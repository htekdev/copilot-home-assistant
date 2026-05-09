---
name: multi-model-review
description: Parallel multi-model quality review pattern — launch diverse AI reviewers simultaneously, collect findings, deduplicate, and fix. Use when reviewing articles, code, specs, proposals, or any deliverable that needs quality assurance. Trigger phrases include "dual review", "multi-model review", "parallel review", "quality review", "cross-model check", "review with multiple models".
---

# Multi-Model Review Skill

The multi-model review pattern ensures quality by running the same deliverable through multiple AI models in parallel, collecting independent findings, and resolving them systematically. This eliminates single-model blind spots and catches hallucinations, factual errors, and quality issues.

## When to Use

| Scenario | Minimum Models | Recommended |
|----------|---------------|-------------|
| Blog or newsletter articles | 2 | Claude Opus + GPT Codex |
| Tier 3 code changes | 3 | Claude Sonnet + GPT 5.2 + Claude Opus |
| Tier 4 safety-critical changes | 4 | 3 standard + 1 safety-focused |
| Client proposals | 2 | Any 2 diverse models |
| Agent/skill definitions | 2 | Claude Opus + GPT 5.4 |

## Core Pattern

### Step 1: Prepare the Review Prompt

Write a **single review prompt** that clearly specifies:
- What the deliverable IS (article, code, spec, proposal)
- What to review FOR (accuracy, quality, safety, compliance, style)
- What format to report in (severity levels, location, issue, fix)
- Context needed (spec reference, style guide, brand rules)

### Step 2: Launch Reviews in Parallel

**CRITICAL**: All review agents must be launched SIMULTANEOUSLY via the `task` tool. Never run them sequentially — that wastes time and provides no independence benefit.

```
# Launch ALL at the same time in a single response:

task(
  agent_type: "general-purpose",
  model: "claude-opus-4.6",
  name: "review-opus",
  prompt: "[REVIEW PROMPT + FULL DELIVERABLE]"
)

task(
  agent_type: "general-purpose", 
  model: "gpt-5.2-codex",
  name: "review-codex",
  prompt: "[SAME REVIEW PROMPT + FULL DELIVERABLE]"
)

# Optional 3rd reviewer for Tier 3+:
task(
  agent_type: "code-review",
  model: "claude-sonnet-4",
  name: "review-sonnet",
  prompt: "[SAME REVIEW PROMPT + FULL DELIVERABLE]"
)
```

### Step 3: Collect and Deduplicate Findings

After all reviewers complete:

1. **Collect** all findings from each reviewer
2. **Categorize** by severity:
   - 🔴 **Must fix** — factual errors, security issues, broken logic, brand violations
   - 🟡 **Should fix** — quality issues, unclear language, missing context
   - 🟢 **Nice to have** — style preferences, minor improvements
3. **Cross-reference**: Issues flagged by 2+ models are HIGH CONFIDENCE real problems
4. **Deduplicate**: Same issue reported by multiple models = one fix
5. **Discard noise**: Single-model 🟢 issues that contradict the style/spec can be ignored

### Step 4: Apply Fixes

1. Address ALL 🔴 must-fix issues — no exceptions
2. Address 🟡 should-fix issues unless they conflict with established style/spec
3. Consider 🟢 nice-to-have issues if they're quick wins
4. For each fix, note which reviewer(s) caught it

### Step 5: Verify (Optional)

For critical deliverables (Tier 4), run a final pass:
- Single reviewer (any model) confirms all 🔴 fixes were applied correctly
- Checks that fixes didn't introduce new issues

## Review Prompt Template

Adapt this template for your specific use case:

