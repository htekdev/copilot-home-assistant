---
name: Block "gh copilot" command references
description: Blocks edit/create calls that introduce "gh copilot" as a command invocation. The correct command is just "copilot" (standalone CLI).
event: edit,create
action: block
lifecycle: pre
conditions:
  - field: content
    operator: regex_match
    pattern: "(?i)(run|execute|install|start|launch|use|type|with|invoke|via|command)\\s+[`\"']?gh\\s+copilot|`gh\\s+copilot(?:\\s+[a-z-]+)?`|```[\\s\\S]*?gh\\s+copilot|gh\\s+copilot\\s+--"
exceptions:
  - field: content
    operator: regex_match
    pattern: "(?i)(previously|formerly|was|used to be|known as|renamed from|old command|legacy|historical|migrated from|instead of)\\s+.*gh\\s+copilot"
---

🚫 **BLOCKED:** Content contains `gh copilot` as a command invocation.

**The correct command is just `copilot`** (standalone CLI binary). The `gh copilot` extension form is deprecated/incorrect for this template.

| Incorrect | Correct |
|-----------|---------|
| `gh copilot` | `copilot` |
| `gh copilot suggest` | `copilot suggest` |
| `gh copilot --remote` | `copilot --remote` |
| `gh copilot explain` | `copilot explain` |

**Exceptions:** You may reference `gh copilot` when discussing it historically (e.g., "previously known as `gh copilot`", "migrated from the `gh copilot` extension").

Fix the content to use the standalone `copilot` command, then retry.
