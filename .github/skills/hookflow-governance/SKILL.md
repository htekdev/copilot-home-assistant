---
name: hookflow-governance
description: >
  Hookflow governance philosophy and creation patterns — every behavioral correction becomes a deterministic hookflow rule.
  Use when: "create hook", "hookflow rule", "enforce behavior", "block pattern", "governance hook",
  "prevent mistake", "deterministic enforcement", "preToolUse deny", "postToolUse advisory",
  "hookflow audit", "new YAML hookflow", "behavioral correction", "hookflow-js"
---

# Hookflow Governance — The Platform's Immune System

## What “Hookflow” Means in This Repo

**Hookflows here mean the custom `hookflow-js` governance engine** — not Copilot CLI extensions.

- **Primary hookflow files live under** `.github/hookflows/`
- **Markdown hookflows** (`.md`) handle simple static block/advise rules
- **YAML hookflows** (`.yml`) handle conditional parsing, regex extraction, and scripted validation
- **Extensions are separate**: they provide tools, management helpers, background jobs, and defense-in-depth, but they are **not** the primary governance layer

When {{PARENT_1}} says "use a hookflow," default to the custom `hookflow-js` files under `.github/hookflows/` unless the requirement is truly impossible to express there.

## Philosophy

**Every time we identify something agents SHOULD or SHOULD NOT do, we create a hookflow rule to deterministically enforce it.**

This is not optional. This is not "nice to have." This is the CORE governance mechanism of the platform. Instructions can be ignored. Memories can be forgotten. Skills can be skipped. But **hookflow rules execute deterministically** — they cannot be bypassed by the AI, they fire on every tool call, and they provide immediate feedback.

**The hierarchy of enforcement:**
1. **Hookflow-js rules in `.github/hookflows/`** (deterministic, cannot be bypassed) ← STRONGEST
2. **Extension tools and extension management layers** (controlled interfaces, privileged writers, defense-in-depth)
3. **copilot-instructions.md** (read at session start, can drift)
4. **Agent instructions** (per-agent, session-scoped)
5. **Skills** (invoked on demand, can be skipped)
6. **Memories** (cross-session, can be stale)

**The principle:** When a mistake happens ONCE, the first response is to create a hookflow rule so it can NEVER happen again. Not a memory. Not an instruction update. A hookflow. Those other things are supplementary — the hook is the primary enforcement.

---

## Hook Types

### preToolUse (Deny Hook)
- **Purpose:** Block an operation BEFORE it executes
- **When to use:** Agent is about to do something harmful, wasteful, or policy-violating
- **Return:** `{ permissionDecision: "deny", permissionDecisionReason: "..." }`
- **Effect:** Tool call is cancelled, agent sees the denial message
- **Example:** Blocking `git push` in powershell → forces use of `dev_push`

### postToolUse (Advisory Hook)
- **Purpose:** Inject context AFTER a tool executes — corrective or supplementary
- **When to use:** Detect a pattern that indicates bad behavior happened, or add required follow-up context
- **Return:** `{ additionalContext: "..." }`
- **Effect:** Agent's next reasoning step includes the advisory
- **Example:** After a `powershell` call that ran `git commit`, inject "You should have used dev_commit"

### onSessionStart (Context Injection)
- **Purpose:** Inject governance rules at session start
- **When to use:** Declare which rules the governance layer enforces
- **Return:** `{ additionalContext: "..." }`
- **Effect:** Agent sees the rules in its first context window

---

## Current Hookflow Rules (Platform Registry)

