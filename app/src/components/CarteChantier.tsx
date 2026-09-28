import { useMemo, useState } from 'react'
import type { Chantier } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { Badge } from '../ui/Badge.tsx'
import { Button } from '../ui/Button.tsx'
import { Repliable } from '../ui/Repliable.tsx'
import { infoEtat, libellePriorite } from '../lib/etats.ts'
import { presenceDe } from '../lib/entonnoir.ts'
import { dateRelative, reservationValide } from '../lib/dates.ts'
import { nomCourtSession } from '../lib/texte.ts'
import { Progression } from './Progression.tsx'
import { BlocQuestion } from './BlocQuestion.tsx'
import { BlocValidation, SignalerProbleme } from './BlocValidation.tsx'
import { CommentVerifierReplie } from './CommentVerifier.tsx'
import { Fil } from './Fil.tsx'
import { EcrireDansFil } from './EcrireDansFil.tsx'
import { Historique } from './Historique.tsx'
import { BoutonsRelance } from './Relance.tsx'
import { FriseMiseEnLigne } from './MiseEnLigne.tsx'
import { TachesDuChantier } from './EnCeMoment.tsx'
import { PointTravaille, useFlash } from './Vivant.tsx'

/** D'où vient un chantier, en clair. */
const ORIGINE: Record<string, string> = { proprietaire: 'créé par toi', utilisateur: 'demande d’un utilisateur', session: '💬 lancé depuis une session Claude' }

/** Le texte d'invitation du champ « Écrire à Claude », selon ce qu'on attend de lui. */
const PLACEHOLDER: Record<string, string> = {
  a_cadrer: 'Ta décision : ce que tu veux, ce que tu ne veux pas…',
  bloque: 'Ta réponse : ce que tu as fait, ou ce qu’il faut faire…',
  attend_toi: 'Une précision en plus de ta réponse…',
  a_verifier: 'Ce que tu as constaté, une correction…',
}

const BORD: Record<string, string> = { attend_toi: 'border-alerte/60', a_verifier: 'border-attention/60', travaille: 'border-ok/60' }

/**
 * Une carte de chantier. Repliée : le titre, le badge de PRÉSENCE (« 🟢 Claude
 * y travaille », « ⏸ Personne dessus »… — presence.ts, jamais l'état seul),
 * son détail, et la barre (vive seulement si quelqu'un avance vraiment).
 * Dépliée : d'abord « Ce que tu peux faire », puis la demande, les questions,
 * la validation, le fil, l'historique, les actions. L'état technique reste
 * lisible en bas et modifiable dans « Modifier ».
 */
