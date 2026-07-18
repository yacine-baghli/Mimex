import type { GeneratedSkillSpec, SkillTarget } from "./schema.js";

export function createMockSkillSpec(goal: string, target: SkillTarget): GeneratedSkillSpec {
  return {
    name: "create-customer",
    description:
      "Créer une fiche client dans GINSE Demo CRM. Utiliser ce skill lorsqu'un utilisateur demande d'ajouter un client avec un nom, une entreprise et une priorité.",
    goal,
    target,
    inputs: [
      {
        key: "customer_name",
        label: "Nom complet",
        description: "Nom complet du client à créer.",
        required: true,
        example: "Ada Lovelace",
        allowedValues: [],
      },
      {
        key: "company_name",
        label: "Entreprise",
        description: "Nom de l'entreprise du client.",
        required: true,
        example: "Analytical Engines",
        allowedValues: [],
      },
      {
        key: "priority",
        label: "Priorité",
        description: "Niveau de priorité de la fiche client.",
        required: true,
        example: "Haute",
        allowedValues: ["Basse", "Normale", "Haute"],
      },
    ],
    steps: [
      {
        id: "step_1",
        title: "Ouvrir le formulaire",
        instruction: "Ouvrir la page Clients puis cliquer sur « Nouveau client ».",
        expectedResult: "Le formulaire « Créer un client » est visible.",
        source: {
          startMs: 0,
          endMs: 2000,
          frameIndex: 1,
          transcriptExcerpt: "Je clique sur Nouveau client.",
        },
        confidence: "high",
        uncertainty: "",
      },
      {
        id: "step_2",
        title: "Renseigner le client",
        instruction:
          "Renseigner Nom complet avec {{customer_name}}, Entreprise avec {{company_name}} et choisir {{priority}} dans Priorité.",
        expectedResult: "Les trois champs affichent les valeurs demandées.",
        source: {
          startMs: 2000,
          endMs: 6000,
          frameIndex: 2,
          transcriptExcerpt: "Je renseigne le nom, l'entreprise et la priorité.",
        },
        confidence: "high",
        uncertainty: "",
      },
      {
        id: "step_3",
        title: "Enregistrer",
        instruction: "Cliquer sur « Enregistrer ».",
        expectedResult: "La notification « Client créé » est visible.",
        source: {
          startMs: 6000,
          endMs: 8000,
          frameIndex: 3,
          transcriptExcerpt: "J'enregistre la fiche.",
        },
        confidence: "high",
        uncertainty: "",
      },
    ],
    successCriteria: [
      "La notification « Client créé » est visible.",
      "La première ligne affiche exactement le nom, l'entreprise et la priorité demandés.",
    ],
    openQuestions: [],
    safetyConcerns: [],
    confidence: 0.96,
    readyToReplay: true,
  };
}
