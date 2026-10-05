/** Public contract for channel-bound Koffierad wheels. No secrets or Slack IDs. */
export const ROUND_MINUTE_CHOICES = [1, 2, 3, 5, 10, 15] as const;
export const DEFAULT_ROUND_MINUTES = 5;
export const MAX_ROUND_MINUTES = 30;
/** Rounds per channel per rolling 24 hours. */
export const MAX_ROUNDS_PER_DAY = 20;
/** A binding is removed after this long without a bind or round request. */
export const CHANNEL_IDLE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * The latest round while it can still be watched; `active` until its draw is
 * over, after which a new round may be requested.
 */
export interface ChannelRound {
  startAt: string;
  spectatorCapability: string;
  active: boolean;
}
export interface ChannelStatus {
  role: "admin" | "requester";
  defaultMinutes: number;
  round?: ChannelRound;
  roundsLeft: number;
  expiresAt: string;
  /** View-only word link of the channel, easy to type on another screen. */
  viewerCapability?: string;
}
export type ChannelCommand =
  | { type: "requestRound"; minutes: number }
  | { type: "setDefaultMinutes"; minutes: number }
  | { type: "rotateRequestLink" }
  | { type: "unbind" };
export type ChannelCommandResult =
  | { type: "status"; status: ChannelStatus }
  | { type: "rotated"; requestCapability: string; status: ChannelStatus }
  | { type: "unbound" }
  /** All a view-only word link gets: the latest round, no commands. */
  | { type: "view"; round?: ChannelRound };

export function validRoundMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_ROUND_MINUTES
  );
}
/**
 * Accepts a Slack channel or message link, or a bare public/private channel ID.
 * Only the ID is used; the link itself is never fetched.
 */
export function parseChannelInput(raw: string): string | null {
  const value = raw.trim();
  if (value.length > 1024) return null;
  if (/^[CG][A-Z0-9]{8,20}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9][a-z0-9-]*\.slack\.com$/.test(url.hostname)
    )
      return null;
    const match = /^\/(?:archives|client\/T[A-Z0-9]{8,20})\/([CG][A-Z0-9]{8,20})(?:\/|$)/.exec(
      url.pathname,
    );
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
