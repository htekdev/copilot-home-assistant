---
name: engagement-cadence
description: Engagement-respecting message cadence — anti-nag protocol, response tracking, escalating back-off, fatigue detection, and per-recipient adaptation. Use when agent says "check engagement", "skip cycle", "unanswered messages", "cadence check", "should I message", "engagement fatigue", "back-off", "nudge frequency", "message spacing", or any periodic messaging decision.
---

# Engagement-Respecting Cadence Skill

Canonical protocol for any agent that sends periodic messages to family members. Prevents over-messaging, respects engagement signals, and adapts cadence based on response patterns.

**Complements** the `telegram-communication` skill (formatting, quiet hours, speak param). This skill governs **when and whether** to send — telegram-communication governs **how** to send.

---

## Core Principle

> Every unanswered message is a signal. Respect it. Back off progressively. Never guilt-trip. Welcome them back naturally when they re-engage.

---

## 1. Response Tracking (Required State)

Every agent using this skill MUST track in `working.md`:

```
## Engagement State — [Recipient Name]
- last_message_sent: [ISO timestamp]
- last_message_topic: [brief description]
- last_response_received: [ISO timestamp or "none"]
- consecutive_unanswered: [0-N]
- cycles_skipped: [0-N]  
- daily_message_count: [0-N]
- daily_message_date: [YYYY-MM-DD]
```

Reset `consecutive_unanswered` to 0 whenever the recipient responds. Reset `daily_message_count` when `daily_message_date` ≠ today.

---

## 2. Escalating Back-Off Rules

Before sending ANY periodic message, evaluate the engagement state:

| Consecutive Unanswered | Action |
|------------------------|--------|
| **0** (responded last time) | ✅ Send normally. Full topic range. |
| **1** | ⚠️ Send, but **softer/lighter** — shorter message, lower-stakes topic. No questions requiring effort. |
| **2** | 🚫 **Skip this cycle entirely.** Update memory: "skipped — respecting space." Exit. |
| **3+** | ⛔ **Skip TWO cycles.** Only return with something genuinely high-value (milestone, exciting news, time-sensitive item). |

### Skip Tracking

When skipping, increment `cycles_skipped` in working memory. When `cycles_skipped` reaches the required count (1 for 2-unanswered, 2 for 3+-unanswered), reset it to 0 and allow the next send — but ONLY with a high-value message.

### Re-Engagement After Silence

When the recipient responds after a gap:
- **Welcome naturally**: "there she is 💛" or "hey! good to hear from you" — match the agent's voice
- **NEVER**: "where have you been?", "I was worried", "did you see my message?"
- **NEVER** guilt-trip about not responding
- Reset `consecutive_unanswered` to 0 immediately

---

## 3. Daily Message Caps

Prevent notification fatigue with per-recipient daily limits:

| Recipient Type | Default Max/Day | Notes |
|---------------|-----------------|-------|
| Low-energy recipient (postpartum, recovering, busy parent) | **3 messages** | Includes all agents combined if possible |
| Standard recipient | **6 messages** | Across all message types |
| High-engagement recipient (actively chatting) | **No hard cap** | But still respect back-off rules between cycles |

Agents should check `daily_message_count` before sending. If at cap → skip and note in memory.

**Cross-agent awareness**: If multiple agents message the same recipient, each agent should check recent Telegram history (last few hours) before adding more messages. If 2+ other agent messages are visible and unanswered, treat as `consecutive_unanswered: 2` (skip cycle).

---

## 4. Time-of-Day Windows

Align message energy with recipient's likely state:

| Window | Time (CT) | Appropriate Tone |
|--------|-----------|-----------------|
| 🌅 Morning | 6–10 AM | Gentle, low-demand. Reminders OK. No heavy questions. |
| ☀️ Midday | 10 AM–2 PM | Full energy. Fun content, substantive topics, questions OK. |
| 🌤️ Afternoon | 2–5 PM | Moderate. Check-ins, light content, medication reminders. |
| 🌙 Evening | 5–9 PM | Winding down. Reflective, cozy. Short messages. No effort-requiring questions. |
| 🚫 Night | 9 PM–6 AM | **Do not send.** Platform quiet hours are 10 PM–6 AM, but engagement-focused agents should stop at 9 PM to avoid late-evening interruptions. |

