// « Pris, mais silencieux » : l'écran dit qui, depuis quand, et LE geste (src/lib/silence.ts).
import { verifie, bilan } from './_assert.ts'
import { situationSilence, passageApres } from '../src/lib/silence.ts'

const now = new Date('2026-09-30T10:00:00Z')
const il = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
const dans = (min: number) => new Date(now.getTime() + min * 60_000).toISOString()
const c = { pris_par: 'claude/agent-abc123', pris_jusqu_a: dans(60), updated_at: il(200) }
const act = (min: number) => ({ updated_at: il(min), pourcentage: 40, etape: 'x' })

console.log('verifier-silence')
{
  const s = situationSilence(c, act(45), { now, prochainPassage: dans(20), demandeEnCours: false })
  verifie('abandonné (45 min) + chef : rien à faire, reprise à l’heure du passage', s.geste === 'rien' && !!s.repriseA && /Rien à faire/.test(s.consigne) && s.consigne.includes(s.repriseA), s)
  verifie('…dit depuis quand', /45 min/.test(s.depuis), s.depuis)
}
{
  const s = situationSilence(c, act(45), { now, prochainPassage: null, demandeEnCours: false })
  verifie('abandonné sans chef : le geste est de relancer', s.geste === 'relancer' && /À faire/.test(s.consigne), s)
}
{
  const s = situationSilence(c, act(20), { now, prochainPassage: dans(5), demandeEnCours: false })
  verifie('20 min de silence : pas encore abandonné, on attend', s.geste === 'attendre' && /Rien à faire/.test(s.consigne) && !!s.repriseA, s)
}
{
  const s = situationSilence(c, act(45), { now, prochainPassage: dans(20), demandeEnCours: true })
  verifie('déjà demandé : ne pas relancer', s.geste === 'rien' && /Ne relance pas/.test(s.consigne), s)
}
{
  const s = situationSilence({ ...c, updated_at: il(10) }, null, { now, prochainPassage: dans(20), demandeEnCours: false })
  verifie('aucun avancement signalé : depuis la réservation, fiche récente = on attend', s.geste === 'attendre' && /aucun signe/.test(s.depuis), s)
}
verifie('passage : saute au premier passage horaire après l’abandon', passageApres(dans(5), now.getTime() + 90 * 60_000, now.getTime()) === now.getTime() + 125 * 60_000)
bilan('verifier-silence')
