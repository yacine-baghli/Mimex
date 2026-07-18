# GINSE — MVP Codex : d’une vidéo à une action reproduite

> GINSE apprend une procédure depuis une vidéo, la transforme en skill Codex, puis Codex utilise ce skill pour reproduire la procédure dans un environnement contrôlé.

*Version 3.0 — 18 juillet 2026 — cible : démonstration de hackathon sur Windows, sans extension Chrome.*

---

## 1. Promesse du MVP

L’utilisateur donne à Codex le chemin d’une vidéo montrant une tâche réalisée à l’écran. Le fichier est placé dans le workspace ; Codex transmet son chemin à GINSE sans devoir interpréter lui-même la vidéo. GINSE génère un skill compatible avec Codex. Codex charge ensuite ce skill et reproduit l’action.

> **Vidéo donnée à Codex → analyse par GINSE → génération du `SKILL.md` → exécution par Codex → preuve du résultat.**

Le MVP doit prouver une boucle complète, pas seulement produire une documentation :

1. comprendre une démonstration vidéo ;
2. compiler cette démonstration en skill ;
3. utiliser le skill dans Codex ;
4. reproduire la tâche avec de nouvelles données ;
5. vérifier que le résultat attendu est atteint.

### Question centrale

> **Codex peut-il apprendre une tâche montrée en vidéo grâce à GINSE, puis la refaire correctement à partir du skill généré ?**

---

## 2. Démonstration finale attendue

La démonstration du hackathon doit tenir en moins de cinq minutes.

### Acte 1 — Montrer

L’utilisateur place dans le workspace une vidéo de 1 à 3 minutes puis indique son chemin dans le chat Codex. Si le client Codex accepte et matérialise une pièce jointe vidéo comme fichier local, celle-ci peut être utilisée de la même manière. La vidéo montre une tâche simple et commente idéalement les actions à voix haute.

Exemple recommandé :

> Dans un mini back-office local, créer une fiche client, renseigner son entreprise, choisir une priorité puis sauvegarder.

### Acte 2 — Apprendre

L’utilisateur demande :

```text
Analyse cette vidéo avec GINSE et crée le skill correspondant.
Fichier : fixtures/videos/create-customer.mp4
La tâche devra ensuite être rejouée avec un autre client.
```

Codex appelle GINSE avec le chemin local de la vidéo. GINSE extrait l’audio et les images clés, comprend les étapes puis écrit :

```text
.agents/skills/create-customer/SKILL.md
```

GINSE retourne à Codex le nom du skill, son chemin, son niveau de confiance et les éventuelles questions à résoudre.

### Acte 3 — Reproduire

L’utilisateur fournit de nouvelles valeurs :

```text
Utilise $create-customer pour créer :
- nom : Ada Lovelace
- entreprise : Analytical Engines
- priorité : Haute
```

Codex lit le skill, utilise le navigateur intégré ou Computer Use, réalise les étapes et vérifie le résultat.

### Acte 4 — Prouver

Codex affiche :

- le statut final ;
- une capture du résultat ;
- les valeurs réellement utilisées ;
- les vérifications effectuées ;
- une explication précise en cas d’échec.

La preuve finale de la démo est la nouvelle fiche client visible dans l’application, créée avec des données différentes de celles de la vidéo.

---

## 3. Positionnement de GINSE

GINSE n’est ni un second agent généraliste ni un navigateur automatisé.

GINSE est le **compilateur vidéo → skill** de Codex :

```text
Vidéo + intention + environnement cible
                 |
                 v
              GINSE
                 |
                 v
Skill Codex + preuves + confiance + questions
```

Codex reste l’orchestrateur :

- il reçoit la demande de l’utilisateur ;
- il donne la vidéo à GINSE ;
- il relit le skill produit ;
- il demande les informations manquantes ;
- il choisit l’outil d’exécution autorisé ;
- il reproduit l’action ;
- il vérifie le résultat.

Cette séparation est importante : GINSE apprend, Codex agit.

---

## 4. Architecture retenue

