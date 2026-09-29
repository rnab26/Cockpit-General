// L'état des déploiements d'un projet (src/lib/deploiement.ts), sur des
// exécutions au format réel de l'API GitHub (relevé le 29 sept. 2026).
import { verifie, bilan } from './_assert.ts'
import { etatDuProjet, etatExecution, estUnDeploiement, phraseSite, siteASonder, type ExecutionGitHub } from '../src/lib/deploiement.ts'

const now = new Date('2026-09-29T01:00:00Z')
const il = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
const run = (name: string, status: string, conclusion: string | null, minAgo: number, branche = 'main'): ExecutionGitHub => ({
  name, status, conclusion, created_at: il(minAgo + 2), updated_at: il(minAgo), run_started_at: il(minAgo + 2),
  head_sha: 'abcdef1234', head_branch: branche, html_url: 'https://github.com/x/y/actions/runs/1', display_title: 'Un commit',
})

console.log('verifier-deploiement')
verifie('in_progress = en cours', etatExecution({ status: 'in_progress', conclusion: null }) === 'en_cours')
verifie('queued = en cours', etatExecution({ status: 'queued', conclusion: null }) === 'en_cours')
verifie('completed + success = réussi', etatExecution({ status: 'completed', conclusion: 'success' }) === 'reussi')
verifie('completed + failure = échoué', etatExecution({ status: 'completed', conclusion: 'failure' }) === 'echoue')
verifie('completed + timed_out = échoué', etatExecution({ status: 'completed', conclusion: 'timed_out' }) === 'echoue')
verifie('completed + cancelled = annulé', etatExecution({ status: 'completed', conclusion: 'cancelled' }) === 'annule')
verifie('« Deploy to GitHub Pages » est un déploiement', estUnDeploiement('Deploy to GitHub Pages'))
verifie('« Build BFS Head Swap worker image » est un déploiement', estUnDeploiement('Build BFS Head Swap worker image (Tête entière)'))
verifie('« Déployer sur GitHub Pages » (le vrai nom du cockpit) est un déploiement', estUnDeploiement('Déployer sur GitHub Pages'))
verifie('« Vérifications » n’en est pas un', !estUnDeploiement('Vérifications'))
{
  const e = etatDuProjet([run('Deploy to GitHub Pages', 'in_progress', null, 1), run('Vérifications', 'completed', 'success', 3)], 'main', now)
  verifie('un déploiement qui tourne → « Mise en ligne en cours »', e.etat === 'en_cours' && e.enCours && /en cours/.test(e.titre), e)
  verifie('…et dit depuis combien de temps', /depuis 3 min/.test(e.lignes[0].phrase), e.lignes[0])
}
{
  const e = etatDuProjet([run('Deploy to GitHub Pages', 'completed', 'success', 5), run('Deploy to GitHub Pages', 'completed', 'failure', 60)], 'main', now)
  verifie('seul le DERNIER passage d’un workflow compte (un vieil échec est oublié)', e.etat === 'reussi' && e.lignes.length === 1, e)
  verifie('réussi → « En ligne — il y a 5 min »', /En ligne/.test(e.titre) && /5 min/.test(e.titre), e.titre)
}
{
  const e = etatDuProjet([run('Deploy to GitHub Pages', 'completed', 'failure', 2), run('Vérifications', 'completed', 'success', 2)], 'main', now)
  verifie('échec du déploiement → le titre dit que la version d’avant reste en ligne', e.etat === 'echoue' && /version d’avant/.test(e.titre), e.titre)
}
{
  const e = etatDuProjet([run('Deploy to GitHub Pages', 'in_progress', null, 1, 'sauvegarde/x'), run('Deploy to GitHub Pages', 'completed', 'success', 30)], 'main', now)
  verifie('une branche de travail ne compte pas (elle ne met rien en ligne)', e.etat === 'reussi' && !e.enCours, e)
}
{
  const e = etatDuProjet([], 'main', now)
  verifie('rien sur main → le dit, sans inventer', e.etat === 'inconnu' && e.lignes.length === 0 && /Aucune/.test(e.titre))
}
{
  const e = etatDuProjet([run('Vérifications', 'completed', 'success', 1), run('Deploy to GitHub Pages', 'completed', 'success', 10)], 'main', now)
  verifie('le déploiement passe en tête de liste, avant les simples vérifications', e.lignes[0].nom === 'Deploy to GitHub Pages', e.lignes.map((l) => l.nom))
}
{
  const p = phraseSite({ commit: '80d6782b401a8cc422ed375a884cf1765e6f88cf', lu: now.getTime() - 10_000, erreur: null }, now)
  verifie('site lu : version courte (7 caractères) et « à l’instant »', p === 'Site en ligne — version 80d6782 (lu sur le site à l’instant)', p)
  const q = phraseSite({ commit: 'abcdef1', lu: now.getTime() - 5 * 60_000, erreur: null }, now)
  verifie('site lu il y a 5 min → le dit', /il y a 5 min/.test(q ?? ''), q)
  verifie('« dev » (pas un vrai déploiement) est cité tel quel', /version « dev »/.test(phraseSite({ commit: 'dev', lu: now.getTime(), erreur: null }, now) ?? ''))
  verifie('site injoignable → l’erreur est dite, pas tue', phraseSite({ commit: null, lu: null, erreur: 'Site injoignable' }, now) === 'Site injoignable')
  verifie('rien lu, pas d’erreur → rien à dire', phraseSite({ commit: null, lu: null, erreur: null }, now) === null)
}
verifie('site GitHub Pages → pas de sonde /health (GitHub dit la version)', siteASonder('https://rnab26.github.io/Melissa-Nabet/') === null)
verifie('site Render → sondé', siteASonder(' https://facepro.onrender.com ') === 'https://facepro.onrender.com')
verifie('pas d’adresse ou adresse illisible → pas de sonde', siteASonder('') === null && siteASonder(null) === null && siteASonder('pas une url') === null)
bilan('verifier-deploiement')
