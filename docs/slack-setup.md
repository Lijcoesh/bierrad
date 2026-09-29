# Slack instellen

Slack is optioneel. Standalone en publieke handmatige live-sessies blijven zonder Slack werken. De implementatie gebruikt drie expliciete Web API-methoden via een kleine getypeerde fetch-client, zonder SDK/dependency of automatische SDK-retries. Raderen blijven volledig onafhankelijk.

## Slack-app

1. Maak via [Slack Apps](https://api.slack.com/apps) een app **From a manifest**, kies de juiste workspace en gebruik [het manifest](slack-app-manifest.json).
2. De enige bot scopes zijn `reactions:read`, `users:read`, `chat:write`. Geen user token/scopes, emailrechten, channel history, public posting of aangepaste afzenderrechten. Installeer de app met workspacegoedkeuring.
3. Voeg de bot expliciet toe aan het gesprek waar het bierrondebericht staat. De app vraagt geen bredere toegang om dit te omzeilen.
4. Bewaar het bot-token uitsluitend in Cloudflare Secrets. Vanuit een eigen terminal met Wrangler-login:

```sh
npx wrangler secret put SLACK_BOT_TOKEN --env=""
```

Plak het token alleen in de interactieve geheime invoer. Nooit in chat, commandoregelargumenten, Git, Pages, screenshots of een `VITE_*`-variabele. Geen signing secret nodig: Bierrad ontvangt geen Slack events/webhooks. Tokenrotatie beheer je via Slack en hetzelfde Cloudflare-secret.

## Privé-startlink voor organisatoren

Iedereen kan een gewone live-sessie maken; dat geeft **geen** Slack-toegang. Slack-sessies vereisen een aparte 256-bit startcapability. De server bewaart alleen de hash en een einddatum in `SLACK_START_GRANT`. Dit is een tijdelijke bevoegdheid voor organisatoren, geen Slack-token of gebruikersidentiteit.

```sh
node scripts/slack-start-link.mjs create
node scripts/slack-start-link.mjs publish
```

De eerste opdracht maakt een willekeurige link met standaard 7 dagen geldigheid in `.private-slack/start-link.txt`; de tweede publiceert uitsluitend hash/expiry via Wrangler stdin. Het script print geen link/credential. De map is genegeerd door Git. Open het bestand privé en geef de link alleen aan bevoegde organisatoren. Maximaal 30 dagen kan expliciet met `create https://timzegveld.github.io/bierrad/ 30`.

Gebruik op de startpagina **Start Bierrad met Slack**. Deel vervolgens uitsluitend **Kopieer kijklink**. De startlink staat in een URL-fragment en gaat niet naar Pages of browseropslag. Succesvol starten vervangt de huidige browsergeschiedenisentry door de hostlink. Bearerlinks kunnen wel in clipboard/browsergeschiedenis staan; beheer ze als tijdelijke toegang.

Intrekken: verwijder het Worker-secret `SLACK_START_GRANT` in Cloudflare of met `npx wrangler secret delete SLACK_START_GRANT --env=""`. Bestaande sessies blijven hun al geïmporteerde namen tonen tot hun eigen expiry/beëindiging, maar nieuwe Slack-imports en posts worden geweigerd. Voor nieuwe toegang: verwijder de twee oude lokale bestanden bewust, maak een nieuwe link en publiceer opnieuw. Publiceren van een nieuwe grant trekt de vorige in. Bestaande sessies worden nooit verlengd; hun expiry is het minimum van 8 uur en grant-expiry. Een al verzonden netwerkverzoek kan niet worden ingetrokken.

## Gebruik

In een geautoriseerde live-sessie kiest de host **Slack 🍻**, plakt een permalink en kiest **Deelnemers ophalen**. Alleen `:beers:` op het hoofdbericht telt. Threadlinks met `thread_ts` verwijzen naar dat hoofdbericht; `cid` mag alleen overeenkomen. De parser accepteert uitsluitend HTTPS workspace-subdomeinen van slack.com, `/archives/<C/G-id>/p<16 cijfers>` en deze twee queryvelden. Andere links/queryvelden worden bewust geweigerd. Een replylink zonder ouderinformatie wordt geweigerd wanneer Slack aangeeft dat het een reply is. De ingevoerde URL wordt nooit gefetcht.

Een import is atomair: bij errors/onvolledige gebruikerslijsten blijft de vorige lijst intact. We dedupliceren Slack-ID's, filteren verwijderde accounts, bots/apps en Slackbot; menselijke gasten/externe deelnemers blijven. Namen: display_name, real_name, anders Deelnemer. Emailachtige waarden worden niet overgenomen. Gelijke namen krijgen `(2)`, `(3)` enzovoorts, zonder Slack-ID. Iedere persoon krijgt een willekeurig sessie-ID; bij verversen blijft dit behouden zolang de persoon in de laatst geïmporteerde mapping staat.

**Opnieuw ophalen** volgt de huidige reacties: verdwenen reactors verdwijnen, nieuwe worden toegevoegd. Expliciet handmatig toegevoegde deelnemers blijven. Handmatig verwijderen van een Slack-deelnemer is tijdelijk: refresh brengt hen terug als hun reactie nog staat. Overschakelen naar Handmatig houdt de huidige lijst maar ontkoppelt Slack; volgende trekkingen posten niet meer. Geen writes naar reacties of originele berichten. Maximaal 100 deelnemers, import maximaal eens per minuut per sessie en langer bij Slack Retry-After. Geen automatische read-retries.

Na de laatste wheel-stop post de server de officiële namen automatisch als één korte reactie in dezelfde thread, ook zonder verbonden host. Alleen geïmporteerde Slack-winnaars krijgen een echte @vermelding. De server bevriest hun Slack-identiteit bij de trekking; handmatige namen blijven letterlijke tekst. Geen broadcast naar het kanaal, links of niet-winnaars. Slack-ID’s gaan alleen terug naar Slack voor deze vermelding, nooit naar Bierrad-browsers. Pending/posting blokkeert kort een nieuwe trekking/reset zodat de vorige verzending niet verloren gaat. Na een mislukte verzending blijven de winnaars geldig.

Bij een aantoonbare afwijzing mag de host na de wachttijd **Opnieuw plaatsen** gebruiken. Bij een netwerkfout/ongeldig succesantwoord of crash na het vastleggen van de verzendpoging is aflevering **onzeker**: controleer de thread. Bierrad probeert dan niet opnieuw, om dubbele berichten te voorkomen. Een nieuwe trekking vervangt de tijdelijke status van de vorige trekking. Er is geen permanente historie.

## Lokale ontwikkeling en acceptatie

Gebruik uitsluitend een testworkspace met synthetische deelnemers. `.dev.vars.development` is genegeerd en mag lokaal `SLACK_BOT_TOKEN` en `SLACK_START_GRANT` bevatten; nooit committen of tonen. De laatste waarde is dezelfde JSON-structuur `{ "hash": "<SHA-256 van lokale startcapability>", "expiresAt": <Unix milliseconden> }`. Gebruik voor een lokale link `node scripts/slack-start-link.mjs create http://127.0.0.1:5173/ 1` en zet de inhoud van `grant.json` alleen in de lokale dev-vars (niet publish naar productie).

Zonder Slack-account/token test `npm test` de echte Worker/SQLite/alarms met een fake Slack API. Voor een echte acceptatie: reageer met meerdere testpersonen, importeer, verwijder/voeg een reactie toe, wacht de importcooldown en refresh, draai met twee kijkers, sluit de host en controleer precies één correcte threadreply. Test ook een ontoegankelijk gesprek en trek daarna de testsessie/starttoegang in. Deze echte workspaceacceptatie kan pas na secretconfiguratie.

## API-bronnen

- [reactions.get](https://docs.slack.dev/reference/methods/reactions.get/): `full=true`; het aantal moet overeenkomen met de unieke ontvangen gebruikers, anders geen import.
- [users.info](https://docs.slack.dev/reference/methods/users.info/): beperkte naamselectie; geen email scope.
- [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/): parent `thread_ts`, geen reply_broadcast, plain_text blocks en niet-geparste fallback.


## Appicoon en @vermeldingen

Upload `public/slack-icon.png` (1024 × 1024) in de Slack-appinstellingen onder **Basic Information → Display Information → App icon** en sla op. De PNG is een export van `public/slack-icon.svg`, gebaseerd op het bestaande favicon. Dit wijzigt het app/bot-icoon; er is geen extra scope of afzender-override nodig.

Nieuwe trekkingen vermelden Slack-winnaars met het officiële [rich-text user-element](https://docs.slack.dev/reference/block-kit/block-elements/user-element/). Slack toont hun actuele weergavenaam. Alleen door de server uit de importmapping verkregen identiteiten worden vermeld; ingevoerde namen kunnen geen @here/@channel of andere mentions injecteren. Bestaande pending jobs zonder mentionmapping blijven als tekst werken. Bestaande Slack-berichten worden niet gewijzigd. De tekstfallback voor meldingen/screenreaders bevat leesbare namen.

PNG opnieuw exporteren zonder projectdependency: `npx --yes --registry=https://registry.npmjs.org @resvg/resvg-js-cli@2.6.2-beta.1 --no-system-font public/slack-icon.svg public/slack-icon.png`.

## Aparte Koffierad-app

Maak een **nieuwe** app From a manifest met [slack-coffee-app-manifest.json](slack-coffee-app-manifest.json), installeer haar in de gewenste workspace en nodig de Koffierad-bot uit in het koffiekanaal. De bestaande Bierrad-app blijft bestaan. Upload [coffee-icon.png](../public/coffee-icon.png) (1024 × 1024) bij Basic Information → Display Information → App icon. De vectorbron is [coffee-icon.svg](../public/coffee-icon.svg).

De scopes zijn dezelfde drie minimale scopes als bij bier: `reactions:read`, `users:read`, `chat:write`. Er zijn geen slashcommando's, events, webhooks, signing secrets of extra scopes. Gebruik de privé-startlink voor organisatoren en laat collega's met **☕ `:coffee:`** op het gekozen bericht reageren.

Bewaar het **nieuwe** bot-token interactief, uitsluitend in het volgende Worker-secret:

```sh
npx wrangler secret put COFFEE_SLACK_BOT_TOKEN --env=""
node scripts/slack-start-link.mjs create --coffee
node scripts/slack-start-link.mjs publish --coffee
```

De koffie-startlink staat privé in `.private-slack/coffee/start-link.txt` en gebruikt `#/coffee-slack-start/<capability>`. De aparte hash/expiry wordt gepubliceerd als `COFFEE_SLACK_START_GRANT`. Ook deze link is standaard zeven dagen geldig; met `create http://127.0.0.1:5173/ 1 --coffee` maak je een lokale testlink. Gebruik dan de koffie-secretnamen in genegeerde dev-vars en publiceer de testgrant niet naar productie. Geef tokens/startlinks nooit door via chat of publieke configuratie.

Intrekken of roteren werkt per app: verwijderen/roteren van `COFFEE_SLACK_START_GRANT` schakelt nieuwe koffie-imports en posts uit, zonder de biergrant te veranderen. Reeds geïmporteerde deelnemers volgen de bestaande sessie-TTL. Voor een nieuwe koffiegrant gelden dezelfde exclusieve bestandscreatie en bewuste verwijdering van oude lokale bestanden als bij bier.

De server selecteert de bot en reactie uit de onveranderlijke sessievariant; er is geen fallback naar de bierbot als koffie niet is ingesteld. Een bier-startcapability werkt niet voor koffie en omgekeerd (provisioneer verschillende grants). Het hoofdbericht mag beide reacties bevatten; iedere variant leest uitsluitend zijn eigen reactie. Refresh en officiële @vermeldingen blijven gelijk werken.

Publicatievolgorde: eerst de compatibele Worker, vervolgens de frontend; configureer daarna de koffie-appsecrets en starttoegang. Zonder koffiecredentials blijven lokaal en handmatig live draaien beschikbaar. Test na installatie met synthetische deelnemers dat alleen ☕ meetelt, twee kijkers dezelfde koffie-uitslag zien en precies één threadreply van de **Koffierad-bot** verschijnt, ook als de host sluit. Het toevoegen van deze broncode installeert of activeert de Slack-app nog niet.
