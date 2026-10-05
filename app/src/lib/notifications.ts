/**
 * Réglages des notifications (migration 0052, chantier 70288582) : quels TYPES et
 * quels PROJETS, par personne. La décision d'envoyer est prise côté serveur
 * (`cockpit.notif_veut` / `notif_destinataires`) ; ce fichier ne sert qu'à
 * AFFICHER l'état de la personne et à fabriquer le nouveau réglage d'un geste.
 * Mêmes règles que le serveur, comparées par verifier-base §41.
 */
export interface TypeNotif { code: string; libelle: string; aide: string; defaut: boolean; emis: boolean; ordre: number }
export interface ReglagesNotif { types: Record<string, boolean>; projets_coupes: string[] }

export const REGLAGES_VIDES: ReglagesNotif = { types: {}, projets_coupes: [] }

/** Lecture défensive d'une ligne de la base. */
export function lireReglages(brut: unknown): ReglagesNotif {
  const r = (brut ?? {}) as { types?: unknown; projets_coupes?: unknown }
  const types: Record<string, boolean> = {}
  if (r.types && typeof r.types === 'object' && !Array.isArray(r.types)) {
    for (const [k, v] of Object.entries(r.types)) if (typeof v === 'boolean') types[k] = v
  }
  const coupes = Array.isArray(r.projets_coupes) ? r.projets_coupes.filter((x): x is string => typeof x === 'string') : []
  return { types, projets_coupes: coupes }
}

/** Ce type est-il voulu ? (valeur choisie, sinon le défaut du catalogue). */
export function typeVoulu(t: TypeNotif, r: ReglagesNotif): boolean {
  return t.code in r.types ? r.types[t.code] : t.defaut
}

export const projetVoulu = (id: string, r: ReglagesNotif) => !r.projets_coupes.includes(id)

export function avecType(r: ReglagesNotif, code: string, voulu: boolean): ReglagesNotif {
  return { ...r, types: { ...r.types, [code]: voulu } }
}

export function avecProjet(r: ReglagesNotif, id: string, voulu: boolean): ReglagesNotif {
  const sans = r.projets_coupes.filter((x) => x !== id)
  return { ...r, projets_coupes: voulu ? sans : [...sans, id] }
}

/** L'interrupteur « tous les projets » : tout rallumer, ou tout couper. */
export function avecTousProjets(r: ReglagesNotif, ids: string[], voulu: boolean): ReglagesNotif {
  return { ...r, projets_coupes: voulu ? [] : [...ids] }
}

export const tousLesProjetsVoulus = (ids: string[], r: ReglagesNotif) => ids.every((i) => projetVoulu(i, r))

/** Une phrase qui résume ce qui arrivera, pour que la personne sache à quoi s'attendre. */
export function resume(types: TypeNotif[], ids: string[], r: ReglagesNotif): string {
  const actifs = types.filter((t) => t.emis && typeVoulu(t, r)).map((t) => t.libelle.toLowerCase())
  const nb = ids.filter((i) => projetVoulu(i, r)).length
  if (!actifs.length) return 'Aucune notification : tu ne seras prévenu de rien.'
  if (!nb) return 'Tous les projets sont coupés : tu ne seras prévenu de rien.'
  const quoi = actifs.join(', ')
  return nb === ids.length ? `Tu es prévenu de : ${quoi}, sur tous les projets.` : `Tu es prévenu de : ${quoi}, sur ${nb} projet${nb > 1 ? 's' : ''} sur ${ids.length}.`
}
