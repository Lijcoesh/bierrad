import { themes, type WheelVariant } from "../../shared/variant";
const key = (variant: WheelVariant) => `${themes[variant].storage}.weights.v1`;
/** Weights stay on this device until reset; forced wins are never stored. */
export function loadWeights(
  variant: WheelVariant = "beer",
): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(key(variant)) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, value]) =>
          typeof value === "number" && Number.isFinite(value) && value >= 0,
      ),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}
export function saveWeights(
  weights: Record<string, number>,
  variant: WheelVariant = "beer",
): void {
  try {
    localStorage.setItem(key(variant), JSON.stringify(weights));
  } catch {
    /* Storage is optional; weights then last for this window only. */
  }
}