```text
Utilisateur
   |
   | vidéo + objectif dans le chat
   v
Codex Desktop
   |
   | appel MCP : create_skill_from_video(...)
   v
Serveur MCP GINSE local
   |-- validation du fichier vidéo
   |-- FFmpeg : audio + images clés
   |-- transcription horodatée
   |-- compréhension multimodale
   |-- génération structurée du skill
   |-- lint et score de confiance
   `-- écriture dans .agents/skills/<slug>/
              |
              v
        SKILL.md + références
              |
              | lecture / invocation explicite
              v
Codex + Browser ou Computer Use
   |-- exécution avec de nouvelles entrées
   |-- vérification visuelle
   `-- capture et compte rendu final
```

### Pourquoi un serveur MCP local ?

Pour le MVP, un outil MCP est plus simple qu’une application web complète :

- Codex peut appeler GINSE directement ;
- la vidéo reste sur la machine pendant la préparation ;
- le chemin du skill retourné est immédiatement accessible ;
- il n’y a ni authentification produit, ni upload cloud, ni tableau de bord à construire ;
- l’interface de la démonstration est déjà le chat Codex.

GINSE expose une seule capacité au MVP :

```text
create_skill_from_video
```

---

## 5. Contrat MCP de GINSE

### Entrée

```json
{
  "video_path": "C:/demo/create-customer.mp4",
  "goal": "Créer une fiche client dans le back-office de démonstration",
  "target": {
    "kind": "browser",
    "app_name": "GINSE Demo CRM",
    "start_url": "http://localhost:3000/customers"
  },
  "output_dir": ".agents/skills",
  "language": "fr"
}
```

### Sortie

```json
{
  "status": "ready",
  "skill_name": "create-customer",
  "skill_path": ".agents/skills/create-customer/SKILL.md",
  "confidence": 0.91,
  "ready_to_replay": true,
  "open_questions": [],
  "evidence_manifest": ".agents/skills/create-customer/references/evidence.json"
}
```

### États possibles

| État | Signification | Action de Codex |
|---|---|---|
| `ready` | le skill peut être testé | lire puis exécuter le skill |
| `needs_clarification` | une ambiguïté importante subsiste | poser les questions retournées |
| `unsafe` | secret ou action risquée détectée | refuser l’exécution et expliquer |
| `failed` | analyse technique impossible | présenter l’erreur utile |

Le serveur ne doit jamais retourner `ready_to_replay: true` lorsqu’une entrée obligatoire, un critère de succès ou une étape critique reste inconnu.

---

## 6. Pipeline vidéo de GINSE

Les modèles généralistes analysent des images, pas directement un fichier vidéo. GINSE transforme donc la vidéo en sources synchronisées.

| Étape | Traitement | Sortie |
|---|---|---|
| P0 — Validation | type MIME, taille, durée, lisibilité | vidéo acceptée ou erreur claire |
| P1 — Préparation | extraction FFmpeg | audio + métadonnées |
| P2 — Vision | image toutes les 2 secondes + changements de scène | images horodatées et dédupliquées |
| P3 — Audio | transcription avec timecodes | transcript segmenté |
| P4 — Compréhension | alignement images + paroles | actions, champs, valeurs et résultats |
| P5 — Généralisation | séparer les valeurs d’exemple des entrées variables | paramètres du skill |
| P6 — Compilation | génération du `SKILL.md` et des références | dossier de skill temporaire |
| P7 — Lint | structure, sécurité, preuves et cohérence | score + questions + état final |
| P8 — Installation | écriture atomique dans `.agents/skills` | skill détectable par Codex |

### Contraintes vidéo du MVP

- formats : `mp4`, `mov`, `webm` ;
- durée maximale : 5 minutes ;
- taille maximale : 200 Mo ;
- maximum : 120 images envoyées au modèle ;
- une seule tâche par vidéo ;
- une seule application cible ;
- narration recommandée mais non obligatoire.

---

## 7. Format du skill généré

Le livrable principal est un vrai skill Codex, pas seulement un JSON métier.

```text
.agents/skills/create-customer/
├─ SKILL.md
└─ references/
   └─ evidence.json
```

