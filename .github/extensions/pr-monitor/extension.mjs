/**
 * PR Monitor Extension for {{PRODUCT}} CLI
 *
 * Simplified CI status monitoring. Agents call pr_monitor_watch with a repo and
 * PR number — then continue working. The extension polls check-run status every
 * 30 seconds. When ALL checks transition to "completed", session.send() delivers
 * the full results (check names, conclusions) back into the agent's conversation.
 *
 * No comment matching, no GraphQL, no pattern fragility.
 * Just: "did CI finish? what was the result?"
 *
 * Tools:
 *   - pr_monitor_watch  — Register a PR for CI status monitoring
 *   - pr_monitor_list   — List active watches
 *   - pr_monitor_cancel — Cancel a watch
 *
 * Zero external dependencies — node:* built-ins + @{{EMPLOYER_PARENT}}/copilot-sdk.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { joinSession } from "@{{EMPLOYER_PARENT}}/copilot-sdk/extension";

// ── Config ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const DEFAULT_TIMEOUT_MINUTES = 45;
const MAX_TIMEOUT_MINUTES = 120;
const MAX_ACTIVE_POLLS = 20;
const {{PARENT_1}}_CHAT_ID = "{{TELEGRAM_PARENT_1}}";

// ── File paths ───────────────────────────────────────────────────────────────

const WATCHES_FILE = resolve(process.cwd(), "data", "pr-monitor-watches.json");
const PENDING_FILE = resolve(process.cwd(), "data", "pr-monitor-pending.json");

// ── Env / token loading ──────────────────────────────────────────────────────

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

// ── State persistence ────────────────────────────────────────────────────────

function loadWatches() {
  try {
    if (!existsSync(WATCHES_FILE)) return new Map();
    const data = JSON.parse(readFileSync(WATCHES_FILE, "utf-8"));
    const map = new Map();
    for (const w of data.watches || []) {
      if (w.status === "active" || w.status === "queued") {
        map.set(w.id, {
          repo: w.repo,
          prNumber: w.pr_number,
          headSha: w.head_sha || null,
          timeoutMinutes: w.timeout_minutes,
          createdAt: new Date(w.created_at).getTime(),
          pollCount: w.poll_count || 0,
          lastDetail: w.last_detail || null,
          lastError: w.last_error || null,
          status: w.status || "active",
          lastCheckState: w.last_check_state || null,
          lastStateHash: w.last_state_hash || null,
        });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function saveWatches(activeMap, opts = {}) {
  let existing = [];
  try {
    if (existsSync(WATCHES_FILE)) {
      const data = JSON.parse(readFileSync(WATCHES_FILE, "utf-8"));
      existing = (data.watches || []).filter(
        (w) => w.status !== "active" && w.status !== "queued"
      );
    }
  } catch { /* start fresh */ }

  const activeEntries = [...activeMap.entries()].map(([id, w]) => ({
    id,
    repo: w.repo,
    pr_number: w.prNumber,
    head_sha: w.headSha || null,
    timeout_minutes: w.timeoutMinutes,
    created_at: new Date(w.createdAt).toISOString(),
    status: w.status || "active",
    poll_count: w.pollCount,
    last_detail: w.lastDetail || null,
    last_error: w.lastError || null,
    last_check_state: w.lastCheckState || null,
    last_state_hash: w.lastStateHash || null,
  }));

  const completed = opts.completed || [];
  const allWatches = [...activeEntries, ...completed, ...existing];

  // Trim history to last 30 completed entries
  const active = allWatches.filter((w) => w.status === "active" || w.status === "queued");
  const history = allWatches.filter((w) => w.status !== "active" && w.status !== "queued");
  const trimmedHistory = history.slice(0, 30);

  writeFileSync(
    WATCHES_FILE,
    JSON.stringify({ version: 2, watches: [...active, ...trimmedHistory] }, null, 2) + "\n",
    "utf-8"
  );
}

function completeWatch(watches, watchId, finalStatus, detail) {
  const watch = watches.get(watchId);
  if (!watch) return;
  const completedEntry = {
    id: watchId,
    repo: watch.repo,
    pr_number: watch.prNumber,
    head_sha: watch.headSha || null,
    timeout_minutes: watch.timeoutMinutes,
    created_at: new Date(watch.createdAt).toISOString(),
    status: finalStatus,
    poll_count: watch.pollCount,
    last_detail: detail || watch.lastDetail || null,
    last_error: watch.lastError || null,
    last_check_state: watch.lastCheckState || null,
    last_state_hash: watch.lastStateHash || null,
    completed_at: new Date().toISOString(),
  };
  watches.delete(watchId);
  saveWatches(watches, { completed: [completedEntry] });
}

