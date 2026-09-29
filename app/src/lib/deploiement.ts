// « Est-ce qu'un déploiement est en cours, et le dernier a-t-il marché ? »
//
// Raphaël, 29 sept. 2026 : « je peux voir l'état du déploiement du site ou
// s'il y a un déploiement en cours, sur le cockpit ? ». On lit les exécutions
// GitHub Actions du dépôt du projet (API publique, sans jeton : dépôts publics
// seulement), branche principale, et on en tire UNE phrase par projet et une
// ligne par workflow. Pur : vérifié par scripts/verifier-deploiement.ts.
//
// Ce que ça ne voit PAS, et qu'on dit à l'écran plutôt que de le taire : un
// site hébergé ailleurs que sur GitHub (FacePro est sur Render) — GitHub ne
// connaît que ses propres workflows.

export interface ExecutionGitHub {
  name: string
  status: string            // queued | in_progress | completed | waiting | requested | pending
  conclusion: string | null // success | failure | cancelled | skipped | timed_out | action_required | null
  created_at: string
  updated_at: string
  run_started_at?: string | null
  head_sha: string
  head_branch: string | null
  html_url: string
  display_title?: string
}

export type EtatDeploiement = 'en_cours' | 'reussi' | 'echoue' | 'annule' | 'inconnu'

export interface LigneWorkflow {
  nom: string
  etat: EtatDeploiement
  /** « En cours depuis 2 min », « Réussi il y a 5 min », « Échoué il y a 1 h » */
  phrase: string
  commit: string
  titre: string | null
  lien: string
  quand: string
}

export interface EtatProjet {
  /** La phrase de tête, en mots simples. */
  titre: string
  etat: EtatDeploiement
  /** Au moins un workflow tourne en ce moment : l'écran peut l'animer. */
  enCours: boolean
  lignes: LigneWorkflow[]
}

const EN_COURS = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending'])

export function etatExecution(r: Pick<ExecutionGitHub, 'status' | 'conclusion'>): EtatDeploiement {
  if (EN_COURS.has(r.status)) return 'en_cours'
  if (r.status !== 'completed') return 'inconnu'
  if (r.conclusion === 'success') return 'reussi'
  if (r.conclusion === 'cancelled' || r.conclusion === 'skipped') return 'annule'
  if (r.conclusion) return 'echoue'
  return 'inconnu'
}

/** « à l'instant », « 3 min », « 2 h », « 3 j ». */
export function duree(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return 'moins d’une minute'
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h`
  return `${Math.floor(s / 86400)} j`
}

function phraseLigne(etat: EtatDeploiement, r: ExecutionGitHub, now: Date): string {
  const debut = new Date(r.run_started_at || r.created_at).getTime()
  const fin = new Date(r.updated_at).getTime()
  switch (etat) {
    case 'en_cours': return `En cours depuis ${duree(now.getTime() - debut)}`
    case 'reussi': return `Réussi il y a ${duree(now.getTime() - fin)}`
    case 'echoue': return `Échoué il y a ${duree(now.getTime() - fin)}`
    case 'annule': return `Annulé il y a ${duree(now.getTime() - fin)}`
    default: return 'État inconnu'
  }
}

/** Un nom de workflow qui publie quelque chose (site, image, paquet). */
export function estUnDeploiement(nom: string): boolean {
  return /d[eé]plo[iy]|pages|publi|release|build|image|render/i.test(nom)
}

/**
 * La synthèse d'un projet à partir des exécutions renvoyées par GitHub
 * (du plus récent au plus ancien). Seule la branche principale compte : une
 * branche de travail ne met rien en ligne.
 */
export function etatDuProjet(runs: readonly ExecutionGitHub[], brancheProd = 'main', now: Date = new Date()): EtatProjet {
  const prod = runs.filter((r) => r.head_branch === brancheProd)
  const dernier = new Map<string, ExecutionGitHub>()
  for (const r of prod) if (!dernier.has(r.name)) dernier.set(r.name, r)
  const lignes: LigneWorkflow[] = [...dernier.values()]
    .sort((a, b) => Number(estUnDeploiement(b.name)) - Number(estUnDeploiement(a.name)) || b.created_at.localeCompare(a.created_at))
    .map((r) => {
      const etat = etatExecution(r)
      return { nom: r.name, etat, phrase: phraseLigne(etat, r, now), commit: r.head_sha.slice(0, 7),
        titre: r.display_title ?? null, lien: r.html_url, quand: r.updated_at }
    })
  const enCours = lignes.some((l) => l.etat === 'en_cours')
  if (lignes.length === 0) {
    return { titre: 'Aucune publication récente sur la branche principale', etat: 'inconnu', enCours: false, lignes }
  }
  const deploiements = lignes.filter((l) => estUnDeploiement(l.nom))
  const ref = deploiements.length ? deploiements : lignes
  let titre: string
  let etat: EtatDeploiement
  if (ref.some((l) => l.etat === 'en_cours')) {
    etat = 'en_cours'; titre = 'Mise en ligne en cours — attends qu’elle se termine avant de vérifier'
  } else if (ref.some((l) => l.etat === 'echoue')) {
    etat = 'echoue'; titre = 'La dernière mise en ligne a échoué — ce qui est en ligne est la version d’avant'
  } else if (ref[0].etat === 'reussi') {
    etat = 'reussi'; titre = `En ligne — dernière mise en ligne réussie il y a ${duree(now.getTime() - new Date(ref[0].quand).getTime())}`
  } else {
    etat = ref[0].etat; titre = ref[0].phrase
  }
  return { titre, etat, enCours, lignes }
}

// ---------------------------------------------------------------------------
// Version EN LIGNE lue sur le site lui-même (29 sept. 2026).
//
// Un site hébergé hors GitHub (FacePro sur Render) ou dont le dépôt est privé
// reste invisible pour l'API GitHub anonyme. Le site peut en revanche dire
// quel commit il sert : `GET <url_site>/health` -> { status, commit } (route
// publique de FacePro, commit RENDER_GIT_COMMIT, CORS ouvert sur cette route
// seulement). Ce qu'on en tire : « la version X est en ligne », jamais
// « un déploiement est en cours » (Render ne le dit pas sans clé).

export interface LectureSite {
  /** Commit servi, tel que le site le renvoie (« dev » = pas un vrai déploiement). */
  commit: string | null
  /** Horodatage (ms) de la lecture réussie. */
  lu: number | null
  erreur: string | null
}

/** Une phrase simple pour la ligne « site » ; null s'il n'y a rien à dire. */
// Un site GitHub Pages est statique : il n'a pas de route /health (404 à
// chaque lecture, constaté le 29 sept. sur un vrai projet) et GitHub dit déjà
// ce qu'il sert. On ne le sonde donc pas.
export function siteASonder(url: string | null | undefined): string | null {
  const u = url?.trim()
  if (!u) return null
  try { if (/\.github\.io$/i.test(new URL(u).hostname)) return null } catch { return null }
  return u
}

export function phraseSite(l: LectureSite, now: Date = new Date()): string | null {
  if (l.commit && l.lu !== null) {
    const quand = now.getTime() - l.lu < 60_000 ? 'à l’instant' : `il y a ${duree(now.getTime() - l.lu)}`
    const version = /^[0-9a-f]{7,40}$/i.test(l.commit) ? `version ${l.commit.slice(0, 7)}` : `version « ${l.commit.slice(0, 20)} »`
    return `Site en ligne — ${version} (lu sur le site ${quand})`
  }
  if (l.erreur) return l.erreur
  return null
}
