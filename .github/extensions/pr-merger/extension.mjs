/**
 * PR Merger Extension for GitHub Copilot CLI
 *
 * Lets agents list open PRs and merge them on Hector's explicit instruction.
 * Bypasses the same-author UI restriction — the REST API merge works fine when
 * Hector explicitly asks for it (his request = his approval).
 *
 * Tools:
 *   - list_open_prs  — List open, non-conflicting PRs across Hector's repos
 *   - merge_pr       — Merge a specific PR via GitHub REST API (squash default)
 *
 * Usage pattern (agent loop):
 *   1. Hector: "merge my PRs" / "what PRs are waiting?"
 *   2. Agent calls list_open_prs → shows formatted list
 *   3. Hector: "merge 1, 3" or "merge all htek-dev-site ones"
 *   4. Agent calls merge_pr for each → confirms each result
 *
 * Zero external dependencies — uses only node:* built-ins + @github/copilot-sdk.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession } from "@github/copilot-sdk/extension";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ───────────────────────────────────────────────────────────────────

/**
 * Repos scanned by list_open_prs (in priority order).
 * Override at call time with the `repos` param.
 */
const DEFAULT_REPOS = [
  "htekdev/htek-dev-site",
  "htekdev/ai-harness",
  "htekdev/gh-hookflow",
  "htekdev/vidpipe",
  "htekdev/rocha-family",
  "htekdev/content-management",
];

const HECTOR_CHAT_ID = "7729308746";

// ── Env / token loading ───────────────────────────────────────────────────────

function parseEnvFile(filePath) {
  const result = {};
  if (!existsSync(filePath)) return result;
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

const ENV_FILE = resolve(process.cwd(), ".env");
const envVars = parseEnvFile(ENV_FILE);

function getToken(key) {
  return process.env[key] || envVars[key] || "";
}

// ── GitHub REST/GraphQL helpers ───────────────────────────────────────────────

async function ghRest(path, token, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "copilot-pr-merger/1.0",
      "Content-Type": "application/json",
    },
    ...options,
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function ghGraphQL(query, token) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "copilot-pr-merger/1.0",
    },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

// ── Telegram helper ───────────────────────────────────────────────────────────

async function sendTelegram(text, token) {
  if (!token) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: HECTOR_CHAT_ID,
          text,
          parse_mode: "HTML",
        }),
      }
    );
    const data = await res.json();
    return data.ok;
  } catch {
    return false;
  }
}

// ── Tool: list_open_prs ───────────────────────────────────────────────────────

async function handleListOpenPrs(args) {
  const GH_TOKEN = getToken("GITHUB_TOKEN") || getToken("GH_TOKEN");
  if (!GH_TOKEN) {
    return JSON.stringify({ error: "No GitHub token found. Set GITHUB_TOKEN in .env." });
  }

  const repos = args.repos
    ? String(args.repos)
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
    : DEFAULT_REPOS;

  const authorFilter = args.author ? String(args.author) : null;
  const includeUnknown = args.include_unknown === true;

  // Build batched GraphQL query — one alias per repo
  const fragments = repos.map((repo, i) => {
    const [owner, name] = repo.split("/");
    return `
      repo${i}: repository(owner: "${owner}", name: "${name}") {
        pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            number
            title
            mergeable
            author { login }
            headRefName
            updatedAt
          }
        }
      }`;
  });

  const query = `{ ${fragments.join("\n")} }`;
  const json = await ghGraphQL(query, GH_TOKEN);

  if (json.errors) {
    return JSON.stringify({ error: "GraphQL error", details: json.errors });
  }

  const allPRs = [];
  const gqlData = json.data || {};

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    const repoData = gqlData[`repo${i}`];
    if (!repoData) continue;

    for (const pr of repoData.pullRequests.nodes) {
      // GraphQL mergeable: MERGEABLE | CONFLICTING | UNKNOWN
      if (pr.mergeable === "CONFLICTING") continue;
      if (pr.mergeable === "UNKNOWN" && !includeUnknown) continue;
      if (authorFilter && pr.author?.login !== authorFilter) continue;

      allPRs.push({
        repo,
        number: pr.number,
        title: pr.title,
        author: pr.author?.login ?? "unknown",
        branch: pr.headRefName ?? "",
        mergeable: pr.mergeable,
        updated_at: pr.updatedAt,
      });
    }
  }

  // Sort: most recently updated first
  allPRs.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  if (allPRs.length === 0) {
    return JSON.stringify({
      prs: [],
      count: 0,
      message: authorFilter
        ? `No open mergeable PRs found for author '${authorFilter}'.`
        : "No open mergeable PRs found across tracked repos.",
    });
  }

  return JSON.stringify({
    prs: allPRs,
    count: allPRs.length,
    repos_scanned: repos,
    note: "MERGEABLE = confirmed clean. UNKNOWN = status not yet computed (may still merge). Use merge_pr to merge any of these.",
  });
}

// ── Tool: merge_pr ────────────────────────────────────────────────────────────

