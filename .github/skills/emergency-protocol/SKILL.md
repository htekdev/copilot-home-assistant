---
name: emergency-protocol
description: Family emergency response procedures — parent notification, medical info relay, child safety escalation, and urgent contact protocols. Use when user says "emergency", "urgent medical", "notify other parent", "emergency contact", "911", "hospital", "safety alert", "allergies", "medications list", or any family emergency situation.
---

# Emergency Protocol Skill

Procedures for handling emergencies in the family system. ALL agents must know how to escalate when safety or health is at stake.

## Core Principle

**Emergency notifications bypass ALL normal rules.** Quiet hours, batching, drip-feed limits, priority queues — ALL suspended during emergencies.

## Emergency Classification

| Level | Description | Example | Response |
|-------|-------------|---------|----------|
| **CRITICAL** | Immediate physical danger | Child unattended, medical emergency, fire | Notify BOTH parents immediately + provide action info |
| **URGENT** | Needs attention within minutes | Medication reaction, pickup overdue, severe weather alert | Notify relevant parent + create urgent task |
| **HIGH** | Needs attention today | Missed medication dose, suspicious email, payment about to fail | Normal high-priority notification flow |

## Procedure: CRITICAL Emergency

### Step 1 — Notify BOTH Parents Immediately

```
telegram_send_message(
  chat_id: "{{TELEGRAM_PARENT_1}}",  # {{PARENT_1}}
  message: "🚨 EMERGENCY: [situation]\n📍 [location if known]\n📞 [action to take]",
  speak: "Emergency. [brief situation]. [action needed]."
)

telegram_send_message(
  chat_id: "{{TELEGRAM_PARENT_2}}",  # {{PARENT_2}}
  message: "🚨 [brief situation] — [action needed]"
)
```

### Step 2 — Provide Medical Context

If the emergency is health-related, immediately pull and relay:

```
get_family_member(name: "[affected person]")
```

Key fields to relay:
- **Allergies** (from profile)
- **Current medications** (from profile)
- **Medical conditions** (from profile)
- **Pharmacy** (for Rx emergencies)
- **Doctor/provider** (for consultation)

### Step 3 — Create Tracking Task

```
add_task(
  title: "EMERGENCY: [situation] — [status]",
  priority: "urgent",
  category: "health",
  assignee: "shared",
  notes: "Detected at [time]. [what was done]. Follow-up: [what's needed]."
)
```

## Procedure: Child Safety Escalation

**When a child pickup is overdue or location is unknown:**

1. Send URGENT notification to both parents
2. Include last known context: "Last mentioned at [time]: {{CHILD_1_NAME}} with [caregiver]"
3. Provide caregiver contact if available
4. Create urgent task: "Confirm {{CHILD_1_NAME}} pickup / location"

**This integrates with the child-safety-protocol skill** — see that skill for location tracking rules.

## Emergency Contacts Quick Reference

Pull from family profiles via `get_family_member`. Key contacts to surface:

| Need | Source |
|------|--------|
| Pediatrician | {{CHILD_1_NAME}}'s profile → medical.doctor |
| OB/GYN | {{PARENT_2}}'s profile → medical.ob |
| Pharmacy | Family profile → medical.pharmacy |
| Hospital (NICU) | nicu-care memory → hospital info |
| Poison Control | 1-800-222-1222 (always include) |
| Non-emergency police | Local PD (from locations) |

## Integration with Other Skills

- **`child-safety-protocol`** — Pickup reminders, location staleness rules
- **`telegram-communication`** — Message formatting (emergencies bypass quiet hours)
- **`clarification-workflow`** — Do NOT create clarification tasks during emergencies; act on best available info
- **`time-awareness`** — Timestamp all emergency notifications

## Rules for ALL Agents

1. **Any agent can trigger an emergency** — you don't need to be a health/safety agent
2. **Act first, verify later** — false positives are better than missed emergencies
3. **Both parents get notified** — unless the emergency IS about one of them (then notify the other)
4. **Never delay for batching** — emergency messages go out one at a time, immediately
5. **Include phone numbers and addresses** when relevant — don't make them look it up
6. **Create a task** even during emergencies — it becomes the tracking artifact

## Anti-Patterns

- ❌ Waiting for quiet hours to end before sending an emergency alert
- ❌ Batching emergency info with a daily briefing
- ❌ Sending "you might want to check on..." for genuine safety concerns
- ❌ Only notifying one parent when both should know
- ❌ Creating a "clarification" task instead of acting during a real emergency
- ❌ Providing medical info without checking the actual profile (might be outdated)
