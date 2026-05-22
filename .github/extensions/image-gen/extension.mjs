/**
 * Image Generation Extension — Exposes a `generate_image` tool that calls
 * OpenAI's gpt-image-2 API to create {{{{EMPLOYER_PARENT}}_USERNAME}}-branded infographic images.
 *
 * Design system defaults (from image-generation skill):
 *   - 1024x1024 square
 *   - Black background, neon accents (teal, green, red, orange)
 *   - Bold sans-serif typography, glow/bloom effects
 *   - @{{{{EMPLOYER_PARENT}}_USERNAME}} watermark, no photos/people/illustrations
 *
 * API key resolution: VidPipe config → env var → .env file.
 */
import { joinSession } from "@{{EMPLOYER_PARENT}}/copilot-sdk/extension";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ── API Key Resolution ──────────────────────────────────────────────────────

function getApiKey() {
  // 1. VidPipe config (shared credentials store — matches video-analyzer pattern)
  const vidpipeCfg = join(process.env.APPDATA || process.env.HOME, "vidpipe", "config.json");
  if (existsSync(vidpipeCfg)) {
    try {
      const cfg = JSON.parse(readFileSync(vidpipeCfg, "utf-8"));
      if (cfg.credentials?.openaiApiKey) return cfg.credentials.openaiApiKey;
    } catch { /* fall through */ }
  }

  // 2. Environment variable
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;

  // 3. .env file in repo root
  const envPath = join(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf-8").match(/^\s*OPENAI_API_KEY\s*=\s*(.+)/m);
    if (m) {
      const val = m[1].trim().replace(/^["']|["']$/g, "");
      if (val) return val;
    }
  }

  return null;
}

// ── Design System — {{{{EMPLOYER_PARENT}}_USERNAME}} prompt injection ────────────────────────────────

const DESIGN_SYSTEM = `
DESIGN RULES (MANDATORY):
- Solid BLACK background (not navy, not charcoal — true #000000 black)
- Primary accent colors: electric teal, neon green
- Warning/contrast colors: hot red/orange, neon amber
- Text: white, bold sans-serif typography — ENORMOUS, readable as thumbnail
- Neon glow and light bloom effects on key elements
- '@{{{{EMPLOYER_PARENT}}_USERNAME}}' watermark text in bottom-right corner
- Square 1024x1024
- NO photos, NO people, NO cartoon illustrations, NO stock imagery
- This is an INFOGRAPHIC — the viewer should understand the topic at a glance
- SCROLL-STOPPING: bold, dramatic, high-contrast. NOT muted corporate slides
`.trim();

// ── Prompt Templates (from image-generation skill) ──────────────────────────

const TEMPLATES = {
  infographic: (prompt) => `Create a DRAMATIC, scroll-stopping LinkedIn infographic with the following layout:

HEADER: Giant bold glowing headline text relevant to the topic. Subtitle below in slightly smaller but still bold text.

BODY: ${prompt}

BOTTOM: Bold high-contrast banner with key takeaway. '@{{{{EMPLOYER_PARENT}}_USERNAME}}' in bottom-right.

${DESIGN_SYSTEM}`,

  comparison: (prompt) => `Create a DRAMATIC, scroll-stopping LinkedIn infographic comparison:

VISUAL: Dramatic diagonal split or jagged crack dividing the image in half.
${prompt}

BOTTOM: Bold verdict banner. '@{{{{EMPLOYER_PARENT}}_USERNAME}}' footer.

${DESIGN_SYSTEM}`,

  tips: (prompt) => `Create a DRAMATIC, scroll-stopping LinkedIn infographic listing key tips/tools/insights:

HEADER: Giant bold glowing title.
BODY: ${prompt}
Each item has HUGE glowing number accent + bold name + one-line description.
BOTTOM: Key takeaway banner. '@{{{{EMPLOYER_PARENT}}_USERNAME}}' footer.

${DESIGN_SYSTEM}`,

  breaking_news: (prompt) => `Create a DRAMATIC, scroll-stopping LinkedIn infographic announcing breaking news:

HEADER: Giant bold headline. Bright red/amber 'BREAKING' badge with glow.
BODY: ${prompt}
One MASSIVE glowing stat number if applicable.
BOTTOM: 'What this means:' takeaway section. '@{{{{EMPLOYER_PARENT}}_USERNAME}}' footer.

${DESIGN_SYSTEM}`,
};

// ── Image Generation ────────────────────────────────────────────────────────

async function generateImage(prompt, size, stylePreset) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY not set. Configure it in one of these locations:\n" +
      "  1. %APPDATA%/vidpipe/config.json → credentials.openaiApiKey (preferred)\n" +
      "  2. OPENAI_API_KEY environment variable\n" +
      "  3. .env file in repo root: OPENAI_API_KEY=sk-your-key-here\n" +
      "No restart needed — key is read on each call."
    );
  }

  // Apply style template if specified; otherwise use prompt AS-IS (no design system injection)
  let finalPrompt;
  if (stylePreset && TEMPLATES[stylePreset]) {
    finalPrompt = TEMPLATES[stylePreset](prompt);
  } else {
    // Clean mode — let the model generate naturally without forced neon/black styling
    finalPrompt = prompt;
  }

  // Call OpenAI Images API
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: finalPrompt,
      size: size || "1024x1024",
      quality: "high",
      n: 1,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${errBody}`);
  }

  const data = await res.json();

  // gpt-image-2 returns b64_json by default
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    // Fallback: might return a URL
    const url = data.data?.[0]?.url;
    if (url) {
      // Download the image
      const imgRes = await fetch(url);
      if (!imgRes.ok) throw new Error("Failed to download generated image");
      const imgBuf = Buffer.from(await imgRes.arrayBuffer());
      return saveImage(imgBuf);
    }
    throw new Error("No image data returned from API");
  }

  const imageBuffer = Buffer.from(b64, "base64");
  return saveImage(imageBuffer);
}

function saveImage(buffer) {
  // Save to a predictable location in the repo for easy access
  const outputDir = join(process.cwd(), "data", "generated-images");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `img-${timestamp}-${randomUUID().slice(0, 8)}.png`;
  const filePath = join(outputDir, filename);

  writeFileSync(filePath, buffer);
  return filePath;
}

// ── Image-to-Image Generation (Edit from reference) ─────────────────────────

async function generateImageFromImage(prompt, imagePaths, size, mask) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY not set. Configure it in one of these locations:\n" +
      "  1. %APPDATA%/vidpipe/config.json → credentials.openaiApiKey (preferred)\n" +
      "  2. OPENAI_API_KEY environment variable\n" +
      "  3. .env file in repo root: OPENAI_API_KEY=sk-your-key-here"
    );
  }

  // Build multipart form data
  const { FormData, Blob } = await import("node:buffer").then(() => globalThis).catch(() => ({}));
  // Use undici or native fetch FormData
  const formData = new (globalThis.FormData || (await import("undici")).FormData)();

  formData.append("model", "gpt-image-2");
  formData.append("prompt", prompt);

  if (size) {
    formData.append("size", size);
  }
  formData.append("quality", "high");

  // Append image(s) — the API accepts image[] for multiple references
  for (const imgPath of imagePaths) {
    const resolvedPath = join(process.cwd(), imgPath).replace(/\\/g, "/");
    const absPath = existsSync(imgPath) ? imgPath : resolvedPath;
    if (!existsSync(absPath)) {
      throw new Error(`Source image not found: ${imgPath}`);
    }
    const imgBuffer = readFileSync(absPath);
    const ext = absPath.split(".").pop().toLowerCase();
    const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "webp" ? "image/webp"
      : "image/png";
    const blob = new Blob([imgBuffer], { type: mimeType });
    formData.append("image[]", blob, basename(absPath));
  }

  // Append mask if provided
  if (mask) {
    const maskPath = existsSync(mask) ? mask : join(process.cwd(), mask);
    if (!existsSync(maskPath)) {
      throw new Error(`Mask image not found: ${mask}`);
    }
    const maskBuffer = readFileSync(maskPath);
    const blob = new Blob([maskBuffer], { type: "image/png" });
    formData.append("mask", blob, basename(maskPath));
  }

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${errBody}`);
  }

  const data = await res.json();

  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    const url = data.data?.[0]?.url;
    if (url) {
      const imgRes = await fetch(url);
      if (!imgRes.ok) throw new Error("Failed to download generated image");
      const imgBuf = Buffer.from(await imgRes.arrayBuffer());
      return saveImage(imgBuf);
    }
    throw new Error("No image data returned from API");
  }

  const imageBuffer = Buffer.from(b64, "base64");
  return saveImage(imageBuffer);
}

