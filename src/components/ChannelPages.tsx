import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_ROUND_MINUTES,
  MAX_ROUND_MINUTES,
  ROUND_MINUTE_CHOICES,
  parseChannelInput,
  type ChannelCommand,
  type ChannelStatus,
} from "../../shared/channel";
import {
  channelBindUrl,
  channelLink,
  channelRequest,
  type ChannelBindFailure,
} from "../sessions/ChannelClient";
import { configuredApiUrl } from "../sessions/liveNavigation";

const clock = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
});
function useCoffeePage(title: string) {
  useEffect(() => {
    document.documentElement.dataset.variant = "coffee";
    document.title = title;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = "./coffee-icon.svg";
  }, [title]);
}
const bindFailures: Record<ChannelBindFailure, string> = {
  denied: "Inloggen bij Slack is geannuleerd.",
  forbidden:
    "Alleen volwaardige leden van de workspace kunnen een Koffierad koppelen. Gasten en externe gebruikers kunnen wel meedoen.",
  expired:
    "Het inloggen duurde te lang of is in een ander tabblad gestart. Probeer opnieuw.",
  unavailable: "Slack is nu niet bereikbaar of het Koffierad is nog niet ingesteld.",
  busy: "Even rustig aan. Probeer over een minuut opnieuw.",
  not_in_channel:
    "Het Koffierad kon niet in dit kanaal posten. Nodig eerst de bot uit met /invite @Koffierad en probeer opnieuw.",
};

/** Bind a Koffierad to a Slack channel: Sign in with Slack, then a test post. */
export function ChannelBindPage({ failure }: { failure?: ChannelBindFailure }) {
  useCoffeePage("Koffierad koppelen");
  const api = configuredApiUrl();
  const [input, setInput] = useState("");
  const channel = parseChannelInput(input);
  return (
    <div className="unavailable channel-page">
      <h1>☕ Koffierad aan een kanaal koppelen</h1>
      <ol className="channel-steps">
        <li>
          Nodig de Koffierad-bot uit in het kanaal: typ daar{" "}
          <code>/invite @Koffierad</code>.
        </li>
        <li>
          Kopieer de link van het kanaal (rechtsklik op de kanaalnaam →{" "}
          <em>Kopiëren</em> → <em>Link kopiëren</em>) en plak hem hieronder.
        </li>
        <li>Log in met Slack. Het Koffierad plaatst dan een bevestiging in het kanaal.</li>
      </ol>
      {failure && <p role="alert">{bindFailures[failure]}</p>}
      {api ? (
        <form
          className="channel-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (channel) location.assign(channelBindUrl(api, channel));
          }}
        >
          <label htmlFor="channel-link">Kanaallink</label>
          <input
            id="channel-link"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://jouwbedrijf.slack.com/archives/C…"
            autoComplete="off"
            spellCheck={false}
          />
          {input && !channel && (
            <small role="status">Dit lijkt geen link naar een Slack-kanaal.</small>
          )}
          <button className="primary" type="submit" disabled={!channel}>
            Log in en koppel ☕
          </button>
        </form>
      ) : (
        <p>Koppelen is hier nog niet ingesteld.</p>
      )}
      <p className="helper">
        Iedere afdeling kan een eigen kanaal koppelen. Wie de aanvraaglink heeft
        of <code>/koffierad</code> typt in het kanaal, kan een koffieronde starten.
      </p>
      <p>
        <a href="#/coffee">Liever handmatig draaien</a>
      </p>
    </div>
  );
}

