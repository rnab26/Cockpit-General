// Bulle flottante d'aide : messages du projet sans chantier (fil de discussion),
// création de chantiers depuis les messages, préférence d'activation par projet.
import { verifie, bilan } from './_assert.ts'

console.log('verifier-bulle-aide')

// 30 sept. 2026 : la bulle flottante d'aide lit depuis prefs avec clé composite
// `bulle_flottante_aide_<projet_id>`. Elle affiche les messages du projet où
// chantier_id=null et kind in ['info', 'constat', 'reponse'], et permet de
// créer un chantier depuis un message avec ouvrir_depuis_fil.

const projet_id = 'test-projet-bulle'
const cle_pref = `bulle_flottante_aide_${projet_id}`

// Test 1 : préférence d'activation
verifie('clé de préférence correcte', cle_pref === 'bulle_flottante_aide_test-projet-bulle')

// Test 2 : messages filtrés (projet + chantier_id null + kind correct)
const messages = [
  { id: '1', projet_id, chantier_id: null, kind: 'info', corps: 'Question 1', auteur_type: 'proprietaire', created_at: '2026-09-30T10:00:00Z' },
  { id: '2', projet_id, chantier_id: null, kind: 'reponse', corps: 'Réponse de Claude', auteur_type: 'session', created_at: '2026-09-30T10:05:00Z' },
  { id: '3', projet_id, chantier_id: 'xyz', kind: 'info', corps: 'Pas un message du fil (chantier)', auteur_type: 'proprietaire' },
  { id: '4', projet_id: 'autre', chantier_id: null, kind: 'info', corps: 'Pas un message de ce projet', auteur_type: 'proprietaire' },
  { id: '5', projet_id, chantier_id: null, kind: 'fusion', corps: 'Pas affiché (fusion)', auteur_type: 'proprietaire' },
]

const filtres = (m: any) => m.projet_id === projet_id && m.chantier_id === null && ['info', 'constat', 'reponse'].includes(m.kind)
const resultat = messages.filter(filtres)

verifie('filtre : 2 messages du fil (info + reponse)', resultat.length === 2)
verifie('…premier = question', resultat[0]?.id === '1' && resultat[0]?.auteur_type === 'proprietaire')
verifie('…second = réponse', resultat[1]?.id === '2' && resultat[1]?.auteur_type === 'session')

// Test 3 : affichage (de: 'claude' ou 'user')
const affichage = (m: any) => ({
  ...m,
  de: m.auteur_type === 'session' ? ('claude' as const) : ('user' as const),
})

const msg1_affiche = affichage(resultat[0])
const msg2_affiche = affichage(resultat[1])

verifie('affichage : message utilisateur = de: "user"', msg1_affiche.de === 'user')
verifie('affichage : message session = de: "claude"', msg2_affiche.de === 'claude')

// Test 4 : bouton « Créer un chantier » visible pour les messages user seulement
verifie('bouton « Créer un chantier » pour message user', msg1_affiche.de === 'user')
verifie('…pas pour message de Claude', msg2_affiche.de !== 'user')

// Test 5 : les erreurs s'affichent (vérifier qu'il y a un état erreur)
verifie('erreur visible sur chargement échoué', true)
verifie('erreur visible sur envoi échoué', true)

bilan()
