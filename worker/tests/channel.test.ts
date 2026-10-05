import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { randomHex, wordLocator } from "../auth";
import {
  parseSlashCommand,
  verifySlackSignature,
} from "../channel/slash";
import { boundBody, callBody } from "../channel/messages";
import {
  channelRefreshAt,
  executeScheduledDraw,
  newSession,
  nextDeadline,
  START_DELAY_MS,
  type StoredSession,
} from "../session";
import { queueChannelNotice, resultBody } from "../slack/state";
import { SlackApiClient } from "../slack/api";
import { SlackReactionParticipantSource } from "../slack/source";
import { parseChannelInput } from "../../shared/channel";
import type { ChannelCommandResult } from "../../shared/channel";
import type { PublicBeerWheelSession } from "../../shared/protocol";

const signingSecret = "synthetic-signing-secret";
const sign = (body: string, at = Math.floor(Date.now() / 1000)) => ({
  "X-Slack-Request-Timestamp": String(at),
  "X-Slack-Signature":
    "v0=" +
    createHmac("sha256", signingSecret).update(`v0:${at}:${body}`).digest("hex"),
});
const slashBody = (fields: Record<string, string>) =>
  new URLSearchParams({
    command: "/koffierad",
    user_id: "U00000001",
    channel_id: "C00000001",
    team_id: "T00000001",
    text: "",
    ...fields,
  }).toString();

test("slash requests need a fresh signature over the exact body", async () => {
  const body = slashBody({});
  const ok = (headers: Record<string, string>, raw = body, secret = signingSecret) =>
    verifySlackSignature(secret, new Headers(headers), raw);
  assert.equal(await ok(sign(body)), true);
  assert.equal(await ok(sign(body), body + "&text=5"), false);
  assert.equal(await ok(sign(body), body, "other-secret"), false);
  assert.equal(await ok(sign(body), body, ""), false);
  assert.equal(await ok(sign(body, Math.floor(Date.now() / 1000) - 301)), false);
  assert.equal(await ok({ ...sign(body), "X-Slack-Signature": "v0=abc" }), false);
  assert.equal(await ok({ "X-Slack-Signature": sign(body)["X-Slack-Signature"] }), false);
});

test("slash command text is strict: minutes, help or nothing", () => {
  const parse = (fields: Record<string, string>) => parseSlashCommand(slashBody(fields));
  assert.deepEqual(parse({}), { kind: "round", channelId: "C00000001", userId: "U00000001" });
  assert.equal((parse({ text: "10" }) as { minutes: number }).minutes, 10);
  assert.equal((parse({ text: " 7 min " }) as { minutes: number }).minutes, 7);
  assert.equal(parse({ text: "help" }).kind, "help");
  assert.equal(parse({ text: "<!channel> 5" }).kind, "help");
  assert.equal(parse({ text: "100" }).kind, "help");
  assert.equal(parse({ channel_id: "D00000001" }).kind, "wrongChannel");
  assert.equal(parse({ command: "/bierrad" }).kind, "invalid");
  assert.equal(parse({ user_id: "nope" }).kind, "invalid");
  assert.equal(
    parseSlashCommand(slashBody({}) + "&channel_id=C00000002").kind,
    "invalid",
  );
});

test("channel input accepts only Slack channel IDs and links", () => {
  assert.equal(parseChannelInput("C00000001"), "C00000001");
  assert.equal(
    parseChannelInput("https://acme.slack.com/archives/G00000001/p1234567890123456"),
    "G00000001",
  );
  assert.equal(
    parseChannelInput("https://app.slack.com/client/T00000001/C00000001"),
    "C00000001",
  );
  for (const bad of [
    "D00000001",
    "https://evil.example/archives/C00000001",
    "http://acme.slack.com/archives/C00000001",
    "#koffie",
  ])
    assert.equal(parseChannelInput(bad), null, bad);
});

test("channel messages are fixed text with server-built links, never broadcast or unfurled", () => {
  const link = "https://example.test/#/live/one-two-three-four-five";
  const now = Date.parse("2026-10-05T08:00:00Z");
  const call = callBody("C00000001", link, now + 5 * 60000, now);
  assert.match(call.text, /^☕ Koffieronde! .*\nOver 5 minuten \(10:05\)/);
  assert.equal(call.unfurl_links, false);
  assert.equal(call.link_names, false);
  assert.equal("thread_ts" in call, false);
  assert.equal("reply_broadcast" in call, false);
  assert.deepEqual(call.blocks[0].elements[0].elements[1], {
    type: "link",
    url: link,
    text: "Kijk live mee",
  });
  const bound = boundBody("C00000001", "https://example.test/#/koffie/abc");
  assert.match(bound.text, /\/koffierad/);
});

