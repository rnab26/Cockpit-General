/**
 * Reçus Claude → Cockpit (version 1)
 *
 * Ce programme vit dans TON compte Google. Chaque dimanche matin, il :
 *   1. cherche dans ta boîte Gmail les mails de reçu d'Anthropic (expéditeur invoice+statements@mail.anthropic.com,
 *      objet « Your receipt from Anthropic ») ;
 *   2. envoie à ton cockpit le texte de chaque reçu et le PDF de sa facture ;
 *   3. dit au cockpit comment ça s'est passé (la carte « Claude » de Coûts l'affiche).
 *
 * Ce qu'il NE fait PAS : il n'envoie, ne supprime, ne classe et n'écrit aucun mail. L'autorisation demandée à Google est
 * « lecture seule » (gmail.readonly) : Google lui-même refuserait toute écriture. Il ne parle qu'à Gmail et à ton cockpit
 * (liste dans appsscript.json). Il vérifie l'expéditeur de chaque mail AVANT de lire son contenu (en-têtes seulement), et
 * ne lit ni n'envoie jamais le contenu d'un mail qui ne vient pas d'Anthropic.
 *
 * Trois fonctions à connaître (liste des fonctions, en haut de l'éditeur, puis « Exécuter ») :
 *   installer()  à lancer UNE fois : programme le passage du dimanche, puis fait un premier passage.
 *   essai()      lit tes reçus et dit ce qui SERAIT ajouté, sans rien écrire dans Coûts.
 *   passage()    le vrai passage (c'est lui que le dimanche lance tout seul).
 *
 * La clé ci-dessous est celle de ton cockpit (Coûts › Claude). Elle n'ouvre que l'ajout des reçus Claude. Pour couper l'accès :
 * « Révoquer » dans le cockpit, ou supprime le passage du dimanche (panneau « Triggers », icône de réveil, à gauche de l'éditeur).
 */

