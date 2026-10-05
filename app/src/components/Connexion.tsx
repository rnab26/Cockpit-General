import { LayoutDashboard } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '../ui/Button.tsx'
import { Champ, Input } from '../ui/Champs.tsx'
import { BandeauInvitation } from './Invitation.tsx'

type Mode = 'connexion' | 'inscription' | 'oublie'

export function Connexion({ seConnecter, sInscrire, motDePasseOublie }: {
  seConnecter: (email: string, mdp: string) => Promise<void>
  sInscrire: (email: string, mdp: string) => Promise<{ confirmationRequise: boolean }>
  motDePasseOublie: (email: string) => Promise<void>
}) {
  const [mode, setMode] = useState<Mode>('connexion')
  const [email, setEmail] = useState('')
  const [mdp, setMdp] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const envoyer = async (e: FormEvent) => {
    e.preventDefault()
    setErreur(null); setInfo(null); setEnCours(true)
    try {
      if (mode === 'connexion') await seConnecter(email.trim(), mdp)
      else if (mode === 'inscription') {
        const r = await sInscrire(email.trim(), mdp)
        if (r.confirmationRequise) setInfo('Compte créé : confirme ton adresse depuis le mail reçu, puis connecte-toi. Ensuite, demande à Raphaël de t’ajouter à ton projet.')
      } else {
        await motDePasseOublie(email.trim())
        setInfo('Si un compte existe avec cette adresse, un lien pour changer le mot de passe vient de partir.')
      }
    } catch (err) {
      setErreur((err as Error).message)
    } finally {
      setEnCours(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-8">
      <div className="mb-6 text-center">
        <div className="flex justify-center text-accent" aria-hidden><LayoutDashboard size={36} strokeWidth={1.5} /></div>
        <h1 className="mt-2 text-2xl font-bold">Cockpit</h1>
        <p className="text-sm text-texte-2">Les chantiers de tes projets, en direct.</p>
      </div>
      <BandeauInvitation />
      <div className="mb-4 grid grid-cols-2 rounded-xl bg-carte-2 p-1 text-sm font-semibold">
        {(['connexion', 'inscription'] as Mode[]).map((m) => (
          <button key={m} type="button" onClick={() => { setMode(m); setErreur(null); setInfo(null) }}
            className={`h-9 rounded-lg ${mode === m || (mode === 'oublie' && m === 'connexion') ? 'bg-carte shadow' : 'text-texte-2'}`}>
            {m === 'connexion' ? 'Se connecter' : 'Créer un compte'}
          </button>
        ))}
      </div>
      <form onSubmit={envoyer} className="space-y-3 rounded-2xl border border-bord bg-carte p-4">
        <Champ label="E-mail"><Input type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" /></Champ>
        {mode !== 'oublie' ? (
          <Champ label="Mot de passe">
            <Input type="password" name="password" autoComplete={mode === 'inscription' ? 'new-password' : 'current-password'} required minLength={6} value={mdp} onChange={(e) => setMdp(e.target.value)} />
          </Champ>
        ) : <p className="text-sm text-texte-2">On t’envoie un lien pour choisir un nouveau mot de passe.</p>}
        {erreur ? <p role="alert" className="rounded-lg bg-alerte/10 px-3 py-2 text-sm text-alerte">{erreur}</p> : null}
        {info ? <p role="status" className="rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">{info}</p> : null}
        <Button type="submit" variante="primaire" taille="lg" pleine chargement={enCours}>
          {mode === 'connexion' ? 'Se connecter' : mode === 'inscription' ? 'Créer mon compte' : 'Envoyer le lien'}
        </Button>
        <div className="text-center text-sm">
          {mode === 'oublie'
            ? <button type="button" className="text-texte-2 underline" onClick={() => setMode('connexion')}>Retour à la connexion</button>
            : mode === 'connexion'
              ? <button type="button" className="text-texte-2 underline" onClick={() => setMode('oublie')}>Mot de passe oublié ?</button>
              : null}
        </div>
      </form>
    </main>
  )
}

export function NouveauMotDePasse({ changer }: { changer: (mdp: string) => Promise<void> }) {
  const [mdp, setMdp] = useState('')
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-8">
      <form className="space-y-3 rounded-2xl border border-bord bg-carte p-4"
        onSubmit={async (e) => { e.preventDefault(); setEnCours(true); setErreur(null); try { await changer(mdp) } catch (err) { setErreur((err as Error).message) } finally { setEnCours(false) } }}>
        <h1 className="text-lg font-bold">Nouveau mot de passe</h1>
        <Champ label="Mot de passe (6 caractères minimum)"><Input type="password" autoComplete="new-password" required minLength={6} value={mdp} onChange={(e) => setMdp(e.target.value)} /></Champ>
        {erreur ? <p role="alert" className="text-sm text-alerte">{erreur}</p> : null}
        <Button type="submit" variante="primaire" taille="lg" pleine chargement={enCours}>Enregistrer</Button>
      </form>
    </main>
  )
}
