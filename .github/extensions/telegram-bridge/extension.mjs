/**
 * Telegram Bridge Extension for GitHub Copilot CLI
 *
 * Bridges Telegram messages <-> Copilot CLI sessions using long polling.
 * - Telegram messages become user prompts in the session.
 * - Assistant responses are forwarded back to Telegram.
 *
 * Requires TELEGRAM_BOT_TOKEN in .env at the project root.
 * Set TELEGRAM_ALLOWED_USERS to a JSON array of user ID strings to restrict access.
 *
 * Set BRIDGE_MODE=standalone in .env to disable this extension
 * (when using the standalone bridge service instead).
 */
import { readFileSync, existsSync, writeFileSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { hostname } from "node:os";
import { joinSession } from "@github/copilot-sdk/extension";

// GramJS-powered large file downloader (MTProto, no 20MB limit)
// Lazy-loaded on first use to avoid blocking extension startup (~2-4s cold import)
const __dirname = dirname(fileURLToPath(import.meta.url));
let downloadLargeFile = null;
let _gramjsLoadAttempted = false;

async function getDownloadLargeFile() {
  if (_gramjsLoadAttempted) return downloadLargeFile;
  _gramjsLoadAttempted = true;
  try {
    const mod = await import(resolve(__dirname, "gramjs-downloader.mjs"));
    downloadLargeFile = mod.downloadLargeFile;
  } catch {
    // GramJS not available — will fall back to Bot API (with 20MB limit)
  }
  return downloadLargeFile;
}

// ---------------------------------------------------------------------------
// Skip if standalone bridge service is handling Telegram
// ---------------------------------------------------------------------------
function checkBridgeMode() {
  if (process.env.BRIDGE_MODE === "standalone") return true;
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return false;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "BRIDGE_MODE=standalone") return true;
  }
  return false;
}

if (checkBridgeMode()) {
  await joinSession({ tools: [] });
  // Extension loaded but idle — standalone service handles Telegram
} else {

// ---------------------------------------------------------------------------
// Configuration — read from .env
// ---------------------------------------------------------------------------
const ENV_FILE = resolve(process.cwd(), ".env");
let TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
let ALLOWED_USERS_RAW = process.env.TELEGRAM_ALLOWED_USERS || "";
let TELEGRAM_API_ID = process.env.TELEGRAM_API_ID || "";
let TELEGRAM_API_HASH = process.env.TELEGRAM_API_HASH || "";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key === "TELEGRAM_BOT_TOKEN" && !TELEGRAM_TOKEN) TELEGRAM_TOKEN = value;
    if (key === "TELEGRAM_ALLOWED_USERS" && !ALLOWED_USERS_RAW) ALLOWED_USERS_RAW = value;
    if (key === "TELEGRAM_API_ID" && !TELEGRAM_API_ID) TELEGRAM_API_ID = value;
    if (key === "TELEGRAM_API_HASH" && !TELEGRAM_API_HASH) TELEGRAM_API_HASH = value;
  }
}

parseEnvFile(ENV_FILE);

// Parse allowed users as a Set of user ID strings
let ALLOWED_USERS = new Set();
try {
  const parsed = JSON.parse(ALLOWED_USERS_RAW);
  if (Array.isArray(parsed)) {
    ALLOWED_USERS = new Set(parsed.map(String));
  }
} catch {
  // Fall back to empty set — no user restriction
}

function isUserAllowed(userId) {
  if (ALLOWED_USERS.size === 0) return true; // no restriction if empty
  return ALLOWED_USERS.has(String(userId));
}

// ---------------------------------------------------------------------------
// PR Merge Approval System
// Agents call merge_pr(repo, pr_number, description) → Telegram inline keyboard
// → Hector taps ✅/❌ → deterministic merge or denial
// ---------------------------------------------------------------------------

/** In-memory pending approval requests: requestId → { resolve, msgText, messageId } */
const pendingApprovals = new Map();
// Track renewal setTimeout IDs so we can cancel them when approvals are processed
const renewalTimers = new Map();

/**
 * Maximum number of auto-renewals before a pending approval truly expires.
 * Each renewal fires after timeoutSeconds (default: 1 hour).
 * 24 renewals = 24 hours of continuous re-prompting before giving up.
 */
const MAX_APPROVAL_RENEWALS = 24;

const HECTOR_CHAT_ID_DEFAULT = "7729308746";
const PAULA_CHAT_ID_DEFAULT = "6796857351";
const SOFIA_CHAT_ID = "8947131346";
const PR_MERGE_CONFIG_PATH = resolve(process.cwd(), "data", "pr-merge-config.json");
const USER_SCOPES_PATH = resolve(process.cwd(), "data", "telegram-user-scopes.json");
const MERGE_QUEUE_PATH = resolve(process.cwd(), "data", "merge-queue.json");

// ---------------------------------------------------------------------------
// Agent Merge — durable approval queue
//
// When a PR is approved for "🤖 Agent Merge", we record the approval here
// (persisted to data/merge-queue.json). The approval persists across rebases
// because it is tied to the PR, not the commit SHA — Hector approves intent,
// not bytes. The merge-agent later reads this ledger and merges each PR via
// the execute_approved_merge tool, which re-validates CI/conflicts/state.
// ---------------------------------------------------------------------------

function loadMergeQueue() {
  try {
    if (existsSync(MERGE_QUEUE_PATH)) {
      const data = JSON.parse(readFileSync(MERGE_QUEUE_PATH, "utf-8"));
      if (!data.queue) data.queue = [];
      return data;
    }
  } catch { /* fall through */ }
  return { version: 1, queue: [] };
}

function saveMergeQueue(data) {
  try {
    const dir = dirname(MERGE_QUEUE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(MERGE_QUEUE_PATH, JSON.stringify(data, null, 2) + "\n");
    return true;
  } catch (err) {
    return false;
  }
}

function addToMergeQueue(entry) {
  const data = loadMergeQueue();
  // Dedupe by repo+pr_number — last approval wins
  data.queue = data.queue.filter(
    (e) => !(e.repo === entry.repo && e.pr_number === entry.pr_number)
  );
  data.queue.push({
    repo: entry.repo,
    pr_number: entry.pr_number,
    description: entry.description || "",
    approved_by: entry.approved_by || "",
    approved_by_chat_id: entry.approved_by_chat_id || "",
    approved_at: entry.approved_at || new Date().toISOString(),
    sha_at_approval: entry.sha_at_approval || "",
    status: "approved",
    attempts: 0,
  });
  saveMergeQueue(data);
}

function removeFromMergeQueue(repo, prNumber) {
  const data = loadMergeQueue();
  const before = data.queue.length;
  data.queue = data.queue.filter(
    (e) => !(e.repo === repo && e.pr_number === prNumber)
  );
  if (data.queue.length !== before) saveMergeQueue(data);
}

function findInMergeQueue(repo, prNumber) {
  const data = loadMergeQueue();
  return data.queue.find(
    (e) => e.repo === repo && e.pr_number === prNumber
  ) || null;
}

async function postPrApprovalComment(repo, prNumber, approverLabel, ghToken) {
  const body =
    `✅ **Approved by ${approverLabel} for agent merge** at ${new Date().toISOString()}\n\n` +
    `_The Rocha merge-agent will rebase this PR onto the latest main, wait for CI, ` +
    `and merge when green. This approval persists across rebases._`;
  try {
    const res = await ghRestMerge(
      `/repos/${repo}/issues/${prNumber}/comments`,
      ghToken,
      { method: "POST", body: JSON.stringify({ body }) }
    );
    return res.ok;
  } catch {
    return false;
  }
}

function loadUserScopes() {
  try {
    if (existsSync(USER_SCOPES_PATH)) {
      return JSON.parse(readFileSync(USER_SCOPES_PATH, "utf-8"));
    }
  } catch { /* fall back to empty */ }
  return { version: 1, users: {} };
}

function getUserScope(userId) {
  const config = loadUserScopes();
  return config.users?.[String(userId)] || null;
}

function loadMergeConfig() {
  try {
    if (existsSync(PR_MERGE_CONFIG_PATH)) {
      return JSON.parse(readFileSync(PR_MERGE_CONFIG_PATH, "utf-8"));
    }
  } catch { /* fall back to defaults */ }
  return {
    version: 1,
    defaults: {
      require_approval: true,
      approver_chat_id: HECTOR_CHAT_ID_DEFAULT,
      timeout_seconds: 3600,
      merge_method: "squash",
      delete_branch: true,
    },
    rules: [],
  };
}

function checkApprovalRequired(config, repo, author) {
  const rules = config.rules || [];
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const { match } = rule;
    if (!match) continue;
    let ruleMatches = true;
    if (match.repo_pattern && !new RegExp(match.repo_pattern).test(repo)) ruleMatches = false;
    if (match.author && match.author !== author) ruleMatches = false;
    if (ruleMatches) return rule.require_approval !== false;
  }
  // No rule matched — use default
  return config.defaults?.require_approval !== false;
}

function resolveApproverChatId(config, explicitApproverChatId, repo) {
  const explicit = explicitApproverChatId ? String(explicitApproverChatId).trim() : "";
  if (explicit) return explicit;

  // Check rules for repo-specific approver_chat_id (first matching rule wins)
  if (repo) {
    const rules = config.rules || [];
    for (const rule of rules) {
      if (rule.enabled === false) continue;
      const { match } = rule;
      if (!match) continue;
      if (match.repo_pattern && !new RegExp(match.repo_pattern).test(repo)) continue;
      if (rule.approver_chat_id) return String(rule.approver_chat_id);
    }
  }

  if (activeChatId && isUserAllowed(activeChatId)) {
    return String(activeChatId);
  }

  return String(config.defaults?.approver_chat_id || HECTOR_CHAT_ID_DEFAULT);
}

function describeApprover(chatId) {
  const normalized = String(chatId || "");
  if (normalized === HECTOR_CHAT_ID_DEFAULT) return "Hector";
  if (normalized === PAULA_CHAT_ID_DEFAULT) return "Paula";
  if (normalized === SOFIA_CHAT_ID) return "Sofia";
  return `chat ${normalized}`;
}

function generateRequestId() {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  ).slice(0, 16);
}

/**
 * Schedule an auto-renewal timer for a pending approval request.
 *
 * When the timer fires and the request is still pending:
 *   1. Checks whether the underlying PR(s) are still open via GitHub API.
 *   2. If all PRs are closed/merged → silently removes the request (no spam).
 *   3. If at least one PR is still open AND renewalCount < MAX_APPROVAL_RENEWALS →
 *      deletes the old entry, sends a fresh Telegram message with new buttons,
 *      stores the new entry, and schedules another renewal.
 *   4. After MAX_APPROVAL_RENEWALS (24 h) → truly expires without re-sending.
 *
 * This means Hector always has a recent, tappable approval button available,
 * even if he was busy for several hours.
 */
function cancelApprovalRenewal(requestId) {
  const timerId = renewalTimers.get(requestId);
  if (timerId) {
    clearTimeout(timerId);
    renewalTimers.delete(requestId);
  }
}

// Find and clean up a pendingApproval entry by PR number + repo (for stateless mpr: path)
function cleanupApprovalByPr(prNumber, repo) {
  for (const [reqId, entry] of pendingApprovals.entries()) {
    if (entry.prNumber === prNumber && entry.repo === repo) {
      cancelApprovalRenewal(reqId);
      pendingApprovals.delete(reqId);
      return;
    }
  }
}

