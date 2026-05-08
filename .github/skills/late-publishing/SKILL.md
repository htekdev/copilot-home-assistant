---
name: late-publishing
description: >
  Late/Zernio multi-platform social media publishing — account IDs, profile configuration, platform-specific
  content rules, upload workflow, and post creation patterns for a creator brand. Use when user says "publish post",
  "schedule post", "create post", "upload video", "late API", "zernio", "platform accounts",
  "social media publish", "cross-platform post", or any Late/Zernio publishing activity.
---

# Late/Zernio Publishing Skill

Canonical publishing configuration and workflow for a creator brand's multi-platform social media presence. All content agents that publish posts MUST use these account IDs, formatting rules, and workflows.

## Platform Accounts

| Platform | Account ID | Status |
|----------|-----------|--------|
| Instagram | `{{INSTAGRAM_ACCOUNT_ID}}` | ✅ Enabled |
| LinkedIn | `{{LINKEDIN_ACCOUNT_ID}}` | ✅ Enabled |
| TikTok | `{{TIKTOK_ACCOUNT_ID}}` | ✅ Enabled |
| Twitter/X | `{{TWITTER_ACCOUNT_ID}}` | ✅ Enabled |
| YouTube | `{{YOUTUBE_ACCOUNT_ID}}` | ✅ Enabled |

**Profile ID:** `{{LATE_PROFILE_ID}}` (Default Profile)

## Publishing Workflow

### Step 1: Upload Media (if video/image)

```
late_presign_upload(filename: "video.mp4", content_type: "video/mp4")
→ returns { uploadUrl, publicUrl }
```

Then upload the file to `uploadUrl` via HTTP PUT:
```powershell
curl.exe -X PUT -H "Content-Type: video/mp4" --data-binary "@local-file.mp4" "UPLOAD_URL"
```

Use `publicUrl` in the post's `media_items`.

### Step 2: Create Post

```
late_create_post(
  content: "Post caption text",
  platforms: '[{"platform":"instagram","accountId":"{{INSTAGRAM_ACCOUNT_ID}}"},{"platform":"linkedin","accountId":"{{LINKEDIN_ACCOUNT_ID}}"},{"platform":"tiktok","accountId":"{{TIKTOK_ACCOUNT_ID}}"},{"platform":"twitter","accountId":"{{TWITTER_ACCOUNT_ID}}"},{"platform":"youtube","accountId":"{{YOUTUBE_ACCOUNT_ID}}"}]',
  media_items: '[{"type":"video","url":"PUBLIC_URL"}]',
  queue_id: "{{LATE_PROFILE_ID}}",
  timezone: "{{TIMEZONE}}"
)
```

### Step 3: Verify Post Created
Use `late_get_post(post_id)` to confirm the post exists and check per-platform status.

## Platform-Specific Content Rules

Each platform gets UNIQUE copy (an explicit operator requirement). Never post the same text to all platforms.

