# Channel-bound Koffierad security review — 2026-10-05

Implementation review against SECURITY.md (section "Channel-bound Koffierad", added at the owner's explicit request on 2026-10-05). Not an independent audit.

## New surface

| Surface | Authorization | Notes |
| --- | --- | --- |
| `GET /auth/slack/channel/<C…/G…>` → callback | Sign in with Slack (unchanged OIDC checks: state/nonce cookie, issuer, audience, expiry, workspace, full member) | Channel ID is regex-validated and carried in the HttpOnly login cookie; failures land on `#/koffie-koppelen/<reason>` without details. |
| `GET/POST /api/channel` | Hex capability `locator.secret` (256-bit secret), admin or request role, SHA-256 hashes, timing-safe comparison | Origin allowlist, request rate limit; `requestRound` also spends the creation limits. Strict command shapes; management is admin-only. |
| `GET /api/channel` (word link) | 5-word viewer capability (50 bits), SHA-256 hash, timing-safe comparison | Same Origin allowlist and request rate limit. GET only (any POST is 405); returns only the latest round (`type: "view"`). |
| `POST /slack/commands` | Slack HMAC-SHA256 signature with `COFFEE_SLACK_SIGNING_SECRET`, 5-minute window | 8 KiB body bound, exact single-valued parameters, minutes 1–30, per-user request and creation limits, ephemeral replies. `ssl_check` is answered without acting. |
| `ChannelWheel` Durable Object | Reached only through the routes above | Named by `SHA-256("koffierad-channel:" + channelId)[0:32]`; the name grants nothing. Viewer pointers are instances named by `SHA-256("koffierad-viewer:" + words)[0:32]` that store only the channel's name and delete themselves when the channel rejects them. |

## Data and retention

- Stored per binding: channel ID, workspace ID, bot user ID, admin/request hashes, the raw request capability (already public in the channel; used only to build the call's link to the fixed channel page and never returned in a DTO), the viewer hash and raw viewer word link (returned only to request and admin link holders, never posted), default minutes, daily counter, idle expiry and, while a round is watchable (start + 3 minutes), that round's raw spectator capability. No binder, requester or participant data.
- Bindings expire 90 days after the last bind or round, or on unbind (`deleteAll`). Every access checks expiry; the alarm deletes expired state, and deletes the raw spectator capability after each round.
- Rounds are ordinary temporary LiveSessions: spectator-only (the host hash is of a discarded random value), one winner, expiry start + 1 hour, and a `slack-channel` grant that fails closed when the coffee login or bot secrets are removed. The bot user ID is a private exclusion list and never appears in DTOs.

## Slack behaviour

- Scopes added: `reactions:write` (only `reactions.add` of `:coffee:` on the bot's own call message) and `commands`. No `channels:read`, history, events or interactivity.
- Messages are fixed text with server-built links (`FRONTEND_URL` + fragment), `mrkdwn: false`, `parse: none`, no link names, no unfurls. The call is top-level and links to the fixed channel page; results and notices are thread replies with `reply_broadcast: false`. Result mentions use only server-frozen identities, as before.
- Rounds are claimed before I/O. A definite rejection of the call clears the round; an uncertain result is not retried. Reaction refreshes happen at most once per minute and never within 30 seconds of the final check, so a refresh cannot block the draw.

## Accepted limitations

- The request link is bearer access and is posted in the channel (visible to Slack Connect members). Mitigations: one active round per channel, 20 rounds per 24 hours, creation rate limits, admin rotation and unbind.
- The viewer word link has only 50 bits and lives as long as the binding (up to 90 days idle, longer while rounds keep it alive). It only shows the latest round of one channel, never commands; guessing is bounded by the request rate limit, and the admin can replace it with a new channel link. Anyone it is shown to on a screen can watch along until then. Bindings made before this change get one on their next rotation or rebind.
- Any full workspace member can rebind a channel and so replace its links; the confirmation post makes this visible in the channel.
- Anyone Slack lets run `/koffierad` in a bound channel (including guests) can start a round, as requested ("iedereen").
- The slash command keys bindings by channel ID only; the app is installed in a single workspace (`org_deploy_enabled: false`).
- If the Worker cannot answer within about 2.5 seconds, the person gets a generic "wordt aangevraagd" reply while the round continues via `waitUntil`.

## Verification

- `worker/tests/channel.test.ts`: signature verification (wrong secret, altered body, stale or malformed headers), strict slash parsing, channel input parsing, fixed message bodies, notices for empty/unreadable rounds, refresh margin, bot exclusion, and a Miniflare integration with a fake Slack. That integration covers: a refused binding when the bot is not in the channel, binding via the login flow, no secrets stored, role checks, strict shapes, rounds from the link and the slash command, one round at a time, a spectator DTO without Slack data, the final check without the bot, one winner in the thread, the raw spectator capability being wiped, forged/stale/unbound slash commands, rotation and unbind, and a viewer word link that is never posted, refuses every command, sees only the round, and stops working (pointer removed) after rotation and unbind.
- `src/tests/channel.test.ts`: exact fragment routes, bearer-only client requests, sanitized error messages.
- Real-workspace acceptance still requires the owner to update the Koffierad app, configure `COFFEE_SLACK_SIGNING_SECRET` and deploy.
