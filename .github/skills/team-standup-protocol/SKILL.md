---
name: team-standup-protocol
description: Team agent standup orchestration — phase-based sub-agent dispatch, standup prompt template, shared-agent dedup, progress collection, and consolidated reporting. Use when user says "team standup", "dispatch team", "team check-in", "run standup", "sub-agent dispatch", "team orchestration", or any team agent needs to coordinate its roster.
---

# Team Standup Protocol Skill

Standard orchestration pattern for Team Agents (goal-oriented agents that coordinate sub-agent rosters). Used by realtor-team and any future team agents.

## Prerequisites

Before running a standup, the team agent MUST have:
1. A `team-manifest.md` listing roster members, roles, and active phases
2. A `progress.md` tracking milestones and phase status
3. Access to the `task` tool for dispatching sub-agents

## Standup Workflow

### Step 0: Compute Current Time

```powershell
[System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), 'Central Standard Time').ToString('dddd, MMMM d, yyyy h:mm tt')
```

**Quiet hours check:** If 10 PM – 6 AM CT → return silently unless urgent.

### Step 1: Determine Current Phase

Read `data/agents/{team-name}/progress.md`. Identify:
- Which phase is ACTIVE
- Which milestones are in-progress
- Which sub-agents are relevant to this phase

### Step 2: Shared-Agent Dedup Check

For shared agents (agents that serve multiple masters, e.g., finance-manager):
1. Check `data/agents/{agent-name}/events.log` last entry
2. If the agent ran within the last 2 hours → **skip dispatch**
3. Read its latest `working.md` instead — use that as the standup report

This prevents double-dispatch when the shared agent's own cron already ran.

### Step 3: Dispatch Active Sub-Agents

For each agent listed as ACTIVE in the current phase:

```
task(
  agent_type: "{agent-name}",
  prompt: "Team standup for {team-name}. Current time: {CURRENT_TIME}.

You are part of the {team-name}. Current phase: {phase}.
Goal: {team goal from core.md}.

Your role on this team: {agent's role from manifest}.

Current milestones:
{relevant milestones from progress.md}

Your last report: {summary from that agent's working.md, or 'First check-in'}

Check your area for updates. Return:
PROGRESS: [any milestone movement]
BLOCKERS: [anything blocking progress]
ACTIONS_TAKEN: [tasks created, research done, etc.]
NEXT_STEPS: [what you'll do next cycle]
REPORT: [2-4 bullet summary]"
)
```

**Fallback:** If a roster role has no dedicated agent file, use `agent_type: "general-purpose"` and pass the role description from the manifest as scope.

### Step 4: Collect Reports

Wait for all dispatched agents to complete. Compile:
- Progress across all sub-agents
- Blockers (flag any that need human attention)
- Combined actions taken
- Phase advancement check: are all phase exit criteria met?

### Step 5: Phase Advancement Check

If ALL exit criteria for the current phase are satisfied:
1. Update `progress.md` — mark phase complete, activate next phase
2. Notify {{PARENT_1}} via Telegram: "🎉 {team-name} Phase N complete! Moving to Phase N+1."
3. Update `team-manifest.md` if the active roster changes

### Step 6: Consolidated Report to {{PARENT_1}}

Only send a Telegram update if there's meaningful progress or blockers:

```
telegram_send_message(
  chat_id: "{{TELEGRAM_PARENT_1}}",
  message: "🏡 {Team Name} Standup\n━━━━━━━━━\n{compiled report}",
  speak: "{1-sentence TTS summary of key progress or blocker}"
)
```

**Quiet standup rule:** If nothing changed since last cycle → skip the Telegram notification. Don't spam.

## Anti-Patterns

- ❌ Dispatching ALL agents regardless of phase (only dispatch phase-relevant agents)
- ❌ Sending Telegram for zero-progress standups
- ❌ Using `write_agent` for standup dispatch (always fresh `task` tool launch)
- ❌ Double-dispatching shared agents that already ran on their own cron
- ❌ Blocking on sub-agent failures (collect what you can, report partial)
