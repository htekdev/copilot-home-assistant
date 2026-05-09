---
name: development-pipeline
description: >
  Spec-first tiered development pipeline — Research, Plan, Implement, Multi-Model Review, Fix.
  Use when agent says "make a change", "implement feature", "new extension", "architecture change",
  "add agent", "refactor", "create spec", "code review", "multi-model review", "tier 2",
  "tier 3", "how should I build this", "development workflow", or any non-trivial platform modification.
---

# Development Pipeline

## Purpose

All changes to the platform follow a size-based pipeline. The larger the change, the more phases required. This is the "anti-vibe-coding" pattern: Research → Plan → Implement → Review → Fix.

**Reference:** Pair this skill with your repo's spec or design-doc workflow so every non-trivial change has a written handoff artifact.

## Tier Classification

### Tier 1 — Small (Just Do It)
- **Size:** Single file, <50 lines, simple logic
- **Examples:** Fix a typo, update a config value, add a task, tweak a prompt, update standing orders
- **Phases:** None. Just make the change.
- **No spec needed.**

### Tier 2 — Medium (Plan → Implement → Review)
- **Size:** Multi-file changes, new features, refactoring, behavioral changes
- **Examples:** Add a tool to an extension, update agent behavior, new standing order, skill extraction
- **Phases:**
  1. **Plan:** `task(agent_type="general-purpose")` — brief spec in the prompt or short what/why/how
  2. **Implement:** `task(agent_type="coding-agent")` or `task(agent_type="general-purpose")`
  3. **Review:** `task(agent_type="code-review")` — at least 1 reviewer validates

### Tier 3 — Large (Research → Plan/Spec → Implement → Multi-Model Review → Fix)
- **Size:** Architecture changes, new systems, platform-level modifications, new agents/extensions
- **Examples:** New extension, schema migration, task dependency system, new domain agent
- **Phases:**
  1. **Research:** `task(agent_type="explore")` — studies the problem space. Read-only.
  2. **Plan/Spec:** `task(agent_type="general-purpose")` — writes full spec to `data/specs/`. Includes schema, examples, edge cases, rollout plan, affected files.
  3. **Implement:** `task(agent_type="coding-agent")` — receives spec as context, builds faithfully.
  4. **Multi-Model Review:** 3+ `code-review` agents IN PARALLEL with different `model` overrides.
  5. **Fix:** `task(agent_type="coding-agent")` — addresses ALL findings from all reviewers.

### Tier 4 — Critical (Tier 3 + Safety Validation)
- **Size:** Changes affecting child safety, medical data, financial transactions
- **Examples:** Anything touching child location logic, medical records, payment processing
- **Phases:** Same as Tier 3, PLUS an additional `code-review` agent specifically checking:
  - Data leaks
  - Child safety edge cases
  - Financial accuracy
  - Medical data integrity

## Phase → Agent Type Mapping

| Phase | `task` tool `agent_type` | Default Model | `model` Override? |
|-------|--------------------------|---------------|-------------------|
| Research | `explore` | Haiku (fast) | Rarely needed |
| Plan/Spec | `general-purpose` | Sonnet | Use Opus for complex specs |
| Implement | `coding-agent` or `general-purpose` | Sonnet | Rarely needed |
| Review | `code-review` | Sonnet | **YES — use 3+ different models** |
| Fix | `coding-agent` or `general-purpose` | Sonnet | Rarely needed |

## Multi-Model Review Pattern

For Tier 3+ changes, launch reviewers IN PARALLEL with diverse models:

```
task(agent_type="code-review", model="claude-sonnet-4", prompt="Review against spec...")
task(agent_type="code-review", model="gpt-5.2", prompt="Review against spec...")
task(agent_type="code-review", model="claude-opus-4.6", prompt="Review against spec...")
```

Each reviewer independently checks:
- Spec compliance (does implementation match the plan?)
- Bug detection (logic errors, edge cases, race conditions)
- Regression risk (does this break existing behavior?)
- Quality (code style, maintainability, documentation)

Collect all findings → deduplicate → feed combined list to Fix agent.

## Pipeline Execution Rules

1. **Each phase = separate delegated agent** via `task` tool with clean context. Never reuse a prior phase's agent.
2. **The spec document is the handoff artifact** — the implementing agent receives it as context in its prompt.
3. **The orchestrating agent manages the pipeline** — launches each phase, collects results, feeds to next.
4. **Review agents run simultaneously** — launch all at once, collect results after all complete.
5. **When in doubt about tier, go UP** — over-planning costs minutes; under-planning costs hours.

## Sizing Guide

| Signal | Tier |
|--------|------|
| Single file, <50 lines | 1 |
| Multi-file, same pattern | 2 |
| New concept or feature | 2-3 |
| Touches >5 files | 3 |
| New data flow between agents | 3 |
| New agent or extension | 3 |
| Changes cross-agent communication | 3 |
| Touches child/medical/financial data | 4 |

## Auto-Implement Categories (No Approval Needed)

Per the platform owner's standing order, these Tier 1/2 items auto-implement:
- Agent instruction updates (stale refs, outdated context)
- Skill extraction and optimization
- Memory cleanup (bloated working.md, stale refs)
- Configuration fixes (cron, quiet hours, prompts)
- Standing order updates
- Context hygiene
- Template and config maintenance

## Still Require Approval (Tier 3/4)

- Brand-new domain agents
- Deleting/disabling existing agents or extensions
- Architectural changes (new data models, extension patterns)
- Security-sensitive changes
- Changes affecting notification delivery
- Major cross-agent communication refactors

## Exemplar

The `task-ownership-v1` implementation (April 21, 2026):
1. `general-purpose` agent → wrote `data/specs/task-ownership-v1.md` (schema, migration, 20 files)
2. `coding-agent` → implemented all changes from spec
3. 3 parallel `code-review` agents (Sonnet, Opus, GPT) → caught issues independently
4. `coding-agent` → fixed all findings
5. **Result:** Zero regressions.

## Integration with Other Skills

- **`multi-model-review`** — Detailed review launch patterns and finding consolidation
- **`quality-gate`** — check→fix→recheck→escalate loop for implementations
- **`repo-workflow`** — Git workflow (direct edit vs worktree) for the implementation phase
- **`agent-skill-management`** — For skill extraction work specifically
