// « Branché ? » (src/lib/branchement.ts) : preuves lues, jamais supposées.
import { verifie, bilan } from './_assert.ts'
import { etatBranchement, estBranche, lireCockpitSurMain, memeProprietaire, sessionReelle } from '../src/lib/branchement.ts'
const now = new Date('2026-09-29T02:00:00Z')
const il = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
console.log('verifier-branchement')
{
  const l = etatBranchement({}, 0, now)
  verifie('jamais vu → le dit en clair', /Aucune session/.test(l[0].texte) && l[0].teinte === 'attention', l)
  verifie('module du site jamais vu → « pas encore installé »', /pas encore installé/.test(l[l.length - 1].texte))
}
{
  const l = etatBranchement({ branchement_vu_at: il(3), embed_vu_at: il(10) }, 5, now)
  verifie('session récente → « Sessions branchées », vert, avec le nombre de chantiers', /Sessions branchées/.test(l[0].texte) && /5 chantiers/.test(l[0].texte) && l[0].teinte === 'ok', l[0])
  verifie('module vu → « vu il y a … »', /Module du site : vu/.test(l[l.length - 1].texte))
}
{
  const l = etatBranchement({ branchement_vu_at: il(3 * 24 * 60) }, 1, now)
  verifie('plus de session depuis 3 jours → alerte', /Plus aucune session/.test(l[0].texte) && l[0].teinte === 'attention' && /1 chantier ouvert /.test(l[0].texte), l[0])
}
{
  const l = etatBranchement({ branchement_vu_at: il(1), branchement_maj_at: il(1) }, 0, now)
  verifie('mise à jour automatique récente → affichée', l.some((x) => /Mis à jour automatiquement/.test(x.texte)))
  const v = etatBranchement({ branchement_vu_at: il(1), branchement_maj_at: il(3 * 24 * 60) }, 0, now)
  verifie('mise à jour ancienne → plus affichée', !v.some((x) => /Mis à jour automatiquement/.test(x.texte)))
}
{
  verifie('estBranche : session récente → vrai', estBranche({ branchement_vu_at: il(3) }, now))
  verifie('estBranche : jamais vu → faux', !estBranche({}, now))
  verifie('estBranche : plus de 24 h → faux', !estBranche({ branchement_vu_at: il(3 * 24 * 60) }, now))
}
// 13 oct. 2026 : un « démarrage » de 0 s (préchauffage du conteneur) ne prouve pas qu'une session est branchée.
{
  const S = (demarreIl: number, vuIl: number, finIl: number | null) => ({ demarre_at: il(demarreIl), vu_at: il(vuIl), fin_at: finIl === null ? null : il(finIl) })
  verifie('vraie session : encore vivante', sessionReelle(S(30, 1, null), now))
  verifie('vraie session : finie après plus de 2 minutes', sessionReelle(S(60, 5, 5), now) && sessionReelle(S(10, 2, 7), now))
  verifie('pas une vraie session : un démarrage de 0 s, ou de 1 minute', !sessionReelle(S(500, 500, 500), now) && !sessionReelle(S(10, 9, 9), now))
  verifie('pas une vraie session : plus vue depuis 24 h', !sessionReelle(S(3 * 24 * 60, 2 * 24 * 60, null), now))
  const preuve = { branchement_vu_at: il(3) }
  verifie('estBranche avec les sessions : le préchauffage seul (0 s) n’allume PAS l’icône', !estBranche(preuve, now, [S(3, 3, 3)]))
  verifie('estBranche avec les sessions : une vraie session l’allume', estBranche(preuve, now, [S(3, 3, 3), S(40, 1, null)]))
  verifie('estBranche sans la liste des sessions (membre) : la règle d’avant', estBranche(preuve, now))
  verifie('estBranche : sans démarrage récent, une session vivante ne suffit pas (la preuve du hook manque)', !estBranche({ branchement_vu_at: il(3 * 24 * 60) }, now, [S(40, 1, null)]))
  verifie('estBranche : aucune session du tout → éteinte', !estBranche(preuve, now, []))
}
// 14 oct. 2026 (Melissa Nabet, Trieur) : l'écran doit dire POURQUOI la prise est éteinte, avec la cause lue sur le dépôt.
{
  const REGLAGES_MELISSA = '{ "hooks": { "SessionStart": [ { "hooks": [ { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh" } ] } ] } }'
  const REGLAGES_BRANCHES = '{ "env": { "COCKPIT_PROJET": "trieur-data" }, "hooks": {} }'
  verifie('lire : réglages de main avec COCKPIT_PROJET → le cockpit est installé', lireCockpitSurMain({ statut: 200, texte: REGLAGES_BRANCHES, depotPublic: null }) === 'present')
  verifie('lire : réglages de main SANS le cockpit (le cas de Melissa : son propre hook seulement) → absent', lireCockpitSurMain({ statut: 200, texte: REGLAGES_MELISSA, depotPublic: null }) === 'absent')
  verifie('lire : fichier absent d’un dépôt PUBLIC → absent', lireCockpitSurMain({ statut: 404, texte: null, depotPublic: true }) === 'absent')
  verifie('lire : fichier absent d’un dépôt privé (ou inconnu) → on ne devine pas', lireCockpitSurMain({ statut: 404, texte: null, depotPublic: false }) === 'inconnu' && lireCockpitSurMain({ statut: 404, texte: null, depotPublic: null }) === 'inconnu')
  verifie('lire : pas de réponse, limite de GitHub, erreur du serveur → inconnu', [0, 403, 429, 500].every((statut) => lireCockpitSurMain({ statut, texte: null, depotPublic: null }) === 'inconnu'))
  verifie('lire : 200 sans texte lisible → inconnu', lireCockpitSurMain({ statut: 200, texte: null, depotPublic: null }) === 'inconnu')
  verifie('même propriétaire : deux dépôts de Raphaël (casse ignorée)', memeProprietaire('rnab26/Melissa-Nabet', 'RNAB26/Cockpit-General'))
  verifie('même propriétaire : le dépôt d’un client n’est pas concerné (voies « invisible » et « branches »)', !memeProprietaire('client/site', 'rnab26/Cockpit-General'))
  verifie('même propriétaire : sans dépôt, rien', !memeProprietaire(null, 'rnab26/x') && !memeProprietaire('rnab26/x', null) && !memeProprietaire('', ''))

  const S = (demarreIl: number, vuIl: number, finIl: number | null) => ({ demarre_at: il(demarreIl), vu_at: il(vuIl), fin_at: finIl === null ? null : il(finIl) })
  // Melissa : plus de session depuis 15 jours, le cockpit n'est que sur une branche de travail.
  {
    const l = etatBranchement({ branchement_vu_at: il(15 * 24 * 60) }, 0, now, { sessions: [S(15 * 24 * 60, 15 * 24 * 60, 15 * 24 * 60)], surMain: 'absent' })
    verifie('Melissa : « Plus aucune session depuis 15 j »', /Plus aucune session depuis/.test(l[0].texte) && /15 j/.test(l[0].texte), l[0])
    verifie('Melissa : la ligne suivante donne la cause — pas installé sur la branche principale', /pas installé sur la branche principale/.test(l[1].texte) && l[1].teinte === 'attention', l[1])
    verifie('Melissa : …et la phrase à dire pour y remédier', /« branche le cockpit »/.test(l[1].texte), l[1])
  }
  // Trieur : branché et prouvé à la main, mais aucune vraie session n'a encore tourné.
  {
    const l = etatBranchement({ branchement_vu_at: il(60), embed_vu_at: il(10) }, 3, now, { sessions: [], surMain: 'present' })
    verifie('Trieur : ne dit PAS « Sessions branchées » tant qu’aucune vraie session n’a tourné (comme l’icône)', !l.some((x) => /Sessions branchées/.test(x.texte)), l)
    verifie('Trieur : dit que le cockpit a répondu mais qu’aucune vraie session n’a tourné', /a répondu .*aucune vraie session/.test(l[0].texte), l[0])
    verifie('Trieur : dit que le cockpit est bien installé sur la branche principale, la prise s’allume à la première session', /bien installé sur la branche principale/.test(l[1].texte) && l[1].teinte === 'neutre', l[1])
  }
  // Un démarrage de 0 s (préchauffage) ne compte pas non plus.
  {
    const l = etatBranchement({ branchement_vu_at: il(3) }, 0, now, { sessions: [S(3, 3, 3)] })
    verifie('un démarrage de 0 s seul : pas « Sessions branchées »', !/Sessions branchées/.test(l[0].texte) && /aucune vraie session/.test(l[0].texte), l[0])
  }
  // Projet branché ET installé sur main : rien à ajouter.
  {
    const l = etatBranchement({ branchement_vu_at: il(3) }, 2, now, { sessions: [S(40, 1, null)], surMain: 'present' })
    verifie('projet branché et installé sur main : « Sessions branchées », aucune ligne de cause', /Sessions branchées/.test(l[0].texte) && !l.some((x) => /branche principale/.test(x.texte)), l)
  }
  // Une session vient de se brancher, mais sur une branche de travail : la prochaine session ouverte sur main n'aura pas le cockpit.
  {
    const l = etatBranchement({ branchement_vu_at: il(3) }, 2, now, { sessions: [S(40, 1, null)], surMain: 'absent' })
    verifie('session branchée mais cockpit absent de main : on le dit quand même (la prise verte ne tiendra pas)', /Sessions branchées/.test(l[0].texte) && /pas installé sur la branche principale/.test(l[1].texte) && l[1].teinte === 'attention', l)
  }
  // Membre (pas la liste des sessions) : la règle d'avant, et jamais de lecture du dépôt.
  {
    const l = etatBranchement({ branchement_vu_at: il(3) }, 1, now)
    verifie('sans la liste des sessions (membre) : la règle d’avant', /Sessions branchées/.test(l[0].texte) && l[0].teinte === 'ok', l[0])
  }
  // Lecture impossible ou pas encore faite : rien d'inventé.
  {
    const vieux = { branchement_vu_at: il(15 * 24 * 60) }
    verifie('cause inconnue ou pas encore lue : aucune ligne de plus (on ne devine pas)',
      etatBranchement(vieux, 0, now, { surMain: 'inconnu' }).length === etatBranchement(vieux, 0, now).length
      && etatBranchement(vieux, 0, now, { surMain: null }).length === etatBranchement(vieux, 0, now).length)
  }
  // Jamais branché : la cause aide autant.
  {
    const l = etatBranchement({}, 0, now, { surMain: 'absent' })
    verifie('jamais branché + cockpit absent de main : les deux lignes', /Aucune session/.test(l[0].texte) && /pas installé sur la branche principale/.test(l[1].texte), l)
  }
}
bilan('verifier-branchement')