// ── Agent forwarding instruction ─────────────────────────────────────────────

function agentForwardInstruction(repo, prNumber) {
  return (
    `\n\nACTION: If a background agent is waiting for PR #${prNumber} (${repo}) CI results, ` +
    `forward this notification to it now using write_agent(agent_id, message).`
  );
}

// ── Pending notifications ────────────────────────────────────────────────────

function loadPending() {
  try {
    if (!existsSync(PENDING_FILE)) return [];
    return JSON.parse(readFileSync(PENDING_FILE, "utf-8")).notifications || [];
  } catch {
    return [];
  }
}

function savePending(notifications) {
  writeFileSync(
    PENDING_FILE,
    JSON.stringify({ version: 1, notifications }, null, 2) + "\n",
    "utf-8"
  );
}

function appendPending(message) {
  const pending = loadPending();
  pending.push({ message, created_at: new Date().toISOString() });
  savePending(pending);
}

function clearPending() {
  savePending([]);
}

// ── Session reference ────────────────────────────────────────────────────────

/** @type {object|null} */
let sessionRef = null;

// ── Telegram fallback ────────────────────────────────────────────────────────

async function sendTelegram(message) {
  const token = getToken("TELEGRAM_BOT_TOKEN");
  if (!token) return false;
  const text = message.slice(0, 4000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: {{PARENT_1}}_CHAT_ID,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    if (res.ok) return true;
    // Retry without markdown
    const res2 = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: {{PARENT_1}}_CHAT_ID, text, disable_web_page_preview: true }),
    });
    return res2.ok;
  } catch {
    return false;
  }
}

// ── Notification delivery (3-tier: session → Telegram → pending file) ────────

async function notify(message) {
  // Tier 1: Active session
  if (sessionRef) {
    try {
      await sessionRef.send({ prompt: message, mode: "immediate" });
      return;
    } catch {
      // Fall through
    }
  }
  // Tier 2: Telegram
  if (await sendTelegram(message)) return;
  // Tier 3: Pending file
  appendPending(message);
}

// ── {{EMPLOYER_PARENT}} REST API ──────────────────────────────────────────────────────────

async function ghRest(path, token) {
  const res = await fetch(`https://api.{{EMPLOYER_PARENT}}.com${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.{{EMPLOYER_PARENT}}.v3+json",
      "User-Agent": "copilot-pr-monitor/2.0",
    },
  });
  if (!res.ok) return { ok: false, status: res.status, data: null };
  const data = await res.json().catch(() => null);
  return { ok: true, status: res.status, data };
}

async function getPrHeadSha(repo, prNumber, token) {
  const res = await ghRest(`/repos/${repo}/pulls/${prNumber}`, token);
  if (!res.ok || !res.data) return null;
  return res.data.head?.sha || null;
}

async function getCheckRuns(repo, sha, token) {
  const res = await ghRest(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`, token);
  if (!res.ok || !res.data) return null;
  return res.data.check_runs || [];
}

// ── Watch ID generation ──────────────────────────────────────────────────────

function generateWatchId(repo, prNumber) {
  const short = repo.split("/").pop();
  const rand = randomBytes(3).toString("hex");
  return `prm-${short}-${prNumber}-${rand}`;
}

// ── State hashing & diffing ──────────────────────────────────────────────────

/**
 * Compute a state snapshot: { checkName: "status:conclusion" }
 * Returns both the object and a stable hash string for comparison.
 */
function computeState(checks) {
  const state = {};
  for (const c of checks) {
    const conclusion = c.conclusion ? `:${c.conclusion}` : "";
    state[c.name] = `${c.status}${conclusion}`;
  }
  // Stable hash: sorted JSON string
  const hash = JSON.stringify(
    Object.keys(state).sort().map((k) => `${k}=${state[k]}`)
  );
  return { state, hash };
}

/**
 * Compute human-readable delta between previous and current state.
 * Returns array of change descriptions.
 */
