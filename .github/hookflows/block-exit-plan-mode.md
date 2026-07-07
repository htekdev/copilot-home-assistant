# block-exit-plan-mode

**Event:** `onPreToolUse`  
**Action:** `deny`

## Purpose

Blocks `exit_plan_mode` calls during autopilot workflows. This tool is designed for interactive planning sessions where the user reviews and approves plans. In autopilot mode, calling this tool breaks the execution flow — agents get stuck waiting for approval that won't come.

## Trigger

Any attempt to call `exit_plan_mode`.

## Response

**Deny the call** and instruct the agent to execute directly:

```
BLOCKED: exit_plan_mode not allowed in autopilot mode.

Do NOT present plans for approval. Execute the work directly.

If you need to organize your approach:
- Use your session plan.md file internally to track your work
- But proceed with implementation immediately
- Report results when complete

The user wants EXECUTION, not planning approval.
```

## Why This Matters

- **Autopilot flow**: {{PARENT_1}} launches agents in autopilot expecting autonomous execution
- **exit_plan_mode breaks this**: Agents stop and wait for user approval, which never comes
- **Result**: Stuck agents, interrupted workflow, wasted time

## Context

Learned 2026-05-27 after multiple autopilot interruptions. The `positioning-strategy` agent (entrepreneur-coach) and other strategic/planning agents were calling `exit_plan_mode` with "autopilot recommended" — but that still requires user interaction to start execution.

In autopilot mode: **detect → execute → report**. Never **detect → plan → wait → execute**.

## Exceptions

None. If {{PARENT_1}} wants interactive planning approval, he won't use autopilot mode.
