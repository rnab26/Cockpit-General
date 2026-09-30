// « Pris, mais silencieux » : l'écran dit qui, depuis quand, et LE geste (src/lib/silence.ts).
import { verifie, bilan } from './_assert.ts'
import { situationSilence, passageApres, phraseLiberee, DELAI_ABANDON_MIN, erreurDelaiSansSigne } from '../src/lib/silence.ts'

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
  const s = situationSilence(c, act(2), { now, prochainPassage: dans(5), demandeEnCours: false })
  verifie('2 min de silence (délai par défaut 3) : pas encore abandonné, on attend', s.geste === 'attendre' && /Rien à faire/.test(s.consigne) && !!s.repriseA, s)
}
{
  const s = situationSilence(c, act(45), { now, prochainPassage: dans(20), demandeEnCours: true })
  verifie('déjà demandé : ne pas relancer', s.geste === 'rien' && /Ne relance pas/.test(s.consigne), s)
}
{
  const s = situationSilence({ ...c, updated_at: il(1) }, null, { now, prochainPassage: dans(20), demandeEnCours: false })
  verifie('aucun avancement signalé : depuis la réservation, fiche récente = on attend', s.geste === 'attendre' && /aucun signe/.test(s.depuis), s)
}
{
  const s = situationSilence(c, act(20), { now, prochainPassage: dans(5), demandeEnCours: false, abandonMin: 30 })
  verifie('délai réglé à 30 min : 20 min de silence, on attend encore', s.geste === 'attendre', s)
  const t = situationSilence(c, act(20), { now, prochainPassage: dans(5), demandeEnCours: false, abandonMin: 10 })
  verifie('délai réglé à 10 min : 20 min de silence, abandonné', t.geste === 'rien' && /abandonné/.test(t.ceQuiSePasse), t)
}
verifie('défaut du délai = 3 min (même valeur que la colonne, comparée par verifier-base)', DELAI_ABANDON_MIN === 3)
verifie('borne du réglage : 1 à 120, entier', erreurDelaiSansSigne(1) === null && erreurDelaiSansSigne(120) === null && !!erreurDelaiSansSigne(0) && !!erreurDelaiSansSigne(121) && !!erreurDelaiSansSigne(2.5))
verifie('passage : saute au premier passage horaire après l’abandon', passageApres(dans(5), now.getTime() + 90 * 60_000, now.getTime()) === now.getTime() + 125 * 60_000)
{
  const lib = { pris_jusqu_a: il(1), libere_at: il(1), libere_de: 'agent/message-abc123', libere_apres_min: 45 }
  const p = phraseLiberee(lib, { now, prochainPassage: dans(20) })
  verifie('libéré par la base : dit qui, depuis combien, quand il est repris seul', !!p && /45 min/.test(p) && /libéré à/.test(p) && /repris seul vers/.test(p) && /Rien à faire/.test(p), p)
  verifie('libéré sans passage programmé : dit « à la prochaine passe »', /prochaine passe/.test(phraseLiberee(lib, { now, prochainPassage: null }) ?? ''))
  verifie('déjà repris (réservation vivante) : plus de phrase', phraseLiberee({ ...lib, pris_jusqu_a: dans(60) }, { now, prochainPassage: null }) === null)
  verifie('jamais libéré : pas de phrase', phraseLiberee({ pris_jusqu_a: null, libere_at: null, libere_de: null, libere_apres_min: null }, { now, prochainPassage: null }) === null)
}
bilan('verifier-silence')
