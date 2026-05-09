---
name: clarification-workflow
description: >
  No-assumptions clarification protocol — detect missing data, create clarification tasks,
  block dependent work, and resume only when answers arrive. Use when agent says "clarification needed",
  "missing info", "don't know current state", "need to ask first", "can't assume",
  "where is he", "what's the current level", or any agent lacks concrete data for a recommendation.
---

# Clarification Workflow

## Purpose

This skill implements the platform's "No Assumptions — Clarification First" mandate. When ANY agent encounters a knowledge gap that would require guessing to proceed, this workflow STOPS the chain of reasoning and creates a structured clarification request.

**Canonical rule:** "Accept that you have gaps in your knowledge and make them tasks for me — clarification questions. You are not allowed to continue the task until your clarification questions are answered."

## When to Invoke This Skill

Trigger when an agent needs information that is NOT concretely available in the system:
- Current physical location (of any family member)
- Supply/inventory levels (dog food, diapers, formula, medications)
- Current health/energy state for any family member
- Real-time availability (is someone free right now?)
- Preference that hasn't been stated (which brand, which store, which time)
- Any planning input that requires knowing current state

## The Workflow

### Step 1 — Detect the Gap

Before making any recommendation that depends on external state, CHECK:
- Is the data available in the system? (task system, calendar, shopping list, family profiles)
- Was it recently stated? (within the last 30 minutes in conversation)
- Is it a reasonable default? (e.g., "home" at 7 AM is reasonable; "home" at 2 PM is not)

If the data is NOT available → proceed to Step 2.

### Step 2 — Create Clarification Task

```
add_task(
  title: "[The question itself]",
  category: "clarification",
  priority: "high",
  assignee: "[whoever has the answer]",
  notes: "WHY this info is needed: [explanation]. Dependent decisions: [what's blocked].",
  surface: "human"
)
```

**Title format examples:**
- "Where are you right now? (needed to calculate drive time to NICU)"
- "How much dog food is left? (need to decide if we add to shopping list)"
- "Are you at home or office? (affects which errands are feasible today)"
- "What time is the pickup from the caregiver?"

### Step 3 — Block Dependent Work

- Do NOT proceed with the chain of reasoning that depends on the answer
- If other tasks depend on this answer, mark them as `blocked` with `depends_on` pointing to the clarification task
- Do NOT guess, estimate, or use stale data as a substitute

### Step 4 — Communicate Transparently

If communicating with the user about a related topic, be transparent:
- ✅ "I need to know [X] before I can [Y]. Created a task for it."
- ✅ "Can't plan the route without knowing where you are — I'll ask."
- ❌ "Leave at 5:15 for the NICU" (assumed starting location)
- ❌ "You're free this afternoon" (only checked one calendar)

### Step 5 — Resume When Answered

When the clarification task is completed (user answers):
1. Retrieve the answer from the completed task or conversation
2. Unblock dependent tasks
3. Resume the chain of reasoning with concrete data
4. Mark the clarification task as `done`

## Forbidden Assumptions (NEVER Make These)

| Category | Bad Assumption | Correct Action |
|----------|---------------|----------------|
| Location | "Leave at X time" without knowing start | Ask: "Where are you right now?" |
| Inventory | "Grab dog food" without knowing supply | Ask: "How much dog food is left?" |
| Availability | "You're free at 3 PM" from one calendar | Check BOTH calendars first |
| Health/Energy | "They can handle this" | Don't assume someone's state |
| Traffic/Route | "Take the highway" without knowing origin | Ask starting location, compute route |
| Schedule | "The child is at school" on a random Tuesday | Verify — don't assume schedule |

## Integration with Other Skills

- **`calendar-availability`** — Use before assuming time slots are free
- **`child-safety-protocol`** — Child location is ALWAYS a clarification (never state as fact)
- **`proactive-task-intelligence`** — Prep tasks should verify prerequisites, not assume them
- **`time-awareness`** — Compute times, don't guess

## Rules

1. **One clarification per gap.** Don't batch 5 questions into one task — each gets its own task so they can be answered independently.
2. **High priority is correct.** Clarifications block work — they deserve `high` priority.
3. **Gaps are normal.** Creating clarification tasks is GOOD behavior, not a failure. The system should ask often.
4. **Stale data ≠ current data.** Something said 2+ hours ago may no longer be true. When in doubt, re-ask.
5. **This overrides speed.** It's better to ask and wait 5 minutes than to give confident advice built on a wrong assumption.
