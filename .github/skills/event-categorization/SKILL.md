---
name: event-categorization
description: Calendar event classification and OOF block generation — keyword-based category detection, sync rules (personal→work), and Outlook block formatting. Use when user says "categorize event", "OOF block", "sync event", "event category", "what type of event", "calendar classification", "work-life sync", or any calendar event needs a category label.
---

# Event Categorization Skill

Classify personal calendar events into standardized categories using keyword matching. Used by work-life-sync for OOF block subjects and family-coordinator for schedule reporting.

## Category Detection (Case-Insensitive Keyword Match)

| Category | Keywords |
|----------|----------|
| **Medical** | doctor, dentist, appointment, checkup, therapy, OB, pediatrician, NICU, hospital, clinic, specialist, orthodontist, optometrist, pharmacy, blood work, lab, scan, ultrasound |
| **Family** | birthday party, school event, recital, graduation, family, reunion, wedding, funeral, celebration, quinceañera, baptism |
| **Childcare** | pickup, dropoff, daycare, babysitter, soccer, swimming, gymnastics, lesson, practice, camp, school, {{CAREGIVER_NAME}}, tutoring |
| **Errands** | service, repair, inspection, install, delivery, mechanic, oil change, DMV, bank, notary, haircut, grooming |
| **Time Off** | vacation, PTO, off, trip, travel, holiday, leave, staycation, sick day |
| **Faith** | church, mass, service, bible, prayer, group |
| **Fitness** | gym, workout, run, yoga, CrossFit, training |
| **Default** | "Personal" (when no keywords match) |

## Match Algorithm

```
1. Normalize event title to lowercase
2. For each category (in order above), check if ANY keyword is a substring of the title
3. Return FIRST matching category
4. If no match → return "Personal"
```

**Priority rule:** If multiple categories could match, the first match in the table order wins. Medical > Family > Childcare > Errands > Time Off > Faith > Fitness.

## OOF Block Generation (for work-life-sync)

When syncing personal events to Outlook as Out of Office blocks:

### Include (sync to Outlook)
- Time-bound personal events on **weekdays** (Mon–Fri)
- Events during or overlapping **work hours** (7 AM – 6 PM CT)
- Multi-day events spanning weekdays → one OOF per weekday
- All-day events with Time Off keywords

### Exclude (do NOT sync)
- Weekend-only events
- All-day events WITHOUT time-off keywords (birthdays, reminders)
- Past events
- Events titled "Busy" or with no title
- Work meetings mirrored via ICS subscription

### OOF Block Format

```
Subject: "[Category] — [Event Title]"
ShowAs: "oof"  (Out of Office — ALWAYS)
Body: "Personal commitment (auto-synced from personal calendar)"
IsPrivate: true
```

**Examples:**
- "Medical — {{DOCTOR_NAME}} appointment"
- "Childcare — {{CHILD_1_NAME}} soccer practice"
- "Time Off — Family vacation"
- "Personal — [Original title]"

## Consuming Agents

| Agent | Uses |
|-------|------|
| `work-life-sync` | Full workflow: detect → categorize → generate OOF block → relay to msix-home |
| `family-coordinator` | Category labels for schedule reporting |
| `daily-briefing` | Category emojis in calendar section |

## Anti-Patterns

- ❌ Syncing work meetings BACK from Outlook to Google (one-way only: personal → work)
- ❌ Creating OOF blocks for weekend events
- ❌ Using "busy" instead of "oof" for showAs
- ❌ Exposing event details in the OOF body (privacy)
