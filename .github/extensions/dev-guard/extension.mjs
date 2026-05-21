/**
 * Dev Guard Extension for {{PRODUCT}} CLI
 *
 * BLOCKS raw git and hookflow commands in powershell, forcing agents to use
 * the dev-workflow extension tools instead. This ensures all git operations
 * go through controlled, auditable extension tools.
 *
 * Intercepted commands:
 *   - git <anything> (commit, push, checkout, branch, worktree, add, etc.)
 *   - gh hookflow <anything>
 *   - git-wt <anything>
 *
 * Allowed exceptions:
 *   - git log / git diff / git show / git blame (read-only, no extension tool exists)
 *   - git --no-pager log/diff/show (read-only with pager disabled)
 *   - NOTE: git status IS blocked — use dev_status instead
 *   - Commands inside the auto-commit extension (runs server-side, not via powershell tool)
 *
 * When blocked, returns a denial message listing the correct extension tool to use.
 *
 * Architecture note: Only intercepts the `powershell` TOOL calls (from the AI).
 * Extensions that use Node.js execSync directly (like auto-commit) are NOT blocked
 * and are considered trusted server-side code.
 */
import { joinSession } from "@github/copilot-sdk/extension";

// ── Git command → extension tool mapping ────────────────────────────────────

const TOOL_MAP = {
  "git status":    { tool: "dev_status",     desc: "Check working tree status (staged, unstaged, untracked)" },
  "git add":       { tool: "dev_add",        desc: "Stage files for commit" },
  "git stage":     { tool: "dev_add",        desc: "Stage files for commit" },
  "git commit":    { tool: "dev_commit",     desc: "Commit staged changes with a message" },
  "git push":      { tool: "dev_push",       desc: "Push branch to remote" },
  "git checkout":  { tool: "dev_checkout",   desc: "Switch branches or create a new branch" },
  "git switch":    { tool: "dev_checkout",   desc: "Switch branches or create a new branch" },
  "git branch":    { tool: "dev_checkout",   desc: "Create or manage branches (use dev_checkout to create)" },
  "git worktree":  { tool: "start_dev_branch", desc: "Create an isolated worktree for parallel development" },
  "git merge":     { tool: "dev_merge_pr",   desc: "Merge a PR via {{EMPLOYER_PARENT}} (use gh pr merge pattern)" },
  "git pull":      { tool: "dev_pull",       desc: "Pull latest changes from remote" },
  "git fetch":     { tool: "dev_pull",       desc: "Fetch and pull latest from remote" },
  "git clone":     { tool: "start_dev_branch", desc: "Clone + worktree setup for a repo" },
  "git stash":     { tool: "dev_stash",      desc: "Stash or pop working changes" },
  "git reset":     { tool: "dev_reset",      desc: "Reset staged changes or commits" },
  "git rebase":    { tool: "dev_rebase",     desc: "Rebase current branch onto another" },
  "git cherry-pick": { tool: null,           desc: "Cherry-pick is not supported via extension — ask {{PARENT_1}}." },
  "git tag":       { tool: null,             desc: "Tagging is not supported via extension — ask {{PARENT_1}}." },
};

// ── Read-only git commands that are ALLOWED ─────────────────────────────────
// These don't modify state and are safe to run directly.
const READ_ONLY_PATTERNS = [
  /^\s*git\s+(--no-pager\s+)?(log|diff|show|shortlog|blame|ls-files|ls-tree|rev-parse|describe|name-rev|symbolic-ref|remote\s+(get-url|show)|config\s+--get|branch\s+--show-current|rev-list)/i,
  /^\s*git\s+--no-pager\s/i,  // git --no-pager <read command> is generally safe
  /^\s*git\s+--version/i,
];

// Refined: --no-pager followed by a write command should still be blocked
const WRITE_WITH_PAGER = /^\s*git\s+--no-pager\s+(status|add|commit|push|pull|fetch|checkout|switch|branch\s+-[dDmM]|merge|rebase|reset|stash|worktree|clone|tag|cherry-pick)/i;

