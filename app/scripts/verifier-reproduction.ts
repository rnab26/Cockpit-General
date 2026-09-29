// « Pour reproduire » (D-05) : nettoyage des adresses et des textes (serveur =
// module embarqué, exécutés côte à côte), bornage de ce que le navigateur
// envoie, et lecture en mots simples pour l'app.
//   node --experimental-strip-types app/scripts/verifier-reproduction.ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifie, bilan } from './_assert.ts'
import { nettoyerUrl, masquerSecrets, bornerReproduction, REPRO_MAX_OCTETS } from '../../supabase/functions/cockpit-embed/reproduction.ts'
import { lireReproduction, actionEnMots, urlOuvrable } from '../src/lib/reproduction.ts'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
const JETON = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6'

console.log('1. Nettoyage d’adresse (serveur)')
const cas: Array<[string, string, string | null]> = [
  ['page simple gardée', 'https://site.fr/clients?tri=date&page=2', 'https://site.fr/clients?tri=date&page=2'],
  ['token retiré', 'https://site.fr/x?token=abc&tri=date', 'https://site.fr/x?tri=date'],
  ['access_token dans le fragment (Supabase)', 'https://site.fr/#access_token=' + JWT + '&type=recovery', 'https://site.fr/#type=recovery'],
  ['api_key retiré', 'https://site.fr/x?api_key=zz&q=pomme', 'https://site.fr/x?q=pomme'],
  ['password retiré', 'https://site.fr/login?password=secret123', 'https://site.fr/login'],
  ['mdp retiré', 'https://site.fr/login?mdp=x', 'https://site.fr/login'],
  ['code et state OAuth retirés', 'https://site.fr/cb?code=4%2F0Ab&state=xyz', 'https://site.fr/cb'],
  ['e-mail en valeur retiré', 'https://site.fr/x?utilisateur=jean%40exemple.fr&vue=liste', 'https://site.fr/x?vue=liste'],
  ['jeton en valeur (nom anodin) retiré', 'https://site.fr/x?ref=' + JETON, 'https://site.fr/x'],
  ['X-Amz-Signature retiré', 'https://b.s3.fr/f.png?X-Amz-Signature=ab12&X-Amz-Date=2026', 'https://b.s3.fr/f.png?X-Amz-Date=2026'],
  ['identifiant:mot de passe retirés', 'https://jean:motdepasse@site.fr/admin', 'https://site.fr/admin'],
  ['jeton dans le chemin remplacé', 'https://site.fr/reset/' + JETON, 'https://site.fr/reset/(retire)'],
  ['JWT dans le chemin remplacé', 'https://site.fr/magic/' + JWT, 'https://site.fr/magic/(retire)'],
  ['uuid dans le chemin gardé', 'https://site.fr/chantier/0f8fad5b-d9cb-469f-a165-70867728950e', 'https://site.fr/chantier/0f8fad5b-d9cb-469f-a165-70867728950e'],
  ['slug lisible gardé', 'https://site.fr/rapport-2026-09-29-clients-actifs', 'https://site.fr/rapport-2026-09-29-clients-actifs'],
  ['route de fragment gardée', 'https://site.fr/app#/clients/42', 'https://site.fr/app#/clients/42'],
  ['route de fragment avec token', 'https://site.fr/app#/clients?token=abc&tri=nom', 'https://site.fr/app#/clients?tri=nom'],
  ['javascript: refusé', 'javascript:alert(1)', null],
  ['data: refusé', 'data:text/html,<b>x</b>', null],
  ['vide', '', null],
  ['pas une adresse', 'pas une adresse', null],
  ['trop long : paramètres retirés', 'https://site.fr/x?q=' + 'a'.repeat(600), 'https://site.fr/x'],
]
for (const [nom, entree, attendu] of cas) {
  const r = nettoyerUrl(entree)
  verifie(nom, r === attendu, { entree, obtenu: r, attendu })
}
verifie('jamais un « token= » ni un JWT dans ce qui sort', cas.every(([, e]) => { const r = nettoyerUrl(e) ?? ''; return !/token=|eyJ/.test(r) }))

