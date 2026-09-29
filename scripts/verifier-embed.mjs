#!/usr/bin/env node
/**
 * verifier-embed.mjs — le module embarqué, de bout en bout, contre la
 * fonction RÉELLEMENT déployée et un vrai navigateur.
 *
 *   node scripts/verifier-embed.mjs            # tout
 *   SANS_NAVIGATEUR=1 node scripts/verifier-embed.mjs   # API seule
 *
 * Node 22, aucune dépendance npm (Playwright est pris dans l'installation
 * globale de l'environnement ; jamais `playwright install`, le Chromium est
 * déjà dans PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers).
 *
 * Ce qu'il prouve :
 *  1. clé fausse → 401, message lisible ;
 *  2. `etat` → structure attendue et AUCUN champ interne (notes, pris_par,
 *     pris_jusqu_a, reproduction, cle_embed, created_by, answered_by) ;
 *  3. le cycle complet d'une demande de test : créer → modifier (encore
 *     permis) → répondre à une question posée par SQL → certifier REFUSÉ
 *     tant que la demande n'est pas « à vérifier » (erreur lisible) →
 *     passée à `a_verifier` par SQL → certifier OK → corriger OK → message
 *     OK → modifier REFUSÉ (une session l'a prise) ;
 *  0. la règle de présence (bloc `<presence>` du module) dit « vivant ou
 *     pas » exactement comme app/src/lib/presence.ts, exécutés côte à côte
 *     sur les mêmes cas (import direct du .ts : Node ≥ 22.18 enlève les
 *     types tout seul) ;
 *  3b. « Comment vérifier » (0005) : `etat` renvoie `comment_verifier` ;
 *  4. dans Chromium en 390 × 844 : les cartes s'affichent, le style hostile
 *     de la page hôte ne traverse pas, une nouvelle demande créée à l'écran
 *     apparaît, aucun défilement horizontal, l'encadré « 👉 Comment vérifier »
 *     en tête du bloc orange (étapes sur des lignes distinctes, lien
 *     cliquable) ou, s'il manque, la phrase qui dit de le demander ;
 *     la présence (29 sept. 2026) : activité fraîche → bandeau, barre vive,
 *     « en cours, il y a … », badge « En cours de codage » ; la même vieille
 *     de 2 h → pas de bandeau pour elle, barre grise, « dernier avancement
 *     connu », badge « En file d'attente » ; et une session qui se tait perd
 *     son « en cours » sans nouvelle donnée (horloge avancée de 16 min, zéro
 *     appel serveur) ; captures dans SCRATCH (embed-presence.png).
 *
 * Il ne touche JAMAIS un vrai projet (29 sept. 2026 : une passe interrompue
 * avait laissé « [TEST verifier-embed …] tri des clients » dans le cockpit de
 * Raphaël). Tout vit dans un projet jetable `test-embed-<aléatoire>`, avec sa
 * propre cle_embed, créé au début et supprimé à la fin (même en cas d'échec) ;
 * la page de démo est servie avec CETTE clé. Au démarrage, les restes d'une
 * passe précédente interrompue sont purgés (scripts/bancs.mjs). Il n'écrit
 * que dans le schéma cockpit, via scripts/sql.sh.
 *
 * À RELANCER après toute modification de supabase/functions/cockpit-embed/,
 * embed/cockpit-embed.js, ou des RPC certifier/corriger/repondre.
 */
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { purgerMarquesDansLesVraisProjets, purgerPassesPrecedentes, purgerProjetsDeTest } from './bancs.mjs'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FONCTION = process.env.COCKPIT_FONCTION || 'https://bexiyvmdbxcwxasgslxp.supabase.co/functions/v1/cockpit-embed'
const SCRATCH = process.env.SCRATCH || '/tmp/claude-0/-home-user/26486ea7-9936-5198-a42a-ff8e3b15d856/scratchpad'
const MARQUE = '[TEST verifier-embed ' + new Date().toISOString().slice(0, 19) + ']'
const PREFIXE = 'test-embed-'
const SLUG = PREFIXE + randomUUID().slice(0, 8)
const CHAMPS_INTERDITS = ['notes', 'pris_par', 'pris_jusqu_a', 'reproduction', 'cle_embed', 'created_by', 'answered_by']

let reussis = 0, rates = 0
function ok(nom, detail) { reussis++; console.log('  ✓ ' + nom + (detail ? ' — ' + detail : '')) }
function ko(nom, detail) { rates++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')) }
function verifie(cond, nom, detail) { (cond ? ok : ko)(nom, detail) }

function sql(requete) {
  const sortie = execFileSync(path.join(RACINE, 'scripts/sql.sh'), [requete], { encoding: 'utf8', cwd: RACINE })
  const j = JSON.parse(sortie)
  if (!j.ok) throw new Error('SQL : ' + j.error)
  return j.rows
}
const lit = (s) => s.replace(/'/g, "''")

async function appel(action, corps, cle) {
  const r = await fetch(FONCTION, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cockpit-key': cle },
    body: JSON.stringify({ action, auteur: 'verifier-embed', ...corps }),
  })
  let j = null
  try { j = await r.json() } catch { /* vide */ }
  return { statut: r.status, corps: j }
}

function clesProfondes(v, sac = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => clesProfondes(x, sac))
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) { sac.add(k); clesProfondes(v[k], sac) }
  return sac
}

function portLibre() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
    s.on('error', rej)
  })
}

