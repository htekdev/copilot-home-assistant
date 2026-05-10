---
name: finance-task-lifecycle
description: >
  Finance task lifecycle management — auto-pay bill cleanup, payment-logged cluster clearing,
  and bill reminder task creation/cancellation rules. Use when agent says "bill paid",
  "auto-pay", "payment logged", "clear reminders", "cancel bill task", "finance cleanup",
  "bill already paid", "duplicate payment task", or handles any bill-payment task lifecycle.
---

# Finance Task Lifecycle Skill

Canonical rules for creating, maintaining, and clearing bill-payment related tasks across the platform.

## Core Principle

**One payment event must clear ALL related reminder tasks.** Bill payment tasks exist only to ensure a payment happens. Once it has happened (by auto-pay, manual payment, or confirmed log), every related task must close immediately.

## Rule 1: Auto-Pay Cleanup (from {{PARENT_1}}, 2026-05-02)

When {{PARENT_1}} says a bill is on auto-pay:
1. **Cancel** all existing bill-payment reminder tasks for that account
2. **Do NOT create** future payment reminders for auto-pay bills
3. **Keep legitimate non-bill finance tasks** active:
   - SSI / benefits enrollment
   - Medical bill tracking (manual, not auto-pay)
   - Proof-of-income/residency gathering
   - Credit monitoring / score actions
   - Budget reviews and savings goals

**Task types to cancel when auto-pay confirmed:**
- "Pay [bill]" reminders
- "Due date" alerts
- Snowball/debt-payoff payment tasks
- Auto-pay confirmation tasks
- Any task whose ONLY purpose is reminding about a bill payment

## Rule 2: Payment Logged = Clear Cluster (from {{PARENT_1}}, 2026-05-05)

When a payment is confirmed (any of these signals):
- {{PARENT_1}} says "I paid [bill]"
- A matching transaction appears in the budget ledger (`get_transactions`)
- A payment confirmation email is detected

**Immediately:**
1. Mark ALL matching human-facing reminder tasks for that payment **done** or **cancelled**
2. Check for sibling/duplicate tasks on the same account — clear them all
3. Do NOT leave any related reminder task open

**Before serving a bill-payment task:**
1. Check `get_transactions` for same-day payment evidence on that account
2. Check task system for recently completed/cancelled sibling tasks on same account
3. If payment already logged → mark task done, serve next task instead

## Rule 3: Bill Reminder Creation Pattern

When creating a bill payment reminder:

```
add_task(
  title: "Pay [bill name] — $[amount] due [date]",
  category: "finance",
  priority: "high",
  assignee: "{{PARENT_1}}",
  due_date: "[3 days before due date]",
  notes: "Amount: $X. Account: [provider]. Due: [date]. Payment method: [manual/auto-pay].",
  created_by: "[agent-name]",
  surface: "human"
)
```

**Only create for MANUAL payment bills.** Auto-pay bills get no reminders.

## Rule 4: Social Media Reply Tasks — Not Finance

Social media comment/reply work is NOT a finance task and should never appear in finance queues. If discovered, cancel or move off the human queue immediately.

## Consuming Agents

| Agent | Usage |
|-------|-------|
| `finance-manager` | Creates bill reminders, detects payments, cleans up on auto-pay confirmation |
| `task-coach` | Validates before serving bill tasks, skips if payment already logged |
| `heartbeat` | Email scan may detect payment confirmations → triggers cluster clear |
| `health-coach` | Medical bill tracking (manual payments only) |

## Anti-Patterns

- ❌ Keeping bill reminders open after payment is confirmed
- ❌ Creating reminders for auto-pay bills
- ❌ Re-serving a bill task that was just completed/cancelled in same cycle
- ❌ Leaving duplicate sibling tasks for the same payment event
- ❌ Treating all finance tasks as bill tasks (SSI, benefits, credit monitoring are NOT bill tasks)