| Hookflow / Extension | Hook Type | What It Enforces |
|----------------------|-----------|-----------------|
| `dev-guard` | preToolUse + postToolUse | Blocks raw git/hookflow commands → forces dev-workflow tools |
| `image-crop-deny` | preToolUse + postToolUse | Blocks resize/crop of hero images → forces regeneration at correct dimensions |
| `protected-files` | preToolUse | Blocks direct edits to governed data files → forces extension tool APIs |
| `task-originator-notify` | preToolUse + postToolUse | Blocks `task` prompts and `write_agent` messages missing `<originator_notify telegram_id="...">...</originator_notify>` and notifies the originator after launch/steer |
| `tool-fishing-guard` | preToolUse + postToolUse | Blocks tool_search_tool_regex for standard tools (call directly) and MCP tools (main-session-only, use web_fetch in sub-agents) |
| `auto-commit` | postToolUse | Auto-commits changes after extension tool mutations |
| `dev-workflow` | tools | Forces git operations through controlled, auditable tool interfaces |
| `safe-content-write` | preToolUse + postToolUse + onSessionStart | Blocks large PowerShell here-string writes → forces `create`/`edit`/extension tools |
| `block-worklog-narration` | preToolUse (YAML hookflow) | Blocks Telegram messages containing internal worklog/process narration → forces result-first communication |
| `linkedin-brand-safety` | postToolUse + onSessionStart | Blocks LinkedIn messages claiming {{PARENT_1}} uses Claude/ChatGPT/Cursor/non-{{EMPLOYER}} AI tools |
| `require-vercel-link-with-pr` | preToolUse (YAML hookflow) | Blocks Telegram messages mentioning {{GITHUB_USERNAME}} PRs without a Vercel preview URL |
| `calendar-date-guard` | preToolUse + onUserPromptSubmitted | Blocks gcal_create_event when computed weekday mismatches user intent or intent is ambiguous |
| `block-db-powershell` | preToolUse (MD hookflow) | Blocks direct SQLite/database access in powershell → forces extension tools |
| `block-web-fetch` | preToolUse (MD hookflow) | Blocks web_fetch/web_search in main session → forces Exa/Perplexity MCP tools |
| `enforce-image-gen-tool` | preToolUse (MD hookflow) | Blocks raw Python image generation → forces `generate_image` extension tool |
| `block-raw-openai-api` | preToolUse (MD hookflow) | Blocks `$OPENAI_API_KEY`/`api.openai.com` in commands → forces `generate_image` extension tool |
| `validate-email-urls` | preToolUse (YAML hookflow) | Blocks `gmail_send` if any URL in body returns non-200 — prevents sending emails with broken links |
| `validate-post-urls` | preToolUse (YAML hookflow) | Blocks `late_create_post`/`late_update_post` if any {{PERSONAL_DOMAIN}} URL in content returns non-200 |
| `block-unvalidated-post-reschedule` | preToolUse (YAML hookflow) | Blocks `late_reschedule_post` → forces `late_update_post` so validate-post-urls re-runs before linked posts are re-scheduled |
| `pitcher-proof-required` | preToolUse (YAML hookflow) | Blocks `telegram_send_message` to {{PARENT_2}} (chat_id: `{{TELEGRAM_PARENT_2}}`) mentioning a milk pitcher unless a structured `📊 Pitcher Proof:` block (7 required fields from `pitcher_check`/`pitcher_status`) is present |
| `telegram-message-param-guard` | preToolUse (YAML hookflow) | Blocks `telegram_send_message` missing the `message` param or using `text` instead — ensures visible Telegram body is always set |
| `block-manage-schedule` | preToolUse (MD hookflow) | Blocks `manage_schedule` tool → forces all scheduling through `cron.json` instead of unreliable in-session timers |
| `block-gh-copilot-command` | preToolUse (MD hookflow) | Blocks `gh copilot` as a command in content writes → correct standalone command is just `copilot` |
| `block-unreviewed-blog-article-merge` | preToolUse (YAML hookflow) | Blocks `dev_merge_pr` on `{{GITHUB_USERNAME}}/htek-dev-site` `article/*`, `blog/*`, `fix/illustrations-*` branches unless the PR has a GitHub APPROVED review — enforces blog pipeline: illustrator → blog-reviewer approves → merge (incident 2026-06-05) |
| `block-direct-blog-issues` | preToolUse (YAML hookflow) | Blocks raw `gh issue create/edit/close` on `{{GITHUB_USERNAME}}/htek-dev-site` blog pipeline → forces `blog_*` extension tools |
| `block-merge-conflict-commit` | preToolUse (YAML hookflow) | Blocks `dev_commit` when staged files contain unresolved merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) |
| `warn-blog-interview-delivery` | postToolUse (MD hookflow) | Advisory after `blog_set_interviewing` — requires agent to send {{PARENT_1}} a direct Telegram with full interview question set (task alone is insufficient) |
| `validate-blackout-event-dates` | postToolUse (YAML hookflow) | Advisory after `dev_commit`/`dev_push` on blackout-pickleball — if event files changed, injects mandatory checklist: day-of-week verification, stale date grep, UTC offset warning, single-source-of-truth reminder, UTF-8 encoding check |
| `block-direct-code-create-on-main` | preToolUse (YAML hookflow) | Blocks `create` of code files (.js/.mjs/.ts/.py/.go etc.) on the main/master branch of non-{{FAMILY_NAME}}-family repos → forces `start_dev_branch` + PR workflow. Closes the escape hatch agents used to bypass `safe-content-write` by writing .mjs files directly via `create`. |
| `block-proposal-generate-image` | preToolUse (YAML hookflow) | Blocks `generate_image` when prompt/params mention ANY client name (blackout, surgiquip, carplay, chapulin, detail-ops, etc.) or "proposal" → forces `generate_image_with_image` with approved wireframe/screenshot as reference. Triggered by Surgiquip + Blackout incidents (2026-06-05). Supersedes `block-blackout-generate-image`. |

