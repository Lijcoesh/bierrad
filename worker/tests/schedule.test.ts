import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newSession,
  mutate,
  executeScheduledDraw,
  nextDeadline,
  publicSession,
} from "../session";

const now = Date.parse("2026-10-02T12:00:00Z");
const setup = () => {
  const r = newSession("host", "viewer", now);
  mutate(
    r,
    "host",
    { type: "setParticipants", names: ["Alice", "Bob"], revision: r.revision },
    now,
  );
  return r;
};
test("schedule is host-only, strictly validated, temporary and cancellable", () => {
  const r = setup();
  const command = (startAt: unknown) => ({
    type: "setScheduledDraw",
    startAt,
    revision: r.revision,
  });
  for (const at of [
    undefined,
    1,
    "bad",
    new Date(now).toISOString(),
    new Date(r.expiresAt - 5000).toISOString(),
  ])
    assert.throws(() => mutate(r, "host", command(at), now));
  const at = new Date(now + 60000).toISOString();
  assert.throws(() => mutate(r, "spectator", command(at), now));
  assert.throws(() => mutate(r, "host", { ...command(at), repeat: true }, now));
  mutate(r, "host", command(at), now);
  assert.equal(nextDeadline(r), now + 58000);
  assert.deepEqual(publicSession(r).scheduledDraw, {
    startAt: at,
    status: "pending",
  });
  mutate(r, "host", command(null), now);
  assert.equal(r.scheduledDraw, undefined);
  assert.equal(nextDeadline(r), r.expiresAt);
});
test("automatic start uses the common draw operation exactly once and queues the official Slack result", () => {
  const r = setup();
  r.slack = {
    grantHash: "synthetic",
    mapping: {},
    source: {
      channelId: "C00000001",
      parentMessageTs: "1234567890.123456",
      reactionName: "beers",
    },
  };
  r.scheduledDraw = {
    startAt: new Date(now + 60000).toISOString(),
    status: "refreshing",
  };
  r.scheduleCheckUntil = now + 120000;
  assert.throws(() =>
    mutate(
      r,
      "host",
      { type: "setParticipants", names: [], revision: r.revision },
      now,
    ),
  );
  executeScheduledDraw(r, now + 58000, true);
  const draw = structuredClone(r.session.activeDraw);
  assert.ok(draw);
  assert.equal(r.session.state, "countdown");
  assert.equal(draw.startAt, new Date(now + 60000).toISOString());
  assert.equal(new Set(draw.spins.map((s) => s.winnerId)).size, 2);
  assert.equal(r.slack.job?.drawId, draw.id);
  assert.equal(r.scheduledDraw, undefined);
  assert.equal(r.scheduleCheckUntil, undefined);
  executeScheduledDraw(r, now + 59000, true);
  assert.deepEqual(r.session.activeDraw, draw);
});
test("failed refresh, no participants, expiry and manual actions never trigger a stale or second scheduled draw", () => {
  for (const mode of ["failed", "empty", "expired", "busy"]) {
    const r = setup();
    if (mode === "empty") r.session.participants = [];
    if (mode === "expired") r.expiresAt = now;
    if (mode === "busy")
      r.slack = {
        grantHash: "synthetic",
        mapping: {},
        importing: { id: "lease", until: now + 120000 },
      };
    r.scheduledDraw = {
      startAt: new Date(now).toISOString(),
      status: "refreshing",
    };
    executeScheduledDraw(r, now, mode !== "failed");
    assert.equal(r.session.activeDraw, undefined);
    if (mode !== "expired") assert.equal(r.scheduledDraw.status, "skipped");
  }
  for (const type of ["reset", "startDraw"]) {
    const r = setup();
    r.scheduledDraw = {
      startAt: new Date(now + 60000).toISOString(),
      status: "pending",
    };
    mutate(r, "host", { type, revision: r.revision }, now);
    assert.equal(r.scheduledDraw, undefined);
  }
});
