/**
 * Merge Proof Utilities
 *
 * Pure functions to extract and validate E2E video proof and Vercel preview
 * URLs from PR comments. Used by the merge_pr tool handler in telegram-bridge
 * to gate merges on proof existence. Walk-through self-correction instructions
 * enforce ONE single test() block per spec for continuous video recording.
 *
 * Replaces the require-e2e-results.yml hookflow with cleaner extension-layer logic.
 */

// ── Repo configuration ───────────────────────────────────────────────────────

/** Repos that require E2E video proof before merge. */
export const E2E_REPOS = new Set([
  "{{GITHUB_USERNAME}}/surgiquip",
  "{{GITHUB_USERNAME}}/servodetail",
  "{{GITHUB_USERNAME}}/taller-mecanico",
  "{{GITHUB_USERNAME}}/carplay-mobile-detail",
  "{{GITHUB_USERNAME}}/milkmama",
]);

/** Subset of E2E repos that also require a Vercel preview URL. */
export const VERCEL_REPOS = new Set([
  "{{GITHUB_USERNAME}}/surgiquip",
  "{{GITHUB_USERNAME}}/servodetail",
  "{{GITHUB_USERNAME}}/carplay-mobile-detail",
]);

/** At least one video filename must contain one of these keywords. */
const PROOF_KEYWORDS = [
  "full-walk-through",
  "full-feature",
  "full-lifecycle",
  "step-by-step",
  "change-proof",
];

/**
 * Generic walk-through filenames that are NOT PR-specific.
 * These are "site tour" specs that run the same flow regardless of what changed.
 * A PR must have EITHER a change-proof-* video OR a full-walk-through-{feature} video
 * (not just "full-walk-through-{repo-slug}" which is the generic one).
 */
const GENERIC_WALKTHROUGH_PATTERNS = [
  // Matches filenames ending with: full-walk-through-carplay.webm, step-by-step-carplay.webm
  // Also handles Playwright truncation (full-walk-throug) and hash suffixes
  // Does NOT match: full-walk-through-quote-form.webm, change-proof-booking.webm
  /full-walk-through-(?:carplay|servodetail|surgiquip|taller-mecanico|milkmama)[\.\-]/i,
  /full-walk-throug-(?:carplay|servodetail|surgiquip|taller-mecanico|milkmama)[\.\-]/i,
  // Matches: step-by-step-carplay (generic site tour, not feature-specific)
  /step-by-step-(?:carplay|servodetail|surgiquip|taller-mecanico|milkmama)[\.\-]/i,
  // Matches filenames containing "y-full-walk-through-carplay" (Playwright truncated path)
  /y-full-walk-through-(?:carplay|servodetail|surgiquip|taller-mecanico|milkmama)\./i,
];

// ── API helpers ──────────────────────────────────────────────────────────────

/**
 * Fetch all comments on a PR (issue comments endpoint).
 * Returns the concatenated body text of all comments.
 */
export async function getPrCommentsText(repo, prNumber, ghToken) {
  const comments = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://api.{{EMPLOYER_PARENT}}.com/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `token ${ghToken}`,
          Accept: "application/vnd.{{EMPLOYER_PARENT}}.v3+json",
          "User-Agent": "copilot-proof-utils/1.0",
        },
      }
    );
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    for (const c of data) {
      if (c.body) comments.push(c.body);
    }
    if (data.length < 100) break;
    page++;
  }
  return comments.join("\n");
}

/**
 * Find the Vercel bot preview URL from PR comment text.
 * Returns the URL string or null.
 */
export function findVercelPreviewUrl(commentsText) {
  if (!commentsText) return null;
  const match = commentsText.match(
    /https?:\/\/[a-z0-9-]+(?:-[a-z0-9-]+)*\.vercel\.app(?:\/\S*)?/i
  );
  return match ? match[0] : null;
}

/**
 * Determine if a video filename is a generic site tour (not PR-specific).
 */
function isGenericWalkthrough(filename) {
  return GENERIC_WALKTHROUGH_PATTERNS.some((p) => p.test(filename));
}

