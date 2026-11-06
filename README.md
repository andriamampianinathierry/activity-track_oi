# Portail Agent — Google Sheet + Apps Script + Vercel

## 1. Google Sheet et Apps Script
1. Créez un Google Sheet vide puis **Fichier > Importer > Importer** le classeur `TELCO-OI 002.xlsx`, avec l'option **Remplacer le classeur**.
   *Mise à jour d'un Sheet existant* : supprimez d'abord les anciens onglets du portail (RPI, ASP, VDC, Selfcare, RJD, Incident, Indexation, Mails, Encaissements, Facebook, AUX, Temps), mais **gardez `Comptes`**, puis importez avec l'option **Insérer une ou plusieurs feuilles**. « Remplacer le classeur » effacerait les comptes.
   Le portail travaille directement dans ses onglets (voir § 3). **Fichier > Paramètres** : le fuseau horaire doit être celui des agents, car les dates envoyées par le portail sont lues dans ce fuseau.
2. **Extensions > Apps Script**, supprimez le code par défaut, collez le contenu de `Code.gs`, enregistrez.
3. Dans `creerAdmin()`, changez `NOM` et `MOT_DE_PASSE`.
4. Exécutez **`setup()`** (autorisez l'accès demandé). Il vérifie que tous les onglets sont présents, ajoute les colonnes de suivi des BASE (§ 3), puis crée l'onglet `Comptes` et la clé secrète.
   Exécutez ensuite **`verifierColonnes()`** : le journal liste, pour chaque onglet, les en-têtes introuvables. Ces colonnes seront créées en fin d'onglet à la première écriture.
5. Exécutez **`creerAdmin()`** : crée votre compte Admin.
6. **Déployer > Nouveau déploiement > Application Web** : *Exécuter en tant que* **Moi**, *Accès* **Tout le monde**. Copiez l'URL qui finit par `/exec`.
7. Après chaque modification de `Code.gs` : **Déployer > Gérer les déploiements > modifier > Nouvelle version** (l'URL reste identique).

## 2. Configurer le site
Dans `config.js`, remplacez `COLLEZ_ICI_URL_APPS_SCRIPT` par l'URL `/exec`.

## 3. Les BASE et les onglets du classeur (temps réel)
Chaque module travaille sur un onglet BASE et un onglet de résultats :

| Module | File d'entrée | Résultats |
|---|---|---|
| RPI | `BASE RPI` | `RPI Tickets` |
| ASP | `BASE ASP` | `ASP Tickets` |
| VDC | `BASE VDC` | `VDC tickets` |
| Selfcare | `BASE SELFCARE` | `SELFCARE Tickets` |
| RJD | `BASE RJD` | `RJD Tickets` |
| Incident | `BASE INCIDENT` | `INCIDENT TICKETS` |

- **Alimenter une BASE** : collez les nouvelles lignes en bas de l'onglet, sous les en-têtes existants, en laissant vides les colonnes `Traité`, `Verrouillé par` et `Verrouillé le`.
  Les nouvelles lignes sont prises en compte immédiatement par GETNEXT, sans redéploiement.
- **GETNEXT** prend la première ligne non traitée et la verrouille au nom de l'agent (`Verrouillé par` / `Verrouillé le`). Deux agents ne reçoivent jamais la même ligne. Un verrou de plus de 2 h est libéré.
- **Enregistrer** ajoute une ligne dans l'onglet de résultats, sous ses en-têtes français. La formule MOIS est recopiée depuis la ligne du dessus. La ligne de la BASE passe ensuite à `TRAITÉ`.
- Une ligne est considérée comme traitée dès que la colonne `Traité` contient une valeur (`1`, `TRAITÉ`, `Traité`…), sauf « Non traité ».
- Les compteurs **Traités / Non traités / En cours** du module affiché se mettent à jour automatiquement toutes les 20 s, et dès le retour sur l'onglet du navigateur. Ils comptent le travail de tous les agents.
- `Base globale RPI` n'est pas utilisée par le portail.
- **Autres onglets utilisés tels quels** : `Indexation`, `Mails`, `Facebook`, `Encaissements` (module Impayés), `NCMS` (module AUX) et `TEMPS_ACTIVITES` (suivi des temps).
- **Changer un nom de colonne** dans le classeur : il faut aussi le changer dans `MODULES`, en haut de `Code.gs`. La comparaison ignore les accents, la casse et le type d'apostrophe.

⚠ Les onglets `users` et `Config` du classeur contiennent des **mots de passe en clair**, et le portail ne les utilise pas. Importez ces comptes via ⚙ > « Importer des comptes » (§ 4), puis **supprimez ces deux onglets** du Google Sheet.

## 4. Comptes
Admin : bouton ⚙ du portail → créer/modifier agents (rôles Agent, Superviseur, Admin), activer/désactiver, changer mot de passe.
**Import en masse** (⚙ > « Importer des comptes ») : fichier `.csv` (séparateur `;` ou `,`) ou `.xlsx` avec les colonnes `NOM`, `PASS`, `ROLE` (Agent, Superviseur, Admin).
Un nom déjà présent voit son mot de passe et son rôle remplacés ; les lignes invalides (nom vide, mot de passe < 4 caractères, rôle inconnu) sont ignorées et listées dans le rapport.
Après toute modification de `Code.gs`, redéployez une **nouvelle version** (Déployer > Gérer les déploiements).

Les mots de passe (4 caractères minimum) sont stockés hachés (SHA-256 + sel) dans l'onglet `Comptes`. 5 échecs de connexion bloquent le nom 10 min.
La colonne `version` de `Comptes` est incrémentée à chaque changement de mot de passe, de rôle ou d'activation : les sessions ouvertes de ce compte sont alors fermées (immédiatement depuis le portail ; sous 5 min si l'onglet est modifié à la main).

**Ne mettez jamais le fichier d'import (.csv / .xlsx) dans ce dossier** : il serait publié sur GitHub et téléchargeable sur le site Vercel. `.gitignore` exclut `*.csv` et `*.xlsx` par sécurité.

## 5. Vercel
1. Poussez ce dossier sur un dépôt GitHub (`git init`, `git add .`, `git commit`, `git push`).
2. Sur vercel.com : **Add New > Project**, importez le dépôt. *Framework Preset* : **Other**, aucune commande de build, dossier racine `./`.
3. **Deploy**. Le site est accessible sur `https://<projet>.vercel.app`.

## Comportement du chrono
- Un seul chrono par agent : l'onglet utilisé en dernier prend la main, les autres se mettent en pause.
- Pause automatique après 15 min sans activité (clavier/souris) ; le temps d'inactivité n'est pas compté ; le chrono reprend à la prochaine action.
