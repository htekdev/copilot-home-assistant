---
name: leads-manager
description: >
  Lead management automation — per-lead folder creation, standardized templates,
  pipeline tracking, and data capture rules. Use when user says "got a lead",
  "new lead", "add lead", "review pipeline", "log call", "update lead",
  "lead pipeline", "lead status", "lead follow-up", "capture lead info",
  "onboard lead", "log communication", "lead research", "scope call notes",
  "lead pricing", "convert lead to project", or any lead/prospect management activity.
---

# Leads Manager Skill

This skill enables any agent to create, update, and query entrepreneurship leads using a standardized per-lead folder structure. It prevents data sprawl by enforcing one canonical location for every type of lead data.

## Critical Rules — Read These First

1. **One folder per lead.** Every lead lives at `data/projects/leads/{slug}/`. The slug is lowercase-hyphenated: brand name if available (e.g., `blackout-pickleball`), person name otherwise (e.g., `edward-yurcisin`).

2. **One file per data type.** Contact info → `contact.md`. Meeting notes → `meeting-notes.md`. Comms → `comms-log.md`. NEVER mix data types in one file.

3. **Agent memory is transient, lead files are persistent.** Agents may note "working on Lead X" in their working memory, but ALL substantive lead data lives in the lead folder. Never store lead data as the canonical source in agent working memory.

4. **Append-only for logs.** `timeline.md` and `comms-log.md` are append-only (newest entries first). Never rewrite history.

5. **Update-in-place for state.** `contact.md`, `opportunity.md`, `pricing.md`, `scope.md` reflect current truth — update them directly.

6. **Cross-reference, don't duplicate.** If research from another agent is relevant, write it in `research.md` — don't keep it in both the agent's memory AND the lead folder.

7. **Always update `_index.md`** when a lead's stage, value, or next action changes.

8. **Always update the `Last Updated` timestamp in `_index.md`** when making any changes to the pipeline.

