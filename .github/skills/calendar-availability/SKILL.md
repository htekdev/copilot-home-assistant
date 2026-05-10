---
name: calendar-availability
description: >
  Dual-calendar availability checking — combines Google Calendar (personal) and WorkIQ (work/Microsoft 365)
  to determine true schedule and free slots. Use when agent says "check availability", "find free time",
  "schedule something", "is {{PARENT_1}} free", "what meetings today", "gym slot", "when can he",
  "calendar conflicts", "block time", or any scheduling decision.
---

# Calendar Availability

## Purpose

{{PARENT_1}} has TWO calendars — personal (Google Calendar) and work (Microsoft 365 via WorkIQ). Checking only one gives an INCOMPLETE, DANGEROUS picture of his availability. Work meetings are invisible to Google Calendar and vice versa.

This skill ensures ALL scheduling agents properly combine both calendar sources before making time-based decisions.

## The Workflow

### Step 1 — Check Personal Calendar (Google)

```
gcal_today()          # For today's events
gcal_upcoming(days=N) # For multi-day lookups
```

Returns: Family events, medical appointments, errands, kids' activities, personal commitments.

### Step 2 — Check Work Calendar (Microsoft 365)

```
workiq-ask_work_iq(question: "What meetings does {{PARENT_1}} have today?")
# Or for a specific date:
workiq-ask_work_iq(question: "What meetings does {{PARENT_1}} have on [date]?")
# Or for availability:
workiq-ask_work_iq(question: "When is {{PARENT_1}} free between [start] and [end]?")
```

Returns: Work meetings (standups, 1:1s, reviews, focus time, team syncs).

### Step 3 — Combine and Determine Availability

A time slot is only FREE if it's clear on BOTH calendars.

**Merge rules:**
- Overlapping events from both calendars = fully blocked
- Adjacent events with <15 min gap = effectively blocked (no useful time)
- "Focus time" on work calendar = treat as soft block (can be overridden for urgent personal)
- "Tentative" events = treat as soft block (mention the conflict)

### Step 4 — Report with Source Labels

When reporting availability, clearly distinguish sources:
- 🏠 Personal: OB appointment at 3 PM
- 💼 Work: Team standup 10–10:30 AM
- ✅ Free: 11 AM – 12 PM (both calendars clear)

## Scheduling Rules

### Gym Slot (Standing Order)
- **Preferred window:** 11 AM – 2 PM
- **Priority order:** 12-1 PM → 11-12 PM → 1-2 PM → outside range (flag to {{PARENT_1}})
- **After finding slot:** Create Google Calendar event + send message to `msix-home` workspace for OOF block

### Work Calendar Writes
- Personal events reflected on work calendar go through the agent mesh:
  ```
  send_message(
    workspace: "msix-home",
    content: "Create an OOF block on {{PARENT_1}}'s Outlook calendar: [event details, time, date]"
  )
  ```
- Default `showAs`: **oof** (Out of Office), NOT busy
- Do NOT copy work meetings INTO Google Calendar (wrong direction)

### Morning OOF for Drop-offs
- When {{CHILD_1_NAME}} goes to {{CAREGIVER_NAME}}'s → block morning slot (8:00-9:30 AM) on work calendar as OOF
- Trigger: drop-off mentioned or on family calendar

## Conflict Resolution

When a scheduling conflict is detected:
1. **Both personal events:** Ask {{PARENT_1}} which takes priority
2. **Personal vs work meeting:** Note the conflict, suggest rescheduling the flexible one
3. **Urgent personal vs work:** Recommend OOF on work calendar + suggest declining/rescheduling work meeting
4. **Multiple free slots available:** Apply preference ordering (energy matching, location chaining)

## Consuming Agents

These agents MUST use this skill before any scheduling decision:
- `daily-briefing` — morning schedule report
- `family-coordinator` — activity scheduling
- `task-coach` — leave-by times, prep task timing
- `weekly-planner` — week overview
- `checkin` — consolidated status
- `fitness-coach` — gym slot finding
- Any agent that says "you're free at [time]"

## Anti-Patterns

- ❌ "You're free this afternoon" (only checked Google Calendar)
- ❌ Scheduling over a work meeting because it wasn't visible in personal calendar
- ❌ Reporting a "packed day" when most events already happened (check current time first)
- ❌ Writing work events INTO Google Calendar (wrong direction — use mesh to write to Outlook)

## Integration with Other Skills

- **`time-awareness`** — Compute current time before filtering past/future events
- **`clarification-workflow`** — If neither calendar has enough data, ask
- **`proactive-task-intelligence`** — Use availability to time prep tasks optimally
