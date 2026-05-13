---
name: platform-content-formatting
description: >
  Platform-specific social media content formatting — per-platform copy rules, hashtag strategy,
  voice guidelines, LinkedIn algorithm optimization, and engagement patterns for {{GITHUB_USERNAME}}.
  Use when user says "write post", "LinkedIn post", "social media copy", "platform formatting",
  "hashtag rules", "content voice", "engagement optimization", "write as {{PARENT_1}}", "social copy",
  or any multi-platform content creation activity.
---

# Platform Content Formatting Skill

Canonical formatting rules, voice guidelines, and platform-specific content patterns for {{GITHUB_USERNAME}} social media. All agents that create social content MUST follow these rules.

## Voice Guidelines ({{PARENT_1}}'s Brand)

- **First person**: "I just built..." "Here's what I learned..." "Most developers don't realize..."
- **Opinionated**: Take a stance. Don't hedge everything.
- **Technical but accessible**: Explain complex ideas simply without dumbing them down
- **Forward-looking**: "The future of X is..." "In 2 years, we'll all be..."
- **Genuine**: Share real insights, not LinkedIn platitudes. No "I'm thrilled to announce..."
- **Concrete**: Specific tools, numbers, examples. Not vague "AI will change everything."

## Hashtag Rules (CRITICAL — from {{PARENT_1}}, 2026-05-02)

- **NO generic hashtags** — never use #AI, #Tech, #Innovation, #Coding alone. These are noise.
- **BE SPECIFIC** — target the exact topic and audience:
  - ✅ #{{EMPLOYER_PARENT}}Copilot #CopilotCLI #MCPServers #AIAgents #DevTools
  - ✅ #{{EMPLOYER_PARENT}}Actions #CICD #AgenticDevOps #VSCode #DotNet
  - ❌ #AI #Technology #Programming #Innovation #Software
- **Include branded hashtags** — #{{GITHUB_USERNAME}} on every post. #{{EMPLOYER_PARENT}}Copilot when relevant.
- **Include community hashtags** — #DevCommunity, #100DaysOfCode, #BuildInPublic when appropriate

### Per-Platform Hashtag Counts
| Platform | Count | Notes |
|----------|-------|-------|
| LinkedIn | 3-5 | Fewer = better on LinkedIn |
| Twitter/X | 2-3 | Space is premium |
| Instagram | 10-15 | More is better, mix broad + niche |
| TikTok | 3-5 | Trending + niche |
| YouTube | Tags | Use as video tags, not in description body |

## Platform-Specific Copy Rules

### LinkedIn
- **Format**: Thought leadership, long-form (150-300 words perform best)
- **Hook**: First 2 lines MUST compel the "see more" click
- **Body**: 3-5 paragraphs with line breaks (dense paragraphs kill engagement)
- **Bold** key phrases where impactful
- **Engagement**: End with a SPECIFIC question (NOT generic "thoughts?")
- **Links**: NEVER in post body (kills reach). Say "link in comments" or mention by name
- **Personal stories + professional insight** = highest engagement combo
- **No external links in body** — put links in comments

### Twitter/X
- Concise, punchy — 1-2 key insights max
- Can include direct links (article URL, repo URL)
- Thread potential: main tweet + reply with links
- Hashtags: 2-3 max

### YouTube
- Full description with:
  - What the video covers (from transcript summary)
  - Timestamps if available
  - Links to related {{PERSONAL_DOMAIN}} articles (full URLs)
  - Links to related repos (full URLs)
  - Relevant hashtags in description
- Title: compelling, keyword-rich, from primary angle + title seed

### TikTok
- Hook-FIRST — grab attention in first 2 seconds of caption
- Casual, trending format — match TikTok energy
- Reference what's shown/discussed specifically
- Hashtags: platform-native trending + #{{EMPLOYER_PARENT}}Copilot #{{GITHUB_USERNAME}}
- Keep caption short — TikTok users don't read long captions

### Instagram
- Visual-first caption — complement what viewers see
- Slightly longer format than TikTok, still concise
- Include call-to-action (follow for more, link in bio)
- Hashtags: 10-15 relevant (mix branded + discovery)
- Reference the specific content shown

## Source Link Requirements (CRITICAL — from {{PARENT_1}}, 2026-05-09)

**Every generated post MUST include links to source material.** If a post discusses an article, product, repo, announcement, or documentation — the source URL MUST be included. Per-platform formatting:

