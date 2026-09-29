import { createContext, useContext } from "react";
import { themes, type WheelVariant } from "../shared/variant";
export const VariantContext = createContext<WheelVariant>("beer");
export function useTheme() {
  const variant = useContext(VariantContext);
  return {
    ...themes[variant],
    variant,
    haler: themes[variant].drink + "haler",
  };
}
