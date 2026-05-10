---
name: daily-briefing-format
description: Structured morning/evening briefing format — weather, dual-calendar merge, tasks, emails, meals, bills, maintenance, and proactive task creation. Use when user says "briefing", "morning summary", "daily report", "what's today look like", "day overview", "evening recap", "compile briefing", or any structured multi-section daily status report.
---

# Daily Briefing Format Skill

Canonical format for compiling and delivering structured daily briefings to the family. Used by daily-briefing agent, weekly-planner, and heartbeat.

## Briefing Compilation Order

Every briefing follows this sequence. Agents may use a subset (heartbeat skips weather/meals) but the section ordering is fixed.

### Section 1: Weather

```
web_search(query: "weather today [city] TX forecast")
```

Format: `🌤️ High: XX° / Low: XX° — [conditions]. [alerts if any]`

### Section 2: Today's Calendar (DUAL-CALENDAR MERGE — MANDATORY)

**Both calendars MUST be checked.** Personal-only gives an incomplete picture.

```
1. gcal_today()  → personal events
2. workiq-ask_work_iq(question: "What meetings does {{PARENT_1}} have today?") → work events
```

**Merge into unified timeline:**
- 🏠 = personal event
- 💼 = work event
- Filter: only show UPCOMING events as action items (check current time first)
- Past events: `✅ Earlier: [event]` (one line, collapsed)

### Section 3: Tasks & To-Dos

```
task_summary()           → dashboard overview
list_tasks(status: "pending", due_date_before: "today")  → overdue
list_tasks(status: "pending", due_date_before: "end_of_week")  → this week
```

Format:
```
📋 Tasks: X pending | Y overdue | Z due today
🔴 Overdue: [list briefly]
📌 Today: [top 3 by priority]
```

### Section 4: Email Highlights

```
gmail_unread_count()
gmail_search(query: "newer_than:1d")
```

Format: `📧 X unread — [1-2 line summary of important items]`

### Section 5: Tonight's Dinner

```
get_meal_plan()  → check today's dinner slot
```

Format: `🍽️ Dinner: [meal] — [any prep needed?]` or `🍽️ No dinner planned — create a task?`

### Section 6: Bills & Maintenance

```
# Bills due soon:
get_transactions(category: "RENT_AND_UTILITIES", start_date: "today", end_date: "+3 days")
# Or use budget tools

# Maintenance:
maintenance_due(within_days: 7)
```

Format: `💸 Bills: [any due in 3 days]` + `🏠 Maintenance: [any due this week]`

### Section 7: NICU/Baby Updates (Contextual)

Only include if relevant (twins in NICU, appointments pending):
- Pumping schedule reminders
- NICU visit times
- Baby milestone notes

## Proactive Task Creation (CRITICAL)

**Before sending the briefing**, scan ALL findings and create tasks for:
- Bills due within 3 days → `add_task(category: "finance", priority: "high")`
- Overdue maintenance → `add_task(category: "home", priority: "medium")`
- Emails requiring action → `add_task(notes: email summary)`
- Empty meal plan → `add_task(title: "Plan tonight's dinner")`
- Any gap needing human action → **create a task**

The briefing REPORTS the day. Tasks DRIVE action.

## Delivery Rules

- **Telegram first** — send structured message with emoji section headers
- **Use `speak` param for {{PARENT_1}}** — summarize the day in 1-2 TTS sentences
- **Keep total message under 4096 chars** — Telegram limit. Be ruthlessly concise.
- **Respect quiet hours** — 10 PM – 6 AM. Weekday briefing at 6 AM, weekend at 8 AM.

## Briefing Variants

| Variant | Used By | Sections Included |
|---------|---------|-------------------|
| Full morning | daily-briefing | All (1-7) |
| Quick heartbeat | heartbeat | 2, 3, 4 only |
| Weekly planning | weekly-planner | 2, 3, 6 + full week calendar |
| Evening recap | (future) | 3 (completed today), 5 (tomorrow prep) |
