---
name: safe-restart
description: Safe session restart workflow after creating a NEW custom agent so the new agent becomes available to the task tool. Use when user says "new agent created", "restart for new agent", "agent not available in task tool", "refresh task agent list", or needs a safe restart after adding `.{{EMPLOYER_PARENT}}/agents/*.agent.md`.
---

# Safe Restart Skill

Use this skill when a **new custom agent file** has been created at `.{{EMPLOYER_PARENT}}/agents/{name}.agent.md` and the current session must be restarted so the `task` tool can see the new agent in its `agent_type` enum.

## When To Use

Use this skill **only** after creating a **NEW** agent file:

- ✅ New file: `.{{EMPLOYER_PARENT}}/agents/{name}.agent.md`
- ✅ Need the new agent to appear in the `task` tool
- ❌ Not needed for editing an existing agent
- ❌ Not needed for normal agent content updates that do not add a brand-new agent type

## Why Restart Is Needed

The `task` tool's available `agent_type` values are effectively frozen for the current conversation. A newly created custom agent will not appear until the session restarts.

The `restart_session` tool relaunches Copilot CLI with `--resume`, so the conversation comes back with refreshed tool and agent metadata.

## Pre-Flight Checks — Required

**Never restart immediately after creating the file.** First make sure no background-agent work will be lost.

### Step 1 — Check active background agents
Call:

```text
list_agents()
```

Inspect the results for these states:
- `running`
- `idle`
- `completed`
- `failed`
- `cancelled`

Only `completed`, `failed`, or `cancelled` are safe to ignore.

### Step 2 — If any agents are RUNNING, wait
If any background agents are `running`, **do not restart**.

For each running agent, call:

```text
read_agent(agent_id="...", wait=true, timeout=180)
```

Repeat until every running agent reaches a terminal state.

**Rule:** Never restart while background agents are running. Their work would be lost.

### Step 3 — If any agents are IDLE, close them out first
If any background agents are `idle`, do **not** restart yet.

Preferred action:

```text
write_agent(agent_id="...", message="Please wrap up any remaining work, summarize final state briefly, and exit cleanly so this session can restart for a newly created agent.")
```

Then wait for completion:

```text
read_agent(agent_id="...", wait=true, timeout=180)
```

Important:
- There is **no reliable hard-stop tool for background agents** in this workflow
- Do not assume an idle agent is safe to abandon
- If an idle agent must remain alive, **postpone the restart**

### Step 4 — Confirm local work is saved
Before restarting, make sure current work is persisted.

Check:

```powershell
git --no-pager status --short
```

Safe states before restart:
- Working tree clean, or
- Changes intentionally saved/committed and ready to resume

**Rule:** Always save or commit work before restarting.

### Step 5 — Warn the user first
Before restarting mid-conversation, send a short warning in the chat explaining:
- a new agent was created
- restart is required for discovery
- active background agents have been cleared
- the session will resume automatically

**Rule:** Never restart mid-conversation without warning the user.

## Restart Procedure

Once all pre-flight checks pass:

1. Verify **no background agents are active**
2. Verify work is saved
3. Call:

```text
restart_session(reason="New agent created: {agent-name}")
```

Example:

```text
restart_session(reason="New agent created: finance-auditor")
```

Expected behavior:
- current Copilot session exits
- a fresh session launches
- `--resume` restores the conversation context
- the new custom agent becomes eligible to appear in the `task` tool

## Post-Restart Verification

After the resumed session comes back:

### Step 1 — Verify the new agent is available
Check that the newly created agent name now appears in the `task` tool's `agent_type` choices.

If it still does not appear:
- confirm the file exists at `.{{EMPLOYER_PARENT}}/agents/{name}.agent.md`
- confirm the frontmatter/agent definition is valid
- retry only after confirming there are still no active background agents

### Step 2 — Smoke-test delegation
Run a tiny delegation to confirm the agent works.

Pattern:

```text
task(
  agent_type="{new-agent-name}",
  name="{short-test-name}",
  description="Smoke test new agent",
  prompt="Reply with a one-sentence confirmation that this new agent is available and working."
)
```

Success criteria:
- the delegation starts successfully
- the agent responds normally
- no `agent_type` lookup error occurs

## Safety Rules

1. **NEVER restart while background agents are running**
2. **NEVER restart mid-conversation without warning the user first**
3. **ALWAYS save or commit work before restarting**
4. **ALWAYS clear idle agents intentionally before restarting**
5. **If restart is not safe, postpone it** — do not force it
6. **If restart fails, `--resume` is intended to return the session where it left off**

## Canonical Workflow

```text
1. Create new agent file at .{{EMPLOYER_PARENT}}/agents/{name}.agent.md
2. list_agents()
3. Wait for all running agents with read_agent(..., wait=true)
4. Close out idle agents with write_agent(...) and read_agent(..., wait=true)
5. Confirm git status / saved work
6. Warn the user a restart is about to happen
7. restart_session(reason="New agent created: {name}")
8. After resume, verify the new agent is visible in task
9. Run a tiny smoke-test delegation
```

## Anti-Patterns

- ❌ Restarting immediately after creating an agent file without checking `list_agents()`
- ❌ Restarting while a background coding, review, or research agent is still running
- ❌ Assuming editing an existing agent requires restart
- ❌ Restarting with unsaved work
- ❌ Skipping the post-restart smoke test

## Bottom Line

**New agent created?** Use this skill.

**Existing agent edited?** Do not restart unless something else specifically requires it.

The safe rule is:
**create new agent → clear background agents → save work → warn user → restart_session → verify new agent works**
