#!/usr/bin/env node
/**
 * verifier-mcp.mjs — le serveur MCP `cockpit-mcp`, contre la fonction RÉELLEMENT
 * déployée, avec des requêtes JSON-RPC telles que les envoient Codex / ChatGPT.
 *
 *   node scripts/verifier-mcp.mjs
 *
 * Prouve : clé absente/fausse → 401 ; poignée de main (initialize, version
 * négociée, notification → 202, ping) ; GET → 405 ; tools/list (7 outils, schémas) ;
 * la clé passe par Authorization Bearer, x-cockpit-key, /cockpit-mcp/<clé> ou
 * ?cle= ; le cycle créer → message → modifier → répondre ; une erreur métier est
 * un résultat d'outil en erreur (pas une erreur HTTP) ; aucun champ interne ne
 * sort ; un chantier d'un autre projet est introuvable ; un lot JSON-RPC.
 *
 * Il ne touche JAMAIS un vrai projet : projet jetable `test-mcp-<aléatoire>`
 * avec sa propre cle_embed, supprimé à la fin (scripts/bancs.mjs).
 * À RELANCER après toute modification de supabase/functions/cockpit-mcp/ ou cockpit-embed/.
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { purgerPassesPrecedentes, purgerProjetsDeTest } from './bancs.mjs'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.COCKPIT_MCP || 'https://bexiyvmdbxcwxasgslxp.supabase.co/functions/v1/cockpit-mcp'
const PREFIXE = 'test-mcp-'
const SLUG = PREFIXE + randomUUID().slice(0, 8)
const INTERDITS = ['notes', 'pris_par', 'pris_jusqu_a', 'reproduction', 'cle_embed', 'created_by', 'answered_by']

let reussis = 0, rates = 0
const verifie = (cond, nom, detail) => { (cond ? reussis++ : rates++); console.log(`  ${cond ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`) }
const lit = (s) => String(s).replace(/'/g, "''")

function sqlSync(requete) {
  const sortie = execFileSync(path.join(RACINE, 'scripts/sql.sh'), [requete], { encoding: 'utf8', cwd: RACINE })
  const j = JSON.parse(sortie)
  if (j.ok === false) throw new Error(j.error)
  return j.rows ?? []
}
const sqlAsync = async (r) => sqlSync(r)

async function rpc(corps, { cle, mode = 'bearer', methode = 'POST', entetes = {} } = {}) {
  let url = BASE
  const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...entetes }
  if (cle && mode === 'bearer') h.authorization = 'Bearer ' + cle
  if (cle && mode === 'x-key') h['x-cockpit-key'] = cle
  if (cle && mode === 'chemin') url += '/' + cle
  if (cle && mode === 'query') url += '?cle=' + cle
  const r = await fetch(url, { method: methode, headers: h, body: methode === 'POST' ? JSON.stringify(corps) : undefined })
  const texte = await r.text()
  let json = null
  try { json = texte ? JSON.parse(texte) : null } catch { /* pas du JSON */ }
  return { statut: r.status, json, texte, type: r.headers.get('content-type') || '' }
}
const appel = (id, name, args, opts) => rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, opts)
const struct = (r) => r.json?.result?.structuredContent

