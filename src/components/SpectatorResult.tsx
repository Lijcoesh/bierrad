import { useTheme } from "../Theme";
import type { Participant } from "../domain/models";
import { joinNames } from "../domain/presentation";
export function SpectatorResult({
  winners,
}: {
  winners: readonly Participant[];
}) {
  const theme = useTheme();
  return (
    <section className="spectator-result">
      <span className="eyebrow">
        {theme.icon} Het rad heeft gesproken!
      </span>
      <p className="spectator-result-names">
        {joinNames(winners.map((winner) => winner.name))}
      </p>
      <p>{winners.length === 1 ? theme.resultOne : theme.resultMany}</p>
    </section>
  );
}
