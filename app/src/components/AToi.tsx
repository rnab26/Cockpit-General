import { useMemo, useState } from 'react'
import type { Chantier, Message } from '../lib/types.ts'
import { useCockpit, useGlobal } from '../contexte.ts'
import { aToi, grouperAToi, TITRE_A_TOI, type ElementAToi, type TypeAToi } from '../lib/entonnoir.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Button } from '../ui/Button.tsx'
import { dateRelative } from '../lib/dates.ts'
import { AvecProjet, PastilleProjet } from './AvecProjet.tsx'
import { BlocQuestion } from './BlocQuestion.tsx'
import { BlocValidation } from './BlocValidation.tsx'
import { EcrireDansFil } from './EcrireDansFil.tsx'

/** Combien d'éléments d'un même groupe s'affichent avant « Voir les N autres » (le reste est à un toucher). */
export const PAR_GROUPE_A_TOI = 3

/**
 * « À toi » : la boîte de réception de Raphaël, tous projets (ou un seul),
 * triée questions → à vérifier → à cadrer → bloqués. Chaque élément se traite
 * SUR PLACE, sans changer d'écran ni déplier une carte.
 */
export function AToi({ projetId }: { projetId: string | null }) {
  const g = useGlobal()
  const elements = useMemo(() => aToi(g.chantiers, g.messages, projetId), [g.chantiers, g.messages, projetId])
  const groupes = grouperAToi(elements)
  const [tousVisibles, setTousVisibles] = useState<Set<TypeAToi>>(new Set())
  return (
    <section data-testid="a-toi" aria-label="À toi" className="space-y-2">
      <h2 className="flex items-baseline justify-between px-1 text-base font-bold">
        <span>👉 À toi</span>
        <span className={`text-sm font-bold ${elements.length ? 'text-alerte' : 'text-texte-2'}`} data-testid="a-toi-total">{elements.length}</span>
      </h2>
      {elements.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-bord px-3 py-3 text-center font-semibold" data-testid="rien-ne-t-attend">✅ Rien ne t’attend.</p>
      ) : groupes.map((gr) => {
        const tout = tousVisibles.has(gr.type) || gr.elements.length <= PAR_GROUPE_A_TOI
        const visibles = tout ? gr.elements : gr.elements.slice(0, PAR_GROUPE_A_TOI)
        return (
          <div key={gr.type} className="space-y-2" data-testid={`groupe-a-toi-${gr.type}`}>
            <h3 className="flex items-baseline justify-between px-1 text-sm font-semibold text-texte-2">
              <span>{TITRE_A_TOI[gr.type]}</span><span data-testid="compte-groupe">{gr.elements.length}</span>
            </h3>
            {visibles.map((e) => (
              <AvecProjet key={e.cle} projetId={e.projetId}>
                <VueElement e={e} avecProjet={!projetId} />
              </AvecProjet>
            ))}
            {!tout ? (
              <Button pleine taille="sm" variante="discret" onClick={() => setTousVisibles((s) => new Set(s).add(gr.type))}>
                Voir les {gr.elements.length - PAR_GROUPE_A_TOI} autres
              </Button>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}

function VueElement({ e, avecProjet }: { e: ElementAToi; avecProjet: boolean }) {
  const { projet, ouvrirChantier } = useCockpit()
  return (
    <article data-testid="element-a-toi" data-type={e.type} data-element-chantier={e.chantier?.id ?? ''} className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1">
        {avecProjet ? <PastilleProjet projet={projet} /> : null}
        {e.chantier ? (
          <button type="button" onClick={() => ouvrirChantier(e.chantier!.id)} className="min-w-0 flex-1 truncate text-left text-sm font-semibold underline-offset-2 hover:underline" title="Ouvrir le chantier">
            {e.chantier.titre}
          </button>
        ) : <span className="min-w-0 flex-1 truncate text-sm font-semibold text-texte-2">Question sur le projet</span>}
      </div>
      {e.type === 'question' && e.message ? <BlocQuestion message={e.message} /> : null}
      {e.type === 'fusion' && e.message ? <BlocFusion message={e.message} /> : null}
      {e.type === 'a_verifier' && e.chantier ? <BlocValidation chantier={e.chantier} sansEntete /> : null}
      {e.type === 'a_cadrer' && e.chantier ? <BlocCadrer chantier={e.chantier} /> : null}
      {e.type === 'bloque' && e.chantier ? <BlocBloque chantier={e.chantier} blocage={e.message} /> : null}
    </article>
  )
}

/** Admin : une fois la décision donnée ou le blocage levé, rendre le chantier « libre » pour qu'une session le prenne. */
function BoutonPretALancer({ chantier, libelle }: { chantier: Chantier; libelle: string }) {
  const { admin, recharger } = useCockpit()
  const toast = useToast()
  const [enCours, setEnCours] = useState(false)
  if (!admin) return null
  return (
    <Button taille="sm" chargement={enCours} data-testid="pret-a-lancer" onClick={async () => {
      setEnCours(true)
      const { error } = await supabase.from('chantiers').update({ etat: 'libre' }).eq('id', chantier.id)
      setEnCours(false)
      if (error) { toast.erreur(messageErreur(error)); return }
      toast.succes(`« ${chantier.titre} » est prêt : il passe dans « À lancer ».`)
      await recharger()
    }}>{libelle}</Button>
  )
}

function DernierMot({ chantier }: { chantier: Chantier }) {
  const { messages, now } = useCockpit()
  const dernier = messages.filter((m) => m.chantier_id === chantier.id && m.auteur_type !== 'session').at(-1)
  if (!dernier) return null
  return <p className="text-xs text-texte-2">Ton dernier mot {dateRelative(dernier.created_at, now)} : « {dernier.corps.length > 90 ? `${dernier.corps.slice(0, 90)}…` : dernier.corps} »</p>
}

/** « À cadrer » : la demande en trois lignes, un champ pour la décision (écrite dans le fil). */
function BlocCadrer({ chantier }: { chantier: Chantier }) {
  const [plus, setPlus] = useState(false)
  const demande = chantier.resume_simple || chantier.demande
  const longue = (demande?.length ?? 0) > 160
  return (
    <div data-testid="bloc-cadrer" className="space-y-2 rounded-xl border-2 border-info/50 bg-info/6 p-3">
      <p className="text-sm font-semibold text-info">🗣️ Une décision de ta part est nécessaire avant qu’une session s’y mette.</p>
      {demande ? (
        <div>
          <p className={`whitespace-pre-wrap text-[15px] leading-snug ${plus ? '' : 'line-clamp-3'}`}>{demande}</p>
          {longue ? <button type="button" className="text-sm font-medium text-accent" onClick={() => setPlus(!plus)}>{plus ? 'voir moins' : 'voir plus'}</button> : null}
        </div>
      ) : <p className="text-sm italic text-texte-2">Pas de description.</p>}
      <DernierMot chantier={chantier} />
      <EcrireDansFil chantierId={chantier.id} placeholder="Ta décision / ta précision" libelle="Envoyer ma décision" rows={2}
        succes="Décision écrite dans le fil : la session qui prendra ce chantier partira de là." testId="decision-cadrer" />
      <BoutonPretALancer chantier={chantier} libelle="✅ C’est cadré : prêt à lancer" />
    </div>
  )
}

/** « Bloqué » : ce qui bloque (dernier message « blocage » du fil) et un champ pour répondre. */
function BlocBloque({ chantier, blocage }: { chantier: Chantier; blocage: Message | null }) {
  const { now } = useCockpit()
  return (
    <div data-testid="bloc-bloque" className="space-y-2 rounded-xl border-2 border-alerte/50 bg-alerte/6 p-3">
      <p className="text-sm font-semibold text-alerte">⛔ Ce qui bloque{blocage ? ` (${dateRelative(blocage.created_at, now)})` : ''} :</p>
      {blocage ? <p className="whitespace-pre-wrap text-[15px] leading-snug">{blocage.corps}</p>
        : <p className="text-sm italic text-texte-2">Le fil ne dit pas ce qui bloque : demande-le ci-dessous.</p>}
      <DernierMot chantier={chantier} />
      <EcrireDansFil chantierId={chantier.id} placeholder="Ta réponse : ce que tu as fait, ou ce qu’il faut faire" libelle="Répondre" rows={2}
        succes="Réponse écrite dans le fil." testId="reponse-blocage" />
      <BoutonPretALancer chantier={chantier} libelle="🔓 Débloqué : prêt à lancer" />
    </div>
  )
}

/**
 * « 🔀 Claude propose de fusionner » (0008) : Claude a repéré deux chantiers
 * qui sont le même sujet ; Raphaël accepte ou refuse d'un toucher. Ses mots :
 * « personne mieux que Claude sait si c'est un doublon ; il peut me suggérer
 * de fusionner, ça j'accepte ; pas à moi de trier ». Réversible (historique),
 * donc pas de confirmation en plus : le toast le dit.
 */
function BlocFusion({ message }: { message: Message }) {
  const { admin, par, recharger } = useCockpit()
  const toast = useToast()
  const [enCours, setEnCours] = useState<'oui' | 'non' | null>(null)
  const fusion = message.options?.[0]
  const trancher = async (fusionner: boolean) => {
    setEnCours(fusionner ? 'oui' : 'non')
    const { error } = await supabase.rpc('trancher_fusion', { p_message: message.id, p_fusionner: fusionner, p_par: admin ? 'Raphaël' : par })
    setEnCours(null)
    if (error) { toast.erreur(`Rien n’a été fait : ${messageErreur(error)}`); return }
    toast.succes(fusionner ? 'Fusionné : tout est passé dans le chantier gardé, rien n’est perdu (historique).' : 'Gardés séparés : cette suggestion ne reviendra pas.')
    await recharger()
  }
  return (
    <div data-testid="bloc-fusion" className="space-y-2 rounded-xl border-2 border-accent/50 bg-accent/6 p-3">
      <p className="text-sm font-semibold text-accent">🔀 Claude propose de fusionner</p>
      <p className="whitespace-pre-wrap text-[15px] font-semibold leading-snug">{message.corps}</p>
      {message.pourquoi ? <p className="whitespace-pre-wrap text-sm text-texte-2"><span className="font-medium">Pourquoi :</span> {message.pourquoi}</p> : null}
      {fusion?.aide ? <p className="text-xs text-texte-2">{fusion.aide}</p> : null}
      {admin ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variante="primaire" chargement={enCours === 'oui'} disabled={!!enCours} onClick={() => trancher(true)} data-testid="fusionner" className="h-auto! min-h-10 whitespace-normal! py-1.5 leading-tight">🔀 Fusionner</Button>
          <Button chargement={enCours === 'non'} disabled={!!enCours} onClick={() => trancher(false)} data-testid="garder-separes" className="h-auto! min-h-10 whitespace-normal! py-1.5 leading-tight">Garder séparés</Button>
        </div>
      ) : <p className="text-xs text-texte-2">Raphaël décidera.</p>}
    </div>
  )
}
