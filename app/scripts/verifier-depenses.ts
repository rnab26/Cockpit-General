// Règles des dépenses d'un projet (src/lib/depenses.ts, 0052, chantier 41127de1).
import { verifie, bilan } from './_assert.ts'
import { cleDePeriode, destinataireValide, envoyable, etatImportAuto, jourLisible, rythmeEnMots, formaterTotaux, grouper, lienDeRepli, lireDepense, lundiDe, parService, resumeCompta, soldeBas, sommer, type Depense, type Service } from '../src/lib/depenses.ts'

const dep = (o: Partial<Depense>): Depense => ({ id: Math.random().toString(), projet_id: 'p', service_id: 's1', date: '2026-10-05', montant: 10, devise: 'USD', type: 'facture', description: '', reference: null, fichier: null,
  compta_statut: 'a_envoyer', compta_at: null, compta_par: null, compta_canal: null, created_at: '2026-10-05T10:00:00Z', ...o })
const svc = (o: Partial<Service>): Service => ({ id: 's1', projet_id: 'p', nom: 'RunPod', url_tableau: null, url_factures: null, devise: 'USD', solde: null, solde_at: null, seuil_alerte: null, note: null, archived_at: null, created_at: '', ...o })

console.log('verifier-depenses')
verifie('lundi de la semaine : un dimanche appartient à la semaine qui finit', lundiDe('2026-10-04') === '2026-09-28' && lundiDe('2026-10-05') === '2026-10-05' && lundiDe('2026-01-01') === '2025-12-29')
verifie('clés de période', cleDePeriode('2026-10-05', 'jour') === '2026-10-05' && cleDePeriode('2026-10-05', 'mois') === '2026-10' && cleDePeriode('2026-10-05', 'annee') === '2026')
const l = [dep({ date: '2026-10-05', montant: 1.1 }), dep({ date: '2026-10-05', montant: 2.2 }), dep({ date: '2026-09-30', montant: 5 }), dep({ date: '2026-10-01', montant: 100, type: 'recharge' }), dep({ date: '2026-10-02', montant: 3, devise: 'EUR' })]
const mois = grouper(l, 'mois')
verifie('mois : le plus récent d’abord, libellé lisible', mois.map((p) => p.libelle).join('|') === 'oct. 2026|sept. 2026')
verifie('somme sans erreur d’arrondi flottant (1,1 + 2,2 = 3,3)', mois[0].totaux.USD === 3.3, mois[0].totaux)
verifie('une recharge n’est pas un coût ; les devises ne se mélangent pas', mois[0].totaux.EUR === 3 && Object.keys(mois[0].totaux).length === 2 && mois[0].depenses.length === 4)
verifie('jour : un paquet par date', grouper(l, 'jour').length === 4)
verifie('semaine : le 30/09 (mer.) et le 05/10 (lun.) sont dans deux semaines', grouper(l, 'semaine').length === 2)
verifie('année : tout dans 2026', grouper(l, 'annee').length === 1 && grouper(l, 'annee')[0].libelle === '2026')
verifie('aucune dépense : aucun paquet (état vide géré par l’écran)', grouper([], 'mois').length === 0)
verifie('total par service (coûts seulement)', parService(l).get('s1')?.USD === 8.3 && parService([dep({ service_id: null })]).has(null))
verifie('formatage : plusieurs devises, vide', formaterTotaux({ USD: 3.3, EUR: 3 }).includes('+') && formaterTotaux({}) === '—' && sommer([]).USD === undefined)
verifie('numeric reçu en texte', lireDepense({ montant: '12.50', devise: 'USD' }).montant === 12.5 && lireDepense({ montant: 'abc' }).montant === 0)
verifie('solde bas : sans solde ou sans seuil, jamais d’alerte', !soldeBas({ solde: null, seuil_alerte: 5 }) && !soldeBas({ solde: 1, seuil_alerte: null }) && soldeBas({ solde: 5, seuil_alerte: 5 }) && !soldeBas({ solde: 6, seuil_alerte: 5 }))
verifie('envoyable : une facture pas envoyée, ni une consommation ni une déjà envoyée', envoyable(dep({})) && !envoyable(dep({ type: 'consommation' })) && !envoyable(dep({ compta_statut: 'envoye' })) && !envoyable(dep({ compta_statut: 'sans_objet' })))
const r = resumeCompta([dep({ reference: 'INV-1', fichier: { chemin: 'x', nom: 'a.pdf', type: 'application/pdf', taille: 1 } }), dep({ service_id: null })], [svc({})], 'FacePro')
verifie('résumé compta : projet, prestataire, réf., total, pièce manquante signalée', r.includes('FacePro (2)') && r.includes('RunPod') && r.includes('INV-1') && r.includes('Sans prestataire') && r.includes('pas de pièce jointe') && r.includes('Total :'))
verifie('repli e-mail : mailto encodé ; adresse invalide : rien', lienDeRepli('email', 'compta@x.fr', 'Sujet é', 'a b')?.startsWith('mailto:compta@x.fr?subject=Sujet%20%C3%A9') === true && lienDeRepli('email', 'pas une adresse', 's', 't') === null)
verifie('repli WhatsApp : chiffres seulement ; autre : rien', lienDeRepli('whatsapp', '+972 54-123-4567', 's', 't')?.startsWith('https://wa.me/972541234567?text=') === true && lienDeRepli('autre', 'bot', 's', 't') === null && lienDeRepli(null, 'a@b.fr', 's', 't') === null)
verifie('destinataire valide selon le canal', destinataireValide('email', 'a@b.fr') && !destinataireValide('email', 'a@') && destinataireValide('whatsapp', '+972541234567') && !destinataireValide('whatsapp', '123') && destinataireValide('autre', 'bot compta') && !destinataireValide(null, 'a@b.fr'))
// Import automatique des reçus par e-mail (0083) : ce que la carte du prestataire en dit
const NOW = new Date('2026-10-20T12:00:00Z')
const imp = (o: Record<string, unknown> = {}) => ({ import_depuis: '2026-10-13', import_cadence_jours: 7 as number | null, import_at: null as string | null, import_statut: null as 'ok' | 'echec' | null, import_note: null as string | null, ...o })
verifie('import auto : aucun battement ni cadence = rien à montrer (un prestataire sans import)', etatImportAuto(imp({ import_cadence_jours: null }), NOW) === null)
const attente = etatImportAuto(imp(), NOW)
verifie('import auto : cadence réglée mais jamais passé = « pas encore passé », avec le rythme', attente?.niveau === 'attente' && attente.titre === 'Import automatique des reçus (chaque semaine) : pas encore passé.' && attente.depuis === '13 oct. 2026', attente)
const ok = etatImportAuto(imp({ import_at: '2026-10-18T12:00:00Z', import_statut: 'ok', import_note: '1 facture ajoutée : 289,00 ₪ (2 oct.)' }), NOW)
verifie('import auto : passé il y a 2 jours = ok, la note du passage est reprise telle quelle', ok?.niveau === 'ok' && ok.titre === 'Import automatique des reçus (chaque semaine) : passé il y a 2 j.' && ok.detail === '1 facture ajoutée : 289,00 ₪ (2 oct.)', ok)
const echec = etatImportAuto(imp({ import_at: '2026-10-20T11:00:00Z', import_statut: 'echec', import_note: 'Le passage n’a pas pu avoir lieu : Gmail inaccessible' }), NOW)
verifie('import auto : un échec se voit tout de suite (même récent), avec sa raison', echec?.niveau === 'echec' && echec.titre === 'L’import automatique des reçus a échoué il y a 1 h.' && echec.detail?.includes('Gmail inaccessible') === true, echec)
verifie('import auto : un échec ancien reste un échec (jamais « ok » par oubli)', etatImportAuto(imp({ import_at: '2026-08-01T12:00:00Z', import_statut: 'echec' }), NOW)?.niveau === 'echec')
verifie('import auto : exactement 2 cadences sans passage = pas encore en retard ; au-delà = en retard, jours comptés', etatImportAuto(imp({ import_at: '2026-10-06T12:00:00Z', import_statut: 'ok' }), NOW)?.niveau === 'ok'
  && etatImportAuto(imp({ import_at: '2026-10-05T11:00:00Z', import_statut: 'ok' }), NOW)?.niveau === 'retard' && etatImportAuto(imp({ import_at: '2026-10-05T11:00:00Z', import_statut: 'ok' }), NOW)?.titre === 'L’import automatique des reçus n’est pas passé depuis 15 jours (prévu chaque semaine).')