async function main() {
  console.log('Serveur : ' + BASE)
  await purgerPassesPrecedentes(sqlAsync, PREFIXE)
  const id = randomUUID(), autre = randomUUID()
  const cle = (randomUUID() + randomUUID()).replace(/-/g, '')
  const cleAutre = (randomUUID() + randomUUID()).replace(/-/g, '')
  sqlSync(`insert into projets (id, slug, nom, couleur, actif, description, cle_embed) values ('${id}', '${SLUG}', 'Test MCP (s’efface seul)', '#64748B', true, 'Créé et supprimé par scripts/verifier-mcp.mjs', '${cle}')`)
  sqlSync(`insert into projets (id, slug, nom, couleur, actif, description, cle_embed) values ('${autre}', '${SLUG}-b', 'Test MCP autre', '#64748B', true, 'Créé et supprimé par scripts/verifier-mcp.mjs', '${cleAutre}')`)
  sqlSync(`insert into chantiers (projet_id, titre, demande, etat, origine, visible_utilisateurs, notes) values ('${id}', '[TEST mcp] interne', 'x', 'libre', 'session', false, 'note interne')`)
  const chantierAutre = randomUUID()
  sqlSync(`insert into chantiers (id, projet_id, titre, etat, origine) values ('${chantierAutre}', '${autre}', '[TEST mcp] autre projet', 'libre', 'utilisateur')`)

  try {
    console.log('1. Clé')
    let r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    verifie(r.statut === 401 && r.json?.error, 'sans clé : 401 avec un message', r.json?.error?.message)
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { cle: 'fausse' })
    verifie(r.statut === 401, 'clé fausse : 401 dès initialize', r.json?.error?.message)

    console.log('2. Poignée de main')
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verif', version: '0' } } }, { cle })
    verifie(r.statut === 200 && r.type.includes('application/json') && r.json?.result?.protocolVersion === '2025-06-18', 'initialize : JSON, version 2025-06-18 négociée')
    verifie(!!r.json?.result?.capabilities?.tools && r.json.result.serverInfo?.name === 'cockpit', 'capacité « tools » et serverInfo')
    r = await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, { cle })
    verifie(r.json?.result?.protocolVersion === '2024-11-05', 'ancienne version 2024-11-05 acceptée telle quelle')
    r = await rpc({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2099-01-01' } }, { cle })
    verifie(r.json?.result?.protocolVersion === '2025-06-18', 'version inconnue : le serveur propose la sienne')
    r = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, { cle })
    verifie(r.statut === 202 && r.texte === '', 'notification : 202 sans corps')
    r = await rpc({ jsonrpc: '2.0', id: 4, method: 'ping' }, { cle })
    verifie(r.statut === 200 && r.json?.result && Object.keys(r.json.result).length === 0, 'ping : {}')
    r = await rpc(null, { cle, methode: 'GET' })
    verifie(r.statut === 405, 'GET : 405 (pas de flux serveur)')
    r = await rpc({ jsonrpc: '2.0', id: 5, method: 'ping' }, { cle, entetes: { 'mcp-protocol-version': '1999-01-01' } })
    verifie(r.statut === 400, 'en-tête de version inconnue : 400')
    r = await rpc({ jsonrpc: '2.0', id: 6, method: 'inconnue' }, { cle })
    verifie(r.json?.error?.code === -32601, 'méthode inconnue : erreur JSON-RPC -32601')

    console.log('3. Outils')
    r = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, { cle })
    const outils = r.json?.result?.tools ?? []
    const noms = outils.map((o) => o.name).sort()
    verifie(JSON.stringify(noms) === JSON.stringify(['cockpit_certifier', 'cockpit_corriger', 'cockpit_creer', 'cockpit_etat', 'cockpit_message', 'cockpit_modifier', 'cockpit_repondre']), '7 outils', noms.join(', '))
    verifie(outils.every((o) => o.inputSchema?.type === 'object' && o.description && !('action' in o)), 'chaque outil : schéma objet, description, pas de champ interne « action »')

    console.log('4. La clé passe par les quatre voies')
    for (const mode of ['bearer', 'x-key', 'chemin', 'query']) {
      r = await appel(10, 'cockpit_etat', {}, { cle, mode })
      verifie(r.statut === 200 && struct(r)?.projet?.slug === SLUG, `etat via ${mode}`)
    }
    r = await appel(11, 'cockpit_etat', {}, { cle: cleAutre })
    verifie(struct(r)?.projet?.slug === SLUG + '-b', 'une autre clé ouvre l’autre projet, pas celui-ci')

    console.log('5. Cycle de vie')
    r = await appel(20, 'cockpit_creer', { titre: '[TEST mcp] première demande', demande: 'Le détail.', auteur: 'Codex' }, { cle })
    const chantier = struct(r)?.chantier
    verifie(!!chantier?.id && chantier.origine === 'utilisateur' && chantier.etat === 'a_trier', 'créer', chantier?.id)
    r = await appel(21, 'cockpit_creer', { titre: '' }, { cle })
    verifie(r.statut === 200 && r.json.result.isError === true && /titre/i.test(r.json.result.content[0].text), 'titre vide : résultat d’outil en erreur, message lisible', r.json?.result?.content?.[0]?.text)
    r = await appel(22, 'cockpit_message', { chantier_id: chantier.id, corps: 'Un détail de plus.', auteur: 'Codex' }, { cle })
    verifie(struct(r)?.message?.corps === 'Un détail de plus.', 'message')
    r = await appel(23, 'cockpit_modifier', { chantier_id: chantier.id, titre: '[TEST mcp] titre modifié', demande: 'Nouveau détail.' }, { cle })
    verifie(struct(r)?.chantier?.titre === '[TEST mcp] titre modifié', 'modifier (encore permis)')
    r = await appel(24, 'cockpit_certifier', { chantier_id: chantier.id }, { cle })
    verifie(r.json?.result?.isError === true && /à vérifier/.test(r.json.result.content[0].text), 'certifier refusé tant que pas « à vérifier » (erreur lisible)', r.json?.result?.content?.[0]?.text)
    r = await appel(25, 'cockpit_corriger', { chantier_id: chantier.id, mots: '' }, { cle })
    verifie(r.json?.result?.isError === true, 'corriger sans mots refusé')

    const q = randomUUID()
    sqlSync(`insert into messages (id, projet_id, chantier_id, auteur, auteur_type, kind, corps, options) values ('${q}', '${id}', '${chantier.id}', 'agent/test', 'session', 'question', 'Quel choix ?', '[{"label":"A"},{"label":"B"}]'::jsonb)`)
    r = await appel(26, 'cockpit_etat', {}, { cle })
    const c = struct(r)?.chantiers?.find((x) => x.id === chantier.id)
    verifie(c?.messages?.some((m) => m.id === q && m.kind === 'question'), 'etat montre la question posée')
    r = await appel(27, 'cockpit_repondre', { message_id: q, reponse: 'A', auteur: 'Codex' }, { cle })
    verifie(struct(r)?.ok === true, 'répondre')
    const rep = sqlSync(`select reponse from messages where id = '${q}'`)[0]?.reponse
    verifie(rep === 'A', 'la réponse est bien en base', String(rep))

    sqlSync(`update chantiers set etat = 'a_verifier', livre_at = now() where id = '${chantier.id}'`)
    r = await appel(28, 'cockpit_corriger', { chantier_id: chantier.id, mots: 'Ça plante au clic.' }, { cle })
    verifie(struct(r)?.ok === true, 'corriger une fois « à vérifier »')
    sqlSync(`update chantiers set etat = 'a_verifier', livre_at = now() where id = '${chantier.id}'`)
    r = await appel(29, 'cockpit_certifier', { chantier_id: chantier.id, mots: 'Bon.' }, { cle })
    verifie(struct(r)?.ok === true, 'certifier une fois « à vérifier »')

    console.log('6. Isolation et confidentialité')
    r = await appel(30, 'cockpit_message', { chantier_id: chantierAutre, corps: 'intrus' }, { cle })
    verifie(r.json?.result?.isError === true, 'chantier d’un autre projet : introuvable')
    r = await appel(31, 'cockpit_etat', {}, { cle })
    const brut = r.texte
    verifie(!INTERDITS.some((k) => brut.includes(`"${k}"`)), 'etat ne contient aucun champ interne')
    verifie(!brut.includes('[TEST mcp] interne'), 'le chantier interne (non visible) ne sort pas')
    verifie(!brut.includes(cle), 'la clé n’est jamais renvoyée')
    r = await appel(32, 'outil_inconnu', {}, { cle })
    verifie(!!r.json?.error, 'outil inconnu : erreur JSON-RPC')

    console.log('7. Lot JSON-RPC')
    r = await rpc([{ jsonrpc: '2.0', id: 40, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 41, method: 'tools/list' }], { cle })
    verifie(Array.isArray(r.json) && r.json.length === 2, 'lot : 2 réponses (la notification n’en a pas)')
  } finally {
    await purgerProjetsDeTest(sqlAsync, [id, autre], PREFIXE)
    const reste = sqlSync(`select count(*)::int as n from projets where slug like '${PREFIXE}%' and id in ('${id}','${autre}')`)[0].n
    verifie(reste === 0, 'projets jetables supprimés')
  }
  console.log(`\n${reussis} réussis, ${rates} ratés`)
  process.exit(rates ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
