// « Est-ce que c'est en ligne ? » — la frise de mise en ligne d'un chantier
// (migration 0007, colonne `chantiers.jalons`, posée par
// `scripts/progression.sh --jalon …`).
//
// Raphaël, 29 sept. 2026 : « quand Claude a fini, j'ai du mal à savoir si
// c'est en ligne ; je suis obligé de demander, on me dit envoyé, déployé, on
// attend la CI, je ne comprends pas. C'est à partir de ce moment-là que je
// peux vérifier. Il faut que quelqu'un qui ne sait pas coder comprenne, comme
// un enfant. » D'où quatre étapes en mots simples, et UNE phrase qui dit s'il
// peut vérifier maintenant.
//
// Pur, vérifié par scripts/verifier-jalons.ts.

export type CleJalon = 'code' | 'pousse' | 'ci_ok' | 'ci_ko' | 'en_ligne' | 'pas_en_ligne'
export interface Jalon { at: string | null; detail: string | null }
export type Jalons = Partial<Record<CleJalon, Jalon>>

export type EtatEtape = 'fait' | 'attente' | 'echec' | 'info'
export interface EtapeFrise {
  cle: 'code' | 'pousse' | 'ci' | 'ligne'
  libelle: string
  etat: EtatEtape
  /** Heure lisible (« 14 h 02 », « hier 9 h 15 »), ou null si on ne la connaît pas. */
  heure: string | null
  detail: string | null
  /** Une adresse cliquable (étape « en ligne » dont le détail est une URL). */
  url: string | null
}

export type CodeSynthese = 'en_ligne' | 'pas_encore' | 'ci_ko' | 'rien' | 'geste'
export interface Synthese { code: CodeSynthese; texte: string; teinte: 'ok' | 'attention' | 'alerte' | 'info'; peutVerifier: boolean }

const CLES: readonly CleJalon[] = ['code', 'pousse', 'ci_ok', 'ci_ko', 'en_ligne', 'pas_en_ligne']

/** Lit la colonne telle qu'elle arrive (jsonb, peut-être null ou mal formé) : seules les clés connues. */
export function lireJalons(brut: unknown): Jalons {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {}
  const out: Jalons = {}
  for (const k of CLES) {
    const v = (brut as Record<string, unknown>)[k]
    if (v && typeof v === 'object') {
      const o = v as { at?: unknown; detail?: unknown }
      out[k] = { at: typeof o.at === 'string' ? o.at : null, detail: typeof o.detail === 'string' && o.detail.trim() ? o.detail.trim() : null }
    } else if (v === true) out[k] = { at: null, detail: null }
  }
  return out
}

/** « 14 h 02 » aujourd'hui, « hier 9 h 15 », « 27 sept. 18 h 40 » avant (heure LOCALE du téléphone). */
export function heureLisible(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const hm = `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const ecart = Math.round((jour(now) - jour(d)) / 86_400_000)
  if (ecart === 0) return hm
  if (ecart === 1) return `hier ${hm}`
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${hm}`
}

/**
 * Pour une PHRASE (pas une colonne) : « 1 h 23 » seul se lit comme une durée.
 * D'où « 1 h 23 du matin », « 14 h 02 », « hier, 18 h 40 », « le 27 sept., 9 h 05 du matin ».
 */
export function momentLisible(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const hm = `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}${d.getHours() < 12 ? ' du matin' : ''}`
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const ecart = Math.round((jour(now) - jour(d)) / 86_400_000)
  if (ecart === 0) return hm
  if (ecart === 1) return `hier, ${hm}`
  return `le ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}, ${hm}`
}

const URL_SEULE = /^https?:\/\/\S+$/

/**
 * « Rien à mettre en ligne » ou « il faut ton geste » ? La session écrit une
 * raison libre ; elle demande un geste quand elle parle d'installer, d'activer,
 * d'autoriser, de télécharger, de cliquer — ou le nomme (« à toi de… »).
 */
