// La frise « Codé → Envoyé → Vérifié par les robots → En ligne » et la phrase
// « tu peux vérifier maintenant / attends » (src/lib/jalons.ts, migration 0007).
// Dates construites en heure LOCALE : le test tient quel que soit le fuseau.
import { verifie, bilan } from './_assert.ts'
import { frise, syntheseMiseEnLigne, heureLisible, momentLisible, lireJalons, demandeUnGeste } from '../src/lib/jalons.ts'

const now = new Date(2026, 8, 29, 15, 30)
const a = (h: number, m: number, jour = 29) => new Date(2026, 8, jour, h, m).toISOString()
const J = (k: string, at: string, detail: string | null = null) => ({ [k]: { at, detail } })

console.log('verifier-jalons')

// 1. Aucun jalon : ancien chantier, on n'affiche rien.
verifie('sans jalon : pas de frise', frise({}, now) === null && frise(null, now) === null && frise(undefined, now) === null)
verifie('sans jalon : pas de phrase', syntheseMiseEnLigne({}, now) === null)
verifie('jsonb mal formé : ignoré sans planter', frise('n’importe quoi', now) === null && frise([1, 2], now) === null)

// 2. Le chemin complet : 4 étapes cochées, « C'est en ligne depuis 14 h 02 ».
{
  const j = { ...J('code', a(13, 40)), ...J('pousse', a(13, 50), 'abc1234'), ...J('ci_ok', a(13, 58)), ...J('en_ligne', a(14, 2), 'https://rnab26.github.io/Cockpit-General/') }
  const f = frise(j, now)!
  verifie('complet : 4 étapes, toutes « fait »', f.length === 4 && f.every((e) => e.etat === 'fait'), f.map((e) => e.etat))
  verifie('complet : les libellés en mots d’enfant', f.map((e) => e.libelle).join(' | ') === 'Codé | Envoyé | Vérifié par les robots | En ligne', f.map((e) => e.libelle))
  verifie('complet : l’adresse en ligne est cliquable', f[3].url === 'https://rnab26.github.io/Cockpit-General/')
  verifie('complet : chaque étape a son heure', f[0].heure === '13 h 40' && f[3].heure === '14 h 02', f.map((e) => e.heure))
  const s = syntheseMiseEnLigne(j, now)!
  verifie('complet : « C’est en ligne depuis 14 h 02 : tu peux vérifier maintenant »', s.code === 'en_ligne' && s.texte.includes('depuis 14 h 02') && s.texte.includes('tu peux vérifier maintenant') && s.peutVerifier, s.texte)
}

// 3. Seulement envoyé : « Pas encore en ligne », les étapes suivantes grises.
{
  const j = J('pousse', a(15, 0), 'def5678')
  const f = frise(j, now)!
  verifie('envoyé seulement : codé et envoyé cochés (envoyé prouve codé)', f[0].etat === 'fait' && f[1].etat === 'fait')
  verifie('envoyé seulement : robots et en ligne en attente (gris)', f[2].etat === 'attente' && f[3].etat === 'attente')
  verifie('envoyé seulement : le commit est gardé', f[1].detail === 'def5678')
  const s = syntheseMiseEnLigne(j, now)!
  verifie('envoyé seulement : « Pas encore en ligne : attends avant de vérifier »', s.code === 'pas_encore' && s.texte.includes('Pas encore en ligne') && !s.peutVerifier, s.texte)
}

// 4. Les robots ont trouvé un problème.
{
  const j = { ...J('pousse', a(15, 0)), ...J('ci_ko', a(15, 10), 'build rouge') }
  const f = frise(j, now)!
  verifie('ci_ko : l’étape robots dit le problème, en croix', f[2].etat === 'echec' && f[2].libelle.includes('problème') && f[2].libelle.includes('Claude corrige'))
  verifie('ci_ko : pas en ligne', f[3].etat === 'attente')
  verifie('ci_ko : la phrase dit d’attendre', syntheseMiseEnLigne(j, now)!.code === 'ci_ko' && !syntheseMiseEnLigne(j, now)!.peutVerifier)
  // Un ci_ok posé ensuite l'emporte (poser_jalon retire ci_ko, mais on se protège aussi côté écran).
  verifie('ci_ok l’emporte sur un vieux ci_ko', frise({ ...j, ...J('ci_ok', a(15, 20)) }, now)![2].etat === 'fait')
}

// 5. Rien à mettre en ligne / il faut ton geste.
{
  const rien = { ...J('code', a(15, 0)), ...J('pas_en_ligne', a(15, 5), 'documentation seulement') }
  const f = frise(rien, now)!
  verifie('pas en ligne : dernière étape « Rien à mettre en ligne : documentation seulement »', f[3].etat === 'info' && f[3].libelle === 'Rien à mettre en ligne : documentation seulement', f[3].libelle)
  verifie('pas en ligne : la phrase dit qu’il peut vérifier', syntheseMiseEnLigne(rien, now)!.code === 'rien' && syntheseMiseEnLigne(rien, now)!.peutVerifier)
  const geste = J('pas_en_ligne', a(15, 5), 'installe la nouvelle APK sur ton téléphone')
  verifie('geste : « 👉 Il faut ton geste : … »', frise(geste, now)![3].libelle.startsWith('Il faut ton geste : installe'))
  verifie('geste : la phrase le dit, il ne peut pas encore vérifier', syntheseMiseEnLigne(geste, now)!.code === 'geste' && !syntheseMiseEnLigne(geste, now)!.peutVerifier)
  verifie('demandeUnGeste : « Raphaël doit activer Pages » oui, « aucun changement déployable » non', demandeUnGeste('Raphaël doit activer Pages') && !demandeUnGeste('aucun changement déployable'))
}

// 6. Une adresse qui n'en est pas une n'est pas un lien.
verifie('en ligne avec un texte (pas une URL) : pas de lien', frise(J('en_ligne', a(14, 0), 'site Render, commit abc'), now)![3].url === null)

// 7. Heures lisibles.
verifie('heure : aujourd’hui « 9 h 05 »', heureLisible(a(9, 5), now) === '9 h 05')
verifie('heure : hier « hier 18 h 40 »', heureLisible(a(18, 40, 28), now) === 'hier 18 h 40')
verifie('heure : avant hier, avec la date', /^\d+ sept\.? 8 h 00$/.test(heureLisible(a(8, 0, 20), now) ?? ''), heureLisible(a(8, 0, 20), now))
verifie('phrase : le matin se dit « du matin » (« 1 h 23 » seul se lit comme une durée)', momentLisible(a(1, 23), now) === '1 h 23 du matin' && momentLisible(a(14, 2), now) === '14 h 02')
verifie('phrase : la veille « hier, 18 h 40 »', momentLisible(a(18, 40, 28), now) === 'hier, 18 h 40')
verifie('phrase en ligne à 9 h 05 : « depuis 9 h 05 du matin »', syntheseMiseEnLigne(J('en_ligne', a(9, 5)), now)!.texte.includes('depuis 9 h 05 du matin'))
verifie('heure : absente ou invalide → null', heureLisible(null, now) === null && heureLisible('x', now) === null)
verifie('lireJalons : ne garde que les clés connues', Object.keys(lireJalons({ code: { at: a(1, 0) }, bidon: { at: 'x' } })).join() === 'code')

bilan('verifier-jalons')
