---
name: Auto-reload extensions on edit
description: >
  After any extension file is created or edited, remind the agent to call
  extensions_reload so changes take effect immediately. Extensions are loaded
  once at session start — without an explicit reload, edits are invisible
  until the next session.
event: file
action: warn
lifecycle: post
pattern: "\\.{{EMPLOYER_PARENT}}/extensions/.*\\.mjs$"
---

⚡ **Extension file modified — reload required (with agent-safety guard).**

You just edited an extension file. Changes will NOT take effect until you call `extensions_reload` — but reloading while background agents are mid-tool-call can leave them stuck.

**MANDATORY procedure:**

1. **Check for running agents FIRST** — call `list_agents()` and inspect statuses.
2. **If ANY agent shows status `running`** (not `idle`, `completed`, `failed`, or `cancelled`):
   - **DO NOT call `extensions_reload`.**
   - Extension changes are deferred. The reload will happen when all agents complete.
   - Add a follow-up reminder (task or note to self) to re-check `list_agents()` and reload once the queue is clear.
   - Surface to the user: "Extension changes detected but reload deferred — agents are running. Will reload when all agents complete."
3. **If NO agents are running** (all idle/completed/failed/cancelled, or empty list):
   - Call `extensions_reload` now to hot-reload all extensions from disk.
   - Verify the reload succeeded (check tool output).
   - If the extension runs a persistent service (e.g., video-bridge HTTP server), `extensions_reload` restarts the extension process — the server will restart automatically with the new code.

**Why this guard exists:** Reloading extensions tears down and rebuilds the tool registry. If a background agent is mid-`tool_call` against an extension-provided tool when the reload fires, that tool call can hang indefinitely and the agent gets stuck. Always wait for a quiet window.

**Why reload at all:** Extensions are loaded once at session startup. Without `extensions_reload`, your edits sit on disk doing nothing until the next `restart_session`.
