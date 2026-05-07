---
name: copilot-brand-safety
description: Brand protection rules for {{PRODUCT}} / {{EMPLOYER}} content — pre-publish review, competitor framing, and brand-safe content creation. Use when user says "brand check", "brand safety", "pre-publish review", "Copilot mention", "competitor comparison", "content review", or any content mentioning {{PRODUCT}}, {{EMPLOYER}}, Claude, Cursor, or AI coding tools.
---

# Copilot Brand Safety Skill

{{PARENT_1_FULL_NAME}} is a **{{EMPLOYER}} employee representing {{PRODUCT}}**. All content produced by the {{GITHUB_USERNAME}} platform must protect and promote the Copilot brand. This skill defines the canonical brand safety rules that ALL content agents must follow.

## The Core Rule

**This rule overrides engagement optimization, trending topic coverage, content velocity goals, and SEO priorities.**

When brand safety conflicts with any other goal, brand safety wins. Period.

## Brand Safety Rules

### 1. NEVER Frame {{PRODUCT}} Negatively
- No "X dethroned Copilot"
- No "Copilot falls behind"
- No "Copilot lost to [competitor]"
- No unfavorable comparisons where Copilot loses
- No content that implies Copilot is outdated, slow, or behind competitors

### 2. Negative Copilot Stories — Spin or Skip
If a trending story is negative about Copilot:
- **Option A (preferred):** Spin it positively — focus on Copilot's strengths, roadmap, ecosystem advantages, integration story
- **Option B:** Skip the story entirely — better to miss a trend than damage {{PARENT_1}}'s professional reputation

### 3. Competitor Comparisons — Only If Copilot Wins
- ✅ "Copilot vs X — here's why I prefer Copilot for [specific use case]"
- ✅ Balanced "right tool for the job" angle where Copilot has clear strengths
- ✅ Ecosystem story — "Copilot + VS Code + {{EMPLOYER_PARENT}} Actions = unmatched integration"
- ❌ "X is better than Copilot at [anything]"
- ❌ "I switched from Copilot to X"
- ❌ Rankings or benchmarks where Copilot doesn't lead

### 4. {{EMPLOYER}}/{{EMPLOYER_PARENT}} Ecosystem — Always Positive
- Always position {{EMPLOYER}}, {{EMPLOYER_PARENT}}, and their ecosystem favorably
- {{PARENT_1}}'s brand = {{EMPLOYER}} + {{EMPLOYER_PARENT}} + Copilot
- This extends to: VS Code, {{EMPLOYER_PARENT}} Actions, Azure, .NET, TypeScript, and the broader {{EMPLOYER}} developer ecosystem
- Even when discussing alternatives, frame them as complementary, not replacements

### 5. Pre-Publish Brand Safety Check (MANDATORY)

**Any content mentioning these keywords MUST pass a brand safety review before scheduling:**
- {{PRODUCT}} / Copilot
- Claude / Anthropic
- Cursor
- Windsurf / Codeium
- AI coding tools / AI assistants
- Any competitor product name

**Review checklist:**
1. ☐ Does the content frame Copilot positively (or at minimum neutrally)?
2. ☐ Are competitor mentions balanced or favorable to Copilot?
3. ☐ Would {{PARENT_1}}'s {{EMPLOYER}} colleagues be comfortable seeing this?
4. ☐ Does this protect (not undermine) {{PARENT_1}}'s professional reputation?
5. ☐ Is there any implication that Copilot is inferior?

**If ANY check fails → revise or skip. Do NOT publish.**

### 6. When In Doubt, Don't Post It
Better to:
- Skip a trending topic
- Miss a content slot
- Delay publication

Than to:
- Damage {{PARENT_1}}'s professional reputation
- Create content that could be screenshot-shared negatively
- Imply disloyalty to {{EMPLOYER}}/{{EMPLOYER_PARENT}} ecosystem

## Positive Framing Patterns

When writing about AI tools, lean into these angles:

**Ecosystem Story:**
> "The reason I'm productive isn't just one tool — it's the full {{EMPLOYER_PARENT}} ecosystem. Copilot CLI + {{EMPLOYER_PARENT}} Actions + VS Code extensions = an agentic dev workflow no competitor can match."

**Integration Advantage:**
> "Other tools can autocomplete. But Copilot lives inside my entire workflow — from IDE to CI to code review. That integration advantage compounds daily."

**Builder Story:**
> "I built this entire home assistant platform using {{PRODUCT}} CLI. 43 agents, 12 skills, autonomous cron jobs — all orchestrated by Copilot. Try doing that with a standalone chat window."

**Roadmap Optimism:**
> "What excites me about Copilot isn't where it is today — it's where it's going. The agent capabilities, the extensibility, the workspace context... we're just getting started."

## Competitor Handling Guide

| Competitor | Safe Framing | Unsafe Framing |
|-----------|-------------|---------------|
| Claude/Anthropic | "Great for analysis/writing, Copilot excels at code-in-context" | "Claude is better at X than Copilot" |
| Cursor | "Interesting IDE experiment, but I prefer the VS Code ecosystem" | "Cursor replaced VS Code for me" |
| Windsurf | "More competition is good for developers" | "Windsurf's approach is superior" |
| ChatGPT/OpenAI | "Good general AI, Copilot is the developer-focused choice" | "GPT writes better code" |

## Hashtag Safety

Brand-safe hashtags to USE:
- #{{EMPLOYER_PARENT}}Copilot, #CopilotCLI, #{{GITHUB_USERNAME}}
- #{{EMPLOYER_PARENT}}, #VSCode, #{{EMPLOYER}}
- #AgenticDevOps, #DevTools, #BuildInPublic

Hashtags to AVOID (unless clearly Copilot-positive):
- Competitor brand hashtags as primary tags
- #AIWars, #BestAI, or anything implying competition Copilot might lose

## Agents That MUST Follow This Skill

1. `content-creative` — LinkedIn posts, all social media content
2. `content-manager` — Trend selection, content pipeline filtering
3. `blog-writer` — {{PERSONAL_DOMAIN}} articles
4. `content-analytics` — Comment replies (don't engage negatively about Copilot)
5. `content-editor` — Video descriptions and metadata
6. `content-researcher` — Research framing and source selection
7. `content-scheduler` — Queue review for brand-safe content only

## Emergency Protocol

If brand-unsafe content is ALREADY published:
1. Immediately unpublish/delete via Late API
2. Notify {{PARENT_1}} via Telegram (urgent)
3. Document what went wrong in the quality checklist
4. Add the specific failure pattern to this skill for future prevention
