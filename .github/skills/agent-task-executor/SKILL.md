---
name: agent-task-executor
description: Execute pending agent-surface tasks by dispatching dedicated agents for each task. Quality-first approach — each task gets a focused agent, batched 3-4 in parallel. Use when user says "execute agent tasks", "run agent queue", "process agent-surface tasks", "agent task execution", or during the agent-task-executor cron cycle.
---

# Agent-Task Executor Skill

Execute pending `surface: "agent"` tasks by dispatching **dedicated agents** for each one. Every task gets a focused, fresh agent — no bulk processing, no quality loss.

## Core Principles

1. **Quality over speed** — each task gets a dedicated agent with full focus and context
2. **Parallel batches of 3-4** — launch a batch, wait for completion, then next batch
3. **Ownership via `created_by`** — the agent that created the task is the agent type that executes it
4. **No bulk execution** — never try to run all pending tasks at once
5. **Skip what you can't handle** — if a task requires human input or has a future due date, leave it

## Execution Protocol

### Step 1: Query Pending Agent-Surface Tasks

```
list_tasks(surface="agent", status="pending")
```

### Step 2: Filter & Prioritize

From the pending tasks, build an execution queue by applying these filters:

**SKIP these tasks (do NOT execute):**
- `created_by: "user"` — these were created by a parent/user and need their timing/direction
- Tasks with `due_date` in the future (not yet actionable)
- Tasks that require human judgment (purchase decisions, medical, content approval)
- Tasks that reference tools/access you don't have (e.g., browser re-auth)

**PRIORITIZE by:**
1. `priority: "urgent"` first
2. `priority: "high"` second
3. Overdue tasks (past `due_date`) third
4. `priority: "medium"` fourth
5. `priority: "low"` last

### Step 3: Select a Batch

Pick the top **3-4 tasks** from the filtered/prioritized queue. This is one execution batch.

**Batch size rules:**
- Default: 3 tasks per batch
- If tasks are simple/quick (config fixes, memory trims): 4 per batch
- If tasks are complex (skill extraction, refactoring): 2-3 per batch
- Never exceed 4 per batch
- If fewer than 3 tasks are available, just run what's there

### Step 4: Dispatch Dedicated Agents

For each task in the batch, launch a **dedicated agent** via the `task` tool:

```
task(
  agent_type: "{resolved_agent_type}",
  name: "exec-{task_id_short}",
  description: "Execute agent task",
  prompt: "{constructed_prompt}"
)
```

**All agents in the batch are launched IN PARALLEL.** They run simultaneously.

#### Agent Type Resolution

Map `created_by` to the correct `task` tool `agent_type`:

| `created_by` | `agent_type` to use |
|--------------|---------------------|
| `platform-manager` | `platform-manager` |
| `context-auditor` | `context-auditor` |
| `skill-optimizer` | `skill-optimizer` |
| `content-scheduler` | `content-scheduler` |
| `content-manager` | `content-manager` |
| `content-analytics` | `content-analytics` |
| `content-creative` | `content-creative` |
| `coding-agent` | `coding-agent` |
| `health-coach` | `health-coach` |
| `nicu-care` | `nicu-care` |
| `finance-manager` | `finance-manager` |
| `home-manager` | `home-manager` |
| `teacher` | `teacher` |
| `realtor-team` | `realtor-team` |
| `wellness-coach` | `wellness-coach` |
| `parenting-coach` | `parenting-coach` |
| `checkin` | `general-purpose` |
| `heartbeat` | `general-purpose` |
| `legacy` | `general-purpose` |
| *(any other)* | `general-purpose` |

**If the `created_by` value matches a custom agent type in the `task` tool's agent list, use it directly.** Fall back to `general-purpose` only for unknown agent types.

#### Prompt Construction

Each dispatched agent receives a complete, self-contained prompt:

```
You have ONE task to execute. Focus entirely on this.

TASK: {task.title}
TASK ID: {task.id}
PRIORITY: {task.priority}
CATEGORY: {task.category}
NOTES: {task.notes}
ASSIGNEE: {task.assignee}

INSTRUCTIONS:
1. Load your memory tiers if you have them (data/agents/{agent-name}/core.md, working.md)
2. Execute this task completely — no stubs, no TODOs, no partial work
3. When finished, call complete_task(id="{task.id}") to mark it done
4. If you cannot complete the task (missing info, blocked, needs human input):
   - Call update_task(id="{task.id}", status="blocked", notes="Blocked because: {reason}")
   - Do NOT leave it in "pending" state

IMPORTANT:
- This task has surface="agent" — it was created FOR an agent to handle autonomously
- Do NOT send Telegram messages to the primary assignee about this unless the task explicitly requires notification
- Do NOT create new tasks unless the original task's scope genuinely requires subtasks
- Focus. Execute. Complete.
```

