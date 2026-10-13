// Règles de la recherche des fournisseurs de factures (src/lib/fournisseurs.ts, 0084, chantier 07258fe5).
import { verifie, bilan } from './_assert.ts'
import {
  ATTENTE_LONGUE_H, ONGLETS, compterParStatut, dansOnglet, demandeOuverte, deviseProbable, etatRecherche, libelleMails, lireFournisseur, lireRecherche,
  nomNormalise, prestatairePour, type Fournisseur, type Recherche,
} from '../src/lib/fournisseurs.ts'

const NOW = new Date('2026-10-20T12:00:00Z')
const rech = (o: Partial<Recherche> = {}): Recherche => ({ id: 'r1', projet_id: 'p', statut: 'en_attente', demandee_par: 'raphael@x.fr', demandee_at: '2026-10-20T11:00:00Z',
  pris_par: null, pris_at: null, fini_at: null, trouves: null, nouveaux: null, note: null, ...o })
const fou = (o: Partial<Fournisseur> = {}): Fournisseur => ({ id: Math.random().toString(), projet_id: 'p', cle: 'vercel.com', nom: 'Vercel', domaine: 'vercel.com', expediteur: 'billing@vercel.com', mails: 3,
  premier_mail: '2026-08-04', dernier_mail: '2026-10-09', exemple_objet: 'Invoice', lecteur: false, statut: 'nouveau', service_id: null, recherche_id: null, created_at: '2026-10-20T11:00:00Z', updated_at: '2026-10-20T11:00:00Z', ...o })

console.log('verifier-fournisseurs')
const aucune = etatRecherche(null, NOW)
verifie('jamais demandée : « Aucune recherche faite », on peut demander', aucune.niveau === 'aucune' && aucune.titre === 'Aucune recherche faite.' && aucune.ouverte === false, aucune)
const attente = etatRecherche(rech(), NOW)
verifie('en attente : dit depuis quand, et que Claude la traite dès qu’une session avec Gmail est ouverte', attente.niveau === 'attente' && attente.titre === 'Demande envoyée il y a 1 h.' && attente.detail === 'Claude la traite dès qu’une session avec Gmail est ouverte.' && attente.ouverte === true, attente)
const longue = etatRecherche(rech({ demandee_at: '2026-10-19T12:00:00Z' }), NOW)
verifie(`en attente depuis plus de ${ATTENTE_LONGUE_H} h : le dit, propose d’ouvrir une session ou d’annuler (rien n’est annulé tout seul)`, longue.niveau === 'attente' && /Toujours en attente/.test(longue.detail ?? '') && /annule la demande/.test(longue.detail ?? ''), longue)
verifie('exactement 6 h : pas encore « toujours en attente »', !/Toujours en attente/.test(etatRecherche(rech({ demandee_at: '2026-10-20T06:00:00Z' }), NOW).detail ?? ''))
const cours = etatRecherche(rech({ statut: 'en_cours', pris_at: '2026-10-20T11:50:00Z', pris_par: 'session_x' }), NOW)
verifie('en cours : « Claude cherche… », depuis quand', cours.niveau === 'cours' && cours.titre === 'Claude cherche… (commencé il y a 10 min).' && cours.ouverte === true, cours)
const ok = etatRecherche(rech({ statut: 'terminee', fini_at: '2026-10-20T11:55:00Z', trouves: 12, nouveaux: 4, note: '12 fournisseurs trouvés dont 4 nouveaux (87 mails vus)' }), NOW)
verifie('terminée : la date et la note du passage (nombre de fournisseurs, nouveaux)', ok.niveau === 'ok' && ok.titre === 'Dernière recherche : il y a 5 min.' && ok.detail === '12 fournisseurs trouvés dont 4 nouveaux (87 mails vus)' && ok.ouverte === false, ok)
const ko = etatRecherche(rech({ statut: 'echec', fini_at: '2026-10-20T11:00:00Z', note: 'Gmail inaccessible' }), NOW)
verifie('échec : visible, avec la raison, on peut réessayer (demande plus ouverte)', ko.niveau === 'echec' && ko.titre === 'La dernière recherche a échoué il y a 1 h.' && ko.detail === 'Gmail inaccessible' && ko.ouverte === false, ko)
const annulee = etatRecherche(rech({ statut: 'annulee', fini_at: '2026-10-20T11:30:00Z' }), NOW)
verifie('annulée : se lit comme « rien en cours »', annulee.niveau === 'aucune' && annulee.ouverte === false && /annulée/.test(annulee.titre), annulee)
verifie('une note vide ou d’espaces n’affiche rien', etatRecherche(rech({ statut: 'terminee', fini_at: '2026-10-20T11:55:00Z', note: '   ' }), NOW).detail === null)
verifie('demandeOuverte : en attente et en cours seulement', demandeOuverte(rech()) && demandeOuverte(rech({ statut: 'en_cours' })) && !demandeOuverte(rech({ statut: 'terminee' })) && !demandeOuverte(rech({ statut: 'echec' })) && !demandeOuverte(rech({ statut: 'annulee' })) && !demandeOuverte(null))
verifie('lecture défensive : nombres reçus en texte, valeurs absentes', lireRecherche({ trouves: '12', nouveaux: null }).trouves === 12 && lireRecherche({ trouves: 'abc' }).trouves === null && lireFournisseur({ mails: '5', lecteur: true }).mails === 5 && lireFournisseur({ mails: null }).mails === 0 && lireFournisseur({}).lecteur === false)

