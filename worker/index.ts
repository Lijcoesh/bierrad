import { isWheelVariant } from "../shared/variant";
import type { WheelVariant } from "../shared/variant";
import type { CreatedSession } from "../shared/protocol";
import {
  LOGIN_CEILING_MS,
  LOGIN_GRANT,
  slackEnvironment,
  type SlackSecrets,
} from "./slack/access";
import {
  beginLogin,
  completeLogin,
  loginCookie,
  LoginError,
  parseLoginCookie,
} from "./slack/login";
import { randomHex, parseCapability, hashSecret } from "./auth";
import { json, readBody, redirect } from "./http";
import { RequestError } from "./session";
export { LiveSession } from "./live-session";

type WorkerEnv = Env & SlackSecrets;
async function createSession(
  env: WorkerEnv,
  variant: WheelVariant,
  grant?: { hash: string; expiresAt: number },
): Promise<CreatedSession> {
  const locator = randomHex(16),
    host = randomHex(),
    spectator = randomHex();
  const [hostHash, spectatorHash] = await Promise.all([
    hashSecret(host),
    hashSecret(spectator),
  ]);
  const expiresAt = await env.SESSIONS.getByName(locator).initialize(
    hostHash,
    spectatorHash,
    grant,
    variant,
  );
  return {
    hostCapability: `${locator}.${host}`,
    spectatorCapability: `${locator}.${spectator}`,
    expiresAt,
  };
}
async function creationAllowed(env: WorkerEnv, ip: string) {
  return (
    (await env.CREATION_LIMIT.limit({ key: ip })).success &&
    (await env.CREATION_GLOBAL.limit({ key: "creation" })).success
  );
}
function frontend(env: WorkerEnv): URL | undefined {
  try {
    const url = new URL(env.FRONTEND_URL);
    if (
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      !env.ALLOWED_ORIGINS.split(",").includes(url.origin)
    )
      return;
    return url;
  } catch {
    return;
  }
}
/**
 * Top-level browser navigations for Sign in with Slack. These carry no Origin
 * header and the callback needs a query, so they bypass the API gate below and
 * only ever answer with redirects; capabilities go into the URL fragment only.
 */
async function slackAuth(
  request: Request,
  env: WorkerEnv,
  url: URL,
): Promise<Response> {
  const app = frontend(env);
  if (!app) return json({ code: "unavailable" }, 503);
  const callback = `${url.origin}/auth/slack/callback`;
  const pending = parseLoginCookie(request.headers.get("Cookie"));
  const start = /^\/auth\/slack\/(beer|coffee)$/.exec(url.pathname);
  let variant: WheelVariant = start
    ? (start[1] as WheelVariant)
    : (pending?.variant ?? "beer");
  const clear = loginCookie("", 0);
  const fail = (reason: string) =>
    redirect(
      `${app.href}#/${variant === "coffee" ? "coffee-" : ""}slack/${reason}`,
      clear,
    );
  try {
    if (request.method !== "GET") return json({ code: "invalid" }, 405);
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    if (!(await env.REQUEST_LIMIT.limit({ key: ip })).success)
      return fail("busy");
    if (start) {
      if (url.search) return fail("expired");
      const login = beginLogin(
        slackEnvironment(env, variant),
        variant,
        callback,
      );
      return redirect(login.location, login.cookie);
    }
    if (url.pathname !== "/auth/slack/callback") return fail("expired");
    if (!pending) return fail("expired");
    variant = pending.variant;
    // Before any Slack call: failed attempts also spend the creation budget.
    if (!(await creationAllowed(env, ip))) return fail("busy");
    await completeLogin(
      slackEnvironment(env, variant),
      pending,
      url.searchParams,
      callback,
    );
    const created = await createSession(env, variant, {
      hash: LOGIN_GRANT,
      expiresAt: Date.now() + LOGIN_CEILING_MS,
    });
    return redirect(
      `${app.href}#/host/${created.hostCapability}/${created.spectatorCapability}`,
      clear,
    );
  } catch (error) {
    return fail(error instanceof LoginError ? error.reason : "unavailable");
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowed = env.ALLOWED_ORIGINS.split(",");
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/slack/"))
      return slackAuth(request, env, url);
    let response: Response;
    try {
      if (!origin || !allowed.includes(origin))
        throw new RequestError(403, "forbidden");
      if (url.search) throw new RequestError(400, "invalid");
      if (request.method === "OPTIONS") {
        response = new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Max-Age": "600",
            "Cache-Control": "no-store",
          },
        });
      } else {
        const ip = request.headers.get("CF-Connecting-IP") ?? "local";
        if (!(await env.REQUEST_LIMIT.limit({ key: ip })).success)
          throw new RequestError(429, "rate_limited");
        if (url.pathname === "/api/sessions" && request.method === "POST") {
          if (!(await creationAllowed(env, ip)))
            throw new RequestError(429, "rate_limited");
          const body = await readBody(request);
          if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body) ||
            Object.keys(body).some((key) => key !== "variant") ||
            ("variant" in body && !isWheelVariant(body.variant))
          )
            throw new RequestError(400, "invalid");
          const variant =
            "variant" in body && isWheelVariant(body.variant)
              ? body.variant
              : "beer";
          response = json(await createSession(env, variant), 201);
        } else if (
          ["/api/session", "/api/command", "/api/socket"].includes(url.pathname)
        ) {
          const socket = url.pathname === "/api/socket";
          if (
            socket || url.pathname === "/api/session"
              ? request.method !== "GET"
              : request.method !== "POST"
          )
            throw new RequestError(405, "invalid");
          const protocols =
            request.headers
              .get("Sec-WebSocket-Protocol")
              ?.split(",")
              .map((p) => p.trim()) ?? [];
          const raw = socket
            ? (protocols.find((p) => p.startsWith("auth."))?.slice(5) ?? null)
            : (request.headers.get("Authorization")?.replace(/^Bearer /, "") ??
              null);
          const capability = parseCapability(raw);
          if (!capability) throw new RequestError(404, "unavailable");
          const stub = env.SESSIONS.getByName(capability.locator);
          if (socket) {
            if (
              request.headers.get("Upgrade")?.toLowerCase() !== "websocket" ||
              !protocols.includes("bierrad")
            )
              throw new RequestError(400, "invalid");
            response = await stub.fetch(request);
          } else {
            const command =
              url.pathname === "/api/command" ? await readBody(request) : null;
            response = await stub.access(capability.secret, command);
          }
        } else throw new RequestError(404, "unavailable");
      }
    } catch (error) {
      response = json(
        { code: error instanceof RequestError ? error.code : "unavailable" },
        error instanceof RequestError ? error.status : 503,
      );
    }
    // Fetch/RPC responses may have immutable headers. Preserve the upgrade socket.
    response = new Response(response.body, {
      status: response.status,
      headers: new Headers(response.headers),
      ...(response.webSocket ? { webSocket: response.webSocket } : {}),
    });
    if (origin && allowed.includes(origin))
      response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
    return response;
  },
} satisfies ExportedHandler<WorkerEnv>;
