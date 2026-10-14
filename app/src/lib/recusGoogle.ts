/**
 * Reçus Claude lus par un programme du compte Google de Raphaël (0088, chantier 72a8d0f4) : UNE source de règles pour l'écran
 * (carte du prestataire « Claude » + assistant d'installation) et pour les bancs. Le programme lui-même et ses réglages Google sont
 * dans src/google/recus-claude/ ; la porte d'entrée est la fonction serveur supabase/functions/cockpit-recus.
 */
import { dateRelative } from './dates.ts'
import { ALIAS_PRESTATAIRES } from './fournisseurs.ts'

/** Une clé d'import, telle que l'app la lit (jamais son texte : la base ne garde que son empreinte et ses 4 derniers caractères). */
export interface CleImport {
  id: string; projet_id: string; service_id: string; fin: string; created_at: string
  revoquee_at: string | null; derniere_utilisation_at: string | null; utilisations: number; programme_version: number | null
}
export function lireCle(r: Record<string, unknown>): CleImport {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
  return { ...(r as unknown as CleImport), utilisations: n(r.utilisations) ?? 0, programme_version: n(r.programme_version) }
}

/** La clé active d'un prestataire (au plus une : la base l'impose), ou null. */
export function cleActive(cles: readonly CleImport[], serviceId: string): CleImport | null {
  return cles.find((c) => c.service_id === serviceId && !c.revoquee_at) ?? null
}

/** Seul le fournisseur Anthropic est lu pour l'instant (supabase/functions/cockpit-recus/regle.ts) : son prestataire s'appelle « Claude » (ou « Anthropic »). */
const NOMS_LUS = new Set(['anthropic', ...(ALIAS_PRESTATAIRES['anthropic.com'] ?? [])])
export function serviceALecteur(nom: string): boolean {
  return NOMS_LUS.has(nom.trim().toLowerCase())
}

/** La forme d'une clé : « cki_ » puis 64 caractères hexadécimaux. */
export const CLE_IMPORT_RE = /^cki_[0-9a-f]{64}$/
/** L'endroit du programme où la clé est posée (exactement une fois, un test le garde). */
export const MARQUE_CLE = "'__CLE__'"

/** Le programme prêt à coller : la clé y est posée. Refuse une clé mal formée ou un programme qui n'a pas sa marque. */
export function programmeAvecCle(source: string, cle: string): string {
  if (!CLE_IMPORT_RE.test(cle)) throw new Error('La clé n’a pas la bonne forme.')
  const n = source.split(MARQUE_CLE).length - 1
  if (n !== 1) throw new Error(`Le programme doit porter ${MARQUE_CLE} exactement une fois (il l’a ${n} fois).`)
  return source.replace(MARQUE_CLE, () => `'${cle}'`)
}

/** La version du programme livré avec l'app (« const VERSION = 1; »). */
export function versionDuProgramme(source: string): number | null {
  const m = /^const VERSION = (\d+);/m.exec(source)
  return m ? Number(m[1]) : null
}

export type NiveauGoogle = 'aucune' | 'attente' | 'branche' | 'perime'
export interface EtatGoogle { niveau: NiveauGoogle; titre: string; detail: string | null }

/**
 * Ce que la carte du prestataire dit du programme du compte Google. Le « battement » (dernier passage, échec, retard) reste dit par
 * `etatImportAuto` (lib/depenses.ts) : ici, seulement la CLÉ et le dernier appel du programme.
 */