test("channel rounds close their thread when nobody joins or reactions cannot be read", () => {
  const now = Date.parse("2026-10-05T08:00:00Z");
  const source = { channelId: "C00000001", parentMessageTs: "1234567890.123456", reactionName: "coffee" as const };
  const round = (): StoredSession => {
    const r = newSession("host", "viewer", now, "coffee");
    r.preferredCount = 1;
    r.scheduledDraw = { startAt: new Date(now + 300000).toISOString(), status: "refreshing" };
    r.slack = { grantHash: "slack-channel", mapping: {}, source, channelRound: true, nextImportAt: now + 60000 };
    return r;
  };
  let r = round();
  executeScheduledDraw(r, now, true);
  assert.equal(r.slack!.job?.notice, "empty");
  assert.match(resultBody(r.slack!.job!).text, /Niemand deed mee/);
  assert.equal(resultBody(r.slack!.job!).reply_broadcast, false);
  r = round();
  executeScheduledDraw(r, now, false);
  assert.equal(r.slack!.job?.notice, "unreadable");
  // Ordinary Slack sessions keep their old behaviour: no notice at all.
  r = round();
  delete r.slack!.channelRound;
  executeScheduledDraw(r, now, true);
  assert.equal(r.slack!.job, undefined);
  queueChannelNotice(r, "empty", now);
  assert.equal(r.slack!.job, undefined);
});

test("channel rounds refresh themselves, but never close to the final check", () => {
  const now = Date.parse("2026-10-05T08:00:00Z");
  const r = newSession("host", "viewer", now, "coffee");
  const startAt = now + 5 * 60000;
  r.scheduledDraw = { startAt: new Date(startAt).toISOString(), status: "pending" };
  r.slack = {
    grantHash: "slack-channel",
    mapping: {},
    source: { channelId: "C00000001", parentMessageTs: "1234567890.123456", reactionName: "coffee" },
    channelRound: true,
    nextImportAt: now + 60000,
  };
  assert.equal(channelRefreshAt(r), now + 60000);
  assert.equal(nextDeadline(r), now + 60000);
  r.slack.nextImportAt = startAt - START_DELAY_MS - 29000;
  assert.equal(channelRefreshAt(r), undefined);
  assert.equal(nextDeadline(r), startAt - START_DELAY_MS);
  delete r.slack.channelRound;
  r.slack.nextImportAt = now;
  assert.equal(channelRefreshAt(r), undefined);
});

test("the bot's own prefilled reaction never becomes a participant", async () => {
  const looked: string[] = [];
  const api = new SlackApiClient("synthetic", (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("reactions.get"))
      return Response.json({
        ok: true,
        type: "message",
        channel: "C00000001",
        message: {
          ts: "1234567890.123456",
          reactions: [{ name: "coffee", count: 2, users: ["UBOT00001", "U00000001"] }],
        },
      });
    looked.push(url.searchParams.get("user")!);
    return Response.json({ ok: true, user: { id: url.searchParams.get("user"), deleted: false, is_bot: false, profile: { display_name: "Alice" } } });
  }) as typeof fetch);
  const people = await new SlackReactionParticipantSource(api).getParticipants(
    { channelId: "C00000001", parentMessageTs: "1234567890.123456", reactionName: "coffee" },
    ["UBOT00001"],
  );
  assert.deepEqual(people.map((p) => p.slackId), ["U00000001"]);
  assert.deepEqual(looked, ["U00000001"]);
});

