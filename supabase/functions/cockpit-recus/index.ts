import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import {
  ErreurDonnees, traiterPassage, traiterRecu, validerCadence, validerResultats, texteBorne,
  type Contexte, type Magasin,
} from "./traiter.ts"

/**
 * cockpit-recus — la porte d'entrée des reçus Claude envoyés par le programme du compte Google de Raphaël.
 *
 * POURQUOI ELLE EXISTE (14 oct. 2026, chantier 72a8d0f4) : Raphaël veut que ses reçus Anthropic arrivent seuls dans Coûts, sans
 * session Claude ni jeton (« Programme dans ton compte Google »). Un petit programme de son compte (Google Apps Script) lit,
 * en lecture seule, ses mails « Your receipt from Anthropic » et appelle cette fonction ; elle applique la MÊME règle que
 * scripts/importer-recus.py (regle.ts, comparée à lui à chaque envoi par scripts/verifier-recus-parite.mjs), dédoublonne par
 * numéro de facture, range le PDF de la facture, et écrit le « battement » que la carte du prestataire affiche.
 *
 * La CLÉ est la seule authentification : une clé par prestataire (cockpit.cles_import, migration 0087), montrée une fois dans
 * l'app, révocable ; seule son empreinte sha256 est gardée. Elle porte le projet ET le prestataire : une requête ne peut écrire
 * nulle part ailleurs. verify_jwt = false (déployée avec VERIFY_JWT=false scripts/deployer-fonction.sh cockpit-recus) : ce n'est
 * pas une personne connectée, c'est un programme.
 *
 * Contrat : POST JSON `{action, ...}`, en-tête `x-cockpit-key` (ou champ `cle`). Réponse `{ok: true, ...}` ; un refus de la
 * règle (un reçu qui ne concorde pas) est une réponse NORMALE (`statut: "refus"`), pas une panne ; toute erreur = `{ok: false,
 * erreur}` en français lisible, code HTTP juste (400 requête, 401 clé, 405 méthode, 413 trop gros, 500 imprévu).
 *   etat    -> projet, prestataire, jour de départ des reçus, cadence
 *   recu    -> UN reçu : {texte, pdfs: [{nom, base64}], essai} -> ajouté / déjà là / PDF joint / refus ... (voir traiter.ts)
 *   passage -> la fin du passage : {resultats, echec, cadence_jours, essai} -> écrit le battement (rien en mode essai)
 * Mode `essai` : rien n'est écrit dans Coûts (ni ligne, ni fichier, ni battement) ; seule la date de dernier contact de la clé bouge,
 * ce qui permet à l'app de dire « le programme a bien appelé ».
 *
 * Ce qui ne sort JAMAIS d'ici : la clé, l'empreinte, le texte des mails (il n'est ni gardé ni journalisé).
 */

const BUCKET_MEDIAS = "cockpit-medias"
// Un PDF de 5 Mo en base64 (≈ 6,7 Mo) + le texte du mail (200 000 caractères au plus) tiennent sous 8 Mo. Mesuré le 14 oct. 2026 sur la fonction
// déployée : un corps de 7 à 8,5 Mo est accepté en 1 à 4 s ; un corps que la fonction refuse d'avance (413) sans l'avoir lu reste suspendu côté
// plateforme (9,5 Mo : 160 s puis 503 ; cause non établie, probablement le corps non lu). Sans importance pour un vrai reçu : le programme ne
// prend jamais une pièce de plus de 5 Mo.
const CORPS_MAX = 8 * 1024 * 1024
const TEXTE_MAX = 200_000
const PDFS_MAX = 3
const RE_CLE = /^cki_[0-9a-f]{64}$/

/** Le client de la base du cockpit (schéma `cockpit`, clé de service) : une seule façon de le créer, son type en découle. */
function clientDe(url: string, cleService: string) {
  return createClient(url, cleService, { db: { schema: "cockpit" }, auth: { persistSession: false, autoRefreshToken: false } })
}
type Client = ReturnType<typeof clientDe>

class ErreurLisible extends Error {
  constructor(public statut: number, message: string) {
    super(message)
  }
}

function json(corps: Record<string, unknown>, statut = 200): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

interface Ouverture { cleId: string; utilisations: number; contexte: Contexte; projetNom: string; serviceNom: string; derniere: string | null }