// ------------------------------------------------------ présence (parité)
// Même principe que le contrôle <etapes-verifier> de
// app/scripts/verifier-comment-verifier.ts : on exécute la COPIE du module et
// la version de l'app sur les mêmes cas, et on refuse la moindre divergence.
async function verifierPresenceParite() {
  console.log('\n0. Règle de présence : module embarqué = app')
  const src = readFileSync(path.join(RACINE, 'embed/cockpit-embed.js'), 'utf8')
  const bloc = src.match(/\/\/ <presence>[^\n]*\n([\s\S]*?)\/\/ <\/presence>/)
  verifie(!!bloc, 'le module porte le bloc <presence>')
  if (!bloc) return
  const copie = new Function(bloc[1] + '\nreturn { preuveDeVie, dateRelative, SILENCE_DEFAUT_MIN }')()
  let app
  try {
    const presence = await import(pathToFileURL(path.join(RACINE, 'app/src/lib/presence.ts')).href)
    const dates = await import(pathToFileURL(path.join(RACINE, 'app/src/lib/dates.ts')).href)
    app = { preuveDeVie: presence.preuveDeVie, SILENCE_DEFAUT_MIN: presence.SILENCE_DEFAUT_MIN, dateRelative: dates.dateRelative }
  } catch (e) {
    ko('import de app/src/lib/presence.ts', e.message + ' (Node ≥ 22.18, ou lancer avec --experimental-strip-types)')
    return
  }
  const now = new Date('2026-09-29T01:04:00Z')
  const il = (min) => new Date(now.getTime() - min * 60000).toISOString()
  const act = (statut, updated_at) => ({ statut, updated_at, session: 'claude/x', pourcentage: 85, etape: 'Bacs' })
  const cas = [
    ['en_cours il y a 2 min', act('en_cours', il(2))],
    ['en_cours il y a 14 min 59 s', act('en_cours', il(14 + 59 / 60))],
    ['en_cours il y a 15 min pile', act('en_cours', il(15))],
    ['en_cours il y a 2 h', act('en_cours', il(120))],
    ['attente il y a 1 min', act('attente', il(1))],
    ['attente il y a 5 h (la capture)', act('attente', il(300))],
    ['termine il y a 1 min', act('termine', il(1))],
    ['echec il y a 1 min', act('echec', il(1))],
    ['en_cours sans date', act('en_cours', null)],
    ['en_cours, date illisible', act('en_cours', 'pas une date')],
    ['en_cours dans le futur (horloge décalée)', act('en_cours', il(-5))],
    ['activité absente', null],
  ]
  const silences = [app.SILENCE_DEFAUT_MIN * 60000, 60 * 60000, 60000]
  const divergences = [], reponses = new Set()
  for (const [nom, a] of cas) for (const sm of silences) {
    const r = app.preuveDeVie(a, now, sm)
    reponses.add(r)
    if (copie.preuveDeVie(a, now, sm) !== r) divergences.push(nom + ' / silence ' + sm / 60000 + ' min : app=' + r)
  }
  verifie(copie.SILENCE_DEFAUT_MIN === app.SILENCE_DEFAUT_MIN, 'même délai de silence par défaut', copie.SILENCE_DEFAUT_MIN + ' / ' + app.SILENCE_DEFAUT_MIN + ' min')
  verifie(reponses.has(true) && reponses.has(false), 'les cas couvrent « vivant » ET « pas vivant » (le contrôle a un sens)')
  verifie(divergences.length === 0, '« vivant ou pas » : le module et l’app disent la même chose (' + cas.length * silences.length + ' cas)', divergences.join(' | ') || 'aucune divergence')
  const attendu = { 'en_cours il y a 2 min': true, 'en_cours il y a 2 h': false, 'attente il y a 1 min': false }
  const faux = Object.entries(attendu).filter(([nom, v]) => copie.preuveDeVie(cas.find((c) => c[0] === nom)[1], now, silences[0]) !== v)
  verifie(faux.length === 0, 'fraîche = vivante ; vieille de 2 h ou « attente » = pas vivante', faux.map((f) => f[0]).join(', ') || '')
  const ecarts = [0, 30, 60, 100, 5 * 60, 59 * 60, 90 * 60, 5 * 3600, 23 * 3600, 30 * 3600, 3 * 86400, 40 * 86400]
  const diffDates = ecarts.map((s) => new Date(now.getTime() - s * 1000).toISOString())
    .filter((iso) => copie.dateRelative(iso, now) !== app.dateRelative(iso, now))
  verifie(diffDates.length === 0 && copie.dateRelative(null, now) === app.dateRelative(null, now), '« il y a 2 min » : même phrase que l’app (' + ecarts.length + ' écarts)', diffDates.join(', ') || '')
}

