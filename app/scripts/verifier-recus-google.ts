// Règles de l'écran « programme dans ton compte Google » (lib/recusGoogle.ts), sans réseau ni navigateur.
// node --experimental-strip-types app/scripts/verifier-recus-google.ts
// Le parcours réel sur téléphone est app/scripts/verifier-recus-google.mjs ; la fonction serveur et le programme, scripts/verifier-recus-google.mjs.
import { readFileSync } from 'node:fs'
import { verifie, bilan } from './_assert.ts'
import {
  APRES_INSTALLATION, CLE_IMPORT_RE, ETAPES, MARQUE_CLE, RATTRAPAGE, cleActive, departAReculer, etatGoogle, lireCle, plusAncienneFacture, programmeAvecCle, serviceALecteur, textesDeLAssistant, versionDuProgramme,
  type CleImport,
} from '../src/lib/recusGoogle.ts'

const PROGRAMME = readFileSync(new URL('../src/google/recus-claude/Code.gs', import.meta.url), 'utf8')
const CLE = 'cki_' + 'ab12cd34'.repeat(8)
const NOW = new Date('2026-10-14T12:00:00Z')
const cle = (extra: Partial<CleImport> = {}): CleImport => ({
  id: 'k1', projet_id: 'p', service_id: 's1', fin: CLE.slice(-4), created_at: '2026-10-14T11:00:00Z', revoquee_at: null, derniere_utilisation_at: null, utilisations: 0, programme_version: null, ...extra,
})

console.log('quels prestataires ont un programme Google')
verifie('« Claude » et « Anthropic » (majuscules, espaces indifférents)', serviceALecteur('Claude') && serviceALecteur('claude') && serviceALecteur('  Anthropic ') && serviceALecteur('CLAUDE'))
verifie('les autres prestataires n’en ont pas (la règle ne lit que les reçus d’Anthropic)', !serviceALecteur('RunPod') && !serviceALecteur('Claude Code') && !serviceALecteur('') && !serviceALecteur('Supabase'))

console.log('la clé active')
verifie('la clé active d’un prestataire, jamais celle d’un autre, jamais une révoquée', cleActive([cle({ id: 'a', service_id: 's2' }), cle({ id: 'b', revoquee_at: '2026-10-13T00:00:00Z' }), cle({ id: 'c' })], 's1')?.id === 'c')
verifie('aucune clé : null', cleActive([], 's1') === null && cleActive([cle({ revoquee_at: '2026-10-13T00:00:00Z' })], 's1') === null)
verifie('lireCle : les nombres arrivent parfois en texte', lireCle({ ...cle(), utilisations: '3', programme_version: '2' }).utilisations === 3 && lireCle({ ...cle(), programme_version: null }).programme_version === null && lireCle({ ...cle(), utilisations: undefined }).utilisations === 0)

console.log('le programme prêt à coller')
verifie('la marque de clé est dans le programme exactement une fois', PROGRAMME.split(MARQUE_CLE).length === 2)
const pose = programmeAvecCle(PROGRAMME, CLE)
verifie('la clé est posée à la place de la marque (une fois), le reste est identique', pose.includes(`const CLE = '${CLE}';`) && !pose.includes('__CLE__') && pose.split(CLE).length === 2 && pose.replace(CLE, '__CLE__') === PROGRAMME)
verifie('une clé mal formée est refusée (jamais posée dans le code)', ['', 'cki_', 'cki_' + 'a'.repeat(63), 'cki_' + 'A'.repeat(64), CLE + ' ', "x'; evil(); '", 'cki_' + '$&'.repeat(32)].every((c) => { try { programmeAvecCle(PROGRAMME, c); return false } catch { return true } }))
verifie('un programme sans marque, ou avec deux marques, est refusé', (() => { try { programmeAvecCle('rien', CLE); return false } catch { /* attendu */ } try { programmeAvecCle(`${MARQUE_CLE} ${MARQUE_CLE}`, CLE); return false } catch { return true } })())
verifie('la forme d’une clé', CLE_IMPORT_RE.test(CLE) && !CLE_IMPORT_RE.test('cki_xyz') && !CLE_IMPORT_RE.test(CLE.toUpperCase()))
verifie('la version du programme est lue (1 aujourd’hui) ; sans ligne de version : null', versionDuProgramme(PROGRAMME) === 1 && versionDuProgramme('const VERSION = 12;\n') === 12 && versionDuProgramme('// rien') === null)

