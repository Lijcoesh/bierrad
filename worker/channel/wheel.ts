import { DurableObject } from "cloudflare:workers";
import {
  CHANNEL_IDLE_TTL_MS,
  DEFAULT_ROUND_MINUTES,
  MAX_ROUNDS_PER_DAY,
  validRoundMinutes,
  type ChannelCommandResult,
  type ChannelStatus,
} from "../../shared/channel";
import {
  equalHash,
  hashSecret,
  randomHex,
  randomWords,
  wordLocator,
} from "../auth";
import { frontend, json } from "../http";
import { RequestError } from "../session";
import { SlackApiClient } from "../slack/api";
import {
  loginConfigured,
  slackEnvironment,
  type SlackSecrets,
} from "../slack/access";
import { clock, postMessage } from "../slack/state";
import { boundBody, callBody } from "./messages";
import { SLASH_HELP } from "./slash";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A round can be watched until this long after its start; it stops blocking once drawn. */
export const ROUND_WATCH_MS = 3 * 60 * 1000;

interface Round {
  id: string;
  status: "posting" | "open";
  startAt: number;
  endsAt: number;
  /**
   * Raw spectator capability of the round, also posted in the channel. Kept
   * server-side only until the round can no longer be watched.
   */
  spectatorCapability: string;
}
interface Binding {
  locator: string;
  channelId: string;
  teamId: string;
  /** The bot's own user; its prefilled reaction never counts. */
  botUserId?: string;
  adminHash: string;
  requestHash: string;
  defaultMinutes: number;
  createdAt: number;
  /** Idle expiry, pushed back by binding and by every round. */
  expiresAt: number;
  window: number;
  rounds: number;
  round?: Round;
}
export interface BindInput {
  locator: string;
  channelId: string;
  teamId: string;
  botUserId?: string;
  adminHash: string;
  requestHash: string;
}
/**
 * One Durable Object per channel. The name is derived from the channel so
 * slash commands find it; like every locator it grants nothing by itself.
 */
export async function channelLocator(channelId: string): Promise<string> {
  return (await hashSecret(`koffierad-channel:${channelId}`)).slice(0, 32);
}
const roundErrors: Record<string, string> = {
  round_active: "☕ Er loopt al een koffieronde in dit kanaal. Klik op ☕ onder de oproep om mee te doen.",
  round_limit: "☕ Vandaag zijn er al genoeg koffierondes gestart in dit kanaal. Morgen weer!",
  slack_post_failed:
    "☕ Het Koffierad kon niet in dit kanaal posten. Nodig de Koffierad-bot uit met /invite @Koffierad en probeer opnieuw.",
  slack_uncertain:
    "☕ Het is onzeker of de oproep is geplaatst. Kijk even in het kanaal voordat je het opnieuw probeert.",
};