export function CarteChantier({ chantier, ouverte, onToggle }: { chantier: Chantier; ouverte: boolean; onToggle: () => void }) {
  const { admin, par, messages, activites, taches, enAttente, selection, recharger, ouvrirModifier, ouvrirDoublonDe, sections, now, silenceMs } = useCockpit()
  const toast = useToast()
  const confirmer = useConfirmer()
  const [enCours, setEnCours] = useState(false)
  const { presence, activite } = useMemo(() => presenceDe(chantier, activites, enAttente, now, silenceMs, taches), [chantier, activites, taches, enAttente, now, silenceMs])
  const fil = useMemo(() => messages.filter((m) => m.chantier_id === chantier.id), [messages, chantier.id])
  const questions = fil.filter((m) => (m.kind === 'question' || m.kind === 'action') && !m.answered_at)
  // Un bref flash quand une nouvelle étape arrive — seulement sur ce qui travaille vraiment.
  const flash = useFlash(presence.barreVive && activite ? `${activite.updated_at}|${activite.pourcentage}|${activite.etape}` : null)
  const priseExpiree = chantier.pris_par && !reservationValide(chantier.pris_jusqu_a, now)
  const section = chantier.section_id ? sections.find((s) => s.id === chantier.section_id) : null
  const coche = selection.ids.has(chantier.id)

  const maj = async (valeurs: Partial<Chantier>, succes: string) => {
    setEnCours(true)
    const { error } = await supabase.from('chantiers').update(valeurs).eq('id', chantier.id)
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return false }
    toast.succes(succes); await recharger(); return true
  }
  const relancer = () => maj({ etat: 'libre' }, `« ${chantier.titre} » relancé : il passe dans « À lancer », prêt pour une session.`)
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
      data-presence={presence.code}
      className={`scroll-mt-16 rounded-2xl border bg-carte transition ${BORD[presence.code] ?? 'border-bord'} ${coche ? 'ring-2 ring-accent' : ''} ${flash ? 'flash-etape' : ''}`}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        {selection.actif ? (
          <input type="checkbox" aria-label={`Choisir ${chantier.titre}`} checked={coche} onChange={() => selection.basculer(chantier.id)} className="mt-1 h-5 w-5 shrink-0 accent-accent" />
        ) : null}
        <button type="button" onClick={onToggle} aria-expanded={ouverte} className="min-w-0 flex-1 text-left" data-testid="carte-titre">
          <div className="flex items-start justify-between gap-2">
            <span className={`font-semibold leading-snug ${ouverte ? '' : 'line-clamp-2'}`}>{chantier.titre}</span>
            <Badge teinte={presence.teinte} className="shrink-0" title={infoEtat(chantier.etat).libelle}><span data-testid="badge-presence">{presence.libelle}</span></Badge>
          </div>
          {presence.code === 'travaille' || presence.detail ? (
            <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${presence.code === 'travaille' ? 'text-ok' : presence.code === 'silencieux' ? 'text-attention' : 'text-texte-2'}`}>
              {presence.code === 'travaille' ? <PointTravaille /> : null}
              {presence.detail ? <span className="min-w-0" data-testid="detail-presence">{presence.detail}</span> : null}
            </p>
          ) : null}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-texte-2">
            {chantier.priorite === 'haute' ? <span className="font-semibold text-alerte">{libellePriorite('haute')}</span> : null}
            {chantier.priorite === 'basse' ? <span>priorité basse</span> : null}
            {priseExpiree ? <span className="text-attention" title={chantier.pris_par ?? ''}>⚠️ réservation expirée ({nomCourtSession(chantier.pris_par)})</span> : null}
            {!chantier.visible_utilisateurs ? <span title="Invisible pour les utilisateurs finaux">🔒 interne</span> : null}
            {chantier.doublon_de ? <span>doublon fusionné</span> : null}
            {chantier.origine === 'session' ? <span data-testid="origine-session">💬 lancé depuis une session Claude</span> : null}
            <span>{chantier.etat === 'valide' && chantier.valide_at ? `certifié ${dateRelative(chantier.valide_at, now)}` : `màj ${dateRelative(chantier.updated_at, now)}`}</span>
          </div>
          {activite && !ouverte ? <Progression activite={activite} vive={presence.barreVive} legende={presence.barreVive} compact now={now} /> : null}
        </button>
      </div>

      {ouverte ? (
        <div className="space-y-3 border-t border-bord px-3 py-3" data-testid="carte-detail">
          {presence.tonAction ? (
            <div className="rounded-xl border border-accent/40 bg-accent/8 px-3 py-2" data-testid="ton-action">
              <p className="text-[15px] leading-snug"><span className="font-bold text-accent">Ce qu’on attend de toi : </span>{presence.tonAction}</p>
              {presence.aRelancer ? <div className="mt-2"><BoutonsRelance chantier={chantier} /></div> : null}
              {presence.code === 'reporte' && admin ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button taille="sm" variante="primaire" chargement={enCours} onClick={relancer} data-testid="relancer-maintenant" className="h-auto! min-h-9 whitespace-normal! py-1.5 leading-tight">▶️ Relancer maintenant</Button>
                  <Button taille="sm" onClick={onToggle} data-testid="garder-de-cote" className="h-auto! min-h-9 whitespace-normal! py-1.5 leading-tight">Garder de côté</Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {questions.map((q) => <BlocQuestion key={q.id} message={q} />)}
          {chantier.etat === 'a_verifier' ? <BlocValidation chantier={chantier} /> : null}

          {activite ? <Progression activite={activite} vive={presence.barreVive} now={now} /> : null}
          <TachesDuChantier chantierId={chantier.id} />
          {chantier.etat !== 'a_verifier' ? <FriseMiseEnLigne chantier={chantier} /> : null}
          {chantier.demande ? <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{chantier.demande}</p> : <p className="text-sm italic text-texte-2">Pas de description.</p>}
          {chantier.resume_simple ? (
            <div className="rounded-xl bg-accent/8 px-3 py-2 text-[15px]"><span className="font-semibold text-accent">En clair : </span>{chantier.resume_simple}</div>
          ) : null}

          <div className={`rounded-xl border px-3 py-2.5 ${presence.code === 'a_cadrer' ? 'border-info/60 bg-info/6 ring-2 ring-info/30' : presence.code === 'bloque' ? 'border-alerte/50 bg-alerte/5' : 'border-bord bg-carte-2/40'}`} data-testid="ecrire-a-claude">
            <p className="mb-1.5 text-sm font-bold">✍️ Écrire à Claude</p>
            <EcrireDansFil chantierId={chantier.id} placeholder={PLACEHOLDER[presence.code] ?? 'Une précision, une correction…'} rows={2}
              succes="Message envoyé : Claude le lira au démarrage de la prochaine session sur ce projet."
              aide="Claude le lira au démarrage de la prochaine session sur ce projet." />
          </div>

          <Fil chantierId={chantier.id} messages={fil} />
          {chantier.notes ? (
            <Repliable titre={<span className="text-sm">📝 Notes de travail</span>}><p className="whitespace-pre-wrap text-sm text-texte-2">{chantier.notes}</p></Repliable>
          ) : null}
          {chantier.etat === 'valide' ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-ok/8 px-3 py-2 text-sm">
              <span>✅ Certifié{chantier.valide_par ? ` par ${chantier.valide_par}` : ''}{chantier.valide_at ? ` · ${dateRelative(chantier.valide_at, now)}` : ''}</span>
              <SignalerProbleme chantier={chantier} />
            </div>
          ) : null}
          {chantier.etat === 'valide' ? <CommentVerifierReplie chantier={chantier} /> : null}
          {admin ? <Historique chantierId={chantier.id} /> : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-texte-2">
            <span data-testid="etat-technique">État : {infoEtat(chantier.etat).libelle}</span>
            <span>{section ? `Section : ${section.nom}` : 'Sans section'}</span>
            <span>Origine : {ORIGINE[chantier.origine] ?? chantier.origine}</span>
            <span>Créé {dateRelative(chantier.created_at, now)}</span>
            {chantier.livre_at ? <span>Livré {dateRelative(chantier.livre_at, now)}</span> : null}
            {chantier.pris_par ? <span title={chantier.pris_par}>Réservation : {nomCourtSession(chantier.pris_par)}</span> : null}
          </div>
          {admin ? (
            <div className="flex flex-wrap gap-1.5 border-t border-bord/70 pt-2" data-testid="actions-admin">
              <Button taille="sm" variante="discret" onClick={() => ouvrirModifier(chantier)}>✏️ Modifier</Button>
              <Button taille="sm" variante="discret" chargement={enCours} onClick={archiver}>{chantier.archived_at ? '📤 Désarchiver' : '📥 Archiver'}</Button>
              {chantier.pris_par ? <Button taille="sm" variante="discret" onClick={liberer}>🔓 Libérer la réservation</Button> : null}
              {!chantier.doublon_de ? <Button taille="sm" variante="discret" onClick={() => ouvrirDoublonDe(chantier)}>🔁 C’est un doublon de…</Button> : null}
              <Button taille="sm" variante="discret" className="text-alerte" chargement={enCours} onClick={supprimer} data-testid="supprimer">🗑️ Supprimer</Button>
            </div>
          ) : (
            <p className="text-xs text-texte-2">Tu peux répondre, certifier ou corriger ; l’état est géré par Raphaël et les sessions. ({par})</p>
          )}
        </div>
      ) : null}
    </article>
  )
}
