import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENV_FILE = resolve(REPO_ROOT, ".env");
const LOCATIONS_FILE = resolve(REPO_ROOT, "data", "locations.json");

// --- Helpers ---

function loadEnv() {
  try {
    const raw = readFileSync(ENV_FILE, "utf-8");
    const vars = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      vars[key] = val;
    }
    return vars;
  } catch {
    return {};
  }
}

function loadLocations() {
  try {
    const raw = readFileSync(LOCATIONS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { home: { name: "Home", address: "" }, places: [] };
  }
}

function resolvePlace(input) {
  const data = loadLocations();
  const normalized = input.trim().toLowerCase();

  if (normalized === "home") {
    return data.home?.address || input;
  }

  const places = data.places || [];
  const match = places.find((p) => {
    const nameMatch = p.name.toLowerCase() === normalized;
    const idMatch = p.id === normalized;
    const partialName = p.name.toLowerCase().includes(normalized);
    const partialId = (p.id || "").includes(normalized);
    return nameMatch || idMatch || partialName || partialId;
  });

  return match ? match.address : input;
}

function resolvePlaceName(input) {
  const data = loadLocations();
  const normalized = input.trim().toLowerCase();

  if (normalized === "home") {
    return data.home?.name || "Home";
  }

  const places = data.places || [];
  const match = places.find((p) => {
    const nameMatch = p.name.toLowerCase() === normalized;
    const idMatch = p.id === normalized;
    const partialName = p.name.toLowerCase().includes(normalized);
    const partialId = (p.id || "").includes(normalized);
    return nameMatch || idMatch || partialName || partialId;
  });

  return match ? match.name : input;
}

function stripHtml(text) {
  return text
    .replace(/<div[^>]*>/gi, "\n")
    .replace(/<\/div>/gi, "")
    .replace(/<b>/gi, "**")
    .replace(/<\/b>/gi, "**")
    .replace(/<wbr\s*\/?>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatDuration(text) {
  return text
    .replace(/\bhours?\b/g, "hr")
    .replace(/\bminutes?\b/g, "min")
    .replace(/\bseconds?\b/g, "sec");
}

function getApiKey() {
  const env = loadEnv();
  return env.GOOGLE_MAPS_API_KEY || "";
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Maps API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// --- Tool handlers ---

async function handleGetDriveTime({ origin, destination }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: "GOOGLE_MAPS_API_KEY not configured in .env file." };
  }

  const originAddr = resolvePlace(origin);
  const destAddr = resolvePlace(destination);
  const originName = resolvePlaceName(origin);
  const destName = resolvePlaceName(destination);

  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", originAddr);
  url.searchParams.set("destinations", destAddr);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("departure_time", "now");

  const data = await fetchJson(url.toString());

  if (data.status !== "OK") {
    return { error: `API error: ${data.status} — ${data.error_message || "Unknown error"}` };
  }

  const row = data.rows?.[0];
  const element = row?.elements?.[0];

  if (!element || element.status !== "OK") {
    return { error: `Could not calculate route: ${element?.status || "No results"}` };
  }

  const duration = element.duration_in_traffic || element.duration;
  const distance = element.distance;
  const durationText = formatDuration(duration.text);
  const distanceText = distance.text;

  const trafficNote = element.duration_in_traffic
    ? ` (with traffic)`
    : "";

  const formatted = `🚗 ${originName} → ${destName}: **${durationText}** (${distanceText})${trafficNote}`;

  return {
    formatted,
    origin: { name: originName, address: originAddr },
    destination: { name: destName, address: destAddr },
    duration: { text: durationText, seconds: duration.value },
    distance: { text: distanceText, meters: distance.value },
    hasTrafficData: !!element.duration_in_traffic,
  };
}

async function handleGetDirections({ origin, destination, waypoints }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: "GOOGLE_MAPS_API_KEY not configured in .env file." };
  }

  const originAddr = resolvePlace(origin);
  const destAddr = resolvePlace(destination);
  const originName = resolvePlaceName(origin);
  const destName = resolvePlaceName(destination);

  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", originAddr);
  url.searchParams.set("destination", destAddr);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("departure_time", "now");

  if (waypoints) {
    const resolved = waypoints
      .split(",")
      .map((w) => resolvePlace(w.trim()))
      .join("|");
    url.searchParams.set("waypoints", resolved);
  }

  const data = await fetchJson(url.toString());

  if (data.status !== "OK") {
    return { error: `API error: ${data.status} — ${data.error_message || "Unknown error"}` };
  }

  const route = data.routes?.[0];
  if (!route) {
    return { error: "No route found." };
  }

  const legs = route.legs || [];
  let totalSeconds = 0;
  let totalMeters = 0;
  for (const leg of legs) {
    totalSeconds += (leg.duration_in_traffic || leg.duration).value;
    totalMeters += leg.distance.value;
  }

  const totalMin = Math.round(totalSeconds / 60);
  const totalMiles = (totalMeters / 1609.344).toFixed(1);
  const summary = route.summary || "";

  const steps = [];
  for (const leg of legs) {
    for (const step of leg.steps || []) {
      const instruction = stripHtml(step.html_instructions);
      const dist = step.distance?.text || "";
      const dur = formatDuration(step.duration?.text || "");
      steps.push(`${instruction} (${dist}, ${dur})`);
    }
  }

  const header = `🧭 **${originName} → ${destName}**\n` +
    `📍 via ${summary}\n` +
    `⏱️ ${totalMin} min · ${totalMiles} mi\n`;

  const stepsFormatted = steps.map((s, i) => `${i + 1}. ${s}`).join("\n");

  return {
    formatted: `${header}\n${stepsFormatted}`,
    summary,
    totalDuration: { text: `${totalMin} min`, seconds: totalSeconds },
    totalDistance: { text: `${totalMiles} mi`, meters: totalMeters },
    steps,
    origin: { name: originName, address: originAddr },
    destination: { name: destName, address: destAddr },
  };
}

