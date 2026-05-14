---
name: content-analytics
description: Content analytics and engagement tracking for {{GITHUB_USERNAME}} — post performance, comment management, auto-replies, best posting times, follower growth, and strategy insights. Use when user says "check analytics", "post performance", "engagement stats", "comments", "reply to comments", "best time to post", "follower growth", "top posts", "content report", or wants performance data from Zernio/Late.
---

# Content Analytics Skill — {{GITHUB_USERNAME}} Performance Intelligence

This skill enables the agent to track content performance, manage comments, auto-reply intelligently, analyze engagement trends, and produce actionable strategy insights using the Late/Zernio extension tools.

## Data Sources

### Late Extension Tools (Primary — all publishing and analytics)

| Tool | Description |
|------|-------------|
| `late_get_analytics` | Post/account analytics with date/platform/account filters |
| `late_follower_stats` | Follower growth metrics per account/platform |
| `late_list_accounts` | Connected account inventory (get IDs) |
| `late_account_health` | Account connection and token status |
| `late_list_posts` | Post listing with status/date/platform filters |
| `late_get_post` | Full post details by ID including per-platform data |
| `late_list_failures` | Failed post deliveries with error details |
| `late_get_queue` | Queue contents by profile, sorted chronologically |
| `late_list_comments` | List recent comments across all platforms |
| `late_reply_comment` | Post a reply to a comment (cross-platform) |
| `late_get_post_comments` | Get all comments on a specific post |
| `late_hide_comment` | Hide spam or abusive comments |

### Zernio CLI (Legacy — available for advanced analytics queries)

| Command | Description |
|---------|-------------|
| `zernio analytics:posts --profileId <id>` | Post performance metrics (impressions, engagement, reach) |
| `zernio analytics:posts --postId <id>` | Analytics for a specific post |
| `zernio analytics:posts --platform <name> --sortBy engagement` | Top posts by engagement per platform |
| `zernio analytics:daily --accountId <id> --from "..." --to "..."` | Daily engagement trend data |
| `zernio analytics:best-time --accountId <id>` | Best posting times per account |

### YouTube MCP Tools (YouTube-specific deep data)

| Tool | Description |
|------|-------------|
| `youtube-youtube_video_details` | Detailed stats: views, likes, comments for a video |
| `youtube-youtube_channel_details` | Channel-level subscriber count, total views |
| `youtube-youtube_channel_videos` | Recent uploads with stats |
| `youtube-youtube_comment_threads` | Top-level comments on a video |
| `youtube-youtube_comment_replies` | Replies to a specific comment |

## Prerequisites

- Late/Zernio extension tools available (primary interface)
- `zernio` CLI installed for advanced analytics queries (fallback)
- YouTube MCP tools available for YouTube-specific analytics

## Key IDs

| Resource | ID |
|----------|-----|
| {{GITHUB_USERNAME}} Profile | `69892b2cfb12174ced3ce38e` |

Account IDs are dynamic — always run `zernio accounts:list` or `late_list_accounts` to get current IDs before querying analytics.

## Core Workflows

### 1. Post Performance Check

Pull analytics for recent posts, identify top/bottom performers, and extract patterns.

```
1. zernio accounts:list                          → Get account IDs
2. zernio analytics:posts --profileId <id> --sortBy engagement → Top posts by engagement
3. zernio analytics:posts --from "7-days-ago" --to "today"     → Recent performance
4. For each top/bottom post: zernio posts:get <id>              → Get full content for pattern analysis
```

**Metrics to track:**
- **Engagement rate** = (likes + comments + shares) / impressions
- **Reach rate** = reach / follower count
- **Click-through rate** = clicks / impressions
- **Save rate** = saves / impressions (Instagram)
- **Completion rate** = full views / total views (video platforms)

**Classification thresholds:**
- 🟢 **High performer**: Engagement rate > 5% or 2× platform average
- 🟡 **Average**: Within 1 standard deviation of platform mean
- 🔴 **Underperformer**: Engagement rate < 1% or <0.5× platform average

