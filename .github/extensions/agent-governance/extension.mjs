/**
 * Agent Governance Extension for GitHub Copilot CLI
 *
 * Enforces behavioral rules on sub-agents via lifecycle hooks:
 *   - onSubagentStart: Injects requirements (skill loading, agent-specific rules)
 *   - onSubagentStop: Checks completion quality (did it load skills? expected tools?)
 *   - onPostToolUse: Tracks tool calls per sub-agent session for correlation
 *
 * Governance rules:
 *   1. "If an agent is called, it MUST first load relevant skills"
 *   2. "If an agent finishes WITHOUT calling expected tools, dispatch follow-up"
 *   3. "If an agent calls tool Z, it MUST also call tool W" (pair rules)
 *
 * Logs governance events to: .local/audit/governance.jsonl (append-only)
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { joinSession } from "@github/copilot-sdk/extension";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const REPO_ROOT = process.cwd();
const AGENTS_DIR = resolve(REPO_ROOT, ".github", "agents");
const AUDIT_DIR = resolve(REPO_ROOT, ".local", "audit");
const GOV_LOG = resolve(AUDIT_DIR, "governance.jsonl");
const TZ = "America/Chicago";

// ---------------------------------------------------------------------------
// Agent Identity Registry — reads all .agent.md files at startup
// ---------------------------------------------------------------------------
function buildAgentRegistry() {
  const registry = new Map();
  if (!existsSync(AGENTS_DIR)) return registry;
  for (const file of readdirSync(AGENTS_DIR)) {
    if (!file.endsWith(".agent.md")) continue;
    try {
      const content = readFileSync(join(AGENTS_DIR, file), "utf-8");
      const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const fm = fmMatch[1];
      const name = (fm.match(/^name:\s*"?([^"\n]*)"?/m) || [])[1]?.trim();
      const desc = (fm.match(/^description:\s*"?([^"\n]*)"?/m) || [])[1]?.trim();
      if (name) {
        registry.set(name, { name, description: desc || name, file });
      }
    } catch { /* skip unreadable */ }
  }
  return registry;
}

const AGENT_REGISTRY = buildAgentRegistry();

// ---------------------------------------------------------------------------
// Agent-specific governance rules
// ---------------------------------------------------------------------------

/**
 * Agents that MUST invoke the `skill` tool before doing substantive work.
 * Lightweight agents (explore, task, code-review) are exempt.
 */
const SKILL_REQUIRED_AGENTS = new Set([
  "coding-agent",
  "platform-manager",
  "content-manager",
  "content-creative",
  "content-illustrator",
  "content-editor",
  "content-scheduler",
  "blog-writer",
  "harness-tracker",
  "finance-manager",
  "nicu-care",
  "task-coach",
  "daily-briefing",
  "heartbeat",
  "repo-maintainer",
  "skill-optimizer",
  "article-maintenance",
  "blueprint-manager",
  "linkedin-outreach",
  "wellness-coach",
  "work-life-sync",
  "quality-agent",
]);

/**
 * Agents exempt from skill-loading requirements.
 * These are stateless utility agents or pure-research agents.
 */
const SKILL_EXEMPT_AGENTS = new Set([
  "explore",
  "task",
  "code-review",
  "research",
  "general-purpose",
]);

/**
 * Expected tools per agent type. If an agent finishes without calling
 * at least one of its expected tools, it's flagged as incomplete.
 */
const EXPECTED_TOOLS = {
  "coding-agent": ["edit", "create", "dev_commit", "grep", "view"],
  "content-creative": ["late_create_post", "generate_image"],
  "content-illustrator": ["generate_image"],
  "heartbeat": ["gmail_search", "list_tasks", "telegram_send_message"],
  "daily-briefing": ["telegram_send_message", "gcal_today"],
  "repo-maintainer": ["powershell"], // git operations via powershell
  "task-coach": ["list_tasks", "telegram_send_message"],
  "nicu-care": ["update_pump_schedule", "telegram_send_message"],
  "finance-manager": ["list_tasks", "telegram_send_message"],
};

