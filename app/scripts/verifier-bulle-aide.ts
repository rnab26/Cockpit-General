// Bulle flottante d'aide : allumée par défaut, projet choisi en vue « Tout », fil libre.
import { verifie, bilan } from './_assert.ts'
import { aCiter, auteurDe, avecCitation, bulleActive, citationDe, citer, cleBulle, cartesAFaire, constructeurVoix, apercuDe, detailDeCarte, filDeLaBulle, notifsChat, messageVoix, projetDeLaBulle, sujetDe, sujetEtDetail } from '../src/lib/bulleAide.ts'
import { estMessageLibre } from '../src/lib/discussion.ts'

console.log('verifier-bulle-aide')
const P = (id: string, slug: string) => ({ id, slug, nom: slug }) as any
const projets = [P('a', 'facepro'), P('b', 'cockpit'), P('t', 'test-x-1')]

// 1. Allumée par défaut ; seule une préférence explicitement false l'éteint.
verifie('clé par projet', cleBulle('a') === 'bulle_flottante_aide_a')
verifie('sans préférence : allumée', bulleActive({}, 'a'))
verifie('préférence true : allumée', bulleActive({ bulle_flottante_aide_a: true }, 'a'))
verifie('préférence false : éteinte', !bulleActive({ bulle_flottante_aide_a: false }, 'a'))
verifie('éteinte pour un projet seulement', bulleActive({ bulle_flottante_aide_a: false }, 'b'))

// 2. Quel projet ?
verifie('vue projet : ce projet', projetDeLaBulle('a', projets, [])?.id === 'a')
verifie('vue Tout : le projet cockpit', projetDeLaBulle(null, projets, [])?.id === 'b')
const sansCockpit = [P('a', 'facepro'), P('c', 'jarvis'), P('t', 'test-x-1')]
const ms = [
  { projet_id: 'a', chantier_id: null, created_at: '2026-09-30T10:00:00Z' },
  { projet_id: 'c', chantier_id: null, created_at: '2026-09-30T11:00:00Z' },
  { projet_id: 't', chantier_id: null, created_at: '2026-09-30T12:00:00Z' },
  { projet_id: 'a', chantier_id: 'x', created_at: '2026-09-30T13:00:00Z' },
]
verifie('vue Tout sans cockpit : dernier fil libre utilisé, jamais un test', projetDeLaBulle(null, sansCockpit, ms)?.id === 'c')
verifie('vue Tout sans message : premier projet', projetDeLaBulle(null, sansCockpit, [])?.id === 'a')
verifie('aucun projet : rien', projetDeLaBulle(null, [], []) === null)

// 3. Le fil : messages du projet, sans chantier, sans mécanique, dans l'ordre.
const m = (id: string, o: any) => ({ id, projet_id: 'b', chantier_id: null, kind: 'info', auteur_type: 'proprietaire', corps: 'x', created_at: `2026-09-30T10:0${id}:00Z`, ...o })
const fil = filDeLaBulle([m('3', { auteur_type: 'session' }), m('1', {}), m('2', { chantier_id: 'z' }), m('4', { projet_id: 'a' }), m('5', { ou_en_est: true }), m('6', { kind: 'question' })], 'b')
verifie('fil : 2 messages, ordre chronologique', fil.length === 2 && fil[0].id === '1' && fil[1].id === '3')

// 4. Un message tapé dans la bulle est un message libre (la chef / la session y répond).
verifie('message de la bulle = message libre', estMessageLibre({ ...m('1', {}), answered_at: null } as any, []))

