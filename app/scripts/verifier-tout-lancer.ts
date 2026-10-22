// « Tout lancer » (lib/toutLancer.ts, 16 oct. 2026, chantier 876e2e4b) : ce que dit l'unique bouton et sa ligne d'état.
import { verifie, bilan } from './_assert.ts'
import { aActiverAvecLancer, decisionToutLancer, messageApresActivation, messageApresLancer, NOTE_NON_SUIVIE, noteNonSuivie, SANS_REVEIL, voyantDe, voyantsDe, type EntreeLancer, type EtatSessions } from '../src/lib/toutLancer.ts'
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

// ---- Voyant des sessions et « Activer une session » (0102)
console.log('voyant des sessions')
const ss = (x: Partial<EtatSessions>): EtatSessions => ({ projet: 'A', en_pause: false, vivantes: 0, chef: false, messages: 0, reveil_possible: true, reveil_at: null, reveil_ecart_min: 5, ...x })
const maintenant = new Date('2026-10-19T12:00:00Z')
const il = (min: number) => new Date(maintenant.getTime() - min * 60_000).toISOString()
verifie('session ouverte qui n’a rien en cours : « en veille » (0104), verte pâle, pas de bouton', (() => { const v = voyantDe(e('a', { etat: etat({}), sessions: ss({ vivantes: 1, etats: { au_travail: 0, en_veille: 1, sans_nouvelles: 0 } }) }), maintenant); return v.etat === 'vivante' && v.signe === 'veille' && v.texte === 'session ouverte, en veille : rien ne tourne' && !v.peutActiver })())
verifie('session au travail (tour, agent ou calcul en arrière-plan) : « au travail », pas de bouton', (() => { const v = voyantDe(e('a', { etat: etat({}), sessions: ss({ vivantes: 2, etats: { au_travail: 1, en_veille: 1, sans_nouvelles: 0 } }) }), maintenant); return v.etat === 'vivante' && v.signe === 'travail' && v.texte === 'session au travail' && !v.peutActiver })())
verifie('seulement des sessions sans nouvelles : « sans nouvelles », le bouton « Activer » reste (elles ne comptent pas comme ouvertes)', (() => { const v = voyantDe(e('a', { etat: etat({ attente: [att('A', 1)] }), sessions: ss({ etats: { au_travail: 0, en_veille: 0, sans_nouvelles: 1 } }) }), maintenant); return v.etat === 'aucune' && v.signe === 'sans_nouvelles' && v.texte.startsWith('sans nouvelles') && v.peutActiver })())
verifie('base d’avant 0104 (pas de détail) : « ouverte, en veille », jamais une erreur', voyantDe(e('a', { etat: etat({}), sessions: ss({ vivantes: 1 }) }), maintenant).signe === 'veille')
verifie('plusieurs sessions en veille : le nombre est dit', voyantDe(e('a', { etat: etat({}), sessions: ss({ vivantes: 3 }) }), maintenant).texte === '3 sessions ouvertes, en veille')
verifie('plusieurs sessions au travail : le nombre est dit', voyantDe(e('a', { etat: etat({}), sessions: ss({ vivantes: 3, etats: { au_travail: 3, en_veille: 0, sans_nouvelles: 0 } }) }), maintenant).texte === '3 sessions au travail')
verifie('une chef vivante sans autre session compte comme session ouverte', voyantDe(e('a', { etat: etat({}), sessions: ss({ chef: true }) }), maintenant).etat === 'vivante')
verifie('aucune session + un chantier qui attend : gris, bouton « Activer »', (() => { const v = voyantDe(e('a', { etat: etat({ attente: [att('A', 2)] }), sessions: ss({}) }), maintenant); return v.etat === 'aucune' && v.peutActiver && v.attend === '2 chantiers' })())
verifie('aucune session + AUCUN chantier mais des messages qui attendent : le bouton reste', (() => { const v = voyantDe(e('a', { etat: etat({}), sessions: ss({ messages: 2 }) }), maintenant); return v.peutActiver && v.attend === '2 messages' })())
verifie('chantiers et messages : les deux sont dits', voyantDe(e('a', { etat: etat({ attente: [att('A', 1)] }), sessions: ss({ messages: 1 }) }), maintenant).attend === '1 chantier · 1 message')
verifie('aucune session et rien n’attend : pas de bouton (une session coûte des jetons pour rien), et AUCUN texte en plus (épuré le 19 oct.)', (() => { const v = voyantDe(e('a', { etat: etat({}), sessions: ss({}) }), maintenant); return v.etat === 'aucune' && !v.peutActiver && v.raison === null && v.note === '' })())
verifie('aucune session : ne l’affirme pas (« suivie »), la précision n’est dite qu’UNE fois et seulement quand un bouton existe', (() => { const v = voyantDe(e('a', { etat: etat({ attente: [att('A', 1)] }), sessions: ss({}) }), maintenant); return v.texte === 'aucune session suivie' && v.note === '' && noteNonSuivie([v]) === NOTE_NON_SUIVIE && noteNonSuivie([{ peutActiver: false }]) === '' && v.peutActiver })())
verifie('session vivante ou en pause : aucune note', (() => { const a = voyantDe(e('a', { etat: etat({}), sessions: ss({ vivantes: 1, etats: { au_travail: 1, en_veille: 0, sans_nouvelles: 0 } }) }), maintenant); const b = voyantDe(e('a', { etat: etat({}), enPause: true }), maintenant); return a.note === '' && b.note === '' })())
verifie('réveil demandé il y a 2 min : pas de bouton (jamais de doublon), « elle arrive »', (() => { const v = voyantDe(e('a', { etat: etat({ attente: [att('A', 1)] }), sessions: ss({ reveil_at: il(2) }) }), maintenant); return v.dejaDemande && !v.peutActiver && /il y a 2 min/.test(v.raison ?? '') })())
verifie('réveil demandé il y a 6 min (écart 5) : le bouton revient', voyantDe(e('a', { etat: etat({ attente: [att('A', 1)] }), sessions: ss({ reveil_at: il(6) }) }), maintenant).peutActiver)
verifie('réveil automatique non réglé : pas de bouton, dit quoi faire', (() => { const v = voyantDe(e('a', { etat: etat({ attente: [att('A', 1)] }), sessions: ss({ reveil_possible: false }) }), maintenant); return !v.peutActiver && v.raison === SANS_REVEIL })())
verifie('projet en pause : voyant « en pause », jamais de bouton', (() => { const v = voyantDe(e('a', { enPause: true, etat: etat({ attente: [att('A', 4)] }), sessions: ss({ messages: 2 }) }), maintenant); return v.etat === 'pause' && !v.peutActiver && v.texte === 'en pause' })())
verifie('pause lue par la base (en_pause) : même chose', voyantDe(e('a', { etat: etat({}), sessions: ss({ en_pause: true }) }), maintenant).etat === 'pause')
verifie('lecture en cours : état inconnu, pas de bouton', (() => { const v = voyantDe(e('a', {}), maintenant); return v.etat === 'inconnu' && !v.peutActiver && v.texte === 'lecture en cours…' })())
verifie('lecture en échec : « état illisible » avec la cause', (() => { const v = voyantDe(e('a', { erreur: 'réseau coupé' }), maintenant); return v.etat === 'inconnu' && v.texte === 'état illisible' && v.raison === 'réseau coupé' })())
verifie('un renfort demandé attend une session : le voyant ne dit pas « rien n’attend », le bouton est là', (() => { const v = voyantDe(e('a', { etat: etat({ renforts: [r({ statut: 'demande' })] }), sessions: ss({}) }), maintenant); return v.peutActiver && v.attend === '1 renfort demandé' })())
verifie('un voyant par projet', voyantsDe([e('a', { etat: etat({}), sessions: ss({ vivantes: 1 }) }), e('b', { etat: etat({}), sessions: ss({}) })], maintenant).map((v) => v.etat).join() === 'vivante,aucune')
verifie('Tout lancer active une session seulement pour les projets lancés sans session', (() => {
  const vs = voyantsDe([e('a', { etat: etat({ attente: [att('A', 1)] }), sessions: ss({}) }), e('b', { etat: etat({ attente: [att('B', 1)] }), sessions: ss({ vivantes: 1 }) }), e('c', { etat: etat({ attente: [att('C', 1)] }), sessions: ss({ reveil_possible: false }) })], maintenant)
  return aActiverAvecLancer(['a', 'b', 'c'], vs).join() === 'a'
})())
verifie('Tout lancer : un réveil déjà parti n’empêche pas l’appel (la base ne tire jamais deux fois)', aActiverAvecLancer(['a'], voyantsDe([e('a', { etat: etat({ attente: [att('A', 1)] }), sessions: ss({ reveil_at: il(1) }) })], maintenant)).join() === 'a')

