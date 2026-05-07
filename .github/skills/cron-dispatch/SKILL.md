---
name: cron-dispatch
description: Cron job dispatch rules — always launch fresh agents via task tool, never write_agent for scheduled jobs. Use when user says "cron dispatch", "scheduled job", "launch cron", "cron architecture", "fresh agent for cron", "cron rule", "dispatch pattern", or any cron-triggered agent execution.
---

# Cron Dispatch Skill

The canonical rules for how cron-scheduled jobs dispatch agents in the {{FAMILY_NAME}} family platform. This is the #1 operational rule that prevents context pollution and agent degradation.

## The Rule (ABSOLUTE — zero exceptions)

**Cron-dispatched agents MUST ALWAYS be launched as NEW agents via the `task` tool. NEVER use `write_agent` to steer/inject into an existing agent for cron dispatches.**

Each cron cycle gets a **fresh agent with clean context**. No exceptions.

## Why This Matters

When cron fires (e.g., task-coach every 20 min), injecting messages into an already-running agent via `write_agent`:
- Pollutes the agent's context with irrelevant messages ("stay silent", "quiet hours", "don't nudge")
- Degrades agent performance over time as context fills with stale instructions
- Creates unpredictable behavior — the agent carries forward state it shouldn't have
- Makes debugging impossible — which cron cycle caused the issue?

**{{PARENT_1}} explicitly forbids this pattern.** It was causing agents to receive corrupted behavioral instructions from prior cycles.

## How Cron Works

1. **Configuration**: All cron jobs defined in `cron.json` at repo root
2. **Engine**: The `cron-scheduler` extension (`.{{EMPLOYER_PARENT}}/extensions/cron-scheduler/extension.mjs`) reads `cron.json`, parses 5-field cron expressions, checks every 60 seconds
3. **Firing**: When a job matches, `session.send()` delivers the dispatch message to the main session
4. **Dispatch**: The main session launches a NEW agent via `task` tool

**There is NO `/cron` slash command. There is NO built-in cron feature in Copilot CLI.** Cron is 100% defined by the extension + `cron.json`.

## Correct Dispatch Pattern

```
# When a cron job fires, the main session MUST:
task(
  agent_type: "{agent-from-cron.json}",
  prompt: "{job prompt or default instructions}",
  name: "{agent-name}-cron",
  description: "Scheduled {agent} run"
)
```

**Even if a previous instance of the same agent type is still running from a prior cron cycle, launch a NEW one.** Let the old one finish naturally.

## Decision Flow

```
Cron fires → main session receives dispatch message →
  1. Is this a scheduled/cron job? → ALWAYS launch fresh via task()
  2. Never check for existing idle agents
  3. Never use write_agent()
  4. Fresh context, clean slate, every time
```

## Anti-Patterns (NEVER do these)

| ❌ Anti-Pattern | ✅ Correct Pattern |
|---|---|
| `list_agents()` → find idle task-coach → `write_agent(agent_id, "new cycle")` | `task(agent_type="task-coach", prompt="...", ...)` |
| Reusing a running agent for a new cron cycle | Launch new agent, let old one finish |
| Injecting "quiet hours" / "don't nudge" into running agents | Fresh agent reads time, decides for itself |
| Funneling all cron jobs through one persistent agent | Each job = independent fresh agent |

## Cron Job Schema (cron.json)

```json
{
  "timezone": "{{TIMEZONE}}",
  "jobs": [
    {
      "id": "job-name",
      "schedule": "*/20 * * * *",
      "enabled": true,
      "agent": "task-coach",
      "prompt": "Optional custom instructions for this cycle"
    }
  ]
}
```

**Required fields:** `id`, `schedule`, `enabled`, `agent`
**Optional:** `prompt` (overrides default agent behavior for this job)

## Managing Cron Jobs

- **List jobs**: `cron_list_jobs` tool
- **Check next fire**: `cron_next_run` tool
- **Add/modify**: Edit `cron.json` directly (hot-reloads every 5 seconds)
- **Disable**: Set `"enabled": false` on the job

## When to Still Use write_agent

`write_agent` is valid for **interactive follow-ups** only:
- User says something that CONTINUES an existing conversation
- A correction/clarification to a running agent's current work
- **NEVER for scheduled/cron dispatches**

The question is: "Does this message CONTINUE an existing conversation, or START a new one?" Cron jobs ALWAYS start new.