### Exemple de `SKILL.md`

```md
---
name: create-customer
description: Créer une fiche client dans GINSE Demo CRM. À utiliser lorsque l’utilisateur demande d’ajouter un client avec un nom, une entreprise et une priorité.
---

# Créer un client

## Outil requis

Utiliser le navigateur intégré sur `http://localhost:3000/customers`.

## Entrées

- `customer_name` : obligatoire
- `company_name` : obligatoire
- `priority` : obligatoire, parmi Basse, Normale, Haute

## Procédure

1. Ouvrir la page Clients.
2. Cliquer sur « Nouveau client ».
3. Renseigner le nom avec `customer_name`.
4. Renseigner l’entreprise avec `company_name`.
5. Choisir `priority` dans la liste Priorité.
6. Cliquer sur « Enregistrer ».

## Vérifications

- Une confirmation « Client créé » est visible.
- La nouvelle fiche affiche exactement le nom, l’entreprise et la priorité demandés.

## Sécurité

- Ne jamais inventer une entrée absente.
- Demander confirmation avant toute action irréversible.
- Arrêter l’exécution si le domaine ou l’application ne correspond pas à la cible.

## En cas d’échec

Prendre une capture, décrire l’étape bloquée et ne pas poursuivre à l’aveugle.
```

### Références de preuve

`references/evidence.json` relie chaque instruction au passage de la vidéo :

```json
{
  "video": "create-customer.mp4",
  "steps": [
    {
      "instruction": 2,
      "start_ms": 8200,
      "end_ms": 13100,
      "frame": "00-00-10.jpg",
      "transcript_excerpt": "Je clique sur Nouveau client",
      "confidence": "high"
    }
  ]
}
```

Les images de preuve restent temporaires et ne sont pas nécessaires à l’exécution normale du skill.

---

## 8. Chargement et utilisation par Codex

GINSE écrit le skill dans :

```text
<workspace>/.agents/skills/<skill-name>/SKILL.md
```

Codex peut ensuite le sélectionner explicitement avec `$skill-name` ou le choisir lorsque la demande correspond à sa description.

### Stratégie robuste pour la démonstration

Pour éviter de dépendre uniquement du rafraîchissement automatique des skills pendant la présentation :

1. GINSE retourne le chemin exact du fichier ;
2. Codex lit immédiatement le `SKILL.md` retourné ;
3. Codex vérifie que les entrées et critères de réussite sont complets ;
4. Codex exécute le workflow en suivant ce fichier ;
5. le skill reste installé pour les prochaines invocations avec `$skill-name`.

Ainsi, la première exécution fonctionne dans le même échange et les exécutions suivantes bénéficient de la découverte native des skills.

---

## 9. Reproduction de l’action

### Outil privilégié

- Application web locale : navigateur intégré de Codex.
- Application desktop : Computer Use.
- Intégration structurée disponible : outil MCP dédié, si le skill l’exige.

Aucune extension Chrome n’est nécessaire.

### Environnement de démonstration

La démo utilise une petite application locale contrôlée, avec :

- données fictives ;
- état réinitialisable ;
- interface stable ;
- aucune authentification ;
- aucune donnée personnelle ;
- aucune action financière ou externe ;
- confirmation visuelle facile à vérifier.

Le scénario recommandé est la création d’un client dans un CRM factice. Il montre les capacités importantes sans rendre la démo fragile : navigation, clics, saisie, sélection, paramétrisation et vérification.

### Préparation de Codex pour la démo

- Installer et activer le plugin Browser dans Codex Desktop.
- Autoriser `http://localhost:3000` pour la session de démonstration.
- Lancer Codex depuis la racine du workspace afin qu’il découvre `.agents/skills`.
- Configurer le serveur MCP GINSE dans le projet.
- Placer la vidéo dans `fixtures/videos/`.
- Démarrer le mini CRM et réinitialiser ses données avant le pitch.

Le navigateur intégré est privilégié pour cette démo web locale. Computer Use reste la solution pour un futur scénario impliquant une application desktop.

### Boucle d’exécution de Codex

