import { useEffect, useState } from "react";
import { useTheme } from "../Theme";
import { countdownDigit } from "../domain/presentation";
/** Ticks on its own, so the wheels do not re-render every second. */
export function DrawCountdown({
  startAt,
  offsetMs,
}: {
  startAt: number;
  offsetMs: number;
}) {
  const theme = useTheme();
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + offsetMs), 200);
    return () => window.clearInterval(timer);
  }, [offsetMs]);
  const digit = countdownDigit(startAt - now);
  return (
    <div className="draw-countdown" aria-hidden={digit !== undefined}>
      {digit === undefined ? (
        <p role="status">Het rad gaat zo draaien…</p>
      ) : digit > 0 ? (
        <strong key={digit}>{digit}</strong>
      ) : (
        <strong key="go" className="go">
          {theme.icon}
        </strong>
      )}
    </div>
  );
}
