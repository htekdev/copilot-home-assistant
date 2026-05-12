---
name: research-tools
description: >
  Search and research tool priority hierarchy — which tools to use for web research, code lookup,
  and information gathering. Exa and Perplexity are PRIMARY. web_search/web_fetch are LAST RESORT.
  Use when any agent needs to search the web, research a topic, look up code examples, investigate
  a technology, or gather information from external sources. Trigger phrases: "search for", "look up",
  "research this", "find out", "investigate", "what is", "how does", "code example".
---

# Research Tools Skill — Search Priority Hierarchy

## Why This Exists

The platform has multiple search/research tools available. Some are dramatically better than others. This skill enforces the correct priority so agents always use the best tools first.

**CRITICAL RULE (from {{PARENT_1}}, 2026-05-11):** `web_search` and `web_fetch` frequently fail and return poor results. They are LAST RESORT only. Always prefer Exa and Perplexity.

---

## Tool Priority — MANDATORY

Every agent performing ANY web research MUST follow this hierarchy. Use tools in order of preference — only fall to the next tier if the higher tier doesn't have what you need.

### Tier 1 — PRIMARY (Use These First)

| Tool | Best For | Example |
|------|----------|---------|
| `perplexity-search` | Quick factual answers with citations | "What Android API level does PocketMCP require?" |
| `perplexity-reason` | Complex questions needing multi-step reasoning | "Compare React Native vs Kotlin for MCP server app" |
| `perplexity-deep_research` | Deep investigation (15s-3min) | "Comprehensive analysis of mobile MCP server approaches" |
| `exa-web_search_exa` | Clean web results, semantic search | "Android app that exposes phone as MCP server" |
| `exa-crawling_exa` | Read full page content from URLs | Read a specific {{EMPLOYER_PARENT}} README or docs page |
| `exa-get_code_context_exa` | Code examples, API docs, SDK usage | "Termux API Node.js HTTP server example" |
| `exa-web_search_advanced_exa` | Filtered search (date, domain, category) | Search only {{EMPLOYER_PARENT}} repos for MCP servers |

### Tier 2 — SPECIALIZED (Use for Specific Domains)

| Tool | Best For | Example |
|------|----------|---------|
| `github-mcp-server-search_code` | Search code across {{EMPLOYER_PARENT}} repos | Find MCP server implementations |
| `github-mcp-server-get_file_contents` | Read specific files from {{EMPLOYER_PARENT}} repos | Read a repo's README, package.json |
| `github-mcp-server-list_issues` | Check project issues/compatibility | Check PocketMCP compatibility issues |
| `mslearn-microsoft_docs_search` | {{EMPLOYER}}/Azure documentation | Azure AD auth, .NET APIs |
| `mslearn-microsoft_code_sample_search` | {{EMPLOYER}} code samples | Azure SDK examples |

### Tier 3 — LAST RESORT (Only When Tiers 1-2 Fail)

| Tool | When to Use | Why It's Last |
|------|-------------|---------------|
| `web_search` | Only if Exa AND Perplexity both fail | Frequently returns errors or poor results |
| `web_fetch` | Only for specific URLs that Exa crawling can't handle | Raw fetch, no intelligence |

---

## Decision Flowchart

```
Need information?
│
├─ Quick factual question? → perplexity-search
├─ Complex comparison/analysis? → perplexity-reason
├─ Deep multi-angle research? → perplexity-deep_research
├─ Need clean web results? → exa-web_search_exa
├─ Need to read a specific URL? → exa-crawling_exa
├─ Need code examples? → exa-get_code_context_exa
├─ Need {{EMPLOYER_PARENT}} repo details? → github-mcp-server tools
├─ {{EMPLOYER}}/Azure topic? → mslearn tools
└─ Everything above failed? → web_search (last resort)
```

---

## Parallel Research Pattern

For thorough research, launch MULTIPLE tools in parallel:

```
# Good — parallel calls in one response:
perplexity-search("What is PocketMCP minimum Android version?")
exa-web_search_exa("PocketMCP Android MCP server compatibility")
github-mcp-server-search_code("PocketMCP minSdkVersion")
```

This is faster and gives you cross-referenced results.

---

## Anti-Patterns

| ❌ Don't Do This | ✅ Do This Instead |
|---|---|
| Start with `web_search` | Start with `perplexity-search` or `exa-web_search_exa` |
| Use `web_fetch` to read {{EMPLOYER_PARENT}} files | Use `github-mcp-server-get_file_contents` |
| Use `web_fetch` to read any URL | Use `exa-crawling_exa` (cleaner extraction) |
| Use only one search tool | Parallel search with 2-3 tools for cross-referencing |
| Search without checking {{EMPLOYER_PARENT}} MCP tools | For code/repos, ALWAYS check {{EMPLOYER_PARENT}} MCP first |
| Use `web_search` for {{EMPLOYER}} docs | Use `mslearn-microsoft_docs_search` |

---

## Which Agents Must Follow This

**ALL agents.** This is a platform-wide standard. Any agent that performs web research, code lookup, or external information gathering must follow this hierarchy. This includes but is not limited to:

- Research agents (explore, research agent types)
- Domain agents doing investigation (coding-agent, content-manager, etc.)
- Health/medical agents using research-grounded-advice skill
- Any agent using web tools for any purpose

---

## ⚠️ Sub-Agent MCP Tool Availability (CRITICAL — 2026-05-11)

**MCP server tools (Perplexity, Exa, {{EMPLOYER_PARENT}} MCP, MS Learn) do NOT propagate to sub-agents launched via the `task` tool.** These tools are only available in the main CLI session.

### If you're running as a sub-agent (launched via `task` tool):

1. **Do NOT search for MCP tools** with `tool_search_tool_regex` — they won't be there
2. **Do NOT try to call** `perplexity-search`, `exa-web_search_exa`, etc. — they will fail
3. **Use `web_fetch`** as your primary research tool — it IS available in sub-agents
4. **Use `grep`/`glob`/`view`** for codebase research — always available
5. **Use the `research` agent type** via `task` tool for delegation if you need thorough web research

### How to detect if you're a sub-agent:
- If `tool_search_tool_regex` for "perplexity" returns zero results, you're a sub-agent
- If you were launched with a specific agent_type prompt, you're a sub-agent

### Sub-agent research priority:
1. `grep`/`glob`/`view` (local codebase) — always try first
2. `web_fetch` (specific URLs) — available everywhere
3. Delegate to `research` agent type via `task` tool — for thorough web research
