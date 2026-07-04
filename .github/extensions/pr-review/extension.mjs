/**
 * PR Review Extension for {{PRODUCT}} CLI
 *
 * Implements the multi-agent code review pipeline:
 * - review_pr tool: lets authorized review agents submit findings
 * - get_review_status tool: read-only status check for any agent
 * - Security hooks: agent authorization, ledger protection, CLI blocking
 *
 * Identity mechanism:
 * - onPreToolUse reads input.agentType (provided by runtime on every hook call)
 * - Verifies authorization against review-config.json
 * - Stashes verified agent name in module-level variable
 * - Tool handler reads from stash (NOT from args — anti-spoofing)
 * - NOTE: modifiedArgs is NOT supported by the runtime for extension hooks;
 *   we use the stash pattern instead (same as agent-identity-client).
 *
 * See spec: data/specs/multi-agent-review-v1.md
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession } from "@github/copilot-sdk/extension";
import {
  handleRequestReview,
  handleSetReviewState,
  handleGetReviewQueue,
  handleInvalidateReviews,
  handleReviewQueueAdmin,
  handleDispatchReviews,
  getQueueStatusForPr,
  getNextReady,
  markDispatched,
} from "./review-queue.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

const CONFIG_PATH = resolve(REPO_ROOT, "data", "review-config.json");
const LEDGER_PATH = resolve(REPO_ROOT, "data", "review-ledger.json");

// ── Config & Ledger loading ─────────────────────────────────────────────────

function loadConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) return { repos: {} };
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return { repos: {} };
  }
}

function loadLedger() {
  try {
    if (!existsSync(LEDGER_PATH)) return {};
    return JSON.parse(readFileSync(LEDGER_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveLedger(ledger) {
  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n", "utf-8");
}

// ── {{EMPLOYER_PARENT}} REST helper ──────────────────────────────────────────────────────

function getGhToken() {
  const envPath = resolve(REPO_ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("GITHUB_TOKEN=")) {
        let val = trimmed.slice("GITHUB_TOKEN=".length).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        return val;
      }
      if (trimmed.startsWith("GH_TOKEN=")) {
        let val = trimmed.slice("GH_TOKEN=".length).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        return val;
      }
    }
  }
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
}

async function postPrComment(repo, prNumber, body, token) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "copilot-pr-review/1.0",
      },
      body: JSON.stringify({ body }),
    }
  );
  return { ok: res.ok, status: res.status };
}

async function getPrHead(repo, prNumber, token) {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "copilot-pr-review/1.0",
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.head?.sha || null;
}

// ── Comment formatting ──────────────────────────────────────────────────────

function formatReviewComment(agentName, role, status, summary, findings) {
  const statusEmoji = status === "APPROVE" ? "✅" : status === "DENY" ? "❌" : "⚠️";
  const statusLabel = status === "APPROVE" ? "APPROVED"
    : status === "DENY" ? "DENIED"
    : "NEEDS MANUAL REVIEW";

  const lines = [`## ${statusEmoji} ${role} — ${statusLabel}`, ""];

  if (status === "APPROVE") {
    lines.push("### Checked");
    for (const f of findings) {
      if (f.type === "pass" || !f.type) {
        const filePart = f.file ? ` (\`${f.file}\`)` : "";
        lines.push(`- ${f.description}${filePart}`);
      }
    }
  } else if (status === "DENY") {
    lines.push("### Required Fixes");
    const failFindings = findings.filter(f => f.type === "fail");
    for (let i = 0; i < failFindings.length; i++) {
      const f = failFindings[i];
      const filePart = f.file ? ` in \`${f.file}\`` : "";
      const linePart = f.line_range ? `:${f.line_range[0]}-${f.line_range[1]}` : "";
      lines.push(`${i + 1}. **[${f.severity || "high"}]** ${f.description}${filePart}${linePart}`);
      if (f.code_snippet) {
        lines.push(`   \`\`\`\n   ${f.code_snippet}\n   \`\`\``);
      }
      if (f.suggested_fix) {
        lines.push(`   **Fix:** ${f.suggested_fix}`);
      }
      if (f.reference) {
        lines.push(`   _Ref: ${f.reference}_`);
      }
      lines.push("");
    }
  } else {
    // NEEDS_MANUAL_REVIEW
    lines.push("### Why");
    for (const f of findings) {
      lines.push(`- ${f.description}`);
    }
    lines.push("");
    lines.push("### What {{PARENT_1}} Should Look At");
    for (const f of findings) {
      if (f.suggested_fix) {
        lines.push(`- ${f.suggested_fix}`);
      }
    }
  }

  lines.push("");
  lines.push("---");
  lines.push(`_${agentName} | ${new Date().toISOString()} | ${summary}_`);

  return lines.join("\n");
}

// ── Ledger update logic ─────────────────────────────────────────────────────

function updateLedger(ledger, repo, prNumber, headCommit, agentName, status, summary, findings) {
  const key = `${repo}#${prNumber}`;
  const config = loadConfig();
  const repoConfig = config.repos[repo];

  if (!ledger[key]) {
    ledger[key] = {
      repo,
      pr: prNumber,
      head_commit: headCommit,
      reviews: {},
      merge_allowed: false,
      pending_reviewers: [],
      blockers: [],
      fix_cycle_count: 0,
      cycle_history: [],
    };
  }

  const entry = ledger[key];

  // Commit invalidation — if head changed, reset reviews and bump cycle
  if (entry.head_commit && entry.head_commit !== headCommit) {
    const prevDeniers = Object.entries(entry.reviews)
      .filter(([, r]) => r.status === "DENY")
      .map(([name]) => name);

    entry.cycle_history.push({
      cycle: entry.fix_cycle_count,
      commit: entry.head_commit,
      deniers: prevDeniers,
      findings_count: Object.values(entry.reviews)
        .reduce((sum, r) => sum + (r.findings?.filter(f => f.type === "fail")?.length || 0), 0),
    });

    entry.fix_cycle_count++;
    entry.head_commit = headCommit;
    entry.reviews = {};
  }

  // Write the review
  entry.reviews[agentName] = {
    status,
    commit_reviewed: headCommit,
    timestamp: new Date().toISOString(),
    summary,
    findings,
  };

  // Recalculate merge status
  if (repoConfig) {
    const requiredAgents = repoConfig.required_reviewers.map(r => r.agent);
    const pending = [];
    const blockers = [];

    for (const agent of requiredAgents) {
      const review = entry.reviews[agent];
      if (!review) {
        pending.push(agent);
      } else if (review.status === "DENY") {
        blockers.push(`${agent}: ${review.summary}`);
      } else if (review.status === "NEEDS_MANUAL_REVIEW") {
        blockers.push(`${agent}: NEEDS MANUAL REVIEW — ${review.summary}`);
      }
    }

    entry.pending_reviewers = pending;
    entry.blockers = blockers;
    entry.merge_allowed = pending.length === 0 && blockers.length === 0;
  }

  // Check fix cycle escalation
  const maxCycles = config.defaults?.max_fix_cycles || 3;
  if (entry.fix_cycle_count >= maxCycles) {
    entry.merge_allowed = false;
    entry.blockers = [`ESCALATED: Max fix cycles (${maxCycles}) reached. Requires manual review.`];
  }

  // Check for same-finding persistence (2 cycles = auto-escalate)
  // Only flag agents that STILL have an unresolved denial (i.e., have NOT since approved
  // in the current cycle). This prevents false positives when a persistent denier has
  // subsequently fixed the issue and approved.
  if (entry.fix_cycle_count >= 2 && entry.cycle_history.length >= 2) {
    const lastCycle = entry.cycle_history[entry.cycle_history.length - 1];
    const prevCycle = entry.cycle_history[entry.cycle_history.length - 2];
    if (lastCycle.deniers.some(d => prevCycle.deniers.includes(d))) {
      const persistentDeniers = lastCycle.deniers.filter(d => {
        if (!prevCycle.deniers.includes(d)) return false;
        // Exclude agents that have since approved in the current cycle
        const currentReview = entry.reviews[d];
        const hasApprovedCurrentCycle = currentReview?.status === "APPROVE";
        return !hasApprovedCurrentCycle;
      });
      for (const d of persistentDeniers) {
        if (!entry.blockers.some(b => b.includes("PERSISTENT"))) {
          entry.blockers.push(`PERSISTENT: ${d} has denied across 2+ cycles — escalate to manual review`);
        }
      }
      if (persistentDeniers.length > 0) {
        entry.merge_allowed = false;
      }
    }
  }

  return entry;
}

// ── Config management helpers ────────────────────────────────────────────────

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function validateRepoFormat(repo) {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo);
}

function agentFileExists(agentName) {
  const agentPath = resolve(REPO_ROOT, ".github", "agents", `${agentName}.agent.md`);
  return existsSync(agentPath);
}

// ── Tool: review_config_add_repo ────────────────────────────────────────────

function handleReviewConfigAddRepo(args) {
  const { repo, required_reviewers, human_approval_required, commit_invalidation } = args;

  if (!repo) return JSON.stringify({ error: "'repo' is required (owner/repo format)." });
  if (!validateRepoFormat(repo)) {
    return JSON.stringify({ error: `Invalid repo format: "${repo}". Must be owner/repo (e.g. {{GITHUB_USERNAME}}/my-repo).` });
  }
  if (!required_reviewers || !Array.isArray(required_reviewers) || required_reviewers.length === 0) {
    return JSON.stringify({ error: "'required_reviewers' must be a non-empty array of { agent, role } objects." });
  }

  // Validate each reviewer
  const errors = [];
  for (const r of required_reviewers) {
    if (!r.agent || !r.role) {
      errors.push(`Each reviewer must have 'agent' and 'role'. Got: ${JSON.stringify(r)}`);
      continue;
    }
    if (!agentFileExists(r.agent)) {
      errors.push(`Agent file not found: .github/agents/${r.agent}.agent.md — create it first or verify the name.`);
    }
  }
  if (errors.length > 0) {
    return JSON.stringify({ error: "Validation failed", details: errors });
  }

  const config = loadConfig();
  if (config.repos[repo]) {
    return JSON.stringify({ error: `Repo "${repo}" already exists in review-config. Use review_config_update_repo to modify it.` });
  }

  config.repos[repo] = {
    required_reviewers,
    human_approval_required: human_approval_required ?? false,
    commit_invalidation: commit_invalidation ?? true,
  };

  saveConfig(config);
  return JSON.stringify({
    status: "added",
    repo,
    reviewers: required_reviewers.map(r => r.agent),
    human_approval_required: config.repos[repo].human_approval_required,
    commit_invalidation: config.repos[repo].commit_invalidation,
  });
}

// ── Tool: review_config_remove_repo ─────────────────────────────────────────

function handleReviewConfigRemoveRepo(args) {
  const { repo } = args;

  if (!repo) return JSON.stringify({ error: "'repo' is required." });

  const config = loadConfig();
  if (!config.repos[repo]) {
    return JSON.stringify({ error: `Repo "${repo}" not found in review-config.` });
  }

  const removed = config.repos[repo];
  delete config.repos[repo];
  saveConfig(config);

  return JSON.stringify({
    status: "removed",
    repo,
    removed_reviewers: removed.required_reviewers.map(r => r.agent),
  });
}

// ── Tool: review_config_update_repo ─────────────────────────────────────────

function handleReviewConfigUpdateRepo(args) {
  const { repo, required_reviewers, human_approval_required, commit_invalidation } = args;

  if (!repo) return JSON.stringify({ error: "'repo' is required." });

  const config = loadConfig();
  if (!config.repos[repo]) {
    return JSON.stringify({ error: `Repo "${repo}" not found in review-config. Use review_config_add_repo to create it.` });
  }

  // Validate reviewers if provided
  if (required_reviewers !== undefined) {
    if (!Array.isArray(required_reviewers) || required_reviewers.length === 0) {
      return JSON.stringify({ error: "'required_reviewers' must be a non-empty array of { agent, role } objects." });
    }
    const errors = [];
    for (const r of required_reviewers) {
      if (!r.agent || !r.role) {
        errors.push(`Each reviewer must have 'agent' and 'role'. Got: ${JSON.stringify(r)}`);
        continue;
      }
      if (!agentFileExists(r.agent)) {
        errors.push(`Agent file not found: .github/agents/${r.agent}.agent.md — create it first or verify the name.`);
      }
    }
    if (errors.length > 0) {
      return JSON.stringify({ error: "Validation failed", details: errors });
    }
    config.repos[repo].required_reviewers = required_reviewers;
  }

  if (human_approval_required !== undefined) {
    config.repos[repo].human_approval_required = human_approval_required;
  }
  if (commit_invalidation !== undefined) {
    config.repos[repo].commit_invalidation = commit_invalidation;
  }

  saveConfig(config);
  return JSON.stringify({
    status: "updated",
    repo,
    config: config.repos[repo],
  });
}

// ── Tool: review_config_list ────────────────────────────────────────────────

function handleReviewConfigList() {
  const config = loadConfig();
  const repos = Object.entries(config.repos).map(([repo, cfg]) => ({
    repo,
    reviewers: cfg.required_reviewers.map(r => ({ agent: r.agent, role: r.role })),
    human_approval_required: cfg.human_approval_required,
    commit_invalidation: cfg.commit_invalidation,
  }));

  return JSON.stringify({
    version: config.version || 1,
    defaults: config.defaults || {},
    repo_count: repos.length,
    repos,
  });
}

// ── Agent identity stash ────────────────────────────────────────────────────
// The onPreToolUse hook reads input.agentType (provided by the runtime) and
// stashes it here. The review_pr tool handler reads it. This avoids needing
// modifiedArgs (which the runtime doesn't currently process from extensions).
let _stashedAgentType = null;

// ── Tool: review_pr ─────────────────────────────────────────────────────────

async function handleReviewPr(args) {
  const { repo, pr_number, status, summary, findings } = args;

  // Validate required fields
  if (!repo || !pr_number) {
    return JSON.stringify({ error: "Both 'repo' and 'pr_number' are required." });
  }
  if (!status || !["APPROVE", "DENY", "NEEDS_MANUAL_REVIEW"].includes(status)) {
    return JSON.stringify({ error: "status must be one of: APPROVE, DENY, NEEDS_MANUAL_REVIEW" });
  }
  if (!summary) {
    return JSON.stringify({ error: "summary is required — describe what was checked or what must be fixed." });
  }
  if (!findings || !Array.isArray(findings) || findings.length === 0) {
    return JSON.stringify({ error: "findings[] is required and must be non-empty." });
  }

  // Validate DENY findings have suggested_fix (Option B enforcement)
  if (status === "DENY") {
    const failFindings = findings.filter(f => f.type === "fail");
    if (failFindings.length === 0) {
      return JSON.stringify({ error: "DENY reviews must include at least one finding with type: 'fail'." });
    }
    const missingSuggestion = failFindings.filter(f => !f.suggested_fix);
    if (missingSuggestion.length > 0) {
      return JSON.stringify({
        error: "Option B enforcement: every DENY finding with type 'fail' MUST have a non-null suggested_fix. " +
          "If you cannot prescribe a fix, use NEEDS_MANUAL_REVIEW instead of DENY. " +
          `Missing suggested_fix on ${missingSuggestion.length} finding(s).`,
        findings_without_fix: missingSuggestion.map(f => f.description),
      });
    }
  }

  // agent_type: read from stash (set by onPreToolUse hook) — NOT from args
  // The hook reads input.agentType from runtime, verifies authorization, and stashes it.
  // This is the anti-spoofing mechanism: agents cannot override their identity via args.
  const agent_type = _stashedAgentType;
  _stashedAgentType = null; // clear after read

  if (!agent_type) {
    return JSON.stringify({ error: "agent_type could not be determined. The onPreToolUse hook must stash agent identity before this tool runs. Ensure you are running as a named agent." });
  }

  // Authorization check: is this agent authorized to review this repo?
  const config = loadConfig();
  const repoConfig = config.repos[repo];
  if (!repoConfig) {
    return JSON.stringify({
      error: `No review config found for ${repo}. Add it to data/review-config.json first.`,
    });
  }

  const authorized = repoConfig.required_reviewers.some(r => r.agent === agent_type);
  if (!authorized) {
    return JSON.stringify({
      error: `Agent "${agent_type}" is not an authorized reviewer for ${repo}.`,
      authorized_reviewers: repoConfig.required_reviewers.map(r => r.agent),
    });
  }

  // Get the PR head commit
  const ghToken = getGhToken();
  if (!ghToken) {
    return JSON.stringify({ error: "No {{EMPLOYER_PARENT}} token found. Set GITHUB_TOKEN in .env." });
  }

  const headCommit = await getPrHead(repo, pr_number, ghToken);
  if (!headCommit) {
    return JSON.stringify({ error: `Could not fetch PR #${pr_number} from ${repo}. Verify PR exists and is open.` });
  }

  // Find the role label for this agent
  const reviewerConfig = repoConfig.required_reviewers.find(r => r.agent === agent_type);
  const role = reviewerConfig?.role || agent_type;

  // Post PR comment
  const commentBody = formatReviewComment(agent_type, role, status, summary, findings);
  const commentResult = await postPrComment(repo, pr_number, commentBody, ghToken);

  if (!commentResult.ok) {
    return JSON.stringify({
      error: `Failed to post PR comment (HTTP ${commentResult.status}). Review NOT recorded.`,
    });
  }

  // Update ledger
  const ledger = loadLedger();
  const entry = updateLedger(ledger, repo, pr_number, headCommit, agent_type, status, summary, findings);
  saveLedger(ledger);

  return JSON.stringify({
    status: "recorded",
    review_status: status,
    agent: agent_type,
    repo,
    pr_number,
    commit_reviewed: headCommit,
    merge_allowed: entry.merge_allowed,
    pending_reviewers: entry.pending_reviewers,
    blockers: entry.blockers,
    fix_cycle_count: entry.fix_cycle_count,
  });
}

// ── Tool: get_review_status ─────────────────────────────────────────────────

function handleGetReviewStatus(args) {
  const { repo, pr_number } = args;

  if (!repo || !pr_number) {
    return JSON.stringify({ error: "Both 'repo' and 'pr_number' are required." });
  }

  const config = loadConfig();
  const repoConfig = config.repos[repo];
  const ledger = loadLedger();
  const key = `${repo}#${pr_number}`;
  const entry = ledger[key];

  if (!entry) {
    // No reviews yet — show what's needed
    if (!repoConfig) {
      return JSON.stringify({
        repo,
        pr_number,
        configured: false,
        message: `No review config for ${repo}. PR can be merged without agent reviews.`,
      });
    }

    return JSON.stringify({
      repo,
      pr_number,
      configured: true,
      reviews: {},
      merge_allowed: false,
      pending_reviewers: repoConfig.required_reviewers.map(r => r.agent),
      blockers: [],
      fix_cycle_count: 0,
      message: "No reviews submitted yet. All required reviewers are pending.",
    });
  }

  return JSON.stringify({
    repo,
    pr_number,
    configured: Boolean(repoConfig),
    head_commit: entry.head_commit,
    reviews: entry.reviews,
    merge_allowed: entry.merge_allowed,
    pending_reviewers: entry.pending_reviewers,
    blockers: entry.blockers,
    fix_cycle_count: entry.fix_cycle_count,
    max_cycles: config.defaults?.max_fix_cycles || 3,
    cycle_history: entry.cycle_history || [],
  });
}

// ── Merge gate check (exported for use by telegram-bridge) ──────────────────

/**
 * Check if a PR passes the review gate.
 * Returns { allowed: true } or { allowed: false, reason, guidance, pending, denied }
 */
