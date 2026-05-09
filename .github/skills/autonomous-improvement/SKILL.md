---
name: autonomous-improvement
description: Platform improvement governance — what to auto-fix vs what needs approval, detect-fix-report pattern, and improvement cadence rules. Use when user says "auto improve", "platform fix", "should I ask first", "auto implement", "improvement approval", "detect fix report", "nightly fixes", "autonomous changes", or any platform self-improvement activity.
---

# Autonomous Improvement Skill

Governance framework for platform self-improvement. Defines what maintenance agents (context-auditor, skill-optimizer, platform-manager, nightly reflection) can auto-implement vs what requires human approval.

## Core Mandate

**"I'm not approving anything. You should automatically improve everything."** — platform owner (2026-05-05)

**The pattern:** Detect → Fix → Report. NOT Detect → Propose → Wait → Fix.

## Auto-Implement Immediately (NO approval needed)

These categories are pre-approved for autonomous execution by any maintenance agent:

| Category | Examples |
|----------|----------|
| **Agent instruction updates** | Fix stale refs, outdated context, wording improvements |
| **Skill extraction & optimization** | Create new skills, refactor agents to use skills |
| **Memory cleanup** | Trim bloated working.md, fix stale references, prune |
| **Configuration fixes** | Cron schedules, quiet hours violations, stale prompts |
| **Standing order updates** | Persist new patterns, update lessons learned |
| **Context hygiene** | Fix pregnancy→postpartum refs, outdated family status |
| **Working memory updates** | Any agent's working.md maintenance |
| **Template & config maintenance** | Fix task templates, update config files |
| **Data cleanup** | Shopping list dedup, task dedup, stale data removal |
| **Copilot-instructions updates** | Non-breaking improvements, new learned behaviors |
| **Skill content updates** | Fix outdated procedures, add missing rules |
| **Extension config tweaks** | Non-breaking configuration adjustments |

## Still Requires Approval (Escalate First)

These categories need explicit human sign-off before execution:

| Category | Why |
|----------|-----|
| **Creating brand-new domain agents** | New `.github/agents/` files change the platform topology |
| **Deleting or disabling agents/extensions** | Destructive — may lose capabilities |
| **Architectural changes** | New data models, new extension patterns, schema migrations |
| **Security-sensitive changes** | Auth flows, secret handling, permission changes |
| **Notification behavior changes** | Affects how family members receive messages |
| **Major cross-agent refactors** | Changes communication patterns between agents |
| **Cron schedule changes** | Affects when agents fire (could cause spam or gaps) |

## Implementation Cadence

| Trigger | Agent | Timing | Action |
|---------|-------|--------|--------|
| Nightly reflection | platform-manager | 9 PM CT | Auto-implement ALL Tier 1/2 fixes found |
| Context audit | context-auditor | On-demand / scheduled | Find issues, fix auto-fixable, queue rest |
| Skill optimization | skill-optimizer | On-demand / scheduled | Extract skills, refactor agents, commit |
| Improvement tasks | Any maintenance agent | Within 24 hours of creation | Pick up queued improvement tasks and execute |

## The Detect → Fix → Report Workflow

### Step 1: Detect
- Scan target files/systems for issues
- Classify each finding: auto-fix category or escalation-needed

### Step 2: Fix (for auto-fix category only)
- Make the change directly (edit files, create skills, update configs)
- Commit with clear conventional message
- If multi-file: ensure consistency across all affected files

### Step 3: Report
- **Report what was DONE (past tense), not what's proposed**
- Include in nightly Telegram summary or immediate notification for significant changes
- Log changes in agent working memory / events.log
- Format: "✅ Auto-fixed: [brief description of what changed and why]"

### Step 4: Track
- Update working memory with changes made
- Note any follow-up work still needed
- Record if a pattern emerged that should become a recurring check

## Escalation Format

When something needs approval, create a task:

```
add_task(
  title: "Approval needed: [brief description]",
  category: "general",
  priority: "medium",
  assignee: "primary_user",
  surface: "human",
  notes: "What: [proposed change]\nWhy: [reason]\nRisk: [what could go wrong]\nAffects: [which agents/files]"
)
```

## Anti-Patterns

- ❌ Proposing improvements and waiting for approval when they're clearly auto-fix category
- ❌ Making approval-required changes without escalating first
- ❌ Reporting proposed changes instead of executed changes in summaries
- ❌ Accumulating improvement debt by deferring safe changes
- ❌ Asking "should I fix this?" for things in the auto-fix category — just fix them
- ❌ Making changes without logging them (always update working memory + events.log)

## Relationship to Other Skills

- **`correction-persistence`** — When a user corrects behavior, persist across all layers. That's a specific case of the detect→fix→report pattern triggered by human feedback.
- **`agent-skill-management`** — The extraction methodology for skill-specific improvements. This skill governs the DECISION to act, not the HOW of skill extraction.
- **`repo-workflow`** — For larger fixes that need isolated branches. Most auto-fixes are small enough for direct edits.
