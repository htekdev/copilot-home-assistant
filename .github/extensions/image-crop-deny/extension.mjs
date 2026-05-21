/**
 * Image Crop/Resize Deny Extension for {{PRODUCT}} CLI
 *
 * BLOCKS powershell commands that attempt to resize, crop, or reformat hero images
 * using common image processing tools. Hero images MUST remain at their generated
 * dimensions (1200×630 OG standard) — resizing destroys quality and breaks
 * frontmatter expectations.
 *
 * Intercepted patterns:
 *   - PIL/Pillow: ImageOps.fit, .resize(), .crop()
 *   - ImageMagick: convert -resize, convert -crop, mogrify -resize
 *   - Sharp (Node.js): .resize(), .extract()
 *   - FFmpeg: -vf scale=, -vf crop=
 *
 * Scope: Only blocks when operating on files matching hero image patterns
 *   (hero*, *-hero*, paths containing /heroes/ or /og-images/, *1200x630*, *og-*)
 *
 * Philosophy: Hookflow Governance — every behavioral correction becomes a
 * deterministic enforcement mechanism. This hook exists because hero images
 * were being incorrectly resized, violating the 1200×630 OG standard.
 */
import { joinSession } from "@github/copilot-sdk/extension";

// ── Hero image file patterns ────────────────────────────────────────────────
const HERO_FILE_PATTERNS = [
  /hero/i,
  /og-image/i,
  /og_image/i,
  /1200.?x.?630/i,
  /\/heroes\//i,
  /\/og-images\//i,
  /heroImage/i,
  /caption-image/i,
];

// ── Image resize/crop operation patterns ────────────────────────────────────
const RESIZE_PATTERNS = [
  // PIL / Pillow
  { pattern: /ImageOps\.fit/i, tool: "PIL ImageOps.fit", desc: "Crops and resizes to fit dimensions" },
  { pattern: /\.resize\s*\(/i, tool: "PIL/Sharp .resize()", desc: "Resizes image dimensions" },
  { pattern: /\.crop\s*\(/i, tool: "PIL .crop()", desc: "Crops image region" },
  { pattern: /Image\.open.*\.thumbnail/i, tool: "PIL .thumbnail()", desc: "Shrinks image to fit" },
  // ImageMagick
  { pattern: /convert\s+.*-resize/i, tool: "ImageMagick convert -resize", desc: "Resizes image" },
  { pattern: /convert\s+.*-crop/i, tool: "ImageMagick convert -crop", desc: "Crops image" },
  { pattern: /mogrify\s+.*-resize/i, tool: "ImageMagick mogrify -resize", desc: "Resizes in-place" },
  { pattern: /magick\s+.*-resize/i, tool: "ImageMagick magick -resize", desc: "Resizes image" },
  { pattern: /magick\s+.*-crop/i, tool: "ImageMagick magick -crop", desc: "Crops image" },
  // Sharp (Node.js)
  { pattern: /sharp\(.*\)[\s\S]*\.resize\(/i, tool: "Sharp .resize()", desc: "Resizes via Sharp" },
  { pattern: /\.extract\s*\(\s*\{/i, tool: "Sharp .extract()", desc: "Crops via Sharp extract" },
  // FFmpeg
  { pattern: /-vf\s+.*scale=/i, tool: "FFmpeg -vf scale", desc: "Scales video/image frame" },
  { pattern: /-vf\s+.*crop=/i, tool: "FFmpeg -vf crop", desc: "Crops video/image frame" },
];

/**
 * Check if a command references a hero image file.
 */
function referencesHeroImage(cmd) {
  return HERO_FILE_PATTERNS.some((pattern) => pattern.test(cmd));
}

/**
 * Check if a command contains a resize/crop operation on a hero image.
 * Returns { blocked: true, tool, desc } or { blocked: false }.
 */
function checkCommand(cmd) {
  if (!cmd || typeof cmd !== "string") return { blocked: false };

  const normalized = cmd.trim();

  // Must reference a hero image to trigger blocking
  if (!referencesHeroImage(normalized)) return { blocked: false };

  // Check for resize/crop patterns
  for (const { pattern, tool, desc } of RESIZE_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        blocked: true,
        tool,
        desc,
      };
    }
  }

  return { blocked: false };
}

/**
 * Build the denial message.
 */
function buildDenialMessage(check) {
  return [
    `🚫 BLOCKED: Hero image resize/crop detected — ${check.tool}`,
    "",
    `Operation: ${check.desc}`,
    "",
    "Hero images MUST remain at their generated dimensions (1200×630 for OG images).",
    "Resizing or cropping hero images destroys quality and breaks frontmatter/meta expectations.",
    "",
    "✅ If you need a different size, REGENERATE the image at the correct dimensions.",
    "✅ If this is NOT a hero image, rename it to not match hero patterns (hero*, og-*, etc.).",
    "",
    "Hookflow governance: This rule exists to prevent permanent quality loss on key brand assets.",
  ].join("\n");
}

// ── Join Session ────────────────────────────────────────────────────────────

await joinSession({
  tools: [],
  hooks: {
    onPreToolUse: async (input) => {
      if (input.toolName !== "powershell") return;

      const cmd = input.toolArgs?.command;
      const check = checkCommand(cmd);

      if (check.blocked) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason: buildDenialMessage(check),
        };
      }
    },

    onPostToolUse: async (input) => {
      if (input.toolName !== "powershell") return;

      const cmd = input.toolArgs?.command;
      const check = checkCommand(cmd);

      if (check.blocked) {
        return {
          additionalContext: buildDenialMessage(check),
        };
      }
    },

    onSessionStart: async () => {
      return {
        additionalContext:
          "[image-crop-deny] Extension loaded — resizing/cropping hero images (hero*, og-*, 1200x630) via PIL, ImageMagick, Sharp, or FFmpeg is BLOCKED. Regenerate at correct dimensions instead.",
      };
    },
  },
});
