---
name: work-hours-filtering
description: >
  Work-hours task filtering and availability detection — suppresses physical tasks during
  meetings, serves only digital tasks during work blocks, and determines free gaps for
  task delivery. Use when checking availability, filtering tasks by work status, deciding
  what to serve during meetings, or any agent says "is he in meetings", "work hours",
  "suppress chores", "can I nudge now", "is he available", "free block", "meeting check".
---

# Work-Hours Filtering Skill

Determines {{PARENT_1}}'s real-time availability by checking BOTH personal and work calendars, then classifies which types of tasks can be served. This prevents interrupting focused work with physical chores.

## Why This Exists

{{PARENT_1}}'s Google Calendar only shows personal events. Their work calendar (for example Microsoft 365 / Outlook in this deployment) is invisible to Google Calendar. Agents MUST check BOTH to know their real availability.

## Data Sources (BOTH required on weekdays)

| Source | What It Shows | Tool |
|--------|--------------|------|
| Google Calendar | Personal events, family, appointments | `gcal_today` / `gcal_upcoming` |
| Work calendar | Work meetings, standups, reviews | `workiq-ask_work_iq` "What meetings does {{PARENT_1}} have today?" |

## The Algorithm

### Weekdays (Monday–Friday, 9 AM – 5 PM CT)

1. Pull today's events from BOTH calendars
2. Determine current time block status:
   - **In a meeting / event now** → SUPPRESS all tasks. Stay silent.
   - **Meeting within 15 min** → SUPPRESS physical tasks. Only serve quick digital (<5 min).
   - **Free block 30+ min with no upcoming event** → Serve lighter tasks (digital or quick physical <10 min)
   - **Free block 60+ min** → Full task serving (energy-appropriate)

3. **After 5 PM on weekdays** → Normal task serving resumes. No work-calendar filtering.

### Weekends (Saturday & Sunday)

No work-calendar filtering. Serve tasks normally using priority and energy matching. Weekends are prime chore time.

## Task Classification

### Physical Tasks (SUPPRESS during work hours with meetings)
- Cleaning, cooking, meal prep
- Yard work, errands, grocery shopping
- Laundry, home maintenance
- Taking out trash, organizing
- Any task with a physical location or that requires leaving the desk

### Digital Tasks (OK during free work-hour gaps)
- Emails, online bill pay
- Scheduling appointments
- Checking order status
- Reviewing documents
- Updating lists
- Quick phone calls (~5 min)

## Response Patterns

### When suppressing (in a meeting block):
- Stay silent — don't nudge at all
- If this is first contact of the day during work hours: "You've got meetings — I'll hold the chores for later 💼"

### When partially available (short gap between meetings):
- Serve ONLY digital/quick tasks: "Quick one while you have a gap — [digital task] (~5 min)"

### When fully available (long free block or after-hours):
- Normal task serving with energy matching

## Integration

- **Primary consumers**: task-coach, daily-briefing, family-coordinator
- **Time computation**: Use `time-awareness` skill to determine current CT time
- **Task ordering**: Feeds into `task-ordering` skill's availability check
- **Calendar tools**: `gcal_today`, `gcal_upcoming`, `workiq-ask_work_iq`

## Anti-Patterns

- ❌ Checking only Google Calendar and assuming {{PARENT_1}} is free
- ❌ Serving physical chores during a meeting gap
- ❌ Nudging during an active meeting
- ❌ Applying work-hours filtering on weekends
- ❌ Suppressing ALL tasks — digital quick-wins are OK during gaps