| Platform | Where to Put Source Links |
|----------|--------------------------|
| **LinkedIn** | First comment (NOT post body — kills reach). Mention by name in body: "Full article on {{PERSONAL_DOMAIN}}" |
| **Twitter/X** | Directly in post body or first reply thread |
| **YouTube** | Full URLs in video description with descriptions |
| **TikTok** | Bio link + mention in caption: "Link in bio" |
| **Instagram** | Caption (not clickable) + "Link in bio" |

**Anti-patterns:**
- ❌ Post about a feature/product without linking to its source
- ❌ "Check it out" without providing the actual URL
- ❌ Assuming the audience will Google it — include the link

## Video-Derived Post Quality Rules

When creating posts from video content:
- **UNIQUE per platform** — if LinkedIn and Twitter have the same text, you FAILED
- **Deep video references** — mention SPECIFIC things from the transcript, not "check out my latest video"
- **Cross-reference assets** — every post should link back into the {{GITHUB_USERNAME}} ecosystem ({{PERSONAL_DOMAIN}} articles, {{EMPLOYER_PARENT}} repos)
- **Source links included** — every post MUST link to the source material discussed (articles, repos, announcements, docs)
- **Brand protection** — never frame {{PRODUCT}}/{{EMPLOYER}} negatively (see `copilot-brand-safety` skill)
- **Targeted hashtags ONLY** — no generic #AI #Tech #Innovation

## Input Contract (Video Production Pipeline Mode)

When invoked by the content-editor orchestrator with a context package:

| Field | Description |
|-------|-------------|
| `run_id` | Production run identifier |
| `transcript.summary` | What the video is about |
| `transcript.topics` | Key topics discussed |
| `transcript.products_tools` | Tools/products mentioned |
| `transcript.quotes` | Notable quotes for hooks |
| `research.related_articles` | {{PERSONAL_DOMAIN}} articles to cross-reference |
| `research.related_repos` | {{EMPLOYER_PARENT}} repos to link |
| `research.industry_sources` | External context |
| `plan.primary_angle` | The decided content angle |
| `plan.social_hooks` | Pre-planned hooks per platform |
| `plan.must_reference` | Assets that MUST appear in posts |
| `video.upload.public_media_url` | CDN URL (may be null during parallel generation) |

## Output Contract

```json
{
  "status": "success|partial|failed",
  "platforms": {
    "linkedin": { "content": "...", "hashtags": ["..."], "title": null },
    "twitter": { "content": "...", "hashtags": ["..."], "title": null },
    "youtube": { "content": "...", "hashtags": ["..."], "title": "Video Title" },
    "tiktok": { "content": "...", "hashtags": ["..."], "title": null },
    "instagram": { "content": "...", "hashtags": ["..."], "title": null }
  },
  "cross_references": {
    "articles_linked": ["url1", "url2"],
    "repos_linked": ["url1"]
  }
}
```

## LinkedIn Algorithm Optimization

- Hook in first 2 lines (determines "see more" clicks)
- Line breaks generously — dense paragraphs kill engagement
- 150-300 words perform best
- Questions drive comments (comments > likes for reach)
- Personal stories + professional insight = highest engagement
- Avoid external links in post body (kills reach)
- Bold key phrases for scannability

## LinkedIn Post Templates

### Template 1: Hot Take / Opinion
```
[Bold contrarian statement]

[2-3 sentences explaining why you believe this]

[Specific example or data point]

[What this means for the audience]

[Specific question to drive comments]

#RelevantHashtags
```

### Template 2: "Here's What I Built/Learned"
```
[I just [built/shipped/discovered] something that changed how I think about X.]

[What it is and why it matters — 2-3 sentences]

[The key insight or lesson — be specific]

[How others can apply this]

[What would you do differently? / Have you tried this?]

#RelevantHashtags
```

### Template 3: Trend Analysis
```
[X just announced/released/changed Y.]

[Here's why this matters more than most people realize:]

[3-5 bullet points with specific implications]

[My prediction for where this goes]

[What's your take — is this a game-changer or hype?]

#RelevantHashtags
```

### Template 4: Dev Tip / Insight
```
[Most [developers/teams/engineers] don't know about X.]

[What X is — one clear sentence]

[How to use it — practical steps]

[Real result or metric that proves the value]

[Try it and tell me what you think]

#RelevantHashtags
```
