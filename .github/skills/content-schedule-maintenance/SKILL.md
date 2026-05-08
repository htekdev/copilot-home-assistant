---
name: content-schedule-maintenance
description: >
  Content queue scheduling maintenance — the 5 ordering rules, near-term scan, deep queue scan,
  bundle cascade timing, collision detection, and bring-forward optimization for multi-platform social media queues.
  Use when user says "schedule maintenance", "check queue ordering", "fix collisions", "content cascade",
  "bring forward posts", "queue optimization", "weekly lineup", "reorder queue", "scheduling rules",
  or any content scheduling maintenance activity.
---

# Content Schedule Maintenance Skill

Canonical scheduling rules and maintenance workflow for a multi-platform content queue. This skill is the source of truth for ordering logic, collision detection, and queue optimization.

## The 5 Ordering Rules (Priority Order)

### Rule 1 — No Collisions (CRITICAL — fix first)
Two posts at the exact same datetime on the same platform = collision. One will fail to publish.
- **Detection:** Group posts by platform + datetime. Any group with 2+ posts = collision.
- **Fix:** Move one post to the next available slot (same platform, same day, 2+ hours later).

### Rule 2 — Platform Cascade (HIGHEST scheduling priority)
Long-form MUST publish BEFORE short-form teasers for the same topic.
```
YouTube long-form → YouTube Medium → LinkedIn long → TikTok short → Instagram Reel → X tweet → YouTube Short
```
- **Why:** Short-form clips tease the long-form. Publishing teasers first spoils content and loses the promotional funnel.
- **Detection:** For each topic cluster, check if any short-form posts are scheduled before the long-form.
- **Fix:** Swap so long-form goes first.

### Rule 3 — Topic Clustering (HIGH priority)
Posts from the same topic should schedule within a **24-48h window** of each other.
- **Why:** Content has a freshness window. Cross-platform flywheel works best when clustered.
- **Detection:** Group posts by topic. If any post is >48h from its siblings, flag it.
- **Fix:** Move outliers closer to the cluster center.

### Rule 4 — Platform Spacing (MEDIUM priority)
Minimum **2-hour gap** between posts on the same platform.
- **Why:** Posting twice within an hour cannibalizes your own reach.
- **Detection:** Sort posts by platform + time. Flag consecutive posts <2h apart.
- **Fix:** Push the later post forward to maintain 2h+ spacing.

### Rule 5 — Topic Diversity (LOW priority)
Don't put 5+ posts about the same topic in a row across platforms.
- **Why:** Multi-platform followers get spammed.
- **Detection:** Check chronological sequence. 5+ consecutive same-topic = violation.
- **Fix:** Interleave with other content.

## "Same Topic" Matching

Posts are considered "same topic" if ANY match:
- Same **tags** (e.g., `mythos`, `copilot-remote`)
- Same key phrases in title/content (fuzzy: 2+ shared significant words)
- Same **GitHub Issue** origin (tag like `idea-207`)
- Same **media** (same video URL across platforms)

## Bundle Scheduling (Video Production Bundles)

When content-editor produces a multi-platform release:

### Cascade Timing (within a bundle)
1. YouTube (long-form anchor) publishes FIRST
2. LinkedIn (thought leadership) within 1-2 hours after
3. Twitter/X (teaser) within 2-4 hours after YouTube
4. TikTok + Instagram (short-form) within 4-8 hours after YouTube

### Bundle Rules
- Same-day preference — all bundle posts on the same day when possible
- No self-collision — bundle posts never share a timeslot on the same platform
- Topic clustering — if other posts on the same topic exist, cluster nearby (not same day)
- Blog companion — when blog goes live, add URL in comments/replies (future enhancement)

### Bundle Metadata
```json
{
  "bundle_id": "video-YYYY-MM-DD-NNN",
  "topic": "primary angle",
  "post_ids": ["id1", "id2", "id3", "id4", "id5"],
  "platforms": ["youtube", "linkedin", "twitter", "tiktok", "instagram"],
  "cascade_order": ["youtube", "linkedin", "twitter", "tiktok", "instagram"],
  "created_at": "ISO timestamp"
}
```

## Near-Term Maintenance Pass (Every Cycle)

Scans the next 7 days. Fast and lightweight.

### Steps
1. Compute current time (PowerShell — mandatory)
2. Fetch near-term posts via `late_list_posts` with pagination (page 50 = nearest)
3. Build working list: `[{post_id, platform, scheduled_for, title/content_preview, queue_id, content_type}]`
4. Classify content type (long-form / medium / short-form) by queue ID
5. Evaluate all 5 rules against the working list
6. Identify top fixes (max 6 per cycle) — prioritize by rule priority
7. Execute fixes via `late_reschedule_post`
8. Log results

### Scope Limits
- Max 6 swaps per near-term pass
- Never touch posts scheduled within 30 minutes of now
- If no violations: log "✅ Near-term clean — no changes needed."

## Deep Queue Scan (Every 3rd Cycle)

Scans the ENTIRE queue. Runs ~hourly. Track `deep_scan_cycle_count` in memory.

### Purpose
Finds content buried too far out, split topic clusters, and empty near-term slots that could be filled.

