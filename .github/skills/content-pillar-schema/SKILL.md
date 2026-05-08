---
name: content-pillar-schema
description: >
  content pillar definitions for your brand, label system, issue templates, and recording schedule —
  the reference schema for all content pipeline agents. Use when creating content issues,
  labeling pipeline items, checking pillar alignment, or referencing the recording schedule.
  Trigger phrases: "content pillars", "label system", "issue template", "recording schedule",
  "content pipeline labels", "create content issue", "pillar alignment".
---

# Content Pillar Schema

Canonical reference for your content pipeline. All content agents reference this skill for consistent pillar definitions, labeling, and issue creation.

## The 5 Content Pillars

All content ideas should align with one or more of these pillars:

| # | Pillar | Topics | Label Color |
|---|--------|--------|-------------|
| 1 | 🤖 **AI / Agent** | GitHub Copilot, Claude, Codex, AI agents, multi-agent systems, autopilot, agentic AI | Purple `#A371F7` |
| 2 | ⚙️ **DevOps / CI** | GitHub Actions, CI/CD, agentic DevOps, automation, infrastructure-as-code | Green `#1F883D` |
| 3 | 🔧 **Tools / IDE** | VS Code, developer tools, debugging, MCP, hooks, extensions | Blue `#0969DA` |
| 4 | 📈 **Strategy / Biz** | Governance, security, best practices, enterprise adoption, productivity | Amber `#BF8700` |
| 5 | 💻 **Tech** | .NET, Microsoft ecosystem, software updates, tutorials | Coral `#FF7B72` |

**Plus:** Anything big in the broader tech/AI space that overlaps with your audience — even if it doesn't fit neatly into a pillar. If it's trending and relevant to developers, it's fair game.

## Recording Schedule

- **Monday mornings** — Primary recording day
- **Tuesday mornings** — Secondary/overflow recording day
- Content ideas should reach `status:ready` by **Sunday evening** to be available for Monday recording
- When creating recording session calendar events, schedule them for **8:00 AM - 11:00 AM Central**

## Content Pipeline Lifecycle

The `{{CONTENT_REPO}}` repo uses GitHub Issues as the content pipeline:

```
💡 Draft → ✅ Ready → 🎬 Recorded → ✂️ Editing → 📅 Scheduled → 🚀 Published
```

## Label System

When creating or updating issues, always apply the correct labels:

**Status** (exactly one):
- `status:draft` — Idea captured, needs refinement
- `status:ready` — Research done, ready to record
- `status:recorded` — Raw content captured
- `status:editing` — Post-production in progress
- `status:scheduled` — Final content ready, publish date set
- `status:published` — Live on target platforms

**Priority** (exactly one):
- `priority:hot-trend` — Ship in 3-5 days (time-sensitive)
- `priority:timely` — Relevant within 1-2 weeks
- `priority:evergreen` — No expiration

**Type** (exactly one):
- `type:tutorial`, `type:breaking-news`, `type:deep-dive`, `type:weekly-roundup`
- `type:comparison`, `type:review`, `type:strategy`, `type:quicktip`, `type:idea`

**Platform** (one or more):
- `platform:youtube`, `platform:tiktok`, `platform:linkedin`, `platform:x`, `platform:instagram`

**Topic** — Add relevant topic labels from the pillar categories (e.g., `github-copilot`, `devops`, `ai-agents`, `mcp`).

## Issue Templates

### Content Idea (default)

```markdown
## Hook
**[One-liner that grabs attention]**

## Audience
[Who is this for and why they should care]

## Talking Points
- [ ] Point 1
- [ ] Point 2
- [ ] Point 3

## Research Links
- [link 1]
- [link 2]

## Platform Targeting
- [ ] YouTube (long-form)
- [ ] TikTok / Shorts
- [ ] LinkedIn
- [ ] X (Twitter)
- [ ] Instagram

## Notes
[Additional context, timing considerations, etc.]
```

### Breaking News

Same template as Content Idea but add urgency context and a **publish deadline**.

## Cross-Platform Publishing Strategy

| Content Type | YouTube | TikTok | Instagram | LinkedIn | X/Twitter |
|-------------|---------|--------|-----------|----------|-----------|
| Long-form tutorial | ✅ Full video | ❌ | ❌ | 📝 Text post w/ link | 📝 Thread + link |
| Short clip / Reel | ✅ Short | ✅ With hook | ✅ Reel | ❌ | 📝 Teaser + link |
| Breaking news | ✅ Short or long | ✅ Quick take | ✅ Reel | ✅ Analysis post | ✅ Hot take |
| Deep dive | ✅ Full video | ✅ Clip teasers | ✅ Reel teaser | ✅ Key insights | ✅ Thread |
| Quick tip | ✅ Short | ✅ With demo | ✅ Reel | ✅ Tip post | ✅ One-liner |
