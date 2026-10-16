// Un message n'est pas un chantier (16 oct. 2026, migration 0091, chantier c2c79e7b).
// Raphaël : « chaque message que je crée en discussion est transcrit comme un chantier avec une progression […] il vaut
// mieux une petite pastille de notification et la discussion concernant le chantier en question. »
// Les règles pures de l'écran : une barre sans pourcentage ne dit jamais « 0 % », une conversation SANS chantier est une
// ligne (jamais une barre) qui dit ce qu'elle fait à l'instant, et la réponse d'une session dans la discussion du projet
// allume la pastille de cette discussion.
import { verifie, bilan } from './_assert.ts'
import { sansPourcentage } from '../src/lib/presence.ts'
import { actionEnDirect, horsChantier, ACTION_EN_DIRECT_MS } from '../src/lib/entonnoir.ts'
import { quiTravaille } from '../src/lib/sessions.ts'
import { cleFil, reponsesNonLues } from '../src/lib/lecture.ts'

const now = new Date('2026-10-16T01:00:00Z')
const il = (s: number) => new Date(now.getTime() - s * 1000).toISOString()

console.log('verifier-messages-fils')

// 1. « 0 % » n'est jamais écrit quand la session n'a donné aucun pourcentage
verifie('barre née d\'une action en direct, aucun pourcentage : « sans pourcentage »', sansPourcentage({ pct_estime: false, pourcentage: 0 }))
verifie('la session a donné 35 % (même si le drapeau est resté faux) : un vrai pourcentage', !sansPourcentage({ pct_estime: false, pourcentage: 35 }))
verifie('pourcentage estimé à 0 (une vraie barre qui démarre) : un vrai pourcentage', !sansPourcentage({ pct_estime: true, pourcentage: 0 }))
verifie('ligne d\'avant 0087 (drapeau absent) : un vrai pourcentage', !sansPourcentage({ pourcentage: 0 } as never))
verifie('aucune activité : pas de barre à décrire', !sansPourcentage(null) && !sansPourcentage(undefined))

// 2. L'action en direct d'une session (et seulement tant qu'elle est récente)
const session = (extra: Record<string, unknown> = {}) => ({
  id: 's1', projet_id: 'p', branche: 'main', sujet: 'Corriger le bandeau', tour_en_cours: true, demarre_at: il(3600), vu_at: il(10), fin_at: null,
  pause_raison: null, pause_at: null, pause_detail: null, relances: 0, action_live: null, action_live_at: null, ...extra,
}) as never
verifie('action récente : dite telle quelle', actionEnDirect({ action_live: 'Modifie Bandeau.tsx', action_live_at: il(20) }, now) === 'Modifie Bandeau.tsx')
verifie('action trop vieille : plus « à l\'instant »', actionEnDirect({ action_live: 'Modifie Bandeau.tsx', action_live_at: il(ACTION_EN_DIRECT_MS / 1000 + 5) }, now) === null)
verifie('action effacée par la fin du tour : rien', actionEnDirect({ action_live: null, action_live_at: null }, now) === null)
verifie('action vide ou espaces : rien', actionEnDirect({ action_live: '  ', action_live_at: il(5) }, now) === null)

// 3. Une conversation SANS chantier est une ligne, jamais une barre
const groupes = (s: unknown) => quiTravaille([s as never], [], [], [], now, 15 * 60_000, ['p'])
let h = horsChantier(groupes(session({ action_live: 'Lance : le banc des cartes', action_live_at: il(8) })), now)
verifie('session sans chantier qui travaille : UNE ligne qui dit ce qu\'elle fait', h.length === 1 && /travaille : Lance : le banc des cartes/.test(h[0].texte) && h[0].enDirect, h)
h = horsChantier(groupes(session()), now)
verifie('…sans action connue : « travaille sur autre chose », toujours en direct (elle répond)', h.length === 1 && /travaille sur autre chose/.test(h[0].texte) && h[0].enDirect, h)
h = horsChantier(groupes(session({ tour_en_cours: false })), now)
verifie('…hors d\'un tour : « attend ton message », sans point vivant', h.length === 1 && /attend ton message/.test(h[0].texte) && !h[0].enDirect, h)
h = horsChantier(groupes(session({ pause_raison: 'rate_limit', pause_at: il(60), action_live: 'Modifie X', action_live_at: il(5) })), now)
verifie('…en pause (limite d\'usage) : la pause passe avant l\'action', h.length === 1 && /en pause/.test(h[0].texte) && !/Modifie X/.test(h[0].texte) && h[0].pause && !h[0].enDirect, h)

// 4. La pastille de la discussion du projet : la réponse d'une session sans chantier l'allume
const rep = (chantier: string | null, quand: string) => ({ projet_id: 'p', chantier_id: chantier, auteur_type: 'session', kind: 'info', repond_a: 'm1', created_at: quand }) as never
const nl = reponsesNonLues([rep(null, il(30)), rep('c1', il(20))], {}, il(3600))
verifie('réponse dans la discussion du projet : pastille sur la clé « projet:… » (celle que lit la ligne de session)', nl.get(cleFil('p', null))?.n === 1, [...nl.entries()])
verifie('réponse dans un chantier : pastille sur ce chantier, pas sur la discussion', nl.get('c1')?.n === 1 && nl.get(cleFil('p', null))?.n === 1)
verifie('discussion ouverte (lue jusqu\'après la réponse) : plus de pastille', reponsesNonLues([rep(null, il(30))], { [cleFil('p', null)]: il(10) }, il(3600)).size === 0)

bilan('verifier-messages-fils')
