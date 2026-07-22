# Mimex

Mimex transforme une démonstration vidéo en skill réutilisable par Codex. L’utilisateur importe une vidéo ou enregistre son écran, OpenAI propose l’objectif observé, l’utilisateur le valide, puis Mimex génère un fichier `SKILL.md` téléchargeable.

Le projet est développé par **l’équipe Mimex** pour l’OpenAI Build Hackathon. Il fonctionne de manière autonome sur Netlify, sans marketplace ou compte tiers.

## Fonctionnalités

- import MP4, MOV, WebM ou MKV jusqu’à 200 Mo ;
- enregistrement d’écran directement depuis Chrome ou Edge ;
- upload découpé, adapté aux limites des fonctions serverless ;
- extraction FFmpeg des captures et de la piste audio ;
- transcription et analyse visuelle avec OpenAI ;
- proposition automatique de l’objectif, modifiable et validée par l’utilisateur ;
- génération asynchrone d’un `SKILL.md` ;
- bibliothèque persistante dans Netlify Blobs ;
- téléchargement et instruction prête à copier dans Codex ;
- renommage, suppression et amélioration d’un skill par IA ;
- composition de 2 à 8 skills dans un skill parent ;
- CRM fictif inclus pour réaliser la démonstration de bout en bout.

## Architecture Netlify

```text
Navigateur
  ├─ React + Vite : CRM, recorder, studio, bibliothèque, composition
  ├─ upload vidéo par fragments de 4 Mo
  └─ polling de l’état du traitement
          │
          ▼
Netlify Functions
  ├─ api.mts : uploads, runs, bibliothèque, édition et composition
  └─ process-background.mts : FFmpeg + OpenAI en arrière-plan
          │
          ├─ Netlify Blobs : fragments temporaires + skills persistants
          └─ OpenAI API : transcription, vision et sorties structurées
```

La clé OpenAI n’est jamais exposée au navigateur. Les fragments vidéo sont supprimés après la génération du skill. Les métadonnées et le Markdown restent disponibles dans le store `mimex-runs`.

## Déployer sur Netlify

1. Importer le dépôt GitHub dans Netlify.
2. Laisser Netlify lire [`netlify.toml`](netlify.toml) : la commande et le dossier de publication sont déjà configurés.
3. Ajouter la variable d’environnement obligatoire :

```text
OPENAI_API_KEY=sk-...
```

4. Déployer le site.

Variables facultatives :

```text
OPENAI_VISION_MODEL=gpt-5.4-mini
OPENAI_TRANSCRIBE_MODEL=whisper-1
OPENAI_COMPOSE_MODEL=gpt-5.4-mini
```

Netlify crée automatiquement les stores Blobs lors de la première utilisation. Aucun Postgres, VPS, Stripe ou service d’authentification n’est requis.

> Ne jamais committer une clé API. Si une clé a été publiée dans un chat, une capture ou l’historique Git, la révoquer puis en créer une nouvelle avant le déploiement.

## Développement local

Prérequis : Node.js 20+, Corepack et pnpm.

```powershell
corepack pnpm install
Copy-Item .env.example .env
corepack pnpm dev
```

Renseigner `OPENAI_API_KEY` dans `.env`, puis ouvrir `http://localhost:3000`.

Cette commande utilise l’API locale Fastify pour le parcours vidéo → objectif → skill. Pour tester également Netlify Blobs, les fonctions en arrière-plan, la bibliothèque et la composition avant le déploiement, utiliser Netlify Dev :

```powershell
npx --yes netlify-cli@latest dev --offline
```

## Démonstration recommandée

1. Ouvrir le CRM de démonstration.
2. Enregistrer une vidéo de 15 secondes montrant la création d’un client.
3. Ouvrir **Générer un skill**, importer la vidéo et lancer l’analyse.
4. Corriger si nécessaire l’objectif proposé par OpenAI, puis le valider.
5. Télécharger le `SKILL.md` généré.
6. Cliquer sur **Utiliser avec Codex**, joindre le fichier téléchargé et coller l’instruction copiée.
7. Demander à Codex de reproduire la procédure avec un autre nom, une autre entreprise et une autre priorité.

## Commandes utiles

```powershell
corepack pnpm build:netlify
corepack pnpm typecheck
corepack pnpm test
corepack pnpm mimex:compile -- --video fixtures/videos/create-customer.mp4 --goal "Créer une fiche client" --url http://localhost:3000
```

## Équipe

Mimex est conçu, développé et présenté collectivement par **l’équipe Mimex**. Les choix produit, le parcours de démonstration, l’intégration OpenAI et l’architecture Netlify appartiennent au projet de l’équipe ; la documentation n’attribue pas le produit à une personne unique.

## Licence et données de démonstration

Le CRM utilise uniquement des données fictives. N’envoyez pas de mots de passe, de secrets, de données personnelles réelles ou de procédures sensibles dans les vidéos de démonstration.
