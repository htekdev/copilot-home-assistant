# Shared Agent Boilerplate — Canonical Reference

> **Purpose**: This file defines the canonical text for all boilerplate sections repeated across agent definitions.
> When boilerplate needs to change, update it HERE first, then propagate to agents.
> Used by: `platform-manager` (sync), `context-auditor` (drift detection), `template-sync` (public template).

---

## How Agent Definitions Are Structured

Copilot agent `.agent.md` files are standalone system prompts — they don't support `#include` or file imports.
However, `copilot-instructions.md` IS loaded alongside every agent (including sub-agents), so rules already
in `copilot-instructions.md` don't need full repetition — a 1-line reminder reference suffices.

### What's Already in `copilot-instructions.md` (DO NOT duplicate verbatim)
- Git workflow rules (NEVER raw git, use dev-workflow tools)
- Tool search prohibition (NEVER use `tool_search_tool_regex`)
- Quiet hours (10 PM – 6 AM CT)
- Telegram speak param rules
- Task tool dispatch rules
- Brand protection rules
- Research tools hierarchy

### What MUST be in every agent definition (agent-specific, cannot be inherited)
- Constitution loading instruction
- Memory tier paths (agent-specific)
- Identity & personality (unique per agent)
- Domain ownership (unique per agent)
- Communication protocol (agent-specific details)
- Decision framework (agent-specific)

### What SHOULD be in agent definitions (compact reference form)
- Tool Usage Rules → compact 4-line version (reminder, not full docs)
- Output Quality Standards → compact 5-line version
- Git Workflow → 1-line skill reference (only for agents that do git)
- Agent Steering → 1-line skill reference (only for agents that steer others)

---

## Canonical Boilerplate Sections

### Section 1: Constitution Block
**Used by**: ALL agents (mandatory)
**Lines**: 8
**Customizable**: No — use exactly as written

```markdown
## Constitution

**Before doing ANYTHING else**, read the family constitution:

\```
data/constitution.md
\```

This contains the core principles, communication rules, and autonomy levels that govern ALL agents.
```

---

### Section 2: Memory (4-Tier System) Block
**Used by**: ALL domain agents (mandatory)
**Lines**: 5
**Customizable**: Yes — replace `{agent-name}` and `{save-items}`

```markdown
## Memory (4-Tier System) — see `memory-management` skill

**Load first:** `data/agents/{agent-name}/core.md` (Tier 1) + `data/agents/{agent-name}/working.md` (Tier 2). On-demand: `long-term.md` (Tier 3).

**Save last:** Update `working.md` ({save-items}), append `events.log`, promote to `long-term.md` only for validated patterns.
```

**{save-items} examples by domain:**
- Finance: `balance/debt changes, bills paid, budget vs actual, anomalies`
- Health: `appointments, medications, symptoms, milestones`
- Content: `articles drafted/published, style decisions, review feedback`
- Home: `maintenance tasks, service providers, repairs/projects, new items`
- Pets: `feeding/supply status, vet appointments, behavioral observations, grooming/meds`

---

### Section 3: Tool Usage Rules
**Used by**: ALL agents (mandatory)
**Lines**: 6
**Customizable**: No — use exactly as written

```markdown
## Tool Usage Rules

**Do NOT use `tool_search_tool_regex`** — it wastes tokens and burns ~3 turns per search cycle. ALL standard tools are available directly by name:
- `telegram_send_message`, `list_tasks`, `add_task`, `complete_task`
- `dev_add`, `dev_commit`, `dev_push`, `dev_status`, `start_dev_branch`, `create_vercel_pr`
- `generate_image`, `store_memory`, `gcal_create_event`, `gmail_send`
- `task`, `read_agent`, `write_agent`, `list_agents`

Call them directly. If a tool does not exist, it does not exist — do not search for it.
```

---

### Section 4: Output Quality Standards
**Used by**: ALL agents (mandatory)
**Lines**: 6
**Customizable**: No — use exactly as written

```markdown
## Output Quality Standards

- **Result-first**: Lead with the answer/outcome, not the process
- **No worklog narration**: Never expose internal tool calls, searches, or step-by-step reasoning in user-facing output
- **Concise**: Telegram messages are 2-5 lines max unless detailed data is requested
- **Professional tone**: Warm but polished — no filler phrases ("Let me check...", "I'll now proceed...")
- **Structured when dense**: Use bullets, tables, or numbered lists for multi-item responses
```

---

### Section 5: Agent Steering
**Used by**: Agents that orchestrate or follow up with other agents (~21 agents)
**Lines**: 2
**Customizable**: No — use exactly as written

```markdown
## Agent Steering

Follow the `agent-steering` skill at `.{{EMPLOYER_PARENT}}/skills/agent-steering/SKILL.md` for the full protocol. Use `write_agent` for follow-ups to a running background session — don't kill and relaunch.
```

---

### Section 6: Git Workflow
**Used by**: Agents that commit/push code (~18 agents)
**Lines**: 12 (full) or 2 (compact reference)
**Customizable**: No

**Full version** (for agents where git is core to their job — coding-agent, repo-maintainer, blog-writer, platform-manager, skill-optimizer):

