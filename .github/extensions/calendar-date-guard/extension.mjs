/**
 * Calendar Date Guard Extension for {{PRODUCT}} CLI
 *
 * Prevents calendar events from being created with a date whose day-of-week
 * does not match the user's stated intent, and blocks event creation when the
 * prompt's date intent is explicitly ambiguous.
 *
 * Created after the baby shower was mistakenly scheduled on Sunday instead of
 * Saturday. Hookflow-first governance: date mistakes get deterministic guards.
 */
import { joinSession } from "@{{EMPLOYER_PARENT}}/copilot-sdk/extension";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const WEEKDAY_PATTERN = /\b(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/gi;
const AMBIGUITY_PATTERN = /\b(i think|not sure|unsure|i forget|maybe confirm|confirm with|double[- ]check|need to confirm)\b/i;
const CORRECTION_PATTERNS = [
  /instead of\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i,
  /\bcorrect(?:[^\n\.]{0,120})?\bon\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i,
  /\bcreate(?:[^\n\.]{0,120})?\bon\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i,
  /\bmove(?:[^\n\.]{0,120})?\bto\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i,
  /\breschedule(?:[^\n\.]{0,120})?\bto\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i,
  /\bon\s+(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i,
];

let latestPromptIntent = null;

function normalizeWeekday(token) {
  if (!token) return null;
  const normalized = token.toLowerCase();
  if (["sun", "sunday"].includes(normalized)) return "Sunday";
  if (["mon", "monday"].includes(normalized)) return "Monday";
  if (["tue", "tues", "tuesday"].includes(normalized)) return "Tuesday";
  if (["wed", "wednesday"].includes(normalized)) return "Wednesday";
  if (["thu", "thur", "thurs", "thursday"].includes(normalized)) return "Thursday";
  if (["fri", "friday"].includes(normalized)) return "Friday";
  if (["sat", "saturday"].includes(normalized)) return "Saturday";
  return null;
}

function uniqueWeekdays(prompt) {
  const found = [];
  const seen = new Set();
  let match;
  while ((match = WEEKDAY_PATTERN.exec(prompt)) !== null) {
    const day = normalizeWeekday(match[0]);
    if (day && !seen.has(day)) {
      seen.add(day);
      found.push(day);
    }
  }
  WEEKDAY_PATTERN.lastIndex = 0;
  return found;
}

function extractPromptIntent(prompt) {
  if (!prompt || typeof prompt !== "string") {
    return { weekdays: [], targetWeekday: null, ambiguous: false };
  }

  const weekdays = uniqueWeekdays(prompt);
  let targetWeekday = null;
  for (const pattern of CORRECTION_PATTERNS) {
    const match = prompt.match(pattern);
    if (match) {
      targetWeekday = normalizeWeekday(match[1]);
      break;
    }
  }

  const explicitOrPattern = /\b(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b\s+or\s+\b(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/i;
  const ambiguous = !targetWeekday && ((weekdays.length > 1 && explicitOrPattern.test(prompt)) || AMBIGUITY_PATTERN.test(prompt));

  return {
    weekdays,
    targetWeekday,
    ambiguous,
  };
}

function getWeekdayFromStart(start) {
  if (!start || typeof start !== "string") return null;
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return null;
  return DAY_NAMES[date.getDay()];
}

function buildDenyMessage(reason, expectedWeekday, actualWeekday, start) {
  const lines = [
    `🚫 BLOCKED: ${reason}`,
    "",
    `Event start: ${start}`,
  ];

  if (expectedWeekday) lines.push(`Expected day: ${expectedWeekday}`);
  if (actualWeekday) lines.push(`Computed day: ${actualWeekday}`);

  lines.push(
    "",
    "Before calling gcal_create_event:",
    "1. Compute the target date via PowerShell",
    "2. Verify it separately with `(Get-Date '<yyyy-mm-dd>').DayOfWeek`",
    "3. If the prompt is ambiguous, clarify first — do not guess",
    "4. If the weekday label and numeric date conflict, fix the date before creating the event",
    "",
    "Calendar date guard enforces {{PARENT_1}}'s no-date-guessing rule."
  );

  return lines.join("\n");
}

await joinSession({
  tools: [],
  hooks: {
    onUserPromptSubmitted: async (input) => {
      latestPromptIntent = extractPromptIntent(input.prompt);

      if (latestPromptIntent.ambiguous) {
        return {
          additionalContext:
            "[calendar-date-guard] The latest prompt contains ambiguous weekday/date intent. Clarify or verify the exact day before any gcal_create_event call.",
        };
      }

      const expectedWeekday = latestPromptIntent.targetWeekday || (latestPromptIntent.weekdays.length === 1 ? latestPromptIntent.weekdays[0] : null);
      if (expectedWeekday) {
        return {
          additionalContext:
            `[calendar-date-guard] The latest prompt expects ${expectedWeekday}. Before any gcal_create_event call, verify the computed date with (Get-Date '<yyyy-mm-dd>').DayOfWeek and ensure it equals ${expectedWeekday}.`,
        };
      }
    },

    onPreToolUse: async (input) => {
      if (input.toolName !== "gcal_create_event") return;

      const start = String(input.toolArgs?.start || "");
      const actualWeekday = getWeekdayFromStart(start);
      if (!actualWeekday) return;

      const toolLevelIntent = extractPromptIntent(
        [input.toolArgs?.summary, input.toolArgs?.description].filter(Boolean).join("\n")
      );
      const activeIntent = latestPromptIntent && (
        latestPromptIntent.ambiguous ||
        latestPromptIntent.targetWeekday ||
        latestPromptIntent.weekdays.length > 0
      ) ? latestPromptIntent : toolLevelIntent;

      if (!activeIntent) return;

      if (activeIntent.ambiguous) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason: buildDenyMessage(
            "User prompt is ambiguous about the intended day/date for this calendar event.",
            activeIntent.targetWeekday,
            actualWeekday,
            start
          ),
        };
      }

      const expectedWeekday = activeIntent.targetWeekday || (activeIntent.weekdays.length === 1 ? activeIntent.weekdays[0] : null);
      if (expectedWeekday && expectedWeekday !== actualWeekday) {
        return {
          permissionDecision: "deny",
          permissionDecisionReason: buildDenyMessage(
            "The event date does not match the weekday requested in the latest user prompt.",
            expectedWeekday,
            actualWeekday,
            start
          ),
        };
      }

      return { permissionDecision: "allow" };
    },

    onSessionStart: async () => ({
      additionalContext:
        "[calendar-date-guard] Extension loaded — gcal_create_event calls are blocked when the computed date's weekday mismatches the latest user prompt, when weekday intent is ambiguous, or when a weekday label/date mismatch has not been corrected.",
    }),
  },
});
