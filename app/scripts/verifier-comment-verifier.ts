// « Comment vérifier » : découpe en étapes, liens cliquables, demande déjà
// faite — et la copie du module embarqué qui doit dire exactement la même chose.
import { readFileSync } from 'node:fs'
import { verifie, bilan } from './_assert.ts'
import {
  etapesVerifier, segmentsAvecLiens, liensAOuvrir, corpsDemandeVerifier, derniereDemandeVerifier, QUESTION_VERIFIER,
} from '../src/lib/commentVerifier.ts'

console.log('verifier-comment-verifier')
const num = (t: string) => etapesVerifier(t).map((e) => e.numero)
const txt = (t: string) => etapesVerifier(t).map((e) => e.texte)

// Une seule ligne « 1. … 2. … 3. … » : trois étapes.
const uneLigne = '1. Ouvre le cockpit. 2. Touche « Réglages ». 3. Tu dois voir ton e-mail en haut.'
verifie('une ligne « 1. … 2. … 3. … » donne trois étapes', JSON.stringify(num(uneLigne)) === '["1","2","3"]', etapesVerifier(uneLigne))
verifie('le texte de chaque étape ne garde pas le numéro suivant', txt(uneLigne)[0] === 'Ouvre le cockpit.' && txt(uneLigne)[2] === 'Tu dois voir ton e-mail en haut.', txt(uneLigne))

// Déjà sur plusieurs lignes : on respecte, sans doubler.
const multi = '1. Ouvre la page\n2. Clique sur Envoyer\n\n3. Un toast vert apparaît'
verifie('des étapes déjà sur plusieurs lignes restent trois, lignes vides écartées', JSON.stringify(num(multi)) === '["1","2","3"]', etapesVerifier(multi))
verifie('les retours Windows (\\r\\n) sont des retours à la ligne', etapesVerifier('1. a\r\n2. b').length === 2)

// Texte libre sans numéro : une ligne par ligne, aucun numéro inventé.
verifie('un texte sans numéro garde ses lignes telles quelles', JSON.stringify(etapesVerifier('Ouvre la page.\nRegarde le bandeau.')) ===
  JSON.stringify([{ numero: null, texte: 'Ouvre la page.' }, { numero: null, texte: 'Regarde le bandeau.' }]))
verifie('texte vide ou null : aucune étape', etapesVerifier('').length === 0 && etapesVerifier(null).length === 0 && etapesVerifier('  \n  ').length === 0)

// Ce qui NE doit PAS couper.
verifie('« version 2.5 » ne coupe pas (pas d’espace après le point)', etapesVerifier('Ouvre la version 2.5 du site').length === 1)
verifie('« à 10. Puis » au milieu d’une phrase ne coupe pas (ni en tête, ni 1)', etapesVerifier('Attends jusqu’à 10. Puis recharge.').length === 1)
verifie('une suite qui saute un numéro ne coupe pas au mauvais endroit',
  JSON.stringify(num('1. Ouvre la page du lot 5. Vérifie 2. Touche OK')) === '["1","2"]', etapesVerifier('1. Ouvre la page du lot 5. Vérifie 2. Touche OK'))
const avecIntro = 'Sur ton téléphone : 1. Ouvre l’app 2. Va dans Réglages'
verifie('une phrase d’introduction avant « 1. » reste une ligne à part', JSON.stringify(etapesVerifier(avecIntro)) ===
  JSON.stringify([{ numero: null, texte: 'Sur ton téléphone :' }, { numero: '1', texte: 'Ouvre l’app' }, { numero: '2', texte: 'Va dans Réglages' }]), etapesVerifier(avecIntro))
verifie('le format « 1) … 2) … » est reconnu aussi', JSON.stringify(num('1) Ouvre 2) Ferme')) === '["1","2"]')

// Liens.
const s1 = segmentsAvecLiens('Va sur https://rnab26.github.io/Cockpit-General/. Puis recharge.')
verifie('un lien est repéré, le point final de la phrase n’en fait pas partie',
  s1.length === 3 && s1[1].lien && s1[1].texte === 'https://rnab26.github.io/Cockpit-General/' && s1[2].texte === '. Puis recharge.', s1)
