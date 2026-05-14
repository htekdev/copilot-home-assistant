---
name: nightly-reflection
description: >
  Nightly maintenance and reflection protocol — Phase 0 active maintenance (cron health, token health,
  task hygiene, budget sync, memory health) plus Phases 1-5 (session review, data gathering, reflection,
  proposals, report). Use when user says "nightly reflection", "nightly maintenance", "9 PM cron",
  "nightly report", "evening maintenance", "run reflection protocol", "maintenance cycle".
---

# Nightly Reflection Protocol

Full nightly maintenance and reflection protocol, executed by `platform-manager` at 9 PM via cron.

## Phase 0: Active Maintenance — FIX THINGS FIRST

**Before reflecting, fix what you can.** This is the most important phase.

### 0a. Cron Health Scan
1. Read `cron.json` — verify every entry references a valid agent in `.github/agents/`
2. Glob `.github/agents/*.agent.md` — check if any agent exists WITHOUT a cron entry
3. For orphaned agents (exist but no cron): add a sensible cron entry based on the agent's purpose. Commit immediately.
4. For phantom crons (reference deleted agents): remove the entry. Commit immediately.
5. Verify no cron fires during quiet hours (10 PM – 6 AM) unless intentionally designed that way.

### 0b. Token Health Check & Auto-Refresh
1. Check all social token health via `late_account_health`
2. For expired tokens with auto-refresh (Twitter, YouTube, Instagram, LinkedIn): the platform should handle this — just verify and log
3. For tokens requiring manual re-auth (TikTok, Google OAuth):
   - Check if a task ALREADY exists for this token — search by keyword
   - If no task exists, create exactly ONE with clear instructions (auth URL if possible)
   - If a task already exists, do NOT create another — just update working memory
   - For Google OAuth: call `google_auth_status`. If expired, call `google_auth_url` and send the URL to {{PARENT_1}} via Telegram with "Click this, sign in, paste the code back" instructions

### 0c. Task Hygiene
1. `list_tasks` with status="pending" — scan for:
   - **Stale overdue tasks**: due date passed AND the task references a specific date/event that's gone (e.g., "Saturday party", "call by 3 PM Friday"). Mark these as done with note "auto-closed: event date passed".
   - **Duplicate tasks**: same topic/title appearing 2+ times. Keep the most detailed, `complete_task` the rest with note "auto-closed: duplicate of [kept-task-id]".
   - **Reschedule candidates**: overdue but still relevant (no specific past event). Bump due_date to a realistic future date.
2. Cap: max **20 task mutations** per cycle.

### 0d. Budget Sync
1. If Google OAuth is working: check `get_spending_summary` vs `budget_vs_actual`
2. For categories where Plaid shows >$100 spending but budget tracker shows $0: auto-log an expense via `add_expense` with description "Auto-synced from Plaid — [category]"
3. Cap: max **5 auto-logged expenses** per cycle to avoid flooding

### 0e. Agent Memory Health
1. Scan `data/agents/*/working.md` — check "Last Updated" timestamps
2. If any agent's working.md hasn't been updated in 3+ days and the agent has active cron jobs, note it as potentially stale
3. If any working.md exceeds 10KB, flag for trimming (or auto-trim old sections if clearly outdated)
4. Verify all 4 memory tier files exist for each domain agent — create missing ones from template if needed

**Commit all fixes from Phase 0 in a single commit before proceeding to Phase 1.**

## Phase 1: Session Transcript Review

Use `session_store_sql` to query recent session events, turns, and tool calls. Look for:

- **User frustrations** — repeated errors, corrections, phrases like "that's annoying", "why doesn't this work", "no", "wrong"
- **Important decisions** — architectural changes, new conventions, workflow changes
- **New conventions or patterns** — that emerged during the day and should be persisted
- **Corrections from {{PARENT_1}} or {{PARENT_2}}** — behavioral corrections that need to be saved to memory, standing orders, or copilot-instructions
- **Tools that failed repeatedly** — broken integrations, timeouts, permission errors

