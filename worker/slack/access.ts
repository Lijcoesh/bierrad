import type { WheelVariant } from "../../shared/variant";
import {
  MAX_SCHEDULE_AHEAD_MS,
  SCHEDULE_RETENTION_MS,
} from "../../shared/retention";
/** Optional server-only secrets; deliberately absent from Vite and public config. */
export interface SlackSecrets {
  COFFEE_SLACK_BOT_TOKEN?: string;
  COFFEE_SLACK_CLIENT_ID?: string;
  COFFEE_SLACK_CLIENT_SECRET?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
}
/** The grant marker stored on every login-started Slack session. */
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
/** Only login-started sessions hold Slack rights; anything else fails closed. */
export function slackAllowed(
  hash: string | undefined,
  env: SlackSecrets,
): boolean {
  return hash === LOGIN_GRANT && loginConfigured(env);
}
/** Revalidated scheduling ceiling, or undefined when Slack access is gone. */
export function slackCeiling(
  slack: { grantHash: string; grantExpiresAt?: number },
  env: SlackSecrets,
): number | undefined {
  return slackAllowed(slack.grantHash, env) ? slack.grantExpiresAt : undefined;
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
      }
    : {
        SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN,
        SLACK_CLIENT_ID: env.SLACK_CLIENT_ID,
        SLACK_CLIENT_SECRET: env.SLACK_CLIENT_SECRET,
      };
}
