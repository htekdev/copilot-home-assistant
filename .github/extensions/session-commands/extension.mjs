/**
 * Session Commands Extension
 *
 * Exposes session-level commands as tools that agents can call programmatically:
 * - session_compact: Compact the conversation history to free context tokens
 * - session_usage: Get current session token/cost metrics
 * - session_cost_analysis: Analyze cost patterns and provide optimization tips
 *
 * These reimplement the logic behind /compact, /usage, and /chronicle cost-tips
 * as extension tools, working around the fact that extensions cannot invoke
 * slash commands programmatically.
 */

import { joinSession } from "@github/copilot-sdk/extension";

function log(msg) {
  process.stderr.write(`[session-commands] ${msg}\n`);
}

/** Format token counts with comma separators */
function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("en-US") : "N/A";
}

/** Calculate context utilization percentage */
function utilPct(current, limit) {
  if (!limit || !current) return "unknown";
  return `${((current / limit) * 100).toFixed(1)}%`;
}

let sessionRef = null;

await joinSession({
  onRegister(session) {
    sessionRef = session;
    log("registered — session RPC available");
  },
  tools: [
    {
      name: "session_compact",
      description:
        "Compact the current session's conversation history to free context window tokens. " +
        "Equivalent to the /compact slash command. Returns tokens freed, messages removed, " +
        "and current context utilization. Use when context is getting large or before " +
        "starting a new phase of work.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description:
              "Why compaction is being triggered (logged for analytics)",
          },
        },
        additionalProperties: false,
      },
      handler: async ({ reason } = {}) => {
        if (!sessionRef) return "ERROR: session not initialized";
        const why = reason || "programmatic compaction";
        log(`compact requested: ${why}`);

        try {
          const result = await sessionRef.rpc.history.compact();

          if (!result.success) {
            return "Compaction failed — session may be too short to compact or already compact.";
          }

          const lines = [
            `✅ Compaction successful`,
            `   Tokens freed: ${fmt(result.tokensRemoved)}`,
            `   Messages removed: ${fmt(result.messagesRemoved)}`,
          ];

          if (result.contextWindow) {
            const cw = result.contextWindow;
            lines.push(
              `   Context: ${fmt(cw.currentTokens)} / ${fmt(cw.tokenLimit)} tokens (${utilPct(cw.currentTokens, cw.tokenLimit)} utilized)`,
              `   Messages remaining: ${fmt(cw.messageCount)}`
            );
          }

          lines.push(`   Reason: ${why}`);
          return lines.join("\n");
        } catch (err) {
          log(`compact error: ${err.message}`);
          return `ERROR: Compaction failed — ${err.message}`;
        }
      },
    },
    {
      name: "session_usage",
      description:
        "Get current session token usage and cost metrics. Returns per-model breakdown " +
        "of tokens consumed, premium request costs, cache efficiency, code changes, and " +
        "context window health. Equivalent to /usage.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      handler: async () => {
        if (!sessionRef) return "ERROR: session not initialized";

        try {
          const m = await sessionRef.rpc.usage.getMetrics();
          const durationMs = Date.now() - m.sessionStartTime;
          const durationMin = Math.round(durationMs / 60000);
          const durationStr =
            durationMin < 60
              ? `${durationMin}m`
              : `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`;

          const modelLines = [];
          for (const [model, metrics] of Object.entries(m.modelMetrics || {})) {
            const u = metrics.usage;
            const r = metrics.requests;
            const totalTokens = u.inputTokens + u.outputTokens;
            const cacheRate =
              u.inputTokens > 0
                ? ((u.cacheReadTokens / u.inputTokens) * 100).toFixed(0)
                : 0;
            modelLines.push(
              `  ${model}:`,
              `    Requests: ${r.count} (cost: ${r.cost.toFixed(2)} premium reqs)`,
              `    Tokens: ${fmt(totalTokens)} (in: ${fmt(u.inputTokens)}, out: ${fmt(u.outputTokens)})`,
              `    Cache: ${cacheRate}% hit rate (read: ${fmt(u.cacheReadTokens)}, write: ${fmt(u.cacheWriteTokens)})`,
              u.reasoningTokens
                ? `    Reasoning: ${fmt(u.reasoningTokens)} tokens`
                : null
            );
          }

          const lines = [
            `📊 Session Usage Summary`,
            `   Duration: ${durationStr}`,
            `   Total premium cost: ${m.totalPremiumRequestCost.toFixed(2)} requests`,
            `   Total API requests: ${m.totalUserRequests}`,
            `   API time: ${(m.totalApiDurationMs / 1000).toFixed(1)}s`,
            `   Last call: ${fmt(m.lastCallInputTokens)} in / ${fmt(m.lastCallOutputTokens)} out`,
            m.currentModel ? `   Current model: ${m.currentModel}` : null,
            ``,
            `   Code changes: +${m.codeChanges.linesAdded} / -${m.codeChanges.linesRemoved} lines across ${m.codeChanges.filesModifiedCount} files`,
            ``,
            `📈 Per-model breakdown:`,
            ...modelLines,
          ];

          return lines.filter(Boolean).join("\n");
        } catch (err) {
          log(`usage error: ${err.message}`);
          return `ERROR: Could not retrieve usage metrics — ${err.message}`;
        }
      },
    },
    {
      name: "session_cost_analysis",
      description:
        "Analyze the current session's cost patterns and provide optimization recommendations. " +
        "Combines usage metrics with heuristics from the Chronicle cost-tips system to identify " +
        "waste: bloated context, poor cache rates, expensive model usage for simple tasks, and " +
        "opportunities to compact or delegate. Returns actionable tips.",
      parameters: {
        type: "object",
        properties: {
          focus: {
            type: "string",
            description:
              "Optional area to focus analysis on: 'tokens', 'cache', 'models', 'context', or 'all'",
            enum: ["tokens", "cache", "models", "context", "all"],
          },
        },
        additionalProperties: false,
      },
      handler: async ({ focus } = {}) => {
        if (!sessionRef) return "ERROR: session not initialized";
        const area = focus || "all";

        try {
          const m = await sessionRef.rpc.usage.getMetrics();
          const tips = [];
          const warnings = [];
          const durationMin = Math.round((Date.now() - m.sessionStartTime) / 60000);

          let totalInput = 0;
          let totalOutput = 0;
          let totalCacheRead = 0;
          let totalCacheWrite = 0;
          let totalReasoning = 0;

          for (const metrics of Object.values(m.modelMetrics || {})) {
            totalInput += metrics.usage.inputTokens;
            totalOutput += metrics.usage.outputTokens;
            totalCacheRead += metrics.usage.cacheReadTokens;
            totalCacheWrite += metrics.usage.cacheWriteTokens;
            totalReasoning += metrics.usage.reasoningTokens || 0;
          }

          const overallCacheRate =
            totalInput > 0
              ? ((totalCacheRead / totalInput) * 100).toFixed(1)
              : "0";

          if (area === "all" || area === "tokens") {
            const ratio = totalOutput > 0 ? (totalInput / totalOutput).toFixed(1) : "∞";

            if (totalInput > 500000) {
              warnings.push(
                `⚠️  High input token usage: ${fmt(totalInput)} tokens consumed. Consider compacting.`
              );
            }

            if (parseFloat(ratio) > 20) {
              tips.push(
                `💡 Input/output ratio is ${ratio}:1 — you're paying to re-send a large context each turn. ` +
                  `Compact with session_compact or start a fresh session.`
              );
            }

            if (m.lastCallInputTokens > 100000) {
              tips.push(
                `💡 Last API call used ${fmt(m.lastCallInputTokens)} input tokens — context is heavy. ` +
                  `Compact now to reduce subsequent call costs.`
              );
            }
          }

          if (area === "all" || area === "cache") {
            if (parseFloat(overallCacheRate) < 30 && totalInput > 50000) {
              tips.push(
                `💡 Cache hit rate is only ${overallCacheRate}%. This means most of your context is ` +
                  `being re-processed each turn. Stabilize your system prompt and use skills/agents ` +
                  `to reduce context churn.`
              );
            } else if (parseFloat(overallCacheRate) > 70) {
              tips.push(`✅ Cache hit rate is ${overallCacheRate}% — good efficiency.`);
            }
          }

          if (area === "all" || area === "models") {
            const models = Object.entries(m.modelMetrics || {});
            const expensiveForSimple = models.filter(([name, met]) => {
              const avgOutput = met.requests.count > 0 ? met.usage.outputTokens / met.requests.count : 0;
              return (
                (name.includes("opus") || name.includes("gpt-5")) &&
                avgOutput < 500 &&
                met.requests.count > 3
              );
            });

            if (expensiveForSimple.length > 0) {
              const names = expensiveForSimple.map(([n]) => n).join(", ");
              tips.push(
                `💡 Premium model(s) [${names}] used for simple tasks (avg <500 output tokens). ` +
                  `Consider switching to a lighter model for routine work.`
              );
            }

            if (models.length > 1) {
              const breakdown = models
                .map(
                  ([name, met]) =>
                    `  ${name}: ${met.requests.cost.toFixed(1)} reqs, ${fmt(met.usage.inputTokens + met.usage.outputTokens)} tokens`
                )
                .join("\n");
              tips.push(`📊 Model breakdown:\n${breakdown}`);
            }
          }

          if (area === "all" || area === "context") {
            if (durationMin > 120 && m.totalUserRequests > 30) {
              tips.push(
                `💡 Session is ${durationMin}m old with ${m.totalUserRequests} requests. ` +
                  `Long sessions accumulate context debt. Consider compacting or starting fresh.`
              );
            }

            if (m.totalUserRequests > 0) {
              const avgInputPerReq = Math.round(totalInput / m.totalUserRequests);
              if (avgInputPerReq > 80000) {
                warnings.push(
                  `⚠️  Average ${fmt(avgInputPerReq)} input tokens per request — context is bloated.`
                );
              }
            }
          }

          const header = [
            `🔍 Cost Analysis (focus: ${area})`,
            `   Session: ${durationMin}m, ${m.totalUserRequests} requests, ${m.totalPremiumRequestCost.toFixed(2)} premium cost`,
            `   Tokens: ${fmt(totalInput)} in / ${fmt(totalOutput)} out (cache: ${overallCacheRate}%)`,
            ``,
          ];

          if (warnings.length === 0 && tips.length <= 1) {
            tips.push(`✅ Session looks healthy — no major cost concerns detected.`);
          }

          return [
            ...header,
            ...(warnings.length > 0 ? ["⚠️  Warnings:", ...warnings, ""] : []),
            "💡 Recommendations:",
            ...tips,
          ].join("\n");
        } catch (err) {
          log(`cost analysis error: ${err.message}`);
          return `ERROR: Cost analysis failed — ${err.message}`;
        }
      },
    },
  ],
});

log("extension loaded");
