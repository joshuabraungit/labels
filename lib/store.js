// Local storage for labels and saved posts. Everything lives under one key in
// chrome.storage.local, which persists across browser restarts in this Chrome profile.

import { classifyUrl, makeExcerpt, POST_ID_PATTERN } from './post.js';

export const STORAGE_KEY = 'labels.data.v1';
export const UNCATEGORIZED_ID = '__uncategorized__';
export const UNCATEGORIZED_NAME = 'Uncategorized';
export const LABEL_NAME_MAX = 60;
export const BACKUP_FORMAT = 'labels-backup';
export const BACKUP_VERSION = 1;

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

/** Labels sorted alphabetically with post counts, then Uncategorized last (a catch-all, not a label). */
export function labelsWithCounts(data) {
  const counts = new Map();
  let uncategorized = 0;
  for (const post of Object.values(data.posts)) {
    if (post.labelIds.length === 0) uncategorized++;
    for (const id of post.labelIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const rows = Object.values(data.labels).map(l => ({ id: l.id, name: l.name, count: counts.get(l.id) ?? 0 }));
  rows.sort((a, b) => compareNames(a.name, b.name));
  rows.push({ id: UNCATEGORIZED_ID, name: UNCATEGORIZED_NAME, count: uncategorized, system: true });
  return rows;
}

/** User labels only, sorted alphabetically. */
export function sortedLabels(data) {
  return Object.values(data.labels).sort((a, b) => compareNames(a.name, b.name));
}

/** Posts for a label (or Uncategorized), newest saved first. */
export function postsForLabel(data, labelId) {
  const posts = Object.values(data.posts).filter(p =>
    labelId === UNCATEGORIZED_ID ? p.labelIds.length === 0 : p.labelIds.includes(labelId),
  );
  return posts.sort((a, b) => b.savedAt - a.savedAt);
}

export function labelName(data, labelId) {
  if (labelId === UNCATEGORIZED_ID) return UNCATEGORIZED_NAME;
  return data.labels[labelId]?.name;
}

function validateLabelName(data, name, exceptId) {
  const clean = cleanLabelName(name);
  if (!clean) throw new LabelsError('Enter a label name.');
  if (clean.length > LABEL_NAME_MAX) throw new LabelsError(`Label names can be up to ${LABEL_NAME_MAX} characters.`);
  if (labelKey(clean) === labelKey(UNCATEGORIZED_NAME)) throw new LabelsError('"Uncategorized" is reserved.');
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
    }
  }
  for (const p of Object.values(raw.posts ?? {})) {
    if (!p || typeof p.id !== 'string' || typeof p.url !== 'string') continue;
    const labelIds = Array.isArray(p.labelIds) ? [...new Set(p.labelIds.filter(id => data.labels[id]))] : [];
    data.posts[p.id] = {
      id: p.id,
      url: p.url,
      excerpt: typeof p.excerpt === 'string' ? p.excerpt : '',
      labelIds,
      savedAt: Number(p.savedAt) || 0,
      updatedAt: Number(p.updatedAt) || Number(p.savedAt) || 0,
    };
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
        if (labelId === UNCATEGORIZED_ID) throw new LabelsError('Uncategorized can’t be renamed.');
        const label = data.labels[labelId];
        if (!label) throw new LabelsError('This label no longer exists.');
        label.name = validateLabelName(data, name, labelId);
        return label;
      }),

    deleteLabel: labelId =>
      mutate(data => {
        if (labelId === UNCATEGORIZED_ID) throw new LabelsError('Uncategorized can’t be deleted.');
        if (!data.labels[labelId]) throw new LabelsError('This label no longer exists.');
        delete data.labels[labelId];
        for (const post of Object.values(data.posts)) post.labelIds = post.labelIds.filter(id => id !== labelId);
      }),

    /** Saves a new post or updates the existing record with the same ID. */
    savePost: ({ id, url, excerpt, labelIds }) =>
      mutate(data => {
        if (!POST_ID_PATTERN.test(id) || typeof url !== 'string' || !url.startsWith('https://www.linkedin.com/')) {
          throw new LabelsError('This post’s link couldn’t be identified, so it wasn’t saved.');
        }
        const ids = existingLabelIds(data, labelIds);
        const now = Date.now();
        const existing = data.posts[id];
        if (existing) {
          existing.labelIds = ids;
          if (excerpt) existing.excerpt = excerpt;
          existing.updatedAt = now;
          return { post: existing, created: false };
        }
        const post = { id, url, excerpt: excerpt || '', labelIds: ids, savedAt: now, updatedAt: now };
        data.posts[id] = post;
        return { post, created: true };
      }),

    setPostLabels: (postId, labelIds) =>
      mutate(data => {
        const post = data.posts[postId];
        if (!post) throw new LabelsError('This saved post no longer exists.');
        post.labelIds = existingLabelIds(data, labelIds);
        post.updatedAt = Date.now();
        return post;
      }),

    /** Adds a preview to a saved post that doesn't have one yet. */
    fillExcerpt: (postId, excerpt) =>
      mutate(data => {
        const post = data.posts[postId];
        if (post && !post.excerpt && excerpt) post.excerpt = excerpt;
        return post;
      }),

    removePost: postId =>
      mutate(data => {
        delete data.posts[postId];
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
          savedAt: Number(record.savedAt) || Date.now(),
          updatedAt: Date.now(),
        };
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
    labels: sortedLabels(data).map(l => ({ name: l.name, createdAt: new Date(l.createdAt || 0).toISOString() })),
    posts: Object.values(data.posts)
      .sort((a, b) => b.savedAt - a.savedAt)
      .map(p => ({
        id: p.id,
        url: p.url,
        excerpt: p.excerpt,
        labels: p.labelIds.map(id => data.labels[id]?.name).filter(Boolean),
        savedAt: new Date(p.savedAt).toISOString(),
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
    return { name, createdAt: l.createdAt === undefined ? Date.now() : parseTime(l.createdAt, where) };
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
    if (p.labels !== undefined && (!Array.isArray(p.labels) || p.labels.some(n => typeof n !== 'string'))) {
      throw new LabelsError(`${where} has invalid labels.`);
    }
    const labelNames = (p.labels ?? [])
      .map(cleanLabelName)
      .filter(n => n && labelKey(n) !== labelKey(UNCATEGORIZED_NAME));
    if (labelNames.some(n => n.length > LABEL_NAME_MAX)) throw new LabelsError(`${where} has an invalid label name.`);
    return {
      id: parsed.id,
      url: parsed.url,
      excerpt: makeExcerpt(p.excerpt ?? ''),
      labels: labelNames,
      savedAt: p.savedAt === undefined ? Date.now() : parseTime(p.savedAt, where),
    };
  });

  return { labels, posts };
}

/** Merges a validated backup into data without creating duplicate labels or posts. */
function mergeBackup(data, backup) {
  const { labels, posts } = validateBackup(backup);
  const summary = { labelsAdded: 0, postsAdded: 0, postsUpdated: 0 };

  const ensureLabel = (name, createdAt) => {
    if (labelKey(name) === labelKey(UNCATEGORIZED_NAME)) return null;
    const found = findLabelByName(data, name);
    if (found) return found.id;
    summary.labelsAdded++;
    return addLabel(data, name, createdAt).id;
  };

  for (const l of labels) ensureLabel(l.name, l.createdAt);

  for (const p of posts) {
    const labelIds = p.labels.map(name => ensureLabel(name, Date.now())).filter(Boolean);
    const existing = data.posts[p.id];
    if (existing) {
      const merged = [...new Set([...existing.labelIds, ...labelIds])];
      const changed =
        merged.length !== existing.labelIds.length || (!existing.excerpt && p.excerpt) || p.savedAt < existing.savedAt;
      existing.labelIds = merged;
      if (!existing.excerpt && p.excerpt) existing.excerpt = p.excerpt;
      existing.savedAt = Math.min(existing.savedAt, p.savedAt);
      if (changed) summary.postsUpdated++;
    } else {
      data.posts[p.id] = {
        id: p.id,
        url: p.url,
        excerpt: p.excerpt,
        labelIds: [...new Set(labelIds)],
        savedAt: p.savedAt,
        updatedAt: p.savedAt,
      };
      summary.postsAdded++;
    }
  }
  return summary;
}
