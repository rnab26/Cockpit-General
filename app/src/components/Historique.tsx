import { useEffect, useState } from 'react'
import type { Historique as LigneHistorique } from '../lib/types.ts'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
import { Repliable } from '../ui/Repliable.tsx'
import { Button } from '../ui/Button.tsx'
import { dateLongue } from '../lib/dates.ts'
import { extrait } from '../lib/texte.ts'
import { infoEtat } from '../lib/etats.ts'
import type { Etat } from '../lib/types.ts'

const RESTAURABLES = new Set(['titre', 'demande', 'notes', 'resume_simple', 'comment_verifier'])
const NOM_CHAMP: Record<string, string> = {
  titre: 'titre', demande: 'demande', notes: 'notes', resume_simple: 'résumé simple', comment_verifier: 'comment vérifier', etat: 'état', priorite: 'priorité',
  section_id: 'section', archived_at: 'archivage', visible_utilisateurs: 'visible aux utilisateurs',
}

/** L'historique d'un chantier : chargé seulement à l'ouverture. Réservé à l'admin (RLS). */
export function Historique({ chantierId }: { chantierId: string }) {
  const { par, sections, recharger } = useCockpit()
  const toast = useToast()
  const confirmer = useConfirmer()
  const [ouvert, setOuvert] = useState(false)
  const [lignes, setLignes] = useState<LigneHistorique[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  const charger = async () => {
    const { data, error } = await supabase.from('historique').select('*').eq('chantier_id', chantierId).order('changed_at', { ascending: false }).limit(100)
    if (error) { setErreur(messageErreur(error)); return }
    setLignes((data ?? []) as LigneHistorique[]); setErreur(null)
  }
  useEffect(() => { if (ouvert && lignes === null) void charger() }, [ouvert]) // eslint-disable-line react-hooks/exhaustive-deps

  const lisible = (champ: string, v: string | null) => {
    if (v == null || v === '') return '—'
    if (champ === 'etat') return infoEtat(v as Etat).libelle
    if (champ === 'section_id') return sections.find((s) => s.id === v)?.nom ?? 'section supprimée'
    if (champ === 'archived_at') return v === 'null' ? 'non' : 'archivé'
    if (champ === 'visible_utilisateurs') return v === 'true' ? 'oui' : 'non'
    return extrait(v, 140)
  }

  const restaurer = async (h: LigneHistorique) => {
    const ok = await confirmer({ titre: `Revenir à l’ancien ${NOM_CHAMP[h.champ] ?? h.champ} ?`,
      texte: <><p>Le texte actuel sera remplacé par :</p><blockquote className="mt-2 whitespace-pre-wrap rounded-lg bg-carte-2 p-2 text-sm">{h.ancienne || '(vide)'}</blockquote><p className="mt-2 text-xs">La restauration laisse elle-même une trace : rien n’est perdu.</p></>,
      libelleOk: 'Revenir à ce texte' })
    if (!ok) return
    const { error } = await supabase.rpc('restaurer_champ', { p_historique: h.id, p_par: par })
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes('Texte restauré.')
    setLignes(null); await recharger(); await charger()
  }

  return (
    <Repliable testId="historique" ouvert={ouvert} onToggle={setOuvert} titre={<span className="text-sm">🕓 Historique</span>}
      badge={lignes ? <span className="text-xs">{lignes.length} changement{lignes.length > 1 ? 's' : ''}</span> : null}>
      {erreur ? <p className="text-sm text-alerte">{erreur}</p> : lignes === null ? <p className="text-sm text-texte-2">Chargement…</p>
        : lignes.length === 0 ? <p className="text-sm text-texte-2">Aucun changement enregistré depuis la création.</p> : (
          <ul className="divide-y divide-bord/60 text-sm">
            {lignes.map((h) => (
              <li key={h.id} className="py-1.5">
                <div className="flex items-baseline justify-between gap-2 text-xs text-texte-2">
                  <span className="font-semibold uppercase">{NOM_CHAMP[h.champ] ?? h.champ}</span>
                  <span>{h.par ?? 'inconnu'} · {dateLongue(h.changed_at)}</span>
                </div>
                <div className="mt-0.5 break-words"><span className="text-texte-2 line-through decoration-alerte/60">{lisible(h.champ, h.ancienne)}</span> → <span>{lisible(h.champ, h.nouvelle)}</span></div>
                {RESTAURABLES.has(h.champ) && h.ancienne ? <Button taille="sm" className="mt-1" onClick={() => restaurer(h)}>↩ Revenir à ce texte</Button> : null}
              </li>
            ))}
          </ul>
        )}
    </Repliable>
  )
}
