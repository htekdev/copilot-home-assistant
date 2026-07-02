/**
 * Agent Identity Client — Shared Library
 *
 * Any extension can import this to check which agent is running in a given session.
 * Reads the identity map from `data/agent-identity-map.json` (written by agent-identity extension).
 *
 * Usage:
 *   import { getCallerIdentity, getIdentityMap, isAgentType, requireAgentType } from '../shared/agent-identity-client.mjs';
 *
 *   const identity = getCallerIdentity(sessionId);
 *   // → { agent_type, agent_name, agent_id, launched_at, bound_at } or null
 *
 *   if (isAgentType(sessionId, 'merge-agent')) { ... }
 *
 *   requireAgentType(sessionId, ['blog-reviewer', 'code-review']);
 *   // → throws AgentIdentityError if caller is not one of the allowed types
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAP_PATH = resolve(process.cwd(), "data", "agent-identity-map.json");

/**
 * Custom error for agent identity enforcement failures.
 */
export class AgentIdentityError extends Error {
  constructor(message, { sessionId, actualType, allowedTypes } = {}) {
    super(message);
    this.name = "AgentIdentityError";
    this.sessionId = sessionId;
    this.actualType = actualType;
    this.allowedTypes = allowedTypes;
  }
}

/**
 * Reads the current identity map from disk.
 * Returns a plain object { sessionId: identityEntry } or empty object on failure.
 */
export function getIdentityMap() {
  try {
    const raw = readFileSync(MAP_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Get the identity of the agent running in the given session.
 * @param {string} sessionId - The session ID to look up
 * @returns {{ agent_type: string, agent_name: string, agent_id: string, launched_at: string, bound_at: string, first_tool?: string, ambiguous?: boolean, candidates?: string[] } | null}
 */
export function getCallerIdentity(sessionId) {
  if (!sessionId) return null;
  const map = getIdentityMap();
  return map[sessionId] || null;
}

/**
 * Check if the agent in this session matches a specific type.
 * @param {string} sessionId
 * @param {string} type - e.g. 'merge-agent', 'blog-reviewer'
 * @returns {boolean}
 */
export function isAgentType(sessionId, type) {
  const identity = getCallerIdentity(sessionId);
  if (!identity) return false;
  return identity.agent_type === type;
}

/**
 * Enforce that the caller is one of the allowed agent types.
 * Throws AgentIdentityError if:
 * - No identity found for this session
 * - The agent_type is not in the allowedTypes list
 *
 * @param {string} sessionId
 * @param {string[]} allowedTypes - Array of permitted agent_type values
 * @returns {{ agent_type: string, agent_name: string, agent_id: string }} - The identity on success
 * @throws {AgentIdentityError}
 */
export function requireAgentType(sessionId, allowedTypes) {
  const identity = getCallerIdentity(sessionId);

  if (!identity) {
    throw new AgentIdentityError(
      `Agent identity not found for session. Only these agent types are allowed: [${allowedTypes.join(", ")}]`,
      { sessionId, actualType: null, allowedTypes }
    );
  }

  if (identity.ambiguous) {
    throw new AgentIdentityError(
      `Agent identity is ambiguous (parallel launch). Cannot verify authorization. Allowed: [${allowedTypes.join(", ")}]`,
      { sessionId, actualType: "ambiguous", allowedTypes }
    );
  }

  if (!allowedTypes.includes(identity.agent_type)) {
    throw new AgentIdentityError(
      `Agent type "${identity.agent_type}" is not authorized. Allowed: [${allowedTypes.join(", ")}]`,
      { sessionId, actualType: identity.agent_type, allowedTypes }
    );
  }

  return identity;
}
