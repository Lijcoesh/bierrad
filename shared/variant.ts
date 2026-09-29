export type WheelVariant = "beer" | "coffee";
export function isWheelVariant(value: unknown): value is WheelVariant {
  return value === "beer" || value === "coffee";
}
export const themes = {
  beer: {
    name: "Bierrad",
    icon: "🍻",
    winnerIcon: "🍺",
    drink: "bier",
    reaction: "beers",
    storage: "bierrad",
    badge: "Vrijdag begint hier",
    question: "Wie haalt deze week het bier?",
    crew: "vrijdagploeg",
    brigade: "bierbrigade",
    footer: "Met liefde gebrouwen voor de vrijdagmiddag.",
    finale: "DE BIERBRIGADE VAN DEZE WEEK",
  },
  coffee: {
    name: "Koffierad",
    icon: "☕",
    winnerIcon: "☕",
    drink: "koffie",
    reaction: "coffee",
    storage: "koffierad",
    badge: "Tijd voor een koffieronde",
    question: "Wie haalt de volgende koffie?",
    crew: "koffieploeg",
    brigade: "koffiebrigade",
    footer: "Met liefde gemaakt voor de koffiepauze.",
    finale: "DE KOFFIEBRIGADE VAN DEZE RONDE",
  },
} as const;
export function localHash(variant: WheelVariant): string {
  return variant === "coffee" ? "#/coffee" : "#/beer";
}
