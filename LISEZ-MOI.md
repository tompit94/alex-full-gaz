# Full Gaz ! : mise en ligne

Le dossier contient tout le site :

| Fichier | Rôle |
|---|---|
| `index.html` | Le jeu complet : images, sons, pseudo et classement |
| `config.js` | L'adresse et la clé de ta base Supabase (à remplir) |
| `supabase.sql` | Le script qui crée la table des scores et le classement |
| `icon.png` | L'icône du site (onglet, écran d'accueil du téléphone) |
| `mp/img/` | Les poses à l'arbalète du mode multijoueur |
| `server/` | Le serveur du mode multijoueur (à héberger à part, voir plus bas) |
| `render.yaml` | La configuration toute prête pour héberger ce serveur sur Render |

Il faut environ 15 minutes, avec deux comptes gratuits : **Supabase** pour la base des scores et **Netlify** pour l'hébergement.

---

## 1. Créer la base des scores (Supabase)

1. Va sur https://supabase.com et crée un compte (bouton « Start your project », tu peux te connecter avec GitHub).
2. Clique sur **New project** :
   - Name : `alex-full-gaz`
   - Database password : clique sur « Generate a password » (tu n'en auras pas besoin ensuite)
   - Region : **Central EU (Frankfurt)** ou **West EU (Paris)**, au plus près de tes joueurs
   - Puis **Create new project**, et attends environ une minute.
3. Dans le menu de gauche, ouvre **SQL Editor**, puis **New query**.
4. Copie tout le contenu de `supabase.sql`, colle-le et clique sur **Run**. Le message « Success. No rows returned » doit s'afficher.
5. Récupère tes deux valeurs de connexion : bouton **Connect** en haut de la page (ou **Project Settings → API Keys / Data API**) :
   - **Project URL**, par exemple `https://abcdefgh.supabase.co`
   - la clé **publishable** (`sb_publishable_…`) ou, sur un ancien projet, la clé **anon public** (elle commence par `eyJ…`)

> ⚠️ Ne prends jamais la clé `secret` ou `service_role`. Elle donne tous les droits sur la base.

## 2. Brancher le jeu sur la base

Ouvre `config.js` avec un éditeur de texte et remplace les deux valeurs :

```js
window.GAME_CONFIG = {
  supabaseUrl: "https://abcdefgh.supabase.co",
  supabaseKey: "sb_publishable_xxxxxxxxxxxxxxxx"
};
```

Enregistre le fichier.

## 3. Mettre le site en ligne (Netlify)

**Méthode la plus simple (glisser-déposer)**

1. Va sur https://app.netlify.com/drop et crée un compte.
2. Glisse **le dossier `alex-full-gaz` entier** dans la zone de dépôt.
3. Après quelques secondes, ton site est en ligne avec une adresse du type `https://nom-au-hasard.netlify.app`.
4. Pour choisir un nom : **Site configuration → Change site name**, par exemple `alex-full-gaz` pour obtenir `https://alex-full-gaz.netlify.app`.

**Pour mettre à jour le jeu plus tard :** dans ton site sur Netlify, onglet **Deploys**, glisse à nouveau le dossier dans la zone « Drag and drop your site output folder here ».

**Si tu préfères GitHub :** pousse le dossier dans un dépôt, puis dans Netlify fais **Add new site → Import an existing project**. Chaque `git push` mettra alors le site à jour tout seul. GitHub Pages fonctionne aussi (Settings → Pages → branche `main`).

## 4. Jouer sur téléphone

Ouvre l'adresse dans Chrome, puis **⋮ → Ajouter à l'écran d'accueil**. Le jeu s'ouvre alors en plein écran, avec l'icône du héros, comme une application.

---

## Comment marchent les scores

- À l'accueil, chaque joueur tape un **pseudo**. Le téléphone ou le navigateur s'en souvient pour les fois suivantes.
- Chaque partie est enregistrée avec son score, les friandises mangées, les monstres éliminés et la durée.
- Le **classement** affiche le meilleur score de chaque pseudo, le petit portrait du perso avec lequel il l'a fait, et son nombre de parties. Il est visible depuis l'accueil (« Voir le classement ») et à la fin de chaque partie, avec la position du joueur.
- Le portrait du perso demande la colonne `perso` : relance `supabase.sql` en entier dans Supabase (SQL Editor → Run), c'est sans risque pour les scores existants. Les parties jouées avant n'ont pas de portrait.
- Les majuscules ne comptent pas : « Turbo » et « turbo » sont le même joueur.
- Tant que `config.js` n'est pas rempli, le jeu marche quand même et garde les scores **sur l'appareil** uniquement.

**Protections en place**

- Le jeu peut seulement **ajouter** des parties : impossible de modifier ou d'effacer un score depuis un navigateur.
- La base refuse les scores impossibles (plus de 300 points par seconde de jeu, ou plus de 100 000 points) et les pseudos de moins de 2 ou plus de 16 caractères.
- Avec un pseudo seul, il n'y a pas de mot de passe : n'importe qui peut jouer sous le pseudo d'un autre. Pour effacer un score suspect, va dans Supabase → **SQL Editor** et lance :

  ```sql
  delete from public.scores where pseudo_key = 'pseudo-en-minuscules';
  ```

- Tu peux voir toutes les parties dans Supabase → **Table Editor → scores**.

**Bon à savoir sur l'offre gratuite de Supabase :** un projet sans aucune activité pendant 7 jours est mis en pause. Il suffit de le relancer d'un clic depuis le tableau de bord Supabase, et les scores sont conservés.

---

## Mode multijoueur

Bouton **Multijoueur** du menu, puis choix du mode :

- **⚔️ Chacun pour soi** : bataille à l'arbalète, tous contre tous, sans monstres (détails juste en dessous).
- **🤝 Coopération** : tous ensemble contre des vagues de monstres (voir « Mode Coopération » plus bas).

Une salle garde le mode choisi par celui qui l'a créée : si tu rejoins une salle existante, tu joues dans son mode (la liste des salles l'affiche).

