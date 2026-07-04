/**
 * Review Queue — Integration Tests
 *
 * Tests the queue infrastructure, state machine, dispatcher logic,
 * and tool handlers without requiring the Copilot runtime.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Override DB_PATH before importing (use test DB)
const TEST_DB_PATH = resolve(__dirname, "test-review-queue.db");

// Clean up any previous test DB
if (existsSync(TEST_DB_PATH)) {
  unlinkSync(TEST_DB_PATH);
}

// Set env BEFORE dynamic import so the module picks it up
process.env.REVIEW_QUEUE_DB_PATH = TEST_DB_PATH;

// Dynamic import so env var is set before module evaluates
const {
  handleRequestReview,
  handleSetReviewState,
  handleGetReviewQueue,
  handleInvalidateReviews,
  handleReviewQueueAdmin,
  handleDispatchReviews,
  runDispatchCycle,
  getQueueStatusForPr,
  getDatabase,
  closeDb,
} = await import("./review-queue.mjs");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL: ${message}`);
  }
}

function parseResult(jsonStr) {
  return JSON.parse(jsonStr);
}

// ── Test Suite ──────────────────────────────────────────────────────────────

console.log("\n═══ Review Queue Test Suite ═══\n");

// --- Phase 1: Queue Infrastructure ---
console.log("📦 Phase 1: Queue Infrastructure");

// Test DB initialization
const db = getDatabase();
assert(db !== null, "Database initialized successfully");

// Check tables exist
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const tableNames = tables.map(t => t.name);
assert(tableNames.includes("review_requests"), "review_requests table exists");
assert(tableNames.includes("dispatcher_config"), "dispatcher_config table exists");
assert(tableNames.includes("per_type_limits"), "per_type_limits table exists");
assert(tableNames.includes("dispatch_metrics"), "dispatch_metrics table exists");

// Check defaults were inserted
const globalMax = db.prepare("SELECT value FROM dispatcher_config WHERE key = 'global_max_concurrent'").get();
assert(globalMax?.value === "6", "Default global_max_concurrent = 6");

// --- Phase 2: Tools ---
console.log("\n🔧 Phase 2: Tool Handlers");

// Test request_review
console.log("\n  request_review:");
const reqResult = parseResult(handleRequestReview({
  repo: "{{GITHUB_USERNAME}}/taller-mecanico",
  pr_number: 42,
  agent_types: ["taller-mecanico-senior-dev", "taller-mecanico-ui-tester"],
  head_sha: "abc1234567890",
  priority: 0,
  pr_title: "feat: add inventory module",
  pr_branch: "feature/inventory",
}));
assert(reqResult.status === "queued", "request_review returns queued status");
assert(reqResult.created.length === 2, "Created 2 review requests");
assert(reqResult.created[0].includes("taller-mecanico-senior-dev"), "First request is senior-dev");

// Test idempotency
const reqResult2 = parseResult(handleRequestReview({
  repo: "{{GITHUB_USERNAME}}/taller-mecanico",
  pr_number: 42,
  agent_types: ["taller-mecanico-senior-dev"],
  head_sha: "abc1234567890",
}));
assert(reqResult2.skipped.length === 1, "Duplicate request is skipped (idempotent)");

// Test validation
const reqBad = parseResult(handleRequestReview({ repo: "{{GITHUB_USERNAME}}/test" }));
assert(reqBad.error?.includes("pr_number"), "Missing pr_number returns error");

// Test get_review_queue
console.log("\n  get_review_queue:");
const queueResult = parseResult(handleGetReviewQueue({}));
assert(queueResult.requests.length === 2, "Queue has 2 pending requests");
assert(queueResult.stats.requested === 2, "Stats show 2 requested");
assert(queueResult.available_slots === 6, "6 slots available (none active)");

// Filter by repo
const filteredResult = parseResult(handleGetReviewQueue({ repo: "{{GITHUB_USERNAME}}/taller-mecanico" }));
assert(filteredResult.requests.length === 2, "Filter by repo returns correct count");

// Filter by agent_type
const typeResult = parseResult(handleGetReviewQueue({ agent_type: "taller-mecanico-senior-dev" }));
assert(typeResult.requests.length === 1, "Filter by agent_type works");

// Test set_review_state
console.log("\n  set_review_state:");

// First, simulate dispatcher marking as dispatched
const requestId = reqResult.created[0];
db.prepare("UPDATE review_requests SET state = 'dispatched', dispatched_at = ? WHERE id = ?")
  .run(new Date().toISOString(), requestId);

// Transition to working
const workResult = parseResult(handleSetReviewState({ request_id: requestId, state: "working" }));
assert(workResult.status === "updated", "Transition dispatched→working succeeds");
assert(workResult.new_state === "working", "New state is working");

// Transition to completed
const completeResult = parseResult(handleSetReviewState({
  request_id: requestId,
  state: "completed",
  result: "approved",
  review_summary: "All checks pass. Architecture is sound.",
}));
assert(completeResult.status === "updated", "Transition working→completed succeeds");
assert(completeResult.result === "approved", "Result is approved");

// Test invalid transition
const secondRequest = reqResult.created[1];
const invalidTransition = parseResult(handleSetReviewState({
  request_id: secondRequest,
  state: "completed", // can't go from requested→completed
}));
assert(invalidTransition.error?.includes("Invalid transition"), "Invalid transition is rejected");

// Test completed without result
db.prepare("UPDATE review_requests SET state = 'dispatched', dispatched_at = ? WHERE id = ?")
  .run(new Date().toISOString(), secondRequest);
const noResult = parseResult(handleSetReviewState({
  request_id: secondRequest,
  state: "working",
}));
assert(noResult.status === "updated", "dispatched→working for second request");

const noResultComplete = parseResult(handleSetReviewState({
  request_id: secondRequest,
  state: "completed",
  // missing result
}));
assert(noResultComplete.error?.includes("result"), "Completed without result returns error");

// Test failed + retry
const failResult = parseResult(handleSetReviewState({
  request_id: secondRequest,
  state: "failed",
  error: "Agent crashed",
}));
assert(failResult.status === "retrying", "Failed with retries available triggers retry");
assert(failResult.retry_count === 1, "Retry count incremented");

// Check it went back to requested
const retried = db.prepare("SELECT state, retry_count FROM review_requests WHERE id = ?").get(secondRequest);
assert(retried.state === "requested", "After retry, state is requested");
assert(retried.retry_count === 1, "Retry count is 1");

// --- Phase 3: State Machine Validation ---
console.log("\n🔄 Phase 3: State Machine");

// Test stale detection
const staleId = "{{GITHUB_USERNAME}}/test#99#stale-agent#deadbeef";
db.prepare(`
  INSERT INTO review_requests (id, repo, pr_number, agent_type, state, priority, requested_at, head_sha, retry_count, max_retries)
  VALUES (?, '{{GITHUB_USERNAME}}/test', 99, 'stale-agent', 'invalidated', 0, ?, 'deadbeef12345678', 0, 2)
`).run(staleId, new Date().toISOString());

const staleResult = parseResult(handleSetReviewState({ request_id: staleId, state: "working" }));
assert(staleResult.stale === true, "Stale detection works — invalidated request returns stale:true");

// --- Phase 4: Invalidation ---
console.log("\n🚫 Phase 4: Invalidation");

// Create some requests for a PR at an old SHA
handleRequestReview({
  repo: "{{GITHUB_USERNAME}}/surgiquip",
  pr_number: 60,
  agent_types: ["surgiquip-senior-dev", "surgiquip-seo"],
  head_sha: "oldsha1234567890",
  pr_title: "fix: broken layout",
});

// Mark one as working (simulate active review)
const surgiquipSrDev = "{{GITHUB_USERNAME}}/surgiquip#60#surgiquip-senior-dev#oldsha12";
db.prepare("UPDATE review_requests SET state = 'dispatched', dispatched_at = ? WHERE id = ?")
  .run(new Date().toISOString(), surgiquipSrDev);
db.prepare("UPDATE review_requests SET state = 'working', working_at = ? WHERE id = ?")
  .run(new Date().toISOString(), surgiquipSrDev);

// Now invalidate with new SHA
const invalidateResult = parseResult(handleInvalidateReviews({
  repo: "{{GITHUB_USERNAME}}/surgiquip",
  pr_number: 60,
  new_head_sha: "newsha9876543210",
  re_request: true,
}));
assert(invalidateResult.status === "invalidated", "Invalidation succeeds");
assert(invalidateResult.invalidated.length === 2, "Both requests invalidated (working + requested)");
assert(invalidateResult.new_requests.length === 2, "New requests auto-created for same agents");

// Verify the old requests are invalidated
const oldReq = db.prepare("SELECT state FROM review_requests WHERE id = ?").get(surgiquipSrDev);
assert(oldReq.state === "invalidated", "Working request marked as invalidated");

// --- Phase 5: Dispatcher ---
console.log("\n⚡ Phase 5: Dispatcher");

// Reset state — create fresh requests for dispatch test
db.prepare("DELETE FROM review_requests").run();
db.prepare("DELETE FROM dispatch_metrics").run();

// Create 3 requests
handleRequestReview({
  repo: "{{GITHUB_USERNAME}}/taller-mecanico",
  pr_number: 100,
  agent_types: ["taller-mecanico-senior-dev", "taller-mecanico-ui-tester"],
  head_sha: "dispatchsha12345",
  priority: 0,
});
handleRequestReview({
  repo: "{{GITHUB_USERNAME}}/surgiquip",
  pr_number: 70,
  agent_types: ["surgiquip-senior-dev"],
  head_sha: "surgisha12345678",
  priority: 1, // High priority
});

// Run dispatch cycle
const dispatchResult = runDispatchCycle();
assert(dispatchResult.status === "cycle_complete", "Dispatch cycle completes");
assert(dispatchResult.actions.length === 3, "3 requests dispatched");

// Verify priority ordering: high priority first
const firstDispatched = dispatchResult.actions[0];
assert(firstDispatched.priority === 1, "High-priority request dispatched first");
assert(firstDispatched.agent_type === "surgiquip-senior-dev", "Surgiquip senior-dev dispatched first (priority 1)");

// Verify all moved to dispatched state
const dispatchedCount = db.prepare("SELECT COUNT(*) as cnt FROM review_requests WHERE state = 'dispatched'").get().cnt;
assert(dispatchedCount === 3, "All 3 requests now in dispatched state");

// Test per-type limits
db.prepare("INSERT OR REPLACE INTO per_type_limits (agent_type, max_concurrent) VALUES ('test-agent', 1)").run();
db.prepare("DELETE FROM review_requests").run();

handleRequestReview({ repo: "{{GITHUB_USERNAME}}/test", pr_number: 1, agent_types: ["test-agent"], head_sha: "sha1111111111" });
handleRequestReview({ repo: "{{GITHUB_USERNAME}}/test", pr_number: 2, agent_types: ["test-agent"], head_sha: "sha2222222222" });

const limitResult = runDispatchCycle();
const testAgentDispatched = limitResult.actions.filter(a => a.type === "dispatched" && a.agent_type === "test-agent");
assert(testAgentDispatched.length === 1, "Per-type limit (1) respected — only 1 dispatched");

// Test paused dispatcher
const pauseResult = parseResult(handleReviewQueueAdmin({ action: "pause" }));
assert(pauseResult.status === "paused", "Dispatcher paused");

const pausedCycle = runDispatchCycle();
assert(pausedCycle.status === "paused", "Dispatch cycle skipped when paused");

// Resume
handleReviewQueueAdmin({ action: "resume" });

// --- Phase 6: Admin Tools ---
console.log("\n🔑 Phase 6: Admin Tools");

// Metrics
const metricsResult = parseResult(handleReviewQueueAdmin({ action: "metrics" }));
assert(metricsResult.status === "ok", "Metrics returns ok");
assert(typeof metricsResult.active_count === "number", "Metrics includes active_count");
assert(metricsResult.config.global_max_concurrent === 6, "Metrics shows config");

// Reprioritize
const repriId = db.prepare("SELECT id FROM review_requests WHERE state = 'requested' LIMIT 1").get()?.id;
if (repriId) {
  const repriResult = parseResult(handleReviewQueueAdmin({ action: "reprioritize", request_id: repriId, priority: 2 }));
  assert(repriResult.status === "reprioritized", "Reprioritize works");
  assert(repriResult.new_priority === 2, "New priority is 2");
}

// Set config
const configResult = parseResult(handleReviewQueueAdmin({
  action: "set_config",
  setting_key: "global_max_concurrent",
  setting_value: "8",
}));
assert(configResult.status === "updated", "Config update works");

// Verify
const newConfig = db.prepare("SELECT value FROM dispatcher_config WHERE key = 'global_max_concurrent'").get();
assert(newConfig.value === "8", "global_max_concurrent updated to 8");

// Set type limit
const typeLimitResult = parseResult(handleReviewQueueAdmin({
  action: "set_type_limit",
  agent_type: "senior-dev",
  max_concurrent: 3,
}));
assert(typeLimitResult.status === "updated", "Set type limit works");

// --- Phase 7: Merge Gate Integration ---
console.log("\n🔒 Phase 7: Merge Gate Integration");

db.prepare("DELETE FROM review_requests").run();
handleRequestReview({
  repo: "{{GITHUB_USERNAME}}/taller-mecanico",
  pr_number: 200,
  agent_types: ["taller-mecanico-senior-dev"],
  head_sha: "mergesha12345678",
});

const mergeStatus = getQueueStatusForPr("{{GITHUB_USERNAME}}/taller-mecanico", 200, "mergesha12345678");
assert(mergeStatus.has_active === true, "Queue status shows active reviews for PR");
assert(mergeStatus.in_queue === true, "in_queue = true when requests pending");

// Complete the review
const mergeReqId = "{{GITHUB_USERNAME}}/taller-mecanico#200#taller-mecanico-senior-dev#mergesha";
db.prepare("UPDATE review_requests SET state = 'dispatched', dispatched_at = ? WHERE id = ?")
  .run(new Date().toISOString(), mergeReqId);
handleSetReviewState({ request_id: mergeReqId, state: "working" });
handleSetReviewState({ request_id: mergeReqId, state: "completed", result: "approved", review_summary: "LGTM" });

const mergeStatus2 = getQueueStatusForPr("{{GITHUB_USERNAME}}/taller-mecanico", 200, "mergesha12345678");
assert(mergeStatus2.has_active === false, "No active reviews after completion");
assert(mergeStatus2.completed_for_sha.length === 1, "1 completed review for this SHA");
assert(mergeStatus2.completed_for_sha[0].result === "approved", "Completed review is approved");

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════");
console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

// Cleanup
closeDb();
if (existsSync(TEST_DB_PATH)) {
  unlinkSync(TEST_DB_PATH);
}

process.exit(failed > 0 ? 1 : 0);
