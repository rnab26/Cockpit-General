// Filet de sécurité (0044) : la phrase que l'écran affiche. Toute la règle est en base
// (etat_filet) ; ici seulement la mise en mots, testée (verifier-filet.ts).

export interface EtatFiletBase {
  statut: 'actif' | 'eteint' | 'global_eteint' | 'cron_absent' | 'sans_jeton' | 'plafond' | 'test'
  projet_actif: boolean
  plafond: number
  delai_min: number
  aujourdhui: number
  dernier_at: string | null
  dernier_pourquoi: string | null
  attente: { n: number; raisons: string[] }
  vivant: boolean
}

export interface PhraseFilet { ton: 'ok' | 'alerte' | 'neutre'; titre: string; detail: string }

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })

export function phraseFilet(e: EtatFiletBase): PhraseFilet {
  const dernier = e.dernier_at ? `dernier réveil ${hhmm(e.dernier_at)} · ${e.dernier_pourquoi ?? 'du travail attendait'}` : 'aucun réveil pour l’instant'
  const attente = e.attente.n > 0
    ? `${e.attente.raisons.join(', ')} ${e.vivant ? '(une session s’en occupe)' : `(personne dessus : réveil après ${e.delai_min} min)`}`
    : 'rien n’attend'
  switch (e.statut) {
    case 'test': return { ton: 'neutre', titre: 'Filet de sécurité : jamais sur un projet de test', detail: '' }
    case 'global_eteint': return { ton: 'alerte', titre: 'Filet de sécurité : coupé pour tous les projets', detail: 'Rallume-le : scripts/chef.sh --filet-global oui' }
    case 'eteint': return { ton: 'alerte', titre: 'Filet de sécurité : éteint sur ce projet', detail: 'Rien ne réveillera Claude tout seul.' }
    case 'cron_absent': return { ton: 'alerte', titre: 'Filet de sécurité : la surveillance de la base ne tourne pas', detail: 'Le job pg_cron « cockpit-filet-securite » est absent ou coupé.' }
    case 'sans_jeton': return { ton: 'alerte', titre: 'Aucun réveil automatique : colle le jeton dans Réglages', detail: `${attente}. Sans jeton, seul le passage horaire de Claude traite.` }
    case 'plafond': return { ton: 'alerte', titre: `Filet de sécurité : plafond atteint (${e.aujourdhui}/${e.plafond} par jour)`, detail: `${dernier}. ${attente}.` }
    default: return { ton: 'ok', titre: `Filet de sécurité : actif · ${dernier}`, detail: `${attente}. ${e.aujourdhui}/${e.plafond} réveil(s) aujourd’hui.` }
  }
}