function computeDelta(prevState, currState) {
  const changes = [];
  const allKeys = new Set([...Object.keys(prevState || {}), ...Object.keys(currState)]);

  for (const name of allKeys) {
    const prev = prevState?.[name];
    const curr = currState[name];

    if (!prev && curr) {
      // New check appeared
      changes.push({ name, from: null, to: curr, type: "new" });
    } else if (prev && !curr) {
      // Check disappeared (rare)
      changes.push({ name, from: prev, to: null, type: "removed" });
    } else if (prev !== curr) {
      // State changed
      changes.push({ name, from: prev, to: curr, type: "changed" });
    }
  }

  return changes;
}

/** Format a state value for display: "in_progress" → "🔄 running", "completed:success" → "✅ passed" */
function formatState(stateVal) {
  if (!stateVal) return "—";
  if (stateVal === "queued") return "⏳ queued";
  if (stateVal === "in_progress") return "🔄 running";
  if (stateVal === "completed:success") return "✅ passed";
  if (stateVal === "completed:failure") return "❌ failed";
  if (stateVal === "completed:cancelled") return "🚫 cancelled";
  if (stateVal === "completed:skipped") return "⏭️ skipped";
  if (stateVal === "completed:neutral") return "➖ neutral";
  if (stateVal.startsWith("completed:")) return `🏁 ${stateVal.split(":")[1]}`;
  return stateVal;
}

// ── Core polling logic ───────────────────────────────────────────────────────

async function pollWatch(watchId, watch, token, watches) {
  watch.pollCount++;

  // Resolve HEAD SHA
  const currentSha = await getPrHeadSha(watch.repo, watch.prNumber, token);

  if (!currentSha) {
    watch.lastError = "Could not resolve PR head SHA";
    watch.lastDetail = "PR not found or API error";
    return;
  }

  // If SHA changed (new push), reset tracking and notify
  if (watch.headSha && watch.headSha !== currentSha) {
    const msg = `[pr-monitor] 🔀 New push on PR #${watch.prNumber} in ${watch.repo}\n` +
      `SHA: ${watch.headSha.slice(0, 7)} → ${currentSha.slice(0, 7)}\n` +
      `Resetting CI state tracking.`;
    await notify(msg);
    watch.lastCheckState = null;
    watch.lastStateHash = null;
    watch.lastDetail = `New push (${currentSha.slice(0, 7)}), tracking reset`;
  }
  watch.headSha = currentSha;

  // Get check runs for current HEAD
  const checks = await getCheckRuns(watch.repo, currentSha, token);

  if (checks === null) {
    watch.lastError = "Check-runs API error";
    return;
  }

  if (checks.length === 0) {
    watch.lastDetail = "No check-runs found yet";
    return;
  }

  // Compute current state
  const { state: currState, hash: currHash } = computeState(checks);

  // Parse previous state from stored JSON
  let prevState = null;
  if (watch.lastCheckState) {
    try {
      prevState = typeof watch.lastCheckState === "string"
        ? JSON.parse(watch.lastCheckState)
        : watch.lastCheckState;
    } catch {
      prevState = null;
    }
  }

  const prevHash = watch.lastStateHash || null;

  // Detect state change
  if (prevHash !== null && currHash !== prevHash) {
    const delta = computeDelta(prevState, currState);

    if (delta.length > 0) {
      // Build notification
      const completed = checks.filter((c) => c.status === "completed");
      const allCompleted = completed.length === checks.length;

      let msg = `[pr-monitor] 🔔 CI state change on PR #${watch.prNumber} (${watch.repo}):\n`;
      msg += `HEAD: ${currentSha.slice(0, 7)} | ${completed.length}/${checks.length} done\n\n`;

      for (const d of delta) {
        if (d.type === "new") {
          msg += `  ${d.name}: ${formatState(d.to)} (new)\n`;
        } else if (d.type === "changed") {
          msg += `  ${d.name}: ${formatState(d.from)} → ${formatState(d.to)}\n`;
        } else if (d.type === "removed") {
          msg += `  ${d.name}: removed\n`;
        }
      }

      // If ALL completed, add summary and finish the watch
      if (allCompleted) {
        const successes = completed.filter((c) => c.conclusion === "success");
        const failures = completed.filter((c) => c.conclusion === "failure");
        const allGreen = failures.length === 0;
        const icon = allGreen ? "🎉" : "💥";

        msg += `\n${icon} **ALL ${checks.length} CHECKS COMPLETE** — `;
        msg += allGreen
          ? `all passed!`
          : `${successes.length} passed, ${failures.length} failed`;

        if (failures.length > 0) {
          msg += `\nFailed: ${failures.map((f) => f.name).join(", ")}`;
        }

        msg += agentForwardInstruction(watch.repo, watch.prNumber);
        await notify(msg);
        completeWatch(watches, watchId, allGreen ? "completed_green" : "completed_red", watch.lastDetail);
        return;
      }

      await notify(msg);
    }
  } else if (prevHash === null && checks.length > 0) {
    // First poll with checks — notify initial state (no delta, just current)
    const completed = checks.filter((c) => c.status === "completed");
    const inProgress = checks.filter((c) => c.status === "in_progress");
    const queued = checks.filter((c) => c.status === "queued");

    let msg = `[pr-monitor] 👁️ Tracking CI for PR #${watch.prNumber} (${watch.repo}):\n`;
    msg += `HEAD: ${currentSha.slice(0, 7)} | ${checks.length} check(s) detected\n\n`;

    for (const [name, val] of Object.entries(currState)) {
      msg += `  ${name}: ${formatState(val)}\n`;
    }

    // If already all completed on first poll, finish immediately
    const allCompleted = completed.length === checks.length;
    if (allCompleted) {
      const successes = completed.filter((c) => c.conclusion === "success");
      const failures = completed.filter((c) => c.conclusion === "failure");
      const allGreen = failures.length === 0;
      msg += `\n${allGreen ? "✅" : "❌"} All checks already completed.`;
      msg += agentForwardInstruction(watch.repo, watch.prNumber);
      await notify(msg);
      completeWatch(watches, watchId, allGreen ? "completed_green" : "completed_red", "All completed on first poll");
      return;
    }

    await notify(msg);
  }

  // Update stored state
  watch.lastCheckState = JSON.stringify(currState);
  watch.lastStateHash = currHash;

  // Update detail
  const completed = checks.filter((c) => c.status === "completed");
  const inProgress = checks.filter((c) => c.status === "in_progress");
  const queued = checks.filter((c) => c.status === "queued");
  watch.lastDetail = `${completed.length}/${checks.length} done, ${inProgress.length} running, ${queued.length} queued`;
}