const s2 = segmentsAvecLiens('(voir https://exemple.fr/page)')
verifie('une parenthèse fermante non ouverte dans l’adresse reste hors du lien', s2[1]?.lien === true && s2[1].texte === 'https://exemple.fr/page' && s2[2]?.texte === ')', s2)
const s3 = segmentsAvecLiens('https://fr.wikipedia.org/wiki/Test_(informatique)')
verifie('une parenthèse qui fait partie de l’adresse est gardée', s3.length === 1 && s3[0].texte === 'https://fr.wikipedia.org/wiki/Test_(informatique)', s3)
const lo = liensAOuvrir('1. Ouvre https://github.com/rnab26/Cockpit-General/pull/12 2. Puis https://rnab26.github.io/Cockpit-General/. Revois https://github.com/rnab26/Cockpit-General/pull/12 et https://x.fr/a.png')
verifie('liens à ouvrir : PR nommée, doublon écarté, site, image', JSON.stringify(lo.map((l) => l.libelle)) === JSON.stringify(['PR n° 12', 'rnab26.github.io', 'Image à voir']))
verifie('liens à ouvrir : rien sans lien', liensAOuvrir(null).length === 0)
verifie('http et https, deux liens dans le même texte', segmentsAvecLiens('http://a.fr et https://b.fr').filter((x) => x.lien).length === 2)
verifie('« javascript: » ou « ftp: » ne deviennent jamais des liens', segmentsAvecLiens('javascript:alert(1) ftp://x.fr').every((x) => !x.lien))
verifie('sans lien, le texte ressort en un seul morceau intact', JSON.stringify(segmentsAvecLiens('rien ici')) === JSON.stringify([{ lien: false, texte: 'rien ici' }]))

// La demande « comment vérifier ».
const corps = corpsDemandeVerifier('Raphaël')
verifie('le message demandé est celui convenu', corps === 'Raphaël demande : comment vérifier ce chantier ? (étapes, où aller, ce que je dois voir)', corps)
const fil = [
  { kind: 'info', corps: corpsDemandeVerifier('Raphaël'), created_at: '2026-09-28T08:00:00Z' },
  { kind: 'info', corps: corpsDemandeVerifier('Raphaël'), created_at: '2026-09-28T11:00:00+00:00' },
  { kind: 'question', corps: 'x ' + QUESTION_VERIFIER, created_at: '2026-09-28T12:00:00Z' },
  { kind: 'info', corps: 'autre chose', created_at: '2026-09-28T13:00:00Z' },
]
verifie('la dernière demande depuis la livraison est retrouvée', derniereDemandeVerifier(fil, '2026-09-28T09:00:00Z')?.created_at === '2026-09-28T11:00:00+00:00')
verifie('une demande antérieure à la livraison ne compte plus', derniereDemandeVerifier(fil.slice(0, 1), '2026-09-28T09:00:00Z') === null)
verifie('une question (kind question) n’est pas prise pour la demande', derniereDemandeVerifier(fil.slice(2), null) === null)

// La copie du module embarqué dit la même chose.
const src = readFileSync(new URL('../../embed/cockpit-embed.js', import.meta.url), 'utf8')
const bloc = src.match(/\/\/ <etapes-verifier>[^\n]*\n([\s\S]*?)\/\/ <\/etapes-verifier>/)
verifie('le module embarqué porte le bloc <etapes-verifier>', !!bloc)
if (bloc) {
  const copie = new Function(bloc[1] + '\nreturn { etapesVerifier, segmentsAvecLiens }')() as {
    etapesVerifier: typeof etapesVerifier; segmentsAvecLiens: typeof segmentsAvecLiens }
  const cas = [uneLigne, multi, 'Ouvre la version 2.5 du site', 'Attends jusqu’à 10. Puis recharge.', avecIntro, '1) Ouvre 2) Ferme',
    '1. Ouvre la page du lot 5. Vérifie 2. Touche OK', '', '1. a\r\n2. b', 'Va sur https://x.fr/a. 2. puis (https://y.fr/b) et https://w.org/T_(i)']
  const diverge = cas.filter((t) => JSON.stringify(copie.etapesVerifier(t)) !== JSON.stringify(etapesVerifier(t))
    || JSON.stringify(copie.segmentsAvecLiens(t)) !== JSON.stringify(segmentsAvecLiens(t)))
  verifie('le module embarqué découpe et repère les liens exactement comme l’app', diverge.length === 0, diverge)
}
bilan('verifier-comment-verifier')
