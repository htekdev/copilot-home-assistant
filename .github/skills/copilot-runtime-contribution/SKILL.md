---
name: copilot-runtime-contribution
description: >
  End-to-end workflow for contributing fixes to the Copilot agent runtime ({{EMPLOYER_PARENT}}/copilot-agent-runtime):
  bug identification, fix implementation, PR creation, local patched build, installation, revert,
  and maintenance cron setup. Use when user says "copilot runtime", "patch copilot", "build copilot locally",
  "runtime contribution", "fix copilot bug", "copilot source", "build patched CLI", "runtime PR",
  "copilot-agent-runtime", or any Copilot CLI source-level contribution work.
---

# Copilot Agent Runtime Contribution Workflow

Complete procedure for identifying bugs, implementing fixes, building a patched local CLI, and maintaining PRs on `{{EMPLOYER_PARENT}}/copilot-agent-runtime`.

---

## 1. Repository Layout & Key Files

**Local clone:** `C:\Repos\{{EMPLOYER_PARENT}}\copilot-agent-runtime` (main checkout)
**Worktrees:** `C:\Repos\{{{{EMPLOYER_PARENT}}_USERNAME}}\copilot-agent-runtime\workdir\{branch-slug}\`

### Key source paths

| Area | Path | Purpose |
|------|------|---------|
| Session core | `src/core/session.ts` | Message queuing, agentic loop, `send()`, `processQueuedItems()` |
| Queue API | `src/core/sharedApi/sessionQueueApi.ts` | Queue inspection endpoints |
| Extensions | `src/core/extensions/` | Extension loader, tools |
| Schedule | `src/core/schedule/scheduleRegistry.ts` | Cron/interval prompt delivery |
| CLI entry | `src/cli/index.ts` → `src/cli/app.tsx` | CLI bootstrap and TUI |
| CCA v3 steering | `src/apps/ccav3/src/steering.ts` | Coding agent immediate steering |
| Remote commands | `src/core/remote/commandPoller.ts` | `write_agent` / mission control delivery |
| Background sessions | `src/cli/sessions/backgroundSessionManager.ts` | Sub-agent session management |
| Model client | `src/model/client.ts` | `IPreRequestProcessor`, completion pipeline |
| Tests | `test/sdk/session.test.ts`, `test/sdk/integration.test.ts` | Unit/integration for session |

### Important types & interfaces

- `SendOptions` — includes `mode?: "enqueue" | "immediate"`, `prompt`, `source`, `attachments`
- `IPreRequestProcessor` — hook called before each LLM request (defined in `src/model/client.ts`)
- `ImmediatePromptProcessor` — class in `session.ts` that injects immediate messages via `preRequest`
- `AgenticLoopOutcome` — return from `runAgenticLoop()` (`ok`, `rate_limited`)

---

## 2. Bug Identification Process

1. **Reproduce the symptom** — identify which extension/caller is affected and under what conditions
2. **Trace the code path** — use `grep` to find relevant patterns:
   ```
   grep -rn "immediate\|isProcessing\|mode.*enqueue" src/core/session.ts
   ```
3. **Read `send()` method** — entry point for all message delivery
4. **Read `processQueuedItems()`** — the main queue processing loop
5. **Check `ImmediatePromptProcessor.preRequest()`** — mid-turn injection logic
6. **Check existing tests** — `test/sdk/integration.test.ts` has immediate mode tests

### Key architecture insight

- `mode: "immediate"` + `isProcessing=true` → message goes to `ImmediatePromptProcessor` queue
- `ImmediatePromptProcessor.preRequest()` fires before each LLM call within the current turn
- If turn ends without consuming it, `processQueuedItems()` pops it to main `itemQueue`
- The `hasActiveBackgroundWork()` gate can block promoted messages (this was the bug fixed in PR #8524)

---

## 3. Creating the Fix

### Branch via worktree (use dev-workflow tools)

```
start_dev_branch repo="{{EMPLOYER_PARENT}}/copilot-agent-runtime" branch="fix/descriptive-name"
```

This creates: `C:\Repos\{{{{EMPLOYER_PARENT}}_USERNAME}}\copilot-agent-runtime\workdir\fix--descriptive-name\`

### Install dependencies

```powershell
cd C:\Repos\{{{{EMPLOYER_PARENT}}_USERNAME}}\copilot-agent-runtime\workdir\fix--descriptive-name
npm install
```

### Make the code change

Edit `src/core/session.ts` (or relevant file) using `edit` tool.

### Write tests

Add tests to `test/sdk/session.test.ts` or `test/sdk/integration.test.ts`.

**Test pattern for session queue behavior:**
```typescript
test("description", async () => {
    const session = createTestLocalSession();
    vi.spyOn(session as unknown as Record<string, (...args: unknown[]) => unknown>, "runAgenticLoop")
      .mockImplementation(async (...args: unknown[]) => {
        // Simulate conditions during agentic loop
        return { kind: "ok" as const };
      });
    // Mock taskRegistry for background work
    vi.spyOn(session.taskRegistry, "list").mockReturnValue([
        { id: "bg-1", type: "agent", status: "running", agentType: "explore" } as never,
    ]);
    await session.send({ prompt: "test", mode: "immediate" });
    // Assert behavior
});
```

### Verify syntax (TypeScript parse check — full tsc OOMs on this repo)

```powershell
node --max-old-space-size=256 -e "const ts=require('typescript');const src=require('fs').readFileSync('src/core/session.ts','utf8');const sf=ts.createSourceFile('session.ts',src,ts.ScriptTarget.Latest,true);console.log('Parse OK, '+sf.statements.length+' statements')"
```

### Commit

```
dev_commit add_all=true message="fix: descriptive commit message"
```

---

## 4. Opening the PR

### Push the branch

```
dev_push folder="C:\Repos\{{{{EMPLOYER_PARENT}}_USERNAME}}\copilot-agent-runtime\workdir\fix--descriptive-name"
```

### Create issue first

```powershell
$body = @"
## Bug Description
...
## Steps to Reproduce
...
## Expected Behavior
...
## Root Cause
...
"@
cd C:\Repos\{{EMPLOYER_PARENT}}\copilot-agent-runtime
$body | gh issue create --repo {{EMPLOYER_PARENT}}/copilot-agent-runtime --title 'Bug: description' --body-file -
```

### Create PR linking to issue

```powershell
gh pr create --repo {{EMPLOYER_PARENT}}/copilot-agent-runtime `
  --title "fix: descriptive title" `
  --head fix/branch-name --base main `
  --body "Fixes #ISSUE_NUMBER`n`n## Problem`n...`n## Fix`n..."