// 5. Nom, sujet, citation, voix.
verifie('auteur : Claude / Toi / Raphaël / invité', auteurDe({ auteur_type: 'session', auteur: 'x' }, true) === 'Claude' && auteurDe({ auteur_type: 'proprietaire', auteur: 'x' }, true) === 'Toi' && auteurDe({ auteur_type: 'proprietaire', auteur: 'x' }, false) === 'Raphaël' && auteurDe({ auteur_type: 'utilisateur', auteur: 'Lea', auteur_user: 'u' }, false) === 'Lea · invité')
verifie('sujet extrait', sujetDe('Sujet : Les coûts. Voilà la suite')?.sujet === 'Les coûts' && sujetDe('Bonjour').sujet === null)
verifie('citation : aller-retour', citationDe(avecCitation('Veux-tu A ou B ?', 'A')).citation === 'Veux-tu A ou B ?' && citationDe(avecCitation('Veux-tu A ou B ?', 'A')).reste === 'A')
verifie('sans citation : corps inchangé', avecCitation(null, ' ok ') === 'ok' && citationDe('salut').citation === null)
verifie('citation longue coupée', citer('mot '.repeat(100)).length <= 160)
verifie('on cite la sélection, sinon le message sans sa ligne Sujet', aCiter('  B  ', 'tout') === 'B' && aCiter('', 'Sujet : Choix. Veux-tu A ou B ?') === 'Veux-tu A ou B ?')
verifie('un message cité reste un message libre', estMessageLibre({ ...m('9', {}), corps: '> Veux-tu A ?\nA', answered_at: null } as any, []))
verifie('voix : non supportée / supportée', constructeurVoix({}) === null && constructeurVoix({ webkitSpeechRecognition: class {} }) !== null)
verifie('voix : micro refusé dit où l’autoriser', messageVoix('not-allowed').includes('Micro') && messageVoix('aborted') === '' && messageVoix('zzz').includes('zzz'))

// Pastilles par chat : réponses libres non lues + cartes à faire ; le total de l'onglet = somme des chats.
const el = (type: string, id: string, chantierId: string | null, message = true) => ({ type, cle: id, projetId: 'a', chantier: chantierId ? { id: chantierId } : null, message: message ? {} : null }) as any
const cartes = cartesAFaire([el('question', 'q1', 'c1'), el('a_verifier', 'v1', 'c1'), el('question', 'q2', 'c2'), el('bloque', 'b', 'c3'), el('fusion', 'f', null), el('fusion', 'f2', null, false)])
verifie('cartes : une question d’un chantier à vérifier n’est pas comptée deux fois, un « bloque » n’est pas une carte ; les demandes AVANT les chantiers à tester', cartes.map((c: any) => c.cle).join() === 'q2,f,v1', cartes.map((c: any) => c.cle))
const nl = new Map([['projet:a', { n: 2, dernier: 'x' }], ['c9', { n: 5, dernier: 'x' }]])
verifie('notifs : réponses du fil libre + DEMANDES (pas les chantiers à tester), jamais les réponses d’un fil de chantier', JSON.stringify(notifsChat(nl, 'a', cartes)) === JSON.stringify({ reponses: 2, aFaire: 2, aTester: 1, total: 4 }), notifsChat(nl, 'a', cartes))
verifie('notifs : 30 chantiers à tester ne font pas monter la pastille', notifsChat(new Map(), 'a', cartesAFaire(Array.from({ length: 30 }, (_, i) => el('a_verifier', `v${i}`, `c${i}`)))).total === 0)
verifie('notifs : rien = zéro', notifsChat(new Map(), 'b', []).total === 0)

// 6. Le sujet de chaque carte (13 oct. 2026, Raphaël : « je suis obligé de lire les descriptifs pour comprendre les sujets »)
const sd = (chantier: any, corps: string | null, type = 'question') => sujetEtDetail({ type, chantier, message: corps === null ? null : { corps } } as any)
const egal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
verifie('sujet : le titre du chantier d’abord (blancs écrasés) ; pour une question, son texte en détail', egal(sd({ titre: '  Tasse : bords   doublés ' }, 'Veux-tu A\nou B ?'), { sujet: 'Tasse : bords doublés', detail: 'Veux-tu A ou B ?' }), sd({ titre: 'x' }, 'y'))
verifie('sujet : quatre questions du MÊME chantier ne se ressemblent plus (le détail est la question)',
  new Set(['Choix 1 ?', 'Choix 2 ?', 'Choix 3 ?', 'Choix 4 ?'].map((q) => sd({ titre: 'Décisions en attente (7 oct.)' }, q).detail)).size === 4)
