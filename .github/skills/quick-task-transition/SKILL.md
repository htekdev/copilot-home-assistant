---
name: quick-task-transition
description: Inline task completion and serve-next pattern for the main session — handles "done/next" without launching full task-coach agent. Use when user says "done", "next", "finished", "move on", "completed", "what's next", "mark done", or any quick task transition that should be handled inline for speed.
---

# Quick Task Transition Skill

Handle task completions and next-task serving directly in the main session without spinning up a full task-coach agent. This skill prioritizes SPEED over process for interactive task transitions.

## When to Use (Inline — This Skill)

Use this pattern when:
- {{PARENT_1}} says "done", "next", "finished", "move on", "completed"
- A task is reported as complete and {{PARENT_1}} wants the next one
- Simple task-to-task transitions during interactive sessions
- Speed matters (inline = 0-5s vs task-coach = 60-90s)

## When NOT to Use (Launch task-coach Instead)

Launch a full task-coach agent for:
- Scheduled cron nudges (every 20 min) — needs proactive discovery
- Complex requests: "what do I have today?", "reprioritize my day", "show me everything"
- {{PARENT_2}} nudges (needs full coaching personality and anti-nag tracking)
- Calendar scanning and prep task generation
- First-of-day briefings with proactive intelligence

## The Procedure (STRICT ORDER)

### Step 1: Complete the Task (MUST be first)

```
complete_task(id: "{task-id}")
```

**CRITICAL:** `complete_task` MUST be called BEFORE any Telegram response. Acknowledging ≠ completing. If you skip this step, the task stays pending and task-coach will re-serve it — infuriating {{PARENT_1}}.

### Step 2: Get Next Task

```
list_tasks(status: "pending", surface: "human")
```

Pick the next task by priority order:
1. **Urgent** tasks first
2. **High** priority
3. **Due today** (regardless of stated priority)
4. **Medium** priority
5. If tied: shorter estimated_minutes first (quick-win momentum)

### Step 3: Send via Telegram (task-coach format)

```
telegram_send_message(
  chat_id: "{{TELEGRAM_PARENT_1}}",
  message: "✅ {completed task title}\n\n🎯 Next: {next task title} (~{estimated_minutes} min)\n{notes if helpful}\n\n📋 {pending_count} pending | {due_today_count} due today",
  speak: "Done. Your next task is {next task title}."
)
```

### Step 4: Done

No agent spin-up. No memory loading. No calendar scanning. Just complete → query → serve.

## Format Template

```
✅ {done task}

🎯 Next: {task title} (~X min)
{brief notes or context if available}

📋 X pending | Y due today
```

## Edge Cases

### No More Tasks
```
✅ {done task}

🎉 Queue clear! No pending tasks right now.
You're caught up. Nice work! 💪
```

### Task Has Dependencies (blocked items freed)
When `complete_task` unblocks downstream tasks, mention them:
```
✅ {done task}
🔓 Unblocked: {newly-unblocked task title}

🎯 Next: {next task by priority}
📋 X pending | Y due today
```

### User Didn't Specify Which Task
If {{PARENT_1}} says "done" without specifying which task:
1. Check if task-coach recently served a task (within last 30 min)
2. If yes → assume that's the one being completed
3. If no → ask: "Which task did you finish? I'll mark it done and serve the next one."

## Anti-Patterns

| ❌ Wrong | ✅ Right |
|----------|---------|
| Send Telegram "Nice! ✅" without calling complete_task | complete_task FIRST, then Telegram |
| Launch full task-coach for simple "done → next" | Handle inline with this skill |
| Re-serve a task that was already completed | Always verify complete_task succeeded |
| Send next task without pending count footer | ALWAYS include "📋 X pending" |
| Skip speak parameter for {{PARENT_1}} | ALWAYS use speak for {{PARENT_1}} messages |

## Why This Exists

**Context:** Task-coach takes 60-90 seconds to spin up (reads constitution, memory, queries calendars, runs proactive discovery). For a simple "I'm done, what's next?" — that delay is unacceptable. This skill gives the main session a fast path for interactive transitions while preserving full task-coach launches for complex scenarios.

**{{PARENT_1}}'s feedback (2026-04-18):** Speed > process for task transitions. The 60-90s wait between tasks was killing his momentum.
