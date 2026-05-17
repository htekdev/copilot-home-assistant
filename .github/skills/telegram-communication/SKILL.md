---
name: telegram-communication
description: Telegram messaging rules for the {{FAMILY_NAME}} family — TTS speak parameter, quiet hours, per-person formatting, and communication patterns. Use when user says "send telegram", "message {{PARENT_1}}", "message {{PARENT_2}}", "notify family", "telegram rules", or any Telegram communication activity.
---

# Telegram Communication Skill

Canonical rules for all Telegram messaging in the {{FAMILY_NAME}} family platform. Every agent that sends Telegram messages MUST follow these patterns.

## Family Chat IDs

| Person | Chat ID | TTS (speak param) | Message Style |
|--------|---------|-------------------|---------------|
| {{PARENT_1}} | `{{TELEGRAM_PARENT_1}}` | ✅ ALWAYS required | Concise, structured, actionable |
| {{PARENT_2}} | `{{TELEGRAM_PARENT_2}}` | ❌ NEVER use | Ultra-short (2-3 lines max), warm, one question at a time |

## SPEAK: TTS Parameter (MANDATORY for {{PARENT_1}})

**Every single message to {{PARENT_1}} MUST include the `speak` parameter.** No exceptions, regardless of agent or context.

```
telegram_send_message(
  chat_id: "{{TELEGRAM_PARENT_1}}",
  message: "🎯 Task: Clean Kitchen Counters\n🧹 Pick up trash, dishes in dishwasher\n⏱️ ~8 min",
  speak: "Next task. Clean the kitchen counters. Pick up trash and do the dishes."
)
```

**`speak` parameter rules:**
- 1-2 sentences maximum
- Natural speech — how you'd say it out loud
- NO emojis in speak text
- NO markdown in speak text
- Summarizes the key point of the message
- The extension auto-prepends `SPEAK: [text]` to the message for notification previews

**Anti-patterns:**
- ❌ Sending to {{PARENT_1}} without `speak` parameter
- ❌ Manually writing "SPEAK:" in the message body (the tool handles this)
- ❌ Using `speak` when messaging {{PARENT_2}}
- ❌ Long speak text (keep it conversational and brief)

## Messages to {{PARENT_1}} — Format Rules

**Structure:** Bullet points, emojis for visual scanning, short paragraphs. Never walls of text.

**Good patterns:**
```
🎯 Task: [title]
📋 [brief instruction]
⏱️ ~X min

📋 X pending | Y due today
```

```
✅ [completed task]
→ 🎯 Next: [next task title] (~X min)
📋 X pending | Y due today
```

```
🔴 URGENT: [what needs attention]
📝 [specific action to take]
📞 [phone number or link if applicable]
```

**Always include:**
- Specific action items (not vague "look into this")
- Time estimates where applicable
- Pending count footer for task-related messages

## Messages to {{PARENT_2}} — Format Rules (CRITICAL)

**{{PARENT_2}} is postpartum with C-section recovery and NICU twins.** Respect her energy.

**Rules:**
- **2-3 lines MAX per message** — shorter is better
- **ONE question per message** — never multiple asks
- **Space questions hours apart** — minimum 2 hours between messages
- **Don't nag** — if no response, wait. She may be resting, pumping, or at NICU.
- **Warm tone** — she's your friend, not a task queue
- **Never send a wall of text** — even if you have multiple things to communicate

**Good:**
```
Hey {{PARENT_2}}! Quick question — do you have the twins' insurance cards handy? 🍼
```

**Bad:**
```
Hi {{PARENT_2}}! I need several things: the insurance cards, your OB's name, the hospital address, your current medications, and any allergies. Also, when is your next appointment? Can you also confirm the due date?
```

## Quiet Hours (ALL AGENTS)

**10 PM – 6 AM CT: No non-urgent notifications.**

- Urgent = safety issue, medical emergency, payment failure about to cause harm
- Everything else waits until 6 AM
- Compute current time via PowerShell before sending:
  ```powershell
  [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), 'Central Standard Time').ToString('HH:mm')
  ```
- If between 22:00 and 06:00 → queue the message (create a task or save to working memory for next cycle)

## Message Priority Patterns

### Urgent (send immediately, any time)
- Child safety concern
- Medical emergency
- System failure affecting family operations
- Time-locked action expiring within minutes

### High (send during waking hours)
- Bill due today
- Appointment reminder (30 min before leave-by time)
- Task deadline approaching
- Significant system finding

### Normal (batch with other messages)
- Task completions and transitions
- Daily summaries and briefings
- Content pipeline updates
- Routine status reports

### Low (include in next scheduled briefing)
- Analytics updates
- Non-urgent maintenance reminders
- General information

## Relay Between Family Members

When one family member shares info the other should know:
1. Send to the other person immediately (during waking hours)
2. Keep the relay **brief and factual**
3. Attribute the source: "{{PARENT_1}} mentioned..." or "{{PARENT_2}} said..."
4. Don't editorialize — just pass the info

## Format Reference — Common Message Types

### Task Serve
```
🎯 [Task Title]
📋 [1-line instruction]
⏱️ ~X min
📋 X pending | Y due today
```

### Task Completion + Next
```
✅ [Done task] — nice! 🎉
→ 🎯 Next: [Next task] (~X min)
📋 X pending
```

### Alert / Urgent
```
🔴 [URGENT THING]
📝 [What to do RIGHT NOW]
📞 [Contact/link if applicable]
```

### Daily Briefing (condensed)
```
☀️ Good morning!

📅 Today: [X events]
• [Event 1] at [time]
• [Event 2] at [time]

✅ Tasks: X pending (Y high priority)
💰 Bills: [any due today/tomorrow]
🍽️ Dinner: [tonight's meal]
```

### Status Report
```
📊 [Report Title]
• [Finding 1]
• [Finding 2]
• [Finding 3]
[Action taken or recommendation]
```

## Anti-Patterns (ALL AGENTS)

- ❌ Sending to {{PARENT_1}} without `speak` parameter
- ❌ Sending walls of text to {{PARENT_2}}
- ❌ Multiple questions in one message to {{PARENT_2}}
- ❌ Messaging during quiet hours (10 PM - 6 AM) for non-urgent items
- ❌ Vague messages: "you might want to look into..." (BE SPECIFIC)
- ❌ Asking permission to do things you should just do: "Would you like me to...?"
- ❌ Sending messages about things already completed (stale info from memory)
- ❌ Redundant notifications for things already surfaced via task-coach
