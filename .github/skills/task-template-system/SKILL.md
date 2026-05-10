---
name: task-template-system
description: Task template design, trigger configuration, dependency DAG creation, and expansion lifecycle. Use when creating task templates, designing trigger conditions, expanding templates, checking scheduled triggers, or any agent says "create template", "task chain", "dependency chain", "template trigger", "expand template", "task DAG".
---

# Task Template System Skill

Task templates define reusable multi-step task chains with dependency DAGs, trigger conditions, and automatic expansion. They live in `data/task-templates/` as JSON files and are loaded by the action-tracker extension.

## Template File Schema

Each template is a single JSON file in `data/task-templates/{template-id}.json`:

```json
{
  "name": "Human-Readable Name",
  "description": "What this template automates and when to use it",
  "trigger_keywords": ["phrase1", "phrase2"],
  "default_assignee": "{{PARENT_1}}",
  "triggers": [ /* see Trigger Types below */ ],
  "tasks": [ /* see Task Schema below */ ]
}
```

## Task Schema (within a template)

Each task in the `tasks` array:

```json
{
  "key": "unique-step-key",
  "title_template": "Task title (supports ${variable} substitution)",
  "category": "chore|meal|health|finance|general|...",
  "priority": "urgent|high|medium|low",
  "depends_on": ["key1", "key2"],
  "estimated_minutes": 15,
  "assignee": "{{PARENT_1}}",
  "notes": "Context and instructions for this step",
  "on_complete": "Post-completion instructions for the agent (optional)"
}
```

### Dependency Rules
- `depends_on` references other task `key` values within the same template
- A task with empty `depends_on: []` starts immediately (no blockers)
- Tasks with multiple dependencies = **fan-in** (waits for ALL to complete)
- Multiple tasks depending on the same task = **fan-out** (all start when blocker completes)
- **Cycles are FORBIDDEN** — the extension validates with 3-color DFS topological sort
- Keep DAGs shallow (max 4-5 levels deep) for human comprehension

### Title Templates
- Use `${variable}` for dynamic substitution at expansion time
- Common variables: `${date}`, `${person}`, `${item}`
- Override via `expand_template(overrides={"_variables": {"date": "2026-05-06"}})`

## Trigger Types

### 1. `on_task_complete` — fires when a specific task is completed

```json
{
  "type": "on_task_complete",
  "condition": {
    "title_contains": "put groceries away",
    "category": "chore"
  },
  "guard": "ASK: Did you buy chicken? Only expand if yes.",
  "auto_expand": false
}
```

- `condition.title_contains` — substring match (case-insensitive) on completed task title
- `condition.category` — optional category filter
- `guard` — human-readable guard condition; if `auto_expand: false`, agent must ask before expanding
- `auto_expand: true` — expand immediately without asking

### 2. `on_template_complete` — fires when another template instance completes

```json
{
  "type": "on_template_complete",
  "condition": {
    "template_id": "grocery-run"
  },
  "guard": "ASK: Did the grocery run include chicken?",
  "auto_expand": false
}
```

### 3. `schedule` — cron-based scheduled triggers

```json
{
  "type": "schedule",
  "cron": "0 19 * * *",
  "description": "Every evening at 7 PM — suggest shower prep",
  "auto_expand": false,
  "dedup_window_hours": 20
}
```

- `cron` — 5-field cron expression (min hour dom month dow), timezone from `cron.json`
- `dedup_window_hours` — don't re-fire if already fired within this window
- `auto_expand: true` — silently expand without asking
- `auto_expand: false` — present as a suggestion to the user

## Expansion Lifecycle

### How to expand a template

```
expand_template(
  template_id: "chicken-marination",
  assignee: "{{PARENT_1}}",           # override default assignee
  due_date: "2026-05-06",       # set due date for all tasks
  surface: "human",             # visibility level
  created_by: "task-coach",     # who triggered expansion
  overrides: '{"marinate": {"priority": "urgent"}, "_variables": {"date": "today"}}'
)
```

### What expansion does
1. Loads the template JSON
2. Validates DAG (topological sort, cycle detection)
3. Creates all tasks via `add_task` with unique IDs
4. Wires up `depends_on` relationships in the `action_deps` table
5. Stamps all tasks with a shared `template_instance` ID for tracking
6. Returns the instance ID for later cancellation if needed

### Cancelling an expansion

```
cancel_template_instance(
  instance_id: "chicken-marination-2026-05-06-001",
  reason: "Changed plans, no chicken tonight"
)
```

- Marks all non-completed tasks in the instance as `cancelled`
- Completed tasks are preserved (work already done)
- Does NOT unblock downstream tasks — cancelled ≠ completed

## Checking Scheduled Triggers

Use `check_scheduled_triggers()` to:
- Scan all templates with `schedule` type triggers
- Match against current time (respecting cron expression)
- Check dedup window (don't re-fire if recently fired)
- Auto-expand templates with `auto_expand: true`
- Return suggestions for templates with `auto_expand: false`

## Template Design Best Practices

### When to create a template
- A multi-step process has been done 2+ times manually
- A task-coach nudge cycle keeps generating the same prep sequence
- A recurring family activity needs consistent preparation steps
- An event (grocery run, appointment, activity) always triggers follow-up work

### Design rules
1. **Keep tasks atomic** — each step should take 5-20 minutes
2. **Name tasks clearly** — title should be actionable without reading notes
3. **Use notes for context** — why this step matters, what "done" looks like
4. **Minimize depth** — prefer wide fan-out over deep sequential chains
5. **Include cleanup** — templates should end with a cleanup/reset step
6. **Set realistic estimates** — `estimated_minutes` helps task-coach schedule
7. **Use `on_complete`** — for agent instructions after completion (e.g., create reminder)
8. **Guard conditions** — when a trigger is probabilistic, use guards + `auto_expand: false`

### Template naming
- File name = template ID: `data/task-templates/{kebab-case-id}.json`
- Use descriptive names: `chicken-marination`, `{{PARENT_2}}-shower`, `nicu-visit-prep`
- The ID is what agents reference in `expand_template(template_id=...)`

### Trigger design
- **Prefer guards over auto-expand** for conditional triggers (avoid expanding wrong)
- **Set dedup windows** for schedule triggers (prevent spam)
- **Keep trigger conditions specific** — broad `title_contains` matches cause false positives

## Trigger Log (Deduplication)

The action-tracker maintains a `trigger_log` table:
- Records which task completion fired which template trigger
- Prevents the same completion event from triggering the same template twice
- Keyed on: `(completed_task_id, trigger_template_id, trigger_index)`

## Integration Points

- **task-coach**: Serves expanded template tasks in priority/dependency order
- **template-sync agent**: Validates template files, checks for orphaned instances
- **daily-briefing / heartbeat**: Can call `check_scheduled_triggers()` to fire due templates
- **Any domain agent**: Can expand templates when detecting relevant events

## Anti-Patterns

- ❌ Creating templates with cycles (will be rejected by validator)
- ❌ Auto-expanding templates without guards when the trigger is probabilistic
- ❌ Templates with 10+ tasks (break into sub-templates or simplify)
- ❌ Using templates for one-off tasks (just use `add_task` directly)
- ❌ Duplicating template logic in agent instructions (reference this skill instead)
- ❌ Caching template IDs in agent memory (templates are loaded dynamically from disk)
