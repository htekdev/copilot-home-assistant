/**
 * Promo Video Extension -- Exposes a `generate_promo_video` tool that generates
 * Higgsfield Marketing Studio promo videos for {{PERSONAL_DOMAIN}} articles using the V5
 * AI persona framing approach.
 *
 * V5 approach:
 *   - AI avatar speaks AS the AI: "My human wanted me to tell you about..."
 *   - Description-based prompts (not scripts) for natural delivery
 *   - Phonetic domain: "H-tek dot dev"
 *   - 15 second duration, ASCII-only prompts
 *   - Screenshot compositing via medias array
 *
 * Requires: HIGGSFIELD_TOKEN environment variable (bearer token)
 */
import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Constants ────────────────────────────────────────────────────────────────

const AVATAR_ID = "78549570-36fd-4eb5-9a38-3a26c087199b";
const WEBPRODUCT_ID = "953c797a-9a9e-43a8-a997-aa48aaa799da";
const API_BASE = "https://fnf.higgsfield.ai/agents/jobs";
const POLL_INTERVAL_MS = 15000; // 15 seconds
const MAX_POLL_ATTEMPTS = 40; // 10 minutes max

// ── Token Resolution ─────────────────────────────────────────────────────────

const CREDENTIALS_PATH = join(
  process.env.XDG_CONFIG_HOME || join(process.env.HOME || process.env.USERPROFILE || "", ".config"),
  "higgsfield",
  "credentials.json"
);