---

## Pattern: Correction → Hook Creation

When a behavioral correction is identified (from {{PARENT_1}}, from a mistake, from an audit), follow this pattern:

### Step 1: Identify the Bad Behavior
- What did the agent do wrong?
- What tool was involved? (`powershell`, `edit`, `create`, etc.)
- What pattern in the tool arguments indicates the bad behavior?

### Step 2: Determine Hook Type
- Can we PREVENT it? → `preToolUse` deny hook
- Can we only DETECT it after? → `postToolUse` advisory hook
- Is it a missing GOOD behavior? → `postToolUse` that checks for absence

### Step 3: Write the Detection Logic
```javascript
function checkCommand(cmd) {
  // Pattern match against the bad behavior
  if (BAD_PATTERN.test(cmd)) {
    return { blocked: true, reason: "...", suggestion: "..." };
  }
  return { blocked: false };
}
```

### Step 4: Write the Denial/Advisory Message
- Lead with `🚫 BLOCKED:` for denials
- Explain WHY the behavior is blocked
- Provide the CORRECT alternative
- Reference the governance principle

### Step 5: Place the Hook
- Markdown hookflow in `.github/hookflows/{name}.md` for simple static policy rules
- YAML hookflow in `.github/hookflows/{name}.yml` for conditional logic, regex extraction, and scripted validation
- Extension in `.github/extensions/{name}/extension.mjs` only when hookflows cannot express the rule (state, APIs, timers, or new tools)
- Prefer migrating broken extension deny hooks to YAML hookflows when the policy is just request validation

---

## Template: New YAML Hookflow (PRIMARY path)

```yaml
name: Require condition X
description: Blocks tool Y unless condition Z is present.
on:
  hooks:
    types: [preToolUse]
    tools: [tool_name]
blocking: true
env:
  ARG_JSON: ${{ toJSON(event.tool.args.some_arg) }}
steps:
  - name: Validate condition
    run: |
      $value = $env:ARG_JSON | ConvertFrom-Json
      if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Error '🚫 BLOCKED: Explain what is missing and how to fix it.'
        exit 1
      }

      # Add regex parsing, conditional logic, and optional network checks here.
      exit 0
```

## Template: New Extension Hook (only when hookflows are insufficient)

