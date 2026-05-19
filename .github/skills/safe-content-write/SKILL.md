---
name: safe-content-write
description: >
  Safe file-writing pattern for large generated content — use create/edit and governed extension tools
  instead of huge PowerShell here-strings, Set-Content, Add-Content, Out-File, or shell redirection.
  Use when: "write article", "write post", "write agent instructions", "multi-line content",
  "PowerShell heredoc", "Set-Content", "Out-File", "large markdown", or "generated file"
---

# Safe Content Write

## Core Rule

**Never write large tracked content through PowerShell here-strings/heredocs or shell redirection when `create`, `edit`, or a governed extension tool can do the write safely.**

PowerShell text writes are fragile: quoting breaks, interpolation surprises happen, escaping gets messy, and long commands are hard to review. The safe path is to build the content in memory, then write it with the file tools.

## Decision Tree

### 1. New file
Use `create` with the full final content.

**Examples:** new article, new skill, new agent file, new JSON fixture, new social post draft.

### 2. Existing file, targeted change
Use `view` first, then `edit` to replace the exact block that changed.

### 3. Existing file, large rewrite
Still avoid PowerShell text writes.
- Read the file with `view`
- Replace the relevant section with one or more `edit` calls
- If the file is governed, use the dedicated extension tool instead of `edit`

### 4. Helper input file for another CLI
If FFmpeg, Python, or another tool needs a temporary input file, write that helper file with `create`/`edit`, run the CLI, then remove the helper file if it should not persist.

## Preferred Patterns

- Compose content in memory, then do **one `create`** for a new file
- Read first, then do **precise `edit`** operations for updates
- Use **extension tools** for governed data or domain-owned files
- Keep shell commands focused on executing programs, not carrying giant blobs of text

## Forbidden Patterns

- `@" ... "@ | Set-Content ...`
- `@' ... '@ | Set-Content ...`
- `@" ... "@ | Out-File ...`
- Multi-hundred-line `powershell` commands whose main job is writing markdown, JSON, prompts, or instructions
- Shell redirection that overwrites tracked content when `create`/`edit` already solve the problem

## Quick Examples

### ✅ Good — new file
- `create(path=..., file_text=full_content)`

### ✅ Good — existing file
- `view(...)` → `edit(path=..., old_str=..., new_str=...)`

### ✅ Good — governed file
- Use the domain extension tool that owns the file

### ❌ Bad
```powershell
@"
# 300 lines of markdown...
"@ | Set-Content article.mdx
```

## Bottom Line

**Shells should run programs. File tools should write files.**

When content is long, tracked, or important, default to `create`/`edit`.
