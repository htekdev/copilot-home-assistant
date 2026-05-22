/**
 * Tool Fishing Guard Extension for {{PRODUCT}} CLI
 *
 * DENY hook (preToolUse) that BLOCKS `tool_search_tool_regex` calls when the
 * search pattern matches well-known standard tools or MCP-only tools.
 *
 * Upgraded from advisory (postToolUse) to deny (preToolUse) on 2026-05-20
 * after observing 690 tool_search calls in 48h despite the advisory being active.
 * The advisory was insufficient — models acknowledged the warning but continued
 * searching on subsequent turns. Blocking is the only effective deterrent.
 *
 * Anti-patterns blocked:
 * 1. Searching for STANDARD tools (telegram, tasks, dev-workflow, etc.) — always
 *    available, just call them directly.
 * 2. Searching for MCP-ONLY tools (perplexity, exa, etc.) — main-session only,
 *    sub-agents should use web_fetch as fallback.
 *
 * Philosophy: Hookflow Governance — deterministic enforcement > advisory guidance.
 */
import { joinSession } from "@{{EMPLOYER_PARENT}}/copilot-sdk/extension";

// ── Standard tool patterns that should never be searched for ─────────────────
const STANDARD_TOOL_PATTERNS = [
  /^(complete|update|list|add|get|search)[-_]?task/i,
  /^task[-_]?(complete|update|list|add|search)/i,
  /^telegram/i,
  /^(gcal|google[-_]?cal)/i,
  /^dev[-_]?(add|commit|push|pull|status|checkout|stash|reset|rebase|merge)/i,
  /^(store|vote)[-_]?memory/i,
  /^list[-_]?agents/i,
  /^(read|write)[-_]?agent/i,
  /^(create|start)[-_]?dev/i,
  /^cron[-_]?(list|next)/i,
  /^gmail/i,
  /^shopping/i,
  /^budget/i,
];

// ── MCP-only tool patterns (main session only, not available in sub-agents) ──
const MCP_TOOL_PATTERNS = [
  /perplexity/i,
  /exa[-_]?(search|find|contents|similar)/i,
  /^exa$/i,
  /perplexity[-_]?(ask|search|query)/i,
  /ms[-_]?learn/i,
  /workiq/i,
  /msx/i,
  /copilot[-_]?usage/i,
  /{{EMPLOYER_PARENT}}[-_]?mcp/i,
];

const STANDARD_DENY_MSG = [
  "🚫 BLOCKED: tool_search for standard platform tools.",
  "These tools are ALWAYS available — call them directly:",
  "complete_task, update_task, list_tasks, add_task, telegram_send_message,",
  "gcal_create_event, gcal_list_events, store_memory, dev_add, dev_commit,",
  "dev_push, dev_status, gmail_search, shopping_list tools, budget tools.",
  "Do NOT search — just call the tool by name.",
].join(" ");

const MCP_DENY_MSG = [
  "🚫 BLOCKED: tool_search for MCP tools.",
  "MCP tools (Perplexity, Exa, WorkIQ, MSX) are ONLY in the MAIN session.",
  "Sub-agents: use web_fetch as fallback.",
  "Main session: these tools are already available — call them directly by name.",
  "Do NOT search for MCP tools with tool_search_tool_regex.",
].join(" ");

/**
 * Check if a search pattern matches standard tools (always available).
 */
function isStandardToolSearch(pattern) {
  if (!pattern || typeof pattern !== "string") return false;
  for (const stdPattern of STANDARD_TOOL_PATTERNS) {
    if (stdPattern.test(pattern)) return true;
  }
  return false;
}

/**
 * Check if a search pattern matches MCP-only tools (main session only).
 */
function isMcpToolSearch(pattern) {
  if (!pattern || typeof pattern !== "string") return false;
  for (const mcpPattern of MCP_TOOL_PATTERNS) {
    if (mcpPattern.test(pattern)) return true;
  }
  return false;
}

// ── Join Session ────────────────────────────────────────────────────────────

await joinSession({
  tools: [],
  hooks: {
    onPreToolUse: async (input) => {
      if (input.toolName !== "tool_search_tool_regex") return;

      const searchPattern = input.toolArgs?.pattern;

      // DENY MCP tool searches (more specific guidance)
      if (isMcpToolSearch(searchPattern)) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason: MCP_DENY_MSG,
        };
      }

      // DENY standard tool searches
      if (isStandardToolSearch(searchPattern)) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason: STANDARD_DENY_MSG,
        };
      }
    },

    // Defense-in-depth: advisory after execution if preToolUse didn't fire
    onPostToolUse: async (input) => {
      if (input.toolName !== "tool_search_tool_regex") return;

      const searchPattern = input.toolArgs?.pattern;

      if (isMcpToolSearch(searchPattern)) {
        return { additionalContext: MCP_DENY_MSG };
      }

      if (isStandardToolSearch(searchPattern)) {
        return { additionalContext: STANDARD_DENY_MSG };
      }
    },

    onSessionStart: async () => {
      return {
        additionalContext: [
          "[tool-fishing-guard] Extension loaded — DENY hook active (preToolUse + postToolUse).",
          "Standard platform tools (tasks, telegram, gcal, dev-workflow, memory, agents, cron) are always available — call directly.",
          "MCP tools (Perplexity, Exa, WorkIQ, MSX) are main-session-only — sub-agents use web_fetch as fallback.",
          "Do not search for either category with tool_search_tool_regex — calls WILL BE BLOCKED.",
        ].join(" "),
      };
    },
  },
});