const ra = (resultat: string | null, extra: object = {}) => ({ nom: 'A', resultat, erreur: null, ...extra })
verifie('activée : « session demandée à HH:MM »', (() => { const m = messageApresActivation([ra('envoye')], new Date(2026, 9, 19, 14, 5)); return m.ok && /^Session demandée à 14:05 : elle s’ouvre/.test(m.texte) && !m.reessayer })())
verifie('déjà demandée : bon résultat, dit depuis quand', (() => { const m = messageApresActivation([ra('deja_demande', { reveil_at: il(3) })], maintenant); return m.ok && m.texte === 'Session déjà demandée il y a 3 min : elle arrive.' })())
verifie('déjà une session ouverte : bon résultat', messageApresActivation([ra('session_vivante')], maintenant).ok)
verifie('pas de réveil réglé : échec visible, sans « Réessayer » (réessayer ne changerait rien)', (() => { const m = messageApresActivation([ra('pas_configure')], maintenant); return !m.ok && !m.reessayer && /^Pas activée : le réveil automatique n’est pas réglé/.test(m.texte) })())
verifie('projet en pause : échec dit', /en pause/.test(messageApresActivation([ra('projet_en_pause')], maintenant).texte))
verifie('erreur technique : visible avec la cause, « Réessayer » proposé', (() => { const m = messageApresActivation([ra(null, { erreur: 'boum' })], maintenant); return !m.ok && m.reessayer && m.texte === 'Pas activée : boum' })())
verifie('dépôt absent de la routine : échec visible qui renvoie à la carte, sans « Réessayer »', (() => { const m = messageApresActivation([ra('depot_absent')], maintenant); return !m.ok && !m.reessayer && /ajoute son dépôt à la routine/.test(m.texte) })())
verifie('plusieurs projets : chaque phrase porte son nom', (() => { const m = messageApresActivation([ra('envoye'), ra('pas_configure', { nom: 'B' })], maintenant); return !m.ok && /A : session demandée/.test(m.texte) && /B : le réveil automatique/.test(m.texte) })())
verifie('réponse inattendue : dite, jamais un faux succès', !messageApresActivation([ra('truc')], maintenant).ok)
bilan()
