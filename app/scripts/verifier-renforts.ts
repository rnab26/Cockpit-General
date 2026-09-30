// Les renforts (src/lib/renforts.ts, 0024) : ce que dit chaque ligne, quand le
// bouton marche, ce qu'on dit après le clic. Les nombres viennent de la base.
import { verifie, bilan } from './_assert.ts'
import { boutonRenforts, erreurReglageRenforts, erreurReglageModeles, libelleFrein, ligneRenfort, messageDemande, renfortsEnRoute, blocUtile, type EtatRenforts, type Renfort } from '../src/lib/renforts.ts'

console.log('verifier-renforts')
const now = new Date('2026-09-29T12:00:00Z')
const r = (x: Partial<Renfort>): Renfort => ({
  id: 'r', section_id: null, section: 'Écran', statut: 'demande', vivant: true, session: null, max_agents: 3, chantiers: 3, faits: 0, en_cours: 0,
  erreur: null, created_at: '2026-09-29T11:50:00Z', vu_at: null, fini_at: null, archive_at: null, ...x,
})
const etat = (x: Partial<EtatRenforts>): EtatRenforts => ({ sessions_max: 2, agents_par_session: 3, chef: true, chef_vu_at: null, attente: [], renforts: [], ...x })
const att = (section: string, n: number) => ({ section_id: section, section, n, ids: [] })

// Lignes
verifie('demandé, chef présente : « Demande envoyée », ouvert au prochain passage', (() => { const l = ligneRenfort(r({}), true, now); return l.code === 'demande' && l.etat === 'Demande envoyée' && /prochain passage/.test(l.detail) })())
verifie('demandé, AUCUNE chef ni relais : « en attente : aucune session FacePro active », ouvrir Claude Code', (() => { const l = ligneRenfort(r({}), false, now, { projet: 'FacePro' }); return l.etat === 'En attente' && l.detail.startsWith('en attente : aucune session FacePro active') && /ouvre Claude Code/.test(l.detail) })())
verifie('demandé, sans chef mais relais du cockpit : qui l’ouvre et vers quelle heure', (() => { const d = ligneRenfort(r({}), false, now, { projet: 'FacePro', relais: 'cockpit', relais_passage: '2026-09-29T12:08:00Z' }).detail; return d.startsWith('en attente : aucune session FacePro active') && /session chef de cockpit/.test(d) && /vers \d+ h 08/.test(d) })())
verifie('actif : « En route », agents au travail, chantiers pris, vu il y a', (() => { const l = ligneRenfort(r({ statut: 'actif', en_cours: 2, faits: 3, vu_at: '2026-09-29T11:55:00Z' }), true, now); return l.code === 'en_route' && /2 agents au travail/.test(l.detail) && /3 chantiers pris/.test(l.detail) && /vu/.test(l.detail) })())
verifie('fini puis archivé : « Terminé », session fermée', (() => { const l = ligneRenfort(r({ statut: 'archive', faits: 1 }), true, now); return l.code === 'termine' && /1 chantier pris/.test(l.detail) && /session fermée/.test(l.detail) })())
verifie('erreur : le texte de la base est montré', ligneRenfort(r({ statut: 'erreur', erreur: 'create_session refusé' }), true, now).detail === 'create_session refusé')
verifie('actif mais muet depuis 3 h (plus vivant) : erreur visible, même avant le passage de la base', ligneRenfort(r({ statut: 'actif', vivant: false }), true, now).code === 'erreur')

// Bouton
verifie('rien n’attend : bouton inactif, « aucun renfort nécessaire »', (() => { const b = boutonRenforts(etat({})); return !b.actif && /aucun renfort/.test(b.aide) })())
verifie('réglage à 0 : inactif, dit où régler', (() => { const b = boutonRenforts(etat({ sessions_max: 0, attente: [att('A', 2)] })); return !b.actif && /Réglages/.test(b.aide) })())
verifie('3 sections en attente, 2 sessions au plus : 2 sessions annoncées, 3 agents chacune', (() => { const b = boutonRenforts(etat({ attente: [att('A', 3), att('B', 2), att('C', 1)] })); return b.actif && b.sections === 2 && /2 sessions/.test(b.aide) && /3 agents/.test(b.aide) })())
verifie('déjà 2 en route sur 2 : inactif, « Déjà 2 renforts en route »', (() => { const b = boutonRenforts(etat({ attente: [att('C', 1)], renforts: [r({ id: '1' }), r({ id: '2', statut: 'actif' })] })); return !b.actif && /Déjà 2 renforts/.test(b.aide) })())
verifie('un renfort mort ne compte plus dans la limite', renfortsEnRoute(etat({ renforts: [r({ vivant: false }), r({ statut: 'fini' })] })).length === 0)
verifie('tout est déjà confié : le dire', /déjà confié/.test(boutonRenforts(etat({ renforts: [r({})] })).aide))

// Après le clic
verifie('clic réussi : « 2 renforts demandés : Écran, Base »', (() => { const m = messageDemande({ demandes: [{ id: '1', section: 'Écran', chantiers: 3 }, { id: '2', section: 'Base', chantiers: 2 }], vivants: 2, max: 2, agents: 3, raison: null }); return m.ok && m.texte.startsWith('2 renforts demandés : Écran, Base') })())
verifie('clic sans effet (plein / éteint / rien) : un message d’échec clair', !messageDemande({ demandes: [], vivants: 2, max: 2, agents: 3, raison: 'plein' }).ok
  && /Déjà 2/.test(messageDemande({ demandes: [], vivants: 2, max: 2, agents: 3, raison: 'plein' }).texte)
  && /éteints/.test(messageDemande({ demandes: [], vivants: 0, max: 0, agents: 3, raison: 'reglage_zero' }).texte)
  && /Rien n’attend/.test(messageDemande({ demandes: [], vivants: 0, max: 2, agents: 3, raison: 'rien_en_attente' }).texte))

// Réglages : mêmes bornes que la base
verifie('réglages : 0 à 4 sessions, 1 à 5 agents', erreurReglageRenforts(0, 1) === null && erreurReglageRenforts(4, 5) === null
  && !!erreurReglageRenforts(5, 3) && !!erreurReglageRenforts(2, 6) && !!erreurReglageRenforts(2, 0))
verifie('bloc utile seulement si quelque chose attend ou un renfort est à suivre', !blocUtile({ attente: [], renforts: [] }) && blocUtile({ attente: [att('A', 1)], renforts: [] }))
// Économie des modèles (0034)
verifie('modèles : 1 à 8 agents, revue de 1 à 168 h', erreurReglageModeles(2, 24) === null && erreurReglageModeles(8, 168) === null
  && !!erreurReglageModeles(0, 24) && !!erreurReglageModeles(9, 24) && !!erreurReglageModeles(2, 0) && !!erreurReglageModeles(2, 169))
verifie('frein : dit qu’il est levé, ou pourquoi il est actif', /Aucun frein/.test(libelleFrein({ actif: false }))
  && /1 agent à la fois/.test(libelleFrein({ actif: true, raison: 'limite d’usage' })) && /limite d’usage/.test(libelleFrein({ actif: true, raison: 'limite d’usage' })))
bilan('verifier-renforts')
