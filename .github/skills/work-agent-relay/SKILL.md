---
name: work-agent-relay
description: Cross-workspace communication with a work-agent repo via the agent mesh — calendar sync (personal→Outlook OOF blocks), work queries (pipeline, meetings), and cross-workspace task delegation. Use when user says "tell work agent", "sync to Outlook", "block Outlook", "ask work agent", "send to work", "work calendar", "OOF block", "mesh message", "cross-workspace", "relay to work", or any communication with the work-agent-repo workspace.
---

# Work Agent Relay Skill

Send messages to {{PARENT_1}}'s work assistant (`work-agent-repo` workspace) via the agent mesh. Use this skill whenever a task requires tools, context, or actions that only the work-agent-repo agent can perform.

## When to Use This Skill

| Scenario | Use Mesh? | Why |
|----------|-----------|-----|
| Sync personal event → Outlook OOF block | ✅ YES | Only work-agent-repo has Outlook write access |
| Query work pipeline / deals / milestones | ❌ NO | Use local tools if this workspace already has them |
| Ask about work meetings / emails | ✅ YES | Those tools often live in the work-agent-repo context |
| Create Outlook calendar events | ✅ YES | Only work-agent-repo has Outlook write |
| Read Power BI dashboards | ❌ NO | Power BI MCP tools are available locally |
| Cross-repo code tasks (e.g., update vidpipe AND family) | ✅ YES | Spans workspaces |

**Rule:** Use local tools first. Only delegate via mesh when the target workspace has tools or context you don't have.

## Discovery — Find the Work Agent

Before sending, verify the agent is online:

```
get_agents(status="active")
```

Look for `workspace: "work-agent-repo"` in the results. If the agent is not active (status = "stopped" or missing), the message will be queued but won't be processed until that session starts. Plan accordingly — don't block on a response from an offline agent.

## Sending Messages

### Basic Pattern

```
send_message(
  workspace: "work-agent-repo",
  content: "Create an Outlook OOF block on Wednesday May 7 from 2-4 PM CT. Title: 'Twins NICU visit'. Show as: Out of Office.",
  priority: "normal"
)
```

### Key Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `workspace` | ✅ | Target workspace name — use `"work-agent-repo"` for work agent |
| `content` | ✅ | The message/instruction. Be specific and self-contained. |
| `priority` | ❌ | `urgent`, `high`, `normal` (default), `low` |
| `recipient_session_id` | ❌ | Use workspace instead — session IDs change on restart |

### Message Content Rules

1. **Be self-contained.** The recipient has no context from your session. Include all relevant details (dates, times, titles, descriptions).
2. **Be specific about the action.** "Create an Outlook event" not "handle my calendar".
3. **Include timezone.** Always specify CT (Central Time) for the {{FAMILY_NAME}} family.
4. **State the expected outcome.** What should happen as a result of this message?

## Common Use Cases

### 1. Calendar Sync — Personal → Outlook OOF Blocks

When {{PARENT_1}} has a personal event that should block his work calendar:

```
send_message(
  workspace: "work-agent-repo",
  content: "Create Outlook calendar event:\n- Title: 'Personal - Doctor appointment'\n- Date: Wednesday May 7, 2026\n- Time: 2:00 PM - 3:30 PM CT\n- Show As: Out of Office\n- No attendees, no reminders\n- Body: 'Blocked from personal calendar'",
  priority: "normal"
)
```

**Rules for calendar sync:**
- Default `showAs` = **Out of Office** (not Busy) unless {{PARENT_1}} says otherwise
- Title format: `"Personal - [brief description]"` — keep it professional but vague
- Never include sensitive details (medical specifics, family issues) in Outlook event body
- Only sync events that actually conflict with work hours (9 AM - 6 PM CT weekdays)

### 2. Work Queries — Meetings & Email Context

When you need information from {{PARENT_1}}'s work environment:

```
send_message(
  workspace: "work-agent-repo",
  content: "What meetings does {{PARENT_1}} have tomorrow (Wednesday May 7)? I need to plan around them for personal scheduling.",
  priority: "low"
)
```

### 3. Cross-Workspace Task Delegation

When a task requires action in the work environment:

```
send_message(
  workspace: "work-agent-repo",
  content: "{{PARENT_1}} needs to submit his timesheet by EOD Friday. Create a reminder task in his work context for Friday 4 PM CT.",
  priority: "normal"
)
```

## Async Communication — Don't Block

**The mesh is asynchronous.** Messages are delivered via polling (every 10 seconds). Do NOT wait for a reply before continuing your work.

### Pattern: Fire and Continue

```python
# 1. Send the message
message_id = send_message(workspace="work-agent-repo", content="...", priority="normal")

# 2. Continue your work — don't wait

# 3. Later (if needed), check for a reply
get_message(message_id)  # Shows the message and any replies
```

### Pattern: Reply Threading

If the work agent sent YOU a message and you need to respond:

```
reply_to_message(
  message_id: "<id-from-incoming-message>",
  content: "Here's the personal calendar info you requested: ...",
  priority: "normal"
)
```

## Priority Levels

| Priority | When to Use | Example |
|----------|-------------|---------|
| `urgent` | Time-critical, needs immediate processing | "Cancel the 2 PM meeting — emergency" |
| `high` | Important but not emergency | "Block tomorrow morning for NICU visit" |
| `normal` | Standard requests | Calendar sync, info queries |
| `low` | Background/non-critical | "FYI — {{PARENT_1}}'s personal schedule next week" |

**Default to `normal`.** Only use `urgent` for genuine emergencies. The recipient processes urgent messages first.

## Error Handling

### Agent Offline

If `get_agents()` shows work-agent-repo as `"stopped"` or missing:
- The message will still be stored in the mesh database
- It will be delivered when the agent next starts (within 24 hours)
- After 24 hours, undelivered messages to stopped agents are purged
- For time-sensitive requests to an offline agent: notify {{PARENT_1}} via Telegram that the work agent needs to be started

### Rate Limiting

- Max 10 messages between any pair within 60 seconds
- Messages > 10KB are rejected
- If you hit the rate limit, batch your requests into fewer, more comprehensive messages

### No Response Received

- Mesh replies are not guaranteed — the other agent may handle the request without replying
- If you need confirmation, explicitly ask for it in your message: "Please reply with confirmation once the event is created."
- Don't send follow-up "did you get my message?" pings — check with `get_message(id)` instead

## Known Workspaces

| Workspace | Description | Capabilities |
|-----------|-------------|-------------|
| `work-agent-repo` | {{PARENT_1}}'s work assistant | Outlook calendar, work tasks, and work-specific tools |
| `family-assistant-repo` | Family home assistant (this workspace) | Tasks, meals, finances, calendar, health, content pipeline |
| `video-pipeline-repo` | Video pipeline processor | Video analysis, transcription, {{EMPLOYER_PARENT}} Actions |

> Run `get_agents()` for the current live state — workspaces auto-register when their CLI session starts.

## Anti-Patterns

- ❌ Sending mesh messages for things you can do locally
- ❌ Blocking/waiting for a mesh reply before continuing work
- ❌ Using `recipient_session_id` instead of `workspace` (session IDs are ephemeral)
- ❌ Sending sensitive family medical details to the work workspace
- ❌ Sending multiple small messages when one comprehensive message would suffice
- ❌ Assuming the work agent is always online — always check with `get_agents()` first
- ❌ Syncing ALL personal events to Outlook — only sync events during work hours that create conflicts
