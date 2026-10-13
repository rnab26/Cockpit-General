import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ListChecks, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { supabase, messageErreur } from '../lib/supabase.ts'
import {
  ONGLETS, STATUT_APRES_LOT, actionsDuLot, cochesVisibles, compterParStatut, dansOnglet, demandeOuverte, deviseProbable, etatRecherche, libelleLot, libelleMails,
  lireFournisseur, lireRecherche, phraseLot, phraseSuivreLot, prestatairePour, toutChoisi,
  type Fournisseur, type Onglet, type Recherche,
} from '../lib/fournisseurs.ts'
import type { Service } from '../lib/depenses.ts'
import { Button } from '../ui/Button.tsx'
import { Badge } from '../ui/Badge.tsx'
import { Repliable } from '../ui/Repliable.tsx'
import { Chargement, Erreur } from '../ui/Etats.tsx'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { DUREE_ANNULATION_MS } from './BarreSelection.tsx'

/** Tant qu'une demande est ouverte, l'écran la relit toutes les 10 s (le temps réel peut manquer : réseau, navigateur). */
const SONDAGE_MS = 10_000

function useRecherche(projetId: string) {
  const [derniere, setDerniere] = useState<Recherche | null>(null)
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([])
  const [charge, setCharge] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const recharger = useCallback(async () => {
    const [r, f] = await Promise.all([
      supabase.from('recherches_fournisseurs').select('*').eq('projet_id', projetId).order('demandee_at', { ascending: false }).limit(1),
      supabase.from('fournisseurs_detectes').select('*').eq('projet_id', projetId).order('mails', { ascending: false }).limit(2000),
    ])
    const err = r.error ?? f.error
    if (err) { setErreur(messageErreur(err)); setCharge(true); return }
    setDerniere(r.data?.[0] ? lireRecherche(r.data[0] as Record<string, unknown>) : null)
    setFournisseurs((f.data ?? []).map((x) => lireFournisseur(x as Record<string, unknown>)))
    setErreur(null); setCharge(true)
  }, [projetId])
  useEffect(() => {
    void recharger()
    const ch = supabase.channel(`fournisseurs-${projetId}`)
    for (const table of ['recherches_fournisseurs', 'fournisseurs_detectes']) ch.on('postgres_changes', { event: '*', schema: 'cockpit', table }, () => { void recharger() })
    ch.subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [projetId, recharger])
  const ouverte = demandeOuverte(derniere)
  useEffect(() => {
    if (!ouverte) return
    const t = window.setInterval(() => { void recharger() }, SONDAGE_MS)
    return () => window.clearInterval(t)
  }, [ouverte, recharger])
  return { derniere, fournisseurs, charge, erreur, recharger }
}

/**
 * « Fournisseurs de factures » (0084, chantier 07258fe5), en tête de l'écran Coûts. Raphaël : « un bouton où j'appuie et ça va chercher
 * tous les noms des fournisseurs où je suis susceptible d'avoir des factures, et comme ça on actualise ». Le bouton POSE une demande ; une
 * session Claude qui a Gmail cherche PAR MOTS-CLÉS (expéditeur, objet, date : jamais le contenu des mails) et range ce qu'elle trouve ici.
 * Il décide : « Suivre » crée le prestataire (jamais de doublon), « Ignorer » le cache pour de bon.
 */
export function RechercheFournisseurs({ projetId, services, par, now, onServicesChange }: {
  projetId: string; services: Service[]; par: string; now: Date; onServicesChange: () => void
}) {
  const toast = useToast()
  const confirmer = useConfirmer()
  const { derniere, fournisseurs, charge, erreur, recharger } = useRecherche(projetId)
  const [envoi, setEnvoi] = useState(false)
  const [occupe, setOccupe] = useState<string | null>(null)
  const [onglet, setOnglet] = useState<Onglet>('nouveau')
  const [ouvert, setOuvert] = useState(false)
  // « Choisir plusieurs » : cases à cocher + barre d'actions en bas (comme les chantiers) ; une action groupée à la fois, jamais mélangée aux boutons de chaque ligne
  const [choisir, setChoisir] = useState(false)
  const [coches, setCoches] = useState<ReadonlySet<string>>(new Set())
  const [enLot, setEnLot] = useState(false)
  const etat = useMemo(() => etatRecherche(derniere, now), [derniere, now])
  const compte = useMemo(() => compterParStatut(fournisseurs), [fournisseurs])
  const nomService = useMemo(() => new Map(services.map((s) => [s.id, s.nom])), [services])
  const liste = useMemo(() => dansOnglet(fournisseurs, onglet), [fournisseurs, onglet])
  const choisis = useMemo(() => liste.filter((f) => coches.has(f.id)), [liste, coches])
  const actions = actionsDuLot(onglet)
  const quitterChoix = () => { setChoisir(false); setCoches(new Set()) }
  const changerOnglet = (o: Onglet) => { setOnglet(o); quitterChoix() }
  // une ligne qui change d'onglet ou disparaît se décoche ; liste repliée ou vide : plus de mode « choisir »
  useEffect(() => { setCoches((c) => cochesVisibles(c, liste)) }, [liste])
  useEffect(() => { if (choisir && (!ouvert || !liste.length)) { setChoisir(false); setCoches(new Set()) } }, [choisir, ouvert, liste.length])
  // La liste s'ouvre au premier affichage s'il y a du nouveau, et QUAND de nouveaux fournisseurs arrivent ; elle ne se referme jamais
  // toute seule (ignorer le dernier « nouveau » ne doit pas fermer la liste sous le doigt).
  const nouveauxAvant = useRef<number | null>(null)
  useEffect(() => {
    if (!charge) return
    if (nouveauxAvant.current === null) setOuvert(compte.nouveau > 0)
    else if (compte.nouveau > nouveauxAvant.current) setOuvert(true)
    nouveauxAvant.current = compte.nouveau
  }, [charge, compte.nouveau])

  const demander = async () => {
    setEnvoi(true)
    const { error } = await supabase.from('recherches_fournisseurs').insert({ projet_id: projetId, demandee_par: par || null })
    setEnvoi(false)
    if (error) {
      // 23505 : la base garde UNE demande ouverte par projet (dix touchers = une ligne)
      if ((error as { code?: string }).code === '23505') { toast.info('Une recherche est déjà demandée.'); void recharger(); return }
      toast.erreur(messageErreur(error)); return
    }
    toast.succes('Demande envoyée. Claude la traite dès qu’une session avec Gmail est ouverte.'); void recharger()
  }
  const annuler = async () => {
    if (!derniere) return
    const { error } = await supabase.from('recherches_fournisseurs').update({ statut: 'annulee', fini_at: new Date().toISOString() }).eq('id', derniere.id)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes('Demande annulée.'); void recharger()
  }
  const changer = async (f: Fournisseur, statut: Onglet, message: string) => {
    setOccupe(f.id)
    const { error } = await supabase.from('fournisseurs_detectes').update({ statut }).eq('id', f.id)
    setOccupe(null)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(message); void recharger()
  }
  /** Crée (ou relie) le prestataire d'UN fournisseur et le passe « suivi ». `connus` = les prestataires déjà là, plus ceux créés plus tôt dans le même lot. */
  const suivreUn = async (f: Fournisseur, connus: readonly Pick<Service, 'id' | 'nom' | 'archived_at'>[]) => {
    let existant = prestatairePour(f, connus)
    let cree = false
    if (!existant) {
      // l'identifiant est choisi ICI : une écriture gardée hors ligne puis renvoyée ne crée jamais deux prestataires
      const id = crypto.randomUUID()
      const { error } = await supabase.from('services').insert({ id, projet_id: projetId, nom: f.nom, devise: deviseProbable(f) })
      if (error) throw error
      existant = { id, nom: f.nom }; cree = true
    }
    const { error } = await supabase.from('fournisseurs_detectes').update({ statut: 'suivi', service_id: existant.id }).eq('id', f.id)
    if (error) throw error
    return { id: existant.id, nom: existant.nom, cree }
  }
  const suivre = async (f: Fournisseur) => {
    setOccupe(f.id)
    try {
      const r = await suivreUn(f, services)
      toast.succes(r.cree ? `« ${f.nom} » ajouté à tes prestataires (devise ${deviseProbable(f)} : change-la avec son crayon).` : `« ${f.nom} » relié au prestataire « ${r.nom} ».`)
      onServicesChange(); void recharger()
    } catch (e) {
      toast.erreur(messageErreur(e as Error))
    } finally { setOccupe(null) }
  }

  // ---- actions groupées
  const basculer = (id: string) => setCoches((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toutChoisir = () => setCoches(toutChoisi(coches, liste) ? new Set() : new Set(liste.map((f) => f.id)))
  /** « Ignorer » / « Remettre » en une seule requête ; « Annuler » (8 s) rend à chacun son état d'avant. En cas de refus, la sélection reste : on peut réessayer. */
  const changerEnLot = async (action: 'ignorer' | 'remettre') => {
    const ids = choisis.map((f) => f.id)
    if (!ids.length) return
    const avant = onglet
    setEnLot(true)
    const { error } = await supabase.from('fournisseurs_detectes').update({ statut: STATUT_APRES_LOT[action] }).in('id', ids)
    setEnLot(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    setCoches(new Set()); void recharger()
    toast.avecAction(phraseLot(action, ids.length), {
      libelle: 'Annuler',
      onClick: async () => {
        // seulement ceux qui sont encore dans l'état posé par l'action : une ligne que tu as changée entre-temps n'est pas défaite
        const { error: e2 } = await supabase.from('fournisseurs_detectes').update({ statut: avant }).in('id', ids).eq('statut', STATUT_APRES_LOT[action])
        if (e2) { toast.erreur(messageErreur(e2)); return }
        toast.succes('Annulé : ils sont revenus dans la liste d’avant.'); void recharger()
      },
    }, DUREE_ANNULATION_MS)
  }
  /** « Suivre » en lot : une confirmation (elle crée des prestataires), puis un par un ; ceux qui échouent restent cochés. */
  const suivreEnLot = async () => {
    const cibles = choisis
    if (!cibles.length) return
    const ok = await confirmer({
      titre: `Suivre ${cibles.length} fournisseur${cibles.length > 1 ? 's' : ''} ?`, libelleOk: libelleLot('suivre', cibles.length),
      texte: (
        <>
          <p>Chacun devient un prestataire de Coûts ; ceux qui existent déjà sont reliés, jamais en double. Tu pourras changer la devise avec le crayon de chaque prestataire.</p>
          <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-sm" data-testid="confirmer-suivre-liste">{cibles.map((f) => <li key={f.id}>{f.nom}</li>)}</ul>
        </>
      ),
    })
    if (!ok) return
    setEnLot(true)
    const connus: Pick<Service, 'id' | 'nom' | 'archived_at'>[] = [...services]
    const rates: string[] = []
    let crees = 0, relies = 0, derniereErreur = ''
    for (const f of cibles) {
      try {
        const r = await suivreUn(f, connus)
        if (r.cree) { crees += 1; connus.push({ id: r.id, nom: r.nom, archived_at: null }) } else relies += 1
      } catch (e) { rates.push(f.id); derniereErreur = messageErreur(e as Error) }
    }
    setEnLot(false)
    setCoches(new Set(rates))
    onServicesChange(); void recharger()
    if (crees + relies) toast.succes(phraseSuivreLot(crees, relies, 0))
    if (rates.length) toast.erreur(`${phraseSuivreLot(0, 0, rates.length)} (${derniereErreur})`)
  }

  const ouverte = etat.ouverte
  const libelleBouton = ouverte ? 'Recherche demandée' : etat.niveau === 'echec' ? 'Réessayer la recherche' : derniere && derniere.statut !== 'annulee' ? 'Actualiser la recherche' : 'Chercher mes fournisseurs'
  return (
    <section className="space-y-2 rounded-2xl border border-bord bg-carte p-3" aria-label="Fournisseurs de factures" data-testid="recherche-fournisseurs">
      <div>
        <h3 className="text-sm font-semibold">Fournisseurs de factures</h3>
        <p className="mt-0.5 text-xs text-texte-2">Claude cherche dans ta boîte mail par mots-clés (facture, invoice, receipt, reçu…). Il ne garde que l’expéditeur, l’objet et la date : jamais le contenu de tes mails.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button variante="primaire" taille="sm" chargement={envoi} disabled={ouverte} onClick={() => void demander()} data-testid="chercher-fournisseurs">
          {etat.niveau === 'echec' || (derniere && derniere.statut !== 'annulee' && !ouverte) ? <RefreshCw size={16} /> : <Search size={16} />}{libelleBouton}
        </Button>
        {ouverte ? <Button taille="sm" variante="discret" onClick={() => void annuler()} data-testid="annuler-recherche">Annuler la demande</Button> : null}
      </div>
      {!charge ? <Chargement texte="Chargement…" /> : erreur ? <Erreur texte={erreur} onReessayer={() => void recharger()} /> : (
        <>
          <div className={`rounded-xl border px-2.5 py-1.5 text-xs ${etat.niveau === 'echec' ? 'border-alerte/50 bg-alerte/10 text-alerte' : 'border-bord text-texte-2'}`}
            data-testid="etat-recherche" data-niveau={etat.niveau} role={etat.niveau === 'echec' ? 'alert' : 'status'}>
            <div className="flex items-start gap-1.5">
              {etat.niveau === 'echec' ? <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden /> : null}
              <span className="font-medium">{etat.titre}</span>
            </div>
            {etat.detail ? <p className="mt-0.5">{etat.detail}</p> : null}
          </div>
          {!fournisseurs.length ? (
            <p className="text-xs text-texte-2" data-testid="fournisseurs-vide">
              {etat.niveau === 'aucune' && !derniere ? 'Touche « Chercher mes fournisseurs » : la liste apparaîtra ici, avec « Suivre » et « Ignorer ».' : ouverte ? 'La liste apparaîtra ici dès que Claude a cherché.' : 'Aucun fournisseur trouvé pour l’instant.'}
            </p>
          ) : (
            <Repliable titre="Fournisseurs trouvés" testId="fournisseurs-liste" ouvert={ouvert} onToggle={setOuvert}
              badge={compte.nouveau ? <Badge teinte="attention">{compte.nouveau} nouveau{compte.nouveau > 1 ? 'x' : ''}</Badge> : <Badge>{fournisseurs.length}</Badge>}>
              <div role="group" aria-label="Fournisseurs" className="mb-2 grid grid-cols-3 gap-1.5">
                {ONGLETS.map((o) => (
                  <Button key={o.valeur} taille="sm" variante={onglet === o.valeur ? 'primaire' : 'secondaire'} aria-pressed={onglet === o.valeur}
                    onClick={() => changerOnglet(o.valeur)} data-testid={`onglet-fournisseur-${o.valeur}`}>{o.libelle} ({compte[o.valeur]})</Button>
                ))}
              </div>
              {actions.length && liste.length ? (
                <div className="mb-1 flex items-center gap-2">
                  {choisir
                    ? <span className="text-xs text-texte-2">Coche les fournisseurs, puis choisis l’action en bas.</span>
                    : <Button taille="sm" variante="secondaire" onClick={() => setChoisir(true)} data-testid="choisir-plusieurs"><ListChecks size={15} aria-hidden />Choisir plusieurs</Button>}
                </div>
              ) : null}
              {!liste.length ? (
                <p className="py-2 text-center text-sm text-texte-2" data-testid="onglet-vide">
                  {onglet === 'nouveau' ? 'Aucun nouveau fournisseur.' : onglet === 'suivi' ? 'Aucun fournisseur suivi pour l’instant : touche « Suivre » sur un nouveau.' : 'Aucun fournisseur ignoré.'}
                </p>
              ) : (
                <ul className="divide-y divide-bord">
                  {liste.map((f) => (
                    <li key={f.id} className="py-2" data-testid="fournisseur" data-cle={f.cle} data-statut={f.statut}>
                      <Ligne choisir={choisir}>
                        {choisir ? <input type="checkbox" aria-label={`Choisir ${f.nom}`} checked={coches.has(f.id)} onChange={() => basculer(f.id)} className="mt-1 h-5 w-5 shrink-0 accent-accent" data-testid="cocher-fournisseur" /> : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <b className="break-words">{f.nom}</b>
                            {f.lecteur ? <Badge teinte="ok" title="Le cockpit sait lire les montants et le PDF de ses reçus">Factures lues tout seul</Badge> : null}
                          </div>
                          <div className="text-xs text-texte-2">{f.expediteur ?? f.domaine} · {libelleMails(f)}</div>
                          {f.exemple_objet ? <div className="truncate text-xs text-texte-2" title={f.exemple_objet}>« {f.exemple_objet} »</div> : null}
                          {!choisir ? (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {f.statut === 'nouveau' ? (
                                <>
                                  <Button taille="sm" variante="primaire" chargement={occupe === f.id} onClick={() => void suivre(f)} data-testid="suivre-fournisseur">Suivre</Button>
                                  <Button taille="sm" variante="discret" disabled={occupe === f.id} onClick={() => void changer(f, 'ignore', `« ${f.nom} » ignoré : il ne reviendra pas dans « Nouveaux ».`)} data-testid="ignorer-fournisseur">Ignorer</Button>
                                </>
                              ) : f.statut === 'suivi' ? (
                                f.service_id && nomService.get(f.service_id)
                                  ? <span className="text-xs text-texte-2" data-testid="prestataire-lie">Prestataire : {nomService.get(f.service_id)}</span>
                                  : (
                                    <>
                                      <span className="text-xs text-texte-2" data-testid="prestataire-lie">Prestataire supprimé.</span>
                                      <Button taille="sm" chargement={occupe === f.id} onClick={() => void suivre(f)} data-testid="suivre-fournisseur">Le recréer</Button>
                                    </>
                                  )
                              ) : (
                                <Button taille="sm" variante="secondaire" chargement={occupe === f.id} onClick={() => void changer(f, 'nouveau', `« ${f.nom} » remis dans « Nouveaux ».`)} data-testid="remettre-fournisseur">Remettre dans la liste</Button>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </Ligne>
                    </li>
                  ))}
                </ul>
              )}
            </Repliable>
          )}
        </>
      )}
      {choisir && ouvert && liste.length ? (
        <div role="region" aria-label="Actions groupées" data-testid="barre-fournisseurs" style={{ bottom: 'var(--nav-h, 0px)' }}
          className="fixed inset-x-0 z-40 border-t border-bord bg-carte px-3 pb-[max(env(safe-area-inset-bottom),10px)] pt-2 shadow-2xl">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 lg:max-w-5xl">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold" data-testid="nb-choisis">{choisis.length} choisi{choisis.length > 1 ? 's' : ''}</span>
              <div className="flex gap-1.5">
                <Button taille="sm" onClick={toutChoisir} data-testid="tout-choisir">{toutChoisi(coches, liste) ? 'Aucun' : 'Tout choisir'}</Button>
                <Button taille="sm" variante="discret" onClick={quitterChoix} data-testid="terminer-choix">Terminer</Button>
              </div>
            </div>
            <div className={`grid gap-2 ${actions.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {actions.map((a) => (
                <Button key={a} taille="sm" variante={a === 'suivre' ? 'primaire' : 'secondaire'} disabled={!choisis.length || enLot} chargement={enLot}
                  onClick={() => void (a === 'suivre' ? suivreEnLot() : changerEnLot(a))} data-testid={`lot-${a}`}>{libelleLot(a, choisis.length)}</Button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/** Une ligne de la liste : en mode « choisir », toute la ligne se touche (case + texte), sinon un simple bloc. */
function Ligne({ choisir, children }: { choisir: boolean; children: ReactNode }) {
  return choisir
    ? <label className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-0.5 active:bg-carte-2">{children}</label>
    : <div className="flex items-start gap-2">{children}</div>
}
