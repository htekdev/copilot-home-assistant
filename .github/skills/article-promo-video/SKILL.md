# Article Promo Video Generation

## Purpose
Generate high-quality Marketing Studio promo videos for {{PERSONAL_DOMAIN}} articles using Higgsfield AI -- specifically the **screenshot compositing** workflow that renders real article content faithfully on a phone screen.

## Why This Skill Exists
The standard CLI `generate create marketing_studio_video` command **cannot** trigger Higgsfield's screenshot compositing pipeline. The API ignores `specific_mode`, `web_product_type`, and similar fields when sent via CLI or direct API. The workaround -- passing the mobile screenshot as a `medias` input -- triggers the same prompt enhancement the UI uses, producing faithful phone-screen renders instead of AI-hallucinated text.

---

## Prerequisites

| Asset | ID | Notes |
|-------|-----|-------|
| Avatar "{{PARENT_1}}" | `78549570-36fd-4eb5-9a38-3a26c087199b` | Custom avatar with linked voice |
| Avatar "{{GITHUB_USERNAME}}" | `9b18199b-22be-45bb-a200-999ef049c5c8` | Brand avatar |
| Webproduct {{PERSONAL_DOMAIN}} | `953c797a-9a9e-43a8-a997-aa48aaa799da` | Base domain |
| Auth token | `~/.config/higgsfield/credentials.json` | Auto-read from CLI login; run `higgsfield auth login` once |

---

## Authentication

Auth is handled automatically via the Higgsfield CLI credentials file:

```bash
# One-time login (opens browser)
higgsfield auth login
```

This saves `access_token` and `refresh_token` to `~/.config/higgsfield/credentials.json`. The `generate_promo_video` extension tool reads this file at runtime -- no manual token management needed.

**Token resolution order:**
1. `~/.config/higgsfield/credentials.json` (CLI login -- preferred)
2. `HIGGSFIELD_TOKEN` environment variable (override)
3. `.env` file in repo root (legacy fallback)

If the token expires, just re-run `higgsfield auth login`.

---

## Canonical Approach: V5 (AI Persona Framing)

This is the **default and recommended** approach for all article promo videos. The AI avatar speaks AS the AI -- not as {{PARENT_1}} -- creating a natural, improvised delivery.

### Core Principles

1. **AI persona framing**: The avatar speaks as {{PARENT_1}}'s AI assistant. Opening line: "My human wanted me to tell you about..."
2. **Description, not script**: Give the model a DESCRIPTION of the article's key points and value prop. Do NOT write a word-for-word script. Let the AI improvise naturally.
3. **Phonetic domain**: Always spell "H-tek dot dev" phonetically for TTS. Never write "{{PERSONAL_DOMAIN}}" literally.
4. **Duration**: 15 seconds.
5. **ASCII-only prompts**: No em-dashes, curly quotes, or unicode characters. They get garbled to nonsense like "a]". Use -- for dashes, straight quotes only.
6. **Custom voice**: {{PARENT_1}}'s cloned voice requires a **two-step process**: first generate video with `generate_audio: true`, then apply `voice_change_merge` post-processing. The voice is tied to the account -- no `voice_id` parameter needed.

### V5 Prompt Template

```
My human wanted me to tell you about [ARTICLE DESCRIPTION -- 2-3 sentences describing what the article covers, its key insight, and why it matters]. Check it out at H-tek dot dev. <<<web_product:953c797a-9a9e-43a8-a997-aa48aaa799da>>> <<<avatar:78549570-36fd-4eb5-9a38-3a26c087199b>>>
```

### V5 Example Prompts

**Article about context engineering:**
```
My human wanted me to tell you about his breakdown of context engineering patterns for AI agents -- how to structure memory, skills, and instructions so your copilot actually understands your codebase. It is the system he uses every day. Check it out at H-tek dot dev. <<<web_product:953c797a-9a9e-43a8-a997-aa48aaa799da>>> <<<avatar:78549570-36fd-4eb5-9a38-3a26c087199b>>>
```

**Article about agentic development:**
```
My human wanted me to tell you about his guide to agentic development -- building AI systems that actually ship code autonomously instead of just autocompleting. He covers the architecture, the guardrails, and the real results. Check it out at H-tek dot dev. <<<web_product:953c797a-9a9e-43a8-a997-aa48aaa799da>>> <<<avatar:78549570-36fd-4eb5-9a38-3a26c087199b>>>
```

### Why V5 Works Best

- The AI persona framing gives the model a clear character to embody -- no awkward "am I {{PARENT_1}} or a narrator?" confusion
- Description-based prompts let the model find natural pacing and emphasis
- The improvised delivery sounds authentic, not robotic or over-rehearsed
- 15 seconds is the sweet spot for social media attention spans

---

## Extension Tool

Use the `generate_promo_video` extension tool (in `.github/extensions/promo-video/extension.mjs`) for one-call video generation. It handles screenshot fetching, prompt construction, and API submission automatically.

---

## Manual 4-Step Workflow

For cases where you need manual control or the extension is unavailable.

### Step 1: Fetch Article as Webproduct

```bash
higgsfield marketing-studio webproducts fetch --url "https://{{PERSONAL_DOMAIN}}/articles/<slug>/" --wait
```

This creates a webproduct entity with mobile/desktop screenshots. Save the returned `webproduct_id`.

**If the article is already fetched**, find it:
```bash
higgsfield marketing-studio webproducts list
```

