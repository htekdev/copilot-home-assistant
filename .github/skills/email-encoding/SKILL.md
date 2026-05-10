---
name: email-encoding
description: Email subject line encoding rules for gmail_send. Use when sending emails, composing subjects, or any gmail_send call.
---

# Email Encoding Skill

## Trigger Phrases
"send email", "gmail_send", "email subject", "compose email", "write email", "draft email"

## The Rule (CRITICAL — from {{PARENT_1}}, 2026-05-09)

**NEVER use emojis, arrows (→), or special Unicode characters in `gmail_send` subject lines.**

The Gmail API's subject line encoding double-encodes UTF-8, producing garbled text (mojibake). Email body text is unaffected.

## What Happens

| Location | Emojis/Unicode | Result |
|----------|---------------|--------|
| Subject line | 🔬 | Garbled: `Ã°ÂŸÂ"Â¬` |
| Subject line | → | Garbled: `Ã¢Â†Â'` |
| Email body | 🔬 → ✅ | Works fine |

## Examples

### ❌ BAD — Will Garble
```
gmail_send(subject="🔬 Weekly Research Update", ...)
gmail_send(subject="Budget → Reviewed ✅", ...)
gmail_send(subject="📋 Family Tasks for May 9", ...)
```

### ✅ GOOD — Plain ASCII Subjects
```
gmail_send(subject="Weekly Research Update", ...)
gmail_send(subject="Budget Reviewed", ...)
gmail_send(subject="Family Tasks for May 9", ...)
gmail_send(subject="[Action Required] NICU Follow-Up Appointment", ...)
```

## Scope

- **ALL agents** that call `gmail_send`
- Applies to: email-triage, daily-briefing, heartbeat, any agent composing emails
- Body text is NOT affected — use emojis freely in the email body

## Why

The `gmail_send` tool passes the subject through an encoding layer that double-encodes UTF-8 characters. Standard ASCII (letters, numbers, punctuation like `[]()-:!?`) works perfectly. Anything outside ASCII (emojis, arrows, accented characters, Unicode symbols) gets corrupted in transit.

## Quick Reference

- **Subject**: Plain ASCII only (a-z, A-Z, 0-9, basic punctuation)
- **Body**: Anything goes (emojis, Unicode, formatting all fine)
- **Use brackets/dashes** for emphasis instead of emojis: `[URGENT]`, `[Action Required]`, `---`
