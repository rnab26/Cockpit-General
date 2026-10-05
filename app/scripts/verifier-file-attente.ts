// File d'attente des écritures hors ligne (lib/fileAttente.ts).
// node --experimental-strip-types app/scripts/verifier-file-attente.ts
import { verifie, bilan } from './_assert.ts'
import { aGarder, aMettreEnCache, avecIdentifiant, classerReponse, cibleDe, delaiReessai, estPanneServeur, phraseBandeau, reponseGardee, resumeDe } from '../src/lib/fileAttente.ts'

const B = 'https://x.supabase.co'
console.log('ce qu’on garde')
verifie('ajout dans messages', aGarder('POST', `${B}/rest/v1/messages`))
verifie('modification de chantier', aGarder('PATCH', `${B}/rest/v1/chantiers?id=eq.1`))
verifie('suppression', aGarder('DELETE', `${B}/rest/v1/chantiers?id=in.(1,2)`))
verifie('RPC d’écriture (repondre_message)', aGarder('POST', `${B}/rest/v1/rpc/repondre_message`))
verifie('RPC de lecture : non', !aGarder('POST', `${B}/rest/v1/rpc/etat_renforts`) && !aGarder('POST', `${B}/rest/v1/rpc/moi`) && !aGarder('POST', `${B}/rest/v1/rpc/prochain_passage_chef`))
verifie('RPC à secret (jeton) : jamais gardée', !aGarder('POST', `${B}/rest/v1/rpc/regler_reveil_immediat`))
verifie('abonnement push : non', !aGarder('POST', `${B}/rest/v1/push_abonnements`))
verifie('dépôt de fichier', aGarder('POST', `${B}/storage/v1/object/cockpit-medias/a/b.png`))
verifie('lecture : jamais gardée', !aGarder('GET', `${B}/rest/v1/messages`))
verifie('connexion (auth) : jamais gardée', !aGarder('POST', `${B}/auth/v1/token?grant_type=password`))
verifie('lecture de table mise en cache', aMettreEnCache('GET', `${B}/rest/v1/chantiers?select=*`) && !aMettreEnCache('POST', `${B}/rest/v1/chantiers`) && !aMettreEnCache('GET', `${B}/auth/v1/user`))
verifie('RPC de lecture (moi, etat_*) mise en cache, pas reveiller_reportes ni une écriture', aMettreEnCache('POST', `${B}/rest/v1/rpc/moi`) && aMettreEnCache('POST', `${B}/rest/v1/rpc/etat_renforts`) && !aMettreEnCache('POST', `${B}/rest/v1/rpc/reveiller_reportes`) && !aMettreEnCache('POST', `${B}/rest/v1/rpc/certifier_chantier`))
verifie('cible rpc', cibleDe(`${B}/rest/v1/rpc/abc?x=1`).nom === 'abc')

console.log('identifiant fixé avant le renvoi')
let n = 0
const gen = () => `id${++n}`
verifie('message sans id : id ajouté', JSON.parse(avecIdentifiant(`${B}/rest/v1/messages`, 'POST', '{"corps":"a"}', gen)!).id === 'id1')
verifie('id déjà là : inchangé', avecIdentifiant(`${B}/rest/v1/messages`, 'POST', '{"id":"z","corps":"a"}', gen) === '{"id":"z","corps":"a"}')
verifie('tableau : un id par ligne', JSON.parse(avecIdentifiant(`${B}/rest/v1/messages`, 'POST', '[{"a":1},{"a":2}]', gen)!).every((o: { id?: string }) => !!o.id))
verifie('autre table : inchangé', avecIdentifiant(`${B}/rest/v1/sections`, 'POST', '{"nom":"a"}', gen) === '{"nom":"a"}')
verifie('PATCH : inchangé', avecIdentifiant(`${B}/rest/v1/messages`, 'PATCH', '{"corps":"a"}', gen) === '{"corps":"a"}')
verifie('corps illisible : inchangé', avecIdentifiant(`${B}/rest/v1/messages`, 'POST', 'pas du json', gen) === 'pas du json')

console.log('réponses du serveur au renvoi')
verifie('200/201/204 : fait', classerReponse(200) === 'fait' && classerReponse(201) === 'fait' && classerReponse(204) === 'fait')
verifie('409 (déjà arrivé) : fait', classerReponse(409) === 'fait')
verifie('401, 429, 500, 503 : on réessaie', [401, 429, 500, 503].every((s) => classerReponse(s) === 'reessayer'))
verifie('400, 403, 404, 422 : refusé, gardé visible', [400, 403, 404, 422].every((s) => classerReponse(s) === 'refuse'))
verifie('502/503/504 en direct = panne ; 500 = vraie erreur', estPanneServeur(503) && !estPanneServeur(500))

console.log('réponse fabriquée')
verifie('rpc → null', reponseGardee('POST', `${B}/rest/v1/rpc/f`, '{}', '').corps === 'null')
verifie('insert minimal → 201 vide', reponseGardee('POST', `${B}/rest/v1/messages`, '{}', 'return=minimal').status === 201)
verifie('insert + representation → écho en tableau', reponseGardee('POST', `${B}/rest/v1/messages`, '{"a":1}', 'return=representation').corps === '[{"a":1}]')
verifie('patch → 204', reponseGardee('PATCH', `${B}/rest/v1/messages`, '{}', '').status === 204)

console.log('texte du bandeau')
verifie('rien à dire', phraseBandeau({ attente: 0, refuses: 0, horsLigne: false, envoi: false }) === null)
verifie('hors ligne seulement', phraseBandeau({ attente: 0, refuses: 0, horsLigne: true, envoi: false })?.texte.startsWith('Hors ligne') === true)
verifie('1 en attente (singulier)', /1 élément enregistré sur cet appareil/.test(phraseBandeau({ attente: 1, refuses: 0, horsLigne: false, envoi: false })!.texte))
verifie('3 en attente (pluriel)', /3 éléments enregistrés.*envoyés/.test(phraseBandeau({ attente: 3, refuses: 0, horsLigne: false, envoi: false })!.texte))
verifie('envoi en cours', /Envoi de 2 éléments/.test(phraseBandeau({ attente: 2, refuses: 0, horsLigne: false, envoi: true })!.texte))
verifie('refusé prime, niveau erreur', phraseBandeau({ attente: 2, refuses: 1, horsLigne: true, envoi: false })?.niveau === 'erreur')
verifie('résumé lisible', resumeDe('POST', `${B}/rest/v1/messages`) === 'Message dans un fil (ajout)' && resumeDe('POST', `${B}/rest/v1/rpc/certifier_chantier`).includes('certifier chantier'))
verifie('délai croissant plafonné', delaiReessai(1) === 30_000 && delaiReessai(2) === 60_000 && delaiReessai(20) === 15 * 60_000)
bilan('verifier-file-attente')
