---
name: repo-workflow
description: Repo change workflow for safe agent-driven development — fast main-branch edits for tiny changes, and the proper worktree-based isolation flow for larger work. Use when user says "make repo changes", "update repo", "proper workflow", "worktree workflow", "isolated changes", "spawn agent in repo", or wants a repo changed the right way.
---

# Repo Workflow Skill

This skill teaches agents how to make code changes in repos under `C:\Repos\{{GITHUB_USERNAME}}\` using two modes:

1. **Fast Mode** — direct edits on `main` for tiny, low-risk changes
2. **Proper Mode** — isolated worktree + spawned agent for real implementation work

**Default guidance:** Fast Mode is acceptable for tiny changes in `{{FAMILY_NAME}}-family`, but **Proper Mode is the preferred workflow** for anything substantial or any other repo.

## Decision Guide

### Use Fast Mode when ALL are true
- The change is in **this repo** (`{{FAMILY_NAME}}-family`)
- Single-file edit, config tweak, typo fix, or similarly small change
- Roughly **<50 lines changed**
- No new agents, extensions, architecture, or multi-file behavior changes

### Use Proper Mode when ANY are true
- Multi-file feature or refactor
- New agent, extension, workflow, or architecture change
- Work in **another repo** under `C:\Repos\{{GITHUB_USERNAME}}\`
- The task benefits from isolated context and branch/worktree safety
- You want planning and implementation to happen in a clean spawned session

---

## Mode 1 — Fast Mode (Current Default: Push to Main)

Use this only for tiny, low-risk edits.

### Workflow
1. Figure out what needs to be done
2. Make the change directly on `main`
3. Validate the change
4. Push directly to `main`

### Example flow
```powershell
Set-Location "C:\Repos\{{GITHUB_USERNAME}}\{{FAMILY_NAME}}-family"
git checkout main
git pull origin main
# make the edit
# run the repo's relevant validation
git add .
git commit -m "fix: small targeted update" --trailer "Co-authored-by: Copilot <{{EMAIL_ADDRESS}}.{{EMPLOYER_PARENT}}.com>"
git push origin main
```

### Fast Mode Notes
- This is fast, but it is **not the right default for larger changes**
- Avoid this mode for other repos unless {{PARENT_1}} explicitly wants speed over isolation
- Never use Fast Mode for broad or risky edits just because it is convenient

---

## Mode 2 — Proper Mode (The Right Way: Worktree-Based Isolation)

Use this for serious work.

### Step 1 — Ensure the repo is cloned locally
Verify the repo exists at:

```text
C:\Repos\{{GITHUB_USERNAME}}\{repo-name}
```

If missing, clone it.

```powershell
$repo = "{repo-name}"
$repoPath = "C:\Repos\{{GITHUB_USERNAME}}\$repo"
if (-not (Test-Path $repoPath)) {
  Set-Location "C:\Repos\{{GITHUB_USERNAME}}"
  git clone "https://{{EMPLOYER_PARENT}}.com/{{GITHUB_USERNAME}}/$repo.git"
}
```

### Step 2 — Ensure latest code from `main`
Always refresh `main` before branching or creating the worktree.

```powershell
Set-Location "C:\Repos\{{GITHUB_USERNAME}}\{repo-name}"
git checkout main
git pull origin main
```

### Step 3 — Create a worktree to isolate the work
Preferred options:

#### Option A — Native git worktree
```powershell
$branch = "feature/{short-name}"
$worktreePath = "C:\Repos\{{GITHUB_USERNAME}}\{repo-name}.worktrees\{short-name}"
git worktree add $worktreePath -b $branch main
```

#### Option B — `git-wt` helper
```powershell
git-wt switch --create <branch>
```

**Expected pattern:** worktrees typically live at:

```text
C:\Repos\{{GITHUB_USERNAME}}\{repo}.worktrees\{branch}
```

### Step 4 — Spawn an agent in the worktree folder
Launch a fresh headless Copilot CLI session in the worktree:

```text
spawn_agent(folder="C:\Repos\{{GITHUB_USERNAME}}\{repo}.worktrees\{branch}")
```

This creates a clean session dedicated to that isolated change.

### Step 5 — Wait for the agent to appear in the mesh
Poll `get_agents()` until the new session registers.

What to look for:
- A newly active session for the target repo
- Fresh heartbeat timestamp
- CWD/worktree path matching the new worktree folder when available

Do **not** send work immediately after spawning. Wait until the session is visible.

### Step 6 — Send a planning prompt
Once the new session is registered, send the planning message through the mesh:

```text
send_message(
  workspace="{repo-name}",
  content="Plan: Review the task, inspect the repo, and produce a concise implementation plan before making changes.",
  priority="normal"
)
```

The planning prompt should include:
- What problem needs solving
- Constraints or acceptance criteria
- Whether this is Tier 2 / Tier 3 work
- Expected validation steps

### Step 7 — Send an implementation prompt
After planning is confirmed, send the implementation message:

```text
send_message(
  workspace="{repo-name}",
  content="Implement the plan in the worktree, validate the change, and report back with what changed.",
  priority="normal"
)
```

Implementation prompts should tell the agent to:
- Execute the approved plan
- Keep changes scoped to the task
- Run relevant validation
- Summarize results clearly

---

## Recommended Proper-Mode Prompt Pattern

### Planning message template
```text
Plan: We need to [describe the task].
Repo: {repo-name}
Context: [important repo/domain context]
Constraints: [what must not break]
Validation: [tests/build/lint/manual checks]
Please inspect the repo and reply with a concrete plan before implementing.
```

### Implementation message template
```text
Implement the approved plan for {repo-name} in the current worktree.
Make the required changes, run the agreed validation, and report the final result.
```

---

## Tools Used

| Tool | Purpose |
|------|---------|
| PowerShell | Clone repo, update `main`, create worktree, run git commands |
| `spawn_agent` | Start a fresh headless Copilot CLI session in the worktree |
| `get_agents` | Poll the agent mesh until the spawned session appears |
| `send_message` | Send planning and implementation prompts to the spawned repo agent |

---

## Anti-Patterns

- ❌ Doing multi-file or risky work directly on `main`
- ❌ Using Fast Mode for other repos when isolated context is the better choice
- ❌ Skipping `git checkout main && git pull origin main` before creating the worktree
- ❌ Spawning the agent in the wrong folder instead of the worktree path
- ❌ Sending planning/implementation prompts before the new mesh session registers
- ❌ Skipping the planning message and jumping straight to implementation for non-trivial work
- ❌ Reusing a polluted session when the task would benefit from a fresh isolated agent
- ❌ Treating Fast Mode as "standard" just because it is current — Proper Mode is the correct workflow

## Bottom Line

- **Fast Mode** = tiny `{{FAMILY_NAME}}-family` edits, direct to `main`
- **Proper Mode** = the real workflow for serious repo work: update `main` → create worktree → `spawn_agent` → wait for `get_agents()` → `send_message` plan → `send_message` implement