const liste = [fou({ nom: 'Zeta', mails: 1 }), fou({ nom: 'Alpha', mails: 1 }), fou({ nom: 'Beta', mails: 9 }), fou({ nom: 'Suivi A', statut: 'suivi', mails: 2 }), fou({ nom: 'Ignoré', statut: 'ignore' })]
verifie('onglets : Nouveaux, Suivis, Ignorés (dans cet ordre)', ONGLETS.map((o) => o.valeur).join('|') === 'nouveau|suivi|ignore' && ONGLETS.map((o) => o.libelle).join('|') === 'Nouveaux|Suivis|Ignorés')
verifie('compte par statut', JSON.stringify(compterParStatut(liste)) === JSON.stringify({ nouveau: 3, suivi: 1, ignore: 1 }) && JSON.stringify(compterParStatut([])) === JSON.stringify({ nouveau: 0, suivi: 0, ignore: 0 }))
verifie('un onglet : les plus fréquents d’abord, puis par nom', dansOnglet(liste, 'nouveau').map((f) => f.nom).join('|') === 'Beta|Alpha|Zeta' && dansOnglet(liste, 'suivi').length === 1 && dansOnglet([], 'ignore').length === 0)
verifie('libellé : « 3 mails · dernier le 9 oct. 2026 », « 1 mail », sans date', libelleMails(fou()) === '3 mails · dernier le 9 oct. 2026' && libelleMails(fou({ mails: 1, dernier_mail: null })) === '1 mail' && libelleMails(fou({ mails: 1 })) === '1 mail · dernier le 9 oct. 2026')
verifie('noms comparés sans accent, majuscule ni ponctuation', nomNormalise('  Crédit-Agricole, S.A. ') === 'credit agricole s a' && nomNormalise('RunPod') === 'runpod')
const services = [{ id: 's1', nom: 'Claude', archived_at: null }, { id: 's2', nom: 'RunPod', archived_at: null }, { id: 's3', nom: 'Vercel', archived_at: '2026-10-01T00:00:00Z' }]
verifie('Suivre ne crée jamais de doublon : même nom (sans accent ni casse)', prestatairePour({ nom: 'runpod', domaine: 'runpod.io' }, services)?.id === 's2')
verifie('… ou alias connu : Anthropic est le prestataire « Claude »', prestatairePour({ nom: 'Anthropic', domaine: 'anthropic.com' }, services)?.id === 's1')
verifie('… un prestataire archivé n’est pas relié, un inconnu non plus', prestatairePour({ nom: 'Vercel', domaine: 'vercel.com' }, services) === null && prestatairePour({ nom: 'Render', domaine: 'render.com' }, services) === null)
verifie('devise probable : un domaine israélien facture en shekels, le reste en dollars', deviseProbable({ domaine: 'bezeq.co.il' }) === 'ILS' && deviseProbable({ domaine: 'vercel.com' }) === 'USD')
bilan('verifier-fournisseurs')
