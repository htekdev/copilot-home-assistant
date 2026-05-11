---
name: agent-dispatch
description: Agent dispatch decision framework — when to launch new agents via task tool vs steer existing idle agents via write_agent. Use when user says "launch agent", "steer agent", "dispatch agent", "write_agent or task", "existing agent", "idle agent", "new vs existing", "agent decision", or any multi-agent orchestration decision.
---

# Agent Dispatch Skill

The canonical decision framework for choosing between launching a fresh agent (`task` tool) vs steering an existing idle agent (`write_agent`). This applies to ALL orchestration decisions, not just cron (cron has its own absolute rule — see `cron-dispatch` skill).

## The Core Question

**Does this message CONTINUE an existing conversation, or START a new one?**

## Decision Flow

```
1. list_agents() → check for IDLE agents
2. Is there an idle agent in the SAME domain as this request?
   NO → Launch new (task tool)
3. Is this a FOLLOW-UP to that agent's prior work?
   (correcting, clarifying, continuing a discussion)
   NO → Launch new (task tool)
4. Does that agent have CONTEXT that would be lost by launching fresh?
   (names, decisions, partial work, conversation state)
   NO → Launch new (task tool)
5. Is this a CRON dispatch?
   YES → Launch new ALWAYS (see cron-dispatch skill — ABSOLUTE rule)
6. All conditions met → STEER via write_agent
```

## Launch New Agent (task tool) — WHEN ANY is true

| Signal | Example |
|--------|---------|
| New topic unrelated to any running agent | "Plan meals for next week" when only a finance agent is idle |
| No idle agents exist | Nothing in list_agents with matching domain |
| No relevant context in existing agent | Agent was doing X, new request is about Y |
| High-quality results needed with clean slate | Complex analysis, report generation |
| Standalone request with no dependency on prior conversation | "Run my daily briefing" |
| Unsure whether to steer or launch | **Default to launch — clean context never hurts** |
| **ALL cron-dispatched jobs** | **Always fresh, zero exceptions** |

## Steer Existing Agent (write_agent) — WHEN ALL are true

| Condition | Why |
|-----------|-----|
| An IDLE agent exists in the same domain | Agent is available and not running |
| Message is a follow-up | Correcting, clarifying, or continuing prior work |
| Agent has context that would be lost | Names, decisions, partial calculations |
| NOT a cron dispatch | Cron always gets fresh agents |

### Examples of Valid Steering

```
# User said "add eggs to the list" — shopping agent already has the grocery context
write_agent(agent_id: "shopping-abc", message: "Also add eggs to the H-E-B cart")

# User corrected a misidentified card — finance agent has the card discussion
write_agent(agent_id: "finance-xyz", message: "No, the Savor is the subscription card, not the travel card")

# User wants to continue a meal plan conversation
write_agent(agent_id: "meal-abc", message: "What about Thursday dinner?")
```

## Anti-Patterns (NEVER do these)

- ❌ Funneling every task through `write_agent` just because an agent is idle
- ❌ Steering cron jobs into existing agents (ABSOLUTE prohibition)
- ❌ Injecting unrelated work into an agent that's idle but in a different domain
- ❌ Assuming an agent's context is still relevant hours after its last turn
- ❌ Using `write_agent` for complex new requests that deserve clean context

## Priority Guideline

When in doubt: **launch new**. The cost of a fresh agent is ~30-60s startup time. The cost of polluted context is degraded output quality, confused behavior, and debugging nightmares.

## Relationship to Other Skills

- **`cron-dispatch`** — Contains the absolute rule for cron jobs (always fresh). This skill covers the general case.
- **`quick-task-transition`** — For "done/next" transitions, handle inline (no agent at all). This skill is for when you DO need an agent.