/**
 * Find E2E proof video URLs from PR comment text.
 * Looks for .webm/.mp4 URLs matching the repo slug and PR number patterns.
 *
 * Returns {
 *   allVideoUrls: string[],
 *   proofVideoUrl: string|null,
 *   proofKeyword: string|null,
 *   isGeneric: boolean  — true if the proof video is a generic site tour
 * }
 *
 * Selection logic: iterate KEYWORDS first (priority order), then URLs — so
 * full-walk-through is always preferred over full-feature, etc. Within a keyword
 * tier, PR-SPECIFIC videos are preferred over generic ones. Filename matching is
 * used (not the full URL) to avoid false positives from S3 path components.
 * Handles Playwright's filename truncation: "full-walk-throug" (without final h)
 * is accepted as a match for "full-walk-through".
 */
export function findProofVideoUrl(commentsText, repoSlug, prNumber) {
  if (!commentsText) {
    return { allVideoUrls: [], proofVideoUrl: null, proofKeyword: null, isGeneric: false };
  }

  const patterns = [
    // Pattern: {slug}-pr{N}-*.webm
    new RegExp(`https://[a-zA-Z0-9._/?&=%-]+${repoSlug}-pr${prNumber}-[a-zA-Z0-9._/?&=%-]+\\.webm`, "gi"),
    // Pattern: {slug}/pr-{N}/*.webm (S3 path style)
    new RegExp(`https://[a-zA-Z0-9._/?&=%-]+${repoSlug}/pr-${prNumber}/[a-zA-Z0-9._/?&=%-]+\\.webm`, "gi"),
    // Pattern: {slug}-pr{N}-*.mp4
    new RegExp(`https://[a-zA-Z0-9._/?&=%-]+${repoSlug}-pr${prNumber}-[a-zA-Z0-9._/?&=%-]+\\.mp4`, "gi"),
  ];

  const urls = new Set();
  for (const regex of patterns) {
    for (const match of commentsText.matchAll(regex)) {
      urls.add(match[0]);
    }
  }

  const allVideoUrls = [...urls];

  // Iterate KEYWORDS first (priority order), then URLs within each keyword tier.
  // Within each keyword tier, prefer PR-SPECIFIC videos over generic site tours.
  for (const kw of PROOF_KEYWORDS) {
    const kwVariants = kw === "full-walk-through" ? [kw, "full-walk-throug"] : [kw];

    // First pass: look for PR-specific (non-generic) videos with this keyword
    for (const url of allVideoUrls) {
      const filename = url.split("/").pop() ?? url;
      const filenameLower = filename.toLowerCase();

      if (kwVariants.some((v) => filenameLower.includes(v)) && !isGenericWalkthrough(filename)) {
        return { allVideoUrls, proofVideoUrl: url, proofKeyword: kw, isGeneric: false };
      }
    }

    // Second pass: fall back to generic videos with this keyword
    for (const url of allVideoUrls) {
      const filename = url.split("/").pop() ?? url;
      const filenameLower = filename.toLowerCase();

      if (kwVariants.some((v) => filenameLower.includes(v))) {
        return { allVideoUrls, proofVideoUrl: url, proofKeyword: kw, isGeneric: true };
      }
    }
  }

  return { allVideoUrls, proofVideoUrl: null, proofKeyword: null, isGeneric: false };
}

/**
 * Check for test failures in PR comments.
 * Returns true if failures are detected.
 */
export function hasTestFailures(commentsText) {
  if (!commentsText) return false;
  return /failed:\s*[1-9]/i.test(commentsText) || /[1-9]+\s*failed/i.test(commentsText);
}

/**
 * Validate a URL returns an acceptable HTTP status.
 * For Vercel: 200-399 or 401 (deployment protection) are valid.
 * For videos: only 200 is valid.
 */
