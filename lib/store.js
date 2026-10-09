// Local storage for labels and saved posts. Everything lives under one key in
// chrome.storage.local, which persists across browser restarts in this Chrome profile.

import { classifyUrl, cleanPostText, makeExcerpt, POST_ID_PATTERN } from './post.js';

export const STORAGE_KEY = 'labels.data.v1';
export const LABEL_NAME_MAX = 60;
export const BACKUP_FORMAT = 'labels-backup';
export const BACKUP_VERSION = 1;
export const NOTE_MAX = 500;
/** Label colors (keys are stored; the UI maps them to swatches). */
export const LABEL_COLORS = ['purple', 'blue', 'green', 'yellow', 'orange', 'red', 'pink', 'gray'];

export function cleanNote(note) {
  return String(note ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOTE_MAX);
}

const validColor = color => (LABEL_COLORS.includes(color) ? color : undefined);

// Picture links: LinkedIn image URLs (https) or inline images; anything else is dropped.
const cleanImageUrl = url =>
  typeof url === 'string' && /^(https:\/\/|data:image\/)/.test(url) && url.length < 4000 ? url : '';
const cleanLine = (text, max) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** The post's author ({ name, headline, avatar }) and main image, tidied. Empty parts are left out. */
// Screen-reader text LinkedIn puts on avatars, which older versions saved as the author's name.
const NOT_A_NAME = /^(status is \w+|view .*profile)$/i;

export function cleanMeta(meta) {
  let name = cleanLine(meta?.name ?? meta?.author?.name, 100);
  let headline = cleanLine(meta?.headline ?? meta?.author?.headline, 220);
  // When the name was that hidden text, the real name was read as the line after it.
  if (NOT_A_NAME.test(name)) [name, headline] = NOT_A_NAME.test(headline) ? ['', ''] : [headline, ''];
  const avatar = cleanImageUrl(meta?.avatar ?? meta?.author?.avatar);
  const image = cleanImageUrl(meta?.image);
  const out = {};
  if (name) out.author = { name, ...(headline ? { headline } : {}), ...(avatar ? { avatar } : {}) };
  if (image) out.image = image;
  return out;
}

// Fresh author details replace old ones (photo links expire); an image is kept unless a new one is found.
function applyMeta(post, meta) {
  const clean = cleanMeta(meta);
  if (clean.author) post.author = clean.author;
  if (clean.image) post.image = clean.image;
}

/** Errors with a message that is safe to show in the UI. */
export class LabelsError extends Error {}

