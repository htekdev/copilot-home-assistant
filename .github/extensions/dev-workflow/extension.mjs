/**
 * Dev Workflow Extension for {{PRODUCT}} CLI
 *
 * Provides tools for ALL git operations — agents should NEVER use raw git commands.
 * The dev-guard extension blocks raw git in powershell and directs agents here.
 *
 * Tools:
 *   - start_dev_branch  — Clone repo (if needed), fetch, create worktree for isolated branch work
 *   - create_vercel_pr  — Push branch, create PR, poll for Vercel preview URL
 *   - dev_status         — Check working tree status (staged, unstaged, untracked)
 *   - dev_add            — Stage files for commit
 *   - dev_commit         — Commit staged changes with a message
 *   - dev_push           — Push current branch to remote (auto-polls Vercel preview URL on Vercel repos)
 *   - dev_pull           — Pull latest from remote (fetch + merge)
 *   - dev_checkout       — Switch branches or create a new branch
 *   - dev_stash          — Stash or pop working changes
 *   - dev_reset          — Reset staged changes or undo commits
 *   - dev_rebase         — Rebase current branch onto another
 *   - dev_merge_pr       — Merge a {{EMPLOYER_PARENT}} PR (squash by default, delete branch)
 *   - dev_get_pr_details — Fetch ALL PR info (title, body, comments, reviews, CI checks, Vercel preview URL, linked issues) in one call
 *
 * Zero external dependencies — uses only node:* built-ins + @{{EMPLOYER_PARENT}}/copilot-sdk.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession } from "@{{EMPLOYER_PARENT}}/copilot-sdk/extension";

// ── Constants ───────────────────────────────────────────────────────────────
const REPOS_ROOT = "C:\\Repos\\{{GITHUB_USERNAME}}";

/**
 * Repos where agents ARE allowed to commit/push directly to main/master.
 * All other repos enforce the branch+PR workflow.
 */
const DIRECT_MAIN_REPOS = new Set(["{{FAMILY_NAME}}-family", "pi-{{FAMILY_NAME}}-family", "agent-mesh-service"]);

/**
 * Error message returned when an agent tries to commit/push to main/master
 * in a repo that requires the branch+PR workflow.
 */
const MAIN_BRANCH_BLOCKED_MSG = [
  "🚫 BLOCKED: Direct commits/pushes to main/master are not allowed in this repo.",
  "",
  "Agents MUST use the branch + PR workflow:",
  "  1. Use `start_dev_branch` to create an isolated worktree (e.g. start_dev_branch repo='{{GITHUB_USERNAME}}/my-repo' branch='feat/my-feature')",
  "  2. Make your changes in that worktree folder",
  "  3. Use `dev_add` + `dev_commit` + `dev_push` from the worktree",
  "  4. Use `create_vercel_pr` (for Vercel repos) or create a PR via `dev_push` + gh CLI",
  "",
  "This protects main from untested changes and ensures all work goes through PR review.",
].join("\n");

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Shell-escape a string for safe use in execSync commands.
 * Wraps in single quotes and escapes internal single quotes (PowerShell/bash safe).
 */
