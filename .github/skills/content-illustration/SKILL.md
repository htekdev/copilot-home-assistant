---
name: content-illustration
description: "Content illustration workflow — generate the mandatory AI hero image first, then create contextual visuals (HTML→Playwright for simple diagrams, AI for concepts), wire heroImage/frontmatter, and inject inline visuals into MDX. Use when user says \"illustrate\", \"add visuals\", \"hero image\", \"generate diagram\", \"content illustration\", \"architecture diagram\", \"process visual\", \"inline images\", or \"backpropagation visuals\"."
---

# Content Illustration Skill

Complete workflow for generating contextual illustrations for {{PERSONAL_DOMAIN}} content. Supports two pipelines: HTML→Playwright for structured visuals and AI generation for conceptual art.

## When to Use This Skill

- After writing a blog article (before PR creation)
- After drafting a blueprint section
- During content-blitz campaign content generation
- During backpropagation through existing articles
- Any time content needs visual explanation

## Mandatory Dispatch Rule (from {{PARENT_1}}, 2026-05-20)

**Every content-producing agent MUST dispatch `content-illustrator` after content creation.** This is a pipeline gate — content is NOT complete without illustrations.

### Who dispatches:
- `blog-writer` — after creating article/newsletter PR
- `blueprint-manager` — after creating/updating blueprint PR
- `content-blitz` — after each merge step (Steps 2, 3, 4)

### How to dispatch:
```
task tool with agent_type: "content-illustrator"
  prompt: "Generate illustrations for [content-type] at [path]. Slug: [slug]. PR: [url]."
```

### What's generated:
1. Mandatory AI hero image (1200×800) → wired into `heroImage` frontmatter
2. Dev.to cover image (1000×420) → wired into `devtoCover` frontmatter
3. 2-4 inline visuals (architecture diagrams, process flows, concept art)
4. All with `{{PERSONAL_DOMAIN}}` branding

**Illustration is part of the content creation pipeline — NOT a separate backprop cycle.**

## Process Overview

```
Read Content → Generate Mandatory AI Hero Image → Write `heroImage` Frontmatter →
  Identify 2-4 Key Concepts → Choose Pipeline Per Concept →
    → [HTML→Playwright] or [AI Generation] →
      → Add {{PERSONAL_DOMAIN}} branding → Optimize (WebP) → Inject into MDX → Verify
```

## Step 1: Mandatory Hero/Caption Image

Every **blog post, article, newsletter, and blueprint** on {{PERSONAL_DOMAIN}} must ship with an **AI-generated hero/caption image**.

**This is the mandatory first step of the workflow.** Do it before deciding on inline visuals.

### Hero requirements
- Final deliverable must be **1200×800** (scaled from 1536×1024 source — full image, NO crop, NO pad)
- Must be **AI-generated** — not a screenshot, not a stock image, not an HTML diagram reused as a banner
- Must feel **beautiful, premium, and shareable**
- Must use the **dark {{PERSONAL_DOMAIN}} tech aesthetic** with subtle accent color
- Must include visible but subtle **`{{PERSONAL_DOMAIN}}`** branding
- Must include a **clear embedded title/headline** that communicates the big idea at a glance
- Must include **embedded labels on the main visual elements** so the image still makes sense off-platform or out of context
- Must be understandable **without requiring the reader to read the article first**
- Must be written into frontmatter using the repo's actual field: **`heroImage`** for `htek-dev-site` articles, blueprints, and newsletters
- **NEVER crop or pad** — scale proportionally only. Social platforms handle their own OG card cropping.

### Hero path convention

```
/images/articles/{article-slug}/hero-og.webp
/images/blueprints/{blueprint-slug}/hero-og.webp
/images/newsletter/{issue-slug}/hero-og.webp
```

### Hero workflow
1. Read the title, subtitle/excerpt, and description
2. Define the single strongest visual metaphor or system composition for the content
3. Generate a wide AI image using the `image-generation` skill / `generate_image` at **1536×1024**
4. Scale proportionally to **1200px wide** (resulting in 1200×800) — **NEVER crop, NEVER pad**
5. Save as optimized WebP (quality 90) in the proper `/public/images/...` folder
6. Write the asset path to `heroImage:` in frontmatter

