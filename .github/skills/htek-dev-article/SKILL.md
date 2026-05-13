---
name: htek-dev-article
description: >
  {{PERSONAL_DOMAIN}} blog article creation — frontmatter schema, tag conventions, research standards,
  quality checklist, git worktree PR workflow, and video-companion article mode. Use when
  creating articles on {{PERSONAL_DOMAIN}}, writing blog posts, creating PRs on your personal-site repo, checking
  article quality, or any agent says "write article", "blog post", "{{PERSONAL_DOMAIN}} article",
  "create PR for article", "frontmatter schema", "article quality check".
---

# {{PERSONAL_DOMAIN}} Article Creation Skill

Complete reference for creating, reviewing, and publishing articles on [{{PERSONAL_DOMAIN}}](https://{{PERSONAL_DOMAIN}}). Any agent creating content on this site MUST follow this skill.

## Site Reference

- **Repo**: `{{GITHUB_USERNAME}}/personal-site` on {{EMPLOYER_PARENT}}
- **Local clone**: `C:\Repos\{{GITHUB_USERNAME}}\personal-site`
- **Tech stack**: Astro 5, MDX content collections, Tailwind CSS 4, {{EMPLOYER_PARENT}} Pages
- **Site URL**: https://{{PERSONAL_DOMAIN}}
- **Articles path**: `src/content/articles/{slug}.mdx`
- **Style guide**: `C:\Repos\{{GITHUB_USERNAME}}\personal-site\.github\instructions\articles.instructions.md` (read at runtime)

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

**Optional fields:** `updatedDate`, `heroImage`, `devto_id`, `devto_hash`, `hashnode_id`, `hashnode_hash`, `medium_id`. Never set sync ID fields — cross-posting {{EMPLOYER_PARENT}} Actions populate those.

## Tag Conventions

Use consistent tags from this set: `AI`, `{{PRODUCT}}`, `DevOps`, `Developer Experience`, `Software Architecture`, `Multi-Agent Systems`, `Automation`, `{{EMPLOYER}}`, `Azure`, `Open Source`, `Productivity`, `Engineering Leadership`, `Career`.

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
- [ ] Multi-model review passed (all 🔴 issues resolved)
- [ ] Slug doesn't conflict with existing articles
- [ ] Tags follow established conventions

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
Set-Location "C:\Repos\{{GITHUB_USERNAME}}\personal-site"
git checkout main
git pull origin main
```

### Step 2: Create branch and worktree
```powershell
$slug = "your-article-slug"
$branch = "article/$slug"
git branch $branch main
git worktree add "C:\Repos\{{GITHUB_USERNAME}}\personal-site\worktrees\$slug" $branch
```

### Step 3: Write the article file
Use the `create` tool to write the final MDX content to:
```
C:\Repos\{{GITHUB_USERNAME}}\personal-site\worktrees\$slug\src\content\articles\$slug.mdx
```

### Step 4: Stage, commit, and push
```powershell
Set-Location "C:\Repos\{{GITHUB_USERNAME}}\personal-site\worktrees\$slug"
git add "src/content/articles/$slug.mdx"
git commit -m "feat(article): add $slug" --trailer "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin $branch
```

### Step 5: Create PR
```powershell
gh pr create --repo {{GITHUB_USERNAME}}/personal-site --base main --head $branch --title "📝 New article: $title" --body "## New Article\n\n**Title:** $title\n**Slug:** $slug\n**Tags:** $tags\n\n### Review Summary\n- Claude Opus review: ✅ passed\n- GPT Codex review: ✅ passed\n- Outbound links: N\n- Cross-links to existing articles: N\n\n---\n\n$description"
```

### Step 6: Wait for Vercel Preview & Send to {{PARENT_1}}

> **⚠️ MANDATORY:** your personal-site repo is Vercel-connected. Follow the `vercel-preview-workflow` skill (`.github/skills/vercel-preview-workflow/SKILL.md`) to:
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
Set-Location "C:\Repos\{{GITHUB_USERNAME}}\personal-site"
git worktree remove "C:\Repos\{{GITHUB_USERNAME}}\personal-site\worktrees\$slug"
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
  "pr_url": "https://github.com/{{GITHUB_USERNAME}}/personal-site/pull/NNN",
  "related_articles": ["slug1", "slug2"],
  "video_embed_status": "embedded|link-placeholder|pending-url"
}
```

## Post-Merge Lifecycle

1. {{EMPLOYER_PARENT}} Actions automatically deploys to {{PERSONAL_DOMAIN}}
2. Cross-posting to DEV.to, Hashnode, Medium triggers automatically
3. Update memory with published article details
4. Notify content-manager for social media promotion

## Integration

- **Primary consumer**: blog-writer agent
- **Secondary consumers**: coding-agent (for documentation PRs), content-editor (video companion mode)
- **Review pattern**: Use `multi-model-review` skill for parallel quality reviews
- **Brand protection**: Use `copilot-brand-safety` skill for all content