function shellEscape(str) {
  // For execSync on Windows (cmd/powershell): use double-quote wrapping
  // and escape internal double quotes + problematic chars
  return '"' + str.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`') + '"';
}

/**
 * Run a shell command and return trimmed stdout. Throws on failure.
 */
function run(cmd, cwd, timeoutMs = 60_000) {
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/**
 * Run a shell command, returning { ok, stdout, stderr }.
 */
function tryRun(cmd, cwd, timeoutMs = 60_000) {
  try {
    const stdout = run(cmd, cwd, timeoutMs);
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout || "").toString().trim(),
      stderr: (err.stderr || "").toString().trim(),
    };
  }
}

/**
 * Sanitize branch name for use as a directory name (replace / with --)
 */
function branchToDir(branch) {
  return branch.replace(/\//g, "--");
}

/**
 * Extract repo name from owner/repo format
 */
function repoName(repo) {
  return repo.split("/").pop();
}

/**
 * Sleep helper for polling
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizePrTitle(title) {
  return String(title || "")
    .replace(/\\n/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePrBody(description) {
  return String(description || "")
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n");
}

function createPrBodyFile(folder, description) {
  const bodyPath = resolve(
    folder || process.cwd(),
    `.copilot-pr-body-${process.pid}-${Date.now()}.md`
  );
  writeFileSync(bodyPath, normalizePrBody(description), "utf8");
  return bodyPath;
}

function removeFileQuietly(filePath) {
  if (!filePath) return;
  try {
    unlinkSync(filePath);
  } catch {}
}

/**
 * Check if the current branch is main/master AND the repo is NOT in the
 * DIRECT_MAIN_REPOS allowlist. Returns { blocked, branch, repoName } where
 * blocked=true means the operation should be refused.
 */
function isMainBranchBlocked(folder) {
  try {
    const branch = run("git branch --show-current", folder, 5_000);
    if (branch !== "main" && branch !== "master") {
      return { blocked: false, branch, repoName: null };
    }

    // Detect which repo this is (use folder name as heuristic)
    const detected = detectRepoName(folder);
    if (detected && DIRECT_MAIN_REPOS.has(detected)) {
      return { blocked: false, branch, repoName: detected };
    }

    return { blocked: true, branch, repoName: detected };
  } catch {
    // If we can't determine the branch, don't block (fail-open for edge cases)
    return { blocked: false, branch: "unknown", repoName: null };
  }
}

/**
 * Extract the short repo name from a folder path or git remote.
 * e.g. "C:\Repos\{{GITHUB_USERNAME}}\htek-dev-site\workdir\feat--foo" → "htek-dev-site"
 *      or from git remote origin → "htek-dev-site"
 */
function detectRepoName(folder) {
  // Try git remote first (most reliable)
  try {
    const remote = run("git remote get-url origin", folder, 5_000);
    const match = remote.match(/{{EMPLOYER_PARENT}}\.com[/:]([^/]+)\/([^/.]+)/);
    if (match) return match[2]; // repo name without owner
  } catch { /* fall through */ }

  // Fallback: walk up from folder path to find a known repo dir under REPOS_ROOT
  try {
    const normalized = folder.replace(/\\/g, "/");
    const root = REPOS_ROOT.replace(/\\/g, "/");
    if (normalized.startsWith(root)) {
      // e.g. "C:/Repos/{{GITHUB_USERNAME}}/htek-dev-site/workdir/feat--foo" → "htek-dev-site"
      const relative = normalized.slice(root.length + 1); // "htek-dev-site/workdir/..."
      const topDir = relative.split("/")[0];
      if (topDir) return topDir;
    }
  } catch { /* ignore */ }

  return null;
}

// ── Tool Handlers ───────────────────────────────────────────────────────────

/**
 * start_dev_branch — Clone repo if needed, fetch, create worktree off main.
 */
async function handleStartDevBranch(args) {
  const { repo, branch } = args;

  if (!repo || !branch) {
    return JSON.stringify({ error: "Both 'repo' and 'branch' are required." });
  }

  const name = repoName(repo);

  // ── Guard: Direct-to-main repos don't use branches ──────────────────
  if (DIRECT_MAIN_REPOS.has(name)) {
    return JSON.stringify({
      skipped: true,
      reason: `⚠️ SKIPPED: "${name}" is a direct-to-main repo (config/agent/data only). ` +
        `Do NOT create branches or PRs here. ` +
        `Just commit directly to main with dev_add + dev_commit + dev_push.`,
      repo: name,
    });
  }

  const repoDir = resolve(REPOS_ROOT, name);
  const worktreeDir = resolve(REPOS_ROOT, name, "workdir", branchToDir(branch));

  try {
    // ── Step 1: Clone if not present ──────────────────────────────────
    if (!existsSync(resolve(repoDir, ".git"))) {
      // Ensure parent directory exists
      if (!existsSync(REPOS_ROOT)) {
        mkdirSync(REPOS_ROOT, { recursive: true });
      }

      const cloneResult = tryRun(
        `gh repo clone ${repo} "${repoDir}" -- --recurse-submodules`,
        REPOS_ROOT,
        120_000
      );
      if (!cloneResult.ok) {
        return JSON.stringify({
          error: `Failed to clone ${repo}: ${cloneResult.stderr}`,
        });
      }
    }

    // ── Step 2: Fetch and update main ─────────────────────────────────
    const fetchResult = tryRun("git fetch origin", repoDir, 30_000);
    if (!fetchResult.ok) {
      return JSON.stringify({
        error: `Failed to fetch origin: ${fetchResult.stderr}`,
      });
    }

    // Detect default branch (main or master)
    let defaultBranch = "main";
    const headRef = tryRun(
      "git symbolic-ref refs/remotes/origin/HEAD",
      repoDir,
      10_000
    );
    if (headRef.ok && headRef.stdout) {
      // refs/remotes/origin/main → main
      defaultBranch = headRef.stdout.split("/").pop();
    }

    // Only pull if we're currently on the default branch (not in a worktree)
    const currentBranch = tryRun("git branch --show-current", repoDir, 5_000);
    if (currentBranch.ok && currentBranch.stdout === defaultBranch) {
      tryRun(`git pull origin ${defaultBranch}`, repoDir, 30_000);
    }

    // ── Step 3: Check if worktree/branch already exists ───────────────
    if (existsSync(worktreeDir)) {
      return JSON.stringify({
        status: "already_exists",
        message: `Worktree for branch '${branch}' already exists.`,
        folder: worktreeDir,
        branch,
        repo,
      });
    }

    // Check if branch already exists (local or remote)
    const localBranch = tryRun(
      `git show-ref --verify refs/heads/${branch}`,
      repoDir,
      5_000
    );
    const remoteBranch = tryRun(
      `git show-ref --verify refs/remotes/origin/${branch}`,
      repoDir,
      5_000
    );

    // Ensure workdir parent exists
    const workdirParent = resolve(REPOS_ROOT, name, "workdir");
    if (!existsSync(workdirParent)) {
      mkdirSync(workdirParent, { recursive: true });
    }

    // ── Step 4: Create worktree ───────────────────────────────────────
    let worktreeResult;
    if (localBranch.ok) {
      // Local branch exists — create worktree using existing branch
      worktreeResult = tryRun(
        `git worktree add "${worktreeDir}" ${branch}`,
        repoDir,
        30_000
      );
    } else if (remoteBranch.ok) {
      // Remote branch exists — track it
      worktreeResult = tryRun(
        `git worktree add "${worktreeDir}" -b ${branch} origin/${branch}`,
        repoDir,
        30_000
      );
    } else {
      // New branch off default
      worktreeResult = tryRun(
        `git worktree add "${worktreeDir}" -b ${branch} origin/${defaultBranch}`,
        repoDir,
        30_000
      );
    }

    if (!worktreeResult.ok) {
      return JSON.stringify({
        error: `Failed to create worktree: ${worktreeResult.stderr}`,
        hint: "If the branch already exists in another worktree, remove it first with 'git worktree remove'.",
      });
    }

    return JSON.stringify({
      status: "created",
      message: `Worktree created for branch '${branch}' off '${defaultBranch}'.`,
      folder: worktreeDir,
      branch,
      repo,
      default_branch: defaultBranch,
    });
  } catch (err) {
    return JSON.stringify({
      error: `Unexpected error: ${err.message}`,
    });
  }
}

/**
 * create_vercel_pr — Push branch, create PR, poll for Vercel preview URL.
 */
async function handleCreateVercelPr(args) {
  const {
    repo,
    branch,
    title,
    description,
    folder,
    push = true,
    max_wait = 120,
  } = args;

  if (!repo || !branch || !title || !description || !folder) {
    return JSON.stringify({
      error:
        "Required parameters: repo, branch, title, description, folder.",
    });
  }

  // ── Guard: Direct-to-main repos don't use PRs ────────────────────────
  const detectedName = repoName(repo);
  if (DIRECT_MAIN_REPOS.has(detectedName)) {
    return JSON.stringify({
      skipped: true,
      reason: `⚠️ SKIPPED: "${detectedName}" is a direct-to-main repo (config/agent/data only). ` +
        `Do NOT create branches or PRs here. ` +
        `Just commit directly to main with dev_add + dev_commit + dev_push.`,
      repo: detectedName,
    });
  }

  if (!existsSync(folder)) {
    return JSON.stringify({
      error: `Folder does not exist: ${folder}`,
    });
  }

  try {
    // ── Step 1: Push if requested ─────────────────────────────────────
    if (push) {
      const pushResult = tryRun(
        `git push -u origin ${branch}`,
        folder,
        180_000
      );
      if (!pushResult.ok) {
        return JSON.stringify({
          error: `Failed to push branch '${branch}': ${pushResult.stderr}`,
        });
      }
    }

    // ── Step 2: Create PR via gh CLI ──────────────────────────────────
    // Check if PR already exists for this branch
    const existingPr = tryRun(
      `gh pr view ${branch} --repo ${repo} --json number,url`,
      folder,
      15_000
    );

    let prNumber, prUrl;

    if (existingPr.ok && existingPr.stdout) {
      // PR already exists — use it
      const prData = JSON.parse(existingPr.stdout);
      prNumber = prData.number;
      prUrl = prData.url;
    } else {
      // Create new PR — use --body-file so multi-line descriptions survive on Windows
      const normalizedTitle = normalizePrTitle(title);
      const titleArg = shellEscape(normalizedTitle);
      const bodyFilePath = createPrBodyFile(folder, description);
      const bodyFileArg = shellEscape(bodyFilePath);

      try {
        const createResult = tryRun(
          `gh pr create --repo ${repo} --head ${branch} --title ${titleArg} --body-file ${bodyFileArg} --json number,url`,
          folder,
          30_000
        );

        if (!createResult.ok) {
          // Sometimes gh pr create doesn't support --json, fall back
          const createFallback = tryRun(
            `gh pr create --repo ${repo} --head ${branch} --title ${titleArg} --body-file ${bodyFileArg}`,
            folder,
            30_000
          );

          if (!createFallback.ok) {
            return JSON.stringify({
              error: `Failed to create PR: ${createFallback.stderr}`,
            });
          }

          // Parse PR URL from stdout (gh pr create prints the URL)
          prUrl = createFallback.stdout.trim();
          // Extract PR number from URL: .../pull/42
          const urlMatch = prUrl.match(/\/pull\/(\d+)/);
          prNumber = urlMatch ? parseInt(urlMatch[1], 10) : null;
        } else {
          const prData = JSON.parse(createResult.stdout);
          prNumber = prData.number;
          prUrl = prData.url;
        }
      } finally {
        removeFileQuietly(bodyFilePath);
      }
    }

    if (!prNumber) {
      return JSON.stringify({
        error: "Created PR but could not determine PR number.",
        pr_url: prUrl || "unknown",
      });
    }

    // ── Step 3: Poll for Vercel preview URL via direct API ────────────
    const projectId = VERCEL_PROJECT_MAP[repo];
    const vercelResult = projectId
      ? await pollVercelDeployment(projectId, branch, max_wait)
      : await pollVercelPreview(repo, prNumber, folder, max_wait);

    // ── Build response based on deployment status ─────────────────────
    if (vercelResult.status === "failed") {
      return JSON.stringify({
        status: "failed",
        action_required: "fix_build_error_before_notifying",
        notify_user: false,
        ready_to_notify: false,
        next_step: "Fix the build error in error_summary, push the fix, and wait for a successful Vercel rebuild before sending any PR or preview update to {{PARENT_1}}.",
        pr_number: prNumber,
        pr_url: prUrl,
        branch,
        repo,
        vercel_preview_url: null,
        inspector_url: vercelResult.inspectorUrl,
        error_summary: vercelResult.error_summary,
        deployment_details: vercelResult.deploymentDetails,
        vercel_comment: vercelResult.commentBody,
        note: "⚠️ Vercel deployment FAILED. DO NOT notify user yet. Fix the build error shown in error_summary, push the fix, and wait for Vercel to rebuild successfully before sending any preview URL.",
      });
    }

    return JSON.stringify({
      status: "success",
      pr_number: prNumber,
      pr_url: prUrl,
      branch,
      repo,
      vercel_preview_url: vercelResult.previewUrl || "timeout",
      inspector_url: vercelResult.inspectorUrl,
      ...(vercelResult.previewUrl
        ? {
            note: "✅ Vercel preview URL extracted. Send this to {{PARENT_1}} via Telegram with the speak parameter.",
          }
        : {
            note: `No Vercel preview comment found within ${max_wait}s. The deployment may still be building — check the PR comments later.`,
          }),
    });
  } catch (err) {
    return JSON.stringify({
      error: `Unexpected error: ${err.message}`,
    });
  }
}

// ── New Tool Handlers ───────────────────────────────────────────────────────

/**
 * dev_status — Show git status for a folder (staged, unstaged, untracked).
 */
async function handleDevStatus(args) {
  const folder = args.folder || process.cwd();
  try {
    const status = run("git status --short --branch", folder, 10_000);
    const ahead = tryRun("git rev-list --count @{u}..HEAD", folder, 5_000);
    const behind = tryRun("git rev-list --count HEAD..@{u}", folder, 5_000);

    // ── Main branch advisory warning ──────────────────────────────────
    const mainCheck = isMainBranchBlocked(folder);
    const warning = mainCheck.blocked
      ? "⚠️ You're on main — create a worktree/branch before making changes. Use `start_dev_branch` to set up an isolated worktree."
      : undefined;

    return JSON.stringify({
      status: "success",
      folder,
      output: status || "(clean — no changes)",
      commits_ahead: ahead.ok ? parseInt(ahead.stdout) || 0 : "unknown",
      commits_behind: behind.ok ? parseInt(behind.stdout) || 0 : "unknown",
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    return JSON.stringify({ error: `Failed to get status: ${err.message}` });
  }
}

/**
 * dev_add — Stage files for commit.
 */
async function handleDevAdd(args) {
  const folder = args.folder || process.cwd();
  const files = args.files || ".";

  try {
    // files can be "." for all, or specific paths space-separated
    const addCmd = files === "." ? "git add -A" : `git add ${files}`;
    run(addCmd, folder, 15_000);

    const staged = run("git diff --cached --stat", folder, 10_000);
    return JSON.stringify({
      status: "success",
      folder,
      staged: staged || "(no changes staged)",
    });
  } catch (err) {
    return JSON.stringify({ error: `Failed to stage files: ${err.message}` });
  }
}

/**
 * dev_commit — Commit staged changes with a message.
 */
async function handleDevCommit(args) {
  const { message, folder: folderArg, add_all } = args;
  const folder = folderArg || process.cwd();

  if (!message) {
    return JSON.stringify({ error: "Commit message is required." });
  }

  // ── Main branch protection ──────────────────────────────────────────
  const mainCheck = isMainBranchBlocked(folder);
  if (mainCheck.blocked) {
    return JSON.stringify({
      error: MAIN_BRANCH_BLOCKED_MSG,
      current_branch: mainCheck.branch,
      repo: mainCheck.repoName,
      action: "dev_commit",
      hint: "Use start_dev_branch to create a worktree, then commit there.",
    });
  }

  try {
    // Optionally stage all changes first
    if (add_all) {
      run("git add -A", folder, 15_000);
    }

    // Check there's something to commit
    const staged = tryRun("git diff --cached --quiet", folder, 5_000);
    if (staged.ok) {
      return JSON.stringify({
        status: "nothing_to_commit",
        message: "No staged changes to commit. Use dev_add first or set add_all=true.",
      });
    }

    // ── Hookflow YAML PS scope-prefix guard (Q-038) ────────────────────────
    // Before committing, scan any staged .{{EMPLOYER_PARENT}}/hookflows/*.yml files for
    // the PowerShell scope-prefix bug: "${variable}: " which PS interprets as
    // a drive prefix (like $env:VAR) causing platform-wide ParseError.
    try {
      const stagedFiles = tryRun("git diff --cached --name-only", folder, 5_000);
      if (stagedFiles.ok) {
        const hookflowFiles = stagedFiles.stdout
          .split("\n")
          .map((f) => f.trim())
          .filter((f) => f.includes(".{{EMPLOYER_PARENT}}/hookflows/") && f.endsWith(".yml"));

        for (const relFile of hookflowFiles) {
          const absFile = resolve(folder, relFile);
          if (!existsSync(absFile)) continue;
          const yamlContent = readFileSync(absFile, "utf-8");

          // Detect "${variable}: " — PS scope-prefix bug pattern
          // Matches e.g. "${tool}: checking" which PS interprets as drive access
          const scopePrefixBugPattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}\s*:/g;
          const bugMatches = [...yamlContent.matchAll(scopePrefixBugPattern)];

          if (bugMatches.length > 0) {
            const buggyExprs = bugMatches.map((m) => `\${${m[1]}}:`).join(", ");
            return JSON.stringify({
              error: [
                `🚫 BLOCKED: PowerShell scope-prefix bug detected in hookflow YAML: ${relFile}`,
                "",
                `Problematic pattern(s): ${buggyExprs}`,
                "PowerShell interprets \"\${variable}:\" as a drive/scope prefix (like \$env:VAR),",
                "NOT as variable interpolation followed by a literal colon.",
                "This causes a platform-wide ParseError that blocks ALL agents (Q-038 incident, Jun 9 2026).",
                "",
                "Fix — use string concatenation instead:",
                `  ❌ Write-Host "Tool \${tool}: checking..."`,
                `  ✅ Write-Host ("Tool " + \$tool + ": checking...")`,
                `  ✅ Write-Host "Tool \$tool is checking..."  (no colon immediately after)`,
                "",
                "Commit blocked. Fix the YAML and stage the file again.",
              ].join("\n"),
              file: relFile,
              action: "dev_commit",
            });
          }
        }
      }
    } catch (_hookflowCheckErr) {
      // Non-fatal — if the guard itself errors, allow the commit to proceed.
      // The guard is defense-in-depth; don't let it block legitimate work.
    }
    // ── End hookflow guard ─────────────────────────────────────────────────

    // Commit with co-author trailer
    const commitCmd = `git commit -m ${shellEscape(message)} --trailer "Co-authored-by: Copilot <{{EMAIL_ADDRESS}}.{{EMPLOYER_PARENT}}.com>"`;
    const result = run(commitCmd, folder, 15_000);

    return JSON.stringify({
      status: "success",
      folder,
      output: result,
    });
  } catch (err) {
    return JSON.stringify({ error: `Failed to commit: ${err.message}` });
  }
}

/**
 * Known Vercel-connected repos — auto-detect for preview URL polling.
 */
const VERCEL_REPOS = new Set([
  "{{GITHUB_USERNAME}}/htek-dev-site",
  "{{GITHUB_USERNAME}}/blackout-pickleball",
  "{{GITHUB_USERNAME}}/carplay-mobile-detail",
]);

/**
 * Map from {{EMPLOYER_PARENT}} owner/repo → Vercel project ID.
 * Used for direct Vercel API polling instead of {{EMPLOYER_PARENT}} comment scraping.
 * Project IDs confirmed via API on 2026-07-15.
 */
const VERCEL_PROJECT_MAP = {
  "{{GITHUB_USERNAME}}/htek-dev-site":         "prj_K8pwwEe55wdsVfh9OxRIRgEXhJGn",
  "{{GITHUB_USERNAME}}/blackout-pickleball":   "prj_3J80wNWJ8ctTgzR5awsSdRrXgbpx",
  "{{GITHUB_USERNAME}}/carplay-mobile-detail": "prj_XeZRwplsqDTvf8QiaHcf6NZfuHVY",
};

// ---------------------------------------------------------------------------
// Vercel API helpers — load token from .env (same pattern as vercel-env ext)
// ---------------------------------------------------------------------------

function loadVercelEnv() {
  try {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const raw = readFileSync(resolve(repoRoot, ".env"), "utf-8");
    const vars = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      vars[key] = val;
    }
    return vars;
  } catch { return {}; }
}

function getVercelToken() {
  return process.env.VERCEL_TOKEN || loadVercelEnv().VERCEL_TOKEN || "";
}

function getVercelTeamId() {
  return process.env.VERCEL_TEAM_ID || loadVercelEnv().VERCEL_TEAM_ID || "";
}

/**
 * Detect the {{EMPLOYER_PARENT}} owner/repo from git remote origin URL.
 * Handles both HTTPS and SSH formats.
 */
function detectRepo(folder) {
  try {
    const remote = run("git remote get-url origin", folder, 5_000);
    // HTTPS: https://{{EMPLOYER_PARENT}}.com/owner/repo.git
    const httpsMatch = remote.match(/{{EMPLOYER_PARENT}}\.com\/([^/]+\/[^/.]+)/);
    if (httpsMatch) return httpsMatch[1];
    // SSH: git@{{EMPLOYER_PARENT}}.com:owner/repo.git
    const sshMatch = remote.match(/{{EMPLOYER_PARENT}}\.com:([^/]+\/[^/.]+)/);
    if (sshMatch) return sshMatch[1];
  } catch { /* ignore */ }
  return null;
}

/**
 * Find an open PR for a given branch. Returns { number, url } or null.
 */
function findOpenPr(repo, branch, folder) {
  const result = tryRun(
    `gh pr view ${branch} --repo ${repo} --json number,url,state`,
    folder,
    15_000
  );
  if (result.ok && result.stdout) {
    try {
      const pr = JSON.parse(result.stdout);
      if (pr.state === "OPEN") return { number: pr.number, url: pr.url };
    } catch { /* ignore parse errors */ }
  }
  return null;
}

/**
 * Parse the Vercel bot comment to extract deployment status and details.
 * The Vercel bot embeds a base64-encoded JSON payload in its comment after a `#hash:` prefix.
 * Returns { status, previewUrl, inspectorUrl, projectName, commentBody } or null if not parseable.
 */
function parseVercelComment(commentBody) {
  if (!commentBody) return null;

  const result = {
    status: "unknown",
    previewUrl: null,
    inspectorUrl: null,
    projectName: null,
    commentBody,
    deploymentError: null,
  };

  // ── Decode the base64 JSON payload ────────────────────────────────
  // Format: [vc]: #hash:base64payload\n...markdown...
  const b64Match = commentBody.match(/#[A-Za-z0-9+/=]+:([A-Za-z0-9+/=]+)/);
  if (b64Match) {
    try {
      const decoded = JSON.parse(
        Buffer.from(b64Match[1], "base64").toString("utf-8")
      );
      const project = decoded.projects?.[0];
      if (project) {
        result.projectName = project.name || null;
        result.inspectorUrl = project.inspectorUrl || null;

        // Key field: nextCommitStatus tells us success vs failure
        const commitStatus = (project.nextCommitStatus || "").toUpperCase();
        if (commitStatus === "FAILED" || commitStatus === "ERROR") {
          result.status = "failed";
        } else if (commitStatus === "READY" || commitStatus === "SUCCEEDED") {
          result.status = "success";
          result.previewUrl = project.previewUrl || null;
        } else if (commitStatus === "BUILDING" || commitStatus === "QUEUED" || commitStatus === "INITIALIZING") {
          result.status = "building";
        } else if (commitStatus) {
          result.status = commitStatus.toLowerCase();
        }

        // If previewUrl is empty string, normalize to null
        if (!result.previewUrl) result.previewUrl = null;
      }
    } catch { /* base64 decode failed — fall through to markdown parsing */ }
  }

  // ── Fallback: parse the markdown table for status indicators ──────
  if (result.status === "unknown") {
    if (/!\[Error\]/i.test(commentBody) || /❌/.test(commentBody)) {
      result.status = "failed";
    } else if (/!\[Ready\]/i.test(commentBody) || /✅/.test(commentBody)) {
      result.status = "success";
    } else if (/!\[Building\]/i.test(commentBody) || /⏳/.test(commentBody)) {
      result.status = "building";
    }
  }

  // ── Extract preview URL from markdown (for success cases) ─────────
  if (result.status === "success" && !result.previewUrl) {
    // Pattern 1: [Visit Preview](https://...)
    const visitMatch = commentBody.match(
      /\[Visit Preview\]\((https:\/\/[^\s)]+)\)/i
    );
    if (visitMatch) result.previewUrl = visitMatch[1];

    // Pattern 2: Preview: https://...
    if (!result.previewUrl) {
      const previewMatch = commentBody.match(
        /Preview:\s*(https:\/\/[^\s)]+)/i
      );
      if (previewMatch) result.previewUrl = previewMatch[1];
    }

    // Pattern 3: any vercel.app URL
    if (!result.previewUrl) {
      const vercelUrlMatch = commentBody.match(
        /(https:\/\/[^\s)]*\.vercel\.app[^\s)]*)/
      );
      if (vercelUrlMatch) result.previewUrl = vercelUrlMatch[1];
    }
  }

  // ── Extract inspector/error URL from markdown ─────────────────────
  if (!result.inspectorUrl) {
    const errorLinkMatch = commentBody.match(
      /\[Error\]\((https:\/\/vercel\.com\/[^\s)]+)\)/i
    );
    if (errorLinkMatch) result.inspectorUrl = errorLinkMatch[1];
  }

  return result;
}

