/**
 * Late API Extension for GitHub Copilot CLI
 *
 * Wraps the Late/Zernio API (https://getlate.dev/api/v1) as Copilot tools
 * so agents (especially content-manager) can manage social media scheduling
 * without raw API calls.
 *
 * Requires LATE_API_KEY in .env at the project root.
 */
import { joinSession } from "@github/copilot-sdk/extension";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const ENV_FILE = resolve(REPO_ROOT, ".env");
const BASE_URL = "https://getlate.dev/api/v1";

// ---------------------------------------------------------------------------
// Env loader
// ---------------------------------------------------------------------------
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
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      vars[key] = val;
    }
    return vars;
  } catch {
    return {};
  }
}

function getApiKey() {
  return process.env.LATE_API_KEY || loadEnv().LATE_API_KEY || "";
}

function truncateContent(content, max = 150) {
  const text = typeof content === "string" ? content : "";
  return text.slice(0, max) + (text.length > max ? "…" : "");
}

function parseCursorOffset(cursor) {
  const value = Number.parseInt(cursor || "0", 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function sortCommentRows(rows, sortBy, sortOrder) {
  const direction = String(sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;
  const key = sortBy || "publishedAt";

  return [...rows].sort((a, b) => {
    if (key === "commentCount") {
      return ((a.commentCount || 0) - (b.commentCount || 0)) * direction;
    }

    const aTime = Date.parse(a.publishedAt || "") || 0;
    const bTime = Date.parse(b.publishedAt || "") || 0;
    return (aTime - bTime) * direction;
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

// ---------------------------------------------------------------------------
// HTTP helper with retry + rate-limit handling
// ---------------------------------------------------------------------------
async function lateRequest(path, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: "LATE_API_KEY not configured. Set it in .env" };
  }

  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { ...options, headers });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        return {
          error: `HTTP ${res.status}: ${body}`,
          status: res.status,
        };
      }

      return await res.json();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  return { error: `Request failed after 3 attempts: ${lastError?.message}` };
}

// ---------------------------------------------------------------------------
// Pagination helper — fetches all pages up to a max
// ---------------------------------------------------------------------------
async function fetchAllPages(path, params = {}, maxPages = 10) {
  const allItems = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= maxPages) {
    const qs = new URLSearchParams({ ...params, page: String(page), limit: "100" });
    const data = await lateRequest(`${path}?${qs}`);

    if (data.error) return data;

    const items = data.posts || data.accounts || data.profiles || [];
    allItems.push(...items);

    if (data.pagination) {
      totalPages = data.pagination.pages || 1;
    } else {
      break;
    }
    page++;
  }

  return { items: allItems, total: allItems.length };
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

// ── Queue / Profile Management ──

async function handleListQueues() {
  // Late uses "profiles" as queue containers — list profiles with post counts
  const profiles = await lateRequest("/profiles");
  if (profiles.error) return profiles;

  const result = [];
  for (const profile of profiles.profiles || []) {
    // Get scheduled post count for this profile
    const posts = await lateRequest(
      `/posts?profileId=${profile._id}&status=scheduled&limit=1`
    );
    const scheduledCount = posts.pagination?.total || 0;

    const drafts = await lateRequest(
      `/posts?profileId=${profile._id}&status=draft&limit=1`
    );
    const draftCount = drafts.pagination?.total || 0;

    result.push({
      id: profile._id,
      name: profile.name,
      description: profile.description || "",
      scheduledPosts: scheduledCount,
      draftPosts: draftCount,
      createdAt: profile.createdAt,
    });
  }

  return { queues: result, total: result.length };
}

async function handleGetQueue(params) {
  const { queue_id, status, platform, limit } = params;
  const qs = new URLSearchParams();
  if (queue_id) qs.set("profileId", queue_id);
  if (status) qs.set("status", status);
  else qs.set("status", "scheduled");
  if (platform) qs.set("platform", platform);
  qs.set("limit", String(limit || 50));
  qs.set("page", "1");

  const data = await lateRequest(`/posts?${qs}`);
  if (data.error) return data;

  const posts = (data.posts || []).map(formatPostSummary);
  posts.sort(
    (a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()
  );

  return {
    posts,
    total: data.pagination?.total || posts.length,
    page: data.pagination?.page || 1,
    pages: data.pagination?.pages || 1,
  };
}

async function handleReorderQueue(params) {
  const { queue_id, platform, new_order } = params;
  // new_order is an array of post IDs in desired chronological order.
  // Strategy: collect the scheduledFor dates from current posts, then reassign
  // them to match the new order (swap dates).

  const qs = new URLSearchParams({
    profileId: queue_id || "",
    status: "scheduled",
    limit: "100",
  });
  if (platform) qs.set("platform", platform);

  const data = await lateRequest(`/posts?${qs}`);
  if (data.error) return data;

  const posts = data.posts || [];
  const dateById = {};
  for (const p of posts) {
    dateById[p._id] = p.scheduledFor;
  }

  // Sort current dates chronologically
  const sortedDates = posts
    .map((p) => p.scheduledFor)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  // Map new_order IDs to sorted dates
  const updates = [];
  for (let i = 0; i < new_order.length && i < sortedDates.length; i++) {
    const postId = new_order[i];
    const targetDate = sortedDates[i];
    if (dateById[postId] !== targetDate) {
      updates.push({ id: postId, scheduledFor: targetDate });
    }
  }

  let ok = 0;
  let failed = 0;
  const errors = [];
  for (const update of updates) {
    const res = await lateRequest(`/posts/${update.id}`, {
      method: "PUT",
      body: JSON.stringify({ scheduledFor: update.scheduledFor }),
    });
    if (res.error) {
      failed++;
      errors.push({ id: update.id, error: res.error });
    } else {
      ok++;
    }
    // Small delay to respect rate limits
    await new Promise((r) => setTimeout(r, 300));
  }

  return {
    message: `Reordered ${ok} posts, ${failed} failed`,
    updatesApplied: ok,
    failures: errors,
    totalInQueue: posts.length,
  };
}

// ── Post Management ──

async function handleListPosts(params) {
  const { status, platform, date_from, date_to, queue_id, page, limit } = params;
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (platform) qs.set("platform", platform);
  if (date_from) qs.set("dateFrom", date_from);
  if (date_to) qs.set("dateTo", date_to);
  if (queue_id) qs.set("profileId", queue_id);
  qs.set("page", String(page || 1));
  qs.set("limit", String(limit || 25));

  const data = await lateRequest(`/posts?${qs}`);
  if (data.error) return data;

  return {
    posts: (data.posts || []).map(formatPostSummary),
    pagination: data.pagination || { page: 1, total: 0, pages: 1 },
  };
}

async function handleGetPost(params) {
  const { post_id } = params;
  const data = await lateRequest(`/posts/${post_id}`);
  if (data.error) return data;

  const post = data.post || data;
  return {
    id: post._id,
    content: post.content,
    title: post.title,
    status: post.status,
    scheduledFor: post.scheduledFor,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    platforms: (post.platforms || []).map((p) => ({
      platform: p.platform,
      accountId: typeof p.accountId === "string" ? p.accountId : p.accountId?._id,
      username: p.accountId?.username,
      status: p.status,
      publishedUrl: p.publishedUrl,
      error: p.error,
    })),
    mediaItems: post.mediaItems,
    tags: post.tags,
    hashtags: post.hashtags,
    mentions: post.mentions,
    platformSpecificData: post.platformSpecificData,
    metadata: post.metadata,
  };
}

async function handleReschedulePost(params) {
  const { post_id, scheduled_for, timezone } = params;
  const body = { scheduledFor: scheduled_for };
  if (timezone) body.timezone = timezone;

  const res = await lateRequest(`/posts/${post_id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

  if (res.error) return res;

  return {
    message: "Post rescheduled successfully",
    postId: post_id,
    newScheduledFor: scheduled_for,
    post: formatPostSummary(res.post || res),
  };
}

async function handleMovePost(params) {
  const { post_id, target_queue_id } = params;
  // Moving between queues: update the profile association
  // Late uses queuedFromProfile to assign a post to a profile's queue
  const res = await lateRequest(`/posts/${post_id}`, {
    method: "PUT",
    body: JSON.stringify({ queuedFromProfile: target_queue_id }),
  });

  if (res.error) return res;

  return {
    message: "Post moved to new queue",
    postId: post_id,
    targetQueue: target_queue_id,
    post: formatPostSummary(res.post || res),
  };
}

async function handleCreatePost(params) {
  const {
    content,
    title,
    platforms,
    scheduled_for,
    publish_now,
    is_draft,
    timezone,
    media_items,
    tags,
    hashtags,
    queue_id,
    platform_specific_data,
  } = params;

  const body = {};
  if (content) body.content = content;
  if (title) body.title = title;
  if (platforms) body.platforms = JSON.parse(platforms);
  if (scheduled_for) body.scheduledFor = scheduled_for;
  if (publish_now) body.publishNow = true;
  if (is_draft) body.isDraft = true;
  if (timezone) body.timezone = timezone;
  if (media_items) body.mediaItems = JSON.parse(media_items);
  if (tags) body.tags = JSON.parse(tags);
  if (hashtags) body.hashtags = JSON.parse(hashtags);
  if (queue_id) body.queuedFromProfile = queue_id;
  if (platform_specific_data) {
    // Merge into each platform entry
    const psd = JSON.parse(platform_specific_data);
    if (body.platforms) {
      for (const p of body.platforms) {
        if (psd[p.platform]) {
          p.platformSpecificData = psd[p.platform];
        }
      }
    }
  }

  const res = await lateRequest("/posts", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (res.error) return res;

  return {
    message: res.message || "Post created",
    post: formatPostSummary(res.post || res),
  };
}

async function handleUpdatePost(params) {
  const { post_id, content, title, scheduled_for, tags, hashtags, timezone, is_draft } = params;
  const body = {};
  if (content !== undefined) body.content = content;
  if (title !== undefined) body.title = title;
  if (scheduled_for !== undefined) body.scheduledFor = scheduled_for;
  if (timezone !== undefined) body.timezone = timezone;
  if (tags !== undefined) body.tags = JSON.parse(tags);
  if (hashtags !== undefined) body.hashtags = JSON.parse(hashtags);
  if (is_draft !== undefined) body.isDraft = is_draft;

  const res = await lateRequest(`/posts/${post_id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

  if (res.error) return res;

  return {
    message: is_draft === false ? "Post scheduled (draft → scheduled)" : "Post updated",
    post: formatPostSummary(res.post || res),
  };
}

async function handleDeletePost(params) {
  const { post_id } = params;
  const res = await lateRequest(`/posts/${post_id}`, { method: "DELETE" });
  if (res.error) return res;
  return { message: `Post ${post_id} deleted`, postId: post_id };
}

// ── Platform / Account ──

async function handleListAccounts(params) {
  const qs = new URLSearchParams();
  if (params.profile_id) qs.set("profileId", params.profile_id);

  const data = await lateRequest(`/accounts?${qs}`);
  if (data.error) return data;

  return {
    accounts: (data.accounts || []).map((a) => ({
      id: a._id,
      platform: a.platform,
      username: a.username,
      displayName: a.displayName,
      profileUrl: a.profileUrl,
      isActive: a.isActive,
      profile: a.profileId
        ? { id: a.profileId._id, name: a.profileId.name }
        : null,
    })),
    hasAnalyticsAccess: data.hasAnalyticsAccess || false,
  };
}

async function handleGetAnalytics(params) {
  const { platform, date_from, date_to, account_id } = params;
  const qs = new URLSearchParams();
  if (platform) qs.set("platform", platform);
  if (date_from) qs.set("dateFrom", date_from);
  if (date_to) qs.set("dateTo", date_to);
  if (account_id) qs.set("accountId", account_id);

  const data = await lateRequest(`/analytics?${qs}`);
  if (data.error) return data;
  return data;
}

async function handleAccountHealth(params) {
  const { account_id } = params;
  if (account_id) {
    return await lateRequest(`/accounts/${account_id}/health`);
  }
  return await lateRequest("/accounts/health");
}

async function handleFollowerStats(params) {
  const { account_id, platform } = params;
  const qs = new URLSearchParams();
  if (account_id) qs.set("accountId", account_id);
  if (platform) qs.set("platform", platform);
  return await lateRequest(`/accounts/follower-stats?${qs}`);
}

// ── Failure Handling ──

async function handleListFailures(params) {
  const { platform, page, limit } = params;
  const qs = new URLSearchParams({ status: "failed" });
  if (platform) qs.set("platform", platform);
  qs.set("page", String(page || 1));
  qs.set("limit", String(limit || 25));

  const data = await lateRequest(`/posts?${qs}`);
  if (data.error) return data;

  return {
    failures: (data.posts || []).map((p) => ({
      ...formatPostSummary(p),
      platformErrors: (p.platforms || [])
        .filter((pl) => pl.status === "failed" || pl.error)
        .map((pl) => ({
          platform: pl.platform,
          error: pl.error,
          status: pl.status,
        })),
    })),
    pagination: data.pagination || { page: 1, total: 0, pages: 1 },
  };
}

async function handleRetryPost(params) {
  const { post_id } = params;
  const res = await lateRequest(`/posts/${post_id}/retry`, { method: "POST" });
  if (res.error) return res;
  return {
    message: "Retry initiated",
    postId: post_id,
    post: formatPostSummary(res.post || res),
  };
}

// ── Media Upload ──

async function handlePresignUpload(params) {
  const { filename, content_type, size } = params;
  const body = { filename, contentType: content_type };
  if (size) body.size = size;

  const res = await lateRequest("/media/presign", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (res.error) return res;
  return {
    uploadUrl: res.uploadUrl,
    publicUrl: res.publicUrl,
    key: res.key,
    type: res.type,
    note: "Upload file to uploadUrl via PUT, then use publicUrl in mediaItems when creating a post.",
  };
}

// ── Comment / Inbox Management ──

async function handleListComments(params) {
  const { platform, status, limit, profile_id, account_id, since, sort_by, sort_order, min_comments, cursor } = params;

  if (String(platform || "").toLowerCase() === "youtube") {
    const postsData = await fetchAllPages("/posts", { platform: "youtube", status: "published" }, 20);
    if (postsData.error) return postsData;

    const sinceTs = since ? Date.parse(since) : NaN;
    const publishedPosts = (postsData.items || []).filter((post) => {
      const youtubePlatform = (post.platforms || []).find((entry) => entry.platform === "youtube");
      if (!youtubePlatform) return false;

      const youtubeAccountId = typeof youtubePlatform.accountId === "string"
        ? youtubePlatform.accountId
        : youtubePlatform.accountId?._id;
      if (account_id && youtubeAccountId !== account_id) return false;
      if (profile_id && youtubePlatform.profileId !== profile_id) return false;
      return true;
    });

    const enriched = await mapWithConcurrency(publishedPosts, 8, async (post) => {
      const youtubePlatform = (post.platforms || []).find((entry) => entry.platform === "youtube");
      const youtubeAccountId = typeof youtubePlatform.accountId === "string"
        ? youtubePlatform.accountId
        : youtubePlatform.accountId?._id;
      const platformPostId = youtubePlatform.platformPostId || post.platformPostId || post._id;
      if (!youtubeAccountId || !platformPostId) return null;

      const qs = new URLSearchParams({ accountId: youtubeAccountId, limit: "100" });
      const commentData = await lateRequest(`/inbox/comments/${platformPostId}?${qs}`);
      if (commentData.error) return null;

      const comments = commentData.comments || commentData.data || [];
      const filteredComments = Number.isNaN(sinceTs)
        ? comments
        : comments.filter((comment) => {
            const createdAt = comment.createdTime || comment.createdAt || comment.timestamp;
            const createdTs = Date.parse(createdAt || "");
            return !Number.isNaN(createdTs) && createdTs >= sinceTs;
          });

      const actualCommentCount = filteredComments.length;
      const minimumComments = min_comments || 1;
      if (actualCommentCount < minimumComments) return null;

      return {
        postId: platformPostId,
        content: truncateContent(post.content),
        platform: "youtube",
        accountId: youtubeAccountId,
        commentCount: actualCommentCount,
        publishedAt: youtubePlatform.publishedAt || post.publishedAt,
        publishedUrl: youtubePlatform.platformPostUrl,
      };
    });

    const offset = parseCursorOffset(cursor);
    const sortedPosts = sortCommentRows(enriched.filter(Boolean), sort_by, sort_order);
    const pageSize = limit || 25;
    const pagePosts = sortedPosts.slice(offset, offset + pageSize);
    const nextCursor = offset + pagePosts.length < sortedPosts.length
      ? String(offset + pagePosts.length)
      : undefined;

    return {
      posts: pagePosts,
      cursor: nextCursor,
      total: sortedPosts.length,
      source: "youtube-direct-comment-scan",
    };
  }

  const qs = new URLSearchParams();
  if (platform) qs.set("platform", platform);
  if (status) qs.set("status", status);
  if (profile_id) qs.set("profileId", profile_id);
  if (account_id) qs.set("accountId", account_id);
  if (since) qs.set("since", since);
  if (sort_by) qs.set("sortBy", sort_by);
  if (sort_order) qs.set("sortOrder", sort_order);
  if (min_comments) qs.set("minComments", String(min_comments));
  if (limit) qs.set("limit", String(limit));
  if (cursor) qs.set("cursor", cursor);

  const data = await lateRequest(`/inbox/comments?${qs}`);
  if (data.error) return data;

  return {
    posts: (data.posts || data.data || []).map((p) => ({
      postId: p._id || p.postId,
      content: truncateContent(p.content),
      platform: p.platform,
      accountId: p.accountId,
      commentCount: p.commentCount || p.comments?.length || 0,
      publishedAt: p.publishedAt,
      publishedUrl: p.publishedUrl,
    })),
    cursor: data.cursor || data.nextCursor,
    total: data.total || (data.posts || data.data || []).length,
  };
}

async function handleGetPostComments(params) {
  const { post_id, account_id, limit, cursor, comment_id } = params;
  const qs = new URLSearchParams();
  if (account_id) qs.set("accountId", account_id);
  if (limit) qs.set("limit", String(limit));
  if (cursor) qs.set("cursor", cursor);
  if (comment_id) qs.set("commentId", comment_id);

  const data = await lateRequest(`/inbox/comments/${post_id}?${qs}`);
  if (data.error) return data;

  return {
    comments: (data.comments || data.data || []).map((c) => ({
      id: c._id || c.id || c.commentId,
      author: c.author || c.from || c.user,
      text: c.text || c.message || c.content,
      createdAt: c.createdAt || c.timestamp,
      likeCount: c.likeCount || c.likes || 0,
      replyCount: c.replyCount || c.replies?.length || 0,
      platform: c.platform,
      isHidden: c.isHidden || false,
    })),
    cursor: data.cursor || data.nextCursor,
    total: data.total || (data.comments || data.data || []).length,
  };
}

// ── URL Validation Quality Gate for Comment Replies ─────────────────────────
// MANDATORY: All URLs in comment replies must be validated before posting.
// Created after a broken link was posted in a comment reply (brand credibility).
// This gate is built INTO the tool so it cannot be bypassed by any agent.

const URL_REGEX = /https?:\/\/[^\s"'<>\])\},]+/gi;

/**
 * Validate all URLs in a message. Returns { valid: true } or { valid: false, failures: [...] }.
 */
async function validateCommentURLs(text) {
  const urls = text.match(URL_REGEX);
  if (!urls || urls.length === 0) return { valid: true, urls: [] };

  const unique = [...new Set(urls)];
  const failures = [];

  for (const url of unique) {
    try {
      // Clean trailing punctuation that may have been captured
      const cleanUrl = url.replace(/[.,;:!?)]+$/, "");
      const resp = await fetch(cleanUrl, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "htekdev-comment-quality-gate/1.0" },
      });
      // Accept 2xx and 3xx (redirects followed), reject 4xx/5xx
      if (resp.status >= 400) {
        // Retry with GET in case HEAD is not supported
        const retryResp = await fetch(cleanUrl, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(8000),
          headers: { "User-Agent": "htekdev-comment-quality-gate/1.0" },
        });
        if (retryResp.status >= 400) {
          failures.push({ url: cleanUrl, status: retryResp.status });
        }
      }
    } catch (err) {
      failures.push({ url: url.replace(/[.,;:!?)]+$/, ""), error: err.message || "Network error" });
    }
  }

  return { valid: failures.length === 0, urls: unique, failures };
}

async function handleReplyComment(params) {
  const { post_id, account_id, message, comment_id } = params;

  // ── QUALITY GATE: Validate all URLs before posting ──
  const urlCheck = await validateCommentURLs(message);
  if (!urlCheck.valid) {
    const failReport = urlCheck.failures
      .map((f) => `  • ${f.url} → ${f.status ? `HTTP ${f.status}` : f.error}`)
      .join("\n");
    return {
      error: "QUALITY GATE BLOCKED: Comment contains broken URLs",
      message:
        "🚫 Reply NOT posted. The following URLs failed validation:\n" +
        failReport +
        "\n\nFix or remove the broken URLs, then retry. All URLs must return HTTP 200 before a comment can be posted.",
      failed_urls: urlCheck.failures,
      original_message: message,
    };
  }

  const body = { accountId: account_id, message };
  if (comment_id) body.commentId = comment_id;

  const res = await lateRequest(`/inbox/comments/${post_id}`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (res.error) return res;

  return {
    message: "Reply posted successfully",
    postId: post_id,
    replyTo: comment_id || "(top-level)",
    reply: res.comment || res.data || res,
    urls_validated: urlCheck.urls.length,
  };
}

async function handleHideComment(params) {
  const { post_id, comment_id, account_id } = params;

  const res = await lateRequest(`/inbox/comments/${post_id}/${comment_id}/hide`, {
    method: "POST",
    body: JSON.stringify({ accountId: account_id }),
  });

  if (res.error) return res;

  return {
    message: "Comment hidden successfully",
    postId: post_id,
    commentId: comment_id,
  };
}

async function handleDeleteComment(params) {
  const { post_id, comment_id, account_id } = params;
  const qs = new URLSearchParams();
  qs.set("accountId", account_id);
  qs.set("commentId", comment_id);

  const res = await lateRequest(`/inbox/comments/${post_id}?${qs}`, {
    method: "DELETE",
  });

  if (res.error) return res;

  return {
    message: "Comment deleted successfully",
    postId: post_id,
    commentId: comment_id,
  };
}

async function handleLikeComment(params) {
  const { post_id, comment_id, account_id } = params;

  const res = await lateRequest(`/inbox/comments/${post_id}/${comment_id}/like`, {
    method: "POST",
    body: JSON.stringify({ accountId: account_id }),
  });

  if (res.error) return res;

  return {
    message: "Comment liked successfully",
    postId: post_id,
    commentId: comment_id,
  };
}

// ── Queue Slot ──

async function handleNextSlot(params) {
  const { profile_id, queue_id } = params;
  const qs = new URLSearchParams();
  if (profile_id) qs.set("profileId", profile_id);
  if (queue_id) qs.set("queueId", queue_id);
  return await lateRequest(`/queue/next-slot?${qs}`);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
function formatPostSummary(post) {
  if (!post) return null;
  return {
    id: post._id,
    content: (post.content || "").slice(0, 200) + ((post.content || "").length > 200 ? "…" : ""),
    title: post.title,
    status: post.status,
    scheduledFor: post.scheduledFor,
    platforms: (post.platforms || []).map((p) => ({
      platform: p.platform,
      username: typeof p.accountId === "object" ? p.accountId?.username : undefined,
      status: p.status,
      publishedUrl: p.publishedUrl,
    })),
    mediaCount: (post.mediaItems || []).length,
    tags: post.tags,
    createdAt: post.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const TOOLS = [
  // ── Queue Management ──
  {
    name: "late_list_queues",
    description:
      "List all Late/Zernio profiles (queues) with scheduled and draft post counts. " +
      "Use this to see available queues before managing posts.",
    parameters: { type: "object", properties: {}, required: [] },
    handler: async () => JSON.stringify(await handleListQueues(), null, 2),
  },
  {
    name: "late_get_queue",
    description:
      "Get posts in a specific queue (profile), sorted chronologically. " +
      "Filter by status and platform. Returns paginated results.",
    parameters: {
      type: "object",
      properties: {
        queue_id: { type: "string", description: "Profile/queue ID to list posts for" },
        status: {
          type: "string",
          description: "Post status filter: scheduled, draft, published, failed. Default: scheduled",
        },
        platform: {
          type: "string",
          description: "Filter by platform: twitter, youtube, tiktok, instagram, linkedin, etc.",
        },
        limit: { type: "number", description: "Max posts to return (1-100). Default: 50" },
      },
      required: [],
    },
    handler: async (p) => JSON.stringify(await handleGetQueue(p), null, 2),
  },
  {
    name: "late_reorder_queue",
    description:
      "Reorder posts in a queue by swapping their scheduled dates. " +
      "Provide an array of post IDs in the desired chronological order. " +
      "The earliest scheduled date goes to the first ID, second-earliest to second ID, etc.",
    parameters: {
      type: "object",
      properties: {
        queue_id: { type: "string", description: "Profile/queue ID" },
        platform: { type: "string", description: "Platform to filter by" },
        new_order: {
          type: "array",
          items: { type: "string" },
          description: "Array of post IDs in desired chronological order",
        },
      },
      required: ["new_order"],
    },
    handler: async (p) => JSON.stringify(await handleReorderQueue(p), null, 2),
  },

  // ── Post Management ──
  {
    name: "late_list_posts",
    description:
      "List scheduled posts with filtering by queue, platform, date range, and status. " +
      "Returns paginated results sorted by scheduled date.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter: scheduled, draft, published, failed, cancelled",
        },
        platform: { type: "string", description: "Filter by platform name" },
        date_from: { type: "string", description: "ISO 8601 start date filter" },
        date_to: { type: "string", description: "ISO 8601 end date filter" },
        queue_id: { type: "string", description: "Filter by profile/queue ID" },
        page: { type: "number", description: "Page number (default: 1)" },
        limit: { type: "number", description: "Results per page (default: 25, max: 100)" },
      },
      required: [],
    },
    handler: async (p) => JSON.stringify(await handleListPosts(p), null, 2),
  },
  {
    name: "late_get_post",
    description: "Get full details of a specific post including all platform data, media, and metadata.",
    parameters: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "The post ID to retrieve" },
      },
      required: ["post_id"],
    },
    handler: async (p) => JSON.stringify(await handleGetPost(p), null, 2),
  },
  {
    name: "late_create_post",
    description:
      "Create a new post on Late/Zernio. Supports scheduling, drafts, and immediate publish. " +
      "Platforms should be a JSON array of {platform, accountId, platformSpecificData?, customContent?}. " +
      "Use late_list_accounts to get accountId values. " +
      "Use media_items as JSON array of {type: 'image'|'video', url: string}.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Post caption/text" },
        title: { type: "string", description: "Post title (for YouTube, Pinterest)" },
        platforms: {
          type: "string",
          description:
            'JSON array of platform targets: [{"platform":"twitter","accountId":"..."}]',
        },
        scheduled_for: { type: "string", description: "ISO 8601 datetime to schedule for" },
        publish_now: { type: "boolean", description: "Publish immediately (default: false)" },
        is_draft: { type: "boolean", description: "Save as draft (default: false)" },
        timezone: { type: "string", description: 'Timezone (default: "UTC"). E.g. "America/Chicago"' },
        media_items: {
          type: "string",
          description: 'JSON array of media: [{"type":"video","url":"https://..."}]',
        },
        tags: { type: "string", description: "JSON array of tags" },
        hashtags: { type: "string", description: "JSON array of hashtags" },
        queue_id: { type: "string", description: "Profile ID to queue into (uses next slot)" },
        platform_specific_data: {
          type: "string",
          description:
            'JSON object keyed by platform: {"youtube":{"title":"...","visibility":"public"}, "tiktok":{...}}',
        },
      },
      required: ["content", "platforms"],
    },
    handler: async (p) => JSON.stringify(await handleCreatePost(p), null, 2),
  },
  {
    name: "late_update_post",
    description:
      "Update a draft or scheduled post's content, title, schedule, tags, hashtags, or draft status. To transition a draft post to scheduled, set is_draft=false AND provide scheduled_for.",
    parameters: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Post ID to update" },
        content: { type: "string", description: "New content/caption" },
        title: { type: "string", description: "New title" },
        scheduled_for: { type: "string", description: "New scheduled date (ISO 8601)" },
        timezone: { type: "string", description: "Timezone for the new schedule" },
        tags: { type: "string", description: "JSON array of new tags" },
        hashtags: { type: "string", description: "JSON array of new hashtags" },
        is_draft: {
          type: "boolean",
          description:
            "Set to false to transition a draft post to scheduled (MUST also provide scheduled_for). Set to true to move a scheduled post back to draft.",
        },
      },
      required: ["post_id"],
    },
    handler: async (p) => JSON.stringify(await handleUpdatePost(p), null, 2),
  },
  {
    name: "late_reschedule_post",
    description: "Change the scheduled date/time of a post. Provide the new ISO 8601 datetime.",
    parameters: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Post ID to reschedule" },
        scheduled_for: { type: "string", description: "New scheduled datetime (ISO 8601)" },
        timezone: { type: "string", description: 'Timezone (e.g. "America/Chicago")' },
      },
      required: ["post_id", "scheduled_for"],
    },
    handler: async (p) => JSON.stringify(await handleReschedulePost(p), null, 2),
  },
  {
    name: "late_move_post",
    description: "Move a post to a different queue/profile.",
    parameters: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Post ID to move" },
        target_queue_id: { type: "string", description: "Target profile/queue ID" },
      },
      required: ["post_id", "target_queue_id"],
    },
    handler: async (p) => JSON.stringify(await handleMovePost(p), null, 2),
  },
  {
    name: "late_delete_post",
    description: "Delete a draft or scheduled post. Cannot delete published posts.",
    parameters: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Post ID to delete" },
      },
      required: ["post_id"],
    },
    handler: async (p) => JSON.stringify(await handleDeletePost(p), null, 2),
  },

  // ── Platform / Account ──
  {
    name: "late_list_accounts",
    description:
      "List connected social media accounts on Late/Zernio. " +
      "Returns account IDs needed for creating posts. Filter by profile.",
    parameters: {
      type: "object",
      properties: {
        profile_id: { type: "string", description: "Filter by profile ID" },
      },
      required: [],
    },
    handler: async (p) => JSON.stringify(await handleListAccounts(p), null, 2),
  },
  {
    name: "late_get_analytics",
    description:
      "Get post/account analytics from Late (requires analytics add-on). " +
      "Filter by platform, account, or date range.",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", description: "Filter by platform" },
        account_id: { type: "string", description: "Filter by account ID" },
        date_from: { type: "string", description: "Start date (ISO 8601)" },
        date_to: { type: "string", description: "End date (ISO 8601)" },
      },
      required: [],
    },
    handler: async (p) => JSON.stringify(await handleGetAnalytics(p), null, 2),
  },
  {
    name: "late_account_health",
    description:
      "Check the health/connection status of social media accounts. " +
      "Omit account_id to check all accounts.",
    parameters: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Specific account ID to check (optional)" },
      },
      required: [],
    },
    handler: async (p) => JSON.stringify(await handleAccountHealth(p), null, 2),
  },
  {
    name: "late_follower_stats",
    description: "Get follower growth metrics for connected accounts (requires analytics add-on).",
    parameters: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Filter by account ID" },
        platform: { type: "string", description: "Filter by platform" },
      },
      required: [],
    },
    handler: async (p) => JSON.stringify(await handleFollowerStats(p), null, 2),
  },

  // ── Failure Handling ──
  {
    name: "late_list_failures",
    description:
      "List posts with failed platform delivery. Shows error details per platform. " +
      "Use late_retry_post to retry failed posts.",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", description: "Filter failures by platform" },
        page: { type: "number", description: "Page number" },
        limit: { type: "number", description: "Results per page" },
      },
      required: [],
    },
    handler: async (p) => JSON.stringify(await handleListFailures(p), null, 2),
  },
  {
    name: "late_retry_post",
    description: "Retry a failed post. Triggers re-delivery to all failed platforms.",
    parameters: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Failed post ID to retry" },
      },
      required: ["post_id"],
    },
    handler: async (p) => JSON.stringify(await handleRetryPost(p), null, 2),
  },

  // ── Media Upload ──
  {
    name: "late_presign_upload",
    description:
      "Get a presigned URL for uploading media to Late. " +
      "After uploading the file to the returned uploadUrl, use the publicUrl in mediaItems when creating a post.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "File name (e.g. 'video.mp4')" },
        content_type: {
          type: "string",
          description: "MIME type (e.g. 'video/mp4', 'image/jpeg')",
        },
        size: { type: "number", description: "File size in bytes (optional, max 5GB)" },
      },
      required: ["filename", "content_type"],
    },
    handler: async (p) => JSON.stringify(await handlePresignUpload(p), null, 2),
  },

  // ── Queue Slot ──
  {
    name: "late_next_slot",
    description: "Get the next available queue slot for a profile. Use for manual slot planning.",
    parameters: {
      type: "object",
      properties: {
        profile_id: { type: "string", description: "Profile ID" },
        queue_id: { type: "string", description: "Specific queue ID (optional)" },
      },
      required: [],
    },
    handler: async (p) => JSON.stringify(await handleNextSlot(p), null, 2),
  },

  // ── Comment / Inbox Management ──
  {
    name: "late_list_comments",
    description:
      "List posts with comments from the Late/Zernio inbox. Shows commented posts across all " +
      "connected accounts with comment counts. For YouTube, uses a direct per-video scan because the inbox feed misses older commented videos. Filter by platform, profile, or account.",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", description: "Filter by platform (twitter, instagram, youtube, etc.)" },
        profile_id: { type: "string", description: "Filter by profile ID" },
        account_id: { type: "string", description: "Filter by specific social account ID" },
        since: { type: "string", description: "Only posts with comments since this ISO 8601 date" },
        min_comments: { type: "number", description: "Minimum comment count to include" },
        sort_by: { type: "string", description: "Sort field (e.g. 'commentCount', 'publishedAt')" },
        sort_order: { type: "string", description: "Sort order: 'asc' or 'desc'" },
        limit: { type: "number", description: "Max results (default: 25)" },
        cursor: { type: "string", description: "Pagination cursor from previous response" },
      },
      required: [],
    },
    handler: async (p) => JSON.stringify(await handleListComments(p), null, 2),
  },
  {
    name: "late_get_post_comments",
    description:
      "Get comments for a specific post. Requires account_id to identify which social account " +
      "to fetch comments from. Returns comment text, author, likes, and reply counts.",
    parameters: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Zernio post ID or platform-specific post ID" },
        account_id: { type: "string", description: "Social account ID (required — use late_list_accounts to find)" },
        limit: { type: "number", description: "Max comments to return" },
        cursor: { type: "string", description: "Pagination cursor from previous response" },
        comment_id: { type: "string", description: "(Reddit only) Get replies to a specific comment" },
      },
      required: ["post_id", "account_id"],
    },
    handler: async (p) => JSON.stringify(await handleGetPostComments(p), null, 2),
  },
  {
    name: "late_reply_comment",
    description:
      "Reply to a comment on a post. Posts a reply via the connected social account. " +
      "If comment_id is provided, replies to that specific comment; otherwise replies to the post. " +
      "⚠️ QUALITY GATE: All URLs in the message are validated before posting. " +
      "If any URL returns non-200, the reply is BLOCKED. Fix or remove broken URLs first.",
    parameters: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Zernio post ID or platform-specific post ID" },
        account_id: { type: "string", description: "Social account ID to reply from" },
        message: { type: "string", description: "The reply text" },
        comment_id: {
          type: "string",
          description: "Reply to this specific comment (optional — omit to reply to the post itself)",
        },
      },
      required: ["post_id", "account_id", "message"],
    },
    handler: async (p) => JSON.stringify(await handleReplyComment(p), null, 2),
  },
  {
    name: "late_hide_comment",
    description:
      "Hide a comment on a post. Hidden comments are only visible to the commenter and page admin. " +
      "Supported by Facebook, Instagram, Threads, and X/Twitter.",
    parameters: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Zernio post ID or platform-specific post ID" },
        comment_id: { type: "string", description: "Comment ID to hide" },
        account_id: { type: "string", description: "Social account ID" },
      },
      required: ["post_id", "comment_id", "account_id"],
    },
    handler: async (p) => JSON.stringify(await handleHideComment(p), null, 2),
  },
  {
    name: "late_delete_comment",
    description:
      "Delete a comment on a post. Permanently removes the comment. " +
      "Supported by Facebook, Instagram, Bluesky, Reddit, YouTube, and LinkedIn.",
    parameters: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Zernio post ID or platform-specific post ID" },
        comment_id: { type: "string", description: "Comment ID to delete" },
        account_id: { type: "string", description: "Social account ID" },
      },
      required: ["post_id", "comment_id", "account_id"],
    },
    handler: async (p) => JSON.stringify(await handleDeleteComment(p), null, 2),
  },
  {
    name: "late_like_comment",
    description:
      "Like or upvote a comment on a post. " +
      "Supported by Facebook, Twitter/X, Bluesky, and Reddit.",
    parameters: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "Zernio post ID or platform-specific post ID" },
        comment_id: { type: "string", description: "Comment ID to like" },
        account_id: { type: "string", description: "Social account ID" },
      },
      required: ["post_id", "comment_id", "account_id"],
    },
    handler: async (p) => JSON.stringify(await handleLikeComment(p), null, 2),
  },
];

