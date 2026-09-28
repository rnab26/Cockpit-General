import { useCockpit } from '../contexte.ts'
import { useToast } from '../ui/Toast.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Button } from '../ui/Button.tsx'
import { FENETRES, FENETRE_DEFAUT, estFenetre, type Fenetre } from '../lib/fenetre.ts'
import type { Theme } from '../hooks/useTheme.ts'

const THEMES: { valeur: Theme; libelle: string }[] = [
  { valeur: 'systeme', libelle: '📱 Système' }, { valeur: 'clair', libelle: '☀️ Clair' }, { valeur: 'sombre', libelle: '🌙 Sombre' },
]

export function Reglages({ ouvert, onFermer, theme, changerTheme, onProjets, seDeconnecter }: {
  ouvert: boolean; onFermer: () => void; theme: Theme; changerTheme: (t: Theme) => void; onProjets: () => void; seDeconnecter: () => Promise<void>
}) {
  const { prefs, poser, admin, moi, projet } = useCockpit()
  const toast = useToast()
  const fenetre: Fenetre = estFenetre(prefs.fenetre_livre) ? prefs.fenetre_livre : FENETRE_DEFAUT
  const choisirFenetre = async (f: Fenetre) => {
    try { await poser('fenetre_livre', f); toast.succes(`« Livré » compte depuis ${FENETRES.find((x) => x.valeur === f)?.libelle.toLowerCase()}.`) }
    catch (e) { toast.erreur((e as Error).message) }
  }
  return (
    <Dialog ouvert={ouvert} onFermer={onFermer} titre="⚙️ Réglages" pied={<Button onClick={onFermer}>Fermer</Button>}>
      <div className="space-y-5">
        <section>
          <h3 className="mb-1 text-sm font-semibold">« Livré » dans « Où j’en suis »</h3>
          <p className="mb-2 text-xs text-texte-2">Depuis minuit local. Suit ton compte, pas ton téléphone.</p>
          <div className="grid grid-cols-3 gap-2" data-testid="fenetre-livre">
            {FENETRES.map((f) => <Button key={f.valeur} variante={fenetre === f.valeur ? 'primaire' : 'secondaire'} onClick={() => choisirFenetre(f.valeur)}>{f.libelle}</Button>)}
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-sm font-semibold">Thème</h3>
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map((t) => <Button key={t.valeur} variante={theme === t.valeur ? 'primaire' : 'secondaire'} onClick={() => changerTheme(t.valeur)}>{t.libelle}</Button>)}
          </div>
        </section>
        {admin ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Administration</h3>
            <Button pleine onClick={() => { onFermer(); onProjets() }}>🏗️ Projets & membres</Button>
          </section>
        ) : null}
        <section className="rounded-xl bg-carte-2 p-3 text-sm">
          <div><span className="text-texte-2">Connecté :</span> {moi.email} {admin ? <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">admin</span> : null}</div>
          <div className="mt-1 text-texte-2">Projet affiché : {projet.nom} ({projet.slug})</div>
          <Button className="mt-3" variante="discret" onClick={() => void seDeconnecter()}>Se déconnecter</Button>
        </section>
      </div>
    </Dialog>
  )
}
