// « Tout lancer » (lib/toutLancer.ts, 16 oct. 2026, chantier 876e2e4b) : ce que dit l'unique bouton et sa ligne d'état.
import { verifie, bilan } from './_assert.ts'
import { decisionToutLancer, messageApresLancer, type EntreeLancer } from '../src/lib/toutLancer.ts'
import type { EtatRenforts, Renfort } from '../src/lib/renforts.ts'

console.log('verifier-tout-lancer')
const now = new Date(2026, 9, 16, 11, 12)
const r = (x: Partial<Renfort>): Renfort => ({
  id: 'r', section_id: null, section: 'Écran', statut: 'actif', vivant: true, session: null, max_agents: 3, chantiers: 3, faits: 0, en_cours: 0,
  erreur: null, created_at: '2026-10-16T08:00:00Z', vu_at: null, fini_at: null, archive_at: null, ...x,
})
const etat = (x: Partial<EtatRenforts>): EtatRenforts => ({ sessions_max: 2, agents_par_session: 3, chef: true, chef_vu_at: null, attente: [], renforts: [], ...x })
const att = (section: string, n: number) => ({ section_id: section, section, n, ids: [] })
const e = (slug: string, x: Partial<EntreeLancer>): EntreeLancer => ({ slug, nom: slug.toUpperCase(), enPause: false, etat: null, erreur: null, ...x })

// Décision
verifie('aucun projet : bouton éteint, dit pourquoi', (() => { const d = decisionToutLancer([]); return !d.actif && /Aucun projet/.test(d.ligne) && !!d.raison })())
verifie('lecture en cours : bouton éteint, « Lecture en cours… », pas une erreur', (() => { const d = decisionToutLancer([e('a', {})]); return d.chargement && !d.enErreur && !d.actif && d.ligne === 'Lecture en cours…' })())
verifie('état illisible : erreur dite, « Réessayer » possible, bouton éteint', (() => { const d = decisionToutLancer([e('a', { erreur: 'réseau coupé' })]); return d.enErreur && !d.actif && /réseau coupé/.test(d.ligne) })())
verifie('projet en pause : éteint, la raison dit où rallumer, rien ne part', (() => { const d = decisionToutLancer([e('a', { enPause: true, etat: etat({ attente: [att('A', 2)] }) })]); return !d.actif && d.aLancer.length === 0 && /en pause/.test(d.ligne) && /Réglages du projet/.test(d.raison ?? '') })())
verifie('tous en pause (Tout) : une phrase pour tous', decisionToutLancer([e('a', { enPause: true }), e('b', { enPause: true })]).ligne.startsWith('Tous les projets sont en pause'))
verifie('rien n’attend : éteint, « Rien n’attend »', (() => { const d = decisionToutLancer([e('a', { etat: etat({}) })]); return !d.actif && d.ligne === 'Rien n’attend' })())
verifie('rien n’attend mais des renforts tournent : « en route »', (() => { const d = decisionToutLancer([e('a', { etat: etat({ renforts: [r({}), r({ id: 'r2' })] }) })]); return !d.actif && /Rien n’attend : 2 renforts en route/.test(d.ligne) })())
verifie('3 chantiers attendent : actif, « 3 chantiers attendent »', (() => { const d = decisionToutLancer([e('a', { etat: etat({ attente: [att('A', 2), att('B', 1)] }) })]); return d.actif && d.nChantiers === 3 && d.ligne === '3 chantiers attendent' && d.aLancer[0] === 'a' })())
verifie('1 chantier : singulier', decisionToutLancer([e('a', { etat: etat({ attente: [att('A', 1)] }) })]).ligne === '1 chantier attend')
verifie('Tout : un seul clic vise chaque projet où quelque chose attend, pas les autres', (() => {
  const d = decisionToutLancer([e('a', { etat: etat({ attente: [att('A', 2)] }) }), e('b', { etat: etat({}) }), e('c', { etat: etat({ attente: [att('C', 1)] }) }), e('p', { enPause: true, etat: etat({ attente: [att('P', 5)] }) })])
  return d.actif && d.aLancer.join() === 'a,c' && d.nChantiers === 3 && d.ligne === '3 chantiers attendent dans 2 projets'
})())
verifie('places toutes prises : éteint, « déjà demandés », le reste part seul', (() => {
  const d = decisionToutLancer([e('a', { etat: etat({ sessions_max: 1, attente: [att('A', 2)], renforts: [r({})] }) })]); return !d.actif && /déjà demandés/.test(d.ligne) && /part tout seul/.test(d.raison ?? '')
})())
verifie('renforts à 0 : éteint, dit où régler', (() => { const d = decisionToutLancer([e('a', { etat: etat({ sessions_max: 0, attente: [att('A', 2)] }) })]); return !d.actif && /éteints/.test(d.ligne) && /Renforts \(détails\)/.test(d.raison ?? '') })())
verifie('un projet plein + un projet libre : on lance seulement le libre', decisionToutLancer([e('a', { etat: etat({ sessions_max: 1, attente: [att('A', 2)], renforts: [r({})] }) }), e('b', { etat: etat({ attente: [att('B', 1)] }) })]).aLancer.join() === 'b')
verifie('un projet illisible parmi d’autres : les autres se lancent, l’illisible est dit', (() => { const d = decisionToutLancer([e('a', { etat: etat({ attente: [att('A', 1)] }) }), e('b', { erreur: 'x' })]); return d.actif && /1 projet illisible/.test(d.ligne) })())

