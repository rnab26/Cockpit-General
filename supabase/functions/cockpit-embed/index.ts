import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { type SupabaseClient, createClient } from "jsr:@supabase/supabase-js@2"

/**
 * cockpit-embed — la fonction serveur du module embarqué du Cockpit.
 *
 * POURQUOI ELLE EXISTE : n'importe quel site de Raphaël (FacePro en Jinja,
 * le Trieur en React, un futur site HTML) affiche les demandes de SON projet
 * en collant une balise <script data-cle="…">. Ce script ne doit ni porter
 * une clé de base, ni connaître le schéma : il parle à cette fonction, qui
 * tient la clé de service et ne répond QUE pour le projet dont on lui donne
 * la `cle_embed` (une clé par projet, révocable en la régénérant).
 *
 * Contrat : POST JSON `{action, ...}`, en-tête `x-cockpit-key` (ou champ
 * `cle`). Réponse JSON ; toute erreur = `{erreur}` en français lisible par
 * un non-technicien, avec un code HTTP juste (401 clé, 400 requête, 404
 * hors projet, 409 état incompatible, 500 imprévu).
 *
 * Ce qui ne sort JAMAIS d'ici : `notes`, `pris_par`, `pris_jusqu_a`,
 * `reproduction`, `cle_embed`, `created_by`, `answered_by` — le travail
 * interne des sessions n'est pas pour l'utilisateur final (D-03, D-05).
 * Les colonnes renvoyées sont listées explicitement, jamais `select *`.
 *
 * verify_jwt = false (déployée avec VERIFY_JWT=false
 * scripts/deployer-fonction.sh cockpit-embed) : la clé du projet EST
 * l'authentification, un navigateur anonyme doit pouvoir appeler.
 */

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cockpit-key",
  "Access-Control-Max-Age": "86400",
}

/** Les colonnes d'un chantier qu'un utilisateur final peut voir.
 *  `comment_verifier` (0005) : les étapes écrites pour la personne qui
 *  certifie — destinées à l'utilisateur, ce n'est pas du travail interne. */
const COLONNES_CHANTIER =
  "id, titre, demande, resume_simple, comment_verifier, etat, priorite, origine, section_id, " +
  "created_at, updated_at, livre_at, valide_at, valide_par, archived_at"

/** Les colonnes d'un message qu'un utilisateur final peut voir. */
const COLONNES_MESSAGE =
  "id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options, " +
  "reponse, precision, repond_a, etat, answered_at, created_at"

/** Les colonnes d'une activité (progression en direct, D-07). */
const COLONNES_ACTIVITE =
  "id, chantier_id, session, etape, pourcentage, eta_secondes, statut, detail, demarre_at, updated_at"

/** États d'un chantier créé par un utilisateur tant qu'aucune session ne l'a pris :
 * seuls ceux-là restent modifiables par lui (titre, demande). */
const ETATS_MODIFIABLES = ["a_trier", "a_cadrer"]

class ErreurLisible extends Error {
  constructor(public statut: number, message: string) {
    super(message)
  }
}

function json(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  })
}

function texte(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

/** Un identifiant reçu du navigateur : uuid ou rien. */
function uuid(v: unknown, quoi: string): string {
  const s = texte(v)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    throw new ErreurLisible(400, `Il manque l'identifiant de ${quoi}.`)
  }
  return s
}

/** Le nom de la personne qui agit, tel que le script l'a reçu (data-utilisateur). */
function auteurDe(corps: Record<string, unknown>): string {
  return texte(corps.auteur).slice(0, 80) || "Utilisateur"
}

/** Traduit une erreur du SDK / de Postgres en phrase lisible. Les RPC du
 * schéma lèvent déjà des messages en français (« ce chantier n'est pas
 * « à vérifier » ») : on les garde, avec une majuscule et un point. */
