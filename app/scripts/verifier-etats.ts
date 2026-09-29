// Libellés d'état, badge « réponse attendue », bac, teinte de progression.
import { verifie, bilan } from './_assert.ts'
import { ETATS, infoEtat, badgeChantier, BADGE_REPONSE_ATTENDUE, bacDe, teinteProgression } from '../src/lib/etats.ts'

console.log('verifier-etats')
verifie('les huit états du schéma ont un libellé', ETATS.length === 8 &&
  ['a_trier','a_cadrer','libre','en_cours','a_verifier','valide','bloque','reporte'].every((e) => ETATS.some((x) => x.etat === e)))
verifie('chaque libellé est en mots, SANS emoji (29 sept. : « des logos plutôt que des emojis »), et diffère du code', ETATS.every((e) => !/\p{Extended_Pictographic}/u.test(e.libelle) && e.libelle !== e.etat))
verifie('a_trier se lit « Pas encore examinée »', infoEtat('a_trier').libelle.includes('Pas encore examinée'))
verifie('a_verifier se lit « Codée, à vérifier »', infoEtat('a_verifier').libelle.includes('Codée, à vérifier'))
verifie('valide se lit « Certifiée »', infoEtat('valide').libelle.includes('Certifiée'))
verifie('une question en attente remplace le badge d’état', badgeChantier({ etat: 'libre' }, true).libelle === BADGE_REPONSE_ATTENDUE)
verifie('sans question, le badge est celui de l’état', badgeChantier({ etat: 'libre' }, false).libelle === infoEtat('libre').libelle)
verifie('un chantier valide va dans « Actif », même archivé', bacDe({ etat: 'valide', archived_at: '2026-09-28T10:00:00Z' }) === 'actif')
verifie('un archivé non valide (doublon) va dans « Archives »', bacDe({ etat: 'libre', archived_at: '2026-09-28T10:00:00Z' }) === 'archives')
verifie('un ouvert va dans « En cours d’optimisation »', bacDe({ etat: 'a_verifier', archived_at: null }) === 'optimisation')
verifie('progression 100 → vert', teinteProgression(100, 'en_cours') === 'ok')
verifie('progression terminée à 80 → vert quand même', teinteProgression(80, 'termine') === 'ok')
verifie('progression 55 → ambre', teinteProgression(55, 'en_cours') === 'attention')
verifie('progression 29 → rouge', teinteProgression(29, 'en_cours') === 'alerte')
verifie('progression 30 → ambre (borne)', teinteProgression(30, 'en_cours') === 'attention')
verifie('un échec est rouge quel que soit le pourcentage', teinteProgression(90, 'echec') === 'alerte')
bilan('verifier-etats')
