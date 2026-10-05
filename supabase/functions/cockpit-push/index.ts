import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import webpush from "npm:web-push@3.6.7"

/**
 * cockpit-push — envoie la notification « Claude a répondu » aux appareils
 * abonnés (migration 0039). Appelée UNIQUEMENT par le trigger de la base
 * (`cockpit.push_sur_reponse`, pg_net) avec l'en-tête `x-push-secret` ; jamais
 * par l'app. Le corps est `{message_id}` : le texte est relu en base, jamais
 * pris de l'appelant.
 *
 * Destinataires : `cockpit.notif_destinataires` (réglages de chacun, migration
 * 0052 : type voulu, projet non coupé). Un abonnement mort (404/410) est supprimé ; toute autre erreur est
 * gardée dans `derniere_erreur` (visible en base).
 * Secrets de la fonction : PUSH_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
 * VAPID_SUBJECT (posés par scripts/installer-push.mjs).
 */
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } })
const court = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t)

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erreur: "POST seulement" }, 405)
  const secret = Deno.env.get("PUSH_SECRET")
  if (!secret || req.headers.get("x-push-secret") !== secret) return json({ erreur: "non autorisé" }, 401)
  let id = ""
  try { id = String((await req.json()).message_id ?? "") } catch { /* corps illisible */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ erreur: "message_id manquant" }, 400)

  const base = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "cockpit" } })
  const { data: m } = await base.from("messages").select("id, projet_id, chantier_id, auteur_type, kind, corps, repond_a").eq("id", id).maybeSingle()
  if (!m || m.auteur_type !== "session" || m.kind !== "info" || !m.repond_a) return json({ envoye: 0, raison: "pas une réponse" })
  const [{ data: projet }, { data: chantier }] = await Promise.all([
    base.from("projets").select("nom, slug").eq("id", m.projet_id).maybeSingle(),
    m.chantier_id ? base.from("chantiers").select("titre").eq("id", m.chantier_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  if (!projet || projet.slug.startsWith("test-")) return json({ envoye: 0, raison: "projet de test" })

  // UNE règle, en base (migration 0052) : admins et membres qui veulent ce type sur ce projet.
  const { data: dest } = await base.rpc("notif_destinataires", { p_type: "reponse", p_projet: m.projet_id })
  const users = [...new Set((dest ?? []).map((x: { user_id: string }) => x.user_id))]
  if (!users.length) return json({ envoye: 0, raison: "personne ne veut cette notification" })
  const { data: abos } = await base.from("push_abonnements").select("id, endpoint, p256dh, auth").in("user_id", users)
  if (!abos?.length) return json({ envoye: 0, raison: "aucun appareil abonné" })

  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@cockpit.local", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!)
  const payload = JSON.stringify({
    titre: `Claude a répondu · ${projet.nom}`,
    corps: court(m.corps.replace(/\s+/g, " "), 140),
    sujet: chantier?.titre ?? "Discussion du projet",
    projet_id: m.projet_id, chantier_id: m.chantier_id, message_id: m.id,
  })
  let envoye = 0, retires = 0, erreurs = 0
  await Promise.all(abos.map(async (a: { id: string; endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, payload, { TTL: 6 * 3600, urgency: "high" })
      envoye++
      await base.from("push_abonnements").update({ derniere_livraison_at: new Date().toISOString(), derniere_erreur: null }).eq("id", a.id)
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) { retires++; await base.from("push_abonnements").delete().eq("id", a.id) }
      else { erreurs++; await base.from("push_abonnements").update({ derniere_erreur: court(`${code ?? ""} ${(e as Error).message}`, 200) }).eq("id", a.id) }
    }
  }))
  return json({ envoye, retires, erreurs })
})