```

### Update PR to link issue (if created after)

```powershell
$body = @"
Fixes #ISSUE_NUMBER
...rest of PR body...
"@
$body | gh pr edit PR_NUMBER --repo {{EMPLOYER_PARENT}}/copilot-agent-runtime --body-file -
```

---

## 5. Building a Patched Local CLI

### Prerequisites
- Node.js (v20+)
- npm dependencies installed in the worktree
- Rust toolchain (for native addons — `icu_segmenter`)

### Build command

```powershell
cd C:\Repos\{{{{EMPLOYER_PARENT}}_USERNAME}}\copilot-agent-runtime\workdir\fix--descriptive-name
npm run build
```

**Takes ~3 minutes.** Produces `dist-cli/` with:
- `index.js` — main entry point (loader)
- `app.js` — CLI application (~25MB bundled)
- `npm-loader.js` — npm shim entry point
- `sdk/index.js` — bundled SDK
- `*.wasm` — tree-sitter parsers
- `prebuilds/` — native addons
- `ripgrep/` — bundled rg binary
- `copilot-sdk/` — SDK for extensions
- `package.json` — metadata

### Build outputs key paths

| File | Purpose |
|------|---------|
| `dist-cli/index.js` | Main entry (used by `bin.copilot-dev` in package.json) |
| `dist-cli/npm-loader.js` | Entry point used by the npm global shim |
| `dist-cli/app.js` | The actual CLI application code |
| `dist-cli/package.json` | Package metadata (name: `@{{EMPLOYER_PARENT}}/copilot`) |

---

## 6. Installing the Patched CLI Locally

### ⚠️ CRITICAL: Multiple Install Locations (WinGet vs npm)

On {{PARENT_1}}'s machine, `copilot` resolves to **three** possible locations (in PATH priority order):

| Priority | Source | Path | Type |
|----------|--------|------|------|
| 1st | VS Code Insiders bootstrapper | `%APPDATA%\Code - Insiders\User\globalStorage\{{EMPLOYER_PARENT}}.copilot-chat\copilotCli\copilot.ps1` | Shim that finds the "real" binary |
| 2nd | WinGet | `%LOCALAPPDATA%\{{EMPLOYER}}\WinGet\Packages\{{EMPLOYER_PARENT}}.Copilot_{{EMPLOYER}}.Winget.Source_8wekyb3d8bbwe\copilot.exe` | **117MB SEA binary** |
| 3rd | npm global | `%APPDATA%\npm\node_modules\@{{EMPLOYER_PARENT}}\copilot\` | Node.js package |

**The WinGet SEA binary is what actually runs.** The VS Code shim resolves to it. Swapping files in the npm directory has NO EFFECT because that path is never reached.

### How to verify which binary is active

```powershell
# Check all copilot locations:
Get-Command copilot -All | Format-Table Source

