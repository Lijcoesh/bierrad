import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amsterdamInput,
  parseAmsterdamInput,
  nextFridayInput,
} from "../utils/schedule";
import {
  startSlackAutoRefresh,
  SLACK_REFRESH_MS,
} from "../utils/slackAutoRefresh";
import type { SlackHostStatus } from "../../shared/protocol";

test("Friday default and Dutch date conversion are independent of browser timezone and follow DST", () => {
  assert.equal(
    nextFridayInput(Date.parse("2026-10-02T10:00:00Z")),
    "2026-10-02T15:45",
  );
  assert.equal(
    nextFridayInput(Date.parse("2026-10-02T14:00:00Z")),
    "2026-10-09T15:45",
  );
  assert.equal(
    new Date(parseAmsterdamInput("2026-10-02T15:45")).toISOString(),
    "2026-10-02T13:45:00.000Z",
  );
  assert.equal(
    new Date(parseAmsterdamInput("2026-10-30T15:45")).toISOString(),
    "2026-10-30T14:45:00.000Z",
  );
  assert.equal(
    amsterdamInput(Date.parse("2026-10-30T14:45:00Z")),
    "2026-10-30T15:45",
  );
  for (const value of ["", "bad", "2026-03-29T02:30", "2026-02-30T15:45"])
    assert.ok(Number.isNaN(parseAmsterdamInput(value)));
});

test("auto refresh runs every five minutes, pauses safely, avoids overlap and cleans up", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1000000 });
  let calls = 0,
    errors = 0,
    locked = false,
    scheduledStartAt: string | undefined;
  let status: SlackHostStatus = {
    enabled: true,
    importing: false,
    source: "slack",
  };
  let release: (() => void) | undefined;
  const stop = startSlackAutoRefresh(
    () => ({ status, locked, scheduledStartAt }),
    async () => {
      calls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    () => {
      errors++;
    },
  );
  t.mock.timers.tick(SLACK_REFRESH_MS - 1);
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  assert.equal(calls, 1);
  t.mock.timers.tick(SLACK_REFRESH_MS);
  assert.equal(calls, 1);
  release!();
  await new Promise<void>((resolve) =>
    queueMicrotask(() => queueMicrotask(resolve)),
  );
  locked = true;
  t.mock.timers.tick(SLACK_REFRESH_MS);
  assert.equal(calls, 1);
  locked = false;
  status = { ...status, syncedAt: new Date(Date.now() + 1).toISOString() };
  t.mock.timers.tick(SLACK_REFRESH_MS);
  assert.equal(calls, 1);
  status = { ...status, syncedAt: undefined, enabled: false };
  t.mock.timers.tick(SLACK_REFRESH_MS);
  assert.equal(calls, 1);
  status = { ...status, enabled: true };
  scheduledStartAt = new Date(
    Date.now() + SLACK_REFRESH_MS + 60000,
  ).toISOString();
  t.mock.timers.tick(SLACK_REFRESH_MS);
  assert.equal(calls, 1);
  scheduledStartAt = undefined;
  t.mock.timers.tick(SLACK_REFRESH_MS);
  assert.equal(calls, 2);
  stop();
  release!();
  t.mock.timers.tick(SLACK_REFRESH_MS * 3);
  assert.equal(calls, 2);
  assert.equal(errors, 0);
});

test("schedule button stays available when the selected start is after the old session expiry", async (t) => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ScheduleControls } = await import("../components/ScheduleControls");
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-02T10:00:00Z"),
  });
  const html = renderToStaticMarkup(
    createElement(ScheduleControls, {
      expiresAt: "2026-10-02T12:27:00Z",
      locked: false,
      async onSave() {},
    }),
  );
  assert.match(html, /2026-10-02T15:45/);
  assert.match(html, /verlengen we deze sessie/);
  assert.match(html, /16:45/);
  assert.doesNotMatch(html, /<button[^>]*disabled/);
});
