/**
 * Portail Agent — serveur unique (Google Apps Script lié à un Google Sheet).
 *
 * Installation : voir README.md.
 *  1. Collez ce fichier dans Extensions > Apps Script du Google Sheet.
 *  2. Importez TELCO-OI 002.xlsx dans le Google Sheet, puis exécutez setup() une fois
 *     (vérifie les onglets, ajoute les colonnes de suivi des BASE, crée Comptes + la clé secrète).
 *  3. Exécutez creerAdmin() (après avoir modifié le nom/mot de passe plus bas).
 *  4. Déployer > Nouveau déploiement > Application Web
 *     (Exécuter en tant que : moi / Accès : tout le monde) et copiez l'URL /exec
 *     dans config.js (API_URL).
 */

var TOKEN_TTL_MS = 12 * 3600 * 1000;      // validité du jeton : 12 h
var LOGIN_MAX_FAILS = 5;                  // échecs avant blocage temporaire
var LOGIN_LOCK_MS = 10 * 60 * 1000;       // durée du blocage : 10 min

/*
 * Le Google Sheet est le classeur TELCO-OI 002 importé tel quel : le portail lit et écrit
 * directement dans ses onglets, sous leurs en-têtes français.
 *  - queue : GETNEXT prend la prochaine ligne non traitée de l'onglet BASE (base / baseCols),
 *            la validation ajoute une ligne dans l'onglet Tickets (tickets / cols) et marque la BASE.
 *  - entry : saisie libre, une ligne ajoutée dans l'onglet (sheet / cols).
 * cols / baseCols : clé utilisée par le portail -> en-tête de colonne dans l'onglet.
 * Une clé dont l'en-tête est absent crée la colonne en fin d'onglet.
 */
var MODULES = {
  rpi: { type: 'queue', base: 'BASE RPI', tickets: 'RPI Tickets',
    baseCols: { dateReception: 'Date de création S2', idActivite: "Numéro d'activité", nomClient: 'NOM DU CLIENT' },
    cols: { nomClient: 'Nom Client', dateReception: 'receptionS2', dateTraitement: 'Début Traitement', idActivite: 'ID Activité',
            contact: 'Contact', montant: 'Montant', zone: 'Zone', paiement: 'Paiement', modeReglement: 'Mode de Règlement',
            etatAppels: "Etat d'appels", statuts: 'Statuts', commentaires: 'Commentaires', dateFinTraitement: 'Fin Traitement',
            dmt: 'DMT (ms)', dmpc: 'DMPC', agent: 'Agent' } },
  asp: { type: 'queue', base: 'BASE ASP', tickets: 'ASP Tickets',
    baseCols: { dateReception: 'Date de création S2', nomClient: 'NOM DU CLIENT', idActivite: "Numéro d'activité" },
    cols: { agent: 'Agent', idActivite: 'ID Activité', dateReception: 'receptionS2', nomClient: 'Nom client', contact: 'Contact',
            montant: 'Montant', paiement: 'Paiement', zone: 'Zone', etatAppels: "État d'appels", statuts: "Statut d'appels",
            commentaires: 'Commentaires', dateTraitement: 'Date début', dateFinTraitement: 'Date fin', dmt: 'DMT', dmpc: 'DMPC',
            modeReglement: 'Mode de Règlement' } },
  vdc: { type: 'queue', base: 'BASE VDC', tickets: 'VDC tickets',
    baseCols: { dateReception: 'Date de réception', idActivite: "Numéro d'activité", boutique: 'BOUTIQUE' },
    cols: { agent: 'Agent', idActivite: 'ID Activité', boutique: 'Boutique', type: 'Type', zone: 'Zone', statutTicket: 'Statut',
            motif: 'Motif Rejet', dateReception: 'Réception S2', dateTraitement: 'Début Traitement', dateFinTraitement: 'Fin Traitement',
            dmt: 'DMT', dateEnregistrement: 'Date enregistrement', dmpc: 'DMPC' } },
  selfcare: { type: 'queue', base: 'BASE SELFCARE', tickets: 'SELFCARE Tickets',
    baseCols: { idActivite: "Numéro d'activité", dateReception: 'Date de réception' },
    cols: { idActivite: "Numéro d'activité", typologie: 'Typologie', etat: 'Etat', agent: 'Agent', dateReception: 'Date de réception',
            dateTraitement: 'Début du traitement', dateFinTraitement: 'Fin du traitement', dmpc: 'DMPC', dmt: 'DMT',
            dmpcGlobale: 'DMPC globale' } },
  rjd: { type: 'queue', base: 'BASE RJD', tickets: 'RJD Tickets',
    baseCols: { contrat: 'Contrat', montant: 'Montant', tribunal: 'Tribunal compétent' },
    cols: { contrat: 'Contrat', montant: 'Montant', tribunal: 'Tribunal compétent', commentaires: 'Commentaires', details: 'Détails',
            dateTraitement: 'Début du traitement', dateFinTraitement: 'Fin du traitement', dmt: 'DMT', agent: 'Agent' } },
  incident: { type: 'queue', base: 'BASE INCIDENT', tickets: 'INCIDENT TICKETS',
    baseCols: { activite: 'ACTIVITE', motifs: 'MOTIFS', nomUtilisateur: 'NOM' },
    cols: { activite: 'ACTIVITÉ', motifs: 'MOTIFS', nomUtilisateur: "NOM D'UTILISATEUR", numLigne: 'N° DE LIGNE',
            actionEffectuee: 'ACTION EFFECTUÉE', etat: 'ETAT DE LA DEMANDE', reassignation: 'RÉASSIGNATION SUPPORT_ING',
            dateCreation: "DATE CRÉATION DE L'ACTIVITÉ", datePriseEnCharge: 'DATE DE PRISE EN CHARGE PAR UN CSA N3',
            dateTraitement: 'DÉBUT DU TRAITEMENT', dateFinTraitement: 'FIN DU TRAITEMENT', dmt: 'DMT', agent: 'AGENT' } },
  indexation: { type: 'entry', sheet: 'Indexation',
    cols: { dateReception: 'Date de réception', dateTraitement: 'Date de traitement', types: 'TYPES', recu: 'REÇU',
            traiteOk: 'TRAITE OK', traiteNok: 'TRAITE NOK', motif: 'MOTIF', comptes: 'COMPTES', dateFinTraitement: 'Fin de traitement',
            dmt: 'DMT', dmpc: 'DMPC', agent: 'AGENT', id: 'ID' } },
  mails: { type: 'entry', sheet: 'Mails',
    cols: { dateReception: 'Date et Heure de réception', dateTraitement: 'Date début de traitement', canal: 'CANAL',
            idActivite: 'ID ACTIVITES', remarques: 'Remarques', comptes: 'COMPTES', dateFinTraitement: 'Date Fin de traitement',
            dmpc: 'DMPC', dmt: 'DMT', backlog: 'BACKLOG', agent: 'AGENT', id: 'ID' } },
  impayes: { type: 'entry', sheet: 'Encaissements',
    cols: { date: 'DATE', nomClient: 'NOM ET PRENOM DU CLIENT', numero: 'NUMERO', motif: 'MOTIF', zone: 'ZONE', montant: 'MONTANT',
            agent: 'AGENT', id: 'ID' } },
  facebook: { type: 'entry', sheet: 'Facebook',
    cols: { dateReception: 'Date et Heure de réception', dateDebut: 'Date début de traitement', comptes: 'COMPTES',
            idZendesk: 'ID ZENDESK', demande: 'Demande', mpRecus: 'MP RECUS', mpTraites: 'MP TRAITES',
            dateFin: 'Date Fin de traitement', dmpc: 'DMPC', dmt: 'DMT', backlog: 'BACKLOG', agent: 'AGENT' } },
  // NCMS garde les valeurs texte envoyées par le portail (jj/mm/aaaa, hh:mm:ss), comme dans le classeur.
  aux: { type: 'special', sheet: 'NCMS', raw: true,
    cols: { date: 'Date', debut: 'Début', fin: 'Fin', duree: 'Durée', categorie: 'Catégorie', valeur: 'Valeur', agent: 'Agent', uid: 'ID' } },
  temps: { type: 'special', sheet: 'TEMPS_ACTIVITES' }
};

