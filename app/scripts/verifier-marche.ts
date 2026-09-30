// Marche à suivre d'une action manuelle (src/lib/marche.ts, 0033, chantier e9a7c360).
import { verifie, bilan } from './_assert.ts'
import { domaineDe, lienSur, marcheDe } from '../src/lib/marche.ts'

console.log('verifier-marche')
verifie('rien, pas un objet, ou tout vide : null (la carte ne montre pas de bloc vide)',
  marcheDe({}) === null && marcheDe({ marche: null }) === null && marcheDe({ marche: [] }) === null
    && marcheDe({ marche: { liens: [], etapes: [' '], copier: [{ libelle: 'x', texte: '  ' }] } }) === null)
const m = marcheDe({ marche: {
  liens: [{ url: 'https://github.com/settings/secrets/actions/new', libelle: 'Ouvrir les secrets' }, { url: 'javascript:alert(1)', libelle: 'piège' }, { url: 'http://exemple.com/x' }],
  etapes: ['Dans « Name », colle le nom', '', 'Touche « Add secret »'],
  copier: [{ libelle: 'Nom du secret', texte: 'RUNPOD_API_KEY' }, { texte: 'sans libellé' }],
} })
verifie('seuls les liens https restent (jamais javascript: ni http:)', m?.liens.length === 1 && m.liens[0].libelle === 'Ouvrir les secrets')
verifie('les étapes vides tombent, l’ordre est gardé', m?.etapes.length === 2 && m.etapes[1] === 'Touche « Add secret »')
verifie('un texte à copier sans libellé en reçoit un', m?.copier.length === 2 && m.copier[1].libelle === 'Texte à coller' && m.copier[0].texte === 'RUNPOD_API_KEY')
verifie('un lien sans libellé : « Ouvrir la page »', marcheDe({ marche: { liens: [{ url: 'https://a.b/c' }] } })?.liens[0].libelle === 'Ouvrir la page')
verifie('lienSur : https oui, le reste non', lienSur('https://a.b/c') && !lienSur('http://a.b') && !lienSur('data:text/html,x') && !lienSur('pas une adresse'))
verifie('domaineDe : le domaine sans www', domaineDe('https://www.runpod.io/console/user/settings') === 'runpod.io' && domaineDe('x') === '')
bilan('verifier-marche')
