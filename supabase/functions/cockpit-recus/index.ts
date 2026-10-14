import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { analyser, choisirPdf, hoteStripe, lienPdfAccepte, noteDuPassage, nomSur, Refus } from "./lecteur.ts"

/**
 * cockpit-recus — reçoit les reçus Claude que le petit programme du compte Google de Raphaël lit dans sa boîte (Google Apps
 * Script, docs/recus-par-email.md) et les range dans Coûts (chantier 72a8d0f4, migration 0086).
 *
 * Qui parle : la clé du prestataire (en-tête `x-cockpit-cle`, créée par `brancher_import_recus`, seul son sha256 est en base).
 * Elle ne permet QUE d'ajouter des factures à CE prestataire de CE projet et de noter le passage : rien d'autre.
 * Un mail n'est qu'une DONNÉE : `lecteur.ts` (même règle que scripts/importer-recus.py) refuse tout ce qui est incohérent.
 *
 * POST { mails: [{ texte, pdfs?: [{ nom, base64 }] }], cadence_jours? }  -> { ok, statut, note, mails: [...], bilan }
 * POST { echec: "raison" }                                                 -> le passage n'a pas pu avoir lieu : noté, visible dans Coûts
 * POST { etat: true }                                                      -> { depuis, cadence_jours } (lecture seule)
 */
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } })
const BUCKET = "cockpit-medias"
const PDF_MAX = 5 * 1024 * 1024
const MAILS_MAX = 20
const TEXTE_MAX = 200_000
const NOTE_MAX = 300

async function sha256(t: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
function octets(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, ""))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch { return null }
}
const estPdf = (o: Uint8Array) => o.length > 4 && o.length <= PDF_MAX && o[0] === 0x25 && o[1] === 0x50 && o[2] === 0x44 && o[3] === 0x46