console.log('ce que dit la carte du prestataire')
const sans = etatGoogle(null, 1, NOW)
verifie('aucune clé : « pas encore branchés », avec ce que ça apporte', sans.niveau === 'aucune' && /pas encore branchés/.test(sans.titre) && /PDF/.test(sans.detail ?? '') && /Gratuit/.test(sans.detail ?? ''))
const att = etatGoogle(cle(), 1, NOW)
verifie('clé créée, programme jamais venu : « attente », avec les 4 derniers caractères', att.niveau === 'attente' && /…ab34|…cd34/.test(att.titre) && /n’a pas encore appelé/.test(att.titre))
const ok = etatGoogle(cle({ derniere_utilisation_at: '2026-10-14T11:55:00Z', programme_version: 1 }), 1, NOW)
verifie('programme venu il y a 5 min, à jour : « branché », dit quand', ok.niveau === 'branche' && /il a appelé le cockpit il y a 5 min/.test(ok.titre))
const vieux = etatGoogle(cle({ derniere_utilisation_at: '2026-10-14T11:55:00Z', programme_version: 1 }), 2, NOW)
verifie('une copie plus ancienne que celle de l’app : « périmé », dit les deux versions et quoi faire', vieux.niveau === 'perime' && /version 1/.test(vieux.titre) && /version 2/.test(vieux.titre) && /Gérer/.test(vieux.detail ?? ''))
verifie('version inconnue (programme jamais venu avec sa version) : pas de fausse alerte', etatGoogle(cle({ derniere_utilisation_at: '2026-10-14T11:55:00Z', programme_version: null }), 2, NOW).niveau === 'branche')

console.log('rattraper les PDF des anciennes factures')
const dep = (service_id: string | null, type: string, date: string) => ({ service_id, type, date })
verifie('la plus ancienne FACTURE du prestataire (pas celle d’un autre, pas une consommation ou une recharge)', plusAncienneFacture([dep('s1', 'facture', '2026-09-10'), dep('s1', 'facture', '2026-07-14'), dep('s2', 'facture', '2025-01-01'), dep('s1', 'consommation', '2026-01-01'), dep(null, 'facture', '2024-01-01')], 's1') === '2026-07-14')
verifie('aucune facture : null', plusAncienneFacture([], 's1') === null && plusAncienneFacture([dep('s1', 'recharge', '2026-01-01')], 's1') === null)
verifie('le départ recule jusqu’à la plus ancienne facture', departAReculer('2026-10-13', '2026-07-14') === '2026-07-14')
verifie('rien à rattraper : départ déjà assez ancien, ou égal, ou pas de facture', departAReculer('2026-07-14', '2026-07-14') === null && departAReculer('2026-01-01', '2026-07-14') === null && departAReculer('2026-10-13', null) === null)
verifie('dates illisibles ou d’avant 2023 : jamais de recul (le champ du prestataire les refuserait)', departAReculer('2026-10-13', '14/07/2026') === null && departAReculer(undefined, '2026-07-14') === null && departAReculer('2026-10-13', '2022-12-31') === null)
verifie('les phrases du rattrapage disent le jour, le bouton et ce qui arrive ensuite', /14 juil\. 2026/.test(RATTRAPAGE.titre('14 juil. 2026')) && /dimanche/.test(RATTRAPAGE.explication) && /Départ reculé au 14 juil\. 2026/.test(RATTRAPAGE.fait('14 juil. 2026')) && /PDF/.test(RATTRAPAGE.bouton))

console.log('l’assistant : une étape à la fois, des mots simples')
verifie('sept étapes dans l’ordre : clé, Google, programme, réglages, coller les réglages, installer, vérifier', ETAPES.map((e) => e.id).join() === 'cle,google,programme,reglages,reglages-coller,installer,verifier')
verifie('chaque étape a un titre et au moins une consigne', ETAPES.every((e) => e.titre.length > 0 && e.consignes.length > 0))
verifie('l’étape « Google » donne l’adresse exacte à ouvrir (https)', ETAPES.find((e) => e.id === 'google')?.lien?.url === 'https://script.google.com/')
verifie('les deux copies (programme, réglages) sont sur les bonnes étapes', ETAPES.find((e) => e.id === 'programme')?.copier?.quoi === 'programme' && ETAPES.find((e) => e.id === 'reglages-coller')?.copier?.quoi === 'reglages')
verifie('l’étape « installer » dit le nom de la fonction à lancer et l’écran d’avertissement de Google à passer', (() => { const t = ETAPES.find((e) => e.id === 'installer')!.consignes.join(' '); return /« installer »/.test(t) && /Exécuter/.test(t) && /n’a pas validé/.test(t) && /Paramètres avancés/.test(t) && /Autoriser/.test(t) })())
verifie('le dernier mot de l’assistant dit ce qui se passe ensuite (le dimanche) et comment tout arrêter', APRES_INSTALLATION.some((t) => /dimanche/.test(t)) && APRES_INSTALLATION.some((t) => /Révoquer/.test(t)))
verifie('aucune consigne ne cite de secret ni de clé en clair', textesDeLAssistant().every(({ texte }) => !/cki_[0-9a-f]{8}/.test(texte)))

bilan('verifier-recus-google (règles)')
