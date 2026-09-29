// Règles communes des bancs de test (verifier-embed, verifier-web,
// verifier-base, verifier-reponses) — 29 sept. 2026, chantier 0b54f4f8.
//
// Raphaël : « J'ai des demandes de chantier que je ne comprends pas d'où
// elles sortent ([TEST verifier-embed …] tri des clients). » Cause : un banc
// écrivait dans le VRAI projet `cockpit` et ne nettoyait qu'en fin de passe ;
// une passe interrompue y laissait ses chantiers. D'où trois règles, ici une
// seule fois pour tous les bancs :
//   1. un banc n'écrit que dans un projet de TEST (slug `test-…`, la même
//      règle que `cockpit.projet_de_test` en base et `estProjetDeTest` dans
//      l'app), créé au début, supprimé à la fin ;
//   2. au démarrage, il purge les restes de SES passes précédentes — mais
//      seulement ceux plus vieux que AGE_RESTE_MIN : la passe vivante d'un
//      autre agent (jusqu'à 3 en parallèle) n'est jamais cassée ;
//   3. `restesDansLesVraisProjets` compte ce qu'un banc aurait laissé dans un
//      projet réel ; verifier-base.mjs rougit si ce n'est pas zéro.
//
// `sql` est la fonction du banc (synchrone ou asynchrone : tout est attendu).

/** Une passe dure au plus ~15 min (verifier-web) : au-delà de 30, c'est un reste. */
export const AGE_RESTE_MIN = 30

/** Le filtre SQL « projet de test », identique à cockpit.projet_de_test(slug). */
export const EST_TEST = (col = 'slug') => `coalesce(${col}, '') like 'test-%'`

const q = (s) => `'${String(s).replace(/'/g, "''")}'`

/** Les projets `<prefixe>…` abandonnés par une passe précédente (plus vieux que AGE_RESTE_MIN). */
export async function projetsDeTestAbandonnes(sql, prefixe) {
  if (!/^test-[a-z0-9-]*$/.test(prefixe)) throw new Error(`REFUS : préfixe de projet de test invalide : ${prefixe}`)
  return await sql(`select id, slug from projets where slug like ${q(prefixe + '%')} and created_at < now() - interval '${AGE_RESTE_MIN} minutes'`)
}

/**
 * Supprime des projets de test (et tout ce qui en dépend, traces hors cascade
 * comprises). Refuse tout id dont le slug ne commence pas par `prefixe`.
 */
export async function purgerProjetsDeTest(sql, ids, prefixe) {
  if (!ids.length) return
  if (!/^test-[a-z0-9-]*$/.test(prefixe)) throw new Error(`REFUS : préfixe de projet de test invalide : ${prefixe}`)
  const liste = ids.map(q).join(', ')
  const reels = await sql(`select slug from projets where id in (${liste}) and slug not like ${q(prefixe + '%')}`)
  if (reels.length) throw new Error(`REFUS : un id à purger n'est pas un projet de test : ${JSON.stringify(reels)}`)
  // La cascade emporte sections, chantiers (→ trigger → supprimes), messages,
  // activite, sessions, taches, membres, visites, ce_qui_marche. historique et
  // supprimes n'ont pas de FK : purgés par les ids passés dans supprimes.
  await sql(`delete from projets where id in (${liste}) and slug like ${q(prefixe + '%')}`)
  await sql(`delete from historique where chantier_id in (select chantier_id from supprimes where projet_id in (${liste}))`)
  await sql(`delete from supprimes where projet_id in (${liste})`)
}

/** Purge au démarrage : les projets `<prefixe>…` abandonnés. Rend la liste purgée. */
export async function purgerPassesPrecedentes(sql, prefixe) {
  const vieux = await projetsDeTestAbandonnes(sql, prefixe)
  if (vieux.length) {
    console.log(`  (purge de ${vieux.length} projet(s) de test d'une passe précédente : ${vieux.map((v) => v.slug).join(', ')})`)
    await purgerProjetsDeTest(sql, vieux.map((v) => v.id), prefixe)
  }
  return vieux
}

/**
 * Les chantiers marqués `<marque>…` qu'une ANCIENNE version d'un banc a
 * laissés dans un projet réel : supprimés avec leurs traces. Jamais un titre
 * qui ne commence pas par « [TEST », jamais un projet de test (celui d'une
 * passe vivante), jamais une ligne de moins de AGE_RESTE_MIN minutes.
 */
export async function purgerMarquesDansLesVraisProjets(sql, marque) {
  if (!marque.startsWith('[TEST')) throw new Error(`REFUS : marque de test invalide : ${marque}`)
  const filtre = `titre like ${q(marque + '%')} and created_at < now() - interval '${AGE_RESTE_MIN} minutes'
    and projet_id in (select id from projets where not ${EST_TEST()})`
  const ids = (await sql(`select id from chantiers where ${filtre}`)).map((r) => r.id)
  if (ids.length) {
    const liste = ids.map(q).join(', ')
    console.log(`  (purge de ${ids.length} chantier(s) « ${marque}… » laissé(s) dans un projet réel)`)
    await sql(`delete from ce_qui_marche where chantier_id in (${liste})`)
    await sql(`delete from chantiers where id in (${liste})`)
    await sql(`delete from historique where chantier_id in (${liste})`)
    await sql(`delete from supprimes where chantier_id in (${liste})`)
  }
  // Et la trace d'un chantier de test déjà supprimé (la corbeille `supprimes`).
  const traces = `ligne->>'titre' like ${q(marque + '%')} and deleted_at < now() - interval '${AGE_RESTE_MIN} minutes'
    and projet_id in (select id from projets where not ${EST_TEST()})`
  const n = (await sql(`select count(*)::int as n from supprimes where ${traces}`))[0].n
  if (n) {
    console.log(`  (purge de ${n} trace(s) de suppression « ${marque}… » dans un projet réel)`)
    await sql(`delete from historique where chantier_id in (select chantier_id from supprimes where ${traces})`)
    await sql(`delete from supprimes where ${traces}`)
  }
  return ids.length + n
}

/**
 * Ce qu'un banc a laissé dans un projet RÉEL : lignes dont le texte commence
 * par « [TEST » (chantiers, leurs traces de suppression, messages, étapes,
 * sessions, tâches). Doit valoir 0. Préfixe seulement : une demande de
 * Raphaël qui CITE « [TEST … » n'est pas un reste.
 */
export async function restesDansLesVraisProjets(sql) {
  const reel = `projet_id in (select id from projets where not ${EST_TEST()})`
  const r = (await sql(`select
      (select count(*) from chantiers where titre like '[TEST%' and ${reel})::int as chantiers,
      (select count(*) from supprimes where ligne->>'titre' like '[TEST%' and ${reel})::int as supprimes,
      (select count(*) from messages where corps like '[TEST%' and ${reel})::int as messages,
      (select count(*) from activite where etape like '[TEST%' and ${reel})::int as activite,
      (select count(*) from sessions where sujet like '[TEST%' and ${reel})::int as sessions,
      (select count(*) from taches where description like '[TEST%' and ${reel})::int as taches,
      (select coalesce(jsonb_agg(p.slug || ' : ' || c.titre), '[]'::jsonb) from chantiers c join projets p on p.id = c.projet_id
         where c.titre like '[TEST%' and not ${EST_TEST('p.slug')}) as titres`))[0]
  const total = r.chantiers + r.supprimes + r.messages + r.activite + r.sessions + r.taches
  return { total, ...r }
}
