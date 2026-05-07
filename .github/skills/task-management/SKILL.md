---
name: task-management
description: Centralized task management procedures for all agents — creating, tracking, updating, and completing tasks via the action-tracker extension. Use when managing tasks, creating action items, checking task status, cleaning up stale tasks, or any agent says "create task", "manage tasks", "task status", "clean up tasks", "update task", "complete task", "task lifecycle", "task ownership".
---

# Task Management Skill

Every agent on the {{FAMILY_NAME}} family platform uses the **action-tracker extension** as the single source of truth for tasks. This skill defines the rules, patterns, and anti-patterns for task management across all agents.

## Core Principle

**The action-tracker database is the system of record.** No agent should maintain its own parallel task list. Query the action-tracker dynamically — never cache task IDs or duplicate task lists in working memory.

## Available Tools

| Tool | Purpose |
|------|---------|
| `add_task` | Create a new task |
| `list_tasks` | Query tasks with filters (status, assignee, category, created_by, due_date, surface, priority) |
| `update_task` | Update a task's fields (status, priority, assignee, due_date, notes, surface) |
| `complete_task` | Mark a task done (handles recurrence, unblocks dependents, shows post-completion instructions) |
| `delete_task` | Permanently remove a task and its dependency links |
| `ready_tasks` | Show tasks with all dependencies met (no unfinished blockers) |
| `task_summary` | Dashboard: totals by status, priority, assignee, category, surface, overdue count |
| `expand_template` | Expand a task template into a dependency chain |
| `list_templates` | Show available task templates |
| `get_dependency_tree` | Show upstream/downstream dependencies for a task |
| `cancel_template_instance` | Cancel remaining tasks from a template expansion |

## Task Creation Rules

### Required Fields

Every task MUST have:
- **`title`** — clear, actionable description (verb-first: "Schedule AC tune-up", "Call MOHELA about deferment")
- **`created_by`** — the agent name creating the task (e.g., `"finance-manager"`, `"health-coach"`, `"user"` for direct human requests)

### Recommended Fields

- **`category`** — one of: general, chore, errand, appointment, school, health, home, finance, shopping, meal, pregnancy, watch
- **`priority`** — urgent, high, medium (default), low
- **`assignee`** — {{PARENT_1}}, {{PARENT_2}}, shared, {{PARENT_1}}-jr, or empty
- **`due_date`** — YYYY-MM-DD format. Set realistic dates.
- **`surface`** — visibility level (see Surface Levels below)
- **`notes`** — additional context, why the task matters, relevant details

### Surface Levels

| Surface | Who sees it | When to use |
|---------|-------------|-------------|
| `human` | Served by task-coach to {{PARENT_1}}/{{PARENT_2}} | Action items that require human execution |
| `agent` | Agent-internal only, never shown to humans | Agent coordination, internal tracking, automated follow-ups |
| `notify` | Appears in summaries, not served as active task | Informational items, FYI notices, monitoring alerts |

**Default is `human`.** Use `agent` for tasks that agents handle autonomously. Use `notify` for awareness items.

### Priority Guidelines

| Priority | When to use | Examples |
|----------|-------------|---------|
| `urgent` | Safety, deadlines <24h, financial risk, child-related | HJ fever recheck, insurance enrollment deadline, NICU visit prep |
| `high` | Important but not immediate, deadlines <7 days | Schedule {{DOCTOR_NAME}}, pay bill due this week |
| `medium` | Standard action items, no time pressure | Organize nursery, research programs, update records |
| `low` | Nice-to-have, backlog items, long-term | Calendar audit, research future improvements |

### Category Selection Guide

- **health** — medical appointments, medications, symptoms, recovery tracking
- **finance** — bills, payments, budgets, insurance, benefits enrollment
- **baby** — NICU care, pumping, twin-specific tasks
- **home** — maintenance, repairs, cleaning, nursery prep
- **chore** — daily/weekly household tasks (trash, dishes, laundry)
- **errand** — trips to stores, pickups, drop-offs
- **appointment** — scheduled meetings, calls, visits
- **school** — HJ education, activities, school-related admin
- **shopping** — purchase decisions, product research
- **meal** — meal planning, grocery runs, cooking prep
- **watch** — monitoring items (token health, subscription renewals)
- **general** — anything that doesn't fit above

## Task Ownership

**Each agent owns tasks in its domain.** Use the `created_by` field to track which agent created a task.

### Ownership Rules

1. **Always set `created_by` to your agent name** when creating tasks (e.g., `created_by: "nicu-care"`)
2. **Only manage tasks you created** — use `list_tasks(created_by="{your-agent-name}")` to find your tasks
3. **Never modify another agent's tasks** unless explicitly coordinating (e.g., platform-manager doing cleanup)
4. **Cross-domain tasks** — if a task spans domains, the creating agent owns it. Coordinate via notes.
5. **User-created tasks** have `created_by: "user"` — any agent can serve these if relevant to their domain