function erreurDepuis(e: unknown): ErreurLisible {
  if (e instanceof ErreurLisible) return e
  const brut = (e && typeof e === "object" && "message" in e) ? String((e as { message: unknown }).message) : String(e)
  const m = brut.trim()
  if (/n'est pas « à vérifier »/.test(m)) {
    return new ErreurLisible(409, "Cette demande n'est pas encore « codée — à vérifier » : on ne peut pas la certifier pour l'instant.")
  }
  if (/ni « à vérifier » ni « validé »/.test(m)) {
    return new ErreurLisible(409, "Cette demande n'est ni « à vérifier » ni « certifiée » : il n'y a rien à corriger dessus pour l'instant.")
  }
  if (/dis ce qui ne marche pas/.test(m)) {
    return new ErreurLisible(400, "Écris ce qui ne marche pas avant d'envoyer la correction.")
  }
  if (/message introuvable ou pas une question/.test(m)) {
    return new ErreurLisible(404, "Cette question n'existe plus, ou ce n'est pas une question.")
  }
  console.error("cockpit-embed erreur brute :", m)
  return new ErreurLisible(500, "Le serveur n'a pas pu enregistrer. Réessaie dans un instant.")
}

type Projet = { id: string; slug: string; nom: string; couleur: string | null }

async function projetParCle(sb: SupabaseClient, cle: string): Promise<Projet> {
  if (!cle) throw new ErreurLisible(401, "Clé du projet manquante : la balise <script> doit porter data-cle.")
  const { data, error } = await sb.from("projets").select("id, slug, nom, couleur, actif").eq("cle_embed", cle).maybeSingle()
  if (error) throw erreurDepuis(error)
  if (!data) throw new ErreurLisible(401, "Clé du projet inconnue : vérifie la valeur de data-cle.")
  if (data.actif === false) throw new ErreurLisible(401, "Ce projet est désactivé dans le Cockpit.")
  return { id: data.id, slug: data.slug, nom: data.nom, couleur: data.couleur }
}

/** Un chantier du projet, ou 404 — jamais un chantier d'un autre projet,
 * même avec un identifiant deviné. */
async function chantierDuProjet(sb: SupabaseClient, projet: Projet, id: string) {
  const { data, error } = await sb.from("chantiers")
    .select(COLONNES_CHANTIER + ", visible_utilisateurs")
    .eq("id", id).eq("projet_id", projet.id).maybeSingle()
  if (error) throw erreurDepuis(error)
  if (!data || data.visible_utilisateurs === false) throw new ErreurLisible(404, "Cette demande n'existe pas dans ce projet.")
  return data
}

// ----------------------------------------------------------------- actions

async function actionEtat(sb: SupabaseClient, projet: Projet) {
  const { data: chantiers, error: e1 } = await sb.from("chantiers")
    .select(COLONNES_CHANTIER)
    .eq("projet_id", projet.id)
    .eq("visible_utilisateurs", true)
    .or("archived_at.is.null,etat.eq.valide")
    .order("created_at", { ascending: true })
  if (e1) throw erreurDepuis(e1)
  const liste = (chantiers ?? []) as Array<Record<string, unknown> & { id: string }>
  const ids = liste.map((c) => c.id)

  let messages: Array<Record<string, unknown> & { chantier_id: string | null }> = []
  if (ids.length > 0) {
    const { data, error } = await sb.from("messages")
      .select(COLONNES_MESSAGE)
      .in("chantier_id", ids)
      .order("created_at", { ascending: true })
    if (error) throw erreurDepuis(error)
    messages = data ?? []
  }

  const { data: activites, error: e3 } = await sb.from("activite")
    .select(COLONNES_ACTIVITE)
    .eq("projet_id", projet.id)
    .eq("statut", "en_cours")
    .order("updated_at", { ascending: false })
  if (e3) throw erreurDepuis(e3)
  // Une activité sur un chantier interne ne sort pas : son étape décrit un
  // travail que l'utilisateur final n'a pas à voir.
  const visibles = new Set(ids)
  const activite = ((activites ?? []) as Array<Record<string, unknown> & { chantier_id: string | null }>)
    .filter((a) => a.chantier_id === null || visibles.has(a.chantier_id))

  const parChantier = new Map<string, unknown[]>()
  for (const m of messages) {
    if (!m.chantier_id) continue
    const tableau = parChantier.get(m.chantier_id) ?? []
    tableau.push(m)
    parChantier.set(m.chantier_id, tableau)
  }
  return {
    projet: { slug: projet.slug, nom: projet.nom, couleur: projet.couleur },
    chantiers: liste.map((c) => ({
      ...c,
      messages: parChantier.get(c.id) ?? [],
      activite: activite.filter((a) => a.chantier_id === c.id),
    })),
    activite,
  }
}

