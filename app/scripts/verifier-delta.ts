// Lecture incrémentale des données (chantier 9d83828c, « cockpit lent ») : règles pures de lib/deltaDonnees.ts.
// node --experimental-strip-types app/scripts/verifier-delta.ts
import { verifie, bilan } from './_assert.ts'
import { appliquer, curseurDelta, filtreDelta, lireEvenement, LotEvenements, ORDRES, pleinDu, PLEIN_TOUTES_MS, RECOUVREMENT_MS, LOT_ATTENTE_MAX_MS, type Horloge, type Lot } from '../src/lib/deltaDonnees.ts'

type M = { id: string; created_at: string; updated_at?: string; corps: string; chantier_id?: string | null }
const m = (id: string, t: string, corps = id): M => ({ id, created_at: t, updated_at: t, corps })

console.log('appliquer : poser / remplacer / retirer')
const base = [m('a', '2026-10-07T10:00:00Z'), m('b', '2026-10-07T10:01:00Z')]
const ord = ORDRES.messages as (a: M, b: M) => number
verifie('aucun changement : le MÊME tableau (aucun rendu pour rien)', appliquer(base, [], [], ord) === base)
verifie('une ligne identique : le même tableau', appliquer(base, [{ ...base[0] }], [], ord) === base)
const plus = appliquer(base, [m('c', '2026-10-07T10:02:00Z')], [], ord)
verifie('une nouvelle ligne s’ajoute à sa place (ordre chronologique)', plus.map((x) => x.id).join() === 'a,b,c' && base.length === 2)
verifie('une ligne modifiée est remplacée', appliquer(base, [{ ...base[0], corps: 'neuf' }], [], ord)[0].corps === 'neuf')
verifie('une suppression retire la ligne', appliquer(base, [], ['a'], ord).map((x) => x.id).join() === 'b')
verifie('retirer une ligne inconnue ne change rien', appliquer(base, [], ['zzz'], ord) === base)
const tri = appliquer(base, [m('z', '2026-10-07T09:00:00Z')], [], ord)
verifie('une ligne plus ancienne se range avant', tri[0].id === 'z')
verifie('colonne volumineuse absente d’un événement : on garde celle qu’on avait', appliquer(base, [{ id: 'a', created_at: base[0].created_at, updated_at: '2026-10-07T10:05:00Z' } as M], [], ord)[0].corps === 'a')
const ch = [{ id: '1', updated_at: '2026-10-07T10:00:00Z' }, { id: '2', updated_at: '2026-10-07T09:00:00Z' }]
verifie('chantiers : le plus récemment modifié passe en tête', appliquer(ch, [{ id: '2', updated_at: '2026-10-07T11:00:00Z' }], [], ORDRES.chantiers as never).map((x) => x.id).join() === '2,1')

console.log('curseur et filtre du delta')
verifie('table vide : pas de curseur (lecture complète)', curseurDelta('messages', []) === null)
verifie('sections : jamais de delta (petite table, lue en entier)', curseurDelta('sections', [{ id: 's' }]) === null)
const cur = curseurDelta('messages', [m('a', '2026-10-07T10:00:00.000Z'), { ...m('b', '2026-10-07T10:01:00.000Z'), updated_at: '2026-10-07T10:30:00.000Z' }])
verifie(`curseur = plus récente date connue − ${RECOUVREMENT_MS} ms (recouvrement)`, cur === '2026-10-07T10:29:58.000Z', cur)
verifie('tâches : la date la plus récente parmi vu_at / fini_at / progres_at', curseurDelta('taches', [{ id: 't', vu_at: '2026-10-07T10:00:00.000Z', fini_at: '2026-10-07T10:10:00.000Z' }]) === '2026-10-07T10:09:58.000Z')
verifie('filtre PostgREST des messages : created_at OU updated_at', filtreDelta('messages', 'X') === 'updated_at.gt.X,created_at.gt.X')
verifie('filtre des tâches : vu_at, fini_at, progres_at', filtreDelta('taches', 'X') === 'vu_at.gt.X,fini_at.gt.X,progres_at.gt.X')

console.log('relecture complète : seulement au premier passage et toutes les 5 minutes')
verifie('jamais lu : complet', pleinDu(null, 1000))
verifie('lu il y a 1 min : delta', !pleinDu(0, 60_000))
verifie('lu il y a 5 min : complet', pleinDu(0, PLEIN_TOUTES_MS))

console.log('événements du direct')
verifie('INSERT : une écriture', lireEvenement({ eventType: 'INSERT', new: { id: 'x', corps: 'c' } }).type === 'ecrire')
verifie('UPDATE : une écriture', lireEvenement({ eventType: 'UPDATE', new: { id: 'x' } }).type === 'ecrire')
verifie('DELETE avec identifiant : une suppression', lireEvenement({ eventType: 'DELETE', old: { id: 'x' } }).type === 'supprimer')
verifie('DELETE sans identifiant : à relire (jamais deviné)', lireEvenement({ eventType: 'DELETE', old: {} }).type === 'relire')
verifie('événement sans ligne : à relire', lireEvenement({ eventType: 'UPDATE' }).type === 'relire')

// Horloge simulée : aucune attente réelle.
function horloge() {
  let t = 1_000_000
  const files: { quand: number; f: () => void; id: number }[] = []
  let n = 0
  const h: Horloge = {
    now: () => t,
    setTimeout: (f, ms) => { const id = ++n; files.push({ quand: t + ms, f, id }); return id },
    clearTimeout: (id) => { const i = files.findIndex((x) => x.id === id); if (i >= 0) files.splice(i, 1) },
  }
  const avancer = (ms: number) => {
    const fin = t + ms
    for (;;) {
      files.sort((a, b) => a.quand - b.quand)
      const prochain = files[0]
      if (!prochain || prochain.quand > fin) break
      files.shift(); t = prochain.quand; prochain.f()
    }
    t = fin
  }
  return { h, avancer }
}

