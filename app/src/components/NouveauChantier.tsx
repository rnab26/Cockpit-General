import { TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useCockpit } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Button } from '../ui/Button.tsx'
import { Champ, Input, Select, Textarea } from '../ui/Champs.tsx'
import { ETATS, PRIORITES, infoEtat } from '../lib/etats.ts'
import { ouApparait } from '../lib/entonnoir.ts'
import { lireProches, libelleCreer, texteConfirmationCompleter, texteConfirmationFusion, type ChantierProche } from '../lib/fusion.ts'
import { MEDIAS_MAX_PAR_MESSAGE, TAILLE_MAX_MEDIA, resumeMedias } from '../lib/medias.ts'
import type { Etat, Priorite } from '../lib/types.ts'
import { useConfirmer } from '../ui/Confirm.tsx'
import { CONFIRMER_ABANDON } from '../ui/Modale.ts'
import { ChoisirMedias, ecrireAvecMedias, useMediasAJoindre } from './Medias.tsx'

/**
 * Créer un chantier. Un utilisateur non admin crée une demande « à trier » (la RLS l'impose).
 * Photos, vidéos, fichiers (et le crayon) dès la création (29 sept. 2026) : ils
 * restent sur l'appareil jusqu'à « Créer » ; le chantier est créé, puis ils
 * partent dans son dossier et dans un message `info` de son fil (comme les
 * réponses). Si un dépôt échoue, le chantier existe déjà : la fenêtre reste
 * ouverte sur les pièces non parties, avec « réessayer ».
 */