// Type des champs à l'écriture : d = date/heure, t = durée hh:mm:ss (fraction de jour), n = nombre ; texte sinon.
var FIELD_TYPES = {
  dateReception: 'd', dateTraitement: 'd', dateFinTraitement: 'd', dateCreation: 'd', datePriseEnCharge: 'd',
  dateDebut: 'd', dateFin: 'd', dateEnregistrement: 'd', date: 'd',
  dmt: 't', dmpc: 't', dmpcGlobale: 't',
  montant: 'n'
};
var FMT_DATE = 'dd/mm/yyyy hh:mm:ss';
var FMT_DUREE = '[h]:mm:ss';

// Colonnes de suivi ajoutées aux onglets BASE (déjà présentes dans BASE RPI et BASE ASP).
var COL_DONE = 'Traité', COL_BY = 'Verrouillé par', COL_AT = 'Verrouillé le';
var DONE_VALUE = 'TRAITÉ';

// Onglet des comptes du portail (mots de passe hachés), créé par setup().
var COMPTES_HEADERS = ['nom', 'hash', 'sel', 'role', 'actif', 'version'];

var PASS_MIN = 4;                         // longueur minimale d'un mot de passe (lettres ou chiffres)
var IMPORT_MAX = 500;                     // lignes max par appel users_import

var LOCK_STALE_MS = 2 * 3600 * 1000;      // un verrou de plus de 2 h est libéré
var ACCOUNT_CACHE_S = 300;                // état d'un compte (version/actif/rôle) gardé 5 min en cache
var LIST_MAX = 100;                       // éléments renvoyés par groupe (Traité / Non traité / En cours)
var LIST_CACHE_S = 10;                    // compteurs d'une BASE gardés 10 s en cache (rafraîchissement auto des postes)

/* ------------------------------------------------------------------ */
/* Installation                                                        */
/* ------------------------------------------------------------------ */

/**
 * À lancer une fois après avoir importé TELCO-OI 002.xlsx dans le Google Sheet :
 * vérifie les onglets, ajoute les colonnes de suivi des BASE, crée Comptes et la clé secrète.
 */