/** Request a round (everyone with the link) and, for admins, manage the binding. */
export function ChannelWheelPage({
  capability,
  requestCapability,
}: {
  capability: string;
  requestCapability?: string;
}) {
  useCoffeePage("Koffierad");
  const api = configuredApiUrl();
  const [status, setStatus] = useState<ChannelStatus>();
  const [minutes, setMinutes] = useState<number>();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [gone, setGone] = useState(false);
  const run = useCallback(
    async (command?: ChannelCommand) => {
      if (!api) return;
      const result = await channelRequest(api, capability, command);
      if (result.type === "unbound") {
        setGone(true);
        return result;
      }
      setStatus(result.status);
      return result;
    },
    [api, capability],
  );
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void run().catch((error: Error) => {
        if (!active) return;
        setNotice(error.message);
        if ((error as { code?: string }).code === "unavailable") setGone(true);
      });
    refresh();
    const timer = setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [run]);
  async function act(command: ChannelCommand, done?: string) {
    setPending(true);
    setNotice("");
    try {
      const result = await run(command);
      if (command.type === "requestRound" && result?.type === "status") {
        const round = result.status.round;
        if (round) location.hash = `/live/${round.spectatorCapability}`;
      }
      if (result?.type === "rotated")
        location.replace(
          `#/koffie-beheer/${capability}/${result.requestCapability}`,
        );
      if (done) setNotice(done);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }
  if (!api || gone)
    return (
      <div className="unavailable channel-page">
        <h1>☕ Dit Koffierad is niet beschikbaar.</h1>
        <p>
          {gone
            ? "De koppeling is opgeheven of deze link is vervangen. Vraag de beheerder van het kanaal om een nieuwe aanvraaglink."
            : "Live koffierondes zijn hier nog niet ingesteld."}
        </p>
        <a href="#/coffee">Open een lokaal Koffierad</a>
      </div>
    );
  if (!status)
    return (
      <div className="unavailable channel-page">
        <p className="notice">{notice || "Het Koffierad wordt gezet…"}</p>
      </div>
    );
  const chosen = minutes ?? status.defaultMinutes ?? DEFAULT_ROUND_MINUTES;
  const choices = [
    ...new Set([...ROUND_MINUTE_CHOICES, status.defaultMinutes]),
  ].sort((a, b) => a - b);
  return (
    <div className="unavailable channel-page">
      <span className="friday-badge">☕ Koffierad · gekoppeld aan Slack</span>
      <h1>Tijd voor koffie?</h1>
      {status.round ? (
        <section className="channel-round" aria-live="polite">
          <p>
            Er loopt een koffieronde. Het rad draait om{" "}
            <strong>{clock.format(Date.parse(status.round.startAt))}</strong>.
            Klik op ☕ onder de oproep in Slack om mee te doen.
          </p>
          <a className="primary" href={`#/live/${status.round.spectatorCapability}`}>
            Kijk live mee ☕
          </a>
        </section>
      ) : (
        <section className="channel-request">
          <p>
            Er komt een oproep in het Slack-kanaal. Wie op ☕ klikt, doet mee. Na
            de wachttijd draait het rad en kiest het één koffiehaler.
          </p>
          <fieldset className="minute-choices">
            <legend>Het rad draait over</legend>
            {choices.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={m === chosen}
                onClick={() => setMinutes(m)}
              >
                {m} min
              </button>
            ))}
          </fieldset>
          <button
            className="primary spin-button"
            disabled={pending || status.roundsLeft === 0}
            onClick={() => void act({ type: "requestRound", minutes: chosen })}
          >
            ☕ VRAAG EEN KOFFIERONDE AAN
          </button>
          {status.roundsLeft === 0 && (
            <p className="helper">Vandaag zijn er genoeg rondes geweest. Morgen weer!</p>
          )}
        </section>
      )}
      {notice && <p role="status">{notice}</p>}
      <p className="helper">
        Liever vanuit Slack? Typ <code>/koffierad</code> of{" "}
        <code>/koffierad 10</code> in het kanaal.
      </p>
      {status.role === "admin" && (
        <ChannelAdmin
          status={status}
          requestCapability={requestCapability}
          pending={pending}
          act={act}
          setNotice={setNotice}
        />
      )}
    </div>
  );
}

function ChannelAdmin({
  status,
  requestCapability,
  pending,
  act,
  setNotice,
}: {
  status: ChannelStatus;
  requestCapability?: string;
  pending: boolean;
  act: (command: ChannelCommand, done?: string) => Promise<void>;
  setNotice: (text: string) => void;
}) {
  return (
    <section className="channel-admin">
      <h2>Beheer</h2>
      <p className="helper">
        Bewaar deze beheerpagina zelf; deel alleen de aanvraaglink. Een koppeling
        verloopt na 90 dagen zonder koffierondes (nu tot{" "}
        {new Date(status.expiresAt).toLocaleDateString("nl-NL")}).
      </p>
      {requestCapability && (
        <button
          disabled={pending}
          onClick={() =>
            void navigator.clipboard.writeText(channelLink(requestCapability)).then(
              () =>
                setNotice(
                  "Aanvraaglink gekopieerd. Iedereen met deze link kan een koffieronde starten en meekijken.",
                ),
              () => setNotice("Kopiëren lukt niet. Sta klembordtoegang toe."),
            )
          }
        >
          Kopieer aanvraaglink ⧉
        </button>
      )}
      <label>
        Standaardwachttijd{" "}
        <select
          value={status.defaultMinutes}
          disabled={pending}
          onChange={(e) =>
            void act(
              { type: "setDefaultMinutes", minutes: Number(e.target.value) },
              "Standaardwachttijd opgeslagen.",
            )
          }
        >
          {Array.from({ length: MAX_ROUND_MINUTES }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m} {m === 1 ? "minuut" : "minuten"}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={pending}
        onClick={() => {
          if (
            window.confirm(
              "Een nieuwe aanvraaglink maken? De oude link werkt dan niet meer, ook niet als hij in Slack staat.",
            )
          )
            void act({ type: "rotateRequestLink" }, "Nieuwe aanvraaglink gemaakt.");
        }}
      >
        Nieuwe aanvraaglink
      </button>
      <button
        disabled={pending}
        onClick={() => {
          if (
            window.confirm(
              "Het Koffierad ontkoppelen? Alle links vervallen. Een lopende ronde draait nog af.",
            )
          )
            void act({ type: "unbind" });
        }}
      >
        Ontkoppelen
      </button>
    </section>
  );
}
