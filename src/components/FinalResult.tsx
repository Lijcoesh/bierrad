import { useTheme } from "../Theme";
import type { Participant } from "../domain/models";
export function FinalResult({
  winners,
  onAgain,
  onSetup,
  canControl,
  disabled,
}: {
  winners: readonly Participant[];
  onAgain: () => void;
  onSetup: () => void;
  canControl: boolean;
  disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <section className="final-result" aria-live="polite">
      <span className="eyebrow">{theme.finale}</span>
      <h2>
        {theme.icon} Het rad heeft gesproken! {theme.icon}
      </h2>
      <ul className="winner-names" aria-label={`De ${theme.haler}s`}>
        {winners.map((winner) => (
          <li key={winner.id}>{winner.name}</li>
        ))}
      </ul>
      <h3>
        {winners.length === 1
          ? `Jij mag ${theme.drink} halen!`
          : `Jullie mogen ${theme.drink} halen!`}
      </h3>
      <p>
        {theme.variant === "coffee"
          ? "De koffiepauze kan beginnen. Maak ons trots."
          : "Het volk heeft dorst. Maak ons trots."}
      </p>
      {canControl && (
        <>
          <button className="primary" disabled={disabled} onClick={onAgain}>
            {theme.icon} Opnieuw draaien
          </button>
          <button className="text-button" disabled={disabled} onClick={onSetup}>
            Deelnemers aanpassen
          </button>
        </>
      )}
    </section>
  );
}
