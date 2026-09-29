// Les projets de TEST des bancs n'apparaissent jamais pour Raphaël (29 sept.
// 2026 : « [TEST verifier-embed …] tri des clients » dans son cockpit).
import { verifie, bilan } from './_assert.ts'
import { estCompteDeTest, estProjetDeTest, lignesVisibles, projetsVisibles } from '../src/lib/projetsDeTest.ts'

console.log('verifier-projets-de-test')

const projets = [
  { id: 'c', slug: 'cockpit' }, { id: 'f', slug: 'facepro' }, { id: 't', slug: 'testeur' },
  { id: 'w', slug: 'test-web-501c81fd' }, { id: 'e', slug: 'test-embed-9831514f' }, { id: 'v', slug: 'test-verif-rep-1' },
]

verifie('test-web-…, test-embed-…, test-verif-… sont des projets de test', ['test-web-a', 'test-embed-a', 'test-verif-a'].every(estProjetDeTest))
verifie('cockpit, facepro, « testeur » (sans tiret) n’en sont pas', !['cockpit', 'facepro', 'testeur', '', null].some(estProjetDeTest))

const raphael = projetsVisibles(projets, 'r.nabet26@gmail.com').map((p) => p.slug)
verifie('Raphaël : aucun onglet de projet de test', raphael.join(',') === 'cockpit,facepro,testeur', raphael)
verifie('un membre (autre adresse) non plus', projetsVisibles(projets, 'client@exemple.fr').length === 3)
verifie('une personne dont l’adresse commence par « test- » mais hors cockpit.local non plus', projetsVisibles(projets, 'test-marie@gmail.com').length === 3)
verifie('le compte des bancs (test-cockpit@cockpit.local) les voit, pour les parcourir', projetsVisibles(projets, 'test-cockpit@cockpit.local').length === 6)
verifie('les comptes de verifier-base aussi', estCompteDeTest('test-verif-ab12cd34@cockpit.local'))
verifie('sans adresse : on cache', projetsVisibles(projets, null).length === 3)

// « Tout » : les lignes d'un projet de test, même arrivées en direct, sont retirées.
const ids = new Set(projetsVisibles(projets, 'r.nabet26@gmail.com').map((p) => p.id))
const chantiers = [
  { id: '1', projet_id: 'c', titre: 'Vrai' },
  { id: '2', projet_id: 'w', titre: '[TEST web] pres vivant' },
  { id: '3', projet_id: 'e', titre: '[TEST verifier-embed 2026-09-29T12:47:51] tri des clients' },
  { id: '4', projet_id: 'nouveau-test-cree-pendant-que-l-app-est-ouverte', titre: '[TEST web] x' },
]
const vus = lignesVisibles(chantiers, ids).map((c) => c.id)
verifie('« Tout » : seuls les chantiers des vrais projets restent', vus.join(',') === '1', vus)
verifie('un projet de test créé après le chargement (inconnu de la liste) : ses lignes ne passent pas', !vus.includes('4'))

bilan('verifier-projets-de-test')
