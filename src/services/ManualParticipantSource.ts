import { themes, type WheelVariant } from "../../shared/variant";
import type { ParticipantSource } from "./ParticipantSource";
import type { Participant } from "../domain/models";
import { validateParticipants } from "../utils/participants";

export class ManualParticipantSource implements ParticipantSource {
  private readonly key: string;
  constructor(variant: WheelVariant = "beer") {
    this.key = `${themes[variant].storage}.participants.v1`;
  }
  async getParticipants(): Promise<Participant[]> {
    const raw = localStorage.getItem(this.key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed))
      throw new Error("Ongeldige opgeslagen deelnemers.");
    return validateParticipants(
      parsed.map((entry: unknown) => {
        if (
          typeof entry !== "object" ||
          !entry ||
          !("name" in entry) ||
          typeof entry.name !== "string"
        )
          throw new Error("Ongeldige opgeslagen deelnemers.");
        return {
          id:
            "id" in entry && typeof entry.id === "string"
              ? entry.id
              : crypto.randomUUID(),
          name: entry.name,
        };
      }),
    );
  }

  save(participants: readonly Participant[]) {
    localStorage.setItem(this.key, JSON.stringify(participants));
  }
}