### Salles

- **Créer une salle** : tape le code de ton choix (8 lettres ou chiffres max) puis **Rejoindre**, ou appuie sur **Créer une salle** pour un code inventé au hasard. Autant de salles que tu veux en même temps, 10 joueurs max chacune.
- **Salles publiques** : la liste montre chaque salle avec son mode, l'état de la partie (en attente, manche 2 en cours, vague 4 en cours, podium…), les pseudos des joueurs et le nombre de places. Clique sur une salle pour la rejoindre.
- **Salle privée** : coche « Salle privée » avant de créer la salle. Elle n'apparaît pas dans la liste : on y entre avec le code ou le lien d'invitation.
- **Inviter des potes** : en jeu, ouvre le menu (Échap, ou le bouton II sur téléphone) puis **Inviter des potes**. Le lien est copié (ou partagé directement sur téléphone). Il ouvre le jeu dans la bonne salle ; un nouveau joueur choisit juste son pseudo avant.
- Une salle disparaît quand le dernier joueur part.

### Chacun pour soi

Jusqu'à **10 joueurs** dans la même salle, sur la même carte, sans monstres. Chacun se bat à l'arbalète.

- **Manches** : dès qu'il y a 2 joueurs, compte à rebours de 4 s, puis manche de 3 min. Le plus de K.O. gagne, ou le premier à 15. Podium pendant 10 s, puis nouvelle manche (scores remis à zéro).
- **Super-pâtisseries dorées** (2 max sur la carte) : *Éclair foudroyant* = tir rapide 7 s, *Glace triple boule* = 3 carreaux en éventail 7 s, *Donut bouclier* = invulnérable 6 s.
- **Pouvoir du perso** : chaque K.O. remplit la jauge, à 3 K.O. le pouvoir est prêt (touche **E** ou bouton POUVOIR) et dure 6 s :
  - Alex (voiture) et Nini (Vespa) : très rapides, renversent au contact, pas de tir, insensibles au prout ;
  - Greg (machette), Arthur (gode), Gargar (Opinel), Mike (baguette), Tommy (ventouse), Dodo (bâton serpent), Yonarie (tournevis) : plus rapides, K.O. en un coup au contact ; Yonarie crie « Quoiiiiiiiii !? » et étourdit autour d'elle ;
  - Mihide (bouclier) : invulnérable, renvoie les carreaux à l'envoyeur.
- Réglages dans `server/server.js` (objets `ROUND`, `POW` et `SUPER`).

**Règles**

- 3 carreaux encaissés = K.O. Tu reviens 3 secondes plus tard, avec un bouclier de 2 secondes (il saute dès que tu tires).
- Les friandises redonnent un cœur et remplissent la jauge. Le **prout** étourdit les adversaires autour de toi.
- Le **café** donne un coup de boost et un **caca piégé** : l'adversaire qui marche dedans perd un cœur.
- Le tableau en haut à droite classe les joueurs par K.O. Le 1er porte la 👑.
- **Classement complet** en cours de partie : maintiens **Alt Gr** (ordinateur) ou touche le bouton **🏆** en haut à droite (téléphone). Marche aussi en coopération.
- On rejoint une salle avec un **code** (par défaut `GAZ`, ou `COOP` en coopération). Donne le même code à tes potes pour être ensemble. Une salle pleine refuse le 11e joueur.

