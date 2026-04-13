/**
 * Agent Launcher Extension
 *
 * Dynamic agent discovery and launching for Copilot CLI.
 *
 * - onSessionStart: injects a catalog of all .agent.md files as context
 * - list_agents_on_disk: re-scans agents/ at call time (catches mid-session additions)
 * - launch_agent: reads an agent's full .agent.md instructions and returns a
 *   ready-to-use prompt for the task tool (agent_type "general-purpose")
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession } from "@github/copilot-sdk/extension";

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const AGENTS_DIR = join(REPO_ROOT, ".github", "agents");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse YAML-ish frontmatter from an .agent.md file.
 * Returns { name, description, body } or null on failure.
 */
function parseAgentFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;

    const fm = fmMatch[1];
    const name = (fm.match(/^name:\s*(.+)/m) || [])[1]?.trim();
    const descRaw = (fm.match(/^description:\s*"?([^"]*)"?/m) || [])[1]?.trim();
    // Body = everything after the closing ---
    const body = content.slice(fmMatch[0].length).trim();

    return name ? { name, description: descRaw || name, body } : null;
  } catch {
    return null;
  }
}

/**
 * Scan the agents directory and return all parsed agents.
 * Excludes templates/ subdirectory files.
 */
function discoverAgents() {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".agent.md"))
    .map((f) => {
      const parsed = parseAgentFile(join(AGENTS_DIR, f));
      return parsed ? { ...parsed, file: f } : null;
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      const agents = discoverAgents();
      if (agents.length === 0) {
        return {
          additionalContext:
            "[agent-launcher] No agent files found in .github/agents/.",
        };
      }

      const catalog = agents
        .map((a) => `  - "${a.name}": ${a.description}`)
        .join("\n");

      return {
        additionalContext:
          `[agent-launcher] ${agents.length} agents discovered on disk:\n${catalog}\n\n` +
          `Use the "launch_agent" tool to read an agent's full instructions and get a ` +
          `ready-to-use prompt for the task tool. Use "list_agents_on_disk" to re-scan ` +
          `after creating new agents mid-session.`,
      };
    },
  },

  tools: [
    // ----- list_agents_on_disk -----
    {
      name: "list_agents_on_disk",
      description:
        "Discover all agent .md files on disk, including ones created mid-session. " +
        "Returns each agent's name and description.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const agents = discoverAgents();
        if (agents.length === 0) {
          return {
            textResultForLlm: "No agent files found in .github/agents/.",
            resultType: "failure",
          };
        }
        const summary = agents.map((a) => ({
          name: a.name,
          description: a.description,
          file: a.file,
        }));
        return JSON.stringify(summary, null, 2);
      },
    },

    // ----- launch_agent -----
    {
      name: "launch_agent",
      description:
        "Launch any custom agent by name. Reads the agent's .agent.md file from disk " +
        "and returns the full instructions combined with your prompt. Use the returned " +
        "text as the prompt for the task tool with agent_type='general-purpose'. " +
        "Works for agents created mid-session.",
      parameters: {
        type: "object",
        properties: {
          agent_name: {
            type: "string",
            description:
              "Agent name (e.g. 'coding-agent', 'health-coach', 'dog-parent')",
          },
          prompt: {
            type: "string",
            description: "The task or question to give the agent",
          },
        },
        required: ["agent_name", "prompt"],
      },
      handler: async (args) => {
        const agentFile = join(AGENTS_DIR, `${args.agent_name}.agent.md`);

        if (!existsSync(agentFile)) {
          // Try fuzzy match
          const agents = discoverAgents();
          const match = agents.find(
            (a) =>
              a.name === args.agent_name ||
              a.file === `${args.agent_name}.agent.md`,
          );
          if (!match) {
            const available = agents.map((a) => a.name).join(", ");
            return {
              textResultForLlm:
                `Agent "${args.agent_name}" not found on disk. ` +
                `Available agents: ${available || "none"}`,
              resultType: "failure",
            };
          }
          // Use the matched agent's body
          return buildLaunchPrompt(match.name, match.description, match.body, args.prompt);
        }

        const parsed = parseAgentFile(agentFile);
        if (!parsed) {
          return {
            textResultForLlm:
              `Could not parse ${args.agent_name}.agent.md ΓÇö check frontmatter format.`,
            resultType: "failure",
          };
        }

        return buildLaunchPrompt(parsed.name, parsed.description, parsed.body, args.prompt);
      },
    },
  ],
});

/**
 * Build the combined prompt that the caller should pass to the task tool.
 */
function buildLaunchPrompt(name, description, body, userPrompt) {
  const combined =
    `You are the "${name}" agent ΓÇö ${description}\n\n` +
    `--- AGENT INSTRUCTIONS ---\n${body}\n--- END AGENT INSTRUCTIONS ---\n\n` +
    `--- YOUR TASK ---\n${userPrompt}`;

  return {
    textResultForLlm:
      `Γ£à Agent "${name}" instructions loaded (${body.length} chars).\n\n` +
      `Launch this agent using the task tool:\n` +
      `  agent_type: "general-purpose"\n` +
      `  name: "${name}"\n` +
      `  description: (short summary of the task)\n` +
      `  prompt: (the full text below)\n\n` +
      `--- FULL PROMPT ---\n${combined}`,
  };
}