function setup() {
  var ss = SpreadsheetApp.getActive();
  var missing = [];
  Object.keys(MODULES).forEach(function (m) {
    var def = MODULES[m];
    [def.base, def.tickets, def.sheet].forEach(function (name) {
      if (name && !ss.getSheetByName(name)) missing.push(name);
    });
  });
  if (missing.length) {
    throw new Error('Onglets absents : ' + missing.join(', ') +
      '. Importez TELCO-OI 002.xlsx (Fichier > Importer > Remplacer le classeur) puis relancez setup().');
  }
  Object.keys(MODULES).forEach(function (m) {
    if (MODULES[m].type === 'queue') {
      var info = baseInfo_(ss.getSheetByName(MODULES[m].base), MODULES[m]);
      Logger.log(MODULES[m].base + ' : suivi en colonnes ' + [info.cDone, info.cBy, info.cAt].join(', '));
    }
  });
  var cpt = ss.getSheetByName('Comptes') || ss.insertSheet('Comptes');
  if (cpt.getLastRow() === 0) {
    cpt.getRange(1, 1, 1, COMPTES_HEADERS.length).setValues([COMPTES_HEADERS]).setFontWeight('bold');
    cpt.setFrozenRows(1);
  }
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  Logger.log('Setup terminé. Lancez maintenant creerAdmin().');
}

/** Modifiez ces 2 valeurs puis exécutez la fonction (une seule fois). */
function creerAdmin() {
  var NOM = 'admin';
  var MOT_DE_PASSE = 'ChangezMoi!2026';
  setUser_(NOM, MOT_DE_PASSE, 'Admin', true);
  Logger.log('Compte admin "' + NOM + '" créé. Changez le mot de passe depuis le portail.');
}

/* ------------------------------------------------------------------ */
/* Entrées HTTP                                                        */
/* ------------------------------------------------------------------ */

function doGet(e) {
  return json_({ ok: true, service: 'portail-agent' });
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}') || {}; }
  catch (err) { return json_({ ok: false, error: 'Requête invalide' }); }
  var module = String((e.parameter && e.parameter.module) || body.module || '');
  var action = String(body.action || '');
  try {
    if (action === 'login') return json_(login_(body));

    var user = verifyToken_(body.token);
    if (!user) return json_({ ok: false, code: 'AUTH', error: 'Session expirée' });

    if (action.indexOf('user_') === 0 || action.indexOf('users_') === 0) return json_(adminAction_(user, action, body));

    var def = MODULES[module];
    if (!def) return json_({ ok: false, error: 'Module inconnu : ' + module });
    if (module === 'temps') return json_(temps_(user, action, body));
    if (module === 'aux') return json_(aux_(user, body));
    if (def.type === 'queue') return json_(queue_(module, def, user, action, body));
    return json_(entry_(module, def, user, action, body));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Comptes, mots de passe, jetons                                      */
/* ------------------------------------------------------------------ */

function hash_(pass, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pass, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function normRole_(r) {
  r = String(r || '').toLowerCase();
  if (r.indexOf('admin') !== -1) return 'Admin';
  if (r.indexOf('superv') !== -1) return 'Superviseur';
  return 'Agent';
}

function findUserRow_(sh, nom) {
  var data = sh.getDataRange().getValues();
  var target = String(nom).trim().toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === target) return { row: i + 1, values: data[i] };
  }
  return null;
}

function setUser_(nom, pass, role, actif) {
  var sh = SpreadsheetApp.getActive().getSheetByName('Comptes');
  ensureVersionCol_(sh);
  var found = findUserRow_(sh, nom);
  var salt = Utilities.getUuid();
  var version = found ? (Number(found.values[5]) || 0) + 1 : 1;
  var rec = [String(nom).trim(), hash_(pass, salt), salt, normRole_(role), actif === false ? 'non' : 'oui', version];
  if (found) sh.getRange(found.row, 1, 1, 6).setValues([rec]);
  else sh.appendRow(rec);
  forgetAccount_(nom);
}

/** Ajoute la colonne "version" aux onglets Comptes créés avant son introduction. */
function ensureVersionCol_(sh) {
  if (String(sh.getRange(1, 6).getValue()) !== 'version') sh.getRange(1, 6).setValue('version').setFontWeight('bold');
}

/** État courant d'un compte (mis en cache) : sert à invalider les jetons d'un compte modifié ou désactivé. */
function accountState_(nom) {
  var cache = CacheService.getScriptCache();
  var key = 'acct_' + String(nom).trim().toLowerCase();
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var f = findUserRow_(SpreadsheetApp.getActive().getSheetByName('Comptes'), nom);
  var st = f ? { v: Number(f.values[5]) || 0, actif: String(f.values[4]).toLowerCase() !== 'non', role: normRole_(f.values[3]) } : { v: -1, actif: false, role: '' };
  cache.put(key, JSON.stringify(st), ACCOUNT_CACHE_S);
  return st;
}

function forgetAccount_(nom) { CacheService.getScriptCache().remove('acct_' + String(nom).trim().toLowerCase()); }

function login_(body) {
  var nom = String(body.nom || '').trim();
  var pass = String(body.pass || '');
  if (!nom || !pass) return { ok: false, error: "Nom d'agent ou mot de passe incorrect." };

  var cache = CacheService.getScriptCache();
  var failKey = 'fail_' + nom.toLowerCase();
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= LOGIN_MAX_FAILS) return { ok: false, error: 'Trop de tentatives. Réessayez dans quelques minutes.' };

  var sh = SpreadsheetApp.getActive().getSheetByName('Comptes');
  var found = findUserRow_(sh, nom);
  var good = false;
  if (found) {
    var v = found.values;
    good = String(v[4]).toLowerCase() !== 'non' && hash_(pass, String(v[2])) === String(v[1]);
  }
  if (!good) {
    cache.put(failKey, String(fails + 1), LOGIN_LOCK_MS / 1000);
    return { ok: false, error: "Nom d'agent ou mot de passe incorrect." };
  }
  cache.remove(failKey);
  var name = String(found.values[0]);
  var role = normRole_(found.values[3]);
  var exp = Date.now() + TOKEN_TTL_MS;
  return { ok: true, token: signToken_(name, role, exp, Number(found.values[5]) || 0), exp: exp, name: name, role: role };
}