// ---------------------------------------------------------------------------
// Register extension
// ---------------------------------------------------------------------------
const TOOL_NAMES = TOOLS.map((t) => t.name).join(", ");

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      const apiKey = getApiKey();
      const keyStatus = apiKey ? "✅ configured" : "❌ not configured";
      return {
        additionalContext:
          `[late-api] Late/Zernio social media API extension active.\n` +
          `- API key: ${keyStatus}\n` +
          `- Base URL: ${BASE_URL}\n` +
          `- Handle: @htekdev\n` +
          `- Tools: ${TOOL_NAMES}\n` +
          `- Use late_list_accounts to discover connected platforms and account IDs.\n` +
          `- Use late_list_queues to see profiles/queues.\n` +
          `- Always use these tools instead of raw fetch/curl for Late API operations.`,
      };
    },
    onUserPromptSubmitted: async (input) => {
      const msg = (input.userPrompt || "").toLowerCase();
      const keywords = [
        "late",
        "zernio",
        "queue",
        "scheduled post",
        "social media post",
        "reschedule",
        "failed post",
        "retry post",
        "post analytics",
        "content calendar",
        "content schedule",
        "comment",
        "inbox",
        "reply",
        "hide comment",
        "delete comment",
        "like comment",
      ];
      if (keywords.some((kw) => msg.includes(kw))) {
        return {
          additionalContext:
            `[late-api] Late/Zernio tools are available for this request. ` +
            `Use late_* tools for all social media scheduling operations. ` +
            `Key tools: late_list_posts, late_list_accounts, late_list_queues, late_list_failures.`,
        };
      }
    },
  },
  tools: TOOLS,
});
