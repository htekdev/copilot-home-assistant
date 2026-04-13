import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession } from "@github/copilot-sdk/extension";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FAMILY_DIR = join(REPO_ROOT, "data", "family");

// --- Helper functions ---

function loadMember(filePath) {
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function saveMember(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function setNestedValue(obj, path, value) {
  const keys = path.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined || current[key] === null || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

function findMemberFile(name) {
  if (!existsSync(FAMILY_DIR)) return null;
  const query = name.toLowerCase();
  const files = readdirSync(FAMILY_DIR).filter((f) => f.endsWith(".json"));

  // First pass: match on the "name" field inside each JSON file
  for (const file of files) {
    try {
      const data = loadMember(join(FAMILY_DIR, file));
      if (data.name && data.name.toLowerCase().includes(query)) {
        return join(FAMILY_DIR, file);
      }
    } catch {
      // skip malformed files
    }
  }

  // Second pass: match on filename (without .json)
  for (const file of files) {
    const base = file.replace(/\.json$/, "").toLowerCase();
    if (base.includes(query)) {
      return join(FAMILY_DIR, file);
    }
  }

  return null;
}

function getAllMembers() {
  if (!existsSync(FAMILY_DIR)) return [];
  const files = readdirSync(FAMILY_DIR).filter((f) => f.endsWith(".json"));
  const members = [];
  for (const file of files) {
    try {
      const data = loadMember(join(FAMILY_DIR, file));
      members.push({ file, data });
    } catch {
      // skip malformed files
    }
  }
  return members;
}

// --- Extension ---

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      const members = getAllMembers();
      if (members.length === 0) {
        return { additionalContext: "[family-data] No family members found in data/family/." };
      }
      const lines = members.map(
        (m) => `  - ${m.data.name} (${m.data.role || "unknown role"})`
      );
      return {
        additionalContext:
          `[family-data] Rocha family members loaded:\n${lines.join("\n")}\n` +
          `Use the family-data tools (get_family_member, list_family, update_family_member, get_preferences, who_is_asking) to manage profiles.`,
      };
    },
  },

  tools: [
    {
      name: "get_family_member",
      description:
        "Get a family member's full profile by name. Case-insensitive partial match.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Family member name (case-insensitive partial match)",
          },
        },
        required: ["name"],
      },
      handler: async (args) => {
        const filePath = findMemberFile(args.name);
        if (!filePath) {
          return {
            textResultForLlm: `No family member found matching "${args.name}".`,
            resultType: "failure",
          };
        }
        const data = loadMember(filePath);
        return JSON.stringify(data, null, 2);
      },
    },

    {
      name: "list_family",
      description:
        "List all family members with their name, role, and Telegram user ID.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const members = getAllMembers();
        if (members.length === 0) {
          return "No family members found in data/family/.";
        }
        const summary = members.map((m) => ({
          name: m.data.name,
          role: m.data.role || "unknown",
          telegram_user_id: m.data.telegram_user_id || null,
        }));
        return JSON.stringify(summary, null, 2);
      },
    },

    {
      name: "update_family_member",
      description:
        "Update a specific field in a family member's profile using dot-notation path. " +
        'Example: field_path="medical.pharmacy", value="CVS on Main St".',
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Family member name (case-insensitive partial match)",
          },
          field_path: {
            type: "string",
            description:
              'Dot-notation path to the field (e.g., "medical.pharmacy", "dietary.allergies")',
          },
          value: {
            description: "The new value to set (string, number, boolean, array, or object)",
          },
        },
        required: ["name", "field_path", "value"],
      },
      handler: async (args) => {
        const filePath = findMemberFile(args.name);
        if (!filePath) {
          return {
            textResultForLlm: `No family member found matching "${args.name}".`,
            resultType: "failure",
          };
        }
        const data = loadMember(filePath);
        setNestedValue(data, args.field_path, args.value);
        saveMember(filePath, data);
        return `Updated ${data.name}'s "${args.field_path}" successfully.`;
      },
    },

    {
      name: "get_preferences",
      description:
        "Get dietary preferences, allergies, schedule, and preferences for a family member.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Family member name (case-insensitive partial match)",
          },
        },
        required: ["name"],
      },
      handler: async (args) => {
        const filePath = findMemberFile(args.name);
        if (!filePath) {
          return {
            textResultForLlm: `No family member found matching "${args.name}".`,
            resultType: "failure",
          };
        }
        const data = loadMember(filePath);
        const result = {
          name: data.name,
          dietary: data.dietary || null,
          allergies: data.medical?.allergies || null,
          schedule: data.schedule || null,
          preferences: data.preferences || null,
        };
        return JSON.stringify(result, null, 2);
      },
    },

    {
      name: "who_is_asking",
      description:
        "Map a Telegram user ID to a family member. Used to identify who sent a Telegram message.",
      parameters: {
        type: "object",
        properties: {
          telegram_user_id: {
            type: "string",
            description: "The Telegram user ID to look up",
          },
        },
        required: ["telegram_user_id"],
      },
      handler: async (args) => {
        const members = getAllMembers();
        for (const m of members) {
          if (
            m.data.telegram_user_id &&
            String(m.data.telegram_user_id) === String(args.telegram_user_id)
          ) {
            return JSON.stringify(
              { name: m.data.name, role: m.data.role || "unknown" },
              null,
              2
            );
          }
        }
        return {
          textResultForLlm: `No family member found with Telegram user ID "${args.telegram_user_id}".`,
          resultType: "failure",
        };
      },
    },
  ],
});
