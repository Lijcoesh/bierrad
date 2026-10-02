# Mandatory security and privacy constraints

These requirements apply to code, infrastructure, tests, documentation, CI and local development. Security takes precedence over implementation convenience. The original briefing is retained in `docs/security-guardrails.md`.

## Trust boundary and secrets

GitHub, Git history, Pages, source maps, frontend bundles, browser storage, network addresses and every `VITE_*` value are public/untrusted. Browsers and WebSocket messages are untrusted input. Server authority and service credentials belong behind the Cloudflare boundary. Never ship or commit Slack tokens, OAuth secrets, private API keys, Cloudflare credentials, signing/encryption keys, database/service-account credentials or webhook secrets, including in tests, examples, comments or builds. Use server secret management. Only public endpoint configuration belongs in Vite or Pages CI.

## Temporary access

Live participant data requires a valid, unexpired, scoped capability on every access. Use separate cryptographically random host and spectator capabilities (at least 128 bits), unrelated to names, timestamps or Slack identifiers. An internal ID is not authorization. Store hashes instead of raw capabilities where practical. Capabilities are bearer access, not user identity: anyone holding a link can use its rights until expiry or revocation. Support revocation where practical. Never create public session listings or a global participant endpoint.

Starting a Slack session requires server-side Sign in with Slack (OpenID Connect authorization code flow; requested by the user on 2026-10-02). Bind each attempt to the browser with a short-lived host-only HttpOnly Secure SameSite=Lax cookie holding random `state` and `nonce`; verify state, issuer, audience, expiry, nonce and workspace; keep the client secret server-side and out of URLs. Only full members of the bot's own workspace may start (no guests, external, bot, app or deleted accounts). Revoke the user token immediately and never store Slack identities, profiles or tokens with the session. Login redirects return capabilities only in URL fragments and send no referrer. A login-started session has a fixed Slack ceiling of 30 days plus one hour from its start and loses Slack rights when login, bot or client secrets are removed. Start-link grants are no longer accepted: only sessions started through Sign in with Slack hold Slack rights; any other stored grant fails closed.

Host mutations require server-side authorization, including manually crafted HTTP and WebSocket requests. Spectators only view. The server determines participants, winner count, timing, unique winners, DrawInstruction and reset. Never accept client-supplied official results. Every input requires server validation, size limits and safe error handling. CORS is an explicit allowlist, never an authorization mechanism. Session creation, mutations and draws require abuse controls with honest documentation of limitations.

## Privacy and retention

Default live TTL is 24 hours. At the explicit host request to schedule a draw, an unexpired session may be extended to the scheduled start plus one hour (never shortened); scheduling is bounded to 30 days ahead. Slack sessions may not be extended beyond their currently validated grant expiry or login ceiling. This retention change was explicitly requested by the user on 2026-10-02. Expired sessions must never be revived. Enforce expiry on every server access and socket delivery, invalidate/close sockets and delete expired application state. Never return expired participants. No permanent directory or identifiable history without a separate privacy review. Send explicit allowlisted DTOs with session-scoped participant IDs and display names; never serialize private server models, hashes, credentials or unnecessary Slack IDs. Collect only necessary data. No real employee names, email addresses, Slack messages/IDs, internal URLs, company information or webhooks in repository fixtures; use synthetic data.

Slack remains server-only, with minimal documented scopes when implemented. No browser Slack credentials. Scheduling must use the same authoritative draw operation.

Spectator-link reminder (explicitly requested by the user on 2026-10-02): when scheduling a draw in a Slack-linked session, the host may opt in to have the server post the session's spectator link in the source Slack thread shortly before the start (two minutes, or immediately for shorter plans). This deliberately gives view access to everyone who can read that thread, including Slack Connect members, until the session expires; the host UI says so. The host's browser supplies its own spectator capability; the server only accepts it after matching the session locator and the stored spectator hash, never accepts other links or text, and builds the URL from the server-configured `FRONTEND_URL` with the capability in the fragment only. The raw spectator capability is the one exception to hash-only storage: it is kept server-side only while that reminder can still be posted and is deleted when it settles, is cancelled or replaced, on draw, reset, manual mode and expiry. It never appears in DTOs, logs or errors. Posts are unfurl-free, never broadcast, claimed before I/O, never repeated when delivery is uncertain, retried at most once after a definite rejection, and capped per session.

## Browser, transport and output

Production uses HTTPS/WSS. Treat names as text; never use unsafe HTML rendering. Never store credentials/capabilities in localStorage, sessionStorage, IndexedDB or JavaScript-accessible cookies. Standalone manually entered names and harmless preferences may remain local; live/Slack rosters must never be automatically stored there.

Prevent capability leakage through URLs sent to third parties, referrers, logs, analytics, screenshots and error messages. Private responses require no-store, noindex and no-referrer controls where supported; document static-host limitations. Review CSP and third-party resource use. Do not add analytics to private views without review. Never log authorization headers, capabilities, full capability-bearing URLs, secrets or environment dumps. Minimize participant data in diagnostics. Errors must not disclose stack traces, private configuration or authorization internals.

## Repository and verification

Ignore local environment/secrets files including `.env`, `.env.local`, `.env.*.local` and `.dev.vars*`; allow placeholder-only `.env.example`. Minimize and review dependencies. No private session data may go to unrelated services. If a credential is discovered, report only its location/type/tracked status; revoke/rotate, investigate and clean history as appropriate. Deleting a line does not remedy exposure.

Changes to APIs, sessions, integrations, authorization, infrastructure or CI require an explicit review against this document, tests, type checking, configured linting, production builds, diff review and searches for credentials, company/employee data and unsafe Vite variables. Report unresolved constraints; never silently weaken them.

> Assume GitHub, GitHub Pages and every browser are completely public and untrusted.
>
> Credentials and privileged operations belong behind the server-side security boundary.
>
> Employee data is only exposed to authorized temporary sessions, using high-entropy, scoped, expiring capabilities.
