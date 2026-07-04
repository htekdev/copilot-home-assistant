/**
 * Review Queue — SQLite-backed async review dispatch system
 *
 * Implements:
 * - Queue infrastructure (SQLite schema, state machine)
 * - Tools: request_review, set_review_state, get_review_queue, invalidate_reviews, review_queue_admin
 * - Dispatcher: polling loop with concurrency management
 * - Observability: metrics, stale detection
 *
 * See spec: data/specs/review-queue-v1.md
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const DB_PATH = process.env.REVIEW_QUEUE_DB_PATH || resolve(REPO_ROOT, "data", "review-queue.db");
const CONFIG_PATH = resolve(REPO_ROOT, "data", "review-config.json");

// ── Valid States ────────────────────────────────────────────────────────────

const VALID_STATES = [
  "requested",
  "dispatched",
  "working",
  "completed",
  "failed",
  "invalidated",
  "completed_stale",
];

const VALID_TRANSITIONS = {
  requested: ["dispatched", "invalidated"],
  dispatched: ["working", "failed", "invalidated"],
  working: ["completed", "failed", "invalidated"],
  failed: ["requested"], // retry
  completed: ["completed_stale"], // invalidation of completed
  invalidated: [], // terminal
  completed_stale: [], // terminal
};

const ACTIVE_STATES = ["dispatched", "working"];

// ── Database Initialization ─────────────────────────────────────────────────

let _db = null;

function getDb() {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("busy_timeout = 5000");

  // Create schema
  _db.exec(`
    CREATE TABLE IF NOT EXISTS review_requests (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      agent_type TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'requested',
      priority INTEGER NOT NULL DEFAULT 0,
      requester_session_id TEXT,
      requester_agent_id TEXT,
      requested_at TEXT NOT NULL,
      dispatched_at TEXT,
      working_at TEXT,
      completed_at TEXT,
      result TEXT,
      review_summary TEXT,
      error TEXT,
      pr_title TEXT,
      pr_branch TEXT,
      head_sha TEXT NOT NULL DEFAULT '',
      invalidated_by TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 2,
      dispatched_agent_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_state_priority
      ON review_requests(state, priority DESC, requested_at ASC);

    CREATE INDEX IF NOT EXISTS idx_agent_type_state
      ON review_requests(agent_type, state);

    CREATE INDEX IF NOT EXISTS idx_repo_pr
      ON review_requests(repo, pr_number);

    CREATE INDEX IF NOT EXISTS idx_pr_head
      ON review_requests(repo, pr_number, head_sha);

    CREATE TABLE IF NOT EXISTS dispatcher_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS per_type_limits (
      agent_type TEXT PRIMARY KEY,
      max_concurrent INTEGER NOT NULL DEFAULT 2
    );

    CREATE TABLE IF NOT EXISTS dispatch_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      request_id TEXT,
      agent_type TEXT,
      duration_ms INTEGER,
      metadata TEXT
    );
  `);

  // Insert defaults if not present
  const insertDefault = _db.prepare(
    "INSERT OR IGNORE INTO dispatcher_config (key, value) VALUES (?, ?)"
  );
  insertDefault.run("global_max_concurrent", "6");
  insertDefault.run("default_per_type_max", "2");
  insertDefault.run("poll_interval_ms", "15000");
  insertDefault.run("request_timeout_ms", "600000");
  insertDefault.run("dispatch_timeout_ms", "30000");
  insertDefault.run("paused", "false");

  return _db;
}

// ── Config Helpers ──────────────────────────────────────────────────────────

function getDispatcherConfig() {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM dispatcher_config").all();
  const config = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  return {
    global_max_concurrent: parseInt(config.global_max_concurrent || "6"),
    default_per_type_max: parseInt(config.default_per_type_max || "2"),
    poll_interval_ms: parseInt(config.poll_interval_ms || "15000"),
    request_timeout_ms: parseInt(config.request_timeout_ms || "600000"),
    dispatch_timeout_ms: parseInt(config.dispatch_timeout_ms || "30000"),
    paused: config.paused === "true",
  };
}

function getPerTypeLimits() {
  const db = getDb();
  const rows = db.prepare("SELECT agent_type, max_concurrent FROM per_type_limits").all();
  const limits = {};
  for (const row of rows) {
    limits[row.agent_type] = row.max_concurrent;
  }
  return limits;
}

function loadReviewConfig() {
  try {
    if (!existsSync(CONFIG_PATH)) return { repos: {} };
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return { repos: {} };
  }
}

// ── State Machine ───────────────────────────────────────────────────────────

function validateTransition(fromState, toState) {
  if (!VALID_STATES.includes(toState)) {
    return { valid: false, error: `Invalid state: ${toState}` };
  }
  if (!fromState) {
    // New request — only 'requested' is valid initial state
    if (toState === "requested") return { valid: true };
    return { valid: false, error: `Cannot create request in state: ${toState}` };
  }
  const allowed = VALID_TRANSITIONS[fromState];
  if (!allowed) {
    return { valid: false, error: `Unknown current state: ${fromState}` };
  }
  if (!allowed.includes(toState)) {
    return {
      valid: false,
      error: `Invalid transition: ${fromState} → ${toState}. Allowed: ${allowed.join(", ") || "none (terminal)"}`,
    };
  }
  return { valid: true };
}

// ── Metrics ─────────────────────────────────────────────────────────────────

function logMetric(eventType, requestId, agentType, durationMs, metadata) {
  const db = getDb();
  db.prepare(
    `INSERT INTO dispatch_metrics (timestamp, event_type, request_id, agent_type, duration_ms, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    new Date().toISOString(),
    eventType,
    requestId || null,
    agentType || null,
    durationMs || null,
    metadata ? JSON.stringify(metadata) : null
  );
}

// ── Tool: request_review ────────────────────────────────────────────────────

export function handleRequestReview(args) {
  const { repo, pr_number, agent_types, priority, pr_title, pr_branch, head_sha } = args;

  // Validation
  if (!repo) return JSON.stringify({ error: "'repo' is required (owner/repo format)." });
  if (!pr_number) return JSON.stringify({ error: "'pr_number' is required." });
  if (!head_sha) return JSON.stringify({ error: "'head_sha' is required — pass the current PR HEAD SHA." });
  if (!agent_types || !Array.isArray(agent_types) || agent_types.length === 0) {
    return JSON.stringify({ error: "'agent_types' must be a non-empty array of reviewer agent type names." });
  }

  const db = getDb();
  const now = new Date().toISOString();
  const createdIds = [];
  const skipped = [];

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO review_requests
      (id, repo, pr_number, agent_type, state, priority, requester_session_id, requester_agent_id,
       requested_at, pr_title, pr_branch, head_sha, retry_count, max_retries)
    VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, 0, 2)
  `);

  // Check for existing active requests
  const existingStmt = db.prepare(`
    SELECT id, state FROM review_requests
    WHERE repo = ? AND pr_number = ? AND agent_type = ? AND head_sha = ?
    AND state NOT IN ('completed', 'failed', 'invalidated', 'completed_stale')
  `);

  for (const agentType of agent_types) {
    const id = `${repo}#${pr_number}#${agentType}#${head_sha.slice(0, 8)}`;

    // Check for existing active request with same SHA
    const existing = existingStmt.get(repo, pr_number, agentType, head_sha);
    if (existing) {
      skipped.push({ id, reason: `Already ${existing.state} for this SHA` });
      continue;
    }

    const result = insertStmt.run(
      id,
      repo,
      pr_number,
      agentType,
      priority || 0,
      args.requester_session_id || null,
      args.requester_agent_id || null,
      now,
      pr_title || null,
      pr_branch || null,
      head_sha
    );

    if (result.changes > 0) {
      createdIds.push(id);
      logMetric("request_created", id, agentType, null, { repo, pr_number, priority: priority || 0 });
    } else {
      skipped.push({ id, reason: "Duplicate (same id already exists)" });
    }
  }

  return JSON.stringify({
    status: "queued",
    created: createdIds,
    skipped,
    total_pending: db.prepare("SELECT COUNT(*) as cnt FROM review_requests WHERE state = 'requested'").get().cnt,
    _dispatch_hint: createdIds.length > 0
      ? "Call dispatch_reviews to immediately process queued requests (or wait for next dispatch cycle)."
      : undefined,
  });
}

// ── Tool: set_review_state ──────────────────────────────────────────────────

export function handleSetReviewState(args) {
  const { request_id, state, result, review_summary, error } = args;

  if (!request_id) return JSON.stringify({ error: "'request_id' is required." });
  if (!state) return JSON.stringify({ error: "'state' is required." });

  const db = getDb();
  const request = db.prepare("SELECT * FROM review_requests WHERE id = ?").get(request_id);

  if (!request) {
    return JSON.stringify({ error: `Request not found: ${request_id}` });
  }

  // Check if invalidated (stale detection)
  if (request.state === "invalidated") {
    return JSON.stringify({
      stale: true,
      message: "Review invalidated — new commit pushed. Abort your review.",
      request_id,
      invalidated_by: request.invalidated_by,
    });
  }

  // Validate state transition
  const transition = validateTransition(request.state, state);
  if (!transition.valid) {
    return JSON.stringify({ error: transition.error, current_state: request.state, requested_state: state });
  }

  // Validate result for completed state
  if (state === "completed") {
    if (!result || !["approved", "changes_requested", "commented"].includes(result)) {
      return JSON.stringify({ error: "'result' is required for completed state. Must be: approved, changes_requested, or commented." });
    }
  }

  const now = new Date().toISOString();
  let updateFields = "state = ?";
  let params = [state];

  if (state === "working") {
    updateFields += ", working_at = ?";
    params.push(now);
  } else if (state === "completed") {
    updateFields += ", completed_at = ?, result = ?, review_summary = ?";
    params.push(now, result, review_summary || null);
  } else if (state === "failed") {
    updateFields += ", error = ?";
    params.push(error || "Unknown error");
  }

  params.push(request_id);
  db.prepare(`UPDATE review_requests SET ${updateFields} WHERE id = ?`).run(...params);

  // Handle retry logic for failed state
  if (state === "failed" && request.retry_count < request.max_retries) {
    db.prepare(`
      UPDATE review_requests SET state = 'requested', retry_count = retry_count + 1, error = ?, dispatched_at = NULL, working_at = NULL, dispatched_agent_id = NULL
      WHERE id = ?
    `).run(error || "Retrying after failure", request_id);

    logMetric("retry_queued", request_id, request.agent_type, null, { retry_count: request.retry_count + 1 });

    return JSON.stringify({
      status: "retrying",
      request_id,
      retry_count: request.retry_count + 1,
      max_retries: request.max_retries,
    });
  }

  // Log metric
  if (state === "completed") {
    const durationMs = request.dispatched_at
      ? new Date(now).getTime() - new Date(request.dispatched_at).getTime()
      : null;
    logMetric("review_completed", request_id, request.agent_type, durationMs, { result, review_summary });
  } else if (state === "failed") {
    logMetric("review_failed_permanent", request_id, request.agent_type, null, { error, retry_count: request.retry_count });
  }

  return JSON.stringify({
    status: "updated",
    request_id,
    new_state: state,
    result: result || undefined,
  });
}

// ── Tool: get_review_queue ──────────────────────────────────────────────────

export function handleGetReviewQueue(args) {
  const { agent_type, state, repo, pr_number, limit } = args || {};

  const db = getDb();
  let query = "SELECT * FROM review_requests WHERE 1=1";
  const params = [];

  if (agent_type) {
    query += " AND agent_type = ?";
    params.push(agent_type);
  }
  if (state) {
    query += " AND state = ?";
    params.push(state);
  }
  if (repo) {
    query += " AND repo = ?";
    params.push(repo);
  }
  if (pr_number) {
    query += " AND pr_number = ?";
    params.push(pr_number);
  }

  query += " ORDER BY priority DESC, requested_at ASC LIMIT ?";
  params.push(limit || 20);

  const requests = db.prepare(query).all(...params);

  // Summary stats
  const stats = db.prepare(`
    SELECT state, COUNT(*) as cnt FROM review_requests GROUP BY state
  `).all();

  const activeCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM review_requests WHERE state IN ('dispatched', 'working')
  `).get().cnt;

  const config = getDispatcherConfig();

  return JSON.stringify({
    requests,
    stats: Object.fromEntries(stats.map(s => [s.state, s.cnt])),
    active_count: activeCount,
    global_max: config.global_max_concurrent,
    available_slots: Math.max(0, config.global_max_concurrent - activeCount),
    dispatcher_paused: config.paused,
  });
}

// ── Tool: invalidate_reviews ────────────────────────────────────────────────

export function handleInvalidateReviews(args) {
  const { repo, pr_number, new_head_sha, re_request } = args;

  if (!repo) return JSON.stringify({ error: "'repo' is required." });
  if (!pr_number) return JSON.stringify({ error: "'pr_number' is required." });
  if (!new_head_sha) return JSON.stringify({ error: "'new_head_sha' is required." });

  const db = getDb();
  const now = new Date().toISOString();

  // Find all non-terminal requests for this PR that target a different SHA
  const staleRequests = db.prepare(`
    SELECT * FROM review_requests
    WHERE repo = ? AND pr_number = ? AND head_sha != ?
    AND state NOT IN ('invalidated', 'completed_stale')
  `).all(repo, pr_number, new_head_sha);

  if (staleRequests.length === 0) {
    return JSON.stringify({ status: "no_stale_reviews", repo, pr_number, new_head_sha });
  }

  const invalidated = [];
  const markedStale = [];

  for (const req of staleRequests) {
    if (req.state === "completed") {
      // Completed reviews become completed_stale
      db.prepare(`
        UPDATE review_requests SET state = 'completed_stale', invalidated_by = ? WHERE id = ?
      `).run(new_head_sha, req.id);
      markedStale.push(req.id);
    } else {
      // Pending/active reviews become invalidated
      db.prepare(`
        UPDATE review_requests SET state = 'invalidated', invalidated_by = ? WHERE id = ?
      `).run(new_head_sha, req.id);
      invalidated.push(req.id);
    }
  }

  // Auto-create new requests for the same agent types at new HEAD
  const newRequests = [];
  if (re_request !== false) {
    const agentTypes = [...new Set(staleRequests.map(r => r.agent_type))];
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO review_requests
        (id, repo, pr_number, agent_type, state, priority, requester_session_id, requester_agent_id,
         requested_at, pr_title, pr_branch, head_sha, retry_count, max_retries)
      VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, 0, 2)
    `);

    for (const agentType of agentTypes) {
      // Use the most recent request's metadata
      const latest = staleRequests.find(r => r.agent_type === agentType);
      const newId = `${repo}#${pr_number}#${agentType}#${new_head_sha.slice(0, 8)}`;

      const result = insertStmt.run(
        newId,
        repo,
        pr_number,
        agentType,
        latest?.priority || 0,
        latest?.requester_session_id || null,
        latest?.requester_agent_id || null,
        now,
        latest?.pr_title || null,
        latest?.pr_branch || null,
        new_head_sha
      );

      if (result.changes > 0) {
        newRequests.push(newId);
      }
    }
  }

  logMetric("invalidation", null, null, null, {
    repo,
    pr_number,
    new_head_sha,
    invalidated_count: invalidated.length,
    stale_count: markedStale.length,
    re_requested: newRequests.length,
  });

  return JSON.stringify({
    status: "invalidated",
    repo,
    pr_number,
    new_head_sha,
    invalidated,
    marked_stale: markedStale,
    new_requests: newRequests,
  });
}

// ── Tool: review_queue_admin ────────────────────────────────────────────────

export function handleReviewQueueAdmin(args) {
  const { action, request_id, priority, agent_type, max_concurrent, setting_key, setting_value } = args;

  if (!action) return JSON.stringify({ error: "'action' is required." });

  const db = getDb();

  switch (action) {
    case "pause": {
      db.prepare("INSERT OR REPLACE INTO dispatcher_config (key, value) VALUES ('paused', 'true')").run();
      logMetric("dispatcher_paused", null, null, null, null);
      return JSON.stringify({ status: "paused", message: "Dispatcher paused — no new reviews will be dispatched." });
    }

    case "resume": {
      db.prepare("INSERT OR REPLACE INTO dispatcher_config (key, value) VALUES ('paused', 'false')").run();
      logMetric("dispatcher_resumed", null, null, null, null);
      return JSON.stringify({ status: "resumed", message: "Dispatcher resumed — reviews will dispatch on next cycle." });
    }

    case "cancel": {
      if (!request_id) return JSON.stringify({ error: "'request_id' is required for cancel action." });
      const req = db.prepare("SELECT state FROM review_requests WHERE id = ?").get(request_id);
      if (!req) return JSON.stringify({ error: `Request not found: ${request_id}` });
      if (["completed", "invalidated", "completed_stale"].includes(req.state)) {
        return JSON.stringify({ error: `Cannot cancel a ${req.state} request.` });
      }
      db.prepare("UPDATE review_requests SET state = 'invalidated', error = 'Cancelled by admin' WHERE id = ?").run(request_id);
      logMetric("admin_cancel", request_id, null, null, null);
      return JSON.stringify({ status: "cancelled", request_id });
    }

    case "reprioritize": {
      if (!request_id) return JSON.stringify({ error: "'request_id' is required for reprioritize action." });
      if (priority === undefined || priority === null) return JSON.stringify({ error: "'priority' is required for reprioritize action." });
      const req = db.prepare("SELECT state FROM review_requests WHERE id = ?").get(request_id);
      if (!req) return JSON.stringify({ error: `Request not found: ${request_id}` });
      db.prepare("UPDATE review_requests SET priority = ? WHERE id = ?").run(priority, request_id);
      return JSON.stringify({ status: "reprioritized", request_id, new_priority: priority });
    }

    case "set_type_limit": {
      if (!agent_type) return JSON.stringify({ error: "'agent_type' is required for set_type_limit action." });
      if (!max_concurrent) return JSON.stringify({ error: "'max_concurrent' is required for set_type_limit action." });
      db.prepare("INSERT OR REPLACE INTO per_type_limits (agent_type, max_concurrent) VALUES (?, ?)").run(agent_type, max_concurrent);
      return JSON.stringify({ status: "updated", agent_type, max_concurrent });
    }

    case "set_config": {
      if (!setting_key) return JSON.stringify({ error: "'setting_key' is required for set_config action." });
      if (!setting_value) return JSON.stringify({ error: "'setting_value' is required for set_config action." });
      const validKeys = ["global_max_concurrent", "default_per_type_max", "poll_interval_ms", "request_timeout_ms", "dispatch_timeout_ms"];
      if (!validKeys.includes(setting_key)) {
        return JSON.stringify({ error: `Invalid setting_key. Valid keys: ${validKeys.join(", ")}` });
      }
      db.prepare("INSERT OR REPLACE INTO dispatcher_config (key, value) VALUES (?, ?)").run(setting_key, setting_value);
      return JSON.stringify({ status: "updated", key: setting_key, value: setting_value });
    }

    case "metrics": {
      const config = getDispatcherConfig();
      const stats = db.prepare("SELECT state, COUNT(*) as cnt FROM review_requests GROUP BY state").all();
      const activeCount = db.prepare("SELECT COUNT(*) as cnt FROM review_requests WHERE state IN ('dispatched', 'working')").get().cnt;

      // Average completion time (last 24h)
      const avgDuration = db.prepare(`
        SELECT AVG(duration_ms) as avg_ms, COUNT(*) as cnt
        FROM dispatch_metrics
        WHERE event_type = 'review_completed'
        AND timestamp > datetime('now', '-24 hours')
      `).get();

      // Throughput (last 24h)
      const throughput = db.prepare(`
        SELECT COUNT(*) as cnt FROM dispatch_metrics
        WHERE event_type = 'review_completed'
        AND timestamp > datetime('now', '-24 hours')
      `).get();

      // Failures (last 24h)
      const failures = db.prepare(`
        SELECT COUNT(*) as cnt FROM dispatch_metrics
        WHERE event_type = 'review_failed_permanent'
        AND timestamp > datetime('now', '-24 hours')
      `).get();

      // Oldest pending request
      const oldestPending = db.prepare(`
        SELECT id, repo, pr_number, agent_type, requested_at
        FROM review_requests WHERE state = 'requested'
        ORDER BY requested_at ASC LIMIT 1
      `).get();

      return JSON.stringify({
        status: "ok",
        config,
        queue_stats: Object.fromEntries(stats.map(s => [s.state, s.cnt])),
        active_count: activeCount,
        available_slots: Math.max(0, config.global_max_concurrent - activeCount),
        last_24h: {
          completed: throughput.cnt,
          avg_duration_ms: avgDuration.avg_ms ? Math.round(avgDuration.avg_ms) : null,
          failures: failures.cnt,
        },
        oldest_pending: oldestPending || null,
        per_type_limits: getPerTypeLimits(),
      });
    }

    case "flush_completed": {
      // Remove completed/invalidated/stale entries older than 7 days
      const result = db.prepare(`
        DELETE FROM review_requests
        WHERE state IN ('completed', 'invalidated', 'completed_stale')
        AND completed_at < datetime('now', '-7 days')
      `).run();
      return JSON.stringify({ status: "flushed", deleted: result.changes });
    }

    case "reset_stale_dispatched": {
      // Reset dispatched items that never progressed to 'working' back to 'requested'
      const timeoutSec = args.timeout_seconds || 300; // default 5 min
      const stale = db.prepare(`
        SELECT id, agent_type, repo, pr_number FROM review_requests
        WHERE state = 'dispatched'
        AND dispatched_at < datetime('now', '-' || ? || ' seconds')
      `).all(timeoutSec.toString());

      if (stale.length === 0) {
        return JSON.stringify({ status: "no_stale", message: "No stale dispatched items found." });
      }

      const resetStmt = db.prepare(`
        UPDATE review_requests
        SET state = 'requested', dispatched_at = NULL, dispatched_agent_id = NULL,
            error = 'Admin reset: stale dispatch'
        WHERE id = ?
      `);

      const resetIds = [];
      for (const item of stale) {
        resetStmt.run(item.id);
        resetIds.push(item.id);
      }

      logMetric("admin_reset_stale", null, null, null, { count: resetIds.length });
      return JSON.stringify({ status: "reset", count: resetIds.length, reset_ids: resetIds });
    }

    default:
      return JSON.stringify({
        error: `Unknown action: ${action}`,
        valid_actions: ["pause", "resume", "cancel", "reprioritize", "set_type_limit", "set_config", "metrics", "flush_completed", "reset_stale_dispatched"],
      });
  }
}

// ── Dispatcher Logic ────────────────────────────────────────────────────────

/**
 * Run one dispatch cycle. Returns actions taken.
 * This is called by the dispatch_reviews tool or by a cron/interval.
 */