/**
 * Fetch deployment error details from {{EMPLOYER_PARENT}} deployment status API.
 * Returns { state, description, logUrl } or null.
 */
function fetchDeploymentError(repo, prNumber, folder) {
  try {
    // Get PR head SHA
    const shaResult = tryRun(
      `gh api repos/${repo}/pulls/${prNumber} --jq ".head.sha"`,
      folder,
      15_000
    );
    if (!shaResult.ok || !shaResult.stdout) return null;
    const sha = shaResult.stdout.trim();

    // Get latest deployment for this SHA
    const deplResult = tryRun(
      `gh api "repos/${repo}/deployments?sha=${sha}" --jq ".[0].id"`,
      folder,
      15_000
    );
    if (!deplResult.ok || !deplResult.stdout) return null;
    const deplId = deplResult.stdout.trim();

    // Get deployment status
    const statusResult = tryRun(
      `gh api "repos/${repo}/deployments/${deplId}/statuses" --jq ".[0] | {state: .state, description: .description, log_url: .log_url}"`,
      folder,
      15_000
    );
    if (!statusResult.ok || !statusResult.stdout) return null;

    return JSON.parse(statusResult.stdout);
  } catch { return null; }
}

/**
 * Poll PR comments for Vercel bot deployment status.
 * Returns a structured result object:
 *   { status: "success"|"failed"|"timeout", previewUrl, inspectorUrl, projectName,
 *     error_summary, commentBody, deploymentDetails }
 */
