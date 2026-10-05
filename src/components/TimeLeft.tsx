import { useEffect, useState } from "react";
import { timeLeftLabel } from "../domain/presentation";
/** " · nog 2:14" until a planned start; ticks on its own, like DrawCountdown. */
export function TimeLeft({
  startAt,
  offsetMs,
}: {
  startAt: number;
  offsetMs: number;
}) {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + offsetMs), 250);
    return () => window.clearInterval(timer);
  }, [offsetMs]);
  const label = timeLeftLabel(startAt - now);
  return label ? (
    <span className="time-left" aria-hidden="true">
      {" "}
      · nog {label}
    </span>
  ) : null;
}
