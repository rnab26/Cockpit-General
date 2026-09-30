// « Branché ? » (src/lib/branchement.ts) : preuves lues, jamais supposées.
import { verifie, bilan } from './_assert.ts'
import { etatBranchement, estBranche } from '../src/lib/branchement.ts'
const now = new Date('2026-09-29T02:00:00Z')
const il = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
console.log('verifier-branchement')
{
  const l = etatBranchement({}, 0, now)
  verifie('jamais vu → le dit en clair', /Aucune session/.test(l[0].texte) && l[0].teinte === 'attention', l)
  verifie('module du site jamais vu → « pas encore installé »', /pas encore installé/.test(l[l.length - 1].texte))
}
{
  const l = etatBranchement({ branchement_vu_at: il(3), embed_vu_at: il(10) }, 5, now)
  verifie('session récente → « Sessions branchées », vert, avec le nombre de chantiers', /Sessions branchées/.test(l[0].texte) && /5 chantiers/.test(l[0].texte) && l[0].teinte === 'ok', l[0])
  verifie('module vu → « vu il y a … »', /Module du site : vu/.test(l[l.length - 1].texte))
}
{
  const l = etatBranchement({ branchement_vu_at: il(3 * 24 * 60) }, 1, now)
  verifie('plus de session depuis 3 jours → alerte', /Plus aucune session/.test(l[0].texte) && l[0].teinte === 'attention' && /1 chantier ouvert /.test(l[0].texte), l[0])
}
{
  const l = etatBranchement({ branchement_vu_at: il(1), branchement_maj_at: il(1) }, 0, now)
  verifie('mise à jour automatique récente → affichée', l.some((x) => /Mis à jour automatiquement/.test(x.texte)))
  const v = etatBranchement({ branchement_vu_at: il(1), branchement_maj_at: il(3 * 24 * 60) }, 0, now)
  verifie('mise à jour ancienne → plus affichée', !v.some((x) => /Mis à jour automatiquement/.test(x.texte)))
}
{
  verifie('estBranche : session récente → vrai', estBranche({ branchement_vu_at: il(3) }, now))
  verifie('estBranche : jamais vu → faux', !estBranche({}, now))
  verifie('estBranche : plus de 24 h → faux', !estBranche({ branchement_vu_at: il(3 * 24 * 60) }, now))
}
bilan('verifier-branchement')