// ── Hookflow / git-wt patterns ──────────────────────────────────────────────
const HOOKFLOW_PATTERN = /\bhookflow\b/i;
const GIT_WT_PATTERN = /\bgit-wt\b/i;

// ── Bypass detection patterns ───────────────────────────────────────────────
// Catch attempts to evade detection via PowerShell tricks
const BYPASS_PATTERNS = [
  /\$\w+\s*=\s*["']git["']/i,          // $var = "git" (variable assignment to bypass)
  /&\s+\$\w+.*(commit|push|add|checkout|merge|rebase|reset|stash|worktree|clone|branch|pull|fetch|tag|cherry)/i, // & $var <git-cmd>
  /Get-Command\s+git/i,                 // (Get-Command git).Path
  /Invoke-Expression.*git\s/i,          // Invoke-Expression "git ..."
  /iex\s.*git\s/i,                      // iex "git ..." (alias)
  /git-lfs\s+(push|pull|fetch|clone)/i, // git-lfs write operations
];

// ── gh CLI patterns that must go through dev-workflow ────────────────────────
const GH_BLOCKED_PATTERNS = [
  { pattern: /\bgh\s+pr\s+checkout\b/i, reason: "`gh pr checkout` is blocked — it checks out directly in the main clone.", fix: "dev_pr_checkout", fixDesc: "Check out a PR into an isolated worktree" },
  { pattern: /\bgh\s+pr\s+create\b/i, reason: "`gh pr create` is blocked — use the dev-workflow extension.", fix: "create_vercel_pr", fixDesc: "Push branch, create PR, and poll Vercel preview" },
  { pattern: /\bgh\s+pr\s+merge\b/i, reason: "`gh pr merge` is blocked — use the dev-workflow extension.", fix: "dev_merge_pr", fixDesc: "Merge a {{EMPLOYER_PARENT}} PR (squash by default, delete branch)" },
];

// ── Core detection ──────────────────────────────────────────────────────────

/**
 * Check if a powershell command contains a blocked git operation.
 * Returns { blocked: true, reason, suggestion } or { blocked: false }.
 */
function checkCommand(cmd) {
  if (!cmd || typeof cmd !== "string") return { blocked: false };

  const normalized = cmd.trim();

  // ── Check hookflow ──
  if (HOOKFLOW_PATTERN.test(normalized)) {
    return {
      blocked: true,
      reason: `Hookflow commands are blocked. Use dev-workflow extension tools instead.`,
      suggestion: "dev_push",
      suggestionDesc: "Push branch to remote (replaces hookflow git-push)",
    };
  }

  // ── Check gh CLI blocked patterns ──
  for (const { pattern, reason, fix, fixDesc } of GH_BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        blocked: true,
        reason,
        suggestion: fix,
        suggestionDesc: fixDesc,
      };
    }
  }

  // ── Check git-wt ──
  if (GIT_WT_PATTERN.test(normalized)) {
    return {
      blocked: true,
      reason: `git-wt commands are blocked. Use dev-workflow extension tools instead.`,
      suggestion: "start_dev_branch",
      suggestionDesc: "Create an isolated worktree for parallel development",
    };
  }

  // ── Check bypass attempts (variable expansion, Invoke-Expression, etc.) ──
  for (const pattern of BYPASS_PATTERNS) {
    if (pattern.test(normalized)) {
      return {
        blocked: true,
        reason: `Detected an attempt to run git indirectly. All git operations must use dev-workflow extension tools.`,
        suggestion: null,
        suggestionDesc: "Use dev-workflow tools directly (dev_commit, dev_push, dev_add, etc.) instead of constructing git commands via variables or expressions.",
      };
    }
  }

  // ── Check for git commands ──
  // Must contain "git " to be a git command
  if (!/\bgit\s/i.test(normalized)) return { blocked: false };

  // Allow read-only git commands
  // But first check if it's a write-with-pager (should block)
  if (WRITE_WITH_PAGER.test(normalized)) {
    // Fall through to blocking logic
  } else {
    for (const pattern of READ_ONLY_PATTERNS) {
      if (pattern.test(normalized)) return { blocked: false };
    }
  }

  // Find the best matching tool suggestion
  // Sort by longest match first to prefer "git cherry-pick" over "git ch"
  const sortedKeys = Object.keys(TOOL_MAP).sort((a, b) => b.length - a.length);

  for (const gitCmd of sortedKeys) {
    // Build a regex that matches the git command as a word boundary
    const escaped = gitCmd.replace(/-/g, "\\-");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(normalized)) {
      const mapping = TOOL_MAP[gitCmd];
      return {
        blocked: true,
        reason: `\`${gitCmd}\` is blocked. Use dev-workflow extension tools instead.`,
        suggestion: mapping.tool,
        suggestionDesc: mapping.desc,
      };
    }
  }

  // Generic git command we don't have a specific mapping for
  // Still block it — if the tool doesn't exist, the agent should add it
  if (/\bgit\s+[a-z]/i.test(normalized)) {
    return {
      blocked: true,
      reason: `Raw git commands are blocked. Use dev-workflow extension tools instead.`,
      suggestion: null,
      suggestionDesc: "If no extension tool exists for this operation, ADD one to the dev-workflow extension and notify what you added.",
    };
  }

  return { blocked: false };
}

