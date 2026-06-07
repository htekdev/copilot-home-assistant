---
name: htek-dev-article
description: >
  {{PERSONAL_DOMAIN}} blog article creation — frontmatter schema, tag conventions, research standards,
  quality checklist, git worktree PR workflow, and video-companion article mode. Use when
  creating articles on {{PERSONAL_DOMAIN}}, writing blog posts, creating PRs on htek-dev-site, checking
  article quality, or any agent says "write article", "blog post", "{{PERSONAL_DOMAIN}} article",
  "create PR for article", "frontmatter schema", "article quality check".
---

# {{PERSONAL_DOMAIN}} Article Creation Skill

Complete reference for creating, reviewing, and publishing articles on [{{PERSONAL_DOMAIN}}](https://{{PERSONAL_DOMAIN}}). Any agent creating content on this site MUST follow this skill.

## Blog Pipeline Awareness (NEW — 2026-06-01)

The canonical long-form article pipeline is now:

```text
blog-idea → blog-ready → blog-draft → blog-review → published
```

### Role boundaries
- `blog-planner` owns `blog-idea` → `blog-ready` by capturing {{PARENT_1}}'s interview input and synthesizing the brief
- `blog-writer` owns `blog-ready` → `blog-draft` by writing the article and creating the PR
- `blog-reviewer` owns `blog-draft` → `blog-review` / `published` by verifying standards before publication

### Critical rule
Do **not** bypass the interview-first step for normal long-form articles. If the topic came from a gap, trend, or recommendation, it should enter the issue-driven pipeline through a `blog-idea` issue on `{{GITHUB_USERNAME}}/htek-dev-site` before writing begins. Video companion mode remains a valid specialized input path, but draft PRs should still expect downstream review.

## Site Reference

- **Repo**: `{{GITHUB_USERNAME}}/htek-dev-site` on GitHub
- **Local clone**: `C:\Repos\{{GITHUB_USERNAME}}\htek-dev-site`
- **Tech stack**: Astro 5, MDX content collections, Tailwind CSS 4, GitHub Pages
- **Site URL**: https://{{PERSONAL_DOMAIN}}
- **Articles path**: `src/content/articles/{slug}.mdx`
- **Style guide**: `C:\Repos\{{GITHUB_USERNAME}}\htek-dev-site\.github\instructions\articles.instructions.md` (read at runtime)

## Frontmatter Schema

Every article MUST have this exact frontmatter (from `src/content.config.ts`):

```yaml
---
title: "Article Title Here"
description: "Compelling 1-2 sentence description (under 160 chars for SEO)"
pubDate: YYYY-MM-DD
tags: ["Tag1", "Tag2", "Tag3"]
draft: false
---
```

**Optional fields:** `updatedDate`, `heroImage`, `devtoCover`, `devto_id`, `devto_hash`, `hashnode_id`, `hashnode_hash`, `medium_id`. Never set sync ID fields — cross-posting GitHub Actions populate those. The `devtoCover` field provides a 1000×420 image optimized for dev.to's cover display — if absent, the Action falls back to `heroImage` (which dev.to will crop).

## Title Rules (MANDATORY — from {{PARENT_1}}, 2026-06-04)

> **Every article title MUST pass this check before PR creation. {{PARENT_1}} hates long titles.**

### Hard Rules
- **Max 8 words** — no exceptions. If you can't say it in 8 words, cut words.
- **No "How to..."** — weak, passive, sounds like documentation
- **No "A Guide to..."** or "Complete Guide" — filler
- **No long subtitles or colons** — the colon trick is lazy ("X: A Comprehensive Look at Y")
- **No restating the slug** — if the slug says it, the title doesn't need to too

### The Test
Ask yourself: *Would I click this if I saw it in a Twitter/LinkedIn feed?*
If the answer is "only if I'm already interested in the topic" → rewrite.
If the answer is "yes, even if I don't know the topic yet" → ship it.

### What Good Titles Do
- **Name a problem, feeling, or insight** — not the article's content
- **Create curiosity** — the reader needs to click to resolve the tension
- **Feel opinionated** — {{PARENT_1}} has a point of view, the title should too
- **Trend-adjacent** — fits naturally in a feed of tech content

### ✅ Good Title Examples
| ✅ Good | ❌ Bad |
|---------|--------|
| "AI Agents Need a Constitution" | "How to Build Governed AI Agent Systems" |
| "Your AI Dev Workflow Is the OS" | "AI-Powered Development Workflow: A Governed Operating System for Shipping Software" |
| "I Made CI Failures Searchable" | "How I Turned 65+ GitHub Actions Failures into an AI-Queryable Debugging Database" |
| "Ship It in 7 Days" | "A Complete Guide to Shipping Your Project in One Week" |
| "The Agent Harness Problem" | "Understanding Agent Harnesses and Why They Matter for AI Systems" |
| "Why Your CI Fails at 3 AM" | "Common Causes of CI Pipeline Failures and How to Fix Them" |
| "Stop Trusting Your AI Agents" | "The Importance of Governance in Multi-Agent AI Systems" |
| "Your God Prompt Is a Monolith" | "Why Large System Prompts Lead to Maintenance Challenges" |

### Formula Patterns That Work
- "Your [thing] Is [surprising truth]" — e.g., "Your Dev Workflow Is the OS"
- "I [did surprising thing]" — e.g., "I Made CI Failures Searchable"
- "[Topic] Need[s] a [unexpected frame]" — e.g., "AI Agents Need a Constitution"
- "Stop [thing people do wrong]" — e.g., "Stop Trusting Your AI Agents"
- "Why Your [thing] [does bad thing]" — e.g., "Why Your CI Fails at 3 AM"
- "The [Topic] Problem" — e.g., "The Agent Harness Problem"

---

## Tag Conventions

Use consistent tags from this set: `AI`, `GitHub Copilot`, `DevOps`, `Developer Experience`, `Software Architecture`, `Multi-Agent Systems`, `Automation`, `{{EMPLOYER}}`, `Azure`, `Open Source`, `Productivity`, `Engineering Leadership`, `Career`.

## Research Standards (ZERO HALLUCINATION POLICY)

Every article must be **100% grounded in reality**.

### What "grounded" means:
- **Statistics**: Must link to the original study/report — not "studies show..."
- **Tool claims**: Must be verifiable in official documentation
- **Personal experience**: Only reference documented experiences. When unsure, frame as general observation.
- **Code examples**: Syntactically correct and logically sound. Verify API is current.
- **Dates and versions**: Double-check all.

### When you can't find a source:
1. **Cut the claim.** Better without an unsourced claim.
2. **Reframe as opinion.** "In my experience..." requires no source.
3. **Flag to {{PARENT_1}}.** If central to the article, create a clarification task.
4. **Never fabricate.** No invented statistics, fake study names, or hallucinated URLs.

## Quality Checklist (Pre-PR)

Before creating a PR, verify every item:

- [ ] Style guide read and followed
- [ ] Frontmatter complete: title, description (<160 chars), pubDate, tags, draft: false
- [ ] No H1 headings in body (title is H1)
- [ ] Opening hooks immediately (bold claim, data, or real scenario)
- [ ] Closing is substantive (no "thanks for reading")
- [ ] 8+ credible outbound links with descriptive anchor text
- [ ] Cross-links to 1-2 existing {{PERSONAL_DOMAIN}} articles (relative paths: `/articles/{slug}`)
- [ ] All statistics cite their source with a link
- [ ] Code examples are syntactically correct with language identifiers
- [ ] Word count: 1000-2500 words
- [ ] Multi-model review passed (Claude Opus 4.6 + GPT-5.5, with all 🔴 issues resolved)
- [ ] Slug doesn't conflict with existing articles
- [ ] Tags follow established conventions
- [ ] Content-illustrator dispatched after PR creation (MANDATORY pipeline gate)
- [ ] Hero image will be AI-generated via `generate_image` (never HTML→Playwright for heroes)

## Article Structure

- **Voice**: First-person as {{PARENT_1}}. Conversational, opinionated, technically precise.
- **Length**: 1000–1500 words (standard), 1500–2500 words (deep-dive).
- **Structure**: Hook opening → clear H2/H3 sections → strong closing with clear takeaway.
- **Links**: Descriptive anchor text. Source every statistic. Cross-link to existing {{PERSONAL_DOMAIN}} articles.
- **No filler**: Every paragraph delivers value. No generic closings.
- **Code blocks**: Language identifiers for syntax highlighting. Realistic, well-formatted.

## Git Worktree + PR Workflow

**⚠️ NEVER commit directly to main. Always use a branch + PR.**

### Step 1: Pull latest main
```powershell
Set-Location "C:\Repos\{{GITHUB_USERNAME}}\htek-dev-site"
git checkout main
git pull origin main
```

### Step 2: Create branch and worktree
```powershell
$slug = "your-article-slug"
$branch = "article/$slug"
git branch $branch main
git worktree add "C:\Repos\{{GITHUB_USERNAME}}\htek-dev-site\worktrees\$slug" $branch
```

### Step 3: Write the article file
Use the `create` tool to write the final MDX content to:
```
C:\Repos\{{GITHUB_USERNAME}}\htek-dev-site\worktrees\$slug\src\content\articles\$slug.mdx
```

### Step 4: Stage, commit, and push
```powershell
Set-Location "C:\Repos\{{GITHUB_USERNAME}}\htek-dev-site\worktrees\$slug"
dev_add -p "src/content/articles/$slug.mdx"
dev_commit -m "feat(article): add $slug"
dev_push
```

### Step 5: Create PR
```powershell
gh pr create --repo {{GITHUB_USERNAME}}/htek-dev-site --base main --head $branch --title "📝 New article: $title" --body "## New Article\n\n**Title:** $title\n**Slug:** $slug\n**Tags:** $tags\n\n### Review Summary\n- Claude Opus 4.6 review: ✅ passed\n- GPT-5.5 review: ✅ passed\n- Outbound links: N\n- Cross-links to existing articles: N\n\n---\n\n$description"
```

### Step 6: Wait for Vercel Preview & Send to {{PARENT_1}}

> **⚠️ MANDATORY:** htek-dev-site is Vercel-connected. Follow the `vercel-preview-workflow` skill (`.github/skills/vercel-preview-workflow/SKILL.md`) to:
> 1. Poll for the Vercel bot comment with the preview URL
> 2. Extract the preview URL
> 3. Send both the PR URL and preview URL to {{PARENT_1}} via Telegram (with `speak`)
> 4. Wait for {{PARENT_1}}'s approval before merging

```powershell
# Extract PR number from creation output, then poll for Vercel preview
# See vercel-preview-workflow skill for full polling script
```

### Step 7: Clean up worktree (after merge)
```powershell
Set-Location "C:\Repos\{{GITHUB_USERNAME}}\htek-dev-site"
git worktree remove "C:\Repos\{{GITHUB_USERNAME}}\htek-dev-site\worktrees\$slug"
```

## Video Companion Article Mode

When invoked with a **context package** from the content-editor orchestrator:

### Input Contract
- `run_id` — production run identifier
- `transcript.full_text` — complete video transcript
- `transcript.summary` — AI-generated summary
- `transcript.topics` — extracted topics list
- `research.related_articles` — discovered related {{PERSONAL_DOMAIN}} articles
- `research.related_repos` — discovered related {{GITHUB_USERNAME}} repos
- `research.industry_sources` — relevant external sources
- `plan.primary_angle` — the decided angle for this release
- `plan.blog_thesis` — specific thesis for the blog article
- `plan.must_reference` — assets that MUST be referenced
- `video.upload.youtube_url` — YouTube URL (may arrive after draft starts)

### Video-Derived Article Structure
1. **The Hook** — core claim or unexpected lesson from the video
2. **What I Actually Built / Said** — clean narrative from transcript (NOT a transcript dump)
3. **Why This Matters** — tie to broader industry movement
4. **How It Connects to My Other Work** — 1-3 related {{PERSONAL_DOMAIN}} articles + repos
5. **Watch the Video** — embed or link (placeholder if URL not yet available)
6. **The Bottom Line** — key takeaway + ecosystem pointers

### Key Rules
- **NEVER dump raw transcript** — transform into clean narrative prose
- **ALWAYS cross-link** to related {{PERSONAL_DOMAIN}} articles from research
- **ALWAYS reference repos** when video demonstrates code/projects
- **Primary angle from production plan** — don't freelance a different angle
- **Blog thesis drives the article** — stay focused
- **Video embed**: Use `<!-- VIDEO_EMBED_PLACEHOLDER -->` if YouTube URL unavailable

### Output Contract
```json
{
  "status": "success|failed",
  "slug": "article-slug-here",
  "title": "Article Title Here",
  "article_path": "src/content/articles/article-slug-here.mdx",
  "pr_url": "https://github.com/{{GITHUB_USERNAME}}/htek-dev-site/pull/NNN",
  "related_articles": ["slug1", "slug2"],
  "video_embed_status": "embedded|link-placeholder|pending-url"
}
```

## Mandatory Illustration Dispatch (PIPELINE GATE)

> **⚠️ CRITICAL: Every article's creation is NOT COMPLETE until this step runs.**

After creating the PR (Step 5), you MUST dispatch the `content-illustrator` agent to generate all visuals. This is a hard pipeline gate — articles without illustration dispatch are incomplete.

### What to dispatch:
```
task tool with agent_type: "content-illustrator"
  prompt: "Generate illustrations for article '{title}' at path src/content/articles/{slug}.mdx.
           Slug: {slug}. PR: {pr_url}. Branch: article/{slug}.
           Worktree: C:\Repos\{{GITHUB_USERNAME}}\htek-dev-site\worktrees\{slug}"
```

### What the illustrator generates:
1. **Mandatory AI hero image** (1536×1024 → scaled to 1200×800) via `generate_image` tool — ALWAYS AI, never HTML→Playwright for heroes
2. **Dev.to cover image** (1000×420) — separate AI-generated cover optimized for cross-posting
3. **2-4 inline visuals** — architecture diagrams, process flows, concept art as appropriate
4. **Frontmatter wiring** — `heroImage` and `devtoCover` fields written automatically

### Rules:
- **Hero images MUST use `generate_image` (AI generation)** — never HTML→Playwright, never screenshots, never stock images
- Hero images must include `{{PERSONAL_DOMAIN}}` branding, embedded title, and be self-explanatory
- The producing agent's job is NOT done until `content-illustrator` has been dispatched
- This applies to ALL content types: articles, blueprints, newsletters
- See `content-illustration` skill for full illustration workflow details

---

## Post-Merge Lifecycle

1. GitHub Actions automatically deploys to {{PERSONAL_DOMAIN}}
2. Cross-posting to DEV.to, Hashnode, Medium triggers automatically
3. Update memory with published article details
4. Notify content-manager for social media promotion

## Integration

- **Primary consumer**: blog-writer agent
- **Upstream intake owner**: `blog-planner` for issue-driven long-form articles
- **Downstream review owner**: `blog-reviewer` for draft PR quality checks before publication
- **Secondary consumers**: coding-agent (for documentation PRs), content-editor (video companion mode), harness-tracker (comparison articles)
- **Illustration**: `content-illustrator` agent — dispatched via `content-illustration` skill (MANDATORY for every article)
- **Review pattern**: Use `multi-model-review` skill for parallel quality reviews
- **Brand protection**: Use `copilot-brand-safety` skill for all content

## Agents That MUST Follow This Skill

Any agent that creates blog articles on {{PERSONAL_DOMAIN}} MUST reference and follow this skill end-to-end:
- `blog-writer` — primary article producer
- `content-editor` — video companion articles
- `harness-tracker` — comparison/tracking articles
- `content-blitz` — campaign articles
- `blueprint-manager` — blueprint pages (adapted workflow)

If you're creating content on {{PERSONAL_DOMAIN}}, you follow THIS skill. No exceptions.