async function actionCreer(sb: SupabaseClient, projet: Projet, corps: Record<string, unknown>) {
  const titre = texte(corps.titre).slice(0, 200)
  const demande = texte(corps.demande)
  if (!titre) throw new ErreurLisible(400, "Donne un titre à ta demande.")
  const auteur = auteurDe(corps)
  const { data, error } = await sb.from("chantiers").insert({
    projet_id: projet.id,
    titre,
    demande: demande || null,
    origine: "utilisateur",
    etat: "a_trier",
    created_by: null,
  }).select(COLONNES_CHANTIER).single()
  if (error) throw erreurDepuis(error)
  // Qui a demandé : la table ne porte pas de nom en clair (created_by est un
  // uuid de compte, absent ici), donc le premier message du fil le dit.
  const { error: e2 } = await sb.from("messages").insert({
    projet_id: projet.id,
    chantier_id: data.id,
    auteur,
    auteur_type: "utilisateur",
    kind: "info",
    corps: `Demande créée par ${auteur}.`,
  })
  if (e2) console.error("cockpit-embed : message de création non écrit :", e2.message)
  return { chantier: { ...data, messages: [], activite: [] } }
}

async function actionRepondre(sb: SupabaseClient, projet: Projet, corps: Record<string, unknown>) {
  const id = uuid(corps.message_id, "la question")
  const { data: msg, error } = await sb.from("messages").select("id, projet_id, kind").eq("id", id).maybeSingle()
  if (error) throw erreurDepuis(error)
  if (!msg || msg.projet_id !== projet.id) throw new ErreurLisible(404, "Cette question n'existe pas dans ce projet.")
  const reponse = texte(corps.reponse) || null
  const precision = texte(corps.precision) || null
  const etat = texte(corps.etat) || null
  if (etat && !["fait", "pas_encore", "bloque"].includes(etat)) {
    throw new ErreurLisible(400, "État inconnu : attendu « fait », « pas_encore » ou « bloque ».")
  }
  if (!reponse && !etat) throw new ErreurLisible(400, "Choisis une réponse avant de valider.")
  const { error: e2 } = await sb.rpc("repondre_message", {
    p_id: id,
    p_par: auteurDe(corps),
    p_reponse: reponse,
    p_precision: precision,
    p_etat: etat,
  })
  if (e2) throw erreurDepuis(e2)
  return { ok: true }
}

async function actionCertifier(sb: SupabaseClient, projet: Projet, corps: Record<string, unknown>) {
  const id = uuid(corps.chantier_id, "la demande")
  await chantierDuProjet(sb, projet, id)
  const { error } = await sb.rpc("certifier_chantier", {
    p_id: id,
    p_par: auteurDe(corps),
    p_mots: texte(corps.mots) || null,
  })
  if (error) throw erreurDepuis(error)
  return { ok: true }
}

async function actionCorriger(sb: SupabaseClient, projet: Projet, corps: Record<string, unknown>) {
  const id = uuid(corps.chantier_id, "la demande")
  await chantierDuProjet(sb, projet, id)
  const mots = texte(corps.mots)
  if (!mots) throw new ErreurLisible(400, "Écris ce qui ne marche pas avant d'envoyer la correction.")
  const { error } = await sb.rpc("corriger_chantier", { p_id: id, p_par: auteurDe(corps), p_mots: mots })
  if (error) throw erreurDepuis(error)
  return { ok: true }
}