async function pollVercelPreview(repo, prNumber, folder, maxWaitSec = 120) {
  const pollInterval = 10; // seconds
  const maxAttempts = Math.ceil(maxWaitSec / pollInterval);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(pollInterval * 1000);

    const commentsResult = tryRun(
      `gh api repos/${repo}/issues/${prNumber}/comments --jq "[.[] | select(.user.login == \\"vercel[bot]\\" or .user.login == \\"vercel\\") | .body] | last"`,
      folder,
      15_000
    );

    if (!commentsResult.ok || !commentsResult.stdout) continue;

    const parsed = parseVercelComment(commentsResult.stdout);
    if (!parsed) continue;

    // ── Deployment FAILED — return error details immediately ────────
    if (parsed.status === "failed") {
      // Fetch additional error info from the deployment status API
      const deplDetails = fetchDeploymentError(repo, prNumber, folder);
      return {
        status: "failed",
        previewUrl: null,
        inspectorUrl: parsed.inspectorUrl,
        projectName: parsed.projectName,
        error_summary: deplDetails?.description || "Vercel deployment failed (see inspector URL for build logs)",
        commentBody: parsed.commentBody,
        deploymentDetails: deplDetails,
      };
    }

    // ── Deployment SUCCEEDED — return preview URL ───────────────────
    if (parsed.status === "success" && parsed.previewUrl) {
      return {
        status: "success",
        previewUrl: parsed.previewUrl,
        inspectorUrl: parsed.inspectorUrl,
        projectName: parsed.projectName,
        error_summary: null,
        commentBody: parsed.commentBody,
        deploymentDetails: null,
      };
    }

    // ── Still building — continue polling ───────────────────────────
    // (status is "building" or "success" without a previewUrl yet)
  }

  // ── Timeout — no conclusive status within maxWaitSec ──────────────
  return {
    status: "timeout",
    previewUrl: null,
    inspectorUrl: null,
    projectName: null,
    error_summary: `No Vercel deployment result found within ${maxWaitSec}s. The deployment may still be building.`,
    commentBody: null,
    deploymentDetails: null,
  };
}

/**
 * Poll Vercel API directly for a deployment on a specific branch.
 * Replaces {{EMPLOYER_PARENT}} comment polling — queries Vercel API for READY state.
 * Returns { status: "success"|"failed"|"timeout", previewUrl, inspectorUrl, uid, error_summary }
 */
async function pollVercelDeployment(projectId, branch, maxWaitSec = 180) {
  const token = getVercelToken();
  const teamId = getVercelTeamId();
  if (!token) {
    return {
      status: "timeout",
      previewUrl: null,
      inspectorUrl: null,
      uid: null,
      error_summary: "VERCEL_TOKEN not configured — cannot poll Vercel API.",
    };
  }

  const headers = { Authorization: `Bearer ${token}` };
  const encoded = encodeURIComponent(branch);
  const teamParam = teamId ? `&teamId=${encodeURIComponent(teamId)}` : "";
  const apiUrl = `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&meta-{{EMPLOYER_PARENT}}CommitRef=${encoded}&limit=1${teamParam}`;

  const pollInterval = 10; // seconds
  const maxAttempts = Math.ceil(maxWaitSec / pollInterval);
  let deploymentUid = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(pollInterval * 1000);
    try {
      const res = await fetch(apiUrl, { headers });
      if (!res.ok) continue;
      const data = await res.json();
      const dep = data.deployments?.[0];
      if (!dep) continue;

      deploymentUid = dep.uid;
      const state = (dep.state || dep.readyState || "").toUpperCase();

      if (state === "READY") {
        return {
          status: "success",
          previewUrl: dep.url ? `https://${dep.url}` : null,
          inspectorUrl: `https://vercel.com/deployment/${dep.uid}`,
          uid: deploymentUid,
          error_summary: null,
        };
      }

      if (state === "ERROR" || state === "CANCELED") {
        return {
          status: "failed",
          previewUrl: null,
          inspectorUrl: `https://vercel.com/deployment/${dep.uid}`,
          uid: deploymentUid,
          error_summary: `Vercel deployment ${state.toLowerCase()} — check inspector for build logs.`,
        };
      }
      // QUEUED, BUILDING, INITIALIZING — continue polling
    } catch { /* network error — retry */ }
  }

  return {
    status: "timeout",
    previewUrl: null,
    inspectorUrl: deploymentUid ? `https://vercel.com/deployment/${deploymentUid}` : null,
    uid: deploymentUid,
    error_summary: `No READY Vercel deployment found for branch '${branch}' within ${maxWaitSec}s. The build may still be in progress.`,
  };
}

/**
 * dev_push — Push current branch to remote.
 * Auto-detects Vercel-connected repos and polls for preview URLs when a PR exists.
 */
