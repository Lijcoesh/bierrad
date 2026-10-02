// PreToolUse guard: agents work on branches and open PRs; only the owner merges.
// Blocks commit/push/merge on main, pushes that target main, and `gh pr merge`.
import { execFileSync } from "node:child_process";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}
const command = String(input?.tool_input?.command ?? "");
if (!command) process.exit(0);

// Only inspect real commands: drop heredoc/here-string bodies and quoted text
// (commit messages, PR bodies) so prose about "main" cannot trigger or hide a match.
const code = command
  .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, "")
  .replace(/@'[\s\S]*?\n'@|@"[\s\S]*?\n"@/g, "")
  .replace(/'[^'\n]*'|"(?:[^"\\\n]|\\.)*"/g, "''");
const segments = code
  .split(/&&|\|\||[;|&\n]/)
  .map((part) => part.trim())
  .filter(Boolean);

const block = (reason) => {
  process.stderr.write(
    `Geblokkeerd: ${reason} Werk op een eigen branch en open een PR; alleen de eigenaar merget naar main.\n`,
  );
  process.exit(2);
};

let branch;
const currentBranch = () => {
  if (branch === undefined)
    try {
      branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: input.cwd || process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      branch = "";
    }
  return branch;
};

let switched = false;
for (const segment of segments) {
  if (/^gh\s+pr\s+merge\b/.test(segment) || /^gh\s+api\b.*\/merge\b/.test(segment))
    block("PR's mergen is voorbehouden aan de eigenaar.");
  const git = /^git(?:\s+-C\s+\S+|\s+-c\s+\S+)*\s+(\S+)(.*)$/.exec(segment);
  if (!git) continue;
  const [, sub, rest] = git;
  if (["checkout", "switch"].includes(sub) && /\s-[bcBC]\b/.test(rest)) {
    switched = true;
    continue;
  }
  if (sub === "push") {
    if (/(?:^|[\s:+]|refs\/heads\/)(main|master)\b/.test(rest))
      block("pushen naar main is niet toegestaan.");
    if (/\s--(?:all|mirror)\b/.test(rest))
      block("git push --all/--mirror kan main overschrijven.");
  }
  if (
    ["commit", "push", "merge", "cherry-pick", "revert", "am"].includes(sub) &&
    !switched &&
    /^(main|master)$/.test(currentBranch())
  )
    block(`je staat op ${currentBranch()}; commit, push of merge daar niet direct.`);
}
process.exit(0);