function checkReviewGate(repo, prNumber, currentHeadSha) {
  const config = loadConfig();
  const repoConfig = config.repos[repo];

  // No config = fall back to existing behavior (no review gate)
  if (!repoConfig) {
    return { allowed: true, reason: "no_config" };
  }

  const ledger = loadLedger();
  const key = `${repo}#${prNumber}`;
  const entry = ledger[key];

  // No reviews yet
  if (!entry) {
    const required = repoConfig.required_reviewers.map(r => r.agent);
    return {
      allowed: false,
      reason: `PR requires review from the following agents: ${required.join(", ")}. No reviews found.`,
      guidance: `Dispatch these agents to review PR #${prNumber} before merging.`,
      pending: required,
      denied: [],
    };
  }

  // Commit invalidation check
  if (repoConfig.commit_invalidation && currentHeadSha && entry.head_commit !== currentHeadSha) {
    const required = repoConfig.required_reviewers.map(r => r.agent);
    return {
      allowed: false,
      reason: `New commits pushed since last review (reviewed: ${entry.head_commit?.slice(0, 7)}, current: ${currentHeadSha?.slice(0, 7)}). All reviews invalidated.`,
      guidance: `Re-request reviews from: ${required.join(", ")}`,
      pending: required,
      denied: [],
    };
  }

  // Fix cycle escalation
  const maxCycles = config.defaults?.max_fix_cycles || 3;
  if (entry.fix_cycle_count >= maxCycles) {
    return {
      allowed: false,
      reason: `Max fix cycles (${maxCycles}) reached. This PR requires manual review by {{PARENT_1}}.`,
      guidance: "Escalate to {{PARENT_1}} for manual review. The fix loop has not converged.",
      pending: [],
      denied: entry.blockers,
    };
  }

  // Check each required reviewer
  const missing = [];
  const denied = [];
  const needsManual = [];

  for (const reviewer of repoConfig.required_reviewers) {
    const review = entry.reviews[reviewer.agent];
    if (!review) {
      missing.push(reviewer.agent);
    } else if (review.status === "DENY") {
      denied.push({ agent: reviewer.agent, summary: review.summary, findings: review.findings });
    } else if (review.status === "NEEDS_MANUAL_REVIEW") {
      needsManual.push({ agent: reviewer.agent, summary: review.summary });
    }
  }

  if (missing.length > 0 || denied.length > 0 || needsManual.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`Missing reviews: ${missing.join(", ")}`);
    if (denied.length > 0) parts.push(`Denied: ${denied.map(d => `${d.agent} (${d.summary})`).join("; ")}`);
    if (needsManual.length > 0) parts.push(`Needs manual review: ${needsManual.map(n => `${n.agent} (${n.summary})`).join("; ")}`);

    let guidance;
    if (missing.length > 0) {
      guidance = `Dispatch these agents to review: ${missing.join(", ")}`;
    } else if (denied.length > 0) {
      guidance = "Address the deny feedback (read findings via get_review_status), push fixes, then re-request review from denying agents.";
    } else {
      guidance = "Wait for {{PARENT_1}} to manually review the flagged items.";
    }

    return {
      allowed: false,
      reason: parts.join("\n"),
      guidance,
      pending: missing,
      denied: denied.map(d => d.agent),
      needs_manual: needsManual.map(n => n.agent),
      human_approval_required: repoConfig.human_approval_required,
    };
  }

  // All approved
  return {
    allowed: true,
    reason: "all_approved",
    human_approval_required: repoConfig.human_approval_required,
  };
}

