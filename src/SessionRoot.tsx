import { VariantContext, useTheme } from "./Theme";
import { localHash, themes, type WheelVariant } from "../shared/variant";
import { useEffect, useState, useSyncExternalStore } from "react";
import App from "./App";
import { LocalSessionController } from "./sessions/LocalSessionController";
import {
  RemoteSessionController,
  createLiveSession,
} from "./sessions/RemoteSessionController";
import { ManualParticipantSource } from "./services/ManualParticipantSource";
import { LocalWinnerCountPreference } from "./services/WinnerCountPreference";
import {
  configuredApiUrl,
  liveLink,
  parseLiveRoute,
} from "./sessions/liveNavigation";

export function SessionRoot() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const invite = /^#\/(coffee-)?slack-start\/([a-f0-9]{64})$/.exec(hash);
  return invite ? (
    <VariantContext.Provider value={invite[1] ? "coffee" : "beer"}>
      <SlackStart key={hash} capability={invite[2]} />
    </VariantContext.Provider>
  ) : (
    <SessionPage key={hash} hash={hash} />
  );
}
function SessionPage({ hash }: { hash: string }) {
  const variant: WheelVariant = hash === "#/coffee" ? "coffee" : "beer";
  const local = !hash || hash === "#/beer" || hash === "#/coffee";
  const apiUrl = configuredApiUrl();
  const route = parseLiveRoute(hash);
  const [controller, setController] = useState<
    LocalSessionController | RemoteSessionController
  >();
  useEffect(() => {
    if (!local && (!route || !apiUrl)) return;
    let current: LocalSessionController | RemoteSessionController;
    if (route && apiUrl)
      current = new RemoteSessionController({ ...route, apiUrl });
    else {
      const source = new ManualParticipantSource(variant);
      current = new LocalSessionController({
        freshStart: true,
        source,
        preference: new LocalWinnerCountPreference(variant),
        saveParticipants: (p) => source.save(p),
      });
    }
    setController(current);
    void current.initialize();
    return () => current.dispose();
  }, [hash, apiUrl]);
  if (!local && (!route || !apiUrl))
    return (
      <div className="unavailable">
        <h1>🍻 Live Bierrad is niet beschikbaar.</h1>
        <p>
          Deze link is ongeldig of live meekijken is hier nog niet ingesteld.
        </p>
        <a href="./">Open een lokaal Bierrad</a>
      </div>
    );
  if (!controller) return <p className="notice">Het rad wordt klaargezet…</p>;
  return (
    <SessionTheme controller={controller} fallback={variant}>
      <LiveBar
        controller={controller}
        apiUrl={apiUrl}
        spectatorCapability={route?.spectatorCapability}
      />
      <App controller={controller} />
    </SessionTheme>
  );
}
function SessionTheme({
  controller,
  fallback,
  children,
}: {
  controller: LocalSessionController | RemoteSessionController;
  fallback: WheelVariant;
  children: import("react").ReactNode;
}) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const variant = snapshot.session.variant ?? fallback;
  useEffect(() => {
    document.documentElement.dataset.variant = variant;
    document.title = themes[variant].name + " — Wie haalt de volgende ronde?";
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon)
      icon.href = variant === "coffee" ? "./coffee-icon.svg" : "./favicon.svg";
  }, [variant]);
  return (
    <VariantContext.Provider value={variant}>
      {children}
    </VariantContext.Provider>
  );
}
function LiveBar({
  controller,
  apiUrl,
  spectatorCapability,
}: {
  controller: LocalSessionController | RemoteSessionController;
  apiUrl?: string;
  spectatorCapability?: string;
}) {
  const theme = useTheme();
  const { live, capabilities } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  async function create() {
    if (!apiUrl) return;
    setPending(true);
    setNotice("");
    try {
      const created = await createLiveSession(apiUrl, undefined, theme.variant);
      // Fragment survives reload, but is never sent to Pages or stored in web storage.
      location.hash = `/host/${created.hostCapability}/${created.spectatorCapability}`;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Live starten is niet gelukt.",
      );
    } finally {
      setPending(false);
    }
  }
  // Spectators get their own presentation header inside SpectatorView.
  if (live?.role === "spectator") return null;
  return (
    <div className="live-bar">
      <span>
        {!live
          ? "Alleen op dit scherm"
          : live.role === "host"
            ? `● Jij organiseert · Live ${theme.name}`
            : "● Je kijkt live mee"}
      </span>
      {live && (
        <small role="status">
          {
            {
              connecting: "Verbinden…",
              connected: "Verbonden",
              reconnecting: "Verbinding herstellen…",
              unavailable: "Afgelopen",
            }[live.status]
          }
        </small>
      )}
      {!live && apiUrl && (
        <button
          disabled={pending || !capabilities.canReset}
          onClick={() => void create()}
        >
          Start live {theme.name} ↗
        </button>
      )}
      {live?.role === "host" &&
        live.status !== "unavailable" &&
        spectatorCapability && (
          <button
            onClick={() => {
              void navigator.clipboard
                .writeText(liveLink("spectator", spectatorCapability))
                .then(
                  () =>
                    setNotice(
                      "Kijklink gekopieerd. Iedereen met deze link kan tijdelijk meekijken.",
                    ),
                  () =>
                    setNotice(
                      "Kopiëren lukt niet. Sta klembordtoegang toe en probeer opnieuw.",
                    ),
                );
            }}
          >
            Kopieer kijklink ⧉
          </button>
        )}
      {live?.role === "host" && live.status === "connected" && (
        <button
          onClick={() => {
            if (
              window.confirm(
                `Dit live ${theme.name} beëindigen? Alle kijklinks vervallen en de deelnemers worden gewist.`,
              )
            )
              void (controller as RemoteSessionController)
                .endSession()
                .catch(() =>
                  setNotice("Beëindigen is niet gelukt. Probeer opnieuw."),
                );
          }}
        >
          Live beëindigen
        </button>
      )}
      {live && <a href={localHash(theme.variant)}>Eigen {theme.name}</a>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}

function SlackStart({ capability }: { capability: string }) {
  const theme = useTheme();
  useEffect(() => {
    document.documentElement.dataset.variant = theme.variant;
    document.title = theme.name;
  }, [theme.variant, theme.name]);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const api = configuredApiUrl();
  return (
    <div className="unavailable">
      <h1>
        {theme.icon} {theme.badge}.
      </h1>
      <p>
        Start een tijdelijk live {theme.name} met Slack. Bewaar deze startlink
        voor organisatoren; deel straks alleen de kijklink.
      </p>
      <button
        className="primary"
        disabled={pending || !api}
        onClick={() => {
          setPending(true);
          setError("");
          void createLiveSession(api!, capability, theme.variant)
            .then((created) => {
              location.replace(
                `${location.pathname}#/host/${created.hostCapability}/${created.spectatorCapability}`,
              );
            })
            .catch(() => {
              setError(
                "Deze startlink is verlopen, ingetrokken of Slack is nog niet ingesteld.",
              );
              setPending(false);
            });
        }}
      >
        {pending
          ? "Klaarzetten…"
          : `Start ${theme.name} met Slack ${theme.icon}`}
      </button>
      {error && <p role="alert">{error}</p>}
      <p>
        <a href={localHash(theme.variant)}>Liever handmatig draaien</a>
      </p>
    </div>
  );
}
