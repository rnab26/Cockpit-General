// UNE règle : la balise du module embarqué selon l'emplacement et l'accès choisis (migration 0049).
// Lue par scripts/emplacement.sh --balise ET par « Copier le code » de l'app (Projets & membres).
// Fonction pure : ni Node ni navigateur requis.
export const URL_EMBED = 'https://rnab26.github.io/Cockpit-General/embed/cockpit-embed.js'
export const URL_APP = 'https://rnab26.github.io/Cockpit-General/'
export const LIBELLES_EMPLACEMENT = { menu: 'Bouton dans le menu du site', page: 'Page à part, avec un lien', appli: 'App Chrome, rien dans le site' }
export const LIBELLES_ACCES = { moi: 'Moi seul', equipe: "L'équipe du projet", utilisateurs: 'Tous les utilisateurs du site' }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const ACCES_CONSIGNE = {
  moi: "Accès : toi seul. Mets la balise dans une zone que toi seul vois (compte admin), ou n'utilise que l'app.",
  equipe: "Accès : l'équipe. Mets la balise dans une zone réservée aux membres (compte du site), et ajoute-les dans Réglages du projet › Membres pour l'app.",
  utilisateurs: "Accès : tous les utilisateurs du site. Mets la balise dans une zone qui exige d'être connecté et passe leur prénom dans data-utilisateur.",
}

/**
 * etat : 'vide' = questionnaire pas répondu (rien à copier) ; 'appli' = rien à coller ; 'balise' = code à coller.
 * complete = false : balise « menu » sans lien précis du menu (bouton flottant posé, lien à compléter).
 */
export function balise({ cle, emplacement, declencheur }) {
  const mode = (emplacement && emplacement.mode) || ''
  const acces = (emplacement && emplacement.acces) || ''
  if (!mode || !acces) {
    return { etat: 'vide', code: null, emplacement: '', acces: '', complete: false, acces_consigne: '',
      consigne: "Pas encore tranché : réponds aux deux cartes « À toi » (où le cockpit apparaît, qui s'en sert). Rien à coller pour l'instant." }
  }
  const src = `<script src="${URL_EMBED}" data-cle="${cle}" data-utilisateur="Prénom"`
  const sel = (declencheur || (emplacement && emplacement.menu) || '').trim()
  const base = { emplacement: mode, acces, acces_consigne: ACCES_CONSIGNE[acces] || '' }
  if (mode === 'appli') {
    return { ...base, etat: 'appli', code: null, complete: true,
      consigne: `Emplacement : app Chrome. RIEN à coller dans le site : ouvre ${URL_APP} puis « Installer l'appli » (menu ⋮ de Chrome).` }
  }
  if (mode === 'page') {
    return { ...base, etat: 'balise', complete: true, code: `${src} data-mode="page"></script>`,
      consigne: 'Emplacement : page à part. Crée une page « /cockpit » (hors du menu) et mets-y :' }
  }
  const ouv = sel ? ` data-mode="bouton" data-declencheur="${esc(sel)}"` : ' data-mode="bouton" data-libelle="Cockpit"'
  return { ...base, etat: 'balise', complete: !!sel, code: `${src}${ouv}></script>`,
    consigne: 'Emplacement : bouton dans le menu. Colle ceci dans le gabarit commun du site (juste avant </body>) :' }
}

// Appel en ligne de commande (emplacement.sh) : node balise.mjs <cle> <mode> <acces> [declencheur] -> JSON
if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  const [cle, mode, acces, decl] = process.argv.slice(2)
  console.log(JSON.stringify(balise({ cle, emplacement: { mode, acces }, declencheur: decl })))
}