async function handleDevPush(args) {
  const folder = args.folder || process.cwd();
  const force = args.force || false;
  const set_upstream = args.set_upstream !== false; // default true
  const poll_vercel = args.poll_vercel; // true/false/undefined (auto)
  const max_wait = args.max_wait || 120;

  // ── Main branch protection ──────────────────────────────────────────
  const mainCheck = isMainBranchBlocked(folder);
  if (mainCheck.blocked) {
    return JSON.stringify({
      error: MAIN_BRANCH_BLOCKED_MSG,
      current_branch: mainCheck.branch,
      repo: mainCheck.repoName,
      action: "dev_push",
      hint: "Use start_dev_branch to create a worktree, then push from there.",
    });
  }

  try {
    const branch = run("git branch --show-current", folder, 5_000);
    if (!branch) {
      return JSON.stringify({ error: "Not on a branch (detached HEAD)." });
    }

    let pushCmd = `git push origin ${branch}`;
    if (set_upstream) pushCmd = `git push -u origin ${branch}`;
    if (force) pushCmd += " --force-with-lease";

    const result = tryRun(pushCmd, folder, 180_000);

    if (!result.ok) {
      return JSON.stringify({
        error: `Failed to push: ${result.stderr}`,
        branch,
        hint: "If the remote has diverged, consider dev_pull first or use force=true (force-with-lease).",
      });
    }

    // ── Vercel preview URL detection ──────────────────────────────────
    // Auto-detect: if poll_vercel is not explicitly set, check if this is
    // a known Vercel-connected repo and we're not on main/master.
    const detectedRepo = detectRepo(folder);
    const isVercelRepo = detectedRepo && VERCEL_REPOS.has(detectedRepo);
    const isFeatureBranch = branch !== "main" && branch !== "master";
    const shouldPoll =
      poll_vercel === true ||
      (poll_vercel !== false && isVercelRepo && isFeatureBranch);

    let vercelResult = {};

    if (shouldPoll && detectedRepo) {
      const projectId = VERCEL_PROJECT_MAP[detectedRepo];
      if (projectId) {
        const pr = findOpenPr(detectedRepo, branch, folder);
        const vercelPollResult = await pollVercelDeployment(projectId, branch, max_wait);

        if (vercelPollResult.status === "failed") {
          vercelResult = {
            pr_number: pr?.number,
            pr_url: pr?.url,
            vercel_preview_url: null,
            vercel_status: "failed",
            action_required: "fix_build_error_before_notifying",
            notify_user: false,
            ready_to_notify: false,
            next_step:
              "Fix the build error in error_summary, push the fix, and wait for a successful Vercel rebuild before sending any PR or preview update to {{PARENT_1}}.",
            inspector_url: vercelPollResult.inspectorUrl,
            error_summary: vercelPollResult.error_summary,
            vercel_note:
              "⚠️ Vercel deployment FAILED. DO NOT notify user yet. Fix the build error shown in error_summary, push the fix, and wait for Vercel to rebuild successfully before sending any preview URL.",
          };
        } else if (vercelPollResult.status === "success" && vercelPollResult.previewUrl) {
          vercelResult = {
            pr_number: pr?.number,
            pr_url: pr?.url,
            vercel_preview_url: vercelPollResult.previewUrl,
            vercel_status: "success",
            inspector_url: vercelPollResult.inspectorUrl,
            vercel_note:
              "✅ Vercel preview URL from Vercel API. Send this to {{PARENT_1}} via Telegram with the speak parameter.",
          };
        } else {
          vercelResult = {
            pr_number: pr?.number,
            pr_url: pr?.url,
            vercel_preview_url: "timeout",
            vercel_status: "timeout",
            inspector_url: vercelPollResult.inspectorUrl,
            vercel_note: `Vercel deployment not READY within ${max_wait}s. The build may still be in progress — check https://vercel.com for status.`,
          };
        }
      } else if (isVercelRepo) {
        vercelResult = {
          vercel_note:
            "Vercel-connected repo detected but no open PR found for this branch. Create a PR with create_vercel_pr to get a preview URL.",
        };
      }
    }

    return JSON.stringify({
      status: "success",
      branch,
      folder,
      repo: detectedRepo,
      output: result.stdout || result.stderr || "Pushed successfully.",
      ...vercelResult,
    });
  } catch (err) {
    return JSON.stringify({ error: `Failed to push: ${err.message}` });
  }
}

/**
 * dev_pull — Pull latest from remote (fetch + merge).
 */
async function handleDevPull(args) {
  const folder = args.folder || process.cwd();
  const rebase = args.rebase || false;

  try {
    const fetchResult = tryRun("git fetch origin", folder, 30_000);
    if (!fetchResult.ok) {
      return JSON.stringify({ error: `Fetch failed: ${fetchResult.stderr}` });
    }

    const branch = run("git branch --show-current", folder, 5_000);
    const pullCmd = rebase
      ? `git pull --rebase origin ${branch}`
      : `git pull origin ${branch}`;

    const result = tryRun(pullCmd, folder, 60_000);

    if (!result.ok) {
      return JSON.stringify({
        error: `Pull failed: ${result.stderr}`,
        branch,
        hint: "There may be merge conflicts. Resolve them manually.",
      });
    }

    return JSON.stringify({
      status: "success",
      branch,
      folder,
      output: result.stdout || "Already up to date.",
    });
  } catch (err) {
    return JSON.stringify({ error: `Failed to pull: ${err.message}` });
  }
}

/**
 * dev_checkout — Switch branches or create a new branch.
 */
async function handleDevCheckout(args) {
  const { branch, create, folder: folderArg } = args;
  const folder = folderArg || process.cwd();

  if (!branch) {
    return JSON.stringify({ error: "Branch name is required." });
  }

  // ── Guard: Direct-to-main repos don't use branches ──────────────────
  if (create) {
    const detected = detectRepoName(folder);
    if (detected && DIRECT_MAIN_REPOS.has(detected)) {
      return JSON.stringify({
        skipped: true,
        reason: `⚠️ SKIPPED: "${detected}" is a direct-to-main repo (config/agent/data only). ` +
          `Do NOT create branches here. ` +
          `Just commit directly to main with dev_add + dev_commit + dev_push.`,
        repo: detected,
      });
    }
  }

  try {
    let cmd;
    let basedOn;
    if (create) {
      // ── Fetch latest from origin before creating a new branch ──────
      const fetchResult = tryRun("git fetch origin", folder, 30_000);
      if (!fetchResult.ok) {
        // Non-fatal: warn but continue (offline/network issues shouldn't block)
      }

      // Detect default branch (main or master)
      let defaultBranch = "main";
      const headRef = tryRun(
        "git symbolic-ref refs/remotes/origin/HEAD",
        folder,
        10_000
      );
      if (headRef.ok && headRef.stdout) {
        defaultBranch = headRef.stdout.split("/").pop();
      }

      // Create new branch from latest origin/default (not stale local HEAD)
      if (fetchResult && fetchResult.ok) {
        cmd = `git checkout -b ${branch} origin/${defaultBranch}`;
        basedOn = `origin/${defaultBranch}`;
      } else {
        // Fallback if fetch failed — use local HEAD
        cmd = `git checkout -b ${branch}`;
        basedOn = "local HEAD (fetch failed)";
      }
    } else {
      cmd = `git checkout ${branch}`;
    }

    const result = tryRun(cmd, folder, 15_000);

    if (!result.ok) {
      return JSON.stringify({
        error: `Checkout failed: ${result.stderr}`,
        hint: create
          ? "Branch may already exist. Try without create=true."
          : "Branch may not exist. Try with create=true, or use start_dev_branch for worktree isolation.",
      });
    }

    const current = run("git branch --show-current", folder, 5_000);

    return JSON.stringify({
      status: "success",
      branch: current,
      folder,
      created: !!create,
      based_on: basedOn,
    });
  } catch (err) {
    return JSON.stringify({ error: `Checkout failed: ${err.message}` });
  }
}

/**
 * dev_stash — Stash or pop working changes.
 */
async function handleDevStash(args) {
  const folder = args.folder || process.cwd();
  const action = args.action || "push"; // push, pop, list, drop
  const stashMessage = args.message || "";

  try {
    let cmd;
    switch (action) {
      case "push":
        cmd = stashMessage
          ? `git stash push -m ${shellEscape(stashMessage)}`
          : "git stash push";
        break;
      case "pop":
        cmd = "git stash pop";
        break;
      case "list":
        cmd = "git stash list";
        break;
      case "drop":
        cmd = "git stash drop";
        break;
      default:
        return JSON.stringify({ error: `Unknown stash action: ${action}. Use push, pop, list, or drop.` });
    }

    const result = tryRun(cmd, folder, 15_000);
    return JSON.stringify({
      status: result.ok ? "success" : "error",
      action,
      folder,
      output: result.ok ? (result.stdout || "Done.") : result.stderr,
    });
  } catch (err) {
    return JSON.stringify({ error: `Stash failed: ${err.message}` });
  }
}

/**
 * dev_reset — Reset staged changes or undo commits.
 */
async function handleDevReset(args) {
  const folder = args.folder || process.cwd();
  const mode = args.mode || "mixed"; // soft, mixed, hard
  const target = args.target || "HEAD"; // HEAD, HEAD~1, specific commit

  // Safety: don't allow hard reset without explicit confirmation
  if (mode === "hard" && !args.confirm_hard) {
    return JSON.stringify({
      error: "Hard reset destroys uncommitted work. Set confirm_hard=true to proceed.",
      hint: "Consider 'soft' or 'mixed' reset instead.",
    });
  }

  try {
    const cmd = `git reset --${mode} ${target}`;
    const result = tryRun(cmd, folder, 15_000);

    return JSON.stringify({
      status: result.ok ? "success" : "error",
      mode,
      target,
      folder,
      output: result.ok ? (result.stdout || "Reset complete.") : result.stderr,
    });
  } catch (err) {
    return JSON.stringify({ error: `Reset failed: ${err.message}` });
  }
}

/**
 * dev_rebase — Rebase current branch onto another.
 */