### Querying Your Tasks

```
list_tasks(created_by="health-coach", status="pending")     # My pending tasks
list_tasks(created_by="finance-manager", priority="urgent")  # My urgent tasks
list_tasks(category="health", status="pending")              # All health tasks (any creator)
list_tasks(assignee="{{PARENT_1}}", surface="human")               # {{PARENT_1}}'s human-facing tasks
```

## Task Lifecycle

```
pending → in_progress → done
                      → cancelled
                      → blocked
```

### State Transitions

- **pending** → Task exists, waiting to be started. Default state on creation.
- **in_progress** → Someone is actively working on it. Set this when starting work.
- **done** → Task completed. ALWAYS use `complete_task` (not `update_task`) to mark done — it handles recurrence, dependency unblocking, and post-completion instructions.
- **cancelled** → Task no longer needed. Use `update_task(id, status="cancelled")`. Add notes explaining why.
- **blocked** → Cannot proceed. Use `update_task(id, status="blocked")`. Add notes explaining what's blocking it.

### The `complete_task` Rule (CRITICAL — from {{PARENT_1}})

**ALWAYS call `complete_task(id)` BEFORE confirming completion to the user.**

```
✅ CORRECT:
1. complete_task(id="abc123")     ← call first
2. Telegram: "✅ Done!"           ← confirm after

❌ WRONG:
1. Telegram: "✅ Done!"           ← acknowledged but NOT completed
2. (forgot to call complete_task) ← task stays pending, gets re-served
```

This rule applies to ALL agents in ALL contexts — sprint mode, cron nudges, interactive transitions, orchestrator dispatch. No exceptions.

## Anti-Patterns

### ❌ Never Do These

1. **Don't duplicate task lists in working memory** — The action-tracker IS the task list. Query it dynamically with `list_tasks(created_by="{agent-name}")`. Never maintain a parallel list of task IDs in your working memory file.

2. **Don't track task IDs in working memory** — Task IDs are ephemeral references. If you need to know your tasks, query the action-tracker. Working memory should describe DOMAINS and FOCUS AREAS, not enumerate IDs.

3. **Don't create tasks for calendar events** — If something has a specific date/time and needs a phone notification, use `gcal_create_event`. Tasks are for ACTION ITEMS, not event reminders. (Exception: prep tasks for events — "Pack HJ's gear for soccer" IS a task.)

4. **Don't create agent-surface tasks for human actions** — If {{PARENT_1}} needs to DO something (call someone, pay a bill, pick up HJ), it's `surface: "human"`. Agent-surface is for things agents handle autonomously.

5. **Don't create social media reply tasks on the human queue** — Social media comment/reply work is autonomous (content agents own it). Never surface these to {{PARENT_1}} unless he explicitly asks.

6. **Don't create duplicate tasks** — Before creating, check `list_tasks` for existing tasks with similar titles or in the same category. If one exists, update it instead of creating a new one.

7. **Don't leave stale tasks open** — If a task's context has changed (event passed, issue resolved, info obtained), update or cancel it. Don't let stale tasks clog the queue.

## Working Memory Rules

### What Belongs in Working Memory

Working memory should contain **domain context and focus areas**, not task lists:

```markdown
✅ GOOD working memory:
## Health Domain Focus
- Monitoring HJ fever (Day 4 of illness)
- {{PARENT_2}} Lexapro Day 17 — past therapeutic threshold
- Next milestone: 6-week postpartum appointment (date TBD)
- 📋 Task Management: Invoke `task-management` skill for all task operations

❌ BAD working memory:
## My Tasks
- Task abc123: Schedule HJ doctor
- Task def456: Recheck HJ temp
- Task ghi789: MacroBid 9 PM reminder
- Task jkl012: Follow up birth certificates
- Task mno345: Insurance enrollment
```

### Working Memory Should Reference

- **Domain state** — what the agent is currently monitoring/tracking
- **Key context** — facts that inform decision-making (medication schedules, deadlines, milestones)
- **Focus areas** — what's most important right now
- **Pending clarifications** — what information is still needed
- **Patterns and lessons** — what the agent has learned

### Working Memory Should NOT Reference

- Individual task IDs (query the action-tracker instead)
- Complete task lists (use `list_tasks(created_by="{agent-name}")`)
- Task management procedures (this skill covers those)
- Duplicate information available via tool queries

## Querying Patterns

### Common Queries

```
# What's on my plate?
list_tasks(created_by="health-coach", status="pending")

# What's urgent across all domains?
list_tasks(priority="urgent", status="pending")

# What's due today?
list_tasks(due_date_before="2026-05-05", status="pending")

# What's ready to work on (all dependencies met)?
ready_tasks(surface="human")

# Dashboard overview
task_summary(surface_filter="human")

# What has a specific assignee?
list_tasks(assignee="{{PARENT_1}}", status="pending", surface="human")
```

