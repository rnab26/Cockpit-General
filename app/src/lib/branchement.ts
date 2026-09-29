// « Ce projet est-il VRAIMENT branché au cockpit ? » — en une ligne, avec la preuve.
//
// Raphaël, 29 sept. 2026 : « sur FacePro, je n'arrive pas à voir si c'est
// branché réellement […] s'il prend réellement les demandes de mes sessions ».
// Trois preuves lues en base (migration 0012), jamais supposées :
//   - branchement_vu_at : le dernier démarrage de session qui a exécuté le hook
//     du cockpit dans ce projet ;
//   - branchement_maj(_at) : la dernière mise à jour automatique faite au démarrage ;
//   - embed_vu_at : le dernier appel du module embarqué depuis le site du projet.
import { dateRelative } from './dates.ts'

export interface PreuvesBranchement {
  branchement_vu_at?: string | null
  branchement_maj_at?: string | null
  embed_vu_at?: string | null
}

export interface LigneBranchement { texte: string; teinte: 'ok' | 'attention' | 'neutre' }

const JOUR = 24 * 3600_000

export function etatBranchement(p: PreuvesBranchement, chantiersDeSessions: number, now: Date = new Date()): LigneBranchement[] {
  const lignes: LigneBranchement[] = []
  const t = (iso?: string | null) => (iso ? new Date(iso).getTime() : NaN)
  const vu = t(p.branchement_vu_at)
  if (Number.isNaN(vu)) {
    lignes.push({ texte: 'Aucune session Claude n’a encore démarré avec le cockpit dans ce projet', teinte: 'attention' })
  } else {
    const quand = dateRelative(p.branchement_vu_at!, now) || 'à l’instant'
    const recent = now.getTime() - vu < JOUR
    lignes.push({
      texte: `${recent ? 'Sessions branchées' : 'Plus aucune session depuis'} — dernier démarrage ${quand} · ${chantiersDeSessions} chantier${chantiersDeSessions > 1 ? 's' : ''} ouvert${chantiersDeSessions > 1 ? 's' : ''} depuis les sessions`,
      teinte: recent ? 'ok' : 'attention',
    })
  }
  const maj = t(p.branchement_maj_at)
  if (!Number.isNaN(maj) && now.getTime() - maj < JOUR) {
    lignes.push({ texte: `Mis à jour automatiquement ${dateRelative(p.branchement_maj_at!, now) || 'à l’instant'} (nouvelle version du cockpit)`, teinte: 'neutre' })
  }
  const site = t(p.embed_vu_at)
  lignes.push(Number.isNaN(site)
    ? { texte: 'Module du site : pas encore installé (les utilisateurs du site ne peuvent pas encore envoyer de demande)', teinte: 'neutre' }
    : { texte: `Module du site : vu ${dateRelative(p.embed_vu_at!, now) || 'à l’instant'}`, teinte: 'ok' })
  return lignes
}
