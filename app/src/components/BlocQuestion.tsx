import { useState } from 'react'
import { Ban, Check, Clock, Star } from 'lucide-react'
import type { Message } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { Textarea } from '../ui/Champs.tsx'
import { TexteLong } from '../ui/TexteLong.tsx'
import { dateRelative } from '../lib/dates.ts'
import { extrait } from '../lib/texte.ts'
import { ChoisirMedias, MediasMessage, ecrireAvecMedias, useMediasAJoindre } from './Medias.tsx'
import { mediasDe } from '../lib/medias.ts'
import { marcheDe } from '../lib/marche.ts'
import { MarcheASuivre } from './MarcheASuivre.tsx'
import { useEnvoi } from '../hooks/useEnvoi.ts'
import { dejaRepondue, libelleEnvoi, ligneRelueValable, phraseRetourCarte, reponseOptimiste, reponseRetrait, REPONSE_LOCALE, retourCarte } from '../lib/reponseCarte.ts'
import { LiensAOuvrir, TexteAvecLiens } from '../ui/TexteAvecLiens.tsx'

/**
 * Une question (options cliquables + précision) ou une action (Fait / Pas
 * encore / Ça bloque) qui attend l'humain : une bulle de la conversation.
 * Règle de clarté (29 sept.) : la question en gros, le pourquoi en petit
 * dessous, les réponses toutes prêtes bien visibles. Carte neutre avec un
 * liseré ; photos et fichiers joints partent dans le fil, sous la réponse.
 */
