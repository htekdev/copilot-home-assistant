# Block manage_schedule Tool

## Rule

**DENY** any call to `manage_schedule` tool.

## Trigger

- `onPreToolUse` when `toolName === "manage_schedule"`

## Action

- `permissionDecision: "deny"`

## Reason

The `manage_schedule` tool creates in-session scheduled prompts that conflict with our cron-based architecture. Problems:
1. Scheduled prompts don't respect queue priority — they block real-time user input
2. They die with the session — unreliable for anything important
3. They duplicate what cron.json already handles reliably
4. No auto-stop mechanism — must be manually stopped or hacked via prompt text

All scheduling should go through `cron.json` which is persistent, governable, and properly dispatches fresh agents.

## Message to Agent

"BLOCKED: Do not use manage_schedule. Use cron.json for all scheduling needs. The manage_schedule tool creates unreliable in-session timers that conflict with our cron architecture. Add entries to cron.json instead (via dev_add + dev_commit + dev_push)."