function getToken() {
  // 1. Higgsfield CLI credentials file (~/.config/higgsfield/credentials.json)
  //    Written by `higgsfield auth login` — preferred method, no manual config needed.
  if (existsSync(CREDENTIALS_PATH)) {
    try {
      const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"));
      if (creds.access_token) return creds.access_token;
    } catch { /* fall through */ }
  }

  // 2. Environment variable override
  if (process.env.HIGGSFIELD_TOKEN) return process.env.HIGGSFIELD_TOKEN;

  // 3. .env file in repo root (legacy fallback)
  const envPath = join(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf-8").match(/^\s*HIGGSFIELD_TOKEN\s*=\s*(.+)/m);
    if (m) {
      const val = m[1].trim().replace(/^["']|["']$/g, "");
      if (val) return val;
    }
  }

  return null;
}

// ── API Helpers ──────────────────────────────────────────────────────────────

async function apiPost(endpoint, body, token) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Higgsfield API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiGet(endpoint, token) {
  const res = await fetch(endpoint, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Higgsfield API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchWebproductScreenshot(token) {
  // Fetch the webproduct to get the mobile screenshot URL
  const wp = await apiGet(
    `https://fnf.higgsfield.ai/marketing-studio/web-products/${WEBPRODUCT_ID}`,
    token
  );
  const mobileUrl = wp?.screenshots?.mobile || wp?.screenshot_mobile_url;
  if (!mobileUrl) {
    throw new Error("Could not find mobile screenshot URL for webproduct");
  }
  return mobileUrl;
}

async function uploadScreenshot(screenshotUrl, token) {
  // Download the screenshot
  const imgRes = await fetch(screenshotUrl);
  if (!imgRes.ok) throw new Error(`Failed to download screenshot: ${imgRes.status}`);
  const imgBuffer = await imgRes.arrayBuffer();

  // Upload to Higgsfield
  const formData = new FormData();
  formData.append("file", new Blob([imgBuffer], { type: "image/png" }), "screenshot.png");

  const uploadRes = await fetch("https://fnf.higgsfield.ai/uploads", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
    body: formData
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(`Upload failed ${uploadRes.status}: ${text}`);
  }
  return uploadRes.json();
}

function buildV5Prompt(articleDescription) {
  // Ensure ASCII-only: strip any unicode dashes/quotes
  const clean = articleDescription
    .replace(/[\u2013\u2014]/g, "--")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');

  return `My human wanted me to tell you about ${clean}. Check it out at H-tek dot dev. <<<web_product:${WEBPRODUCT_ID}>>> <<<avatar:${AVATAR_ID}>>>`;
}

async function pollForCompletion(jobId, token) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const status = await apiGet(`${API_BASE}/${jobId}`, token);
    const state = status?.status || status?.state;
    if (state === "completed" || state === "done") {
      return status;
    }
    if (state === "failed" || state === "error") {
      throw new Error(`Job ${jobId} failed: ${JSON.stringify(status)}`);
    }
  }
  throw new Error(`Job ${jobId} timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
}

// ── Extension Setup ──────────────────────────────────────────────────────────

const session = await joinSession({
  tools: [
    {
      name: "generate_promo_video",
      description:
        "Generate a Higgsfield Marketing Studio promo video for an {{PERSONAL_DOMAIN}} article. " +
        "Uses the V5 AI persona framing approach: the avatar speaks as {{PARENT_1}}'s AI, " +
        "improvising naturally from the article description. Returns video URL when complete. " +
        "Takes 3-8 minutes (video generation + voice cloning). Returns final video with {{PARENT_1}}'s custom voice.",
      parameters: {
        type: "object",
        properties: {
          article_url: {
            type: "string",
            description: "The full {{PERSONAL_DOMAIN}} article URL (e.g. https://{{PERSONAL_DOMAIN}}/articles/my-article/)"
          },
          article_description: {
            type: "string",
            description:
              "Brief description of article content and value (2-3 sentences, plain ASCII text). " +
              "This becomes the AI's talking points -- describe key insights, not a script."
          },
          article_title: {
            type: "string",
            description: "The article title for reference/logging"
          }
        },
        required: ["article_url", "article_description", "article_title"]
      },
      handler: async (args) => {
        const token = getToken();
        if (!token) {
          return "ERROR: No Higgsfield auth token found. Run `higgsfield auth login` to authenticate, or set HIGGSFIELD_TOKEN env var.";
        }

        const { article_url, article_description, article_title } = args;

        // Step 1: Fetch webproduct mobile screenshot
        let screenshotUrl;
        try {
          screenshotUrl = await fetchWebproductScreenshot(token);
        } catch (e) {
          return `ERROR fetching webproduct screenshot: ${e.message}`;
        }

        // Step 2: Upload screenshot as media input
        let upload;
        try {
          upload = await uploadScreenshot(screenshotUrl, token);
        } catch (e) {
          return `ERROR uploading screenshot: ${e.message}`;
        }

        const uploadId = upload.id || upload.upload_id;
        const uploadUrl = upload.url || upload.file_url;

        if (!uploadId || !uploadUrl) {
          return `ERROR: Upload response missing id/url: ${JSON.stringify(upload)}`;
        }

        // Step 3: Build V5 prompt and submit job
        const prompt = buildV5Prompt(article_description);

        const jobPayload = {
          job_set_type: "marketing_studio_video",
          params: {
            prompt,
            mode: "ugc",
            duration: 15,
            aspect_ratio: "9:16",
            resolution: "1080p",
            generate_audio: true,
            avatars: [{ id: AVATAR_ID, type: "custom" }],
            web_product_ids: [WEBPRODUCT_ID],
            medias: [
              {
                role: "image",
                data: {
                  id: uploadId,
                  url: uploadUrl,
                  type: "media_input"
                }
              }
            ]
          }
        };

        let job;
        try {
          job = await apiPost(API_BASE, jobPayload, token);
        } catch (e) {
          return `ERROR submitting job: ${e.message}`;
        }

        const jobId = job.id || job.job_id || job.job_set_id;
        if (!jobId) {
          return `ERROR: No job ID in response: ${JSON.stringify(job)}`;
        }

        // Step 4: Poll video generation until complete
        let videoResult;
        try {
          videoResult = await pollForCompletion(jobId, token);
        } catch (e) {
          return `Video job submitted (ID: ${jobId}) but polling failed: ${e.message}. ` +
            `Check status manually: GET ${API_BASE}/${jobId}`;
        }

        const videoUrl = videoResult.result_url || videoResult.video_url ||
          videoResult.output_url || videoResult.result?.video_url ||
          videoResult.result?.url || videoResult.outputs?.[0]?.url;

        if (!videoUrl) {
          return `Video generated (job ${jobId}) but no URL found. Check: GET ${API_BASE}/${jobId}`;
        }

        // Step 5: Apply {{PARENT_1}}'s custom cloned voice via voice_change_merge
        // This is a post-processing step that replaces generic TTS with the
        // custom voice tied to {{PARENT_1}}'s account/avatar.
        const voicePayload = {
          job_set_type: "voice_change_merge",
          params: {
            input_video: {
              id: jobId,
              url: videoUrl,
              type: "video_job"
            }
          }
        };

        let voiceJob;
        try {
          voiceJob = await apiPost(API_BASE, voicePayload, token);
        } catch (e) {
          // If voice_change_merge fails, return the video without custom voice
          return JSON.stringify({
            status: "completed_without_voice",
            job_id: jobId,
            video_url: videoUrl,
            voice_error: e.message,
            note: "Video generated but custom voice failed. Video uses generic TTS.",
            article_title,
            article_url,
            prompt_used: prompt
          }, null, 2);
        }

        const voiceJobId = voiceJob.id || voiceJob.job_id || voiceJob.job_set_id;
        if (!voiceJobId) {
          return JSON.stringify({
            status: "completed_without_voice",
            job_id: jobId,
            video_url: videoUrl,
            voice_error: "No voice job ID in response",
            article_title,
            article_url,
            prompt_used: prompt
          }, null, 2);
        }

        // Step 6: Poll voice_change_merge until complete
        let voiceResult;
        try {
          voiceResult = await pollForCompletion(voiceJobId, token);
        } catch (e) {
          return JSON.stringify({
            status: "voice_processing",
            video_job_id: jobId,
            voice_job_id: voiceJobId,
            video_url_without_voice: videoUrl,
            voice_error: e.message,
            note: "Voice merge submitted but polling timed out. Check voice job status.",
            voice_poll_url: `${API_BASE}/${voiceJobId}`,
            article_title,
            article_url,
            prompt_used: prompt
          }, null, 2);
        }

        const finalVideoUrl = voiceResult.result_url || voiceResult.video_url ||
          voiceResult.output_url || voiceResult.result?.video_url ||
          voiceResult.result?.url || voiceResult.outputs?.[0]?.url;

        return JSON.stringify({
          status: "completed",
          video_job_id: jobId,
          voice_job_id: voiceJobId,
          video_url: finalVideoUrl || videoUrl,
          voice_applied: !!finalVideoUrl,
          article_title,
          article_url,
          prompt_used: prompt,
          poll_url: `${API_BASE}/${voiceJobId}`
        }, null, 2);
      }
    }
  ]
});