function scheduleApprovalRenewal(requestId, timeoutSeconds) {
  // Clear any existing timer for this requestId before scheduling a new one
  cancelApprovalRenewal(requestId);
  const timer = setTimeout(async () => {
    renewalTimers.delete(requestId);
    const pending = pendingApprovals.get(requestId);
    if (!pending) return; // Already handled (approved / denied) — nothing to do

    const renewal = (pending.renewalCount || 0) + 1;

    // Hard cap: truly expire after MAX_APPROVAL_RENEWALS renewals
    if (renewal > MAX_APPROVAL_RENEWALS) {
      pendingApprovals.delete(requestId);
      return;
    }

    try {
      const ghToken = getGhToken();
      const renewLabel = `🔁 Auto-renewal #${renewal}/${MAX_APPROVAL_RENEWALS} — expires in 1 h`;

      if (pending.mode === "direct_merge") {
        // Check if the PR is still open
        const info = await ghRestMerge(`/repos/${pending.repo}/pulls/${pending.prNumber}`, ghToken);
        if (!info.ok || info.data?.state !== "open") {
          // PR is already merged or closed — clean up silently
          pendingApprovals.delete(requestId);
          return;
        }

        // PR still open — issue a fresh approval request
        const newId = generateRequestId();
        const approverLabel = describeApprover(pending.approverChatId);
        const prUrl = `https://github.com/${pending.repo}/pull/${pending.prNumber}`;
        const descPart = pending.description ? `\n\n📝 <i>${pending.description}</i>` : "";

        const msgText =
          `🔀 <b>PR Merge Request</b> (auto-renewed)\n\n` +
          `<b>Repo:</b> <code>${pending.repo}</code>\n` +
          `<b>PR:</b> <a href="${prUrl}">#${pending.prNumber}</a>${descPart}\n\n` +
          `<b>Approver:</b> ${approverLabel}\n` +
          `<i>${renewLabel}</i>\n\n` +
          `Approve this merge?`;

        const shortRepo = pending.repo.replace("htekdev/", "");
        const keyboard = {
          inline_keyboard: [[
            { text: "✅ Merge Now",   callback_data: `mpr:a:${pending.prNumber}:${shortRepo}` },
            { text: "🤖 Agent Merge", callback_data: `mpr:ag:${pending.prNumber}:${shortRepo}` },
            { text: "❌ Deny",        callback_data: `mpr:d:${pending.prNumber}:${shortRepo}` },
          ]],
        };

        pendingApprovals.delete(requestId);
        pendingApprovals.set(newId, {
          ...pending,
          msgText,
          renewalCount: renewal,
          createdAt: Date.now(),
          expiresAt: Date.now() + (timeoutSeconds * 1000),
        });

        await telegramApi("sendMessage", {
          chat_id: pending.approverChatId,
          text: msgText,
          parse_mode: "HTML",
          reply_markup: keyboard,
        }).catch(() => {});

        scheduleApprovalRenewal(newId, timeoutSeconds);

      } else if (pending.mode === "agent_merge_batch") {
        // Check which batch PRs are still open
        const stillOpen = [];
        for (const pr of (pending.batch || [])) {
          try {
            const info = await ghRestMerge(`/repos/${pr.repo}/pulls/${pr.pr_number}`, ghToken);
            if (info.ok && info.data?.state === "open") stillOpen.push(pr);
          } catch { /* skip, treat as closed */ }
        }

        if (stillOpen.length === 0) {
          // All PRs merged/closed — no renewal needed
          pendingApprovals.delete(requestId);
          return;
        }

        const newId = generateRequestId();
        const approverLabel = describeApprover(pending.approverChatId);
        const listLines = stillOpen.map(
          (p) => `• <a href="${p.url}">${p.repo}#${p.pr_number}</a> — <i>${p.title}</i>`
        ).join("\n");

        const msgText =
          `🤖 <b>Agent Merge Request</b> (auto-renewed)\n\n` +
          `<b>Approver:</b> ${approverLabel}\n` +
          `<b>PRs in queue (${stillOpen.length}):</b>\n${listLines}\n\n` +
          `<i>${renewLabel}</i>\n\n` +
          `Approve all for the merge-agent? The agent will rebase, wait for CI (10 min each), ` +
          `and merge sequentially. Approval persists across rebases.`;

        const keyboard = {
          inline_keyboard: [[
            { text: `✅ Approve all (${stillOpen.length})`, callback_data: `merge:agent:${newId}` },
            { text: "❌ Cancel", callback_data: `merge:deny:${newId}` },
          ]],
        };

        pendingApprovals.delete(requestId);
        pendingApprovals.set(newId, {
          ...pending,
          batch: stillOpen,
          msgText,
          renewalCount: renewal,
          createdAt: Date.now(),
          expiresAt: Date.now() + (timeoutSeconds * 1000),
        });

        await telegramApi("sendMessage", {
          chat_id: pending.approverChatId,
          text: msgText,
          parse_mode: "HTML",
          reply_markup: keyboard,
          disable_web_page_preview: true,
        }).catch(() => {});

        scheduleApprovalRenewal(newId, timeoutSeconds);
      }
    } catch {
      // On any unexpected error, clean up silently rather than leaving stale state
      pendingApprovals.delete(requestId);
    }
  }, timeoutSeconds * 1000);
  if (typeof timer.unref === "function") timer.unref();
  renewalTimers.set(requestId, timer);
}

function getGhToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    if (existsSync(ENV_FILE)) {
      const content = readFileSync(ENV_FILE, "utf-8");
      for (const line of content.split("\n")) {
        const t = line.trim();
        for (const key of ["GITHUB_TOKEN", "GH_TOKEN"]) {
          if (t.startsWith(`${key}=`)) {
            let v = t.slice(key.length + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
            if (v) return v;
          }
        }
      }
    }
  } catch { /* ignore */ }
  // Fall back to gh CLI auth token
  try {
    const token = execSync("gh auth token", { encoding: "utf-8", timeout: 5000 }).trim();
    if (token) return token;
  } catch { /* gh CLI not available or not authenticated */ }
  return "";
}

async function ghRestMerge(path, ghToken, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `token ${ghToken}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "copilot-pr-approval/1.0",
      "Content-Type": "application/json",
    },
    ...options,
  });
  // Handle empty responses (e.g., 204 No Content from branch delete)
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Check CI / deployment status for a PR's head commit.
 * Inspects both GitHub Check Runs (Actions, Vercel-as-check) and legacy
 * commit Statuses (Vercel deployments often appear here as state=error).
 *
 * Returns:
 *   { ok: true, summary }                 — no failures detected
 *   { ok: false, error, failures }         — at least one failed/errored check
 */
async function checkPrCiStatus(repo, sha, ghToken) {
  const FAIL_CONCLUSIONS = new Set([
    "failure", "cancelled", "timed_out", "action_required", "startup_failure",
  ]);
  const FAIL_STATES = new Set(["failure", "error"]);

  const failures = [];
  let totalChecks = 0;
  let pendingChecks = 0;

  // 1) Check Runs (modern GitHub Checks API — Actions, Vercel, most integrations)
  try {
    const cr = await ghRestMerge(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`, ghToken);
    if (cr.ok && Array.isArray(cr.data?.check_runs)) {
      for (const run of cr.data.check_runs) {
        totalChecks++;
        if (run.status !== "completed") {
          pendingChecks++;
          continue;
        }
        if (FAIL_CONCLUSIONS.has(run.conclusion)) {
          failures.push({
            type: "check_run",
            name: run.name,
            conclusion: run.conclusion,
            url: run.html_url || run.details_url,
          });
        }
      }
    }
  } catch (err) {
    return { ok: false, error: `Failed to fetch check runs: ${err.message}`, failures: [] };
  }

  // 2) Combined commit Status (legacy API — Vercel deployments often post here)
  try {
    const st = await ghRestMerge(`/repos/${repo}/commits/${sha}/status`, ghToken);
    if (st.ok && Array.isArray(st.data?.statuses)) {
      for (const status of st.data.statuses) {
        totalChecks++;
        if (status.state === "pending") {
          pendingChecks++;
          continue;
        }
        if (FAIL_STATES.has(status.state)) {
          failures.push({
            type: "status",
            name: status.context,
            state: status.state,
            description: status.description,
            url: status.target_url,
          });
        }
      }
    }
  } catch (err) {
    return { ok: false, error: `Failed to fetch commit statuses: ${err.message}`, failures: [] };
  }

  if (failures.length > 0) {
    const lines = failures.map((f) => {
      const result = f.conclusion || f.state;
      const desc = f.description ? ` — ${f.description}` : "";
      return `  • ${f.name}: ${result}${desc}`;
    });
    return {
      ok: false,
      error:
        `CI/deployment checks failed for commit ${sha.slice(0, 7)} ` +
        `(${failures.length} failing of ${totalChecks} total):\n${lines.join("\n")}`,
      failures,
      total: totalChecks,
      pending: pendingChecks,
    };
  }

  return {
    ok: true,
    summary: `${totalChecks} checks (${pendingChecks} pending, ${totalChecks - pendingChecks} passing)`,
    total: totalChecks,
    pending: pendingChecks,
  };
}

async function executePrMerge(repo, prNumber, mergeMethod, doDeleteBranch, ghToken) {
  // Fetch PR details
  const prInfo = await ghRestMerge(`/repos/${repo}/pulls/${prNumber}`, ghToken);
  if (!prInfo.ok) {
    return {
      status: "failed",
      error: `Could not fetch PR #${prNumber} from ${repo}: ${prInfo.data?.message}`,
    };
  }
  const pr = prInfo.data;
  if (pr.state !== "open") {
    return { status: "failed", error: `PR #${prNumber} is not open (state: ${pr.state})` };
  }
  const headBranch = pr.head?.ref ?? "";

  // Execute merge
  const mergeRes = await ghRestMerge(
    `/repos/${repo}/pulls/${prNumber}/merge`,
    ghToken,
    { method: "PUT", body: JSON.stringify({ merge_method: mergeMethod }) }
  );
  if (!mergeRes.ok) {
    let hint = "";
    if (mergeRes.status === 405) hint = "Branch protection requires another reviewer.";
    else if (mergeRes.status === 409) hint = "Merge conflicts — resolve first.";
    else if (mergeRes.status === 422) hint = mergeRes.data?.message || "Check branch protection rules.";
    return {
      status: "failed",
      error: mergeRes.data?.message || "Merge failed",
      http_status: mergeRes.status,
      hint,
    };
  }

  // Delete branch if requested
  let branchDeleted = false;
  if (doDeleteBranch && headBranch) {
    const delRes = await ghRestMerge(
      `/repos/${repo}/git/refs/heads/${headBranch}`,
      ghToken,
      { method: "DELETE" }
    );
    branchDeleted = delRes.status === 204;
  }

  return {
    status: "merged",
    repo,
    pr_number: prNumber,
    pr_title: pr.title ?? `PR #${prNumber}`,
    merge_method: mergeMethod,
    merge_commit_sha: mergeRes.data?.sha ?? "",
    branch_deleted: branchDeleted,
    head_branch: headBranch,
  };
}

/**
 * Called by the polling loop when Telegram sends a callback_query.
 * Routes approval/denial decisions back to waiting merge_pr tool calls.
 */
