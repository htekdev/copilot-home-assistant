---
name: agent-steering
description: >
  Background agent steering protocol — when to use write_agent vs launching fresh,
  run isolation guards, and cron exception rules. Use when user says "steer agent",
  "write_agent", "background agent", "run isolation", "inject context", "running agent",
  "agent communication", or any background agent interaction decision.
---

# Agent Steering Skill

Canonical protocol for interacting with background agents via `write_agent`. Covers the steering pattern, run isolation guard, and cron exception.

## Core Pattern

When an agent is running in the background (via `task` tool with `mode="background"`) and new context arrives:

- **Use `write_agent`** to inject the update into the running session — don't kill and relaunch
- The agent will incorporate the new instructions while preserving its full context
- This avoids losing accumulated state (research, calculations, partial results)

## Run Isolation Guard (Pipeline Agents)

**⚠️ CRITICAL for multi-run agents (content pipeline, video production, client projects):**

Only steer within the SAME `run_id`. If a new production run, video upload, or independent request arrives:
- **ALWAYS launch a fresh agent instance** via `task` tool
- **NEVER inject a new run's context/assets** into an agent processing a different run
- Cross-run contamination corrupts transcripts, research, deliverables, and publish targets

### Examples

```
# ✅ CORRECT — follow-up within same run
write_agent(agent_id: "editor-abc", message: "YouTube URL is now available: https://...")

# ❌ WRONG — new video into existing session
write_agent(agent_id: "editor-abc", message: "New video uploaded: C:\vidpipe\new-video.mp4")
# ^ This contaminates the first run's context. Launch fresh instead.
```

## Cron Exception (ABSOLUTE RULE)

**Cron dispatches MUST ALWAYS launch fresh agents via `task` tool.** Never use `write_agent` for cron-dispatched instances. The steering protocol is ONLY for interactive follow-ups within the same request/run.

See `cron-dispatch` skill for the full rationale.

## When to Steer vs Launch Fresh

| Scenario | Action |
|----------|--------|
| Follow-up in same run/request | `write_agent` ✅ |
| New production run / new video | Launch fresh ✅ |
| Cron-triggered job | Launch fresh ✅ |
| Correction to ongoing work | `write_agent` ✅ |
| Unrelated request, same agent type | Launch fresh ✅ |
| Providing missing data agent asked for | `write_agent` ✅ |

## Integration

- **Complements `agent-dispatch` skill** — that skill covers the orchestrator's decision; this skill covers the protocol once the decision is made
- **Complements `cron-dispatch` skill** — that skill covers why cron always gets fresh agents
