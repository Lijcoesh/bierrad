import { channelCopy, type ChannelVariant } from "../../shared/channel";
import { themes } from "../../shared/variant";
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
/** The call for a round; its own reaction (☕ or 💧) is added right after. */
export function callBody(
  channelId: string,
  spectatorLink: string,
  startAt: number,
  variant: ChannelVariant = "coffee",
) {
  const theme = themes[variant],
    round = channelCopy[variant].round;
  return body(channelId, [
    {
      text: `${theme.icon} ${round[0].toUpperCase()}${round.slice(1)}! Klik op ${theme.icon} hieronder om mee te doen.\nOm ${clock.format(startAt)} draait het ${theme.name} en kiest het één ${theme.drink}haler. `,
    },
    { text: "Kijk live mee", url: spectatorLink },
  ]);
}
/** Posting this also proves the bot is a member of the channel. */
export function boundBody(channelId: string, requestLink: string) {
  return body(channelId, [
    {
      text: "☕ Het Koffierad is aan dit kanaal gekoppeld! Dit is ",
    },
    { text: "het vaste Koffierad van dit kanaal", url: requestLink },
    {
      text: ": daar zie je steeds de huidige ronde en vraag je een nieuwe aan. Of typ /koffierad of /waterrad (met bijvoorbeeld 10 erachter voor tien minuten). Meedoen doe je door op ☕ of 💧 te klikken onder de oproep. Eerdere links van dit kanaal werken niet meer.",
    },
  ]);
}