/** Le PDF depuis le lien du mail : seulement pay.stripe.com, redirections vérifiées une à une. */
async function pdfDuLien(lien: string | null): Promise<{ o: Uint8Array | null; raison: string }> {
  if (!lienPdfAccepte(lien)) return { o: null, raison: "lien du PDF inattendu" }
  let url = lien!
  for (let i = 0; i < 4; i++) {
    let r: Response
    try { r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20000) }) } catch { return { o: null, raison: "téléchargement impossible" } }
    if (r.status >= 300 && r.status < 400) {
      const suite = r.headers.get("location")
      if (!suite) return { o: null, raison: "redirection sans adresse" }
      url = new URL(suite, url).toString()
      if (!hoteStripe(url)) return { o: null, raison: "redirection hors de Stripe refusée" }
      continue
    }
    if (r.status !== 200) {
      const t = (await r.text()).slice(0, 80).toLowerCase()
      return { o: null, raison: t.includes("expired") ? "lien expiré" : `PDF refusé par Stripe (HTTP ${r.status})` }
    }
    const o = new Uint8Array(await r.arrayBuffer())
    return estPdf(o) ? { o, raison: "" } : { o: null, raison: "le fichier reçu n'est pas un PDF" }
  }
  return { o: null, raison: "trop de redirections" }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, erreur: "POST seulement" }, 405)
  const cle = req.headers.get("x-cockpit-cle") ?? ""
  if (!/^rc_[0-9a-f]{64}$/.test(cle)) return json({ ok: false, erreur: "clé absente ou mal formée" }, 401)
  const base = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "cockpit" } })
  const { data: service } = await base.from("services").select("id, projet_id, nom, import_depuis, import_cadence_jours")
    .eq("import_cle_hash", await sha256(cle)).is("archived_at", null).maybeSingle()
  if (!service) return json({ ok: false, erreur: "clé inconnue ou retirée" }, 401)

  let corps: { mails?: unknown; echec?: unknown; etat?: unknown; cadence_jours?: unknown } = {}
  try { corps = await req.json() } catch { return json({ ok: false, erreur: "corps illisible" }, 400) }
  const cadence = Number.isInteger(corps.cadence_jours) && (corps.cadence_jours as number) >= 1 && (corps.cadence_jours as number) <= 90 ? corps.cadence_jours as number : null
  const battement = async (statut: "ok" | "echec", note: string) => {
    const maj: Record<string, unknown> = { import_at: new Date().toISOString(), import_statut: statut, import_note: note.slice(0, NOTE_MAX) }
    if (cadence) maj.import_cadence_jours = cadence
    else if (!service.import_cadence_jours) maj.import_cadence_jours = 7
    await base.from("services").update(maj).eq("id", service.id)
  }

  if (corps.etat) return json({ ok: true, depuis: service.import_depuis, cadence_jours: service.import_cadence_jours })
  if (typeof corps.echec === "string") {
    const note = `Le passage n'a pas pu avoir lieu : ${corps.echec.replace(/\s+/g, " ").trim()}`.slice(0, NOTE_MAX)
    await battement("echec", note)
    return json({ ok: true, statut: "echec", note })
  }
  if (!Array.isArray(corps.mails) || corps.mails.length > MAILS_MAX) return json({ ok: false, erreur: `mails : une liste de ${MAILS_MAX} au plus` }, 400)

  const ajoutes: { montant: string; devise: string; date: string; facture: string; pdf: string }[] = []
  const erreurs: string[] = []
  const resultats: Record<string, unknown>[] = []
  let deja = 0, hors = 0
  for (const [i, m] of (corps.mails as { id?: unknown; texte?: unknown; pdfs?: unknown }[]).entries()) {
    const idMail = typeof m.id === "string" ? m.id.slice(0, 64) : String(i)
    try {
      if (typeof m.texte !== "string" || m.texte.length > TEXTE_MAX) throw new Refus("texte absent ou trop long")
      const r = analyser(m.texte)
      const ligne = { id: idMail, facture: r.facture, montant: r.montant, devise: r.devise, date: r.date }
      if (r.date < String(service.import_depuis)) { hors++; resultats.push({ ...ligne, statut: "hors_periode" }); continue }
      const { data: existe } = await base.from("depenses").select("id").eq("projet_id", service.projet_id).eq("reference", r.facture).limit(1)
      if (existe?.length) { deja++; resultats.push({ ...ligne, statut: "deja_la" }); continue }

      // le PDF : la pièce jointe du mail d'abord, sinon le lien du mail s'il est encore valable
      let pdf: Uint8Array | null = null, raisonPdf = ""
      const jointes = Array.isArray(m.pdfs) ? (m.pdfs as { nom?: unknown; base64?: unknown }[]).filter((p) => typeof p.nom === "string" && typeof p.base64 === "string").slice(0, 6) : []
      const k = choisirPdf(r.facture, jointes.map((p) => ({ nom: p.nom as string })))
      if (k >= 0) {
        const o = octets(jointes[k].base64 as string)
        if (o && estPdf(o)) pdf = o
        else raisonPdf = "pièce jointe illisible ou trop grosse"
      }
      if (!pdf) { const l = await pdfDuLien(r.lien_facture); pdf = l.o; raisonPdf ||= l.raison }

      let fichier: Record<string, unknown> | null = null, chemin = ""
      let etatPdf = "absent"
      try {
        if (pdf) {
          const nomPdf = `Invoice-${r.facture}.pdf`
          chemin = `${service.projet_id}/depenses/${crypto.randomUUID()}-${nomSur(nomPdf)}`
          const { error: e } = await base.storage.from(BUCKET).upload(chemin, pdf, { contentType: "application/pdf", upsert: false })
          if (e) throw new Error(`dépôt du PDF refusé : ${e.message}`)
          fichier = { chemin, nom: nomPdf, type: "application/pdf", taille: pdf.length }
          etatPdf = "depose"
        }
        const { error: e2 } = await base.from("depenses").insert({
          projet_id: service.projet_id, service_id: service.id, date: r.date, montant: r.montant, devise: r.devise,
          type: "facture", description: r.description, reference: r.facture, fichier,
        })
        if (e2) throw new Error(`écriture refusée : ${e2.message}`)
      } catch (e) {
        if (chemin && fichier) await base.storage.from(BUCKET).remove([chemin])
        throw new Refus(`${r.facture} : ${(e as Error).message}`.slice(0, 120))
      }
      ajoutes.push({ montant: r.montant, devise: r.devise, date: r.date, facture: r.facture, pdf: etatPdf })
      resultats.push({ ...ligne, statut: "ajoute", pdf: etatPdf, raison_pdf: raisonPdf })
    } catch (e) {
      const msg = e instanceof Refus ? e.message : "erreur inattendue"
      erreurs.push(msg)
      resultats.push({ id: idMail, statut: "erreur", message: msg })
    }
  }
  const note = noteDuPassage(ajoutes, deja, erreurs)
  const statut = erreurs.length ? "echec" : "ok"
  await battement(statut, note)
  return json({ ok: true, statut, note, mails: resultats, bilan: { ajoutes: ajoutes.length, deja_la: deja, hors_periode: hors, erreurs: erreurs.length } })
})