### 2. Comment Management & Active Reply

Read comments across ALL platforms and **actively reply** using Late comment tools (cross-platform) and YouTube MCP tools (YouTube-specific).

#### Comment Tools Reference

| Tool | Purpose | Platform |
|------|---------|----------|
| `late_list_comments` | List recent comments across all platforms | All |
| `late_reply_comment` | Post a reply to a comment | All (cross-platform) |
| `late_get_post_comments` | Get all comments on a specific post | All |
| `late_hide_comment` | Hide spam/abusive comments | All |
| `youtube-youtube_comment_threads` | Deep YouTube comment data | YouTube only |
| `youtube-youtube_comment_replies` | Check existing replies on YouTube | YouTube only |

#### Comment Reply Workflow

```
1. late_list_comments                                    → Get recent comments (all platforms)
2. For YouTube: youtube-youtube_comment_threads --videoId → Deep comment data
3. 🚨 DUPLICATE CHECK: For each comment:
   - late_get_post_comments --postId <id>                → Check for existing replies
   - For YouTube: youtube-youtube_comment_replies         → Verify no reply from @{{YOUTUBE_HANDLE}} or @{{GITHUB_USERNAME}}
   - If reply already exists → SKIP
4. Read the original post content via late_get_post <id>  → Understand context
5. Classify comment → sentiment + intent
6. Craft reply matching platform voice (see Per-Platform Etiquette below)
7. late_reply_comment --commentId <id> --text "..."       → Post reply
8. For spam/abuse: late_hide_comment --commentId <id>     → Hide it
9. Log comment + reply in working memory for tracking
```

**Auto-Reply Rules:**
- **Always reply to:** Questions, genuine compliments, constructive feedback, feature requests
- **Never reply to:** Spam, hate speech, clearly bot-generated comments, trolling
- **Reply tone:** Friendly, knowledgeable, appreciative. Match {{GITHUB_USERNAME}} brand voice — developer-friendly, helpful, occasionally witty
- **Include source links:** When answering questions, link to relevant {{PERSONAL_DOMAIN}} blog posts, YouTube videos, official docs, or {{EMPLOYER_PARENT}} repos
- **Reply structure:**
  - Acknowledge the commenter's point
  - Add value (answer the question, share a resource, confirm the feedback)
  - Include a relevant link when applicable
  - Optional: Ask a follow-up question to drive engagement
- **Reply length:** 1-3 sentences max. Concise > verbose.
- **Flagging:** Comments requiring {{PARENT_1}}'s personal attention → create a task via `add_task`
- **Rate limit:** Max 20 auto-replies per cycle to avoid bot-like behavior

#### Per-Platform Reply Etiquette

| Platform | Tone | Style | Notes |
|----------|------|-------|-------|
| **YouTube** | Friendly, conversational | "Hey [name]! Great question..." | Can be slightly longer (2-3 sentences). Use emojis sparingly. Heart/pin notable comments. |
| **LinkedIn** | Professional, thought-leader | "Great point, [name]. In my experience..." | Formal but warm. Reference industry context. No slang. |
| **X/Twitter** | Casual, concise | "Good call! Here's how..." | Keep under 280 chars if possible. Hashtags OK. Witty when appropriate. |
| **Instagram** | Warm, visual-oriented | "Love this! 🔥..." | Emoji-friendly. Short. Direct. |
| **TikTok** | Casual, Gen-Z-aware | "Yep! Here's the trick..." | Very casual. Brief. Match TikTok energy. |

#### Reply Templates by Comment Type

**Positive feedback:**
> "Thanks [name]! Really glad this helped. What topic should I cover next? 🙏"

**Technical question:**
> "Great question! [Direct answer]. I covered this in more detail here: [link to blog/video]. Let me know if that helps!"

**Constructive criticism:**
> "Appreciate the feedback, [name]! You make a good point about [topic]. I'll address that in a follow-up — stay tuned."

