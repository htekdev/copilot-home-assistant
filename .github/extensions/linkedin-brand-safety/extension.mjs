/**
 * LinkedIn Brand Safety Extension for GitHub Copilot CLI
 *
 * FLAGS outgoing LinkedIn messages that contain brand-unsafe content — specifically
 * any claim that {{PARENT_1}} uses Claude, Anthropic, ChatGPT, OpenAI, Cursor, or any
 * non-{{EMPLOYER}} AI tool. {{PARENT_1}} is a {{EMPLOYER}} employee who uses {{PRODUCT}}.
 *
 * Hookflow Governance: Created after the linkedin-outreach agent hallucinated
 * competitor-tool usage in professional outreach messages. These are critical
 * brand safety violations for an employee representing {{EMPLOYER}} publicly.
 *
 * Hook type: postToolUse (advisory) — fires after Playwright tool calls that
 * send LinkedIn messages. Since onPreToolUse is not reliably dispatched to
 * extensions (SDK v1.0.47), we use postToolUse to provide strong advisory
 * correction when brand-unsafe content is detected.
 */
import { joinSession } from "@github/copilot-sdk/extension";

const BRAND_UNSAFE_PATTERNS = [
  {
    pattern: /\b(?:my|I(?:'m| am)|I've|we(?:'re| are)|built (?:with|on|using)|running (?:on|with)|powered by|using|leverage|orchestrat(?:ed|ing) (?:by|with|via))\b[^.]{0,40}\b(?:Claude|Anthropic)\b/i,
    reason: "Claims {{PARENT_1}} uses Claude/Anthropic. They use {{PRODUCT}}.",
  },
  {
    pattern: /\b(?:Claude|Anthropic)\b[^.]{0,40}\b(?:system|agent|platform|pipeline|workflow|harness|orchestrat)/i,
    reason: "Implies {{PARENT_1}}'s systems run on Claude/Anthropic. They use {{PRODUCT}}.",
  },
  {
    pattern: /\b(?:my|I(?:'m| am)|I've|we(?:'re| are)|built (?:with|on|using)|running (?:on|with)|powered by|using|leverage)\b[^.]{0,40}\b(?:ChatGPT|OpenAI|GPT-4|GPT-5)\b/i,
    reason: "Claims {{PARENT_1}} uses ChatGPT/OpenAI. They use {{PRODUCT}}.",
  },
  {
    pattern: /\b(?:my|I(?:'m| am)|I've|we(?:'re| are)|built (?:with|on|using)|running (?:on|with)|powered by|using|switched to)\b[^.]{0,40}\b(?:Cursor|Windsurf|Codeium)\b/i,
    reason: "Claims {{PARENT_1}} uses Cursor/Windsurf/Codeium. They use {{PRODUCT}}.",
  },
  {
    pattern: /multi-agent\s+Claude\b/i,
    reason: "Phrase 'multi-agent Claude' implies Claude powers the system. {{PARENT_1}} uses {{PRODUCT}}.",
  },
  {
    pattern: /\bprimarily on Claude\b/i,
    reason: "Phrase 'primarily on Claude' claims Claude is the main tool. {{PARENT_1}} uses {{PRODUCT}}.",
  },
];

function checkBrandSafety(text) {
  if (!text || typeof text !== "string") return { unsafe: false };

  for (const { pattern, reason } of BRAND_UNSAFE_PATTERNS) {
    if (pattern.test(text)) {
      return { unsafe: true, reason, match: text.match(pattern)?.[0] };
    }
  }
  return { unsafe: false };
}

function buildAdvisoryMessage(check) {
  return [
    "🚫 BRAND SAFETY VIOLATION DETECTED in LinkedIn message!",
    "",
    `⚠️ Issue: ${check.reason}`,
    `📝 Matched: \"${check.match}\"`,
    "",
    "🔒 CRITICAL RULES:",
    `• {{PARENT_1}} is a {{EMPLOYER}} employee who uses {{PRODUCT}}`,
    "• NEVER claim they use: Claude, Anthropic, ChatGPT, OpenAI, Cursor, Windsurf, Codeium.",
    `• Their tools: {{PRODUCT}} CLI, {{PRODUCT}} Extensions, {{EMPLOYER_PARENT}} Actions, Azure.`,
    `• When discussing their multi-agent platform, say '{{PRODUCT}}-powered' or keep it model-agnostic.`,
    "",
    `✅ Correct framing: 'multi-agent systems powered by {{PRODUCT}}' or 'autonomous agent platform'`,
    "❌ Wrong framing: 'Claude systems', 'running on Claude', 'built with ChatGPT'",
    "",
    "⚡ ACTION: STOP. Do NOT send this message. Rewrite it with brand-safe language, then retry.",
    "",
    "Hookflow governance: deterministic brand safety enforcement for LinkedIn outreach.",
  ].join("\n");
}

function isLinkedInMessageAction(toolName, toolArgs) {
  if (!toolName) return { isMessage: false };
  const name = toolName.toLowerCase();

  const isPlaywright =
    name.includes("playwright") ||
    name.includes("browser") ||
    name === "powershell";

  if (!isPlaywright) return { isMessage: false };

  const argsStr = JSON.stringify(toolArgs || {}).toLowerCase();

  const isLinkedIn =
    argsStr.includes("linkedin") ||
    argsStr.includes("messaging") ||
    argsStr.includes("msg-form") ||
    argsStr.includes("message-input") ||
    argsStr.includes("send-button");

  if (!isLinkedIn) return { isMessage: false };

  const text =
    toolArgs?.text ||
    toolArgs?.value ||
    toolArgs?.content ||
    toolArgs?.message ||
    toolArgs?.command ||
    "";

  return { isMessage: true, text: typeof text === "string" ? text : JSON.stringify(text) };
}

await joinSession({
  tools: [],
  hooks: {
    onPostToolUse: async (input) => {
      const { isMessage, text } = isLinkedInMessageAction(
        input.toolName,
        input.toolArgs
      );

      let contentToCheck = text || "";
      const fullArgs = JSON.stringify(input.toolArgs || {});
      if (
        fullArgs.toLowerCase().includes("linkedin") ||
        fullArgs.toLowerCase().includes("messaging")
      ) {
        contentToCheck = fullArgs;
      }

      if (!contentToCheck) return;

      const check = checkBrandSafety(contentToCheck);
      if (check.unsafe) {
        return { additionalContext: buildAdvisoryMessage(check) };
      }
    },

    onSessionStart: async () => {
      return {
        additionalContext: [
          "[linkedin-brand-safety] Extension loaded — LinkedIn outreach brand safety enforcement active.",
          `🔒 {{PARENT_1}} is a {{EMPLOYER}} employee. Their tools: {{PRODUCT}} CLI, {{PRODUCT}} Extensions, {{EMPLOYER_PARENT}} Actions, Azure.`,
          "🚫 NEVER claim they use: Claude, Anthropic, ChatGPT, OpenAI, Cursor, Windsurf, Codeium.",
          "Any LinkedIn message containing these claims will be flagged as a CRITICAL brand safety violation.",
        ].join("\n"),
      };
    },
  },
});
