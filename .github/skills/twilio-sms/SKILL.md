---
name: twilio-sms
description: >
  Twilio SMS messaging for external contacts — send text messages to service providers, clients,
  doctors, and non-family contacts. Use when user says "send SMS", "text message", "send text",
  "Twilio", "SMS to", "text {{EXTERNAL_CONTACT_NAME}}", "message provider", or any SMS/text messaging activity.
---

# Twilio SMS Skill

Rules and patterns for sending SMS messages via the `send_sms` tool. All agents that send SMS MUST follow these guidelines.

## When to Use SMS vs Telegram

| Channel | Use For | Examples |
|---------|---------|---------|
| **SMS** (`send_sms`) | External contacts who aren't on Telegram | {{EXTERNAL_CONTACT_NAME}} (CarPlay), service providers, doctors, schools, clients |
| **Telegram** (`telegram_send_message`) | Family members and internal platform | {{PARENT_1}}, {{PARENT_2}} |

**Rule:** Never SMS family members. Never Telegram external contacts. Pick the right channel.

## Phone Number Format

All phone numbers MUST be **E.164 format**: `+[country code][number]`

| Format | Valid? |
|--------|--------|
| `+15551234567` | ✅ US number |
| `+447911123456` | ✅ UK number |
| `5551234567` | ❌ Missing + and country code |
| `(555) 123-4567` | ❌ Wrong format |
| `555-123-4567` | ❌ Wrong format |

**US numbers:** Always `+1` followed by 10 digits. Example: `+18325551234`

## Message Length Limits

- **Max:** 1,600 characters per message
- **SMS segments:** Messages over 160 chars are split into segments (each segment costs separately)
- **Best practice:** Keep SMS under 160 characters when possible to stay within 1 segment
- **No markdown:** SMS is plain text only — no bold, italic, or formatting

## Usage Patterns

### Basic SMS
```
send_sms(
  to: "+18325551234",
  message: "Hi, this is {{PARENT_1}}. Confirming our appointment for tomorrow at 2 PM."
)
```

### Appointment Reminder
```
send_sms(
  to: "+18325559876",
  message: "Reminder: Your detail appointment is scheduled for Saturday at 10 AM. Reply to confirm."
)
```

### Service Provider Follow-up
```
send_sms(
  to: "+18325554321",
  message: "Hi, following up on the quote for HVAC filter replacement. Is the part in stock?"
)
```

## Rules

1. **No spam** — Only send messages with clear purpose. Never bulk-send or send marketing without consent.
2. **Respect quiet hours** — No SMS between 9 PM and 8 AM CT unless explicitly urgent.
3. **Identify yourself** — Always include {{PARENT_1}}'s name in first contact with someone new.
4. **One message** — Don't send multiple SMS in rapid succession. Consolidate into one message.
5. **No sensitive data** — Never send passwords, SSNs, account numbers, or medical details via SMS.
6. **Log sent messages** — After sending, note the recipient and purpose in context so the platform can track communication history.
7. **Confirm before sending** — For first-time recipients or messages over 300 chars, confirm with {{PARENT_1}} before sending.

## Error Handling

| Error | Likely Cause | Action |
|-------|-------------|--------|
| Invalid phone number | Wrong format | Convert to E.164 format |
| Twilio API error 21211 | Invalid "To" number | Verify the number is real |
| Twilio API error 21608 | Unverified number (trial) | Number must be verified in Twilio console |
| Twilio API error 21610 | Recipient opted out | Do not retry — they unsubscribed |
| Credentials not configured | Missing .env vars | Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER |

## Integration with Other Agents

- **CarPlay agent** → Can text {{EXTERNAL_CONTACT_NAME}} for appointment updates, scheduling changes
- **Home Manager** → Can text service providers for scheduling/quotes
- **Health Coach** → Can text doctors' offices for appointment confirmations
- **Project Manager** → Can text clients for quick updates

## Cost Awareness

- Each SMS segment costs ~$0.0079 (US domestic)
- MMS (with media) costs ~$0.0200
- International rates vary — check before sending international SMS
- Monitor usage at https://console.twilio.com