### Efficient Query Patterns

1. **Start narrow** — filter by `created_by` and `status` first
2. **Add filters progressively** — category, priority, due_date as needed
3. **Use `task_summary`** for counts and overview — don't query all tasks just to count them
4. **Use `ready_tasks`** for what can be worked on NOW

## Cleanup Procedures

### When to Clean Up

- During scheduled check-ins (cron cycles)
- When a domain state changes significantly (event completed, issue resolved)
- When `task_summary` shows high overdue counts
- When platform-manager flags task backlog growth

### How to Clean Up

1. **Query your domain**: `list_tasks(created_by="{agent-name}", status="pending")`
2. **For each task, evaluate**:
   - Is this still relevant? → Keep or cancel
   - Has the due date passed with no action? → Reschedule or cancel
   - Is this a duplicate of another task? → Cancel the duplicate
   - Has the underlying need been resolved? → Mark done or cancel
3. **Cancel with notes**: `update_task(id, status="cancelled", notes="Resolved: [reason]")`
4. **Update stale info**: `update_task(id, due_date="2026-05-10", notes="Rescheduled from May 3")`

### Auto-Pay Cleanup Rule (from {{PARENT_1}})

If {{PARENT_1}} says a bill is on auto-pay, **cancel all bill-payment reminder tasks** for that account. This includes:
- Pay/due reminders
- Snowball or debt-payoff tasks
- Auto-pay confirmation tasks
- Any task whose only purpose is reminding about a bill payment

**Keep non-bill finance tasks active** — SSI, benefits enrollment, medical bill tracking, proof-of-income gathering, etc.

### Payment Logged = Clear Cluster Rule (from {{PARENT_1}})

When a payment is confirmed ({{PARENT_1}} says he paid, or matching transaction in budget ledger):
1. Find ALL matching human-facing reminder tasks for that payment
2. Mark them ALL done or cancelled immediately
3. One payment event clears the FULL reminder cluster
4. Before serving a bill-payment task, check the budget ledger for same-day payment evidence

## Clarification Tasks

When an agent doesn't have concrete data needed for a recommendation:

1. **Do NOT guess or assume** — stop the chain of reasoning
2. **Create a clarification task**:
   ```
   add_task(
     title="What time is HJ pickup from Miss Stephanie?",
     category="clarification",
     priority="high",
     assignee="{{PARENT_1}}",
     notes="Need pickup time to set a hard reminder. HJ was mentioned with caregiver at 2 PM.",
     created_by="family-coordinator"
   )
   ```
3. **Block dependent work** until the clarification is answered

## Task Templates

For repeatable multi-step processes, use task templates:

```
list_templates()                          # See available templates
expand_template(template_id="...")        # Create a dependency chain
get_dependency_tree(task_id="...")        # View task dependencies
cancel_template_instance(instance_id="...") # Cancel remaining chain tasks
```

Templates are defined in `data/task-templates/` and expanded into real tasks with pre-wired dependencies.

## Integration with Other Systems

### Calendar Events vs Tasks

| Situation | Use |
|-----------|-----|
| {{DOCTOR_NAME}} 2:15 PM | Calendar event (`gcal_create_event`) |
| "Pack insurance cards for doctor" | Task (`add_task`, due before appointment) |
| "Report {{DOCTOR_NAME}} NICU" | Task (`add_task`, due after appointment) |
| Weekly team meeting | Calendar event (recurring) |
| "Prepare agenda for team meeting" | Task (recurring, due day before) |

### Shopping List vs Tasks

| Situation | Use |
|-----------|-----|
| "We need milk" | Shopping list (`add_to_shopping_list`) |
| "Research best car seat for preemies" | Task (`add_task`, category: baby) |
| "Order nursery furniture this week" | Task (`add_task`, category: shopping) |

### Budget vs Tasks

| Situation | Use |
|-----------|-----|
| Recording a $50 grocery purchase | Budget (`add_expense`) |
| "Review AWS charge — business or personal?" | Task (`add_task`, category: finance) |
| "Set up autopay for all credit cards" | Task (`add_task`, category: finance) |

## Bottom Line

1. **One system of record** — the action-tracker database. Query it, don't duplicate it.
2. **Own your domain** — use `created_by` to track ownership. Only manage your tasks.
3. **`complete_task` before confirming** — no exceptions, all agents, all contexts.
4. **Working memory = domain context**, not task lists. Reference categories and focus areas.
5. **Clean up regularly** — stale tasks degrade the system for everyone.
6. **Surface levels matter** — human tasks go to {{PARENT_1}}/{{PARENT_2}}, agent tasks stay internal, notify for FYIs.