async function handleApprovalCallback(callbackQuery) {
  const data = callbackQuery.data || "";
  const messageId = callbackQuery.message?.message_id;
  const chatId = String(callbackQuery.message?.chat?.id || callbackQuery.from?.id || "");
  const fromId = String(callbackQuery.from?.id || "");

  // Handle merge approval callbacks in two formats:
  //   merge:{approve|deny}:{requestId}           — normal tool path (Promise in pendingApprovals)
  //   mpr:{a|d}:{pr_number}:{short_repo}         — direct path (no pending Promise; bridge dispatches to session)
  const matchNormal = data.match(/^merge:(approve|deny|agent):(.{8,16})$/);
  const matchDirect = data.match(/^mpr:(a|ag|d):(\d+):(.+)$/);

  if (!matchNormal && !matchDirect) {
    // Not our callback — answer silently so Telegram stops showing spinner
    try {
      await telegramApi("answerCallbackQuery", { callback_query_id: callbackQuery.id });
    } catch { /* ignore */ }
    return;
  }

  // ── Direct path: mpr format (no pending Promise needed) ──────────────────
  if (matchDirect) {
    const [, act, prNumStr, shortRepo] = matchDirect;
    const fullRepo = shortRepo.includes("/") ? shortRepo : `htekdev/${shortRepo}`;
    const prNum = parseInt(prNumStr, 10);
    const emoji = act === "a" ? "✅" : act === "ag" ? "🤖" : "❌";
    const label = act === "a" ? "Approved" : act === "ag" ? "Agent Merge Queued" : "Denied";

    try {
      await telegramApi("editMessageReplyMarkup", {
        chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] },
      });
    } catch {}

    // Cancel any pending renewal timer for this PR
    cleanupApprovalByPr(prNum, fullRepo);

    await telegramApi("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text: `${emoji} ${label}!`,
    }).catch(() => {});

    if (act === "a") {
      // Execute the merge directly via GitHub API
      try {
        const ghToken = getGhToken();
        if (!ghToken) {
          await telegramApi("sendMessage", {
            chat_id: chatId,
            text: `⚠️ Cannot merge ${fullRepo}#${prNum} — no GitHub token available.`,
            parse_mode: "HTML",
          });
          return;
        }

        const config = loadMergeConfig();
        const mergeMethod = config.defaults?.merge_method || "squash";
        const doDeleteBranch = config.defaults?.delete_branch !== false;

        const result = await executePrMerge(fullRepo, prNum, mergeMethod, doDeleteBranch, ghToken);

        if (result.status === "merged") {
          const branchNote = result.branch_deleted ? "\n🗑️ Branch deleted" : "";
          await telegramApi("sendMessage", {
            chat_id: chatId,
            text:
              `✅ <b>Merged!</b> ${fullRepo}#${prNum} (${mergeMethod})\n` +
              `<i>${result.pr_title || ""}</i>${branchNote}`,
            parse_mode: "HTML",
          });
          // Notify the session so the agent can handle post-merge tasks
          if (_sessionRef) {
            queueOrSend(_sessionRef, {
              prompt: `[PR Merged]: ${fullRepo}#${prNum} "${result.pr_title || ""}" was merged (${mergeMethod}) after Hector's approval. Branch ${result.head_branch || ""} ${result.branch_deleted ? "was deleted" : "still exists"}. Handle any post-merge tasks: trigger article-promoter if blog article, update issues, notify relevant agents, etc.`,
              mode: "immediate",
            }, chatId);
          }
        } else {
          await telegramApi("sendMessage", {
            chat_id: chatId,
            text: `⚠️ Merge failed for ${fullRepo}#${prNum}: ${result.error || "Unknown error"}${result.hint ? "\n💡 " + result.hint : ""}`,
            parse_mode: "HTML",
          });
        }
      } catch (mergeErr) {
        // Ensure Hector always gets feedback even if something crashes
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: `⚠️ Error during merge of ${fullRepo}#${prNum}: ${mergeErr.message || "Unknown error"}`,
          parse_mode: "HTML",
        }).catch(() => {});
      }
    } else if (act === "ag") {
      // Agent Merge path (stateless) — record durable approval + dispatch merge-agent
      try {
        const ghToken = getGhToken();
        const approverName = callbackQuery.from?.first_name || "Hector";
        const approvalEntry = {
          repo: fullRepo,
          pr_number: prNum,
          description: "",
          approved_by: approverName,
          approved_by_chat_id: fromId,
          approved_at: new Date().toISOString(),
          sha_at_approval: "",
        };
        addToMergeQueue(approvalEntry);

        if (ghToken) {
          await postPrApprovalComment(fullRepo, prNum, approverName, ghToken);
        }

        await telegramApi("sendMessage", {
          chat_id: chatId,
          text:
            `🤖 <b>Queued for Agent Merge:</b> ${fullRepo}#${prNum}\n\n` +
            `Approval recorded in <code>data/merge-queue.json</code>. ` +
            `Merge-agent will rebase, wait for CI, and merge when green.`,
          parse_mode: "HTML",
        }).catch(() => {});

        // Dispatch merge-agent via session prompt
        if (_sessionRef) {
          const prsJson = JSON.stringify([{ repo: fullRepo, pr_number: prNum, description: "" }]);
          queueOrSend(_sessionRef, {
            prompt: `[Agent Merge Approved]: ${approverName} approved agent-merge for ${fullRepo}#${prNum}. Approval recorded in data/merge-queue.json. Dispatch merge-agent now:\n\nPRs: ${prsJson}`,
            mode: "immediate",
          }, chatId);
        }
      } catch (agErr) {
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: `⚠️ Error queuing agent merge for ${fullRepo}#${prNum}: ${agErr.message || "Unknown error"}`,
          parse_mode: "HTML",
        }).catch(() => {});
      }
    } else if (act === "d") {
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: `❌ PR merge denied — ${fullRepo}#${prNum} not merged.`,
        parse_mode: "HTML",
      }).catch(() => {});
    }
    return;
  }

  const [, action, requestId] = matchNormal;
  const config = loadMergeConfig();
  const pending = pendingApprovals.get(requestId);
  const approverChatId = String(pending?.approverChatId || config.defaults?.approver_chat_id || HECTOR_CHAT_ID_DEFAULT);

  // Also re-derive the approver from config rules for the repo.
  // Ensures repo-specific approvers (e.g. Sofia for taller-mecanico) can always act
  // even if pending.approverChatId was stored without full repo context or the calling
  // agent didn't pass an explicit approver_chat_id.
  const configApproverChatId = pending?.repo
    ? resolveApproverChatId(config, null, pending.repo)
    : approverChatId;

  // Security: the intended approver OR the config-designated approver can act
  if (fromId !== approverChatId && fromId !== configApproverChatId) {
    try {
      await telegramApi("answerCallbackQuery", {
        callback_query_id: callbackQuery.id,
        text: "❌ Not authorized.",
      });
    } catch { /* ignore */ }
    return;
  }

  if (!pending) {
    try {
      await telegramApi("answerCallbackQuery", {
        callback_query_id: callbackQuery.id,
        text: "⚠️ Already handled or expired.",
      });
    } catch { /* ignore */ }
    return;
  }

  // Remove from map immediately to prevent double-processing
  pendingApprovals.delete(requestId);
  cancelApprovalRenewal(requestId);

  const emoji = action === "approve" ? "✅" : action === "agent" ? "🤖" : "❌";
  const approverName = callbackQuery.from?.first_name || describeApprover(approverChatId);
  const decisionText =
    action === "approve" ? `Approved by ${approverName}` :
    action === "agent"   ? `Queued for Agent Merge by ${approverName}` :
                           `Denied by ${approverName}`;

  // Edit the original message: remove buttons and append decision
  try {
    await telegramApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: (pending.msgText || "PR merge request") + `\n\n${emoji} <b>${decisionText}</b>`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    });
  } catch { /* non-critical — button removal is best-effort */ }

  // Answer the callback so Telegram clears the spinner
  try {
    await telegramApi("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text: `${emoji} ${decisionText}!`,
    });
  } catch { /* ignore */ }

  if (pending.mode === "direct_merge") {
    if (action === "agent") {
      // ── Agent Merge path ──────────────────────────────────────────────
      // Record durable approval, post PR comment, dispatch merge-agent.
      const ghToken = getGhToken();
      const approvalEntry = {
        repo: pending.repo,
        pr_number: pending.prNumber,
        description: pending.description || "",
        approved_by: approverName,
        approved_by_chat_id: String(fromId || approverChatId),
        approved_at: new Date().toISOString(),
        sha_at_approval: pending.headSha || "",
      };
      addToMergeQueue(approvalEntry);

      if (ghToken) {
        await postPrApprovalComment(
          pending.repo,
          pending.prNumber,
          approverName,
          ghToken
        );
      }

      await telegramApi("sendMessage", {
        chat_id: chatId,
        text:
          `🤖 <b>Queued for Agent Merge:</b> ${pending.repo}#${pending.prNumber}\n` +
          `<i>${pending.prTitle || pending.description || ""}</i>\n\n` +
          `Approval recorded in <code>data/merge-queue.json</code>. ` +
          `Merge-agent will rebase, wait for CI, and merge when green.`,
        parse_mode: "HTML",
      }).catch(() => {});

      // Dispatch merge-agent via session prompt (will use task tool)
      if (_sessionRef) {
        const prsJson = JSON.stringify([{
          repo: pending.repo,
          pr_number: pending.prNumber,
          description: pending.description || "",
        }]);
        queueOrSend(_sessionRef, {
          prompt:
            `[Agent Merge Dispatch] ${approverName} approved ${pending.repo}#${pending.prNumber} ` +
            `for agent-merge via Telegram. Dispatch the merge-agent (use the task tool with ` +
            `agent_type="merge-agent", model="claude-sonnet-4.5") with this prompt:\n\n` +
            `"Process the agent-merge queue. approver_chat_id: ${chatId}. PRs: ${prsJson}. ` +
            `For each PR: rebase onto main, wait for CI (10min timeout), call execute_approved_merge. ` +
            `Send a start notification, then only escalation/failure messages, then a final summary."\n\n` +
            `Do not merge anything yourself — only dispatch the merge-agent.`,
          mode: "immediate",
        }, chatId);
      }
      return;
    }

    if (action === "approve") {
      try {
        const ghToken = getGhToken();
        if (!ghToken) {
          await telegramApi("sendMessage", {
            chat_id: chatId,
            text: `⚠️ Cannot merge ${pending.repo}#${pending.prNumber} — no GitHub token available.`,
            parse_mode: "HTML",
          });
          return;
        }

        const result = await executePrMerge(
          pending.repo,
          pending.prNumber,
          pending.mergeMethod,
          pending.deleteBranch,
          ghToken
        );

        if (result.status === "merged") {
          const branchNote = result.branch_deleted ? "\n🗑️ Branch deleted" : "";
          await telegramApi("sendMessage", {
            chat_id: chatId,
            text:
              `✅ <b>Merged!</b> ${pending.repo}#${pending.prNumber} (${pending.mergeMethod})\n` +
              `<i>${result.pr_title || ""}</i>${branchNote}`,
            parse_mode: "HTML",
          });
          if (_sessionRef) {
            queueOrSend(_sessionRef, {
              prompt: `[PR Merged]: ${pending.repo}#${pending.prNumber} "${result.pr_title || ""}" was merged (${pending.mergeMethod}) after ${approverName}'s approval. Branch ${result.head_branch || ""} ${result.branch_deleted ? "was deleted" : "still exists"}. Handle any post-merge tasks: trigger article-promoter if blog article, update issues, notify relevant agents, etc.`,
              mode: "immediate",
            }, chatId);
          }
        } else {
          await telegramApi("sendMessage", {
            chat_id: chatId,
            text: `⚠️ Merge failed for ${pending.repo}#${pending.prNumber}: ${result.error || "Unknown error"}${result.hint ? "\n💡 " + result.hint : ""}`,
            parse_mode: "HTML",
          });
        }
      } catch (mergeErr) {
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: `⚠️ Error during merge of ${pending.repo}#${pending.prNumber}: ${mergeErr.message || "Unknown error"}`,
          parse_mode: "HTML",
        }).catch(() => {});
      }
    } else {
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: `❌ PR merge denied — ${pending.repo}#${pending.prNumber} not merged.`,
        parse_mode: "HTML",
      }).catch(() => {});
    }
    return;
  }

  // ── Agent Merge batch path (from agent_merge tool) ───────────────────────
  if (pending.mode === "agent_merge_batch") {
    if (action === "agent" || action === "approve") {
      const ghToken = getGhToken();
      const batch = pending.batch || [];
      const queuedList = [];

      for (const pr of batch) {
        addToMergeQueue({
          repo: pr.repo,
          pr_number: pr.pr_number,
          description: pr.description || "",
          approved_by: approverName,
          approved_by_chat_id: String(fromId || approverChatId),
          approved_at: new Date().toISOString(),
          sha_at_approval: pr.head_sha || "",
        });
        if (ghToken) {
          await postPrApprovalComment(pr.repo, pr.pr_number, approverName, ghToken);
        }
        queuedList.push(`${pr.repo}#${pr.pr_number}`);
      }

      await telegramApi("sendMessage", {
        chat_id: chatId,
        text:
          `🤖 <b>Agent-merge queue armed</b> — ${batch.length} PR(s) approved\n` +
          queuedList.map((p) => `• <code>${p}</code>`).join("\n") +
          `\n\nMerge-agent dispatching now. Reports on start, escalations, and final summary only.`,
        parse_mode: "HTML",
      }).catch(() => {});

      if (_sessionRef) {
        const prsJson = JSON.stringify(batch.map((p) => ({
          repo: p.repo, pr_number: p.pr_number, description: p.description || "",
        })));
        queueOrSend(_sessionRef, {
          prompt:
            `[Agent Merge Dispatch] ${approverName} approved a batch of ${batch.length} PR(s) for agent-merge. ` +
            `Dispatch the merge-agent (use task tool with agent_type="merge-agent", model="claude-sonnet-4.5") with this prompt:\n\n` +
            `"Process the agent-merge queue. approver_chat_id: ${chatId}. PRs (sequential): ${prsJson}. ` +
            `For each: rebase onto main, wait for CI (10min timeout), call execute_approved_merge. ` +
            `Send one start message, only escalation/failure messages mid-run, and one final summary."\n\n` +
            `Do not merge anything yourself — only dispatch the merge-agent.`,
          mode: "immediate",
        }, chatId);
      }
    } else {
      // deny / cancel
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: `❌ Agent-merge cancelled — no PRs queued.`,
        parse_mode: "HTML",
      }).catch(() => {});
    }
    return;
  }

  // Unblock the waiting merge_pr tool call
  pending.resolve(action === "approve" ? "approved" : "denied");
}

// ---------------------------------------------------------------------------
// Telegram API helpers
// ---------------------------------------------------------------------------
// Support custom Telegram Bot API server (local server supports up to 2GB file downloads)
let TELEGRAM_API_SERVER = process.env.TELEGRAM_API_SERVER || "";
if (!TELEGRAM_API_SERVER) {
  try {
    const envContent = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf-8") : "";
    for (const line of envContent.split("\n")) {
      const t = line.trim();
      if (t.startsWith("TELEGRAM_API_SERVER=")) {
        let v = t.slice("TELEGRAM_API_SERVER=".length).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        TELEGRAM_API_SERVER = v;
      }
    }
  } catch { /* ignore */ }
}
const API_BASE_HOST = TELEGRAM_API_SERVER || `https://api.telegram.org`;
const API_BASE = `${API_BASE_HOST}/bot${TELEGRAM_TOKEN}`;
const FILE_BASE = `${API_BASE_HOST}/file/bot${TELEGRAM_TOKEN}`;

// Telegram Bot API getFile limit: 20MB for cloud API, ~2GB for local Bot API server
const TELEGRAM_GETFILE_LIMIT = TELEGRAM_API_SERVER ? 2000 * 1024 * 1024 : 20 * 1024 * 1024;