verifie('import auto : le retard suit la cadence du prestataire (mensuelle : 45 jours de silence ne sont pas un retard)', etatImportAuto(imp({ import_cadence_jours: 30, import_at: '2026-09-05T12:00:00Z', import_statut: 'ok' }), NOW)?.niveau === 'ok'
  && etatImportAuto(imp({ import_cadence_jours: 30, import_at: '2026-08-01T12:00:00Z', import_statut: 'ok' }), NOW)?.niveau === 'retard')
verifie('import auto : un passage sans cadence notée reste lisible (jamais de retard inventé)', etatImportAuto(imp({ import_cadence_jours: null, import_at: '2026-01-01T12:00:00Z', import_statut: 'ok' }), NOW)?.niveau === 'ok')
verifie('import auto : rythmes en mots', rythmeEnMots(1) === 'chaque jour' && rythmeEnMots(7) === 'chaque semaine' && rythmeEnMots(14) === 'toutes les 2 semaines' && rythmeEnMots(30) === 'chaque mois' && rythmeEnMots(10) === 'tous les 10 jours')
verifie('import auto : date de départ lisible, et rien d’inventé quand ce n’est pas une date', jourLisible('2026-10-13') === '13 oct. 2026' && jourLisible('2026-01-05') === '5 janv. 2026' && jourLisible(null) === null && jourLisible('abc') === null && jourLisible('2026-13-01') === null)
verifie('import auto : une date de passage illisible se traite comme « jamais passé », sans planter', etatImportAuto(imp({ import_at: 'pas une date' }), NOW)?.niveau === 'attente')
verifie('import auto : une note vide ou faite d’espaces n’affiche rien', etatImportAuto(imp({ import_at: '2026-10-18T12:00:00Z', import_statut: 'ok', import_note: '   ' }), NOW)?.detail === null)
bilan('verifier-depenses')