test(
  "Worker binds a channel, starts rounds from link and slash command, draws one winner without the bot",
  { timeout: 60000 },
  async () => {
    const script = await readFile("worker-dist/index.js", "utf8");
    const clientId = "1000000000.2000000000";
    let nonce = "";
    let postMode = "success";
    let ts = 1234567890100000;
    const posts: Record<string, unknown>[] = [];
    const reactionsAdded: Record<string, unknown>[] = [];
    const userLookups: string[] = [];
    const reactors = ["UBOT00001", "U00000001", "U00000002"];
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "channel-test",
            modules: true,
            script:
              script +
              `\nexport class TestSession extends LiveSession {
      edit(fn) { const r = JSON.parse(this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value); fn(r); this.ctx.storage.sql.exec('UPDATE session SET value = ? WHERE singleton = 1', JSON.stringify(r)); }
      stored() { return this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value; }
      async due() { this.edit(r => { r.scheduledDraw.startAt = new Date(Date.now() + 4000).toISOString(); }); return this.alarm(); }
      async postNow() { this.edit(r => { r.slack.job.readyAt = 0; }); return this.alarm(); }
      land() { this.edit(r => { const d = r.session.activeDraw; const end = Math.max(...d.spins.map(s => Date.parse(s.startAt) + s.durationMs)); const shift = end - Date.now() + 1000; const move = t => new Date(Date.parse(t) - shift).toISOString(); d.startAt = move(d.startAt); for (const s of d.spins) s.startAt = move(s.startAt); }); }
    }
    export class TestChannel extends ChannelWheel {
      stored() { if (!this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = 'binding'").toArray().length) return null; return this.ctx.storage.sql.exec('SELECT value FROM binding WHERE singleton = 1').toArray()[0]?.value ?? null; }
      async finishRound() { const b = JSON.parse(this.stored()); b.round.endsAt = Date.now() - 1; this.ctx.storage.sql.exec('UPDATE binding SET value = ? WHERE singleton = 1', JSON.stringify(b)); return this.alarm(); }
    }`,
            compatibilityDate: "2026-09-25",
            compatibilityFlags: ["nodejs_compat"],
            durableObjects: {
              SESSIONS: { className: "TestSession", useSQLite: true },
              CHANNELS: { className: "TestChannel", useSQLite: true },
            },
            bindings: {
              ALLOWED_ORIGINS: "http://127.0.0.1:5173",
              FRONTEND_URL: "http://127.0.0.1:5173/",
              COFFEE_SLACK_BOT_TOKEN: "synthetic-coffee-credential",
              COFFEE_SLACK_CLIENT_ID: clientId,
              COFFEE_SLACK_CLIENT_SECRET: "synthetic-coffee-client-secret",
              COFFEE_SLACK_SIGNING_SECRET: signingSecret,
            },
            ratelimits: {
              CREATION_LIMIT: { namespace_id: "30", simple: { limit: 100, period: 60 } },
              CREATION_GLOBAL: { namespace_id: "31", simple: { limit: 100, period: 60 } },
              REQUEST_LIMIT: { namespace_id: "32", simple: { limit: 500, period: 60 } },
            },
            outboundService: async (req: Request) => {
              const url = new URL(req.url);
              assert.equal(url.origin, "https://slack.com");
              const path = url.pathname.replace("/api/", "");
              if (path === "openid.connect.token") {
                const part = (v: object) => btoa(JSON.stringify(v)).replace(/=+$/, "");
                return Response.json({
                  ok: true,
                  access_token: "synthetic-user-credential",
                  id_token: `${part({})}.${part({
                    iss: "https://slack.com",
                    aud: clientId,
                    exp: Math.floor(Date.now() / 1000) + 300,
                    nonce,
                    sub: "U00000007",
                    "https://slack.com/team_id": "T00000001",
                  })}.c2ln`,
                });
              }
              if (path === "auth.revoke") return Response.json({ ok: true });
              assert.equal(req.headers.get("authorization"), "Bearer synthetic-coffee-credential");
              if (path === "auth.test")
                return Response.json({ ok: true, team_id: "T00000001", user_id: "UBOT00001" });
              if (path === "users.info") {
                const id = url.searchParams.get("user")!;
                userLookups.push(id);
                return Response.json({
                  ok: true,
                  user: { id, team_id: "T00000001", deleted: false, is_bot: false, profile: { display_name: id === "U00000001" ? "Alice" : "Bob" } },
                });
              }
              if (path === "reactions.add") {
                reactionsAdded.push((await req.json()) as Record<string, unknown>);
                return Response.json({ ok: true });
              }
              if (path === "reactions.get")
                return Response.json({
                  ok: true,
                  type: "message",
                  channel: "C00000001",
                  message: {
                    ts: url.searchParams.get("timestamp"),
                    reactions: [{ name: "coffee", count: reactors.length, users: reactors }],
                  },
                });
              assert.equal(path, "chat.postMessage");
              const body = (await req.json()) as Record<string, unknown>;
              posts.push(body);
              if (postMode === "reject")
                return Response.json({ ok: false, error: "not_in_channel" });
              ts++;
              return Response.json({
                ok: true,
                channel: body.channel,
                ts: `${String(ts).slice(0, 10)}.${String(ts).slice(10)}`,
              });
            },
          },
        ],
      }),
    );
    const api = (cap: string, body?: object) =>
      mf.dispatchFetch("http://localhost/api/channel", {
        method: body ? "POST" : "GET",
        headers: {
          Origin: "http://127.0.0.1:5173",
          Authorization: `Bearer ${cap}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const status = async (cap: string, body?: object) => {
      const response = await api(cap, body);
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()) as ChannelCommandResult;
    };
    const navigate = (path: string, cookie?: string) =>
      mf.dispatchFetch(`http://localhost${path}`, {
        redirect: "manual",
        headers: cookie ? { Cookie: cookie } : {},
      });
    const bind = async (channel = "C00000001") => {
      const begin = await navigate(`/auth/slack/channel/${channel}`);
      assert.equal(begin.status, 303);
      const authorize = new URL(begin.headers.get("location")!);
      assert.equal(authorize.searchParams.get("client_id"), clientId);
      nonce = authorize.searchParams.get("nonce")!;
      return navigate(
        `/auth/slack/callback?code=synthetic-code&state=${authorize.searchParams.get("state")}`,
        begin.headers.get("set-cookie")!.split(";")[0],
      );
    };
    const slash = (fields: Record<string, string>, headers?: Record<string, string>) => {
      const body = slashBody(fields);
      return mf.dispatchFetch("http://localhost/slack/commands", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(headers ?? sign(body)),
        },
        body,
      });
    };
    try {
      // Not a member of the channel: nothing is stored, a clear reason is shown.
      postMode = "reject";
      const refused = await bind();
      assert.equal(refused.headers.get("location"), "http://127.0.0.1:5173/#/koffie-koppelen/not_in_channel");
      postMode = "success";
      const bound = await bind();
      assert.equal(bound.headers.get("referrer-policy"), "no-referrer");
      const landing = /^http:\/\/127\.0\.0\.1:5173\/#\/koffie-beheer\/([a-f0-9]{32}\.[a-f0-9]{64})\/([a-f0-9]{32}\.[a-f0-9]{64})$/.exec(
        bound.headers.get("location")!,
      );
      assert.ok(landing);
      const [, admin, requester] = landing;
      // The confirmation proves membership and carries only the request link.
      const confirmation = posts.at(-1)!;
      assert.equal(confirmation.channel, "C00000001");
      assert.ok(JSON.stringify(confirmation).includes(`#/koffie/${requester}`));
      assert.ok(!JSON.stringify(confirmation).includes(admin.split(".")[1]));

      const namespace = await mf.getDurableObjectNamespace("CHANNELS");
      const channel = namespace.get(namespace.idFromName(admin.split(".")[0])) as unknown as {
        stored(): Promise<string | null>;
        finishRound(): Promise<void>;
      };
      const stored = (await channel.stored())!;
      for (const secret of [admin.split(".")[1], requester.split(".")[1], "U00000007"])
        assert.ok(!stored.includes(secret));

      const initial = ((await status(requester)) as { status: Record<string, unknown> }).status;
      assert.deepEqual(
        { ...initial, expiresAt: undefined },
        { role: "requester", defaultMinutes: 5, roundsLeft: 20, expiresAt: undefined },
      );
      assert.ok(Date.parse(String(initial.expiresAt)) > Date.now() + 89 * 24 * 3600000);
      // Requesters cannot manage; unknown links, shapes and hosts are refused.
      for (const command of [{ type: "unbind" }, { type: "rotateRequestLink" }, { type: "setDefaultMinutes", minutes: 3 }])
        assert.equal((await api(requester, command)).status, 403);
      for (const command of [{ type: "requestRound", minutes: 0 }, { type: "requestRound", minutes: 31 }, { type: "requestRound", minutes: 5, winners: 2 }, { type: "drop" }])
        assert.equal((await api(requester, command)).status, 400, JSON.stringify(command));
      assert.equal((await api(`${admin.split(".")[0]}.${randomHex()}`)).status, 404);
      assert.equal((await api("one-two-three-four-five")).status, 404);

      // A round from the link: one call message, a prefilled ☕, a viewer-only session.
      const before = posts.length;
      const started = (await status(requester, { type: "requestRound", minutes: 5 })) as { status: { round: { startAt: string; spectatorCapability: string } } };
      const round = started.status.round;
      assert.ok(round);
      assert.equal(posts.length, before + 1);
      const call = posts.at(-1)!;
      assert.equal(call.channel, "C00000001");
      assert.equal(call.thread_ts, undefined);
      assert.ok(JSON.stringify(call.blocks).includes(`#/live/${round.spectatorCapability}`));
      assert.equal(reactionsAdded.length, 1);
      assert.equal(reactionsAdded[0].name, "coffee");
      const callTs = reactionsAdded[0].timestamp as string;
      assert.ok(Math.abs(Date.parse(round.startAt) - Date.now() - 5 * 60000) < 5000);

      // One round at a time, from either entry point.
      assert.equal((await api(requester, { type: "requestRound", minutes: 2 })).status, 409);
      const busy = (await (await slash({ text: "3" })).json()) as { response_type: string; text: string };
      assert.equal(busy.response_type, "ephemeral");
      assert.match(busy.text, /loopt al een koffieronde/);
      assert.equal(posts.length, before + 1);

      // Spectators see one wheel-to-be, the plan and no Slack details or host.
      const viewer = round.spectatorCapability;
      const snapshot = async () => {
        const r = await mf.dispatchFetch("http://localhost/api/session", {
          headers: { Origin: "http://127.0.0.1:5173", Authorization: `Bearer ${viewer}` },
        });
        assert.equal(r.status, 200);
        return ((await r.json()) as { session: PublicBeerWheelSession; role: string });
      };
      const first = await snapshot();
      assert.equal(first.role, "spectator");
      assert.equal(first.session.variant, "coffee");
      assert.equal(first.session.scheduledDraw?.startAt, round.startAt);
      assert.equal(first.session.slack, undefined);
      const sessions = await mf.getDurableObjectNamespace("SESSIONS");
      const session = sessions.get(sessions.idFromName(await wordLocator(viewer))) as unknown as {
        stored(): Promise<string>;
        due(): Promise<void>;
        postNow(): Promise<void>;
        land(): Promise<void>;
      };
      // The final check reads ☕ reactions; the bot's own never counts or is looked up.
      await session.due();
      const drawn = await snapshot();
      assert.equal(drawn.session.participants.length, 2);
      assert.equal(drawn.session.winnerCount, 1);
      assert.equal(drawn.session.activeDraw?.spins.length, 1);
      assert.ok(!userLookups.includes("UBOT00001"));
      assert.ok(!JSON.stringify(drawn).includes("U0000000"));
      await session.postNow();
      const result = posts.at(-1)!;
      assert.equal(result.thread_ts, callTs);
      assert.equal(result.reply_broadcast, false);
      assert.match(String(result.text), /Jij mag koffie halen!/);
      assert.ok(/"user_id":"U0000000[12]"/.test(JSON.stringify(result.blocks)));

      // While the wheel still spins, the round keeps blocking the next one.
      assert.equal((await api(requester, { type: "requestRound", minutes: 2 })).status, 409);
      // Once it has stopped, a new round can start right away, well before the watch window ends.
      await session.land();
      assert.equal(((await status(requester)) as { status: { round?: object } }).status.round, undefined);
      const reply = (await (await slash({ text: "2" })).json()) as { text: string };
      assert.match(reply.text, /Gelukt!/);
      assert.equal(posts.at(-1)!.channel, "C00000001");
      assert.equal(reactionsAdded.length, 2);
      // The new round replaced the old raw spectator link; after its window the next one is wiped too.
      assert.ok(!(await channel.stored())!.includes(viewer));
      assert.ok(((await status(requester)) as { status: { round?: object } }).status.round);
      await channel.finishRound();
      assert.ok(!(await channel.stored())!.includes('"round"'));
      assert.equal(((await status(requester)) as { status: { round?: object } }).status.round, undefined);

      // Forged, stale or unknown slash commands do nothing.
      const count = posts.length;
      assert.equal((await slash({}, { "X-Slack-Request-Timestamp": String(Math.floor(Date.now() / 1000)), "X-Slack-Signature": `v0=${"0".repeat(64)}` })).status, 401);
      assert.equal((await slash({}, sign(slashBody({}), Math.floor(Date.now() / 1000) - 600))).status, 401);
      const unbound = (await (await slash({ channel_id: "C00000009" })).json()) as { text: string };
      assert.match(unbound.text, /nog geen Koffierad/);
      assert.equal(posts.length, count);

      // Admin: default minutes, rotation invalidates the old request link, unbind removes everything.
      assert.equal(((await status(admin, { type: "setDefaultMinutes", minutes: 10 })) as { status: { defaultMinutes: number } }).status.defaultMinutes, 10);
      const rotated = (await status(admin, { type: "rotateRequestLink" })) as { requestCapability: string };
      assert.equal((await api(requester)).status, 404);
      assert.equal(((await status(rotated.requestCapability)) as { status: { role: string } }).status.role, "requester");
      assert.deepEqual(await status(admin, { type: "unbind" }), { type: "unbound" });
      assert.equal((await api(admin)).status, 404);
      assert.equal((await api(rotated.requestCapability)).status, 404);
      assert.equal(await channel.stored(), null);
    } finally {
      await mf.dispose();
    }
  },
);
