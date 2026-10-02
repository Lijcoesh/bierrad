# Slack security review — 2026-09-25

Reviewed against every section of SECURITY.md. Slack was explicitly requested; scheduling remains out of scope.

## Authorization and trust boundary

Public hosts cannot use the workspace bot. A separate random 256-bit expiring startcapability authorizes Slack session creation. Only its SHA-256 hash/expiry is stored in the Worker secret SLACK_START_GRANT. A session keeps its grant hash privately. Import and sending recheck that the grant is current and the bot configured; rotating/deleting the grant disables subsequent Slack operations for old sessions. Session expiry is at most eight hours and never exceeds grant expiry. The grant is a shared organizer permission, not per-user Slack authorization: any organizer with it can import a permalink accessible to the bot. Restrict bot conversation membership accordingly. No general public Slack proxy, public roster/list endpoint, or public source attachment.

Host and spectator capability checks, exact Origin allowlist, request size/creation/mutation limits and expiry remain. Slack import checks host, grant, phase and revision; stores a busy lease and cooldown before network I/O. Changes/draws are locked during import. Responses re-read durable state before applying, refusing expired/revoked/replaced operations. Every result request ignores client winner/target data: target and official names are frozen server-side when the authoritative draw starts.

## Data and network

SLACK_BOT_TOKEN is server-only. The optional secret type is isolated under worker/slack; generated Cloudflare binding types remain generated. No SDK/dependency added. The existing nodejs_compat runtime supplies node:crypto timingSafeEqual; the Worker typecheck includes the existing Node types. Only official reactions.get/users.info/chat.postMessage endpoints are callable. A user URL is parsed, never fetched; redirects are manual and non-2xx rejected, preventing credential forwarding. Bounded response bodies, strict schemas, timeouts, no raw error passthrough, no logs. No email scope, no persistent user cache. Four concurrent lookups within one import; each deduplicated user is resolved once. Slack rate limits impose a minimum host retry deadline. An import waits at least a minute; distributed sessions still share Slack workspace quota and may hit upstream limits.

Public DTOs explicitly contain opaque session IDs and display names. Only hosts get allowlisted enabled/source/count/sync-time/result-status fields. No browser gets a Slack channel/user/message identifier, permalink from server, credential or mapping. The host's pasted link exists briefly in their input and HTTPS request body; it is cleared on successful import. Spectators get no Slack metadata or controls. Live rosters/capabilities are not persisted in browser storage. Expiry deletes the session including source, mapping and outbox. Provider backups and already delivered Slack replies follow their own retention policies; ending a session does not delete Slack messages.

External names are normalized/bounded and rendered as React text; Slack output uses structured rich_text blocks and an escaped non-parsed fallback. Only server-resolved winner identities become explicit user mention elements; manual names remain literal text nodes. No broadcast/group mentions/links/unfurls. Synthetic fixtures only. Maximum 100 participants and one current posting record; no historical directory/results database.

## Durable posting and failure semantics

At draw creation, capture the official winner names and validated source in a pending job, with not-before equal to the last spin end. A Durable Object alarm advances and sends without browser callbacks. Before external I/O, synchronously claim posting, save it, arm recovery, and await storage.sync. Reentrant alarms find posting and do not send. Pending/posting blocks replacing the job with another draw/reset. Definitive success persists posted; definitive rejection persists failed plus retry deadline. Only an authorized host can retry a definite failure after that deadline. Automatic completion retries of posted/failed/uncertain jobs never send.

Slack does not give this implementation a documented transactional exactly-once boundary. If Slack accepts and the process/network fails before acknowledgement is durably saved, the job becomes uncertain (after 120 seconds for crash recovery). We **do not resend uncertain delivery**, sacrificing guaranteed delivery to avoid duplicate automatic posts. A crash between recording posting and sending can therefore lose a message. Host must inspect the thread; there is deliberately no ambiguous retry button. We do not claim an undocumented client_msg_id deduplication guarantee. Revocation cannot recall an already in-flight request. Failures never alter official winners.

