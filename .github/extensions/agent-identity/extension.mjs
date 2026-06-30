/**
 * Agent Identity Extension — Timing Correlation with Parallel-Safety
 *
 * HOW IT WORKS:
 *
 * 1. onPostToolUse for task() → push {agent_id, agent_type, agent_name} to FIFO queue
 * 2. onPreToolUse for ANY tool → if sessionId is NEW (never seen, not main session):
 *    a. If pendingQueue has EXACTLY 1 entry → bind unambiguously (high confidence)
 *    b. If pendingQueue has >1 entries → mark as "ambiguous" (parallel launch safety)
 *    c. If pendingQueue is empty → mark as unknown
 * 3. get_agent_type tool → look up caller's sessionId in identityMap → return identity
 *
 * WHY OPTION 4 (single-agent binding only):
 * - FIFO ordering assumes launch order == execution order, which FAILS under parallelism
 * - Agent A queued first but Agent B makes its first tool call first → B gets A's identity
 * - Fix: only bind when there's exactly 1 candidate (unambiguous). Otherwise, be honest.
 */
import { joinSession } from "@{{EMPLOYER_PARENT}}/copilot-sdk/extension";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ── Debug File ──────────────────────────────────────────────────────────────

const DEBUG_LOG = resolve(process.cwd(), "data", "agent-identity-debug.log");
const debugDir = dirname(DEBUG_LOG);
if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });

writeFileSync(DEBUG_LOG, `=== AGENT IDENTITY — TIMING CORRELATION ===\nStarted: ${new Date().toISOString()}\n\n`, "utf-8");

function debugToFile(hook, data) {
  try {
    appendFileSync(DEBUG_LOG, JSON.stringify({ hook, ts: new Date().toISOString(), ...data }, null, 2) + "\n---\n", "utf-8");
  } catch {}
}

function log(msg) {
  process.stderr.write(`[agent-identity] ${msg}\n`);
}

// ── Shared Map File ─────────────────────────────────────────────────────────

const MAP_FILE = resolve(process.cwd(), "data", "agent-identity-map.json");

