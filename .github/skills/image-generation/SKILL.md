---
name: image-generation
description: AI image generation for {{GITHUB_USERNAME}} social media — OpenAI gpt-image-2 API, {{PERSONAL_DOMAIN}} brand palette, professional infographic style, and upload workflow. Use when user says "generate image", "create image", "AI image", "post image", "infographic", "social media graphic", "image for post", or any image generation activity.
---

# Image Generation Skill

Canonical workflow for generating AI images for {{GITHUB_USERNAME}} social media posts using OpenAI's gpt-image-2 model.

## Core Rules

1. **Every image MUST be an infographic** — when someone sees it, they should understand the entire post topic at a glance
2. **Every image MUST be premium and professional** — clean, modern, authoritative. Think polished tech company marketing, NOT sci-fi
3. **NEVER use transparent backgrounds** — always specify a solid dark navy-charcoal background
4. **Always include '@{{GITHUB_USERNAME}}' watermark** in small light text, bottom-right corner
5. **1024x1024 square** — works across all platforms
6. **NO stock photos, NO people, NO cartoon illustrations**
7. **Text in images IS expected** — headlines, stats, key points. gpt-image-2 handles text well

## Visual Design System ({{PERSONAL_DOMAIN}} Brand Palette — approved by {{PARENT_1}} 2026-05-15)

The design system is derived from the live {{PERSONAL_DOMAIN}} website palette, extracted via Playwright screenshot. All images must feel like they belong on {{PERSONAL_DOMAIN}}.

