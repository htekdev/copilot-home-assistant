---
name: Block sleep/wait patterns in PowerShell
description: Blocks Start-Sleep, Thread::Sleep, and any polling loop with sleep. Agents must use event-driven tools instead of blocking waits.
event: bash
action: block
lifecycle: pre
conditions:
  - field: command
    operator: regex_match
    pattern: '(Start-Sleep|\bsleep\b|\[System\.Threading\.Thread\]::Sleep|Wait-Event)'
---

🚫 **BLOCKED:** Sleep/wait patterns are not allowed in PowerShell.

Sleep-based polling wastes compute, blocks the agent context, and masks the correct event-driven tool that should be used instead.

## What you're trying to do → What to do instead

| Blocked Pattern | Use Instead |
|----------------|-------------|
| `Start-Sleep` + CI check loop | `pr_monitor_watch` — polls CI in the background, delivers results via `session.send()` when complete |
| `Start-Sleep` + agent status loop | `read_agent` with `wait: true` — blocks cleanly until the agent finishes, no polling loop needed |
| `[System.Threading.Thread]::Sleep(...)` | Same as above — pick the event-driven tool for the thing you're waiting on |
| `sleep` (alias) | Same as above |
| `Wait-Event` (generic wait) | Replace with the specific event-driven tool (e.g., `read_agent`, `pr_monitor_watch`) |
| Polling loop with sleep + rate limit handling | Accept the rate-limit error and retry on the next agent cycle — do not spin in a loop |
| Polling loop with sleep + deployment wait | `pr_monitor_watch` tracks deployment checks on the PR — no loop needed |

## Why sleep patterns are always wrong here

- **Agents are not long-running processes.** Sleeping in a tool call blocks the entire agent turn with no useful work happening.
- **There is always a better tool.** Every polling pattern has an event-driven counterpart:
  - Waiting for CI → `pr_monitor_watch`
  - Waiting for a background agent → `read_agent(wait: true)`
  - Waiting for a deployment → `pr_monitor_watch`
  - Rate-limited API → retry on next cycle, not in a loop
- **General rule:** If you're about to write `Start-Sleep`, stop and ask: *"What event am I waiting for, and what tool delivers that event?"* Use that tool instead.