async function actionMessage(sb: SupabaseClient, projet: Projet, corps: Record<string, unknown>) {
  const id = uuid(corps.chantier_id, "la demande")
  await chantierDuProjet(sb, projet, id)
  const texteMsg = texte(corps.corps)
  if (!texteMsg) throw new ErreurLisible(400, "Le message est vide.")
  const { data, error } = await sb.from("messages").insert({
    projet_id: projet.id,
    chantier_id: id,
    auteur: auteurDe(corps),
    auteur_type: "utilisateur",
    kind: "info",
    corps: texteMsg,
  }).select(COLONNES_MESSAGE).single()
  if (error) throw erreurDepuis(error)
  return { message: data }
}

async function actionModifier(sb: SupabaseClient, projet: Projet, corps: Record<string, unknown>) {
  const id = uuid(corps.chantier_id, "la demande")
  const chantier = await chantierDuProjet(sb, projet, id)
  if (chantier.origine !== "utilisateur") {
    throw new ErreurLisible(409, "Cette demande n'a pas été créée depuis ce site : elle ne se modifie pas ici. Ajoute plutôt un message dessous.")
  }
  if (!ETATS_MODIFIABLES.includes(chantier.etat)) {
    throw new ErreurLisible(409, "Une session a déjà pris cette demande : on ne la réécrit plus. Ajoute plutôt un message dessous, il sera lu.")
  }
  const titre = texte(corps.titre).slice(0, 200)
  const demande = texte(corps.demande)
  if (!titre) throw new ErreurLisible(400, "Le titre ne peut pas être vide.")
  const { data, error } = await sb.from("chantiers")
    .update({ titre, demande: demande || null })
    .eq("id", id).eq("projet_id", projet.id)
    .select(COLONNES_CHANTIER).single()
  if (error) throw erreurDepuis(error)
  return { chantier: data }
}

// ------------------------------------------------------------------ serveur

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ erreur: "Cette adresse n'accepte que des requêtes POST." }, 405)

  const debut = Date.now()
  let action = "?"
  let slug = "?"
  try {
    let corps: Record<string, unknown>
    try {
      corps = (await req.json()) as Record<string, unknown>
      if (!corps || typeof corps !== "object") throw new Error("pas un objet")
    } catch {
      throw new ErreurLisible(400, "Le corps de la requête n'est pas du JSON valide.")
    }
    action = texte(corps.action)
    const cle = texte(req.headers.get("x-cockpit-key")) || texte(corps.cle)

    const url = Deno.env.get("SUPABASE_URL")
    const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!url || !cleService) throw new ErreurLisible(500, "Le serveur du Cockpit est mal configuré (clé de service absente).")
    const sb = createClient(url, cleService, {
      db: { schema: "cockpit" },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const projet = await projetParCle(sb, cle)
    slug = projet.slug

    let resultat: unknown
    switch (action) {
      case "etat": resultat = await actionEtat(sb, projet); break
      case "creer": resultat = await actionCreer(sb, projet, corps); break
      case "repondre": resultat = await actionRepondre(sb, projet, corps); break
      case "certifier": resultat = await actionCertifier(sb, projet, corps); break
      case "corriger": resultat = await actionCorriger(sb, projet, corps); break
      case "message": resultat = await actionMessage(sb, projet, corps); break
      case "modifier": resultat = await actionModifier(sb, projet, corps); break
      default:
        throw new ErreurLisible(400, action ? `Action inconnue : « ${action} ».` : "Il manque le champ « action ».")
    }
    console.log(`cockpit-embed ${action} projet=${slug} ${Date.now() - debut} ms`)
    return json(resultat)
  } catch (e) {
    const err = erreurDepuis(e)
    console.log(`cockpit-embed ${action} projet=${slug} ${Date.now() - debut} ms -> ${err.statut} ${err.message}`)
    return json({ erreur: err.message }, err.statut)
  }
})
