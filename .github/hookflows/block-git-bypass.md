---
name: Block git bypass attempts
description: Catches indirect git execution via PowerShell variable expansion, Invoke-Expression, etc.
event: bash
action: block
lifecycle: pre
conditions:
  - field: command
    operator: regex_match
    pattern: "(Invoke-Expression|iex\\s).*\\bgit\\s|\\$\\w+\\s*=\\s*[\"']git[\"']|&\\s+\\$\\w+.*(commit|push|add|checkout|merge|rebase|reset|stash|worktree|clone|branch|pull|fetch|tag|cherry)"
---

🚫 **BLOCKED:** Detected an attempt to run git indirectly via PowerShell tricks.

All git operations must use dev-workflow extension tools directly:
`dev_add`, `dev_commit`, `dev_push`, `dev_pull`, `dev_checkout`, `dev_status`, `dev_stash`, `dev_reset`, `dev_rebase`, `dev_merge_pr`, `start_dev_branch`

Do NOT construct git commands via variables, `Invoke-Expression`, or `iex`.