/** Ce que la clé ouvre : son prestataire et son projet. Une clé inconnue, révoquée ou d'un prestataire disparu n'ouvre rien. */
async function ouvrir(sb: Client, cle: string): Promise<Ouverture> {
  if (!cle) throw new ErreurLisible(401, "Clé manquante : le programme du compte Google doit envoyer sa clé.")
  if (!RE_CLE.test(cle)) throw new ErreurLisible(401, "Clé inconnue : recopie le programme depuis le cockpit (Coûts › Claude).")
  const { data: k, error } = await sb.from("cles_import").select("id, projet_id, service_id, revoquee_at, utilisations").eq("empreinte", await sha256Hex(cle)).maybeSingle()
  if (error) { console.error("cockpit-recus : lecture de la clé refusée :", error.message); throw new ErreurLisible(500, "Le serveur n'a pas pu vérifier la clé. Réessaie dans un instant.") }
  if (!k) throw new ErreurLisible(401, "Clé inconnue : recopie le programme depuis le cockpit (Coûts › Claude).")
  if (k.revoquee_at) throw new ErreurLisible(401, "Cette clé a été remplacée ou révoquée : crée-en une nouvelle dans le cockpit (Coûts › Claude) et recopie le programme.")
  const [s, p] = await Promise.all([
    sb.from("services").select("id, nom, import_depuis, import_cadence_jours, import_at, archived_at").eq("id", k.service_id).maybeSingle(),
    sb.from("projets").select("id, nom, actif").eq("id", k.projet_id).maybeSingle(),
  ])
  if (s.error || p.error) { console.error("cockpit-recus : lecture du prestataire refusée :", (s.error ?? p.error)?.message); throw new ErreurLisible(500, "Le serveur n'a pas pu lire le prestataire. Réessaie dans un instant.") }
  if (!s.data || !p.data) throw new ErreurLisible(401, "Le prestataire de cette clé n'existe plus : crée une nouvelle clé dans le cockpit.")
  if (s.data.archived_at) throw new ErreurLisible(401, "Le prestataire de cette clé est archivé dans le cockpit.")
  if (p.data.actif === false) throw new ErreurLisible(401, "Ce projet est désactivé dans le cockpit.")
  return {
    cleId: k.id, utilisations: Number(k.utilisations) || 0, projetNom: p.data.nom, serviceNom: s.data.nom, derniere: s.data.import_at ?? null,
    contexte: {
      projetId: k.projet_id, serviceId: k.service_id, depuis: String(s.data.import_depuis), cadenceActuelle: s.data.import_cadence_jours ?? null,
      erreurInterne: (e) => console.error("cockpit-recus : écriture refusée :", e instanceof Error ? e.message : e),
    },
  }
}

/** Toute l'écriture, sur la vraie base (service_role). Les erreurs sont levées : traiter.ts décide quoi en dire. */
function magasinDe(sb: Client): Magasin {
  const echec = (quoi: string, e: { message: string } | null) => { if (e) throw new Error(`${quoi} : ${e.message}`) }
  return {
    async depenseParReference(projetId, reference) {
      const { data, error } = await sb.from("depenses").select("id, fichier, type").eq("projet_id", projetId).eq("reference", reference).limit(1)
      echec("lecture des dépenses", error)
      return data?.[0] ? { id: data[0].id, fichier: data[0].fichier, type: data[0].type } : null
    },
    async deposer(chemin, octets) {
      const { error } = await sb.storage.from(BUCKET_MEDIAS).upload(chemin, octets, { contentType: "application/pdf", upsert: false })
      echec("dépôt du PDF", error)
    },
    async retirer(chemin) {
      await sb.storage.from(BUCKET_MEDIAS).remove([chemin])
    },
    async inserer(d) {
      const { error } = await sb.from("depenses").insert(d)
      echec("ajout de la dépense", error)
    },
    async joindre(id, fichier) {
      const { data, error } = await sb.from("depenses").update({ fichier }).eq("id", id).is("fichier", null).select("id")
      echec("ajout du PDF à la dépense", error)
      return (data?.length ?? 0) > 0
    },
    async battement(serviceId, b) {
      const { error } = await sb.from("services").update(b).eq("id", serviceId)
      echec("écriture du battement", error)
    },
  }
}

