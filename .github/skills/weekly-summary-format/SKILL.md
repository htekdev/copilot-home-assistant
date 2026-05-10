---
name: weekly-summary-format
description: Weekly planning summary format and procedure — week-in-review, upcoming calendar, priority tasks, meal plan, financial snapshot, and home maintenance. Use when user says "weekly summary", "weekly planning", "Sunday planning", "week review", "weekly report", "what's next week", "plan the week", or any weekly planning session.
---

# Weekly Summary Format Skill

Canonical format and data-gathering procedure for the weekly planning session (typically Sunday evening).

## When to Use

- Sunday evening weekly planning session (via `weekly-planner` agent or cron)
- When {{PARENT_1}} asks "what's my week look like?"
- Any time a comprehensive week overview is needed

## Data Gathering Procedure

### Step 1 — Week in Review (Past Week)

```
list_tasks(status: "done", due_date_after: "[last Monday]", due_date_before: "[today]")
list_tasks(status: "pending", due_date_before: "[today]")  # Carryover / overdue
```

### Step 2 — Upcoming Calendar (Next 7 Days)

```
gcal_upcoming(days: 7)
workiq-ask_work_iq(question: "What meetings does {{PARENT_1}} have next week?")
```

Combine both calendars. Label sources: 🏠 Personal | 💼 Work.

### Step 3 — Priority Tasks

```
list_tasks(status: "pending", priority: "urgent")
list_tasks(status: "pending", priority: "high")
list_tasks(status: "pending", due_date_before: "[next Sunday]")
```

### Step 4 — Meal Plan Status

```
get_meal_plan()  # Current/upcoming week
```

If empty → note that meal planning is needed.

### Step 5 — Financial Snapshot

```
get_spending_summary(start_date: "[first of month]")
# Check for bills due this week
list_tasks(category: "finance", status: "pending", due_date_before: "[next Sunday]")
```

### Step 6 — Home Maintenance

```
maintenance_due(within_days: 14)
```

### Step 7 — Family Health / NICU (if applicable)

Pull from `nicu-care` working memory or health-coach context for any upcoming appointments, medication refills, or milestone dates.

## Output Format (Telegram)

```
📋 Weekly Summary — Week of [Monday date]

🔙 Last Week
✅ Completed: X tasks
⚡ Highlights: [top 2-3 accomplishments]
⏳ Carried over: X tasks

📅 This Week
[Day] — [key events, labeled 🏠/💼]
[Day] — [key events]
...

🎯 Priority Tasks
🔴 [urgent items]
🟡 [high items]
📋 [count] total pending

🍽️ Meals
[status — planned/needs planning]

💰 Finance
• MTD spending: $X
• Bills due: [list or "none"]
• Budget status: [on track / over in X category]

🏠 Home
• [maintenance items due soon]

👶 Health/NICU
• [relevant updates]

---
Let's make it a great week! 🚀
```

## Delivery Rules

- **Telegram to {{PARENT_1}}** with `speak` parameter: "Here's your weekly summary. You completed X tasks last week. This week you have Y events and Z priority tasks."
- Keep the message scannable — bullet points, emojis for section headers
- If the message exceeds ~2000 chars, split into 2 messages (review + upcoming)

## Consuming Agents

- `weekly-planner` — Primary consumer (Sunday evening cron)
- `checkin` — May produce a condensed version during Monday morning check-in
- Main session — When {{PARENT_1}} asks for a week overview

## Integration with Other Skills

- **`calendar-availability`** — Dual-calendar merge for schedule section
- **`time-awareness`** — Compute week boundaries correctly
- **`budget-reporting`** — Financial snapshot format
- **`daily-briefing-format`** — Similar structure, daily scope
- **`task-ordering`** — Priority sorting for task section