function secret_() { return PropertiesService.getScriptProperties().getProperty('SECRET') || ''; }

function b64url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function signToken_(name, role, exp, version) {
  var payload = b64url_(Utilities.newBlob(JSON.stringify({ n: name, r: role, e: exp, v: version })).getBytes());
  var sig = b64url_(Utilities.computeHmacSha256Signature(payload, secret_()));
  return payload + '.' + sig;
}

function verifyToken_(token) {
  if (!token || typeof token !== 'string') return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  var sig = b64url_(Utilities.computeHmacSha256Signature(parts[0], secret_()));
  if (sig !== parts[1]) return null;
  try {
    var data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    if (!data.e || data.e < Date.now()) return null;
    // Compte désactivé, mot de passe ou rôle changé depuis l'émission : le jeton n'est plus valable.
    var st = accountState_(data.n);
    if (!st.actif || st.v !== (Number(data.v) || 0)) return null;
    return { name: data.n, role: st.role, isSup: st.role === 'Superviseur' || st.role === 'Admin', isAdmin: st.role === 'Admin' };
  } catch (err) { return null; }
}

function adminAction_(user, action, body) {
  if (action === 'user_password') {            // chacun peut changer son propre mot de passe
    var pw = String(body.pass || '');
    if (pw.length < PASS_MIN) return { ok: false, error: 'Mot de passe trop court (' + PASS_MIN + ' caractères minimum).' };
    var target = user.isAdmin && body.nom ? String(body.nom) : user.name;
    var sh = SpreadsheetApp.getActive().getSheetByName('Comptes');
    var f = findUserRow_(sh, target);
    if (!f) return { ok: false, error: 'Compte introuvable.' };
    setUser_(f.values[0], pw, f.values[3], String(f.values[4]).toLowerCase() !== 'non');
    return selfToken_(user, f.values[0]);
  }
  if (!user.isAdmin) return { ok: false, error: 'Réservé aux administrateurs.' };
  var sheet = SpreadsheetApp.getActive().getSheetByName('Comptes');
  if (action === 'users_list') {
    var rows = sheet.getDataRange().getValues().slice(1).map(function (r) {
      return { nom: r[0], role: r[3], actif: String(r[4]).toLowerCase() !== 'non' };
    });
    return { ok: true, users: rows };
  }
  if (action === 'user_set') {
    var nom = String(body.nom || '').trim();
    if (!nom) return { ok: false, error: 'Nom requis.' };
    var existing = findUserRow_(sheet, nom);
    if (!existing) {
      if (String(body.pass || '').length < PASS_MIN) return { ok: false, error: 'Mot de passe requis (' + PASS_MIN + ' caractères minimum).' };
      setUser_(nom, body.pass, body.role, body.actif !== false);
    } else {
      ensureVersionCol_(sheet);
      sheet.getRange(existing.row, 4, 1, 3).setValues([[normRole_(body.role || existing.values[3]), body.actif === false ? 'non' : 'oui', (Number(existing.values[5]) || 0) + 1]]);
      forgetAccount_(existing.values[0]);
      if (body.pass) {
        if (String(body.pass).length < PASS_MIN) return { ok: false, error: 'Mot de passe trop court (' + PASS_MIN + ' caractères minimum).' };
        setUser_(existing.values[0], body.pass, body.role || existing.values[3], body.actif !== false);
      }
      return selfToken_(user, existing.values[0]);
    }
    return { ok: true };
  }
  if (action === 'users_import') return importUsers_(user, body.users);
  return { ok: false, error: 'Action inconnue.' };
}

/** Si l'utilisateur vient de modifier son propre compte, son jeton est invalidé : on lui en renvoie un neuf. */
function selfToken_(user, nom) {
  if (String(nom).trim().toLowerCase() !== String(user.name).trim().toLowerCase()) return { ok: true };
  var st = accountState_(nom);
  if (!st.actif) return { ok: true };
  var exp = Date.now() + TOKEN_TTL_MS;
  return { ok: true, token: signToken_(user.name, st.role, exp, st.v), exp: exp };
}

/**
 * Import en masse : [{nom, pass, role, ligne}]. Hache côté serveur, remplace le mot de passe
 * et le rôle des noms déjà présents (insensible à la casse), conserve leur colonne "actif".
 */