async function handlePlanRoute({ stops }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: "GOOGLE_MAPS_API_KEY not configured in .env file." };
  }

  const stopList = stops.split(",").map((s) => s.trim()).filter(Boolean);

  if (stopList.length < 2) {
    return { error: "Need at least 2 stops to plan a route." };
  }

  const originInput = stopList[0];
  const destInput = stopList[stopList.length - 1];
  const waypointInputs = stopList.slice(1, -1);

  const originAddr = resolvePlace(originInput);
  const destAddr = resolvePlace(destInput);
  const originName = resolvePlaceName(originInput);
  const destName = resolvePlaceName(destInput);

  const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
  url.searchParams.set("origin", originAddr);
  url.searchParams.set("destination", destAddr);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("departure_time", "now");

  if (waypointInputs.length > 0) {
    const resolved = waypointInputs.map((w) => resolvePlace(w)).join("|");
    url.searchParams.set("waypoints", resolved);
  }

  const data = await fetchJson(url.toString());

  if (data.status !== "OK") {
    return { error: `API error: ${data.status} — ${data.error_message || "Unknown error"}` };
  }

  const route = data.routes?.[0];
  if (!route) {
    return { error: "No route found." };
  }

  const legs = route.legs || [];
  let totalSeconds = 0;
  let totalMeters = 0;

  const allNames = [originInput, ...waypointInputs, destInput];
  const legBreakdown = [];

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const dur = leg.duration_in_traffic || leg.duration;
    const dist = leg.distance;
    totalSeconds += dur.value;
    totalMeters += dist.value;

    const fromName = resolvePlaceName(allNames[i]);
    const toName = resolvePlaceName(allNames[i + 1]);

    legBreakdown.push({
      from: fromName,
      to: toName,
      duration: formatDuration(dur.text),
      distance: dist.text,
      durationSeconds: dur.value,
      distanceMeters: dist.value,
    });
  }

  const totalMin = Math.round(totalSeconds / 60);
  const totalMiles = (totalMeters / 1609.344).toFixed(1);

  const header = `🗺️ **Multi-stop route** (${stopList.length} stops)\n` +
    `⏱️ Total: ${totalMin} min · ${totalMiles} mi\n`;

  const legLines = legBreakdown.map(
    (l, i) => `${i + 1}. ${l.from} → ${l.to}: **${l.duration}** (${l.distance})`
  ).join("\n");

  return {
    formatted: `${header}\n${legLines}`,
    totalDuration: { text: `${totalMin} min`, seconds: totalSeconds },
    totalDistance: { text: `${totalMiles} mi`, meters: totalMeters },
    stops: stopList.map((s) => ({ input: s, name: resolvePlaceName(s), address: resolvePlace(s) })),
    legs: legBreakdown,
  };
}