## Verification and deployment limits

Automated tests cover strict URL parsing/SSRF cases, complete reactions, deduplication, names/filtering, refresh and opaque identity, safe DTOs, grant expiry/rotation, source rights, deterministic result text, failure/retry, disconnected alarm completion, reentrant completion and crash recovery. Existing local/remote/capability tests remain. Frontend/backend typechecks, frontend build and Worker dry-run must pass before publication. No configured lint task. Review source/diff/build for secrets, unsafe VITE variables, private data and dependencies.

Production activation requires an installed app with reactions:read/users:read/chat:write, bot conversation membership, SLACK_BOT_TOKEN and a privately provisioned SLACK_START_GRANT. The initial implementation had no bot token configured. On 2026-09-28 the user configured it and demonstrated a successful real thread reply. The new mention rendering still requires a real draw acceptance check. The feature fails closed without both secrets; manual use remains available.

## Required answers

1. Public URL reveals private participants without a capability? **No.**
2. Spectator can import or refresh Slack? **No.**
3. Slack bot token in browser? **No.**
4. Slack user IDs in browser? **No.**
5. Pasted URL directly fetched? **No.**
6. Email access required? **No.**
7. Posted winners can differ from the official draw? **No:** captured from the server instruction.
8. Normal retries/reconnects duplicate a post? **No:** durable claim; ambiguous outcomes are never retried. Not an exactly-once delivery guarantee.
9. Draw remains valid after post failure? **Yes.**
10. Permanent employee directory or identifiable result history? **No:** session TTL; delivered replies follow Slack retention.

Validation completed: 34 tests pass (23 frontend/domain/controller and 11 Worker/Slack tests), including viewer WebSocket privacy and disconnected automatic posting. Desktop synthetic Slack-host review and a 390px mobile iframe confirmed the controls, unique final winners and no live browser storage. A rotated-SVG horizontal overflow found in mobile review was fixed with bounded clipping around the wheel, preserving its pointer/shadow. Production build and both typechecks passed; runtime dependency audit found zero known vulnerabilities. The user subsequently confirmed the first real thread reply on 2026-09-28.


## Winner mentions and icon review — 2026-09-28

The user explicitly requested tagging winners, superseding the initial no-mentions requirement for official Slack winners only. SECURITY.md remains unchanged. At draw creation, reverse-map opaque winner IDs to validated private Slack identities and freeze them in the temporary job. Retry recipients cannot drift after later mapping changes. No lookup by name, no new API method/scope, no user IDs in HTTP/WebSocket DTOs. The posting request sends these identities back only to the same Slack integration for intended mentions. Plain text elements carry manual names, including hostile-looking markup, without interpreting it. The fallback escapes special characters and disables automatic parsing. Broadcast mentions cannot be generated by participant text. Legacy jobs without the optional identity array remain supported during their existing TTL.

Tests cover equal display names, mixed manual/Slack winners, exact official identity mapping, invalid identity fallback, frozen retry identity, legacy jobs, HTTP/WS privacy and actual Worker outbound mention payloads. Icon SVG/PNG contains only the existing generic vector brand, no profile photos or employee data. No runtime or development dependency was added; PNG was exported with a temporary CLI. The app icon is uploaded in Slack settings, without chat:write.customize or request-level icon overrides.

Mention release validation after integrating the current main: 39 tests pass (27 frontend and 12 Worker/Slack), both typechecks and both production builds pass. Diff/dependency/secret checks passed; no dependency changes, no private fields in frontend artifacts. The 1024px icon was visually reviewed. Slack mention rendering is verified against the documented payload and the mocked Worker integration; a real new draw is the remaining visual acceptance check.

## Koffierad review — 2026-09-28

Explicitly reviewed against every SECURITY.md section; the user authorized the coffee Slack variant. SECURITY.md remains unchanged. No new dependencies, scopes, external API methods, logging, scheduling or public participant endpoints. Standalone remains available.

