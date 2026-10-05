// Reprise de l'écran après que le navigateur a vidé la page (retour d'un lien ouvert ailleurs).
import { readFileSync, readdirSync } from 'node:fs'
import { verifie, bilan } from './_assert.ts'
import { lireEtatEcran, etatCoherent, VALIDITE_ETAT_ECRAN_MS } from '../src/lib/etatEcran.ts'

console.log('verifier-etat-ecran')
const t = 1_800_000_000_000
const ok = JSON.stringify({ slug: 'facepro', onglet: 'couts', conversation: { projetId: 'p', chantierId: 'c' }, scrollY: 420.4, at: t - 60_000 })
const e = lireEtatEcran(ok, t)
verifie('état récent relu tel quel', e?.slug === 'facepro' && e.onglet === 'couts' && e.conversation?.chantierId === 'c' && e.scrollY === 420)
verifie('trop vieux : on repart de l’accueil', lireEtatEcran(ok, t + VALIDITE_ETAT_ECRAN_MS) === null)
verifie('rien / JSON cassé / mauvais type : null', lireEtatEcran(null, t) === null && lireEtatEcran('{x', t) === null && lireEtatEcran('12', t) === null && lireEtatEcran('{"at":"a"}', t) === null)
verifie('onglet inconnu → travail ; défilement négatif → 0', (() => { const r = lireEtatEcran(JSON.stringify({ slug: null, onglet: 'zzz', scrollY: -5, conversation: { projetId: 3 }, at: t }), t); return r?.onglet === 'travail' && r.scrollY === 0 && r.conversation === null })())
verifie('lien vers un autre projet : état ignoré ; sans lien ou même projet : repris', etatCoherent(e, 'jarvis') === null && etatCoherent(e, null) === e && etatCoherent(e, 'facepro') === e)
const src = readFileSync(new URL('../src/components/Cockpit.tsx', import.meta.url), 'utf8')
verifie('Cockpit sauve l’écran en quittant la page et ne sauve rien avant la vue restaurée', /pagehide/.test(src) && /visibilitychange/.test(src) && /pret: d\.vue !== null/.test(src))
// Tous les liens sortants s'ouvrent dans un autre onglet : l'appli n'est jamais remplacée.
const dir = new URL('../src/components/', import.meta.url)
const fautifs: string[] = []
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.tsx')) continue
  for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/<a\s[^>]*href=\{?["'`]?https?:[^>]*>|<a\s[^>]*href=\{[a-zA-Z_.]*(?:url|lien)[^>]*>/g)) {
    if (!/target="_blank"/.test(m[0]) || !/rel="no(opener|referrer)/.test(m[0])) fautifs.push(`${f}: ${m[0].slice(0, 80)}`)
  }
}
verifie('liens sortants : target="_blank" + rel noopener', fautifs.length === 0, fautifs)
bilan('verifier-etat-ecran')