const VERSION = 1;
const URL_COCKPIT = 'https://bexiyvmdbxcwxasgslxp.supabase.co/functions/v1/cockpit-recus';
const CLE = '__CLE__';
const EXPEDITEUR = 'invoice+statements@mail.anthropic.com';
const SUJET = 'Your receipt from Anthropic';
const CADENCE_JOURS = 7;
const MESSAGES_MAX = 40;
const PDF_MAX_OCTETS = 5 * 1024 * 1024;
const DUREE_MAX_MS = 5 * 60 * 1000; // Google coupe un programme à 6 minutes : on s'arrête avant, le passage suivant continue
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** À lancer une seule fois : programme le passage du dimanche vers 7 h (heure d'Israël), puis fait un premier passage pour de vrai. */
function installer() {
  clePresente_();
  const anciens = ScriptApp.getProjectTriggers();
  for (let i = 0; i < anciens.length; i++) {
    if (anciens[i].getHandlerFunction() === 'passage') ScriptApp.deleteTrigger(anciens[i]);
  }
  programmer_();
  Logger.log('Installé : le programme passera chaque dimanche vers 7 h (heure d\'Israël). Premier passage :');
  passage();
}

/** Le passage hebdomadaire. Si Google refuse la forme « toutes les semaines », la forme classique « le dimanche à 7 h » fait la même chose. */
function programmer_() {
  try {
    ScriptApp.newTrigger('passage').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(7).create();
  } catch (e) {
    ScriptApp.newTrigger('passage').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(7).create();
  }
}

/** Lit tes reçus Anthropic et dit ce qui serait ajouté dans Coûts. N'écrit rien dans Coûts. */
function essai() {
  executer_(true);
}

/** Le vrai passage : c'est ce que le déclencheur du dimanche lance. */
function passage() {
  executer_(false);
}

function executer_(essai) {
  clePresente_();
  const debut = Date.now();
  const resultats = [];
  let echec = null;
  try {
    const etat = appeler_({ action: 'etat' });
    Logger.log('Cockpit joint : projet « ' + etat.projet + ' », prestataire « ' + etat.prestataire + ' », reçus lus à partir du ' + etat.depuis + '.');
    const requete = requete_(etat.depuis);
    const ids = chercher_(requete);
    Logger.log(ids.length + ' mail(s) de reçu trouvé(s).');
    for (let i = 0; i < ids.length; i++) {
      if (Date.now() - debut > DUREE_MAX_MS) {
        resultats.push({ statut: 'erreur', quoi: 'fin du temps', message: (ids.length - i) + ' mail(s) pas encore traité(s) : le prochain passage continuera' });
        break;
      }
      const r = traiter_(ids[i], essai);
      if (r) {
        resultats.push(r);
        Logger.log(ligne_(r));
      }
    }
  } catch (e) {
    echec = texte_(e);
    Logger.log('ÉCHEC : ' + echec);
  }
  const fin = appeler_({ action: 'passage', resultats: resultats, echec: echec, cadence_jours: CADENCE_JOURS, essai: essai });
  Logger.log((essai ? 'Essai terminé (rien n\'a été écrit dans Coûts) : ' : 'Passage terminé : ') + fin.note);
  if (echec) throw new Error(echec); // l'exécution apparaît en échec dans Google ; le cockpit le sait déjà
}

/** Un mail : vérifie qui l'a envoyé (en-têtes seulement), puis en prend le texte et le PDF de la facture et les envoie au cockpit. */
function traiter_(id, essai) {
  let quoi = 'un mail';
  try {
    const entete = gmail_('/messages/' + id + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject');
    quoi = 'mail du ' + new Date(Number(entete.internalDate)).toISOString().slice(0, 10);
    const entetes = entetes_(entete.payload);
    if (adresse_(entetes.from) !== EXPEDITEUR || (entetes.subject || '').indexOf(SUJET) !== 0) {
      Logger.log(quoi + ' : pas un reçu d\'Anthropic, ignoré (son contenu n\'est pas lu).');
      return null;
    }
    const m = gmail_('/messages/' + id + '?format=full');
    const texte = texteDe_(m);
    if (!texte) return { statut: 'refus', quoi: quoi, message: 'aucun texte lisible dans ce mail' };
    const r = appeler_({ action: 'recu', texte: texte, pdfs: pdfsDe_(m), essai: essai });
    return { statut: r.statut, facture: r.facture, montant: r.montant, devise: r.devise, date: r.date, pdf: r.pdf, quoi: quoi, message: r.message };
  } catch (e) {
    return { statut: 'erreur', quoi: quoi, message: texte_(e) };
  }
}

// ------------------------------------------------------------------------------------------------------------- Gmail

/** La recherche : l'expéditeur exact, l'objet, et un jour de marge avant le jour de départ (le cockpit dédoublonne par n° de facture). */
function requete_(depuis) {
  const d = new Date(depuis + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return 'from:' + EXPEDITEUR + ' subject:"' + SUJET + '" after:' + d.toISOString().slice(0, 10).replace(/-/g, '/');
}

function chercher_(requete) {
  const ids = [];
  let page = null;
  do {
    const r = gmail_('/messages?maxResults=50&q=' + encodeURIComponent(requete) + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    const l = r.messages || [];
    for (let i = 0; i < l.length; i++) ids.push(l[i].id);
    page = r.nextPageToken || null;
  } while (page && ids.length < MESSAGES_MAX);
  return ids.slice(0, MESSAGES_MAX);
}

/** Une lecture Gmail (jamais autre chose qu'un GET). */
function gmail_(chemin) {
  const r = UrlFetchApp.fetch(GMAIL + chemin, { method: 'get', headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  const code = r.getResponseCode();
  if (code !== 200) {
    const aide = code === 403 || code === 401 ? ' — relance installer() et accepte la lecture de tes mails' : '';
    throw new Error('Gmail a répondu ' + code + aide + ' : ' + r.getContentText().slice(0, 160).replace(/\s+/g, ' '));
  }
  return JSON.parse(r.getContentText());
}

function entetes_(payload) {
  const out = {};
  const l = (payload && payload.headers) || [];
  for (let i = 0; i < l.length; i++) out[String(l[i].name).toLowerCase()] = l[i].value;
  return out;
}

/** « Anthropic, PBC <invoice+statements@mail.anthropic.com> » -> l'adresse seule, en minuscules. */
function adresse_(de) {
  const m = /<([^<>]+)>\s*$/.exec(de || '');
  return (m ? m[1] : String(de || '')).trim().toLowerCase();
}

/** Toutes les parties du mail, y compris les parties emboîtées. */
function parties_(p) {
  let out = [p];
  const f = p.parts || [];
  for (let i = 0; i < f.length; i++) out = out.concat(parties_(f[i]));
  return out;
}

/** Le contenu d'une partie : dans le mail lui-même, ou à aller chercher quand il est trop gros. */
function donnees_(idMessage, corps) {
  if (!corps) return '';
  if (corps.attachmentId) return gmail_('/messages/' + idMessage + '/attachments/' + corps.attachmentId).data || '';
  return corps.data || '';
}

function decoder_(base64Url) {
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(base64Url)).getDataAsString();
}

/** Le texte du mail : sa partie « texte brut », sinon sa partie HTML réduite à du texte. */
function texteDe_(m) {
  const l = parties_(m.payload);
  let brut = null;
  let html = null;
  for (let i = 0; i < l.length; i++) {
    if (l[i].filename) continue;
    if (l[i].mimeType === 'text/plain' && !brut) brut = l[i];
    if (l[i].mimeType === 'text/html' && !html) html = l[i];
  }
  if (brut) {
    const t = decoder_(donnees_(m.id, brut.body));
    if (t.trim()) return t;
  }
  if (html) return enTexte_(decoder_(donnees_(m.id, html.body)));
  return '';
}

function enTexte_(html) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(br|p|div|tr|td|th|li|h[1-6])[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'');
}

/** Le PDF de la facture (« Invoice-….pdf ») : jamais le PDF du reçu, jamais plus de deux pièces, jamais plus de 5 Mo. */
function pdfsDe_(m) {
  const out = [];
  const l = parties_(m.payload);
  for (let i = 0; i < l.length && out.length < 2; i++) {
    const p = l[i];
    if (!p.filename || !/^Invoice-.+\.pdf$/i.test(p.filename)) continue;
    if (p.body && p.body.size > PDF_MAX_OCTETS) continue;
    const data = donnees_(m.id, p.body);
    if (data) out.push({ nom: p.filename, base64: data });
  }
  return out;
}

// ----------------------------------------------------------------------------------------------------------- cockpit

/** Un appel au cockpit. Toute réponse qui n'est pas « ok » devient une erreur lisible. */
function appeler_(corps) {
  corps.version = VERSION;
  const r = UrlFetchApp.fetch(URL_COCKPIT, {
    method: 'post', contentType: 'application/json', headers: { 'x-cockpit-key': CLE }, payload: JSON.stringify(corps), muteHttpExceptions: true,
  });
  const code = r.getResponseCode();
  let json = null;
  try { json = JSON.parse(r.getContentText()); } catch (e) { json = null; }
  if (code !== 200 || !json || json.ok !== true) {
    throw new Error(json && json.erreur ? json.erreur : 'Le cockpit a répondu ' + code + ' sans explication.');
  }
  return json;
}

function clePresente_() {
  if (!/^cki_[0-9a-f]{64}$/.test(CLE)) throw new Error('Ce programme n\'a pas sa clé : recopie-le depuis le cockpit (Coûts › Claude › Brancher mon compte Google).');
}

/** Un message d'erreur sans jamais la clé. */
function texte_(e) {
  return String(e && e.message ? e.message : e).split(CLE).join('***').slice(0, 300);
}

/** Une ligne du journal pour un reçu. */
function ligne_(r) {
  const nom = { ajoute: 'ajouté', a_ajouter: 'serait ajouté', deja_la: 'déjà dans Coûts', hors_periode: 'avant le jour de départ, laissé de côté', pdf_joint: 'PDF joint à la facture déjà présente', refus: 'REFUSÉ', erreur: 'ERREUR' }[r.statut] || r.statut;
  const detail = r.facture ? ' · facture ' + r.facture + (r.montant ? ' · ' + r.montant + ' ' + (r.devise || '') : '') : '';
  const pdf = r.pdf ? ' · PDF : ' + ({ depose: 'rangé', absent: 'absent', deja: 'déjà là', refuse: 'refusé', serait_depose: 'serait rangé', serait_joint: 'serait joint' }[r.pdf] || r.pdf) : '';
  return r.quoi + ' : ' + nom + detail + pdf + (r.message ? ' — ' + r.message : '');
}
