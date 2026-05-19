---
name: hookflow-governance
description: >
  Hookflow governance philosophy and creation patterns — every behavioral correction becomes a deterministic hookflow rule.
  Use when: "create hook", "hookflow rule", "enforce behavior", "block pattern", "governance hook",
  "prevent mistake", "deterministic enforcement", "preToolUse deny", "postToolUse advisory",
  "hookflow audit", "new extension hook", "behavioral correction"
---

# Hookflow Governance — The Platform's Immune System

## Philosophy

**Every time we identify something agents SHOULD or SHOULD NOT do, we create a hookflow rule to deterministically enforce it.**

This is not optional. This is not "nice to have." This is the CORE governance mechanism of the platform. Instructions can be ignored. Memories can be forgotten. Skills can be skipped. But **hookflow rules execute deterministically** — they cannot be bypassed by the AI, they fire on every tool call, and they provide immediate feedback.

**The hierarchy of enforcement:**
1. **Hookflow rules** (deterministic, cannot be bypassed) ← STRONGEST
2. **Extension tools** (force agents through controlled interfaces)
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
- **When to use:** Declare which rules this extension enforces
- **Return:** `{ additionalContext: "..." }`
- **Effect:** Agent sees the rules in its first context window

---

## Current Hookflow Rules (Platform Registry)

| Extension | Hook Type | What It Enforces |
|-----------|-----------|-----------------|
| `dev-guard` | preToolUse + postToolUse | Blocks raw git/hookflow commands → forces dev-workflow tools |
| `image-crop-deny` | preToolUse + postToolUse | Blocks resize/crop of hero images → forces regeneration at correct dimensions |
| `protected-files` | preToolUse | Blocks direct edits to governed data files → forces extension tool APIs |
| `auto-commit` | postToolUse | Auto-commits changes after extension tool mutations |
| `dev-workflow` | tools | Forces git operations through controlled, auditable tool interfaces |

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
- New extension in `.github/extensions/{name}/extension.mjs` for new domains
- Add to existing extension if the rule belongs to that domain (e.g., git rules → dev-guard)

---

## Template: New Hookflow Extension

```javascript
/**
 * {Name} Extension for {{PRODUCT}} CLI
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
5. **Are sub-agents violating rules?** → Hooks in the main session catch sub-agent tool calls too (SDK limitation: they don't propagate to sub-agent sessions, but the parent session's hooks fire for tool calls made in that session).

---

## SDK Limitations (as of v1.0.47)

- `onPreToolUse` is NOT dispatched to extension `joinSession` hooks by the runtime — it's defined but inactive. The `hooks.json` top-level `onPreToolUse` IS active.
- `onPostToolUse` IS dispatched to extensions — this is the reliable enforcement point.
- Hooks do NOT propagate to sub-agents launched via `task` tool — sub-agents run in separate sessions without parent extensions.
- Workaround: prompt-level enforcement for sub-agents + hookflow for main session.

---

## Decision Framework: When to Create a Hook

| Scenario | Action |
|----------|--------|
| Agent ran a blocked command | Add pattern to existing hook or create new extension |
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
