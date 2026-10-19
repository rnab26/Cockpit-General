// Statuer un chantier ou une carte : les compteurs et les listes bougent TOUT DE SUITE, et la balle change de camp
// (chantier fa297cc4, 19 oct. 2026). Raphaël : « lorsque je statue une tâche, qu'elle soit à lancer, à tester ou n'importe quoi,
// elle ne repart pas bien dans les compteurs […] pareil pour l'action à faire : elle reste statique ».
// Hors ligne, sur des tables en mémoire : seules les règles pures (lib/statuts.ts, entonnoir.ts, reponseCarte.ts) sont jouées.
import { verifie, bilan } from './_assert.ts'
import { tableauDeBord } from '../src/lib/tableauDeBord.ts'
import { pastillesProjet, aToi, demandesDe } from '../src/lib/entonnoir.ts'
import { ouJenSuis } from '../src/lib/ouJenSuis.ts'
import { apresAbandon, apresCertification, apresMiseDeCote, apresRelance, apresVerificationDemandee } from '../src/lib/statuts.ts'
import { reponseOptimiste, retourPrisEnCharge } from '../src/lib/reponseCarte.ts'
import type { Chantier, Message } from '../src/lib/types.ts'

const now = new Date('2026-10-19T09:00:00Z')
const SILENCE = 15 * 60_000
const il = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
const C = (id: string, etat: string, extra: Record<string, unknown> = {}) => ({
  id, projet_id: 'p', section_id: 'S', titre: id, etat, priorite: 'normale', archived_at: null, jalons: null,
  pris_par: null, pris_jusqu_a: null, valide_at: null, updated_at: il(60), created_at: il(600), ...extra,
}) as unknown as Chantier
const M = (id: string, chantier: string | null, kind: string, extra: Record<string, unknown> = {}) => ({
  id, projet_id: 'p', chantier_id: chantier, auteur: 's', auteur_type: 'session', kind, corps: `m ${id}`, pourquoi: null, options: null,
  reponse: null, precision: null, repond_a: null, etat: null, answered_at: null, answered_by: null, created_at: il(30), ...extra,
}) as unknown as Message

const tab = (chantiers: Chantier[], messages: Message[]) => tableauDeBord({ chantiers, messages, activites: [], sessions: [], taches: [] }, now, SILENCE, 'aujourdhui', ['p'], null)
const nombres = (t: ReturnType<typeof tab>) => t.tuiles
const sections = (chantiers: Chantier[], messages: Message[]) => {
  const t = tab(chantiers, messages)
  return ouJenSuis([{ id: 'S', projet_id: 'p', nom: 'S', position: 0 } as never], chantiers, messages, 'aujourdhui', now, { bouge: new Set(t.caAvance.map((l) => l.c.id)), dort: new Set([...t.pretALancer, ...t.sansSession].map((l) => l.c.id)) }).total
}

console.log('verifier-statuts')

// 1. « Ça marche » : le chantier quitte « à tester » et entre dans « fini », partout pareil.
{
  const livre = C('livre', 'a_verifier', { livre_at: il(20) })
  const avant = nombres(tab([livre], []))
  const cert = apresCertification(livre, 'raphael@x', now.toISOString())
  const apres = nombres(tab([cert], []))
  verifie('ça marche : « à tester » 1 → 0, « fini » 0 → 1', avant.aTester === 1 && avant.fini === 0 && apres.aTester === 0 && apres.fini === 1, { avant, apres })
  verifie('ça marche : archivé, libéré, certifié par lui (comme certifier_chantier)', cert.etat === 'valide' && !!cert.archived_at && cert.pris_par === null && cert.valide_par === 'raphael@x' && cert.valide_at === now.toISOString())
  verifie('ça marche : le curseur de lecture (updated_at) n’est pas touché', cert.updated_at === livre.updated_at)
  verifie('ça marche : sur un chantier qui n’est pas « à vérifier », rien ne bouge', apresCertification(C('x', 'libre'), 'r', now.toISOString()).etat === 'libre')
  const s = sections([cert], [])
  verifie('ça marche : le tableau par section dit pareil (fini 1, pour toi 0)', s.livre === 1 && s.pourToi === 0, s)
}

// 2. « Ça ne marche pas » / « Claude vérifie » : il quitte « à tester », Claude le juge (jamais perdu).
{
  const livre = C('livre', 'a_verifier')
  const v = apresVerificationDemandee(livre, now.toISOString())
  const apres = tab([v], [])
  verifie('vérification demandée : « à tester » 1 → 0, et il se retrouve dans « ça avance / en pause » (jamais perdu)',
    nombres(tab([livre], [])).aTester === 1 && apres.tuiles.aTester === 0 && apres.tuiles.caAvance + apres.tuiles.enPause === 1, apres.tuiles)
  verifie('vérification demandée : un chantier déjà archivé ne change pas', apresVerificationDemandee(C('a', 'a_verifier', { archived_at: il(1) }), now.toISOString()).verif_demandee_at == null)
}