export function runDispatchCycle() {
  const db = getDb();
  const config = getDispatcherConfig();

  if (config.paused) {
    return { status: "paused", actions: [] };
  }

  const actions = [];
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Count active reviews
  const activeCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM review_requests WHERE state IN ('dispatched', 'working')
  `).get().cnt;

  if (activeCount >= config.global_max_concurrent) {
    actions.push({ type: "at_capacity", active: activeCount, max: config.global_max_concurrent });
    // Still check for stale items below
  } else {
    // 2. Get per-type active counts
    const perTypeActive = db.prepare(`
      SELECT agent_type, COUNT(*) as cnt FROM review_requests
      WHERE state IN ('dispatched', 'working')
      GROUP BY agent_type
    `).all();
    const typeActiveCounts = Object.fromEntries(perTypeActive.map(r => [r.agent_type, r.cnt]));

    const perTypeLimits = getPerTypeLimits();
    let slotsAvailable = config.global_max_concurrent - activeCount;

    // 3. Find pending requests ordered by priority DESC, requested_at ASC
    const pendingRequests = db.prepare(`
      SELECT * FROM review_requests
      WHERE state = 'requested'
      ORDER BY priority DESC, requested_at ASC
    `).all();

    for (const req of pendingRequests) {
      if (slotsAvailable <= 0) break;

      // Check per-type limit
      const typeActive = typeActiveCounts[req.agent_type] || 0;
      const typeMax = perTypeLimits[req.agent_type] || config.default_per_type_max;

      if (typeActive >= typeMax) {
        continue; // Skip — this type is at capacity
      }

      // Mark as dispatched
      db.prepare(`
        UPDATE review_requests SET state = 'dispatched', dispatched_at = ? WHERE id = ?
      `).run(nowIso, req.id);

      actions.push({
        type: "dispatched",
        request_id: req.id,
        repo: req.repo,
        pr_number: req.pr_number,
        agent_type: req.agent_type,
        priority: req.priority,
      });

      // Update counts
      typeActiveCounts[req.agent_type] = typeActive + 1;
      slotsAvailable--;

      logMetric("dispatched", req.id, req.agent_type, null, { repo: req.repo, pr_number: req.pr_number });
    }
  }

  // 4. Check for stale Dispatched (no Working transition within dispatch_timeout)
  const staleDispatched = db.prepare(`
    SELECT * FROM review_requests
    WHERE state = 'dispatched'
    AND dispatched_at < datetime('now', '-' || ? || ' seconds')
  `).all(Math.floor(config.dispatch_timeout_ms / 1000).toString());

  for (const req of staleDispatched) {
    if (req.retry_count < req.max_retries) {
      db.prepare(`
        UPDATE review_requests
        SET state = 'requested', retry_count = retry_count + 1,
            error = 'Dispatch timeout — never started working', dispatched_at = NULL, dispatched_agent_id = NULL
        WHERE id = ?
      `).run(req.id);
      actions.push({ type: "retry_dispatch_timeout", request_id: req.id, retry_count: req.retry_count + 1 });
    } else {
      db.prepare(`
        UPDATE review_requests SET state = 'failed', error = 'Dispatch timeout after max retries' WHERE id = ?
      `).run(req.id);
      actions.push({ type: "failed_dispatch_timeout", request_id: req.id });
      logMetric("review_failed_permanent", req.id, req.agent_type, null, { reason: "dispatch_timeout" });
    }
  }

  // 5. Check for stale Working (no completion within request_timeout)
  const staleWorking = db.prepare(`
    SELECT * FROM review_requests
    WHERE state = 'working'
    AND working_at < datetime('now', '-' || ? || ' seconds')
  `).all(Math.floor(config.request_timeout_ms / 1000).toString());

  for (const req of staleWorking) {
    if (req.retry_count < req.max_retries) {
      db.prepare(`
        UPDATE review_requests
        SET state = 'requested', retry_count = retry_count + 1,
            error = 'Working timeout — review took too long', working_at = NULL, dispatched_at = NULL, dispatched_agent_id = NULL
        WHERE id = ?
      `).run(req.id);
      actions.push({ type: "retry_working_timeout", request_id: req.id, retry_count: req.retry_count + 1 });
    } else {
      db.prepare(`
        UPDATE review_requests SET state = 'failed', error = 'Working timeout after max retries' WHERE id = ?
      `).run(req.id);
      actions.push({ type: "failed_working_timeout", request_id: req.id });
      logMetric("review_failed_permanent", req.id, req.agent_type, null, { reason: "working_timeout" });
    }
  }

  return {
    status: "cycle_complete",
    active_count: activeCount,
    actions,
    timestamp: nowIso,
  };
}

// ── PR State Validation ─────────────────────────────────────────────────────

function getGhToken() {
  const envPath = resolve(REPO_ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("GITHUB_TOKEN=") || trimmed.startsWith("GH_TOKEN=")) {
        let val = trimmed.slice(trimmed.indexOf("=") + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        return val;
      }
    }
  }
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
}

/**
 * Check PR state via {{EMPLOYER_PARENT}} API. Returns "open", "closed", or "merged".
 * Returns null on API failure (treat as open to avoid false negatives).
 */
async function fetchPrState(repo, prNumber) {
  const token = getGhToken();
  if (!token) return null;

  try {
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
    if (data.merged_at) return "merged";
    return data.state || null; // "open" or "closed"
  } catch {
    return null; // Network error — don't block dispatch
  }
}

/**
 * Pre-dispatch validation: check all unique pending PRs against {{EMPLOYER_PARENT}} API.
 * Marks closed/merged PRs as failed so they won't get dispatched.
 * Returns count of purged items.
 */
async function purgeClosedPrs() {
  const db = getDb();

  // Get unique repo+pr_number combinations from pending requests
  const pendingPrs = db.prepare(`
    SELECT DISTINCT repo, pr_number FROM review_requests
    WHERE state = 'requested'
  `).all();

  if (pendingPrs.length === 0) return 0;

  let purgedCount = 0;

  // Check each unique PR (batch — max 10 to avoid rate limits)
  const toCheck = pendingPrs.slice(0, 10);

  for (const { repo, pr_number } of toCheck) {
    const state = await fetchPrState(repo, pr_number);

    if (state === "closed" || state === "merged") {
      // Mark all pending requests for this PR as failed
      const result = db.prepare(`
        UPDATE review_requests
        SET state = 'failed', error = ?
        WHERE repo = ? AND pr_number = ? AND state IN ('requested', 'dispatched')
      `).run(
        `PR is ${state.toUpperCase()} — skipped by pre-dispatch validation`,
        repo,
        pr_number
      );
      purgedCount += result.changes;
      logMetric("pr_state_purge", null, null, null, { repo, pr_number, state, purged: result.changes });
    }
  }

  return purgedCount;
}

// ── Tool: dispatch_reviews (manually trigger a cycle) ───────────────────────

/**
 * Generate spawn instructions for each dispatched item.
 * The CALLER is responsible for actually launching these agents via `task` tool.
 */
function buildSpawnInstructions(actions) {
  const dispatched = actions.filter(a => a.type === "dispatched");
  if (dispatched.length === 0) return [];

  return dispatched.map(action => ({
    agent_type: action.agent_type,
    request_id: action.request_id,
    repo: action.repo,
    pr_number: action.pr_number,
    prompt: [
      `You are dispatched by the review queue to review PR #${action.pr_number} in ${action.repo}.`,
      ``,
      `## Review Queue Context`,
      `- Request ID: ${action.request_id}`,
      `- Your role: ${action.agent_type}`,
      ``,
      `## Required Steps`,
      `1. FIRST: Call set_review_state with request_id="${action.request_id}" and state="working"`,
      `2. Review the PR: check out the code, read the diff, analyze for issues per your role`,
      `3. Submit your review via review_pr tool (repo="${action.repo}", pr_number=${action.pr_number})`,
      `4. FINALLY: Call set_review_state with request_id="${action.request_id}" and state="completed" and result="approved" or "changes_requested"`,
      ``,
      `## Important`,
      `- If set_review_state returns { stale: true }, STOP immediately — a new commit invalidated this review`,
      `- Be thorough but focused — complete within 5 minutes`,
      `- DENY if you find real issues (with prescriptive suggested_fix), APPROVE if clean`,
    ].join("\n"),
  }));
}

