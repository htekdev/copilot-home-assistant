---
name: escalation-protocol
description: Standardized error recovery and escalation patterns — failure handling, retry logic, human notification, and graceful degradation. Use when agent says "if fails", "escalate", "notify on error", "retry", "graceful degradation", "error handling", "fallback", or any failure recovery decision.
---

# Escalation Protocol Skill

Canonical failure handling and escalation patterns for all agents in the home assistant platform. Use this to ensure consistent, predictable behavior when things go wrong.

## Core Principle

**Continue what you can. Report what you can't. Never silently fail.**

## Escalation Tiers

### Tier 1 — Auto-Retry (No human involvement)

**When:** Transient failures — API timeouts, rate limits, network blips, token refresh.

**Pattern:**
1. Retry up to 3 times with exponential backoff (5s, 15s, 45s)
2. Log each retry attempt to `events.log`
3. If succeeds on retry, continue normally — no notification needed
4. If all retries fail → escalate to Tier 2

**Examples:**
- Late/Zernio API returns 429 or 5xx → retry
- Google Calendar API timeout → retry
- Git provider API rate limit → wait and retry
- Plaid sync temporary failure → retry

### Tier 2 — Continue + Notify (Human awareness, no action needed)

**When:** Non-blocking failures — one step fails but the overall workflow can continue.

**Pattern:**
1. Skip the failed step
2. Continue with remaining steps
3. Log the failure to `events.log`
4. Include the failure in the next Telegram summary (batch, don't spam)
5. Create a task only if human action is needed to resolve

**Examples:**
- Video upload to one platform fails, others succeed → continue, report failed platform
- One calendar (work/personal) is unreachable → report with data from the available calendar
- Blog post generation fails but video publishing succeeds → continue, note blog failure
- One agent in a check-in orchestration fails to respond → compile report from available agents

### Tier 3 — Stop + Alert (Requires human attention)

**When:** Blocking failures — the workflow cannot meaningfully continue.

**Pattern:**
1. Stop the current workflow
2. Log detailed error context to `events.log`
3. Create a task via `add_task` with:
   - `priority: "high"` or `"urgent"` depending on time sensitivity
   - `category:` appropriate domain category
   - `notes:` include error details, what was tried, what's needed
4. Send Telegram notification to the primary user using the configured default chat (use TTS if your platform supports it)
5. Do NOT retry indefinitely — 3 failures = Tier 3

**Examples:**
- OAuth token expired and refresh fails → task: "Reconnect [service] token"
- Critical data file is missing or corrupt → task: "Fix [file] — [agent] cannot operate"
- CI pipeline red for >24 hours → task: "Investigate CI failure in [repo]"
- Financial sync completely failing → alert + task

### Tier 4 — Emergency (Safety-critical)

**When:** Child safety, medical emergencies, security breaches.

**Pattern:**
1. **Immediately** notify the relevant caregivers via Telegram
2. Include all relevant data (allergies, medications, emergency contacts)
3. Create urgent task
4. Follow `emergency-protocol` and `child-safety-protocol` skills

## Notification Rules

### DO batch notifications
- Multiple Tier 2 failures in one run → single summary message
- Non-urgent issues → include in next briefing or nightly summary
- Pattern: "3 items need attention: [list]"

### DO NOT batch these
- Tier 3 blocking failures → alert immediately
- Tier 4 emergencies → alert immediately
- Time-sensitive issues (bill due today, appointment in 1 hour) → alert immediately

### Telegram format for escalations
```
⚠️ [Agent Name] — [Issue Summary]

What happened: [1-2 sentences]
What I tried: [retry count, fallback attempts]
What's needed: [specific human action]

Task created: ✅ [task title]
```

## Graceful Degradation

When full capability is unavailable, operate in degraded mode:

| Full Mode | Degraded Mode |
|-----------|---------------|
| Dual-calendar merge (Google + WorkIQ) | Report from available calendar only |
| Live bank balance | Use cached balance with staleness warning |
| Multi-platform publish | Publish to available platforms, skip failed |
| Multi-model review | Single-model review with note |
| Full briefing (8 sections) | Available sections only, note what's missing |

**Always label degraded output:** "⚠️ Partial data — [service] was unreachable."

## Persistent Failure Detection

If the same failure occurs 3+ times across separate runs:
1. It's a systemic issue, not transient
2. Escalate to `platform-manager` (create agent-surface task)
3. Stop retrying until the root cause is fixed
4. Log the pattern to long-term memory

## Anti-Patterns

- ❌ Silently swallowing errors and returning empty results
- ❌ Retrying indefinitely without escalation
- ❌ Sending individual Telegram messages for each minor failure
- ❌ Stopping the entire workflow for a non-blocking failure
- ❌ Guessing what failed without logging specifics
- ❌ Creating vague tasks like "Something went wrong"

## Consuming Agents

All agents should follow these patterns. Primary consumers:
- `content-editor` — video pipeline failures
- `content-manager` — API/platform failures
- `heartbeat` — multi-service check failures
- `work-life-sync` — calendar sync failures
- `repo-maintainer` — CI/PR failures
- `finance-manager` — Plaid/bank sync failures
- `checkin` — orchestration partial failures
