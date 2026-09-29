import { phraseTraiter, etatTraiter, etapesTraiter, LIEN_CLAUDE_CODE } from '../src/lib/traiter.ts'
let ko = 0, ok = 0
const verifie = (nom: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓ ' + nom) } else { ko++; console.log('  ✗ ' + nom, detail ?? '') } }
const now = new Date('2026-09-29T12:00:00Z')

console.log('traiter ce projet')
verifie('la phrase nomme le projet et dit « en lot »', /Facepro/.test(phraseTraiter('Facepro')) && /en lot/.test(phraseTraiter('Facepro')))
verifie('la même règle pour un projet inconnu d’avance', /Autre projet/.test(phraseTraiter('Autre projet')))
const vide = etatTraiter({ chef: false, chef_vu_at: null, attente: [] }, now)
verifie('état vide : dit qu’aucune session ne tourne ET que rien n’attend', /Aucune session ouverte/.test(vide) && /Rien n’attend/.test(vide), vide)
const un = etatTraiter({ chef: false, chef_vu_at: null, attente: [{ n: 1, section: 'Bugs' }] }, now)
verifie('un chantier : singulier', /1 chantier sera pris : Bugs 1/.test(un), un)
const deux = etatTraiter({ chef: true, chef_vu_at: '2026-09-29T11:50:00Z', attente: [{ n: 3, section: 'A' }, { n: 2, section: 'B' }] }, now)
verifie('chef vivante : « tient déjà », et le détail par section', /tient déjà/.test(deux) && /5 chantiers seront pris : A 3 · B 2/.test(deux), deux)
verifie('sans dépôt : on ne l’invente pas', etapesTraiter(null)[0].includes('de ce projet'))
verifie('avec dépôt : il est nommé', etapesTraiter('rnab26/Facepro')[0].includes('rnab26/Facepro'))
verifie('le lien est la page documentée, sans paramètre inventé', LIEN_CLAUDE_CODE === 'https://claude.ai/code')
console.log(`\nverifier-traiter : ${ok}/${ok + ko}`)
process.exit(ko ? 1 : 0)