/**
 * Tool pair rules: if an agent calls toolA, it MUST also call toolB.
 * Format: { toolA: toolB }
 */
const TOOL_PAIR_RULES = {
  dev_add: "dev_commit",       // If you stage, you must commit
  dev_commit: "dev_push",      // If you commit, you must push
  generate_image: "dev_commit", // If you generate an image, commit it
};

/**
 * Agent-specific additionalContext injected on start.
 */
const AGENT_REQUIREMENTS = {
  "coding-agent": [
    "MANDATORY: Use dev-workflow tools (dev_add, dev_commit, dev_push) — NEVER raw git commands.",
    "MANDATORY: For rocha-family repo, commit directly to main. NEVER create branches or PRs here.",
  ].join("\n"),
  "content-illustrator": [
    "MANDATORY: Every illustration MUST include subtle htek.dev branding (bottom-right watermark or footer chip).",
    "MANDATORY: Hero images must be OG-sized at 1200x630 with dark premium tech aesthetic.",
  ].join("\n"),
  "content-creative": [
    "MANDATORY: Every social media post MUST include links to source material.",
    "MANDATORY: Check Late API for existing scheduled posts before creating duplicates.",
  ].join("\n"),
  "blog-writer": [
    "MANDATORY: Run quality-gate skill before publishing. No exceptions.",
    "MANDATORY: Never mention Enbridge or previous employer by name.",
  ].join("\n"),
  "repo-maintainer": [
    "MANDATORY: Use dev-workflow tools (dev_add, dev_commit, dev_push) — NEVER raw git commands.",
    "MANDATORY: For non-rocha-family repos, use branch + PR workflow.",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// In-memory state — tracks active sub-agent sessions
// ---------------------------------------------------------------------------

/**
 * Map of toolCallId → { agentName, startTime, tools: string[] }
 * Populated by onSubagentStart, updated by onPostToolUse, consumed by onSubagentStop.
 */
const activeSessions = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  process.stderr.write(`[agent-governance] ${msg}\n`);
}

function ensureDir() {
  if (!existsSync(AUDIT_DIR)) {
    mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

function nowISO() {
  return new Date().toISOString();
}

function emitGov(event, data) {
  try {
    ensureDir();
    const line = JSON.stringify({ timestamp: nowISO(), event, ...data }) + "\n";
    appendFileSync(GOV_LOG, line, "utf-8");
  } catch (err) {
    log(`Write error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Governance Logic
// ---------------------------------------------------------------------------

function buildStartContext(agentName) {
  const lines = [];

  // Universal skill-loading requirement
  if (SKILL_REQUIRED_AGENTS.has(agentName) || !SKILL_EXEMPT_AGENTS.has(agentName)) {
    lines.push(
      "[agent-governance] You MUST first load relevant skills (invoke the `skill` tool) before proceeding with substantive work. " +
      "Skills contain domain-specific procedures, rules, and conventions that prevent mistakes. " +
      "Check `.github/skills/` for applicable skills to your task."
    );
  }

  // Agent-specific requirements
  if (AGENT_REQUIREMENTS[agentName]) {
    lines.push(`[agent-governance] Agent-specific rules for ${agentName}:\n${AGENT_REQUIREMENTS[agentName]}`);
  }

  // Universal dev-workflow reminder for agents that commonly use git
  const GIT_AGENTS = new Set(["coding-agent", "repo-maintainer", "platform-manager", "content-illustrator", "skill-optimizer"]);
  if (GIT_AGENTS.has(agentName)) {
    lines.push(
      "[agent-governance] CRITICAL: NEVER use raw git commands. Use dev-workflow tools: dev_add, dev_commit, dev_push, dev_checkout, start_dev_branch."
    );
  }

  return lines.length > 0 ? lines.join("\n\n") : undefined;
}

function evaluateCompletion(agentName, tools) {
  const issues = [];

  // Check skill loading
  const needsSkill = SKILL_REQUIRED_AGENTS.has(agentName) || !SKILL_EXEMPT_AGENTS.has(agentName);
  const loadedSkill = tools.includes("skill");
  if (needsSkill && !loadedSkill && tools.length > 3) {
    // Only flag if the agent did meaningful work (>3 tool calls) without loading skills
    issues.push({
      type: "skill_not_loaded",
      severity: "warning",
      message: `${agentName} completed ${tools.length} tool calls without loading any skills.`,
    });
  }

  // Check expected tools
  const expected = EXPECTED_TOOLS[agentName];
  if (expected) {
    const calledExpected = expected.filter((t) => tools.includes(t));
    if (calledExpected.length === 0 && tools.length > 2) {
      issues.push({
        type: "expected_tools_missing",
        severity: "warning",
        message: `${agentName} did not call any expected tools (${expected.join(", ")}). Called: ${[...new Set(tools)].join(", ")}`,
      });
    }
  }

  // Check tool pair rules
  for (const [toolA, toolB] of Object.entries(TOOL_PAIR_RULES)) {
    if (tools.includes(toolA) && !tools.includes(toolB)) {
      issues.push({
        type: "tool_pair_violation",
        severity: "error",
        message: `${agentName} called ${toolA} but NOT ${toolB}. This is a governance violation.`,
      });
    }
  }

  // Check zero-tool completions (agent launched but did nothing)
  if (tools.length === 0) {
    issues.push({
      type: "zero_tools",
      severity: "error",
      message: `${agentName} completed with 0 tool calls — likely failed to start or hit an error.`,
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Main — join session with governance hooks
// ---------------------------------------------------------------------------

let _session = null;

const session = await joinSession({
  tools: [
    {
      name: "agent_governance_report",
      description:
        "View the agent governance report — shows sub-agent compliance metrics, " +
        "skill-loading rates, tool pair violations, and agents that completed without " +
        "calling expected tools. Use for platform health monitoring.",
      parameters: {
        type: "object",
        properties: {
          since_minutes: {
            type: "number",
            description: "Show events from the last N minutes. Default: 60",
          },
        },
      },
      handler: async (args) => {
        const sinceMinutes = args.since_minutes || 60;
        const since = Date.now() - sinceMinutes * 60 * 1000;

        // Read governance log
        if (!existsSync(GOV_LOG)) {
          return "No governance events recorded yet.";
        }

        const lines = readFileSync(GOV_LOG, "utf-8").split("\n").filter(Boolean);
        const events = [];
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            const ts = new Date(obj.timestamp).getTime();
            if (ts >= since) events.push(obj);
          } catch { /* skip malformed */ }
        }

        if (events.length === 0) {
          return `No governance events in the last ${sinceMinutes} minutes.`;
        }

        // Summarize
        const starts = events.filter((e) => e.event === "subagent_start");
        const stops = events.filter((e) => e.event === "subagent_stop");
        const violations = events.filter((e) => e.event === "governance_violation");

        const report = [
          `## Agent Governance Report (last ${sinceMinutes} min)`,
          "",
          `**Sub-agents started:** ${starts.length}`,
          `**Sub-agents completed:** ${stops.length}`,
          `**Governance violations:** ${violations.length}`,
          "",
        ];

        if (violations.length > 0) {
          report.push("### Violations");
          for (const v of violations.slice(-10)) {
            report.push(`- [${v.severity}] ${v.agent}: ${v.message}`);
          }
        }

        // Skill loading rate
        const stopsWithData = stops.filter((s) => s.tools);
        const skillLoaded = stopsWithData.filter((s) => s.tools.includes("skill"));
        if (stopsWithData.length > 0) {
          const rate = Math.round((skillLoaded.length / stopsWithData.length) * 100);
          report.push("", `**Skill loading rate:** ${rate}% (${skillLoaded.length}/${stopsWithData.length})`);
        }

        return report.join("\n");
      },
    },
  ],
  hooks: {
    // ─── onSubagentStart ─────────────────────────────────────────────────
    onSubagentStart: async (input) => {
      const agentName = input.agentName || input.name || "unknown";
      const toolCallId = input.toolCallId || input.sessionId || `anon-${Date.now()}`;

      // Track this session
      activeSessions.set(toolCallId, {
        agentName,
        startTime: Date.now(),
        tools: [],
      });

      // Log
      emitGov("subagent_start", { agent: agentName, toolCallId });
      log(`Sub-agent started: ${agentName} (${toolCallId.slice(0, 20)}...)`);

      // Build governance context to inject
      const ctx = buildStartContext(agentName);
      if (ctx) {
        return { additionalContext: ctx };
      }
    },

    // ─── onSubagentStop ──────────────────────────────────────────────────
    onSubagentStop: async (input) => {
      const agentName = input.agentName || input.name || "unknown";
      const toolCallId = input.toolCallId || input.sessionId || "";
      const durationMs = input.durationMs || 0;
      const totalToolCalls = input.totalToolCalls || 0;

      // Get tracked tools for this session
      const sessionData = activeSessions.get(toolCallId);
      const tools = sessionData ? sessionData.tools : [];

      // Evaluate completion quality
      const issues = evaluateCompletion(agentName, tools);

      // Log completion
      emitGov("subagent_stop", {
        agent: agentName,
        toolCallId,
        durationMs,
        totalToolCalls,
        toolsUsed: [...new Set(tools)],
        skillLoaded: tools.includes("skill"),
        issueCount: issues.length,
      });

      // Log violations
      for (const issue of issues) {
        emitGov("governance_violation", {
          agent: agentName,
          toolCallId,
          ...issue,
        });
        log(`VIOLATION [${issue.severity}] ${agentName}: ${issue.message}`);
      }

      // Clean up tracked session
      activeSessions.delete(toolCallId);

      // If there are critical issues, inject context for the parent session
      const errors = issues.filter((i) => i.severity === "error");
      if (errors.length > 0) {
        const errorSummary = errors.map((e) => `- ${e.message}`).join("\n");
        return {
          additionalContext:
            `[agent-governance] ⚠️ Sub-agent ${agentName} completed with governance violations:\n` +
            errorSummary +
            "\n\nConsider dispatching a follow-up agent to complete the missing work.",
        };
      }
    },

    // ─── onPreToolUse — sync task advisory (was: blanket denial, removed 2026-05-19) ───
    // Sync task calls are now ALLOWED. Quality-sensitive workflows (outreach,
    // content publishing) need sequential execution to wait for review results.
    // Background mode is still RECOMMENDED for independent/parallel work but
    // is no longer ENFORCED.

    // ─── onPostToolUse — correlate tool calls to active sub-agents ───────
    onPostToolUse: async (input) => {
      const sessionId = input.sessionId || "";
      const toolName = input.toolName || "";

      // If this tool call belongs to a tracked sub-agent session, record it
      if (activeSessions.has(sessionId)) {
        activeSessions.get(sessionId).tools.push(toolName);
      }

      // Check tool-pair rules in real-time (advisory only)
      // This fires after each tool call, so we can warn early
      if (activeSessions.has(sessionId)) {
        const session = activeSessions.get(sessionId);
        const pairedTool = TOOL_PAIR_RULES[toolName];
        if (pairedTool) {
          // Record that this agent now has a pending pair obligation
          if (!session.pendingPairs) session.pendingPairs = [];
          session.pendingPairs.push({ called: toolName, mustCall: pairedTool });
        }
      }
    },

    // ─── onSessionStart — announce governance is active ──────────────────
    onSessionStart: async () => {
      return {
        additionalContext:
          "[agent-governance] Extension loaded — monitoring sub-agent compliance. " +
          "Rules: skill loading required for domain agents, tool-pair enforcement " +
          "(dev_add→dev_commit, dev_commit→dev_push, generate_image→dev_commit), " +
          "expected-tools checks on completion. " +
          "Sync task calls are ALLOWED (background mode recommended for independent work but not enforced). " +
          "Use `agent_governance_report` to view metrics.",
      };
    },
  },
});

_session = session;

log("Agent governance extension loaded — monitoring sub-agent lifecycle hooks.");
