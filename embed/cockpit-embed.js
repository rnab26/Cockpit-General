/*
 * cockpit-embed.js — le module embarqué du Cockpit de Raphaël.
 *
 * COMMENT BRANCHER (une balise, rien d'autre) :
 *
 *   <script src="https://rnab26.github.io/Cockpit-General/embed/cockpit-embed.js"
 *           data-cle="<cle_embed du projet>"
 *           data-utilisateur="Prénom"></script>
 *
 *   Options : data-cible="#un-conteneur" (sinon une <div> est créée juste
 *   après la balise), data-fonction="<url de la fonction>", data-intervalle
 *   ="15" (secondes entre deux rafraîchissements), data-titre="Demandes et
 *   corrections", data-silence="15" (minutes sans nouvelle d'une session
 *   avant de ne plus la montrer « en cours » — même défaut que l'app),
 *   data-reproduction="non" (ne rien joindre pour rejouer, voir <capture>),
 *   data-version="<commit>" (la version servie, si le site n'a pas de /health).
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
    // null = défaut de l'app (SILENCE_DEFAUT_MIN, bloc <presence>).
    silenceMin: parseInt(balise.getAttribute('data-silence') || '', 10) > 0 ? parseInt(balise.getAttribute('data-silence'), 10) : null,
    // D-05 : joindre de quoi rejouer la demande (bloc <capture>), sauf data-reproduction="non".
    reproduction: !/^(non|no|false|0|off)$/i.test((balise.getAttribute('data-reproduction') || '').trim()),
    version: (balise.getAttribute('data-version') || '').trim().slice(0, 64),
  }

  let hote = cfg.cible ? document.querySelector(cfg.cible) : null
  if (!hote) {
    hote = document.createElement('div')
    hote.className = 'cockpit-embed'
    balise.insertAdjacentElement('afterend', hote)
  }
  const racine = hote.attachShadow({ mode: 'open' })

  // <nettoyer-url> — COPIE de supabase/functions/cockpit-embed/reproduction.ts
  // (nettoyerUrl, masquerSecrets) : le module n'a pas d'étape de build, et la
  // fonction serveur refait le même nettoyage (on ne fait pas confiance au
  // navigateur). app/scripts/verifier-reproduction.ts exécute ce bloc à côté de
  // la version serveur, sur les mêmes cas, et refuse toute divergence.
  /** Noms de paramètres qui portent un secret ou une donnée personnelle. */
  const NOM_SECRET = /(^|[_\-.])(token|jeton|key|cle|clef|secret|password|passwd|pass|pwd|mdp|auth|authorization|code|session|sessionid|sid|jwt|signature|sig|otp|apikey|access|refresh|credential|credentials|nonce|state|email|mail|tel|phone|telephone)([_\-.]|$)/i
  /** Une longue suite sans espace mêlant lettres ET chiffres (24 caractères ou plus) : un jeton, pas un mot. */
  function aleatoire(mot) {
    return mot.length >= 24 && /[0-9]/.test(mot) && /[A-Za-z]/.test(mot)
  }
  /** Une valeur qui ressemble à un secret : jeton JWT, e-mail, ou longue suite aléatoire.
   * Un identifiant (uuid) ou un nom lisible (« rapport-2026-09-29-clients ») reste. */
  function valeurSecrete(v) {
    if (/^eyJ[\w-]+\.[\w-]+/.test(v)) return true
    if (/[^@\s/]+@[^@\s/]+\.[a-z]{2,}/i.test(v)) return true
    return (v.match(/[A-Za-z0-9_]{24,}/g) || []).some(aleatoire)
  }
  function nettoyerParams(qs) {
    const garde = []
    for (const morceau of qs.split('&')) {
      if (!morceau) continue
      const i = morceau.indexOf('=')
      const nom = i < 0 ? morceau : morceau.slice(0, i)
      const brute = i < 0 ? '' : morceau.slice(i + 1)
      let nomLu = nom, valeur = brute
      try { nomLu = decodeURIComponent(nom.replace(/\+/g, ' ')) } catch { /* garde tel quel */ }
      try { valeur = decodeURIComponent(brute.replace(/\+/g, ' ')) } catch { /* garde tel quel */ }
      if (NOM_SECRET.test(nomLu) || valeurSecrete(valeur)) continue
      garde.push(morceau)
    }
    return garde.join('&')
  }
  function nettoyerChemin(chemin) {
    return chemin.split('/').map((s) => {
      let lu = s
      try { lu = decodeURIComponent(s) } catch { /* garde tel quel */ }
      return valeurSecrete(lu) ? '(retire)' : s
    }).join('/')
  }
  /** Une adresse sans rien de secret : ni identifiant:mot de passe, ni jeton dans
   * les paramètres, le fragment (#access_token=…) ou le chemin. `null` si ce
   * n'est pas une adresse http(s) lisible. */
  function nettoyerUrl(brut) {
    if (typeof brut !== 'string' || !brut.trim()) return null
    let u
    try { u = new URL(brut.trim()) } catch { return null }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.username = ''
    u.password = ''
    const chemin = nettoyerChemin(u.pathname)
    const qs = nettoyerParams(u.search.replace(/^\?/, ''))
    let fragment = u.hash.replace(/^#/, '')
    if (fragment) {
      const q = fragment.indexOf('?')
      if (q >= 0) {
        const p = nettoyerParams(fragment.slice(q + 1))
        fragment = nettoyerChemin(fragment.slice(0, q)) + (p ? '?' + p : '')
      } else if (fragment.includes('=')) {
        fragment = nettoyerParams(fragment)
      } else {
        fragment = nettoyerChemin(fragment)
      }
    }
    let out = u.origin + chemin + (qs ? '?' + qs : '') + (fragment ? '#' + fragment : '')
    if (out.length > 500) out = u.origin + chemin
    return out.length > 500 ? u.origin : out
  }
  /** Un texte libre (message d'erreur, libellé) sans jeton, e-mail ni adresse secrète. */
  function masquerSecrets(texte, max) {
    if (typeof texte !== 'string') return ''
    let t = texte.replace(/\s+/g, ' ').trim()
    t = t.replace(/https?:\/\/[^\s"'<>]+/g, (m) => nettoyerUrl(m) ?? '(adresse)')
    t = t.replace(/eyJ[\w-]+\.[\w-]+(\.[\w-]+)?/g, '(retire)')
    t = t.replace(/[^@\s"'<>()]+@[^@\s"'<>()]+\.[a-z]{2,}/gi, '(e-mail)')
    t = t.replace(/[A-Za-z0-9_]{24,}/g, (mot) => aleatoire(mot) ? '(retire)' : mot)
    return t.length > max ? t.slice(0, max - 1) + '…' : t
  }
  // </nettoyer-url>

  // <capture> — ce qui permet de REJOUER une demande (D-05). Joint à chaque
  // demande et à chaque correction, sauf data-reproduction="non" sur la balise.
  // Ce qui est capturé (et dit dans la doc d'installation) : l'adresse de la
  // page (sans jetons, mots de passe ni e-mails), son titre, la taille de
  // l'écran, l'appareil et le navigateur, la langue, l'heure, la version
  // servie (/health du site, ou data-version), les 20 dernières actions
  // (pages visitées, boutons et liens touchés par leur LIBELLÉ, champs remplis
  // par leur NOM — jamais ce qui est tapé) et les 5 dernières erreurs
  // JavaScript. Rien ne part avant qu'une demande soit envoyée ; le journal vit
  // dans la mémoire de l'onglet (sessionStorage), jamais ailleurs.
  const REPRO_CLE = 'cockpit-embed-repro'
  const journal = { actions: [], erreurs: [], derniere: '' }
  function lireJournal() {
    try {
      const j = JSON.parse(sessionStorage.getItem(REPRO_CLE) || 'null')
      if (j && Array.isArray(j.actions) && Array.isArray(j.erreurs)) { journal.actions = j.actions.slice(-20); journal.erreurs = j.erreurs.slice(-5) }
    } catch (e) { /* pas de stockage : journal en mémoire seulement */ }
  }
  function garderJournal() {
    try { sessionStorage.setItem(REPRO_CLE, JSON.stringify({ actions: journal.actions, erreurs: journal.erreurs })) } catch (e) { /* idem */ }
  }
  function noter(type, quoi, libelle) {
    journal.actions.push({ t: new Date().toISOString(), type: type, quoi: quoi, libelle: libelle })
    if (journal.actions.length > 20) journal.actions.splice(0, journal.actions.length - 20)
    garderJournal()
  }
  function noterErreur(message, source) {
    journal.erreurs.push({ t: new Date().toISOString(), message: masquerSecrets(message, 300), source: source })
    if (journal.erreurs.length > 5) journal.erreurs.splice(0, journal.erreurs.length - 5)
    garderJournal()
  }
  function pageVue() {
    const url = nettoyerUrl(location.href)
    if (url && url !== journal.derniere) { journal.derniere = url; noter('page', 'page', url) }
  }
  // Le libellé VISIBLE d'un élément touché, jamais sa valeur.
  function libelleDe(el) {
    const tag = el.tagName.toLowerCase()
    const aria = el.getAttribute('aria-label') || el.getAttribute('title') || ''
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const type = (el.getAttribute('type') || '').toLowerCase()
      if (type === 'password') return 'mot de passe'
      let lab = ''
      try { lab = el.labels && el.labels[0] ? el.labels[0].textContent : '' } catch (e) { /* rien */ }
      if ((type === 'submit' || type === 'button') && el.value) lab = lab || el.value
      return lab || aria || el.getAttribute('placeholder') || el.getAttribute('name') || el.id || type || tag
    }
    return aria || (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() || el.getAttribute('alt') || tag
  }
  function quoiDe(el) {
    const tag = el.tagName.toLowerCase(), role = el.getAttribute('role') || ''
    const type = (el.getAttribute('type') || '').toLowerCase()
    if (tag === 'a' || role === 'link') return 'lien'
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) return 'case'
    if (tag === 'input' && (type === 'submit' || type === 'button')) return 'bouton'
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'champ'
    if (tag === 'summary' || role === 'tab') return 'onglet'
    return 'bouton'
  }
  const INTERACTIF = 'a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[onclick]'
  function horsModule(el) { return el instanceof Element && el !== hote && !hote.contains(el) }
  function installerCapture() {
    lireJournal()
    const dernier = journal.actions.filter((a) => a.type === 'page').pop()
    journal.derniere = dernier ? dernier.libelle : ''
    pageVue()
    document.addEventListener('click', (e) => {
      if (!horsModule(e.target)) return
      const el = e.target.closest(INTERACTIF)
      if (!el) return
      pageVue()
      noter('clic', quoiDe(el), masquerSecrets(libelleDe(el), 80))
    }, true)
    document.addEventListener('change', (e) => {
      const el = e.target
      if (!horsModule(el)) return
      const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase()
      if (!/^(input|textarea|select)$/.test(tag) || type === 'checkbox' || type === 'radio') return
      noter('saisie', 'champ', masquerSecrets(libelleDe(el), 80))
    }, true)
    window.addEventListener('popstate', pageVue)
    window.addEventListener('hashchange', pageVue)
    window.addEventListener('error', (e) => {
      if (!e || !e.message) return
      noterErreur(e.message, e.filename ? (nettoyerUrl(e.filename) || '') + (e.lineno ? ':' + e.lineno + (e.colno ? ':' + e.colno : '') : '') : '')
    })
    window.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason
      noterErreur('Promesse rejetée : ' + (r && r.message ? r.message : typeof r === 'string' ? r : 'sans message'), '')
    })
  }
  // « iPhone · Safari 17 », « Android · Chrome 128 », « Windows · Edge 129 »…
  function appareilEnMots(ua) {
    const sys = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
      : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Appareil inconnu'
    const nav = [['Edge', /Edg(?:e|A|iOS)?\/(\d+)/], ['Samsung Internet', /SamsungBrowser\/(\d+)/], ['Opera', /OPR\/(\d+)/],
      ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/], ['Chrome', /(?:Chrome|CriOS)\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/]]
      .map((n) => { const m = ua.match(n[1]); return m ? n[0] + ' ' + m[1] : null }).find(Boolean)
    return sys + ' · ' + (nav || 'navigateur inconnu')
  }
  // La version servie : data-version sur la balise, sinon /health du site (le
  // commit que la plupart des hébergeurs y exposent). 1,5 s au plus ; rien si absent.
  async function versionServie() {
    if (cfg.version) return cfg.version
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null
      const minuterie = setTimeout(() => { if (ctl) ctl.abort() }, 1500)
      const r = await fetch(location.origin + '/health', { cache: 'no-store', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
      clearTimeout(minuterie)
      if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return null
      const j = await r.json()
      for (const k of ['commit', 'version', 'sha', 'git_sha', 'git_commit', 'render_git_commit', 'build']) {
        if (j && (typeof j[k] === 'string' || typeof j[k] === 'number') && String(j[k]).length <= 64) return String(j[k])
      }
    } catch (e) { /* pas de /health : pas de version */ }
    return null
  }
  // Ce qui part avec la demande (null si désactivé). La fonction serveur refait
  // tout le tri. Jamais une cause d'échec : au moindre souci, la demande part sans.
  async function capturer() {
    try { return await capturerBrut() } catch (e) { return null }
  }
  async function capturerBrut() {
    if (!cfg.reproduction) return null
    pageVue()
    const ua = navigator.userAgent || ''
    let fuseau = ''
    try { fuseau = Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch (e) { /* rien */ }
    return {
      page: { url: nettoyerUrl(location.href), titre: masquerSecrets(document.title || '', 200) },
      ecran: { largeur: window.innerWidth, hauteur: window.innerHeight, ratio: window.devicePixelRatio || 1 },
      appareil: { resume: appareilEnMots(ua), ua: ua.slice(0, 300), tactile: (navigator.maxTouchPoints || 0) > 0 },
      langue: navigator.language || '',
      fuseau: fuseau,
      heure: new Date().toISOString(),
      version: await versionServie(),
      actions: journal.actions.slice(-20),
      erreurs: journal.erreurs.slice(-5),
    }
  }
  if (cfg.reproduction) installerCapture()
  // </capture>

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
/* :where() = spécificité de .ck seule : .btn, .champ… (déclarés après) gardent leur couleur et leur taille */
.ck :where(button,input,textarea){font:inherit;color:inherit;letter-spacing:inherit;text-transform:none}
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
.barre.vive>span{background-image:linear-gradient(90deg,transparent 0,rgba(255,255,255,.35) 50%,transparent 100%);
 background-size:200% 100%;animation:ck-vie 1.6s linear infinite}
@keyframes ck-vie{from{background-position:200% 0}to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.barre.vive>span{animation:none}}
.barre.grise{height:4px}.barre.grise>span{background:var(--muted);opacity:.55}
.vif{color:var(--primary);font-weight:600}
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
.cv{border-radius:8px;padding:6px 8px;margin:4px 0 6px;background:var(--card);box-shadow:inset 0 0 0 1px var(--primary)}
.cv.vide{box-shadow:inset 0 0 0 1px var(--warning);color:var(--muted)}
.cv-titre{font-weight:700;color:var(--fg)}
.cv ol{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.cv li{display:flex;gap:6px;font-size:14px;line-height:1.35;color:var(--fg)}
.cv .num{flex-shrink:0;min-width:18px;text-align:right;font-weight:700;color:var(--primary)}
.cv .txt{min-width:0;flex:1;overflow-wrap:anywhere}
.cv a{color:var(--primary);text-decoration:underline;word-break:break-all}
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
  // <etapes-verifier> — COPIE de app/src/lib/commentVerifier.ts
  // (etapesVerifier, segmentsAvecLiens) : le module n'a pas d'étape de build.
  // app/scripts/verifier-comment-verifier.ts exécute ce bloc et refuse qu'il
  // diverge de la version de l'app.
  function etapesVerifier(texte) {
    const MARQUEUR = /(^|\s)(\d{1,2})[.)]\s+/g
    const couper = (ligne) => {
      const marques = []
      let attendu = null
      for (const m of ligne.matchAll(MARQUEUR)) {
        const n = Number(m[2]), debut = m.index + m[1].length, fin = m.index + m[0].length
        if (attendu === null) { if (debut !== 0 && n !== 1) continue } else if (n !== attendu) continue
        marques.push({ debut, fin, n }); attendu = n + 1
      }
      if (!marques.length) return [{ numero: null, texte: ligne }]
      const etapes = []
      const avant = ligne.slice(0, marques[0].debut).trim()
      if (avant) etapes.push({ numero: null, texte: avant })
      marques.forEach((mq, i) => etapes.push({ numero: String(mq.n), texte: ligne.slice(mq.fin, i + 1 < marques.length ? marques[i + 1].debut : undefined).trim() }))
      return etapes
    }
    const etapes = []
    for (const brute of String(texte == null ? '' : texte).replace(/\r\n?/g, '\n').split('\n')) {
      const ligne = brute.replace(/[ \t]+/g, ' ').trim()
      if (ligne) etapes.push(...couper(ligne))
    }
    return etapes
  }
  function segmentsAvecLiens(texte) {
    const out = []
    let dernier = 0
    for (const m of texte.matchAll(/https?:\/\/[^\s<>"']+/g)) {
      let url = m[0]
      for (;;) {
        const fin = url.slice(-1)
        if (/[.,;:!?»\]]/.test(fin)) { url = url.slice(0, -1); continue }
        if (fin === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) { url = url.slice(0, -1); continue }
        break
      }
      if (m.index > dernier) out.push({ lien: false, texte: texte.slice(dernier, m.index) })
      out.push({ lien: true, texte: url, url })
      dernier = m.index + url.length
    }
    if (dernier < texte.length) out.push({ lien: false, texte: texte.slice(dernier) })
    return out
  }
  // </etapes-verifier>

  // <presence> — COPIE de app/src/lib/presence.ts (preuveDeVie, et la phrase
  // « il y a 2 min » de app/src/lib/dates.ts#dateRelative) : le module n'a
  // pas d'étape de build. scripts/verifier-embed.mjs exécute ce bloc à côté
  // de la version de l'app, sur les mêmes cas, et refuse toute divergence.
  //
  // La règle (29 sept. 2026, captures de Raphaël : des barres orange et des
  // « En cours » alors qu'aucune session ne travaillait) : « quelqu'un y
  // travaille » exige une PREUVE DE VIE, une activité au statut `en_cours`
  // mise à jour depuis moins de `silenceMs`. L'état du chantier ne suffit
  // jamais : il dit où en est la demande, pas qui est dessus.
  const SILENCE_DEFAUT_MIN = 15
  function dateRelative(iso, now) {
    if (!iso) return ''
    now = now || new Date()
    const t = new Date(iso).getTime()
    if (Number.isNaN(t)) return ''
    const s = Math.round((now.getTime() - t) / 1000)
    if (s < 45) return 'à l’instant'
    if (s < 90) return 'il y a 1 min'
    const m = Math.round(s / 60)
    if (m < 60) return 'il y a ' + m + ' min'
    const hh = Math.round(m / 60)
    if (hh < 24) return 'il y a ' + hh + ' h'
    const j = Math.round(hh / 24)
    if (j === 1) return 'hier'
    if (j < 30) return 'il y a ' + j + ' j'
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  }
  function preuveDeVie(a, now, silenceMs) {
    if (!a || a.statut !== 'en_cours') return false
    const t = a.updated_at ? new Date(a.updated_at).getTime() : NaN
    return !Number.isNaN(t) && now.getTime() - t < silenceMs
  }
  // </presence>

  const silenceMs = () => (cfg.silenceMin || SILENCE_DEFAUT_MIN) * 60000
  const vivante = (a, now) => preuveDeVie(a, now, silenceMs())
  const parRecence = (a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')
  // L'activité à montrer sur une carte : la plus récente des VIVANTES s'il y
  // en a une (plusieurs sessions possibles), sinon la plus récente tout court
  // — affichée alors en gris, comme « dernier avancement connu ».
  function activiteAffichee(c, now) {
    const liste = (c.activite || []).slice().sort(parRecence)
    const vive = liste.find((a) => vivante(a, now))
    return { a: vive || liste[0] || null, vie: !!vive }
  }

  // « 👉 Comment vérifier » : les étapes écrites par la session qui livre.
  function commentVerifier(c) {
    const texte = (c.comment_verifier || '').trim()
    if (!texte) return h('div', { class: 'cv vide', 'data-cv': 'vide' },
      "La session n'a pas encore dit comment vérifier : ajoute un message pour le lui demander.")
    return h('div', { class: 'cv', 'data-cv': 'etapes' },
      h('p', { class: 'cv-titre' }, '👉 Comment vérifier'),
      h('ol', null, etapesVerifier(texte).map((e) => h('li', { 'data-etape': '' },
        e.numero ? h('span', { class: 'num' }, e.numero + '.') : null,
        h('span', { class: 'txt' }, segmentsAvecLiens(e.texte).map((sg) => sg.lien
          ? h('a', { href: sg.url, target: '_blank', rel: 'noopener noreferrer' }, sg.texte)
          : sg.texte))))))
  }

  const pluriel = (n, mot, fem) => n + ' ' + mot + (n > 1 ? 's' : '') + (fem === undefined ? '' : '')

  // Le statut est en LECTURE SEULE pour l'utilisateur final : c'est la
  // session qui le fait avancer (règle du Trieur, « les statuts sont à
  // statuer par toi, pas par moi »).
  // « 🔧 En cours de codage » n'est dit QUE si une session donne signe de vie
  // (badgeEtat, plus bas) : un état `en_cours` sans preuve de vie se lit
  // « En file d'attente », le même libellé que `libre` — la demande attend
  // qu'une session la (re)prenne, quoi qu'en dise la colonne.
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
  // Les états où une session peut être en train de coder : avec une preuve
  // de vie, ils se lisent « en cours » (même ordre de décision que
  // presenceChantier dans l'app : à vérifier, bloqué, etc. gardent le leur).
  const ETATS_DE_TRAVAIL = ['a_trier', 'libre', 'en_cours']
  function badgeEtat(c, now) {
    if (ETATS_DE_TRAVAIL.includes(c.etat) && activiteAffichee(c, now || new Date()).vie) return BADGES.en_cours
    if (c.etat === 'en_cours') return BADGES.libre
    return BADGES[c.etat] || BADGES.a_trier
  }
  const enAttente = (m) => (m.kind === 'question' || m.kind === 'action') && !m.answered_at
  const questionsEnAttente = (c) => (c.messages || []).filter(enAttente)
  const modifiable = (c) => c.origine === 'utilisateur' && (c.etat === 'a_trier' || c.etat === 'a_cadrer')
  function priorite(c) {
    if (questionsEnAttente(c).length) return 0
    if (c.etat === 'a_verifier') return 1
    if (badgeEtat(c) === BADGES.en_cours) return 2
    return 3
  }
  const normaliser = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')

  // -------------------------------------------------------------- état
  let instant = null // l'heure du rendu en cours : une seule pour tout l'écran
  const etat = { donnees: null, chargement: true, erreur: null, erreurFond: null, majA: null, empreinte: '' }
  const ui = {
    bacEnCours: true, bacEnCoursChoisi: false, bacActif: false,
    formulaire: false, nouveau: { titre: '', demande: '' },
    cartes: {}, envoi: {}, retour: {}, attenteVue: -1, rendreApres: false,
  }
  function carte(id) {
    return ui.cartes[id] || (ui.cartes[id] = {
      depliee: false, hist: false, edition: false, titre: '', demande: '',
      correction: false, mots: '', option: null, precision: '', msg: false, msgTexte: '', cv: false,
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
  // Ce qui change avec le temps SANS nouvelle donnée : qui est encore vivant,
  // et le « il y a 2 min ». Une session qui se tait doit perdre son « en
  // cours » même si le serveur renvoie exactement la même chose.
  function signaturePresence() {
    const d = etat.donnees
    if (!d) return ''
    const now = new Date()
    return (d.activite || []).map((a) => a.id + ':' + vivante(a, now) + ':' + dateRelative(a.updated_at, now)).join(',')
  }
  function rendreSiPossible(fond) {
    const empreinte = JSON.stringify(etat.donnees) + '|' + signaturePresence() + '|' + (etat.erreur || '') + '|' + (etat.erreurFond || '')
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

    // Bandeau « là, maintenant » : seulement avec une PREUVE DE VIE (bloc
    // <presence>). Sans elle, rien : un bandeau « en cours » sur une session
    // arrêtée depuis des heures est exactement ce qui trompait Raphaël.
    const now = new Date()
    instant = now
    const activite = (d.activite || []).filter((a) => vivante(a, now)).sort(parRecence)[0]
    if (activite) {
      const c = activite.chantier_id ? parId[activite.chantier_id] : null
      noeuds.push(h('div', { class: 'bandeau now' },
        h('span', { style: 'font-weight:700' }, '🔧 Là, maintenant : '),
        c ? h('span', { style: 'font-weight:600' }, c.titre, ' — ') : null,
        activite.etape,
        activite.detail ? h('span', { class: 'aide' }, ' · ', activite.detail) : null,
        h('span', { class: 'aide' }, ' (en cours, ', dateRelative(activite.updated_at, now), ')'),
        barre(activite, true)))
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

  // Barre vive (couleur, animation, temps restant) seulement quand une
  // session avance vraiment ; sinon une barre grise fine, sans « reste ~x »,
  // qui ne serait plus qu'une promesse périmée.
  function barre(a, vive) {
    if (!a) return null
    const p = Math.max(0, Math.min(100, a.pourcentage || 0))
    if (!vive) {
      return h('div', { class: 'barre grise', role: 'progressbar', 'aria-valuenow': p, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Dernier avancement connu' },
        h('span', { style: 'width:' + p + '%' }))
    }
    const eta = duree(a.eta_secondes)
    return h('div', null,
      h('div', { class: 'barre vive', role: 'progressbar', 'aria-valuenow': p, 'aria-valuemin': 0, 'aria-valuemax': 100 },
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
        h('ul', null, proches.map((c) => h('li', null, '« ' + c.titre + ' » (' + badgeEtat(c)[0] + ')')))) : null,
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
      await api('creer', { titre: n.titre.trim(), demande: n.demande.trim(), reproduction: await capturer() })
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
    const now = instant || new Date()
    const b = badgeEtat(c, now)
    const badge = questions.length
      ? h('span', { class: 'badge danger' }, '🔴 Réponse attendue')
      : h('span', { class: 'badge ' + b[1] }, b[0])

    const li = h('li', { class: 'carte ' + classe, 'data-chantier': c.id })
    if (u.edition) {
      ajouter(li, edition(c, u, envoi))
    } else {
      li.append(h('div', { class: 'haut' },
        h('div', { class: 'corps' }, h('p', { class: 'titre' }, c.titre), demande(c, u), c.resume_simple ? h('p', { class: 'resume' }, c.resume_simple) : null),
        h('div', { class: 'droite' }, badge,
          modifiable(c) ? h('button', { class: 'discret', title: 'Modifier le titre / la demande', onclick: () => { u.edition = true; u.titre = c.titre; u.demande = c.demande || ''; rendre(); focus('titre-' + c.id) } }, '✏️') : null)))
    }
    const { a, vie } = activiteAffichee(c, now)
    if (a && vie) {
      ajouter(li, [h('p', { class: 'aide', style: 'margin-top:6px', 'data-presence': 'vivante' },
        '🔧 ', a.etape, h('span', { class: 'vif' }, ' · en cours, ', dateRelative(a.updated_at, now))), barre(a, true)])
    } else if (a) {
      const depuis = dateRelative(a.updated_at, now)
      ajouter(li, [h('p', { class: 'aide', style: 'margin-top:6px', 'data-presence': 'silencieuse' },
        'dernier avancement connu : ' + Math.max(0, Math.min(100, a.pourcentage || 0)) + ' %' + (depuis ? ' (' + depuis + ')' : '')), barre(a, false)])
    }
    if (!blocs.includes((ui.retour[c.id] || {}).bloc)) ajouter(li, retourPour(c.id, (ui.retour[c.id] || {}).bloc))
    ajouter(li, historique(c, u))
    questions.forEach((q) => ajouter(li, blocQuestion(c, u, q, envoi)))
    if (aVerifier) ajouter(li, blocValidation(c, u, envoi, 'a_verifier'))
    ajouter(li, pied(c, u, envoi))
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
    if (!['validation', 'message'].includes((ui.retour[c.id] || {}).bloc)) ajouter(li, retourPour(c.id, (ui.retour[c.id] || {}).bloc))
    ajouter(li, blocValidation(c, u, envoi, 'valide'))
    ajouter(li, demande(c, u, true))
    ajouter(li, historique(c, u))
    ajouter(li, pied(c, u, envoi))
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
          await api('corriger', { chantier_id: c.id, mots: u.mots.trim(), reproduction: await capturer() })
          u.correction = false; u.mots = ''
        }) }, envoi ? 'Enregistrement…' : '📩 Envoyer la correction'),
        h('button', { class: 'btn sec', disabled: envoi, onclick: () => { u.correction = false; rendre() } }, 'Annuler')))
    if (mode === 'valide') {
      const texteCv = (c.comment_verifier || '').trim()
      return h('div', { style: 'margin-top:6px' },
        texteCv ? h('button', { class: 'discret', 'aria-expanded': String(!!u.cv), onclick: () => { u.cv = !u.cv; rendre() } }, (u.cv ? '▲' : '▼') + ' 👉 Comment vérifier') : null,
        texteCv && u.cv ? commentVerifier(c) : null,
        u.correction
          ? h('div', { class: 'bloc orange', style: 'margin-top:0' }, h('p', { class: 'bloc-titre' }, "🧪 Qu'est-ce qui ne va pas ?"), zone(), retourPour(c.id, 'validation'))
          : h('div', null, h('button', { class: 'lien', onclick: () => { u.correction = true; rendre(); focus('mots-' + c.id) } }, '✏️ Signaler un problème'), retourPour(c.id, 'validation')))
    }
    return h('div', { class: 'bloc orange' },
      h('p', { class: 'bloc-titre' }, '🧪 Codée et déployée — est-ce que ça fonctionne comme attendu ?'),
      commentVerifier(c),
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
    // Comme une discussion (0025) : ton dernier message sans réponse écrite de
    // Claude le dit, en bas du fil, jusqu'à ce qu'il réponde.
    const derniereSession = (c.messages || []).filter((m) => m.auteur_type === 'session').map((m) => m.created_at).sort().pop() || ''
    const attend = (c.messages || []).some((m) => m.auteur_type !== 'session' && ['info', 'reponse'].includes(m.kind) && m.created_at > derniereSession)
    if (attend) items.push({ ts: '~', noeud: [h('p', { class: 'aide', 'data-attente-reponse': 'oui' }, '⏳ Message envoyé : la réponse de Claude arrivera ici.')] })
    return h('div', { style: 'margin-top:6px' },
      h('button', { class: 'discret', 'aria-expanded': String(u.hist), onclick: () => { u.hist = !u.hist; rendre() } }, (u.hist ? '▲' : '▼') + ' Historique (' + (items.length - (attend ? 1 : 0)) + ')' + (attend ? ' · réponse en attente' : '')),
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
  // Recalcul de la présence toutes les 30 s, même sans nouvelle donnée.
  setInterval(() => { if (!document.hidden && etat.donnees) rendreSiPossible(true) }, 30000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) charger(false) })
})()