export async function handleDispatchReviews() {
  // Pre-dispatch: purge any closed/merged PRs from the queue
  let purgedCount = 0;
  try {
    purgedCount = await purgeClosedPrs();
  } catch (err) {
    // Don't block dispatch on purge failure
    logMetric("purge_error", null, null, null, { error: String(err) });
  }

  const result = runDispatchCycle();

  // Build spawn instructions for any dispatched items
  const spawnInstructions = buildSpawnInstructions(result.actions);

  const output = {
    ...result,
    purged_closed_prs: purgedCount > 0 ? purgedCount : undefined,
    spawn_instructions: spawnInstructions,
    _caller_action_required: spawnInstructions.length > 0
      ? `IMPORTANT: You MUST now launch ${spawnInstructions.length} review agent(s) using the task tool. ` +
        `For each item in spawn_instructions, call: task(agent_type=item.agent_type, prompt=item.prompt, name="review-"+item.agent_type+"-pr"+item.pr_number). ` +
        `The reviews will NOT happen unless you spawn these agents.`
      : undefined,
  };

  return JSON.stringify(output);
}

// ── Queue Check for Merge Gate ──────────────────────────────────────────────

/**
 * Check if there are active/pending reviews in the queue for a PR.
 * Used by merge gate to decide if reviews are in-flight.
 */
