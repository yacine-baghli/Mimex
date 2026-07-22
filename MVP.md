# Mimex — MVP Netlify

## Promesse

Une personne montre une procédure dans une vidéo courte. Mimex comprend ce qui est fait, fait valider l’objectif, génère un vrai `SKILL.md`, puis permet à Codex de reproduire la procédure avec de nouvelles données.

```text
Vidéo ou enregistrement
        ↓
Objectif proposé par OpenAI
        ↓ validation humaine
SKILL.md stocké sur Netlify
        ↓ téléchargement
Codex reproduit et vérifie l’action
```

## Parcours de démonstration

1. Filmer pendant environ 15 secondes la création d’un client dans le CRM fictif.
2. Déposer la vidéo dans le studio Mimex.
3. Attendre la proposition d’objectif d’OpenAI.
4. Valider ou corriger cet objectif.
5. Générer puis télécharger le fichier `SKILL.md`.
6. Donner le fichier à Codex et lui demander de l’exécuter avec un autre jeu de données.
7. Vérifier que le nouveau client apparaît dans le CRM.

## Périmètre retenu

- site React hébergé sur Netlify ;
- import et enregistrement d’écran ;
- analyse audio + captures par OpenAI ;
- validation humaine avant génération ;
- traitement asynchrone ;
- bibliothèque partagée via Netlify Blobs ;
- amélioration, renommage, suppression et composition de skills ;
- téléchargement et passage à Codex ;
- aucune extension Chrome ;
- aucun compte ou marketplace tiers ;
- aucune facturation, authentification ou base PostgreSQL pour la démo.

## Critère de réussite

Le MVP est réussi si une vidéo de démonstration produit un skill que Codex peut utiliser pour refaire la même tâche avec des valeurs différentes et confirmer visuellement le résultat.

## Sécurité

- conserver `OPENAI_API_KEY` uniquement dans les variables Netlify ;
- utiliser uniquement des données fictives ;
- supprimer les fragments vidéo après génération ;
- ne pas inventer d’étapes absentes de la vidéo ;
- demander les entrées obligatoires avant le replay ;
- arrêter le replay si l’application ne correspond pas à la cible décrite.
