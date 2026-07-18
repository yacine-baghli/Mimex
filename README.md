# GINSE — Video to Codex Skill

GINSE transforme une démonstration vidéo commentée en skill Codex téléchargeable.

## Tester comme le jury

Ouvrir : **https://mimex-demo-crm.netlify.app**

1. Déposer une vidéo WebM ou MP4 avec narration audio.
2. La vidéo doit durer 90 secondes maximum et peser moins de 50 Mo.
3. Ajouter éventuellement l'objectif, le nom de l'application et son URL.
4. Cliquer sur **Compiler en skill Codex**.
5. Télécharger le ZIP retourné.
6. Décompresser son dossier sous `<workspace>/.agents/skills/`.
7. Dans Codex, invoquer le skill avec `$nom-du-skill`.

Le navigateur extrait localement des images et une piste audio compressée. La Function Netlify transcrit la narration, analyse les images, valide la structure et renvoie :

```text
<skill-name>/
├── SKILL.md
├── agents/
│   └── openai.yaml
└── references/
    └── evidence.json
```

## Développement local

Prérequis : Node.js, pnpm et une clé OpenAI.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm build
npx netlify dev
```

Configurer `OPENAI_API_KEY` dans `.env` pour le développement. En production, la définir comme secret Netlify limité aux Functions. Ne jamais l'ajouter au dépôt ou au frontend.

## Pipeline

```text
Vidéo dans le navigateur
  → 12 images JPEG + narration WAV 8 kHz
  → POST /api/compile
  → transcription horodatée
  → analyse multimodale structurée
  → lint de sécurité et de complétude
  → ZIP de skill Codex
```

La vidéo brute ne quitte pas le navigateur. Les données préparées ne sont pas stockées par l'application.

## Développement du compilateur local historique

Le serveur MCP et la CLI restent disponibles :

```sh
pnpm dev:mcp
pnpm ginse:compile -- --video fixtures/videos/demo.webm --goal "Décrire le workflow"
```