export function etatGoogle(cle: CleImport | null, versionLivree: number, now: Date): EtatGoogle {
  if (!cle) {
    return {
      niveau: 'aucune', titre: 'Reçus Claude par e-mail : pas encore branchés.',
      detail: 'Un petit programme de ton compte Google les lit chaque semaine et les range ici, avec le PDF de chaque facture. Gratuit, aucune IA sur ta boîte mail.',
    }
  }
  if (!cle.derniere_utilisation_at) {
    return { niveau: 'attente', titre: `Clé créée ${dateRelative(cle.created_at, now)} (…${cle.fin}) : le programme n’a pas encore appelé le cockpit.`, detail: 'Termine l’installation dans ton compte Google (étapes dans « Gérer »).' }
  }
  const v = cle.programme_version
  if (v !== null && v < versionLivree) {
    return {
      niveau: 'perime', titre: `Le programme de ton compte Google est en version ${v} ; la version ${versionLivree} est disponible.`,
      detail: 'Touche « Gérer » : tu recopies le nouveau programme (avec une nouvelle clé).',
    }
  }
  return { niveau: 'branche', titre: `Programme du compte Google branché : il a appelé le cockpit ${dateRelative(cle.derniere_utilisation_at, now)}.`, detail: `Clé …${cle.fin}.` }
}

/**
 * « PDF de toutes les factures » : le programme ne lit que les reçus datés du jour de départ du prestataire ou après (migration 0083). Les
 * factures déjà dans Coûts depuis plus longtemps n'auraient donc jamais leur PDF. Rend le jour auquel reculer le départ pour les rattraper
 * (la plus ancienne facture du prestataire), ou null quand il n'y a rien à rattraper (aucune facture, ou départ déjà assez ancien).
 */
export function plusAncienneFacture(depenses: readonly { service_id: string | null; type: string; date: string }[], serviceId: string): string | null {
  const jours = depenses.filter((d) => d.service_id === serviceId && d.type === 'facture').map((d) => d.date).sort()
  return jours[0] ?? null
}
export function departAReculer(departActuel: string | undefined, plusAncienne: string | null): string | null {
  if (!plusAncienne || !/^\d{4}-\d{2}-\d{2}$/.test(plusAncienne)) return null
  if (!departActuel || !/^\d{4}-\d{2}-\d{2}$/.test(departActuel)) return null
  return plusAncienne < departActuel && plusAncienne >= '2023-01-01' ? plusAncienne : null
}

// -------------------------------------------------------------------------------------------------------- l'assistant

export type CopieDemandee = 'programme' | 'reglages'
export interface Etape {
  id: 'cle' | 'google' | 'programme' | 'reglages' | 'reglages-coller' | 'installer' | 'verifier'
  titre: string
  /** Une idée par phrase, des mots de tous les jours. Le nom exact d'un bouton ou d'un champ est entre « ». */
  consignes: readonly string[]
  lien?: { url: string; libelle: string }
  copier?: { quoi: CopieDemandee; libelle: string }
}

export const URL_GOOGLE_PROGRAMMES = 'https://script.google.com/'

