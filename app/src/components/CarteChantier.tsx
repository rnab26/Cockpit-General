import { useMemo, useState } from 'react'
import type { Chantier } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { Badge } from '../ui/Badge.tsx'
import { Button } from '../ui/Button.tsx'
import { Repliable } from '../ui/Repliable.tsx'
import { badgeChantier, libellePriorite } from '../lib/etats.ts'
import { activiteDuChantier } from '../lib/activite.ts'
import { dateRelative, reservationValide } from '../lib/dates.ts'
import { nomCourtSession } from '../lib/texte.ts'
import { Progression } from './Progression.tsx'
import { BlocQuestion } from './BlocQuestion.tsx'
import { BlocValidation, SignalerProbleme } from './BlocValidation.tsx'
import { CommentVerifierReplie } from './CommentVerifier.tsx'
import { Fil } from './Fil.tsx'
import { Historique } from './Historique.tsx'

/**
 * Une carte de chantier. Repliée : une ligne (titre, badge, priorité,
 * « Prise par »), plus la barre de progression s'il y a une activité.
 * Dépliée : la demande, le résumé, les questions, la validation, le fil,
 * l'historique, les actions.
 */
export function CarteChantier({ chantier, ouverte, onToggle }: { chantier: Chantier; ouverte: boolean; onToggle: () => void }) {
  const { admin, par, messages, activites, enAttente, selection, recharger, ouvrirModifier, ouvrirDoublonDe, sections } = useCockpit()
  const toast = useToast()
  const confirmer = useConfirmer()
  const [enCours, setEnCours] = useState(false)
  const questionEnAttente = enAttente.has(chantier.id)
  const badge = badgeChantier(chantier, questionEnAttente)
  const activite = useMemo(() => activiteDuChantier(activites, chantier.id), [activites, chantier.id])
  const fil = useMemo(() => messages.filter((m) => m.chantier_id === chantier.id), [messages, chantier.id])
  const questions = fil.filter((m) => (m.kind === 'question' || m.kind === 'action') && !m.answered_at)
  const prise = chantier.pris_par && reservationValide(chantier.pris_jusqu_a)
  const priseExpiree = chantier.pris_par && !prise
  const section = chantier.section_id ? sections.find((s) => s.id === chantier.section_id) : null
  const coche = selection.ids.has(chantier.id)

  const maj = async (valeurs: Partial<Chantier>, succes: string) => {
    setEnCours(true)
    const { error } = await supabase.from('chantiers').update(valeurs).eq('id', chantier.id)
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return false }
    toast.succes(succes); await recharger(); return true
  }
  const archiver = () => maj({ archived_at: chantier.archived_at ? null : new Date().toISOString() }, chantier.archived_at ? 'Chantier désarchivé.' : 'Chantier archivé.')
  const liberer = async () => {
    const { data, error } = await supabase.rpc('liberer_chantier', { p_id: chantier.id, p_par: chantier.pris_par })
    if (error || !data) { toast.erreur(error ? messageErreur(error) : 'La réservation n’a pas pu être libérée.'); return }
    toast.succes('Réservation libérée : le chantier redevient libre.'); await recharger()
  }
  const supprimer = async () => {
    const ok = await confirmer({ titre: 'Supprimer ce chantier ?', danger: true, libelleOk: 'Supprimer',
      texte: <><p>« <b>{chantier.titre}</b> » et ses {fil.length} message{fil.length > 1 ? 's' : ''} seront supprimés.</p><p className="mt-1 text-xs">Une trace reste en base (table supprimés), mais il ne sera plus dans le cockpit. Préfère « Archiver » si tu veux le retrouver.</p></> })
    if (!ok) return
    setEnCours(true)
    const { error } = await supabase.from('chantiers').delete().eq('id', chantier.id)
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(`« ${chantier.titre} » supprimé.`); await recharger()
  }

  return (
    <article data-testid="carte" data-chantier={chantier.id} data-etat={chantier.etat}
      className={`rounded-2xl border bg-carte transition ${questionEnAttente ? 'border-alerte/60' : chantier.etat === 'a_verifier' ? 'border-attention/60' : 'border-bord'} ${coche ? 'ring-2 ring-accent' : ''}`}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        {selection.actif ? (
          <input type="checkbox" aria-label={`Choisir ${chantier.titre}`} checked={coche} onChange={() => selection.basculer(chantier.id)} className="mt-1 h-5 w-5 shrink-0 accent-accent" />
        ) : null}
        <button type="button" onClick={onToggle} aria-expanded={ouverte} className="min-w-0 flex-1 text-left" data-testid="carte-titre">
          <div className="flex items-start justify-between gap-2">
            <span className={`font-semibold leading-snug ${ouverte ? '' : 'line-clamp-2'}`}>{chantier.titre}</span>
            <Badge teinte={badge.teinte} className="shrink-0">{badge.libelle}</Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-texte-2">
            {chantier.priorite === 'haute' ? <span className="font-semibold text-alerte">{libellePriorite('haute')}</span> : null}
            {chantier.priorite === 'basse' ? <span>priorité basse</span> : null}
            {prise ? <span title={chantier.pris_par ?? ''}>Prise par {nomCourtSession(chantier.pris_par)}</span> : null}
            {priseExpiree ? <span className="text-attention" title={chantier.pris_par ?? ''}>⚠️ réservation expirée ({nomCourtSession(chantier.pris_par)})</span> : null}
            {!chantier.visible_utilisateurs ? <span title="Invisible pour les utilisateurs finaux">🔒 interne</span> : null}
            {chantier.doublon_de ? <span>doublon fusionné</span> : null}
            <span>{chantier.etat === 'valide' && chantier.valide_at ? `certifié ${dateRelative(chantier.valide_at)}` : `màj ${dateRelative(chantier.updated_at)}`}</span>
          </div>
          {activite && !ouverte ? <Progression activite={activite} compact /> : null}
        </button>
      </div>

      {ouverte ? (
        <div className="space-y-3 border-t border-bord px-3 py-3" data-testid="carte-detail">
          {activite ? <Progression activite={activite} /> : null}
          {chantier.demande ? <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{chantier.demande}</p> : <p className="text-sm italic text-texte-2">Pas de description.</p>}
          {chantier.resume_simple ? (
            <div className="rounded-xl bg-accent/8 px-3 py-2 text-[15px]"><span className="font-semibold text-accent">En clair : </span>{chantier.resume_simple}</div>
          ) : null}
          {chantier.notes ? (
            <Repliable titre={<span className="text-sm">📝 Notes de travail</span>}><p className="whitespace-pre-wrap text-sm text-texte-2">{chantier.notes}</p></Repliable>
          ) : null}

          {questions.map((q) => <BlocQuestion key={q.id} message={q} />)}
          {chantier.etat === 'a_verifier' ? <BlocValidation chantier={chantier} /> : null}
          {chantier.etat === 'valide' ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-ok/8 px-3 py-2 text-sm">
              <span>✅ Certifié{chantier.valide_par ? ` par ${chantier.valide_par}` : ''}{chantier.valide_at ? ` · ${dateRelative(chantier.valide_at)}` : ''}</span>
              <SignalerProbleme chantier={chantier} />
            </div>
          ) : null}
          {chantier.etat === 'valide' ? <CommentVerifierReplie chantier={chantier} /> : null}

          <Fil chantierId={chantier.id} messages={fil} />
          {admin ? <Historique chantierId={chantier.id} /> : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-texte-2">
            <span>{section ? `Section : ${section.nom}` : 'Sans section'}</span>
            <span>Origine : {chantier.origine}</span>
            <span>Créé {dateRelative(chantier.created_at)}</span>
            {chantier.livre_at ? <span>Livré {dateRelative(chantier.livre_at)}</span> : null}
          </div>
          {admin ? (
            <div className="flex flex-wrap gap-2" data-testid="actions-admin">
              <Button taille="sm" onClick={() => ouvrirModifier(chantier)}>✏️ Modifier</Button>
              <Button taille="sm" chargement={enCours} onClick={archiver}>{chantier.archived_at ? '📤 Désarchiver' : '📥 Archiver'}</Button>
              {chantier.pris_par ? <Button taille="sm" onClick={liberer}>🔓 Libérer la réservation</Button> : null}
              {!chantier.doublon_de ? <Button taille="sm" onClick={() => ouvrirDoublonDe(chantier)}>🔁 C’est un doublon de…</Button> : null}
              <Button taille="sm" variante="danger" chargement={enCours} onClick={supprimer} data-testid="supprimer">🗑️ Supprimer</Button>
            </div>
          ) : (
            <p className="text-xs text-texte-2">Tu peux répondre, certifier ou corriger ; l’état est géré par Raphaël et les sessions. ({par})</p>
          )}
        </div>
      ) : null}
    </article>
  )
}
