import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DATA_FILE = resolve(REPO_ROOT, "data", "locations.json");

const VALID_CATEGORIES = [
  "auto", "medical", "school", "sports", "shopping",
  "dining", "church", "work", "family", "other",
];

const LOCATION_KEYWORDS = [
  "address", "location", "where is", "directions", "drive to", "how far",
];

const DEFAULT_DATA = {
  home: { name: "Home", address: "" },
  places: [],
};

// --- Helpers ---

function loadLocations() {
  try {
    const raw = readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
}

function saveLocations(data) {
  const dir = dirname(DATA_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// --- Load data at startup ---

const locations = loadLocations();

// --- Join session ---

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      const placeCount = locations.places.length;
      const homeAddr = locations.home.address || "(not set)";
      return {
        additionalContext:
          `[locations] Extension loaded. Home address: ${homeAddr}. ` +
          `${placeCount} saved place${placeCount === 1 ? "" : "s"}.`,
      };
    },

    onUserPromptSubmitted: async (input) => {
      const text = (input.userPrompt || "").toLowerCase();
      const mentioned = LOCATION_KEYWORDS.some((kw) => text.includes(kw));
      if (mentioned) {
        return {
          additionalContext:
            "[locations] When creating calendar events or tasks with locations, " +
            "always use add_location to save new places for future reference, " +
            "and include the address in the calendar event via gcal_update_event " +
            "or gcal_create_event.",
        };
      }
    },
  },

  tools: [
    // 1. add_location
    {
      name: "add_location",
      description:
        "Save a new frequently-used location/place for the Rocha family.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Place name (e.g. 'Pediatrician - Dr. Smith')" },
          address: { type: "string", description: "Full street address" },
          category: {
            type: "string",
            description: `Category: ${VALID_CATEGORIES.join(", ")}`,
            enum: VALID_CATEGORIES,
          },
          notes: { type: "string", description: "Optional notes about this place" },
        },
        required: ["name", "address"],
      },
      handler: async ({ name, address, category, notes }) => {
        const data = loadLocations();
        const id = slugify(name);

        if (data.places.some((p) => p.id === id)) {
          return { result: `Location with ID "${id}" already exists. Use update_location to modify it.` };
        }

        const place = {
          id,
          name,
          address,
          category: VALID_CATEGORIES.includes(category) ? category : "other",
          notes: notes || "",
        };

        data.places.push(place);
        saveLocations(data);

        return {
          result: `Saved location: **${name}** (${place.category})\nAddress: ${address}\nID: ${id}`,
        };
      },
    },

    // 2. find_location
    {
      name: "find_location",
      description:
        "Search saved family locations by name or category.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Partial name match (case-insensitive)" },
          category: {
            type: "string",
            description: `Filter by category: ${VALID_CATEGORIES.join(", ")}`,
            enum: VALID_CATEGORIES,
          },
        },
      },
      handler: async ({ query, category }) => {
        const data = loadLocations();
        let results = data.places;

        if (category) {
          results = results.filter((p) => p.category === category);
        }
        if (query) {
          const q = query.toLowerCase();
          results = results.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              p.address.toLowerCase().includes(q),
          );
        }

        if (results.length === 0) {
          return { result: "No matching locations found." };
        }

        const lines = results.map(
          (p) =>
            `• **${p.name}** [${p.category}]\n  ${p.address}${p.notes ? `\n  _${p.notes}_` : ""}\n  ID: ${p.id}`,
        );

        const homeInfo = `🏠 Home: ${data.home.address || "(not set)"}`;
        return { result: `${homeInfo}\n\n${lines.join("\n\n")}` };
      },
    },

    // 3. update_location
    {
      name: "update_location",
      description:
        "Update an existing saved location's name, address, category, or notes.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Location ID (slug)" },
          name: { type: "string", description: "New name" },
          address: { type: "string", description: "New address" },
          category: {
            type: "string",
            description: `New category: ${VALID_CATEGORIES.join(", ")}`,
            enum: VALID_CATEGORIES,
          },
          notes: { type: "string", description: "New notes" },
        },
        required: ["id"],
      },
      handler: async ({ id, name, address, category, notes }) => {
        const data = loadLocations();
        const place = data.places.find((p) => p.id === id);

        if (!place) {
          return { result: `Location "${id}" not found. Use find_location to search.` };
        }

        if (name !== undefined) place.name = name;
        if (address !== undefined) place.address = address;
        if (category !== undefined && VALID_CATEGORIES.includes(category)) {
          place.category = category;
        }
        if (notes !== undefined) place.notes = notes;

        saveLocations(data);
        return {
          result: `Updated **${place.name}** (${place.category})\nAddress: ${place.address}\nID: ${place.id}`,
        };
      },
    },

    // 4. remove_location
    {
      name: "remove_location",
      description: "Delete a saved location by ID.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Location ID (slug) to remove" },
        },
        required: ["id"],
      },
      handler: async ({ id }) => {
        const data = loadLocations();
        const idx = data.places.findIndex((p) => p.id === id);

        if (idx === -1) {
          return { result: `Location "${id}" not found.` };
        }

        const removed = data.places.splice(idx, 1)[0];
        saveLocations(data);
        return { result: `Removed **${removed.name}** (${removed.address}).` };
      },
    },

    // 5. set_home_address
    {
      name: "set_home_address",
      description: "Set or update the family home address.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Full home street address" },
        },
        required: ["address"],
      },
      handler: async ({ address }) => {
        const data = loadLocations();
        data.home.address = address;
        saveLocations(data);
        return { result: `🏠 Home address updated to: ${address}` };
      },
    },
  ],
});