// ── Extension Entry Point ───────────────────────────────────────────────────

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      const hasKey = !!getApiKey();
      return {
        additionalContext: hasKey
          ? "[image-gen] ✅ Ready. Tools: generate_image (text→image), generate_image_from_image (image→image edit/reference). Style presets: infographic, comparison, tips, breaking_news."
          : "[image-gen] ⚠️ OPENAI_API_KEY not set. Add it to .env to enable image generation.",
      };
    },
  },

  tools: [
    {
      name: "generate_image",
      description:
        "Generate an AI image using OpenAI gpt-image-2. Applies {{{{EMPLOYER_PARENT}}_USERNAME}} design system by default " +
        "(black bg, neon accents, bold typography, @{{{{EMPLOYER_PARENT}}_USERNAME}} watermark). " +
        "Returns the local file path of the saved PNG. " +
        "Style presets: 'infographic' (default card), 'comparison' (A vs B split), " +
        "'tips' (numbered list), 'breaking_news' (urgent announcement).",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "Image description or content to visualize. Be specific about text, numbers, and layout you want in the image.",
          },
          size: {
            type: "string",
            description:
              "Image dimensions. Default: '1024x1024'. Options: '1024x1024' (square), '1536x1024' (landscape), '1024x1536' (portrait).",
          },
          style_preset: {
            type: "string",
            description:
              "Design template to apply. Options: 'infographic' (general card), 'comparison' (A vs B), " +
              "'tips' (numbered tips/tools), 'breaking_news' (urgent announcement). Omit for raw prompt with design system defaults.",
          },
          output_filename: {
            type: "string",
            description:
              "Optional custom filename (without extension). Default: auto-generated timestamp-based name.",
          },
        },
        required: ["prompt"],
      },
      handler: async (args) => {
        const startTime = Date.now();
        try {
          await session.log("🎨 Generating image with gpt-image-2...", { ephemeral: true });

          const filePath = await generateImage(args.prompt, args.size, args.style_preset);

          // Rename if custom filename provided
          let finalPath = filePath;
          if (args.output_filename) {
            const dir = join(process.cwd(), "data", "generated-images");
            const customPath = join(dir, `${args.output_filename}.png`);
            const { renameSync } = await import("node:fs");
            renameSync(filePath, customPath);
            finalPath = customPath;
          }

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          await session.log(`✅ Image generated in ${elapsed}s`);

          return [
            `✅ Image generated successfully!`,
            `📁 File: ${finalPath}`,
            `⏱️ Time: ${elapsed}s`,
            `📐 Size: ${args.size || "1024x1024"}`,
            `🎨 Style: ${args.style_preset || "default (design system applied)"}`,
            ``,
            `To upload for social media, use:`,
            `  late_presign_upload(filename="${basename(finalPath)}", content_type="image/png")`,
            `  Then PUT the file to the returned uploadUrl.`,
          ].join("\n");
        } catch (e) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          await session.log(`❌ Image generation failed (${elapsed}s)`, { level: "error" });
          return {
            textResultForLlm: `❌ Image generation failed: ${e.message}`,
            resultType: "failure",
          };
        }
      },
    },

    {
      name: "generate_image_from_image",
      description:
        "Generate a new AI image using one or more source images as reference (image-to-image). " +
        "Uses OpenAI gpt-image-2 /v1/images/edits endpoint. " +
        "Use cases: edit an existing image, generate a new image using reference images for style/content, " +
        "composite multiple images into one, or apply a mask for targeted edits. " +
        "Returns the local file path of the saved PNG.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "Text prompt describing what to generate or how to modify the source image(s). " +
              "Be specific about the desired output — the model uses both the image(s) and this prompt.",
          },
          source_images: {
            type: "array",
            items: { type: "string" },
            description:
              "Array of file paths to source/reference images (1-4 images). " +
              "Can be absolute paths or relative to the repo root. " +
              "Supported formats: PNG, JPEG, WebP. Max 50MB each.",
          },
          mask: {
            type: "string",
            description:
              "Optional path to a mask image (PNG with alpha channel). " +
              "Transparent areas in the mask indicate where the image should be edited. " +
              "If multiple source images are provided, the mask applies to the first one.",
          },
          size: {
            type: "string",
            description:
              "Output image dimensions. Default: '1024x1024'. Options: '1024x1024' (square), '1536x1024' (landscape), '1024x1536' (portrait).",
          },
          output_filename: {
            type: "string",
            description:
              "Optional custom filename (without extension). Default: auto-generated timestamp-based name.",
          },
        },
        required: ["prompt", "source_images"],
      },
      handler: async (args) => {
        const startTime = Date.now();
        try {
          if (!args.source_images || args.source_images.length === 0) {
            return {
              textResultForLlm: "❌ source_images is required — provide at least one image path.",
              resultType: "failure",
            };
          }
          if (args.source_images.length > 4) {
            return {
              textResultForLlm: "❌ Maximum 4 source images allowed per request.",
              resultType: "failure",
            };
          }

          await session.log(
            `🎨 Generating image from ${args.source_images.length} reference(s) with gpt-image-2...`,
            { ephemeral: true }
          );

          const filePath = await generateImageFromImage(
            args.prompt,
            args.source_images,
            args.size,
            args.mask
          );

          // Rename if custom filename provided
          let finalPath = filePath;
          if (args.output_filename) {
            const dir = join(process.cwd(), "data", "generated-images");
            const customPath = join(dir, `${args.output_filename}.png`);
            const { renameSync } = await import("node:fs");
            renameSync(filePath, customPath);
            finalPath = customPath;
          }

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          await session.log(`✅ Image-to-image generated in ${elapsed}s`);

          return [
            `✅ Image generated from reference successfully!`,
            `📁 File: ${finalPath}`,
            `⏱️ Time: ${elapsed}s`,
            `📐 Size: ${args.size || "1024x1024"}`,
            `🖼️ Source images: ${args.source_images.join(", ")}`,
            args.mask ? `🎭 Mask: ${args.mask}` : "",
            ``,
            `To upload for social media, use:`,
            `  late_presign_upload(filename="${basename(finalPath)}", content_type="image/png")`,
            `  Then PUT the file to the returned uploadUrl.`,
          ].filter(Boolean).join("\n");
        } catch (e) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          await session.log(`❌ Image-from-image generation failed (${elapsed}s)`, { level: "error" });
          return {
            textResultForLlm: `❌ Image-from-image generation failed: ${e.message}`,
            resultType: "failure",
          };
        }
      },
    },
  ],
});