export function NouveauChantier({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  const { admin, projet, sections, recharger, moi, par, ouvrirChantier } = useCockpit()
  const toast = useToast()
  const confirmer = useConfirmer()
  const pj = useMediasAJoindre(projet.id, null, { differe: true })
  /** Le chantier déjà créé dont des pièces restent à envoyer. */
  const [cree, setCree] = useState<{ id: string; titre: string } | null>(null)
  const [titre, setTitre] = useState('')
  const [demande, setDemande] = useState('')
  const [sectionId, setSectionId] = useState('')
  const [priorite, setPriorite] = useState<Priorite>('normale')
  const [etat, setEtat] = useState<Etat>('a_trier')
  const [enCours, setEnCours] = useState(false)
  // « Ça existe déjà » : la règle est en base (chantiers_proches_creation = ressemblance_fusion + seuil du projet).
  const [proches, setProches] = useState<ChantierProche[]>([])
  const [rechercheErreur, setRechercheErreur] = useState(false)
  const [action, setAction] = useState<string | null>(null)
  useEffect(() => {
    const t = titre.trim()
    if (!ouvert || t.length < 4) { setProches([]); setRechercheErreur(false); return }
    let vivant = true
    const minuteur = setTimeout(async () => {
      const { data, error } = await supabase.rpc('chantiers_proches_creation', { p_projet: projet.id, p_titre: t, p_limite: 3 })
      if (!vivant) return
      if (error) { setProches([]); setRechercheErreur(true); return }
      setRechercheErreur(false); setProches(lireProches(data))
    }, 400)
    return () => { vivant = false; clearTimeout(minuteur) }
  }, [titre, ouvert, projet.id])

  const { vider } = pj
  const reinitialiser = useCallback(() => { setTitre(''); setDemande(''); setSectionId(''); setPriorite('normale'); setEtat('a_trier'); setCree(null); vider() }, [vider])
  // Quitter : le brouillon (texte ou pièce jointe) est perdu, la fenêtre l'a demandé (Dialog `brouillon`) ou « Annuler » l'a dit.
  const fermer = useCallback(() => { reinitialiser(); onFermer() }, [reinitialiser, onFermer])
  const annuler = async () => {
    // Chantier créé mais pièces pas parties : « Fermer » les abandonne, on le demande d'abord.
    if (cree && pj.pieces.length && !(await confirmer(CONFIRMER_ABANDON))) return
    fermer()
  }

  /** Dépose les pièces dans le dossier du chantier et les écrit dans son fil. Vrai si plus rien n'attend. */
  const envoyerPieces = async (id: string): Promise<boolean> => {
    const r = await pj.envoyerTout(id)
    if (r.medias.length) {
      const err = await ecrireAvecMedias({ projetId: projet.id, chantierId: id, par, admin, medias: r.medias, corps: `Joint à la demande : ${resumeMedias(r.medias)}` })
      if (err) { toast.erreur(`Les pièces jointes n’ont pas pu être ajoutées au fil : ${err}`); return false }
      pj.oublier(r.ids)
    }
    return r.echecs === 0
  }

  /** Insère le chantier (id choisi ici : les pièces savent où aller sans relire la ligne, un non-admin ne relit pas toujours ce qu'il crée) ; rend l'id, ou null après avoir dit l'échec. */
  const inserer = async (): Promise<string | null> => {
    const id = crypto.randomUUID()
    const { error } = await supabase.from('chantiers').insert({
      id, projet_id: projet.id, titre: titre.trim(), demande: demande.trim() || null,
      section_id: sectionId || null, priorite,
      etat: admin ? etat : 'a_trier', origine: admin ? 'proprietaire' : 'utilisateur', created_by: moi.user_id,
    })
    if (error) { toast.erreur(messageErreur(error)); return null }
    return id
  }

  /** « Compléter celui-ci » : pas de nouveau chantier, ce qui est tapé rejoint la demande de l'existant. */
  const completer = async (p: ChantierProche) => {
    if (!titre.trim()) { toast.erreur('Donne un titre.'); return }
    if (!(await confirmer({ titre: 'Compléter ce chantier ?', libelleOk: 'Compléter', texte: <p>{texteConfirmationCompleter(p.titre)}</p> }))) return
    setEnCours(true); setAction(`completer:${p.id}`)
    const { error } = await supabase.rpc('completer_chantier', { p_cible: p.id, p_titre: titre.trim(), p_demande: demande.trim() || null, p_par: par })
    if (error) { setEnCours(false); setAction(null); toast.erreur(`Compléter impossible : ${messageErreur(error)}`); return }
    const nb = pj.pieces.length
    const complet = nb ? await envoyerPieces(p.id) : true
    setEnCours(false); setAction(null)
    void recharger()
    if (!complet) {
      setCree({ id: p.id, titre: p.titre })
      toast.erreur(`« ${p.titre} » est complété, mais des pièces jointes ne sont pas parties : touche « Envoyer les pièces ».`)
      return
    }
    toast.succes(`« ${p.titre} » complété : ta demande y est ajoutée.`)
    fermer()
  }

  /** « Fusionner » : le chantier est créé puis archivé comme doublon de l'existant (fusionner_chantiers, une seule règle) ; les deux demandes sont gardées. */
  const fusionner = async (p: ChantierProche) => {
    if (!titre.trim()) { toast.erreur('Donne un titre.'); return }
    if (!(await confirmer({ titre: 'Fusionner avec ce chantier ?', libelleOk: 'Fusionner', texte: <p>{texteConfirmationFusion(titre.trim(), p.titre, 0)}</p> }))) return
    setEnCours(true); setAction(`fusionner:${p.id}`)
    const id = await inserer()
    if (!id) { setEnCours(false); setAction(null); return }
    const nb = pj.pieces.length
    const complet = nb ? await envoyerPieces(id) : true
    const { error } = await supabase.rpc('fusionner_chantiers', { p_source: id, p_cible: p.id, p_par: par, p_note: 'créé depuis « + Chantier »' })
    setEnCours(false); setAction(null)
    void recharger()
    if (error) {
      toast.erreur(`« ${titre.trim()} » est créé mais la fusion a échoué : ${messageErreur(error)}. Fusionne-le depuis son menu ⋯ « Fusionner avec… ».`)
      fermer(); return
    }
    if (!complet) {
      setCree({ id: p.id, titre: p.titre })
      toast.erreur(`« ${titre.trim()} » est fusionné dans « ${p.titre} », mais des pièces jointes ne sont pas parties.`)
      return
    }
    toast.succes(`« ${titre.trim()} » fusionné dans « ${p.titre} » : les deux demandes sont gardées.`)
    fermer()
  }

  const creer = async () => {
    if (!titre.trim()) { toast.erreur('Donne un titre.'); return }
    setEnCours(true); setAction('creer')
    const id = await inserer()
    if (!id) { setEnCours(false); setAction(null); return }
    const nb = pj.pieces.length
    const complet = nb ? await envoyerPieces(id) : true
    setEnCours(false); setAction(null)
    void recharger()
    if (!complet) {
      setCree({ id, titre: titre.trim() })
      toast.erreur(`${admin ? 'Chantier créé' : 'Demande envoyée'}, mais des pièces jointes ne sont pas parties : touche « Envoyer les pièces ».`)
      return
    }
    const avec = nb ? `, avec ${nb} pièce${nb > 1 ? 's' : ''} jointe${nb > 1 ? 's' : ''}` : ''
    const msg = admin ? `Chantier « ${titre.trim()} » créé${avec}. ${ouApparait(etat)}` : `Demande envoyée${avec} : elle apparaît « Pas encore examinée ».`
    const ouvrir = () => ouvrirChantier(id)
    if (admin) toast.avecAction(msg, { libelle: 'Voir', onClick: ouvrir }, 10000)
    else toast.succes(msg)
    fermer()
  }

  const renvoyer = async () => {
    if (!cree) return
    setEnCours(true)
    const complet = await envoyerPieces(cree.id)
    setEnCours(false)
    if (!complet) return
    toast.succes(`Pièces jointes ajoutées au fil de « ${cree.titre} ».`)
    fermer()
  }

  const brouillon = !!(titre.trim() || demande.trim() || pj.pieces.length)
  const envoiEnCours = pj.enCours || enCours

  if (cree) {
    const restent = pj.pieces.length
    return (
      <Dialog ouvert={ouvert} onFermer={fermer} brouillon={restent > 0} titre="Pièces jointes à envoyer"
        pied={<><Button onClick={() => { void annuler() }}>Fermer</Button><Button variante="primaire" chargement={envoiEnCours} onClick={renvoyer} data-testid="envoyer-pieces">Envoyer les pièces</Button></>}>
        <div className="space-y-3" data-testid="pieces-a-renvoyer">
          <p className="text-sm">« {cree.titre} » est {admin ? 'créé' : 'envoyé'}. {restent > 1 ? `${restent} pièces ne sont` : 'Une pièce n’est'} pas encore partie{restent > 1 ? 's' : ''} : elles sont gardées ici.</p>
          <p className="text-xs text-texte-2">Touche « Envoyer les pièces » (ou « réessayer » sur une vignette). Si ça échoue encore, vérifie ta connexion.</p>
          <ChoisirMedias ctrl={pj} testId="medias-creation" />
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog ouvert={ouvert} onFermer={fermer} brouillon={brouillon} titre={admin ? '+ Nouveau chantier' : '+ Nouvelle demande'}
      pied={<><Button onClick={() => { void annuler() }}>Annuler</Button><Button variante="primaire" chargement={envoiEnCours && action === 'creer'} disabled={envoiEnCours && action !== 'creer'} onClick={creer} data-testid="creer-chantier">{libelleCreer(proches.length)}</Button></>}>
      <div className="space-y-3">
        <Champ label="Titre"><Input autoFocus value={titre} onChange={(e) => setTitre(e.target.value)} placeholder="En une phrase : ce qu’il faut faire" data-testid="titre" /></Champ>
        {proches.length ? (
          <div className="rounded-xl border border-l-4 border-bord border-l-attention bg-carte px-3 py-2 text-sm" data-testid="ca-existe-deja">
            <p className="flex items-center gap-1.5 font-medium text-attention"><TriangleAlert size={15} aria-hidden />Ça existe déjà, peut-être :</p>
            <ul className="mt-1.5 space-y-2">
              {proches.map((p) => (
                <li key={p.id} data-testid="proche">
                  <div>• {p.titre} <span className="text-texte-2">({infoEtat(p.etat as Etat).libelle})</span></div>
                  {admin ? (
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Button taille="sm" chargement={action === `completer:${p.id}`} disabled={envoiEnCours && action !== `completer:${p.id}`} onClick={() => { void completer(p) }} data-testid="completer-proche">Compléter celui-ci</Button>
                      <Button taille="sm" chargement={action === `fusionner:${p.id}`} disabled={envoiEnCours && action !== `fusionner:${p.id}`} onClick={() => { void fusionner(p) }} data-testid="fusionner-proche">Fusionner</Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-texte-2">{admin ? 'Compléter ajoute ce que tu tapes à ce chantier ; Fusionner garde les deux demandes en un seul. Ou « Créer quand même ».' : 'Tu peux créer quand même.'}</p>
          </div>
        ) : rechercheErreur ? (
          <p className="text-xs text-texte-2" data-testid="proches-erreur">La recherche de chantiers proches n’a pas répondu : tu peux créer quand même.</p>
        ) : null}
        <Champ label="Demande" aide="Tes mots : ce que tu veux, ce qui ne va pas, comment le reproduire.">
          <Textarea rows={4} value={demande} onChange={(e) => setDemande(e.target.value)} data-testid="demande" />
        </Champ>
        <div>
          <span className="mb-1 block text-sm font-medium text-texte-2">Pièces jointes <span className="font-normal">(photo, vidéo, PDF, tout fichier)</span></span>
          <ChoisirMedias ctrl={pj} testId="medias-creation" />
          <p className="mt-1 text-xs text-texte-2" data-testid="limite-medias">{pj.pieces.length ? 'Envoyées avec la demande, quand tu touches « Créer ». Le crayon sur une photo : dessiner dessus. ' : ''}{TAILLE_MAX_MEDIA / 1024 / 1024} Mo au plus par fichier, {MEDIAS_MAX_PAR_MESSAGE} fichiers au plus.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Champ label="Section">
            <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">Sans section</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </Select>
          </Champ>
          <Champ label="Priorité">
            <Select value={priorite} onChange={(e) => setPriorite(e.target.value as Priorite)}>
              {PRIORITES.map((p) => <option key={p.priorite} value={p.priorite}>{p.libelle}</option>)}
            </Select>
          </Champ>
        </div>
        {admin ? (
          <Champ label="État de départ">
            <Select value={etat} onChange={(e) => setEtat(e.target.value as Etat)}>
              {ETATS.filter((e) => e.etat !== 'valide').map((e) => <option key={e.etat} value={e.etat}>{e.libelle}</option>)}
            </Select>
            <p className="mt-1 text-xs text-texte-2">{infoEtat(etat).aide}{etat === 'a_trier' ? ' Choix par défaut : Claude la lit et la range.' : ''}</p>
          </Champ>
        ) : <p className="text-xs text-texte-2">Ta demande arrive « Pas encore examinée » ; Claude la range, une session la prend, et tu certifies quand c’est livré.</p>}
      </div>
    </Dialog>
  )
}