verifie('sujet : une action dont le texte REDIT le titre (même début, coupure « … » mise à part) n’a pas de détail en double',
  sd({ titre: 'Fusionne la PR #58 : Tête entière vidéo : lèvres lips_motion par défaut (suivi…' }, 'Fusionne la PR #58 : Tête entière vidéo : lèvres lips_motion par défaut (suivi des lèvres)', 'action').detail === null
  && sd({ titre: 'Choix' }, 'Veux-tu A ou B ?').detail === 'Veux-tu A ou B ?')
verifie('sujet : un chantier à tester / à cadrer n’a pas de détail inventé (la phrase d’attente suffit)', sd({ titre: 'T' }, 'texte', 'a_verifier').detail === null && sd({ titre: 'T' }, null, 'a_cadrer').detail === null)
verifie('aperçu d’une ligne : le « Sujet : » s’il y en a un, sinon le début ; la citation « > » n’y est pas ; jamais plus long que demandé',
  apercuDe('Sujet : Solde RunPod. Peux-tu recharger le compte ?') === 'Solde RunPod' && apercuDe('Bonjour,   où en est la tasse ?') === 'Bonjour, où en est la tasse ?'
  && apercuDe('> Veux-tu A ?\nA, merci') === 'A, merci' && apercuDe(null) === '' && apercuDe('mot '.repeat(60), 40).length <= 41)
const now0 = new Date('2026-10-13T10:00:00Z')
verifie('2e ligne : la question elle-même ; sinon ce qu’on attend ; l’alerte « Claude a avancé » passe d’abord',
  detailDeCarte({ type: 'question', chantier: { titre: 'T' }, message: { corps: 'Veux-tu A ?' } } as any, now0) === 'Veux-tu A ?'
  && detailDeCarte({ type: 'a_verifier', chantier: { titre: 'T', jalons: null }, message: null } as any, now0) === 'livré, à tester'
  && /travaillé dessus/.test(detailDeCarte({ type: 'question', chantier: { titre: 'T' }, message: { corps: 'Veux-tu A ?' }, avanceDepuis: '2026-10-13T09:00:00Z' } as any, now0)))
verifie('sujet : sans chantier, la balise « Sujet : » du message ; le reste en détail', egal(sd(null, 'Sujet : Solde RunPod. Peux-tu recharger ?'), { sujet: 'Solde RunPod', detail: 'Peux-tu recharger ?' }), sd(null, 'Sujet : Solde RunPod. Peux-tu recharger ?'))
verifie('sujet : sans chantier ni balise, la première phrase ; le reste en détail', egal(sd(null, 'PR #60 introuvable. Que faire ? Dis-moi.'), { sujet: 'PR #60 introuvable.', detail: 'Que faire ? Dis-moi.' }), sd(null, 'PR #60 introuvable. Que faire ? Dis-moi.'))
const longue = `Vignette floue ${'et encore '.repeat(12)}fin de phrase.`
const sl = sd(null, longue)
verifie('sujet : une première phrase trop longue est coupée au mot, le message ENTIER reste en détail (rien n’est perdu)', sl.sujet.length <= 81 && sl.sujet.endsWith('…') && sl.detail === longue, sl)
verifie('sujet : un lien n’est pas coupé à ses points', egal(sd(null, 'Ouvre https://claude.ai/code/x.y puis dis-moi'), { sujet: 'Ouvre https://claude.ai/code/x.y puis dis-moi', detail: null }))
verifie('sujet : la citation « > » en tête n’est pas le sujet', egal(sd(null, '> Veux-tu A ou B ?\nA, merci. Voilà'), { sujet: 'A, merci.', detail: 'Voilà' }), sd(null, '> Veux-tu A ou B ?\nA, merci. Voilà'))
verifie('sujet : message vide ou absent → « Question sur le projet », jamais une ligne vide', sd(null, '').sujet === 'Question sur le projet' && sd(null, null).sujet === 'Question sur le projet' && sd({ titre: '   ' }, null).sujet === 'Question sur le projet')

bilan()