**⚠️ CRITICAL: No aspect ratio conversion.** gpt-image-2 only supports 1024×1024, 1536×1024, and 1024×1536. The 1536×1024 (3:2 ratio) scales to 1200×800. Do NOT force 1200×630 — that requires cropping 21% of content. Social platforms handle their own OG card cropping from the full image.

## Step 1B: Dev.to Cover Image (Cross-Post Platforms)

When an article will be cross-posted to dev.to (all articles by default), generate a **separate** cover image optimized for dev.to's required dimensions.

### Why a separate image?
- dev.to cover images are **1000×420** (2.38:1 ultra-wide ratio)
- Our hero is 1200×800 (3:2 ratio) — dev.to's `fit=cover` crops ~44% of the height
- We NEVER crop — so we generate a purpose-built image at the correct dimensions

### Dev.to cover requirements
- Final deliverable must be exactly **1000×420**
- Same dark {{PERSONAL_DOMAIN}} brand aesthetic as the hero
- Simpler composition than the hero — fewer elements, bolder text (it displays small)
- Must include the article **title/headline** prominently (readable at small sizes)
- Must include **`{{PERSONAL_DOMAIN}}`** branding (bottom-right, subtle)
- Must be self-explanatory — readers on dev.to see this before clicking

### Dev.to cover workflow
1. After generating the hero (Step 1), generate the dev.to cover
2. Generate at **1536×1024** with a prompt that composes ALL important content within the **center horizontal band** (middle ~42% of height = center 430px of 1024px). Top/bottom are background padding only.
3. Extract the center band: crop vertically to center 430px (y=297 to y=727) → gives 1536×430
4. Scale proportionally to **1000×420** (final deliverable)
5. Convert to WebP (quality 90)
6. Save as `devto-cover.webp` in the same image directory

### Dev.to cover prompt template

```
Create a premium ultra-wide banner for a developer blog post about [TOPIC].

COMPOSITION CRITICAL: This image will be extracted as an ULTRA-WIDE horizontal strip (2.38:1 ratio). ALL important content (title, visual elements, branding) MUST be concentrated in the CENTER 42% of the image height. The top 29% and bottom 29% should be ONLY dark background with no important elements.

HEADER: '[ARTICLE TITLE]' in bold white (#f8fafc) sans-serif, vertically centered in the image. Keep it to 1-2 lines max.

VISUAL: [One strong visual element — icon, simple diagram, or graphic — placed to the LEFT or RIGHT of the title]

BACKGROUND: Dark navy-charcoal (#0f172a) solid background filling the entire canvas.

BRANDING: '{{PERSONAL_DOMAIN}}' in small light gray text, right side, vertically centered.

STYLE: Premium, clean, bold. Blue (#3b82f6) accent on key elements. NO neon, NO glow, NO cyberpunk. Wide 1536x1024. Solid background (NOT transparent).
```

### Dev.to cover post-processing

```python
from PIL import Image

# Load the generated 1536x1024 image
img = Image.open("devto-raw.png")

# Extract center horizontal band (42% of height centered)
# 1024 * 0.42 ≈ 430px band, centered at 512
top = 297  # (1024 - 430) / 2
bottom = 727  # 297 + 430
center_band = img.crop((0, top, 1536, bottom))  # 1536×430

# Scale to exactly 1000×420
devto_cover = center_band.resize((1000, 420), Image.LANCZOS)

# Save as WebP
devto_cover.save("devto-cover.webp", "webp", quality=90)
```

### Dev.to cover path convention

```
/images/articles/{article-slug}/devto-cover.webp
/images/blueprints/{blueprint-slug}/devto-cover.webp
/images/newsletter/{issue-slug}/devto-cover.webp
```

### Frontmatter

Add `devtoCover` to article frontmatter pointing to the dev.to cover:
```yaml
heroImage: /images/articles/my-article/hero-og.webp
devtoCover: /images/articles/my-article/devto-cover.webp
```

