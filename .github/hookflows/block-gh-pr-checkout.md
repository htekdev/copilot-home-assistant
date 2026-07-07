---
name: Block gh pr checkout
description: Blocks gh pr checkout in powershell. Use dev_pr_checkout tool instead which creates a proper worktree.
event: bash
action: block
lifecycle: pre
conditions:
  - field: command
    operator: regex_match
    pattern: "\\bgh\\s+pr\\s+checkout\\b"
---

🚫 **BLOCKED:** `gh pr checkout` is not allowed. It checks out a PR branch in your main repo clone, polluting the working tree.

Use the `dev_pr_checkout` tool instead:

| Blocked Command | Use Instead | Description |
|----------------|-------------|-------------|
| `gh pr checkout <number>` | `dev_pr_checkout` | Checks out PR in an isolated worktree |

**Why:** `dev_pr_checkout` creates a git worktree for the PR branch, keeping your main clone clean and enabling parallel work on multiple PRs.

**Usage:** `dev_pr_checkout` with `repo: "owner/repo"` and `pr_number: 123`
