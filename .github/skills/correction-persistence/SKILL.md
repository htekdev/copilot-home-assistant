---
name: correction-persistence
description: 3-layer lesson persistence pattern — when {{PARENT_1}} or {{PARENT_2}} corrects behavior, persist the lesson across store_memory + standing-orders.md + copilot-instructions.md. Use when user says "persist lesson", "save correction", "never repeat", "remember this rule", "update instructions", "learned behavior", "permanent fix", or any behavioral correction that must be persisted.
---

# Correction Persistence Skill

When {{PARENT_1}} or {{PARENT_2}} corrects the system's behavior, the lesson MUST be persisted across ALL three layers to guarantee it is never repeated. This is the platform's meta-rule for continuous improvement.

## The 3-Layer Pattern

Every correction gets stored in ALL of these (not just one):

| Layer | File | Purpose | Who Reads It |
|-------|------|---------|-------------|
| 1. Cross-session memory | `store_memory` tool | Survives between sessions | All future sessions |
| 2. Standing orders | `data/standing-orders.md` | Heartbeat/cron reference | Agents with standing-order reads |
| 3. Copilot instructions | `.{{EMPLOYER_PARENT}}/copilot-instructions.md` | ALL future sessions | Every agent, every run |

## When to Apply

Apply this pattern when:
- {{PARENT_1}} says "never do X again" or "always do Y"
- A behavior is corrected with frustration or emphasis
- A bug in agent behavior is identified that could recur
- A new rule is established that affects multiple agents
- {{PARENT_2}} or {{PARENT_1}} provides explicit feedback on system behavior

## Step-by-Step Procedure

### Step 1: Acknowledge the Correction
Confirm understanding before persisting. "Got it — [restate the rule]. Persisting now."

### Step 2: Store in Cross-Session Memory
```
store_memory(
  subject: "[relevant topic]",
  fact: "[concise rule statement, <200 chars]",
  citations: "User input: \"[exact quote from {{PARENT_1}}/{{PARENT_2}}]\"",
  reason: "[why this matters, what it prevents, 2-3 sentences]"
)
```

### Step 3: Add to Standing Orders
Edit `data/standing-orders.md` — add a new section under the appropriate heading with:
- Rule title (with "CRITICAL — from [person], [date]" tag)
- {{PARENT_1}}'s exact words (if available)
- The rule stated clearly
- Anti-patterns (what NOT to do)
- Correct pattern (what TO do)
- Scope (which agents/contexts this applies to)

### Step 4: Add to Copilot Instructions
Edit `.{{EMPLOYER_PARENT}}/copilot-instructions.md` under "Learned Behaviors" section with:
- Same format as standing orders
- Include date learned
- Be concise — copilot-instructions is read by every session

### Step 5: Confirm Persistence
Report back: "✅ Persisted across all 3 layers: store_memory, standing-orders.md, copilot-instructions.md. This will never happen again."

## Quality Standards

### Good Persistence
- **Specific**: "NEVER use write_agent for cron dispatches" (not "be careful with agents")
- **Actionable**: Clear what TO do and what NOT to do
- **Scoped**: States which agents/contexts are affected
- **Sourced**: Includes date and person who gave the correction
- **Verifiable**: Another agent can read it and know exactly what's expected

### Anti-Patterns
- ❌ Storing only in one layer (will be forgotten in other contexts)
- ❌ Vague rules ("be more careful") instead of specific ones
- ❌ Missing anti-pattern examples (agents need to know what to AVOID)
- ❌ Not including the date (makes it hard to trace when rules were established)
- ❌ Storing a lesson that contradicts an existing rule without resolving the contradiction

## Deduplication

Before adding a new rule, check if a similar one already exists:
1. `grep` standing-orders.md for related keywords
2. Check copilot-instructions.md "Learned Behaviors" section
3. If a related rule exists, UPDATE it (don't duplicate)
4. If the new correction OVERRIDES an old rule, mark the old one as superseded

## Scope Classification

| Scope | Where to Emphasize |
|-------|-------------------|
| ALL agents, all contexts | All 3 layers + mark as "platform-wide" |
| Specific agent only | All 3 layers + note the specific agent |
| Specific interaction pattern | All 3 layers + include trigger condition |
| Content/publishing only | All 3 layers + note "content agents" scope |

## Examples of Well-Persisted Corrections

- "SPEAK: TTS via speak parameter" — platform-wide, all {{PARENT_1}} messages
- "Finance Auto-Pay Cleanup" — finance-manager + task-coach scope
- "Social Media Replies Are Autonomous" — content agents + task-coach
- "No Assumptions — Clarification First" — ALL agents, ALL domains
- "Child Location — SAFETY CRITICAL" — ALL agents, safety override
