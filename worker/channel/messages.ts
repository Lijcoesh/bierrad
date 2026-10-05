import { clock } from "../slack/state";
/**
 * Fixed Koffierad channel messages. Only server-built links and times; no
 * names, mentions or client-supplied text. Never unfurled or broadcast.
 */
function body(
  channelId: string,
  parts: ({ text: string } | { text: string; url: string })[],
) {
  const text = parts.map((p) => ("url" in p ? p.url : p.text)).join("");
  return {
    channel: channelId,
    text: text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    blocks: [
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: parts.map((p) =>
              "url" in p
                ? { type: "link", url: p.url, text: p.text }
                : { type: "text", text: p.text },
            ),
          },
        ],
      },
    ],
    mrkdwn: false,
    parse: "none",
    link_names: false,
    unfurl_links: false,
    unfurl_media: false,
  };
}
/** The call for a round; its own :coffee: reaction is added right after. */
export function callBody(
  channelId: string,
  spectatorLink: string,
  startAt: number,
  now: number,
) {
  const minutes = Math.max(1, Math.round((startAt - now) / 60000));
  return body(channelId, [
    {
      text: `☕ Koffieronde! Klik op ☕ hieronder om mee te doen.\nOver ${minutes} ${minutes === 1 ? "minuut" : "minuten"} (${clock.format(startAt)}) draait het Koffierad en kiest het één koffiehaler. `,
    },
    { text: "Kijk live mee", url: spectatorLink },
  ]);
}
/** Posting this also proves the bot is a member of the channel. */
export function boundBody(channelId: string, requestLink: string) {
  return body(channelId, [
    {
      text: "☕ Het Koffierad is aan dit kanaal gekoppeld! Vraag een koffieronde aan met /koffierad (of /koffierad 10 voor tien minuten) of via ",
    },
    { text: "de aanvraaglink", url: requestLink },
    {
      text: ". Meedoen doe je door op ☕ te klikken onder de oproep. Eerdere aanvraaglinks van dit kanaal werken niet meer.",
    },
  ]);
}
