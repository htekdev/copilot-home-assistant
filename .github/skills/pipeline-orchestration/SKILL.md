---
name: pipeline-orchestration
description: Multi-lane pipeline execution pattern with parallel/sequential lanes, retry policies, failure modes, context packages, and coherence correction. Use when user says "pipeline", "multi-lane", "parallel execution", "retry policy", "failure handling", "orchestrate lanes", "pipeline config", "context package", "pipeline run", or any multi-step production workflow with parallel branches.
---

# Pipeline Orchestration Skill

Generalized multi-lane execution pattern for complex production workflows. Extracted from a video pipeline but applicable to any multi-step process with parallel branches, retry logic, and quality gates.

## Core Concepts

| Concept | Definition |
|---------|-----------|
| **Lane** | An independent unit of work in the pipeline (e.g., editing, blog, social) |
| **Sequential prereq** | Lanes that MUST complete before parallel lanes can start |
| **Parallel lanes** | Lanes that execute simultaneously after prereqs complete |
| **Context package** | Shared data artifact that lanes read from and contribute to |
| **Failure policy** | How to handle lane failure (stop, continue partial, per-platform) |
| **Coherence correction** | Post-execution check that all outputs align with the production plan |

## Pipeline Structure

```
[Sequential Prereqs] → [Parallel Lanes] → [Quality Gate] → [Final Output]
     ↓                      ↓                    ↓               ↓
  research              editing              coherence        publish
  planning              blog                 correction       notify
                        social
```

## Configuration Pattern

Every pipeline should define:

```json
{
  "orchestration": {
    "orchestrator": "{agent-name}",
    "lanes": ["research", "planning", "editing", "blog", "social"],
    "parallelLanes": ["editing", "blog", "social"],
    "sequentialPrereqs": ["research", "planning"],
    "runIdFormat": "{prefix}-YYYY-MM-DD-NNN",
    "contextPackagePath": "data/{output-dir}/{run_id}/context-package.json",
    "notifyOnComplete": true,
    "notifyOnPartialSuccess": true
  }
}
```

## Retry & Failure Policies

Each lane defines its own failure behavior:

| Policy | Behavior |
|--------|----------|
| `stop_and_notify` | Halt entire pipeline, notify human. For critical failures. |
| `continue_partial` | Mark lane as partial, allow downstream lanes to proceed with reduced context |
| `partial_success` | Lane failure doesn't block others. Record what succeeded. |
| `per_platform` | Independent retry per sub-target (e.g., per social platform) |
| `non_fatal` | Failure is logged but pipeline continues normally |

### Retry Configuration Pattern

```json
{
  "retry": {
    "{lane_name}": {
      "maxAttempts": 2,
      "failurePolicy": "continue_partial",
      "_behavior": "Human-readable description of what happens on failure"
    }
  }
}
```

## Execution Flow

### Step 1: Initialize Run
1. Generate run ID from format pattern
2. Create output directory
3. Initialize context package (empty or with input data)

### Step 2: Execute Sequential Prerequisites
```
for each prereq in sequentialPrereqs (in order):
  result = execute_lane(prereq)
  if result.failed AND policy == "stop_and_notify":
    HALT pipeline, notify human
    return
  update_context_package(result)
```

### Step 3: Execute Parallel Lanes
```
parallel_results = await Promise.all(
  parallelLanes.map(lane => execute_lane(lane, context_package))
)
for each result in parallel_results:
  if result.failed:
    apply_failure_policy(lane, result)
  update_context_package(result)
```

### Step 4: Coherence Correction (Optional)
After parallel lanes complete, check all outputs align with the production plan:
1. Compare each lane's output against the primary angle/thesis from planning
2. If drift detected → re-invoke drifted lane with correction feedback (max 1 retry)
3. Accept and flag if still drifted after retry

### Step 5: Quality Gate
Before final output:
1. Run quality checks on combined output
2. If FAIL → retry affected lane (up to maxRetries)
3. If still failing → notify human, do NOT proceed to publish

### Step 6: Final Output & Notification
1. Compile final deliverables
2. Execute publish/delivery step
3. Notify stakeholders with success/partial/fail status

## Context Package Pattern

The context package is the shared data artifact between lanes:

```json
{
  "runId": "video-2026-05-06-001",
  "status": "in_progress",
  "createdAt": "2026-05-06T10:00:00-05:00",
  "prerequisites": {
    "research": { "status": "complete", "data": {...} },
    "planning": { "status": "complete", "primaryAngle": "..." }
  },
  "lanes": {
    "editing": { "status": "complete", "outputPath": "..." },
    "blog": { "status": "failed", "error": "..." },
    "social": { "status": "complete", "posts": [...] }
  }
}
```

## Success Model

Define what constitutes success for the pipeline:

| Level | Definition |
|-------|-----------|
| **Full success** | All lanes complete + quality gate passed + published |
| **Partial success** | Core lanes succeeded but auxiliary lanes failed (e.g., blog failed but video published) |
| **Failed** | Critical lane failed and cannot recover (e.g., no usable edit, no coherent plan) |

## Agent Dispatch Pattern

For orchestrating lanes via agents:

```
# Sequential prereq
task(agent_type="{prereq-agent}", prompt="...", name="{run-id}-research")

# Wait for result, then parallel lanes
task(agent_type="{editing-agent}", prompt="...", name="{run-id}-edit")    # parallel
task(agent_type="{blog-agent}", prompt="...", name="{run-id}-blog")       # parallel
task(agent_type="{social-agent}", prompt="...", name="{run-id}-social")   # parallel
```

## Anti-Patterns

- ❌ Running all lanes sequentially when they have no dependencies (wastes time)
- ❌ Blocking all platforms because one failed (use per_platform policy)
- ❌ No retry for transient failures (network, API rate limits)
- ❌ Skipping coherence check and publishing misaligned content
- ❌ No context package — lanes can't access each other's outputs
- ❌ Retrying indefinitely without a max attempt limit
