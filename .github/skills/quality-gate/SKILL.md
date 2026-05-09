---
name: quality-gate
description: Reusable quality review gate pattern with retry logic, failure escalation, and lessons-learned feedback loops. Use when implementing pre-publish quality checks, content validation gates, automated review-and-retry workflows, or any process that needs "check → fix → recheck → escalate" logic. Trigger phrases include "quality check", "quality gate", "review gate", "pre-publish check", "retry on failure", "quality loop".
---

# Quality Gate Skill

A quality gate is a mandatory checkpoint that a deliverable must pass before proceeding to the next pipeline stage. This skill defines the reusable pattern for implementing quality gates with retry logic, failure handling, and continuous improvement.

## Core Pattern

```
CHECK → PASS? → Continue pipeline
         ↓ FAIL
       FIX → RECHECK → PASS? → Continue pipeline
                         ↓ FAIL (retry exhausted)
                       ESCALATE → Notify human, STOP pipeline
```

## Configuration Schema

Every quality gate needs these parameters:

```json
{
  "gate_name": "descriptive-name",
  "enabled": true,
  "max_retries": 2,
  "checks": ["check_1", "check_2", "check_3"],
  "failure_policy": "stop_and_notify | continue_partial | non_fatal",
  "escalation_target": "primary_user",
  "lessons_file": "path/to/lessons-learned.md"
}
```

### Failure Policies