> **Note**: The 9 PM cutoff is stricter than the platform-wide 10 PM quiet hours. Agents using this skill prioritize recipient rest over the wider window. Emergency/urgent messages still follow `emergency-protocol` and bypass all cadence rules.

---

## 5. Cycle Spacing

Minimum time between messages to the same recipient from the same agent:

| Agent Cadence Profile | Min Spacing | Example Agents |
|----------------------|-------------|----------------|
| High-frequency coach | 20 min | task-coach ({{PARENT_1}} nudges) |
| Moderate companion | 60 min | task-coach ({{PARENT_2}} nudges), luna |
| Low-frequency advisor | 4 hours | wellness-coach, health-coach, nicu-care |
| Batch reporter | 1x/day | daily-briefing, finance-manager |

If the agent's cron fires more frequently than its spacing profile, it should check `last_message_sent` and skip if too soon.

---

## 6. Engagement Fatigue Detection

Signs that messaging cadence needs to reduce:

| Signal | What It Means | Action |
|--------|--------------|--------|
| Responses getting shorter over time | Fatigue setting in | Reduce frequency by 50% next 24h |
| "ok" / "👍" / single-emoji responses | Acknowledging, not engaging | Count as "barely responded" — treat as 0.5 unanswered |
| Explicit "stop" / "not now" / "busy" | Direct signal | Skip next 3 cycles minimum. Note in memory. |
| No response to 3+ messages across agents | Systemic disengagement | ALL agents should back off for 6+ hours |
| Responding only to urgent items | Bandwidth-limited | Switch to urgent-only mode for this recipient |

---

## 7. Message Batching

When an agent has multiple things to communicate:

1. **Combine into ONE message** — never send 3 messages in a row
2. **Prioritize**: Lead with the most important/time-sensitive item
3. **Cut ruthlessly**: If you have 5 things, pick the top 2. Save the rest for next cycle.
4. **For {{PARENT_2}} specifically**: ONE topic per message, max 2-3 lines. If you have multiple topics, pick the single most important one.

---

## 8. Implementation Checklist

When adopting this skill, an agent should:

- [ ] Add engagement state tracking to `working.md` template
- [ ] Check engagement state BEFORE composing any message
- [ ] Implement skip logic with memory updates ("skipped — respecting space")
- [ ] Track daily message count per recipient
- [ ] Implement re-engagement welcome pattern
- [ ] Reference this skill in agent definition: `> **Skill reference:** Follow the \`engagement-cadence\` skill at \`.github/skills/engagement-cadence/SKILL.md\` for message frequency, back-off rules, and engagement fatigue detection.`

---

## 9. Emergency Override

All cadence rules are **suspended** for:
- Medical emergencies (red flag symptoms)
- Child safety concerns
- Time-critical actions (payment about to fail, appointment in 30 min)

Follow `emergency-protocol` skill for these cases. After the emergency, resume normal cadence tracking.

---

## 10. Decision Flowchart

```
Cron fires → Compute CT time
  → After 9 PM or before agent's start hour? → EXIT (save "skipped — outside hours")
  → Check engagement state for recipient
    → consecutive_unanswered >= 3 AND cycles_skipped < 2? → EXIT (increment cycles_skipped)
    → consecutive_unanswered == 2 AND cycles_skipped < 1? → EXIT (increment cycles_skipped)
    → daily_message_count >= cap? → EXIT (save "skipped — daily cap reached")
    → Last message sent < min_spacing ago? → EXIT (save "skipped — too soon")
    → All clear → Compose message
      → consecutive_unanswered == 1? → Use softer/lighter tone
      → consecutive_unanswered == 0? → Normal tone
      → Send message → Update engagement state
```
