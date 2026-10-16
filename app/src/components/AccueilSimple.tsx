import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FlaskConical, Rocket } from 'lucide-react'
import { useGlobal } from '../contexte.ts'
import { trierAToi, type ElementAToi, type TriAToi } from '../lib/entonnoir.ts'
import { FENETRES } from '../lib/fenetre.ts'
import { quandFini } from '../lib/ouJenSuis.ts'
import { dateLongue } from '../lib/dates.ts'
import { libelleATester, libelleEnAttente, phraseSansChantier, VISIBLES_ACCUEIL } from '../lib/vueAccueil.ts'
import { useVueAccueil } from '../hooks/useVueAccueil.ts'
import { Button } from '../ui/Button.tsx'
import { EcrireAuProjet, LigneAToi, LigneAvance, LigneSession, ListeChantiers, ListeUl, Tuiles, VoirPlus, useTableauDeBord, type Liste } from './TableauDeBord.tsx'
import { ClasserLivres } from './ClasserLivres.tsx'
import { LigneRetireesSeules } from './CartesRetireesSeules.tsx'
import { PastilleReponse } from './PastilleReponse.tsx'
import { PointProjet } from './Icones.tsx'

/**
 * L'accueil simple (13 oct. 2026, Raphaël : « il y a encore trop d'informations […] fais au plus simple possible »).
 * Les six boxes avec le nombre de chantiers (« j'en ai besoin », 13 oct.), puis trois blocs, dans l'ordre où on agit :
 * À toi (ce que Claude attend), En cours (ce qui avance, avec sa barre), Livré (ce qui est fini).
 * Les nombres viennent de lib/tableauDeBord.ts, comme la vue détaillée : une seule règle. Règles d'affichage : lib/vueAccueil.ts.
 * `seulementEntre` : un autre onglet du projet est ouvert (réglages, coûts) — on ne montre que les boxes et la barre d'onglets.
 */
