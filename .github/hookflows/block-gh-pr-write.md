---
name: Block gh pr write commands
description: Blocks raw gh pr create and gh pr merge in powershell. These bypass dev-guard governance — use dev-workflow extension tools instead.
event: bash
action: block
lifecycle: pre
conditions:
  - field: command
    operator: regex_match
    pattern: "\\bgh\\s+pr\\s+(create|merge)\\b"
---

🚫 **BLOCKED:** `gh pr create` and `gh pr merge` bypass dev-workflow governance. Use extension tools instead.

| Blocked Command | Use Instead | Description |
|----------------|-------------|-------------|
| `gh pr create ...` | `create_vercel_pr` | Creates PR with proper co-author trailers and Vercel preview |
| `gh pr merge <number>` | `dev_merge_pr` | Merges via governed workflow with audit trail |

**Why:** Raw `gh pr create/merge` skips co-author trailers, bypasses commit formatting, and can push to protected branches without review. Always use the dev-workflow extension tools.

**harness-tracker fallback:** If `create_vercel_pr` fails with a JSON parse error, retry once with a 5-second delay. Do NOT fall back to `gh pr create`. If retry fails, create a task for platform-manager and push the branch only (`dev_push`).