# Confirm running processes:
Get-Process -Name copilot | Select-Object Id, Path | Select-Object -First 3

# Check version + build metadata of active install:
copilot --version
```

### Option A — Run directly from worktree (RECOMMENDED for dev)

Skip the binary swap entirely. Run your patched build directly:

```powershell
cd C:\Repos\{{{{EMPLOYER_PARENT}}_USERNAME}}\copilot-agent-runtime\workdir\fix--descriptive-name
npm run build
node --enable-source-maps dist-cli/index.js
```

For watch mode (auto-rebuild on save):
```powershell
# Terminal 1:
npm run watch

# Terminal 2:
node --enable-source-maps dist-cli/index.js
# Restart manually after each rebuild (node --watch dist-cli/app.js also works)
```

### Option B — Replace WinGet binary (for full system testing)

```powershell
$pkg = "$env:LOCALAPPDATA\{{EMPLOYER}}\WinGet\Packages\{{EMPLOYER_PARENT}}.Copilot_{{EMPLOYER}}.Winget.Source_8wekyb3d8bbwe"

# Backup official SEA
Rename-Item "$pkg\copilot.exe" "copilot.exe.official"

# Build your own SEA:
cd C:\Repos\{{{{EMPLOYER_PARENT}}_USERNAME}}\copilot-agent-runtime\workdir\fix--descriptive-name
npm run build:sea
# Copy the resulting SEA binary to the WinGet location
Copy-Item "dist-sea\copilot.exe" "$pkg\copilot.exe"
```

### Option C — npm swap (ONLY works if WinGet is uninstalled)

This is the legacy approach — only use if WinGet copilot is removed:

```powershell
$npm = "$env:APPDATA\npm\node_modules\@{{EMPLOYER_PARENT}}"
$installed = "$npm\copilot"
$backup = "$npm\copilot-original-v1.0.10"  # use actual version
$built = "C:\Repos\{{{{EMPLOYER_PARENT}}_USERNAME}}\copilot-agent-runtime\workdir\fix--descriptive-name\dist-cli"

# Backup original
Rename-Item $installed $backup

