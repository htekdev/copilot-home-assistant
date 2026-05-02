import { execSync } from "node:child_process";
import { joinSession } from "@github/copilot-sdk/extension";

const CWD = process.cwd();
let pendingChanges = false;
let lastCommitTime = 0;
const DEBOUNCE_MS = 30000; // Don't commit more than once per 30 seconds
const POLL_INTERVAL_MS = 5 * 60 * 1000; // Poll for uncommitted changes every 5 minutes

function hasChanges() {
  try {
    const status = execSync("git status --porcelain --ignore-submodules", {
      cwd: CWD,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

function commitAndPush(detail) {
  const now = Date.now();
  if (now - lastCommitTime < DEBOUNCE_MS) return null;

  try {
    if (!hasChanges()) return null;

    const timestamp = new Date().toISOString().split("T")[0];
    const msg = detail
      ? `Auto-save: ${detail} (${timestamp})\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
      : `Auto-save: session updates (${timestamp})\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`;

    execSync("git add -A", { cwd: CWD, timeout: 10000 });
    execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: CWD, timeout: 10000 });
    execSync("gh hookflow git-push origin main", { cwd: CWD, timeout: 30000 });

    lastCommitTime = Date.now();
    return "✅ Committed and pushed";
  } catch (err) {
    return `⚠️ Auto-commit failed: ${err.message.split("\n")[0]}`;
  }
}

// ── Periodic polling timer ──────────────────────────────────────────────
// The hook-based approach only fires for the main copilot session.
// Sub-agents launched via `task` tool run in separate processes — their
// file changes (memory updates, task completions, data edits) never
// trigger onPostToolUse here. This timer catches those orphaned changes.
setInterval(() => {
  try {
    if (hasChanges()) {
      commitAndPush("background sync");
    }
  } catch {
    // Silently ignore — next interval will retry
  }
}, POLL_INTERVAL_MS);

// Track which tools modify files
const FILE_MODIFY_TOOLS = new Set([
  "create", "edit",
  "add_task", "update_task", "complete_task", "delete_task",
  "add_to_shopping_list", "check_off_item", "clear_shopping_list", "remove_from_list",
  "set_meal", "add_recipe",
  "add_expense", "add_income", "set_budget", "add_recurring_bill",
  "add_maintenance_task", "log_maintenance", "add_service_provider",
  "update_family_member", "add_location", "update_location", "remove_location",
  "set_home_address",
  "update_family_member",
]);

const session = await joinSession({
  tools: [],
  hooks: {
    onPostToolUse: async (input) => {
      // After any file-modifying tool, flag pending changes
      if (FILE_MODIFY_TOOLS.has(input.toolName)) {
        pendingChanges = true;
        const result = commitAndPush(input.toolName);
        if (result) {
          return { additionalContext: `[auto-commit] ${result}` };
        }
      }

      // After dataverse writes, commit any local notes that were saved alongside
      if (input.toolName === "msx-mcp-dataverse_write") {
        if (hasChanges()) {
          pendingChanges = true;
          const result = commitAndPush("MSX data sync");
          if (result) {
            return { additionalContext: `[auto-commit] ${result}` };
          }
        }
      }

      // After powershell commands that might create files
      if (input.toolName === "powershell") {
        const cmd = String(input.toolArgs?.command || "").toLowerCase();
        if (
          cmd.includes("add-content") || cmd.includes("set-content") ||
          cmd.includes("out-file") || cmd.includes("new-item") ||
          cmd.includes(">> ") || cmd.includes("> ")
        ) {
          if (hasChanges()) {
            pendingChanges = true;
            const result = commitAndPush("file update");
            if (result) {
              return { additionalContext: `[auto-commit] ${result}` };
            }
          }
        }
      }
    },

    onUserPromptSubmitted: async () => {
      // On every user message, check if there are uncommitted changes and commit
      if (hasChanges()) {
        pendingChanges = true;
        const result = commitAndPush("pending changes");
        if (result) {
          return { additionalContext: `[auto-commit] ${result}` };
        }
      }
    },

    onSessionStart: async () => {
      // On session start, commit anything leftover from last session
      if (hasChanges()) {
        const result = commitAndPush("session start cleanup");
        return {
          additionalContext:
            `[auto-commit] Extension active — hooks + 5-min polling timer. ${result || "No pending changes."}`,
        };
      }
      return {
        additionalContext:
          "[auto-commit] Extension active — hooks + 5-min polling timer. Repo is clean.",
      };
    },
  },
});