function pdfsDe(brut: unknown): { nom: string; base64: string }[] {
  if (brut === undefined || brut === null) return []
  if (!Array.isArray(brut)) throw new ErreurLisible(400, "La liste des pièces jointes est illisible.")
  if (brut.length > PDFS_MAX) throw new ErreurLisible(400, `${PDFS_MAX} pièces jointes au plus par reçu.`)
  return brut.map((x) => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>
    if (typeof o.nom !== "string" || typeof o.base64 !== "string") throw new ErreurLisible(400, "Une pièce jointe n'a pas de nom ou de contenu.")
    return { nom: o.nom.slice(0, 200), base64: o.base64 }
  })
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, erreur: "Cette adresse n'accepte que des requêtes POST." }, 405)
  const debut = Date.now()
  let action = "?"
  try {
    if (Number(req.headers.get("content-length") ?? 0) > CORPS_MAX) throw new ErreurLisible(413, "La requête est trop grosse (8 Mo au plus).")
    const brut = await req.text()
    if (brut.length > CORPS_MAX) throw new ErreurLisible(413, "La requête est trop grosse (8 Mo au plus).")
    let corps: Record<string, unknown>
    try {
      corps = JSON.parse(brut) as Record<string, unknown>
      if (!corps || typeof corps !== "object" || Array.isArray(corps)) throw new Error("pas un objet")
    } catch {
      throw new ErreurLisible(400, "Le corps de la requête n'est pas du JSON valide.")
    }
    action = typeof corps.action === "string" ? corps.action : "?"
    const cle = (req.headers.get("x-cockpit-key") ?? (typeof corps.cle === "string" ? corps.cle : "")).trim()

    const url = Deno.env.get("SUPABASE_URL")
    const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!url || !cleService) throw new ErreurLisible(500, "Le serveur du Cockpit est mal configuré (clé de service absente).")
    const sb = clientDe(url, cleService)

    const o = await ouvrir(sb, cle)
    // La preuve que le programme a bien appelé (l'app la montre) ; l'essai ne touche rien d'autre. Jamais bloquant.
    const version = typeof corps.version === "number" && Number.isInteger(corps.version) && corps.version >= 1 && corps.version <= 1000 ? corps.version : null
    await sb.from("cles_import").update({ derniere_utilisation_at: new Date().toISOString(), utilisations: o.utilisations + 1, ...(version ? { programme_version: version } : {}) })
      .eq("id", o.cleId).then(() => {}, () => {})

    const mag = magasinDe(sb)
    let resultat: Record<string, unknown>
    switch (action) {
      case "etat":
        resultat = { projet: o.projetNom, prestataire: o.serviceNom, depuis: o.contexte.depuis, cadence_jours: o.contexte.cadenceActuelle, dernier_passage: o.derniere }
        break
      case "recu": {
        const texte = typeof corps.texte === "string" ? corps.texte : ""
        if (!texte.trim()) throw new ErreurLisible(400, "Il manque le texte du reçu.")
        if (texte.length > TEXTE_MAX) throw new ErreurLisible(413, "Le texte du reçu est trop long.")
        resultat = { ...(await traiterRecu(o.contexte, { texte, pdfs: pdfsDe(corps.pdfs), essai: corps.essai === true }, mag)) }
        break
      }
      case "passage":
        resultat = await traiterPassage(o.contexte, {
          resultats: validerResultats(corps.resultats), echec: texteBorne(corps.echec, 200) ?? null,
          cadenceJours: validerCadence(corps.cadence_jours), essai: corps.essai === true,
        }, mag)
        break
      default:
        throw new ErreurLisible(400, action !== "?" ? `Action inconnue : « ${action.slice(0, 40)} ».` : "Il manque le champ « action ».")
    }
    console.log(`cockpit-recus ${action} ${Date.now() - debut} ms`)
    return json({ ok: true, ...resultat })
  } catch (e) {
    if (e instanceof ErreurDonnees) { console.log(`cockpit-recus ${action} ${Date.now() - debut} ms -> 400 ${e.message}`); return json({ ok: false, erreur: e.message }, 400) }
    if (e instanceof ErreurLisible) { console.log(`cockpit-recus ${action} ${Date.now() - debut} ms -> ${e.statut} ${e.message}`); return json({ ok: false, erreur: e.message }, e.statut) }
    console.error(`cockpit-recus ${action} erreur imprévue :`, e instanceof Error ? e.message : e)
    return json({ ok: false, erreur: "Le serveur n'a pas pu traiter la requête. Réessaie dans un instant." }, 500)
  }
})