```
You are a [ROLE] reviewing a [DELIVERABLE_TYPE] for [CONTEXT].

Review for:
1. [DIMENSION 1] — [what to check, what good looks like]
2. [DIMENSION 2] — [what to check, what good looks like]
3. [DIMENSION 3] — [what to check, what good looks like]
4. [DIMENSION 4] — [what to check, what good looks like]
5. [DIMENSION 5] — [what to check, what good looks like]

For each issue found, provide:
- SEVERITY: 🔴 Must fix / 🟡 Should fix / 🟢 Nice to have
- LOCATION: Where in the deliverable
- ISSUE: What's wrong
- FIX: Specific suggestion

If the deliverable is clean, say so. Don't invent issues.

[REFERENCE MATERIAL — spec, style guide, brand rules if applicable]

Deliverable to review:
[FULL CONTENT]
```

## Model Selection Strategy

### Diversity matters more than "best" model
- Different model families catch different issues
- Claude excels at nuance, consistency, and factual grounding
- GPT excels at logical structure, code accuracy, and completeness
- Mixing families (Claude + GPT) gives better coverage than 2 of the same family

### Current recommended pairings (as of May 2026)

| Use Case | Model 1 | Model 2 | Model 3 (optional) |
|----------|---------|---------|---------------------|
| Blog articles | claude-opus-4.6 | gpt-5.2-codex | — |
| Code changes | claude-sonnet-4 | gpt-5.2 | claude-opus-4.6 |
| Architecture specs | claude-opus-4.6 | gpt-5.4 | claude-sonnet-4 |
| Safety review | claude-opus-4.7 | gpt-5.5 | claude-opus-4.6 |

### ⚠️ Model Deprecation Awareness
- Check current model availability before launching reviews
- GPT-5.2 / GPT-5.2-Codex deprecated June 1, 2026 — migrate to GPT-5.4 after that date
- When a model is deprecated, swap to the next recommended model in the same family

## Agent Type Selection

| Review Scope | `agent_type` | Why |
|---|---|---|
| Content/articles | `general-purpose` | Full toolset for fact-checking, link verification |
| Code changes | `code-review` | Specialized for code analysis, won't modify |
| Specs/architecture | `general-purpose` | Can access codebase for context |
| Quick check | `explore` | Lightweight, faster, cheaper (Haiku) |

## Blog-Specific Review Dimensions

For long-form technical articles, always check these 5 dimensions:

1. **FACTUAL ACCURACY** — Are claims supported by linked sources? Any hallucinated facts?
2. **SOURCE QUALITY** — Are linked sources credible and current? Any dead or irrelevant links?
3. **WRITING QUALITY** — Is the voice consistent (first-person, opinionated, conversational)?
4. **STRUCTURE** — Does it flow logically? Is the hook strong? Is the closing substantive?
5. **TECHNICAL ACCURACY** — Are code examples correct? Are tool/version references accurate?

## Code-Specific Review Dimensions

For code changes (Tier 3 development standard):

1. **SPEC COMPLIANCE** — Does the implementation match the spec in `data/specs/`?
2. **BUGS** — Logic errors, off-by-one, null handling, race conditions
3. **SECURITY** — Injection, auth bypass, data leaks, PII exposure
4. **REGRESSIONS** — Does it break existing behavior or contracts?
5. **QUALITY** — Naming, structure, test coverage, error handling

## Anti-Patterns

- ❌ Running reviews sequentially instead of in parallel (wastes time, no benefit)
- ❌ Using only one model (misses model-specific blind spots)
- ❌ Using the same model family twice (e.g., two Claude variants — low diversity)
- ❌ Ignoring 🔴 findings from any reviewer (must be addressed or explicitly justified)
- ❌ Launching reviews without the full deliverable in the prompt (partial context = bad reviews)
- ❌ Reviewing incomplete/draft work (finish first, review second)
- ❌ Skipping review for "simple" changes that turn out to be Tier 2+ scope

## Integration with Development Standards

This skill implements the **Review** phase of the Tier 2-4 development pipeline:

- **Tier 2**: 1-2 model review (blog-writer default)
- **Tier 3**: 3+ model review with model diversity (mandatory)
- **Tier 4**: 3+ model review + dedicated safety reviewer

The orchestrating agent manages the pipeline; this skill defines HOW the review phase works.
