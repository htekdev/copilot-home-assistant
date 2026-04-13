import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { joinSession } from "@github/copilot-sdk/extension";

const REPO_ROOT = resolve(
  dirname(import.meta.url.replace("file:///", "")),
  "..",
  "..",
  ".."
);
const MEAL_PLANS_DIR = resolve(REPO_ROOT, "data", "meal-plans");
const RECIPES_DIR = resolve(REPO_ROOT, "data", "recipes");

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const MEALS = ["breakfast", "lunch", "dinner", "snacks"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return formatDate(monday);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getWeekFilePath(weekStart) {
  return resolve(MEAL_PLANS_DIR, `week-${weekStart}.json`);
}

function createEmptyPlan(weekStart) {
  const emptyDay = () => ({
    breakfast: "",
    lunch: "",
    dinner: "",
    snacks: "",
  });
  return {
    week_start: weekStart,
    days: Object.fromEntries(DAYS.map((d) => [d, emptyDay()])),
    notes: "",
  };
}

async function ensureDir(dir) {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function loadMealPlan(weekStart) {
  await ensureDir(MEAL_PLANS_DIR);
  const filePath = getWeekFilePath(weekStart);
  if (!existsSync(filePath)) {
    return createEmptyPlan(weekStart);
  }
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

async function saveMealPlan(weekStart, plan) {
  await ensureDir(MEAL_PLANS_DIR);
  const filePath = getWeekFilePath(weekStart);
  await writeFile(filePath, JSON.stringify(plan, null, 2) + "\n", "utf-8");
}

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getRecipeFilePath(slug) {
  return resolve(RECIPES_DIR, `${slug}.json`);
}

async function loadAllRecipes() {
  await ensureDir(RECIPES_DIR);
  const files = (await readdir(RECIPES_DIR)).filter((f) => f.endsWith(".json"));
  const recipes = [];
  for (const file of files) {
    try {
      const raw = await readFile(resolve(RECIPES_DIR, file), "utf-8");
      recipes.push(JSON.parse(raw));
    } catch {
      // skip malformed files
    }
  }
  return recipes;
}

function parseArray(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    if (input.includes("\n")) return input.split("\n").map((s) => s.trim()).filter(Boolean);
    return input.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function parseTags(input) {
  if (Array.isArray(input)) return input.map((t) => t.trim().toLowerCase());
  if (typeof input === "string") {
    return input
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function formatMealPlan(plan) {
  const lines = [`🍽️  Meal Plan — Week of ${plan.week_start}`, ""];
  for (const day of DAYS) {
    const d = plan.days[day] || {};
    const label = day.charAt(0).toUpperCase() + day.slice(1);
    lines.push(`**${label}**`);
    for (const meal of MEALS) {
      const icon =
        meal === "breakfast" ? "🌅" :
        meal === "lunch" ? "☀️" :
        meal === "dinner" ? "🌙" : "🍎";
      const value = d[meal] || "—";
      lines.push(`  ${icon} ${meal.charAt(0).toUpperCase() + meal.slice(1)}: ${value}`);
    }
    lines.push("");
  }
  if (plan.notes) {
    lines.push(`📝 Notes: ${plan.notes}`);
  }
  return lines.join("\n");
}

function recipeMatchesQuery(recipe, query) {
  const q = query.toLowerCase();
  if (recipe.name.toLowerCase().includes(q)) return true;
  if (recipe.tags && recipe.tags.some((t) => t.toLowerCase().includes(q))) return true;
  if (recipe.ingredients && recipe.ingredients.some((i) => i.toLowerCase().includes(q))) return true;
  return false;
}

function formatRecipeBrief(recipe) {
  const tags = recipe.tags?.length ? ` [${recipe.tags.join(", ")}]` : "";
  const time =
    recipe.prep_time || recipe.cook_time
      ? ` (${[recipe.prep_time, recipe.cook_time].filter(Boolean).join(" + ")})`
      : "";
  return `• ${recipe.name}${tags}${time}`;
}

function formatRecipeFull(recipe) {
  const lines = [
    `# ${recipe.name}`,
    "",
  ];
  if (recipe.prep_time || recipe.cook_time || recipe.servings) {
    const parts = [];
    if (recipe.prep_time) parts.push(`Prep: ${recipe.prep_time}`);
    if (recipe.cook_time) parts.push(`Cook: ${recipe.cook_time}`);
    if (recipe.servings) parts.push(`Servings: ${recipe.servings}`);
    lines.push(parts.join(" | "));
    lines.push("");
  }
  if (recipe.tags?.length) {
    lines.push(`Tags: ${recipe.tags.join(", ")}`);
    lines.push("");
  }
  lines.push("## Ingredients");
  for (const ing of recipe.ingredients || []) {
    lines.push(`- ${ing}`);
  }
  lines.push("");
  lines.push("## Instructions");
  for (let i = 0; i < (recipe.instructions || []).length; i++) {
    lines.push(`${i + 1}. ${recipe.instructions[i]}`);
  }
  if (recipe.notes) {
    lines.push("");
    lines.push(`📝 ${recipe.notes}`);
  }
  return lines.join("\n");
}

// ── Tool definitions ─────────────────────────────────────────────────────────

const tools = [
  {
    name: "set_meal",
    description:
      "Set a specific meal for a day in the weekly meal plan. " +
      "Creates the week file if it doesn't exist.",
    parameters: {
      type: "object",
      properties: {
        day: {
          type: "string",
          enum: DAYS,
          description: "Day of the week (monday–sunday)",
        },
        meal: {
          type: "string",
          enum: MEALS,
          description: "Meal slot (breakfast, lunch, dinner, snacks)",
        },
        description: {
          type: "string",
          description: "What's being served (e.g. 'Chicken Stir Fry with rice')",
        },
        week_start: {
          type: "string",
          description:
            "Monday of the target week as YYYY-MM-DD. Defaults to current week.",
        },
      },
      required: ["day", "meal", "description"],
    },
    handler: async ({ day, meal, description, week_start }) => {
      const weekStart = week_start || getCurrentWeekStart();
      const normalDay = day.toLowerCase();
      const normalMeal = meal.toLowerCase();

      if (!DAYS.includes(normalDay)) {
        return { error: `Invalid day "${day}". Use: ${DAYS.join(", ")}` };
      }
      if (!MEALS.includes(normalMeal)) {
        return { error: `Invalid meal "${meal}". Use: ${MEALS.join(", ")}` };
      }

      const plan = await loadMealPlan(weekStart);
      plan.days[normalDay][normalMeal] = description;
      await saveMealPlan(weekStart, plan);

      const dayLabel = normalDay.charAt(0).toUpperCase() + normalDay.slice(1);
      const mealLabel = normalMeal.charAt(0).toUpperCase() + normalMeal.slice(1);
      return {
        result: `✅ Set ${dayLabel} ${mealLabel} to "${description}" for week of ${weekStart}.`,
      };
    },
  },

  {
    name: "get_meal_plan",
    description:
      "Get the full weekly meal plan for the current or a specified week.",
    parameters: {
      type: "object",
      properties: {
        week_start: {
          type: "string",
          description:
            "Monday of the target week as YYYY-MM-DD. Defaults to current week.",
        },
      },
      required: [],
    },
    handler: async ({ week_start } = {}) => {
      const weekStart = week_start || getCurrentWeekStart();
      const plan = await loadMealPlan(weekStart);
      const filePath = getWeekFilePath(weekStart);
      const exists = existsSync(filePath);

      return {
        result: exists
          ? formatMealPlan(plan)
          : `No meal plan found for week of ${weekStart}. Here's an empty template:\n\n${formatMealPlan(plan)}`,
      };
    },
  },

  {
    name: "add_recipe",
    description:
      "Save a new recipe to the collection. Ingredients and instructions " +
      "can be arrays or comma/newline-separated strings.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Recipe name (e.g. 'Chicken Stir Fry')",
        },
        ingredients: {
          description:
            "List of ingredients — array or comma-separated string",
        },
        instructions: {
          description:
            "Preparation steps — array or newline-separated string",
        },
        prep_time: { type: "string", description: "Prep time (e.g. '15 min')" },
        cook_time: { type: "string", description: "Cook time (e.g. '20 min')" },
        servings: { type: "number", description: "Number of servings" },
        tags: {
          description:
            "Tags — array or comma-separated (e.g. 'quick, healthy, kid-friendly')",
        },
        notes: { type: "string", description: "Optional notes about this recipe" },
      },
      required: ["name", "ingredients", "instructions"],
    },
    handler: async ({
      name,
      ingredients,
      instructions,
      prep_time,
      cook_time,
      servings,
      tags,
      notes,
    }) => {
      await ensureDir(RECIPES_DIR);
      const slug = slugify(name);
      const filePath = getRecipeFilePath(slug);

      if (existsSync(filePath)) {
        return {
          error:
            `A recipe named "${name}" (${slug}.json) already exists. ` +
            `Delete or rename it first, or use a different name.`,
        };
      }

      const recipe = {
        name,
        slug,
        prep_time: prep_time || "",
        cook_time: cook_time || "",
        servings: servings || 0,
        tags: parseTags(tags),
        ingredients: parseArray(ingredients),
        instructions: parseArray(instructions),
        notes: notes || "",
        created_at: formatDate(new Date()),
      };

      await writeFile(filePath, JSON.stringify(recipe, null, 2) + "\n", "utf-8");
      return {
        result:
          `✅ Recipe "${name}" saved as ${slug}.json\n\n` +
          formatRecipeBrief(recipe),
      };
    },
  },

  {
    name: "search_recipes",
    description:
      "Search saved recipes by name, tags, or ingredients. " +
      "Returns brief summaries of matching recipes.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search term — matches against recipe names, tags, and ingredients",
        },
      },
      required: ["query"],
    },
    handler: async ({ query }) => {
      const recipes = await loadAllRecipes();
      if (recipes.length === 0) {
        return { result: "No recipes saved yet. Use add_recipe to start your collection." };
      }

      const matches = recipes.filter((r) => recipeMatchesQuery(r, query));
      if (matches.length === 0) {
        return {
          result: `No recipes matching "${query}". ${recipes.length} recipe(s) in collection.`,
        };
      }

      const lines = [`Found ${matches.length} recipe(s) matching "${query}":\n`];
      for (const r of matches) {
        lines.push(formatRecipeBrief(r));
      }
      return { result: lines.join("\n") };
    },
  },

  {
    name: "get_recipe",
    description:
      "Get full details of a saved recipe by name (partial match supported).",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Recipe name or partial name to look up",
        },
      },
      required: ["name"],
    },
    handler: async ({ name }) => {
      const recipes = await loadAllRecipes();
      const q = name.toLowerCase();

      // Exact slug match first
      let match = recipes.find((r) => r.slug === slugify(name));
      // Then partial name match
      if (!match) {
        match = recipes.find((r) => r.name.toLowerCase().includes(q));
      }
      // Then broader partial on slug
      if (!match) {
        match = recipes.find((r) => r.slug.includes(q.replace(/\s+/g, "-")));
      }

      if (!match) {
        return {
          result: `No recipe found matching "${name}". Use search_recipes to browse.`,
        };
      }

      return { result: formatRecipeFull(match) };
    },
  },

  {
    name: "generate_grocery_list",
    description:
      "Auto-generate a shopping list from the current week's meal plan. " +
      "Cross-references meals with saved recipes to extract ingredients.",
    parameters: {
      type: "object",
      properties: {
        week_start: {
          type: "string",
          description:
            "Monday of the target week as YYYY-MM-DD. Defaults to current week.",
        },
      },
      required: [],
    },
    handler: async ({ week_start } = {}) => {
      const weekStart = week_start || getCurrentWeekStart();
      const plan = await loadMealPlan(weekStart);
      const recipes = await loadAllRecipes();

      const recipeIndex = new Map();
      for (const r of recipes) {
        recipeIndex.set(r.name.toLowerCase(), r);
        recipeIndex.set(r.slug, r);
      }

      const ingredientMap = new Map();
      const unmatchedMeals = [];

      for (const day of DAYS) {
        const dayPlan = plan.days[day] || {};
        for (const meal of MEALS) {
          const value = (dayPlan[meal] || "").trim();
          if (!value) continue;

          const searchKey = value.toLowerCase();
          const searchSlug = slugify(value);

          const matched = recipeIndex.get(searchKey) || recipeIndex.get(searchSlug);

          if (matched && matched.ingredients?.length) {
            for (const ing of matched.ingredients) {
              const key = ing.toLowerCase().trim();
              if (!ingredientMap.has(key)) {
                ingredientMap.set(key, { text: ing, sources: [] });
              }
              const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
              ingredientMap.get(key).sources.push(`${dayLabel} ${meal}`);
            }
          } else {
            const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
            unmatchedMeals.push(`${dayLabel} ${meal}: ${value}`);
          }
        }
      }

      const lines = [`🛒  Grocery List — Week of ${weekStart}`, ""];

      if (ingredientMap.size > 0) {
        lines.push("## From Recipes");
        const sorted = [...ingredientMap.values()].sort((a, b) =>
          a.text.localeCompare(b.text)
        );
        for (const { text, sources } of sorted) {
          lines.push(`- [ ] ${text}  _(${sources.join(", ")})_`);
        }
      } else {
        lines.push(
          "No ingredients extracted — either no meals are set or no matching recipes found."
        );
      }

      if (unmatchedMeals.length > 0) {
        lines.push("");
        lines.push("## Meals Without Matching Recipes");
        lines.push(
          "_Add these as recipes to auto-extract ingredients next time:_"
        );
        for (const m of unmatchedMeals) {
          lines.push(`- ${m}`);
        }
      }

      return { result: lines.join("\n") };
    },
  },
];

// ── Session ──────────────────────────────────────────────────────────────────

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      const weekStart = getCurrentWeekStart();
      const weekFile = getWeekFilePath(weekStart);
      const hasPlan = existsSync(weekFile);

      let recipeCount = 0;
      try {
        if (existsSync(RECIPES_DIR)) {
          const files = await readdir(RECIPES_DIR);
          recipeCount = files.filter((f) => f.endsWith(".json")).length;
        }
      } catch {
        // directory may not exist yet
      }

      const planStatus = hasPlan
        ? `Meal plan exists for this week (${weekStart}).`
        : `No meal plan yet for this week (${weekStart}).`;

      return {
        additionalContext:
          `[meal-planner] 🍽️ Active. ${planStatus} ` +
          `${recipeCount} recipe(s) saved. ` +
          `Tools: set_meal, get_meal_plan, add_recipe, search_recipes, get_recipe, generate_grocery_list.`,
      };
    },
  },
  tools,
});
