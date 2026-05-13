---
name: tool-debugging-limits
description: Tool/MCP debugging escalation protocol — when a tool isn't working, stop fast, notify {{PARENT_1}}, and move on. Prevents context destruction and token waste. Use when agent says "tool not found", "MCP not available", "Playwright not working", "command failed", "trying to install", "debugging tool", or any repeated tool failure pattern.
---

# Tool Debugging Limits Skill

When a tool, MCP server, or environment dependency isn't working, agents MUST follow this escalation protocol. **Never burn context trying to fix tool issues inline.**

## The Rule (from {{PARENT_1}}, 2026-05-12)

> "You should never have to run a bunch of PowerShell scripts to get something to work. If it doesn't work, we gotta move on. It eats away at my productivity and your token use."

## Protocol

### Step 1: Try the Tool (2-3 Attempts Max)

- Attempt the tool/MCP call normally
- If it fails, try ONE reasonable alternative (different syntax, different args)
- If it fails again, try ONE more time with a basic sanity check
- **That's it. 3 attempts maximum.**

### Step 2: Notify {{PARENT_1}}

Send a Telegram (chat_id: {{TELEGRAM_PARENT_1}}, with `speak` parameter) explaining:
- What tool/MCP you were trying to use
- What you were trying to accomplish
- That it's not available/working
- That you're moving on

Example: "Hey, Playwright MCP isn't available in this session. I was trying to visually verify the blueprint sticky sidebar. Moving on to the next task — this might be a gap you need to fix."

### Step 3: Move On

- Continue with other work immediately
- Do NOT keep trying different approaches to make the tool work
- Do NOT install packages, run setup scripts, or try to bootstrap the tool yourself

### Step 4 (Optional): Delegate Debugging

If the tool issue is worth investigating:
- Launch a **separate throwaway agent** (`task` tool, `agent_type: "task"`) to debug
- The throwaway agent can burn its own context without affecting your working state
- Your primary agent stays clean and productive

## What Counts as "Tool Not Working"

| Situation | Action |
|-----------|--------|
| MCP tool not found in `tool_search_tool_regex` | Notify {{PARENT_1}}, move on |
| Tool returns errors on 2-3 tries | Notify {{PARENT_1}}, move on |
| Tool requires install/setup not already done | Notify {{PARENT_1}}, move on |
| Tool works but gives unexpected results | Try 2-3 variations, then notify |
| Tool available but slow/timing out | Try once more with longer timeout, then notify |

## Anti-Patterns (NEVER Do These)

- ❌ Running 5+ PowerShell commands trying to find/install/fix a tool
- ❌ Trying to run tools directly via shell when MCP isn't available (e.g., Playwright via PowerShell instead of MCP)
- ❌ Debugging tool issues inside a working agent with valuable context
- ❌ Silently spinning on a broken tool without telling {{PARENT_1}}
- ❌ Installing npm packages, pip packages, or other dependencies to make a tool work
- ❌ Searching for tool binaries across the filesystem
- ❌ Trying multiple different tool names hoping one works

## Correct Patterns

- ✅ Try tool 2-3 times → doesn't work → Telegram {{PARENT_1}} → move on
- ✅ Delegate tool debugging to a throwaway agent if investigation is needed
- ✅ Use alternative approaches that DON'T require the broken tool (e.g., if Playwright isn't available, describe what needs visual verification and ask {{PARENT_1}} to check)
- ✅ Create a task for {{PARENT_1}} to fix the tool gap: `add_task(title="Fix [tool] availability", surface="human", priority="high")`

## Scope

**ALL agents, ALL tool types.** This applies to:
- MCP servers (Playwright, Exa, Perplexity, {{EMPLOYER_PARENT}} MCP, etc.)
- CLI tools (gh, git, npm, etc.)
- Extensions (action-tracker, cron-scheduler, etc.)
- Any external dependency an agent tries to use

## Playwright-Specific Rules

Playwright is a common failure point. Specific rules:
- **Always use Playwright via MCP tools** — never try to run Playwright directly via PowerShell/Node scripts
- If Playwright MCP isn't available, tell {{PARENT_1}} — it's a session-level gap he needs to fix
- For visual verification without Playwright: describe what to check and ask {{PARENT_1}} to look at the preview URL
