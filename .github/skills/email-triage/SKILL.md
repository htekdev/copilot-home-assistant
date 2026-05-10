---
name: email-triage
description: Email scanning, categorization, and autonomous action pattern — read emails, categorize by type, take action (create tasks/events/bills), and send batched Telegram summary. Use when user says "scan emails", "email triage", "process inbox", "email check", "unread emails", "email actions", "handle emails", or any agent needs to read and act on emails.
---

# Email Triage Skill

Canonical workflow for scanning, categorizing, and autonomously acting on Gmail emails. Used by heartbeat, daily-briefing, and any agent that needs to process the inbox.

## Core Principle

**Do NOT just count unread emails. Actually read them and take action.** The pattern is: Scan → Read → Categorize → Act → Batch Notify.

## Step 1: Scan

```
gmail_search(query: "is:unread newer_than:3h", maxResults: 20)
```

Adjust the time window based on agent frequency:
- Heartbeat (every 90 min): `newer_than:3h`
- Daily briefing (once/day): `newer_than:24h`
- On-demand: `newer_than:7d` or specific query

## Step 2: Read & Categorize

For EACH email, call `gmail_read(messageId)` and classify:

| Category | Signal Words / Patterns | Priority |
|----------|------------------------|----------|
| **Bills / Payment Due** | "amount due", "payment", "statement", invoice, "$XX.XX by [date]" | HIGH |
| **Appointments / Scheduling** | "confirmed", "reminder", "appointment", "scheduled for" | HIGH |
| **Action Items** | "please review", "action required", "submit by", "deadline" | HIGH |
| **Urgent / Time-sensitive** | "URGENT", "expires today", "last chance", "final notice" | URGENT |
| **Shipping / Delivery** | "shipped", "delivered", "tracking", "out for delivery" | LOW (unless today) |
| **Receipts** | "receipt", "order confirmation", "thank you for your purchase" | AUTO |
| **Newsletters / Marketing** | "unsubscribe", promotional headers, bulk sender | SKIP |
| **FYI / Informational** | status updates, notifications, auto-generated | SKIP |
| **Formspree Leads** | from `noreply@formspree.io`, {{PERSONAL_DOMAIN}} contact form submissions | HIGH |

## Step 3: Act on Each Email

| Email Type | Autonomous Action |
|-----------|-------------------|
| **Bills / Payment Due** | `add_task(title: "Pay $X to [company]", due_date: "[due date]", category: "finance", priority: "high")`. Check if already on auto-pay first — if so, skip. |
| **Appointments** | `gcal_create_event(summary, start, end, location)`. Notify via Telegram with date/time/location. |
| **Action Items** | `add_task(title: "[specific action]", due_date, assignee, category)`. Assign to the right person. |
| **Urgent** | Send Telegram IMMEDIATELY with full context and specific action steps. Also create task. |
| **Shipping (today)** | Note in summary: "📦 [item] arriving today" |
| **Receipts** | Log expense if identifiable. Note as auto-handled. |
| **Newsletters/Marketing** | Tally count for summary. Don't process individually. |
| **FYI** | Skip silently UNLESS relevant to an existing task or watch item. |
| **Formspree Leads** | `add_task(title: "Review lead: [name]", category: "general", assignee: "{{PARENT_1}}", priority: "high", surface: "human", notes: "website form submission — Name: [name], Email: [email], Message: [msg], Source: [_source]")`. Check for 40+/month to warn about Formspree free tier (50/month limit). |

## Step 4: Batch Notification

Send ONE consolidated Telegram message with ALL results:

```
✅ AUTO-HANDLED: Processed X emails
• [count] newsletters/promos skipped
• [count] receipts logged

📋 CREATED:
• Task: "Pay $X to [company] by [date]"
• Event: "[appointment] on [date] at [location]"

🔴 ACTION REQUIRED:
• [specific urgent item with phone number/deadline/next step]
```

### Rules:
- If NOTHING actionable was found → stay completely silent. Don't send "0 emails" messages.
- Urgent items get their own immediate Telegram (don't wait for batch)
- Never send more than 2 Telegram messages for email processing

## Anti-Patterns

- ❌ "You have 5 unread emails" (counting without reading)
- ❌ "You might want to check your email" (vague, unhelpful)
- ❌ Processing newsletters individually (waste of context)
- ❌ Creating bill-payment tasks for auto-pay accounts
- ❌ Reporting stale email info from prior scans

## Integration Points

- **Finance Manager**: Bills and payment reminders should match existing bill tracking
- **Task System**: All action items become tasks via `add_task`
- **Calendar**: Appointments become events via `gcal_create_event`
- **Watch List**: Cross-reference emails against `list_tasks(category="watch")` items
- **Standing Orders**: Check `data/standing-orders.md` for auto-pay rules before creating payment tasks
- **Email Encoding**: If replying or sending emails as part of triage, follow the `email-encoding` skill — NEVER use emojis or Unicode in `gmail_send` subject lines (UTF-8 double-encoding garbles them). Body text is fine.

## Finance Auto-Pay Guard

Before creating a bill-payment task:
1. Check if the bill is known to be on auto-pay (from finance-manager's memory or standing orders)
2. If auto-pay → skip task creation, note as "auto-handled"
3. If unknown → create the task but note "verify auto-pay status" in notes

## Deduplication

Before creating any task from an email:
1. Check `list_tasks` for existing tasks matching the same bill/action/appointment
2. If a matching task already exists → skip (don't duplicate)
3. If the email provides NEW info about an existing task → `update_task` with the new details