async function telegramApi(method, body = {}) {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram API error: ${data.description}`);
  return data.result;
}

const TELEGRAM_MAX_LENGTH = 4096;

async function sendTelegramMessage(chatId, text) {
  if (!text || text.trim().length === 0) return;
  // Detect if the text already contains HTML tags
  const isAlreadyHtml = /<(?:b|i|u|s|a|code|pre|em|strong)\b[^>]*>/i.test(text);
  const chunks = [];
  for (let i = 0; i < text.length; i += TELEGRAM_MAX_LENGTH) {
    chunks.push(text.slice(i, i + TELEGRAM_MAX_LENGTH));
  }
  for (const chunk of chunks) {
    try {
      if (isAlreadyHtml) {
        // Already HTML — send directly (just sanitize unsupported tags)
        const sanitized = sanitizeTelegramHtml(chunk);
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: sanitized,
          parse_mode: "HTML",
        });
      } else {
        // Convert markdown-ish text to Telegram HTML
        const html = telegramTextToHtml(chunk);
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: html,
          parse_mode: "HTML",
        });
      }
    } catch {
      // Fall back to plain text (strip all tags)
      const plain = chunk.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      await telegramApi("sendMessage", { chat_id: chatId, text: plain });
    }
    if (chunks.length > 1) await sleep(150);
  }
}

// Sanitize HTML for Telegram — only allows supported tags
function sanitizeTelegramHtml(html) {
  // Telegram supports: b, strong, i, em, u, ins, s, strike, del, a, code, pre
  // Remove unsupported tags but keep their content
  return html
    .replace(/<\/?(?!b|strong|i|em|u|ins|s|strike|del|a|code|pre|\/)[a-z][^>]*>/gi, "")
    .replace(/&amp;amp;/g, "&amp;"); // fix double-encoded ampersands
}

// Convert markdown-ish text to Telegram HTML
function telegramTextToHtml(text) {
  return text
    // Escape HTML entities first
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Bold **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/__(.+?)__/g, "<b>$1</b>")
    // Italic *text* or _text_
    .replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<i>$1</i>")
    .replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<i>$1</i>")
    // Code `text`
    .replace(/`([^`]+?)`/g, "<code>$1</code>")
    // Links [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

async function sendTypingAction(chatId) {
  try {
    await telegramApi("sendChatAction", { chat_id: chatId, action: "typing" });
  } catch {
    /* best-effort */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Gemini video analysis (same direct-call pattern as Whisper for voice notes)
// ---------------------------------------------------------------------------
const GEMINI_BASE = "https://generativelanguage.googleapis.com";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_MIME = {
  mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
  webm: "video/webm", mkv: "video/x-matroska",
};

function getGeminiApiKey() {
  const vidpipeCfg = join(
    process.env.APPDATA || process.env.HOME, "vidpipe", "config.json"
  );
  if (existsSync(vidpipeCfg)) {
    try {
      const cfg = JSON.parse(readFileSync(vidpipeCfg, "utf-8"));
      if (cfg.credentials?.geminiApiKey) return cfg.credentials.geminiApiKey;
    } catch { /* fall through */ }
  }
  const envPath = join(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf-8").match(/^\s*GEMINI_API_KEY\s*=\s*(.+)/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return process.env.GEMINI_API_KEY || null;
}

async function analyzeVideoWithGemini(videoPath, videoBuffer, ext) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error("No Gemini API key configured");

  const mime = GEMINI_MIME[ext] || "video/mp4";
  // Gemini Files API supports up to 2GB uploads
  if (videoBuffer.length > 2000 * 1024 * 1024) {
    throw new Error(`Video too large (${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB). Gemini max is 2GB.`);
  }

  // 1. Upload to Gemini Files API using resumable upload protocol
  const initRes = await fetch(`${GEMINI_BASE}/upload/v1beta/files?key=${apiKey}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(videoBuffer.length),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { displayName: basename(videoPath) } }),
  });
  if (!initRes.ok) throw new Error(`Upload init failed: ${await initRes.text()}`);
  const uploadUrl = initRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Upload init succeeded but no upload URL returned");

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(videoBuffer.length),
      "Content-Type": mime,
    },
    body: videoBuffer,
  });
  if (!uploadRes.ok) throw new Error(`Upload failed: ${await uploadRes.text()}`);
  const uploaded = await uploadRes.json();
  const fileName = uploaded?.file?.name;
  if (!fileName) throw new Error("Upload succeeded but no file reference returned");

  // 2. Poll until file is ACTIVE
  const deadline = Date.now() + 120_000;
  let file;
  while (Date.now() < deadline) {
    const pollRes = await fetch(`${GEMINI_BASE}/v1beta/${fileName}?key=${apiKey}`);
    if (!pollRes.ok) throw new Error(`Status check failed: ${await pollRes.text()}`);
    file = await pollRes.json();
    if (file.state === "ACTIVE") break;
    if (file.state === "FAILED") throw new Error("Gemini failed to process the video");
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (file?.state !== "ACTIVE") throw new Error("Timed out waiting for Gemini video processing (120s)");

  // 3. Generate content
  const genRes = await fetch(
    `${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { fileData: { mimeType: mime, fileUri: file.uri } },
            { text: "Describe this video concisely. What does it show? Who/what is in it? What are the key topics, actions, or takeaways? Keep it under 300 words." },
          ],
        }],
      }),
    }
  );
  if (!genRes.ok) throw new Error(`Gemini analysis failed: ${await genRes.text()}`);
  const data = await genRes.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "(no analysis returned)";
}

// ---------------------------------------------------------------------------
// Long-polling loop
//
// IMPORTANT: this extension is loaded into EVERY agent session simultaneously
// (one process per joinSession). Telegram only permits ONE getUpdates consumer
// per bot token — competing consumers get 409 Conflict. Without coordination
// you get a thundering herd of "Waiting for previous polling instance to
// release..." retries that never converges (especially after extensions_reload
// when N processes restart at once).
//
// We use a file-based PID lock (data/.telegram-bridge.lock) so exactly ONE
// process in this repo holds the long-poll connection at a time. The rest
// run in standby mode — their tools still work (merge_pr, agent_merge, etc.)
// and they still receive session.on(...) events, they just don't getUpdates.
// Standby instances periodically check the lock; if the holder dies or stops
// heartbeating, the next standby takes over.
// ---------------------------------------------------------------------------
let running = false;
let pollOffset = 0;
let activeChatId = null;
let pollController = null;
let typingInterval = null;

// ── Poll-lock coordination ─────────────────────────────────────────────────
const POLL_LOCK_PATH = resolve(process.cwd(), "data", ".telegram-bridge.lock");
const LOCK_STALE_MS = 45_000;        // lock heartbeat older than this is stale
const LOCK_HEARTBEAT_MS = 15_000;    // owner refreshes lock this often
const STANDBY_CHECK_MS = 30_000;     // standbys probe for stale lock this often
const MAX_CONSECUTIVE_CONFLICTS = 8; // give up the lock after this many 409s

let isPollOwner = false;
let heartbeatTimer = null;
let shutdownRegistered = false;

