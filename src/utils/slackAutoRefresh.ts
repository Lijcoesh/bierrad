import type { SlackHostStatus } from "../../shared/protocol";
export const SLACK_REFRESH_MS = 5 * 60 * 1000;
/** Only an open host screen polls; the server still authorizes every import. */
export function startSlackAutoRefresh(
  state: () => {
    status: SlackHostStatus;
    locked: boolean;
    scheduledStartAt?: string;
  },
  refresh: () => Promise<void>,
  onError: (error: unknown) => void,
): () => void {
  let stopped = false,
    inFlight = false;
  const timer = setInterval(() => {
    const current = state(),
      now = Date.now();
    if (
      stopped ||
      inFlight ||
      current.locked ||
      current.status.importing ||
      !current.status.enabled ||
      current.status.source !== "slack" ||
      (current.status.syncedAt &&
        now - Date.parse(current.status.syncedAt) < SLACK_REFRESH_MS) ||
      (current.scheduledStartAt &&
        now >= Date.parse(current.scheduledStartAt) - 120000)
    )
      return;
    inFlight = true;
    void refresh()
      .catch((error) => {
        if (!stopped) onError(error);
      })
      .finally(() => {
        inFlight = false;
      });
  }, SLACK_REFRESH_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