The cross-posting GitHub Action reads `devtoCover` for the dev.to `cover_image` field. If absent, falls back to `heroImage` (which will be cropped by dev.to — avoid this).

---

## Step 2: Content Analysis

Read the full article/blueprint and identify concepts that benefit from visual explanation:

**High-value illustration targets:**
- Architecture descriptions ("the system has X components that connect via Y")
- Process descriptions ("first we do A, then B, then C")
- Comparisons ("X differs from Y in these ways")
- Abstract concepts ("orchestration", "event-driven", "multi-agent")
- Data/metrics ("performance improved by 40%")

**Skip — don't illustrate:**
- Simple code snippets (the code IS the visual)
- Personal opinions/hot takes
- Short transitional paragraphs
- Concepts already illustrated by an existing image

**Target count by article length:**
- <500 words: 0-1 illustrations
- 500-1500 words: 1-2 illustrations
- 1500-3000 words: 2-3 illustrations
- 3000+ words: 3-4 illustrations

## Step 3: Pipeline Selection

| Visual Need | Pipeline | Reason |
|-------------|----------|--------|
| Simple system architecture (3-5 distinct elements, boxes + arrows) | HTML→Playwright | Precise layout, editable |
| Simple step-by-step process (3-5 steps) | HTML→Playwright | Sequential, text-heavy |
| Comparison grid/table | HTML→Playwright | Tabular, needs alignment |
| Simple timeline/roadmap | HTML→Playwright | Linear, labeled |
| Simple decision tree | HTML→Playwright | Branching logic |
| Abstract concept (e.g., "AI orchestration") | AI Generation | Creative interpretation |
| Dense architecture, multi-lane workflow, or crowded orchestration map | AI Generation | More visually striking, avoids cramped diagrams |
| Hero/banner image | AI Generation | Artistic impact |
| Metaphorical visualization | AI Generation | Abstract→concrete |

### Hard Selection Rule (MANDATORY)

**Use HTML→Playwright only when the illustration stays simple, spacious, and instantly readable.**

Choose **AI generation instead** when ANY are true:
- The concept needs more than **5-6 distinct visual elements** to make sense
- The layout would require text smaller than **14px** to fit cleanly
- The image is meant to feel **visually stunning / shareable**, not just mechanically precise
- The HTML version feels crowded, busy, or too literal to be worth reposting

**Default heuristic:**
- **HTML→Playwright** = clean explanatory diagrams
- **AI generation** = complex, abstract, or high-impact visuals

## Step 3A: HTML→Playwright Pipeline

### Branding Requirement (MANDATORY)

Every illustration — HTML→Playwright or AI-generated — MUST include visible but subtle **`{{PERSONAL_DOMAIN}}` branding** so shared screenshots still drive traffic back to the site.

**Rules:**
- Use `{{PERSONAL_DOMAIN}}` (not `@{{GITHUB_USERNAME}}`) as the visible brand mark
- Place it as a subtle bottom-right watermark or compact footer chip
- It must be visible at normal article width but never dominate the diagram
- Use the same Luminous Void palette: dark backing, white text, cyan/green accent
- Apply this to articles, blueprints, social visuals, comparison graphics, and backfilled illustration work

### HTML Template Structure

