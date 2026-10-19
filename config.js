// Connexion au classement en ligne (Supabase).
// Remplace les deux valeurs ci-dessous par celles de ton projet :
// Supabase > Project Settings > API (ou "Connect").
// Tant qu'elles ne sont pas remplies, le jeu marche quand même
// et garde les scores sur l'appareil du joueur.
//
// Cette clé est publique par nature : elle est faite pour être dans le navigateur.
// Les règles du fichier supabase.sql limitent ce qu'elle permet (lire et ajouter des parties).
// Ne mets JAMAIS ici la clé "service_role" ou "secret".

window.GAME_CONFIG = {
  supabaseUrl: "https://cqcqwmecriwpypwnekzf.supabase.co",
  supabaseKey: "sb_publishable_1Fx2nfJ1fd46LywJ8LXjAQ_EzDE7yyO",

  // Adresse du serveur multijoueur (mode « Bataille »), voir LISEZ-MOI > Multijoueur.
  // Exemple : "wss://full-gaz-multi.onrender.com"
  multiUrl: "wss://full-gaz-multi.onrender.com"
};
