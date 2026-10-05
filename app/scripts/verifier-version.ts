// Mise à jour de l'appli (src/lib/version.ts) : comparaison de versions, bannière écartée qui revient,
// ligne des Réglages, mise à jour automatique bloquée par un brouillon (chantier c4de4baa).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifie, bilan } from './_assert.ts'
import {
  RAPPEL_DEFAUT_MIN, banniereVisible, lireReglagesVersion, messageVerification, nouvelleVersion, peutMajAuto, phraseVersion, statutVersion,
  type EtatVersion,
} from '../src/lib/version.ts'

console.log('verifier-version')
const A = 'aaaaaaaaaaaa'
const B = 'bbbbbbbbbbbb'

// Comparaison : UNE source
verifie('même version : pas de nouvelle', !nouvelleVersion(A, { version: A }))
verifie('version différente : nouvelle', nouvelleVersion(A, { version: B }))
verifie('version avec espaces : comparée proprement', !nouvelleVersion(A, { version: ` ${A} ` }))
verifie('en développement : jamais', !nouvelleVersion('dev', { version: B }))
verifie('lecture vide / illisible / « dev » : jamais', !nouvelleVersion(A, null) && !nouvelleVersion(A, {}) && !nouvelleVersion(A, { version: '' }) && !nouvelleVersion(A, { version: 'dev' }) && !nouvelleVersion(A, 'x'))

// Le défaut signalé : écartée, la bannière devait REVENIR
const t0 = 1_000_000_000
const min = 60_000
verifie('nouvelle version, jamais écartée : visible', banniereVisible({ nouvelle: true, ecarteA: null, maintenant: t0, rappelMin: 60 }))
verifie('écartée à l’instant : cachée', !banniereVisible({ nouvelle: true, ecarteA: t0, maintenant: t0 + 1, rappelMin: 60 }))
verifie('écartée, 59 min plus tard : toujours cachée', !banniereVisible({ nouvelle: true, ecarteA: t0, maintenant: t0 + 59 * min, rappelMin: 60 }))
verifie('écartée, 1 h plus tard : REVIENT', banniereVisible({ nouvelle: true, ecarteA: t0, maintenant: t0 + 60 * min, rappelMin: 60 }))
verifie('délai réglé à 15 min : revient après 15 min', banniereVisible({ nouvelle: true, ecarteA: t0, maintenant: t0 + 15 * min, rappelMin: 15 }))
verifie('pas de nouvelle version : jamais visible', !banniereVisible({ nouvelle: false, ecarteA: null, maintenant: t0, rappelMin: 60 }))

// Réglages retenus : défaut 1 h, auto éteint, valeurs absurdes écartées
verifie('défaut : 1 h, auto éteint', RAPPEL_DEFAUT_MIN === 60 && JSON.stringify(lireReglagesVersion(null)) === JSON.stringify({ rappelMin: 60, auto: false }))
verifie('réglage lu', lireReglagesVersion('{"rappelMin":15,"auto":true}').rappelMin === 15 && lireReglagesVersion('{"rappelMin":15,"auto":true}').auto === true)
verifie('réglage corrompu ou hors liste : défaut', lireReglagesVersion('pas du json').rappelMin === 60 && lireReglagesVersion('{"rappelMin":7,"auto":"oui"}').rappelMin === 60 && !lireReglagesVersion('{"auto":"oui"}').auto)

// Mise à jour automatique
verifie('auto + nouvelle + rien en saisie : met à jour', peutMajAuto({ auto: true, nouvelle: true, brouillon: false, enCours: false }))
verifie('un brouillon BLOQUE l’auto', !peutMajAuto({ auto: true, nouvelle: true, brouillon: true, enCours: false }))
verifie('auto éteint (défaut) : jamais', !peutMajAuto({ auto: false, nouvelle: true, brouillon: false, enCours: false }))
verifie('pas de nouvelle version : rien', !peutMajAuto({ auto: true, nouvelle: false, brouillon: false, enCours: false }))
verifie('déjà en cours : pas deux fois', !peutMajAuto({ auto: true, nouvelle: true, brouillon: false, enCours: true }))

// Ligne des Réglages
const courante = { version: A + '', date: '2026-10-05T11:32:00.000Z' }
const e = (p: Partial<EtatVersion>): EtatVersion => ({ courante, lue: { version: A, date: null }, lecture: 'ok', ...p })
verifie('à jour : « À jour (commit aaaaaaa, du … »', /^À jour \(commit aaaaaaa, du \d\d\/\d\d \d\d:\d\d\)\.$/.test(phraseVersion(e({}))), phraseVersion(e({})))
verifie('nouvelle : le dit, avec les deux commits', /Nouvelle version disponible \(bbbbbbb/.test(phraseVersion(e({ lue: { version: B, date: null } }))) && /aaaaaaa/.test(phraseVersion(e({ lue: { version: B, date: null } }))))
verifie('hors ligne : dit l’impossibilité, garde la version', /Impossible de vérifier/.test(phraseVersion(e({ lecture: 'erreur' }))) && /aaaaaaa/.test(phraseVersion(e({ lecture: 'erreur' }))))
verifie('chargement : « Vérification en cours »', statutVersion(e({ lecture: 'en_cours' })) === 'verification')
verifie('une nouvelle version connue reste « nouvelle » même si la relecture échoue', statutVersion(e({ lue: { version: B, date: null }, lecture: 'erreur' })) === 'nouvelle')
verifie('dev : statut dev', statutVersion(e({ courante: { version: 'dev', date: null } })) === 'dev')
verifie('toast : à jour = succès', messageVerification(e({})).ok && /dernière version/.test(messageVerification(e({})).texte))
verifie('toast : nouvelle = succès qui invite', messageVerification(e({ lue: { version: B, date: null } })).ok && /Mettre à jour/.test(messageVerification(e({ lue: { version: B, date: null } })).texte))
verifie('toast : hors ligne = ÉCHEC', !messageVerification(e({ lecture: 'erreur' })).ok)

// « Mettre à jour » force vraiment la nouvelle version (garde-fous du code livré)
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hook = readFileSync(path.join(racine, 'src/hooks/useNouvelleVersion.ts'), 'utf8')
const sw = readFileSync(path.join(racine, 'public/sw.js'), 'utf8')
verifie('mise à jour : désinscrit le service worker, vide les caches, force le réseau, recharge',
  /unregister\(\)/.test(hook) && /caches\.delete/.test(hook) && /cache: 'reload'/.test(hook) && /location\.reload\(\)/.test(hook))
verifie('service worker : la page passe par le réseau SANS le cache HTTP', /fetch\(e\.request, \{ cache: 'reload' \}\)/.test(sw))
verifie('version.json et l’app portent la date de construction (une source : vite.config)', /date: DATE/.test(readFileSync(path.join(racine, 'vite.config.ts'), 'utf8')) && /__DATE_APP__/.test(hook))
bilan('verifier-version')
