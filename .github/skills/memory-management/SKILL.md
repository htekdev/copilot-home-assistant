---
name: memory-management
description: 4-tier memory system management for all stateful agents — loading, saving, pruning, promoting, and maintaining memory files. Use when user says "load memory", "save memory", "update working memory", "prune memory", "memory management", "tier system", or any agent memory lifecycle activity.
---

# Memory Management Skill

Standard 4-tier memory system used by all stateful agents in the {{FAMILY_NAME}} family platform. This skill defines the canonical patterns for loading, saving, pruning, and promoting agent memory.

## The 4-Tier System

| Tier | File | Purpose | Load Rule | Size Limit |
|------|------|---------|-----------|-----------|
| 1 | `core.md` | Identity, mission, heuristics | ALWAYS load first | 3-5KB |
| 2 | `working.md` | Current state, active context | ALWAYS load second | 5KB max |
| 3 | `long-term.md` | Historical patterns, lessons | On-demand only | 10KB max |
| 4 | `events.log` | Append-only event stream | Never bulk-load | Unlimited (prune >30 days) |

## Directory Structure

All agent memory lives at:
```
data/agents/{agent-name}/
├── core.md          # Tier 1 — identity, rules, preferences
├── working.md       # Tier 2 — current state, today's context
├── long-term.md     # Tier 3 — accumulated wisdom, patterns
└── events.log       # Tier 4 — append-only audit trail
```

## First Action: Load Memory (Every Run)

**MANDATORY for every stateful agent at run start:**

```
1. Read data/agents/{agent-name}/core.md      # Tier 1 — ALWAYS
2. Read data/agents/{agent-name}/working.md   # Tier 2 — ALWAYS
```

**Do NOT bulk-load Tier 3 (long-term.md).** Only read it when:
- You need historical context for a specific decision
- A pattern question requires past data
- Debugging a recurring issue

**Never load Tier 4 (events.log) in bulk.** It's write-only during normal operations.

## Last Action: Save Memory (Every Run)

**MANDATORY for every stateful agent before ending a run:**

### Step 1: Update Working Memory (Tier 2)

Update `data/agents/{agent-name}/working.md` with:
- What happened this run (actions taken, findings, decisions)
- Current state changes (new data, status updates)
- Deferred items or blockers
- Update the "Last Updated" timestamp (ISO-8601 with timezone)

**Format the timestamp:**
```
## Last Updated
2026-05-06T07:30:00-05:00
```

**Size discipline:** Keep working.md under 5KB. When approaching the limit:
- Remove completed items older than 7 days
- Summarize patterns instead of listing every instance
- Move proven lessons to long-term.md (Tier 3)
- Trim verbose notes to essential facts

### Step 2: Append to Events Log (Tier 4)

Append one-line entries to `data/agents/{agent-name}/events.log`:
```
[2026-05-06T07:30:00-05:00] action: description of what happened
```

**Rules:**
- One line per significant action (not every trivial step)
- Include the ISO timestamp with timezone
- Use lowercase action verbs: `scan:`, `create:`, `fix:`, `notify:`, `skip:`
- Keep each line under 120 characters

### Step 3: Promote to Long-Term (Tier 3) — ONLY when justified

Append to `data/agents/{agent-name}/long-term.md` ONLY when:
- A new repeatable pattern was discovered and validated
- A significant milestone was reached
- A lesson was learned that will affect future decisions
- A heuristic was proven across multiple runs

**Do NOT promote:**
- One-off events that won't recur
- Transient state that belongs in working memory
- Raw data dumps

## Pruning Rules

### Working Memory (weekly)
- Remove items completed >7 days ago
- Collapse repeated entries into summaries
- Archive deferred items older than 14 days to long-term
- Target: always <5KB

### Long-Term Memory (monthly)
- Remove patterns that are now captured in skills
- Consolidate similar lessons into single entries
- Remove context that's become platform-standard (in constitution/skills)
- Target: <10KB

### Events Log (monthly)
- Prune entries older than 30 days
- Keep milestone entries regardless of age
- Archive significant events to long-term before pruning

## Staleness Detection

**A working memory file is STALE if:**
- `Last Updated` timestamp is >3 days old AND the agent has an active cron job
- It references dates/events that have passed without resolution
- It contains "today" or "this week" references from a previous week

**When stale memory is detected:**
1. Flag it in the audit (context-auditor or skill-optimizer will catch this)
2. On next run, refresh all temporal references
3. Remove completed items that weren't cleaned up
4. Update the timestamp

## Core.md Template

```markdown
# {Agent Name} — Core Identity

## Last Updated
{ISO timestamp}

## Identity
{1-2 sentences: who this agent is}

## Mission
{2-3 bullet points: what it exists to do}

## Ownership Boundaries
### You own
- {list of owned domains}

### You do NOT own
- {explicit exclusions}

## Core Heuristics
1. {Key decision rule 1}
2. {Key decision rule 2}
...

## Key Rules
- {Critical behavioral rules}
```

## Working.md Template

```markdown
# {Agent Name} — Working Memory

## Last Updated
{ISO timestamp}

## Current State
{What's active right now — 3-5 bullet points max}

## Recent Actions
{What happened in last 1-3 runs}

## Pending / Deferred
{Items waiting for input or scheduled for later}

## Active Rules
{Any temporary rules or sprint-mode adjustments}
```

## Anti-Patterns

- ❌ Bulk-loading all 4 tiers at start (wastes tokens, slow)
- ❌ Skipping memory save at end of run (causes stale data)
- ❌ Letting working.md grow >5KB (context window pollution)
- ❌ Storing raw data in long-term (use summaries and patterns)
- ❌ Forgetting to update the "Last Updated" timestamp
- ❌ Promoting every finding to long-term (it's for validated patterns only)
- ❌ Never pruning events.log (grows unbounded)
- ❌ Assuming working memory is current without checking the timestamp

## Which Agents Use This System

All agents with persistent state use this memory system:
- content-creative, content-manager, content-scheduler, content-editor, content-researcher
- content-analytics, blog-writer
- task-coach, finance-manager, health-coach, wellness-coach
- nicu-care, parent-support, parenting-coach
- entrepreneur-coach, entrepreneur-driver
- dog-parent, home-manager, teacher
- realtor-team, credit-coach
- work-life-sync, luna
- platform-manager, context-auditor, skill-optimizer
- cloud-advisor, repo-maintainer, milk-mama

**Stateless agents (no memory):** daily-briefing, meal-planner, weekly-planner, budget-review, heartbeat, checkin, family-coordinator