**Feature request:**
> "Love this idea! I'll add it to my content backlog. In the meantime, you might find this useful: [link]"

#### Escalation Criteria — Flag for {{PARENT_1}} (DO NOT auto-reply)

Create a task via `add_task(surface='agent')` for these — do NOT surface to {{PARENT_1}} as a human task (per standing order "Social Media Replies Are Autonomous"), but DO create agent-surface tasks to track:

| Scenario | Why Flag | Task Priority |
|----------|----------|---------------|
| Negative/controversial opinion about Copilot/{{EMPLOYER}} | Brand safety — needs nuanced response or ignore | high |
| Competitor comparison question | Could violate brand safety if answered wrong | medium |
| Comment from verified/notable account | {{PARENT_1}} may want to reply personally | medium |
| Request for opinion on unreleased features | Cannot make claims about roadmap | high |
| Personal attack or doxxing attempt | Safety concern — may need moderation | urgent |
| Comment in non-English language {{PARENT_1}} speaks | May want personal touch | low |

**Comment Sentiment Classification:**
| Sentiment | Action |
|-----------|--------|
| 🟢 Positive (praise, thanks) | Reply with gratitude, ask what they'd like to see next |
| 🔵 Question (how-to, clarification) | Answer directly with source links, point to relevant content |
| 🟡 Constructive criticism | Thank them, acknowledge the point, note for content improvement |
| 🟠 Feature request / suggestion | Thank them, log as content idea, tag for content-manager |
| 🔴 Negative / hostile | Do not reply. Flag if brand-sensitive. Use `late_hide_comment` if abusive. |
| ⚫ Spam / bot | `late_hide_comment` immediately. No reply. |

### 3. Best Posting Times Analysis

Compare scheduled slot performance against analytics data to optimize timing.

```
1. zernio analytics:best-time --accountId <id>          → Platform-recommended times
2. zernio analytics:daily --accountId <id> --from --to  → Actual daily engagement data
3. Cross-reference with content-scheduler slot config    → Compare actual vs optimal
4. Identify slots that consistently underperform         → Flag for schedule adjustment
```

**Current {{GITHUB_USERNAME}} slot configuration** (reference — owned by content-scheduler):

| Platform | Slots (CT) |
|----------|------------|
| YouTube | 08:00, 13:00, 16:00, 18:00 |
| TikTok | 07:30, 12:30, 15:00, 19:00 |
| Instagram | 08:30, 10:30, 12:00, 14:00, 15:30, 17:30 |
| LinkedIn | 08:00, 10:00, 12:00, 14:00, 15:00, 17:00 |
| X/Twitter | 07:00, 10:30, 14:00, 17:00, 20:30 |

**Output:** Slot-by-slot performance comparison with recommendations. Feed findings to content-scheduler via working memory or Telegram.

### 4. Follower Growth Tracking

Track follower growth across all platforms over time.

```
1. late_follower_stats                           → Current follower counts per account
2. late_follower_stats --platform <name>          → Platform-specific growth
3. Compare against previous snapshots in working memory → Calculate growth rate
4. Identify growth spikes and correlate with content    → What caused the spike?
```

**Tracking cadence:** Snapshot follower counts every analytics run (every 3 hours). Store in working memory with timestamps.

### 5. Performance Report Generation

Produce weekly and on-demand performance summaries.

```
1. Pull 7-day analytics per platform
2. Calculate: total reach, total engagement, avg engagement rate, top 3 posts, bottom 3 posts
3. Compare vs previous period (week-over-week)
4. Identify content type/topic/time patterns
5. Generate actionable recommendations
6. Send via Telegram to {{PARENT_1}} (chat_id: {{TELEGRAM_PARENT_1}})
```

**Weekly Report Template:**