```html
<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0d1117;
    font-family: system-ui, -apple-system, sans-serif;
    padding: 40px;
    width: 1200px;
    min-height: 800px;
    color: #f0f6fc;
  }
  .title {
    font-size: 24px;
    font-weight: 700;
    color: #f0f6fc;
    margin-bottom: 32px;
    text-align: center;
  }
  .container {
    display: flex;
    gap: 24px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 24px;
    min-width: 200px;
  }
  .card-title {
    font-size: 16px;
    font-weight: 600;
    color: #58a6ff;
    margin-bottom: 12px;
  }
  .card-body {
    font-size: 14px;
    color: #8b949e;
    line-height: 1.5;
  }
  .arrow {
    display: flex;
    align-items: center;
    color: #58a6ff;
    font-size: 24px;
  }
  .flow-step {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
  }
  .step-number {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #58a6ff;
    color: #0d1117;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
    flex-shrink: 0;
  }
  .step-text {
    font-size: 16px;
    color: #f0f6fc;
  }
  .highlight {
    color: #58a6ff;
    font-weight: 600;
  }
  .accent-green { color: #3fb950; }
  .accent-purple { color: #bc8cff; }
  .accent-orange { color: #d29922; }
  .connection-line {
    border-left: 2px solid #30363d;
    margin-left: 15px;
    height: 24px;
  }
  .brand-mark {
    position: absolute;
    right: 24px;
    bottom: 20px;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid rgba(88, 166, 255, 0.24);
    background: rgba(13, 17, 23, 0.78);
    color: #f0f6fc;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: lowercase;
  }
  .brand-mark::before {
    content: "";
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: linear-gradient(135deg, #58a6ff, #3fb950);
  }
</style>
</head>
<body>
  <!-- CONTENT GOES HERE -->
  <div class="brand-mark">{{PERSONAL_DOMAIN}}</div>
</body>
</html>
```

### Rendering Commands

```python
# Using Playwright to screenshot the HTML
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1200, "height": 800}, device_scale_factor=2)
    page.set_content(html_content)
    # Wait for any fonts to load
    page.wait_for_timeout(500)
    # Screenshot with appropriate height
    page.screenshot(path="output.png", full_page=True)
    browser.close()

# Convert to WebP
# Use: cwebp output.png -q 85 -o output.webp
# Or via Python Pillow: Image.open("output.png").save("output.webp", "webp", quality=85)
```

### Architecture Diagram Example

```html
<div class="title">Multi-Agent Orchestration Architecture</div>
<div class="container">
  <div class="card" style="border-color: #58a6ff;">
    <div class="card-title">🎯 Orchestrator</div>
    <div class="card-body">Dispatches tasks to specialized agents based on domain ownership</div>
  </div>
  <div class="arrow">→</div>
  <div class="card">
    <div class="card-title accent-green">📝 Blog Writer</div>
    <div class="card-body">Researches, drafts, reviews articles</div>
  </div>
  <div class="card">
    <div class="card-title accent-purple">🎨 Content Creative</div>
    <div class="card-body">Generates images and social posts</div>
  </div>
  <div class="card">
    <div class="card-title accent-orange">📊 Analytics</div>
    <div class="card-body">Tracks engagement, reports performance</div>
  </div>
</div>
```

### Process Flow Example

```html
<div class="title">Article Publishing Pipeline</div>
<div style="max-width: 600px; margin: 0 auto;">
  <div class="flow-step">
    <div class="step-number">1</div>
    <div class="step-text">Research topic via <span class="highlight">Exa + Perplexity</span></div>
  </div>
  <div class="connection-line"></div>
  <div class="flow-step">
    <div class="step-number">2</div>
    <div class="step-text">Write draft in {{PARENT_1}}'s voice</div>
  </div>
  <div class="connection-line"></div>
  <div class="flow-step">
    <div class="step-number">3</div>
    <div class="step-text">Multi-model <span class="highlight">quality review</span></div>
  </div>
  <div class="connection-line"></div>
  <div class="flow-step">
    <div class="step-number">4</div>
    <div class="step-text">Generate <span class="accent-purple">inline illustrations</span></div>
  </div>
  <div class="connection-line"></div>
  <div class="flow-step">
    <div class="step-number" style="background: #3fb950;">✓</div>
    <div class="step-text">Create PR → Vercel preview → <span class="accent-green">Publish</span></div>
  </div>
</div>
```

## Step 3B: AI Generation Pipeline

### Gold Standard Prompting Style (established PR#255, 2026-05-18)

**Every AI-generated illustration must follow this proven structure.** A recent premium technical illustration set the bar — aim for that same standout quality.

#### Core Principles
1. **Conceptual metaphor first** — don't just diagram boxes. Find the visual story (rock climber=model, harness=governance; before/after panels; timeline roadmaps).
2. **Navy-charcoal premium aesthetic** — background #0f172a, blue (#3b82f6) accents, gradient (blue→purple→pink) for emphasis lines.
3. **Self-explanatory** — bold title + labeled elements + subtitles. Image must make sense shared alone on social without article context.
4. **Hyper-specific prompts** — specify exact text, exact layout, exact colors. Never leave composition to chance.

