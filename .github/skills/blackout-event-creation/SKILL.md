---
name: blackout-event-creation
description: Creating and deploying events on Blackout Pickleball site — event data structure, brand-aligned images, homepage banner, and deployment workflow. Use when user says "add event", "create Blackout event", "new pickleball event", "event images", "homepage banner", "Blackout event workflow", or any Blackout Pickleball event creation activity.
---

# Blackout Pickleball Event Creation Skill

Complete workflow for creating and deploying events on the Blackout Pickleball site (brandblackout.com / {{GITHUB_USERNAME}}/blackout-pickleball repo).

## Core Principles

**Blackout Brand Identity:**
- **Visual style:** Real photography of diverse people, community-focused, authentic
- **Colors:** Black (#0a0a0a) as primary, white text, very minimal and clean
- **Typography:** Bold, clean, uppercase "BLACKOUT PICKLEBALL" wordmark
- **Aesthetic:** Premium athletic wear brand, diversity & inclusion focused
- **NOT:** Graphic design heavy, neon colors, cyberpunk, sci-fi, abstract patterns

**Event images:** Clean typography-focused designs on black background. NO AI-generated illustrations or complex graphics. Match the minimal athletic brand aesthetic seen on their apparel.

## Event Data Structure

Events live in `src/pages/events.astro` as an array of objects.

### Event Object Schema

```javascript
{
  id: 'event-slug-year',                    // Unique kebab-case ID
  title: 'Event Title',                      // Main event name
  subtitle: 'Tagline or Description 🎾',     // Optional subtitle with emoji
  date: 'Day, Month DD, YYYY',               // Human-readable date
  time: 'HH:MM AM/PM – HH:MM AM/PM',        // Time range or 'TBA'
  dateISO: 'YYYY-MM-DDTHH:MM:SS-05:00',     // ISO 8601 with timezone
  venue: 'Venue Name',                       // Venue name or 'TBA'
  address: '123 Street Name, City, ST ZIP',  // Full address or empty string
  city: 'City, ST',                          // City and state
  image: '/images/events/event-image.png',   // Path to event image or null
  price: '$XX.XX' or 'Free / RSVP',         // Ticket price
  ticketUrl: 'https://...',                  // Ticket purchase/RSVP URL
  ticketLabel: 'Get Tickets' or 'RSVP Now', // CTA button text
  description: 'Event description...',       // 2-3 sentence description
  highlights: [                              // Array of bullet points
    'Feature 1',
    'Feature 2',
    'Feature 3',
  ],
  refundPolicy: 'Policy text' or null,       // Refund policy
  duration: '3 hours' or 'TBA',              // Event duration
  format: 'In person',                       // Event format
  status: 'on-sale' or 'sold-out',          // Ticket availability
}
```

Array is automatically sorted by `dateISO` (earliest first).

## Event Image Generation

**Location:** `public/images/events/[event-name].png`

**Dimensions:** Landscape **1536x1024** (3:2 aspect ratio) - CRITICAL to prevent cropping

**Brand Guidelines:**
- Solid black background (#0a0a0a) - NO textures, NO patterns
- White and light gray text ONLY
- Clean, bold sans-serif typography (Urbanist/Inter aesthetic)
- NO graphic elements, NO illustrations, NO decorative patterns
- Typography-focused, minimal, professional athletic brand look

### Image Generation Prompt Template

```
Create a clean, minimal event graphic for Blackout Pickleball. LANDSCAPE 1536x1024.

BACKGROUND: Solid deep black (#0a0a0a) - NO textures, NO patterns. Clean and minimal.

TOP SECTION (centered):
- "BLACKOUT PICKLEBALL" in bold uppercase white sans-serif (Urbanist/Inter style)
- Thin white horizontal line below (subtle)

CENTER (large, bold, centered):
- "[EVENT NAME]" in very large bold uppercase white text
- Keep typography CLEAN and BOLD - no decorative elements

MIDDLE INFO (centered, clean spacing):
- "MONTH DD, YYYY" in white
- Small white dot separator
- "TIME RANGE" in white (if applicable)
- Small white dot separator
- "VENUE • CITY" in white

BOTTOM SECTION (centered):
- Simple bullets: "FEATURE 1 • FEATURE 2 • FEATURE 3" in light gray
- Tiny tagline if applicable in light gray

DESIGN RULES:
- MINIMAL and CLEAN - athletic brand aesthetic
- Black background, white/light gray text ONLY
- NO graphic elements, NO illustrations, NO colors
- Professional typography-focused design
- Looks like a premium athletic brand event announcement
- LANDSCAPE 1536x1024. Solid background.
```

### Generating and Saving Images

```javascript
// 1. Generate image
generate_image(
  output_filename: "event-name-2025",
  prompt: "[use template above with event-specific details]",
  size: "1536x1024"
)

// 2. Copy to blackout-pickleball repo
Copy-Item "C:\Repos\{{GITHUB_USERNAME}}\{{FAMILY_NAME}}-family\data\generated-images\event-name-2025.png" 
          "C:\Repos\{{GITHUB_USERNAME}}\blackout-pickleball\workdir\[branch]\public\images\events\event-name-2025.png"

// 3. Update events.astro
image: '/images/events/event-name-2025.png',
```

## Homepage Banner

The EventBanner component displays upcoming events at the top of the site.

**Location:** `src/layouts/BaseLayout.astro` (lines ~100-105)

**Component props:**
- `eventDate` — ISO date string (must match event's `dateISO`)
- `eventName` — Event title
- `eventCity` — City name
- `ticketUrl` — Ticket/RSVP URL

**Behavior:**
- Shows banner when event is within 30 days
- Displays countdown timer ("X days" or "Tomorrow")
- Auto-hides after event date passes

### Updating the Banner

```astro
<EventBanner
  eventDate="2025-06-19T20:00:00-05:00"
  eventName="Juneteenth Pickleball Celebration"
  eventCity="Chicago"
  ticketUrl="https://events.eventnoire.com/e/blackout-pickleball-presents-juneteenth-pickleball"
/>
```

**Rule:** Always point to the NEXT upcoming event (earliest date).

## Git Workflow

**IMPORTANT:** Blackout Pickleball uses Vercel preview workflow. NEVER push directly to main.

### Step-by-Step

1. **Create worktree branch:**
   ```
   start_dev_branch(
     branch_name: "feature/event-name",
     repo_path: "C:\Repos\{{GITHUB_USERNAME}}\blackout-pickleball"
   )
   ```

2. **Make changes** in `workdir/feature--event-name/`:
   - Add event to `src/pages/events.astro`
   - Generate/save images to `public/images/events/`
   - Update banner in `src/layouts/BaseLayout.astro`

3. **Stage, commit, push:**
   ```
   dev_add(folder: "[workdir]", paths: ["src/pages/events.astro", "public/images/events/...", "src/layouts/BaseLayout.astro"])
   dev_commit(folder: "[workdir]", message: "feat: add [Event] event + homepage banner")
   dev_push(folder: "[workdir]")
   ```

4. **Send {{PARENT_1}} preview URL** via Telegram ({{TELEGRAM_PARENT_1}}) with `speak` param

5. **Merge after approval:**
   ```
   dev_merge_pr(
     folder: "[workdir]",
     repo: "{{GITHUB_USERNAME}}/blackout-pickleball",
     pr_number: X,
     merge_method: "squash"
   )
   ```

6. **Confirm production:** Wait ~90s, notify {{PARENT_1}} site is live at https://blackout-pickleball.com

## Common Issues & Fixes

**Image Cropping:**
- **Cause:** Square images (1024x1024) with `object-cover` CSS
- **Fix:** Always use landscape 1536x1024

**Banner Not Showing:**
- **Cause:** Event >30 days away OR already passed OR user dismissed
- **Fix:** Verify `eventDate` is correct, check date is within 30 days

**Brand Misalignment:**
- **Cause:** Generated images too "graphic" with decorative elements
- **Fix:** Use prompt template strictly - black bg, white text ONLY

## Date Propagation — MANDATORY Rules

These rules exist because the same event had its date set wrong, then corrected wrong, then UTC-shifted in display, then mangled by encoding — four separate bugs from one root cause: no single source of truth.

### Single Source of Truth

**ALL event dates MUST live in ONE place: the event object in `src/pages/events.astro`.**

Every other reference — EventBanner props, flyer image content, social copy, email blasts — MUST derive from that single source. If an event date changes, update the event object and only the event object. All downstream consumers read from it or regenerate from it.

**NEVER hardcode an event date in `BaseLayout.astro` separately from the event object.** The `eventDate` prop passed to `<EventBanner>` must match the `dateISO` field of the event object exactly.

### Day-of-Week Verification (MANDATORY before every commit)

Before committing ANY event data change, verify the day-of-week matches what is displayed:

```powershell
(Get-Date '2026-06-19').DayOfWeek   # returns: Friday
```

Run this for **every date** you are working with. Do not assume. Do not rely on what a flyer image says. Compute it, then verify it matches:
- The `date` field in the event object (e.g., `"Friday, June 19, 2026"`)
- Any day-of-week text in flyer images
- Any day-of-week text in social copy

If the computed day-of-week does not match any of the above → STOP. Fix before committing.

### UTC Offset — NEVER use `new Date(isoString)` for Display

**Do NOT parse ISO date strings with `new Date()` for display purposes.** JavaScript's `new Date("2026-06-19T20:00:00-05:00")` in a browser will shift to UTC and can display the wrong day (e.g., June 20 instead of June 19 for a late evening CDT event).

**Correct approach:** Parse the date string directly:

```javascript
// ❌ WRONG — UTC shift can change the displayed date
const d = new Date(event.dateISO);
const displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// ✅ CORRECT — extract date parts directly from the ISO string
const [year, month, day] = event.dateISO.substring(0, 10).split('-').map(Number);
const displayDate = new Date(year, month - 1, day)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
// OR: just format it manually from the event.date string field
```

The EventBanner component in particular must use direct string parsing — it previously showed "Jun 20" instead of "Jun 19" due to this exact UTC offset bug.

### Stale Date Check — After ANY Date Change

After changing an event date (in any direction), run a full-codebase grep for the OLD date before committing:

```powershell
# From the blackout-pickleball repo root (or workdir branch):
git --no-pager grep -r "2026-06-19" -- src/
git --no-pager grep -r "Jun 19" -- src/
git --no-pager grep -r "June 19" -- src/
```

Verify these specific files are all in sync:
1. `src/pages/events.astro` — event object `date` and `dateISO` fields
2. `src/layouts/BaseLayout.astro` — `<EventBanner eventDate="...">` prop
3. `src/components/EventBanner.astro` — no hardcoded date, reads from prop
4. Any flyer images in `public/images/events/` — must show correct day AND date
5. Any social copy or email content referencing the event

### Flyer Image Day-of-Week

Flyer images are static — they cannot auto-update when a date changes. If an event date changes OR if a flyer shows the wrong day-of-week:

1. Verify correct day: `(Get-Date 'YYYY-MM-DD').DayOfWeek`
2. Regenerate the image using the prompt template with the correct day-of-week
3. Replace the old image file
4. Re-verify the new image shows the correct day before committing

A flyer saying "THURSDAY" for a Friday event is a hard blocker — do not merge.

### UTF-8 Encoding — PowerShell Write Safety

**NEVER use PowerShell `[System.IO.File]::WriteAllText()` or `Set-Content` / `Out-File` to write tracked source files in the blackout-pickleball repo.**

PowerShell's default encoding can corrupt multi-byte UTF-8 characters (emojis like 🎾 become `Γ£ª`, em-dashes become `ΓÇö`). This has caused production corruption that required a git revert.

**Correct approach:** Use the `edit` and `create` tools directly. If a PowerShell write is unavoidable:

```powershell
# ALWAYS specify UTF-8 explicitly:
[System.IO.File]::WriteAllText($path, $content, [System.Text.Encoding]::UTF8)
# NOT: Set-Content, Out-File, or WriteAllText without encoding
```

After any PowerShell write to a `.astro` file, verify encoding before staging:

```powershell
$bytes = [System.IO.File]::ReadAllBytes($path)
# Check that emoji/special chars round-trip correctly
```

## Quality Checklist

Before pushing:
- [ ] Event image is landscape 1536x1024
- [ ] Image follows Blackout brand (black bg, white text, minimal)
- [ ] Homepage banner points to NEXT upcoming event
- [ ] Using Vercel preview workflow (branch + PR, not direct to main)
- [ ] Day-of-week verified: `(Get-Date 'YYYY-MM-DD').DayOfWeek` run for every date
- [ ] Flyer images show correct day-of-week (matches computed value)
- [ ] EventBanner `eventDate` prop matches `dateISO` in event object exactly
- [ ] No `new Date(isoString)` used for display — date parts parsed directly
- [ ] Full-codebase grep for event date — no stale references

Before merging:
- [ ] {{PARENT_1}} approved preview
- [ ] Event images display without cropping
- [ ] Homepage banner displays correct date (not UTC-shifted)
- [ ] No UTF-8 encoding corruption in `.astro` files (check emojis/em-dashes)

## Related Skills

- `vercel-preview-workflow` — Branch + PR + preview workflow
- `client-site-lifecycle` — Shared development standards
- `image-generation` — AI image generation guidelines