export function cleanLabelName(name) {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function labelKey(name) {
  return cleanLabelName(name).toLocaleLowerCase();
}

export function emptyData() {
  return { version: 1, labels: {}, posts: {} };
}

export function compareNames(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/** Labels sorted alphabetically, with how many saved posts each has. */
export function labelsWithCounts(data) {
  const counts = new Map();
  for (const post of Object.values(data.posts)) {
    for (const id of post.labelIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const rows = Object.values(data.labels).map(l => ({ id: l.id, name: l.name, count: counts.get(l.id) ?? 0 }));
  return rows.sort((a, b) => compareNames(a.name, b.name));
}

/** How many saved posts have this label and no other (they go if the label is deleted). */
export function postsOnlyIn(data, labelId) {
  return Object.values(data.posts).filter(p => p.labelIds.length === 1 && p.labelIds[0] === labelId).length;
}

/** User labels only, sorted alphabetically. */
export function sortedLabels(data) {
  return Object.values(data.labels).sort((a, b) => compareNames(a.name, b.name));
}

/**
 * "To sort": where posts brought in from LinkedIn's Saved posts page wait for real labels.
 * It's an ordinary label, so every post still has one; it drops off a post as soon as the
 * post gets another label, and the label goes away once nothing is left to sort.
 */
export const TO_SORT = 'To sort';

export function toSortLabelId(data) {
  return Object.values(data.labels).find(l => labelKey(l.name) === labelKey(TO_SORT))?.id ?? null;
}

// A post with real labels no longer needs "To sort".
function withoutToSort(data, ids) {
  const sortId = toSortLabelId(data);
  return sortId && ids.length > 1 ? ids.filter(id => id !== sortId) : ids;
}

// Removes the "To sort" label once no post has it.
function tidyToSort(data) {
  const sortId = toSortLabelId(data);
  if (sortId && !Object.values(data.posts).some(p => p.labelIds.includes(sortId))) delete data.labels[sortId];
}

// ---------- Today: a few saved posts resurfaced each day ----------

export const TODAY_COUNT = 5;
const DAY = 86400000;
const NO_REPEAT_DAYS = 30;
const MIN_AGE_DAYS = 3; // just-saved posts aren't "resurfacing"

/** The local calendar day, like "2026-10-09"; a new set of picks starts each day. */
export function dayKey(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Posts that can be resurfaced now, the ones shown longest ago (or never) first, in random
 * order among equals. Skips "To sort", posts saved in the last few days, and anything shown
 * in the last 30 days.
 */
export function todayCandidates(data, now = Date.now(), exclude = []) {
  const sortId = toSortLabelId(data);
  const skip = new Set(exclude);
  const shown = data.surfaced ?? {};
  return Object.values(data.posts)
    .filter(
      p =>
        !skip.has(p.id) &&
        !(sortId && p.labelIds.includes(sortId)) &&
        now - p.savedAt >= MIN_AGE_DAYS * DAY &&
        now - (shown[p.id] ?? 0) >= NO_REPEAT_DAYS * DAY,
    )
    .map(p => ({ p, at: shown[p.id] ?? 0, r: Math.random() }))
    .sort((a, b) => a.at - b.at || a.r - b.r)
    .map(x => x.p);
}

/** Today's posts that still exist. */
export function todayPosts(data, now = Date.now()) {
  if (data.today?.date !== dayKey(now)) return [];
  return data.today.ids.map(id => data.posts[id]).filter(Boolean);
}

/** True when a new day's picks are waiting to be seen (shown as a badge on the toolbar icon). */
export function todayIsNew(data, now = Date.now()) {
  if (data.today?.date === dayKey(now)) return data.today.fresh && todayPosts(data, now).length > 0;
  return todayCandidates(data, now).length > 0;
}

function pickMore(data, now, count) {
  const picks = todayCandidates(data, now, data.today?.ids ?? []).slice(0, count);
  data.surfaced ??= {};
  for (const p of picks) data.surfaced[p.id] = now;
  return picks.map(p => p.id);
}

/** Shown like a label, but it's every pinned post rather than a real label. */
export const PINNED_ID = 'pinned';

// Pinned posts first (most recently pinned on top), then newest saved first.
function byPinThenSaved(a, b) {
  return (b.pinnedAt || 0) - (a.pinnedAt || 0) || b.savedAt - a.savedAt;
}

/** Posts with a label (or every pinned post, for PINNED_ID), pinned ones on top. */
export function postsForLabel(data, labelId) {
  const posts = Object.values(data.posts).filter(p =>
    labelId === PINNED_ID ? p.pinnedAt : p.labelIds.includes(labelId),
  );
  return posts.sort(byPinThenSaved);
}

/**
 * Posts matching every word of the query, in the post text, preview, note or label names.
 * Pinned posts first, then newest saved.
 */
export function searchPosts(data, query) {
  const words = String(query ?? '')
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  return Object.values(data.posts)
    .filter(p => {
      const hay = [
        p.text,
        p.excerpt,
        p.note,
        p.author?.name,
        p.author?.headline,
        ...p.labelIds.map(id => data.labels[id]?.name),
      ]
        .filter(Boolean)
        .join('\n')
        .toLocaleLowerCase();
      return words.every(w => hay.includes(w));
    })
    .sort(byPinThenSaved);
}

/** A label's posts as a Markdown list, for pasting into a doc or chat. */
export function postsAsMarkdown(data, labelId) {
  return postsForLabel(data, labelId)
    .map(p => {
      const title = (p.excerpt || 'LinkedIn post').replace(/[\[\]]/g, '');
      return `- [${title}](${p.url})${p.note ? ` - ${p.note}` : ''}`;
    })
    .join('\n');
}

export function pinnedCount(data) {
  return Object.values(data.posts).filter(p => p.pinnedAt).length;
}

export function labelName(data, labelId) {
  return data.labels[labelId]?.name;
}

function validateLabelName(data, name, exceptId) {
  const clean = cleanLabelName(name);
  if (!clean) throw new LabelsError('Enter a label name.');
  if (clean.length > LABEL_NAME_MAX) throw new LabelsError(`Label names can be up to ${LABEL_NAME_MAX} characters.`);
  const key = labelKey(clean);
  const clash = Object.values(data.labels).find(l => l.id !== exceptId && labelKey(l.name) === key);
  if (clash) throw new LabelsError(`You already have a label called "${clash.name}".`);
  return clean;
}

function newId() {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `l_${rand}`;
}

function addLabel(data, name, createdAt = Date.now()) {
  const clean = validateLabelName(data, name);
  const label = { id: newId(), name: clean, createdAt };
  data.labels[label.id] = label;
  return label;
}

function findLabelByName(data, name) {
  const key = labelKey(name);
  return Object.values(data.labels).find(l => labelKey(l.name) === key);
}

/** Drops anything malformed so a damaged record can't break the UI. */
function sanitize(raw) {
  const data = emptyData();
  if (!raw || typeof raw !== 'object') return data;
  for (const l of Object.values(raw.labels ?? {})) {
    if (l && typeof l.id === 'string' && typeof l.name === 'string' && cleanLabelName(l.name)) {
      data.labels[l.id] = { id: l.id, name: cleanLabelName(l.name), createdAt: Number(l.createdAt) || 0 };
      if (validColor(l.color)) data.labels[l.id].color = l.color;
    }
  }
  for (const p of Object.values(raw.posts ?? {})) {
    if (!p || typeof p.id !== 'string' || typeof p.url !== 'string') continue;
    const labelIds = Array.isArray(p.labelIds) ? [...new Set(p.labelIds.filter(id => data.labels[id]))] : [];
    // Every saved post has at least one label. Unlabeled posts from older versions
    // (the former "Uncategorized") are dropped.
    if (!labelIds.length) continue;
    data.posts[p.id] = {
      id: p.id,
      url: p.url,
      excerpt: typeof p.excerpt === 'string' ? p.excerpt : '',
      labelIds,
      savedAt: Number(p.savedAt) || 0,
      updatedAt: Number(p.updatedAt) || Number(p.savedAt) || 0,
    };
    if (Number(p.pinnedAt) > 0) data.posts[p.id].pinnedAt = Number(p.pinnedAt);
    if (typeof p.text === 'string' && p.text) data.posts[p.id].text = cleanPostText(p.text);
    if (typeof p.note === 'string' && cleanNote(p.note)) data.posts[p.id].note = cleanNote(p.note);
    applyMeta(data.posts[p.id], { author: p.author, image: p.image });
  }
  // Today's picks and when each post was last resurfaced (local state, not in backups).
  if (raw.today && typeof raw.today.date === 'string' && Array.isArray(raw.today.ids)) {
    data.today = {
      date: raw.today.date,
      ids: raw.today.ids.filter(id => typeof id === 'string' && data.posts[id]),
      fresh: Boolean(raw.today.fresh),
    };
  }
  data.surfaced = {};
  for (const [id, at] of Object.entries(raw.surfaced ?? {})) {
    if (data.posts[id] && Number(at) > 0) data.surfaced[id] = Number(at);
  }
  return data;
}

/**
 * Creates a store over a chrome.storage-like area ({ get(key), set(obj) } returning promises).
 * All writes are serialized so quick clicks can't overwrite each other.
 */
export function createStore(area) {
  let queue = Promise.resolve();

  async function load() {
    const result = await area.get(STORAGE_KEY);
    return sanitize(result?.[STORAGE_KEY]);
  }

  function mutate(fn) {
    const run = queue.then(async () => {
      const data = await load();
      const result = await fn(data);
      await area.set({ [STORAGE_KEY]: data });
      return { data, result };
    });
    queue = run.catch(() => {});
    return run;
  }

  function existingLabelIds(data, labelIds) {
    const ids = [...new Set(labelIds)];
    const missing = ids.filter(id => !data.labels[id]);
    if (missing.length)
      throw new LabelsError('One of the selected labels no longer exists. Check your labels and try again.');
    return ids;
  }

  return {
    load,

    createLabel: name => mutate(data => addLabel(data, name)),

    renameLabel: (labelId, name) =>
      mutate(data => {
        const label = data.labels[labelId];
        if (!label) throw new LabelsError('This label no longer exists.');
        label.name = validateLabelName(data, name, labelId);
        return label;
      }),

    deleteLabel: labelId =>
      mutate(data => {
        if (!data.labels[labelId]) throw new LabelsError('This label no longer exists.');
        delete data.labels[labelId];
        // Posts keep their other labels; posts left with none are removed.
        let removed = 0;
        for (const post of Object.values(data.posts)) {
          post.labelIds = post.labelIds.filter(id => id !== labelId);
          if (!post.labelIds.length) {
            delete data.posts[post.id];
            removed++;
          }
        }
        return { removed };
      }),

    /** Saves a new post or updates the existing record with the same ID. */
    savePost: ({ id, url, excerpt, text, labelIds, meta }) =>
      mutate(data => {
        if (!POST_ID_PATTERN.test(id) || typeof url !== 'string' || !url.startsWith('https://www.linkedin.com/')) {
          throw new LabelsError('This post’s link couldn’t be identified, so it wasn’t saved.');
        }
        const ids = withoutToSort(data, existingLabelIds(data, labelIds));
        const now = Date.now();
        const existing = data.posts[id];
        // Saving with no labels removes an existing post; a new post needs at least one.
        if (!ids.length) {
          if (!existing) throw new LabelsError('Pick or create a label to save this post.');
          delete data.posts[id];
          tidyToSort(data);
          return { post: null, created: false, removed: true };
        }
        const full = cleanPostText(text);
        if (existing) {
          existing.labelIds = ids;
          if (excerpt) existing.excerpt = excerpt;
          // Keep the longest capture (a collapsed "see more" post gives less text).
          if (full.length > (existing.text?.length ?? 0)) existing.text = full;
          applyMeta(existing, meta);
          existing.updatedAt = now;
          tidyToSort(data);
          return { post: existing, created: false };
        }
        const post = { id, url, excerpt: excerpt || '', labelIds: ids, savedAt: now, updatedAt: now };
        if (full) post.text = full;
        applyMeta(post, meta);
        data.posts[id] = post;
        return { post, created: true };
      }),

    setPostLabels: (postId, labelIds) =>
      mutate(data => {
        const post = data.posts[postId];
        if (!post) throw new LabelsError('This saved post no longer exists.');
        post.labelIds = withoutToSort(data, existingLabelIds(data, labelIds));
        if (!post.labelIds.length) {
          delete data.posts[postId];
          tidyToSort(data);
          return null;
        }
        tidyToSort(data);
        post.updatedAt = Date.now();
        return post;
      }),

    /** Adds a preview to a saved post that doesn't have one yet. */
    fillExcerpt: (postId, excerpt, text, meta) =>
      mutate(data => {
        const post = data.posts[postId];
        if (!post) return post;
        if (!post.excerpt && excerpt) post.excerpt = excerpt;
        const full = cleanPostText(text);
        if (full.length > (post.text?.length ?? 0)) post.text = full;
        applyMeta(post, meta);
        return post;
      }),

    /** Sets (or clears, with '') a post's note. */
    setNote: (postId, note) =>
      mutate(data => {
        const post = data.posts[postId];
        if (!post) throw new LabelsError('This saved post no longer exists.');
        const clean = cleanNote(note);
        if (clean) post.note = clean;
        else delete post.note;
        return post;
      }),

    /** Sets (or clears, with null) a label's color. */
    setLabelColor: (labelId, color) =>
      mutate(data => {
        const label = data.labels[labelId];
        if (!label) throw new LabelsError('This label no longer exists.');
        if (validColor(color)) label.color = color;
        else delete label.color;
        return label;
      }),

    /** Adds labels to several posts at once (saving any that aren't saved yet). */
    labelMany: (posts, labelIds) =>
      mutate(data => {
        const ids = existingLabelIds(data, labelIds);
        if (!ids.length) throw new LabelsError('Pick or create a label first.');
        const now = Date.now();
        let added = 0;
        let updated = 0;
        for (const p of posts) {
          if (
            !POST_ID_PATTERN.test(p.id) ||
            typeof p.url !== 'string' ||
            !p.url.startsWith('https://www.linkedin.com/')
          ) {
            continue;
          }
          const existing = data.posts[p.id];
          const full = cleanPostText(p.text);
          if (existing) {
            const merged = [...new Set([...existing.labelIds, ...ids])];
            if (merged.length !== existing.labelIds.length) updated++;
            existing.labelIds = merged;
            if (!existing.excerpt && p.excerpt) existing.excerpt = p.excerpt;
            if (full.length > (existing.text?.length ?? 0)) existing.text = full;
            existing.updatedAt = now;
          } else {
            data.posts[p.id] = {
              id: p.id,
              url: p.url,
              excerpt: p.excerpt || '',
              labelIds: ids,
              savedAt: now,
              updatedAt: now,
            };
            if (full) data.posts[p.id].text = full;
            added++;
          }
        }
        return { added, updated };
      }),

    /** Pins or unpins a saved post. */
    setPinned: (postId, pinned) =>
      mutate(data => {
        const post = data.posts[postId];
        if (!post) throw new LabelsError('This saved post no longer exists.');
        if (pinned) post.pinnedAt = post.pinnedAt || Date.now();
        else delete post.pinnedAt;
        return post;
      }),

    removePost: postId =>
      mutate(data => {
        delete data.posts[postId];
        tidyToSort(data);
      }),

    /** Picks today's posts if it's a new day (they stay the same until tomorrow). */
    ensureToday: (now = Date.now()) =>
      mutate(data => {
        const date = dayKey(now);
        if (data.today?.date !== date) {
          data.today = { date, ids: [], fresh: true };
          data.today.ids = pickMore(data, now, TODAY_COUNT);
          if (!data.today.ids.length) data.today.fresh = false;
        }
        return data.today;
      }),

    /** "Show 5 more": adds more picks to today (tomorrow is picked fresh as usual). */
    moreToday: (now = Date.now()) =>
      mutate(data => {
        if (data.today?.date !== dayKey(now)) data.today = { date: dayKey(now), ids: [], fresh: false };
        const added = pickMore(data, now, TODAY_COUNT);
        data.today.ids.push(...added);
        return added.length;
      }),

    /** Today's picks have been seen (clears the toolbar badge). */
    seenToday: () =>
      mutate(data => {
        if (data.today) data.today.fresh = false;
      }),

    /**
     * Brings posts in under "To sort" (LinkedIn's Saved posts page). Posts already in Labels
     * are left as they are.
     */
    addToSort: posts =>
      mutate(data => {
        let sortId = toSortLabelId(data);
        let added = 0;
        const now = Date.now();
        for (const p of posts) {
          if (
            !POST_ID_PATTERN.test(p.id) ||
            typeof p.url !== 'string' ||
            !p.url.startsWith('https://www.linkedin.com/')
          ) {
            continue;
          }
          if (data.posts[p.id]) continue;
          if (!sortId) sortId = addLabel(data, TO_SORT).id;
          const post = {
            id: p.id,
            url: p.url,
            excerpt: p.excerpt || '',
            labelIds: [sortId],
            savedAt: now - added,
            updatedAt: now,
          };
          const full = cleanPostText(p.text);
          if (full) post.text = full;
          applyMeta(post, p.meta);
          data.posts[p.id] = post;
          added++;
        }
        return { added, labelId: sortId };
      }),

    /** Puts back a post exactly as it was (for Undo), keeping only labels that still exist. */
    restorePost: record =>
      mutate(data => {
        if (
          !record ||
          !POST_ID_PATTERN.test(record.id) ||
          !String(record.url).startsWith('https://www.linkedin.com/')
        ) {
          throw new LabelsError('This saved post couldn\u2019t be restored.');
        }
        data.posts[record.id] = {
          id: record.id,
          url: record.url,
          excerpt: typeof record.excerpt === 'string' ? record.excerpt : '',
          labelIds: (record.labelIds ?? []).filter(id => data.labels[id]),
        };
        if (!data.posts[record.id].labelIds.length) {
          delete data.posts[record.id];
          throw new LabelsError('This post\u2019s labels no longer exist, so it can\u2019t be restored.');
        }
        data.posts[record.id] = {
          ...data.posts[record.id],
          savedAt: Number(record.savedAt) || Date.now(),
          updatedAt: Date.now(),
        };
        if (Number(record.pinnedAt) > 0) data.posts[record.id].pinnedAt = Number(record.pinnedAt);
        if (typeof record.text === 'string' && record.text) data.posts[record.id].text = cleanPostText(record.text);
        if (cleanNote(record.note)) data.posts[record.id].note = cleanNote(record.note);
        applyMeta(data.posts[record.id], { author: record.author, image: record.image });
        return data.posts[record.id];
      }),

    importBackup: backup => mutate(data => mergeBackup(data, backup)),
  };
}

export function exportBackup(data) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    labels: sortedLabels(data).map(l => ({
      name: l.name,
      createdAt: new Date(l.createdAt || 0).toISOString(),
      ...(l.color ? { color: l.color } : {}),
    })),
    posts: Object.values(data.posts)
      .sort((a, b) => b.savedAt - a.savedAt)
      .map(p => ({
        id: p.id,
        url: p.url,
        excerpt: p.excerpt,
        labels: p.labelIds.map(id => data.labels[id]?.name).filter(Boolean),
        savedAt: new Date(p.savedAt).toISOString(),
        ...(p.pinnedAt ? { pinnedAt: new Date(p.pinnedAt).toISOString() } : {}),
        ...(p.text ? { text: p.text } : {}),
        ...(p.note ? { note: p.note } : {}),
        ...(p.author ? { author: p.author } : {}),
        ...(p.image ? { image: p.image } : {}),
      })),
  };
}

function parseTime(value, where) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw new LabelsError(`${where} has an invalid date.`);
  return ms;
}

/**
 * Validates a parsed backup file. Throws LabelsError describing the first problem;
 * nothing is imported unless the whole file is valid.
 */
export function validateBackup(raw) {
  if (!raw || typeof raw !== 'object' || raw.format !== BACKUP_FORMAT) {
    throw new LabelsError('This isn’t a Labels backup file.');
  }
  if (raw.version !== BACKUP_VERSION)
    throw new LabelsError('This backup was made by an unsupported version of Labels.');
  if (!Array.isArray(raw.labels) || !Array.isArray(raw.posts)) throw new LabelsError('This backup file is incomplete.');

  const labels = raw.labels.map((l, i) => {
    const where = `Label ${i + 1}`;
    if (!l || typeof l.name !== 'string') throw new LabelsError(`${where} has no name.`);
    const name = cleanLabelName(l.name);
    if (!name || name.length > LABEL_NAME_MAX) throw new LabelsError(`${where} has an invalid name.`);
    return {
      name,
      createdAt: l.createdAt === undefined ? Date.now() : parseTime(l.createdAt, where),
      color: validColor(l.color),
    };
  });

  const posts = raw.posts.map((p, i) => {
    const where = `Saved post ${i + 1}`;
    if (!p || typeof p.url !== 'string') throw new LabelsError(`${where} has no link.`);
    const parsed = classifyUrl(p.url);
    if (parsed.kind !== 'post') throw new LabelsError(`${where} doesn’t link to an individual LinkedIn post.`);
    if (p.id !== undefined && p.id !== parsed.id)
      throw new LabelsError(`${where} has an ID that doesn’t match its link.`);
    if (p.excerpt !== undefined && typeof p.excerpt !== 'string')
      throw new LabelsError(`${where} has an invalid preview.`);
    if (p.text !== undefined && typeof p.text !== 'string') throw new LabelsError(`${where} has invalid text.`);
    if (p.note !== undefined && typeof p.note !== 'string') throw new LabelsError(`${where} has an invalid note.`);
    if (p.labels !== undefined && (!Array.isArray(p.labels) || p.labels.some(n => typeof n !== 'string'))) {
      throw new LabelsError(`${where} has invalid labels.`);
    }
    const labelNames = (p.labels ?? []).map(cleanLabelName).filter(Boolean);
    if (labelNames.some(n => n.length > LABEL_NAME_MAX)) throw new LabelsError(`${where} has an invalid label name.`);
    return {
      id: parsed.id,
      url: parsed.url,
      excerpt: makeExcerpt(p.excerpt ?? ''),
      labels: labelNames,
      savedAt: p.savedAt === undefined ? Date.now() : parseTime(p.savedAt, where),
      pinnedAt: p.pinnedAt === undefined || p.pinnedAt === null ? 0 : parseTime(p.pinnedAt, where),
      text: cleanPostText(p.text ?? ''),
      note: cleanNote(p.note),
      meta: cleanMeta({ author: p.author, image: p.image }),
    };
  });

  return { labels, posts };
}

/** Merges a validated backup into data without creating duplicate labels or posts. */
function mergeBackup(data, backup) {
  const { labels, posts } = validateBackup(backup);
  const summary = { labelsAdded: 0, postsAdded: 0, postsUpdated: 0, postsSkipped: 0 };

  const ensureLabel = (name, createdAt, color) => {
    const found = findLabelByName(data, name);
    if (found) {
      if (color && !found.color) found.color = color;
      return found.id;
    }
    summary.labelsAdded++;
    const label = addLabel(data, name, createdAt);
    if (color) label.color = color;
    return label.id;
  };

  for (const l of labels) ensureLabel(l.name, l.createdAt, l.color);

  for (const p of posts) {
    // Posts without labels (from older backups) are skipped: every saved post has a label.
    if (!p.labels.length) {
      summary.postsSkipped++;
      continue;
    }
    const labelIds = p.labels.map(name => ensureLabel(name, Date.now())).filter(Boolean);
    const existing = data.posts[p.id];
    if (existing) {
      const merged = [...new Set([...existing.labelIds, ...labelIds])];
      const changed =
        merged.length !== existing.labelIds.length || (!existing.excerpt && p.excerpt) || p.savedAt < existing.savedAt;
      existing.labelIds = merged;
      if (!existing.excerpt && p.excerpt) existing.excerpt = p.excerpt;
      existing.savedAt = Math.min(existing.savedAt, p.savedAt);
      // A pin in the backup pins the post here too; importing never unpins.
      const pins = p.pinnedAt && !existing.pinnedAt;
      if (pins) existing.pinnedAt = p.pinnedAt;
      // Fill in text and notes this copy doesn't have; never overwrite.
      const adds = (p.text.length > (existing.text?.length ?? 0) && p.text) || (p.note && !existing.note);
      if (p.text.length > (existing.text?.length ?? 0)) existing.text = p.text;
      if (p.note && !existing.note) existing.note = p.note;
      // Author and image only fill gaps on import.
      const fills = (p.meta.author && !existing.author) || (p.meta.image && !existing.image);
      if (p.meta.author && !existing.author) existing.author = p.meta.author;
      if (p.meta.image && !existing.image) existing.image = p.meta.image;
      if (changed || pins || adds || fills) summary.postsUpdated++;
    } else {
      data.posts[p.id] = {
        id: p.id,
        url: p.url,
        excerpt: p.excerpt,
        labelIds: [...new Set(labelIds)],
        savedAt: p.savedAt,
        updatedAt: p.savedAt,
        ...(p.pinnedAt ? { pinnedAt: p.pinnedAt } : {}),
        ...(p.text ? { text: p.text } : {}),
        ...(p.note ? { note: p.note } : {}),
        ...p.meta,
      };
      summary.postsAdded++;
    }
  }
  return summary;
}
