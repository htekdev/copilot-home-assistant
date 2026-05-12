---
name: child-safety-protocol
description: >
  Safety-critical rules for child location tracking, pickup reminders, and caregiver handoff verification.
  Use when any agent mentions "child location", "{{CHILD_1_NAME}} is with", "babysitter", "{{CAREGIVER_NAME}}",
  "pickup time", "drop-off", "childcare", "where is {{CHILD_1_NAME}}", "caregiver", or handles any child-related logistics.
---

# Child Safety Protocol

## Purpose

The system MUST NEVER be the source of truth for a child's physical location. If a parent trusts the system's statement about where their child is and then forgets to pick them up — that is a SAFETY failure.

**{{PARENT_1}}'s concern:** "What if you told me {{CHILD_1_NAME}} is with {{CAREGIVER_NAME}} and I just forget to pick him up? Like, what if that happened?"

This skill ensures every agent handles child location data with appropriate caution and always creates proactive safety reminders.

## Core Rules (ALL agents, ALL the time)

### Rule 1 — NEVER State Child Location as Current Fact

Even if {{PARENT_1}} said "{{CHILD_1_NAME}} is with {{CAREGIVER_NAME}}" 30 minutes ago, that information is STALE. Do not present it as current reality.

- ❌ "{{CHILD_1_NAME}} is with {{CAREGIVER_NAME}}" (stated as fact)
- ❌ "You don't need to worry about {{CHILD_1_NAME}} right now, he's with the babysitter"
- ❌ "Since {{CHILD_1_NAME}} is taken care of, focus on..."
- ✅ "Last you mentioned at 3:48 PM, {{CHILD_1_NAME}} was with {{CAREGIVER_NAME}}."
- ✅ "As of [time], you said {{CHILD_1_NAME}} was at [location]."

### Rule 2 — ALWAYS Create Pickup Reminder Task

When a babysitter, caregiver, daycare, or any childcare arrangement is mentioned:

```
add_task(
  title: "What time is pickup for {{CHILD_1_NAME}} from [caregiver]?",
  category: "clarification",
  priority: "high",
  assignee: "shared",
  notes: "{{CHILD_1_NAME}} was mentioned as being with [caregiver] at [time]. We need a pickup time to set a hard reminder. SAFETY: System must not be sole reminder for child pickup."
)
```

Do this IMMEDIATELY when childcare is mentioned. Don't wait.

### Rule 3 — ALWAYS Ask for Pickup Time

When any caregiver/childcare is mentioned, the FIRST response should include asking for pickup time. This is non-negotiable — even if it interrupts another workflow.

### Rule 4 — Set Time-Locked Pickup Reminder

When pickup time IS known:
1. Create a task due 30 minutes before pickup time:
   ```
   add_task(
     title: "⚠️ Leave for {{CHILD_1_NAME}} pickup in 30 min (pickup at [time] from [caregiver])",
     priority: "urgent",
     due_date: "[30 min before pickup, YYYY-MM-DD]",
     category: "general",
     assignee: "shared",
     notes: "Pickup from [caregiver] at [time]. Drive time: [X min]. Leave by: [time]."
   )
   ```
2. If the reminder goes unacknowledged at pickup time → escalate to URGENT Telegram:
   ```
   telegram_send_message(
     chat_id: "{{TELEGRAM_PARENT_1}}",
     message: "🚨 PICKUP REMINDER: {{CHILD_1_NAME}} pickup from [caregiver] is NOW ([time]). Are you on your way?",
     speak: "Urgent. {{CHILD_1_NAME}} pickup time is now. Are you on your way?"
   )
   ```

### Rule 5 — NEVER Use Child Location as Planning Input

The system must not use child location to inform OTHER decisions:
- ❌ "{{CHILD_1_NAME}} is taken care of, so you're free to run errands"
- ❌ "Since {{CHILD_1_NAME}} is with {{CAREGIVER_NAME}}, you could go to the gym"
- ✅ "Do you need a pickup reminder for {{CHILD_1_NAME}}?"
- ✅ "What time should I remind you about pickup?"

## Trigger Scenarios

| Trigger | Required Actions |
|---------|-----------------|
| "{{CHILD_1_NAME}} is with {{CAREGIVER_NAME}}" | Staleness caveat + create pickup clarification task + ask for pickup time |
| "Dropping {{CHILD_1_NAME}} off at daycare" | Create pickup task + ask for pickup time + morning OOF if applicable |
| "Babysitter is here" | Create pickup task + ask for pickup/end time |
| "{{CHILD_1_NAME}} is at school" | Create pickup task (verify dismissal time from family profile) |
| Calendar shows caregiver event | Create reminder 30 min before end time |
| Pickup time known | Create time-locked reminder task |
| Pickup time passes, unacknowledged | Escalate to URGENT Telegram notification |

## Integration with Other Skills

- **`clarification-workflow`** — Pickup time is ALWAYS a clarification if not known
- **`time-awareness`** — Compute drive times and leave-by times via PowerShell
- **`proactive-task-intelligence`** — Drop-off/pickup are prep-worthy events
- **`telegram-communication`** — Escalation messages follow Telegram rules (speak for {{PARENT_1}}, short for {{PARENT_2}})

## Safety Hierarchy

This is **Principle #10** in the constitution because it has SAFETY implications:
- Principles 1-9 affect convenience and productivity
- Principle 10 affects **child safety**
- It overrides ALL other considerations: convenience, productivity, scheduling optimization, workflow efficiency

**When in doubt, create the reminder. When in doubt, ask for pickup time. When in doubt, escalate.**