async function handleDevRebase(args) {
  const folder = args.folder || process.cwd();
  const onto = args.onto || "main";
  const abort = args.abort || false;
  const continueRebase = args.continue || false;

  try {
    if (abort) {
      const result = tryRun("git rebase --abort", folder, 15_000);
      return JSON.stringify({
        status: result.ok ? "success" : "error",
        action: "abort",
        output: result.ok ? "Rebase aborted." : result.stderr,
      });
    }

    if (continueRebase) {
      // GIT_EDITOR=true skips the commit message editor (uses current message as-is)
      const result = tryRun("git -c core.editor=true rebase --continue", folder, 60_000);
      if (!result.ok) {
        // Check if there are still conflicts
        const conflicts = tryRun("git diff --name-only --diff-filter=U", folder, 5_000);
        return JSON.stringify({
          status: result.ok ? "success" : "error",
          action: "continue",
          folder,
          output: result.ok ? (result.stdout || "Rebase continued.") : result.stderr,
          ...(conflicts.ok && conflicts.stdout ? { remaining_conflicts: conflicts.stdout.split("\n").filter(Boolean) } : {}),
        });
      }
      return JSON.stringify({
        status: "success",
        action: "continue",
        folder,
        output: result.stdout || "Rebase continued successfully.",
      });
    }

    // Fetch first to ensure we have the latest
    tryRun("git fetch origin", folder, 30_000);

    const cmd = `git rebase origin/${onto}`;
    const result = tryRun(cmd, folder, 60_000);

    if (!result.ok) {
      // Extract conflicting files from stderr/stdout for actionable feedback
      const conflicts = tryRun("git diff --name-only --diff-filter=U", folder, 5_000);
      return JSON.stringify({
        error: `Rebase failed: ${result.stderr}`,
        hint: "Conflicts detected. Resolve them, then call dev_rebase with continue=true. Or abort with abort=true.",
        ...(conflicts.ok && conflicts.stdout ? { conflicting_files: conflicts.stdout.split("\n").filter(Boolean) } : {}),
      });
    }

    return JSON.stringify({
      status: "success",
      onto,
      folder,
      output: result.stdout || "Rebase complete.",
    });
  } catch (err) {
    return JSON.stringify({ error: `Rebase failed: ${err.message}` });
  }
}

/**
 * dev_merge_pr — Merge a {{EMPLOYER_PARENT}} PR via gh CLI.
 */
async function handleDevMergePr(args) {
  // ══════════════════════════════════════════════════════════════════════════
  // HARD BLOCK — dev_merge_pr is PERMANENTLY DISABLED.
  //
  // ALL PR merges must go through the approval-gated flow:
  //   1. merge_pr(repo, pr_number) → sends {{PARENT_1}} Approve/Deny buttons
  //   2. {{PARENT_1}} clicks Approve → record written to data/merge-queue.json
  //   3. merge-agent dispatched → calls execute_approved_merge
  //
  // This handler exists only to return a clear error message. The hookflow
  // enforce-merge-pr-tool-only.yml ALSO blocks this at the preToolUse level,
  // but this hardcoded refusal is defense-in-depth — if the hookflow ever
  // fails to fire, the merge still cannot happen.
  //
  // History: Surgiquip PRs #35, #25, #27 merged without approval (2026-06-28).
  //          ServoDetail unauthorized merge (2026-06-19). Never again.
  // ══════════════════════════════════════════════════════════════════════════
  return JSON.stringify({
    error: "REFUSED: dev_merge_pr is permanently disabled.",
    reason: "All PR merges require explicit {{PARENT_1}} approval via Telegram.",
    correct_flow: [
      "1. Call merge_pr(repo, pr_number) — sends {{PARENT_1}} inline keyboard buttons",
      "2. Wait for {{PARENT_1}} to click Approve",
      "3. merge-agent is auto-dispatched and calls execute_approved_merge",
    ],
    note: "Do NOT attempt to bypass this. The tool will NEVER execute a merge.",
  });
}

/**
 * dev_pr_checkout — Check out a PR into an isolated worktree.
 * Uses `gh pr view` to get the branch name, then creates a worktree for it.
 */
async function handleDevPrCheckout(args) {
  const { repo, pr_number, folder } = args;

  if (!repo || !pr_number) {
    return JSON.stringify({ error: "Both 'repo' and 'pr_number' are required." });
  }

  const name = repoName(repo);
  const repoDir = resolve(REPOS_ROOT, name);

  try {
    // ── Step 1: Ensure repo is cloned locally ───────────────────────────
    if (!existsSync(resolve(repoDir, ".git"))) {
      if (!existsSync(REPOS_ROOT)) {
        mkdirSync(REPOS_ROOT, { recursive: true });
      }
      const cloneResult = tryRun(
        `gh repo clone ${repo} "${repoDir}" -- --recurse-submodules`,
        REPOS_ROOT,
        120_000
      );
      if (!cloneResult.ok) {
        return JSON.stringify({
          error: `Failed to clone ${repo}: ${cloneResult.stderr}`,
        });
      }
    }

    // ── Step 2: Get PR branch name via gh CLI ───────────────────────────
    const prInfo = tryRun(
      `gh pr view ${pr_number} --repo ${repo} --json headRefName,title,state`,
      repoDir,
      15_000
    );

    if (!prInfo.ok) {
      return JSON.stringify({
        error: `Failed to get PR #${pr_number} info: ${prInfo.stderr}`,
        hint: "Verify the PR number and repo are correct.",
      });
    }

    const prData = JSON.parse(prInfo.stdout);
    const branch = prData.headRefName;
    const prTitle = prData.title;
    const prState = prData.state;

    if (!branch) {
      return JSON.stringify({
        error: `Could not determine branch name for PR #${pr_number}.`,
      });
    }

    // ── Step 3: Fetch the PR branch ─────────────────────────────────────
    const fetchResult = tryRun("git fetch origin", repoDir, 30_000);
    if (!fetchResult.ok) {
      return JSON.stringify({
        error: `Failed to fetch origin: ${fetchResult.stderr}`,
      });
    }

    // ── Step 4: Create worktree for the PR branch ───────────────────────
    const worktreeDir = resolve(REPOS_ROOT, name, "workdir", branchToDir(branch));

    if (existsSync(worktreeDir)) {
      return JSON.stringify({
        status: "already_exists",
        message: `Worktree for PR #${pr_number} branch '${branch}' already exists.`,
        folder: worktreeDir,
        branch,
        pr_number: Number(pr_number),
        pr_title: prTitle,
        pr_state: prState,
        repo,
      });
    }

    // Ensure workdir parent exists
    const workdirParent = resolve(REPOS_ROOT, name, "workdir");
    if (!existsSync(workdirParent)) {
      mkdirSync(workdirParent, { recursive: true });
    }

    // Check if local branch already exists
    const localBranch = tryRun(
      `git show-ref --verify refs/heads/${branch}`,
      repoDir,
      5_000
    );

    let worktreeResult;
    if (localBranch.ok) {
      worktreeResult = tryRun(
        `git worktree add "${worktreeDir}" ${branch}`,
        repoDir,
        30_000
      );
    } else {
      // Track from remote
      worktreeResult = tryRun(
        `git worktree add "${worktreeDir}" -b ${branch} origin/${branch}`,
        repoDir,
        30_000
      );
    }

    if (!worktreeResult.ok) {
      return JSON.stringify({
        error: `Failed to create worktree: ${worktreeResult.stderr}`,
        hint: "If the branch exists in another worktree, remove it first.",
      });
    }

    return JSON.stringify({
      status: "created",
      message: `PR #${pr_number} checked out into isolated worktree.`,
      folder: worktreeDir,
      branch,
      pr_number: Number(pr_number),
      pr_title: prTitle,
      pr_state: prState,
      repo,
    });
  } catch (err) {
    return JSON.stringify({ error: `PR checkout failed: ${err.message}` });
  }
}

/**
 * dev_get_pr_details — Fetch comprehensive PR info in a single call.
 * Combines `gh pr view --json` (basic info, comments, reviews, checks, linked issues)
 * with the {{EMPLOYER_PARENT}} Deployments API (Vercel preview URL + state) and a Vercel-bot
 * comment scrape as a fallback for the preview URL.
 */
