// Navigation « application » : où la barre du bas apparaît, quel onglet est allumé (src/lib/navMobile.ts).
import { verifie, bilan } from './_assert.ts'
import { navMobileActive, ongletBarreActif } from '../src/lib/navMobile.ts'

console.log('verifier-nav-mobile')
verifie('vue Mobile : barre partout (tactile ou non)', navMobileActive('mobile', true) && navMobileActive('mobile', false))
verifie('vue Ordinateur : jamais de barre', !navMobileActive('ordinateur', true) && !navMobileActive('ordinateur', false))
verifie('vue Auto : barre seulement sur écran tactile', navMobileActive('auto', true) && !navMobileActive('auto', false))
verifie('accueil allumé sur « Tout »', ongletBarreActif(true, 'travail', false) === 'accueil')
verifie('projet : travail / coûts / réglages', ongletBarreActif(false, 'travail', false) === 'projet' && ongletBarreActif(false, 'couts', false) === 'couts' && ongletBarreActif(false, 'reglages', false) === 'reglages')
verifie('recherche ouverte : elle prime', ongletBarreActif(false, 'couts', true) === 'recherche' && ongletBarreActif(true, 'travail', true) === 'recherche')
bilan('verifier-nav-mobile')