### Step 2: Upload Mobile Screenshot as Media Input

Download the mobile screenshot from the webproduct's `screenshots.mobile` URL, then upload:

```bash
higgsfield upload create <path-to-mobile-screenshot.png>
```

Save the returned `upload_id` and `url`.

### Step 3: Generate Video via Direct API

The CLI cannot pass `medias` correctly. Use a direct API call:

```bash
curl -X POST "https://fnf.higgsfield.ai/agents/jobs" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "job_set_type": "marketing_studio_video",
    "params": {
      "prompt": "My human wanted me to tell you about [DESCRIPTION]. Check it out at H-tek dot dev. <<<web_product:953c797a-9a9e-43a8-a997-aa48aaa799da>>> <<<avatar:78549570-36fd-4eb5-9a38-3a26c087199b>>>",
      "mode": "ugc",
      "duration": 15,
      "aspect_ratio": "9:16",
      "resolution": "1080p",
      "generate_audio": true,
      "avatars": [{"id": "78549570-36fd-4eb5-9a38-3a26c087199b", "type": "custom"}],
      "web_product_ids": ["953c797a-9a9e-43a8-a997-aa48aaa799da"],
      "medias": [
        {
          "role": "image",
          "data": {
            "id": "<upload_id>",
            "url": "<upload_url>",
            "type": "media_input"
          }
        }
      ]
    }
  }'
```

**Critical parameters:**
- `medias[].data.type` MUST be `"media_input"` (not `"image"`)
- `<<<web_product:ID>>>` and `<<<avatar:ID>>>` template syntax triggers backend resolution
- `mode: "ugc"` gives natural presenter + phone screen format
- The `medias` image triggers the screenshot compositing pipeline
- `generate_audio: true` + custom avatar = {{PARENT_1}}'s cloned voice automatically

### Step 4: Poll for Completion

```bash
curl -H "Authorization: Bearer <token>" \
  "https://fnf.higgsfield.ai/agents/jobs/<job_id>"
```

Poll every 15-30 seconds. Job is done when `status` is `"completed"`. Video URL is in `result_url`.

### Step 5: Apply Custom Voice (voice_change_merge)

**This is REQUIRED for {{PARENT_1}}'s cloned voice.** The `generate_audio: true` parameter only produces generic TTS. To get {{PARENT_1}}'s custom voice, submit a separate `voice_change_merge` job:

```bash
curl -X POST "https://fnf.higgsfield.ai/agents/jobs" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "job_set_type": "voice_change_merge",
    "params": {
      "input_video": {
        "id": "<video_job_id>",
        "url": "<video_result_url>",
        "type": "video_job"
      }
    }
  }'
```

**Key details:**
- No `voice_id` needed -- the custom voice is tied to {{PARENT_1}}'s account
- `input_video.type` MUST be `"video_job"`
- The source video must have `generate_audio: true` (provides the speech content to re-voice)
- Poll this job the same way as Step 4
- Final video URL with custom voice is in the `result_url` field

---

## Prompt Rules (All Approaches)

### TTS Pronunciation -- MANDATORY

**"{{PERSONAL_DOMAIN}}" MUST be spelled phonetically in ALL prompts:**

- CORRECT: `"H-tek dot dev"`
- WRONG: `"{{PERSONAL_DOMAIN}}"` (TTS will mangle this every time)

### ASCII-Only -- MANDATORY

**No unicode characters in prompts.** They get garbled by the TTS pipeline:

- CORRECT: `--` for dashes, `"straight quotes"`
- WRONG: em-dashes, curly quotes, special characters

### Required Elements -- NEVER Remove

These must be present in EVERY video generation call:
- `avatars` array with {{PARENT_1}}'s custom avatar ID
- `web_product_ids` with the webproduct ID
- `medias` array with the uploaded mobile screenshot (type: `"media_input"`)
- `<<<web_product:ID>>>` and `<<<avatar:ID>>>` template tokens in prompt text
- `generate_audio: true` for speech content generation
- **Post-processing `voice_change_merge` job** for {{PARENT_1}}'s custom cloned voice

---

## Modes Reference

| Mode | Best For |
|------|----------|
| `ugc` | Natural presenter + phone screen (DEFAULT) |
| `product_showcase` | Product-focused, phone center frame |
| `spokesperson` | Formal presenter style |
| `street_interview` | Casual, outdoor feel |
| `podcast` | Sit-down discussion format |

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Garbled text on screen | Missing `medias` input | Add mobile screenshot as `media_input` |
| Wrong voice | Missing voice_change_merge step | Add post-processing: submit voice_change_merge job after video completes |
| "Invalid type" error | `medias[].data.type` set wrong | Must be `"media_input"` |
| CLI ignores parameters | CLI cannot pass `medias` array | Use direct API (curl/fetch) |
| Unicode garbling (a]) | Em-dashes/unicode in prompt | ASCII-only -- use straight dashes and quotes |
| TTS says "htek do" | Literal domain in prompt | Spell phonetically: "H-tek dot dev" |

---

## Integration Notes

- **`generate_promo_video` tool**: One-call extension for automated video generation
- **content-creative agent**: Can call this workflow for scheduled article promotions
- **content-manager agent**: Tracks which articles have promo videos generated
- **Automation**: Fully scriptable via extension tool or manual API calls
- **Cost**: Each video generation uses ~1 Higgsfield credit (included in Pro plan)