### Color Palette
- **Background**: Dark navy-charcoal (#0f172a / #1e293b range) — solid or subtle gradient
- **Primary accent**: Blue (#3b82f6 / #60a5fa range) — buttons, highlights, key numbers
- **Gradient accent**: Blue → purple → pink gradient — used for emphasis bars, borders, badges
- **Secondary accent**: Slate/cool gray (#94a3b8) — secondary text, dividers
- **Text**: White (#f8fafc) for headlines, light gray (#cbd5e1) for body text
- Clean sans-serif typography throughout

### Typography
- Clean, bold sans-serif (Inter/Geist aesthetic)
- White headlines, blue accents for key words/numbers
- Light gray for secondary/body text
- Large but elegant — readable as thumbnail, not shouty

### Effects
- Subtle gradient accent bars or borders (blue → purple → pink)
- Clean card-style layouts with slight depth/shadow
- Minimal decorative elements — content-first design
- Professional infographic look — data visualization, clean sections, clear hierarchy

### NEVER Use
- Neon glow, neon colors, neon accents of any kind
- Cyberpunk or sci-fi aesthetic
- Geometric abstract wireframes, hexagonal grids, circuit-board patterns (RETIRED 2026-05-15)
- Deep purple (#1a0533) backgrounds (OLD palette — retired)
- Gold/lavender color scheme (OLD palette — retired)
- True black backgrounds
- Movie-poster drama or dramatic split/shatter effects
- Particle/ember/spark effects

## API Call Pattern

```python
import openai, base64, os

client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

response = client.images.generate(
    model="gpt-image-2",
    prompt="[DETAILED PROMPT — see templates below]",
    size="1024x1024",
    quality="high",
    response_format="b64_json",
    n=1
)

# Save the image
image_data = base64.b64decode(response.data[0].b64_json)
with open("post_image.png", "wb") as f:
    f.write(image_data)
```

## Prompt Templates

### Default: Infographic Card (use for most posts)

```
Create a premium, professional LinkedIn infographic with the {{PERSONAL_DOMAIN}} brand aesthetic.

BACKGROUND: Dark navy-charcoal (#0f172a) solid background. Clean and minimal.

HEADER: '[POST TITLE / MAIN CLAIM]' in bold clean white (#f8fafc) sans-serif. Subtitle: '[ONE-LINE CONTEXT]' in light gray (#cbd5e1) below. A thin blue→purple→pink gradient accent bar under the header.

BODY: [Adapt based on content — use one of these layouts:]
- **List layout**: Items with small blue (#3b82f6) bullet icons + clean white labels
- **Stats layout**: Key numbers in large blue (#60a5fa) text with white labels below
- **Comparison layout**: Two card sections with subtle borders, separated cleanly
- **Timeline layout**: Connected dots in blue along a thin line with event labels

BOTTOM: '@{{GITHUB_USERNAME}}' in small light gray text, bottom-right.

DESIGN: Dark navy-charcoal background, blue + white + gray palette. Blue→purple→pink gradient accents on key elements (borders, bars, badges). Clean sans-serif typography. Professional, modern, authoritative. NO neon, NO glow, NO cyberpunk, NO geometric wireframes. Square 1024x1024. Solid background (NOT transparent).
```

### Comparison Infographic

```
Create a premium LinkedIn infographic comparing [THING A] vs [THING B] with {{PERSONAL_DOMAIN}} brand aesthetic.

BACKGROUND: Dark navy-charcoal (#0f172a) solid background.

LAYOUT: Vertical split — thin gradient bar (blue→purple→pink) down center. Clean card-style sections on each side.
LEFT: '[THING A]' label in blue (#3b82f6) + 3-4 attributes in light gray (#cbd5e1)
RIGHT: '[THING B]' label in white + 3-4 attributes in white text

HEADER: Bold white headline spanning full width above the split.
BOTTOM: Verdict/conclusion in blue text. '@{{GITHUB_USERNAME}}' bottom-right.

DESIGN: Clean contrast, professional comparison layout. Dark navy-charcoal background, blue + white + gray palette. Blue→purple→pink gradient accent on divider. Square 1024x1024. Solid background (NOT transparent).
```

### Numbered Tips/Tools

```
Create a premium LinkedIn infographic listing [NUMBER] key [tips/tools/insights] with {{PERSONAL_DOMAIN}} brand aesthetic.

BACKGROUND: Dark navy-charcoal (#0f172a) solid background.

HEADER: '[LIST TITLE]' in bold clean white sans-serif. Blue→purple→pink gradient accent bar below.
BODY: Each item has a blue (#3b82f6) number + bold white name + one-line description in light gray (#cbd5e1).
BOTTOM: Key takeaway in blue text. '@{{GITHUB_USERNAME}}' bottom-right.

DESIGN: Dark navy-charcoal background, blue + white + gray palette. Clean sans-serif typography. Professional and organized. Square 1024x1024. Solid background (NOT transparent).
```

### Breaking News

```
Create a premium LinkedIn infographic announcing [NEWS TOPIC] with {{PERSONAL_DOMAIN}} brand aesthetic.

BACKGROUND: Dark navy-charcoal (#0f172a) solid background.

HEADER: '[WHAT HAPPENED]' in bold large white sans-serif. A small blue→purple→pink gradient badge above the headline suggests importance (NOT a red alert — keep it professional).
BODY: 3-4 key facts in clean white text. One highlighted stat as a larger blue (#60a5fa) number. Thin gray separator lines between sections.
BOTTOM: 'What this means →' section with key takeaway in light gray text. '@{{GITHUB_USERNAME}}' bottom-right.

DESIGN: Professional urgency — authoritative, NOT alarming. Dark navy-charcoal background, blue accents, clean typography. Square 1024x1024. Solid background (NOT transparent).
```

## Image Prompt Engineering Rules

- Be specific about layout, colors, and content
- Always specify "dark navy-charcoal (#0f172a) background" explicitly
- Always end with "Square 1024x1024. Solid background (NOT transparent)."
- Include the actual text/numbers you want in the image
- Specify '@{{GITHUB_USERNAME}}' in small light gray text, bottom-right corner
- If the image has a comparison, specify what goes on each side
- NO neon, NO glow, NO cyberpunk, NO geometric wireframes — always use the {{PERSONAL_DOMAIN}} brand palette
- Use blue→purple→pink gradient for accent elements (bars, borders, badges) — NOT as the background

## Upload Workflow

After generating the image, upload to Late for social media:

1. `late_presign_upload(filename="post_image.png", content_type="image/png")`
2. Upload to the returned `uploadUrl` via PUT
3. Use `publicUrl` in `media_items` when creating the post

See `late-publishing` skill for the full publish workflow.

## Failure Handling

- If image generation fails (API error, quota, etc.) → post without image rather than delaying
- If image quality is poor (blurry text, wrong layout) → regenerate with more specific prompt
- Max 2 regeneration attempts before posting text-only
- Log image quality issues to agent working memory for future prompt improvement
