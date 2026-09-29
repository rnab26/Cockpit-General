// « Traiter ce projet » : une phrase et un lien, pour ouvrir en un toucher la session
// qui prend les chantiers en lot. Valable pour TOUT projet (rien n'est écrit par projet).
//
// Ce qui est vérifié : n'importe quel premier message d'une session ouverte sur le dépôt d'un
// projet branché la rend chef DE CE PROJET (hooks/prompt-rappel.sh → chef.sh --prendre), et la
// chef lance des agents sur ses chantiers prenables. La phrase n'est donc pas un code magique : elle
// dit clairement ce que Raphaël veut.
// Ce qui n'existe PAS : un lien qui ouvre la session avec le dépôt et la phrase déjà remplis (la
// documentation de Claude Code sur le web n'en décrit aucun). On copie la phrase et on ouvre la page
// des sessions ; ne pas inventer de paramètres d'adresse.
import { dateRelative } from './dates.ts'

export const LIEN_CLAUDE_CODE = 'https://claude.ai/code'

export function phraseTraiter(nom: string): string {
  return `Traite le projet ${nom} en lot : prends tous les chantiers qui attendent, lance des agents, et réponds dans le cockpit.`
}

export interface EtatTraiter { chef: boolean; chef_vu_at: string | null; attente: { n: number; section: string }[] }

/** Où en est le projet, en une phrase (jamais un état vide muet). */
export function etatTraiter(e: EtatTraiter, now: Date): string {
  const n = e.attente.reduce((s, a) => s + a.n, 0)
  const qui = e.chef
    ? `Une session tient déjà ce projet${e.chef_vu_at ? ` (vue ${dateRelative(e.chef_vu_at, now) || 'à l’instant'})` : ''} : elle prend les chantiers toute seule.`
    : 'Aucune session ouverte sur ce projet.'
  const quoi = n
    ? `${n} chantier${n > 1 ? 's' : ''} ${n > 1 ? 'seront pris' : 'sera pris'} : ${e.attente.map((a) => `${a.section} ${a.n}`).join(' · ')}.`
    : 'Rien n’attend pour l’instant : crée un chantier, ou réponds à une question, puis lance.'
  return `${qui} ${quoi}`
}

/** Les trois gestes, dans l'ordre. Sans dépôt renseigné, on ne l'invente pas. */
export function etapesTraiter(depot: string | null): string[] {
  return [
    `Ouvre Claude Code et choisis le dépôt ${depot ?? 'de ce projet'}.`,
    'Colle la phrase (déjà copiée) et envoie.',
    'Reviens ici : les chantiers avancent, tu réponds dans le fil.',
  ]
}