export function AccueilSimple({ projetId, entre, seulementEntre = false }: { projetId: string | null; entre?: ReactNode; seulementEntre?: boolean }) {
  const g = useGlobal()
  const [, poserVue] = useVueAccueil()
  const { t, fenetre } = useTableauDeBord(projetId)
  const [liste, setListe] = useState<Liste | null>(null)
  const avecProjet = !projetId && g.projets.length > 1
  const tri: TriAToi = g.prefs.tri_a_toi === 'anciens' ? 'anciens' : 'recents'
  const demandes = useMemo(() => trierAToi(t.aToi, tri), [t.aToi, tri])
  const libelleFenetre = FENETRES.find((f) => f.valeur === fenetre)?.libelle.toLowerCase() ?? ''
  const attente = t.pretALancer.length + t.sansSession.length
  const changerFenetre = () => {
    const i = FENETRES.findIndex((f) => f.valeur === fenetre)
    void g.poser('fenetre_livre', FENETRES[(i + 1) % FENETRES.length].valeur)
  }
  // Les boxes d'abord, comme dans la vue détaillée ; les icônes du projet (`entre`) juste dessous.
  const boxes = <Tuiles t={t} projetId={projetId} fenetre={fenetre} compact />
  if (seulementEntre) return <div className="space-y-5">{boxes}{entre}</div>
  return (
    <div className="space-y-5" data-testid="accueil-simple">
      {boxes}
      {entre}
      {projetId ? <EcrireAuProjet projetId={projetId} /> : null}

      <Bloc titre="À toi" sous="Ce que Claude attend de toi" n={demandes.length} testId="accueil-a-toi" alerte>
        <DemandesAToi demandes={demandes} avecProjet={avecProjet} />
        <LigneRetireesSeules projetId={projetId} />
        <LivresATester elements={t.aTester} avecProjet={avecProjet} projetId={projetId} />
      </Bloc>

      <Bloc titre="En cours" sous="Ce sur quoi Claude travaille" n={t.caAvance.length} testId="accueil-en-cours">
        {t.caAvance.length === 0 && t.horsChantier.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-bord px-3 py-3 text-center text-[15px] text-texte-2" data-testid="accueil-personne">
            {phraseSansChantier(t.resume, !!projetId) ?? <>Personne ne travaille {projetId ? 'sur ce projet ' : ''}en ce moment.</>}
          </p>
        ) : null}
        {t.caAvance.length ? <EnCours lignes={t.caAvance} avecProjet={avecProjet} /> : null}
        {/* Une conversation ouverte qui ne porte aucun chantier (0091) : une ligne sans barre, un toucher ouvre la discussion du projet. */}
        {t.horsChantier.length ? (
          <ListeUl>{t.horsChantier.map((h) => <LigneSession key={h.cle} h={h} avecProjet={avecProjet} />)}</ListeUl>
        ) : null}
        {attente ? (
          <button type="button" data-testid="accueil-en-attente"
            onClick={() => setListe({ titre: 'En attente d’une session', ids: [...t.pretALancer, ...t.sansSession].map((l) => l.c.id), n: attente, enAttente: true, aide: 'prêts à démarrer, ou en cours sans session dessus : rien ne les bloque, personne ne les a encore pris' })}
            className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-bord bg-carte px-3 text-left text-[15px] transition hover:bg-carte-2 active:scale-[.99]">
            <Rocket size={16} className="shrink-0 text-texte-2" aria-hidden />
            <span className="flex-1">{libelleEnAttente(attente)}</span>
            <span className="text-sm font-medium text-accent">Voir</span>
            <ChevronRight size={16} className="shrink-0 text-texte-2" aria-hidden />
          </button>
        ) : null}
      </Bloc>

      <Bloc titre="Livré" sous={`Certifié ${libelleFenetre}`} n={t.fini.length} testId="accueil-livre"
        action={<button type="button" onClick={changerFenetre} data-testid="accueil-fenetre" className="text-xs text-texte-2 underline-offset-2 hover:underline">changer</button>}>
        {t.fini.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-bord px-3 py-3 text-center text-[15px] text-texte-2" data-testid="accueil-rien-livre">Rien de certifié {libelleFenetre}.</p>
        ) : (
          <ListeUl>
            {t.fini.slice(0, VISIBLES_ACCUEIL.livre).map((c) => {
              const projet = g.projets.find((p) => p.id === c.projet_id)
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => g.ouvrirChantier(c.projet_id, c.id)} data-testid="accueil-ligne-livre"
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[15px] leading-snug">{c.titre}</span>
                      <span className="flex items-center gap-1.5 text-xs text-texte-2">
                        {avecProjet ? <><PointProjet couleur={projet?.couleur} /><span className="truncate">{projet?.nom}</span><span>·</span></> : null}
                        <span className="tabular-nums" title={dateLongue(c.valide_at)}>{quandFini(c, g.moi.email, g.now)}</span>
                      </span>
                    </span>
                    <PastilleReponse cle={c.id} />
                    <ChevronRight size={16} className="shrink-0 text-texte-2" aria-hidden />
                  </button>
                </li>
              )
            })}
            <VoirPlus reste={t.fini.length - VISIBLES_ACCUEIL.livre} testId="accueil-voir-livre"
              onClick={() => setListe({ titre: `Fini ${libelleFenetre}`, ids: t.fini.map((c) => c.id), n: t.fini.length, fini: true, aide: 'certifié dans la période choisie' })} />
          </ListeUl>
        )}
      </Bloc>

      <div className="flex justify-center pt-1">
        <Button taille="sm" variante="discret" onClick={() => poserVue('detaillee')} data-testid="vue-detaillee">Vue détaillée</Button>
      </div>
      <ListeChantiers liste={liste} onFermer={() => setListe(null)} avance={t.caAvance} aToi={t.aToi} />
    </div>
  )
}

