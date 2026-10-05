import { useEffect, useState } from 'react'
import type { Projet } from '../lib/types.ts'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { Invites } from './Invites.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Button } from '../ui/Button.tsx'
import { Champ, Input, Interrupteur, Textarea } from '../ui/Champs.tsx'

export const URL_EMBED = 'https://rnab26.github.io/Cockpit-General/embed/cockpit-embed.js'
export function extraitEmbed(cle: string, utilisateur = 'Prénom'): string {
  return `<script src="${URL_EMBED}" data-cle="${cle}" data-utilisateur="${utilisateur}"></script>`
}

type Formulaire = { slug: string; nom: string; description: string; couleur: string; depot: string; url_site: string; actif: boolean }
const vide = (): Formulaire => ({ slug: '', nom: '', description: '', couleur: '#0F766E', depot: '', url_site: '', actif: true })
const depuis = (p: Projet): Formulaire => ({ slug: p.slug, nom: p.nom, description: p.description ?? '', couleur: p.couleur ?? '#0F766E', depot: p.depot ?? '', url_site: p.url_site ?? '', actif: p.actif })

/** Projets & membres (admin) : créer/modifier un projet, clé du module embarqué, membres par e-mail. */
export function ProjetsMembres({ ouvert, onFermer, projets, chargerProjets }: { ouvert: boolean; onFermer: () => void; projets: Projet[]; chargerProjets: () => Promise<Projet[]> }) {
  const { recharger } = useGlobal()
  const toast = useToast()
  const [selection, setSelection] = useState<string | 'nouveau' | null>(null)
  const [f, setF] = useState<Formulaire>(vide())
  const [cleVisible, setCleVisible] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const projet = projets.find((p) => p.id === selection) ?? null

  useEffect(() => {
    setCleVisible(false)
    if (selection === 'nouveau') setF(vide())
    else if (projet) setF(depuis(projet))
  }, [selection, projet?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const enregistrer = async () => {
    if (!f.nom.trim()) { toast.erreur('Donne un nom.'); return }
    if (selection === 'nouveau' && !/^[a-z0-9][a-z0-9-]{1,40}$/.test(f.slug)) { toast.erreur('Slug : lettres minuscules, chiffres et tirets, 2 à 41 caractères.'); return }
    setEnCours(true)
    const valeurs = { nom: f.nom.trim(), description: f.description.trim() || null, couleur: f.couleur || null, depot: f.depot.trim() || null, url_site: f.url_site.trim() || null, actif: f.actif }
    const r = selection === 'nouveau'
      ? await supabase.from('projets').insert({ ...valeurs, slug: f.slug })
      : await supabase.from('projets').update(valeurs).eq('id', selection!)
    setEnCours(false)
    if (r.error) { toast.erreur(messageErreur(r.error)); return }
    toast.succes(selection === 'nouveau' ? `Projet « ${f.nom} » créé.` : 'Projet modifié.')
    const liste = await chargerProjets()
    if (selection === 'nouveau') setSelection(liste.find((p) => p.slug === f.slug)?.id ?? null)
    await recharger()
  }

  const copier = async (texte: string, quoi: string) => {
    try { await navigator.clipboard.writeText(texte); toast.succes(`${quoi} copié.`) } catch { toast.erreur('Copie impossible : sélectionne le texte à la main.') }
  }

  return (
    <Dialog ouvert={ouvert} onFermer={onFermer} titre="Projets & membres" large pied={<Button onClick={onFermer}>Fermer</Button>}>
      {selection === null ? (
        <div className="space-y-2">
          {projets.map((p) => (
            <button key={p.id} type="button" onClick={() => setSelection(p.id)} className="flex w-full items-center gap-3 rounded-xl border border-bord p-3 text-left">
              <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: p.couleur ?? '#888' }} />
              <span className="min-w-0 flex-1"><span className="font-semibold">{p.nom}</span> <span className="text-xs text-texte-2">· {p.slug}{p.depot ? ` · ${p.depot}` : ''}</span></span>
              {!p.actif ? <span className="text-xs text-texte-2">désactivé</span> : null}<span aria-hidden>›</span>
            </button>
          ))}
          <Button variante="primaire" pleine onClick={() => setSelection('nouveau')}>+ Nouveau projet</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <button type="button" className="text-sm text-texte-2 underline-offset-2 hover:underline" onClick={() => setSelection(null)}>‹ Tous les projets</button>
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ label="Nom"><Input value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Champ>
            <Champ label="Slug" aide={selection === 'nouveau' ? 'Identifiant technique, définitif (ex. facepro).' : 'Définitif : les scripts des sessions s’en servent.'}>
              <Input value={f.slug} disabled={selection !== 'nouveau'} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder="mon-projet" />
            </Champ>
            <Champ label="Couleur"><div className="flex items-center gap-2"><input type="color" value={f.couleur} onChange={(e) => setF({ ...f, couleur: e.target.value })} className="h-11 w-14 rounded-lg border border-bord bg-carte" aria-label="Couleur" /><Input value={f.couleur} onChange={(e) => setF({ ...f, couleur: e.target.value })} /></div></Champ>
            <Champ label="Dépôt GitHub"><Input value={f.depot} onChange={(e) => setF({ ...f, depot: e.target.value })} placeholder="rnab26/Facepro" /></Champ>
            <Champ label="URL du site" className="sm:col-span-2"><Input value={f.url_site} onChange={(e) => setF({ ...f, url_site: e.target.value })} placeholder="https://…" inputMode="url" /></Champ>
            <Champ label="Description" className="sm:col-span-2"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Champ>
          </div>
          <Interrupteur actif={f.actif} onChange={(b) => setF({ ...f, actif: b })} label="Projet actif" />
          <div className="flex justify-end"><Button variante="primaire" chargement={enCours} onClick={enregistrer}>{selection === 'nouveau' ? 'Créer le projet' : 'Enregistrer'}</Button></div>

          {projet ? (
            <>
              <section className="rounded-xl bg-carte-2 p-3">
                <h3 className="text-sm font-semibold">Boîte de demandes pour les utilisateurs du site</h3>
                <p className="mt-1 text-xs text-texte-2">Ajoute une petite fenêtre dans le site de ce projet : tes utilisateurs y écrivent une demande ou un bug, ça arrive ici comme chantier, et ils voient où ça en est. Optionnel : sans ça, le projet marche très bien.</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-texte-2">
                  <li>Touche « Copier le code ».</li>
                  <li>Colle-le dans le code du site, juste avant la fin de la page (avant <code>&lt;/body&gt;</code>). Ou envoie-le à la personne qui s’en occupe.</li>
                </ol>
                <div className="mt-2 flex justify-end"><Button variante="primaire" taille="sm" onClick={() => copier(extraitEmbed(projet.cle_embed), 'Code')}>Copier le code</Button></div>
                <details className="mt-2 text-xs text-texte-2" data-testid="embed-confidentialite">
                  <summary className="cursor-pointer font-medium">Détails (code, clé, confidentialité)</summary>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-carte px-2 py-1.5 text-[11px] leading-relaxed"><code>{extraitEmbed(cleVisible ? projet.cle_embed : '…')}</code></pre>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-carte px-2 py-1.5 text-xs">{cleVisible ? projet.cle_embed : '•'.repeat(24)}</code>
                    <Button taille="sm" onClick={() => setCleVisible(!cleVisible)}>{cleVisible ? 'Masquer' : 'Voir'}</Button>
                    <Button taille="sm" onClick={() => copier(projet.cle_embed, 'Clé')}>Copier la clé</Button>
                  </div>
                  <p className="mt-2">La clé sert seulement à reconnaître le projet : elle ne donne aucun accès à la base.</p>
                  <p className="mt-2">Pour t’aider à refaire un bug, le module joint la page (sans jetons ni e-mails), l’appareil, la version du site, les 20 dernières actions (libellés seulement, jamais ce qui est tapé) et les erreurs de la page. Pour ne rien joindre : ajoute <code>data-reproduction="non"</code>.</p>
                </details>
              </section>
              <Invites projetId={projet.id} projetNom={projet.nom} />
            </>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
