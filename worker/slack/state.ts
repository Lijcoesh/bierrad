import { themes } from "../../shared/variant";
import { createSession } from "../../src/domain/drawEngine";
import type { StoredSession } from "../session";
import { RequestError } from "../session";
import type { SlackPerson, SlackSource } from "./source";
import { SlackApiClient, SlackError } from "./api";
export interface SlackJob {
  drawId: string;
  source: SlackSource;
  names: string[];
  /** Private, frozen in winner order; absent on jobs created before mentions shipped. */
  mentionIds?: (string | null)[];
  status: "pending" | "posting" | "posted" | "failed" | "uncertain";
  readyAt: number;
  attemptedAt?: number;
  retryAt?: number;
  postedMessageTs?: string;
}
export interface SlackState {
  grantHash: string;
  source?: SlackSource;
  mapping: Record<string, string>;
  syncedAt?: string;
  count?: number;
  importing?: { id: string; until: number };
  nextImportAt?: number;
  nextFinalImportAt?: number;
  retryImportAt?: number;
  job?: SlackJob;
}
/** Stable opaque identity; numbered display labels distinguish equal names without Slack IDs. */
export function reconcile(
  record: StoredSession,
  source: SlackSource,
  people: SlackPerson[],
  now: number,
) {
  const state = record.slack!;
  const oldIds = new Set(Object.values(state.mapping));
  const manual = record.session.participants.filter((p) => !oldIds.has(p.id));
  const used = new Set(manual.map((p) => p.name.toLocaleLowerCase("nl")));
  const mapping: Record<string, string> = {};
  const imported = people.map((p) => {
    const id = state.mapping[p.slackId] ?? crypto.randomUUID();
    mapping[p.slackId] = id;
    let name = p.name;
    let suffix = 1;
    while (used.has(name.toLocaleLowerCase("nl"))) {
      const label = ` (${++suffix})`;
      name = p.name.slice(0, 32 - label.length).trimEnd() + label;
    }
    used.add(name.toLocaleLowerCase("nl"));
    return { id, name };
  });
  if (manual.length + imported.length > 100)
    throw new RequestError(400, "slack_too_many");
  record.session = createSession(
    record.session.id,
    [...manual, ...imported],
    record.preferredCount,
  );
  state.source = source;
  state.mapping = mapping;
  state.count = imported.length;
  state.syncedAt = new Date(now).toISOString();
}
export function queueResult(record: StoredSession) {
  const draw = record.session.activeDraw,
    slack = record.slack;
  if (!draw || !slack?.source) return;
  const identities = new Map(
    Object.entries(slack.mapping).map(([slackId, participantId]) => [
      participantId,
      slackId,
    ]),
  );
  slack.job = {
    drawId: draw.id,
    source: { ...slack.source },
    names: draw.spins.map(
      (spin) =>
        record.session.participants.find((p) => p.id === spin.winnerId)!.name,
    ),
    mentionIds: draw.spins.map((spin) => identities.get(spin.winnerId) ?? null),
    status: "pending",
    readyAt: Math.max(
      ...draw.spins.map((s) => Date.parse(s.startAt) + s.durationMs),
    ),
  };
}
export function resultBody(job: SlackJob) {
  const theme =
    themes[job.source.reactionName === "coffee" ? "coffee" : "beer"];
  const heading = `${theme.icon} Het rad heeft gesproken!\n`;
  const ending = `${job.names.length === 1 ? "Jij mag" : "Jullie mogen"} ${theme.drink} halen!`;
  const text = `${heading}${job.names.join(" · ")}\n${ending}`;
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Only server-resolved identities become mention elements. Names remain literal text.
  const elements: (
    | { type: "text"; text: string }
    | { type: "user"; user_id: string }
  )[] = [{ type: "text", text: heading }];
  job.names.forEach((name, index) => {
    if (index) elements.push({ type: "text", text: " · " });
    const id = job.mentionIds?.[index];
    elements.push(
      id && /^[UW][A-Z0-9]{8,20}$/.test(id) && id !== "USLACKBOT"
        ? { type: "user", user_id: id }
        : { type: "text", text: name },
    );
  });
  elements.push({
    type: "text",
    text: `\n${ending}`,
  });
  return {
    channel: job.source.channelId,
    thread_ts: job.source.parentMessageTs,
    text: escaped,
    blocks: [
      {
        type: "rich_text",
        elements: [{ type: "rich_text_section", elements }],
      },
    ],
    mrkdwn: false,
    parse: "none",
    link_names: false,
    reply_broadcast: false,
    unfurl_links: false,
    unfurl_media: false,
  };
}
export async function postResult(
  api: SlackApiClient,
  job: SlackJob,
): Promise<
  | { status: "posted"; postedMessageTs: string }
  | { status: "failed" | "uncertain"; retryAt: number }
> {
  try {
    const result = await api.call("chat.postMessage", resultBody(job));
    if (
      result.channel !== job.source.channelId ||
      typeof result.ts !== "string" ||
      !/^\d{10}\.\d{6}$/.test(result.ts)
    )
      throw new SlackError("slack_response", 60000, true);
    return { status: "posted", postedMessageTs: result.ts };
  } catch (error) {
    return {
      status:
        error instanceof SlackError && !error.uncertain
          ? "failed"
          : "uncertain",
      retryAt:
        Date.now() + (error instanceof SlackError ? error.retryAfterMs : 60000),
    };
  }
}