#### Proven Prompt Structure (use for ALL AI illustrations)

```
Create a premium technical illustration for a developer blog about [TOPIC].

CONCEPT: [What it represents + the visual metaphor/storytelling approach. E.g., "A rock climber (the AI model) ascending a cliff (the task) secured by a high-tech harness (governance) with labeled anchor points"]

LAYOUT: [Specific spatial arrangement — radial hub-spoke, vertical timeline, horizontal split, before/after panels, etc. Include element count and positioning.]

HEADER: '[EXACT TITLE TEXT]' in bold white sans-serif at top. Subtitle: '[EXACT SUBTITLE]' in light gray (#cbd5e1).

LABELS/ELEMENTS: [List every visual element with its exact label text. Be exhaustive — every node, card, arrow, zone gets named.]

BACKGROUND: Dark navy-charcoal (#0f172a) solid background.

COLORS: Dark navy background. Blue (#3b82f6) for primary accents and borders. White (#f8fafc) for titles. Light gray (#cbd5e1) for subtitles/descriptions. Green (#3fb950) for success/positive states. Blue→purple→pink gradient for emphasis lines/borders. Cards use slightly lighter dark (#1e293b) with thin blue borders.

BRANDING: '{{PERSONAL_DOMAIN}}' in small light text, bottom-right corner.

STYLE: Premium technical illustration. Clean, modern, professional. NO neon glow, NO cyberpunk, NO sci-fi, NO geometric wireframes. Clean sans-serif typography. Solid dark background (NOT transparent). [SIZE: Square 1024x1024 OR Wide 1536x1024 for heroes].
```

#### Hero-Specific Additions (wide format)

For hero images, append to the prompt:
```
Wide hero composition at 1536x1024. ALL important content (title, labels, key visual elements) must be well within the frame boundaries — compose for the FULL image to be displayed at 1200×800 without any cropping. The visual metaphor should be DRAMATIC and NARRATIVE — tell a story that makes someone want to click through.
```

### Legacy Prompt Template (still valid for simpler illustrations)

```
Create a technical illustration for a developer blog article about [TOPIC].

BACKGROUND: Dark (#0d1117) solid background.

CONTENT: [Describe what the illustration should show — be specific about layout, elements, relationships]

STYLE: Clean, minimal, technical illustration. Use thin cyan (#58a6ff) lines and accents. White (#f0f6fc) text where needed. Gray (#8b949e) for secondary elements. Green (#3fb950) for success/positive elements. Purple (#bc8cff) for categories/groupings.

TEXT IN IMAGE (MANDATORY): Add a clear title/header inside the image plus short labels on the main components, steps, arrows, or zones. The image must be self-explanatory even when shared as a standalone screenshot.

DESIGN: Professional data visualization / technical diagram aesthetic. NO neon glow, NO cyberpunk, NO sci-fi. Clean sans-serif text. Minimal decorative elements. Dark background with bright accent elements.

WATERMARK: `{{PERSONAL_DOMAIN}}` in a subtle bottom-right brand chip or footer mark using the Luminous Void palette.

Square 1024x1024. Solid dark background (NOT transparent).
```

### Wide Format (for hero/banner)

Generate the source image in wide format (`size="1536x1024"`). The image will be proportionally scaled to 1200×800 for display.

**⚠️ DO NOT crop to 1200×630.** The full 3:2 image is the deliverable. Compose all important content within the frame — it will ALL be visible.

Append guidance to the prompt like:

```
Wide hero composition at 1536x1024. ALL important content (title, labels, key visual elements) must be well within the frame boundaries — compose for the FULL image to be displayed without any cropping. This is the final deliverable — no post-processing crop will occur.
```

**Post-process:** Scale proportionally to 1200px wide (→ 1200×800). Convert to WebP quality 90. That's it — no crop, no pad, no aspect ratio change.

### API Call

