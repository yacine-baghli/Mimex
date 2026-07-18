# GINSE

GINSE transforme une démonstration vidéo en skill Codex, puis Codex peut utiliser ce skill pour reproduire la procédure dans le CRM local de démonstration.

## Démarrage

```powershell
corepack pnpm install
Copy-Item .env.example .env
corepack pnpm build
corepack pnpm dev
```

Renseigner `OPENAI_API_KEY` dans l’environnement avant une compilation réelle. Le CRM est disponible sur `http://localhost:3000`.

Déposer une vidéo dans `fixtures/videos/`, puis demander à Codex d’appeler l’outil MCP `create_skill_from_video`. Pour tester sans appel OpenAI, définir `GINSE_MOCK=1`.

## Commande locale

```powershell
corepack pnpm ginse:compile -- --video fixtures/videos/create-customer.mp4 --goal "Créer une fiche client" --url http://localhost:3000
```

Les skills sont installés dans `.agents/skills/<nom>/SKILL.md`.