console.log('rafales : regroupées, jamais N relectures')
{
  const { h, avancer } = horloge()
  const lots: Lot[] = []
  const lot = new LotEvenements((l) => lots.push(l), 800, LOT_ATTENTE_MAX_MS, h)
  for (let i = 0; i < 20; i++) { lot.ajouter('messages', { eventType: 'INSERT', new: { id: `m${i}` } }); avancer(190) }   // 20 événements en 3,8 s
  avancer(1000)
  verifie('20 événements en ~4 s : UN seul passage d’application', lots.length === 1 && lot.passages === 1, lots.length)
  verifie('…qui porte les 20 lignes, sans aucune relecture demandée', lots[0].messages?.lignes.size === 20 && lots[0].messages?.arelire === false)
}
{
  const { h, avancer } = horloge()
  const lots: Lot[] = []
  const lot = new LotEvenements((l) => lots.push(l), 800, LOT_ATTENTE_MAX_MS, h)
  for (let i = 0; i < 50; i++) { lot.ajouter('taches', { eventType: 'UPDATE', new: { id: `t${i % 5}` } }); avancer(100) }   // 50 événements en 5 s
  avancer(1000)
  verifie('50 événements en 5 s : au plus 2 passages (l’écran n’attend jamais plus de 4 s)', lots.length <= 2 && lots.length >= 1, lots.length)
  verifie('la même ligne écrite dix fois ne compte qu’une fois', lots.reduce((s, l) => s + (l.taches?.lignes.size ?? 0), 0) <= 10)
}
{
  const { h, avancer } = horloge()
  const lots: Lot[] = []
  const lot = new LotEvenements((l) => lots.push(l), 800, LOT_ATTENTE_MAX_MS, h)
  lot.ajouter('chantiers', { eventType: 'INSERT', new: { id: 'c1' } })
  lot.ajouter('chantiers', { eventType: 'DELETE', old: { id: 'c1' } })
  lot.ajouter('chantiers', { eventType: 'UPDATE', new: { id: 'c2' } })
  lot.ajouter('chantiers', { eventType: 'DELETE', old: { id: 'c3' } })
  lot.ajouter('chantiers', { eventType: 'DELETE', old: { id: 'c2' } })
  lot.ajouter('chantiers', { eventType: 'INSERT', new: { id: 'c2' } })
  avancer(900)
  const t = lots[0]?.chantiers
  verifie('insert puis delete du même id : seule la suppression reste', !!t && !t.lignes.has('c1') && t.suppressions.has('c1'))
  verifie('delete puis réécriture du même id : la ligne gagne', !!t && t.lignes.has('c2') && !t.suppressions.has('c2'))
  verifie('suppression seule gardée', !!t && t.suppressions.has('c3'))
}
{
  const { h, avancer } = horloge()
  const lots: Lot[] = []
  const lot = new LotEvenements((l) => lots.push(l), 800, LOT_ATTENTE_MAX_MS, h)
  for (let i = 0; i < 20; i++) { lot.ajouter('messages', { eventType: 'UPDATE' }); avancer(190) }
  avancer(1000)
  verifie('20 événements SANS ligne en ~4 s : une seule relecture (delta) demandée', lots.length === 1 && lots[0].messages?.arelire === true)
}
{
  const { h, avancer } = horloge()
  const lots: Lot[] = []
  const lot = new LotEvenements((l) => lots.push(l), 800, LOT_ATTENTE_MAX_MS, h)
  lot.ajouter('messages', { eventType: 'INSERT', new: { id: 'a' } })
  avancer(500)
  verifie('avant le délai : rien n’est appliqué', lots.length === 0)
  avancer(400)
  verifie('800 ms après le dernier événement : appliqué', lots.length === 1)
  lot.ajouter('messages', { eventType: 'INSERT', new: { id: 'b' } })
  lot.vidange()
  verifie('vidange immédiate (retour sur l’appli)', lots.length === 2)
  lot.vidange()
  verifie('vidange à vide : aucun passage', lots.length === 2)
  lot.ajouter('messages', { eventType: 'INSERT', new: { id: 'c' } })
  lot.annuler(); avancer(5000)
  verifie('annuler (fermeture de l’écran) : plus rien ne part', lots.length === 2)
}

console.log('coût d’une rafale sur de vraies tailles (1 900 messages)')
{
  const gros = Array.from({ length: 1900 }, (_, i) => m(`m${String(i).padStart(5, '0')}`, new Date(1_790_000_000_000 + i * 60_000).toISOString(), 'x'.repeat(200)))
  const recus = Array.from({ length: 20 }, (_, i) => ({ ...gros[1800 + i], corps: 'modifié' }))
  const t0 = performance.now()
  let r = gros
  for (let k = 0; k < 20; k++) r = appliquer(r, recus, [], ord)
  const ms = (performance.now() - t0) / 20
  verifie(`appliquer 20 lignes sur 1 900 : ${ms.toFixed(2)} ms (< 15 ms)`, ms < 15, ms)
  verifie('les 1 880 autres lignes gardent leur objet (pas de copie profonde)', r[0] === gros[0] && r[1000] === gros[1000])
}

bilan('verifier-delta')
