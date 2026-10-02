import {
  MAX_SCHEDULE_AHEAD_MS,
  SCHEDULE_RETENTION_MS,
} from "../../shared/retention";
import { useState } from "react";
import type { ScheduledDraw, SlackHostStatus } from "../../shared/protocol";
import {
  amsterdamInput,
  nextFridayInput,
  parseAmsterdamInput,
  formatScheduledTime,
} from "../utils/schedule";
const reminderLabels = {
  pending: "📣 De kijklink gaat 2 minuten voor de start in de Slack-thread.",
  posting: "📣 De kijklink wordt in de Slack-thread geplaatst…",
  posted: "✓ De kijklink staat in de Slack-thread.",
  failed: "De kijklink kon niet in Slack worden geplaatst. Deel hem zelf.",
  uncertain:
    "Controleer de Slack-thread: of de kijklink is geplaatst is onzeker. We sturen niet opnieuw om dubbele berichten te voorkomen.",
  skipped: "De kijklink is niet in Slack geplaatst. Deel hem zelf.",
};
export function ScheduleControls({
  plan,
  expiresAt,
  locked,
  clockOffsetMs = 0,
  slack,
  onSave,
}: {
  plan?: ScheduledDraw;
  expiresAt: string;
  locked: boolean;
  clockOffsetMs?: number;
  /** Present only for Slack-linked sessions with working Slack access. */
  slack?: { canShare: boolean; reminder?: SlackHostStatus["reminder"] };
  onSave: (startAt: string | null, shareSpectatorLink: boolean) => Promise<void>;
}) {
  const [share, setShare] = useState(true);
  const [value, setValue] = useState(() =>
    plan
      ? amsterdamInput(Date.parse(plan.startAt))
      : nextFridayInput(Date.now() + clockOffsetMs),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const at = parseAmsterdamInput(value);
  const reminder =
    plan && slack?.reminder?.startAt === plan.startAt
      ? slack.reminder
      : undefined;
  const valid =
    Number.isFinite(at) &&
    at > Date.now() + clockOffsetMs + 2000 &&
    at <= Date.now() + clockOffsetMs + MAX_SCHEDULE_AHEAD_MS;
  const extendsSession =
    valid && at + SCHEDULE_RETENTION_MS > Date.parse(expiresAt);
  const save = async (startAt: string | null) => {
    setBusy(true);
    setError("");
    try {
      await onSave(startAt, !!slack?.canShare && share);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Plannen is niet gelukt.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="schedule-controls" aria-label="Automatisch starten">
      <h3>⏰ Automatisch starten</h3>
      {plan?.status === "refreshing" ? (
        <p role="status">
          Laatste deelnemers ophalen… Daarna gaat het rad draaien.
        </p>
      ) : plan?.status === "pending" ? (
        <>
          <p role="status">
            Ingepland: {formatScheduledTime(plan.startAt)} (Nederlandse tijd).
          </p>
          {reminder && <p role="status">{reminderLabels[reminder.status]}</p>}
          <button disabled={locked || busy} onClick={() => void save(null)}>
            Automatische start uitzetten
          </button>
        </>
      ) : (
        <>
          {plan?.status === "skipped" && (
            <p role="status">
              De automatische start is overgeslagen: ophalen is niet gelukt, het
              rad was niet klaar of de start kwam te laat. Controleer de
              deelnemers en plan opnieuw.
            </p>
          )}
          <label htmlFor="scheduled-start">Datum en tijd · Nederland</label>
          <input
            id="scheduled-start"
            type="datetime-local"
            value={value}
            max={amsterdamInput(
              Date.now() + clockOffsetMs + MAX_SCHEDULE_AHEAD_MS,
            )}
            disabled={locked || busy}
            onChange={(event) => setValue(event.target.value)}
          />
          {!valid && (
            <p className="storage-note">
              Kies een toekomstig tijdstip binnen de komende 30 dagen.
            </p>
          )}
          {extendsSession && (
            <p className="storage-note">
              Bij aanzetten verlengen we deze sessie tot{" "}
              {formatScheduledTime(
                new Date(at + SCHEDULE_RETENTION_MS).toISOString(),
              )}
              : één uur na de start.
            </p>
          )}
          {slack && (
            <>
              <label className="share-toggle">
                <input
                  type="checkbox"
                  checked={slack.canShare && share}
                  disabled={!slack.canShare || locked || busy}
                  onChange={(event) => setShare(event.target.checked)}
                />
                Stuur 2 minuten vooraf de kijklink in de Slack-thread
              </label>
              <p className="storage-note">
                {slack.canShare
                  ? "Iedereen in dat Slack-kanaal kan dan tot het einde van de sessie meekijken."
                  : "Open de volledige hostlink (met kijklink) om de kijklink via Slack te delen."}
              </p>
            </>
          )}
          <button
            disabled={locked || busy || !valid}
            onClick={() => void save(new Date(at).toISOString())}
          >
            Automatische start aanzetten
          </button>
        </>
      )}
      <p className="storage-note">
        Eenmalig voor dit live rad, ook als je dit scherm sluit. Een gekoppeld
        Slack-bericht wordt vlak voor de start nog gecontroleerd; daardoor kan
        het rad iets later starten. Nieuwe sessies blijven standaard 24 uur
        actief; een latere planning verlengt dat tot één uur na de start. Deze
        sessie verloopt nu {formatScheduledTime(expiresAt)}. Handmatig draaien
        of resetten annuleert de planning.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