### Steps
1. Paginate through ALL scheduled posts (all pages, all platforms)
2. Identify bring-forward candidates (posts 3+ months out that could fill near-term gaps)
3. Identify split topic clusters (same topic scattered across months)
4. Identify orphaned content (posts with no topic siblings on other platforms)
5. Score and select top 3-5 fixes (max 5 swaps per deep scan)
6. Execute bring-forward swaps respecting cascade ordering
7. Log results

### Scoring (highest priority first)
1. Split clusters where half are this week, half are months out
2. High-quality content buried 6+ months with open near-term slots
3. Content buried 3-6 months with open near-term slots
4. Orphaned posts needing consolidation
5. Entirely buried topic clusters that could come forward as a unit

## Weekly Lineup Briefing (Monday Mornings)

### Format
```
📋 <b>This Week's Content Lineup</b>

<b>🎬 Cluster 1: [Topic Name]</b>
  📺 YouTube (long-form) — Mon 8:00 AM
  📱 TikTok (short) — Mon 12:30 PM
  📸 Instagram (reel) — Mon 3:30 PM
  💼 LinkedIn (text) — Tue 12:00 PM

<b>🎬 Cluster 2: [Topic Name]</b>
  ...

<b>⚡ Unclustered / Standalone:</b>
  ...

<b>📊 Totals:</b> X posts across Y platforms
<b>⚠️ Issues:</b> [collisions, ordering violations, etc.]
```

## On-Demand Prioritization

When the operator requests "prioritize [topic]":
1. Search ALL scheduled posts for the topic (all pages)
2. Identify buried posts
3. Find available near-term slots
4. Execute date-swaps (long-form first per cascade)
5. Report what was moved
6. Flag duplicates or missing platforms

## Queue Configuration

### Queue IDs
| Platform | Queue ID | Type |
|----------|----------|------|
| YouTube | `{{YOUTUBE_SHORT_QUEUE_ID}}` | Shorts (primary) |
| YouTube | `{{YOUTUBE_MEDIUM_QUEUE_ID}}` | Medium clips |
| YouTube | `{{YOUTUBE_SECONDARY_QUEUE_ID}}` | Secondary |
| TikTok | `{{TIKTOK_SHORT_QUEUE_ID}}` | Shorts (primary) |
| TikTok | `{{TIKTOK_MEDIUM_QUEUE_ID}}` | Medium clips |
| Instagram | `{{INSTAGRAM_SHORT_QUEUE_ID}}` | Shorts (primary) |
| Instagram | `{{INSTAGRAM_MEDIUM_QUEUE_ID}}` | Medium clips |
| LinkedIn | `{{LINKEDIN_PRIMARY_QUEUE_ID}}` | Primary |
| LinkedIn | `{{LINKEDIN_SECONDARY_QUEUE_ID}}` | Secondary |
| X/Twitter | `{{TWITTER_PRIMARY_QUEUE_ID}}` | Primary |
| X/Twitter | `{{TWITTER_SECONDARY_QUEUE_ID}}` | Secondary |

### Time Slots (Central Time)
| Platform | Clip Type | Slots |
|----------|-----------|-------|
| YouTube | Short | 08:00, 13:00, 18:00 |
| YouTube | Medium | 16:00 |
| YouTube | Video | Sunday 10:00 |
| TikTok | Short | 07:30, 12:30, 19:00 |
| TikTok | Medium | 15:00 |
| Instagram | Short | 08:30, 12:00, 15:30 |
| Instagram | Medium | 10:30, 14:00, 17:30 |
| Instagram | Video | Saturday 14:00 |
| LinkedIn | Short | 08:00, 12:00, 15:00 |
| LinkedIn | Medium | 10:00, 14:00, 17:00 |
| X/Twitter | Short | 07:00, 10:30, 14:00, 20:30 |
| X/Twitter | Medium | 17:00 |

## Tools

### Primary
- `late_list_posts` — Fetch scheduled posts (pagination only — date filters broken, return 500)
- `late_reschedule_post` — Move a post to a new datetime (always use `timezone: "{{TIMEZONE}}"`)
- `late_get_post` — Full post details

### Known API Quirks
- `late_get_queue` returns HTTP 403 — use `late_list_posts` with pagination instead
- `late_list_posts` with `date_from`/`date_to` returns HTTP 500 — date filters broken
- `late_list_posts` sorts descending by `scheduledFor` — page 50 = nearest, page 1 = farthest
- API intermittently returns 500 on PUT operations — log and retry next cycle

### Notification Rules (When to Telegram operator)
Only notify the operator if:
- Fixed a collision (publishing would have broken)
- Made 4+ swaps in one cycle
- Deep scan brought forward 3+ posts
- Found a problem that can't be fixed autonomously
- Same violation recurring 3+ consecutive cycles

## Anti-Patterns
- ❌ Deleting posts (ZERO deletion authority — permanent rule)
- ❌ Touching posts within 30 minutes of publishing
- ❌ Trying to fix everything in one cycle (iterative — top issues only)
- ❌ Running deep scan every cycle (only every 3rd — ~hourly)
- ❌ Notifying the operator for routine maintenance (silent by default)
- ❌ Creating new posts (that's content-manager's domain)
