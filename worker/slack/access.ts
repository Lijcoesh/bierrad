import type { WheelVariant } from "../../shared/variant";
import {
  MAX_SCHEDULE_AHEAD_MS,
  SCHEDULE_RETENTION_MS,
} from "../../shared/retention";
import { equalHash } from "../auth";
/** Optional server-only secrets; deliberately absent from Vite and public config. */
export interface SlackSecrets {
  COFFEE_SLACK_BOT_TOKEN?: string;
  COFFEE_SLACK_CLIENT_ID?: string;
  COFFEE_SLACK_CLIENT_SECRET?: string;
  COFFEE_SLACK_START_GRANT?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  SLACK_START_GRANT?: string;
}
/** Stored instead of a start-grant hash; never equal to a 64-hex hash. */
export const LOGIN_GRANT = "slack-login";
/** Fixed at creation: a full 30-day schedule plus its retention hour. */
export const LOGIN_CEILING_MS = MAX_SCHEDULE_AHEAD_MS + SCHEDULE_RETENTION_MS;
export function loginConfigured(env: SlackSecrets): boolean {
  return (
    !!env.SLACK_BOT_TOKEN &&
    !!env.SLACK_CLIENT_SECRET &&
    /^\d{1,20}\.\d{1,20}$/.test(env.SLACK_CLIENT_ID ?? "")
  );
}
/**
 * Legacy start-link grants. New grants can no longer be used to start sessions;
 * this only keeps sessions started before Sign in with Slack working until
 * their grant expires or SLACK_START_GRANT is deleted.
 */
export function currentGrant(
  env: SlackSecrets,
  now = Date.now(),
): { hash: string; expiresAt: number } | undefined {
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_START_GRANT) return;
  try {
    const grant = JSON.parse(env.SLACK_START_GRANT);
    if (
      /^[a-f0-9]{64}$/.test(grant.hash) &&
      Number.isSafeInteger(grant.expiresAt) &&
      grant.expiresAt > now
    )
      return { hash: grant.hash, expiresAt: grant.expiresAt };
  } catch {
    /* Misconfigured secrets fail closed. */
  }
}
export function slackAllowed(
  hash: string | undefined,
  env: SlackSecrets,
): boolean {
  if (hash === LOGIN_GRANT) return loginConfigured(env);
  const grant = currentGrant(env);
  return !!hash && !!grant && equalHash(hash, grant.hash);
}
/** Revalidated scheduling ceiling, or undefined when Slack access is gone. */
export function slackCeiling(
  slack: { grantHash: string; grantExpiresAt?: number },
  env: SlackSecrets,
): number | undefined {
  if (slack.grantHash === LOGIN_GRANT)
    return loginConfigured(env) ? slack.grantExpiresAt : undefined;
  const grant = currentGrant(env);
  return grant && equalHash(grant.hash, slack.grantHash)
    ? grant.expiresAt
    : undefined;
}

export function slackEnvironment(
  env: SlackSecrets,
  variant: WheelVariant = "beer",
): SlackSecrets {
  return variant === "coffee"
    ? {
        SLACK_BOT_TOKEN: env.COFFEE_SLACK_BOT_TOKEN,
        SLACK_CLIENT_ID: env.COFFEE_SLACK_CLIENT_ID,
        SLACK_CLIENT_SECRET: env.COFFEE_SLACK_CLIENT_SECRET,
        SLACK_START_GRANT: env.COFFEE_SLACK_START_GRANT,
      }
    : {
        SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN,
        SLACK_CLIENT_ID: env.SLACK_CLIENT_ID,
        SLACK_CLIENT_SECRET: env.SLACK_CLIENT_SECRET,
        SLACK_START_GRANT: env.SLACK_START_GRANT,
      };
}