export async function validateUrl(url, { acceptAuth = false } = {}) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const ok = acceptAuth
      ? (res.status >= 200 && res.status < 400) || res.status === 401
      : res.status === 200;
    return { ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

// ── Self-correction instruction builders ─────────────────────────────────────

function selfCorrectionHeader() {
  return "═══ SELF-CORRECTION INSTRUCTIONS (DO THIS NOW — NO HUMAN INPUT NEEDED) ═══";
}

function noCommentsInstructions(repo, prNumber) {
  return [
    `BLOCKED: No PR comments found for PR #${prNumber} (${repo}).`,
    "",
    selfCorrectionHeader(),
    "",
    "CI has not posted E2E test results yet. You must trigger CI and wait for results.",
    "",
    "STEP 1: Push a trivial commit to trigger CI (if no recent push):",
    `  dev_commit(message='chore: trigger CI for E2E proof', folder='<worktree-path>')`,
    `  dev_push(folder='<worktree-path>')`,
    "",
    "STEP 2: Monitor CI completion with pr_monitor_watch:",
    `  pr_monitor_watch(repo='${repo}', pr_number=${prNumber})`,
    "",
    "STEP 3: When CI completes and posts video results in PR comments, retry:",
    `  merge_pr(repo='${repo}', pr_number=${prNumber}, ...)`,
    "",
    "This is a SELF-CORRECTING loop. Do NOT ask {{PARENT_1}} — just execute these steps.",
  ].join("\n");
}

function noVideosInstructions(repo, prNumber, repoSlug) {
  return [
    `BLOCKED: No E2E video URLs found in PR comments for PR #${prNumber} (${repo}).`,
    `Expected pattern: '${repoSlug}-pr${prNumber}-*.webm' or '${repoSlug}/pr-${prNumber}/*.webm'`,
    "",
    selfCorrectionHeader(),
    "",
    "No E2E test videos exist for this PR. You MUST autonomously create a comprehensive",
    "E2E spec that demonstrates the SPECIFIC changes this PR introduces.",
    "",
    "╔══════════════════════════════════════════════════════════════════════════════╗",
    "║  ⚠️  YOUR WALK-THROUGH MUST BE PR-SPECIFIC — NOT A GENERIC HOMEPAGE TOUR   ║",
    "╚══════════════════════════════════════════════════════════════════════════════╝",
    "",
    "STEP 1: Read the PR DIFF to identify which ROUTES/PAGES were added or changed:",
    `  dev_get_pr_details(repo='${repo}', pr_number=${prNumber})`,
    "",
    "  From the diff, extract:",
    "    - Which page routes were ADDED (e.g., /projects/memorial-hermann)",
    "    - Which page routes were MODIFIED (e.g., /contact updated)",
    "    - Which components/forms were changed",
    "",
    "STEP 2: Create a PR-SPECIFIC proof spec that visits ONLY the changed pages:",
    "  File: e2e/tests/scenarios/change-proof-<feature-slug>.spec.ts",
    "",
    "  ╔══════════════════════════════════════════════════════════════════════════╗",
    "  ║  The <feature-slug> MUST describe THIS PR's specific change:            ║",
    "  ║    change-proof-quote-form-options.spec.ts  (quote form fix)            ║",
    "  ║    change-proof-booking-validation.spec.ts  (booking changes)           ║",
    "  ║    change-proof-pricing-tiers.spec.ts       (pricing update)            ║",
    "  ║                                                                         ║",
    "  ║  NEVER use generic names like full-walk-through-carplay.spec.ts         ║",
    "  ║  Generic site tours are REJECTED — they don't prove your PR's changes.  ║",
    "  ╚══════════════════════════════════════════════════════════════════════════╝",
    "",
    "  ╔══════════════════════════════════════════════════════════════════════════╗",
    "  ║  🚨 CRITICAL — PR-SPECIFIC ROUTING REQUIREMENTS:                        ║",
    "  ║                                                                         ║",
    "  ║  • The walk-through MUST navigate to the SPECIFIC pages from the diff   ║",
    "  ║  • DO NOT just visit the homepage and scroll — that's GENERIC           ║",
    "  ║  • If the PR adds /projects/memorial-hermann → navigate TO that page    ║",
    "  ║  • If the PR changes /contact → visit /contact and show the change      ║",
    "  ║  • EVERY page/route touched by the PR diff MUST be visited              ║",
    "  ║  • Spend 80%+ of the video on the CHANGED pages, not the homepage       ║",
    "  ║                                                                         ║",
    "  ║  ❌ BANNED: Homepage scroll → generic nav → done (same for every PR)    ║",
    "  ║  ✅ REQUIRED: Homepage → nav to CHANGED page → scroll THAT page → next  ║",
    "  ╚══════════════════════════════════════════════════════════════════════════╝",
    "",
    "  WALK-THROUGH = ONE SINGLE test() BLOCK — NOT multiple describe/it",
    "  Playwright records video PER test(). ONE test() = ONE continuous walk-through video.",
    "",
    "  Your proof spec is a CLIENT DEMO VIDEO showing the SPECIFIC feature/fix.",
    "  The recording is what the client ({{PARENT_1}}) watches to verify your work.",
    "",
    "  STRUCTURE: ONE single test() block:",
    "    test('change-proof-<feature-slug>', async ({ page }) => { ... });",
    "",
    "  Follow this flow inside that single test():",
    "",
    "    1. START at the homepage (goto baseURL '/') — BRIEFLY (2-3 seconds max)",
    "    2. IMMEDIATELY navigate to the SPECIFIC page that changed by clicking links",
    "       (NOT goto URL directly — the client needs to see the navigation path)",
    "    3. Demonstrate the SPECIFIC change on THAT page:",
    "       - Show new/modified UI elements",
    "       - Interact with changed forms/buttons/components",
    "       - Verify new content renders correctly",
    "    4. SCROLL through the CHANGED page slowly (this is the main content):",
    "       await page.mouse.wheel(0, 300); await page.waitForTimeout(500);",
    "    5. If the change affects multiple pages, navigate to EACH changed page",
    "    6. Interact with the changed functionality (fill forms, click CTAs, etc.)",
    "",
    "  ⚠️  SPEND 80%+ OF VIDEO TIME ON THE PAGES THAT CHANGED — NOT THE HOMEPAGE.",
    "  The homepage is just a 2-second starting point. Get to the changed content FAST.",
    "",
    "  Use smooth scrolling and natural pauses (800-1500ms) between actions.",
    "",
    "STEP 3: Commit and push the new spec to this PR's branch:",
    "  dev_add → dev_commit → dev_push (NEVER raw git)",
    "",
    "STEP 4: Monitor CI — it will auto-run E2E tests and post video results:",
    `  pr_monitor_watch(repo='${repo}', pr_number=${prNumber})`,
    "",
    "STEP 5: When CI posts the video results, retry merge:",
    `  merge_pr(repo='${repo}', pr_number=${prNumber}, ...)`,
    "",
    "If you cannot create the spec yourself, launch a dedicated coding-agent.",
    "",
    "This is a SELF-CORRECTING loop. Do NOT ask {{PARENT_1}} — just execute steps 1-5.",
  ].join("\n");
}

function noProofKeywordInstructions(repo, prNumber, videoCount) {
  return [
    `BLOCKED: None of the ${videoCount} E2E video(s) for PR #${prNumber} (${repo}) contain a proof keyword.`,
    "",
    `Required proof keywords: ${PROOF_KEYWORDS.join(", ")}`,
    "",
    selfCorrectionHeader(),
    "",
    "Videos exist but none prove a full walkthrough. Create a comprehensive E2E spec",
    "with a proof keyword in the filename, push it, and retry merge.",
    "",
    "STEP 1: Read the PR: dev_get_pr_details",
    "STEP 2: Create: e2e/tests/scenarios/change-proof-<feature-slug>.spec.ts",
    "",
    "  ╔══════════════════════════════════════════════════════════════════════════╗",
    "  ║  CRITICAL: The spec MUST demonstrate the SPECIFIC changes this PR made  ║",
    "  ║  Navigate to the EXACT pages/forms/features that were modified.         ║",
    "  ║  A generic site tour is NOT acceptable proof.                           ║",
    "  ╚══════════════════════════════════════════════════════════════════════════╝",
    "",
    "  IMPORTANT — Walk-through specs are CLIENT DEMO VIDEOS, not technical tests.",
    "  MUST be ONE SINGLE test() block — NOT multiple describe/it blocks.",
    "  Playwright records video per test(). One test() = one continuous video.",
    "  The spec must flow like a presentation the client watches to review your work:",
    "    test('change-proof-<slug>', async ({ page }) => {",
    "      1. START at the homepage",
    "      2. NAVIGATE via actual link clicks to the CHANGED page/feature",
    "      3. Verify the SPECIFIC changes (new options, fixed form, new content)",
    "      4. SCROLL DOWN slowly: page.mouse.wheel(0, 300) + waitForTimeout(500), repeat",
    "      5. Interact with changed elements (fill forms, click buttons, etc.)",
    "      6. NAVIGATE to any pages affected by the change",
    "      7. Verify cross-page impact of changes",
    "    });",
    "  Use natural pauses (800-1500ms) between actions for presentation flow.",
    "",
    "STEP 3: dev_add → dev_commit → dev_push",
    `STEP 4: pr_monitor_watch(repo='${repo}', pr_number=${prNumber})`,
    `STEP 5: merge_pr(repo='${repo}', pr_number=${prNumber}, ...)`,
    "",
    "This is a SELF-CORRECTING loop. Do NOT ask {{PARENT_1}}.",
  ].join("\n");
}

function videoNotAccessibleInstructions(repo, prNumber, url, status) {
  return [
    `BLOCKED: E2E video URL is not accessible (HTTP ${status}) for PR #${prNumber} (${repo}).`,
    `URL checked: ${url}`,
    "",
    selfCorrectionHeader(),
    "",
    "STEP 1: Push a commit to re-trigger CI:",
    `  dev_commit(message='chore: re-trigger E2E for PR #${prNumber}', allow_empty=true)`,
    `  dev_push(folder='<worktree-path>')`,
    "",
    `STEP 2: pr_monitor_watch(repo='${repo}', pr_number=${prNumber})`,
    `STEP 3: merge_pr(repo='${repo}', pr_number=${prNumber}, ...)`,
    "",
    "This is a SELF-CORRECTING loop. Do NOT ask {{PARENT_1}}.",
  ].join("\n");
}

function genericWalkthroughInstructions(repo, prNumber, videoUrl) {
  return [
    `BLOCKED: Only a GENERIC site walk-through video was found for PR #${prNumber} (${repo}).`,
    `Video: ${videoUrl}`,
    "",
    "╔══════════════════════════════════════════════════════════════════════════════╗",
    "║  🚨 A GENERIC HOMEPAGE TOUR IS NOT ACCEPTABLE AS PR PROOF.                 ║",
    "║  The video must show THE SPECIFIC PAGES/ROUTES this PR adds or changes.    ║",
    "╚══════════════════════════════════════════════════════════════════════════════╝",
    "",
    "A generic site tour (e.g., full-walk-through-carplay.spec.ts) does NOT prove",
    "your PR's specific changes. It runs the same flow regardless of what was modified.",
    "",
    selfCorrectionHeader(),
    "",
    "You MUST create a PR-SPECIFIC proof spec that demonstrates the actual changes.",
    "",
    "STEP 1: Read the PR DIFF to identify which ROUTES/PAGES were added or changed:",
    `  dev_get_pr_details(repo='${repo}', pr_number=${prNumber})`,
    "",
    "  From the diff, BUILD A LIST of routes to visit:",
    "    Example: PR adds src/content/projects/memorial-hermann.md",
    "      → Route to visit: /projects/memorial-hermann",
    "    Example: PR modifies src/pages/contact.astro",
    "      → Route to visit: /contact",
    "    Example: PR adds src/content/blog/new-post.md",
    "      → Route to visit: /blog/new-post",
    "",
    "STEP 2: Create a CHANGE-SPECIFIC proof spec targeting THOSE routes:",
    "  File: e2e/tests/scenarios/change-proof-<feature-slug>.spec.ts",
    "",
    "  ╔══════════════════════════════════════════════════════════════════════════╗",
    "  ║  The <feature-slug> MUST describe the actual change:                    ║",
    "  ║    change-proof-quote-form-options.spec.ts  (quote form fix)            ║",
    "  ║    change-proof-booking-validation.spec.ts  (booking changes)           ║",
    "  ║    change-proof-pricing-tiers.spec.ts       (pricing update)            ║",
    "  ║  NEVER use the repo name as the slug (that's generic).                  ║",
    "  ╚══════════════════════════════════════════════════════════════════════════╝",
    "",
    "  ╔══════════════════════════════════════════════════════════════════════════╗",
    "  ║  🚨 PR-SPECIFIC ROUTING — MANDATORY:                                    ║",
    "  ║                                                                         ║",
    "  ║  • Navigate to EVERY page the PR diff touches                           ║",
    "  ║  • If PR adds /projects/memorial-hermann → GO TO /projects/memorial-... ║",
    "  ║  • If PR changes /contact → VISIT /contact and show what changed        ║",
    "  ║  • Homepage is a 2-second start point ONLY — get to changed pages FAST  ║",
    "  ║  • 80%+ of video time must be on CHANGED pages                          ║",
    "  ║  • A video that never visits the pages in the diff = REJECTED           ║",
    "  ╚══════════════════════════════════════════════════════════════════════════╝",
    "",
    "  Structure — ONE single test() block:",
    "    test('change-proof-<feature-slug>', async ({ page }) => {",
    "      // 1. Start at homepage — BRIEFLY (2-3 seconds, not a full tour)",
    "      await page.goto('/');",
    "      await page.waitForTimeout(1500);",
    "",
    "      // 2. IMMEDIATELY navigate to the SPECIFIC page that changed",
    "      //    Use link clicks — NOT goto(url) — so the video shows navigation",
    "      await page.click('nav >> text=<LinkText>');",
    "      await page.waitForTimeout(1000);",
    "",
    "      // 3. Demonstrate the SPECIFIC change on THAT page:",
    "      //    - If form options changed: show the form, verify new options",
    "      //    - If content changed: scroll to the changed section",
    "      //    - If layout changed: scroll through the new layout",
    "      //    - If a bug was fixed: reproduce the scenario that was broken",
    "",
    "      // 4. Scroll through the changed page slowly",
    "      for (let i = 0; i < 10; i++) {",
    "        await page.mouse.wheel(0, 300);",
    "        await page.waitForTimeout(500);",
    "      }",
    "",
    "      // 5. Interact with changed elements (click, fill, select, etc.)",
    "      // 6. Navigate to any secondary pages affected by the change",
    "    });",
    "",
    "STEP 3: dev_add → dev_commit → dev_push",
    `STEP 4: pr_monitor_watch(repo='${repo}', pr_number=${prNumber})`,
    `STEP 5: merge_pr(repo='${repo}', pr_number=${prNumber}, ...)`,
    "",
    "This is a SELF-CORRECTING loop. Do NOT ask {{PARENT_1}}.",
  ].join("\n");
}

function testFailuresInstructions(repo, prNumber) {
  return [
    `BLOCKED: E2E test results show failures for PR #${prNumber} (${repo}).`,
    "",
    selfCorrectionHeader(),
    "",
    "All E2E tests must pass before merge is allowed.",
    "",
    "STEP 1: Read the PR diff and failing test output:",
    `  dev_get_pr_details(repo='${repo}', pr_number=${prNumber})`,
    "",
    "STEP 2: Fix the failing tests or code, then dev_add → dev_commit → dev_push.",
    "",
    `STEP 3: pr_monitor_watch(repo='${repo}', pr_number=${prNumber})`,
    `STEP 4: merge_pr(repo='${repo}', pr_number=${prNumber}, ...)`,
    "",
    "This is a SELF-CORRECTING loop. Do NOT ask {{PARENT_1}}.",
  ].join("\n");
}

function vercelNotFoundInstructions(repo, prNumber, repoSlug) {
  return [
    `BLOCKED: No Vercel preview URL found in PR comments for PR #${prNumber} (${repo}).`,
    "",
    selfCorrectionHeader(),
    "",
    `A Vercel preview URL (e.g., ${repoSlug}-git-branch.vercel.app) must be posted`,
    "by the Vercel bot as a PR comment. Push a commit to trigger a Vercel deployment.",
    "",
    "STEP 1: Push a commit to trigger Vercel deployment:",
    "  dev_commit(message='chore: trigger Vercel preview', allow_empty=true)",
    "  dev_push(folder='<worktree-path>')",
    "",
    `STEP 2: pr_monitor_watch(repo='${repo}', pr_number=${prNumber})`,
    `STEP 3: merge_pr(repo='${repo}', pr_number=${prNumber}, ...)`,
    "",
    "This is a SELF-CORRECTING loop. Do NOT ask {{PARENT_1}}.",
  ].join("\n");
}

function vercelNotAccessibleInstructions(repo, prNumber, url, status) {
  return [
    `BLOCKED: Vercel preview URL is not accessible (HTTP ${status}) for PR #${prNumber} (${repo}).`,
    `URL checked: ${url}`,
    "",
    selfCorrectionHeader(),
    "",
    "STEP 1: Push a commit to re-trigger Vercel deployment:",
    "  dev_commit(message='chore: re-trigger Vercel preview', allow_empty=true)",
    "  dev_push(folder='<worktree-path>')",
    "",
    `STEP 2: pr_monitor_watch(repo='${repo}', pr_number=${prNumber})`,
    `STEP 3: merge_pr(repo='${repo}', pr_number=${prNumber}, ...)`,
    "",
    "This is a SELF-CORRECTING loop. Do NOT ask {{PARENT_1}}.",
  ].join("\n");
}

// ── Main validation function ─────────────────────────────────────────────────

/**
 * Validate E2E proof and Vercel preview for a PR.
 *
 * Call this BEFORE sending the approval message in merge_pr.
 *
 * Returns:
 *   { ok: true, videoUrl, vercelUrl }  — proof valid, append URLs to approval msg
 *   { ok: false, error }               — blocked, return error to agent (self-correction)
 *   { skip: true }                     — repo not E2E-enabled, proceed normally
 */
export async function validateMergeProof(repo, prNumber, ghToken) {
  // Not an E2E repo — skip entirely
  if (!E2E_REPOS.has(repo)) {
    return { skip: true };
  }

  const repoSlug = repo.split("/")[1]; // e.g., "servodetail"
  const needsVercel = VERCEL_REPOS.has(repo);

  // ── 1. Fetch PR comments ──────────────────────────────────────────────
  const commentsText = await getPrCommentsText(repo, prNumber, ghToken);

  if (!commentsText.trim()) {
    return { ok: false, error: noCommentsInstructions(repo, prNumber) };
  }

  // ── 2. Check for test failures ────────────────────────────────────────
  if (hasTestFailures(commentsText)) {
    return { ok: false, error: testFailuresInstructions(repo, prNumber) };
  }

  // ── 3. Find video URLs ────────────────────────────────────────────────
  const { allVideoUrls, proofVideoUrl, proofKeyword, isGeneric } = findProofVideoUrl(
    commentsText, repoSlug, prNumber
  );

  if (allVideoUrls.length === 0) {
    return { ok: false, error: noVideosInstructions(repo, prNumber, repoSlug) };
  }

  if (!proofVideoUrl) {
    return { ok: false, error: noProofKeywordInstructions(repo, prNumber, allVideoUrls.length) };
  }

  // ── 3b. Block generic walk-throughs — require PR-specific proof ─────
  if (isGeneric) {
    return { ok: false, error: genericWalkthroughInstructions(repo, prNumber, proofVideoUrl) };
  }

  // ── 4. Validate video URL is accessible ───────────────────────────────
  const videoCheck = await validateUrl(proofVideoUrl);
  if (!videoCheck.ok) {
    return { ok: false, error: videoNotAccessibleInstructions(repo, prNumber, proofVideoUrl, videoCheck.status) };
  }

  // ── 5. Vercel preview check (Vercel repos only) ───────────────────────
  let vercelUrl = null;
  if (needsVercel) {
    vercelUrl = findVercelPreviewUrl(commentsText);
    if (!vercelUrl) {
      return { ok: false, error: vercelNotFoundInstructions(repo, prNumber, repoSlug) };
    }

    const vercelCheck = await validateUrl(vercelUrl, { acceptAuth: true });
    if (!vercelCheck.ok) {
      return { ok: false, error: vercelNotAccessibleInstructions(repo, prNumber, vercelUrl, vercelCheck.status) };
    }
  }

  // ── All checks passed ─────────────────────────────────────────────────
  return {
    ok: true,
    videoUrl: proofVideoUrl,
    videoKeyword: proofKeyword,
    videoCount: allVideoUrls.length,
    vercelUrl,
  };
}
