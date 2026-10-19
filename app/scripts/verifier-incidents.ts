// L'autocontrôle (19 oct. 2026, migration 0105, chantier 7cecd1f3) : ce que l'écran montre de la table `incidents` (la RÈGLE est en base :
// scripts/verifier-incidents.mjs). UNE ligne, la panne la plus ancienne d'abord, « À savoir » pour un choix de Raphaël, rien quand tout va bien.
import { verifie, bilan } from './_assert.ts'
import { AUTOCONTROLE_DEFAUT, entierSaisi, erreurAutocontrole, ligneIncident, ordreIncidents, reglageAutocontrole, type Incident } from '../src/lib/incidents.ts'

const now = new Date(2026, 9, 19, 20, 0)                                 // heure LOCALE : aucun test ne dépend du fuseau de la machine
const il = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
const inc = (id: string, extra: Partial<Incident> = {}): Incident => ({
  id, projet_id: 'p1', code: 'reveil_sans_effet', gravite: 'panne', cause: 'Du travail attend : un réveil est parti, mais la session lancée n’a rien pris.',
  detail: { geste: 'activer_session' }, etat: 'ouvert', depuis: il(25), vu_at: il(1), ...extra,
})
const un = new Map([['p1', 'Trieur']])
const deux = new Map([['p1', 'Trieur'], ['p2', 'FacePro']])

console.log('verifier-incidents')

console.log('1. rien quand tout va bien')
verifie('aucun incident : aucune ligne', ligneIncident([], un, null, now) === null)
verifie('un incident résolu n’est jamais montré', ligneIncident([inc('a', { etat: 'resolu' })], un, null, now) === null)
verifie('un projet que l’écran ne connaît pas (test, supprimé) n’apparaît jamais', ligneIncident([inc('a', { projet_id: 'test-x' })], un, null, now) === null)
verifie('la vue d’un projet ne montre que ses incidents', ligneIncident([inc('a', { projet_id: 'p2' })], deux, 'p1', now) === null)

console.log('2. une seule ligne, en mots simples')
const l = ligneIncident([inc('a')], un, null, now)!
verifie('« Problème : cause »', l.texte === 'Problème : Du travail attend : un réveil est parti, mais la session lancée n’a rien pris.', l.texte)
verifie('l’âge et l’heure sont dits (« depuis il y a 25 min · hh:mm »)', /^depuis il y a 25 min · \d{2}:\d{2}$/.test(l.meta), l.meta)
verifie('un seul projet : son nom n’est pas répété', !l.meta.includes('Trieur'))
verifie('plusieurs projets (vue Tout) : le projet est nommé', ligneIncident([inc('a')], deux, null, now)!.meta.startsWith('Trieur · depuis '))
verifie('vue d’un projet : le nom n’est pas répété', !ligneIncident([inc('a')], deux, 'p1', now)!.meta.includes('Trieur'))
verifie('le geste utile vient de la base (activer_session)', l.geste === 'activer_session')
verifie('sans geste proposé : aucun bouton', ligneIncident([inc('a', { detail: { geste: null } })], un, null, now)!.geste === null && ligneIncident([inc('a', { detail: null })], un, null, now)!.geste === null)
verifie('un geste inconnu n’est jamais proposé', ligneIncident([inc('a', { detail: { geste: 'supprimer_tout' } })], un, null, now)!.geste === null)

console.log('3. ordre : pannes d’abord, la plus ancienne en tête, « À savoir » jamais devant une panne')
const info = inc('i', { code: 'attente_reveil_eteint', gravite: 'info', cause: 'Du travail attend, et le réveil automatique est éteint (ton choix).', depuis: il(600) })
const recente = inc('r', { code: 'renfort_en_erreur', cause: 'Une session lancée s’est arrêtée : ça a planté.', depuis: il(5) })
const ancienne = inc('o', { code: 'session_sans_nouvelles', cause: 'Une session ne donne plus de nouvelles.', depuis: il(90) })
const o = ordreIncidents([info, recente, ancienne])
verifie('ordre : panne la plus ancienne, panne récente, puis le choix de Raphaël', o.map((x) => x.id).join() === 'o,r,i', o.map((x) => x.id))
const m = ligneIncident([info, recente, ancienne], un, null, now)!
verifie('la ligne montre la panne la plus ancienne, avec « + 2 autres » dans le détail', m.principal.id === 'o' && m.autres.length === 2 && m.prefixe === 'Problème')
const seul = ligneIncident([info], un, null, now)!
verifie('seul le réveil éteint : « À savoir », jamais « Problème » (c’est son choix, pas une panne)', seul.prefixe === 'À savoir' && seul.texte.startsWith('À savoir : ') && !seul.texte.includes('Problème'))

console.log('4. les réglages : défauts = colonnes de la base, mêmes bornes')
verifie('défauts 20 min / 60 min / 6 h', AUTOCONTROLE_DEFAUT.delaiMin === 20 && AUTOCONTROLE_DEFAUT.nettoyageMin === 60 && AUTOCONTROLE_DEFAUT.gardeH === 6)
verifie('un projet sans les colonnes (base d’avant 0105) : défauts', JSON.stringify(reglageAutocontrole({})) === JSON.stringify({ delaiMin: 20, nettoyageMin: 60, gardeH: 6 }))
verifie('les valeurs du projet gagnent', reglageAutocontrole({ autocontrole_delai_min: 45, autocontrole_nettoyage_min: 0, autocontrole_garde_h: 12 }).nettoyageMin === 0)
verifie('champ : entier seulement', entierSaisi(' 30 ') === 30 && entierSaisi('3,5') === null && entierSaisi('') === null && entierSaisi('-1') === null && entierSaisi('abc') === null)
const bon = { delaiMin: 20, nettoyageMin: 60, gardeH: 6 }
verifie('réglage valide accepté', erreurAutocontrole(bon) === null && erreurAutocontrole({ ...bon, nettoyageMin: 0 }) === null)
verifie('délai hors de 5 à 1440 refusé', erreurAutocontrole({ ...bon, delaiMin: 4 }) !== null && erreurAutocontrole({ ...bon, delaiMin: 1441 }) !== null && erreurAutocontrole({ ...bon, delaiMin: null }) !== null)
verifie('nettoyage : 0 ou 10 à 1440', erreurAutocontrole({ ...bon, nettoyageMin: 5 }) !== null && erreurAutocontrole({ ...bon, nettoyageMin: 1441 }) !== null && erreurAutocontrole({ ...bon, nettoyageMin: 10 }) === null)
verifie('garde : 1 à 168 h', erreurAutocontrole({ ...bon, gardeH: 0 }) !== null && erreurAutocontrole({ ...bon, gardeH: 169 }) !== null && erreurAutocontrole({ ...bon, gardeH: 168 }) === null)

bilan('verifier-incidents')