The creation body accepts only an optional allowlisted beer/coffee variant; omitted means beer for compatibility. Persist this outside the draw engine in private session state and expose only the non-sensitive enum in the allowlisted DTO. No command can change it. Refresh/reset/draw cannot discard the session variant. Host and spectator keep using separate expiring capabilities, unchanged authorization and rate limits; existing stored records default to beer.

Coffee resolves only COFFEE_SLACK_BOT_TOKEN and COFFEE_SLACK_START_GRANT. It never falls back to beer credentials. Start authorization, import, post, retry and asynchronous revalidation all use the record's variant-specific grant. Each app must receive independently generated grants/tokens. Reactions are selected server-side, never supplied by a host command. The frozen result source retains the reaction, so coffee result text and retries retain the correct drink. Mention escaping, private mappings, expiry, revocation and uncertain-delivery behavior are unchanged.

The public theme contains only copy and non-sensitive styling. Local manual rosters, winner-count preferences and existing optional local weights use separate storage namespaces; legacy beer keys are preserved. Live rosters never enter these stores. No identifiable history is introduced. The icon is an original generic vector coffee cup with a PNG export, with no employee/company data.

Automated coverage extends the real Worker/SQLite/alarms suite to both apps: wrong-variant start refusal, invalid creation bodies, immutable variant, opposite-reaction exclusion, selected bot credential, coffee result text, viewer DTO privacy, refresh and disconnected completion. Frontend checks cover isolated local storage and coffee setup/finale/Slack copy. Real Slack workspace activation and acceptance remain pending app installation, secret configuration and deployment.

Final validation: 42 tests pass (29 frontend/domain/controller, 13 Worker/Slack), both typechecks and frontend/Worker production builds pass. No lint task is configured. Diff and dependency review completed; package files unchanged. Changed-file credential/private-data scan found no matches; frontend artifacts contain no server secret names or private Slack mapping fields. Desktop draw/finale and 390px mobile layout were checked with synthetic participants; no horizontal overflow. Real workspace acceptance remains pending activation.

## Reimport identity review — 2026-10-02

Reviewed against SECURITY.md. Switching to manual mode now retains the existing private, session-scoped Slack identity mapping so a later import replaces previous reactors instead of treating them as manual additions. The source is still removed, so manual draws do not post to Slack. The mapping remains server-only and expires with the existing session TTL; authorization, API methods, scopes, DTOs, credentials, logging and dependencies are unchanged. No name-based identity guessing or automatic cleanup of legacy duplicates is performed: after an older version discarded identity information, equal names cannot safely establish that two entries are the same person.

Regression coverage exercises manual switching, manual additions, repeated imports, equal display names, changed display names, removed reactions, stable opaque IDs and absence of Slack IDs from the public DTO.

## Automatic refresh and one-time draw review — 2026-10-02

The user explicitly authorized five-minute refresh and scheduling for the current session, including a final refresh before the automatic draw. Reviewed against every SECURITY.md section. No TTL extension, permanent schedule, employee directory, new credentials, scopes, bindings or dependencies. Browser polling is opt-in, host-only, transient and paused for disconnection, imports, draws and the final two minutes before a schedule. The final check runs server-side regardless of browser polling.

Only an authenticated host can set or cancel the canonical ISO instant, within the existing session lifetime and with time left to finish. Strict command fields, revisions, mutation/draw limits and server validation still apply. The public schedule DTO contains only a timestamp and status; leases, Slack identities and credentials remain private. Time input uses Europe/Amsterdam including DST; nonexistent wall times are rejected. Manual draw/reset consumes the plan. The durable alarm claims the plan before awaiting network I/O, re-reads current state after awaits, revalidates expiry and the variant-specific Slack grant, and invokes the same startDraw mutation after a successful final import. Concurrent host edits/imports are refused while final checking. Retries do not create extra draws or results. Failed/empty/revoked/busy checks are skipped, delayed alarms beyond one minute are skipped, and crashed final checks become skipped after a two-minute lease. The existing session expiry erases all planning state.

