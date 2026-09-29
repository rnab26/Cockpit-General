import { useEffect, useState } from 'react'
import type { Membre, Projet } from '../lib/types.ts'
import { useGlobal } from '../contexte.ts'
import { supabase, messageErreur } from '../lib/supabase.ts'
import { useToast } from '../ui/Toast.tsx'
import { useConfirmer } from '../ui/Confirm.tsx'
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
  const confirmer = useConfirmer()
  const [selection, setSelection] = useState<string | 'nouveau' | null>(null)
  const [f, setF] = useState<Formulaire>(vide())
  const [membres, setMembres] = useState<Membre[] | null>(null)
  const [email, setEmail] = useState('')
  const [cleVisible, setCleVisible] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const projet = projets.find((p) => p.id === selection) ?? null

  useEffect(() => {
    setCleVisible(false); setMembres(null); setEmail('')
    if (selection === 'nouveau') setF(vide())
    else if (projet) { setF(depuis(projet)); void chargerMembres(projet.id) }
  }, [selection, projet?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const chargerMembres = async (id: string) => {
    const { data, error } = await supabase.rpc('membres_du_projet', { p_projet: id })
    if (error) { toast.erreur(messageErreur(error)); return }
    setMembres((data ?? []) as Membre[])
  }

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

  const ajouterMembre = async () => {
    if (!projet || !email.trim()) return
    setEnCours(true)
    const { data, error } = await supabase.rpc('ajouter_membre', { p_projet: projet.id, p_email: email.trim() })
    setEnCours(false)
    if (error) { toast.erreur(messageErreur(error)); return }
    if (data === 'ajouté') { toast.succes(`${email.trim()} ajouté au projet.`); setEmail('') } else toast.erreur(String(data))
    await chargerMembres(projet.id)
  }
  const retirer = async (m: Membre) => {
    if (!projet) return
    const ok = await confirmer({ titre: `Retirer ${m.email} ?`, danger: true, libelleOk: 'Retirer', texte: `Cette personne ne verra plus le projet « ${projet.nom} ». Ses demandes restent.` })
    if (!ok) return
    const { error } = await supabase.from('membres').delete().eq('projet_id', projet.id).eq('user_id', m.user_id)
    if (error) { toast.erreur(messageErreur(error)); return }
    toast.succes(`${m.email} retiré.`); await chargerMembres(projet.id)
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
                <h3 className="text-sm font-semibold">Module embarqué</h3>
                <p className="mt-1 text-xs text-texte-2">La clé identifie le projet côté serveur ; elle ne donne aucun droit direct sur la base. À coller dans le site du projet :</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-carte px-2 py-1.5 text-xs">{cleVisible ? projet.cle_embed : '•'.repeat(24)}</code>
                  <Button taille="sm" onClick={() => setCleVisible(!cleVisible)}>{cleVisible ? 'Masquer' : 'Voir'}</Button>
                  <Button taille="sm" onClick={() => copier(projet.cle_embed, 'Clé')}>Copier</Button>
                </div>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-carte px-2 py-1.5 text-[11px] leading-relaxed"><code>{extraitEmbed(cleVisible ? projet.cle_embed : '…')}</code></pre>
                <div className="mt-2 flex justify-end"><Button taille="sm" onClick={() => copier(extraitEmbed(projet.cle_embed), 'Extrait')}>Copier l’extrait</Button></div>
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold">Membres (utilisateurs finaux)</h3>
                {membres === null ? <p className="text-sm text-texte-2">Chargement…</p> : membres.length === 0 ? <p className="text-sm text-texte-2">Personne pour l’instant : toi seul vois ce projet.</p> : (
                  <ul className="space-y-1">
                    {membres.map((m) => (
                      <li key={m.user_id} className="flex items-center justify-between gap-2 rounded-lg border border-bord px-3 py-2 text-sm">
                        <span className="truncate">{m.email}</span><Button taille="sm" variante="discret" className="text-alerte" onClick={() => retirer(m)}>Retirer</Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex gap-2">
                  <Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="adresse@exemple.com" onKeyDown={(e) => { if (e.key === 'Enter') void ajouterMembre() }} />
                  <Button variante="primaire" chargement={enCours} disabled={!email.trim()} onClick={ajouterMembre}>Ajouter</Button>
                </div>
                <p className="mt-1 text-xs text-texte-2">La personne doit d’abord s’être créé un compte sur cette page de connexion.</p>
              </section>
            </>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}
