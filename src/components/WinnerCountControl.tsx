import { useTheme } from "../Theme";
export function WinnerCountControl({
  count,
  max,
  disabled,
  readOnly,
  onChange,
}: {
  count: number;
  max: number;
  disabled: boolean;
  readOnly: boolean;
  onChange: (count: number) => void;
}) {
  const theme = useTheme();
  return (
    <div className="winner-count-control">
      <span id="winner-count-label">Aantal {theme.haler}s</span>
      <div
        className="count-stepper"
        role="group"
        aria-labelledby="winner-count-label"
      >
        {!readOnly && (
          <button
            type="button"
            aria-label={`Minder ${theme.haler}s`}
            disabled={disabled || count <= 1}
            onClick={() => onChange(count - 1)}
          >
            −
          </button>
        )}
        <output aria-live="polite" aria-label={`Aantal ${theme.haler}s`}>
          {count}
        </output>
        {!readOnly && (
          <button
            type="button"
            aria-label={`Meer ${theme.haler}s`}
            disabled={disabled || count >= max}
            onClick={() => onChange(count + 1)}
          >
            +
          </button>
        )}
      </div>
      <small>
        {max
          ? `Uit ${max} ${max === 1 ? "deelnemer" : "deelnemers"}`
          : `Voeg je ${theme.crew} toe`}
      </small>
    </div>
  );
}
