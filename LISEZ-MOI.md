# Alex: Full Gaz ! : mise en ligne

Le dossier contient tout le site :

| Fichier | Rôle |
|---|---|
| `index.html` | Le jeu complet : images, sons, pseudo et classement |
| `config.js` | L'adresse et la clé de ta base Supabase (à remplir) |
| `supabase.sql` | Le script qui crée la table des scores et le classement |
| `icon.png` | L'icône du site (onglet, écran d'accueil du téléphone) |

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

Ouvre l'adresse dans Chrome, puis **⋮ → Ajouter à l'écran d'accueil**. Le jeu s'ouvre alors en plein écran, avec l'icône d'Alex, comme une application.

---

## Comment marchent les scores

- À l'accueil, chaque joueur tape un **pseudo**. Le téléphone ou le navigateur s'en souvient pour les fois suivantes.
- Chaque partie est enregistrée avec son score, les friandises mangées, les monstres éliminés et la durée.
- Le **classement** affiche le meilleur score de chaque pseudo et son nombre de parties. Il est visible depuis l'accueil (« Voir le classement ») et à la fin de chaque partie, avec la position du joueur.
- Les majuscules ne comptent pas : « Alex » et « alex » sont le même joueur.
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