### Step 5: Wait for Completion

After launching all agents in the batch:

1. Use `read_agent(agent_id, wait=true, timeout=180)` for each agent
2. Collect results — note which succeeded and which failed/blocked
3. If an agent times out (180s), check status with `read_agent(agent_id, wait=false)`
   - If still running, let it continue — don't kill it
   - Move on to the next batch

### Step 6: Report Results

After the batch completes, compile a brief summary:

```
Agent-Task Execution Results:
✅ Completed: {count} — {list of task titles}
🚫 Blocked: {count} — {list with reasons}
⏳ Still running: {count}
📋 Remaining in queue: {remaining_count}
```

**Notification rules:**
- If ANY tasks were completed → send one batched summary to the primary assignee via Telegram
- If ALL tasks were blocked/failed → send a brief alert to the primary assignee
- If nothing was actionable (all skipped) → do NOT send a message

### Step 7: Next Batch (if applicable)

If more tasks remain in the queue AND the cron cycle has capacity:
- **Max 2 batches per cron cycle** (6-8 tasks total maximum)
- Wait for batch 1 to complete before starting batch 2
- If batch 1 had failures/blocks, still proceed with batch 2 (different tasks)

## Platform-Manager Direct Execution

Some tasks are faster to execute directly rather than dispatching an agent. The platform-manager (or whatever agent invokes this skill) MAY execute these task types directly:

| Task Type | Direct Execution OK? |
|-----------|---------------------|
| Fix stale file references | ✅ Yes — quick file edit |
| Update cron.json | ✅ Yes — config change |
| Trim/prune memory files | ✅ Yes — file edit |
| Fix JSON syntax | ✅ Yes — quick fix |
| Create calendar events | ✅ Yes — single tool call |
| Skill extraction | ❌ No — dedicated agent |
| Agent refactoring | ❌ No — dedicated agent |
| Multi-file changes | ❌ No — dedicated agent |
| Content review/scheduling | ❌ No — dedicated agent |

If platform-manager handles a task directly:
1. Execute the fix
2. Call `complete_task(id="{task_id}")`
3. Include it in the results summary

## Anti-Patterns (NEVER do these)

- ❌ Batch-executing 10+ tasks in a single agent prompt ("handle all these...")
- ❌ Executing user-created tasks without explicit go-ahead from the request owner
- ❌ Skipping `complete_task` after finishing — the task MUST be marked done
- ❌ Creating new agent-surface tasks as "execution notes" — just do the work
- ❌ Sending a Telegram for every individual task completion — batch the report
- ❌ Executing tasks with future due dates that aren't yet actionable
- ❌ Running more than 2 batches (8 tasks) per cron cycle — quality degrades with volume
- ❌ Leaving tasks in "pending" after attempting them — either "done" or "blocked"

## Cron Integration

This skill is invoked by the `agent-task-executor` cron job in `cron.json`:

```json
{
  "id": "agent-task-executor",
  "schedule": "0 7,9,11,13,15,17,19 * * *",
  "enabled": true,
  "agent": "platform-manager",
  "prompt": "Invoke the agent-task-executor skill. Execute pending agent-surface tasks following the skill protocol: query → filter → prioritize → batch (3-4) → dispatch dedicated agents → wait → report. Max 2 batches this cycle."
}
```

## Edge Cases

### Task references a deleted/renamed agent
If `created_by` maps to an agent that no longer exists (e.g., a decommissioned team agent), use `general-purpose` and include extra context in the prompt about what the task is trying to accomplish.

### Task is self-referential (created_by = "platform-manager" and executor IS platform-manager)
Execute directly if it's a simple fix. If complex, still dispatch a fresh `platform-manager` agent — clean context is always better than trying to do everything inline.

### Task has dependencies (depends_on other tasks)
Check `get_dependency_tree(task_id)`. If upstream dependencies are not done, skip the task this cycle. It will be picked up when dependencies clear.

### Task has been pending for 14+ days
Flag as potentially stale. If the task references a specific date/event that has passed, cancel it with a note. If it's evergreen work, keep it and let the dedicated agent decide.
