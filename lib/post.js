// Identifies individual LinkedIn posts from a URL and builds short excerpts.
// Pure functions only, so they can run in the popup and in Node tests.

export const EXCERPT_LIMIT = 160;

const LINKEDIN_HOST = /^(?:[a-z0-9-]+\.)?linkedin\.com$/i;
const URN_TYPES = { activity: 'activity', share: 'share', ugcpost: 'ugcPost' };

const FEED_UPDATE = /^\/feed\/update\/urn:li:(activity|share|ugcpost):(\d+)\/?$/i;
const POSTS_SLUG = /^\/posts\/([^/]+)\/?$/;
const SLUG_ID = /(?:^|[-_])(activity|share|ugcpost)-(\d{10,25})(?=-|$)/gi;

/**
 * Classifies a tab URL.
 *   { kind: 'post', id, url }  an individual post we can save
 *   { kind: 'post-unidentified' } looks like a post page, but no reliable ID
 *   { kind: 'linkedin-other' } LinkedIn, but not an individual post (feed, profile, ...)
 *   { kind: 'other' } anything else
 * `id` is a stable URN like "urn:li:activity:123"; `url` is the normalized direct link
 * with tracking parameters and fragments removed.
 */
export function classifyUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { kind: 'other' };
  }
  if (!/^https?:$/.test(parsed.protocol) || !LINKEDIN_HOST.test(parsed.hostname)) return { kind: 'other' };

  let path;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return { kind: 'post-unidentified' };
  }

  const feed = path.match(FEED_UPDATE);
  if (feed) {
    const id = `urn:li:${URN_TYPES[feed[1].toLowerCase()]}:${feed[2]}`;
    return { kind: 'post', id, url: `https://www.linkedin.com/feed/update/${id}/` };
  }

  const posts = path.match(POSTS_SLUG);
  if (posts) {
    const matches = [...posts[1].matchAll(SLUG_ID)];
    const last = matches[matches.length - 1];
    if (!last) return { kind: 'post-unidentified' };
    const id = `urn:li:${URN_TYPES[last[1].toLowerCase()]}:${last[2]}`;
    const slug = encodeURIComponent(posts[1]);
    return { kind: 'post', id, url: `https://www.linkedin.com/posts/${slug}/` };
  }

  if (/^\/(feed\/update|posts)\//.test(path)) return { kind: 'post-unidentified' };
  return { kind: 'linkedin-other' };
}

export const POST_ID_PATTERN = /^urn:li:(activity|share|ugcPost):\d+$/;

/** Collapses whitespace and trims to EXCERPT_LIMIT characters at a word boundary. */
export const TEXT_LIMIT = 4000;

/** The post's full text for search and the full-page view: tidy spacing, keep paragraphs. */
export function cleanPostText(text) {
  let clean = String(text ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (clean.length > TEXT_LIMIT) {
    clean = clean.slice(0, TEXT_LIMIT);
    if (/[\uD800-\uDBFF]$/.test(clean)) clean = clean.slice(0, -1);
  }
  return clean;
}

export function makeExcerpt(text) {
  const clean = String(text ?? '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= EXCERPT_LIMIT) return clean;

  let cut = clean.slice(0, EXCERPT_LIMIT);
  if (clean[EXCERPT_LIMIT] !== ' ') {
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  }
  // Never leave half of a surrogate pair (emoji) behind.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  cut = cut.replace(/[\s.,;:!?\-–—…]+$/, '');
  return `${cut}…`;
}