export function getQueueStatusForPr(repo, prNumber, headSha) {
  const db = getDb();

  const active = db.prepare(`
    SELECT id, agent_type, state, requested_at, head_sha
    FROM review_requests
    WHERE repo = ? AND pr_number = ? AND state IN ('requested', 'dispatched', 'working')
  `).all(repo, prNumber);

  const completed = db.prepare(`
    SELECT id, agent_type, state, result, review_summary, head_sha
    FROM review_requests
    WHERE repo = ? AND pr_number = ? AND state = 'completed' AND head_sha = ?
  `).all(repo, prNumber, headSha || "");

  return {
    has_active: active.length > 0,
    active_reviews: active,
    completed_for_sha: completed,
    in_queue: active.length > 0,
  };
}

// ── Polling Dispatcher Helper ───────────────────────────────────────────────

/**
 * Get the next "requested" review ready for dispatch.
 * Respects concurrency limits (global + per-type).
 * Returns null if nothing is ready or dispatcher is paused.
 */
export function getNextReady() {
  const db = getDb();
  const config = getDispatcherConfig();

  if (config.paused) return null;

  // Check global capacity
  const activeCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM review_requests WHERE state IN ('dispatched', 'working')
  `).get().cnt;

  if (activeCount >= config.global_max_concurrent) return null;

  // Get per-type active counts
  const perTypeActive = db.prepare(`
    SELECT agent_type, COUNT(*) as cnt FROM review_requests
    WHERE state IN ('dispatched', 'working')
    GROUP BY agent_type
  `).all();
  const typeActiveCounts = Object.fromEntries(perTypeActive.map(r => [r.agent_type, r.cnt]));
  const perTypeLimits = getPerTypeLimits();

  // Find first eligible pending request
  const pendingRequests = db.prepare(`
    SELECT * FROM review_requests
    WHERE state = 'requested'
    ORDER BY priority DESC, requested_at ASC
  `).all();

  for (const req of pendingRequests) {
    const typeActive = typeActiveCounts[req.agent_type] || 0;
    const typeMax = perTypeLimits[req.agent_type] || config.default_per_type_max;
    if (typeActive < typeMax) {
      return req;
    }
  }

  return null;
}

/**
 * Transition a review request to 'dispatched' state.
 * Returns true if transition succeeded, false otherwise.
 */
export function markDispatched(requestId) {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const result = db.prepare(`
    UPDATE review_requests SET state = 'dispatched', dispatched_at = ? WHERE id = ? AND state = 'requested'
  `).run(nowIso, requestId);
  if (result.changes > 0) {
    const req = db.prepare("SELECT * FROM review_requests WHERE id = ?").get(requestId);
    logMetric("dispatched", requestId, req?.agent_type, null, { repo: req?.repo, pr_number: req?.pr_number, source: "polling_dispatcher" });
    return true;
  }
  return false;
}

// ── Export DB getter for testing ────────────────────────────────────────────

export function getDatabase() {
  return getDb();
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
