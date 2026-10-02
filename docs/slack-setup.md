# Slack instellen

Slack is optioneel. Standalone en publieke handmatige live-sessies blijven zonder Slack werken. De implementatie gebruikt drie expliciete Web API-methoden via een kleine getypeerde fetch-client, zonder SDK/dependency of automatische SDK-retries. Raderen blijven volledig onafhankelijk.

## Slack-app

1. Maak via [Slack Apps](https://api.slack.com/apps) een app **From a manifest**, kies de juiste workspace en gebruik [het manifest](slack-app-manifest.json).
2. De enige bot scopes zijn `reactions:read`, `users:read`, `chat:write`. De enige user scope is `openid` voor Sign in with Slack; het daarbij uitgegeven gebruikerstoken wordt direct ingetrokken en nooit bewaard. Geen emailrechten, channel history, public posting of aangepaste afzenderrechten. Installeer de app met workspacegoedkeuring.
3. Voeg de bot expliciet toe aan het gesprek waar het bierrondebericht staat. De app vraagt geen bredere toegang om dit te omzeilen.
4. Bewaar het bot-token uitsluitend in Cloudflare Secrets. Vanuit een eigen terminal met Wrangler-login:

```sh
npx wrangler secret put SLACK_BOT_TOKEN --env=""
```

Plak het token alleen in de interactieve geheime invoer. Nooit in chat, commandoregelargumenten, Git, Pages, screenshots of een `VITE_*`-variabele. Geen signing secret nodig: Bierrad ontvangt geen Slack events/webhooks. Tokenrotatie beheer je via Slack en hetzelfde Cloudflare-secret.

## Inloggen met Slack voor organisatoren

Iedereen kan een gewone live-sessie maken; dat geeft **geen** Slack-toegang. Een Slack-sessie start je met **Start met Slack** in de livebalk (of via `#/slack`, koffie: `#/coffee-slack`). Je logt in met Slack (OpenID Connect, authorization code flow). De Worker laat alleen **volwaardige leden van de workspace van de bot** een Slack-rad starten: geen gasten (`is_restricted`/`is_ultra_restricted`), externe Slack Connect-gebruikers, bots, apps of verwijderde accounts. Iedereen mag wel blijven meedoen als deelnemer en meekijken via de kijklink.

Eenmalig instellen per app (Slack-appinstellingen → **OAuth & Permissions** en **Basic Information**):

1. Voeg de redirect-URL `https://bierrad-live.timzegveld.workers.dev/auth/slack/callback` toe en de user scope `openid` (staat ook in het manifest). Herinstalleer de app als Slack daarom vraagt.
2. Bewaar Client ID en Client Secret uitsluitend als Worker-secrets, interactief vanuit je eigen terminal:

```sh
npx wrangler secret put SLACK_CLIENT_ID --env=""
npx wrangler secret put SLACK_CLIENT_SECRET --env=""
```

Hoe het werkt en wat er wordt bewaard:

- `GET /auth/slack/<beer|coffee>` zet een kortlevende `__Host-`cookie (HttpOnly, Secure, SameSite=Lax, 10 minuten) met willekeurige `state` en `nonce`, en stuurt door naar Slack. Deze stap doet zelf geen Slack-call en verbruikt dus geen botquotum.
- `GET /auth/slack/callback` controleert `state` tegen die cookie, wisselt de code server-side in (client secret alleen in de POST-body), controleert `iss`, `aud`, `exp`, `nonce`, gebruikers- en workspace-ID, en vraagt met het bottoken via `users.info` het accounttype op. Het gebruikerstoken wordt direct met `auth.revoke` ingetrokken.
- Bij succes maakt de Worker de sessie aan en stuurt door naar de hostlink. De capabilities staan alleen in het URL-fragment; alle redirects hebben `Referrer-Policy: no-referrer`, zodat de callback-URL met code niet als referrer lekt. Mislukte pogingen landen op `#/slack/<reden>` zonder details.
- Er wordt geen Slack-identiteit, profiel of token bewaard bij de sessie; alleen de markering dat ze via inloggen is gestart. Daarna werkt de hostlink zoals altijd als tijdelijke bearertoegang.

Geldigheid en intrekken: een via inloggen gestarte sessie is standaard 24 uur geldig en kan bij het plannen worden verlengd tot de starttijd plus één uur, maar nooit voorbij een vaste grens van 30 dagen plus één uur na het starten. Elke Slack-actie controleert opnieuw dat login, bottoken en client secret nog zijn ingesteld. Intrekken voor alle sessies: verwijder `SLACK_CLIENT_SECRET` (of `SLACK_BOT_TOKEN`) in Cloudflare of met `npx wrangler secret delete SLACK_CLIENT_SECRET --env=""`. Het intrekken van één persoon na het starten is niet mogelijk; de hostlink blijft dan tot het einde van de sessie geldig. Een al verzonden netwerkverzoek kan niet worden ingetrokken.

Beperkingen: Enterprise Grid met meerdere workspaces wordt niet ondersteund (workspace-ID moet gelijk zijn aan die van de bot). Lokaal inloggen werkt alleen met een HTTPS-redirect-URL die in Slack is geregistreerd; zie hieronder.

### Oude privé-startlinks

Startlinks kunnen geen nieuwe sessies meer starten en het provisioningscript is verwijderd. Sessies die vóór deze wijziging met een startlink zijn gestart, blijven hun grant (`SLACK_START_GRANT`/`COFFEE_SLACK_START_GRANT`) controleren tot die verloopt. Daarna, of als je die sessies niet meer nodig hebt, verwijder je het secret met `npx wrangler secret delete SLACK_START_GRANT --env=""` en de lokale map `.private-slack/`. De resterende legacycode in `worker/slack/access.ts` kan dan worden verwijderd.

## Gebruik

In een geautoriseerde live-sessie kiest de host **Slack 🍻**, plakt een permalink en kiest **Deelnemers ophalen**. Alleen `:beers:` op het hoofdbericht telt. Threadlinks met `thread_ts` verwijzen naar dat hoofdbericht; `cid` mag alleen overeenkomen. De parser accepteert uitsluitend HTTPS workspace-subdomeinen van slack.com, `/archives/<C/G-id>/p<16 cijfers>` en deze twee queryvelden. Andere links/queryvelden worden bewust geweigerd. Een replylink zonder ouderinformatie wordt geweigerd wanneer Slack aangeeft dat het een reply is. De ingevoerde URL wordt nooit gefetcht.

Een import is atomair: bij errors/onvolledige gebruikerslijsten blijft de vorige lijst intact. We dedupliceren Slack-ID's, filteren verwijderde accounts, bots/apps en Slackbot; menselijke gasten/externe deelnemers blijven. Externe Slack Connect-gebruikers die Slack als ingekort profiel teruggeeft (zonder verwijderd-/botvlaggen of profiel) tellen als mens; aanwezige vlaggen moeten nog steeds geldige booleans zijn. Namen: display_name, real_name, anders Deelnemer. Emailachtige waarden worden niet overgenomen. Gelijke namen krijgen `(2)`, `(3)` enzovoorts, zonder Slack-ID. Iedere persoon krijgt een willekeurig sessie-ID; bij verversen blijft dit behouden zolang de persoon in de laatst geïmporteerde mapping staat.

**Opnieuw ophalen** volgt de huidige reacties: verdwenen reactors verdwijnen, nieuwe worden toegevoegd. Expliciet handmatig toegevoegde deelnemers blijven. Handmatig verwijderen van een Slack-deelnemer is tijdelijk: refresh brengt hen terug als hun reactie nog staat. Overschakelen naar Handmatig houdt de huidige lijst maar ontkoppelt Slack; volgende trekkingen posten niet meer. Geen writes naar reacties of originele berichten. Maximaal 100 deelnemers, import maximaal eens per minuut per sessie en langer bij Slack Retry-After. Geen automatische read-retries.

Na de laatste wheel-stop post de server de officiële namen automatisch als één korte reactie in dezelfde thread, ook zonder verbonden host. Alleen geïmporteerde Slack-winnaars krijgen een echte @vermelding. De server bevriest hun Slack-identiteit bij de trekking; handmatige namen blijven letterlijke tekst. Geen broadcast naar het kanaal, links of niet-winnaars. Slack-ID’s gaan alleen terug naar Slack voor deze vermelding, nooit naar Bierrad-browsers. Pending/posting blokkeert kort een nieuwe trekking/reset zodat de vorige verzending niet verloren gaat. Na een mislukte verzending blijven de winnaars geldig.

Bij een aantoonbare afwijzing mag de host na de wachttijd **Opnieuw plaatsen** gebruiken. Bij een netwerkfout/ongeldig succesantwoord of crash na het vastleggen van de verzendpoging is aflevering **onzeker**: controleer de thread. Bierrad probeert dan niet opnieuw, om dubbele berichten te voorkomen. Een nieuwe trekking vervangt de tijdelijke status van de vorige trekking. Er is geen permanente historie.

## Lokale ontwikkeling en acceptatie

Gebruik uitsluitend een testworkspace met synthetische deelnemers. `.dev.vars.development` is genegeerd en mag lokaal `SLACK_BOT_TOKEN`, `SLACK_CLIENT_ID` en `SLACK_CLIENT_SECRET` van een testapp bevatten; nooit committen of tonen. Slack stuurt na inloggen alleen terug naar een geregistreerde redirect-URL, dus lokaal echt inloggen vraagt een testapp met een HTTPS-tunnel naar `wrangler dev`. Zonder tunnel test `npm test` de volledige inlogflow met een nep-Slack.

Zonder Slack-account/token test `npm test` de echte Worker/SQLite/alarms met een fake Slack API. Voor een echte acceptatie: reageer met meerdere testpersonen, importeer, verwijder/voeg een reactie toe, wacht de importcooldown en refresh, draai met twee kijkers, sluit de host en controleer precies één correcte threadreply. Test ook een ontoegankelijk gesprek, inloggen als gast (moet worden geweigerd) en annuleren bij Slack, en beëindig daarna de testsessie. Deze echte workspaceacceptatie kan pas na secretconfiguratie.

## API-bronnen

- [reactions.get](https://docs.slack.dev/reference/methods/reactions.get/): `full=true`; het aantal moet overeenkomen met de unieke ontvangen gebruikers, anders geen import.
- [users.info](https://docs.slack.dev/reference/methods/users.info/): beperkte naamselectie; geen email scope.
- [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/): parent `thread_ts`, geen reply_broadcast, plain_text blocks en niet-geparste fallback.
- [Sign in with Slack](https://docs.slack.dev/authentication/sign-in-with-slack/): `openid.connect.token` en ID-tokenclaims; [auth.test](https://docs.slack.dev/reference/methods/auth.test/) voor de workspace van de bot; [auth.revoke](https://docs.slack.dev/reference/methods/auth.revoke/) voor het gebruikerstoken.


## Appicoon en @vermeldingen

Upload `public/slack-icon.png` (1024 × 1024) in de Slack-appinstellingen onder **Basic Information → Display Information → App icon** en sla op. De PNG is een export van `public/slack-icon.svg`, gebaseerd op het bestaande favicon. Dit wijzigt het app/bot-icoon; er is geen extra scope of afzender-override nodig.

Nieuwe trekkingen vermelden Slack-winnaars met het officiële [rich-text user-element](https://docs.slack.dev/reference/block-kit/block-elements/user-element/). Slack toont hun actuele weergavenaam. Alleen door de server uit de importmapping verkregen identiteiten worden vermeld; ingevoerde namen kunnen geen @here/@channel of andere mentions injecteren. Bestaande pending jobs zonder mentionmapping blijven als tekst werken. Bestaande Slack-berichten worden niet gewijzigd. De tekstfallback voor meldingen/screenreaders bevat leesbare namen.

PNG opnieuw exporteren zonder projectdependency: `npx --yes --registry=https://registry.npmjs.org @resvg/resvg-js-cli@2.6.2-beta.1 --no-system-font public/slack-icon.svg public/slack-icon.png`.

## Aparte Koffierad-app

Maak een **nieuwe** app From a manifest met [slack-coffee-app-manifest.json](slack-coffee-app-manifest.json), installeer haar in de gewenste workspace en nodig de Koffierad-bot uit in het koffiekanaal. De bestaande Bierrad-app blijft bestaan. Upload [coffee-icon.png](../public/coffee-icon.png) (1024 × 1024) bij Basic Information → Display Information → App icon. De vectorbron is [coffee-icon.svg](../public/coffee-icon.svg).

De scopes zijn dezelfde minimale scopes als bij bier: bot `reactions:read`, `users:read`, `chat:write` en user `openid`. Er zijn geen slashcommando's, events, webhooks of signing secrets. Organisatoren loggen in met **Start met Slack** op het Koffierad en collega's reageren met **☕ `:coffee:`** op het gekozen bericht.

Bewaar het **nieuwe** bot-token interactief, uitsluitend in het volgende Worker-secret:

```sh
npx wrangler secret put COFFEE_SLACK_BOT_TOKEN --env=""
npx wrangler secret put COFFEE_SLACK_CLIENT_ID --env=""
npx wrangler secret put COFFEE_SLACK_CLIENT_SECRET --env=""
```

Voeg in de Koffierad-app dezelfde redirect-URL en user scope `openid` toe. Koffie-inloggen gebruikt uitsluitend de Koffierad-app en haar bot; Bierrad-inloggen uitsluitend de Bierrad-app. Intrekken werkt per app: verwijderen van `COFFEE_SLACK_CLIENT_SECRET` schakelt nieuwe koffie-starts, imports en posts uit, zonder bier te veranderen. Reeds geïmporteerde deelnemers volgen de bestaande sessie-TTL.

De server selecteert de bot en reactie uit de onveranderlijke sessievariant; er is geen fallback naar de bierbot als koffie niet is ingesteld. De variant ligt vast in de inlogcookie en kan tijdens de callback niet wisselen. Het hoofdbericht mag beide reacties bevatten; iedere variant leest uitsluitend zijn eigen reactie. Refresh en officiële @vermeldingen blijven gelijk werken.

Publicatievolgorde: eerst de compatibele Worker, vervolgens de frontend; configureer daarna de koffie-appsecrets. Zonder koffiecredentials blijven lokaal en handmatig live draaien beschikbaar. Test na installatie met synthetische deelnemers dat alleen ☕ meetelt, twee kijkers dezelfde koffie-uitslag zien en precies één threadreply van de **Koffierad-bot** verschijnt, ook als de host sluit. Het toevoegen van deze broncode installeert of activeert de Slack-app nog niet.

## Automatisch verversen en eenmalig starten

De host kan vijfminutenrefresh aanzetten zolang het hostscherm openstaat. Dit bewaart geen deelnemers of toegang in browseropslag. De live-server kan daarnaast een eenmalige start tot 30 dagen vooruit bewaren en de sessie zo nodig verlengen tot één uur daarna (standaard vrijdag 15.45, Europe/Amsterdam). De eindcontrole van Slack loopt op de server en werkt ook zonder hostscherm. Pas na een geslaagde controle volgt de normale trekking en threaduitslag; bij fouten wordt overgeslagen. Een normale import heeft een cooldown van een minuut. De eindcontrole heeft een aparte limiet van één per minuut en zet ook de normale cooldown; een expliciete Slack-retrydeadline geldt voor beide. Zo kan een laatste controle na een recente reguliere import plaatsvinden, met maximaal twee imports per minuut per sessie. Geen nieuwe Slack-scopes, cronconfiguratie of serversecrets nodig. Wekelijkse herhaling is niet inbegrepen.

Optioneel plaatst de server twee minuten voor de geplande start de kijklink in dezelfde thread (aan te vinken bij het plannen, standaard aan). Dit gebruikt de bestaande `chat:write`-scope, zonder unfurl of kanaalbroadcast, met hooguit vijf herinneringen per sessie. De link-basis komt uit de publieke Worker-variabele `FRONTEND_URL`, die al voor Sign in with Slack is ingesteld.