export class ChannelWheel extends DurableObject<Env & SlackSecrets> {
  private read(): Binding | undefined {
    if (
      !this.ctx.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE name = 'binding'")
        .toArray().length
    )
      return undefined;
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM binding WHERE singleton = 1")
      .toArray()[0];
    return row ? (JSON.parse(row.value) as Binding) : undefined;
  }
  private save(binding: Binding) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO binding VALUES (1, ?)",
      JSON.stringify(binding),
    );
  }
  private async expire() {
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
  private async arm(binding: Binding) {
    await this.ctx.storage.setAlarm(
      Math.min(binding.expiresAt, binding.round?.endsAt ?? Infinity),
    );
  }
  private slack() {
    return slackEnvironment(this.env, "coffee");
  }
  /** Rebinding replaces both links (the old ones stop working) but keeps the daily count. */
  async bind(input: BindInput, requestLink: string): Promise<void> {
    const env = this.slack();
    if (!loginConfigured(env)) throw new RequestError(503, "unavailable");
    const posted = await postMessage(
      new SlackApiClient(env.SLACK_BOT_TOKEN!),
      input.channelId,
      boundBody(input.channelId, requestLink),
    );
    if (posted.status !== "posted")
      throw new RequestError(
        400,
        posted.status === "failed" ? "not_in_channel" : "unavailable",
      );
    const now = Date.now();
    const stored = this.read();
    const previous = stored && now < stored.expiresAt ? stored : undefined;
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS binding (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), value TEXT NOT NULL)",
    );
    const binding: Binding = {
      locator: input.locator,
      channelId: input.channelId,
      teamId: input.teamId,
      ...(input.botUserId ? { botUserId: input.botUserId } : {}),
      adminHash: input.adminHash,
      requestHash: input.requestHash,
      defaultMinutes: previous?.defaultMinutes ?? DEFAULT_ROUND_MINUTES,
      createdAt: now,
      expiresAt: now + CHANNEL_IDLE_TTL_MS,
      window: previous?.window ?? now,
      rounds: previous?.rounds ?? 0,
      ...(previous?.round ? { round: previous.round } : {}),
    };
    this.save(binding);
    await this.arm(binding);
  }
  /** The current round's ID once its draw is over, so it no longer blocks the next. */
  private async settledRoundId(): Promise<string | undefined> {
    const round = this.read()?.round;
    if (!round || round.status !== "open") return;
    try {
      const session = this.env.SESSIONS.getByName(
        await wordLocator(round.spectatorCapability),
      );
      return (await session.channelRoundSettled()) ? round.id : undefined;
    } catch {
      return;
    }
  }
  private status(
    binding: Binding,
    role: ChannelStatus["role"],
    now: number,
    settledId?: string,
  ): ChannelStatus {
    const round = binding.round?.id === settledId ? undefined : binding.round;
    const used = now - binding.window >= DAY_MS ? 0 : binding.rounds;
    return {
      role,
      defaultMinutes: binding.defaultMinutes,
      ...(round && round.status === "open" && now < round.endsAt
        ? {
            round: {
              startAt: new Date(round.startAt).toISOString(),
              spectatorCapability: round.spectatorCapability,
            },
          }
        : {}),
      roundsLeft: Math.max(0, MAX_ROUNDS_PER_DAY - used),
      expiresAt: new Date(binding.expiresAt).toISOString(),
    };
  }
  private async authenticate(secret: string): Promise<ChannelStatus["role"]> {
    const hash = await hashSecret(secret);
    const binding = this.read();
    if (!binding) throw new RequestError(404, "unavailable");
    if (Date.now() >= binding.expiresAt) {
      await this.expire();
      throw new RequestError(404, "unavailable");
    }
    if (equalHash(hash, binding.adminHash)) return "admin";
    if (equalHash(hash, binding.requestHash)) return "requester";
    throw new RequestError(404, "unavailable");
  }
  /** Link holders: status, round requests and (admin only) management. */
  async access(secret: string, command: unknown): Promise<Response> {
    try {
      // Generated before authorization so no await separates read and write below.
      const rotated = randomHex();
      const rotatedHash = await hashSecret(rotated);
      const role = await this.authenticate(secret);
      const settled = await this.settledRoundId();
      if (command === null) {
        const binding = this.read();
        if (!binding) throw new RequestError(404, "unavailable");
        return json({
          type: "status",
          status: this.status(binding, role, Date.now(), settled),
        } satisfies ChannelCommandResult);
      }
      const allowed: Record<string, string[]> = {
        requestRound: ["minutes"],
        setDefaultMinutes: ["minutes"],
        rotateRequestLink: [],
        unbind: [],
      };
      if (
        !command ||
        typeof command !== "object" ||
        Array.isArray(command) ||
        !("type" in command) ||
        typeof command.type !== "string" ||
        !Object.hasOwn(allowed, command.type) ||
        Object.keys(command).some(
          (k) => !["type", ...allowed[command.type as string]].includes(k),
        )
      )
        throw new RequestError(400, "invalid");
      const input = command as Record<string, unknown>;
      if (input.type === "requestRound") {
        if (!validRoundMinutes(input.minutes))
          throw new RequestError(400, "invalid");
        await this.startRound(input.minutes);
      } else {
        if (role !== "admin") throw new RequestError(403, "forbidden");
        const binding = this.read();
        if (!binding || Date.now() >= binding.expiresAt)
          throw new RequestError(404, "unavailable");
        if (input.type === "unbind") {
          await this.expire();
          return json({ type: "unbound" } satisfies ChannelCommandResult);
        }
        if (input.type === "setDefaultMinutes") {
          if (!validRoundMinutes(input.minutes))
            throw new RequestError(400, "invalid");
          binding.defaultMinutes = input.minutes;
          this.save(binding);
        } else {
          binding.requestHash = rotatedHash;
          this.save(binding);
          return json({
            type: "rotated",
            requestCapability: `${binding.locator}.${rotated}`,
            status: this.status(binding, role, Date.now(), settled),
          } satisfies ChannelCommandResult);
        }
      }
      const binding = this.read();
      if (!binding) throw new RequestError(404, "unavailable");
      return json({
        type: "status",
        status: this.status(binding, role, Date.now(), settled),
      } satisfies ChannelCommandResult);
    } catch (error) {
      return json(
        { code: error instanceof RequestError ? error.code : "unavailable" },
        error instanceof RequestError ? error.status : 503,
      );
    }
  }
  /** Called only after the Worker verified Slack's signature for this channel. */
  async slash(minutes: number | undefined): Promise<string> {
    const app = frontend(this.env);
    const binding = this.read();
    if (!binding || Date.now() >= binding.expiresAt)
      return `☕ Dit kanaal heeft nog geen Koffierad.${app ? ` Koppel het via ${app.href}#/koffie-koppelen` : ""}`;
    const chosen = minutes ?? binding.defaultMinutes;
    if (!validRoundMinutes(chosen)) return SLASH_HELP;
    try {
      const round = await this.startRound(chosen);
      return `☕ Gelukt! De oproep staat in het kanaal en het rad draait om ${clock.format(Date.parse(round.startAt))}.`;
    } catch (error) {
      return (
        (error instanceof RequestError && roundErrors[error.code]) ||
        "☕ Het Koffierad is nu niet bereikbaar. Probeer het zo opnieuw."
      );
    }
  }
  /**
   * Claims the round before any Slack call, posts the call, adds the first ☕
   * and hands the draw to a fresh spectator-only LiveSession.
   */
  private async startRound(
    minutes: number,
  ): Promise<{ startAt: string; spectatorCapability: string }> {
    const spectator = randomWords();
    const [sessionLocator, spectatorHash] = await Promise.all([
      wordLocator(spectator),
      hashSecret(spectator),
    ]);
    const settled = await this.settledRoundId();
    const env = this.slack(),
      app = frontend(this.env);
    const binding = this.read();
    const now = Date.now();
    if (!binding || now >= binding.expiresAt)
      throw new RequestError(404, "unavailable");
    if (!loginConfigured(env) || !app)
      throw new RequestError(503, "unavailable");
    // A round blocks the next until its draw is over (or it can no longer be watched).
    if (
      binding.round &&
      now < binding.round.endsAt &&
      binding.round.id !== settled
    )
      throw new RequestError(409, "round_active");
    if (now - binding.window >= DAY_MS) {
      binding.window = now;
      binding.rounds = 0;
    }
    if (binding.rounds >= MAX_ROUNDS_PER_DAY)
      throw new RequestError(429, "round_limit");
    const startAt = Math.ceil((now + minutes * 60000) / 1000) * 1000;
    const id = crypto.randomUUID();
    binding.round = {
      id,
      status: "posting",
      startAt,
      endsAt: startAt + ROUND_WATCH_MS,
      spectatorCapability: spectator,
    };
    binding.rounds++;
    binding.expiresAt = Math.max(binding.expiresAt, now + CHANNEL_IDLE_TTL_MS);
    this.save(binding);
    await this.arm(binding);
    await this.ctx.storage.sync();
    const clear = () => {
      const current = this.read();
      if (current?.round?.id !== id) return;
      delete current.round;
      this.save(current);
    };
    const api = new SlackApiClient(env.SLACK_BOT_TOKEN!);
    const posted = await postMessage(
      api,
      binding.channelId,
      callBody(
        binding.channelId,
        `${app.href}#/live/${spectator}`,
        startAt,
        Date.now(),
      ),
    );
    if (posted.status !== "posted") {
      clear();
      throw new RequestError(
        400,
        posted.status === "failed" ? "slack_post_failed" : "slack_uncertain",
      );
    }
    try {
      await api.call("reactions.add", {
        channel: binding.channelId,
        timestamp: posted.postedMessageTs,
        name: "coffee",
      });
    } catch {
      // Not essential: people can still add ☕ themselves.
    }
    try {
      await this.env.SESSIONS.getByName(sessionLocator).initializeChannelRound(
        spectatorHash,
        {
          channelId: binding.channelId,
          parentMessageTs: posted.postedMessageTs,
          reactionName: "coffee",
        },
        startAt,
        binding.botUserId ? [binding.botUserId] : [],
      );
    } catch {
      clear();
      throw new RequestError(503, "unavailable");
    }
    const current = this.read();
    if (current?.round?.id === id) {
      current.round.status = "open";
      this.save(current);
      await this.arm(current);
    }
    return {
      startAt: new Date(startAt).toISOString(),
      spectatorCapability: spectator,
    };
  }
  async alarm() {
    const binding = this.read();
    if (!binding) return;
    const now = Date.now();
    if (now >= binding.expiresAt) {
      await this.expire();
      return;
    }
    if (binding.round && now >= binding.round.endsAt) {
      // Wipes the raw spectator capability with the round.
      delete binding.round;
      this.save(binding);
    }
    await this.arm(binding);
  }
}