The final import has a separate one-per-minute budget so a recent ordinary refresh does not suppress the required last check. It also moves the normal import deadline forward; explicit upstream retry deadlines constrain both paths. This permits at most two imports per minute per session instead of one, with unchanged bounded lookups/timeouts and shared workspace-quota limitations. There is no public final-check API flag. Import errors never trigger a draw from stale participants. Ordinary manual draws retain their existing behavior.

Tests cover Dutch summer/winter time, polling cadence and cancellation, spectator refusal, schema/revision/expiry validation, manual cancellation, common draw selection, duplicate execution, failure/empty/busy outcomes, and real Worker alarms without host polling for both drink variants. Final-check fixtures change reactors after scheduling and verify the new identity is mentioned; failed reads and revoked grants never draw or post. Production activation still requires deploying the backend before the frontend. Existing Slack source/mapping remains temporary and server-only, outputs remain text-safe, and no private data is logged or sent to unrelated services.

Validation for this change: all 49 tests pass (32 frontend/domain/controller, 17 Worker/Slack), both typechecks and both production builds pass. No linter is configured. Desktop and 390px iframe QA verified the refresh checkbox, Friday 15:45 default, plan/cancel controls and no horizontal overflow. Diff review found no new dependencies, secrets, real employee/company fixtures or unsafe VITE variables; frontend bundles contain no private server fields. No production deployment or real Slack post was performed for this change.

Production backend deployed on 2026-10-02 after user approval (Worker version f5501279-329d-4774-89a8-a4bbd052af7b). A temporary manual session with synthetic participants verified scheduled execution and completion on production; the session was deleted afterward. Alarm delivery added several seconds, so scheduling is best-effort rather than exact to the second. No real Slack message was sent. The matching frontend is published by the main-branch Pages workflow.


## User-authorized retention update — 2026-10-02

The user explicitly requested a 24-hour default and extension to a scheduled start plus one hour. This supersedes the earlier eight-hour retention decision; SECURITY.md now records this exact authorization and bounded policy. Existing expiry/authentication/revocation enforcement remains binding. New sessions default to 24 hours, still capped by Slack grant expiry. Only a host setting a future schedule can extend an unexpired session, at most 30 days ahead plus one hour. The operation never shortens existing validity; cancellation/reset keeps the already granted expiry so open viewers are not abruptly invalidated. Expired sessions cannot be revived and ordinary reads never extend retention.

For Slack scheduling, the server rechecks the current variant-specific grant hash and deadline before mutation, including legacy sessions without a stored grant deadline. The full planned time plus one-hour retention must fit that grant; no grant or secret is renewed automatically. The private deadline is excluded from public DTOs. All connected clients receive the updated public session expiry and re-arm their existing expiry timers. New UI no longer disables planning at the old session deadline; it previews the extension and reports a specific insufficient-Slack-access error. No new permissions, dependencies, public environment variables, logging or participant storage are introduced.

Tests cover the explicit 24-hour default, later/earlier replanning, no resurrection, the exact grant ceiling including the extra hour, atomic rejection, legacy-session extension through the real Worker, viewer expiry updates, and the original disabled-button scenario. No real participant data or capability links are used in fixtures.

Retention validation: 53 tests pass (34 frontend/controller, 19 Worker/Slack); both typechecks and both production builds pass. Long-lived browser expiry timers are chunked below the platform timeout limit and tested offline. No configured linting or dependency changes. Changed-file and frontend-bundle checks found no credentials, capability links, private server fields or unsafe VITE configuration.

## External Slack Connect reactors (2026-10-02)

Reviewed against SECURITY.md; it remains unchanged. Slack may return a reduced `users.info` object for external Slack Connect users. Previously the missing `deleted`/`is_bot`/`profile` fields made the whole import fail with `slack_response`. Absent flags now mean false; present flags must still be booleans, the returned ID must still match exactly and a present profile must still be an object. Names keep the existing normalization and `Deelnemer` fallback; no new scopes, API methods, fields, storage or logging. Synthetic tests cover reduced external objects and malformed flags.
