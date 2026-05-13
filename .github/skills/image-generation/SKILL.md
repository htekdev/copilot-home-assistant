---
name: image-generation
description: AI image generation for {{GITHUB_USERNAME}} social media — OpenAI gpt-image-2 API, geometric abstract design, premium tech aesthetic, and upload workflow. Use when user says "generate image", "create image", "AI image", "post image", "infographic", "social media graphic", "image for post", or any image generation activity.
---

# Image Generation Skill

Canonical workflow for generating AI images for {{GITHUB_USERNAME}} social media posts using OpenAI's gpt-image-2 model.

## Core Rules

1. **Every image MUST be an infographic** — when someone sees it, they should understand the entire post topic at a glance
2. **Every image MUST be premium and elegant** — sophisticated, future-forward. Think Stripe design language meets AI conference keynote
3. **NEVER use transparent backgrounds** — always specify a solid gradient background (deep purple to midnight blue)
4. **Always include '@{{GITHUB_USERNAME}}' watermark** in small gold text, bottom-right corner
5. **1024x1024 square** — works across all platforms
6. **NO stock photos, NO people, NO cartoon illustrations**
7. **Text in images IS expected** — headlines, stats, key points. gpt-image-2 handles text well

## Visual Design System (Geometric Abstract — chosen by {{PARENT_1}} 2026-05-04)

### Color Palette
- **Base**: Deep purple (#1a0533) to midnight blue (#0a0a2e) gradient
- **Primary accent**: Muted gold (#C9A94C)
- **Secondary accent**: Lavender (#B8A9E8)
- **Text**: Soft white (#F0F0F0), clean sans-serif

### Typography
- Clean, bold sans-serif (Inter/Geist aesthetic)
- White headlines, gold accents for key words/numbers
- Lavender for secondary text
- Large but elegant — readable as thumbnail, not shouty

### Effects
- Subtle geometric wireframe overlays (thin gold lines: hexagonal grids, node networks, circuit-inspired paths)
- Wireframe patterns fade softly at edges
- Abstract geometric shapes — hexagons, interconnected nodes, circuit-board patterns
- Suggests AI/connectivity without being literal

### NEVER Use (Retired 2026-05-04)
- Neon glow, neon colors, neon accents of any kind
- True black backgrounds
- Movie-poster drama or cyberpunk aesthetic
- Dramatic split/shatter/crack effects
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
Create a premium, elegant LinkedIn infographic with geometric abstract design.

BACKGROUND: Deep purple (#1a0533) to midnight blue gradient. Overlaid with subtle geometric wireframe patterns — thin gold (#C9A94C) lines forming [hexagonal grid / node network / circuit paths], fading softly at edges.

HEADER: '[POST TITLE / MAIN CLAIM]' in bold clean white sans-serif. Subtitle: '[ONE-LINE CONTEXT]' in lighter lavender (#B8A9E8) below.

BODY: [Adapt based on content — use one of these layouts:]
- **List layout**: Items with small geometric icons (abstract shapes in gold/lavender outline) + clean white labels
- **Stats layout**: Key numbers in large gold text with white labels below
- **Comparison layout**: Two sections separated by a thin gold line, each with its own geometric accent shape
- **Timeline layout**: Connected nodes in gold along a thin line with event labels

BOTTOM: '@{{GITHUB_USERNAME}}' in small gold text, bottom-right.

DESIGN: Deep purple gradient background, muted gold + lavender + white palette. Thin geometric wireframe overlays. Clean sans-serif typography. Elegant, premium, future-forward. Think Stripe meets AI conference keynote. NO neon, NO glow, NO black backgrounds. Square 1024x1024. Solid gradient background (NOT transparent).
```

### Comparison Infographic

```
Create a premium LinkedIn infographic comparing [THING A] vs [THING B] with geometric abstract design.

BACKGROUND: Deep purple (#1a0533) to midnight blue gradient. Thin gold wireframe grid fading at edges.

LAYOUT: Vertical split — thin gold line down center. Left side has a lavender geometric accent shape, right side has a gold geometric accent shape.
LEFT: '[THING A]' label + 3-4 attributes in muted lavender text
RIGHT: '[THING B]' label + 3-4 attributes in bright white text

HEADER: Bold white headline spanning full width above the split.
BOTTOM: Verdict/conclusion in gold text. '@{{GITHUB_USERNAME}}' bottom-right.

DESIGN: Elegant contrast, NOT dramatic splits or cracks. Sophisticated comparison. Deep purple gradient, gold/lavender/white palette. Square 1024x1024. Solid gradient background (NOT transparent).
```

### Numbered Tips/Tools

```
Create a premium LinkedIn infographic listing [NUMBER] key [tips/tools/insights] with geometric abstract design.

BACKGROUND: Deep purple (#1a0533) to midnight blue gradient. Subtle hexagonal wireframe in gold, fading at edges.

HEADER: '[LIST TITLE]' in bold clean white sans-serif.
BODY: Each item has a small gold geometric number accent + bold white name + one-line description in lavender.
BOTTOM: Key takeaway in gold text. '@{{GITHUB_USERNAME}}' bottom-right.

DESIGN: Deep purple gradient, muted gold + lavender + white. Clean sans-serif typography. Elegant and organized. Square 1024x1024. Solid gradient background (NOT transparent).
```

### Breaking News

```
Create a premium LinkedIn infographic announcing [NEWS TOPIC] with geometric abstract design.

BACKGROUND: Deep purple (#1a0533) to midnight blue gradient. Subtle hexagonal wireframe in gold, denser at top, fading downward.

HEADER: '[WHAT HAPPENED]' in bold large white sans-serif. A small elegant gold diamond or hexagon badge above the headline suggests importance (NOT a red alert — keep it premium).
BODY: 3-4 key facts in clean white text. One highlighted stat as a larger gold number. Thin gold separator lines between sections.
BOTTOM: 'What this means →' section with key takeaway in lavender text. '@{{GITHUB_USERNAME}}' in gold, bottom-right.

DESIGN: Elegant urgency — sophisticated, NOT alarming. Deep purple gradient, gold wireframes, clean typography. Square 1024x1024. Solid gradient background (NOT transparent).
```

## Image Prompt Engineering Rules

- Be specific about layout, colors, and content
- Always specify "deep purple to midnight blue gradient background" explicitly
- Always end with "Square 1024x1024. Solid gradient background (NOT transparent)."
- Include the actual text/numbers you want in the image
- Specify '@{{GITHUB_USERNAME}}' in small gold text, bottom-right corner
- If the image has a comparison, specify what goes on each side
- NO neon, NO glow, NO black backgrounds — always use the Geometric Abstract design system

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