```
📊 {{GITHUB_USERNAME}} Weekly Performance (Mon-Sun)

🏆 Top Performers:
1. [Platform] "Title" — X engagement, Y reach
2. ...
3. ...

📈 Growth:
- Followers: +N across all platforms (YT +X, TT +Y, IG +Z)
- Total reach: X (↑/↓ Y% vs last week)
- Avg engagement rate: X% (↑/↓ Y% vs last week)

🎯 Patterns:
- [Topic/type] content performing X% above average
- [Time slot] consistently outperforming by Y%
- [Platform] engagement trending [up/down] — [reason]

💡 Recommendations:
- [Actionable suggestion 1]
- [Actionable suggestion 2]

💬 Comments: X new (Y replied, Z flagged)
```

### 6. Cross-Platform Strategy Insights

Correlate performance data with scheduled content to inform future strategy.

```
1. Pull top 10 posts by engagement per platform (last 30 days)
2. Categorize by: content pillar, format (short/medium/long), topic
3. Map performance to the 5 {{GITHUB_USERNAME}} content pillars:
   - AI & Copilot Ecosystem
   - Developer Productivity
   - Creator Economy
   - Career & Leadership
   - {{EMPLOYER}} Platform
4. Identify: which pillars overperform, which underperform
5. Cross-reference with content-scheduler queue density
6. Output: pillar balance recommendations for content-manager
```

## Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 401 | Auth expired | Run `zernio auth:check`, then `zernio auth:login` if needed |
| 402 | Analytics add-on required | Notify {{PARENT_1}} — analytics feature needs paid upgrade |
| 429 | Rate limited | Back off, wait 60s, retry. Log in events. |
| 500 | API error | Retry once. If persistent, log and skip that data source. |

## Agent Instructions

When running analytics checks:

1. **Load memory first** — check working.md for previous snapshots to compute deltas
2. **Get account IDs** — `zernio accounts:list` (IDs may change if accounts reconnected)
3. **Check account health** — `zernio accounts:health` before pulling analytics (skip unhealthy accounts)
4. **Pull analytics** — use CLI for structured data, MCP tools as fallback
5. **Compute deltas** — compare against previous snapshot in working memory
6. **Identify outliers** — flag posts performing 2× above or 0.5× below average
7. **Update working memory** — save current snapshot for next run's comparison
8. **Notify only on significance** — don't spam {{PARENT_1}} with routine metrics

When managing comments:

1. **Scan all platforms** — use `late_list_comments` for cross-platform comment feed, YouTube MCP for deep YouTube data
2. **Read the original post content** — `late_get_post` to understand what the post is about before reading comments
3. **Classify each comment** — sentiment + intent (question, praise, criticism, spam)
4. **🚨 DUPLICATE CHECK (MANDATORY before ANY reply):**
   - Call `late_get_post_comments` or `youtube-youtube_comment_replies` to check for existing replies
   - Check if ANY reply in the thread is authored by `@{{YOUTUBE_HANDLE}}` or `@{{GITHUB_USERNAME}}`
   - If a reply from either account already exists → **SKIP, do not reply**
   - Do NOT rely solely on working memory or events.log — always verify via the API
   - This check is non-negotiable even after OAuth blind spots, session restarts, or multi-hour gaps
5. **Actively reply** — use `late_reply_comment` (cross-platform) or YouTube MCP tools. Match per-platform etiquette (see workflow section). Include source links when answering questions.
6. **Hide spam/abuse** — use `late_hide_comment` for clear spam, hate speech, or bot comments
7. **Flag for {{PARENT_1}}** — create agent-surface tasks for brand-sensitive or controversial comments (NOT human-surface — per standing order "Social Media Replies Are Autonomous")
8. **Log everything** — append comment activity to events.log

**Tips:**
- Always use `--pretty` when showing data to the user
- Parse JSON programmatically when chaining commands in scripts
- Rate limit awareness: space out API calls, especially across multiple platforms
- Follower count snapshots are essential for growth tracking — never skip saving them
- Cross-reference published post timing with engagement spikes for time-slot optimization