```python
import openai, base64, os

client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

response = client.images.generate(
    model="gpt-image-2",
    prompt="[DETAILED PROMPT]",
    size="1024x1024",  # or "1536x1024" for wide
    quality="high",
    response_format="b64_json",
    n=1
)

image_data = base64.b64decode(response.data[0].b64_json)
with open("illustration.png", "wb") as f:
    f.write(image_data)
```

## Step 4: Image Optimization

All images must be converted to WebP before injection:

```bash
# From PNG to WebP (quality 85, max 500KB)
cwebp input.png -q 85 -o output.webp

# Verify file size
# If > 500KB, reduce quality to 75 and retry
cwebp input.png -q 75 -o output.webp
```

## Step 5: MDX Injection

### Image Placement Rules

1. Place the image AFTER the heading of the section it illustrates
2. Never place two images back-to-back — at least one paragraph between them
3. First illustration should appear within the first 30% of the article
4. Last illustration should not be at the very end (leave room for conclusion)

### MDX Image Format

```mdx
![Architecture diagram showing the multi-agent orchestration system with orchestrator dispatching to specialized agents](/images/articles/multi-agent-patterns/architecture-overview.webp)
*Figure 1: The orchestrator dispatches tasks to domain-specific agents, each owning a piece of the content pipeline.*
```

### Image Path Convention

```
/images/articles/{article-slug}/hero-og.webp
/images/articles/{article-slug}/{image-name}.webp
/images/blueprints/{blueprint-slug}/hero-og.webp
/images/blueprints/{blueprint-slug}/{image-name}.webp
/images/newsletter/{issue-slug}/hero-og.webp
/images/newsletter/{issue-slug}/{image-name}.webp
```

Image names should be descriptive:
- `hero-og.webp`
- `architecture-overview.webp`
- `pipeline-flow.webp`
- `comparison-grid.webp`
- `concept-orchestration.webp`

## Step 6: Visual Inspection (MANDATORY)

**⚠️ NEVER generate and push blindly.** After generating EACH image, you MUST visually inspect it before committing:

1. **View the generated PNG** using the `view` tool (it renders images inline)
2. **Confirm**: Full content visible? No cropping? No garbled text? Labels readable? Branding present?
3. **If issues found**: Regenerate with adjusted prompt (max 2 retries)
4. **Only after visual confirmation** → proceed to WebP conversion and commit

The workflow is: **generate → view/inspect → confirm quality → convert → commit**. NOT: generate → commit → hope.

## Step 7: Quality Checklist

Before finalizing, verify each illustration:

- [ ] Hero image exists for the content item and is wired into frontmatter via `heroImage`
- [ ] Hero image is **1200×800** (full proportional scale from 1536×1024, NO crop, NO pad)
- [ ] Dev.to cover exists at **1000×420** and is wired into frontmatter via `devtoCover`
- [ ] **Visually inspected** — full content visible, nothing cut off at edges
- [ ] Image renders correctly (no broken elements)
- [ ] Text in image is readable at article width (if HTML→Playwright)
- [ ] No garbled/distorted text (if AI generated)
- [ ] Colors match the Luminous Void palette
- [ ] Alt text is descriptive and accessible
- [ ] Caption adds context beyond what's visible
- [ ] File size < 500KB
- [ ] Image dimensions appropriate for display context
- [ ] `{{PERSONAL_DOMAIN}}` branding is present, visible, and not distracting
- [ ] AI-generated visuals include an embedded title/headline
- [ ] AI-generated visuals include labels on the key components, arrows, or regions
- [ ] The image is understandable as a standalone screenshot without article context
- [ ] No brand safety issues (no competitor logos, no negative framing)
- [ ] HTML visuals stay under the simplicity threshold (roughly 3-5 core elements, never more than 5-6)
- [ ] If the composition feels crowded or would need sub-14px text, it was upgraded to AI instead of forced into HTML

## Integration: How Other Agents Invoke This

### From blog-writer (after article is written):

```
Invoke content-illustration skill:
- Read the article I just wrote at {path}
- Generate the mandatory AI hero image first
- Save it to `/public/images/articles/{slug}/hero-og.webp`
- Write the frontmatter field `heroImage`
- Identify 2-4 concepts that need visual explanation
- Generate inline illustrations using the appropriate pipeline
- Return the hero path, frontmatter update, image paths, and MDX injection snippets
```