// 3. Mettre de côté, relancer, abandonner.
{
  const prete = C('prete', 'libre')
  const avant = nombres(tab([prete], []))
  const cote = apresMiseDeCote(prete, null)
  const mid = nombres(tab([cote], []))
  const relance = apresRelance(cote)
  const fin = nombres(tab([relance], []))
  verifie('mettre de côté : « à lancer » 1 → 0, « de côté » 0 → 1', avant.enPause === 1 && avant.deCote === 0 && mid.enPause === 0 && mid.deCote === 1, { avant, mid })
  verifie('relancer : « de côté » 1 → 0, « à lancer » 0 → 1', fin.enPause === 1 && fin.deCote === 0, fin)
  const ab = apresAbandon(prete, now.toISOString())
  const t = nombres(tab([ab], []))
  verifie('abandonner : sort de tous les compteurs (archivé)', t.enPause === 0 && t.deCote === 0 && t.caAvance === 0 && t.pourToi === 0, t)
}

// 4. Une carte d'action : « Fait » la ferme ; « Ça bloque » (ou « Pas encore » + un mot) passe la balle à Claude ; Claude répond → elle revient.
{
  const ch = C('ch', 'en_cours', { pris_par: 'claude/x', pris_jusqu_a: new Date(now.getTime() + 3_600_000).toISOString() })
  const carte = M('act', 'ch', 'action', { created_at: il(30) })
  const pourToi = (c: Chantier[], m: Message[]) => demandesDe(aToi(c, m)).length
  const poser = (etat: 'fait' | 'pas_encore' | 'bloque', precision: string | null) => reponseOptimiste(carte, { reponse: etat, precision, etat, maintenant: il(10) })
  verifie('carte intacte : « pour toi » 1', pourToi([ch], [carte]) === 1)
  verifie('« Fait » : « pour toi » 1 → 0', pourToi([ch], [poser('fait', null)]) === 0)
  const bloque = poser('bloque', null)
  verifie('« Ça bloque » : la carte reste ouverte en base mais sort de « pour toi » (1 → 0) : c’est à Claude', !bloque.answered_at && pourToi([ch], [bloque]) === 0 && retourPrisEnCharge(bloque, [bloque]))
  const t = tab([C('ch', 'libre')], [bloque])
  verifie('« Ça bloque » : le chantier est alors dans « ça avance / en pause », avec « Claude va la reprendre » (comme après « Fait »)',
    t.tuiles.pourToi === 0 && [...t.caAvance, ...t.sansSession].some((l) => l.c.id === 'ch' && l.pourquoi === 'Ta réponse est reçue : Claude va la reprendre'), [...t.caAvance, ...t.sansSession].map((l) => [l.c.id, l.pourquoi]))
  verifie('« Ça bloque » : le tableau par section dit pareil (pour toi 0)', sections([C('ch', 'libre')], [bloque]).pourToi === 0)
  verifie('« Ça bloque » : la pastille de l’onglet dit pareil (0)', pastillesProjet([C('ch', 'libre')], [bloque], [], [], [], now, SILENCE, 'p').aToi === 0)
  verifie('« Pas encore » sans mot : c’est encore à lui, la carte reste dans « pour toi »', pourToi([ch], [poser('pas_encore', null)]) === 1)
  verifie('« Pas encore » + un mot : la balle passe à Claude (1 → 0)', pourToi([ch], [poser('pas_encore', 'je n’ai pas le compte')]) === 0)
  const reprend = M('r', 'ch', 'info', { corps: 'Claude reprend ta réponse « Ça bloque »', created_at: il(8) })
  verifie('« Claude reprend ta réponse » : toujours chez Claude (0)', pourToi([ch], [bloque, reprend]) === 0)
  const repond = M('rep', 'ch', 'info', { corps: 'J’ai regardé : voici ce qui bloque', created_at: il(5) })
  verifie('Claude a répondu dans le fil sans fermer la carte : elle revient dans « pour toi » (0 → 1)', pourToi([ch], [bloque, repond]) === 1 && !retourPrisEnCharge(bloque, [bloque, repond]))
  const sansChantier = reponseOptimiste(M('s', null, 'action'), { reponse: 'Ça bloque', etat: 'bloque', maintenant: il(10) })
  verifie('une carte sans chantier ne disparaît jamais d’un compteur (rien d’autre ne la montrerait)', pourToi([], [sansChantier]) === 1)
  const fini = C('ch', 'valide', { archived_at: il(5), valide_at: il(5) })
  verifie('un chantier certifié garde sa carte « Ça bloque » dans « pour toi » (0026 : certifier ne la ferme pas)', pourToi([fini], [bloque]) === 1)
}

bilan('verifier-statuts')