function importUsers_(user, list) {
  if (!Array.isArray(list)) return { ok: false, error: 'Liste invalide.' };
  if (list.length > IMPORT_MAX) return { ok: false, error: 'Maximum ' + IMPORT_MAX + ' lignes par envoi.' };
  var ROLES = { agent: 'Agent', superviseur: 'Superviseur', admin: 'Admin' };
  var rejetes = [], valid = {}, order = [];
  list.forEach(function (it, i) {
    var ligne = it && it.ligne != null ? it.ligne : i + 1;
    var nom = String(it && it.nom != null ? it.nom : '').trim();
    var pass = String(it && it.pass != null ? it.pass : '');
    var role = ROLES[String(it && it.role != null ? it.role : '').trim().toLowerCase()];
    var raison = '';
    if (!nom) raison = 'nom vide';
    else if (pass.length < PASS_MIN) raison = 'mot de passe trop court (' + PASS_MIN + ' minimum)';
    else if (!role) raison = 'rôle inconnu (Agent, Superviseur ou Admin)';
    else if (nom.toLowerCase() === String(user.name).toLowerCase() && role !== 'Admin') raison = 'vous ne pouvez pas retirer votre propre rôle Admin';
    if (raison) { rejetes.push({ ligne: ligne, nom: nom, raison: raison }); return; }
    var k = nom.toLowerCase();
    if (!valid[k]) order.push(k);
    valid[k] = { nom: nom, pass: pass, role: role };      // doublon dans le fichier : le dernier gagne
  });

  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName('Comptes');
    ensureVersionCol_(sh);
    var data = sh.getDataRange().getValues();
    var rowOf = {};
    for (var r = 1; r < data.length; r++) rowOf[String(data[r][0]).trim().toLowerCase()] = r;
    var crees = 0, modifies = 0, adds = [];
    order.forEach(function (k) {
      var u = valid[k], salt = Utilities.getUuid();
      var idx = rowOf[k];
      if (idx !== undefined) {
        var self = k === String(user.name).trim().toLowerCase();   // ne pas déconnecter l'admin en plein import
        data[idx] = [data[idx][0], hash_(u.pass, salt), salt, u.role, data[idx][4] === '' ? 'oui' : data[idx][4], (Number(data[idx][5]) || 0) + (self ? 0 : 1)];
        forgetAccount_(data[idx][0]);
        modifies++;
      } else {
        adds.push([u.nom, hash_(u.pass, salt), salt, u.role, 'oui', 1]);
        forgetAccount_(u.nom);
        crees++;
      }
    });
    if (modifies && data.length > 1) {
      sh.getRange(2, 1, data.length - 1, 6).setNumberFormat('@').setValues(data.slice(1).map(function (row) { return row.slice(0, 6); }));
    }
    if (adds.length) sh.getRange(sh.getLastRow() + 1, 1, adds.length, 6).setNumberFormat('@').setValues(adds);
    return { ok: true, crees: crees, modifies: modifies, rejetes: rejetes };
  } finally { lock.releaseLock(); }
}

/* ------------------------------------------------------------------ */
/* Utilitaires feuille                                                 */
/* ------------------------------------------------------------------ */

function getSheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Onglet "' + name + '" absent : importez TELCO-OI 002.xlsx puis exécutez setup().');
  return sh;
}

function headers_(sh) {
  var n = sh.getLastColumn();
  return n ? sh.getRange(1, 1, 1, n).getValues()[0].map(String) : [];
}

/** Forme comparable d'un en-tête : sans accents, casse, espaces multiples ni apostrophe typographique. */
function norm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Colonne (0-based) de chaque clé de map dans l'onglet. Avec create, un en-tête absent
 * est ajouté en fin d'onglet ; sinon la clé est omise.
 */
function colIndex_(sh, map, create) {
  var hdrs = headers_(sh);
  var normed = hdrs.map(norm_);
  var idx = {};
  Object.keys(map).forEach(function (k) {
    var i = normed.indexOf(norm_(map[k]));
    if (i === -1 && create) {
      i = hdrs.length;
      hdrs.push(map[k]);
      normed.push(norm_(map[k]));
      sh.getRange(1, i + 1).setValue(map[k]).setFontWeight('bold');
    }
    if (i !== -1) idx[k] = i;
  });
  return idx;
}

var tz__ = null;
function tz_() { return tz__ || (tz__ = SpreadsheetApp.getActive().getSpreadsheetTimeZone()); }

