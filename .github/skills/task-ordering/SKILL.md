---
name: task-ordering
description: Smart task ordering algorithm for serving tasks — time-locked first, then urgent/high priority, dependencies, location chaining, energy matching, quick-win momentum, and staleness bumps. Use when user says "next task", "what should I do", "task priority", "order tasks", "serve task", "pick next task", "task algorithm", "smart ordering", or any agent needs to select the optimal next task from a queue.
---

# Task Ordering Skill

The canonical algorithm for selecting the optimal next task to serve. Used by task-coach, quick-serve transitions, and any agent that needs to pick the best next action from a set of pending tasks.

## Pre-Requisites

Before running this algorithm:
1. **Compute current time** (via `time-awareness` skill — PowerShell CT computation)
2. **Filter to correct surface**: `list_tasks(status="pending", surface="human")` for human coaching
3. **Check calendar** for upcoming events that constrain available time

## The Algorithm (Priority Order)

### Level 1 — Time-Locked (HIGHEST)
Tasks with hard deadlines in the next 2 hours:
- Leave-by times
- Expiring tokens or codes
- Appointment prep windows
- Pickup reminders (SAFETY — never skip)
- Bill payments due today

**If multiple time-locked tasks exist:** serve the one with the soonest deadline.

### Level 2 — Urgent + Due Today
- Priority = `urgent`
- Due date = today (or overdue)
- These get served before ALL non-time-locked tasks

### Level 3 — High + Due Today
- Priority = `high`
- Due date = today (or overdue)

### Level 4 — Dependencies Met
- Use `ready_tasks(surface="human")` to find unblocked tasks
- A task with all predecessors marked `done` jumps ahead of still-blocked tasks
- This prevents serving tasks that CAN'T be done yet

### Level 5 — Location Chaining
Minimize context switches by grouping tasks in the same area:

| If last completed task was in... | Serve next task in... |
|----------------------------------|----------------------|
| Kitchen | Kitchen (dishes, cooking, counters) |
| Upstairs | Upstairs (bedrooms, bathroom) |
| Garage/yard | Garage/yard |
| Car/errands | Other car errands |
| Digital/computer | Other digital tasks |

**How to detect location**: Check the `location` field on tasks, or infer from `category` (chore → physical area, finance → digital, errand → car).

### Level 6 — Energy Matching
Match task difficulty to time-of-day energy levels:

| Time Block | Best Task Types |
|-----------|----------------|
| Morning (before 11 AM) | Complex, creative, high-focus, important calls |
| Midday (11 AM – 2 PM) | Moderate tasks, errands, digital admin |
| Afternoon (2 – 5 PM) | Routine, easy, quick wins |
| Evening (after 5 PM) | Quick wins, closing tasks, prep-for-tomorrow |

**During work hours (9 AM – 5 PM weekdays):** Suppress physical chore nudges. Prefer digital/quick tasks or stay silent until a work break.

### Level 7 — Quick-Win Momentum
When two tasks are equal priority at all levels above:
- **Serve the shorter one first** (`estimated_minutes` field)
- Completing a 5-min task builds momentum for the 30-min task next
- Quick wins accumulate and create a sense of progress

### Level 8 — Staleness Bump
- Tasks pending for 3+ days get a slight priority boost
- Tasks rescheduled 3+ times → escalate to urgent
- Stale tasks drain mental energy even when not being worked

## Calendar Constraint Check

After selecting a candidate task, verify it fits:
1. Get upcoming events: `gcal_today()` (personal) + WorkIQ (work meetings)
2. Only count UPCOMING events (start time > now)
3. If an event starts within `estimated_minutes + 15 min` → skip this task, pick a shorter one
4. Never suggest a 2-hour task when there's a meeting in 45 min

## Output Format

When serving a task, ALWAYS include:

```
🎯 [Task title] (~X min)
📋 [Brief instruction or context]
📋 X pending | Y due today
```

For transitions (after completing one):
```
✅ [Completed task] → 🎯 Next: [Task title] (~X min)
📋 X pending | Y due today
```

## Queue Visibility Rule

**NEVER silence the queue count.** Every task serve, every nudge, every transition MUST include:
```
📋 X pending | Y due today
```

This footer is {{PARENT_1}}'s pulse of the system. It's always there — no exceptions.

## {{PARENT_2}}-Sourced Attribution

When serving a task whose `notes` field contains "From {{PARENT_2}}:", use attribution format:
```
🎯 {{PARENT_2}} said: [task] (~X min)
```

This matters for motivation — {{PARENT_1}} responds better to "{{PARENT_2}} asked" than "system says."

## Suppress Conditions

Do NOT serve a task if:
- Current time is quiet hours (10 PM – 6 AM) and task is not urgent
- {{PARENT_1}} is in a work meeting (check WorkIQ) and task is a physical chore
- A clarification task for this task is still pending (blocked on missing info)
- The task was just served within the last nudge cycle (anti-nag)

## Anti-Patterns

- ❌ Serving a list of tasks (ONE at a time only)
- ❌ Suggesting break/rest during an active completion streak
- ❌ Skipping the queue count footer
- ❌ Serving a task that depends on unfinished predecessors
- ❌ Suggesting a 45-min task 20 minutes before a meeting
- ❌ Serving agent-surface tasks to humans