async function handleGetPrDetails(args) {
  const { repo, pr_number } = args;

  if (!repo || !pr_number) {
    return JSON.stringify({ error: "Both 'repo' and 'pr_number' are required." });
  }

  const cwd = process.cwd();

  // ── 1. Pull the bulk of the PR metadata via gh's GraphQL-backed JSON view ──
  const fields = [
    "number", "title", "body", "state", "isDraft", "url",
    "author", "headRefName", "headRefOid", "baseRefName",
    "createdAt", "updatedAt", "mergedAt", "closedAt",
    "mergeable", "mergeStateStatus",
    "labels", "reviewRequests", "reviews", "comments",
    "statusCheckRollup", "closingIssuesReferences",
    "additions", "deletions", "changedFiles",
  ].join(",");

  const prResult = tryRun(
    `gh pr view ${pr_number} --repo ${repo} --json ${fields}`,
    cwd,
    30_000
  );

  if (!prResult.ok) {
    return JSON.stringify({
      error: `Failed to fetch PR: ${prResult.stderr || prResult.stdout}`,
    });
  }

  let pr;
  try {
    pr = JSON.parse(prResult.stdout);
  } catch (err) {
    return JSON.stringify({ error: `Failed to parse PR JSON: ${err.message}` });
  }

  const headSha = pr.headRefOid;

  // ── 2. Deployments (Vercel) — most-recent deployment + its latest status ──
  let deployment = null;
  if (headSha) {
    const deplResult = tryRun(
      `gh api "repos/${repo}/deployments?sha=${headSha}&per_page=10"`,
      cwd,
      15_000
    );
    if (deplResult.ok && deplResult.stdout) {
      try {
        const deployments = JSON.parse(deplResult.stdout);
        if (Array.isArray(deployments) && deployments.length > 0) {
          // Pick the most recent (deployments are returned newest-first by GH).
          const d = deployments[0];
          let state = null;
          let environmentUrl = null;
          let logUrl = null;
          let description = null;
          let statusUpdatedAt = null;

          const statusResult = tryRun(
            `gh api "repos/${repo}/deployments/${d.id}/statuses?per_page=10"`,
            cwd,
            15_000
          );
          if (statusResult.ok && statusResult.stdout) {
            try {
              const statuses = JSON.parse(statusResult.stdout);
              if (Array.isArray(statuses) && statuses.length > 0) {
                const s = statuses[0]; // newest-first
                state = s.state;
                environmentUrl = s.environment_url || null;
                logUrl = s.log_url || null;
                description = s.description || null;
                statusUpdatedAt = s.updated_at || null;
              }
            } catch { /* ignore status parse errors */ }
          }

          deployment = {
            id: d.id,
            environment: d.environment,
            ref: d.ref,
            sha: d.sha,
            created_at: d.created_at,
            updated_at: d.updated_at,
            state,
            preview_url: environmentUrl,
            log_url: logUrl,
            description,
            status_updated_at: statusUpdatedAt,
          };
        }
      } catch { /* ignore deployments parse errors */ }
    }
  }

  // ── 3. Fallback: scrape Vercel bot comment for preview URL ────────────────
  if (!deployment || !deployment.preview_url) {
    const vercelCommentResult = tryRun(
      `gh api "repos/${repo}/issues/${pr_number}/comments?per_page=100" --jq "[.[] | select(.user.login == \\"vercel[bot]\\" or .user.login == \\"vercel\\") | .body] | last"`,
      cwd,
      15_000
    );
    if (vercelCommentResult.ok && vercelCommentResult.stdout) {
      const parsed = parseVercelComment(vercelCommentResult.stdout);
      if (parsed && (parsed.previewUrl || parsed.inspectorUrl)) {
        if (!deployment) deployment = { state: parsed.status || null };
        deployment.preview_url = deployment.preview_url || parsed.previewUrl || null;
        deployment.inspector_url = parsed.inspectorUrl || null;
        deployment.source = "vercel_bot_comment";
      }
    }
  }

  // ── 4. CI / check runs — flatten statusCheckRollup into a clean shape ─────
  const checks = Array.isArray(pr.statusCheckRollup)
    ? pr.statusCheckRollup.map((c) => ({
        name: c.name || c.context || null,
        status: c.status || null,           // QUEUED, IN_PROGRESS, COMPLETED (check runs)
        conclusion: c.conclusion || null,   // SUCCESS, FAILURE, NEUTRAL, CANCELLED, etc.
        state: c.state || null,             // legacy commit-status state (success/failure/pending)
        workflow_name: c.workflowName || null,
        details_url: c.detailsUrl || c.targetUrl || null,
        started_at: c.startedAt || null,
        completed_at: c.completedAt || null,
      }))
    : [];

  // Roll-up summary: "success" | "failure" | "pending" | "neutral"
  let checks_summary = "neutral";
  if (checks.length > 0) {
    const norm = (v) => (v || "").toString().toUpperCase();
    const hasFailure = checks.some(
      (c) => ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(norm(c.conclusion)) ||
             norm(c.state) === "FAILURE" || norm(c.state) === "ERROR"
    );
    const hasPending = checks.some(
      (c) => ["QUEUED", "IN_PROGRESS", "PENDING"].includes(norm(c.status)) ||
             norm(c.state) === "PENDING"
    );
    const allSuccess = checks.every(
      (c) => norm(c.conclusion) === "SUCCESS" || norm(c.state) === "SUCCESS" ||
             norm(c.conclusion) === "SKIPPED" || norm(c.conclusion) === "NEUTRAL"
    );
    if (hasFailure) checks_summary = "failure";
    else if (hasPending) checks_summary = "pending";
    else if (allSuccess) checks_summary = "success";
  }

  // ── 5. Linked issues — combine API data with body regex parse ─────────────
  const linkedFromApi = Array.isArray(pr.closingIssuesReferences)
    ? pr.closingIssuesReferences.map((i) => ({
        number: i.number,
        title: i.title,
        url: i.url,
        state: i.state || null,
        source: "api",
      }))
    : [];

  const bodyText = pr.body || "";
  const linkRegex = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  const fromBody = new Set();
  let m;
  while ((m = linkRegex.exec(bodyText)) !== null) {
    fromBody.add(parseInt(m[1], 10));
  }
  const apiNumbers = new Set(linkedFromApi.map((i) => i.number));
  const linkedFromBody = [...fromBody]
    .filter((n) => !apiNumbers.has(n))
    .map((n) => ({ number: n, source: "body_regex" }));

  const linked_issues = [...linkedFromApi, ...linkedFromBody];

  // ── 6. Reviews — flatten + summarize ──────────────────────────────────────
  const reviews = Array.isArray(pr.reviews)
    ? pr.reviews.map((r) => ({
        author: r.author?.login || null,
        state: r.state, // APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING
        body: r.body || "",
        submitted_at: r.submittedAt || null,
      }))
    : [];

  // Latest non-COMMENTED review per author wins for the rollup
  let review_summary = "pending";
  const latestByAuthor = new Map();
  for (const r of reviews) {
    if (!r.author || r.state === "COMMENTED" || r.state === "DISMISSED") continue;
    const prev = latestByAuthor.get(r.author);
    if (!prev || (r.submitted_at && r.submitted_at > prev.submitted_at)) {
      latestByAuthor.set(r.author, r);
    }
  }
  const decisive = [...latestByAuthor.values()];
  if (decisive.some((r) => r.state === "CHANGES_REQUESTED")) review_summary = "changes_requested";
  else if (decisive.some((r) => r.state === "APPROVED")) review_summary = "approved";

  // ── 7. Comments — issue/PR conversation comments ──────────────────────────
  const comments = Array.isArray(pr.comments)
    ? pr.comments.map((c) => ({
        author: c.author?.login || null,
        body: c.body || "",
        created_at: c.createdAt || null,
        url: c.url || null,
      }))
    : [];

  // ── 8. Reviewers requested ────────────────────────────────────────────────
  const reviewers_requested = Array.isArray(pr.reviewRequests)
    ? pr.reviewRequests.map((r) => r.login || r.name || null).filter(Boolean)
    : [];

  // ── 9. Final assembly ─────────────────────────────────────────────────────
  return JSON.stringify({
    repo,
    number: pr.number,
    url: pr.url,
    title: pr.title,
    body: pr.body || "",
    state: pr.state,                 // OPEN, CLOSED, MERGED
    is_draft: pr.isDraft,
    author: pr.author?.login || null,
    branch: pr.headRefName,
    head_sha: headSha,
    base_branch: pr.baseRefName,
    created_at: pr.createdAt,
    updated_at: pr.updatedAt,
    merged_at: pr.mergedAt || null,
    closed_at: pr.closedAt || null,
    mergeable: pr.mergeable,                  // MERGEABLE, CONFLICTING, UNKNOWN
    merge_state: pr.mergeStateStatus || null, // CLEAN, DIRTY, BLOCKED, BEHIND, etc.
    additions: pr.additions ?? null,
    deletions: pr.deletions ?? null,
    changed_files: pr.changedFiles ?? null,
    labels: Array.isArray(pr.labels) ? pr.labels.map((l) => l.name) : [],
    reviewers_requested,
    reviews,
    review_summary,
    comments,
    checks,
    checks_summary,
    deployment,
    linked_issues,
  });
}

// ── Join Session ────────────────────────────────────────────────────────────

