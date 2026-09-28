/*
 * cockpit-embed.js — le module embarqué du Cockpit de Raphaël.
 *
 * COMMENT BRANCHER (une balise, rien d'autre) :
 *
 *   <script src="https://rnab26.github.io/cockpit/embed/cockpit-embed.js"
 *           data-cle="<cle_embed du projet>"
 *           data-utilisateur="Prénom"></script>
 *
 *   Options : data-cible="#un-conteneur" (sinon une <div> est créée juste
 *   après la balise), data-fonction="<url de la fonction>", data-intervalle
 *   ="15" (secondes entre deux rafraîchissements), data-titre="Demandes et
 *   corrections".
 *
 * POURQUOI PAS DE FRAMEWORK : ce script doit vivre dans FacePro (Jinja + JS
 * vanilla), dans le Trieur (React) et dans n'importe quelle page HTML à
 * venir. Un composant React ne s'installe pas dans une page Jinja ; un
 * fichier JS sans dépendance s'installe partout, avec une balise.
 *
 * POURQUOI UN SHADOW DOM : le site hôte a ses propres styles (et parfois
 * des règles `*` agressives). Dans un Shadow DOM, nos styles ne fuient pas
 * vers lui, et les siens ne cassent pas notre écran — seule la police est
 * héritée, pour que le module ait l'air d'appartenir à la page.
 *
 * POURQUOI PAS D'ACCÈS DIRECT À LA BASE : le navigateur ne porte aucune clé
 * de base. Il parle à la fonction serveur `cockpit-embed`, qui tient la clé
 * de service et ne répond que pour le projet dont on lui donne la clé
 * `data-cle` (une par projet, révocable en la régénérant).
 *
 * Le modèle d'écran est celui du Trieur (PrelevementRuleRequests.tsx) :
 * bandeau « là, maintenant », compteurs rouge / orange, deux bacs (en cours
 * d'optimisation / actif), question à options avec précision, validation
 * « ça fonctionne / corriger », historique replié, statut en lecture seule.
 */
