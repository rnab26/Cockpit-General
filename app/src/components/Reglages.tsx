import { Monitor, Moon, Sun } from 'lucide-react'
import { useGlobal } from '../contexte.ts'
import { useToast } from '../ui/Toast.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Button } from '../ui/Button.tsx'
import { FENETRES, FENETRE_DEFAUT, estFenetre, type Fenetre } from '../lib/fenetre.ts'
import { CLE_PREF_SILENCE, SILENCES_MIN, silenceMsDe } from '../lib/presence.ts'
import type { Theme } from '../hooks/useTheme.ts'
import { SectionInstallation } from './InstallerAppli.tsx'
import { SectionNotifications } from './NotificationsPush.tsx'

const THEMES: { valeur: Theme; libelle: string; I: typeof Sun }[] = [
  { valeur: 'systeme', libelle: 'Système', I: Monitor }, { valeur: 'clair', libelle: 'Clair', I: Sun }, { valeur: 'sombre', libelle: 'Sombre', I: Moon },
]

export function Reglages({ ouvert, onFermer, theme, changerTheme, onProjets, seDeconnecter, onAideInstallation }: {
  ouvert: boolean; onFermer: () => void; theme: Theme; changerTheme: (t: Theme) => void; onProjets: () => void; seDeconnecter: () => Promise<void>
  onAideInstallation: () => void
}) {
  const { prefs, poser, admin, moi, projets, vue } = useGlobal()
  const projet = projets.find((p) => p.id === vue) ?? null
  const toast = useToast()
  const fenetre: Fenetre = estFenetre(prefs.fenetre_livre) ? prefs.fenetre_livre : FENETRE_DEFAUT
  const silenceMin = silenceMsDe(prefs[CLE_PREF_SILENCE]) / 60_000
  const choisirSilence = async (m: number) => {
    try { await poser(CLE_PREF_SILENCE, m); toast.succes(`Une session sans nouvelle depuis ${m} min passe en « Pris, mais silencieux ».`) }
    catch (e) { toast.erreur((e as Error).message) }
  }
  const choisirFenetre = async (f: Fenetre) => {
    try { await poser('fenetre_livre', f); toast.succes(`« Certifiés récemment » compte depuis ${FENETRES.find((x) => x.valeur === f)?.libelle.toLowerCase()}.`) }
    catch (e) { toast.erreur((e as Error).message) }
  }
  return (
    <Dialog ouvert={ouvert} onFermer={onFermer} titre="Réglages" pied={<Button onClick={onFermer}>Fermer</Button>}>
      <div className="space-y-5">
        <section>
          <h3 className="mb-1 text-sm font-semibold">Délai avant de considérer une session comme silencieuse</h3>
          <p className="mb-2 text-xs text-texte-2">Une session qui n’a rien signalé depuis ce délai n’est plus comptée « en train de travailler » : sa barre devient grise et le chantier propose de la relancer. Suit ton compte.</p>
          <div className="grid grid-cols-5 gap-1.5" data-testid="silence-minutes">
            {SILENCES_MIN.map((m) => <Button key={m} taille="sm" variante={silenceMin === m ? 'primaire' : 'secondaire'} aria-pressed={silenceMin === m} onClick={() => choisirSilence(m)}>{m} min</Button>)}
          </div>
        </section>
        <section>
          <h3 className="mb-1 text-sm font-semibold">« Certifiés récemment » (tuile « fini »)</h3>
          <p className="mb-2 text-xs text-texte-2">Depuis minuit local. Suit ton compte, pas ton téléphone.</p>
          <div className="grid grid-cols-3 gap-2" data-testid="fenetre-livre">
            {FENETRES.map((f) => <Button key={f.valeur} variante={fenetre === f.valeur ? 'primaire' : 'secondaire'} onClick={() => choisirFenetre(f.valeur)}>{f.libelle}</Button>)}
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Thème</h3>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => <Button key={t.valeur} variante={theme === t.valeur ? 'primaire' : 'secondaire'} onClick={() => changerTheme(t.valeur)}><t.I size={16} aria-hidden />{t.libelle}</Button>)}
          </div>
        </section>
        <SectionNotifications ouvrirAide={() => { onFermer(); onAideInstallation() }} />
        <SectionInstallation ouvrirAide={() => { onFermer(); onAideInstallation() }} />
        {admin ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Administration</h3>
            <Button pleine onClick={() => { onFermer(); onProjets() }}>Projets & membres</Button>
          </section>
        ) : null}
        <section className="rounded-xl bg-carte-2 p-3 text-sm">
          <div><span className="text-texte-2">Connecté :</span> {moi.email} {admin ? <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">admin</span> : null}</div>
          <div className="mt-1 text-texte-2">Affiché : {projet ? `${projet.nom} (${projet.slug})` : 'tous les projets (onglet Tout)'}</div>
          <Button className="mt-3" variante="discret" onClick={() => void seDeconnecter()}>Se déconnecter</Button>
        </section>
      </div>
    </Dialog>
  )
}