function _readLock() {
  try {
    if (!existsSync(POLL_LOCK_PATH)) return null;
    const raw = readFileSync(POLL_LOCK_PATH, "utf-8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function _writeLock(data) {
  try {
    const dir = dirname(POLL_LOCK_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(POLL_LOCK_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

function _processAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function _isLockStale(lock) {
  if (!lock || typeof lock !== "object") return true;
  if (lock.pid === process.pid) return false;
  if (!_processAlive(lock.pid)) return true;
  const hb = Number(lock.heartbeat) || 0;
  return (Date.now() - hb) > LOCK_STALE_MS;
}

function tryAcquirePollLock() {
  const existing = _readLock();
  if (existing && existing.pid === process.pid) {
    // Refresh our existing lock
    return _writeLock({
      pid: process.pid,
      hostname: hostname(),
      startedAt: existing.startedAt || Date.now(),
      heartbeat: Date.now(),
    });
  }
  if (!_isLockStale(existing)) return false;
  return _writeLock({
    pid: process.pid,
    hostname: hostname(),
    startedAt: Date.now(),
    heartbeat: Date.now(),
  });
}

function refreshPollLock() {
  const cur = _readLock();
  if (!cur || cur.pid !== process.pid) {
    // Lost the lock (another process took over). Give up ownership cleanly.
    return false;
  }
  return _writeLock({ ...cur, heartbeat: Date.now() });
}

function releasePollLock() {
  try {
    const cur = _readLock();
    if (cur && cur.pid === process.pid) {
      unlinkSync(POLL_LOCK_PATH);
    }
  } catch { /* ignore */ }
  isPollOwner = false;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (pollController) {
    try { pollController.abort(); } catch { /* ignore */ }
    pollController = null;
  }
}

function registerShutdownHandlers() {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  const onExit = () => {
    running = false;
    try { releasePollLock(); } catch { /* ignore */ }
  };
  process.once("SIGTERM", () => { onExit(); process.exit(0); });
  process.once("SIGINT", () => { onExit(); process.exit(0); });
  process.once("SIGHUP", () => { onExit(); process.exit(0); });
  process.on("beforeExit", onExit);
  process.on("exit", onExit);
}

// ---------------------------------------------------------------------------
// Session-aware local message queue
// Holds messages locally when the agent is busy and flushes one-at-a-time
// on tool.execution_complete — prevents inconsistent runtime queue behavior.
// ---------------------------------------------------------------------------
let agentBusy = false;
const localQueue = []; // Array of { options, chatId } objects
let _sessionRef = null; // Set after joinSession()
let _deadSessionCount = 0; // Track consecutive dead-session failures
const MAX_DEAD_SESSION_BEFORE_EXIT = 3; // Self-terminate after this many

function queueOrSend(session, options, chatId) {
  // Always send immediately — queue disabled per Hector (2026-05-20)
  //
  // Resilient against:
  //  - `session` or `session.send` missing/null (e.g., extension loaded in a
  //    state where the SDK session never finished joining, or a stale closure
  //    capture during PID-lock standby handoffs).
  //  - Synchronous TypeErrors that bypass `.catch()` if `send` is not a fn.
  // Falls back to module-level `_sessionRef` and finally notifies the chat
  // so a voice/photo/text never silently dies with no transcript delivered.
  const trySend = (s) => {
    if (!s || typeof s.send !== "function") return null;
    try {
      const p = s.send(options);
      if (p && typeof p.catch === "function") {
        p.catch((err) => {
          try {
            (s.log || console.error)(
              `Failed to send prompt: ${err?.message || err}`,
              { level: "warning" }
            );
          } catch { /* ignore */ }
        });
      }
      return p;
    } catch (err) {
      try {
        (s.log || console.error)(
          `session.send threw synchronously: ${err?.message || err}`,
          { level: "warning" }
        );
      } catch { /* ignore */ }
      return null;
    }
  };

  if (trySend(session) !== null) { _deadSessionCount = 0; return; }
  if (trySend(_sessionRef) !== null) { _deadSessionCount = 0; return; }

  // No working session. Log and (if we have a chatId) tell the user instead
  // of swallowing the message.
  _deadSessionCount++;
  const logger = session?.log || _sessionRef?.log || console.error;
  try {
    logger(
      `queueOrSend: no session with .send() available — message not forwarded to agent. ` +
      `Dead session count: ${_deadSessionCount}/${MAX_DEAD_SESSION_BEFORE_EXIT}. ` +
      `prompt preview: ${(options?.prompt || "").slice(0, 120)}`,
      { level: "error" }
    );
  } catch { /* ignore */ }
  if (chatId) {
    sendTelegramMessage(
      chatId,
      "⚠️ Bridge couldn't forward that to the agent (no active session). " +
      "Please try again in a moment."
    ).catch(() => { /* ignore */ });
  }

  // Self-terminate if session is persistently dead — release poll lock so a
  // healthy process can take over. This prevents zombie bridge processes from
  // holding the lock indefinitely with a dead session (root cause of Jun 23
  // "no active session" outage where 12 zombie processes accumulated).
  if (_deadSessionCount >= MAX_DEAD_SESSION_BEFORE_EXIT) {
    try {
      logger(
        `queueOrSend: session dead ${_deadSessionCount} consecutive times — ` +
        `self-terminating to release poll lock. A healthy bridge will take over.`,
        { level: "error" }
      );
    } catch { /* ignore */ }
    // Release the lock file before exiting
    try {
      const lockPath = resolve(process.cwd(), "data", ".telegram-bridge.lock");
      if (existsSync(lockPath)) {
        const lock = JSON.parse(readFileSync(lockPath, "utf-8"));
        if (lock && lock.pid === process.pid) {
          unlinkSync(lockPath);
        }
      }
    } catch { /* ignore */ }
    // Give Telegram message time to send, then exit
    setTimeout(() => process.exit(1), 2000);
  }
}

// flushOne() — DISABLED per Hector (2026-05-20) — queue system removed
// function flushOne() { ... }

async function skipOldUpdates() {
  try {
    const result = await telegramApi("getUpdates", {
      offset: -1,
      limit: 1,
      timeout: 0,
    });
    if (result.length > 0) {
      pollOffset = result[0].update_id + 1;
    }
  } catch {
    /* start from 0 */
  }
}

function startTypingIndicator(chatId) {
  stopTypingIndicator();
  sendTypingAction(chatId);
  typingInterval = setInterval(() => sendTypingAction(chatId), 4000);
}

function stopTypingIndicator() {
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
}

async function pollLoop(session) {
  running = true;
  registerShutdownHandlers();

  // Outer loop: acquire poll lock, run inner poll, release on conflict storm,
  // then standby and try again. Only one process in the repo polls at a time.
  while (running) {
    // ── Standby: wait until we own the lock ───────────────────────────────
    if (!tryAcquirePollLock()) {
      // Someone else is the active poller. Stay silent (don't spam logs) and
      // re-check periodically. Tools and session.on(...) hooks still work
      // because they don't depend on getUpdates.
      await sleep(STANDBY_CHECK_MS);
      continue;
    }

    isPollOwner = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (!refreshPollLock()) {
        // We lost ownership (another process reclaimed). Abort poll.
        isPollOwner = false;
        if (pollController) {
          try { pollController.abort(); } catch { /* ignore */ }
        }
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }, LOCK_HEARTBEAT_MS);
    if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();

    // Give any prior owner a beat to release its long-poll connection.
    await sleep(2000);
    await skipOldUpdates();

    try {
      const me = await telegramApi("getMe");
      await session.log(
        `Telegram bot connected: @${me.username} (${me.first_name}) [pid ${process.pid} owns poll lock]`
      );
    } catch (err) {
      await session.log(`Could not verify bot identity: ${err.message}`, {
        level: "warning",
      });
    }

    await session.log("Telegram long polling started — waiting for messages");

    let consecutiveConflicts = 0;
    let lostLock = false;

    // ── Inner loop: actively poll Telegram ────────────────────────────────
    while (running && isPollOwner) {
      try {
        pollController = new AbortController();

        const res = await fetch(`${API_BASE}/getUpdates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offset: pollOffset,
            timeout: 10,
            allowed_updates: ["message", "callback_query"],
          }),
          signal: pollController.signal,
        });

        const data = await res.json();

        if (!data.ok) {
          const isConflict = data.description?.includes("Conflict");
          if (isConflict) {
            consecutiveConflicts += 1;
            if (consecutiveConflicts >= MAX_CONSECUTIVE_CONFLICTS) {
              // Lock storm: another process is somehow holding the long-poll
              // even though we own the file lock. Release and let the rightful
              // owner take over via the standby path.
              await session.log(
                `Telegram 409 Conflict persisted ${consecutiveConflicts} times — ` +
                `releasing poll lock and entering standby. Another instance will resume polling.`,
                { level: "warning" }
              );
              lostLock = true;
              break;
            }
            await sleep(3000);
            continue;
          }
          consecutiveConflicts = 0;
          await session.log(
            `Telegram API error: ${data.description}`,
            { level: "warning" }
          );
          await sleep(5000);
          continue;
        }
        consecutiveConflicts = 0;

      for (const update of data.result) {
        pollOffset = update.update_id + 1;

        // Handle inline keyboard callbacks (PR merge approval decisions)
        if (update.callback_query) {
          await handleApprovalCallback(update.callback_query);
          continue;
        }

        if (!update.message) continue;

        const msg = update.message;
        const chatId = String(msg.chat.id);
        const userId = msg.from?.id;
        const from =
          msg.from?.first_name || msg.from?.username || "Unknown";

        // Security: check if the sender is in the allowed users set
        if (!isUserAllowed(userId)) {
          await sendTelegramMessage(
            chatId,
            "Unauthorized. This bot is restricted to authorized family members."
          );
          continue;
        }

        activeChatId = chatId;

        // Debug: log message keys to understand what Telegram sends
        const msgKeys = Object.keys(msg).filter(k => !["message_id", "from", "chat", "date"].includes(k));
        if (msgKeys.length > 0 && !msg.text) {
          await session.log(`[Telegram] ${from} sent: ${msgKeys.join(", ")}`);
        }

        // Handle bot commands
        if (msg.text === "/start") {
          await sendTelegramMessage(
            chatId,
            `Connected! Your chat ID is: ${chatId}\n\n` +
              `Send any message and it will be forwarded to your GitHub Copilot CLI session.\n\n` +
              `Commands:\n/status — check bridge status\n/help — show this message`
          );
          continue;
        }

        if (msg.text === "/status") {
          await sendTelegramMessage(
            chatId,
            `Bridge Status\n` +
              `• Polling: ${running ? "active" : "stopped"}\n` +
              `• Chat ID: ${chatId}\n` +
              `• Offset: ${pollOffset}`
          );
          continue;
        }

        if (msg.text === "/help") {
          await sendTelegramMessage(
            chatId,
            `Telegram <-> Copilot CLI Bridge\n\n` +
              `Send any text message and it will be forwarded to your active Copilot CLI session as a user prompt.\n\n` +
              `The assistant's response will be sent back here automatically.\n\n` +
              `Commands:\n/start — welcome message & chat ID\n/status — bridge status\n/help — this message`
          );
          continue;
        }

        // Forward text messages to the session
        if (msg.text) {
          const preview =
            msg.text.length > 80
              ? msg.text.slice(0, 80) + "..."
              : msg.text;
          await session.log(`[Telegram] ${from}: ${preview}`);

          startTypingIndicator(chatId);

          // Session-aware queue: hold locally when busy, send when idle
          queueOrSend(session, {
            prompt: `[Telegram from ${from} (user ${userId})]: ${msg.text}`,
            mode: "immediate",
          }, chatId);
          continue;
        }

        // Non-text messages — notify user
        if (msg.photo || msg.document || msg.video || msg.voice || msg.sticker) {
          // Handle photos — download and forward as vision input
          if (msg.photo) {
            const caption = msg.caption || "What do you see in this image?";
            const preview =
              caption.length > 80 ? caption.slice(0, 80) + "..." : caption;
            await session.log(`[Telegram] ${from}: ${preview}`);

            startTypingIndicator(chatId);

            setTimeout(async () => {
              try {
                // Get the largest photo (last in array)
                const photo = msg.photo[msg.photo.length - 1];
                const fileInfo = await telegramApi("getFile", {
                  file_id: photo.file_id,
                });
                const fileUrl = `${FILE_BASE}/${fileInfo.file_path}`;

                // Download the image
                const imgRes = await fetch(fileUrl);
                const imgBuffer = await imgRes.arrayBuffer();
                const imgNodeBuffer = Buffer.from(imgBuffer);
                const base64Data = imgNodeBuffer.toString("base64");

                // Determine mime type from file path
                const ext = fileInfo.file_path.split(".").pop().toLowerCase();
                const mimeMap = {
                  jpg: "image/jpeg",
                  jpeg: "image/jpeg",
                  png: "image/png",
                  gif: "image/gif",
                  webp: "image/webp",
                  bmp: "image/bmp",
                };
                const mimeType = mimeMap[ext] || "image/jpeg";

                // Persist image locally so sub-agents can access via view tool
                const imgDir = resolve(process.cwd(), "data", "telegram-images");
                mkdirSync(imgDir, { recursive: true });
                const timestamp = Date.now();
                const imgFilename = `${timestamp}-${photo.file_id}.${ext || "jpg"}`;
                const imgLocalPath = join(imgDir, imgFilename);
                writeFileSync(imgLocalPath, imgNodeBuffer);
                const imgAbsPath = resolve(imgLocalPath);

                queueOrSend(session, {
                  prompt: `[Telegram from ${from} (user ${userId})]: ${caption}\n[Image saved to: ${imgAbsPath}]`,
                  mode: "immediate",
                  attachments: [
                    {
                      type: "blob",
                      data: base64Data,
                      mimeType,
                      displayName: fileInfo.file_path.split("/").pop(),
                    },
                  ],
                }, chatId);
              } catch (err) {
                session.log(
                  `Failed to process image: ${err.message}`,
                  { level: "warning" }
                );
                await sendTelegramMessage(
                  chatId,
                  "Failed to process that image. Try again or send as text."
                );
              }
            }, 0);
            continue;
          }

          // Handle voice notes — transcribe with Whisper and forward as text
          if (msg.voice || msg.audio) {
            const voiceObj = msg.voice || msg.audio;
            await session.log(`[Telegram] ${from}: voice note (${voiceObj.duration}s)`);

            startTypingIndicator(chatId);

            setTimeout(async () => {
              try {
                // Get OpenAI key from vidpipe config
                const vidpipeConfig = join(
                  process.env.APPDATA || process.env.HOME,
                  "vidpipe",
                  "config.json"
                );
                let openaiKey = process.env.OPENAI_API_KEY || "";
                if (!openaiKey && existsSync(vidpipeConfig)) {
                  const vc = JSON.parse(readFileSync(vidpipeConfig, "utf-8"));
                  openaiKey = vc.credentials?.openaiApiKey || "";
                }
                if (!openaiKey) {
                  await sendTelegramMessage(chatId, "No OpenAI API key found for transcription.");
                  return;
                }

                // Download voice file
                const fileInfo = await telegramApi("getFile", { file_id: voiceObj.file_id });
                const fileUrl = `${FILE_BASE}/${fileInfo.file_path}`;
                const audioRes = await fetch(fileUrl);
                const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

                // Send to Whisper API
                const boundary = "----WhisperBoundary" + Date.now();
                const ext = (fileInfo.file_path || "voice.ogg").split(".").pop();
                const filename = `voice.${ext}`;
                const mimeMap = { ogg: "audio/ogg", oga: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" };
                const mime = mimeMap[ext] || "audio/ogg";

                const parts = [
                  `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
                  audioBuffer,
                  `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}--\r\n`,
                ];
                const bodyBuffer = Buffer.concat([
                  Buffer.from(parts[0]),
                  parts[1],
                  Buffer.from(parts[2]),
                ]);

                const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${openaiKey}`,
                    "Content-Type": `multipart/form-data; boundary=${boundary}`,
                  },
                  body: bodyBuffer,
                });

                if (!whisperRes.ok) {
                  const errText = await whisperRes.text();
                  throw new Error(`Whisper API ${whisperRes.status}: ${errText}`);
                }

                const result = await whisperRes.json();
                const transcript = result.text || "(empty transcription)";

                await session.log(`Transcribed: ${transcript.slice(0, 100)}...`);

                // Echo the transcript back to the user so they always see it,
                // even if forwarding to the agent fails downstream.
                try {
                  await sendTelegramMessage(
                    chatId,
                    `🎙️ Transcribed: ${transcript.slice(0, 3500)}`
                  );
                } catch { /* non-fatal */ }

                queueOrSend(session, {
                  prompt: `[Telegram from ${from} (user ${userId})]: ${transcript}`,
                  mode: "immediate",
                }, chatId);
              } catch (err) {
                session.log(`Failed to transcribe voice: ${err.message}`, { level: "warning" });
                await sendTelegramMessage(chatId, `Failed to transcribe voice note: ${err.message.slice(0, 100)}`);
              }
            }, 0);
            continue;
          }

          // Handle video messages — download, analyze with Gemini, forward summary as context
          if (msg.video || msg.video_note || msg.document?.mime_type?.startsWith("video/")) {
            const videoObj = msg.video || msg.video_note || msg.document;
            const caption = msg.caption || "";
            const fileSize = videoObj.file_size || 0;
            const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
            await session.log(`🎬 [Telegram] ${from}: video received (${fileSizeMB}MB), checking size...`);

            startTypingIndicator(chatId);

            // Check if the file exceeds the Telegram Bot API getFile limit (20MB for cloud API)
            if (fileSize > TELEGRAM_GETFILE_LIMIT) {
              const limitMB = (TELEGRAM_GETFILE_LIMIT / (1024 * 1024)).toFixed(0);

              // Try MTProto download via GramJS (no file size limit)
              const _dlFn = await getDownloadLargeFile();
              if (_dlFn && TELEGRAM_API_ID && TELEGRAM_API_HASH) {
                await session.log(`🎬 Video ${fileSizeMB}MB exceeds Bot API limit — using MTProto (GramJS)...`);
                await sendTelegramMessage(chatId, `📹 Got your video (${fileSizeMB}MB) — downloading via MTProto... ⏳`);

                setTimeout(async () => {
                  try {
                    const dataDir = resolve(process.cwd(), "data");
                    const ext = (videoObj.file_name || videoObj.mime_type || "mp4").split(/[./]/).pop() || "mp4";
                    const videoFile = resolve(dataDir, `telegram-video-${Date.now()}.${ext}`);

                    await _dlFn({
                      fileId: videoObj.file_id,
                      fileSize,
                      outputPath: videoFile,
                      botToken: TELEGRAM_TOKEN,
                      apiId: TELEGRAM_API_ID,
                      apiHash: TELEGRAM_API_HASH,
                      logger: (msg) => session.log(`🎬 ${msg}`),
                    });

                    await session.log(`🎬 Saved to ${videoFile} (${fileSizeMB}MB)`);

                    // Analyze with Gemini (Gemini supports up to 2GB via Files API)
                    const { readFileSync: readFS } = await import("node:fs");
                    const videoBuffer = readFS(videoFile);
                    let summary = "(video analysis unavailable)";
                    try {
                      summary = await analyzeVideoWithGemini(videoFile, videoBuffer, ext);
                      await session.log(`🎬 Gemini summary: ${summary.slice(0, 120)}...`);
                    } catch (gemErr) {
                      await session.log(`🎬 Gemini analysis failed: ${gemErr.message}`, { level: "warning" });
                    }

                    await sendTelegramMessage(chatId, `✅ Video downloaded and analyzed! Processing your request...`);

                    const captionPart = caption ? ` Caption: "${caption}".` : "";
                    queueOrSend(session, {
                      prompt: `[Telegram from ${from} (user ${userId})]: Sent a video.${captionPart} [Video summary: ${summary}] The video file is at ${videoFile}.`,
                      mode: "immediate",
                    }, chatId);
                  } catch (err) {
                    await session.log(`🎬 MTProto download error: ${err.message}`, { level: "warning" });
                    await sendTelegramMessage(chatId,
                      `❌ MTProto download failed: ${err.message.slice(0, 150)}\n\n` +
                      `**Workaround:** Save the video locally and share the file path:\n` +
                      `\`C:\\Users\\floreshector\\Videos\\my-video.mp4\``
                    );
                    const captionPart = caption ? ` Caption: "${caption}".` : "";
                    queueOrSend(session, {
                      prompt: `[Telegram from ${from} (user ${userId})]: Sent a video (${fileSizeMB}MB) but MTProto download failed: ${err.message}.${captionPart} The user has been asked to share the file path instead.`,
                      mode: "immediate",
                    }, chatId);
                  }
                }, 0);
                continue;
              }

              // No MTProto available — fall back to asking for file path
              await session.log(`🎬 Video too large (${fileSizeMB}MB > ${limitMB}MB) and MTProto not configured`, { level: "warning" });

              await sendTelegramMessage(chatId,
                `📹 Got your video (${fileSizeMB}MB) but Telegram's Bot API has a ${limitMB}MB download limit.\n\n` +
                (_dlFn
                  ? `**To enable large file downloads**, add to your .env:\n\`TELEGRAM_API_ID=your_id\`\n\`TELEGRAM_API_HASH=your_hash\`\n(Get them free at https://my.telegram.org/apps)\n\n`
                  : "") +
                `**Workaround:** Save the video to your computer and share the file path:\n` +
                `\`C:\\Users\\floreshector\\Videos\\my-video.mp4\`\n\n` +
                `I'll pick it up from there and handle the rest! 🎬`
              );

              // Still forward the caption/intent to the session so the agent knows what the user wants
              const captionPart = caption ? ` Caption: "${caption}".` : "";
              queueOrSend(session, {
                prompt: `[Telegram from ${from} (user ${userId})]: Sent a video (${fileSizeMB}MB) but it exceeds the Telegram Bot API ${limitMB}MB download limit.${captionPart} The user has been asked to share the file path instead. Wait for them to provide a local file path.`,
                mode: "immediate",
              }, chatId);
              continue;
            }

            setTimeout(async () => {
              try {
                const fileInfo = await telegramApi("getFile", { file_id: videoObj.file_id });
                const fileUrl = `${FILE_BASE}/${fileInfo.file_path}`;
                await session.log(`🎬 Downloading: ${fileInfo.file_path}`);
                const videoRes = await fetch(fileUrl);
                if (!videoRes.ok) throw new Error(`Download failed: HTTP ${videoRes.status}`);
                const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

                // Save video file (kept for downstream agents to use)
                const dataDir = resolve(process.cwd(), "data");
                const ext = (fileInfo.file_path || "video.mp4").split(".").pop();
                const videoFile = resolve(dataDir, `telegram-video-${Date.now()}.${ext}`);
                writeFileSync(videoFile, videoBuffer);
                await session.log(`🎬 Saved to ${videoFile} (${(videoBuffer.length / 1024).toFixed(0)} KB)`);

                // Analyze with Gemini directly (same pattern as voice→Whisper)
                let summary = "(video analysis unavailable)";
                try {
                  summary = await analyzeVideoWithGemini(videoFile, videoBuffer, ext);
                  await session.log(`🎬 Gemini summary: ${summary.slice(0, 120)}...`);
                } catch (gemErr) {
                  await session.log(`🎬 Gemini analysis failed: ${gemErr.message}`, { level: "warning" });
                }

                // Build prompt with summary as context (like voice transcriptions)
                const captionPart = caption ? ` Caption: "${caption}".` : "";
                queueOrSend(session, {
                  prompt: `[Telegram from ${from} (user ${userId})]: Sent a video.${captionPart} [Video summary: ${summary}] The video file is at ${videoFile}.`,
                  mode: "immediate",
                }, chatId);
              } catch (err) {
                await session.log(`🎬 Video error: ${err.message}`, { level: "warning" });
                // Detect the "file is too big" error from Telegram API (fallback for when file_size wasn't available)
                if (err.message.includes("file is too big") || err.message.includes("file_size")) {
                  await sendTelegramMessage(chatId,
                    `📹 This video is too large for Telegram's Bot API download limit (20MB).\n\n` +
                    `**Workaround:** Save it locally and share the file path:\n` +
                    `\`C:\\Users\\floreshector\\Videos\\my-video.mp4\`\n\n` +
                    `I'll handle it from there! 🎬`
                  );
                  const captionPart = caption ? ` Caption: "${caption}".` : "";
                  queueOrSend(session, {
                    prompt: `[Telegram from ${from} (user ${userId})]: Sent a video but it exceeds the Telegram Bot API 20MB download limit.${captionPart} The user has been asked to share the file path instead.`,
                    mode: "immediate",
                  }, chatId);
                } else {
                  await sendTelegramMessage(chatId, `❌ Failed to process video: ${err.message.slice(0, 200)}`);
                }
              }
            }, 0);
            continue;
          }

          // Handle general documents/files — save locally and forward path to agent
          if (msg.document) {
            const doc = msg.document;
            const caption = msg.caption || "";
            const origName = doc.file_name || "";
            const mimeType = doc.mime_type || "application/octet-stream";
            const fileSize = doc.file_size || 0;
            const fileSizeKB = (fileSize / 1024).toFixed(1);
            await session.log(`📎 [Telegram] ${from}: file ${origName || doc.file_id} (${mimeType}, ${fileSizeKB} KB)`);

            startTypingIndicator(chatId);

            // Check Bot API getFile size limit (20MB)
            if (fileSize > TELEGRAM_GETFILE_LIMIT) {
              const limitMB = (TELEGRAM_GETFILE_LIMIT / (1024 * 1024)).toFixed(0);
              const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);
              await sendTelegramMessage(chatId,
                `📎 Got your file (${fileSizeMB}MB) but Telegram's Bot API has a ${limitMB}MB download limit.\n\n` +
                `**Workaround:** Save the file to your computer and share the file path instead.`
              );
              const captionPart = caption ? ` Caption: "${caption}".` : "";
              queueOrSend(session, {
                prompt: `[Telegram from ${from} (user ${userId})]: Sent a file "${origName}" (${mimeType}, ${fileSizeMB}MB) but it exceeds the Telegram Bot API ${limitMB}MB download limit.${captionPart} The user has been asked to share the file path instead.`,
                mode: "immediate",
              }, chatId);
              continue;
            }

            setTimeout(async () => {
              try {
                const fileInfo = await telegramApi("getFile", { file_id: doc.file_id });
                const fileUrl = `${FILE_BASE}/${fileInfo.file_path}`;
                const fileRes = await fetch(fileUrl);
                if (!fileRes.ok) throw new Error(`Download failed: HTTP ${fileRes.status}`);
                const fileBuffer = Buffer.from(await fileRes.arrayBuffer());

                // Persist file locally so the agent can act on it
                const fileDir = resolve(process.cwd(), "data", "telegram-files");
                mkdirSync(fileDir, { recursive: true });
                const timestamp = Date.now();
                let saveName;
                if (origName) {
                  saveName = `${timestamp}-${origName}`;
                } else {
                  // Derive extension from telegram file_path or mime_type
                  const tgExt = (fileInfo.file_path || "").split(".").pop();
                  const mimeExt = mimeType.split("/").pop()?.split("+")[0] || "bin";
                  const ext = tgExt && tgExt.length <= 5 ? tgExt : mimeExt;
                  saveName = `${timestamp}-${doc.file_id}.${ext}`;
                }
                const fileLocalPath = join(fileDir, saveName);
                writeFileSync(fileLocalPath, fileBuffer);
                const fileAbsPath = resolve(fileLocalPath);
                await session.log(`📎 Saved to ${fileAbsPath} (${fileSizeKB} KB)`);

                const captionPart = caption ? ` Caption: "${caption}".` : "";
                queueOrSend(session, {
                  prompt: `[Telegram from ${from} (user ${userId})]:${captionPart}\n[File received: ${origName || doc.file_id} (${mimeType}, ${fileSize} bytes)]\n[File saved to: ${fileAbsPath}]`,
                  mode: "immediate",
                }, chatId);
              } catch (err) {
                await session.log(`📎 File error: ${err.message}`, { level: "warning" });
                await sendTelegramMessage(chatId, `❌ Failed to process file: ${err.message.slice(0, 200)}`);
              }
            }, 0);
            continue;
          }

          await sendTelegramMessage(
            chatId,
            "Only text, photo, voice, video, and file messages are supported right now."
          );
        }
      }
    } catch (err) {
      if (err.name === "AbortError") break;
      await session.log(
        `Polling error: ${err.message}`,
        { level: "warning" }
      );
      await sleep(3000);
    }
    }
    // Inner poll ended (lock lost, conflict storm, or shutdown).
    // Release our lock so a standby instance can take over, then loop back
    // to the standby state and try to re-acquire after a back-off.
    releasePollLock();
    if (!running) break;
    await sleep(5000);
  }
}