// Après le clic
const dem = (n: number, ch = 2) => ({ demandes: Array.from({ length: n }, (_, i) => ({ id: `d${i}`, section: `S${i}`, chantiers: ch })), vivants: n, max: 4, agents: 3, raison: null })
verifie('demandé : « Demandé à 11:12 : 4 chantiers. Ils passent dans « ça avance »… »', (() => { const m = messageApresLancer([{ nom: 'A', resultat: dem(2), erreur: null, sansChef: false }], now); return m.ok && m.texte === 'Demandé à 11:12 : 4 chantiers. Ils passent dans « ça avance » dès qu’une session les prend.' && !m.reessayer })())
verifie('lancé sans session ouverte : le dit, avec le nom du projet', (() => { const m = messageApresLancer([{ nom: 'FacePro', resultat: dem(1), erreur: null, sansChef: true }], now); return m.ok && /Aucune session n’est ouverte pour FacePro/.test(m.texte) })())
verifie('erreur technique : visible, « Réessayer » proposé', (() => { const m = messageApresLancer([{ nom: 'A', resultat: null, erreur: 'refusé', sansChef: false }], now); return !m.ok && m.reessayer && /^Pas lancé : refusé/.test(m.texte) })())
verifie('erreur sur un projet, succès sur l’autre : les deux sont dits', (() => { const m = messageApresLancer([{ nom: 'A', resultat: dem(1), erreur: null, sansChef: false }, { nom: 'B', resultat: null, erreur: 'boum', sansChef: false }], now); return !m.ok && m.reessayer && /B : boum/.test(m.texte) && /1 projet lancé quand même/.test(m.texte) })())
verifie('la base répond « rien n’attend » : message de la base, pas de « Réessayer »', (() => { const m = messageApresLancer([{ nom: 'A', resultat: { demandes: [], vivants: 0, max: 2, agents: 3, raison: 'rien_en_attente' }, erreur: null, sansChef: false }], now); return !m.ok && !m.reessayer && /Rien n’attend/.test(m.texte) })())
verifie('la base répond « plein » : dit combien tournent', (() => { const m = messageApresLancer([{ nom: 'A', resultat: { demandes: [], vivants: 2, max: 2, agents: 3, raison: 'plein' }, erreur: null, sansChef: false }], now); return !m.ok && /Déjà 2 renforts en route/.test(m.texte) })())
bilan()
