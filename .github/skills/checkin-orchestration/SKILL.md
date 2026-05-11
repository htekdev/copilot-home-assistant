---
name: checkin-orchestration
description: Parallel multi-agent dispatch and report compilation pattern — discover agents, launch in parallel, collect results, compile consolidated notification. Use when user says "orchestrate agents", "dispatch agents", "parallel launch", "compile reports", "agent check-in", "consolidated report", "multi-agent dispatch", or any orchestrator needs to coordinate multiple sub-agents.
---

# Check-In Orchestration Skill

Canonical pattern for discovering domain agents, dispatching them in parallel, collecting their reports, and compiling a consolidated notification. Used by checkin, weekly-planner, budget-review, and any agent that orchestrates multiple sub-agents.

## When To Use

Any time you need to:
- Launch multiple agents for the same purpose (check-in, review, audit)
- Collect and synthesize results from parallel agents
- Send one consolidated message instead of per-agent spam
- Handle partial failures gracefully (one agent failing ≠ everything fails)

## The Pattern

```
Discover → Filter → Dispatch (parallel) → Collect → Compile → Notify (single message)
```

## Step 1: Discover Domain Agents

```
glob(pattern: ".github/agents/*.agent.md")
```

Parse agent names from filenames (strip `.agent.md` suffix).

### Exclusion Rules

Filter OUT these agent types — they are NOT domain agents and should NOT be dispatched:

| Exclusion Category | Examples | Why |
|-------------------|----------|-----|
| **Orchestrators** | checkin, daily-briefing, budget-review, weekly-planner, meal-planner, heartbeat | They dispatch others; dispatching them creates loops |
| **Team agents** | Any `*-team` agent (e.g., realtor-team) | Run on own cron; never dispatched by generic orchestrators |
| **Team dedicated agents** | Discovered dynamically from `data/agents/{team}/team-manifest.md` | Owned by their team, not the generic checkin |
| **Utility agents** | skill-optimizer, context-auditor, platform-manager, coding-agent | Meta-agents that audit/maintain the platform itself |
| **Test agents** | test-hotreload, hotreload-proof | Not domain agents |

### Dynamic Team Exclusion

For each `*-team` agent found:
1. Read `data/agents/{team-name}/team-manifest.md`
2. Parse the Team Roster table
3. Extract agent names where Type = `dedicated`
4. Add ALL dedicated agents to exclusion list
5. `shared` agents are NOT excluded — they run normally

## Step 2: Dispatch in Parallel

Launch ALL remaining agents simultaneously using the `task` tool with `mode: "background"`.

### Standard Prompt Template

```
Scheduled check-in. Current time: {CURRENT_TIME}.
IMPORTANT: Use this exact time to filter all time-sensitive data — only report FUTURE events/tasks (start time after {CURRENT_TIME}). Do NOT report past events as upcoming.
Check your domain for updates, urgent items, and anything noteworthy.
TASK-FIRST: If you discover anything actionable, CREATE A TASK via add_task — don't just report it.
Only send Telegram for URGENT items.
Return: STATUS: [updates/nothing], URGENT_SENT: [yes/no], TASKS_CREATED: [list or none], REPORT: [2-4 bullet points or "All clear."]
```

### Key Rules
- Pass computed `CURRENT_TIME` (from `time-awareness` skill) to every agent
- Each agent uses its own `agent_type` matching its `name`
- Never reuse or steer an existing agent — always launch fresh
- All launches happen in ONE batch (one response, multiple `task` calls)

## Step 3: Collect Reports

Wait for all agents using `read_agent(agent_id, wait=true)`.

Parse each result for:
- `STATUS`: "updates" or "nothing"
- `URGENT_SENT`: whether they already sent their own Telegram
- `TASKS_CREATED`: what tasks they auto-generated
- `REPORT`: the human-readable summary

### Handling Failures
- If an agent times out or errors → note: "⚠️ {Agent}: check-in failed — will retry next cycle"
- Never let one agent's failure block report compilation
- If 3+ agents fail → include a diagnostic alert in the report

## Step 4: Compile Consolidated Report

Build ONE message from only agents that had updates:

```
🤖 Agent Check-In — {DAY}, {DATE} {TIME}

{emoji} {Agent Name}:
{agent_report}

{emoji} {Agent Name}:
{agent_report}

✅ All agents checked in. {X}/{TOTAL} had updates.
```

### Compilation Rules
- **OMIT** agents that reported "All clear" / "nothing" — don't include them
- If an agent sent an urgent Telegram, note: "(⚡ urgent alert sent)"
- Keep each section to 2-4 lines max
- If ALL agents report nothing → **stay completely silent** — return "No activity"
- **Only send Telegram if genuinely actionable updates exist.** Routine confirmations = silence.

## Step 5: Send (Single Notification)

```
telegram_send_message(
  chat_id: "{{TELEGRAM_PARENT_1}}",
  message: [compiled report],
  speak: "[1-2 sentence summary of what's noteworthy]"
)
```

### When to Stay Silent
- All agents reported "nothing" / "All clear"
- Only updates are routine status confirmations (e.g., "repos stable", "cron healthy")
- It's quiet hours and nothing is urgent

## Quiet Hours Guard

Before dispatching, check time:
- If 10 PM – 6 AM CT → only dispatch if a known urgent matter exists
- Quick scan of `data/agents/*/working.md` for anything flagged urgent
- If nothing urgent → return "No activity — quiet hours"

## Performance Targets

- Launch all agents in parallel (one batch)
- Each agent should complete within 2-3 minutes
- Full orchestration: ≤5 minutes total
- If an agent exceeds 3 minutes, collect available results and note the timeout

## Anti-Patterns

- ❌ Dispatching agents sequentially (always parallel)
- ❌ Sending per-agent Telegram messages (always compile into one)
- ❌ Including "All clear" sections in the report (omit them)
- ❌ Dispatching team-dedicated agents (they're owned by their team)
- ❌ Dispatching orchestrators (creates recursive loops)
- ❌ Sending reports when nothing actionable happened (stay silent)
- ❌ Using `write_agent` to steer existing agents for cron dispatches (always fresh)