function persistMap() {
  try {
    const obj = Object.fromEntries(identityMap);
    writeFileSync(MAP_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch (e) {
    log(`Failed to persist identity map: ${e.message}`);
  }
}

// ── State ───────────────────────────────────────────────────────────────────

/** FIFO queue of recently launched agents awaiting their first tool call */
const pendingAgents = [];

/** sessionId → { agent_type, agent_name, agent_id, bound_at } */
const identityMap = new Map();

/** Set of all known sessionIds (main + already-bound sub-agents) */
const knownSessions = new Set();

/** The main session's ID — captured from first tool call we see */
let mainSessionId = null;

/** Stashed by onPreToolUse for get_agent_type */
let _pendingCallerSessionId = null;

// ── Join Session ────────────────────────────────────────────────────────────

await joinSession({
  tools: [
    {
      name: "get_agent_type",
      description:
        "Returns the calling agent's identity (agent_type and agent_name). " +
        "No parameters needed — auto-detects caller via timing correlation. " +
        "Use to discover your own agent type at runtime.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      handler: async () => {
        const sessionId = _pendingCallerSessionId;
        _pendingCallerSessionId = null;

        debugToFile("TOOL_HANDLER", {
          sessionId,
          mapSize: identityMap.size,
          mapEntries: Object.fromEntries(identityMap),
          pendingQueue: pendingAgents.length,
        });

        if (!sessionId) {
          return JSON.stringify({ error: "no_session_id", note: "onPreToolUse did not capture sessionId" });
        }

        const identity = identityMap.get(sessionId);
        if (identity) {
          if (identity.ambiguous) {
            return JSON.stringify({
              agent_type: "ambiguous",
              agent_name: "parallel-launch",
              session_id: sessionId,
              note: "Parallel launch — identity unresolved. Multiple agents were pending when this session started.",
              candidates: identity.candidates || [],
            });
          }
          return JSON.stringify({
            agent_type: identity.agent_type,
            agent_name: identity.agent_name,
            agent_id: identity.agent_id,
            session_id: sessionId,
          });
        }

        if (sessionId === mainSessionId) {
          return JSON.stringify({
            agent_type: "main-session",
            agent_name: "orchestrator",
            session_id: sessionId,
          });
        }

        return JSON.stringify({
          agent_type: "unknown",
          agent_name: "unknown",
          session_id: sessionId,
          note: "Session not in identity map and no pending agents in queue at bind time.",
          pending_queue_size: pendingAgents.length,
        });
      },
    },
  ],

  hooks: {
    // ─── Capture task() completions → queue identity ─────────────────────
    onPostToolUse: async (input) => {
      const tool = input.toolName || "";
      const sid = input.sessionId || "";

      // Identify main session from postToolUse (it's always the orchestrator calling task())
      if (!mainSessionId && sid) {
        mainSessionId = sid;
        knownSessions.add(sid);
        debugToFile("MAIN_SESSION_IDENTIFIED", { mainSessionId: sid });
        log(`Main session identified: ${sid.slice(0, 20)}...`);
      }

      if (tool !== "task") return;

      // Parse toolArgs
      let args = input.toolArgs;
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { args = {}; }
      }

      // Extract agent_id from toolResult
      const result = input.toolResult || {};
      const agentId = result?.toolTelemetry?.restrictedProperties?.agent_id
        || result?.agent_id || result?.agentId || null;

      const agentType = args?.agent_type || "unknown";
      const agentName = args?.name || agentType;
      const agentModel = args?.model || "";

      if (!agentId) {
        debugToFile("TASK_NO_AGENT_ID", { args, result });
        return;
      }

      const entry = {
        agent_id: agentId,
        agent_type: agentType,
        agent_name: agentName,
        model: agentModel,
        launched_at: new Date().toISOString(),
      };

      pendingAgents.push(entry);
      debugToFile("QUEUED", { entry, queueSize: pendingAgents.length });
      log(`Queued: ${agentType}/${agentName} (id=${agentId}) — queue size: ${pendingAgents.length}`);
    },

    // ─── Watch ALL tool calls for new sessionIds → bind from queue ────────
    onPreToolUse: async (input) => {
      const sid = input.sessionId || "";
      const tool = input.toolName || "";

      // Stash for get_agent_type handler
      if (tool === "get_agent_type") {
        _pendingCallerSessionId = sid;
      }

      // Skip if no sessionId
      if (!sid) return;

      // If this is the main session, mark it and skip
      if (sid === mainSessionId) return;

      // If already known, skip
      if (knownSessions.has(sid)) return;

      // NEW SESSION DETECTED — this is a sub-agent's first tool call!
      knownSessions.add(sid);

      if (pendingAgents.length === 1) {
        // SAFE: exactly one pending agent → unambiguous binding
        const entry = pendingAgents.shift();

        identityMap.set(sid, {
          ...entry,
          bound_at: new Date().toISOString(),
          first_tool: tool,
        });

        // Persist to shared file for other extensions
        persistMap();

        debugToFile("BOUND", {
          sessionId: sid,
          entry,
          firstTool: tool,
          remainingQueue: pendingAgents.length,
        });
        log(`BOUND: ${sid.slice(0, 20)}... → ${entry.agent_type}/${entry.agent_name} (first tool: ${tool})`);
      } else if (pendingAgents.length > 1) {
        // AMBIGUOUS: multiple agents pending → cannot safely determine which one this is
        identityMap.set(sid, {
          agent_id: "ambiguous",
          agent_type: "ambiguous",
          agent_name: "parallel-launch",
          bound_at: new Date().toISOString(),
          first_tool: tool,
          ambiguous: true,
          candidates: pendingAgents.map(e => `${e.agent_type}/${e.agent_name}`),
        });

        // Persist to shared file for other extensions
        persistMap();

        debugToFile("AMBIGUOUS_BIND", {
          sessionId: sid,
          firstTool: tool,
          pendingCount: pendingAgents.length,
          candidates: pendingAgents.map(e => `${e.agent_type}/${e.agent_name}`),
          note: "Multiple agents pending — identity unresolved to avoid mismatch",
        });
        log(`AMBIGUOUS: ${sid.slice(0, 20)}... — ${pendingAgents.length} agents pending, cannot identify safely`);
      } else {
        // No pending agents — can't identify this session
        debugToFile("NEW_SESSION_NO_QUEUE", {
          sessionId: sid,
          firstTool: tool,
          note: "New session appeared but pending queue is empty",
        });
        log(`New session ${sid.slice(0, 20)}... but queue empty — cannot identify`);
      }
    },
  },
});

debugToFile("EXTENSION_LOADED", { note: "Timing correlation active", mainSessionId });
log("Extension loaded — timing correlation active.");