/** Date envoyée par le portail (aaaa-mm-jjThh:mm[:ss], jj/mm/aaaa [hh:mm[:ss]] ou ISO avec fuseau) -> Date, sinon null. */
function parseDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var s = String(v).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/))) {
    return Utilities.parseDate(m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + (m[6] || '00'), tz_(), 'yyyy-MM-dd HH:mm:ss');
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) {
    return Utilities.parseDate(m[3] + '-' + m[2] + '-' + m[1] + ' ' + (m[4] || '0') + ':' + (m[5] || '00') + ':' + (m[6] || '00'), tz_(), 'yyyy-M-d H:mm:ss');
  }
  if (/^\d{4}-\d{2}-\d{2}T.+(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Durée hh:mm[:ss] -> fraction de jour (format des colonnes DMT / DMPC du classeur), sinon null. */
function parseDuree_(v) {
  if (typeof v === 'number') return v;
  var m = String(v).trim().match(/^(-?)(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  var sec = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] || 0);
  return (m[1] ? -sec : sec) / 86400;
}

function dureeText_(n) {
  var s = Math.round(Math.abs(n) * 86400);
  var p = function (x) { return (x < 10 ? '0' : '') + x; };
  return (n < 0 ? '-' : '') + p(Math.floor(s / 3600)) + ':' + p(Math.floor(s % 3600 / 60)) + ':' + p(s % 60);
}

/** Valeur du portail -> valeur de cellule, selon FIELD_TYPES (raw : texte tel quel). */
function in_(v, key, raw) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
  if (!raw) {
    var t = FIELD_TYPES[key];
    if (t === 'd') { var d = parseDate_(v); if (d) return d; }
    if (t === 't') { var f = parseDuree_(v); if (f !== null) return f; }
    if (t === 'n' && String(v).trim() !== '' && !isNaN(Number(String(v).replace(',', '.')))) return Number(String(v).replace(',', '.'));
  }
  if (v instanceof Date) return v;
  var s = String(v);
  return /^[=+]/.test(s) ? "'" + s : s;   // jamais de formule venant du client
}

function out_(v) { return v instanceof Date ? v.toISOString() : v; }

/** Dernière ligne (1-based) ayant une valeur dans l'une des colonnes idx ; 1 si aucune. */
function lastDataRow_(sh, idx) {
  var last = sh.getLastRow();
  var cols = Object.keys(idx).map(function (k) { return idx[k]; });
  if (last < 2 || !cols.length) return Math.max(last, 1);
  var data = sh.getRange(2, 1, last - 1, Math.max.apply(null, cols) + 1).getValues();
  for (var r = data.length - 1; r >= 0; r--) {
    for (var j = 0; j < cols.length; j++) {
      var c = data[r][cols[j]];
      if (c !== '' && c !== null) return r + 2;
    }
  }
  return 1;
}

/** Recopie dans row les formules de la ligne du dessus (ex. MOIS), là où row n'a ni formule ni valeur écrite. */
function copyFormulasFromAbove_(sh, row, written) {
  if (row <= 2) return;
  var width = sh.getLastColumn();
  var above = sh.getRange(row - 1, 1, 1, width).getFormulasR1C1()[0];
  var cur = sh.getRange(row, 1, 1, width).getFormulas()[0];
  above.forEach(function (f, i) { if (f && !cur[i] && !(written && written[i])) sh.getRange(row, i + 1).setFormulaR1C1(f); });
}

/** Écrit les champs de obj présents dans idx sur la ligne row, en un seul appel ; les formules existantes sont conservées. */
function writeRow_(sh, row, idx, obj, raw) {
  var keys = Object.keys(idx).filter(function (k) { return Object.prototype.hasOwnProperty.call(obj, k); });
  var written = {};
  if (!keys.length) return written;
  var range = sh.getRange(row, 1, 1, sh.getLastColumn());
  var vals = range.getValues()[0];
  var formulas = range.getFormulas()[0];
  var fmts = range.getNumberFormats()[0];
  formulas.forEach(function (f, i) { if (f) vals[i] = f; });
  keys.forEach(function (k) {
    var i = idx[k], v = in_(obj[k], k, raw);
    written[i] = true;
    vals[i] = v;
    if (v instanceof Date) fmts[i] = FMT_DATE;
    else if (typeof v === 'number') fmts[i] = FIELD_TYPES[k] === 't' ? FMT_DUREE : (fmts[i] === '@' ? '0.00' : fmts[i]);
    else fmts[i] = '@';                    // texte brut : évite les conversions automatiques (ex. 0692…)
  });
  range.setNumberFormats([fmts]).setValues([vals]);
  return written;
}

/** Ajoute obj (clés de map) sous la dernière ligne remplie de l'onglet et renvoie le numéro de ligne. */
function appendRow_(sh, map, obj, raw) {
  var used = {};
  Object.keys(map).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(obj, k)) used[k] = map[k]; });
  var idx = colIndex_(sh, used, true);
  var row = lastDataRow_(sh, colIndex_(sh, map, false)) + 1;
  copyFormulasFromAbove_(sh, row, writeRow_(sh, row, idx, obj, raw));
  return row;
}