```javascript
/**
 * {Name} Extension for GitHub Copilot CLI
 *
 * {What it blocks/enforces and why}
 *
 * Hookflow Governance: This rule was created because {the specific mistake/correction}.
 */
import { joinSession } from "@github/copilot-sdk/extension";

// ── Detection patterns ──────────────────────────────────────────────────────

const BAD_PATTERNS = [
  { pattern: /regex_here/i, reason: "Why this is bad", fix: "What to do instead" },
];

/**
 * Check if a command matches blocked patterns.
 */
function checkCommand(cmd) {
  if (!cmd || typeof cmd !== "string") return { blocked: false };
  const normalized = cmd.trim();

  for (const { pattern, reason, fix } of BAD_PATTERNS) {
    if (pattern.test(normalized)) {
      return { blocked: true, reason, fix };
    }
  }
  return { blocked: false };
}

function buildDenialMessage(check) {
  return [
    `🚫 BLOCKED: ${check.reason}`,
    "",
    `✅ Instead: ${check.fix}`,
    "",
    "Hookflow governance: deterministic behavioral enforcement.",
  ].join("\\n");
}

// ── Join Session ────────────────────────────────────────────────────────────

await joinSession({
  tools: [],
  hooks: {
    onPreToolUse: async (input) => {
      if (input.toolName !== "powershell") return;
      const cmd = input.toolArgs?.command;
      const check = checkCommand(cmd);
      if (check.blocked) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason: buildDenialMessage(check),
        };
      }
    },

    onPostToolUse: async (input) => {
      if (input.toolName !== "powershell") return;
      const cmd = input.toolArgs?.command;
      const check = checkCommand(cmd);
      if (check.blocked) {
        return { additionalContext: buildDenialMessage(check) };
      }
    },

    onSessionStart: async () => {
      return {
        additionalContext: "[{name}] Extension loaded — {brief description of what's enforced}.",
      };
    },
  },
});
```

---

## Hookflow Audit Checklist

When reviewing platform behavior (nightly reflection, context audit, skill optimizer), ask:

1. **Was a mistake made?** → Can we create a hookflow to prevent it?
2. **Was an instruction ignored?** → Can we enforce it deterministically via hookflow?
3. **Is there a "NEVER do X" rule?** → Does a hookflow enforce it? If not, CREATE ONE.
4. **Is there a "ALWAYS do Y" rule?** → Can a postToolUse check for absence and advise?
5. **Are sub-agents violating rules?** → Hooks propagate to sub-agents, providing consistent enforcement across all sessions.

---

## Runtime Notes & Limitations

- The **custom `hookflow-js` engine** and files in `.github/hookflows/` are the PRIMARY governance mechanism in this repo.
- Extension-based `onPreToolUse` deny hooks are unreliable for some cross-extension tool paths. Do not assume an extension can block tools registered by another extension.
- YAML hookflows in `.github/hookflows/` are the preferred place for deterministic request-validation deny rules.
- Extension `onPostToolUse` remains useful for advisory context and side effects.
- Hooks propagate to sub-agents launched via `task` tool — governance enforcement is consistent across all sessions.
- Belt-and-suspenders: prompt-level enforcement in agent definitions provides additional redundancy alongside hookflow enforcement.

---

## Decision Framework: When to Create a Hook

| Scenario | Action |
|----------|--------|
| Agent ran a blocked command | Add pattern to an existing hookflow or create a new hookflow first; use an extension only if hookflows are insufficient |
| Agent forgot a required step | Create postToolUse advisory that detects the absence |
| A rule exists only in instructions | Promote to hookflow for deterministic enforcement |
| Sub-agent violated a rule | Can't hookflow (SDK limitation) → strengthen prompt + add to copilot-instructions |
| New "NEVER do X" correction from {{PARENT_1}} | IMMEDIATELY create hookflow + persist in instructions |
| Pattern seen 2+ times | Definitely a hookflow candidate |

---

## Integration with Other Governance Layers

Hookflows are the PRIMARY enforcement, but they work with:
- **`correction-persistence` skill** — persist the lesson in memories + instructions + standing orders
- **`development-pipeline` skill** — new hookflows follow Tier 1 (small, just do it) for simple patterns, Tier 2 for complex multi-pattern hooks
- **`autonomous-improvement` skill** — hookflow creation is auto-implementable (no approval needed)
- **`nightly-reflection` cron** — should scan for new hookflow opportunities in every cycle
- **`context-auditor` cron** — should flag "NEVER do X" rules that lack hookflow enforcement
