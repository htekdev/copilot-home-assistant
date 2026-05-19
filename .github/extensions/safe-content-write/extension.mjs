/**
 * Safe Content Write Extension for {{PRODUCT}} CLI
 *
 * Detects large PowerShell here-string writes and redirects agents toward the
 * safer file-writing path: `create` for new files, `edit` for updates, and
 * extension tools for governed data.
 *
 * Architecture:
 * - Hookflow markdown in .github/hookflows/ handles deterministic preToolUse blocking
 * - This extension adds defense-in-depth via onPostToolUse + session-start guidance
 *
 * Reason: large PowerShell heredocs used for markdown/instruction writes are
 * fragile, hard to review, and easy to break with quoting or interpolation.
 */
import { joinSession } from "@github/copilot-sdk/extension";

const HERE_STRING_PATTERN = /(@"[\s\S]*?"@|@'[\s\S]*?'@)/m;
const WRITE_PATTERN = /(\b(Set-Content|Add-Content|Out-File)\b)|((^|[\s;])>>\s*\S)|((^|[\s;])>\s*\S)/im;
const MIN_HERE_STRING_LINES = 8;
const MIN_HERE_STRING_CHARS = 400;

function checkCommand(cmd) {
  if (!cmd || typeof cmd !== "string") return { blocked: false };

  const normalized = cmd.trim();
  const hereString = normalized.match(HERE_STRING_PATTERN)?.[0];
  if (!hereString) return { blocked: false };
  if (!WRITE_PATTERN.test(normalized)) return { blocked: false };

  const lineCount = hereString.split(/\r?\n/).length;
  const charCount = hereString.length;

  if (lineCount < MIN_HERE_STRING_LINES && charCount < MIN_HERE_STRING_CHARS) {
    return { blocked: false };
  }

  return {
    blocked: true,
    lineCount,
    charCount,
  };
}

function buildDenialMessage(check) {
  return [
    "🚫 BLOCKED: Large PowerShell here-string file write detected.",
    "",
    `Detected a here-string write of approximately ${check.lineCount} lines / ${check.charCount} characters.`,
    "",
    "Use the safe content-write path instead:",
    "1. New file → `create` with the final content",
    "2. Existing file → `view` + `edit`",
    "3. Governed data → dedicated extension tool",
    "",
    "Why: giant PowerShell heredocs are fragile, easy to escape incorrectly, and hard to review in diffs.",
    "See `.github/skills/safe-content-write/SKILL.md`.",
  ].join("\n");
}

await joinSession({
  tools: [],
  hooks: {
    onPreToolUse: async (input) => {
      if (input.toolName !== "powershell") return;

      const check = checkCommand(input.toolArgs?.command);
      if (check.blocked) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason: buildDenialMessage(check),
        };
      }
    },

    onPostToolUse: async (input) => {
      if (input.toolName !== "powershell") return;

      const check = checkCommand(input.toolArgs?.command);
      if (check.blocked) {
        return {
          additionalContext: buildDenialMessage(check),
        };
      }
    },

    onSessionStart: async () => ({
      additionalContext:
        "[safe-content-write] Extension loaded — large PowerShell here-string file writes are blocked. Use `create` for new files, `edit` for existing files, and extension tools for governed data. See `.github/skills/safe-content-write/SKILL.md`.",
    }),
  },
});