/** Lignes non vides de l'onglet en objets à clés de map (durées en hh:mm:ss, dates en ISO). */
function readAll_(sh, map) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var idx = colIndex_(sh, map, false);
  var range = sh.getRange(2, 1, last - 1, sh.getLastColumn());
  var vals = range.getValues(), disp = range.getDisplayValues();
  var out = [];
  vals.forEach(function (r, i) {
    var o = { row: i + 2 }, empty = true;
    Object.keys(idx).forEach(function (k) {
      var v = r[idx[k]];
      if (v !== '' && v !== null) empty = false;
      if (FIELD_TYPES[k] === 't') o[k] = typeof v === 'number' ? dureeText_(v) : disp[i][idx[k]];
      else o[k] = out_(v);
    });
    if (!empty) out.push(o);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Files BASE -> Tickets : getnext / release / update / list           */
/* ------------------------------------------------------------------ */

/**
 * Colonnes (0-based) des données et du suivi d'une BASE. Les colonnes de suivi absentes prennent
 * d'abord les colonnes sans titre qui suivent les données (l'ancien classeur y mettait statut,
 * agent, date dans cet ordre), puis la fin de l'onglet.
 */
function baseInfo_(sh, def) {
  var hdrs = headers_(sh);
  var normed = hdrs.map(norm_);
  var data = colIndex_(sh, def.baseCols, false);
  var need = [COL_DONE, COL_BY, COL_AT].filter(function (h) { return normed.indexOf(norm_(h)) === -1; });
  if (need.length) {
    var i = Math.max.apply(null, Object.keys(data).map(function (k) { return data[k]; }).concat([-1])) + 1;
    need.forEach(function (h) {
      while (i < hdrs.length && String(hdrs[i]).trim() !== '') i++;
      sh.getRange(1, i + 1).setValue(h).setFontWeight('bold');
      hdrs[i] = h;
      i++;
    });
    normed = hdrs.map(norm_);
  }
  return { data: data, cDone: normed.indexOf(norm_(COL_DONE)), cBy: normed.indexOf(norm_(COL_BY)), cAt: normed.indexOf(norm_(COL_AT)) };
}

function readBase_(sh) {
  var last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}

/** Traité : 1, TRAITÉ, Traité… (tout sauf vide / « Non traité » / 0). */
function baseDone_(r, info) {
  var d = norm_(r[info.cDone]);
  return d !== '' && d !== 'non traite' && d !== 'en cours' && d !== '0' && d !== 'false';
}

function baseStatus_(r, info, now) {
  if (baseDone_(r, info)) return 'Traité';
  var at = r[info.cAt];
  if (String(r[info.cBy]).trim() && at instanceof Date && now - at.getTime() < LOCK_STALE_MS) return 'En cours';
  return 'Non traité';
}

function baseEmpty_(r, info) {
  return Object.keys(info.data).every(function (k) { var v = r[info.data[k]]; return v === '' || v === null; });
}

function baseTicket_(r, info) {
  var o = {};
  Object.keys(info.data).forEach(function (k) { o[k] = out_(r[info.data[k]]); });
  return o;
}

function setLock_(sh, row, info, by, at) {
  sh.getRange(row, info.cBy + 1).setValue(by);
  var c = sh.getRange(row, info.cAt + 1);
  if (at) c.setNumberFormat(FMT_DATE).setValue(at);
  else c.setValue('');
}

function sameAgent_(a, user) { return String(a).trim().toLowerCase() === String(user.name).trim().toLowerCase(); }

function queue_(module, def, user, action, body) {
  var sh = getSheet_(def.base);
  if (action !== 'getnext' && action !== 'release' && action !== 'update') return list_(module, def, sh);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var info = baseInfo_(sh, def);
    var res = action === 'getnext' ? getNext_(sh, info, user)
            : action === 'release' ? release_(sh, info, user, Number(body.row))
            : update_(def, sh, info, user, body.ticket || {});
    CacheService.getScriptCache().remove('list_' + module);
    return res;
  } finally { lock.releaseLock(); }
}

function getNext_(sh, info, user) {
  var data = readBase_(sh), now = Date.now(), pick = -1, i;
  // 1) une ligne déjà verrouillée par cet agent (reprise) ; 2) la première non traitée
  for (i = 0; i < data.length && pick === -1; i++) {
    if (baseStatus_(data[i], info, now) === 'En cours' && sameAgent_(data[i][info.cBy], user)) pick = i;
  }
  for (i = 0; i < data.length && pick === -1; i++) {
    if (!baseEmpty_(data[i], info) && baseStatus_(data[i], info, now) === 'Non traité') pick = i;
  }
  if (pick === -1) return { ok: false, error: 'Aucun ticket non traité dans ' + sh.getName() + '.' };
  var row = pick + 2;
  setLock_(sh, row, info, user.name, new Date(now));
  var ticket = baseTicket_(data[pick], info);
  ticket.row = row;
  ticket.statutTraitement = 'En cours';
  ticket.agent = user.name;
  return { ok: true, ticket: ticket };
}

function release_(sh, info, user, row) {
  if (!row || row < 2 || row > sh.getLastRow()) return { ok: false, error: 'Ligne invalide' };
  var r = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  if (baseStatus_(r, info, Date.now()) === 'En cours' && sameAgent_(r[info.cBy], user)) setLock_(sh, row, info, '', null);
  return { ok: true };
}

/**
 * Ajoute le traitement dans l'onglet Tickets ; si le ticket vient de la BASE (row, via GETNEXT),
 * la ligne BASE est marquée TRAITÉ. Sans row (saisie manuelle), seule la ligne Tickets est ajoutée.
 */
function update_(def, sh, info, user, t) {
  var row = Number(t.row) || 0;
  if (row) {
    if (row < 2 || row > sh.getLastRow()) return { ok: false, error: 'Ligne invalide' };
    var r = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
    if (baseDone_(r, info)) return { ok: false, error: 'Ce ticket est déjà traité dans ' + sh.getName() + '.' };
    if (!user.isSup && !sameAgent_(r[info.cBy], user)) {
      return { ok: false, error: String(r[info.cBy]).trim() ? 'Ce ticket est verrouillé par un autre agent.' : "Ce ticket ne vous est pas attribué (utilisez GETNEXT)." };
    }
  }
  var fields = {};
  Object.keys(def.cols).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(t, k)) fields[k] = t[k]; });
  fields.agent = user.isSup && t.agent ? t.agent : user.name;     // l'agent enregistré est celui du jeton
  if (def.cols.dateEnregistrement) fields.dateEnregistrement = new Date();
  var ticketRow = appendRow_(getSheet_(def.tickets), def.cols, fields, false);
  if (row) {
    sh.getRange(row, info.cDone + 1).setValue(DONE_VALUE);
    setLock_(sh, row, info, fields.agent, new Date());
  }
  return { ok: true, row: row, ticketRow: ticketRow };
}

/** Compteurs d'une BASE (partagés par tous les postes, cache court) + LIST_MAX éléments par groupe. */
function list_(module, def, sh) {
  var cache = CacheService.getScriptCache(), key = 'list_' + module;
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var info = baseInfo_(sh, def), now = Date.now();
  var counts = { 'Traité': 0, 'Non traité': 0, 'En cours': 0 }, tickets = [];
  readBase_(sh).forEach(function (r, i) {
    if (baseEmpty_(r, info)) return;
    var st = baseStatus_(r, info, now);
    if (counts[st]++ < LIST_MAX) {
      var o = baseTicket_(r, info);
      o.row = i + 2;
      o.statutTraitement = st;
      o.agent = r[info.cBy];
      tickets.push(o);
    }
  });
  var res = { ok: true, counts: counts, tickets: tickets };
  try { cache.put(key, JSON.stringify(res), LIST_CACHE_S); } catch (e) { /* trop volumineux pour le cache */ }
  return res;
}

/* ------------------------------------------------------------------ */
/* Modules de saisie : submit / list                                   */
/* ------------------------------------------------------------------ */

