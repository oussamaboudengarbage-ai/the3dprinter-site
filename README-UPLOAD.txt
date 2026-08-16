THE 3D PRINTER — PROJET COMPLET FINAL

CE DOSSIER EST FAIT POUR REMPLACER LE CONTENU DE TON SITE GITHUB.

STRUCTURE ATTENDUE

index.html
compte.html
admin-commandes.html
merci.html
robots.txt
database.sql
CLOUDFLARE-VARIABLES.txt

functions/
├── api/
│   ├── auth-config.js
│   ├── create-checkout-session.js
│   ├── stripe-webhook.js
│   └── admin-orders.js
├── produits/
│   └── [slug].js
└── sitemap.xml.js

CE QUI EST INCLUS

- catalogue Google Sheets
- couleurs
- images principale + détail
- panier
- paiement Stripe
- thème automatique clair/sombre
- pages produit SEO
- sitemap.xml automatique
- robots.txt
- création de compte Supabase
- connexion/déconnexion
- mot de passe oublié
- compte obligatoire avant paiement
- historique des commandes
- statuts de commande
- page admin des commandes
- numéro/lien de suivi manuel
- webhook Stripe
- ancienne page merci redirigée vers Mon compte

UPLOAD GITHUB

Méthode la plus propre :
1. Sauvegarde ton dépôt actuel en ZIP si tu veux.
2. Dans le dépôt GitHub, remplace les fichiers portant les mêmes noms.
3. Ajoute tous les nouveaux fichiers/dossiers de ce dossier.
4. Tu peux supprimer les anciens fichiers qui ne sont plus utilisés.
5. NE supprime PAS le dossier functions.
6. Vérifie surtout que [slug].js garde bien ses crochets.
7. Commit.
8. Attends le déploiement Cloudflare.

APRÈS LE DÉPLOIEMENT

Teste :
/
 /compte.html
 /admin-commandes.html
 /api/auth-config
 /sitemap.xml
 /robots.txt

Puis ouvre une fiche produit depuis le catalogue.

SUPABASE

Tu as déjà exécuté database.sql : inutile de le relancer si la table orders existe déjà.

Authentication > URL Configuration :
Site URL :
https://the3dprinter3.dpdns.org

Redirect URL :
https://the3dprinter3.dpdns.org/compte.html

STRIPE WEBHOOK

URL :
https://the3dprinter3.dpdns.org/api/stripe-webhook

Événements :
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired

Copie ensuite le signing secret whsec_... dans Cloudflare :
STRIPE_WEBHOOK_SECRET
Type : Secret