(function () {
  'use strict'

  // ------------------------------------------------------------ config
  const balise = document.currentScript
  if (!balise) { console.error('cockpit-embed : impossible de trouver sa balise <script>.'); return }
  const cfg = {
    cle: balise.getAttribute('data-cle') || '',
    utilisateur: (balise.getAttribute('data-utilisateur') || 'Utilisateur').trim() || 'Utilisateur',
    cible: balise.getAttribute('data-cible') || '',
    fonction: balise.getAttribute('data-fonction') || 'https://bexiyvmdbxcwxasgslxp.supabase.co/functions/v1/cockpit-embed',
    intervalle: Math.max(3, parseInt(balise.getAttribute('data-intervalle') || '15', 10) || 15),
    titre: balise.getAttribute('data-titre') || 'Demandes et corrections',
  }

  let hote = cfg.cible ? document.querySelector(cfg.cible) : null
  if (!hote) {
    hote = document.createElement('div')
    hote.className = 'cockpit-embed'
    balise.insertAdjacentElement('afterend', hote)
  }
  const racine = hote.attachShadow({ mode: 'open' })

  // ------------------------------------------------------------- styles
  const CSS = `
:host{display:block;max-width:100%}
*,*::before,*::after{box-sizing:border-box}
.ck{font-family:inherit;font-size:15px;line-height:1.45;color:var(--fg);background:transparent;
 text-transform:none;letter-spacing:normal;word-spacing:normal;font-style:normal;font-weight:400;
 text-align:left;text-shadow:none;text-indent:0;direction:ltr;white-space:normal;max-width:100%;
 -webkit-text-size-adjust:100%;
 --fg:#1f2937;--muted:#6b7280;--card:#fff;--border:#e5e7eb;--muted-bg:#f3f4f6;--track:#e5e7eb;
 --primary:#0f766e;--primary-fg:#fff;--danger:#dc2626;--warning:#d97706;--warning-fg:#fff;--success:#16a34a}
@media (prefers-color-scheme:dark){.ck{--fg:#e5e7eb;--muted:#9ca3af;--card:#111827;--border:#374151;
 --muted-bg:#1f2937;--track:#374151;--primary:#2dd4bf;--primary-fg:#042f2e;--danger:#f87171;
 --warning:#fbbf24;--warning-fg:#1c1917;--success:#4ade80}}
.ck p,.ck ul,.ck h2{margin:0;padding:0}.ck ul{list-style:none}
.ck button,.ck input,.ck textarea{font:inherit;color:inherit;letter-spacing:inherit;text-transform:none}
.entete{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;
 padding:0 0 8px;border-bottom:1px solid var(--border);margin-bottom:10px}
.entete h2{font-size:17px;font-weight:700;line-height:1.3}
.entete .sous{font-size:12px;color:var(--muted)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:36px;padding:6px 12px;
 border-radius:8px;border:1px solid transparent;background:var(--primary);color:var(--primary-fg);
 font-weight:600;font-size:13px;cursor:pointer;touch-action:manipulation;max-width:100%}
.btn:disabled{opacity:.55;cursor:default}
.btn.sec{background:var(--card);color:var(--fg);border-color:var(--border)}
.btn.sec.choisi{border-color:var(--primary);box-shadow:inset 0 0 0 1px var(--primary);color:var(--primary)}
.btn.petit{min-height:30px;padding:3px 9px;font-size:12px}
.lien{background:none;border:0;padding:2px 0;color:var(--primary);cursor:pointer;font-size:13px;text-decoration:underline}
.discret{background:none;border:0;padding:4px 2px;color:var(--muted);cursor:pointer;font-size:12px}
.discret:hover{color:var(--fg)}
.champ,.zone{width:100%;display:block;padding:8px 10px;border-radius:8px;border:1px solid var(--border);
 background:var(--card);font-size:14px;line-height:1.4;outline:none;resize:vertical;min-width:0}
.champ:focus,.zone:focus{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 25%,transparent)}
.champ.gras{font-weight:700}
.bandeau{border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:13px}
.bandeau.now{background:var(--muted-bg);box-shadow:inset 0 0 0 1px var(--primary)}
.bandeau.rouge{background:var(--danger);color:#fff;font-weight:700;font-size:14px}
.bandeau.orange{background:var(--warning);color:var(--warning-fg);font-weight:700;font-size:14px}
.bandeau.gris{background:var(--muted-bg);color:var(--muted);font-size:12px}
.barre{position:relative;height:8px;border-radius:99px;background:var(--track);overflow:hidden;margin-top:6px}
.barre>span{position:absolute;inset:0 auto 0 0;background:var(--primary);border-radius:99px;transition:width .4s}
.barre-legende{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted);margin-top:3px}
.bac-titre{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;padding:6px 0;
 font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;text-align:left}
.bac-titre.vert{color:var(--success)}
.pastille{border-radius:99px;padding:1px 8px;font-size:11px;font-weight:700;background:var(--primary);color:var(--primary-fg)}
.liste{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.carte{border-radius:10px;padding:8px 10px;background:var(--card);box-shadow:inset 0 0 0 1px var(--border);overflow-wrap:anywhere}
.carte.rouge{box-shadow:inset 3px 0 0 var(--danger),inset 0 0 0 1px var(--border)}
.carte.orange{box-shadow:inset 3px 0 0 var(--warning),inset 0 0 0 1px var(--border)}
.carte.verte{box-shadow:inset 3px 0 0 var(--success),inset 0 0 0 1px var(--border)}
.carte .haut{display:flex;align-items:flex-start;gap:8px}
.carte .corps{min-width:0;flex:1}
.carte .titre{font-size:15px;font-weight:600;line-height:1.3}
.carte .droite{display:flex;align-items:center;gap:10px;flex-shrink:0}
.badge{border-radius:99px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap;
 background:var(--card);box-shadow:inset 0 0 0 1px currentColor}
.badge.muted{color:var(--muted)}.badge.primary{color:var(--primary)}.badge.warning{color:var(--warning)}
.badge.success{color:var(--success)}.badge.danger{color:#fff;background:var(--danger);box-shadow:none}
.demande{font-size:13px;color:var(--muted);white-space:pre-wrap;margin-top:2px}
.demande.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:normal}
.resume{font-size:13px;margin-top:4px}
.bloc{margin-top:8px;border-radius:8px;padding:8px;font-size:13px}
.bloc.rouge{box-shadow:inset 0 0 0 1px var(--danger)}.bloc.rouge .bloc-titre{color:var(--danger)}
.bloc.orange{box-shadow:inset 0 0 0 1px var(--warning)}.bloc.orange .bloc-titre{color:var(--warning)}
.bloc.neutre{box-shadow:inset 0 0 0 1px var(--border)}
.bloc-titre{font-weight:700;margin-bottom:4px}
.options{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.aide{font-size:12px;color:var(--muted)}
.ligne{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px}
.pied{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px 12px;margin-top:6px;font-size:12px;color:var(--muted)}
.retour{font-size:12px;font-weight:600;margin-top:4px}.retour.ok{color:var(--success)}.retour.ko{color:var(--danger)}
.hist{margin-top:6px;display:flex;flex-direction:column;gap:4px}
.hist li{border-radius:8px;background:var(--muted-bg);padding:5px 8px;font-size:12px}
.hist .quand{color:var(--muted)}
.hist .rep{font-weight:600}
.formulaire{border:1px dashed var(--border);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;margin-bottom:10px}
.avert{background:var(--muted-bg);box-shadow:inset 0 0 0 1px var(--primary);border-radius:8px;padding:8px;font-size:12px}
.avert ul{list-style:disc;padding-left:18px;margin-top:4px}
.vide{color:var(--muted);font-size:13px;padding:12px 0}
.centre{padding:16px 0;color:var(--muted);font-size:13px}
.erreur{color:var(--danger);font-size:13px}
.edit{display:flex;flex-direction:column;gap:6px}
`

  // ------------------------------------------------------------- outils
  function h(tag, attrs) {
    const el = document.createElement(tag)
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k]
        if (v == null || v === false) continue
        if (k === 'class') el.className = v
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v)
        else if (k === 'disabled') { if (v) el.disabled = true }
        else if (k === 'value') el.value = v
        else el.setAttribute(k, v === true ? '' : v)
      }
    }
    for (let i = 2; i < arguments.length; i++) ajouter(el, arguments[i])
    return el
  }
  function ajouter(el, e) {
    if (e == null || e === false) return
    if (Array.isArray(e)) { for (const x of e) ajouter(el, x); return }
    el.append(e instanceof Node ? e : String(e))
  }

  // « Aujourd'hui à HH:mm », « Hier à HH:mm », sinon dd/mm/yy à HH:mm
  // (règle du Trieur : l'heure toujours, le jour relatif seulement à J et J-1).
  function quand(iso) {
    if (!iso) return ''
    const d = new Date(iso), now = new Date()
    const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const diff = Math.round((jour(now) - jour(d)) / 86400000)
    const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    if (diff === 0) return "Aujourd'hui à " + heure
    if (diff === 1) return 'Hier à ' + heure
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' à ' + heure
  }
  function duree(s) {
    if (s == null || !(s > 0)) return ''
    if (s < 60) return "moins d'une minute"
    if (s < 3600) return '~' + Math.round(s / 60) + ' min'
    const hh = Math.floor(s / 3600), mm = Math.round((s % 3600) / 60)
    return '~' + hh + ' h' + (mm ? ' ' + String(mm).padStart(2, '0') : '')
  }
  const pluriel = (n, mot, fem) => n + ' ' + mot + (n > 1 ? 's' : '') + (fem === undefined ? '' : '')

  // Le statut est en LECTURE SEULE pour l'utilisateur final : c'est la
  // session qui le fait avancer (règle du Trieur, « les statuts sont à
  // statuer par toi, pas par moi »).
  const BADGES = {
    a_trier: ['⏳ Pas encore examinée', 'muted'],
    a_cadrer: ['🗣️ À préciser', 'primary'],
    libre: ["📋 En file d'attente", 'muted'],
    en_cours: ['🔧 En cours de codage', 'primary'],
    a_verifier: ['🧪 Codée — à vérifier', 'warning'],
    valide: ['✅ Certifiée', 'success'],
    bloque: ['⛔ Bloquée', 'danger'],
    reporte: ['💤 Reportée', 'muted'],
  }
  const enAttente = (m) => (m.kind === 'question' || m.kind === 'action') && !m.answered_at
  const questionsEnAttente = (c) => (c.messages || []).filter(enAttente)
  const modifiable = (c) => c.origine === 'utilisateur' && (c.etat === 'a_trier' || c.etat === 'a_cadrer')
  function priorite(c) {
    if (questionsEnAttente(c).length) return 0
    if (c.etat === 'a_verifier') return 1
    if (c.etat === 'en_cours') return 2
    return 3
  }
  const normaliser = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')

  // -------------------------------------------------------------- état
  const etat = { donnees: null, chargement: true, erreur: null, erreurFond: null, majA: null, empreinte: '' }
  const ui = {
    bacEnCours: true, bacEnCoursChoisi: false, bacActif: false,
    formulaire: false, nouveau: { titre: '', demande: '' },
    cartes: {}, envoi: {}, retour: {}, attenteVue: -1, rendreApres: false,
  }
  function carte(id) {
    return ui.cartes[id] || (ui.cartes[id] = {
      depliee: false, hist: false, edition: false, titre: '', demande: '',
      correction: false, mots: '', option: null, precision: '', msg: false, msgTexte: '',
    })
  }

  // ---------------------------------------------------------------- api
  async function api(action, corps) {
    let r
    try {
      r = await fetch(cfg.fonction, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-cockpit-key': cfg.cle },
        body: JSON.stringify(Object.assign({ action: action, auteur: cfg.utilisateur }, corps || {})),
      })
    } catch (e) {
      throw new Error('Pas de connexion au Cockpit. Vérifie le réseau, puis réessaie.')
    }
    let j = null
    try { j = await r.json() } catch (e) { /* corps vide */ }
    if (!r.ok) throw new Error((j && j.erreur) || ('Le serveur a répondu ' + r.status + '.'))
    return j
  }

  async function charger(premier) {
    if (premier) { etat.chargement = true; etat.erreur = null; rendre() }
    try {
      const d = await api('etat')
      etat.donnees = d
      etat.majA = new Date()
      etat.erreurFond = null
      etat.erreur = null
    } catch (e) {
      if (premier || !etat.donnees) etat.erreur = e.message
      else etat.erreurFond = e.message
    }
    etat.chargement = false
    rendreSiPossible(!premier)
  }

  // Une action : bouton désactivé pendant l'envoi, puis « Enregistré ✓ » ou
  // l'erreur en rouge à côté, et la liste rechargée — sans faire sauter la page.
  async function agir(id, bloc, fn) {
    ui.envoi[id] = true
    delete ui.retour[id]
    rendre()
    try {
      await fn()
      await charger(false)
      ui.retour[id] = { ok: true, texte: 'Enregistré ✓', bloc: bloc }
      setTimeout(() => { if (ui.retour[id] && ui.retour[id].ok) { delete ui.retour[id]; rendre() } }, 4000)
    } catch (e) {
      ui.retour[id] = { ok: false, texte: e.message, bloc: bloc }
    }
    delete ui.envoi[id]
    rendre()
  }

  // ------------------------------------------------------------- rendu
  const app = h('div', { class: 'ck' })
  racine.append(h('style', null, CSS), app)

  function champTexteActif() {
    const a = racine.activeElement
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') ? a : null
  }
  // Un rafraîchissement de fond ne redessine que si quelque chose a changé,
  // et jamais pendant qu'on tape (il attend que le champ soit quitté).
  function rendreSiPossible(fond) {
    const empreinte = JSON.stringify(etat.donnees) + '|' + (etat.erreur || '') + '|' + (etat.erreurFond || '')
    if (fond && empreinte === etat.empreinte) return
    if (fond && champTexteActif()) { ui.rendreApres = true; return }
    etat.empreinte = empreinte
    rendre()
  }
  racine.addEventListener('focusout', () => {
    if (ui.rendreApres) { ui.rendreApres = false; setTimeout(() => { if (!champTexteActif()) rendre() }, 50) }
  })

  function rendre() {
    // La position ne saute pas : on note où on est, on remplace tout d'un
    // bloc (même tâche, donc aucun repaint entre les deux), on remet la
    // position et le curseur.
    const y = window.scrollY, hs = hote.scrollTop
    const actif = champTexteActif()
    const cleFocus = actif && actif.getAttribute('data-focus')
    const sel = actif && actif.selectionStart != null ? [actif.selectionStart, actif.selectionEnd] : null

    app.replaceChildren.apply(app, contenu())

    window.scrollTo(0, y)
    hote.scrollTop = hs
    if (cleFocus) {
      const nouveau = racine.querySelector('[data-focus="' + cleFocus + '"]')
      if (nouveau) {
        nouveau.focus({ preventScroll: true })
        try { if (sel) nouveau.setSelectionRange(sel[0], sel[1]) } catch (e) { /* type non textuel */ }
      }
    }
  }

  function retourPour(id, bloc) {
    const r = ui.retour[id]
    if (!r || r.bloc !== bloc) return null
    return h('p', { class: 'retour ' + (r.ok ? 'ok' : 'ko'), role: 'status' }, r.texte)
  }

  function contenu() {
    const noeuds = []
    const d = etat.donnees
    noeuds.push(h('div', { class: 'entete' },
      h('h2', null, cfg.titre),
      h('span', { class: 'sous' },
        d && d.projet ? d.projet.nom + ' · ' : '',
        etat.majA ? 'mis à jour à ' + etat.majA.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ' ' : '',
        h('button', { class: 'discret', title: 'Actualiser', onclick: () => charger(!d) }, '↻'))))

    if (etat.chargement && !d) { noeuds.push(h('p', { class: 'centre' }, 'Chargement…')); return noeuds }
    if (etat.erreur && !d) {
      noeuds.push(h('p', { class: 'erreur' }, etat.erreur),
        h('div', { class: 'ligne' }, h('button', { class: 'btn', onclick: () => charger(true) }, 'Réessayer')))
      return noeuds
    }
    if (etat.erreurFond) noeuds.push(h('div', { class: 'bandeau gris' }, '⚠️ ', etat.erreurFond, ' — la liste affichée date de ', quand(etat.majA.toISOString()).toLowerCase(), '.'))

    const chantiers = (d.chantiers || []).slice()
    const parId = {}
    chantiers.forEach((c) => { parId[c.id] = c })

    // Bandeau « là, maintenant » : l'activité la plus récente encore en cours.
    const activite = (d.activite || []).slice().sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0]
    if (activite) {
      const c = activite.chantier_id ? parId[activite.chantier_id] : null
      noeuds.push(h('div', { class: 'bandeau now' },
        h('span', { style: 'font-weight:700' }, '🔧 Là, maintenant : '),
        c ? h('span', { style: 'font-weight:600' }, c.titre, ' — ') : null,
        activite.etape,
        activite.detail ? h('span', { class: 'aide' }, ' · ', activite.detail) : null,
        h('span', { class: 'aide' }, ' (', quand(activite.updated_at), ')'),
        barre(activite)))
    }

    const nbQuestions = chantiers.reduce((n, c) => n + questionsEnAttente(c).length, 0)
    const nbAVerifier = chantiers.filter((c) => c.etat === 'a_verifier' && !questionsEnAttente(c).length).length
    if (nbQuestions) noeuds.push(h('div', { class: 'bandeau rouge' }, '🔴 ' + nbQuestions + ' question' + (nbQuestions > 1 ? 's' : '') + ' en attente de ta réponse, ci-dessous'))
    if (nbAVerifier) noeuds.push(h('div', { class: 'bandeau orange' }, '🧪 ' + nbAVerifier + ' demande' + (nbAVerifier > 1 ? 's' : '') + ' codée' + (nbAVerifier > 1 ? 's' : '') + ' — à valider ou corriger, ci-dessous'))

    // Le bac « en cours » se déplie tout seul dès qu'une action attend
    // (règle du Trieur : son père ne trouvait pas où répondre).
    const attente = nbQuestions + nbAVerifier
    if (attente > 0 && attente !== ui.attenteVue) ui.bacEnCours = true
    ui.attenteVue = attente

    noeuds.push(formulaire(chantiers))

    const actifs = chantiers.filter((c) => c.etat === 'valide')
    const enCours = chantiers.filter((c) => c.etat !== 'valide').sort((a, b) => priorite(a) - priorite(b))

    if (!chantiers.length) {
      noeuds.push(h('p', { class: 'vide' }, "Aucune demande pour l'instant. La première est à toi : « ➕ Nouvelle demande »."))
      return noeuds
    }

    noeuds.push(h('button', { class: 'bac-titre', 'aria-expanded': String(ui.bacEnCours), onclick: () => { ui.bacEnCours = !ui.bacEnCours; ui.bacEnCoursChoisi = true; rendre() } },
      (ui.bacEnCours ? '▲' : '▼') + " 🔧 En cours d'optimisation (" + enCours.length + ')',
      attente ? h('span', { class: 'pastille' }, attente + ' à traiter') : null))
    if (ui.bacEnCours) {
      noeuds.push(enCours.length
        ? h('ul', { class: 'liste' }, enCours.map(carteEnCours))
        : h('p', { class: 'vide' }, 'Rien en cours : tout ce qui a été demandé est certifié.'))
    }

    noeuds.push(h('button', { class: 'bac-titre vert', 'aria-expanded': String(ui.bacActif), onclick: () => { ui.bacActif = !ui.bacActif; rendre() } },
      (ui.bacActif ? '▲' : '▼') + ' ✅ Actif (' + actifs.length + ')'))
    if (ui.bacActif) {
      noeuds.push(actifs.length
        ? h('ul', { class: 'liste' }, actifs.map(carteActive))
        : h('p', { class: 'vide' }, 'Aucune demande certifiée pour le moment.'))
    }
    return noeuds
  }

  function barre(a) {
    if (!a) return null
    const p = Math.max(0, Math.min(100, a.pourcentage || 0))
    const eta = duree(a.eta_secondes)
    return h('div', null,
      h('div', { class: 'barre', role: 'progressbar', 'aria-valuenow': p, 'aria-valuemin': 0, 'aria-valuemax': 100 },
        h('span', { style: 'width:' + p + '%' })),
      h('div', { class: 'barre-legende' }, h('span', null, p + ' %'), h('span', null, eta ? 'reste ' + eta : '')))
  }

  // ------------------------------------------------- nouvelle demande
  function formulaire(chantiers) {
    if (!ui.formulaire) {
      return h('div', { class: 'ligne', style: 'margin:0 0 10px' },
        h('button', { class: 'btn', onclick: () => { ui.formulaire = true; rendre(); focus('nouveau-titre') } }, '➕ Nouvelle demande'),
        retourPour('nouveau', 'form'))
    }
    const n = ui.nouveau
    const titre = normaliser(n.titre)
    const proches = titre.length < 3 ? [] : chantiers.filter((c) => {
      const t = normaliser(c.titre)
      return t === titre || t.includes(titre) || titre.includes(t)
    })
    const envoi = !!ui.envoi.nouveau
    return h('div', { class: 'formulaire' },
      h('p', { class: 'aide', style: 'font-weight:600' }, '➕ Nouvelle demande'),
      h('input', { class: 'champ gras', 'data-focus': 'nouveau-titre', placeholder: 'Titre court (ex. Le bouton Exporter ne répond plus)', value: n.titre, maxlength: 200, disabled: envoi,
        oninput: (e) => { n.titre = e.target.value; rendre() } }),
      proches.length ? h('div', { class: 'avert' },
        h('p', { style: 'font-weight:600' }, '⚠️ Une demande au nom proche existe déjà. Pour éviter un doublon, ajoute plutôt un message sur sa carte :'),
        h('ul', null, proches.map((c) => h('li', null, '« ' + c.titre + ' » (' + (BADGES[c.etat] || BADGES.a_trier)[0] + ')')))) : null,
      h('textarea', { class: 'zone', 'data-focus': 'nouveau-demande', rows: 3, placeholder: 'Ce que tu veux changer, en détail… (un exemple concret aide beaucoup)', disabled: envoi,
        oninput: (e) => { n.demande = e.target.value } }, n.demande),
      h('div', { class: 'ligne' },
        h('button', { class: 'btn', disabled: envoi || !n.titre.trim(), onclick: creer }, envoi ? 'Enregistrement…' : '➕ Ajouter la demande'),
        h('button', { class: 'btn sec', disabled: envoi, onclick: () => { ui.formulaire = false; rendre() } }, 'Annuler')),
      retourPour('nouveau', 'form'))
  }
  function creer() {
    const n = ui.nouveau
    agir('nouveau', 'form', async () => {
      await api('creer', { titre: n.titre.trim(), demande: n.demande.trim() })
      ui.nouveau = { titre: '', demande: '' }
      ui.formulaire = false
      ui.bacEnCours = true
    })
  }
  function focus(cle) {
    setTimeout(() => { const el = racine.querySelector('[data-focus="' + cle + '"]'); if (el) el.focus({ preventScroll: true }) }, 0)
  }

  // ------------------------------------------------------------ cartes
  function carteEnCours(c) {
    const u = carte(c.id)
    const questions = questionsEnAttente(c)
    const aVerifier = !questions.length && c.etat === 'a_verifier'
    const classe = questions.length ? 'rouge' : aVerifier ? 'orange' : ''
    const envoi = !!ui.envoi[c.id]
    const blocs = []
    if (questions.length) blocs.push('question')
    if (aVerifier) blocs.push('validation')
    if (u.msg) blocs.push('message')
    if (u.edition) blocs.push('edition')
    const badge = questions.length
      ? h('span', { class: 'badge danger' }, '🔴 Réponse attendue')
      : h('span', { class: 'badge ' + (BADGES[c.etat] || BADGES.a_trier)[1] }, (BADGES[c.etat] || BADGES.a_trier)[0])

    const li = h('li', { class: 'carte ' + classe, 'data-chantier': c.id })
    if (u.edition) {
      li.append(edition(c, u, envoi))
    } else {
      li.append(h('div', { class: 'haut' },
        h('div', { class: 'corps' }, h('p', { class: 'titre' }, c.titre), demande(c, u), c.resume_simple ? h('p', { class: 'resume' }, c.resume_simple) : null),
        h('div', { class: 'droite' }, badge,
          modifiable(c) ? h('button', { class: 'discret', title: 'Modifier le titre / la demande', onclick: () => { u.edition = true; u.titre = c.titre; u.demande = c.demande || ''; rendre(); focus('titre-' + c.id) } }, '✏️') : null)))
    }
    const a = (c.activite || [])[0]
    if (a) li.append(h('p', { class: 'aide', style: 'margin-top:6px' }, '🔧 ', a.etape), barre(a))
    if (!blocs.includes((ui.retour[c.id] || {}).bloc)) li.append(retourPour(c.id, (ui.retour[c.id] || {}).bloc))
    li.append(historique(c, u))
    questions.forEach((q) => li.append(blocQuestion(c, u, q, envoi)))
    if (aVerifier) li.append(blocValidation(c, u, envoi, 'a_verifier'))
    li.append(pied(c, u, envoi))
    return li
  }

  function carteActive(c) {
    const u = carte(c.id)
    const envoi = !!ui.envoi[c.id]
    const li = h('li', { class: 'carte verte', 'data-chantier': c.id },
      h('div', { class: 'haut' },
        h('span', { title: 'Certifiée', style: 'flex-shrink:0' }, '✅'),
        h('div', { class: 'corps' }, h('p', { class: 'titre' }, c.titre),
          h('p', { class: 'resume', style: 'color:var(--muted)' }, c.resume_simple || 'Certifiée' + (c.valide_par ? ' par ' + c.valide_par : '') + (c.valide_at ? ' — ' + quand(c.valide_at).toLowerCase() : '')))))
    if (!['validation', 'message'].includes((ui.retour[c.id] || {}).bloc)) li.append(retourPour(c.id, (ui.retour[c.id] || {}).bloc))
    li.append(blocValidation(c, u, envoi, 'valide'))
    li.append(demande(c, u, true))
    li.append(historique(c, u))
    li.append(pied(c, u, envoi))
    return li
  }

  function demande(c, u, avecEtiquette) {
    if (!c.demande) return null
    const longue = c.demande.length > 220 || (c.demande.match(/\n/g) || []).length >= 3
    return h('div', null,
      avecEtiquette ? h('p', { class: 'aide', style: 'margin-top:6px;font-weight:600' }, "Demande d'origine :") : null,
      h('p', { class: 'demande' + (longue && !u.depliee ? ' clamp' : '') }, c.demande),
      longue ? h('button', { class: 'discret', onclick: () => { u.depliee = !u.depliee; rendre() } }, u.depliee ? 'voir moins' : 'voir plus') : null)
  }

  function edition(c, u, envoi) {
    return h('div', { class: 'edit' },
      h('input', { class: 'champ gras', 'data-focus': 'titre-' + c.id, value: u.titre, maxlength: 200, disabled: envoi, oninput: (e) => { u.titre = e.target.value } }),
      h('textarea', { class: 'zone', 'data-focus': 'demande-' + c.id, rows: 3, disabled: envoi, oninput: (e) => { u.demande = e.target.value } }, u.demande),
      h('div', { class: 'ligne' },
        h('button', { class: 'btn', disabled: envoi || !u.titre.trim(), onclick: () => agir(c.id, 'edition', async () => {
          await api('modifier', { chantier_id: c.id, titre: u.titre.trim(), demande: u.demande.trim() })
          u.edition = false
        }) }, envoi ? 'Enregistrement…' : '✓ Terminé'),
        h('button', { class: 'btn sec', disabled: envoi, onclick: () => { u.edition = false; delete ui.retour[c.id]; rendre() } }, 'Annuler')),
      retourPour(c.id, 'edition'))
  }

  // Question à options (rouge). Une option qui contient « préciser » ne
  // part pas au clic : elle place le curseur dans le champ, et c'est le
  // bouton « Valider » qui envoie — sinon la réponse partait avant que la
  // précision soit tapée (bug réel du Trieur).
  function blocQuestion(c, u, q, envoi) {
    const estAction = q.kind === 'action'
    const options = estAction
      ? [{ libelle: 'Fait', etat: 'fait' }, { libelle: 'Pas encore', etat: 'pas_encore' }, { libelle: 'Ça bloque', etat: 'bloque' }]
      : (Array.isArray(q.options) ? q.options : []).map((o) => typeof o === 'string' ? { libelle: o } : o)
    const cleChamp = 'precision-' + q.id
    const envoyer = (o) => agir(c.id, 'question', async () => {
      await api('repondre', { message_id: q.id, reponse: o ? o.libelle : null, etat: o && o.etat ? o.etat : null, precision: u.precision.trim() || null })
      u.option = null; u.precision = ''
    })
    const choisir = (o) => {
      if (!estAction && /pr[ée]ciser/i.test(o.libelle || '')) { u.option = o; rendre(); focus(cleChamp); return }
      envoyer(o)
    }
    return h('div', { class: 'bloc rouge', 'data-question': q.id },
      h('p', { class: 'bloc-titre' }, estAction ? '🔴 Une action t’est demandée' : '🔴 Réponse attendue'),
      h('p', { style: 'font-weight:600' }, q.corps),
      q.pourquoi ? h('p', { class: 'aide' }, 'Pourquoi : ', q.pourquoi) : null,
      h('div', { class: 'options' }, options.map((o) => h('button', {
        class: 'btn sec petit' + (u.option && u.option.libelle === o.libelle ? ' choisi' : ''),
        title: o.aide || null, disabled: envoi, onclick: () => choisir(o),
      }, o.libelle, o.recommande ? ' ★' : ''))),
      options.some((o) => o.recommande) ? h('p', { class: 'aide' }, '★ = recommandé par la session') : null,
      options.some((o) => o.aide) ? h('ul', { class: 'aide', style: 'list-style:disc;padding-left:18px;margin-top:4px' }, options.filter((o) => o.aide).map((o) => h('li', null, h('b', null, o.libelle), ' : ', o.aide))) : null,
      h('input', { class: 'champ', style: 'margin-top:6px', 'data-focus': cleChamp, value: u.precision, disabled: envoi,
        placeholder: u.option ? 'Écris ta précision ici, puis valide ci-dessous…' : 'Précision (facultatif)…',
        oninput: (e) => { u.precision = e.target.value; if (u.option) rendre() } }),
      !options.length || u.option ? h('div', { class: 'ligne' },
        h('button', { class: 'btn', disabled: envoi || !u.precision.trim(), onclick: () => envoyer(u.option) }, envoi ? 'Enregistrement…' : '✅ Valider cette réponse')) : null,
      retourPour(c.id, 'question'))
  }

  // Validation (orange) : « ça fonctionne, je certifie » / « ça ne marche
  // pas, corriger » ; sur une carte certifiée, seulement le lien de
  // signalement. Corriger complète la MÊME demande, jamais une nouvelle.
  function blocValidation(c, u, envoi, mode) {
    const zone = () => h('div', { class: 'edit', style: 'margin-top:6px' },
      h('textarea', { class: 'zone', 'data-focus': 'mots-' + c.id, rows: 3, disabled: envoi, placeholder: "Qu'est-ce qui ne va pas ? Sois précis (un exemple concret si possible)…",
        oninput: (e) => { u.mots = e.target.value; rendre() } }, u.mots),
      h('div', { class: 'ligne' },
        h('button', { class: 'btn', disabled: envoi || !u.mots.trim(), onclick: () => agir(c.id, 'validation', async () => {
          await api('corriger', { chantier_id: c.id, mots: u.mots.trim() })
          u.correction = false; u.mots = ''
        }) }, envoi ? 'Enregistrement…' : '📩 Envoyer la correction'),
        h('button', { class: 'btn sec', disabled: envoi, onclick: () => { u.correction = false; rendre() } }, 'Annuler')))
    if (mode === 'valide') {
      return h('div', { style: 'margin-top:6px' },
        u.correction
          ? h('div', { class: 'bloc orange', style: 'margin-top:0' }, h('p', { class: 'bloc-titre' }, "🧪 Qu'est-ce qui ne va pas ?"), zone(), retourPour(c.id, 'validation'))
          : h('div', null, h('button', { class: 'lien', onclick: () => { u.correction = true; rendre(); focus('mots-' + c.id) } }, '✏️ Signaler un problème'), retourPour(c.id, 'validation')))
    }
    return h('div', { class: 'bloc orange' },
      h('p', { class: 'bloc-titre' }, '🧪 Codée et déployée — est-ce que ça fonctionne comme attendu ?'),
      u.correction ? zone() : h('div', { class: 'options' },
        h('button', { class: 'btn', disabled: envoi, onclick: () => agir(c.id, 'validation', () => api('certifier', { chantier_id: c.id })) }, envoi ? 'Enregistrement…' : '✅ Ça fonctionne, je certifie'),
        h('button', { class: 'btn sec', disabled: envoi, onclick: () => { u.correction = true; rendre(); focus('mots-' + c.id) } }, '✏️ Ça ne marche pas, corriger')),
      retourPour(c.id, 'validation'))
  }

  // Historique replié : questions répondues (🤖 / 🙋) et messages, dans
  // l'ordre du temps, avec qui parle (règle du Trieur).
  function historique(c, u) {
    const items = []
    for (const m of c.messages || []) {
      if (m.kind === 'question' || m.kind === 'action') {
        if (!m.answered_at) continue
        items.push({ ts: m.answered_at, noeud: [
          h('p', { class: 'quand' }, quand(m.answered_at), ' · 🤖 ', m.auteur_type === 'session' ? 'La session a demandé' : m.auteur + ' a demandé', ' : ', m.corps),
          h('p', { class: 'rep' }, '🙋 Réponse : ', m.reponse || ({ fait: 'Fait', pas_encore: 'Pas encore', bloque: 'Ça bloque' })[m.etat] || '—'),
          m.precision ? h('p', { class: 'quand' }, 'Précision : ', m.precision) : null] })
      } else {
        const qui = m.auteur_type === 'session' ? '🤖' : '🙋 ' + m.auteur + ' :'
        items.push({ ts: m.created_at, noeud: [h('p', { class: 'quand' }, quand(m.created_at)), h('p', null, qui + ' ', m.kind === 'blocage' ? '⛔ ' : '', m.corps)] })
      }
    }
    if (!items.length) return null
    items.sort((a, b) => a.ts.localeCompare(b.ts))
    return h('div', { style: 'margin-top:6px' },
      h('button', { class: 'discret', 'aria-expanded': String(u.hist), onclick: () => { u.hist = !u.hist; rendre() } }, (u.hist ? '▲' : '▼') + ' Historique (' + items.length + ')'),
      u.hist ? h('ul', { class: 'hist' }, items.map((i) => h('li', null, i.noeud))) : null)
  }

  function pied(c, u, envoi) {
    return h('div', null,
      u.msg ? h('div', { class: 'bloc neutre' },
        h('p', { class: 'bloc-titre' }, '💬 Ton message'),
        h('textarea', { class: 'zone', 'data-focus': 'msg-' + c.id, rows: 2, disabled: envoi, placeholder: 'Une précision, un exemple, une remarque…', oninput: (e) => { u.msgTexte = e.target.value; rendre() } }, u.msgTexte),
        h('div', { class: 'ligne' },
          h('button', { class: 'btn petit', disabled: envoi || !u.msgTexte.trim(), onclick: () => agir(c.id, 'message', async () => {
            await api('message', { chantier_id: c.id, corps: u.msgTexte.trim() })
            u.msg = false; u.msgTexte = ''; u.hist = true
          }) }, envoi ? 'Enregistrement…' : '📩 Envoyer'),
          h('button', { class: 'btn sec petit', disabled: envoi, onclick: () => { u.msg = false; rendre() } }, 'Annuler')),
        retourPour(c.id, 'message')) : null,
      h('div', { class: 'pied' },
        h('span', null, 'Créée ', quand(c.created_at).toLowerCase(), c.updated_at && c.updated_at !== c.created_at ? ' · modifiée ' + quand(c.updated_at).toLowerCase() : ''),
        !u.msg ? h('button', { class: 'discret', onclick: () => { u.msg = true; rendre(); focus('msg-' + c.id) } }, '💬 Ajouter un message') : null))
  }

  // ------------------------------------------------------ démarrage
  if (!cfg.cle) {
    etat.chargement = false
    etat.erreur = 'La balise <script> ne porte pas data-cle : le module ne sait pas quel projet afficher.'
    rendre()
    return
  }
  charger(true)
  setInterval(() => { if (!document.hidden) charger(false) }, cfg.intervalle * 1000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) charger(false) })
})()
