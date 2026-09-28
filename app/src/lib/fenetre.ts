// La fenêtre « livré » de « Où j'en suis » : réglage de la personne,
// comptée depuis MINUIT LOCAL (à une heure du matin, le travail de la
// soirée ne doit pas tomber à zéro).

export type Fenetre = 'aujourdhui' | '7j' | '30j'
export const FENETRES: readonly { valeur: Fenetre; libelle: string }[] = [
  { valeur: 'aujourdhui', libelle: 'Aujourd’hui' },
  { valeur: '7j', libelle: '7 jours' },
  { valeur: '30j', libelle: '30 jours' },
]
export const FENETRE_DEFAUT: Fenetre = 'aujourdhui'

const JOURS: Record<Fenetre, number> = { aujourdhui: 1, '7j': 7, '30j': 30 }

export function estFenetre(v: unknown): v is Fenetre {
  return v === 'aujourdhui' || v === '7j' || v === '30j'
}

/** Début de la fenêtre : minuit local du jour (n-1) jours avant `now`. */
export function debutFenetre(fenetre: Fenetre, now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - (JOURS[fenetre] - 1))
  return d
}

export function dansFenetre(iso: string | null | undefined, fenetre: Fenetre, now: Date = new Date()): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return !Number.isNaN(t) && t >= debutFenetre(fenetre, now).getTime() && t <= now.getTime() + 60_000
}
