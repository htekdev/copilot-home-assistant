---
name: Block git-wt commands
description: Blocks raw git-wt commands. Use dev-workflow extension tools instead.
event: bash
action: block
lifecycle: pre
conditions:
  - field: command
    operator: regex_match
    pattern: "\\bgit-wt\\b"
---

🚫 **BLOCKED:** Raw `git-wt` commands are not allowed.

Use `start_dev_branch` instead to create isolated worktrees for parallel development.
