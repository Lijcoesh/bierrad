import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ChannelApiError,
  channelRequest,
  parseChannelRoute,
} from "../sessions/ChannelClient";

const cap = `${"a".repeat(32)}.${"b".repeat(64)}`;
const other = `${"c".repeat(32)}.${"d".repeat(64)}`;

test("channel routes accept only exact fragments with hex capabilities", () => {
  assert.deepEqual(parseChannelRoute("#/koffie-koppelen"), { page: "bind" });
  assert.deepEqual(parseChannelRoute("#/koffie-koppelen/not_in_channel"), {
    page: "bind",
    failure: "not_in_channel",
  });
  assert.deepEqual(parseChannelRoute(`#/koffie/${cap}`), {
    page: "wheel",
    capability: cap,
  });
  assert.deepEqual(parseChannelRoute(`#/koffie-beheer/${cap}/${other}`), {
    page: "wheel",
    capability: cap,
    requestCapability: other,
  });
  for (const hash of [
    "#/koffie-koppelen/other",
    `#/koffie/${cap}/extra`,
    "#/koffie/one-two-three-four-five",
    `#/koffie-beheer/${cap}`,
    "#/coffee",
  ])
    assert.equal(parseChannelRoute(hash), null, hash);
});

test("channel client sends the capability only as a bearer header, never stores it", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init: init! });
    return Response.json({
      type: "status",
      status: { role: "requester", defaultMinutes: 5, roundsLeft: 20, expiresAt: "2027-01-01T00:00:00.000Z" },
    });
  }) as typeof fetch;
  const result = await channelRequest("https://api.example.test", cap, { type: "requestRound", minutes: 5 }, fetcher);
  assert.equal(result.type, "status");
  assert.equal(seen[0].url, "https://api.example.test/api/channel");
  assert.ok(!seen[0].url.includes(cap));
  assert.equal(new Headers(seen[0].init.headers).get("authorization"), `Bearer ${cap}`);
  assert.equal(seen[0].init.credentials, "omit");
  assert.equal(seen[0].init.referrerPolicy, "no-referrer");
  assert.equal(seen[0].init.body, JSON.stringify({ type: "requestRound", minutes: 5 }));
});

test("channel errors become friendly Dutch messages without server details", async () => {
  const failing = (status: number, body: unknown) =>
    (async () => Response.json(body, { status })) as unknown as typeof fetch;
  await assert.rejects(
    channelRequest("https://api.example.test", cap, undefined, failing(409, { code: "round_active" })),
    (e: unknown) => e instanceof ChannelApiError && e.code === "round_active" && /koffieronde/.test(e.message),
  );
  await assert.rejects(
    channelRequest("https://api.example.test", cap, undefined, failing(500, { stack: "secret" })),
    (e: unknown) => e instanceof ChannelApiError && !e.message.includes("secret"),
  );
});
