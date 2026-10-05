import { equalHash, hashSecret } from "../auth";
/**
 * `/koffierad` slash commands. Slack signs every request with the Koffierad
 * app's signing secret; the signature is the only authorization.
 * https://docs.slack.dev/authentication/verifying-requests-from-slack/
 */
export const SLASH_COMMAND = "/koffierad";
const MAX_BODY_BYTES = 8192;
const MAX_SKEW_S = 300;

export class SlashError extends Error {}
/** Reads the raw form body with a byte bound; the signature covers these exact bytes. */
export async function readSlashBody(request: Request): Promise<string> {
  if (
    request.method !== "POST" ||
    !request.headers
      .get("Content-Type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    throw new SlashError("invalid");
  const reader = request.body?.getReader();
  if (!reader) throw new SlashError("invalid");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new SlashError("invalid");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
    all,
  );
}
export async function verifySlackSignature(
  secret: string | undefined,
  headers: Headers,
  body: string,
  now = Date.now(),
): Promise<boolean> {
  if (!secret) return false;
  const timestamp = headers.get("X-Slack-Request-Timestamp") ?? "";
  const signature = headers.get("X-Slack-Signature") ?? "";
  if (
    !/^\d{1,12}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_S ||
    !/^v0=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${timestamp}:${body}`),
  );
  const expected =
    "v0=" +
    Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
  // Compare digests of equal length so timing reveals nothing about the MAC.
  return equalHash(await hashSecret(expected), await hashSecret(signature));
}
export type SlashRequest =
  | { kind: "help" }
  | { kind: "invalid" }
  | { kind: "wrongChannel" }
  | { kind: "round"; channelId: string; userId: string; minutes?: number };
export function parseSlashCommand(body: string): SlashRequest {
  const params = new URLSearchParams(body);
  const one = (key: string) =>
    params.getAll(key).length === 1 ? params.get(key)! : undefined;
  const userId = one("user_id");
  const channelId = one("channel_id");
  const text = (one("text") ?? "").trim();
  if (
    one("command") !== SLASH_COMMAND ||
    !userId ||
    !/^[UW][A-Z0-9]{8,20}$/.test(userId) ||
    !channelId ||
    channelId.length > 32 ||
    text.length > 32
  )
    return { kind: "invalid" };
  if (!/^[CG][A-Z0-9]{8,20}$/.test(channelId)) return { kind: "wrongChannel" };
  if (/^(help|hulp|\?)$/i.test(text)) return { kind: "help" };
  if (!text) return { kind: "round", channelId, userId };
  const match = /^(\d{1,2})\s*(m|min|minuut|minuten)?$/i.exec(text);
  return match
    ? { kind: "round", channelId, userId, minutes: Number(match[1]) }
    : { kind: "help" };
}
/** Only the person who typed the command sees this reply. */
export function ephemeral(text: string): Response {
  return Response.json(
    { response_type: "ephemeral", text },
    {
      headers: {
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
export const SLASH_HELP =
  "☕ Gebruik `/koffierad` om een koffieronde te starten met de standaardwachttijd van dit kanaal, of `/koffierad 10` om het rad na 1 tot 30 minuten te laten draaien.";
