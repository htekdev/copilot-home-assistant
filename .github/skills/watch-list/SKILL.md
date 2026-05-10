---
name: watch-list
description: Watch list pattern for tracking expected replies and follow-ups — create watches, check resolution, escalate stale items. Use when user says "watch for reply", "waiting on response", "follow up", "watch list", "track reply", "check watches", "pending replies", "awaiting response", or any reply-tracking activity.
---

# Watch List Skill

Canonical pattern for tracking messages, emails, or requests where you're waiting for a reply or outcome. Ensures nothing falls through the cracks.

## What Is a Watch Item?

A watch item is a task (category: `watch`) that tracks something the system sent or initiated where a reply/outcome is expected. It creates accountability — if the reply never comes, the system escalates rather than forgetting.

## Creating a Watch

When ANY agent sends a message expecting a reply (email, Telegram relay, mesh message, form submission), create a watch:

```
add_task(
  title: "Watch: [what you're waiting for]",
  category: "watch",
  priority: "medium",        # or "high" if time-sensitive
  assignee: "shared",        # system-owned, not a human action
  surface: "agent",          # agent-internal, not served to humans
  notes: "Sent [what] to [who] on [date]. Context: [why]. Expected response by: [timeframe].",
  due_date: "[expected response date or check-by date]"
)
```

### Watch Item Quality Rules

- **Title must state what you're waiting for** — not just "Watch: email sent"
- **Notes must include**: what was sent, to whom, when, why, and expected timeframe
- **Due date** = when to escalate if no response (default: 3 days after sending)
- **Surface: agent** — watch items are system-internal tracking, NOT human tasks

## Checking Watches (Heartbeat Phase 0)

The heartbeat agent checks watches every cycle. Any agent CAN check watches relevant to its domain.

### Check Workflow

```
1. list_tasks(category: "watch", status: "pending")
2. For EACH watch item:
   a. Parse context from notes (who, what, when sent)
   b. Check for resolution:
      - Gmail: search for reply to the original thread
      - Telegram: check for response message
      - Mesh: get_message(id) to check for replies
      - Calendar: check if event was confirmed
      - Task system: check if blocking task was completed
   c. Decision:
      - RESOLVED → complete_task(id), notify via Telegram what was resolved
      - NOT RESOLVED + past due_date → ESCALATE (see below)
      - NOT RESOLVED + within timeframe → skip silently (no action)
```

### Escalation Rules

When a watch item passes its due date without resolution:

| Days Overdue | Action |
|-------------|--------|
| 1-2 days | Re-check once more. Still nothing? Move to step below. |
| 3+ days | Create a human-facing task with specific next step: "Follow up with [person] about [thing] — no response since [date]" |
| 7+ days | Mark watch as stale, escalate to {{PARENT_1}} via Telegram with full context |

### Resolution Actions

When a watch resolves:
1. `complete_task(watch_id)` — mark the watch done
2. Execute any follow-up action documented in notes
3. If the resolution triggers new work → create appropriate task(s)
4. Notify via Telegram if the outcome affects {{PARENT_1}}/{{PARENT_2}}

## Examples

### Email Watch
```
add_task(
  title: "Watch: Reply from insurance about twin coverage",
  category: "watch",
  surface: "agent",
  notes: "Sent email to {{INSURANCE_PROVIDER}} re: twin NICU coverage limits on 2026-05-06. Waiting for coverage confirmation. If no reply by 5/9, call 1-800-XXX-XXXX.",
  due_date: "2026-05-09"
)
```

### Mesh Message Watch
```
add_task(
  title: "Watch: MSIX-home OOF block confirmation",
  category: "watch",
  surface: "agent",
  notes: "Sent mesh message to msix-home requesting Outlook OOF block for Wednesday 2-4 PM. Message ID: 42. Check with get_message(42).",
  due_date: "2026-05-07"
)
```

### Telegram Relay Watch
```
add_task(
  title: "Watch: {{PARENT_2}}'s response about NICU visit time",
  category: "watch",
  surface: "agent",
  notes: "Asked {{PARENT_2}} via Telegram ({{TELEGRAM_PARENT_2}}) what time she wants to visit NICU tomorrow. Sent 2026-05-06 3 PM. Need answer to plan logistics.",
  due_date: "2026-05-07"
)
```

## Anti-Patterns

- ❌ Creating human-facing (surface: "human") tasks for watch items — watches are agent-internal
- ❌ Forgetting to include resolution criteria in notes
- ❌ Setting due_date too aggressively (same day for non-urgent items)
- ❌ Not checking watches in heartbeat — the whole point is systematic follow-up
- ❌ Creating a watch without enough context to check resolution later