let pollStarted = false;

// ---------------------------------------------------------------------------
// Dynamic agent discovery — reads .github/agents/*.agent.md at startup.
// The main agent (AI) decides which agent to use — no heuristics.
// ---------------------------------------------------------------------------
function discoverAgents() {
  const agentsDir = resolve(process.cwd(), ".github", "agents");
  if (!existsSync(agentsDir)) return [];
  return readdirSync(agentsDir)
    .filter((f) => f.endsWith(".agent.md"))
    .map((f) => {
      try {
        const content = readFileSync(join(agentsDir, f), "utf-8");
        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!fmMatch) return null;
        const fm = fmMatch[1];
        const name = (fm.match(/^name:\s*(.+)/m) || [])[1]?.trim();
        const desc = (fm.match(/^description:\s*"?([^"]*)"?/m) || [])[1]?.trim();
        return name ? { name, description: desc || name } : null;
      } catch { return null; }
    })
    .filter(Boolean);
}

const AVAILABLE_AGENTS = discoverAgents();

// ---------------------------------------------------------------------------
// Session setup
// ---------------------------------------------------------------------------
const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      if (!TELEGRAM_TOKEN) {
        return {
          additionalContext:
            "[telegram-bridge] Telegram bridge is NOT active. " +
            "The user needs to set TELEGRAM_BOT_TOKEN in .env and reload extensions.",
        };
      }

      const userInfo = ALLOWED_USERS.size > 0
        ? ` (restricted to ${ALLOWED_USERS.size} authorized user(s))`
        : " (accepting all users)";
      return {
        additionalContext:
          `[telegram-bridge] Telegram bridge is ACTIVE${userInfo}. ` +
          `Incoming Telegram messages will appear as user prompts prefixed with the sender's user ID. ` +
          `Use the who_is_asking tool to identify family members by Telegram user ID. ` +
          `All your responses are automatically forwarded to Telegram. ` +
          `You also have a 'telegram_send_message' tool for explicit sends.`,
      };
    },

    onUserPromptSubmitted: async (input) => {
      const prompt = input.prompt || "";
      // Only apply to Telegram messages, not cron jobs (those already delegate)
      if (!prompt.startsWith("[Telegram from")) return;

      // Extract the user ID and message from the prompt
      const userMatch = prompt.match(/\[Telegram from (.+?) \(user (\d+)\)\]: (.+)/s);
      if (!userMatch) return;
      const [, senderName, senderId, userMessage] = userMatch;

      // Get current local time in Central timezone
      const now = new Date();
      const localTime = now.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      // ── Per-user agent scoping ──────────────────────────────────────────
      // If this sender has a scope restriction, ONLY dispatch to their allowed agents.
      const userScope = getUserScope(senderId);
      if (userScope && userScope.allowed_agents?.length > 0) {
        const allowedList = userScope.allowed_agents.join(", ");
        const outOfScopeReply = userScope.out_of_scope_reply ||
          `I can only help with ${userScope.scope_label || allowedList}. For other requests, please contact Hector.`;
        return {
          modifiedPrompt:
            `[Telegram from ${senderName} (user ${senderId})]: "${userMessage}"\n\n` +
            `Current time: ${localTime} (Central Time).\n` +
            `Sender identity: ${userScope.display_name || userScope.name} — ${userScope.role}.\n\n` +
            `⚠️ STRICT SCOPE RESTRICTION — THIS USER IS SCOPED ONLY TO: ${allowedList}\n` +
            `This user MUST NOT receive any information about family, finance, health, NICU, meals, calendar, or any other domain.\n` +
            `If the request is NOT about ${userScope.scope_label || allowedList}, respond immediately via telegram_send_message(chat_id: "${senderId}", message: "${outOfScopeReply}") and STOP — do NOT delegate anywhere else.\n\n` +
            `MANDATORY: You MUST delegate this to the ${allowedList} agent ONLY.\n\n` +
            `## STEP 0: STEER vs LAUNCH DECISION (check BEFORE delegating)\n` +
            `Call list_agents() first to see IDLE/RUNNING background agents.\n` +
            `Then decide:\n\n` +
            `**STEER an existing agent (write_agent) WHEN ALL of these are true:**\n` +
            `- An IDLE ${allowedList} agent exists that was working on a RELATED topic\n` +
            `- The new message is a FOLLOW-UP (correcting, clarifying, adding to, or continuing a prior discussion)\n` +
            `- The existing agent has CONTEXT that would be LOST by launching fresh\n` +
            `→ Use write_agent(agent_id, message) to inject the follow-up.\n\n` +
            `**LAUNCH a NEW agent (task tool) WHEN ANY of these are true:**\n` +
            `- The message is a NEW topic\n` +
            `- No relevant idle agent exists\n` +
            `- You're unsure → LAUNCH NEW (safer)\n\n` +
            `## STEP 1: Execute\n` +
            `- Delegate ONLY to agent_type: "${userScope.allowed_agents[0]}"\n` +
            `- The agent responds via telegram_send_message (chat_id: "${senderId}")\n` +
            `- Remind the agent: Sofia is the product owner of Taller Mecánico. She can request features, review Vercel previews, and approve PR merges. When she requests changes → create branch → implement → PR → send her the Vercel preview URL via Telegram (chat_id: ${senderId}) → request her approval via merge_pr with approver_chat_id: "${senderId}".\n\n` +
            `## STEP 2: Acknowledge & continue\n` +
            `- Do not wait for agent results. Dispatch and continue.`,
        };
      }
      // ── End scoping ──────────────────────────────────────────────────────

      // Smart dispatch — steer existing agents for follow-ups, launch fresh for new topics
      return {
        modifiedPrompt:
          `[Telegram from ${senderName} (user ${senderId})]: "${userMessage}"\n\n` +
          `Current time: ${localTime} (Central Time).\n` +
          `MANDATORY: You MUST delegate this to background agent(s). Do NOT handle this inline.\n\n` +
          `## STEP 0: STEER vs LAUNCH DECISION (check BEFORE delegating)\n` +
          `Call list_agents() first to see IDLE/RUNNING background agents.\n` +
          `Then decide for EACH distinct task in the message:\n\n` +
          `**STEER an existing agent (write_agent) WHEN ALL of these are true:**\n` +
          `- An IDLE agent exists that was working on a RELATED topic (same domain, same conversation thread)\n` +
          `- The new message is a FOLLOW-UP — correcting, clarifying, adding to, or continuing a prior discussion\n` +
          `  (e.g., "No, the Savor is the subscription card", "also add milk", "what about the other one?")\n` +
          `- The existing agent has CONTEXT that would be LOST by launching fresh (names, decisions, partial work)\n` +
          `- The task is in the SAME domain as what that agent was doing\n` +
          `→ Use write_agent(agent_id, message) to inject the follow-up. The agent wakes up with full prior context.\n\n` +
          `**LAUNCH a NEW agent (task tool) WHEN ANY of these are true:**\n` +
          `- The message is a NEW topic unrelated to any running/idle agent's context\n` +
          `- No idle agents exist, or none have relevant context\n` +
          `- High-quality results are needed with NO dependency on prior context (fresh analysis, clean slate)\n` +
          `- The message is clearly a standalone request (e.g., "what's the weather?", "add eggs to the list")\n` +
          `- You're unsure whether to steer or launch → LAUNCH NEW (safer — clean context never hurts)\n\n` +
          `## STEP 1: Analyze the message\n` +
          `- Identify how many distinct tasks/requests it contains\n` +
          `- For EACH task, apply the steer-vs-launch decision above\n\n` +
          `## STEP 2: Execute\n` +
          `- For follow-ups → write_agent to the relevant idle agent\n` +
          `- For new requests → launch via task tool (pick the best custom agent_type, or general-purpose if none fits)\n` +
          `- If MULTIPLE independent new requests, launch MULTIPLE agents in parallel\n` +
          `- Each agent responds via telegram_send_message (chat_id: "${senderId}")\n` +
          `- When writing the agent prompt, remind it to CHECK and USE available skills (.github/skills/) relevant to the task. Skills contain domain-specific procedures that improve quality and consistency.\n\n` +
          `## STEP 3: Acknowledge & continue\n` +
          `- You only send a Telegram yourself for trivial acknowledgments (e.g., "goodnight", "thanks")\n` +
          `- Continue immediately after dispatching — do not wait for results.`,
      };
    },

    onSessionEnd: async () => {
      stopTypingIndicator();
    },
  },

  tools: [
    {
      name: "telegram_send_message",
      description:
        "Send a message to a Telegram chat. If chat_id is omitted, sends to the last active chat. " +
        "Supports Markdown formatting (auto-converted to HTML) and plain text. " +
        "Messages longer than 4096 chars are automatically chunked.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message text to send. Supports **bold**, *italic*, `code`, and [links](url).",
          },
          chat_id: {
            type: "string",
            description:
              "Target Telegram chat ID. Omit to use the last active chat.",
          },
          speak: {
            type: "string",
            description:
              "Short TTS text for Tasker integration (1-2 sentences, no emojis/markdown). " +
              "When provided, 'SPEAK: [text]' is prepended to the message so it appears in notification previews. " +
              "ALWAYS use this when sending to Hector (7729308746). " +
              "Do NOT use for Paula (6796857351) — she doesn't use Tasker TTS.",
          },
        },
        required: ["message"],
      },
      handler: async (args) => {
        const targetChat = args.chat_id || activeChatId;
        if (!targetChat) {
          return {
            textResultForLlm:
              "No active Telegram chat. A user must message the bot first.",
            resultType: "failure",
          };
        }
        if (!TELEGRAM_TOKEN) {
          return {
            textResultForLlm:
              "Telegram bridge is not configured. Set TELEGRAM_BOT_TOKEN in .env.",
            resultType: "failure",
          };
        }
        try {
          // Compose final message: prepend SPEAK: line if speak parameter provided
          let finalMessage = args.message;
          if (args.speak && args.speak.trim()) {
            finalMessage = `SPEAK: ${args.speak.trim()}\n\n${args.message}`;
          }
          await sendTelegramMessage(targetChat, finalMessage);
          return `Message sent to Telegram chat ${targetChat}`;
        } catch (err) {
          return {
            textResultForLlm: `Failed to send: ${err.message}`,
            resultType: "failure",
          };
        }
      },
    },
    {
      name: "telegram_get_status",
      description:
        "Get the current Telegram bridge status including uptime, message counts, active chats, and configuration details.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        return JSON.stringify(
          {
            configured: !!TELEGRAM_TOKEN,
            polling: running,
            activeChatId: activeChatId || "none",
            allowedUsers: [...ALLOWED_USERS],
            pollOffset,
          },
          null,
          2
        );
      },
    },
    {
      name: "telegram_send_photo",
      description:
        "Send a photo to the connected Telegram chat. Photo can be a URL, local file path, or Telegram file_id. " +
        "Optionally include a caption.",
      parameters: {
        type: "object",
        properties: {
          photo: {
            type: "string",
            description:
              "Photo URL, local file path, or Telegram file_id.",
          },
          caption: {
            type: "string",
            description: "Optional caption for the photo. Supports Markdown formatting.",
          },
          chat_id: {
            type: "string",
            description:
              "Target Telegram chat ID. Omit to use the last active chat.",
          },
        },
        required: ["photo"],
      },
      handler: async (args) => {
        const targetChat = args.chat_id || activeChatId;
        if (!targetChat) {
          return {
            textResultForLlm:
              "No active Telegram chat. A user must message the bot first.",
            resultType: "failure",
          };
        }
        if (!TELEGRAM_TOKEN) {
          return {
            textResultForLlm:
              "Telegram bridge is not configured. Set TELEGRAM_BOT_TOKEN in .env.",
            resultType: "failure",
          };
        }
        try {
          const photoSource = args.photo;
          const isUrl =
            photoSource.startsWith("http://") ||
            photoSource.startsWith("https://");

          if (isUrl) {
            const body = { chat_id: targetChat, photo: photoSource };
            if (args.caption) body.caption = args.caption;
            await telegramApi("sendPhoto", body);
          } else {
            const { readFileSync } = await import("node:fs");
            const { basename } = await import("node:path");
            const fileData = readFileSync(photoSource);
            const fileName = basename(photoSource);
            const formData = new FormData();
            formData.append("chat_id", targetChat);
            formData.append(
              "photo",
              new Blob([fileData]),
              fileName
            );
            if (args.caption) formData.append("caption", args.caption);

            const res = await fetch(
              `${API_BASE}/sendPhoto`,
              { method: "POST", body: formData }
            );
            const data = await res.json();
            if (!data.ok)
              throw new Error(`Telegram API error: ${data.description}`);
          }
          return `Photo sent to Telegram chat ${targetChat}`;
        } catch (err) {
          return {
            textResultForLlm: `Failed to send photo: ${err.message}`,
            resultType: "failure",
          };
        }
      },
    },

    // ── merge_pr ─────────────────────────────────────────────────────────
    {
      name: "merge_pr",
      description:
        "Request a PR merge via Telegram inline keyboard approval. " +
        "Sends the configured approver a message with the PR link, description, and ✅ Approve / ❌ Deny buttons. " +
        "On approval, merges the PR deterministically via GitHub API. " +
        "On denial or timeout, returns the decision without merging. " +
        "Pre-flight: verifies PR is open/non-draft/no-conflicts AND that no CI checks " +
        "or deployments (GitHub Actions, Vercel, etc.) are failing on the head commit. " +
        "If any check run or commit status is in a failed/errored/cancelled state, " +
        "the merge request is BLOCKED and no approval is sent. " +
        "Approval rules are configured in data/pr-merge-config.json. " +
        "htekdev/* repos always require approval. Use this instead of any direct merge operation.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "GitHub repo in owner/repo format, e.g. 'htekdev/htek-dev-site'.",
          },
          pr_number: {
            type: "number",
            description: "The PR number to merge.",
          },
          description: {
            type: "string",
            description:
              "What this PR does and why it should be merged. " +
              "Shown to Hector in the approval message. Be concise and specific.",
          },
          merge_method: {
            type: "string",
            description: "Merge strategy: 'squash' (default), 'merge', or 'rebase'.",
          },
          delete_branch: {
            type: "boolean",
            description: "Delete the head branch after merge. Default: true.",
          },
          author: {
            type: "string",
            description: "PR author login (e.g. 'dependabot[bot]'). Avoids an extra API call for rule matching.",
          },
          approver_chat_id: {
            type: "string",
            description: "Optional Telegram chat ID to route the approval request to. Use this when the originator should approve their own PR merge.",
          },
        },
        required: ["repo", "pr_number"],
      },
      handler: async (args) => {
        const { repo, pr_number, description, merge_method, delete_branch, author: argAuthor, approver_chat_id } = args;

        if (!repo || !pr_number) {
          return JSON.stringify({ error: "Both 'repo' and 'pr_number' are required." });
        }

        const ghToken = getGhToken();
        if (!ghToken) {
          return JSON.stringify({ error: "No GitHub token found. Set GITHUB_TOKEN in .env." });
        }

        const config = loadMergeConfig();
        const mergeMethod = merge_method || config.defaults?.merge_method || "squash";
        const doDeleteBranch = delete_branch !== false && config.defaults?.delete_branch !== false;
        const timeoutSeconds = config.defaults?.timeout_seconds || 3600;
        const approverChatId = resolveApproverChatId(config, approver_chat_id, repo);
        const approverLabel = approverChatId === HECTOR_CHAT_ID_DEFAULT ? "Hector"
          : approverChatId === PAULA_CHAT_ID_DEFAULT ? "Paula"
          : approverChatId === SOFIA_CHAT_ID ? "Sofia"
          : approverChatId;

        // ── Pre-check: PR must be open, not a draft, and mergeable ──────────
        let prData;
        try {
          const prInfo = await ghRestMerge(`/repos/${repo}/pulls/${pr_number}`, ghToken);
          if (!prInfo.ok) {
            return JSON.stringify({ error: `Could not fetch PR #${pr_number} from ${repo}: ${prInfo.data?.message}` });
          }
          prData = prInfo.data;
        } catch (err) {
          return JSON.stringify({ error: `Failed to fetch PR info: ${err.message}` });
        }

        if (prData.state !== "open") {
          return JSON.stringify({ error: `PR #${pr_number} is not open (state: ${prData.state}). Cannot merge.`, repo, pr_number });
        }
        if (prData.draft) {
          return JSON.stringify({ error: `PR #${pr_number} is still a Draft. Mark it "Ready for Review" before merging.`, repo, pr_number });
        }
        if (prData.mergeable === false) {
          return JSON.stringify({ error: `PR #${pr_number} has merge conflicts. Resolve conflicts before merging.`, repo, pr_number });
        }

        // ── Pre-check: CI / deployment status must not be failing ───────────
        // Block approval if any check run or commit status is in a failed state.
        // Vercel deployments typically appear as both check_runs AND statuses.
        const headSha = prData.head?.sha;
        if (headSha) {
          const ciStatus = await checkPrCiStatus(repo, headSha, ghToken);
          if (!ciStatus.ok) {
            return JSON.stringify({
              error: ciStatus.error,
              repo,
              pr_number,
              head_sha: headSha,
              failures: ciStatus.failures,
              hint:
                "Fix the failing CI builds or deployments (or wait for them to re-run successfully) " +
                "before requesting merge approval. Approval was NOT sent to Hector.",
            });
          }
        }

        // Resolve PR author (needed for rule matching)
        let prAuthor = argAuthor || prData.user?.login || "";

        const requiresApproval = checkApprovalRequired(config, repo, prAuthor);

        // ── Auto-merge path ─────────────────────────────────────────────────
        if (!requiresApproval) {
          const result = await executePrMerge(repo, pr_number, mergeMethod, doDeleteBranch, ghToken);
          if (result.status === "merged") {
            const shortRepo = repo.replace("htekdev/", "");
            await telegramApi("sendMessage", {
              chat_id: approverChatId,
              text:
                `🤖 <b>Auto-merged</b> ${shortRepo}#${pr_number} (${mergeMethod})\n` +
                `<i>${result.pr_title || ""}</i>`,
              parse_mode: "HTML",
            }).catch(() => {});
          }
          return JSON.stringify(result);
        }

        // ── Approval-required path (non-blocking) ───────────────────────────
        // Send approval buttons and return immediately. The callback handler
        // (handleApprovalCallback) will execute the merge when Hector taps ✅.
        // This avoids blocking the tool execution (which times out in the runtime).
        const requestId = generateRequestId();
        const prUrl = `https://github.com/${repo}/pull/${pr_number}`;
        const descPart = description ? `\n\n📝 <i>${description}</i>` : "";

        const msgText =
          `🔀 <b>PR Merge Request</b>\n\n` +
          `<b>Repo:</b> <code>${repo}</code>\n` +
          `<b>PR:</b> <a href="${prUrl}">#${pr_number}</a>${descPart}\n\n` +
          `<b>Approver:</b> ${approverLabel}\n\n` +
          `Approve this merge?`;

        pendingApprovals.set(requestId, {
          mode: "direct_merge",
          approverChatId,
          repo,
          prNumber: pr_number,
          mergeMethod,
          deleteBranch: doDeleteBranch,
          msgText,
          description: description || "",
          prTitle: prData.title || "",
          headSha: headSha || "",
          renewalCount: 0,
          createdAt: Date.now(),
          expiresAt: Date.now() + (timeoutSeconds * 1000),
        });
        scheduleApprovalRenewal(requestId, timeoutSeconds);

        // ALL buttons use stateless mpr: format — survives session restarts,
        // sub-agent process termination, and extension reloads. The in-memory
        // pendingApprovals Map is kept as a secondary optimization (enables renewal
        // timers) but is NOT required for button functionality.
        const shortRepo = repo.replace("htekdev/", "");
        const keyboard = {
          inline_keyboard: [
            [
              { text: "✅ Merge Now", callback_data: `mpr:a:${pr_number}:${shortRepo}` },
              { text: "🤖 Agent Merge", callback_data: `mpr:ag:${pr_number}:${shortRepo}` },
              { text: "❌ Deny", callback_data: `mpr:d:${pr_number}:${shortRepo}` },
            ],
          ],
        };

        try {
          await telegramApi("sendMessage", {
            chat_id: approverChatId,
            text: msgText,
            parse_mode: "HTML",
            reply_markup: keyboard,
          });
        } catch (err) {
          return JSON.stringify({ error: `Failed to send approval request via Telegram: ${err.message}` });
        }

        // Return immediately — merge happens asynchronously via callback handler
        return JSON.stringify({
          status: "pending_approval",
          message: `Approval buttons sent to ${approverLabel}. PR will be merged when they tap ✅ Approve.`,
          approver_chat_id: approverChatId,
          repo,
          pr_number,
          pr_url: prUrl,
        });
      },
    },

    // ── agent_merge ──────────────────────────────────────────────────────
    // Batch agent-merge entry point. Takes a list of PRs, sends a single
    // Telegram approval with [✅ Approve all / ❌ Cancel]. On approve, records
    // each in the merge queue, posts PR comments, dispatches the merge-agent.
    {
      name: "agent_merge",
      description:
        "Queue one or more PRs for the merge-agent — async, patient, self-healing merging. " +
        "Sends Telegram approval with [✅ Approve all / ❌ Cancel]. " +
        "On approval, each PR gets a durable approval record in data/merge-queue.json " +
        "and a comment posted on the PR. The merge-agent rebases onto main, waits for CI " +
        "(10 min timeout), and merges via the deterministic execute_approved_merge tool. " +
        "Sequential processing. Use this instead of merge_pr when you have multiple PRs " +
        "or want self-healing rebase + CI-wait behavior.",
      parameters: {
        type: "object",
        properties: {
          prs: {
            type: "array",
            description: "Array of PRs to queue. Each entry: { repo, pr_number, description? }",
            items: {
              type: "object",
              properties: {
                repo: { type: "string", description: "owner/repo" },
                pr_number: { type: "number" },
                description: { type: "string" },
              },
              required: ["repo", "pr_number"],
            },
          },
          approver_chat_id: {
            type: "string",
            description: "Optional Telegram chat ID for approval routing.",
          },
        },
        required: ["prs"],
      },
      handler: async (args) => {
        const { prs, approver_chat_id } = args;
        if (!Array.isArray(prs) || prs.length === 0) {
          return JSON.stringify({ error: "'prs' must be a non-empty array." });
        }
        const ghToken = getGhToken();
        if (!ghToken) {
          return JSON.stringify({ error: "No GitHub token found. Set GITHUB_TOKEN in .env." });
        }

        const config = loadMergeConfig();
        const timeoutSeconds = config.defaults?.timeout_seconds || 3600;
        const approverChatId = resolveApproverChatId(config, approver_chat_id, prs[0].repo);
        const approverLabel = describeApprover(approverChatId);

        // Pre-flight each PR — gather metadata, fail-fast on closed/draft
        const enriched = [];
        for (const pr of prs) {
          const { repo, pr_number, description } = pr;
          if (!repo || !pr_number) {
            return JSON.stringify({ error: `Each PR entry needs 'repo' and 'pr_number'. Got: ${JSON.stringify(pr)}` });
          }
          try {
            const info = await ghRestMerge(`/repos/${repo}/pulls/${pr_number}`, ghToken);
            if (!info.ok) {
              return JSON.stringify({ error: `Could not fetch ${repo}#${pr_number}: ${info.data?.message || info.status}` });
            }
            const prData = info.data;
            if (prData.state !== "open") {
              return JSON.stringify({ error: `${repo}#${pr_number} is not open (state: ${prData.state}).` });
            }
            if (prData.draft) {
              return JSON.stringify({ error: `${repo}#${pr_number} is a draft. Mark Ready for Review first.` });
            }
            enriched.push({
              repo,
              pr_number,
              description: description || "",
              title: prData.title || "",
              head_sha: prData.head?.sha || "",
              head_branch: prData.head?.ref || "",
              base_branch: prData.base?.ref || "",
              url: prData.html_url || `https://github.com/${repo}/pull/${pr_number}`,
            });
          } catch (err) {
            return JSON.stringify({ error: `Failed to fetch ${repo}#${pr_number}: ${err.message}` });
          }
        }

        // Build approval message
        const requestId = generateRequestId();
        const listLines = enriched.map(
          (p) => `• <a href="${p.url}">${p.repo}#${p.pr_number}</a> — <i>${p.title}</i>`
        ).join("\n");

        const msgText =
          `🤖 <b>Agent Merge Request</b>\n\n` +
          `<b>Approver:</b> ${approverLabel}\n` +
          `<b>PRs in queue (${enriched.length}):</b>\n${listLines}\n\n` +
          `Approve all for the merge-agent? The agent will rebase, wait for CI (10 min each), ` +
          `and merge sequentially. Approval persists across rebases.`;

        pendingApprovals.set(requestId, {
          mode: "agent_merge_batch",
          approverChatId,
          batch: enriched,
          msgText,
          renewalCount: 0,
          createdAt: Date.now(),
          expiresAt: Date.now() + (timeoutSeconds * 1000),
        });
        scheduleApprovalRenewal(requestId, timeoutSeconds);

        const keyboard = {
          inline_keyboard: [[
            { text: `✅ Approve all (${enriched.length})`, callback_data: `merge:agent:${requestId}` },
            { text: "❌ Cancel", callback_data: `merge:deny:${requestId}` },
          ]],
        };

        try {
          await telegramApi("sendMessage", {
            chat_id: approverChatId,
            text: msgText,
            parse_mode: "HTML",
            reply_markup: keyboard,
            disable_web_page_preview: true,
          });
        } catch (err) {
          return JSON.stringify({ error: `Failed to send approval: ${err.message}` });
        }

        return JSON.stringify({
          status: "pending_approval",
          mode: "agent_merge",
          message: `Agent-merge approval sent to ${approverLabel} for ${enriched.length} PR(s).`,
          approver_chat_id: approverChatId,
          pr_count: enriched.length,
          prs: enriched.map((p) => `${p.repo}#${p.pr_number}`),
        });
      },
    },

    // ── execute_approved_merge ───────────────────────────────────────────
    // Used by merge-agent to perform the actual merge. Refuses unless an
    // approval record exists in data/merge-queue.json. Re-runs all the
    // deterministic gates (open, non-draft, no conflicts, CI green) before
    // calling executePrMerge. On success, removes the entry from the queue.
    {
      name: "execute_approved_merge",
      description:
        "Deterministically merge a PR that was previously approved for agent-merge. " +
        "REFUSES unless the PR exists in data/merge-queue.json (approval ledger). " +
        "Re-validates: PR open, not draft, no conflicts, all CI checks passing. " +
        "On success, removes the entry from the queue and deletes the head branch. " +
        "This is the ONLY merge call the merge-agent should use.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo" },
          pr_number: { type: "number" },
          merge_method: {
            type: "string",
            description: "'squash' (default), 'merge', or 'rebase'.",
          },
        },
        required: ["repo", "pr_number"],
      },
      handler: async (args) => {
        const { repo, pr_number, merge_method } = args;
        if (!repo || !pr_number) {
          return JSON.stringify({ error: "Both 'repo' and 'pr_number' are required." });
        }

        // 1) APPROVAL GATE — must be in the queue
        const approval = findInMergeQueue(repo, pr_number);
        if (!approval) {
          return JSON.stringify({
            error: "REFUSED: No approval record found for this PR in data/merge-queue.json. " +
                   "Agent-merge requires a prior approval via the agent_merge tool or 🤖 Agent Merge button.",
            repo,
            pr_number,
          });
        }

        const ghToken = getGhToken();
        if (!ghToken) {
          return JSON.stringify({ error: "No GitHub token found. Set GITHUB_TOKEN in .env." });
        }

        const config = loadMergeConfig();
        const mergeMethod = merge_method || config.defaults?.merge_method || "squash";
        const doDeleteBranch = config.defaults?.delete_branch !== false;

        // 2) PR STATE GATE — open, not draft, mergeable
        let prData;
        try {
          const info = await ghRestMerge(`/repos/${repo}/pulls/${pr_number}`, ghToken);
          if (!info.ok) {
            return JSON.stringify({ error: `Could not fetch PR: ${info.data?.message || info.status}` });
          }
          prData = info.data;
        } catch (err) {
          return JSON.stringify({ error: `Failed to fetch PR: ${err.message}` });
        }

        if (prData.state !== "open") {
          // Already merged or closed → clean up queue silently
          removeFromMergeQueue(repo, pr_number);
          return JSON.stringify({
            status: prData.merged ? "already_merged" : "closed",
            message: `${repo}#${pr_number} is ${prData.state}${prData.merged ? " (merged)" : ""}. Removed from queue.`,
            repo,
            pr_number,
          });
        }
        if (prData.draft) {
          return JSON.stringify({ error: `REFUSED: ${repo}#${pr_number} is a draft.`, repo, pr_number });
        }
        if (prData.mergeable === false) {
          return JSON.stringify({
            error: `REFUSED: ${repo}#${pr_number} has merge conflicts. Rebase before retrying.`,
            repo, pr_number, mergeable_state: prData.mergeable_state,
          });
        }

        // 3) CI GATE — re-check head SHA
        const headSha = prData.head?.sha;
        if (headSha) {
          const ciStatus = await checkPrCiStatus(repo, headSha, ghToken);
          if (!ciStatus.ok) {
            return JSON.stringify({
              error: `REFUSED: ${ciStatus.error}`,
              repo, pr_number, head_sha: headSha, failures: ciStatus.failures,
              hint: "Wait for CI to go green, then retry execute_approved_merge.",
            });
          }
        }

        // 4) EXECUTE — all gates passed
        const result = await executePrMerge(repo, pr_number, mergeMethod, doDeleteBranch, ghToken);

        if (result.status === "merged") {
          removeFromMergeQueue(repo, pr_number);
          // Notify approver
          const approverChatId = approval.approved_by_chat_id || HECTOR_CHAT_ID_DEFAULT;
          await telegramApi("sendMessage", {
            chat_id: approverChatId,
            text:
              `✅ <b>Agent-merged:</b> ${repo}#${pr_number} (${mergeMethod})\n` +
              `<i>${result.pr_title || ""}</i>` +
              (result.branch_deleted ? "\n🗑️ Branch deleted" : ""),
            parse_mode: "HTML",
          }).catch(() => {});
        }

        return JSON.stringify({
          ...result,
          approval_record: {
            approved_by: approval.approved_by,
            approved_at: approval.approved_at,
          },
        });
      },
    },

    // ── list_merge_queue ─────────────────────────────────────────────────
    {
      name: "list_merge_queue",
      description:
        "List all PRs currently in the agent-merge approval ledger (data/merge-queue.json). " +
        "Used by the merge-agent to see what's queued and by humans to inspect pending approvals.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const data = loadMergeQueue();
        return JSON.stringify({
          count: data.queue.length,
          queue: data.queue,
        }, null, 2);
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Start polling immediately on script load
// ---------------------------------------------------------------------------
_sessionRef = session; // Enable queue flush

if (TELEGRAM_TOKEN) {
  pollLoop(session).catch(async (err) => {
    await session.log(
      `Telegram polling crashed: ${err.message}`,
      { level: "error" }
    );
  });
} else {
  await session.log(
    "TELEGRAM_BOT_TOKEN not found in .env — Telegram bridge disabled",
    { level: "warning" }
  );
}

// ---------------------------------------------------------------------------
// Forward assistant responses -> Telegram
// (Suppressed during cron job execution — use telegram_send_message tool instead)
// ---------------------------------------------------------------------------
let cronJobActive = false;

session.on("user.message", (event) => {
  const prompt = event.data?.content || "";
  if (prompt.startsWith("[Scheduled Task:") || prompt.startsWith("[Scheduled Agent Task:") || prompt.startsWith("[Telegram Agent Task]")) {
    cronJobActive = true;
  } else {
    cronJobActive = false;
  }
});

session.on("assistant.message", async (event) => {
  // Auto-forwarding DISABLED per Hector's request (2026-04-12)
  // Agents use telegram_send_message directly when they need to communicate.
  // This prevents duplicate/noisy messages from every assistant response.
  return;
});

// ---------------------------------------------------------------------------
// Queue event listeners — DISABLED per Hector (2026-05-20) — queue removed
// Messages now always send immediately via queueOrSend(); no busy tracking needed.
// ---------------------------------------------------------------------------
// session.on("assistant.turn_start", () => { agentBusy = true; });
// session.on("tool.execution_complete", () => { stopTypingIndicator(); agentBusy = false; flushOne(); });

} // end BRIDGE_MODE check
