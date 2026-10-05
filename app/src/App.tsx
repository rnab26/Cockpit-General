import { useAuth } from './hooks/useAuth.ts'
import { useTheme } from './hooks/useTheme.ts'
import { ToastProvider } from './ui/Toast.tsx'
import { ConfirmProvider } from './ui/Confirm.tsx'
import { Connexion, NouveauMotDePasse } from './components/Connexion.tsx'
import { Cockpit } from './components/Cockpit.tsx'
import { Chargement, Erreur } from './ui/Etats.tsx'
import { Button } from './ui/Button.tsx'
import { NouvelleVersion } from './components/NouvelleVersion.tsx'
import { BandeauFileAttente } from './components/BandeauFileAttente.tsx'

export default function App() {
  const auth = useAuth()
  const [theme, changerTheme] = useTheme()
  let contenu
  if (!auth.pret) contenu = <Chargement texte="Ouverture du cockpit…" />
  else if (!auth.session) contenu = <Connexion seConnecter={auth.seConnecter} sInscrire={auth.sInscrire} motDePasseOublie={auth.motDePasseOublie} />
  else if (auth.recuperation) contenu = <NouveauMotDePasse changer={auth.changerMotDePasse} />
  else if (auth.erreurMoi) contenu = <div className="p-4"><Erreur texte={`Impossible de lire ton profil : ${auth.erreurMoi}`} onReessayer={() => void auth.rechargerMoi()} /><div className="mt-3 text-center"><Button variante="discret" onClick={() => void auth.seDeconnecter()}>Se déconnecter</Button></div></div>
  else if (!auth.moi) contenu = <Chargement texte="Lecture de ton profil…" />
  else contenu = <Cockpit key={auth.moi.user_id} moi={auth.moi} theme={theme} changerTheme={changerTheme} seDeconnecter={auth.seDeconnecter} />
  return (
    <ToastProvider>
      <ConfirmProvider>{contenu}<BandeauFileAttente /></ConfirmProvider>
      <NouvelleVersion />
    </ToastProvider>
  )
}