// ── Background polling loop ──────────────────────────────────────────────────

async function pollAllWatches() {
  const watches = loadWatches();
  if (watches.size === 0) return;

  const GH_TOKEN = getToken("{{EMPLOYER_PARENT}}_TOKEN") || getToken("GH_TOKEN");
  if (!GH_TOKEN) return;

  const now = Date.now();

  // Phase 0: Expire timed-out watches
  for (const [watchId, watch] of [...watches.entries()]) {
    const elapsedMs = now - watch.createdAt;
    const timeoutMs = watch.timeoutMinutes * 60 * 1000;

    if (elapsedMs >= timeoutMs) {
      const elapsed = Math.round(elapsedMs / 60_000);
      await notify(
        `[pr-monitor] ⏰ PR #${watch.prNumber} in ${watch.repo} — timed out after ${elapsed} min.\n` +
        `Last status: ${watch.lastDetail || "unknown"}\nPolls: ${watch.pollCount}` +
        agentForwardInstruction(watch.repo, watch.prNumber)
      );
      completeWatch(watches, watchId, "timed_out");
    }
  }

  if (watches.size === 0) return;

  // Phase 1: FIFO queue (oldest first, max 20 active)
  const allEntries = [...watches.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const activeEntries = allEntries.slice(0, MAX_ACTIVE_POLLS);

  for (let i = 0; i < allEntries.length; i++) {
    allEntries[i][1].status = i < MAX_ACTIVE_POLLS ? "active" : "queued";
  }

  // Phase 2: Poll each active watch
  for (const [watchId, watch] of activeEntries) {
    if (!watches.has(watchId)) continue;
    try {
      await pollWatch(watchId, watch, GH_TOKEN, watches);
    } catch (err) {
      watch.lastError = err.message || "Unknown polling error";
    }
  }

  // Persist state
  saveWatches(watches);
}

// Start background polling
const pollTimer = setInterval(pollAllWatches, POLL_INTERVAL_MS);
if (pollTimer.unref) pollTimer.unref();

// ── Tool handlers ────────────────────────────────────────────────────────────

async function handleWatch(args) {
  const { repo, pr_number, timeout_minutes } = args;

  if (!repo || !pr_number) {
    return JSON.stringify({ error: "Both 'repo' and 'pr_number' are required." });
  }

  const timeout = Math.min(
    Math.max(Number(timeout_minutes) || DEFAULT_TIMEOUT_MINUTES, 1),
    MAX_TIMEOUT_MINUTES
  );

  const watchId = generateWatchId(repo, pr_number);
  const watches = loadWatches();

  // Check if already monitoring this PR
  for (const [existingId, w] of watches) {
    if (w.repo === repo && w.prNumber === Number(pr_number)) {
      return JSON.stringify({
        already_watching: true,
        watch_id: existingId,
        status: w.status,
        poll_count: w.pollCount,
        last_detail: w.lastDetail,
        message: `PR #${pr_number} in ${repo} is already being monitored (${existingId}). ` +
          `Current status: ${w.lastDetail || "polling"}. Continue working.`,
      });
    }
  }

  watches.set(watchId, {
    repo: String(repo),
    prNumber: Number(pr_number),
    headSha: null,
    timeoutMinutes: timeout,
    createdAt: Date.now(),
    pollCount: 0,
    lastDetail: null,
    lastError: null,
    status: "active",
    lastCheckState: null,
    lastStateHash: null,
  });

  saveWatches(watches);

  const queuePosition = watches.size;
  const isQueued = queuePosition > MAX_ACTIVE_POLLS;

  return JSON.stringify({
    watch_id: watchId,
    status: isQueued ? "queued" : "watching",
    repo,
    pr_number,
    timeout_minutes: timeout,
    message: isQueued
      ? `Queued PR #${pr_number} in ${repo} (position ${queuePosition}). Timeout: ${timeout} min.`
      : `Now monitoring CI status for PR #${pr_number} in ${repo}. ` +
        `You'll be notified when ALL check-runs complete (success or failure). ` +
        `Timeout: ${timeout} min. Continue working.`,
  });
}

async function handleList() {
  const watches = loadWatches();

  if (watches.size === 0) {
    return JSON.stringify({ watches: [], count: 0, message: "No active PR watches." });
  }

  const now = Date.now();
  const list = [...watches.entries()]
    .sort((a, b) => a[1].createdAt - b[1].createdAt)
    .map(([id, w]) => ({
      watch_id: id,
      repo: w.repo,
      pr_number: w.prNumber,
      head_sha: w.headSha ? w.headSha.slice(0, 7) : null,
      status: w.status,
      elapsed_minutes: Math.round((now - w.createdAt) / 60_000),
      timeout_minutes: w.timeoutMinutes,
      polls: w.pollCount,
      last_detail: w.lastDetail,
      last_error: w.lastError,
    }));

  return JSON.stringify({
    watches: list,
    count: list.length,
    active: list.filter((w) => w.status === "active").length,
    queued: list.filter((w) => w.status === "queued").length,
  });
}

async function handleCancel(args) {
  const { watch_id } = args;
  if (!watch_id) return JSON.stringify({ error: "'watch_id' is required." });

  const watches = loadWatches();
  if (!watches.has(watch_id)) {
    return JSON.stringify({ error: `Watch '${watch_id}' not found.`, active_ids: [...watches.keys()] });
  }

  completeWatch(watches, watch_id, "cancelled");
  return JSON.stringify({ cancelled: true, watch_id });
}

// ── Post-push hook: auto-detect PR and suggest monitoring ────────────────────

async function handlePostPush(input) {
  try {
    let result;
    try {
      result = typeof input.toolResult === "string"
        ? JSON.parse(input.toolResult)
        : input.toolResult || {};
    } catch {
      return {};
    }

    if (result.status !== "success") return {};

    const branch = result.branch;
    const repo = result.repo;
    if (!branch || !repo) return {};
    if (branch === "main" || branch === "master") return {};

    // Look up associated PR
    let prNumber = result.pr_number;
    let prTitle = "";

    if (!prNumber) {
      try {
        const ghOutput = execFileSync("gh", [
          "pr", "list", "--head", branch, "--repo", repo,
          "--json", "number,title", "--limit", "1",
        ], { encoding: "utf-8", timeout: 10_000 });
        const prs = JSON.parse(ghOutput || "[]");
        if (prs.length > 0) {
          prNumber = prs[0].number;
          prTitle = prs[0].title || "";
        }
      } catch {
        return {};
      }
    }

    if (!prNumber) return {};

    // Check if already monitored
    const watches = loadWatches();
    for (const [, watch] of watches) {
      if (watch.repo === repo && watch.prNumber === prNumber) {
        return {
          additionalContext:
            `[pr-monitor] Push to PR #${prNumber} — already being monitored. ` +
            `Status: ${watch.lastDetail || "polling"}.`,
        };
      }
    }

    const titleNote = prTitle ? ` ("${prTitle}")` : "";
    return {
      additionalContext:
        `[pr-monitor] Push detected → PR #${prNumber}${titleNote} on ${repo}.\n` +
        `This PR is NOT being monitored for CI status. Consider:\n` +
        `  pr_monitor_watch(repo="${repo}", pr_number=${prNumber})\n` +
        `to get notified when CI completes.`,
    };
  } catch {
    return {};
  }
}

// ── Extension registration ───────────────────────────────────────────────────

const session = await joinSession({
  tools: [
    {
      name: "pr_monitor_watch",
      description:
        "Monitor CI check-run status for a PR. Polls every 30s. When ALL checks complete " +
        "(success or failure), delivers the full result back to you. " +
        "No comment matching needed — just repo and PR number. " +
        "Auto-detects HEAD SHA changes (new pushes reset tracking). " +
        "Call after pushing code, then continue working.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "Full repo name in owner/repo format (e.g., '{{GITHUB_USERNAME}}/taller-mecanico').",
          },
          pr_number: {
            type: "number",
            description: "Pull request number to monitor.",
          },
          timeout_minutes: {
            type: "number",
            description: "Max minutes to wait for CI. Default: 45. Max: 120.",
          },
        },
        required: ["repo", "pr_number"],
      },
      handler: handleWatch,
    },
    {
      name: "pr_monitor_list",
      description: "List all active CI watches — repo, PR, HEAD SHA, status, elapsed time.",
      parameters: { type: "object", properties: {}, required: [] },
      handler: handleList,
    },
    {
      name: "pr_monitor_cancel",
      description: "Cancel an active CI watch by its watch_id.",
      parameters: {
        type: "object",
        properties: {
          watch_id: { type: "string", description: "The watch_id returned by pr_monitor_watch." },
        },
        required: ["watch_id"],
      },
      handler: handleCancel,
    },
  ],

  hooks: {
    onPostToolUse: async (input) => {
      if (input.toolName === "dev_push") {
        return handlePostPush(input);
      }
      return {};
    },

    onSessionStart: async () => {
      const GH_TOKEN = getToken("{{EMPLOYER_PARENT}}_TOKEN") || getToken("GH_TOKEN");
      const hasToken = Boolean(GH_TOKEN);

      // Startup: deliver pending notifications
      let pendingDelivered = 0;
      const pending = loadPending();
      if (pending.length > 0 && sessionRef) {
        for (const n of pending) {
          try {
            await sessionRef.send({
              prompt: `[pr-monitor] 📬 Queued (from ${n.created_at}):\n\n${n.message}`,
              mode: "immediate",
            });
            pendingDelivered++;
          } catch {
            break;
          }
        }
        if (pendingDelivered > 0) clearPending();
      }

      // Startup: expire stale watches
      const watches = loadWatches();
      const now = Date.now();
      let expired = 0;
      for (const [id, w] of [...watches.entries()]) {
        if (now - w.createdAt >= w.timeoutMinutes * 60_000) {
          completeWatch(watches, id, "timed_out");
          expired++;
        }
      }

      const notes = [
        pendingDelivered > 0 ? `📬 Delivered ${pendingDelivered} queued notification(s).` : "",
        expired > 0 ? `🧹 Expired ${expired} stale watch(es).` : "",
      ].filter(Boolean).join("\n");

      return {
        additionalContext:
          "[pr-monitor] Extension loaded — CI status monitoring.\n" +
          "Tools:\n" +
          "  • pr_monitor_watch(repo, pr_number) — monitor CI check-runs for a PR\n" +
          "  • pr_monitor_list — show active watches\n" +
          "  • pr_monitor_cancel — cancel a watch\n\n" +
          "How it works: polls check-runs every 30s. When ALL checks complete → " +
          "notifies with pass/fail results. Auto-detects new pushes (SHA changes).\n" +
          "Fallback: Telegram → pending file if session.send() fails.\n" +
          (hasToken ? "{{EMPLOYER_PARENT}} token: ✓\n" : "⚠️ No {{EMPLOYER_PARENT}} token.\n") +
          (notes ? "\n" + notes : ""),
      };
    },
  },
});

sessionRef = session;
await session.log("pr-monitor v2 loaded — CI check-run status polling");