```text
Lire le skill
      |
Valider les entrées
      |
Ouvrir l’application autorisée
      |
Exécuter une étape
      |
Observer le résultat
      |
Étape suivante ou arrêt explicite
      |
Vérifier les critères de succès
      |
Produire la preuve finale
```

Codex ne doit pas continuer si l’interface observée contredit le skill.

---

## 10. Périmètre strict

### Inclus

- Réception d’un chemin de vidéo accessible depuis le workspace Codex.
- Appel du serveur MCP GINSE par Codex.
- Analyse audio + images clés.
- Génération d’un skill dans `.agents/skills`.
- Détection des variables utilisées pendant le replay.
- Une clarification courte si une information critique manque.
- Invocation du skill par Codex.
- Reproduction dans une application locale contrôlée.
- Vérification visuelle et capture finale.
- Conservation du skill pour une seconde exécution.

### Hors périmètre

- Extension Chrome.
- Upload cloud et application SaaS GINSE.
- Exécution fiable sur n’importe quel site Internet.
- Comptes réels, login, mots de passe ou 2FA.
- Capture du DOM pendant la vidéo d’origine.
- Sélecteurs CSS générés depuis la vidéo.
- Planification, batch, partage d’équipe et marketplace.
- Auto-correction illimitée après changement important d’interface.
- Actions sensibles : achat, suppression, envoi public ou modification de droits.

---

## 11. Critères de sécurité

- Codex demande l’autorisation avant de contrôler une application ou un domaine non autorisé.
- Le skill indique explicitement l’application ou l’URL cible.
- GINSE refuse une vidéo montrant visiblement un mot de passe ou une donnée sensible.
- Aucune valeur secrète n’est écrite dans `SKILL.md`.
- Les actions irréversibles sont interdites dans la démo.
- L’exécution s’arrête si les données demandées sont incomplètes.
- L’exécution s’arrête si la cible ne correspond pas à celle du skill.
- Les images clés et l’audio sont supprimés après compilation, sauf mode debug explicite.
- Le rapport final distingue ce qui a été observé de ce qui a seulement été tenté.

---

## 12. Stack minimale

| Couche | Choix | Rôle |
|---|---|---|
| Orchestrateur | Codex Desktop | reçoit la vidéo, appelle GINSE et exécute le skill |
| Interface GINSE | serveur MCP TypeScript | expose `create_skill_from_video` |
| Vidéo | FFmpeg | extrait audio, frames et timecodes |
| Transcription | modèle de transcription OpenAI | transforme la narration en segments horodatés |
| Compréhension | OpenAI Responses API | analyse images + transcript |
| Sortie | Structured Outputs + Zod | garantit la structure intermédiaire |
| Skill | Markdown + références JSON | format consommé par Codex |
| Exécution | Browser / Computer Use | reproduit visuellement l’action |
| Cible de démo | mini CRM Next.js local | environnement déterministe et réinitialisable |

### Organisation du dépôt

```text
ginse/
├─ apps/
│  └─ demo-crm/                    # application locale de démonstration
├─ packages/
│  ├─ ginse-mcp/                   # serveur MCP et outil public
│  ├─ video-pipeline/              # FFmpeg, frames, audio et timecodes
│  ├─ skill-compiler/              # prompts, schéma, lint et rendu SKILL.md
│  └─ shared/                      # types, erreurs et logs
├─ .agents/
│  └─ skills/                      # skills générés pendant la démo
└─ fixtures/
   └─ videos/                      # vidéos de démonstration sans données sensibles
```

Pas de base de données au MVP. Les résultats sont des fichiers locaux versionnables.

---

## 13. Plan de construction — 7 jours

| Jour | Livrable démontrable |
|---|---|
| J1 | mini CRM local avec scénario de création et bouton de reset |
| J2 | serveur MCP GINSE avec contrat d’entrée/sortie et faux skill |
| J3 | extraction FFmpeg de l’audio et des images clés |
| J4 | transcription, analyse multimodale et représentation structurée |
| J5 | génération de `SKILL.md`, références, lint et questions |
| J6 | boucle Codex → GINSE → skill → Browser/Computer Use → preuve |
| J7 | 10 répétitions, réduction de la latence, sécurisation et répétition du pitch |