await joinSession({
  tools: [
    // ── Worktree / Project Setup ──
    {
      name: "start_dev_branch",
      description:
        "Create an isolated git worktree for parallel development. Clones the repo if not already local, fetches latest, and creates a worktree with a new branch off the default branch. Returns the absolute folder path where the agent can immediately start working. Use this instead of 'git clone', 'git worktree add', or 'git checkout -b' for new feature work.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description:
              "{{EMPLOYER_PARENT}} repo in owner/repo format (e.g. '{{GITHUB_USERNAME}}/htek-dev-site')",
          },
          branch: {
            type: "string",
            description:
              "Branch name to create (e.g. 'feat/blueprint-colors'). Will be created off the default branch.",
          },
        },
        required: ["repo", "branch"],
      },
      skipPermission: true,
      handler: handleStartDevBranch,
    },

    // ── PR Checkout ──
    {
      name: "dev_pr_checkout",
      description:
        "Check out a {{EMPLOYER_PARENT}} Pull Request into an isolated git worktree. Fetches the PR branch and creates a worktree so the agent can review/modify the PR code without affecting the main repo clone. Returns the worktree folder path. Use this instead of 'gh pr checkout'.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description:
              "{{EMPLOYER_PARENT}} repo in owner/repo format (e.g. '{{GITHUB_USERNAME}}/htek-dev-site')",
          },
          pr_number: {
            type: "number",
            description: "PR number to check out (e.g. 277).",
          },
        },
        required: ["repo", "pr_number"],
      },
      skipPermission: true,
      handler: handleDevPrCheckout,
    },

    // ── Vercel PR ──
    {
      name: "create_vercel_pr",
      description:
        "Push a branch, create a {{EMPLOYER_PARENT}} PR, and wait for the Vercel preview URL. Queries Vercel API directly for deployment status — no comment polling. Returns status='success' with preview URL on successful deployment, or status='failed' with action_required='fix_build_error_before_notifying', notify_user=false, error_summary, and inspector_url when the build fails — so you fix it before notifying {{PARENT_1}}. Returns 'timeout' if no result within max_wait seconds. Use after making changes in a worktree created by start_dev_branch.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description:
              "{{EMPLOYER_PARENT}} repo in owner/repo format (e.g. '{{GITHUB_USERNAME}}/htek-dev-site')",
          },
          branch: {
            type: "string",
            description: "Branch name to push and create PR for",
          },
          title: {
            type: "string",
            description: "PR title",
          },
          description: {
            type: "string",
            description: "PR description / body (supports Markdown)",
          },
          folder: {
            type: "string",
            description:
              "Absolute path to the worktree folder (from start_dev_branch output)",
          },
          push: {
            type: "boolean",
            description:
              "Whether to push the branch before creating the PR (default: true)",
          },
          max_wait: {
            type: "number",
            description:
              "Max seconds to poll for Vercel preview URL (default: 120). Polls every 10 seconds.",
          },
        },
        required: ["repo", "branch", "title", "description", "folder"],
      },
      handler: handleCreateVercelPr,
    },

    // ── Status ──
    {
      name: "dev_status",
      description:
        "Check the git working tree status — staged, unstaged, and untracked files. Also reports how many commits ahead/behind the remote. Use instead of 'git status'. Safe read-only operation.",
      parameters: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "Absolute path to the repo or worktree folder. Defaults to current working directory.",
          },
        },
      },
      skipPermission: true,
      handler: handleDevStatus,
    },

    // ── Add / Stage ──
    {
      name: "dev_add",
      description:
        "Stage files for the next commit. Use instead of 'git add'. Pass files='.' to stage everything, or specify paths.",
      parameters: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "Absolute path to the repo or worktree folder. Defaults to cwd.",
          },
          files: {
            type: "string",
            description: "Files to stage — '.' for all (default), or space-separated paths.",
          },
        },
      },
      skipPermission: true,
      handler: handleDevAdd,
    },

    // ── Commit ──
    {
      name: "dev_commit",
      description:
        "Commit staged changes with a message. Automatically adds Co-authored-by trailer. Use instead of 'git commit'. Set add_all=true to stage everything before committing.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "Commit message (e.g. 'feat: add dark mode toggle').",
          },
          folder: {
            type: "string",
            description: "Absolute path to the repo or worktree folder. Defaults to cwd.",
          },
          add_all: {
            type: "boolean",
            description: "If true, runs 'git add -A' before committing (default: false).",
          },
        },
        required: ["message"],
      },
      handler: handleDevCommit,
    },

    // ── Push ──
    {
      name: "dev_push",
      description:
        "Push the current branch to the remote. Sets upstream tracking by default. Auto-detects Vercel-connected repos (htek-dev-site, blackout-pickleball, carplay-mobile-detail) and queries the Vercel API directly for the preview URL when an open PR exists — no comment polling, faster and more reliable. On success it returns the preview URL to send to {{PARENT_1}}; on Vercel failure it returns action_required='fix_build_error_before_notifying' and notify_user=false so you fix the build before notifying him. Use instead of 'git push' or 'hookflow git-push'.",
      parameters: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "Absolute path to the repo or worktree folder. Defaults to cwd.",
          },
          force: {
            type: "boolean",
            description: "Use --force-with-lease for safe force push (default: false).",
          },
          set_upstream: {
            type: "boolean",
            description: "Set upstream tracking with -u (default: true).",
          },
          poll_vercel: {
            type: "boolean",
            description: "Poll for Vercel preview URL after push. Auto-detected for known Vercel repos when pushing a feature branch with an open PR. Set true to force polling, false to skip.",
          },
          max_wait: {
            type: "number",
            description: "Max seconds to poll for Vercel preview URL (default: 120). Polls every 10 seconds.",
          },
        },
      },
      handler: handleDevPush,
    },

    // ── Pull ──
    {
      name: "dev_pull",
      description:
        "Fetch from remote and merge/rebase into the current branch. Use instead of 'git pull' or 'git fetch'.",
      parameters: {
        type: "object",
        properties: {
          folder: {
            type: "string",
            description: "Absolute path to the repo or worktree folder. Defaults to cwd.",
          },
          rebase: {
            type: "boolean",
            description: "Use --rebase instead of merge (default: false).",
          },
        },
      },
      handler: handleDevPull,
    },

    // ── Checkout / Switch ──
    {
      name: "dev_checkout",
      description:
        "Switch to an existing branch or create a new one. Use instead of 'git checkout' or 'git switch'. For isolated worktree work, prefer start_dev_branch instead.",
      parameters: {
        type: "object",
        properties: {
          branch: {
            type: "string",
            description: "Branch name to switch to or create.",
          },
          create: {
            type: "boolean",
            description: "If true, create the branch (-b flag). Default: false.",
          },
          folder: {
            type: "string",
            description: "Absolute path to the repo or worktree folder. Defaults to cwd.",
          },
        },
        required: ["branch"],
      },
      handler: handleDevCheckout,
    },

    // ── Stash ──
    {
      name: "dev_stash",
      description:
        "Stash or restore working changes. Actions: push (save), pop (restore), list (show all), drop (remove top stash). Use instead of 'git stash'.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "Stash action: 'push' (default), 'pop', 'list', or 'drop'.",
          },
          message: {
            type: "string",
            description: "Optional stash message (only for push action).",
          },
          folder: {
            type: "string",
            description: "Absolute path to the repo or worktree folder. Defaults to cwd.",
          },
        },
      },
      handler: handleDevStash,
    },

    // ── Reset ──
    {
      name: "dev_reset",
      description:
        "Reset staged changes or undo commits. Modes: 'soft' (keep changes staged), 'mixed' (unstage, keep working tree), 'hard' (discard everything — requires confirm_hard=true). Use instead of 'git reset'.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            description: "Reset mode: 'soft', 'mixed' (default), or 'hard'.",
          },
          target: {
            type: "string",
            description: "Reset target: 'HEAD' (default), 'HEAD~1', or a commit SHA.",
          },
          confirm_hard: {
            type: "boolean",
            description: "Required when mode='hard'. Confirms destructive operation.",
          },
          folder: {
            type: "string",
            description: "Absolute path to the repo or worktree folder. Defaults to cwd.",
          },
        },
      },
      handler: handleDevReset,
    },

    // ── Rebase ──
    {
      name: "dev_rebase",
      description:
        "Rebase the current branch onto another branch (fetches latest first). Use instead of 'git rebase'. Set abort=true to cancel an in-progress rebase.",
      parameters: {
        type: "object",
        properties: {
          onto: {
            type: "string",
            description: "Branch to rebase onto (default: 'main'). Will rebase onto origin/{onto}.",
          },
          abort: {
            type: "boolean",
            description: "If true, abort an in-progress rebase.",
          },
          folder: {
            type: "string",
            description: "Absolute path to the repo or worktree folder. Defaults to cwd.",
          },
        },
      },
      handler: handleDevRebase,
    },

    // ── Merge PR ──
    {
      name: "dev_merge_pr",
      description:
        "Merge a {{EMPLOYER_PARENT}} Pull Request. Uses squash merge by default and deletes the source branch. Use instead of 'gh pr merge' or 'git merge'.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "{{EMPLOYER_PARENT}} repo in owner/repo format (e.g. '{{GITHUB_USERNAME}}/htek-dev-site').",
          },
          pr_number: {
            type: "number",
            description: "PR number to merge.",
          },
          method: {
            type: "string",
            description: "Merge method: 'squash' (default), 'merge', or 'rebase'.",
          },
          delete_branch: {
            type: "boolean",
            description: "Delete source branch after merge (default: true).",
          },
        },
        required: ["repo", "pr_number"],
      },
      handler: handleDevMergePr,
    },

    // ── Get PR Details ──
    {
      name: "dev_get_pr_details",
      description:
        "Fetch comprehensive details for a {{EMPLOYER_PARENT}} Pull Request in a single call: title, body, state, author, branches, mergeability, labels, reviewers, reviews + review_summary, conversation comments, all CI/check runs + checks_summary, Vercel deployment (preview URL + state, with vercel[bot] comment fallback), and linked issues (closes/fixes/resolves #N + {{EMPLOYER_PARENT}}'s linked issues API). Returns one clean JSON object — use instead of scraping `gh pr view`, `gh pr checks`, deployment APIs, or PR comments separately.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "{{EMPLOYER_PARENT}} repo in owner/repo format (e.g. '{{GITHUB_USERNAME}}/htek-dev-site').",
          },
          pr_number: {
            type: "number",
            description: "PR number (e.g. 277).",
          },
        },
        required: ["repo", "pr_number"],
      },
      skipPermission: true,
      handler: handleGetPrDetails,
    },
  ],
  hooks: {
    onSessionStart: async () => {
      return {
        additionalContext:
          "[dev-workflow] Extension loaded — ALL git operations available as tools. Raw git commands are BLOCKED by dev-guard. Available: start_dev_branch, dev_pr_checkout, create_vercel_pr, dev_status, dev_add, dev_commit, dev_push, dev_pull, dev_checkout, dev_stash, dev_reset, dev_rebase, dev_merge_pr, dev_get_pr_details.",
      };
    },
  },
});