// ------------------------------------------------------------------ API
async function verifierApi(cle) {
  console.log('\n1. Clé')
  const faux = await appel('etat', {}, 'pas-la-bonne-cle')
  verifie(faux.statut === 401 && faux.corps && /cl[ée]/i.test(faux.corps.erreur), 'clé fausse → 401 lisible', faux.statut + ' ' + JSON.stringify(faux.corps))
  const sans = await appel('etat', {}, '')
  verifie(sans.statut === 401, 'sans clé → 401', String(sans.statut))

  console.log('\n2. etat')
  const e = await appel('etat', {}, cle)
  verifie(e.statut === 200, 'etat → 200', String(e.statut))
  const d = e.corps || {}
  verifie(d.projet && typeof d.projet.slug === 'string' && typeof d.projet.nom === 'string' && 'couleur' in d.projet, 'projet {slug, nom, couleur}')
  verifie(Array.isArray(d.chantiers) && Array.isArray(d.activite), 'chantiers[] et activite[]')
  const c0 = (d.chantiers || [])[0]
  verifie(c0 && Array.isArray(c0.messages) && Array.isArray(c0.activite) && 'etat' in c0 && 'titre' in c0, 'chaque chantier porte messages[], activite[], etat, titre')
  verifie((d.chantiers || []).every((c) => 'comment_verifier' in c), 'chaque chantier porte comment_verifier (même vide)')
  const fuites = [...clesProfondes(d)].filter((k) => CHAMPS_INTERDITS.includes(k))
  verifie(fuites.length === 0, 'aucun champ interne dans etat', fuites.join(', ') || 'rien ne fuit')
  const internes = sql("select count(*)::int as n from chantiers c join projets p on p.id = c.projet_id where p.cle_embed = '" + lit(cle) + "' and c.visible_utilisateurs = false")[0].n
  const idsVus = new Set((d.chantiers || []).map((c) => c.id))
  const caches = sql("select c.id from chantiers c join projets p on p.id = c.projet_id where p.cle_embed = '" + lit(cle) + "' and c.visible_utilisateurs = false")
  verifie(caches.every((c) => !idsVus.has(c.id)), 'les chantiers internes (visible_utilisateurs=false) ne sortent pas', internes + ' interne(s) en base')

  console.log('\n3. Cycle d’une demande de test')
  let chantierId = null
  try {
    const vide = await appel('creer', { titre: '   ', demande: 'x' }, cle)
    verifie(vide.statut === 400 && /titre/i.test(vide.corps.erreur), 'creer sans titre → 400 lisible', vide.corps && vide.corps.erreur)

    const cr = await appel('creer', { titre: MARQUE + ' demande', demande: 'Première version de la demande.' }, cle)
    verifie(cr.statut === 200 && cr.corps.chantier && cr.corps.chantier.etat === 'a_trier' && cr.corps.chantier.origine === 'utilisateur', 'creer → chantier a_trier / utilisateur', cr.statut + ' ' + (cr.corps.erreur || ''))
    chantierId = cr.corps.chantier.id
    const fuiteCr = [...clesProfondes(cr.corps)].filter((k) => CHAMPS_INTERDITS.includes(k))
    verifie(fuiteCr.length === 0, 'creer ne renvoie aucun champ interne', fuiteCr.join(', '))

    const mod = await appel('modifier', { chantier_id: chantierId, titre: MARQUE + ' demande (modifiée)', demande: 'Deuxième version.' }, cle)
    verifie(mod.statut === 200 && mod.corps.chantier.titre.endsWith('(modifiée)'), 'modifier autorisé tant que a_trier', String(mod.statut))

    // Une question posée « par une session », par SQL, avec options.
    // exec_sql ne rend pas les lignes d'un `insert … returning` : l'id est
    // tiré ici et écrit avec la ligne.
    const q = randomUUID()
    sql("insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options) select '" + q + "', projet_id, id, 'session-test', 'session', 'question', 'Quelle couleur ?', 'Pour le test.', '[{\"libelle\":\"Rouge\",\"recommande\":true},{\"libelle\":\"Bleu\"},{\"libelle\":\"Autre, à préciser\"}]'::jsonb from chantiers where id = '" + chantierId + "'")
    const etatAvecQ = await appel('etat', {}, cle)
    const cQ = etatAvecQ.corps.chantiers.find((c) => c.id === chantierId)
    verifie(cQ && cQ.messages.some((m) => m.id === q && m.kind === 'question' && Array.isArray(m.options) && m.options.length === 3), 'etat expose la question et ses options')

    const repVide = await appel('repondre', { message_id: q }, cle)
    verifie(repVide.statut === 400, 'repondre sans réponse → 400', repVide.corps && repVide.corps.erreur)
    const rep = await appel('repondre', { message_id: q, reponse: 'Rouge', precision: 'plutôt bordeaux' }, cle)
    verifie(rep.statut === 200, 'repondre → 200', rep.statut + ' ' + (rep.corps.erreur || ''))
    const ligneQ = sql("select reponse, precision, answered_at from messages where id = '" + q + "'")[0]
    verifie(ligneQ.reponse === 'Rouge' && ligneQ.precision === 'plutôt bordeaux' && ligneQ.answered_at, 'la réponse et la précision sont en base, answered_at posé')

    const fant = await appel('repondre', { message_id: '00000000-0000-4000-8000-000000000000', reponse: 'x' }, cle)
    verifie(fant.statut === 404, 'repondre sur une question inexistante → 404', String(fant.statut))
    const fantC = await appel('certifier', { chantier_id: '00000000-0000-4000-8000-000000000000' }, cle)
    verifie(fantC.statut === 404, 'certifier une demande inexistante → 404', String(fantC.statut))

    const certTrop = await appel('certifier', { chantier_id: chantierId }, cle)
    verifie(certTrop.statut === 409 && /v[ée]rifier/i.test(certTrop.corps.erreur), 'certifier refusé tant que pas a_verifier (409 lisible)', certTrop.statut + ' ' + (certTrop.corps && certTrop.corps.erreur))
    const corrTrop = await appel('corriger', { chantier_id: chantierId, mots: 'trop tôt' }, cle)
    verifie(corrTrop.statut === 409, 'corriger refusé tant que pas a_verifier/valide (409)', corrTrop.corps && corrTrop.corps.erreur)

    const CV_API = '1. Ouvre la liste. 2. Touche « Trier ». 3. Le plus récent est en haut.'
    sql("update chantiers set etat = 'a_verifier', comment_verifier = '" + lit(CV_API) + "' where id = '" + chantierId + "'")
    const etatCv = await appel('etat', {}, cle)
    const cCv = etatCv.corps.chantiers.find((c) => c.id === chantierId)
    verifie(cCv && cCv.comment_verifier === CV_API, 'etat renvoie comment_verifier tel qu’écrit par la session', cCv && JSON.stringify(cCv.comment_verifier))
    const cert = await appel('certifier', { chantier_id: chantierId, mots: 'nickel' }, cle)
    verifie(cert.statut === 200, 'certifier → 200', cert.statut + ' ' + (cert.corps.erreur || ''))
    const apresCert = sql("select etat, archived_at, valide_par from chantiers where id = '" + chantierId + "'")[0]
    verifie(apresCert.etat === 'valide' && apresCert.archived_at && apresCert.valide_par === 'verifier-embed', 'chantier valide, archivé, valide_par = auteur', JSON.stringify(apresCert))
    const etatValide = await appel('etat', {}, cle)
    verifie(etatValide.corps.chantiers.some((c) => c.id === chantierId && c.etat === 'valide'), 'un chantier validé (archivé) reste dans etat : c’est un « actif »')

    const corrVide = await appel('corriger', { chantier_id: chantierId, mots: '  ' }, cle)
    verifie(corrVide.statut === 400, 'corriger sans mots → 400', corrVide.corps && corrVide.corps.erreur)
    const corr = await appel('corriger', { chantier_id: chantierId, mots: 'le bouton reste gris' }, cle)
    verifie(corr.statut === 200, 'corriger → 200', corr.statut + ' ' + (corr.corps.erreur || ''))
    const apresCorr = sql("select etat, archived_at, demande from chantiers where id = '" + chantierId + "'")[0]
    verifie(apresCorr.etat === 'libre' && !apresCorr.archived_at && /Correction du .*le bouton reste gris/s.test(apresCorr.demande), 'corriger : etat libre, désarchivé, correction ajoutée à la MÊME demande', apresCorr.etat)

    const msg = await appel('message', { chantier_id: chantierId, corps: 'Un exemple : la page /export.' }, cle)
    verifie(msg.statut === 200 && msg.corps.message && msg.corps.message.kind === 'info' && msg.corps.message.auteur_type === 'utilisateur', 'message → info / utilisateur', String(msg.statut))

    const modTard = await appel('modifier', { chantier_id: chantierId, titre: 'x', demande: 'y' }, cle)
    verifie(modTard.statut === 409 && /session/i.test(modTard.corps.erreur), 'modifier refusé une fois la demande prise (409 lisible)', modTard.corps && modTard.corps.erreur)

    const final = await appel('etat', {}, cle)
    const cF = final.corps.chantiers.find((c) => c.id === chantierId)
    verifie(cF && cF.messages.filter((m) => m.kind === 'constat').length === 2 && cF.messages.some((m) => m.kind === 'info' && m.auteur === 'verifier-embed'), 'le fil porte les deux constats et le message')
  } finally {
    if (chantierId) nettoyer(chantierId)
  }
}