# Install patched build
Copy-Item $built $installed -Recurse -Force
```

### Verifying YOUR build is active

After installing, check:
```powershell
copilot --version
# Then check the package.json buildMetadata in the active location
```

The `dist-cli/package.json` contains `buildMetadata.gitCommit` with YOUR branch's HEAD commit hash. Compare against `git rev-parse --short HEAD` in your worktree.

---

## 7. Reverting to Original

### If using Option A (direct run)
Just stop the node process. Your global `copilot` command is still the official binary.

### If using Option B (WinGet swap)
```powershell
$pkg = "$env:LOCALAPPDATA\{{EMPLOYER}}\WinGet\Packages\{{EMPLOYER_PARENT}}.Copilot_{{EMPLOYER}}.Winget.Source_8wekyb3d8bbwe"
Remove-Item "$pkg\copilot.exe"
Rename-Item "$pkg\copilot.exe.official" "copilot.exe"
```

Or run `winget upgrade {{EMPLOYER_PARENT}}.Copilot` to pull the latest official release.

### If using Option C (npm swap)
```powershell
$npm = "$env:APPDATA\npm\node_modules\@{{EMPLOYER_PARENT}}"
Remove-Item "$npm\copilot" -Recurse -Force
Rename-Item "$npm\copilot-original-v1.0.10" "$npm\copilot"
```

Or simply run `copilot update` (overwrites local with latest release).

---

## 8. PR Maintenance Cron

For active repos where main moves fast, add a cron job to `cron.json`:

```json
{
  "id": "pr-XXXX-rebase",
  "schedule": "57 1,7,13,19 * * *",
  "enabled": true,
  "agent": "coding-agent",
  "_slot": "temporary PR maintenance, self-removes on merge/close",
  "prompt": "PR #XXXX maintenance on {{EMPLOYER_PARENT}}/copilot-agent-runtime (branch: fix/branch-name). Worktree: C:\\Repos\\{{{{EMPLOYER_PARENT}}_USERNAME}}\\copilot-agent-runtime\\workdir\\fix--branch-name. Steps: (1) Check PR status via gh pr view XXXX --repo {{EMPLOYER_PARENT}}/copilot-agent-runtime --json state. If merged or closed, remove this cron entry from cron.json (id: pr-XXXX-rebase), commit via dev_add + dev_commit + dev_push, and stop. (2) If open, cd to the worktree and run git fetch origin main && git rebase origin/main. (3) If rebase succeeds with no conflicts, force-push via dev_push --force. (4) If conflicts exist, attempt resolution — if trivial, resolve and continue; if non-trivial, abort and notify {{PARENT_1}} ({{TELEGRAM_PARENT_1}}, speak param). (5) Check for review comments and address actionable feedback."
}
```

**Key behaviors:**
- Runs every 6 hours (repo is very active)
- Self-removes from `cron.json` when PR merges/closes
- Attempts trivial conflict resolution
- Notifies {{PARENT_1}} only for non-trivial conflicts or review feedback needing input
- Uses `dev_push --force` after successful rebase

---

## 9. Reference: PR #8524 (Immediate Mode Fix)

| Item | Value |
|------|-------|
| PR | [#8524](https://{{EMPLOYER_PARENT}}.com/{{EMPLOYER_PARENT}}/copilot-agent-runtime/pull/8524) |
| Issue | [#8525](https://{{EMPLOYER_PARENT}}.com/{{EMPLOYER_PARENT}}/copilot-agent-runtime/issues/8525) |
| Branch | `fix/honor-immediate-mode-during-processing` |
| Worktree | `C:\Repos\{{{{EMPLOYER_PARENT}}_USERNAME}}\copilot-agent-runtime\workdir\fix--honor-immediate-mode-during-processing` |
| Cron | `pr-8524-rebase` (every 6h, self-removing) |
| Backup | `$env:APPDATA\npm\node_modules\@{{EMPLOYER_PARENT}}\copilot-original-v1.0.10` |
| Fix | Added `continue` after promoting immediate messages to bypass `hasActiveBackgroundWork()` gate |

---

## 10. Tips & Gotchas

- **OOM on full typecheck**: `tsc --noEmit` will OOM on this repo (~14k+ TS files). Use the parse-only check above.
- **Tests take 5+ minutes**: The test suite is massive. Run filtered: `npx vitest run --testNamePattern "immediate"`
- **Native addons**: Build requires Rust for ICU segmenter. If Rust isn't installed, the build may fail on `napi build`.
- **node_modules in worktree**: Worktrees don't share `node_modules` — run `npm install` in each new worktree.
- **dist-cli structure must match**: The npm shim expects `npm-loader.js` at the root of the installed package. Don't restructure.
- **copilot update overwrites**: Running `copilot update` will overwrite your patched version with the latest official release.
- **git operations**: Use dev-workflow tools (`dev_push`, `dev_commit`, etc.) — never raw git in powershell.