// ── Extension registration ──────────────────────────────────────────────────
// NOTE: joinSession Promise hangs (runtime bug — never ACKs the registration)
// but tools ARE registered and functional via IPC. The catch block prevents
// the process from dying if the Promise ever rejects.

let session;
try {
  session = await joinSession({
  tools: [
    {
      name: "review_pr",
      description:
        "Submit a PR review as an authorized review agent. Posts a structured comment " +
        "on the {{EMPLOYER_PARENT}} PR and updates the local review ledger. " +
        "The agent_type parameter is auto-injected by a hook — do NOT provide it manually. " +
        "DENY reviews MUST include findings with type 'fail' and a non-null suggested_fix " +
        "(prescriptive fixes only — if you can't prescribe a fix, use NEEDS_MANUAL_REVIEW). " +
        "APPROVE reviews must list what was checked (findings with type 'pass'). " +
        "Only agents listed in data/review-config.json for the target repo can use this tool.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "{{EMPLOYER_PARENT}} repo in owner/repo format, e.g. '{{GITHUB_USERNAME}}/surgiquip'.",
          },
          pr_number: {
            type: "number",
            description: "The PR number to review.",
          },
          status: {
            type: "string",
            description: "Review outcome: 'APPROVE', 'DENY', or 'NEEDS_MANUAL_REVIEW'.",
            enum: ["APPROVE", "DENY", "NEEDS_MANUAL_REVIEW"],
          },
          summary: {
            type: "string",
            description: "One-line summary of the review (what was checked or what must be fixed).",
          },
          findings: {
            type: "array",
            description:
              "JSON array of finding objects. Each object MUST have: " +
              "{ type: 'pass'|'fail'|'warning'|'info', description: string (required), " +
              "severity: 'critical'|'high'|'medium'|'low', category: string, " +
              "file: string|null, line_range: [startLine, endLine]|null, " +
              "code_snippet: string|null, suggested_fix: string|null (REQUIRED for DENY findings), " +
              "reference: string|null }. DENY must include at least one type:'fail' finding with suggested_fix.",
          },
        },
        required: ["repo", "pr_number", "status", "summary", "findings"],
      },
      handler: handleReviewPr,
    },
    {
      name: "get_review_status",
      description:
        "Check the current review status of a PR. Returns all reviews, " +
        "pending reviewers, blockers, fix cycle count, and whether merge is allowed. " +
        "Any agent can call this — it's read-only. Use this to check what reviews " +
        "are needed before calling merge_pr, or to read deny findings for fixing.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "{{EMPLOYER_PARENT}} repo in owner/repo format, e.g. '{{GITHUB_USERNAME}}/surgiquip'.",
          },
          pr_number: {
            type: "number",
            description: "The PR number to check.",
          },
        },
        required: ["repo", "pr_number"],
      },
      handler: handleGetReviewStatus,
    },
    {
      name: "review_config_add_repo",
      description:
        "Add a new repository to the multi-agent review pipeline. Defines which " +
        "agents are required reviewers for the repo. Each agent must have a matching " +
        ".github/agents/<name>.agent.md file. Use this to onboard new repos into " +
        "the code review system.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "{{EMPLOYER_PARENT}} repo in owner/repo format, e.g. '{{GITHUB_USERNAME}}/taller-mecanico'.",
          },
          required_reviewers: {
            type: "array",
            description:
              "Array of reviewer objects: [{ agent: 'agent-name', role: 'Human-readable role description' }]. " +
              "Each agent must have a corresponding .agent.md file in .github/agents/.",
          },
          human_approval_required: {
            type: "boolean",
            description: "Whether {{PARENT_1}} must also approve before merge. Default: false.",
          },
          commit_invalidation: {
            type: "boolean",
            description: "Whether new commits invalidate prior reviews. Default: true.",
          },
        },
        required: ["repo", "required_reviewers"],
      },
      handler: handleReviewConfigAddRepo,
    },
    {
      name: "review_config_remove_repo",
      description:
        "Remove a repository from the multi-agent review pipeline. " +
        "The repo will no longer require agent reviews before merge.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "{{EMPLOYER_PARENT}} repo in owner/repo format to remove.",
          },
        },
        required: ["repo"],
      },
      handler: handleReviewConfigRemoveRepo,
    },
    {
      name: "review_config_update_repo",
      description:
        "Update an existing repo's review configuration — change reviewers, " +
        "toggle human approval, or change commit invalidation settings. " +
        "Only provided fields are updated; omitted fields keep current values.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "{{EMPLOYER_PARENT}} repo in owner/repo format to update.",
          },
          required_reviewers: {
            type: "array",
            description:
              "New reviewer list (replaces existing): [{ agent: 'name', role: 'description' }].",
          },
          human_approval_required: {
            type: "boolean",
            description: "Whether {{PARENT_1}} must also approve before merge.",
          },
          commit_invalidation: {
            type: "boolean",
            description: "Whether new commits invalidate prior reviews.",
          },
        },
        required: ["repo"],
      },
      handler: handleReviewConfigUpdateRepo,
    },
    {
      name: "review_config_list",
      description:
        "List all repositories configured for multi-agent code review, " +
        "including their required reviewers and settings. Read-only — any agent can call this.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      handler: handleReviewConfigList,
    },

    // ── Review Queue Tools ────────────────────────────────────────────────
    {
      name: "request_review",
      description:
        "Queue a PR for async code review by specified agent types. " +
        "Creates review requests in the queue — the dispatcher will launch agents. " +
        "Replaces inline task() dispatch for reviews. Idempotent: same repo+PR+agent+SHA won't duplicate.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "Full repo name (e.g., '{{GITHUB_USERNAME}}/taller-mecanico').",
          },
          pr_number: {
            type: "number",
            description: "PR number to review.",
          },
          agent_types: {
            type: "array",
            description: "Review agent types to dispatch (e.g., ['taller-mecanico-senior-dev', 'taller-mecanico-ui-tester']).",
          },
          head_sha: {
            type: "string",
            description: "Current PR HEAD SHA (required for commit-level tracking).",
          },
          priority: {
            type: "number",
            description: "Priority: -1=low, 0=normal, 1=high. Default: 0.",
          },
          pr_title: {
            type: "string",
            description: "PR title for display context.",
          },
          pr_branch: {
            type: "string",
            description: "Source branch name.",
          },
          requester_session_id: {
            type: "string",
            description: "Session ID of the requester (for feedback routing).",
          },
          requester_agent_id: {
            type: "string",
            description: "Background agent ID (for write_agent feedback).",
          },
        },
        required: ["repo", "pr_number", "agent_types", "head_sha"],
      },
      handler: handleRequestReview,
    },
    {
      name: "set_review_state",
      description:
        "Update the state of a review request. Called by review agents to signal progress. " +
        "Valid transitions: dispatched→working, working→completed, working→failed. " +
        "Returns { stale: true } if the review has been invalidated by a new commit.",
      parameters: {
        type: "object",
        properties: {
          request_id: {
            type: "string",
            description: "Review request ID (returned by request_review or included in dispatch prompt).",
          },
          state: {
            type: "string",
            description: "New state: 'working', 'completed', or 'failed'.",
            enum: ["working", "completed", "failed"],
          },
          result: {
            type: "string",
            description: "Review outcome (required for 'completed'): 'approved', 'changes_requested', 'commented'.",
            enum: ["approved", "changes_requested", "commented"],
          },
          review_summary: {
            type: "string",
            description: "Brief summary of review findings.",
          },
          error: {
            type: "string",
            description: "Error message (for 'failed' state).",
          },
        },
        required: ["request_id", "state"],
      },
      handler: handleSetReviewState,
    },
    {
      name: "get_review_queue",
      description:
        "Query the review queue with optional filters. Returns pending/active/completed reviews, " +
        "queue stats, and available dispatch slots. Any agent can call this — read-only.",
      parameters: {
        type: "object",
        properties: {
          agent_type: {
            type: "string",
            description: "Filter by agent type.",
          },
          state: {
            type: "string",
            description: "Filter by state (requested, dispatched, working, completed, failed, invalidated).",
          },
          repo: {
            type: "string",
            description: "Filter by repository.",
          },
          pr_number: {
            type: "number",
            description: "Filter by PR number.",
          },
          limit: {
            type: "number",
            description: "Max results (default: 20).",
          },
        },
        required: [],
      },
      handler: handleGetReviewQueue,
    },
    {
      name: "invalidate_reviews",
      description:
        "Invalidate all pending/active reviews for a PR when a new commit is pushed. " +
        "Marks stale reviews, optionally re-creates requests for same agents at new HEAD. " +
        "Call this from pr-monitor or push webhook handlers.",
      parameters: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "Full repo name.",
          },
          pr_number: {
            type: "number",
            description: "PR number.",
          },
          new_head_sha: {
            type: "string",
            description: "The new HEAD SHA after push.",
          },
          re_request: {
            type: "boolean",
            description: "Auto-create new requests for same agent_types at new SHA (default: true).",
          },
        },
        required: ["repo", "pr_number", "new_head_sha"],
      },
      handler: handleInvalidateReviews,
    },
    {
      name: "review_queue_admin",
      description:
        "Administrative actions for the review queue: pause/resume dispatcher, " +
        "cancel or reprioritize requests, set concurrency limits, view metrics, flush old entries.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "Admin action to perform.",
            enum: ["pause", "resume", "cancel", "reprioritize", "set_type_limit", "set_config", "metrics", "flush_completed"],
          },
          request_id: {
            type: "string",
            description: "Request ID (for cancel/reprioritize).",
          },
          priority: {
            type: "number",
            description: "New priority (for reprioritize).",
          },
          agent_type: {
            type: "string",
            description: "Agent type (for set_type_limit).",
          },
          max_concurrent: {
            type: "number",
            description: "Max concurrent (for set_type_limit).",
          },
          setting_key: {
            type: "string",
            description: "Config key (for set_config): global_max_concurrent, default_per_type_max, poll_interval_ms, request_timeout_ms, dispatch_timeout_ms.",
          },
          setting_value: {
            type: "string",
            description: "Config value as string (for set_config).",
          },
        },
        required: ["action"],
      },
      handler: handleReviewQueueAdmin,
    },
    {
      name: "dispatch_reviews",
      description:
        "Trigger a review dispatch cycle. Returns spawn_instructions[] — YOU MUST launch " +
        "a review agent for EACH item using the task tool (agent_type from instruction, prompt from instruction). " +
        "Without spawning agents, reviews stay stuck as 'dispatched' forever. " +
        "Also detects and recycles stale/timed-out dispatches. " +
        "Called by cron (repo-maintainer) or manually. Always act on spawn_instructions.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      handler: handleDispatchReviews,
    },
  ],

  hooks: {
    // ── Agent identity stash + authorization ──────────────────────────────
    onPreToolUse: async (input) => {
      // Hook 1: review_pr — stash agent identity + verify authorization
      if (input.toolName === "review_pr") {
        // Read agent identity from runtime-provided fields
        const agentName = input.agentType
          || input.agentId
          || input.toolArgs?.agent_type
          || null;

        if (!agentName) {
          return {
            permissionDecision: "deny",
            permissionDecisionReason:
              "🚫 BLOCKED: Cannot identify calling agent. " +
              "The review_pr tool requires agent identity (provided by runtime via input.agentType). " +
              "Ensure you are running as a named agent.",
          };
        }

        const repo = input.toolArgs?.repo;
        if (repo) {
          const config = loadConfig();
          const repoConfig = config.repos[repo];
          if (repoConfig) {
            const authorized = repoConfig.required_reviewers.some(r => r.agent === agentName);
            if (!authorized) {
              return {
                permissionDecision: "deny",
                permissionDecisionReason:
                  `🚫 BLOCKED: Agent "${agentName}" is not an authorized reviewer for ${repo}.\n` +
                  `Authorized reviewers: ${repoConfig.required_reviewers.map(r => r.agent).join(", ")}\n\n` +
                  "Only agents listed in data/review-config.json can submit reviews for a repo.",
              };
            }
          }
        }

        // Stash the verified agent type for the tool handler to read
        _stashedAgentType = agentName;
        // Allow the tool call to proceed
        return;
      }

      // Hook 2: Block raw gh pr review/approve commands in powershell
      if (input.toolName === "powershell") {
        const cmd = input.toolArgs?.command || "";
        const blockedPatterns = [
          /\bgh\s+pr\s+review\b/i,
          /\bgh\s+pr\s+approve\b/i,
        ];

        for (const pattern of blockedPatterns) {
          if (pattern.test(cmd)) {
            return {
              permissionDecision: "deny",
              permissionDecisionReason:
                "🚫 BLOCKED: Raw `gh pr review` / `gh pr approve` commands are blocked.\n\n" +
                "Use the `review_pr` tool to submit code reviews. This ensures:\n" +
                "- Agent identity is verified\n" +
                "- Review is recorded in the ledger\n" +
                "- Only authorized agents can review each repo\n\n" +
                "Tool: review_pr(repo, pr_number, status, summary, findings)",
            };
          }
        }
      }

      // Hook 3: Block direct edits to review-ledger.json
      if (input.toolName === "edit" || input.toolName === "create") {
        const filePath = input.toolArgs?.path || "";
        const normalized = filePath.replace(/\\/g, "/");
        if (normalized.includes("review-ledger.json")) {
          return {
            permissionDecision: "deny",
            permissionDecisionReason:
              "🚫 BLOCKED: The review ledger (data/review-ledger.json) is protected.\n\n" +
              "The ledger can only be written via the `review_pr` tool, which:\n" +
              "- Verifies agent authorization\n" +
              "- Validates findings schema\n" +
              "- Enforces Option B (prescriptive fixes)\n" +
              "- Posts the PR comment atomically\n\n" +
              "To read ledger status, use `get_review_status(repo, pr_number)`.",
          };
        }
        // Also protect review-config.json from casual edits (use extension tools instead)
        if (normalized.includes("review-config.json")) {
          return {
            permissionDecision: "deny",
            permissionDecisionReason:
              "🚫 BLOCKED: The review config (data/review-config.json) is a governance file.\n\n" +
              "Use the review_config_* tools to manage it:\n" +
              "- review_config_add_repo — add a new repo\n" +
              "- review_config_remove_repo — remove a repo\n" +
              "- review_config_update_repo — update settings/reviewers\n" +
              "- review_config_list — list all configured repos\n\n" +
              "These tools validate inputs and bypass the file protection safely.",
          };
        }
      }
    },

    // onPostToolUse fallback (defense-in-depth for runtimes that don't dispatch onPreToolUse)
    onPostToolUse: async (input) => {
      if (input.toolName === "powershell") {
        const cmd = input.toolArgs?.command || "";
        if (/\bgh\s+pr\s+(review|approve)\b/i.test(cmd)) {
          return {
            additionalContext:
              "🚫 WARNING: You just ran a raw `gh pr review/approve` command. " +
              "This is NOT recorded in the review ledger and will NOT count toward merge gate approval. " +
              "Use the `review_pr` tool instead.",
          };
        }
      }
    },

    onSessionStart: async () => {
      const config = loadConfig();
      const repoCount = Object.keys(config.repos).length;

      // Initialize queue DB on session start (creates tables if needed)
      try {
        const queueStatus = handleGetReviewQueue({});
        const parsed = JSON.parse(queueStatus);
        const pendingCount = parsed.stats?.requested || 0;
        const activeCount = parsed.active_count || 0;

        return {
          additionalContext: [
            `[pr-review] Multi-agent code review system loaded.`,
            `  • ${repoCount} repo(s) configured for agent-based review`,
            `  • Review tools: review_pr, get_review_status, review_config_*`,
            `  • Queue tools: request_review, set_review_state, get_review_queue, invalidate_reviews, review_queue_admin, dispatch_reviews`,
            `  • Security: agent identity verified, ledger protected, raw CLI blocked`,
            `  • DENY reviews require prescriptive suggested_fix on every fail finding (Option B)`,
            `  • Fix cycle limit: ${config.defaults?.max_fix_cycles || 3} cycles before auto-escalation`,
            `  • Queue: ${pendingCount} pending, ${activeCount} active, ${parsed.available_slots} slots available`,
          ].join("\n"),
        };
      } catch (queueErr) {
        return {
          additionalContext: [
            `[pr-review] Multi-agent code review system loaded.`,
            `  • ${repoCount} repo(s) configured for agent-based review`,
            `  • Tools: review_pr, get_review_status, review_config_*, request_review, set_review_state, get_review_queue, invalidate_reviews, review_queue_admin, dispatch_reviews`,
            `  • Security: agent identity verified, ledger protected, raw CLI blocked`,
            `  • Queue init warning: ${queueErr?.message || "unknown error"}`,
          ].join("\n"),
        };
      }
    },
  },
  });

  // Export checkReviewGate for use by other extensions (telegram-bridge merge gate)
  // Since ESM doesn't easily share between extensions, we write a helper module
  // that telegram-bridge can import, OR we rely on the merge gate reading the ledger directly.
  // For now, the merge gate integration will be done inline in telegram-bridge.

  await session.log("pr-review extension loaded — multi-agent code review active");

  // ── Polling Dispatcher — dispatches one queued review per tick ─────────────
  const DISPATCH_INTERVAL_MS = 60_000; // 1 minute between dispatches

  setInterval(async () => {
    try {
      const item = getNextReady();
      if (!item) return; // No items ready — no-op

      // Transition to dispatched
      const ok = markDispatched(item.id);
      if (!ok) return; // Race condition — someone else grabbed it

      // Build cron-style dispatch prompt
      const agentType = item.agent_type;
      const titleLine = item.pr_title ? `\nTitle: ${item.pr_title}` : "";
      const branchLine = item.pr_branch ? `\nBranch: ${item.pr_branch}` : "";

      const dispatchPrompt = [
        `[Review Queue Dispatch — ${item.id}]`,
        ``,
        `@${agentType}`,
        ``,
        `Scheduled review dispatch: PR #${item.pr_number} in ${item.repo}`,
        `HEAD: ${item.head_sha}${titleLine}${branchLine}`,
        `Request ID: ${item.id}`,
        ``,
        `Instructions:`,
        `1. Launch a dedicated review agent via the \`task\` tool with agent_type="${agentType}".`,
        `2. In the agent prompt, include:`,
        `   - Repo: ${item.repo}`,
        `   - PR number: ${item.pr_number}`,
        `   - HEAD SHA: ${item.head_sha}`,
        `   - Request ID: ${item.id}`,
        `3. The review agent MUST call set_review_state({ request_id: "${item.id}", state: "working" }) immediately on start.`,
        `4. After review completion, call set_review_state({ request_id: "${item.id}", state: "completed", result: "approve"|"deny"|"needs_manual_review", review_summary: "..." }).`,
        `5. On failure, call set_review_state({ request_id: "${item.id}", state: "failed", error: "..." }).`,
        `6. Use the review_pr tool to submit findings to {{EMPLOYER_PARENT}}.`,
        ``,
        `IMPORTANT: Each dispatched review MUST get a fresh agent via \`task\` tool — ` +
        `do NOT review inline. This is a critical rule. Let the agent run autonomously.`,
      ].join("\n");

      await session.send({ prompt: dispatchPrompt, mode: "immediate" });
      await session.log(`[review-queue] Dispatched: ${item.id} → ${agentType}`);
    } catch (err) {
      await session.log(`[review-queue] Dispatch tick error: ${err?.message || err}`, { level: "warning" });
    }
  }, DISPATCH_INTERVAL_MS);

  await session.log(`[review-queue] Polling dispatcher active — 1 review/minute max`);
} catch (err) {
  // Log the error to stderr so it shows up in the extension log
  console.error("[pr-review] FATAL: joinSession failed:", err?.message || err);
  console.error("[pr-review] Stack:", err?.stack || "no stack");
  process.exit(1);
}