console.log('\n2. Textes libres (erreurs, libellés)')
verifie('JWT masqué', !masquerSecrets('Échec avec ' + JWT, 300).includes('eyJ'))
verifie('e-mail masqué', masquerSecrets('Contact jean@exemple.fr introuvable', 300) === 'Contact (e-mail) introuvable', masquerSecrets('Contact jean@exemple.fr introuvable', 300))
verifie('adresse dans le texte nettoyée', masquerSecrets('fetch https://api.fr/x?token=abc a échoué', 300) === 'fetch https://api.fr/x a échoué', masquerSecrets('fetch https://api.fr/x?token=abc a échoué', 300))
verifie('jeton long masqué', masquerSecrets('clé ' + JETON, 300) === 'clé (retire)')
verifie('phrase ordinaire intacte', masquerSecrets("Cannot read properties of undefined (reading 'map')", 300) === "Cannot read properties of undefined (reading 'map')")
verifie('longueur bornée', masquerSecrets('x'.repeat(500), 80).length === 80)
verifie('pas une chaîne → vide', masquerSecrets(42, 80) === '' && masquerSecrets(null, 80) === '')

console.log('\n3. Module embarqué = serveur (bloc <nettoyer-url>)')
const src = readFileSync(path.join(RACINE, 'embed/cockpit-embed.js'), 'utf8')
const bloc = src.match(/\/\/ <nettoyer-url>[^\n]*\n([\s\S]*?)\/\/ <\/nettoyer-url>/)
verifie('le module porte le bloc <nettoyer-url>', !!bloc)
if (bloc) {
  const copie = new Function(bloc[1] + '\nreturn { nettoyerUrl, masquerSecrets }')() as { nettoyerUrl: typeof nettoyerUrl; masquerSecrets: typeof masquerSecrets }
  const divergences = cas.filter(([, e]) => copie.nettoyerUrl(e) !== nettoyerUrl(e)).map(([n]) => n)
  verifie('mêmes adresses nettoyées sur les ' + cas.length + ' cas', divergences.length === 0, divergences)
  const textes = ['Échec avec ' + JWT, 'Contact jean@exemple.fr', 'fetch https://api.fr/x?token=abc', 'clé ' + JETON, 'rien de secret', 'x'.repeat(400)]
  verifie('mêmes textes masqués', textes.every((t) => copie.masquerSecrets(t, 120) === masquerSecrets(t, 120)))
}
verifie('le module ne capture pas si data-reproduction="non"', /data-reproduction/.test(src) && /if \(cfg\.reproduction\) installerCapture\(\)/.test(src) && /if \(!cfg\.reproduction\) return null/.test(src))
const lignesValeur = src.slice(src.indexOf('// <capture>'), src.indexOf('// </capture>')).split('\n').filter((l) => /\.value\b/.test(l))
verifie('le module ne lit jamais la valeur d’un champ de saisie (seulement le texte d’un bouton « submit »)', lignesValeur.length > 0 && lignesValeur.every((l) => /type === 'submit' \|\| type === 'button'\) && el\.value/.test(l)), lignesValeur)