Example queries:
```sql
-- Recent user messages with frustration signals
SELECT timestamp, user_content FROM events
WHERE type = 'user.message'
AND updated_at > now() - INTERVAL '24 hours'
ORDER BY timestamp DESC LIMIT 50

-- Failed tool calls today
SELECT timestamp, tool_start_name, tool_complete_result_content FROM events
WHERE type = 'tool.execution_complete'
AND tool_complete_success = false
AND timestamp > now() - INTERVAL '24 hours'
ORDER BY timestamp DESC LIMIT 20
```

This grounds the nightly reflection in what actually happened today, not just data snapshots.

## Phase 2: Gather Today's Activity Data

Collect a snapshot of the assistant's current state by running these in parallel:

1. `task_summary` — overall task health (overdue, blocked, done today)
2. `list_tasks` with status="done" — what got completed today
3. `list_tasks` with status="pending" — what's still open
4. `list_tasks` with status="blocked" — what's stuck
5. `get_meal_plan` — is the meal plan filled in or empty?
6. `shopping_list` — shopping list state (lots of unchecked items? empty?)
7. `gmail_unread_count` — email backlog
8. `gcal_today` — what was on the calendar today
9. `upcoming_bills` — any bills due soon that haven't been handled
10. `maintenance_summary` — home maintenance state
11. `budget_vs_actual` — any budget categories over or near limit
12. `cron_list_jobs` — verify all cron jobs are enabled and healthy
13. `shopping_history` — recent purchase patterns

## Phase 3: Reflect on the Day

Analyze the data you gathered:

- **What Went Well** — tasks completed, meals planned, bills paid, proactive actions taken
- **What Went Poorly** — overdue tasks, empty meal slots, unread emails piling up, blocked tasks, budget overruns
- **Patterns** — recurring failures, stale shopping lists, empty mid-week meal plans, unused budget tracking

## Phase 4: Generate Improvement Proposals

Create 3-5 specific proposals. Each must include:

1. **Title** — short, descriptive name
2. **Problem** — what's broken (with evidence from today's data)
3. **Solution** — exactly what to change (be specific: which file, what code, what config)
4. **Effort** — 🟢 Quick fix (~5 min) | 🟡 Medium (~30 min) | 🔴 Big (~2+ hours)
5. **Impact** — how this helps the family day-to-day

Types of improvements: new automations, missing data tracking, agent enhancements, extension ideas, standing order updates, workflow streamlining, new meal patterns, budget improvements, home maintenance gaps.

Cross-reference your memory for past proposals — don't repeat rejected ones. Reframe if still relevant.

## Phase 5: Send Report to {{PARENT_1}}

Send a single Telegram message to {{PARENT_1}} (chat_id: `{{TELEGRAM_PARENT_1}}`, with `speak` parameter):

```
🔧 Nightly Maintenance Report

🛠️ Auto-Fixed Tonight:
• [List of fixes actually made — cron entries added, tasks cleaned, tokens refreshed, etc.]

📊 Today's Recap:
• [X] tasks completed, [Y] overdue, [Z] blocked
• [Brief summary]

✅ What Went Well:
• [Specific wins with evidence]

⚠️ Needs Your Attention:
• [Only things that REQUIRE human action — browser re-auth, purchase decisions, etc.]

💡 Improvement Proposals:

1. [🟢/🟡/🔴] [Title]
   [One-line problem → solution]

Reply with the numbers you'd like me to implement!
```

## Reflection Rules

- Keep under 4096 chars (Telegram limit)
- Be specific — reference actual task names, dates, amounts
- Don't repeat proposals {{PARENT_1}} ignored twice — reframe or drop them
- This runs at 9 PM — be mindful {{PARENT_1}} is winding down
- Sort proposals by impact (highest first)
- 🟢 Quick fixes that are obviously beneficial — implement immediately, don't wait for approval. Report what you did.