### From blueprint-manager (during draft):

```
Invoke content-illustration skill:
- Generate the mandatory AI hero image first for the blueprint
- Save it to `/public/images/blueprints/{slug}/hero-og.webp`
- Write the frontmatter field `heroImage`
- This blueprint section describes {architecture/process}
- Generate the needed inline visual(s) for the section
- Use HTML→Playwright only if the diagram stays simple; otherwise switch to AI
- Return the hero path, frontmatter update, and MDX snippet(s)
```

### Standalone backpropagation (cron):

```
1. Load working.md for progress
2. Find next unillustrated article in {{GITHUB_USERNAME}}/personal-site
3. Read content, identify illustration opportunities
4. Generate images
5. Create branch, inject images, create PR
6. Update working.md
```

## Failure Handling

- **HTML→Playwright fails**: Check HTML syntax, fall back to simpler layout
- **AI generation returns poor quality**: Regenerate with more specific prompt (max 2 retries)
- **Image too large (>500KB)**: Reduce WebP quality to 75, then 60
- **All pipelines fail**: Skip this illustration, continue to next. Log error.
- **Max retries exhausted**: Report to {{PARENT_1}} via Telegram, move to next article

## Anti-Patterns

- ❌ Illustrating code snippets (the code is already visual)
- ❌ Generic stock-photo-style images with no informational value
- ❌ Illustrations that require reading the article to understand (should be self-explanatory)
- ❌ More than 4 illustrations per article (visual fatigue)
- ❌ Identical visual style for every image (vary between architecture, flow, concept)
- ❌ Placing images without alt text (accessibility violation)
- ❌ Using bright/light backgrounds that clash with {{PERSONAL_DOMAIN}} dark theme

## {{PERSONAL_DOMAIN}} Site Specifics

### Repository & Tech Stack
- **Repo**: `{{GITHUB_USERNAME}}/personal-site` (local: `C:\Repos\{{GITHUB_USERNAME}}\personal-site`)
- **Framework**: Astro 5 + MDX + Tailwind CSS 4 + Vercel
- **Image handling**: No Astro `<Image>` component — uses standard markdown `![alt](src)` rendered to `<img>`
- **Rehype plugins**: `rehype-lazy-images` adds `loading="lazy"` and `decoding="async"` to all inline images automatically
- **Article layout** applies: `border-radius: 0.5rem`, `margin-top/bottom: 1.5rem`, `max-width: 100%`, `height: auto`
- **Caption styling**: `*italic text*` immediately after an image renders as a centered gray caption (0.875rem, #8b949e)

### Directory Convention
```
public/images/articles/{article-slug}/    # Article illustrations
public/images/blueprints/{blueprint-slug}/ # Blueprint illustrations
public/articles/                          # LEGACY — don't add new files here
```

### Current State (customize for your site)
- Audit your article inventory in `src/content/articles/` and identify which pieces still need illustrations
- Track which articles already have hero/inline visuals versus none
- If you have legacy image folders or flat PNG assets, plan a migration into `/public/images/...` with WebP output

### What the Agent Needs to Do (per article)
1. Create directory: `public/images/articles/{slug}/`
2. Generate images, convert to WebP, save to that directory
3. Inject markdown image syntax into the MDX file
4. All in one PR branch per article

### MDX Injection Example (real)
```mdx
Some paragraph text explaining the architecture...

![Multi-agent orchestration diagram showing the orchestrator dispatching tasks to blog-writer, content-creative, and analytics agents](/images/articles/multi-agent-orchestration-patterns/architecture-overview.webp)
*The orchestrator dispatches tasks based on domain ownership — each agent handles its specialty independently.*

The key insight here is that...
```

### No Build-Time Optimization (yet)
- Images served as-is from `public/` (Vercel CDN handles caching/compression)
- WebP at quality 85 is the optimization — do it at generation time
- Future: may add Astro `<Image>` component or Vercel Image Optimization

