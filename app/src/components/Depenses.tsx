import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, ExternalLink, FileText, Landmark, Pencil, Plus, Send, Settings2, Trash2, TriangleAlert, Wallet } from 'lucide-react'
import { useCockpit, useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { BUCKET_MEDIAS, cheminMedia, tailleLisible } from '../lib/medias.ts'
import { dateRelative } from '../lib/dates.ts'
import { copierTexte } from '../lib/copier.ts'
import {
  PERIODES, PERIODE_DEFAUT, STATUTS_COMPTA, TYPES, destinataireValide, envoyable, estPeriode, formaterMontant, formaterTotaux, grouper, lienDeRepli,
  lireDepense, lireService, parService, resumeCompta, soldeBas, sommer, type Canal, type Depense, type FichierDepense, type Periode, type Service, type TypeDepense,
} from '../lib/depenses.ts'
import { Button } from '../ui/Button.tsx'
import { Badge } from '../ui/Badge.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Champ, Input, Select, Textarea } from '../ui/Champs.tsx'
import { Chargement, Erreur, Vide } from '../ui/Etats.tsx'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'

const PREF_PERIODE = 'periode_couts'
const SUGGESTIONS = ['Supabase', 'Claude', 'RunPod', 'Render', 'GitHub', 'OpenAI', 'Vercel']
const aujourdhui = () => new Date().toISOString().slice(0, 10)
/** Déclenche un téléchargement par un lien (pas window.open : bloqué par les téléphones après un appel réseau). */
function ancrer(url: string, nom: string) {
  const a = document.createElement('a'); a.href = url; a.download = nom; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
}
const lienHttps = (u: string) => !u.trim() || /^https:\/\/\S+$/.test(u.trim())

/** Charge services + dépenses du projet, se met à jour en direct (0052), et dit s'il a échoué. */
function useDonneesDepenses(projetId: string) {
  const [services, setServices] = useState<Service[]>([])
  const [depenses, setDepenses] = useState<Depense[]>([])
  const [charge, setCharge] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const recharger = useCallback(async () => {
    const [s, d] = await Promise.all([
      supabase.from('services').select('*').eq('projet_id', projetId).order('nom'),
      supabase.from('depenses').select('*').eq('projet_id', projetId).order('date', { ascending: false }).limit(5000),
    ])
    const err = s.error ?? d.error
    if (err) { setErreur(messageErreur(err)); setCharge(true); return }
    setServices((s.data ?? []).map((r) => lireService(r as Record<string, unknown>)))
    setDepenses((d.data ?? []).map((r) => lireDepense(r as Record<string, unknown>)))
    setErreur(null); setCharge(true)
  }, [projetId])
  useEffect(() => {
    void recharger()
    const ch = supabase.channel(`depenses-${projetId}`)
    for (const table of ['services', 'depenses']) ch.on('postgres_changes', { event: '*', schema: 'cockpit', table }, () => { void recharger() })
    ch.subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [projetId, recharger])
  return { services, depenses, charge, erreur, recharger }
}

/** Coûts du projet (0052) : prestataires et liens directs, soldes, dépenses par période, factures et envoi à la compta. */
export function CoutsProjet() {
  const { projet, admin, par, now, prefs, poser } = useCockpit()
  const toast = useToast()
  const confirmer = useConfirmer()
  const { services, depenses, charge, erreur, recharger } = useDonneesDepenses(projet.id)
  const periode: Periode = estPeriode(prefs[PREF_PERIODE]) ? (prefs[PREF_PERIODE] as Periode) : PERIODE_DEFAUT
  const [filtreService, setFiltreService] = useState<string>('')
  const [serviceEdit, setServiceEdit] = useState<Partial<Service> | null>(null)
  const [depenseEdit, setDepenseEdit] = useState<Partial<Depense> | null>(null)
  const [reglageCompta, setReglageCompta] = useState(false)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [envoi, setEnvoi] = useState<Depense[] | null>(null)

  const visibles = useMemo(() => depenses.filter((d) => !filtreService || (filtreService === '_aucun' ? d.service_id === null : d.service_id === filtreService)), [depenses, filtreService])
  const paquets = useMemo(() => grouper(visibles, periode), [visibles, periode])
  const totauxService = useMemo(() => parService(depenses), [depenses])
  const nomService = useMemo(() => new Map(services.map((s) => [s.id, s.nom])), [services])
  const aEnvoyer = useMemo(() => depenses.filter(envoyable), [depenses])
  const actifs = services.filter((s) => !s.archived_at)
  const choisiesAEnvoyer = aEnvoyer.filter((d) => selection.has(d.id))

  const basculer = (id: string) => setSelection((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  if (!admin) return null
  if (!charge) return <Chargement texte="Chargement des coûts…" />
  if (erreur && !services.length && !depenses.length) return <Erreur texte={erreur} onReessayer={() => void recharger()} />

  const supprimerService = async (s: Service) => {
    if (!(await confirmer({ titre: `Supprimer « ${s.nom} » ?`, texte: 'Le prestataire disparaît de la liste. Ses dépenses restent, rangées « Sans prestataire ».', libelleOk: 'Supprimer', danger: true }))) return
    const { error } = await supabase.from('services').delete().eq('id', s.id)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(`« ${s.nom} » supprimé.`); void recharger()
  }
  const supprimerDepense = async (d: Depense) => {
    if (!(await confirmer({ titre: 'Supprimer cette dépense ?', texte: `${formaterMontant(d.montant, d.devise)} du ${d.date}${d.fichier ? ' — la pièce jointe est supprimée aussi' : ''}. Cette action est définitive.`, libelleOk: 'Supprimer', danger: true }))) return
    const { error } = await supabase.from('depenses').delete().eq('id', d.id)
    if (error) { toast.erreur(messageErreur(error)); return }
    if (d.fichier) void supabase.storage.from(BUCKET_MEDIAS).remove([d.fichier.chemin])
    setSelection((s) => { const n = new Set(s); n.delete(d.id); return n })
    toast.succes('Dépense supprimée.'); void recharger()
  }
  const changerStatut = async (d: Depense, statut: 'a_envoyer' | 'sans_objet') => {
    const { error } = await supabase.from('depenses').update({ compta_statut: statut, compta_at: null, compta_par: null, compta_canal: null }).eq('id', d.id)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(statut === 'a_envoyer' ? 'Remise dans « À envoyer ».' : 'Marquée « sans objet » : elle ne sera pas envoyée.'); void recharger()
  }
  const telecharger = async (f: FichierDepense) => {
    const { data, error } = await supabase.storage.from(BUCKET_MEDIAS).createSignedUrl(f.chemin, 120, { download: f.nom })
    if (error || !data) { toast.erreur(`Téléchargement impossible : ${messageErreur(error)}`); return }
    ancrer(data.signedUrl, f.nom)
  }

  const toutVide = !services.length && !depenses.length
  return (
    <section aria-label="Coûts du projet" data-testid="couts-projet" className="space-y-4">
      {erreur ? <Erreur texte={erreur} onReessayer={() => void recharger()} /> : null}

      {/* Prestataires : accès direct, solde, alerte */}
      <div className="space-y-2" data-testid="services">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Prestataires du projet</h3>
          <Button taille="sm" onClick={() => setServiceEdit({ devise: 'USD' })} data-testid="service-ajouter"><Plus size={16} />Prestataire</Button>
        </div>
        {!actifs.length ? (
          <Vide icone={<Wallet size={28} strokeWidth={1.5} />} titre="Aucun prestataire"
            texte="Ajoute les services que ce projet utilise (Supabase, Claude, RunPod…) : accès direct à leur tableau de bord et à leurs factures, solde, alerte."
            action={<div className="flex flex-wrap justify-center gap-1.5">{SUGGESTIONS.slice(0, 4).map((n) => <Button key={n} taille="sm" onClick={() => setServiceEdit({ nom: n, devise: 'USD' })}>+ {n}</Button>)}</div>} />
        ) : actifs.map((s) => {
          const tot = totauxService.get(s.id)
          return (
            <article key={s.id} className="rounded-2xl border border-bord bg-carte p-3" data-testid="service" data-nom={s.nom}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{s.nom}</div>
                  <div className="text-xs text-texte-2">Dépensé en tout : {formaterTotaux(tot ?? {})}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button taille="sm" variante="discret" aria-label={`Modifier ${s.nom}`} onClick={() => setServiceEdit(s)}><Pencil size={16} /></Button>
                  <Button taille="sm" variante="discret" aria-label={`Supprimer ${s.nom}`} onClick={() => void supprimerService(s)}><Trash2 size={16} /></Button>
                </div>
              </div>
              {s.solde !== null ? (
                <div className={`mt-2 flex flex-wrap items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm ${soldeBas(s) ? 'border-alerte/50 text-alerte' : 'border-bord'}`} data-testid="solde" data-bas={soldeBas(s)}>
                  {soldeBas(s) ? <TriangleAlert size={16} aria-hidden /> : <Landmark size={16} aria-hidden />}
                  <b>Solde : {formaterMontant(s.solde, s.devise)}</b>
                  <span className="text-xs text-texte-2">saisi {dateRelative(s.solde_at, now) || '—'}{soldeBas(s) ? ` · sous ton seuil de ${formaterMontant(s.seuil_alerte ?? 0, s.devise)} : recharge` : ''}</span>
                </div>
              ) : null}
              {s.note ? <p className="mt-1.5 text-xs text-texte-2">{s.note}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.url_tableau ? <a className="inline-flex h-8 items-center gap-1 rounded-xl border border-bord px-2.5 text-sm hover:bg-carte-2" href={s.url_tableau} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Tableau de bord</a> : null}
                {s.url_factures ? <a className="inline-flex h-8 items-center gap-1 rounded-xl border border-bord px-2.5 text-sm hover:bg-carte-2" href={s.url_factures} target="_blank" rel="noopener noreferrer"><FileText size={14} />Factures</a> : null}
                {!s.url_tableau && !s.url_factures ? <span className="text-xs text-texte-2">Aucun lien : touche le crayon pour coller l’adresse de son tableau de bord.</span> : null}
              </div>
            </article>
          )
        })}
      </div>

      {/* Dépenses par période */}
      <div className="space-y-2" data-testid="depenses">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Dépenses</h3>
          <Button taille="sm" variante="primaire" onClick={() => setDepenseEdit({ date: aujourdhui(), devise: actifs[0]?.devise ?? 'USD', type: 'facture', service_id: actifs[0]?.id ?? null })} data-testid="depense-ajouter"><Plus size={16} />Dépense</Button>
        </div>
        <div role="group" aria-label="Période" className="grid grid-cols-4 gap-1.5" data-testid="periodes">
          {PERIODES.map((p) => (
            <Button key={p.valeur} taille="sm" variante={periode === p.valeur ? 'primaire' : 'secondaire'} aria-pressed={periode === p.valeur}
              onClick={() => { void poser(PREF_PERIODE, p.valeur).catch((e: Error) => toast.erreur(e.message)) }}>{p.libelle}</Button>
          ))}
        </div>
        {actifs.length > 1 || filtreService ? (
          <Select aria-label="Filtrer par prestataire" value={filtreService} onChange={(e) => setFiltreService(e.target.value)}>
            <option value="">Tous les prestataires</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
            <option value="_aucun">Sans prestataire</option>
          </Select>
        ) : null}
        {!paquets.length ? (
          <Vide icone={<Wallet size={28} strokeWidth={1.5} />} titre="Aucune dépense enregistrée"
            texte={toutVide ? 'Le cockpit ne lit pas encore tout seul les comptes de tes prestataires : ajoute une dépense (facture, consommation, recharge) avec « + Dépense », en joignant la facture si tu l’as.' : 'Rien pour ce filtre.'} />
        ) : paquets.map((p) => (
          <div key={p.cle} className="rounded-2xl border border-bord bg-carte" data-testid="periode-paquet" data-cle={p.cle}>
            <div className="flex items-baseline justify-between gap-2 border-b border-bord px-3 py-2">
              <span className="font-medium">{p.libelle}</span>
              <span className="text-sm font-semibold" data-testid="total-periode">{formaterTotaux(p.totaux)}</span>
            </div>
            <ul className="divide-y divide-bord">
              {p.depenses.map((d) => (
                <li key={d.id} className="flex items-start gap-2 px-3 py-2" data-testid="depense" data-statut={d.compta_statut}>
                  {envoyable(d) ? <input type="checkbox" className="mt-1.5 h-5 w-5 shrink-0 accent-[var(--accent)]" checked={selection.has(d.id)} onChange={() => basculer(d.id)} aria-label={`Sélectionner la facture du ${d.date}`} />
                    : <span className="w-5 shrink-0" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <b>{formaterMontant(d.montant, d.devise)}</b>
                      <span className="text-sm">{(d.service_id && nomService.get(d.service_id)) || 'Sans prestataire'}</span>
                      <span className="text-xs text-texte-2">{d.date}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-texte-2">
                      <Badge teinte="neutre">{TYPES[d.type]}</Badge>
                      {d.type === 'facture' ? <Badge teinte={d.compta_statut === 'envoye' ? 'ok' : d.compta_statut === 'sans_objet' ? 'neutre' : 'attention'} title={d.compta_at ? `Le ${new Date(d.compta_at).toLocaleString('fr-FR')} par ${d.compta_par ?? '?'}` : undefined}>{d.compta_statut === 'envoye' ? `Envoyée à la compta ${dateRelative(d.compta_at, now)}` : STATUTS_COMPTA[d.compta_statut]}</Badge> : null}
                      {d.reference ? <span>réf. {d.reference}</span> : null}
                      {d.description ? <span className="truncate">{d.description}</span> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.fichier ? <Button taille="sm" onClick={() => void telecharger(d.fichier!)} aria-label={`Télécharger ${d.fichier.nom}`}><Download size={14} />{d.fichier.nom.length > 22 ? `${d.fichier.nom.slice(0, 20)}…` : d.fichier.nom}</Button> : null}
                      {d.type === 'facture' && d.compta_statut === 'a_envoyer' ? <Button taille="sm" onClick={() => setEnvoi([d])}><Send size={14} />Compta</Button> : null}
                      {d.type === 'facture' && d.compta_statut === 'a_envoyer' ? <Button taille="sm" variante="discret" onClick={() => void changerStatut(d, 'sans_objet')}>Sans objet</Button> : null}
                      {d.type === 'facture' && d.compta_statut !== 'a_envoyer' ? <Button taille="sm" variante="discret" onClick={() => void changerStatut(d, 'a_envoyer')}>Remettre à envoyer</Button> : null}
                      <Button taille="sm" variante="discret" aria-label="Modifier la dépense" onClick={() => setDepenseEdit(d)}><Pencil size={14} /></Button>
                      <Button taille="sm" variante="discret" aria-label="Supprimer la dépense" onClick={() => void supprimerDepense(d)}><Trash2 size={14} /></Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {depenses.some((d) => d.type === 'recharge') ? <p className="text-xs text-texte-2">Les recharges de crédit ne comptent pas dans les totaux : ce n’est pas un coût, c’est de l’argent mis de côté. Les devises ne sont jamais converties.</p> : null}
      </div>

      {/* Compta */}
      <div className="rounded-2xl border border-bord bg-carte p-3" data-testid="compta">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Compta</h3>
          <Button taille="sm" variante="discret" onClick={() => setReglageCompta(true)}><Settings2 size={16} />Destinataire</Button>
        </div>
        <p className="mt-1 text-xs text-texte-2">
          {destinataireValide((projet.compta_canal ?? null) as Canal | null, projet.compta_destinataire ?? null)
            ? <>Les factures partent vers <b>{projet.compta_destinataire}</b> ({projet.compta_canal === 'email' ? 'e-mail' : projet.compta_canal === 'whatsapp' ? 'WhatsApp' : 'autre'}).</>
            : 'Aucun destinataire réglé : touche « Destinataire » (e-mail ou WhatsApp de ta compta ou de son bot).'}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button taille="sm" onClick={() => setSelection(new Set(aEnvoyer.map((d) => d.id)))} disabled={!aEnvoyer.length}>Tout sélectionner ({aEnvoyer.length})</Button>
          {selection.size ? <Button taille="sm" variante="discret" onClick={() => setSelection(new Set())}>Tout désélectionner</Button> : null}
          <Button taille="sm" variante="primaire" disabled={!choisiesAEnvoyer.length} onClick={() => setEnvoi(choisiesAEnvoyer)} data-testid="envoyer-compta"><Send size={14} />Envoyer à la compta ({choisiesAEnvoyer.length})</Button>
        </div>
        {!aEnvoyer.length ? <p className="mt-2 text-xs text-texte-2">Aucune facture en attente d’envoi.</p> : null}
      </div>

      {serviceEdit ? <FormService init={serviceEdit} projetId={projet.id} onFermer={() => setServiceEdit(null)} onFait={() => { setServiceEdit(null); void recharger() }} /> : null}
      {depenseEdit ? <FormDepense init={depenseEdit} projetId={projet.id} services={actifs} onFermer={() => setDepenseEdit(null)} onFait={() => { setDepenseEdit(null); void recharger() }} /> : null}
      {reglageCompta ? <FormCompta projetId={projet.id} canal={(projet.compta_canal ?? 'email') as Canal} destinataire={projet.compta_destinataire ?? ''} onFermer={() => setReglageCompta(false)} /> : null}
      {envoi ? <EnvoiCompta factures={envoi} services={services} projetNom={projet.nom} canal={(projet.compta_canal ?? null) as Canal | null} destinataire={projet.compta_destinataire ?? null} par={par}
        onFermer={() => setEnvoi(null)} onFait={() => { setEnvoi(null); setSelection(new Set()); void recharger() }} /> : null}
    </section>
  )
}

function FormService({ init, projetId, onFermer, onFait }: { init: Partial<Service>; projetId: string; onFermer: () => void; onFait: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ nom: init.nom ?? '', url_tableau: init.url_tableau ?? '', url_factures: init.url_factures ?? '', devise: init.devise ?? 'USD', solde: init.solde != null ? String(init.solde) : '', seuil: init.seuil_alerte != null ? String(init.seuil_alerte) : '', note: init.note ?? '' })
  const [enCours, setEnCours] = useState(false)
  const soldeNum = f.solde.trim() === '' ? null : Number(f.solde.replace(',', '.'))
  const seuilNum = f.seuil.trim() === '' ? null : Number(f.seuil.replace(',', '.'))
  const erreur = !f.nom.trim() ? 'Le nom est obligatoire.' : !lienHttps(f.url_tableau) || !lienHttps(f.url_factures) ? 'Un lien doit commencer par https://' : !/^[A-Za-z]{3}$/.test(f.devise) ? 'Devise sur 3 lettres (USD, EUR, ILS…).'
    : (soldeNum !== null && !Number.isFinite(soldeNum)) || (seuilNum !== null && (!Number.isFinite(seuilNum) || seuilNum < 0)) ? 'Solde et seuil : des nombres.' : null
  const enregistrer = async () => {
    if (erreur) return
    setEnCours(true)
    const soldeChange = soldeNum !== (init.solde ?? null)
    const valeurs = { nom: f.nom.trim(), url_tableau: f.url_tableau.trim() || null, url_factures: f.url_factures.trim() || null, devise: f.devise.toUpperCase(), solde: soldeNum,
      ...(soldeChange ? { solde_at: soldeNum === null ? null : new Date().toISOString() } : {}), seuil_alerte: seuilNum, note: f.note.trim() || null }
    const { error } = init.id ? await supabase.from('services').update(valeurs).eq('id', init.id) : await supabase.from('services').insert({ ...valeurs, projet_id: projetId })
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(init.id ? 'Prestataire mis à jour.' : `« ${valeurs.nom} » ajouté.`); onFait()
  }
  return (
    <Dialog ouvert onFermer={onFermer} titre={init.id ? 'Modifier le prestataire' : 'Nouveau prestataire'} brouillon={!init.id && !!f.nom}
      pied={<><Button onClick={onFermer}>Annuler</Button><Button variante="primaire" chargement={enCours} disabled={!!erreur} onClick={() => void enregistrer()}>Enregistrer</Button></>}>
      <div className="space-y-3">
        {!init.id ? <div className="flex flex-wrap gap-1.5">{SUGGESTIONS.map((n) => <Button key={n} taille="sm" onClick={() => setF({ ...f, nom: n })}>{n}</Button>)}</div> : null}
        <Champ label="Nom"><Input value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} placeholder="RunPod" /></Champ>
        <Champ label="Tableau de bord (lien)" aide="La page où tu gères ce service."><Input inputMode="url" value={f.url_tableau} onChange={(e) => setF({ ...f, url_tableau: e.target.value })} placeholder="https://…" /></Champ>
        <Champ label="Page des factures (lien)" aide="Là où tu télécharges ses factures."><Input inputMode="url" value={f.url_factures} onChange={(e) => setF({ ...f, url_factures: e.target.value })} placeholder="https://…" /></Champ>
        <div className="grid grid-cols-3 gap-2">
          <Champ label="Devise"><Input value={f.devise} maxLength={3} onChange={(e) => setF({ ...f, devise: e.target.value.toUpperCase() })} /></Champ>
          <Champ label="Solde"><Input inputMode="decimal" value={f.solde} onChange={(e) => setF({ ...f, solde: e.target.value })} placeholder="—" /></Champ>
          <Champ label="Alerte sous"><Input inputMode="decimal" value={f.seuil} onChange={(e) => setF({ ...f, seuil: e.target.value })} placeholder="—" /></Champ>
        </div>
        <p className="-mt-1 text-xs text-texte-2">Le solde est celui que tu saisis (le cockpit ne lit pas encore les comptes seul) ; l’alerte s’affiche quand il passe sous le seuil.</p>
        <Champ label="Note"><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={2} /></Champ>
        {erreur ? <p className="text-sm text-alerte" role="alert">{erreur}</p> : null}
      </div>
    </Dialog>
  )
}

function FormDepense({ init, projetId, services, onFermer, onFait }: { init: Partial<Depense>; projetId: string; services: Service[]; onFermer: () => void; onFait: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ service_id: init.service_id ?? '', date: init.date ?? aujourdhui(), montant: init.montant != null ? String(init.montant) : '', devise: init.devise ?? 'USD', type: (init.type ?? 'facture') as TypeDepense, reference: init.reference ?? '', description: init.description ?? '' })
  const [fichier, setFichier] = useState<FichierDepense | null>(init.fichier ?? null)
  const [envoye, setEnvoye] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const nouveauxChemins = useRef<string[]>([])
  const montantNum = Number(f.montant.replace(',', '.'))
  const erreur = !f.montant.trim() || !Number.isFinite(montantNum) || montantNum < 0 ? 'Montant : un nombre positif.' : !/^\d{4}-\d{2}-\d{2}$/.test(f.date) ? 'Date invalide.' : !/^[A-Za-z]{3}$/.test(f.devise) ? 'Devise sur 3 lettres.' : null
  const choisir = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fic = e.target.files?.[0]; e.target.value = ''
    if (!fic) return
    if (fic.size > 50 * 1024 * 1024) { toast.erreur('Fichier trop lourd (50 Mo au plus).'); return }
    setEnvoye(true)
    const chemin = cheminMedia(projetId, 'depenses', crypto.randomUUID(), fic.name)
    const { error } = await supabase.storage.from(BUCKET_MEDIAS).upload(chemin, fic, { contentType: fic.type || undefined, upsert: false })
    setEnvoye(false)
    if (error) { toast.erreur(`Dépôt impossible : ${messageErreur(error)}`); return }
    nouveauxChemins.current.push(chemin)
    setFichier({ chemin, nom: fic.name, type: fic.type || 'application/octet-stream', taille: fic.size })
  }
  const enregistrer = async () => {
    if (erreur) return
    setEnCours(true)
    const valeurs = { service_id: f.service_id || null, date: f.date, montant: montantNum, devise: f.devise.toUpperCase(), type: f.type, reference: f.reference.trim() || null, description: f.description.trim(), fichier }
    const { error } = init.id ? await supabase.from('depenses').update(valeurs).eq('id', init.id) : await supabase.from('depenses').insert({ ...valeurs, projet_id: projetId })
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    // La pièce remplacée ou retirée n'est plus référencée : on la supprime du stockage.
    const ancien = init.fichier?.chemin
    if (ancien && ancien !== fichier?.chemin) void supabase.storage.from(BUCKET_MEDIAS).remove([ancien])
    nouveauxChemins.current = []
    toast.succes(init.id ? 'Dépense mise à jour.' : 'Dépense ajoutée.'); onFait()
  }
  const fermer = () => { if (nouveauxChemins.current.length) void supabase.storage.from(BUCKET_MEDIAS).remove(nouveauxChemins.current); onFermer() }
  return (
    <Dialog ouvert onFermer={fermer} titre={init.id ? 'Modifier la dépense' : 'Nouvelle dépense'} brouillon={!init.id && (!!f.montant || !!fichier)}
      pied={<><Button onClick={fermer}>Annuler</Button><Button variante="primaire" chargement={enCours} disabled={!!erreur || envoye} onClick={() => void enregistrer()}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <Champ label="Type">
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as TypeDepense })}>
            {(Object.keys(TYPES) as TypeDepense[]).map((t) => <option key={t} value={t}>{TYPES[t]}</option>)}
          </Select>
        </Champ>
        <Champ label="Prestataire">
          <Select value={f.service_id} onChange={(e) => { const s = services.find((x) => x.id === e.target.value); setF({ ...f, service_id: e.target.value, devise: s?.devise ?? f.devise }) }}>
            <option value="">Aucun</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
          </Select>
        </Champ>
        <div className="grid grid-cols-3 gap-2">
          <Champ label="Montant" className="col-span-2"><Input inputMode="decimal" value={f.montant} onChange={(e) => setF({ ...f, montant: e.target.value })} placeholder="0,00" /></Champ>
          <Champ label="Devise"><Input value={f.devise} maxLength={3} onChange={(e) => setF({ ...f, devise: e.target.value.toUpperCase() })} /></Champ>
        </div>
        <Champ label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Champ>
        <Champ label="N° de facture (facultatif)"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Champ>
        <Champ label="Description (facultatif)"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="GPU A100, 14 h…" /></Champ>
        <div>
          <span className="mb-1 block text-sm font-medium text-texte-2">Facture (PDF ou image)</span>
          {fichier ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-bord px-3 py-2 text-sm">
              <span className="min-w-0 truncate"><FileText size={14} className="mr-1 inline" />{fichier.nom} · {tailleLisible(fichier.taille)}</span>
              <Button taille="sm" variante="discret" onClick={() => setFichier(null)}>Retirer</Button>
            </div>
          ) : (
            <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-bord text-sm text-texte-2 hover:bg-carte-2">
              {envoye ? 'Dépôt en cours…' : 'Joindre un fichier'}
              <input type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => void choisir(e)} disabled={envoye} data-testid="depense-fichier" />
            </label>
          )}
        </div>
        {erreur ? <p className="text-sm text-alerte" role="alert">{erreur}</p> : null}
      </div>
    </Dialog>
  )
}

function FormCompta({ projetId, canal: c0, destinataire: d0, onFermer }: { projetId: string; canal: Canal; destinataire: string; onFermer: () => void }) {
  const toast = useToast()
  const { rechargerProjets } = useGlobal()
  const [canal, setCanal] = useState<Canal>(c0)
  const [dest, setDest] = useState(d0)
  const [enCours, setEnCours] = useState(false)
  const valide = destinataireValide(canal, dest)
  const enregistrer = async () => {
    setEnCours(true)
    const { error } = await supabase.from('projets').update({ compta_canal: dest.trim() ? canal : null, compta_destinataire: dest.trim() || null }).eq('id', projetId)
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(dest.trim() ? 'Destinataire de la compta enregistré.' : 'Destinataire retiré.')
    await rechargerProjets(); onFermer()
  }
  return (
    <Dialog ouvert onFermer={onFermer} titre="Où partent les factures ?"
      pied={<><Button onClick={onFermer}>Annuler</Button><Button variante="primaire" chargement={enCours} disabled={!!dest.trim() && !valide} onClick={() => void enregistrer()}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <Champ label="Par quel moyen ?">
          <Select value={canal} onChange={(e) => setCanal(e.target.value as Canal)}>
            <option value="email">E-mail</option><option value="whatsapp">WhatsApp</option><option value="autre">Autre (bot, plateforme…)</option>
          </Select>
        </Champ>
        <Champ label={canal === 'email' ? 'Adresse e-mail' : canal === 'whatsapp' ? 'Numéro WhatsApp (avec l’indicatif)' : 'Nom du destinataire'}
          aide="Le cockpit n’envoie jamais seul : à chaque envoi, tu valides depuis ton téléphone (partage de fichiers vers l’app choisie).">
          <Input value={dest} onChange={(e) => setDest(e.target.value)} inputMode={canal === 'email' ? 'email' : canal === 'whatsapp' ? 'tel' : 'text'} placeholder={canal === 'email' ? 'compta@exemple.fr' : canal === 'whatsapp' ? '+972…' : 'Bot compta'} />
        </Champ>
        {dest.trim() && !valide ? <p className="text-sm text-alerte" role="alert">{canal === 'email' ? 'Adresse e-mail invalide.' : 'Numéro invalide (au moins 8 chiffres, avec l’indicatif).'}</p> : null}
      </div>
    </Dialog>
  )
}

/** Aperçu (résumé + pièces) puis envoi : partage du téléphone avec les fichiers ; sinon marche manuelle. Marqué « envoyé » seulement après le geste de Raphaël. */
function EnvoiCompta({ factures, services, projetNom, canal, destinataire, par, onFermer, onFait }: {
  factures: Depense[]; services: Service[]; projetNom: string; canal: Canal | null; destinataire: string | null; par: string; onFermer: () => void; onFait: () => void
}) {
  const toast = useToast()
  const [etape, setEtape] = useState<'apercu' | 'manuel'>('apercu')
  const [enCours, setEnCours] = useState(false)
  const resume = useMemo(() => resumeCompta(factures, services, projetNom), [factures, services, projetNom])
  const sujet = `Factures ${projetNom} (${factures.length})`
  const avecPiece = factures.filter((f) => f.fichier)
  const lien = lienDeRepli(canal, destinataire, sujet, resume)
  const total = sommer(factures)

  const marquer = async () => {
    const { error } = await supabase.from('depenses').update({ compta_statut: 'envoye', compta_at: new Date().toISOString(), compta_par: par, compta_canal: canal ?? 'autre' }).in('id', factures.map((f) => f.id))
    if (error) { toast.erreur(`Envoyée, mais le statut n’a pas pu être enregistré : ${messageErreur(error)}`); return false }
    toast.succes(`${factures.length} facture${factures.length > 1 ? 's' : ''} marquée${factures.length > 1 ? 's' : ''} « envoyée à la compta ».`)
    return true
  }
  const partager = async () => {
    setEnCours(true)
    try {
      const fichiers: File[] = []
      for (const f of avecPiece) {
        const { data, error } = await supabase.storage.from(BUCKET_MEDIAS).download(f.fichier!.chemin)
        if (error || !data) throw new Error(`Pièce « ${f.fichier!.nom} » illisible : ${messageErreur(error)}`)
        fichiers.push(new File([data], f.fichier!.nom, { type: f.fichier!.type }))
      }
      const donnees: ShareData = { title: sujet, text: resume, files: fichiers }
      if (typeof navigator.share !== 'function' || (fichiers.length && !navigator.canShare?.({ files: fichiers }))) { setEtape('manuel'); return }
      try { await navigator.share(donnees) }
      catch (e) {
        if ((e as Error).name === 'AbortError') { toast.info('Envoi annulé : rien n’est marqué.'); return }
        setEtape('manuel'); return
      }
      if (await marquer()) onFait()
    } catch (e) { toast.erreur(messageErreur(e)) } finally { setEnCours(false) }
  }
  const telechargerTout = async () => {
    for (const f of avecPiece) {
      const { data, error } = await supabase.storage.from(BUCKET_MEDIAS).createSignedUrl(f.fichier!.chemin, 120, { download: f.fichier!.nom })
      if (error || !data) { toast.erreur(`Téléchargement impossible : ${messageErreur(error)}`); return }
      ancrer(data.signedUrl, f.fichier!.nom)
    }
  }
  const confirmerManuel = async () => { setEnCours(true); const ok = await marquer(); setEnCours(false); if (ok) onFait() }

  return (
    <Dialog ouvert onFermer={onFermer} titre={`Envoyer ${factures.length} facture${factures.length > 1 ? 's' : ''} à la compta`} large
      pied={etape === 'apercu'
        ? <><Button onClick={onFermer}>Annuler</Button><Button variante="primaire" chargement={enCours} onClick={() => void partager()} data-testid="partager"><Send size={16} />Envoyer</Button></>
        : <><Button onClick={onFermer}>Pas envoyé</Button><Button variante="primaire" chargement={enCours} onClick={() => void confirmerManuel()} data-testid="marquer-envoye">C’est envoyé : marquer</Button></>}>
      <div className="space-y-3" data-testid="envoi-compta">
        {etape === 'apercu' ? (
          <>
            <pre className="whitespace-pre-wrap rounded-xl border border-bord bg-carte-2 p-3 text-sm" data-testid="resume-compta">{resume}</pre>
            <p className="text-xs text-texte-2">
              {avecPiece.length} pièce{avecPiece.length > 1 ? 's' : ''} jointe{avecPiece.length > 1 ? 's' : ''}. « Envoyer » ouvre le partage de ton téléphone avec le résumé et les fichiers : choisis WhatsApp ou ton e-mail
              {destinataire ? <> (destinataire réglé : <b>{destinataire}</b>)</> : null}. Le statut passe à « envoyée à la compta » une fois le partage terminé ; si tu annules, rien n’est marqué.
            </p>
            {!destinataireValide(canal, destinataire) ? <p className="text-sm text-attention" role="alert">Aucun destinataire valide réglé : tu le choisiras toi-même dans le partage.</p> : null}
            {factures.length - avecPiece.length ? <p className="text-sm text-attention" role="alert">{factures.length - avecPiece.length} facture(s) sans pièce jointe : seul le résumé partira pour elle(s).</p> : null}
            <p className="text-xs text-texte-2">Total : {formaterTotaux(total)}</p>
          </>
        ) : (
          <>
            <p className="text-sm">Le partage de fichiers n’est pas disponible ici (ordinateur ou navigateur sans cette fonction). Fais-le à la main, dans cet ordre :</p>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {avecPiece.length ? <li><Button taille="sm" onClick={() => void telechargerTout()}><Download size={14} />Télécharger les {avecPiece.length} pièce(s)</Button></li> : null}
              <li><Button taille="sm" onClick={async () => { if (await copierTexte(resume)) toast.succes('Résumé copié.'); else toast.erreur('Copie impossible : sélectionne le texte à la main.') }}>Copier le résumé</Button></li>
              <li>{lien ? <a className="inline-flex h-8 items-center gap-1 rounded-xl border border-bord px-2.5 hover:bg-carte-2" href={lien} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Ouvrir {canal === 'email' ? 'l’e-mail' : 'WhatsApp'} pré-rempli</a> : 'Ouvre ta messagerie et colle le résumé.'}</li>
              <li>Joins les fichiers téléchargés et envoie.</li>
              <li>Reviens ici et touche « C’est envoyé : marquer ».</li>
            </ol>
          </>
        )}
      </div>
    </Dialog>
  )
}