```markdown
## Git Workflow

> **⚠️ MANDATORY:** NEVER use raw git commands in powershell. ALWAYS use dev-workflow extension tools.

Follow the `repo-workflow` skill at `.{{EMPLOYER_PARENT}}/skills/repo-workflow/SKILL.md` for the full git workflow (Fast Mode for tiny edits, Proper Mode for larger work).

When auto-fixes are applied:
1. Stage all modified files via `dev_add`
2. Commit with message via `dev_commit`: `{prefix}(scope): description`
3. Push via `dev_push`
4. Co-author: `Co-authored-by: Copilot <{{EMAIL_ADDRESS}}.{{EMPLOYER_PARENT}}.com>`

**NEVER use:** `git add`, `git commit`, `git push`, `gh hookflow git-push`. Hooks don't propagate to sub-agents (SDK v1.0.47).
**Read-only allowed:** `git log`, `git diff`, `git show`, `git blame`
```

**Compact version** (for agents that occasionally commit — content agents, harness-tracker, etc.):

```markdown
> **⚠️ Git:** NEVER use raw git commands. ALWAYS use `dev_add`/`dev_commit`/`dev_push`. See `repo-workflow` skill. Read-only (`git log`, `git diff`) is allowed.
```

---

### Section 7: Task-First Rule
**Used by**: Domain agents that discover actionable items (~16 agents)
**Lines**: 4 (template) + domain-specific examples
**Customizable**: Yes — examples are domain-specific

```markdown
## Task-First Rule (CRITICAL)

> **Skill reference:** Follow the `task-management` skill (`.{{EMPLOYER_PARENT}}/skills/task-management/SKILL.md`) for full task creation rules, surface levels, the Task-First guardrail, and lifecycle management.

When you discover anything actionable — {domain-specific triggers} — **create a task via `add_task`** in addition to any Telegram alert.
```

---

### Section 8: Communication Protocol Header
**Used by**: ALL agents that send Telegram messages (~53 agents)
**Lines**: 2 (reference line) + agent-specific rules
**Customizable**: Yes — agent adds its own messaging rules below the reference

```markdown
## Communication Protocol

> **Skill reference:** Follow the `telegram-communication` skill (`.{{EMPLOYER_PARENT}}/skills/telegram-communication/SKILL.md`) for base messaging rules (speak param for {{PARENT_1}}, quiet hours, per-person formatting).
```

---

## Agent Definition Structure (Recommended Order)

```
---
name: {agent-name}
description: "{description}"
---

# {Title}

## Constitution                          ← Section 1 (mandatory, verbatim)
## Memory (4-Tier System)                ← Section 2 (mandatory, customized paths)

---

## Identity & Personality                ← UNIQUE per agent
## Domain Ownership                      ← UNIQUE per agent

---

## Task-First Rule (CRITICAL)            ← Section 7 (if applicable)
## Communication Protocol                ← Section 8 header + agent-specific
## Decision Framework                    ← UNIQUE per agent
## Integration Points                    ← UNIQUE per agent

---

## {Domain-Specific Sections}            ← UNIQUE per agent

## Output Quality Standards              ← Section 4 (mandatory, verbatim)
## Git Workflow                           ← Section 6 (if agent does git)
## Agent Steering                        ← Section 5 (if agent orchestrates)
## Tool Usage Rules                      ← Section 3 (mandatory, verbatim)
```

---

## Token Budget Analysis

| Section | Per Agent | × Agents | Total Tokens Saved if Trimmed |
|---------|-----------|----------|-------------------------------|
| Tool Usage Rules (full → compact) | ~80 tokens | 59 | ~4,720 |
| Output Quality Standards | ~60 tokens | 49 | ~2,940 |
| Git Workflow (full in non-git agents) | ~120 tokens | 11 | ~1,320 |
| Agent Steering (in non-orchestrators) | ~30 tokens | -- | -- |
| Constitution block | ~60 tokens | 56 | 0 (keep as-is) |
| Memory block | ~50 tokens | 47 | 0 (keep as-is) |
| **Total reclaimable** | | | **~9,000 tokens** |

The biggest wins come from ensuring:
1. Non-git agents don't have full Git Workflow sections
2. Tool Usage Rules and Output Quality Standards use the exact canonical text (no drift)
3. Rules already in `copilot-instructions.md` aren't re-explained in verbose form

---

## Migration Guide

### For platform-manager / context-auditor to propagate changes:

1. **Update this file** with the new canonical text
2. **Search for drift**: `grep -r "old text pattern" .{{EMPLOYER_PARENT}}/agents/`
3. **Apply to agents**: Use `edit` tool to replace old text with new canonical text
4. **Commit**: `fix(agents): sync boilerplate with shared-boilerplate.md`

### For new agents:
1. Copy the appropriate template (`domain-agent-template.md`, `task-agent-template.md`, or `team-agent-template.md`)
2. Replace `{PLACEHOLDERS}` with agent-specific content
3. Copy boilerplate sections verbatim from this file
4. Add domain-specific sections

### Drift Detection (context-auditor weekly audit):
Compare each agent's boilerplate sections against this file. Flag any that:
- Have extra lines not in the canonical version
- Are missing lines from the canonical version
- Use different wording for the same rule
