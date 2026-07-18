# GINSE

GINSE transforme une démonstration vidéo en skill Codex. L’utilisateur dépose sa vidéo dans le site, le serveur en extrait les frames et l’audio, OpenAI analyse ces éléments, puis GINSE génère un `SKILL.md` accompagné d’un manifeste de preuves.

## Prérequis

- Node.js 20 ou supérieur
- Corepack et pnpm
- FFmpeg et FFprobe accessibles dans le terminal
- Une clé API OpenAI

## Démarrage du site complet

```powershell
corepack pnpm install
Copy-Item .env.example .env
corepack pnpm build
corepack pnpm dev
```

Renseigner `OPENAI_API_KEY` dans `.env`, puis ouvrir `http://localhost:3000`. Le bouton **Générer un skill** donne accès à l’écran d’upload.

Le serveur API écoute localement sur `http://127.0.0.1:8787`. Vite transmet automatiquement les requêtes `/api` vers ce serveur.

## Parcours de génération

1. Enregistrer une procédure dans le CRM de démonstration.
2. Ouvrir **Générer un skill** dans la barre latérale.
3. Déposer une vidéo MP4, MOV ou WebM de moins de 200 Mo et 5 minutes.
4. Lancer l’analyse visuelle : OpenAI propose automatiquement l’objectif métier observé.
5. Valider ou corriger cet objectif dans l’interface.
6. Générer le skill fondé sur l’objectif approuvé.
7. Télécharger `SKILL.md` ou cliquer sur **Utiliser avec Codex** pour copier l’invocation du skill déjà installé dans le workspace.

Les skills validés sont également installés dans `.agents/skills/<nom>/SKILL.md`. Le manifeste horodaté se trouve dans `references/evidence.json` à côté du skill.

L’upload vidéo est temporaire et supprimé après traitement. La clé OpenAI reste exclusivement côté serveur.

## Fonctionnement de l’analyse

- FFprobe valide la durée et les pistes de la vidéo.
- FFmpeg extrait au maximum 30 frames et la piste audio.
- L’API de transcription produit un transcript horodaté lorsqu’une narration existe.
- La Responses API analyse les frames et le transcript avec une sortie structurée.
- Le compilateur valide les étapes, les paramètres, la sécurité et les critères de réussite avant d’écrire le skill.

## Test sans consommation OpenAI

Définir temporairement `GINSE_MOCK=1` dans `.env`, puis lancer le site normalement. Ce mode vérifie l’upload, FFmpeg et la génération des fichiers sans analyser réellement le contenu de la vidéo.

## Commande locale alternative

```powershell
corepack pnpm ginse:compile -- --video fixtures/videos/create-customer.mp4 --goal "Créer une fiche client" --url http://localhost:3000
```

## Commandes séparées

```powershell
corepack pnpm dev:crm
corepack pnpm dev:api
corepack pnpm dev:mcp
```