| Policy | Behavior | When to use |
|--------|----------|-------------|
| `stop_and_notify` | Stop the pipeline entirely, notify human | Critical quality (publishing, safety) |
| `continue_partial` | Mark gate as failed, continue pipeline with degraded output | Non-blocking quality (optimization) |
| `non_fatal` | Log the failure, continue as if passed | Informational checks |
| `per_platform` | Independent pass/fail per target (one failure doesn't block others) | Multi-platform publishing |

## Implementation Steps

### Step 1: Define the Checklist

Create a checklist specific to your domain. Each check item must be:
- **Observable** — can be verified programmatically or via AI analysis
- **Actionable** — if it fails, there's a known fix
- **Specific** — "captions visible" not "video looks good"

Example (video quality):
```
checks:
  - captions_visibility: "Captions stay in bottom 25% of frame"
  - face_obstruction: "Speaker's face visible, not blocked by overlays"
  - audio_quality: "No clipping, background noise acceptable"
  - editorial_cuts: "No jump cuts in speech, transitions smooth"
  - duration_sanity: "Output duration ≈ sum of inputs (±2s)"
```

### Step 2: Run the Check

Use the appropriate tool for the domain:
- **Video**: `analyze_video` with a quality review prompt
- **Text/Articles**: Multi-model review (see `multi-model-review` skill)
- **Code**: `task(agent_type="code-review")` 
- **Data**: Schema validation + spot checks

The check tool receives:
1. The deliverable (file path, content, or reference)
2. The checklist items to evaluate
3. Instructions to report PASS or FAIL with specifics

### Step 3: Evaluate Results

Parse the check output for each checklist item:
- **ALL PASS** → Gate passes. Continue pipeline.
- **ANY FAIL** → Attempt fix if retries remain.
- **Parse failure** → Treat as FAIL (defensive).

### Step 4: Fix and Retry

When a check fails:

1. **Log the failure** — what failed, why, what was attempted
2. **Attempt automated fix** based on the specific failure:
   - Caption overflow → reduce font size, increase margin
   - Audio issue → re-process with adjusted threshold
   - Factual error → re-research and rewrite section
   - Code bug → apply the suggested fix from reviewer
3. **Re-run the check** (same tool, same prompt)
4. **Decrement retry counter**

If retry succeeds → continue pipeline.
If retry fails and retries exhausted → escalate.

### Step 5: Escalate on Exhausted Retries

When `max_retries` is exhausted:

1. **DO NOT proceed** with the pipeline (for `stop_and_notify` policy)
2. **Notify the escalation target** via Telegram:
   ```
   ⚠️ Quality gate FAILED: {gate_name}
   
   Deliverable: {file/description}
   Failed checks: {list}
   Retries attempted: {count}
   Last failure: {specific issue}
   
   Action needed: {what human should do}
   ```
3. **Create a task** for the human to resolve manually
4. **Log to lessons-learned file** for future prevention

### Step 6: Update Lessons Learned

After EVERY gate execution (pass or fail), reflect:

**On failure (after fix):**
- What failed? What was the root cause?
- What fix worked? Should this be a new default?
- Should the checklist be updated with a new item?

**On pass:**
- Were there near-misses that should become new checks?
- Are any checks always passing (and thus potentially stale)?

Append new lessons to the `lessons_file` with:
```markdown
### N. Issue Name (Severity: HIGH|MEDIUM|LOW)
- **Problem**: What went wrong
- **Root cause**: Why it happened
- **Fix**: How to prevent/fix it
- **Review check**: What to verify in future runs
- **Date learned**: YYYY-MM-DD
```

## Domain-Specific Gates

### Video Publishing Gate

```json
{
  "gate_name": "video-quality-review",
  "enabled": true,
  "max_retries": 2,
  "checks": ["captions_visibility", "face_obstruction", "audio_quality", "editorial_cuts", "framing"],
  "failure_policy": "stop_and_notify",
  "escalation_target": "primary_user",
  "lessons_file": "data/content/video-pipeline/quality-checklist.md",
  "tool": "analyze_video",
  "prompt_template": "Review this edited video for publishing quality. Check specifically for: [checklist items]. Report PASS or FAIL with specific issues found."
}
```

### Blog Article Gate

```json
{
  "gate_name": "article-quality-review",
  "enabled": true,
  "max_retries": 1,
  "checks": ["factual_accuracy", "source_quality", "writing_voice", "structure", "technical_accuracy"],
  "failure_policy": "stop_and_notify",
  "escalation_target": "primary_user",
  "lessons_file": "data/agents/blog-writer/long-term.md",
  "tool": "multi-model-review (see skill)",
  "models": ["claude-opus-4.6", "gpt-5.2-codex"]
}
```

### Code Change Gate

```json
{
  "gate_name": "code-review-gate",
  "enabled": true,
  "max_retries": 1,
  "checks": ["spec_compliance", "bugs", "security", "regressions", "quality"],
  "failure_policy": "stop_and_notify",
  "escalation_target": "primary_user",
  "lessons_file": null,
  "tool": "task(agent_type='code-review')",
  "models": ["claude-sonnet-4", "gpt-5.2", "claude-opus-4.6"]
}
```

### Social Media Publishing Gate

```json
{
  "gate_name": "brand-safety-check",
  "enabled": true,
  "max_retries": 1,
  "checks": ["brand_protection", "competitor_framing", "factual_claims", "hashtag_compliance"],
  "failure_policy": "stop_and_notify",
  "escalation_target": "primary_user",
  "lessons_file": null,
  "tool": "inline AI review against copilot-brand-safety skill"
}
```

## Pipeline Integration

Quality gates integrate into larger pipelines at defined checkpoints:

```
Stage 1 → Stage 2 → [QUALITY GATE] → Stage 3 → Stage 4 → [QUALITY GATE] → Publish
```

### Placement rules
- Place gates AFTER the main transformation but BEFORE irreversible actions
- Video: after caption burn, before publish (can re-burn but can't un-publish)
- Articles: after writing, before PR creation (can revise but PR creation triggers notifications)
- Code: after implementation, before merge (can fix but merge is hard to undo)

### Gate ordering (when multiple gates exist)
- Cheapest/fastest gates first (font size check before full AI analysis)
- Most likely to fail first (reduces wasted work on subsequent checks)
- Safety gates last (final backstop before release)

## Retry Strategy

### Exponential backoff (for API/transient failures)
- Retry 1: immediate
- Retry 2: 5 second wait
- Retry 3: 30 second wait (if max_retries > 2)

### Fix-and-retry (for quality failures)
- Retry 1: Apply automated fix based on failure specifics
- Retry 2: Apply aggressive fix (larger margins, stricter settings)
- No retry 3 — if 2 fixes don't work, the issue needs human judgment

### Per-platform retry (for multi-target publishing)
- Each platform is independent
- One platform failure does NOT block others
- Track per-platform success/failure separately
- Retry failed platforms up to max_retries independently

## Anti-Patterns

- ❌ Skipping quality gates "because it's just a quick change"
- ❌ Setting `max_retries` > 3 (infinite retry loops waste time — escalate)
- ❌ Auto-fixing without re-checking (fix might introduce new issues)
- ❌ Publishing despite gate failure (defeats the purpose)
- ❌ Not updating lessons-learned after incidents (doomed to repeat)
- ❌ Quality checks that always pass (stale/too lenient — tighten or remove)
- ❌ Gates without clear escalation path (who gets notified? what do they do?)
- ❌ Using `non_fatal` policy for safety-critical gates
