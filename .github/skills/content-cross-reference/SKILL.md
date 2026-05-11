---
name: content-cross-reference
description: {{GITHUB_USERNAME}} asset cross-referencing for content creation — blog post discovery, GitHub repo linking, prior post checking, and ecosystem interconnection. Use when user says "cross-reference", "find related articles", "link blog post", "related repos", "asset discovery", "{{GITHUB_USERNAME}} links", "content ecosystem", or any content cross-referencing activity.
---

# Content Cross-Reference Skill

Canonical workflow for discovering and linking owned content assets (blog posts, GitHub repos, prior social posts) in new content. Every post should feel like part of an interconnected ecosystem, not an isolated piece.

## Why This Exists

The creator's content ecosystem can include blog posts, repositories, and published social posts. When content relates to something the creator has built, written about, or published — it MUST link back into those projects. This is mandatory for all content creation agents.

## Asset Discovery Process (Run for EVERY Post)

### 1. Search Personal Blog Posts

```
exa-web_search_advanced_exa(
  query: "[topic keywords]",
  includeDomains: ["{{PERSONAL_DOMAIN}}"],  # customize for your blog/domain
  numResults: 5,
  enableHighlights: true
)
```

Example: If the video is about a Copilot CLI home assistant → search "copilot CLI home assistant"

### 2. Search Creator GitHub Repos

```
github-mcp-server-search_repositories(query: "[topic] user:{{GITHUB_USERNAME}}")  # customize username
github-mcp-server-search_code(query: "[key terms] org:{{GITHUB_USERNAME}}")  # or user:{{GITHUB_USERNAME}}
```

Example: If video mentions a home assistant project → find the actual repo URL

### 3. Check Content Management Issues

Search `{{CONTENT_PIPELINE_REPO}}` for related issues that might have additional context or prior coverage of the topic.

### 4. Check Prior Posts

Search working memory and Late for previously published posts on the same topic to:
- Avoid repetition
- Enable cross-linking ("Part 2" framing, "As I shared last week...")
- Build content series momentum

## How to Include Links (Platform-Specific)

| Platform | Link Strategy |
|----------|--------------|
| **LinkedIn** | Say "Link in comments" or "Full article on {{PERSONAL_DOMAIN}}" — NEVER put links in post body (kills algorithmic reach). Mention resources by name. |
| **Twitter/X** | Include links directly (short tweets + link work well). Use blog URL or repo URL. |
| **YouTube** | Full URLs in video description. List all relevant resources with descriptions. |
| **Instagram** | "Link in bio" or describe where to find the resource. Links work in Stories. |
| **TikTok** | Mention verbally in captions: "Full breakdown on {{PERSONAL_DOMAIN}}" or "Repo link in bio." |

## What Counts as a Relevant Asset

- Blog posts on {{PERSONAL_DOMAIN}} about the same topic or technology
- GitHub repos that are demonstrated or discussed in the video/post
- Prior LinkedIn/social posts on the same topic (for "Part 2" framing)
- Related tools, extensions, or projects the creator has built
- The video itself on YouTube (cross-platform linking)
- Open-source repos the creator maintains that relate to the topic

## Video Pipeline Integration

When operating in video production pipeline mode:
- Use `research.related_articles` and `research.related_repos` from the context package as mandatory inputs
- Deepen references beyond what research found when needed
- Respect the production plan's `must_reference` fields
- Videos often showcase projects the creator has built — posts MUST link back into those projects

## Output Format

When reporting cross-references to orchestrators or including in output contracts:

```json
{
  "cross_references": {
    "articles_linked": ["https://{{PERSONAL_DOMAIN}}/articles/...", "..."],
    "repos_linked": ["https://github.com/{{GITHUB_USERNAME}}/...", "..."],
    "prior_posts": ["reference to related prior content"]
  }
}
```

## Flagship Topics (Always Check These)

These are the creator's core topics — always check for existing {{PERSONAL_DOMAIN}}/{{GITHUB_USERNAME}} assets:
- Copilot Home Assistant
- Agentic DevOps
- GitHub Copilot CLI
- Agent Mesh
- Multi-Agent Systems
- MCP Servers
- Video Pipeline Automation

## Rules

- **Every post about a project the creator built → MUST include repo link** (at minimum in YouTube description)
- **Every post about a topic the creator already covered in a blog post → MUST reference the blog post**
- **Never post generic "check out my video" without specific ecosystem links**
- **If no assets found → that's fine, but you MUST have searched first**
- **Cross-referencing is mandatory, not optional** — skip only when genuinely no related assets exist
- **SOURCE LINKS ARE MANDATORY** (CRITICAL — from direct feedback): Every generated post MUST include links to the source material it references (articles, announcements, repos, docs, products). If a post discusses something — the URL MUST be in the post body (Twitter, YouTube) or first comment (LinkedIn). No exceptions. A post without source links fails the quality gate.
