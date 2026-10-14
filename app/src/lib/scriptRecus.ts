/**
 * Le petit programme que Raphaël pose UNE fois dans son compte Google (Google Apps Script) pour que ses reçus Claude arrivent
 * dans Coûts tout seuls (chantier 72a8d0f4, 14 oct. 2026). UNE source : ce fichier. Le banc `verifier-recus-fonction.ts` vérifie
 * que le texte est du JavaScript valide, qu'il ne contient aucune écriture dans la boîte et que la clé est bien celle donnée.
 *
 * Ce que le programme fait : lit (lecture seule) les mails de `invoice+statements@mail.anthropic.com` intitulés « Your receipt
 * from Anthropic », avec leur PDF joint, et les envoie à la fonction `cockpit-recus`, qui applique la règle de lecture (la même
 * que scripts/importer-recus.py) et range les factures dans Coûts. Il ne peut ni écrire, ni envoyer, ni supprimer dans la
 * boîte : la permission demandée est « lire tes e-mails » (gmail.readonly), posée dans le fichier appsscript.json ci-dessous.
 */
export const URL_FONCTION_RECUS = 'https://bexiyvmdbxcwxasgslxp.supabase.co/functions/v1/cockpit-recus'
export const EXPEDITEUR_RECUS = 'invoice+statements@mail.anthropic.com'
export const SUJET_RECUS = 'Your receipt from Anthropic'
/** Les mails sont relus sur cette durée ; ceux déjà envoyés sont mémorisés par le programme (et le serveur ne double jamais). */
export const JOURS_RELUS = 400

/** Le fichier appsscript.json : fuseau, service Gmail avancé, et SEULEMENT les trois permissions nécessaires. */
export const MANIFESTE_RECUS = `{
  "timeZone": "Asia/Jerusalem",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "dependencies": {
    "enabledAdvancedServices": [{ "userSymbol": "Gmail", "serviceId": "gmail", "version": "v1" }]
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp"
  ]
}
`

/** Le programme, avec la clé du prestataire. `cle` ne contient que des caractères sûrs (rc_ + 64 hexadécimaux). */
export function scriptRecus(cle: string): string {
  if (!/^rc_[0-9a-f]{64}$/.test(cle)) throw new Error('clé mal formée')
  return `// Reçus Claude -> Coûts du cockpit. Ce programme LIT tes mails de reçus Anthropic (lecture seule) et les envoie au cockpit.
// Il ne peut ni écrire, ni envoyer, ni supprimer dans ta boîte. Ne partage pas ce texte : il contient ta clé.
var CLE = '${cle}';
var ADRESSE_COCKPIT = '${URL_FONCTION_RECUS}';
var EXPEDITEUR = '${EXPEDITEUR_RECUS}';
var RECHERCHE = 'from:' + EXPEDITEUR + ' subject:"${SUJET_RECUS}" newer_than:${JOURS_RELUS}d';
var PAR_LOT = 3;

// Une fois par semaine (dimanche 7 h), et tout de suite quand tu lances « installer ».
function installer() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'passer') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('passer').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(7).create();
  passer();
}

function passer() {
  try {
    envoyer();
  } catch (e) {
    try { poster({ echec: String(e && e.message ? e.message : e).slice(0, 200) }); } catch (ignore) {}
    throw e;
  }
}

function envoyer() {
  var props = PropertiesService.getScriptProperties();
  var vus = JSON.parse(props.getProperty('vus') || '[]');
  var liste = [];
  var page = null;
  do {
    var rep = Gmail.Users.Messages.list('me', { q: RECHERCHE, maxResults: 100, pageToken: page });
    liste = liste.concat(rep.messages || []);
    page = rep.nextPageToken;
  } while (page && liste.length < 500);
  var neufs = liste.filter(function (m) { return vus.indexOf(m.id) < 0; });
  var lots = [];
  for (var i = 0; i < neufs.length; i += PAR_LOT) lots.push(neufs.slice(i, i + PAR_LOT));
  if (!lots.length) lots.push([]); // rien de neuf : on le dit quand même au cockpit (c'est le signe que le programme tourne)
  lots.forEach(function (lot) {
    var mails = lot.map(function (m) { return lire(m.id); }).filter(function (x) { return x; });
    var rep = poster({ mails: mails, cadence_jours: 7 });
    (rep.mails || []).forEach(function (r) { if (r.statut !== 'erreur' && vus.indexOf(r.id) < 0) vus.push(r.id); });
    props.setProperty('vus', JSON.stringify(vus.slice(-500)));
  });
}

// Un mail : son texte et ses PDF joints. Rien d'autre n'est lu.
function lire(id) {
  var m = Gmail.Users.Messages.get('me', id, { format: 'full' });
  var de = '';
  (m.payload.headers || []).forEach(function (h) { if (h.name.toLowerCase() === 'from') de = h.value; });
  var adresse = (/<([^>]+)>/.exec(de) || [null, de])[1].trim().toLowerCase();
  if (adresse !== EXPEDITEUR) return null; // seul cet expéditeur exact compte
  var texte = '';
  var pdfs = [];
  (function parcourir(p) {
    if (p.mimeType === 'text/plain' && p.body && p.body.data && !texte) texte = decoder(p.body.data);
    if (p.filename && /\\.pdf$/i.test(p.filename) && p.body && p.body.attachmentId && (p.body.size || 0) <= 5 * 1024 * 1024 && pdfs.length < 4) {
      var a = Gmail.Users.Messages.Attachments.get('me', id, p.body.attachmentId);
      pdfs.push({ nom: p.filename, base64: a.data });
    }
    (p.parts || []).forEach(parcourir);
  })(m.payload);
  return { id: id, texte: texte, pdfs: pdfs };
}

function decoder(donnees) {
  var d = donnees;
  while (d.length % 4) d += '=';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(d)).getDataAsString('UTF-8');
}

function poster(corps) {
  var r = UrlFetchApp.fetch(ADRESSE_COCKPIT, {
    method: 'post', contentType: 'application/json', headers: { 'x-cockpit-cle': CLE },
    payload: JSON.stringify(corps), muteHttpExceptions: true
  });
  var rep = {};
  try { rep = JSON.parse(r.getContentText()); } catch (e) {}
  if (r.getResponseCode() !== 200 || !rep.ok) throw new Error('Le cockpit a refusé (' + r.getResponseCode() + ') : ' + (rep.erreur || r.getContentText().slice(0, 100)));
  return rep;
}
`
}
