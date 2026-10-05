// Recherche de la loupe (src/lib/vueProjet.ts, chantier 9cc71872).
import { verifie, bilan } from './_assert.ts'
import { chercher, ONGLET_DEFAUT } from '../src/lib/vueProjet.ts'

console.log('verifier-recherche')
const c = (id: string, projet: string, titre: string, demande = '') => ({ id, projet_id: projet, titre, demande, resume_simple: null }) as never
const m = (chantier: string | null, projet: string, corps: string) => ({ chantier_id: chantier, projet_id: projet, corps }) as never
const chantiers = [c('1', 'A', 'Tri des clients', 'rangement'), c('2', 'A', 'Facture Éléphant'), c('3', 'B', 'Tri des photos')]
const messages = [m('2', 'A', 'on a changé la couleur du bouton'), m(null, 'A', 'Bonjour, une idée de bouton rond'), m(null, 'B', 'rien')]
verifie('requête vide : aucun résultat', chercher('  ', chantiers, messages, null).length === 0)
verifie('titre, sans accent ni casse', chercher('ELEPHANT', chantiers, messages, 'A').map((r) => r.chantierId).join() === '2')
verifie('un projet : on ne sort pas de lui', chercher('tri', chantiers, messages, 'A').map((r) => r.chantierId).join() === '1')
verifie('tous les projets : les deux', chercher('tri', chantiers, messages, null).length === 2)
verifie('trouvé dans le fil d’un chantier, dit où', (() => { const r = chercher('couleur', chantiers, messages, 'A'); return r.length === 1 && r[0].chantierId === '2' && /Dans le fil/.test(r[0].extrait) })())
verifie('discussion générale du projet', (() => { const r = chercher('rond', chantiers, messages, 'A'); return r.length === 1 && r[0].chantierId === null && r[0].titre === 'Discussion du projet' })())
verifie('rien : liste vide', chercher('zzz', chantiers, messages, null).length === 0)
verifie('on arrive sur « travail »', ONGLET_DEFAUT === 'travail')
bilan('verifier-recherche')