### Mode Coopération

De 1 à **10 joueurs** ensemble contre les monstres du mode solo (et le croqueur de pomme).

- **Vagues** : compte à rebours de 4 s, puis vague 1. Une vague est finie quand tous ses monstres sont éliminés : 6 s de pause, les joueurs K.O. reviennent, puis vague suivante, plus grosse et un peu plus rapide. Le nombre de monstres grandit avec le nombre de joueurs.
- **Le croqueur de pomme** (boss avec une barre de vie) arrive toutes les 3 vagues.
- **Pas de tir ami** : carreaux, prouts, cacas et pouvoirs ne touchent que les monstres. Un carreau enlève 1 point de vie (2 ou 3 selon le monstre), un caca élimine le monstre qui marche dedans, le prout les étourdit.
- **Morsure** = -1 cœur. K.O., tu reviens 6 s plus tard.
- **Défaite** : si toute l'équipe est K.O. en même temps. Podium des meilleurs chasseurs (monstres éliminés), puis nouvelle partie au bout de 10 s.
- **Pouvoir du perso** : 5 monstres éliminés remplissent la jauge.
- **Prix de l'équipe** : toutes les **5 vagues** nettoyées, l'équipe gagne un prix avec un message de félicitations (échelle de 30 prix, de « La Miette d'Or » au « Graal Full Gaz ! »). Le dernier prix gagné est rappelé dans le classement et sur le podium. Liste et fréquence dans `index.html` (`PRIZES` et `PRIZE_EVERY`).
- Réglages dans `server/server.js` (objets `COOP` et `MON`).

**Commandes**

- Ordinateur : ZQSD ou flèches pour courir, souris pour viser, clic pour tirer, Espace pour le prout, C pour le caca, E pour le pouvoir, Alt Gr (maintenu) pour le classement.
- Téléphone : doigt à gauche pour courir, doigt à droite pour viser et tirer, bouton **TIR** pour le tir automatique sur l'adversaire le plus proche.

### Pourquoi un serveur à part ?

GitHub Pages et Netlify ne servent que des fichiers. Pour que 10 personnes jouent en direct, il faut un petit programme qui tourne en permanence et relaie les positions et les tirs. C'est le dossier `server/`. Supabase reste utilisé pour le classement du mode solo.

### Héberger le serveur sur Render (gratuit, environ 10 minutes)

1. Va sur https://render.com et crée un compte avec **GitHub**.
2. Clique sur **New → Blueprint**, choisis le dépôt `alex-full-gaz`, puis **Apply**. Render lit `render.yaml` et crée le service `full-gaz-multi`.
3. Attends la fin du déploiement (2 à 3 minutes). Render affiche l'adresse du service, par exemple `https://full-gaz-multi.onrender.com`.
4. Ouvre cette adresse dans ton navigateur : le message « Full Gaz ! serveur multijoueur OK » doit s'afficher.
5. Dans `config.js`, mets cette adresse en remplaçant `https://` par `wss://` :

   ```js
   multiUrl: "wss://full-gaz-multi.onrender.com"
   ```

6. Pousse la modification sur GitHub (et sur Netlify si tu l'utilises). Le bouton **Multijoueur** du menu marche alors.

**Bon à savoir sur l'offre gratuite de Render**

- Le serveur s'endort après 15 minutes sans joueur. Le premier qui lance une bataille le réveille, ce qui prend environ une minute : le jeu affiche « Le serveur se réveille… » et se connecte tout seul ensuite.
- Les scores de bataille vivent dans la salle et repartent à zéro quand elle se vide ou que le serveur redémarre.

### Tester chez toi

```bash
cd server
npm install
npm start                      # serveur sur le port 8080
ROUND_TIME=30 npm start        # (test) manches de 30 s au lieu de 3 min
TEST_SUPER=1 npm start         # (test) jauge de pouvoir toujours pleine
node bots.js 4                 # (optionnel) 4 robots qui se battent dans la salle GAZ
node bots.js 2 COOP ws://localhost:8080 coop   # (optionnel) 2 robots qui chassent les monstres dans la salle COOP
COOP_WAVE=3 npm start          # (test) la coopération commence directement à la vague 3 (boss)
```

Puis ouvre le jeu depuis `http://localhost` (par exemple `npx serve .` à la racine) avec l'adresse `index.html?server=ws://localhost:8080` (sinon le jeu se branche sur le serveur indiqué dans `config.js`).

### Si tu modifies la carte

Le serveur a sa propre copie des obstacles dans `server/world.js`, pour savoir où les carreaux s'arrêtent. Si tu changes la carte dans `index.html` (fonction `buildWorld`), reporte la modification dans ce fichier.