export function BlocQuestion({ message }: { message: Message }) {
  const { par, admin, projet, messagesLocal, messages, now } = useCockpit()
  const toast = useToast()
  const [choix, setChoix] = useState<string | null>(null)
  const [precision, setPrecision] = useState('')
  const envoi = useEnvoi()
  const [dernier, setDernier] = useState<string | null>(null)  // le bouton touché : seul lui dit « Envoi… / Envoyé ✓ »
  const [confirme, setConfirme] = useState<'attente' | 'base' | 'appareil' | null>(null)
  const enCours = envoi.occupe
  const options = message.options ?? []
  const estAction = message.kind === 'action'
  const pj = useMediasAJoindre(projet.id, message.chantier_id)
  const marche = marcheDe(message)
  const retour = retourCarte(message, messages)
  const [retrait, setRetrait] = useState<string | null>(null)   // le motif en cours de saisie (null = formulaire fermé)
  const [retraitEnCours, setRetraitEnCours] = useState(false)

  const envoyer = async (reponse: string, etat?: 'fait' | 'pas_encore' | 'bloque') => {
    if (pj.enCours) { toast.info('Un fichier est encore en cours d’envoi : un instant.'); return }
    // Même geste déjà enregistré (écran pas encore à jour, ou deuxième toucher) : rien n'est reposé.
    if (dejaRepondue(message, { reponse, etat })) { toast.info('C’est déjà enregistré : rien à refaire.'); return }
    setDernier(etat ?? 'reponse')
    await envoi.lancer(async () => {
      const avant = message
      // La carte passe « répondue » tout de suite ; si l'écriture échoue, elle revient telle qu'elle était.
      const local = reponseOptimiste(message, { reponse, precision: precision.trim() || null, etat, maintenant: new Date().toISOString() })
      messagesLocal.poser(local)
      const { error } = await supabase.rpc('repondre_message', {
        p_id: message.id, p_par: par, p_reponse: reponse, p_precision: precision.trim() || null, p_etat: etat ?? null,
      })
      if (error) { messagesLocal.poser(avant); toast.erreur(`Pas enregistré, la carte est revenue : ${messageErreur(error)}`); return false }
      toast.succes(`${estAction ? 'État enregistré' : 'Réponse enregistrée'} ✓`)
      let erreurMedias: string | null = null
      if (pj.medias.length) {
        erreurMedias = await ecrireAvecMedias({ projetId: projet.id, chantierId: message.chantier_id, par, admin, medias: pj.medias, local: messagesLocal,
          corps: `Pièces jointes à ma réponse « ${extrait(reponse, 60)} » à : ${extrait(message.corps, 80)}` })
        if (erreurMedias) toast.erreur(`Réponse enregistrée, mais les fichiers ne sont pas partis : ${erreurMedias}`)
        else toast.succes('Fichiers envoyés ✓')
      }
      pj.vider()
      // Le texte et le choix sont partis : plus de brouillon (sinon « Quitter sans envoyer ? » après un envoi réussi).
      setPrecision(''); setChoix(null)
      setConfirme('attente')
      // UNE ligne relue (pas tout l'écran) ; une lecture ancienne (hors ligne) ne défait pas le geste.
      // « Enregistré en base » n'est dit que si la ligne relue porte VRAIMENT la réponse (vérifié, pas supposé).
      void messagesLocal.relire(message.id).then((m) => {
        if (ligneRelueValable(local, m)) { messagesLocal.poser(m); setConfirme('base') } else setConfirme('appareil')
      })
      return !erreurMedias
    })
  }


  // « Cette carte n'a pas lieu d'être » (0070) : il la retire lui-même, avec son motif (lu par Claude dans le fil).
  const retirer = async () => {
    const motif = (retrait ?? '').trim()
    setRetraitEnCours(true)
    const avant = message
    messagesLocal.poser({ ...message, answered_at: new Date().toISOString(), answered_by: REPONSE_LOCALE, reponse: reponseRetrait(admin ? 'Raphaël' : par, motif) })
    const { error } = await supabase.rpc('retirer_carte', { p_id: message.id, p_par: admin ? 'Raphaël' : par, p_motif: motif || null })
    setRetraitEnCours(false)
    if (error) { messagesLocal.poser(avant); toast.erreur(`Carte pas retirée, elle est revenue : ${messageErreur(error)}`); return }
    toast.succes('Carte retirée ✓ Claude voit ton motif dans le fil.')
    setRetrait(null)
    void messagesLocal.relire(message.id).then((m) => { if (m) messagesLocal.poser(m) })
  }

  const valider = () => {
    const reponse = choix ?? precision.trim()
    if (!reponse) { toast.erreur(options.length ? 'Choisis une option, ou écris ta réponse.' : 'Écris ta réponse.'); return }
    void envoyer(reponse)
  }

  return (
    <div data-testid="bloc-question" className="rounded-2xl border border-l-4 border-bord border-l-alerte bg-carte p-3">
      <div className="flex items-baseline justify-between gap-2 text-xs text-texte-2">
        <span className="font-medium text-alerte">{estAction ? 'Claude attend un geste de toi' : 'Claude te pose une question'}</span>
        <span>{dateRelative(message.created_at, now)}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-base font-medium leading-snug"><TexteAvecLiens texte={message.corps} /></p>
      {message.pourquoi ? <TexteLong texte={message.pourquoi} petit /> : null}
      {/* 0020 : l'image que Claude montre pour que la question se comprenne d'un coup d'œil. */}
      {mediasDe(message).length ? <div className="mt-2"><MediasMessage medias={mediasDe(message)} apercu testId="images-question" /></div> : null}
      {/* 0033 : la marche à suivre d'un geste — lien exact, étapes numérotées, textes prêts à coller. */}
      {marche ? <MarcheASuivre marche={marche} /> : null}
      {/* 2be961b8 : une adresse écrite dans la question ou le pourquoi devient un bouton, sauf si la marche à suivre l'offre déjà. */}
      <LiensAOuvrir textes={[message.corps, message.pourquoi]} deja={marche?.liens.map((l) => l.url)} />

      {estAction ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Button variante="ok" chargement={enCours} onClick={() => envoyer('Fait', 'fait')}><Check size={16} aria-hidden />{libelleEnvoi(dernier === 'fait' ? envoi.etat : 'repos', 'Fait')}</Button>
          <Button chargement={enCours} onClick={() => envoyer('Pas encore', 'pas_encore')}><Clock size={16} aria-hidden />{libelleEnvoi(dernier === 'pas_encore' ? envoi.etat : 'repos', 'Pas encore')}</Button>
          <Button variante="attention" chargement={enCours} onClick={() => envoyer('Ça bloque', 'bloque')}><Ban size={16} aria-hidden />{libelleEnvoi(dernier === 'bloque' ? envoi.etat : 'repos', 'Ça bloque')}</Button>
        </div>
      ) : (
        <>
          {options.length ? (
            <div className="mt-3 flex flex-col gap-2" role="radiogroup">
              {options.map((o) => (
                <button key={o.libelle} type="button" role="radio" aria-checked={choix === o.libelle} onClick={() => setChoix(o.libelle)}
                  className={`min-h-12 rounded-xl border px-3 py-2.5 text-left transition ${choix === o.libelle ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-bord bg-carte hover:bg-carte-2'}`}>
                  <span className="font-medium">{o.libelle}</span>
                  {o.recommande ? <span className="ml-2 inline-flex items-center gap-0.5 text-xs font-medium text-accent"><Star size={12} aria-hidden />recommandé</span> : null}
                  {o.aide ? <span className="mt-0.5 block text-sm text-texte-2">{o.aide}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          <Textarea className="mt-2" rows={2} value={precision} onChange={(e) => setPrecision(e.target.value)}
            placeholder={options.length ? 'Une précision, si tu veux (facultatif)' : 'Ta réponse'} />
          <div className="mt-2"><ChoisirMedias ctrl={pj} testId="medias-reponse" /></div>
          <Button variante="primaire" taille="lg" pleine className="mt-2" chargement={enCours || pj.enCours} onClick={valider} data-testid="valider-reponse">{libelleEnvoi(envoi.etat, 'Valider cette réponse')}</Button>
        </>
      )}
      {/* Un geste qui bloque (PR en conflit…) : on peut dire pourquoi, avec une pièce jointe ; le texte part avec « Fait / Pas encore / Ça bloque ». */}
      {estAction ? (
        <>
          <Textarea className="mt-2" rows={2} value={precision} onChange={(e) => setPrecision(e.target.value)}
            placeholder="Un mot pour Claude, si tu veux (ex. pourquoi ça bloque)" data-testid="precision-action" />
          <div className="mt-2"><ChoisirMedias ctrl={pj} testId="medias-reponse" /></div>
        </>
      ) : null}
      {confirme ? (
        <p role="status" data-testid="envoi-confirmation" className={`mt-2 text-xs ${confirme === 'base' ? 'text-ok' : 'text-texte-2'}`}>
          {confirme === 'base' ? 'Envoyé ✓ Enregistré en base : Claude le verra à son prochain passage.'
            : confirme === 'attente' ? 'Envoyé ✓ Vérification en base…' : 'Gardé sur cet appareil : pas encore confirmé par la base (réseau ?), il part au retour du réseau.'}
        </p>
      ) : null}
      {retour ? (
        <p role="status" data-testid="retour-carte" data-etat={retour.etat} className="mt-2 rounded-lg border border-bord bg-carte-2 px-2.5 py-1.5 text-sm">
          <span className="font-medium">{retour.etat === 'lu' ? 'Lu par Claude' : 'Retour enregistré'} · {dateRelative(retour.depuis, now)}.</span> {phraseRetourCarte(retour)}
        </p>
      ) : null}
      {/* Une carte qui n'a pas lieu d'être se retire d'ici, jamais « à force de répondre ». */}
      {retrait === null ? (
        <button type="button" className="mt-2 text-sm text-texte-2 underline-offset-2 hover:underline" data-testid="retirer-carte-ouvrir"
          onClick={() => setRetrait(precision.trim())}>Cette carte n’a pas lieu d’être : la retirer</button>
      ) : (
        <div className="mt-2 rounded-xl border border-bord bg-carte-2 p-2" data-testid="retirer-carte-formulaire">
          <p className="text-sm font-medium">Retirer cette carte ? Dis pourquoi en un mot (Claude le lira).</p>
          <Textarea className="mt-1" rows={2} value={retrait} onChange={(e) => setRetrait(e.target.value)} placeholder="Ex. cette PR n’existe pas" data-testid="retirer-carte-motif" />
          <div className="mt-2 flex justify-end gap-2">
            <Button onClick={() => setRetrait(null)} disabled={retraitEnCours}>Annuler</Button>
            <Button variante="attention" chargement={retraitEnCours} onClick={() => void retirer()} data-testid="retirer-carte-confirmer">Retirer la carte</Button>
          </div>
        </div>
      )}
      {estAction && message.etat ? <p className="mt-2 text-xs text-texte-2">Dernier état : {message.etat === 'pas_encore' ? 'pas encore' : message.etat}{message.answered_at ? '' : ' — la session attend « fait »'}</p> : null}
    </div>
  )
}
