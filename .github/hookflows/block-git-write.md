---
name: Block git write commands
description: Blocks raw git write commands in powershell. Use dev-workflow extension tools instead.
event: bash
action: block
lifecycle: pre
conditions:
  - field: command
    operator: regex_match
    pattern: "\\bgit\\s+(status|add|stage|commit|push|pull|fetch|checkout|switch|merge|rebase|reset|stash|worktree|clone|tag|cherry-pick|branch\\s+-[dDmM])"
---

🚫 **BLOCKED:** Raw git write commands are not allowed in powershell.

Use the dev-workflow extension tools instead:

| Blocked Command | Use Instead | Description |
|----------------|-------------|-------------|
| `git status` | `dev_status` | Check working tree status |
| `git add` / `git stage` | `dev_add` | Stage files for commit |
| `git commit` | `dev_commit` | Commit staged changes |
| `git push` | `dev_push` | Push branch to remote |
| `git pull` / `git fetch` | `dev_pull` | Pull latest changes |
| `git checkout` / `git switch` | `dev_checkout` | Switch or create branches |
| `git branch -d/-m` | `dev_checkout` | Manage branches |
| `git merge` | `dev_merge_pr` | Merge via {{EMPLOYER_PARENT}} PR |
| `git rebase` | `dev_rebase` | Rebase current branch |
| `git reset` | `dev_reset` | Reset staged changes |
| `git stash` | `dev_stash` | Stash working changes |
| `git worktree` / `git clone` | `start_dev_branch` | Create isolated worktree |

Read-only commands (`git log`, `git diff`, `git show`, `git blame`) are still allowed.