console.log('\n4. Bornage de ce que le navigateur envoie')
const maintenant = new Date('2026-09-29T10:00:00Z')
const propre = bornerReproduction({
  page: { url: 'https://site.fr/export?token=abc&format=pdf', titre: 'Export' },
  ecran: { largeur: 390, hauteur: 844, ratio: 3 },
  appareil: { resume: 'iPhone · Safari 17', ua: 'Mozilla/5.0 (iPhone)', tactile: true },
  langue: 'fr-FR', fuseau: 'Asia/Jerusalem', heure: '2026-09-29T09:59:00.000Z', version: 'abc1234',
  actions: [{ t: '2026-09-29T09:58:00Z', type: 'page', quoi: 'page', libelle: 'https://site.fr/export?token=zz' }, { t: 'x', type: 'clic', quoi: 'bouton', libelle: 'Exporter' }, { type: 'pirate', libelle: 'x' }],
  erreurs: [{ message: 'TypeError: x is undefined', source: 'https://site.fr/app.js:10:5' }],
  champ_inconnu: 'ne doit pas passer',
}, 'creation', maintenant)
verifie('une capture propre est gardée', !!propre && propre.page.url === 'https://site.fr/export?format=pdf' && propre.version === 'abc1234' && propre.contexte === 'creation', propre)
verifie('les champs inconnus ne passent pas', !!propre && !('champ_inconnu' in propre))
verifie('une action de type inconnu est écartée', !!propre && propre.actions.length === 2 && propre.actions.every((a) => a.type !== ('pirate' as never)))
verifie('adresse d’une action « page » nettoyée', !!propre && propre.actions[0].libelle === 'https://site.fr/export')
verifie('date illisible → null (jamais une erreur)', !!propre && propre.actions[1].t === null)
verifie('recu_at posé par le serveur', !!propre && propre.recu_at === maintenant.toISOString())
verifie('pas un objet → null', bornerReproduction('texte', 'creation') === null && bornerReproduction([1, 2], 'creation') === null && bornerReproduction(null, 'creation') === null)
verifie('objet vide → null', bornerReproduction({}, 'creation') === null)
const enorme = bornerReproduction({
  page: { url: 'https://site.fr/', titre: 'T'.repeat(5000) },
  ecran: { largeur: 1e9, hauteur: -5, ratio: 'x' },
  appareil: { resume: 'A'.repeat(500), ua: 'U'.repeat(5000), tactile: 'oui' },
  langue: 'L'.repeat(500), version: 'V'.repeat(500),
  actions: Array.from({ length: 500 }, (_, i) => ({ t: '2026-09-29T09:00:00Z', type: 'clic', quoi: 'bouton', libelle: 'B' + i + ' '.repeat(3) + 'mot '.repeat(100) })),
  erreurs: Array.from({ length: 100 }, () => ({ message: 'E'.repeat(5000), source: 'S'.repeat(5000) })),
}, 'correction', maintenant)
verifie('énorme : borné à la taille maximale', !!enorme && JSON.stringify(enorme).length <= REPRO_MAX_OCTETS, enorme && JSON.stringify(enorme).length)
verifie('énorme : 20 actions au plus, les plus récentes', !!enorme && enorme.actions.length <= 20 && enorme.actions[enorme.actions.length - 1].libelle.startsWith('B499'))
verifie('énorme : 5 erreurs au plus, messages ≤ 300', !!enorme && enorme.erreurs.length <= 5 && enorme.erreurs.every((e) => e.message.length <= 300))
verifie('énorme : titre ≤ 200, ua ≤ 300, version ≤ 64', !!enorme && enorme.page.titre.length <= 200 && enorme.appareil.ua.length <= 300 && (enorme.version ?? '').length <= 64)
verifie('énorme : nombres hors bornes → null, booléen faux type → null', !!enorme && enorme.ecran.largeur === null && enorme.ecran.hauteur === null && enorme.ecran.ratio === null && enorme.appareil.tactile === null)
verifie('contexte correction gardé', !!enorme && enorme.contexte === 'correction')

console.log('\n5. Lecture pour l’app')
const vue = lireReproduction(propre)
verifie('vue : page, adresse ouvrable, appareil + écran', !!vue && vue.pageTitre === 'Export' && vue.url === 'https://site.fr/export?format=pdf' && vue.appareil === 'iPhone · Safari 17 — écran 390 × 844', vue)
verifie('vue : étapes en mots', !!vue && vue.etapes.map((e) => e.texte).join(' | ') === 'Ouvre la page /export | Touche le bouton « Exporter »', vue && vue.etapes)
verifie('vue : erreurs', !!vue && vue.erreurs.length === 1 && vue.moment === 'Lors de la demande')
verifie('vue : correction', lireReproduction(enorme)?.moment === 'Lors de la correction')
verifie('rien → null (pas de bloc)', lireReproduction(null) === null && lireReproduction({}) === null && lireReproduction('x') === null && lireReproduction([]) === null)
verifie('javascript: jamais ouvrable (pas de bouton Rejouer)', urlOuvrable('javascript:alert(1)') === null && lireReproduction({ page: { url: 'javascript:alert(1)', titre: 'x' } })?.url === null)
verifie('lien, case, onglet, saisie en mots',
  actionEnMots({ type: 'clic', quoi: 'lien', libelle: 'Aide' }) === 'Touche le lien « Aide »'
  && actionEnMots({ type: 'clic', quoi: 'case', libelle: '' }) === 'Coche ou décoche une case'
  && actionEnMots({ type: 'clic', quoi: 'onglet', libelle: 'Factures' }) === 'Ouvre l\'onglet « Factures »'
  && actionEnMots({ type: 'saisie', quoi: 'champ', libelle: 'Email' }) === 'Remplit le champ « Email »')
verifie('page d’une autre origine : adresse entière', actionEnMots({ type: 'page', libelle: 'https://autre.fr/a' }, 'https://site.fr') === 'Ouvre la page https://autre.fr/a')
verifie('double toucher = une étape', lireReproduction({ page: { url: 'https://s.fr/' }, actions: [{ type: 'clic', quoi: 'bouton', libelle: 'OK' }, { type: 'clic', quoi: 'bouton', libelle: 'OK' }] })?.etapes.length === 1)

bilan('Pour reproduire')