/**
 * Build the denial message shown to the agent when a command is blocked.
 */
function buildDenialMessage(check) {
  const lines = [
    `🚫 BLOCKED: ${check.reason}`,
    "",
    "You should be using a dev-workflow extension tool for this activity.",
  ];

  if (check.suggestion) {
    lines.push("");
    lines.push(`✅ Use instead: \`${check.suggestion}\` — ${check.suggestionDesc}`);
  } else if (check.suggestionDesc) {
    lines.push("");
    lines.push(`⚠️ ${check.suggestionDesc}`);
  }

  lines.push("");
  lines.push("Available dev-workflow tools: start_dev_branch, create_vercel_pr, dev_add, dev_commit, dev_push, dev_pull, dev_checkout, dev_status, dev_stash, dev_reset, dev_rebase, dev_merge_pr");

  return lines.join("\n");
}

// ── Join Session ────────────────────────────────────────────────────────────

await joinSession({
  tools: [],
  hooks: {
    // NOTE: onPreToolUse is NOT dispatched by the Copilot CLI runtime to
    // extension join sessions (SDK v1.0.47). We keep it here so it activates
    // automatically if/when the runtime starts dispatching it.
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

    // onPostToolUse IS dispatched — use it to detect blocked commands after
    // execution and inject a strong correction into the conversation context.
    onPostToolUse: async (input) => {
      if (input.toolName !== "powershell") return;

      const cmd = input.toolArgs?.command;
      const check = checkCommand(cmd);

      if (check.blocked) {
        return {
          additionalContext: buildDenialMessage(check),
        };
      }
    },

    onSessionStart: async () => {
      return {
        additionalContext: [
          "[dev-guard] Extension loaded — raw git commands, hookflow, and `gh pr checkout/create/merge` are BLOCKED in powershell.",
          "Use dev-workflow extension tools instead: start_dev_branch, dev_pr_checkout, create_vercel_pr, dev_add, dev_commit, dev_push, dev_pull, dev_checkout, dev_status, dev_stash, dev_reset, dev_rebase, dev_merge_pr.",
          "Read-only git commands (log, diff, show, blame) are still allowed. git status is BLOCKED — use dev_status.",
          "",
          "⚠️ CRITICAL: If you accidentally run a blocked git command via powershell, you MUST immediately redo the operation using the correct dev-workflow tool. The command output should be IGNORED.",
        ].join(" "),
      };
    },
  },
});
