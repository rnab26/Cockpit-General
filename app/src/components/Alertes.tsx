import { useCockpit } from '../contexte.ts'
import { pluriel } from '../lib/texte.ts'

/** Bandeaux « N questions attendent ta réponse » / « N chantiers livrés à vérifier ». Un tap filtre. */
export function Alertes() {
  const { messages, chantiers, poserFiltre, enAttente } = useCockpit()
  const nQuestions = messages.filter((m) => (m.kind === 'question' || m.kind === 'action') && !m.answered_at).length
  const aVerifier = chantiers.filter((c) => c.etat === 'a_verifier' && !c.archived_at)
  if (!nQuestions && !aVerifier.length) return null
  return (
    <div className="flex flex-col gap-2" data-testid="alertes">
      {nQuestions ? (
        <button type="button" data-testid="alerte-questions"
          onClick={() => poserFiltre({ libelle: 'Réponse attendue', ids: enAttente })}
          className="flex w-full items-center justify-between rounded-2xl border border-alerte/40 bg-alerte/8 px-3 py-2.5 text-left font-semibold text-alerte">
          <span>🔴 {pluriel(nQuestions, 'question attend', 'questions attendent')} ta réponse</span><span aria-hidden>›</span>
        </button>
      ) : null}
      {aVerifier.length ? (
        <button type="button" data-testid="alerte-verifier"
          onClick={() => poserFiltre({ libelle: 'Livrés, à vérifier', ids: new Set(aVerifier.map((c) => c.id)) })}
          className="flex w-full items-center justify-between rounded-2xl border border-attention/40 bg-attention/8 px-3 py-2.5 text-left font-semibold text-attention">
          <span>🧪 {pluriel(aVerifier.length, 'chantier livré', 'chantiers livrés')} à vérifier</span><span aria-hidden>›</span>
        </button>
      ) : null}
    </div>
  )
}