/** Un bloc de l'accueil : un titre franc, sa phrase d'aide, son compteur. */
function Bloc({ titre, sous, n, testId, alerte = false, action, children }: { titre: string; sous: string; n: number; testId: string; alerte?: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={titre} data-testid={testId} className="space-y-2">
      <h2 className="flex items-baseline gap-2 px-1">
        <span className="text-lg font-semibold">{titre}</span>
        <span className={`text-lg font-semibold tabular-nums ${alerte && n ? 'text-alerte' : 'text-texte-2'}`} data-testid={`${testId}-total`}>{n}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-normal text-texte-2">{sous}</span>
        {action}
      </h2>
      {children}
    </section>
  )
}

/** Les demandes de Claude : cinq au plus, le plus récent en haut ; rien à faire = une phrase, pas un tableau vide. */
function DemandesAToi({ demandes, avecProjet }: { demandes: ElementAToi[]; avecProjet: boolean }) {
  const [tout, setTout] = useState(false)
  if (demandes.length === 0) {
    return <p className="rounded-2xl border border-dashed border-bord px-3 py-4 text-center text-[15px] text-texte-2" data-testid="rien-ne-t-attend">Rien ne t’attend. Claude n’a besoin de rien.</p>
  }
  const visibles = tout ? demandes : demandes.slice(0, VISIBLES_ACCUEIL.demandes)
  return (
    <ListeUl>
      {visibles.map((e) => <LigneAToi key={e.cle} e={e} avecProjet={avecProjet} />)}
      <VoirPlus reste={demandes.length - visibles.length} onClick={() => setTout(true)} testId="accueil-voir-demandes" />
    </ListeUl>
  )
}

/** « 12 livrés à tester » : une ligne repliée sous les demandes (un test n'est pas une demande de Claude), la liste à un toucher. */
function LivresATester({ elements, avecProjet, projetId }: { elements: ElementAToi[]; avecProjet: boolean; projetId: string | null }) {
  const [ouvert, setOuvert] = useState(false)
  const [tout, setTout] = useState(false)
  if (!elements.length) return null
  const visibles = tout ? elements : elements.slice(0, VISIBLES_ACCUEIL.aTester)
  return (
    <div data-testid="accueil-a-tester">
      <button type="button" onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert} data-testid="accueil-a-tester-repli"
        className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-bord bg-carte px-3 text-left text-[15px] transition hover:bg-carte-2 active:scale-[.99]">
        <FlaskConical size={16} className="shrink-0 text-attention" aria-hidden />
        <span className="flex-1"><span data-testid="accueil-a-tester-libelle">{libelleATester(elements.length)}</span><span className="text-xs text-texte-2"> · sans urgence</span></span>
        <ChevronDown size={16} className={`shrink-0 text-texte-2 transition ${ouvert ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {ouvert ? (
        <div className="mt-1.5">
          <ListeUl>
            {visibles.map((e) => <LigneAToi key={e.cle} e={e} avecProjet={avecProjet} />)}
            <VoirPlus reste={elements.length - visibles.length} onClick={() => setTout(true)} testId="accueil-voir-a-tester" />
          </ListeUl>
          <div className="mt-1.5"><ClasserLivres elements={elements} projetId={projetId} /></div>
        </div>
      ) : null}
    </div>
  )
}

/** Ce qui avance vraiment (une preuve de vie), cinq lignes au plus. */
function EnCours({ lignes, avecProjet }: { lignes: ReturnType<typeof useTableauDeBord>['t']['caAvance']; avecProjet: boolean }) {
  const [tout, setTout] = useState(false)
  const visibles = tout ? lignes : lignes.slice(0, VISIBLES_ACCUEIL.enCours)
  return (
    <ListeUl>
      {visibles.map((l) => <LigneAvance key={l.c.id} l={l} avecProjet={avecProjet} />)}
      <VoirPlus reste={lignes.length - visibles.length} onClick={() => setTout(true)} testId="accueil-voir-en-cours" />
    </ListeUl>
  )
}