function entry_(module, def, user, action, body) {
  var sh = getSheet_(def.sheet);
  if (action === 'submit') {
    var entry = Object.assign({}, body[module] || body.facebook || body.entry || {});
    if (!user.isSup || !entry.agent) entry.agent = user.name;     // agent imposé par le jeton
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      return { ok: true, row: appendRow_(sh, def.cols, entry, false) };
    } finally { lock.releaseLock(); }
  }
  // list : un agent ne voit que ses lignes, un superviseur voit tout
  var rows = readAll_(sh, def.cols);
  if (!user.isSup) rows = rows.filter(function (r) { return sameAgent_(r.agent, user); });
  var out = { ok: true };
  out[module === 'facebook' ? 'facebook' : 'entries'] = rows;
  return out;
}

/* ------------------------------------------------------------------ */
/* AUX (onglet NCMS)                                                   */
/* ------------------------------------------------------------------ */

function aux_(user, body) {
  var e = Object.assign({}, body.entry || {});
  if (!e.uid) return { ok: false, error: 'uid manquant' };
  e.agent = user.name;
  var def = MODULES.aux, sh = getSheet_(def.sheet);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var idx = colIndex_(sh, def.cols, true);
    var row = findRowByUid_(sh, idx.uid, e.uid);
    if (row && !sameAgent_(sh.getRange(row, idx.agent + 1).getValue(), user)) return { ok: false, error: 'Entrée AUX d\'un autre agent.' };
    if (row) writeRow_(sh, row, idx, e, def.raw);
    else row = appendRow_(sh, def.cols, e, def.raw);
    return { ok: true, row: row };
  } finally { lock.releaseLock(); }
}

/** Ligne (1-based) dont la colonne col (0-based) vaut uid, en partant du bas ; 0 si absente. */
function findRowByUid_(sh, col, uid) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, col + 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(uid)) return i + 2;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Temps (suivi par activité, onglet TEMPS_ACTIVITES)                  */
/* ------------------------------------------------------------------ */

function temps_(user, action, body) {
  var sh = getSheet_(MODULES.temps.sheet);
  if (action === 'tt_upsert') {
    var s = body.session || {};
    if (!s.uid || !s.activity || !s.start) return { ok: false, error: 'Session invalide' };
    var rec = { uid: String(s.uid), agent: user.name, activity: String(s.activity), start: Number(s.start),
                end: s.end === '' || s.end == null ? '' : Number(s.end), seen: Number(s.seen) || Date.now() };
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var row = findRowByUid_(sh, 0, rec.uid);
      if (row && !sameAgent_(sh.getRange(row, 2).getValue(), user)) return { ok: false, error: "Session d'un autre agent." };
      var isNew = !row;
      if (isNew) row = lastDataRow_(sh, { uid: 0 }) + 1;     // l'onglet a des formules pré-remplies : pas getLastRow()
      sh.getRange(row, 1, 1, 6).setNumberFormat('@').setValues([[rec.uid, rec.agent, rec.activity, rec.start, rec.end, rec.seen]]);
      if (isNew) copyFormulasFromAbove_(sh, row);
    } finally { lock.releaseLock(); }
    return { ok: true };
  }
  if (action === 'tt_list') {
    var last = lastDataRow_(sh, { uid: 0 });
    var sessions = [];
    if (last >= 2) {
      sessions = sh.getRange(2, 1, last - 1, 6).getValues().map(function (r) {
        return { uid: String(r[0]), agent: String(r[1]), activity: String(r[2]), start: Number(r[3]), end: r[4] === '' ? '' : Number(r[4]), seen: Number(r[5]) || 0 };
      }).filter(function (s) { return s.uid && (user.isSup || sameAgent_(s.agent, user)); });
    }
    return { ok: true, sessions: sessions };
  }
  return { ok: false, error: 'Action inconnue' };
}

/* ------------------------------------------------------------------ */
/* Vérifications (à lancer depuis l'éditeur Apps Script)               */
/* ------------------------------------------------------------------ */

/** Journalise, pour chaque onglet, les en-têtes attendus introuvables. Ne modifie rien. */
function verifierColonnes() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(MODULES).forEach(function (m) {
    var def = MODULES[m];
    [[def.base, def.baseCols], [def.tickets, def.cols], [def.sheet, def.cols]].forEach(function (p) {
      if (!p[0] || !p[1]) return;
      var sh = ss.getSheetByName(p[0]);
      if (!sh) { Logger.log(p[0] + ' : ONGLET ABSENT'); return; }
      var idx = colIndex_(sh, p[1], false);
      var miss = Object.keys(p[1]).filter(function (k) { return !(k in idx); }).map(function (k) { return p[1][k]; });
      Logger.log(p[0] + ' : ' + (miss.length ? 'colonnes créées à la première écriture -> ' + miss.join(', ') : 'OK'));
    });
  });
}

/** GETNEXT puis libération sur BASE RPI, au nom de « test-portail » : vérifie le verrouillage sans rien traiter. */
function testerFileRpi() {
  var user = { name: 'test-portail', isSup: false };
  var res = queue_('rpi', MODULES.rpi, user, 'getnext', {});
  Logger.log(JSON.stringify(res));
  if (res.ok) Logger.log(JSON.stringify(queue_('rpi', MODULES.rpi, user, 'release', { row: res.ticket.row })));
  Logger.log(JSON.stringify(queue_('rpi', MODULES.rpi, user, 'list', {}).counts));
}
