import { themes, type WheelVariant } from "../../shared/variant";
export interface WinnerCountPreference {
  load(): number;
  save(count: number): void;
}

export class LocalWinnerCountPreference implements WinnerCountPreference {
  private readonly key: string;
  constructor(variant: WheelVariant = "beer") {
    this.key = `${themes[variant].storage}.winnerCount.v1`;
  }
  load(): number {
    const raw = localStorage.getItem(this.key);
    const value = raw === null ? 2 : Number(raw);
    return Number.isSafeInteger(value) && value >= 1 ? value : 2;
  }
  save(count: number): void {
    localStorage.setItem(this.key, String(count));
  }
}
