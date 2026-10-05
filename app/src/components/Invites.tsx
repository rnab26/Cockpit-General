import { useCallback, useEffect, useState } from 'react'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { Button } from '../ui/Button.tsx'
import { Champ, Input, Select } from '../ui/Champs.tsx'
import { AIDE_ROLE, DROITS, LIBELLE_ROLE, droitEffectif, ecartsDuModele, lienInvitation, resumeDroits, type Droit, type Droits } from '../lib/invitation.ts'

type MembreDetail = { user_id: string; email: string; nom: string | null; role: string; depuis: string; nb_actions: number; derniere_action: string | null; droits: Droits | null }
type InvitationLigne = { id: string; role: string; nom: string | null; created_at: string; expire_at: string; etat: string; droits: Droits | null }
type Entree = { quand: string; user_id: string; email: string | null; nature: string; texte: string; chantier_id: string | null; chantier_titre: string | null }

const quand = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

/** Invités d'un projet (admin) : inviter par lien, droits, retirer, et journal « qui a fait quoi ». */
export function Invites({ projetId, projetNom }: { projetId: string; projetNom: string }) {
  const toast = useToast()
  const confirmer = useConfirmer()
  const [membres, setMembres] = useState<MembreDetail[] | null>(null)
  const [invitations, setInvitations] = useState<InvitationLigne[] | null>(null)
  const [journal, setJournal] = useState<Entree[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [nom, setNom] = useState('')
  const [role, setRole] = useState('suggere')
  const [jours, setJours] = useState('7')
  const [perso, setPerso] = useState<Record<Droit, boolean> | null>(null)
  const [lien, setLien] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const charger = useCallback(async () => {
    const [m, i, j] = await Promise.all([
      supabase.rpc('membres_detail', { p_projet: projetId }),
      supabase.rpc('invitations_du_projet', { p_projet: projetId }),
      supabase.rpc('journal_invites', { p_projet: projetId, p_limite: 60 }),
    ])
    const e = m.error ?? i.error ?? j.error
    if (e) { setErreur(messageErreur(e)); return }
    setErreur(null)
    setMembres((m.data ?? []) as MembreDetail[]); setInvitations((i.data ?? []) as InvitationLigne[]); setJournal((j.data ?? []) as Entree[])
  }, [projetId])
  useEffect(() => { setMembres(null); setInvitations(null); setJournal(null); setLien(null); setNom(''); void charger() }, [charger])

  const copier = async (texte: string) => {
    try { await navigator.clipboard.writeText(texte); toast.succes('Lien copié.') } catch { toast.erreur('Copie impossible : sélectionne le lien à la main.') }
  }
  const inviter = async () => {
    setEnCours(true)
    const { data, error } = await supabase.rpc('inviter', { p_projet: projetId, p_role: role, p_nom: nom.trim() || null, p_jours: Number(jours), p_droits: perso ? ecartsDuModele(role, perso) : null })
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    const l = lienInvitation(String(data))
    setLien(l); setNom(''); setPerso(null); toast.succes('Invitation créée : copie le lien et envoie-le toi-même.')
    void copier(l)
    await charger()
  }
  const revoquer = async (i: InvitationLigne) => {
    const ok = await confirmer({ titre: 'Retirer cette invitation ?', danger: true, libelleOk: 'Retirer', texte: 'Le lien ne fonctionnera plus.' })
    if (!ok) return
    const { error } = await supabase.rpc('revoquer_invitation', { p_id: i.id })
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes('Invitation retirée.'); await charger()
  }
  const changerRole = async (m: MembreDetail, r: string) => {
    const { error } = await supabase.rpc('changer_role_membre', { p_projet: projetId, p_user: m.user_id, p_role: r })
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(`${m.email} : ${LIBELLE_ROLE[r]}.`); await charger()
  }
  const changerDroit = async (m: MembreDetail, d: Droit, v: boolean) => {
    const voulu = Object.fromEntries(DROITS.map(({ cle }) => [cle, cle === d ? v : droitEffectif(m.role, m.droits, cle)])) as Record<Droit, boolean>
    await poserDroits(m, ecartsDuModele(m.role, voulu), `${m.email} : droits mis à jour.`)
  }
  const poserDroits = async (m: MembreDetail, droits: Droits | null, message: string) => {
    const { error } = await supabase.rpc('changer_droits_membre', { p_projet: projetId, p_user: m.user_id, p_droits: droits })
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(message); await charger()
  }
  const retirer = async (m: MembreDetail) => {
    const ok = await confirmer({ titre: `Retirer ${m.email} ?`, danger: true, libelleOk: 'Retirer', texte: `Cette personne ne verra plus « ${projetNom} ». Ce qu’elle a écrit reste, avec son nom.` })
    if (!ok) return
    const { error } = await supabase.from('membres').delete().eq('projet_id', projetId).eq('user_id', m.user_id)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(`${m.email} retiré.`); await charger()
  }

  const attente = (invitations ?? []).filter((i) => i.etat === 'en attente')
  return (
    <section data-testid="invites" className="space-y-4">
      <h3 className="text-sm font-semibold">Invités</h3>
      {erreur ? <p role="alert" className="rounded-lg border border-alerte p-2 text-sm text-alerte">{erreur} <button type="button" className="underline" onClick={() => void charger()}>Réessayer</button></p> : null}

      {membres === null && !erreur ? <p className="text-sm text-texte-2">Chargement…</p> : null}
      {membres && membres.length === 0 ? <p className="text-sm text-texte-2">Personne pour l’instant : toi seul vois ce projet. Crée un lien d’invitation ci-dessous.</p> : null}
      {membres && membres.length > 0 ? (
        <ul className="space-y-2">
          {membres.map((m) => (
            <li key={m.user_id} className="rounded-lg border border-bord p-3 text-sm" data-testid="invite">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="truncate font-medium">{m.nom ? `${m.nom} · ` : ''}{m.email}</div>
                  <div className="text-xs text-texte-2">Depuis le {quand(m.depuis)} · {m.nb_actions} action{m.nb_actions > 1 ? 's' : ''}{m.derniere_action ? ` · dernière le ${quand(m.derniere_action)}` : ''}</div></div>
                <Button taille="sm" variante="discret" className="text-alerte" onClick={() => retirer(m)}>Retirer</Button>
              </div>
              <Select aria-label={`Droits de ${m.email}`} className="mt-2" value={m.role} onChange={(e) => void changerRole(m, e.target.value)}>
                {Object.entries(LIBELLE_ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <fieldset className="mt-2 space-y-1" data-testid="droits-invite">
                <legend className="text-xs font-semibold">Droits de cette personne{m.droits ? ' (réglés à la main)' : ' (modèle du rôle)'}</legend>
                {DROITS.map((d) => (
                  <label key={d.cle} className="flex items-start gap-2 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={droitEffectif(m.role, m.droits, d.cle)} onChange={(e) => void changerDroit(m, d.cle, e.target.checked)} />
                    <span><b>{d.libelle}</b> · {d.aide}</span>
                  </label>
                ))}
                {m.droits ? <button type="button" className="text-xs underline" onClick={() => void poserDroits(m, null, 'Retour au modèle du rôle.')}>Revenir au modèle « {LIBELLE_ROLE[m.role]} »</button> : null}
              </fieldset>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="rounded-xl bg-carte-2 p-3">
        <h4 className="text-sm font-semibold">Inviter quelqu’un</h4>
        <p className="mt-1 text-xs text-texte-2">Aucun e-mail n’est envoyé : tu copies le lien et tu l’envoies toi-même (WhatsApp, SMS…). Il sert une seule fois.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Champ label="Nom (pour t’y retrouver)"><Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Dana, comptable" /></Champ>
          <Champ label="Droits"><Select value={role} onChange={(e) => setRole(e.target.value)}>{Object.entries(LIBELLE_ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Champ>
          <Champ label="Valable"><Select value={jours} onChange={(e) => setJours(e.target.value)}><option value="1">1 jour</option><option value="7">7 jours</option><option value="30">30 jours</option></Select></Champ>
        </div>
        <p className="mt-1 text-xs text-texte-2">{AIDE_ROLE[role]}</p>
        {perso ? (
          <fieldset className="mt-2 space-y-1" data-testid="droits-nouvelle-invitation">
            <legend className="text-xs font-semibold">Droits sur mesure</legend>
            {DROITS.map((d) => (
              <label key={d.cle} className="flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-0.5" checked={perso[d.cle]} onChange={(e) => setPerso({ ...perso, [d.cle]: e.target.checked })} />
                <span><b>{d.libelle}</b> · {d.aide}</span>
              </label>
            ))}
            <button type="button" className="text-xs underline" onClick={() => setPerso(null)}>Revenir au modèle « {LIBELLE_ROLE[role]} »</button>
          </fieldset>
        ) : <button type="button" className="mt-1 text-xs underline" onClick={() => setPerso({ demandes: droitEffectif(role, null, 'demandes'), messages: droitEffectif(role, null, 'messages'), valider: droitEffectif(role, null, 'valider') })}>Régler les droits au cas par cas</button>}
        <div className="mt-2 flex justify-end"><Button variante="primaire" chargement={enCours} onClick={inviter}>Créer le lien</Button></div>
        {lien ? (
          <div className="mt-2" data-testid="lien-invitation">
            <code className="block break-all rounded-lg bg-carte px-2 py-1.5 text-[11px]">{lien}</code>
            <div className="mt-2 flex justify-end"><Button taille="sm" onClick={() => copier(lien)}>Copier le lien</Button></div>
            <p className="mt-1 text-xs text-texte-2">Ce lien n’est montré qu’une fois. Perdu : retire l’invitation et refais-en une.</p>
          </div>
        ) : null}
      </div>

      {attente.length > 0 ? (
        <div>
          <h4 className="mb-1 text-sm font-semibold">Invitations en attente</h4>
          <ul className="space-y-1">
            {attente.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg border border-bord px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{i.nom ?? 'Sans nom'} · {LIBELLE_ROLE[i.role]}{i.droits ? ` sur mesure (${resumeDroits(i.role, i.droits)})` : ''} · jusqu’au {quand(i.expire_at)}</span>
                <Button taille="sm" variante="discret" className="text-alerte" onClick={() => revoquer(i)}>Retirer</Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Qui a fait quoi ({journal?.length ?? 0})</summary>
        {journal === null ? <p className="mt-1 text-texte-2">Chargement…</p> : journal.length === 0 ? <p className="mt-1 text-xs text-texte-2">Aucune action d’invité pour l’instant.</p> : (
          <ul className="mt-2 space-y-1" data-testid="journal-invites">
            {journal.map((e, k) => (
              <li key={k} className="rounded-lg border border-bord px-3 py-2 text-xs">
                <span className="font-semibold">{e.email ?? 'Compte supprimé'}</span> · {e.nature} · {quand(e.quand)}
                <div className="text-texte-2">{e.nature === 'demande' ? e.texte : `${e.chantier_titre ? `« ${e.chantier_titre} » : ` : ''}${e.texte}`}</div>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  )
}