function nettoyer(id) {
  sql("delete from ce_qui_marche where chantier_id = '" + id + "'")
  sql("delete from chantiers where id = '" + id + "'")
  sql("delete from historique where chantier_id = '" + id + "'")
  sql("delete from supprimes where chantier_id = '" + id + "'")
  console.log('  (chantier de test ' + id + ' supprimé, traces comprises)')
}

// ----------------------------------------------------------- navigateur
// Le jeu de test du navigateur : une demande avec une question à options et
// une activité en cours, une demande « à vérifier ». Toujours ciblées par
// leur id (data-chantier) — JAMAIS « la première carte orange » : le
// 28 sept. 2026 une passe visuelle a envoyé une fausse correction sur un
// vrai chantier du projet pilote de cette façon (restauré à la main).
const CV_NAV = "1. Ouvre la liste des clients https://exemple.fr/clients. 2. Touche l'en-tête « Date ». 3. Le client contacté le plus récemment est en haut."
function creerJeuNavigateur() {
  const idQ = randomUUID(), idV = randomUUID(), idV2 = randomUUID(), qid = randomUUID(), idP = randomUUID()
  const pj = "(select id from projets where slug = '" + SLUG + "')"
  sql("insert into chantiers (id, projet_id, titre, demande, etat, origine) values ('" + idQ + "', " + pj + ", '" + lit(MARQUE) + " export PDF', 'Quand je clique sur Exporter, rien ne se passe.', 'en_cours', 'utilisateur')")
  sql("insert into chantiers (id, projet_id, titre, demande, etat, origine, resume_simple) values ('" + idV + "', " + pj + ", '" + lit(MARQUE) + " tri des clients', 'Trier les clients par date.', 'a_verifier', 'utilisateur', 'La liste se trie par date de dernier contact.')")
  sql("update chantiers set comment_verifier = '" + lit(CV_NAV) + "' where id = '" + idV + "'")
  sql("insert into chantiers (id, projet_id, titre, demande, etat, origine) values ('" + idV2 + "', " + pj + ", '" + lit(MARQUE) + " export CSV', 'Exporter en CSV.', 'a_verifier', 'utilisateur')")
  sql("insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, pourquoi, options) values ('" + qid + "', " + pj + ", '" + idQ + "', 'session-test', 'session', 'question', 'Une page par facture, ou tout à la suite ?', 'Le rendu diffère.', '[{\"libelle\":\"Une page par facture\",\"aide\":\"Plus lisible.\",\"recommande\":true},{\"libelle\":\"Tout à la suite\"},{\"libelle\":\"Autre, à préciser\"}]'::jsonb)")
  // La carte « présence », sans question : signalée AVANT celle de idQ pour
  // que le bandeau « Là, maintenant » reste sur idQ (la plus récente).
  sql("insert into chantiers (id, projet_id, titre, demande, etat, origine) values ('" + idP + "', " + pj + ", '" + lit(MARQUE) + " présence', 'Trier par date.', 'en_cours', 'utilisateur')")
  sql("select signaler_activite('" + SLUG + "', '" + idP + "'::uuid, 'session-test', 'Test présence : tri par date', 40, 600, 'en_cours', null)")
  sql("select signaler_activite('" + SLUG + "', '" + idQ + "'::uuid, 'session-test', 'Test du correctif sur 30 factures', 62, 540, 'en_cours', 'lot 3/5')")
  return { idQ, idV, idV2, qid, idP }
}