async function handleMergePr(args) {
  const { repo, pr_number, merge_method, delete_branch } = args;

  if (!repo || !pr_number) {
    return JSON.stringify({ error: "Both 'repo' and 'pr_number' are required." });
  }

  const GH_TOKEN = getToken("GITHUB_TOKEN") || getToken("GH_TOKEN");
  if (!GH_TOKEN) {
    return JSON.stringify({ error: "No GitHub token found. Set GITHUB_TOKEN in .env." });
  }

  const method = merge_method || "squash";
  const validMethods = ["squash", "merge", "rebase"];
  if (!validMethods.includes(method)) {
    return JSON.stringify({
      error: `Invalid merge_method '${method}'. Must be one of: ${validMethods.join(", ")}.`,
    });
  }

  // ── Fetch PR info first ──────────────────────────────────────────────────
  const prInfo = await ghRest(`/repos/${repo}/pulls/${pr_number}`, GH_TOKEN);
  if (!prInfo.ok) {
    return JSON.stringify({
      error: `Could not fetch PR #${pr_number} from ${repo}: ${prInfo.data.message}`,
      status: prInfo.status,
    });
  }

  const pr = prInfo.data;
  const prTitle = pr.title ?? `PR #${pr_number}`;
  const headBranch = pr.head?.ref ?? "";
  const mergeableState = pr.mergeable_state; // clean, dirty, blocked, unknown

  if (pr.state !== "open") {
    return JSON.stringify({
      error: `PR #${pr_number} is not open (state: ${pr.state}). Nothing to merge.`,
    });
  }

  // ── Call merge API ───────────────────────────────────────────────────────
  const mergeRes = await ghRest(
    `/repos/${repo}/pulls/${pr_number}/merge`,
    GH_TOKEN,
    {
      method: "PUT",
      body: JSON.stringify({ merge_method: method }),
    }
  );

  if (!mergeRes.ok) {
    // Map common status codes to actionable messages
    let hint = "";
    if (mergeRes.status === 405) {
      hint = "Branch protection requires at least one approved review from another person.";
    } else if (mergeRes.status === 409) {
      hint = "PR has merge conflicts — rebase or resolve conflicts first.";
    } else if (mergeRes.status === 422) {
      hint = mergeRes.data.message || "Merge blocked — check branch protection rules.";
    }

    return JSON.stringify({
      status: "failed",
      pr_number,
      repo,
      pr_title: prTitle,
      http_status: mergeRes.status,
      error: mergeRes.data.message || "Merge failed.",
      hint,
    });
  }

  const sha = mergeRes.data.sha ?? "";

  // ── Delete branch if requested ───────────────────────────────────────────
  let branchDeleted = false;
  if (delete_branch !== false && headBranch) {
    const delRes = await ghRest(
      `/repos/${repo}/git/refs/heads/${headBranch}`,
      GH_TOKEN,
      { method: "DELETE" }
    );
    branchDeleted = delRes.status === 204;
  }

  // ── Telegram confirmation ────────────────────────────────────────────────
  const TG_TOKEN = getToken("TELEGRAM_BOT_TOKEN");
  const shortRepo = repo.replace("htekdev/", "");
  const tgMsg = `✅ Merged <b>${shortRepo}#${pr_number}</b> (${method})\n<i>${prTitle}</i>${branchDeleted ? "\n🗑️ Branch deleted" : ""}`;
  await sendTelegram(tgMsg, TG_TOKEN);

  return JSON.stringify({
    status: "merged",
    pr_number,
    repo,
    pr_title: prTitle,
    merge_method: method,
    merge_commit_sha: sha,
    branch_deleted: branchDeleted,
    head_branch: headBranch,
    mergeable_state_before: mergeableState,
  });
}

// ── Extension registration ────────────────────────────────────────────────────

const session = await joinSession({
  tools: [
    // ── list_open_prs ──
    {
      name: "list_open_prs",
      description:
        "List open, non-conflicting pull requests across Hector's GitHub repos. " +
        "Call this first when Hector asks to merge PRs — it shows the full list so he can pick which ones. " +
        "Returns PR number, title, repo, author, and mergeable status for each.",
      parameters: {
        type: "object",
        properties: {
          repos: {
            type: "string",
            description:
              "Comma-separated list of repos to scan in owner/repo format. " +
              "Defaults to all of Hector's main repos if omitted.",
          },
          author: {
            type: "string",
            description:
              "Filter by PR author login (e.g. 'htekdev'). Omit to show all authors.",
          },
          include_unknown: {
            type: "boolean",
            description:
              "Include PRs with UNKNOWN mergeable status (not yet computed by GitHub). Default: false.",
          },
        },
        required: [],
      },
      handler: handleListOpenPrs,
    },

    // merge_pr REMOVED — all merges must go through telegram-bridge's
    // approval-gated merge_pr tool (inline keyboard ✅/❌) to prevent escape hatches.
  ],

  hooks: {
    onSessionStart: async () => {
      const GH_TOKEN = getToken("GITHUB_TOKEN") || getToken("GH_TOKEN");
      const hasToken = Boolean(GH_TOKEN);

      return {
        additionalContext:
          "[pr-merger] Extension loaded — tool available:\n" +
          "  • list_open_prs — show open mergeable PRs across Hector's repos\n\n" +
          "To MERGE a PR, use the merge_pr tool (from telegram-bridge) which sends Hector " +
          "an inline keyboard for approval. Direct merges without approval are not allowed.\n" +
          (hasToken ? "GitHub token: ✓ loaded." : "⚠️ No GitHub token found — set GITHUB_TOKEN in .env."),
      };
    },
  },
});

await session.log("pr-merger extension loaded");