### Ordre non négociable

1. faire fonctionner l’exécution Codex avec un skill écrit manuellement ;
2. faire générer exactement ce même format par GINSE ;
3. brancher la vidéo réelle ;
4. améliorer la compréhension ;
5. seulement ensuite améliorer l’interface de démonstration.

Ce chemin réduit le principal risque : découvrir trop tard que le skill généré est lisible mais inexécutable.

---

## 14. Tests d’acceptation

Le MVP est prêt uniquement si ces tests passent :

1. Codex peut appeler `create_skill_from_video` avec un fichier local.
2. Une vidéo valide génère un dossier de skill conforme.
3. Le `SKILL.md` contient un nom et une description valides.
4. Les valeurs montrées dans la vidéo deviennent des exemples, pas des constantes.
5. Les entrées nécessaires au replay sont explicitement listées.
6. Chaque étape importante possède une preuve temporelle.
7. Une ambiguïté critique bloque le replay et produit une question.
8. Codex peut lire le skill dans le même échange.
9. Codex reproduit la tâche avec des valeurs différentes.
10. Les critères de succès sont vérifiés visuellement.
11. Une seconde exécution peut invoquer `$skill-name` sans régénérer le skill.
12. Une interface inattendue provoque un arrêt propre, pas des clics au hasard.
13. La démo complète dure moins de cinq minutes.

---

## 15. Métriques de succès

| Métrique | Objectif MVP |
|---|---|
| vidéo → skill prêt | moins de 90 secondes pour une vidéo de 3 minutes |
| étapes principales correctement extraites | ≥ 80 % |
| variables correctement généralisées | 100 % sur le scénario de démo |
| replay réussi sans correction du fichier | ≥ 8 essais sur 10 |
| faux succès annoncé | 0 |
| durée totale de la démonstration | < 5 minutes |

La métrique principale devient :

> **Pourcentage de vidéos dont le skill généré permet à Codex de réussir le replay avec de nouvelles données.**

---

## 16. Risques et parades

| Risque | Parade MVP |
|---|---|
| La vidéo ne montre pas précisément les clics | narration recommandée, images rapprochées et questions de clarification |
| Le skill décrit bien mais ne s’exécute pas | commencer par un skill manuel validé par Codex avant de construire le compilateur |
| Codex ne rafraîchit pas immédiatement la liste des skills | retourner le chemin et faire lire directement `SKILL.md` lors du premier replay |
| Computer Use clique sur une mauvaise cible | cible locale stable, observation après chaque étape et arrêt en cas d’écart |
| La démo dépend d’un service externe | application locale, données fictives et état réinitialisable |
| L’analyse prend trop de temps | vidéo courte, maximum 120 frames, progression visible dans le chat |
| Une valeur d’exemple est figée dans le skill | passe dédiée de généralisation + test avec un second jeu de données |
| Un secret apparaît dans la vidéo | détection, refus de compiler et jeu de données synthétique obligatoire pour la démo |

---

## 17. Ce qui vient après

Après validation de la boucle complète :

- interface web GINSE pour les utilisateurs qui n’emploient pas Codex ;
- plusieurs vidéos pour améliorer un même skill ;
- édition visuelle avant installation ;
- skills multi-applications ;
- packaging des skills dans un plugin partageable ;
- exécution sur des outils réels avec authentification contrôlée ;
- comparaison de plusieurs replays et amélioration guidée du skill.

L’extension Chrome ne revient que si les tests montrent que la vidéo et Computer Use ne suffisent pas.

---

## 18. Décision produit finale

Le MVP complet est désormais :

> **L’utilisateur montre une tâche en vidéo à Codex. Codex confie la vidéo à GINSE. GINSE fabrique le skill. Codex utilise ce skill pour refaire la tâche avec de nouvelles données et en apporte la preuve.**

La génération du fichier n’est donc plus le résultat final. Le résultat final est un **replay réussi et vérifié par Codex**.
