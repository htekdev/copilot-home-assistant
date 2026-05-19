---
name: Block unsafe PowerShell content writes
description: Blocks large PowerShell here-string writes. Use create/edit or governed extension tools instead.
event: bash
action: block
lifecycle: pre
conditions:
  - field: command
    operator: regex_match
    pattern: "(\\b(Set-Content|Add-Content|Out-File)\\b[\\s\\S]{0,200}(@\"|@')[\\s\\S]{200,}(\"@|'@))|((@\"|@')[\\s\\S]{200,}(\"@|'@)[\\s\\S]{0,200}(\\b(Set-Content|Add-Content|Out-File)\\b|>>|>\\s*[A-Za-z0-9_\\\"']))"
---

🚫 **BLOCKED:** Large PowerShell here-string file writes are not allowed.

Use the safe content-write path instead:

| Goal | Use Instead |
|------|-------------|
| New file | `create` with the final content |
| Existing file | `view` + `edit` |
| Governed file/data | The dedicated extension tool |
| CLI helper file | `create`/`edit` the helper file, then run the CLI |

**Why?** Huge PowerShell heredocs are fragile, hard to review, and easy to break with quoting or interpolation mistakes.

See `.github/skills/safe-content-write/SKILL.md` for the full decision tree.