// --- Extension setup ---

const DRIVE_KEYWORDS = [
  "driving", "directions", "commute", "route", "how long",
  "how far", "leave by", "drive time", "drive to", "navigate",
  "eta", "traffic", "distance",
];

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      const apiKey = getApiKey();
      const locations = loadLocations();
      const placeCount = (locations.places || []).length;
      const keyStatus = apiKey ? "✅ configured" : "❌ not configured";

      return {
        additionalContext:
          `[google-maps] Google Maps extension active.\n` +
          `- API key: ${keyStatus}\n` +
          `- Saved locations: ${placeCount} places + home\n` +
          `- Tools: get_drive_time, get_directions, plan_route`,
      };
    },

    onUserPromptSubmitted: async (input) => {
      const msg = (input.userPrompt || "").toLowerCase();
      const matched = DRIVE_KEYWORDS.some((kw) => msg.includes(kw));
      if (matched) {
        return {
          additionalContext:
            `[google-maps] Drive time tools available. Use get_drive_time for quick estimates, ` +
            `get_directions for turn-by-turn, or plan_route for multi-stop trips. ` +
            `Saved locations can be referenced by name (e.g., "home", "soccer", "dentist").`,
        };
      }
    },
  },

  tools: [
    {
      name: "get_drive_time",
      description:
        "Get driving time and distance between two locations. " +
        "Origin and destination can be addresses or saved location names (e.g., 'home', 'soccer', 'dentist').",
      parameters: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description: "Starting location — address or saved place name",
          },
          destination: {
            type: "string",
            description: "Ending location — address or saved place name",
          },
        },
        required: ["origin", "destination"],
      },
      handler: async (params) => {
        const result = await handleGetDriveTime(params);
        return JSON.stringify(result, null, 2);
      },
    },
    {
      name: "get_directions",
      description:
        "Get turn-by-turn driving directions between two locations. " +
        "Supports optional waypoints for intermediate stops. " +
        "All locations can be addresses or saved place names.",
      parameters: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description: "Starting location — address or saved place name",
          },
          destination: {
            type: "string",
            description: "Ending location — address or saved place name",
          },
          waypoints: {
            type: "string",
            description: "Optional comma-separated intermediate stops",
          },
        },
        required: ["origin", "destination"],
      },
      handler: async (params) => {
        const result = await handleGetDirections(params);
        return JSON.stringify(result, null, 2);
      },
    },
    {
      name: "plan_route",
      description:
        "Plan an optimized multi-stop route. Provide a comma-separated list of stops — " +
        "first is the starting point, last is the final destination. " +
        "All stops can be addresses or saved place names. " +
        'Example: "home, grocery store, school, dentist, gym, home"',
      parameters: {
        type: "object",
        properties: {
          stops: {
            type: "string",
            description:
              "Comma-separated list of stops in order (e.g., 'home, soccer, dentist, home')",
          },
        },
        required: ["stops"],
      },
      handler: async (params) => {
        const result = await handlePlanRoute(params);
        return JSON.stringify(result, null, 2);
      },
    },
  ],
});