9. **Premium pricing is the default** (per {{PARENT_1}}'s core.md). No friends-and-family discounts. Always price at the top of market with justification.

10. **Create follow-up tasks.** Every lead update should check if a follow-up task is needed via `add_task`. Leads without next actions go stale.

11. **Stage transitions must be logged.** Every stage change gets a timestamped entry in `timeline.md` with the trigger that caused it.

---

## Data Architecture

### Pipeline Overview — `data/projects/leads/_index.md`

The top-level view of all active leads. This is the starting point for any pipeline query.

### Per-Lead Folder Structure

Each lead folder contains a subset of these files (only create what's needed):

| File | Purpose | Required? |
|------|---------|-----------|
| `README.md` | Lead overview with quick links | ✅ Always |
| `contact.md` | Who is this person? | ✅ Always |
| `opportunity.md` | What's the deal? | ✅ Always |
| `timeline.md` | Activity log & stage tracking | ✅ Always |
| `comms-log.md` | Communication history | ✅ Always |
| `research.md` | Industry/company research | When available |
| `meeting-notes.md` | Discovery/scope call notes | After first call |
| `proposal.md` | Proposal tracking | When proposal drafted |
| `pricing.md` | Pricing strategy & research | When pricing discussed |
| `scope.md` | Scope definition & boundaries | When scoping begins |

### Templates — `data/projects/leads/_templates/`

Blank templates for each file type. Copy and populate when creating a new lead.

---

## Workflows

### 1. Creating a New Lead

When ANY agent receives information about a new potential client:

```
1. Determine the slug: brand name if available, person name otherwise
2. Create folder: data/projects/leads/{slug}/
3. Populate required files from templates:
   - README.md (with overview)
   - contact.md (with whatever info is available — mark unknowns as ❌ Missing)
   - opportunity.md (type, need, estimated value)
   - timeline.md (Initial Contact entry)
   - comms-log.md (first communication)
4. Add optional files if data is available:
   - research.md (if brand/company research was done)
   - scope.md (if scope was discussed)
   - pricing.md (if pricing was discussed)
5. Update _index.md with new pipeline row
6. If the lead came from {{PERSONAL_DOMAIN}} Formspree/email capture, send the follow-up email automatically from `{{EMAIL}}` (no approval needed), but route it by page intent:
   - services/consulting → qualification email
   - articles/blog → educational resources / newsletter-style
   - blueprint/product → offer-specific follow-up
7. Create follow-up task via add_task:
   - title: "Follow up with {name} — {context}"
   - category: "finance" (entrepreneurship revenue)
   - assignee: "hector"
   - due_date: appropriate follow-up date
8. If the automatic email was sent, log it in `comms-log.md` and set the lead's next action to wait for reply / follow up in 48 hours if silent
```

### 2. Updating a Lead

When new information arrives about an existing lead:

```
1. Identify which file the data belongs to:
   - Contact changes → contact.md
   - New communication → comms-log.md (prepend, newest first)
   - Stage change → timeline.md (prepend) + README.md + _index.md
   - Meeting happened → meeting-notes.md (create if first meeting)
   - Pricing discussed → pricing.md
   - Scope discussed → scope.md
   - Research found → research.md
2. Update ONLY the relevant file(s)
3. If stage changed: update timeline.md, README.md, and _index.md
4. If next action changed: update _index.md and create/update task
```

### 3. Stage Transitions

Valid stages (in order):
```
Initial Contact → Warm Lead → Active/Scoping → Proposal Sent → Negotiating → Closed Won → Closed Lost → On Hold
```

Every transition requires:
- Date
- Trigger (what caused the transition)
- Entry in `timeline.md` Stage History table

When a stage transition occurs:
```
1. Update timeline.md, README.md, and _index.md to reflect the new stage
2. Search for pending tasks related to that lead (match by lead name or slug in the task title)
3. Identify tasks that belong to prior stages and are now superseded by the transition
4. Cancel those superseded tasks with a note explaining the stage changed and the task is no longer current
5. If entering Proposal Sent, ALWAYS create a follow-up task via add_task:
   - title: "Follow up with {name} on proposal — 3 business days"
   - due_date: 3 business days from now
   - category: "finance"
   - priority: "high"
   - assignee: "hector"
   - notes: "Proposal was sent on {date}. Follow up if no response."
```

### 4. Lead-to-Project Promotion (Closed Won)

When a lead reaches "Closed Won":
```
1. Create the full project in data/projects/{project-name}/
2. Link the lead folder to the project (cross-reference in both READMEs)
3. Lead folder remains as historical record — never deleted
4. Update _index.md: move to Archive section
5. Project Manager agent takes over from this point
```

### 5. Logging a Communication

Any time {{PARENT_1}} sends, receives, or discusses communication with a lead:
```
1. Prepend entry to comms-log.md:
   ### YYYY-MM-DD HH:MM — {Channel}
   **Direction:** Inbound / Outbound
   **Summary:** {one-line summary}
   **Full Text:**
   > {quoted message}
   ---
2. If the communication changes the status/next-action, also update timeline.md and _index.md
```

### 6. Logging Meeting Notes

After a discovery call, scope call, or any meeting:
```
1. Create or append to meeting-notes.md
2. Include: date, topic, attendees, duration, channel
3. Capture: raw notes, key decisions, action items, quotes/signals
4. Update timeline.md with meeting entry
5. Create tasks for each action item via add_task
```

### 7. Task Creation Rules

Task creation must respect the lead's current pipeline stage.

- **Initial Contact** → only create tasks for: reply, research, schedule intro call
- **Warm Lead** → only create tasks for: schedule discovery call, send intro materials
- **Active/Scoping** → only create tasks for: scope call prep, scope documentation, pricing research
- **Proposal Sent** → only create tasks for: follow-up on proposal, negotiate
- **Negotiating** → only create tasks for: contract review, close terms

Additional rules:
- **NEVER create tasks for actions 2+ stages ahead of the current stage.**
- **If unsure, check the lead's current stage in `_index.md` before creating any task.**
- When a stage changes, cancel pending tasks from prior stages that are now superseded.

---

## Agent Integration

### Which agents use this skill?

| Agent | When | What they do |
|-------|------|-------------|
| `project-manager` | Lead reaches Closed Won | Creates project, links to lead folder |
| `entrepreneur-coach` | Pipeline review, strategy | Reads `_index.md` and `opportunity.md` for coaching |
| `entrepreneur-driver` | Outreach, follow-ups | Reads `comms-log.md`, appends new outreach |
| Any agent receiving lead info | New info from Telegram/email | Routes data to correct template file |

### Trigger Phrases

These phrases should invoke this skill:
- "new lead", "add lead", "got a lead"
- "update lead", "lead status", "lead pipeline"
- "capture lead info", "log communication", "log call"
- "lead research", "scope call notes", "meeting notes for {lead}"
- "lead follow-up", "follow up with {name}"
- "lead pricing", "pricing for {lead}"
- "convert lead to project", "close lead", "lead won"
- "review pipeline", "how are my leads"

---

## Data Capture Standardization Rules

These rules prevent data sprawl — the core problem this skill solves.

1. **One canonical location per data type.** Contact info → `contact.md`. Meeting notes → `meeting-notes.md`. No exceptions.

2. **Agent memory is transient, lead files are persistent.** Agents may note "working on Lead X" in their working memory, but ALL substantive lead data lives in the lead folder.

3. **Append-only for logs.** `timeline.md` and `comms-log.md` are append-only (newest first). Never rewrite history.

4. **Update-in-place for state.** `contact.md`, `opportunity.md`, `pricing.md` are update-in-place — they reflect current truth.

5. **Cross-reference, don't duplicate.** If research from entrepreneur-coach is relevant to a lead, link to it or write it in `research.md` — don't duplicate it in the coach's memory AND the lead folder.

6. **Skill-first invocation.** When any agent needs to create, update, or query lead data, it should follow this skill's workflows.

---

## Examples

### Example: New Lead from Voice Note

{{PARENT_1}} sends: "Hey just got a message from Mike Chen on LinkedIn, VP of Engineering at TechFlow, wants Copilot for his team of 50 devs."

**Action:**
1. Create `data/projects/leads/mike-chen-techflow/`
2. Populate `contact.md`: Mike Chen, VP Engineering, TechFlow, LinkedIn, Warm Lead
3. Populate `opportunity.md`: Consulting, Copilot rollout for 50-dev team, est. $15K-$30K
4. Populate `timeline.md`: Initial Contact via LinkedIn
5. Populate `comms-log.md`: Inbound message summary
6. Update `_index.md` with new row
7. Create task: "Reply to Mike Chen on LinkedIn — Copilot consulting inquiry"

### Example: Logging a Scope Call

{{PARENT_1}} finishes a call and sends notes via Telegram.

**Action:**
1. Append to `meeting-notes.md` in the lead folder
2. Update `timeline.md`: stage transition to Active/Scoping
3. Update `scope.md` with what was discussed
4. Create tasks for each action item mentioned
5. Update `_index.md` and `README.md`