async function verifierNavigateur(cle) {
  console.log('\n4. Navigateur (390 × 844)')
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  let pw
  try {
    pw = await import('playwright')
  } catch {
    const global = '/opt/node22/lib/node_modules/playwright/index.mjs'
    if (!existsSync(global)) { ko('Playwright introuvable (ni local, ni ' + global + ')'); return }
    pw = await import(pathToFileURL(global).href)
  }
  const port = await portLibre()
  // La page de démo, servie avec la clé du PROJET DE TEST (jamais celle d'un vrai projet).
  const site = mkdtempSync(path.join(tmpdir(), 'embed-demo-'))
  copyFileSync(path.join(RACINE, 'embed/cockpit-embed.js'), path.join(site, 'cockpit-embed.js'))
  const demo = readFileSync(path.join(RACINE, 'embed/demo.html'), 'utf8')
  const demoTest = demo.replace(/data-cle="[^"]*"/, 'data-cle="' + cle + '"')
  verifie(demoTest !== demo && demoTest.includes('data-cle="' + cle + '"'), 'la page de démo parle au projet de test ' + SLUG + ', pas à un vrai projet')
  writeFileSync(path.join(site, 'demo.html'), demoTest)
  const serveur = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: site, stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 700))
  mkdirSync(SCRATCH, { recursive: true })
  let navigateur, chantierCree = null
  const jeu = creerJeuNavigateur()
  try {
    // Le Chromium COMPLET, pas le « headless shell » par défaut : seul le
    // premier lit la base NSS (~/.pki/nssdb) où vit l'autorité du proxy de
    // l'environnement. Sans ça : ERR_CERT_AUTHORITY_INVALID sur la fonction.
    // Si la base est vide (constaté le 28 sept. 2026) :
    //   certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n ccr-agent-proxy -i /root/.ccr/agent-proxy-ca.crt
    navigateur = await pw.chromium.launch({ channel: 'chromium' })
    // Et même ainsi, constaté le 29 sept. : ce Chromium refuse le proxy
    // (ERR_CERT_AUTHORITY_INVALID). Les requêtes https passent donc par Node,
    // qui vérifie le certificat — comme verifier-web.mjs ; jamais
    // `ignoreHTTPSErrors`.
    const nouvellePage = async (opts) => {
      const ctx = await navigateur.newContext(opts)
      await ctx.route(/^https:\/\//, async (route) => {
        const r = route.request()
        try {
          const res = await fetch(r.url(), { method: r.method(), headers: r.headers(), body: r.postDataBuffer() ?? undefined })
          const headers = Object.fromEntries(res.headers)
          delete headers['content-encoding']; delete headers['content-length']
          await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) })
        } catch { await route.abort('failed') }
      })
      return ctx.newPage()
    }
    const page = await nouvellePage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    const erreursJs = []
    page.on('pageerror', (e) => erreursJs.push(e.message))
    await page.goto('http://127.0.0.1:' + port + '/demo.html')
    const hote = page.locator('.cockpit-embed')
    await hote.waitFor()
    await page.waitForFunction(() => {
      const r = document.querySelector('.cockpit-embed').shadowRoot
      return r && r.querySelector('.carte, .vide')
    }, null, { timeout: 20000 })
    const nbCartes = await page.evaluate(() => document.querySelector('.cockpit-embed').shadowRoot.querySelectorAll('.carte').length)
    verifie(nbCartes > 0, 'des cartes s’affichent', nbCartes + ' carte(s)')
    verifie(erreursJs.length === 0, 'aucune erreur JS', erreursJs.join(' | '))

    const style = await page.evaluate(() => {
      const r = document.querySelector('.cockpit-embed').shadowRoot
      const t = r.querySelector('.carte .titre')
      const cs = getComputedStyle(t)
      const hoteCs = getComputedStyle(document.querySelector('h1'))
      return { couleur: cs.color, transform: cs.textTransform, espacement: cs.letterSpacing, taille: cs.fontSize, police: cs.fontFamily, hoteCouleur: hoteCs.color }
    })
    verifie(style.hoteCouleur === 'rgb(255, 0, 0)', 'la page hôte est bien rouge (le test a un sens)', style.hoteCouleur)
    verifie(style.couleur !== 'rgb(255, 0, 0)' && style.transform === 'none' && style.espacement === 'normal' && style.taille !== '22px', 'le style hôte ne traverse pas (couleur, capitales, espacement, taille)', JSON.stringify(style))
    verifie(/Georgia|serif/i.test(style.police), 'la police, elle, est héritée', style.police)

    await page.screenshot({ path: path.join(SCRATCH, 'embed-1-liste.png'), fullPage: true })

    // Nouvelle demande depuis l'écran.
    const titre = MARQUE + ' depuis le navigateur'
    await page.evaluate(() => { const r = document.querySelector('.cockpit-embed').shadowRoot; r.querySelector('.btn').click() })
    const champ = page.locator('.cockpit-embed').locator('[data-focus="nouveau-titre"]')
    await champ.fill(titre)
    await page.locator('.cockpit-embed').locator('[data-focus="nouveau-demande"]').fill('Créée par verifier-embed.mjs, à supprimer.')
    await page.screenshot({ path: path.join(SCRATCH, 'embed-2-formulaire.png'), fullPage: true })
    // Playwright fait défiler AVANT de cliquer : pour mesurer notre rendu et
    // pas ce défilement-là, on met le bouton en vue nous-mêmes, on note la
    // position, puis on clique par le DOM.
    await page.evaluate(() => { const r = document.querySelector('.cockpit-embed').shadowRoot; [...r.querySelectorAll('.btn')].find((b) => /Ajouter la demande/.test(b.textContent)).scrollIntoView({ block: 'center' }) })
    const yAvant = await page.evaluate(() => window.scrollY)
    await page.evaluate(() => { const r = document.querySelector('.cockpit-embed').shadowRoot; [...r.querySelectorAll('.btn')].find((b) => /Ajouter la demande/.test(b.textContent)).click() })
    await page.waitForFunction((t) => {
      const r = document.querySelector('.cockpit-embed').shadowRoot
      return [...r.querySelectorAll('.carte .titre')].some((el) => el.textContent === t)
    }, titre, { timeout: 20000 })
    ok('une nouvelle demande créée à l’écran apparaît dans la liste')
    const yApres = await page.evaluate(() => window.scrollY)
    verifie(Math.abs(yApres - yAvant) <= 2, 'la position de défilement n’a pas sauté', yAvant + ' → ' + yApres)
    const retour = await page.evaluate(() => { const r = document.querySelector('.cockpit-embed').shadowRoot; const e = r.querySelector('.retour'); return e ? e.textContent : '' })
    verifie(/Enregistré/.test(retour), '« Enregistré ✓ » affiché', retour)
    chantierCree = sql("select id from chantiers where titre = '" + lit(titre) + "'")[0]
    chantierCree = chantierCree && chantierCree.id
    verifie(!!chantierCree, 'la demande est en base avec origine utilisateur')
    const badge = await page.evaluate((t) => {
      const r = document.querySelector('.cockpit-embed').shadowRoot
      const carte = [...r.querySelectorAll('.carte')].find((c) => c.querySelector('.titre').textContent === t)
      return carte ? carte.querySelector('.badge').textContent : ''
    }, titre)
    verifie(/Pas encore examinée/.test(badge), 'la nouvelle carte porte « Pas encore examinée »', badge)
    await page.screenshot({ path: path.join(SCRATCH, 'embed-3-apres-creation.png'), fullPage: true })

    const largeur = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    verifie(largeur.scroll <= largeur.client, 'aucun défilement horizontal', JSON.stringify(largeur))

    // Le badge d'état en lecture seule : aucun contrôle ne permet de le changer.
    const selects = await page.evaluate(() => document.querySelector('.cockpit-embed').shadowRoot.querySelectorAll('select').length)
    verifie(selects === 0, 'aucun sélecteur d’état (statut en lecture seule)')
    const nulls = await page.evaluate(() => /(^|>)null(<|$)/.test(document.querySelector('.cockpit-embed').shadowRoot.querySelector('.ck').innerHTML))
    verifie(!nulls, 'aucun « null » affiché par erreur')

    // --- la carte avec une question (ciblée par son id)
    const carteQ = page.locator('.cockpit-embed').locator('[data-chantier="' + jeu.idQ + '"]')
    const infosQ = await carteQ.evaluate((c) => ({
      badge: c.querySelector('.badge').textContent, rouge: c.classList.contains('rouge'),
      barre: !!c.querySelector('.barre'), legende: (c.querySelector('.barre-legende') || {}).textContent || '',
      options: [...c.querySelectorAll('.bloc.rouge .btn')].map((b) => b.textContent),
    }))
    verifie(/Réponse attendue/.test(infosQ.badge) && infosQ.rouge, 'une question en attente remplace le badge par « Réponse attendue »', infosQ.badge)
    verifie(infosQ.barre && /62 %/.test(infosQ.legende) && /9 min/.test(infosQ.legende), 'barre de progression 62 % + ETA ~9 min sur la carte', infosQ.legende)
    verifie(infosQ.options.length === 3 && /★/.test(infosQ.options[0]), 'trois options, la recommandée marquée ★', infosQ.options.join(' | '))
    const bandeau = await page.evaluate(() => { const r = document.querySelector('.cockpit-embed').shadowRoot; return (r.querySelector('.bandeau.now') || {}).textContent || '' })
    verifie(/Là, maintenant/.test(bandeau) && /Test du correctif/.test(bandeau), 'bandeau « Là, maintenant » avec l’étape en cours', bandeau.slice(0, 80))
    const rougeBandeau = await page.evaluate(() => { const r = document.querySelector('.cockpit-embed').shadowRoot; return (r.querySelector('.bandeau.rouge') || {}).textContent || '' })
    verifie(/question/.test(rougeBandeau), 'bandeau rouge « N question(s) en attente »', rougeBandeau)

    // « Autre, à préciser » n'envoie pas : il place le curseur dans le champ.
    await carteQ.evaluate((c) => [...c.querySelectorAll('.bloc.rouge .btn')].find((b) => /préciser/.test(b.textContent)).click())
    await page.waitForTimeout(150)
    const focusQ = await page.evaluate(() => { const r = document.querySelector('.cockpit-embed').shadowRoot; return r.activeElement && r.activeElement.getAttribute('data-focus') })
    verifie(focusQ === 'precision-' + jeu.qid, '« à préciser » place le curseur dans le champ Précision au lieu d’envoyer', String(focusQ))
    const enBase0 = sql("select answered_at from messages where id = '" + jeu.qid + "'")[0]
    verifie(!enBase0.answered_at, 'rien n’est parti en base au clic sur « à préciser »')
    await carteQ.locator('[data-focus="precision-' + jeu.qid + '"]').fill('Une page, mais en paysage')
    await page.screenshot({ path: path.join(SCRATCH, 'embed-4-question.png'), fullPage: true })
    await carteQ.evaluate((c) => c.querySelector('.bloc.rouge').scrollIntoView({ block: 'center' }))
    const yQ0 = await page.evaluate(() => window.scrollY)
    await carteQ.evaluate((c) => [...c.querySelectorAll('.btn')].find((b) => /Valider cette réponse/.test(b.textContent)).click())
    await page.waitForFunction((id) => { const r = document.querySelector('.cockpit-embed').shadowRoot; const c = r.querySelector('[data-chantier="' + id + '"]'); return c && !c.querySelector('.bloc.rouge') }, jeu.idQ, { timeout: 20000 })
    const yQ1 = await page.evaluate(() => window.scrollY)
    verifie(Math.abs(yQ1 - yQ0) <= 2, 'répondre ne fait pas sauter la page', yQ0 + ' → ' + yQ1)
    const enBase1 = sql("select reponse, precision from messages where id = '" + jeu.qid + "'")[0]
    verifie(enBase1.reponse === 'Autre, à préciser' && enBase1.precision === 'Une page, mais en paysage', 'la réponse et la précision tapées à l’écran sont en base', JSON.stringify(enBase1))
    await carteQ.evaluate((c) => c.querySelector('.discret[aria-expanded]').click())
    const hist = await carteQ.evaluate((c) => (c.querySelector('.hist') || {}).textContent || '')
    verifie(/Réponse : Autre, à préciser/.test(hist) && /Précision : Une page/.test(hist), 'l’historique déplié montre la question répondue 🤖/🙋', hist.slice(0, 120))
    const badgeQ = await carteQ.evaluate((c) => c.querySelector('.badge').textContent)
    verifie(/En cours de codage/.test(badgeQ), 'une fois répondue, le badge redevient l’état réel', badgeQ)

    // --- la carte « à vérifier » : corriger, sur SA carte
    const carteV = page.locator('.cockpit-embed').locator('[data-chantier="' + jeu.idV + '"]')
    const infosV = await carteV.evaluate((c) => ({ orange: c.classList.contains('orange'), badge: c.querySelector('.badge').textContent, resume: (c.querySelector('.resume') || {}).textContent || '', boutons: [...c.querySelectorAll('.bloc.orange .btn')].map((b) => b.textContent) }))
    verifie(infosV.orange && /à vérifier/.test(infosV.badge) && /se trie/.test(infosV.resume) && infosV.boutons.length === 2, 'carte orange « à vérifier » avec résumé simple et deux boutons', JSON.stringify(infosV.boutons))
    // « 👉 Comment vérifier » en tête du bloc orange.
    const cv = await carteV.evaluate((c) => {
      const bloc = c.querySelector('.bloc.orange'), enc = bloc && bloc.querySelector('.cv[data-cv="etapes"]'), opt = bloc && bloc.querySelector('.options')
      const lis = enc ? [...enc.querySelectorAll('li[data-etape]')] : []
      const a = enc && enc.querySelector('a')
      return {
        present: !!enc, titre: enc ? enc.querySelector('.cv-titre').textContent : '',
        avantBoutons: !!(enc && opt && (enc.compareDocumentPosition(opt) & Node.DOCUMENT_POSITION_FOLLOWING) && enc.getBoundingClientRect().bottom <= opt.getBoundingClientRect().top),
        lignes: lis.map((l) => ({ y: Math.round(l.getBoundingClientRect().top), t: l.textContent })),
        lien: a ? { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') } : null,
      }
    })
    verifie(cv.present && /Comment vérifier/.test(cv.titre) && cv.avantBoutons, 'module : l’encadré « 👉 Comment vérifier » est en tête du bloc orange, avant les boutons', JSON.stringify({ present: cv.present, avant: cv.avantBoutons }))
    verifie(cv.lignes.length === 3 && cv.lignes.every((l, i) => i === 0 || l.y > cv.lignes[i - 1].y + 8) && /^1\.\s*Ouvre/.test(cv.lignes[0].t) && !/Touche/.test(cv.lignes[0].t),
      'module : les trois étapes (écrites sur une ligne) s’affichent sur trois lignes distinctes', JSON.stringify(cv.lignes))
    verifie(cv.lien && cv.lien.href === 'https://exemple.fr/clients' && cv.lien.target === '_blank' && /noopener/.test(cv.lien.rel || ''), 'module : le lien est cliquable (nouvel onglet, noopener), sans le point final', JSON.stringify(cv.lien))
    await carteV.evaluate((c) => c.scrollIntoView({ block: 'start' }))
    await page.screenshot({ path: path.join(SCRATCH, 'embed-comment-verifier.png'), fullPage: false })
    const carteV2 = page.locator('.cockpit-embed').locator('[data-chantier="' + jeu.idV2 + '"]')
    const vide = await carteV2.evaluate((c) => { const e = c.querySelector('.bloc.orange .cv[data-cv="vide"]'); return e ? e.textContent : '' })
    verifie(/pas encore dit comment vérifier : ajoute un message pour le lui demander/.test(vide), 'module : sans étapes, la phrase qui dit de les demander', vide)

    await carteV.evaluate((c) => [...c.querySelectorAll('.bloc.orange .btn')].find((b) => /corriger/.test(b.textContent)).click())
    await carteV.locator('[data-focus="mots-' + jeu.idV + '"]').fill('Le tri est inversé.')
    await page.screenshot({ path: path.join(SCRATCH, 'embed-5-correction.png'), fullPage: true })
    await carteV.evaluate((c) => [...c.querySelectorAll('.btn')].find((b) => /Envoyer la correction/.test(b.textContent)).click())
    await page.waitForFunction((id) => { const r = document.querySelector('.cockpit-embed').shadowRoot; const c = r.querySelector('[data-chantier="' + id + '"]'); return c && !c.querySelector('.bloc.orange') }, jeu.idV, { timeout: 20000 })
    const apresV = sql("select etat, demande from chantiers where id = '" + jeu.idV + "'")[0]
    verifie(apresV.etat === 'libre' && /Le tri est inversé/.test(apresV.demande), 'la correction tapée à l’écran a rendu la demande à la session', apresV.etat)
    const badgeV = await carteV.evaluate((c) => c.querySelector('.badge').textContent)
    verifie(/file d’attente|file d'attente/.test(badgeV), 'après correction le badge dit « En file d’attente »', badgeV)
    await page.screenshot({ path: path.join(SCRATCH, 'embed-6-apres-actions.png'), fullPage: true })

    // --- présence (29 sept. 2026) : « en cours » exige une preuve de vie.
    const lirePresence = (id) => page.evaluate((id) => {
      const r = document.querySelector('.cockpit-embed').shadowRoot
      const c = r.querySelector('[data-chantier="' + id + '"]')
      const p = c && c.querySelector('[data-presence]')
      const b = r.querySelector('.bandeau.now')
      return {
        existe: !!c, presence: p ? p.getAttribute('data-presence') : null, texte: p ? p.textContent : '',
        vive: !!(c && c.querySelector('.barre.vive')), grise: !!(c && c.querySelector('.barre.grise')),
        legende: c && c.querySelector('.barre-legende') ? c.querySelector('.barre-legende').textContent : '',
        badge: c ? c.querySelector('.badge').textContent : '', bandeau: b ? b.textContent : null,
      }
    }, id)
    const p1 = await lirePresence(jeu.idP)
    verifie(p1.presence === 'vivante' && /en cours, (à l’instant|il y a \d+ min)/.test(p1.texte) && p1.vive && !p1.grise,
      'présence : activité fraîche → « en cours, il y a … » et barre vive', JSON.stringify({ texte: p1.texte, vive: p1.vive, grise: p1.grise }))
    verifie(/En cours de codage/.test(p1.badge), 'présence : activité fraîche → badge « En cours de codage »', p1.badge)
    verifie(p1.bandeau !== null && /Là, maintenant/.test(p1.bandeau) && /en cours, /.test(p1.bandeau), 'présence : activité fraîche → bandeau « Là, maintenant … (en cours, …) »', (p1.bandeau || 'absent').slice(0, 120))

    // La MÊME activité, vieille de 2 h (la session s'est tue).
    sql("update activite set updated_at = now() - interval '2 hours' where chantier_id = '" + jeu.idP + "'")
    await page.goto('http://127.0.0.1:' + port + '/demo.html')
    await page.waitForFunction((id) => { const r = document.querySelector('.cockpit-embed').shadowRoot; return r && r.querySelector('[data-chantier="' + id + '"]') }, jeu.idP, { timeout: 20000 })
    const p2 = await lirePresence(jeu.idP)
    verifie(p2.presence === 'silencieuse' && /^dernier avancement connu : 40 % \(il y a 2 h\)$/.test(p2.texte) && p2.grise && !p2.vive && !/reste/.test(p2.legende),
      'présence : vieille de 2 h → ligne grise « dernier avancement connu : 40 % (il y a 2 h) », barre grise, sans « reste »', JSON.stringify({ texte: p2.texte, vive: p2.vive, grise: p2.grise }))
    verifie(/En file d['’]attente/.test(p2.badge) && !/En cours de codage/.test(p2.badge), 'présence : vieille de 2 h → badge « En file d’attente »', p2.badge)
    verifie(p2.bandeau === null || !/Test présence/.test(p2.bandeau), 'présence : vieille de 2 h → le bandeau ne la montre plus', (p2.bandeau || 'absent').slice(0, 120))
    await page.evaluate(({ id }) => { const r = document.querySelector('.cockpit-embed').shadowRoot; r.querySelector('[data-chantier="' + id + '"]').scrollIntoView({ block: 'start' }) }, { id: jeu.idP })
    await page.screenshot({ path: path.join(SCRATCH, 'embed-presence.png'), fullPage: false })

    // Plus AUCUNE activité fraîche du jeu : sans autre session vivante sur le
    // projet, aucun bandeau du tout.
    sql("update activite set updated_at = now() - interval '2 hours' where chantier_id = '" + jeu.idQ + "'")
    const autresVivantes = sql("select count(*)::int as n from activite a join projets p on p.id = a.projet_id where p.slug = '" + SLUG + "' and a.statut = 'en_cours' and a.updated_at > now() - interval '15 minutes'")[0].n
    await page.goto('http://127.0.0.1:' + port + '/demo.html')
    await page.waitForFunction((id) => { const r = document.querySelector('.cockpit-embed').shadowRoot; return r && r.querySelector('[data-chantier="' + id + '"]') }, jeu.idP, { timeout: 20000 })
    const p3 = await lirePresence(jeu.idQ)
    if (autresVivantes === 0) verifie(p3.bandeau === null, 'présence : aucune preuve de vie sur le projet → aucun bandeau « Là, maintenant »', p3.bandeau || 'absent')
    else verifie(p3.bandeau === null || !/Test du correctif|Test présence/.test(p3.bandeau), 'présence : le bandeau ne montre que la session vraiment vivante (' + autresVivantes + ' hors test)', (p3.bandeau || '').slice(0, 120))

    // Une session qui se tait perd son « en cours » SANS nouvelle donnée : on
    // coupe le rechargement (data-intervalle=3600) et on avance l'horloge de
    // la page de 16 min ; seul le recalcul des 30 s peut changer l'écran.
    sql("select signaler_activite('" + SLUG + "', '" + jeu.idP + "'::uuid, 'session-test', 'Test présence : tri par date', 40, 600, 'en_cours', null)")
    const horloge = await nouvellePage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    await horloge.route('**/demo.html', async (route) => {
      const rep = await route.fetch()
      await route.fulfill({ response: rep, body: (await rep.text()).replace('data-utilisateur="Démo"', 'data-utilisateur="Démo" data-intervalle="3600"') })
    })
    await horloge.clock.install()
    await horloge.goto('http://127.0.0.1:' + port + '/demo.html')
    await horloge.waitForFunction((id) => { const r = document.querySelector('.cockpit-embed').shadowRoot; const c = r && r.querySelector('[data-chantier="' + id + '"]'); return c && c.querySelector('[data-presence]') }, jeu.idP, { timeout: 20000 })
    const lireH = () => horloge.evaluate((id) => { const c = document.querySelector('.cockpit-embed').shadowRoot.querySelector('[data-chantier="' + id + '"]'); return { presence: c.querySelector('[data-presence]').getAttribute('data-presence'), badge: c.querySelector('.badge').textContent } }, jeu.idP)
    const h1 = await lireH()
    let appels = 0
    horloge.on('request', (r) => { if (r.url().startsWith(FONCTION)) appels++ })
    await horloge.clock.fastForward('16:00')
    await horloge.waitForTimeout(300)
    const h2 = await lireH()
    verifie(h1.presence === 'vivante' && h2.presence === 'silencieuse' && /file d['’]attente/.test(h2.badge) && appels === 0,
      'présence : 16 min de silence → « en cours » perdu par le recalcul des 30 s, sans appel serveur', JSON.stringify({ avant: h1, apres: h2, appels }))
    await horloge.close()

    // --- thème sombre : le module suit prefers-color-scheme.
    const sombre = await nouvellePage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' })
    await sombre.goto('http://127.0.0.1:' + port + '/demo.html')
    await sombre.waitForFunction(() => { const r = document.querySelector('.cockpit-embed').shadowRoot; return r && r.querySelector('.carte') }, null, { timeout: 20000 })
    const couleurSombre = await sombre.evaluate(() => getComputedStyle(document.querySelector('.cockpit-embed').shadowRoot.querySelector('.carte .titre')).color)
    verifie(couleurSombre === 'rgb(229, 231, 235)', 'thème sombre : texte clair', couleurSombre)
    await sombre.screenshot({ path: path.join(SCRATCH, 'embed-7-sombre.png'), fullPage: false })
    await sombre.close()
  } finally {
    if (navigateur) await navigateur.close()
    serveur.kill()
    rmSync(site, { recursive: true, force: true })
    if (chantierCree) nettoyer(chantierCree)
    nettoyer(jeu.idQ)
    nettoyer(jeu.idV)
    nettoyer(jeu.idV2)
    nettoyer(jeu.idP)
  }
}

// ----------------------------------------------------------------- main
// Le projet de test : sa clé, un chantier visible et un chantier INTERNE
// (visible_utilisateurs = false, avec des notes) pour que « etat » ait de quoi
// montrer ET de quoi cacher.
function creerProjetTest() {
  const id = randomUUID()
  const cle = (randomUUID() + randomUUID()).replace(/-/g, '')
  sql("insert into projets (id, slug, nom, couleur, actif, description, cle_embed) values ('" + id + "', '" + SLUG + "', 'Test module (s’efface seul)', '#64748B', true, 'Projet créé et supprimé par scripts/verifier-embed.mjs', '" + cle + "')")
  sql("insert into chantiers (projet_id, titre, demande, etat, origine) values ('" + id + "', '" + lit(MARQUE) + " visible', 'Un chantier que l’utilisateur voit.', 'libre', 'utilisateur')")
  sql("insert into chantiers (projet_id, titre, demande, etat, origine, visible_utilisateurs, notes) values ('" + id + "', '" + lit(MARQUE) + " interne', 'Travail interne.', 'libre', 'session', false, 'note interne')")
  return { id, cle }
}

console.log('Fonction : ' + FONCTION)
console.log('Projet de test : ' + SLUG)
let projetTest = null
try {
  await purgerPassesPrecedentes(sql, PREFIXE)
  await purgerMarquesDansLesVraisProjets(sql, '[TEST verifier-embed')
  projetTest = creerProjetTest()
  await verifierPresenceParite()
  await verifierApi(projetTest.cle)
  if (!process.env.SANS_NAVIGATEUR) await verifierNavigateur(projetTest.cle)
} catch (e) {
  ko('exception', e.stack || String(e))
} finally {
  try {
    if (projetTest) await purgerProjetsDeTest(sql, [projetTest.id], PREFIXE)
    const idP = projetTest ? projetTest.id : '00000000-0000-0000-0000-000000000000'
    const reste = sql("select (select count(*) from projets where slug = '" + SLUG + "')::int + (select count(*) from supprimes where projet_id = '" + idP + "')::int + (select count(*) from chantiers c join projets p on p.id = c.projet_id where c.titre like '" + lit(MARQUE) + "%' and p.slug not like 'test-%')::int as n")[0].n
    verifie(reste === 0, 'nettoyage : projet de test supprimé avec ses traces, rien dans un vrai projet', String(reste))
  } catch (e) { ko('nettoyage', e.message) }
}
console.log('\n' + reussis + ' réussi(s), ' + rates + ' raté(s).')
process.exit(rates ? 1 : 0)