### LinkedIn
- **Angle:** Thought leadership, professional insight
- **Style:** Longer-form (1-3 paragraphs), insightful hooks
- **No external links in body** (LinkedIn suppresses linked posts in feed)
- **Links go in first comment** (post them separately after publishing)
- **Hashtags:** 3-5 max, professional (#GitHubCopilot, #DevTools, #AI)

### Twitter/X
- **Angle:** Punchy, conversational, hook-first
- **Style:** 1-2 sentences max, can include links
- **Thread-worthy:** If content is meaty, consider thread format
- **Hashtags:** 1-2 max or none

### YouTube
- **Title:** Descriptive, keyword-rich, <70 chars
- **Description:** Full description with timestamps + links + related content
- **Visibility:** `public` (default)
- **Tags:** Relevant to content

### TikTok
- **Angle:** Hook-first, casual, trending-adjacent
- **Style:** Short caption, let the video do the talking
- **Hashtags:** 5-8, mix of niche and broader reach
- **Trending format awareness:** Duets, stitches, response style

### Instagram
- **Angle:** Visual-first, community-oriented
- **Style:** Caption supports the visual, not the other way around
- **Hashtags:** 10-15, mix of niche (#CopilotCLI) and broader (#CodingTips)
- **Reels vs Feed:** Reels for video, Feed for static (rarely used)

## Hashtag Standards

### Always Include (brand hashtags)
- `#GitHubCopilot`
- `#CopilotCLI`
- `#{{BRAND_TAG}}`

### Never Use (too generic)
- ❌ `#AI` (too broad)
- ❌ `#Tech` (meaningless)
- ❌ `#Coding` (too generic)
- ❌ `#Developer` (useless for discovery)

### Preferred Niche Tags
- `#DevTools`, `#AgenticAI`, `#AIEngineering`
- `#OpenSource`, `#BuildInPublic`
- `#MicrosoftDev`, `#VSCode`, `#GitHubActions`

## Queue-Based Publishing

When using queue-based scheduling (no specific datetime):
```
late_create_post(
  ...
  queue_id: "{{LATE_PROFILE_ID}}"
)
```
The post gets the next available slot from the profile's queue schedule.

## Draft Mode

For content that needs review before publishing:
```
late_create_post(
  ...
  is_draft: true
)
```
Drafts can be reviewed and scheduled later via `late_update_post` or `late_reschedule_post`.

## Failure Handling

### Check for failures
```
late_list_failures()
```

### Retry failed posts
```
late_retry_post(post_id: "FAILED_POST_ID")
```

### Per-platform independence
- One platform failure does NOT block others
- Track per-platform success/failure separately
- Retry failed platforms independently (up to 3 attempts)

## Account Health Monitoring
```
late_account_health()
```
Check before bulk publishing. If an account shows unhealthy status, skip that platform and notify.

## Quality Review Gate

Before scheduling a draft post:
1. Re-read the post critically — hook compelling? Claims grounded? Sounds like the creator?
2. Check platform anti-patterns (external links in LinkedIn body, generic hashtags, same copy across platforms)
3. Run brand safety check via `copilot-brand-safety` skill for any post mentioning Copilot, Claude, Cursor, or AI tools
4. If passes → schedule. If fails → revise content, then schedule.

## Optimal Posting Times

| Platform | Best Times (Central) | Notes |
|----------|---------------------|-------|
| LinkedIn | Tue–Thu 7–8 AM, 12–1 PM | Professional audience, weekday mornings |
| YouTube | Weekdays 8 AM, 1 PM, 6 PM | Shorts at peak browse times |
| TikTok | Weekdays 7:30 AM, 12:30 PM, 7 PM | Hook-first, casual browse times |
| Instagram | Weekdays 8:30 AM, 12 PM, 3:30 PM | Visual-first, lunch & afternoon |
| Twitter/X | Weekdays 7 AM, 10:30 AM, 2 PM, 8:30 PM | Punchy, news-cycle aligned |

## Issue Tracking (Post-Schedule)

After scheduling a post sourced from a `{{CONTENT_REPO}}` issue:
1. Comment on the issue with post details (platform, post ID, scheduled time)
2. Update issue label: swap current status for `status:scheduled`
3. Use: `gh issue edit {number} --repo {{CONTENT_REPO}} --remove-label "status:draft" --add-label "status:scheduled"`

## Known API Quirks & Workarounds

| Issue | Workaround |
|-------|-----------|
| `late_get_queue` returns HTTP 403 | Use `late_list_posts` with pagination instead |
| `late_list_posts` date filters (`date_from`/`date_to`) return HTTP 500 | Don't use date filters — paginate through all results |
| `late_list_posts` sorts **descending** by `scheduledFor` | Page 1 = farthest out, last page = nearest. Plan pagination accordingly |
| Intermittent 500 on PUT/reschedule operations | Log error, skip, retry next cycle (transient) |
| `late_retry_post` only retries top-level failures | For platform-level failures, use direct API PATCH on the platforms array |

### Direct API Fallback (when tool fails)

If `late_reschedule_post` or other tools return errors:
- **Endpoint:** `PUT https://getlate.dev/api/v1/posts/:id`
- **Auth:** `Authorization: Bearer <key>` (key stored in your local Late/Zernio config)
- **Body:** `{ "scheduledFor": "ISO8601-datetime" }`
- **⛔ NEVER use delete+recreate** — the operator's permanent rule: zero deletion authority

## Anti-Patterns
- ❌ Posting same text to all platforms (each platform gets unique copy)
- ❌ Using generic hashtags (#AI, #Tech, #Coding)
- ❌ Including external links in LinkedIn post body (suppresses reach)
- ❌ Publishing without verifying upload completed successfully
- ❌ Deleting posts (zero deletion authority — permanent rule)
- ❌ Ignoring platform failures (always retry or escalate)
- ❌ Using date filters on `late_list_posts` (they return 500)
- ❌ Using `late_get_queue` (returns 403 — use `late_list_posts` instead)