export const ETAPES: readonly Etape[] = [
  {
    id: 'cle', titre: 'Crée ta clé',
    consignes: [
      'La clé ouvre une seule porte du cockpit : l’ajout de tes reçus Claude.',
      'Elle ne s’affiche qu’une fois. Si tu la perds, tu en crées une autre et l’ancienne s’arrête.',
    ],
  },
  {
    id: 'google', titre: 'Ouvre Google',
    consignes: [
      'Ouvre la page ci-dessous avec le compte Google qui reçoit tes mails Claude.',
      'Sur téléphone : dans Chrome, touche ⋮ puis « Version pour ordinateur ».',
      'Touche « Nouveau projet » (« New project » en anglais).',
    ],
    lien: { url: URL_GOOGLE_PROGRAMMES, libelle: 'Ouvrir « Google Apps Script »' },
  },
  {
    id: 'programme', titre: 'Colle le programme',
    consignes: [
      'Dans l’éditeur, touche la zone de texte, sélectionne tout et efface.',
      'Touche « Copier le programme » ci-dessous, puis colle dans l’éditeur.',
      'Touche l’icône d’enregistrement (la disquette).',
    ],
    copier: { quoi: 'programme', libelle: 'Copier le programme' },
  },
  {
    id: 'reglages', titre: 'Affiche le fichier de réglages',
    consignes: [
      'À gauche, touche « Paramètres du projet » (le rouage).',
      'Coche la case « Afficher le fichier manifeste "appsscript.json" dans l’éditeur » (en français : la même phrase).',
    ],
  },
  {
    id: 'reglages-coller', titre: 'Colle les réglages Google',
    consignes: [
      'Reviens à l’éditeur (l’icône « < > » à gauche) et ouvre le fichier « appsscript.json ».',
      'Efface tout, touche « Copier les réglages » ci-dessous, colle, puis enregistre.',
      'Ces réglages activent le service Gmail de Google, disent que le programme lit seulement tes mails, et qu’il ne parle qu’à ton cockpit.',
    ],
    copier: { quoi: 'reglages', libelle: 'Copier les réglages' },
  },
  {
    id: 'installer', titre: 'Lance l’installation',
    consignes: [
      'En haut de l’éditeur, choisis la fonction « installer » dans la liste, puis touche « Exécuter ».',
      'Google demande ton accord : touche « Examiner les autorisations » et choisis ton compte.',
      'Un écran « Google n’a pas validé cette appli » apparaît. C’est normal : le programme est le tien. Touche « Paramètres avancés », puis « Accéder à … (non sécurisé) », puis « Autoriser ».',
      'Tu autorises seulement la lecture de tes mails : Google refusera au programme d’en envoyer ou d’en supprimer.',
      'Si le journal dit que le service Gmail n’est pas activé : touche « + » à côté de « Services », choisis « Gmail API », touche « Ajouter », puis relance.',
    ],
  },
  {
    id: 'verifier', titre: 'Vérifie',
    consignes: [
      'Cette étape se coche toute seule dès que le programme appelle le cockpit.',
      'Dans le journal en bas de l’éditeur, tu dois lire « Passage terminé ».',
    ],
  },
]

/** Après l'installation : ce qui se passe ensuite (dit une fois, à la fin). */
export const APRES_INSTALLATION: readonly string[] = [
  'Chaque dimanche matin, le programme repasse tout seul. La carte « Claude » dit quand, et ce qu’il a fait.',
  'Pour tout arrêter : « Révoquer » ici.',
]

/** Les factures déjà dans Coûts depuis plus longtemps que le jour de départ n'ont pas leur PDF : un bouton recule le départ pour les rattraper. */
export const RATTRAPAGE = {
  bouton: 'Récupérer les PDF des anciennes factures',
  titre: (jour: string) => `Tes factures plus anciennes (depuis le ${jour}) n’ont pas encore leur PDF.`,
  explication: 'Le bouton recule le jour de départ des reçus lus. Au prochain passage (dimanche), les PDF manquants sont ajoutés aux factures déjà là. Tu peux aussi relancer « passage » dans Google pour le faire tout de suite.',
  fait: (jour: string) => `Départ reculé au ${jour}. Les PDF manquants seront ajoutés au prochain passage.`,
}

/** Tout le texte que l'assistant montre, en un seul tableau (le banc de clarté le passe au contrôle de vocabulaire). */
export function textesDeLAssistant(): { nom: string; texte: string }[] {
  const out: { nom: string; texte: string }[] = []
  for (const e of ETAPES) {
    out.push({ nom: `étape ${e.id} (titre)`, texte: e.titre })
    e.consignes.forEach((c, i) => out.push({ nom: `étape ${e.id} (consigne ${i + 1})`, texte: c }))
    if (e.copier) out.push({ nom: `étape ${e.id} (bouton)`, texte: e.copier.libelle })
    if (e.lien) out.push({ nom: `étape ${e.id} (lien)`, texte: e.lien.libelle })
  }
  APRES_INSTALLATION.forEach((t, i) => out.push({ nom: `après (${i + 1})`, texte: t }))
  out.push({ nom: 'rattrapage (bouton)', texte: RATTRAPAGE.bouton }, { nom: 'rattrapage (titre)', texte: RATTRAPAGE.titre('14 juil. 2026') },
    { nom: 'rattrapage (explication)', texte: RATTRAPAGE.explication }, { nom: 'rattrapage (fait)', texte: RATTRAPAGE.fait('14 juil. 2026') })
  return out
}