export function demandeUnGeste(raison: string | null | undefined): boolean {
  return /(install|apk|geste|ta part|à toi de|raphaël|raphael|cliqu|touche|activ|autoris|permission|télécharg|telecharg|mets? à jour|mettre à jour|redémarr)/i.test(raison ?? '')
}

/** Les quatre étapes, ou null si aucun jalon n'est posé (ancien chantier : on n'affiche rien). */
export function frise(brut: unknown, now: Date = new Date()): EtapeFrise[] | null {
  const j = lireJalons(brut)
  if (!Object.keys(j).length) return null
  const h = (k: CleJalon) => heureLisible(j[k]?.at, now)
  // Une étape plus loin prouve les précédentes (on ne met pas en ligne un code non envoyé).
  const enLigne = !!j.en_ligne
  const ciOk = !!j.ci_ok || enLigne
  const pousse = !!j.pousse || ciOk || !!j.ci_ko
  const code = !!j.code || pousse || !!j.pas_en_ligne

  const etapes: EtapeFrise[] = [
    { cle: 'code', libelle: '✍️ Codé', etat: code ? 'fait' : 'attente', heure: h('code'), detail: null, url: null },
    { cle: 'pousse', libelle: '📤 Envoyé', etat: pousse ? 'fait' : 'attente', heure: h('pousse'), detail: j.pousse?.detail ?? null, url: null },
    j.ci_ko && !ciOk
      ? { cle: 'ci', libelle: '❌ Les robots ont trouvé un problème, Claude corrige', etat: 'echec', heure: h('ci_ko'), detail: j.ci_ko.detail, url: null }
      : { cle: 'ci', libelle: '🤖 Vérifié par les robots', etat: ciOk ? 'fait' : 'attente', heure: h('ci_ok'), detail: j.ci_ok?.detail ?? null, url: null },
  ]
  if (j.pas_en_ligne && !enLigne) {
    const raison = j.pas_en_ligne.detail
    etapes.push({ cle: 'ligne', etat: 'info', heure: h('pas_en_ligne'), detail: null, url: null,
      libelle: demandeUnGeste(raison) ? `👉 Il faut ton geste${raison ? ` : ${raison}` : ''}` : `ℹ️ Rien à mettre en ligne${raison ? ` : ${raison}` : ''}` })
  } else {
    const d = j.en_ligne?.detail ?? null
    etapes.push({ cle: 'ligne', libelle: '🌐 En ligne', etat: enLigne ? 'fait' : 'attente', heure: h('en_ligne'),
      detail: d, url: d && URL_SEULE.test(d) ? d : null })
  }
  return etapes
}

/** La phrase au-dessus de « Ça fonctionne » : peut-il vérifier MAINTENANT ? null sans aucun jalon. */
export function syntheseMiseEnLigne(brut: unknown, now: Date = new Date()): Synthese | null {
  const j = lireJalons(brut)
  if (!Object.keys(j).length) return null
  if (j.en_ligne) {
    const h = momentLisible(j.en_ligne.at, now)
    return { code: 'en_ligne', teinte: 'ok', peutVerifier: true,
      texte: `🌐 C’est en ligne${h ? ` depuis ${h}` : ''} : tu peux vérifier maintenant.` }
  }
  if (j.ci_ko && !j.ci_ok) return { code: 'ci_ko', teinte: 'alerte', peutVerifier: false,
    texte: '❌ Les robots ont trouvé un problème : Claude corrige. Attends avant de vérifier.' }
  if (j.pas_en_ligne) {
    const raison = j.pas_en_ligne.detail
    return demandeUnGeste(raison)
      ? { code: 'geste', teinte: 'attention', peutVerifier: false, texte: `👉 Il faut ton geste avant de vérifier${raison ? ` : ${raison}` : '.'}` }
      : { code: 'rien', teinte: 'info', peutVerifier: true, texte: `ℹ️ Rien à mettre en ligne${raison ? ` (${raison})` : ''} : tu peux vérifier.` }
  }
  return { code: 'pas_encore', teinte: 'attention', peutVerifier: false, texte: '⏳ Pas encore en ligne : attends avant de vérifier.' }
}
