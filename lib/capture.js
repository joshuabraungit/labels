// Reads LinkedIn posts for the Label buttons (content.js loads this file as a content
// script before content.js). Plain function declarations, so loading it twice is harmless.
//
// For the post being labeled it reads only that post: its visible text (expanding
// "…see more" first), its author's name, headline and photo, and its main image. Never
// comments or other posts. LinkedIn ships more than one page markup (and changes it), so
// text is looked for in LinkedIn's known post-text elements first, then with a
// layout-based search between the post header (timestamp) and the reactions bar.

function labelsClean(s) {
  return String(s || '')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

var LABELS_COMMENTS =
  '.comments-comments-list, .comments-comment-item, .comments-comment-entity, .comments-comment-list, ' +
  '.comments-comment-box, [data-test-id="comments-section"], section.comments, .comment, ' +
  '[class*="comments-comment"], [data-testid*="comment" i], [aria-label*="comment" i][role="list"]';

var LABELS_TEXT = [
  '.feed-shared-update-v2__description',
  '.feed-shared-inline-show-more-text',
  '.update-components-text',
  '.feed-shared-text',
  '[data-test-id="main-feed-activity-card__commentary"]',
  '.attributed-text-segment-list__content',
  '[data-testid="expandable-text-box"]',
  '[data-testid*="commentary" i]',
  '.entity-result__content-summary',
].join(', ');

/** Visible text of an element, without buttons ("…more") or screen-reader-only labels. */
function labelsTextOf(el) {
  const copy = el.cloneNode(true);
  copy
    .querySelectorAll('button, script, style, svg, .visually-hidden, .a11y-text, [data-labels-ui]')
    .forEach(n => n.remove());
  // Keep line breaks so the saved full text keeps its paragraphs.
  copy.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  copy.querySelectorAll('p, div, li, h1, h2, h3, h4').forEach(n => n.append('\n'));
  return labelsCleanLines(copy.textContent);
}

/** Like labelsClean, but keeps (at most double) line breaks. */
function labelsCleanLines(s) {
  return String(s || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Clicks the post's own "…see more" toggle (never one in the comments) so its whole text is
 * on the page. This is the only thing Labels ever clicks on LinkedIn, and only on the post
 * being labeled. Returns true if it clicked.
 */
function labelsExpandPost(container) {
  if (!container) return false;
  const MORE = /^(…|\.\.\.)?\s*(see )?more$/i;
  const toggle = [...container.querySelectorAll('button, [role="button"]')].find(b => {
    if (b.closest(LABELS_COMMENTS) || b.closest('[data-labels-ui]')) return false;
    const text = labelsClean(b.textContent);
    if (/\bless$/i.test(text)) return false;
    if (b.matches('[data-testid="expandable-text-button"], .feed-shared-inline-show-more-text__see-more-less-toggle')) {
      return true;
    }
    return MORE.test(text) || /^see more\b/i.test(labelsClean(b.getAttribute('aria-label')));
  });
  if (!toggle) return false;
  toggle.click();
  return true;
}

/**
 * Who wrote the post and its main image: { name, headline, avatar, image }, any of them ''
 * when not found. Read from the post's header (the author's profile link) and body only,
 * never from comments.
 */
function labelsPostMeta(container) {
  const meta = { name: '', headline: '', avatar: '', image: '' };
  if (!container) return meta;
  const outside = el => !el.closest(LABELS_COMMENTS) && !el.closest('[data-labels-ui]');
  const first = sel => [...container.querySelectorAll(sel)].find(outside);
  const textOf = el => (el ? labelsClean(el.textContent) : '');
  // Screen-reader-only bits, like the "Status is online" label on an avatar's presence dot.
  const hidden = el => el.closest('.visually-hidden, .a11y-text, .sr-only, [class*="presence"]');
  const visibleText = el =>
    labelsClean(
      [...el.querySelectorAll('*')]
        .filter(c => !c.children.length && !hidden(c))
        .map(c => c.textContent)
        .join(' '),
    );
  const usableUrl = src => (/^(https:\/\/|data:image\/)/.test(src || '') && src.length < 4000 ? src : '');
  const NOISE =
    /^(•|·|status is\b|view\b.*\bprofile|\d+(st|nd|rd|th)\b|follow|following|promoted|verified|premium|edited|\d+\s*(s|m|h|d|w|mo|yr)s?\b)/i;
  const tidyName = s => s.replace(/\s*[•·].*$/, '').trim();

  // 1. LinkedIn's known header markup.
  meta.name = tidyName(
    textOf(
      first(
        '.update-components-actor__title span[aria-hidden="true"], .update-components-actor__name, ' +
          '.update-components-actor__title, .entity-result__title-text a span[aria-hidden="true"]',
      ),
    ),
  );
  meta.headline = textOf(
    first(
      '.update-components-actor__description span[aria-hidden="true"], .update-components-actor__description, ' +
        '.entity-result__primary-subtitle',
    ),
  );
  meta.avatar = usableUrl(
    first(
      '.update-components-actor__avatar img, .update-components-actor__image img, .update-components-actor img, ' +
        '.entity-result__universal-image img, .entity-result__content-image img',
    )?.getAttribute('src'),
  );

  // 2. Otherwise the first profile link with text: its text pieces are the name, then the headline.
  const links = [...container.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')].filter(outside);
  const authorLink = links.find(a => visibleText(a) && !NOISE.test(visibleText(a)));
  if (authorLink) {
    const pieces = [...authorLink.querySelectorAll('*')]
      .filter(el => !el.children.length && !hidden(el) && textOf(el))
      .map(textOf)
      .filter(t => !NOISE.test(t));
    if (!pieces.length) pieces.push(textOf(authorLink));
    if (!meta.name) meta.name = tidyName(pieces[0]);
    if (!meta.headline && pieces[1]) meta.headline = pieces[1];
    // Headline next to the link rather than in it: the first line after the name in the
    // small header block around it (never climbing into the post's text).
    const body = labelsPostText(container).text.slice(0, 40);
    for (
      let block = authorLink.parentElement, i = 0;
      !meta.headline && block && i < 4;
      block = block.parentElement, i++
    ) {
      if (!container.contains(block) || labelsClean(block.textContent).length > 400) break;
      // Stop at the post body or the actions bar.
      if ((body && labelsClean(block.textContent).includes(body)) || block.querySelector('button, [role="button"]'))
        break;
      const next = [...block.querySelectorAll('*')].find(
        el =>
          !el.children.length &&
          !authorLink.contains(el) &&
          authorLink.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING &&
          outside(el) &&
          !hidden(el) &&
          !el.closest(LABELS_TEXT) &&
          textOf(el).length > 2 &&
          !NOISE.test(textOf(el)),
      );
      if (next) meta.headline = textOf(next);
    }
    if (!meta.avatar) {
      const path = authorLink.getAttribute('href').split('?')[0];
      const sameProfile = links.filter(a => a.getAttribute('href').split('?')[0] === path);
      meta.avatar = usableUrl(
        sameProfile
          .map(a => a.querySelector('img'))
          .find(Boolean)
          ?.getAttribute('src'),
      );
    }
  }

  // The post's own image: known image blocks first, then any large picture outside the header.
  const known = first('.update-components-image img, .feed-shared-image img, .update-components-image__image');
  const big = [...container.querySelectorAll('img')].find(img => {
    if (!outside(img) || img.closest('a[href*="/in/"], a[href*="/company/"]')) return false;
    const r = img.getBoundingClientRect();
    return Math.max(r.width, img.naturalWidth || 0) >= 160 && Math.max(r.height, img.naturalHeight || 0) >= 100;
  });
  meta.image = usableUrl((known || big)?.getAttribute('src'));

  meta.name = meta.name.slice(0, 100);
  meta.headline = meta.headline.slice(0, 220);
  return meta;
}

/** Text of one post container, or '' if none is found. */
function labelsPostText(container) {
  const MAX_CHARS = 4000;
  const known = [...container.querySelectorAll(LABELS_TEXT)].find(el => !el.closest(LABELS_COMMENTS));
  const knownText = known ? labelsTextOf(known) : '';
  if (knownText) return { text: knownText.slice(0, MAX_CHARS), source: 'known' };
  const found = labelsLayoutSearch(container);
  return { text: found.slice(0, MAX_CHARS), source: found ? 'layout' : 'no-text' };
}

// The post text sits after the header (author, headline, timestamp) and before the
// reactions bar and comment box. Pick the longest plain text block in between.
function labelsLayoutSearch(scope) {
  const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const all = [...scope.querySelectorAll('*')].filter(el => !el.closest('[data-labels-ui]'));

  const TIMESTAMP = /^(\d+\s?(s|m|h|d|w|mo|y|yr|min|hr)s?|edited|now|just now)\b/i;
  const header = all.find(
    el => el.tagName === 'TIME' || (el.children.length === 0 && TIMESTAMP.test(labelsClean(el.textContent))),
  );

  const footer = all.find(
    el =>
      el.matches('[role="textbox"], [contenteditable="true"], textarea, form') ||
      (el.matches('button, [role="button"]') && labelsIsSocialButton(el)) ||
      el.matches(LABELS_COMMENTS),
  );

  const OFF_LIMITS =
    'a[href*="/in/"], a[href*="/company/"], a[href*="/school/"], header, nav, aside, button, [role="button"], ' +
    'time, figure, [role="dialog"]';
  const MEDIA = 'img, video, svg image, time, textarea, [role="textbox"], [contenteditable="true"], figure';

  let best = '';
  for (const el of all) {
    if (header && !before(header, el)) continue;
    if (footer && (el === footer || !before(el, footer) || el.contains(footer))) continue;
    if (el.closest(OFF_LIMITS) || el.closest(LABELS_COMMENTS)) continue;
    if (el.querySelector(MEDIA)) continue;
    // Long buttons inside mean this block holds controls, not just text ("…more" is fine).
    if ([...el.querySelectorAll('button, [role="button"]')].some(b => labelsClean(b.textContent).length > 15)) continue;
    const text = labelsTextOf(el);
    if (text.length > best.length && text.length >= 15 && text.includes(' ')) best = text;
  }
  return best;
}

function labelsIsSocialButton(el) {
  const label = labelsClean(el.getAttribute('aria-label') || el.textContent).toLowerCase();
  return /^(like|react|reaction|reactions|comment|repost|send|share)\b/.test(label);
}

/**
 * LinkedIn's newer feed doesn't show post URNs. Each post's comment area is keyed by a
 * short protobuf token (e.g. "CgsIgMC7kNTUpL/QAQ-replaceableCommentTools…") whose outer
 * field is the thread type and whose inner zigzag varint is the post ID. LinkedIn post
 * IDs start with a millisecond timestamp, which is checked as a sanity test.
 */
function labelsDecodeThreadKey(token) {
  let bytes;
  try {
    const bin = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
    bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length < 4 || (bytes[0] & 7) !== 2) return null;
  const type = { 1: 'activity', 2: 'ugcPost', 3: 'share' }[bytes[0] >> 3];
  const len = bytes[1];
  const inner = bytes.subarray(2, 2 + len);
  if (!type || inner.length !== len || inner[0] !== 0x08) return null;
  let value = 0n;
  let shift = 0n;
  let i = 1;
  for (; i < inner.length; i++) {
    value |= BigInt(inner[i] & 0x7f) << shift;
    shift += 7n;
    if (!(inner[i] & 0x80)) break;
  }
  if (i >= inner.length || value & 1n) return null;
  const id = value >> 1n;
  const ms = Number(id >> 22n);
  if (ms < Date.UTC(2014, 0, 1) || ms > Date.now() + 86400000) return null;
  return `urn:li:${type}:${id}`;
}

/** Post cards in LinkedIn's newer feed, identified through their comment threads. */
function labelsThreadKeyHits(root) {
  const byCard = new Map();
  for (const el of root.querySelectorAll('[componentkey*="replaceableComment"]')) {
    const key = el.getAttribute('componentkey') || '';
    const card = el.closest('[componentkey^="update-card-focus"], [role="listitem"]');
    if (!card || !root.contains(card) || card.closest('[data-labels-ui], aside, nav, header')) continue;
    // A comment's own URN names its post exactly; prefer it over the decoded token.
    const fromComment = key.match(/urn:li:comment:\((activity|ugcpost|share):(\d{10,25}),/i);
    if (fromComment) {
      byCard.set(card, `urn:li:${LABELS_URN_TYPES[fromComment[1].toLowerCase()]}:${fromComment[2]}`);
      continue;
    }
    const token = key.match(/^([A-Za-z0-9+/_=]{8,})-replaceableCommentTools/);
    const urn = token && !byCard.has(card) ? labelsDecodeThreadKey(token[1]) : null;
    if (urn) byCard.set(card, urn);
  }
  return [...byCard].map(([el, urn]) => ({ el, urn }));
}

var LABELS_URN_TYPES = { activity: 'activity', share: 'share', ugcpost: 'ugcPost' };

/** The post URN mentioned in an attribute value, ignoring comment URNs. */
function labelsUrnFrom(value) {
  let v = String(value || '');
  if (v.includes('%3A')) {
    try {
      v = decodeURIComponent(v);
    } catch {
      // keep as is
    }
  }
  if (/comment/i.test(v)) return null;
  let m = v.match(/urn:li:(activity|share|ugcpost):(\d{10,25})/i);
  if (!m) m = v.match(/\/posts\/[^/?#]*?[-_](activity|share|ugcpost)-(\d{10,25})(?=-|\/|\?|#|$)/i);
  return m ? `urn:li:${LABELS_URN_TYPES[m[1].toLowerCase()]}:${m[2]}` : null;
}

/**
 * Finds the posts on the page and the element that wraps each one. A post is identified
 * only by a LinkedIn post URN found in the page (attributes or links); anything without
 * one is skipped rather than guessed. Each post's wrapper is the largest ancestor that
 * doesn't also contain another post.
 */
function labelsFindPosts(root) {
  const XPATH =
    './/*[@*[contains(., "urn:li:activity:") or contains(., "urn:li:share:") or contains(., "urn:li:ugcPost:")' +
    ' or contains(., "urn%3Ali%3A") or contains(., "-activity-") or contains(., "-ugcPost-") or contains(., "-share-")]]';
  const snap = document.evaluate(XPATH, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  const hits = [];
  for (let i = 0; i < snap.snapshotLength; i++) {
    const el = snap.snapshotItem(i);
    if (el.closest('[data-labels-ui], aside, nav, header') || el.closest(LABELS_COMMENTS)) continue;
    for (const attr of el.attributes) {
      const urn = labelsUrnFrom(attr.value);
      if (urn) {
        hits.push({ el, urn });
        break;
      }
    }
  }

  for (const hit of labelsThreadKeyHits(root)) {
    if (!hits.some(h => h.el.contains(hit.el) || hit.el.contains(h.el))) hits.push(hit);
  }

  // Which posts each ancestor contains.
  const contains = new Map();
  for (const { el, urn } of hits) {
    for (let a = el; a && a !== root; a = a.parentElement) {
      let set = contains.get(a);
      if (!set) contains.set(a, (set = new Set()));
      set.add(urn);
    }
  }

  const wrappers = new Map();
  for (const { el, urn } of hits) {
    let wrapper = el;
    while (wrapper.parentElement && wrapper.parentElement !== root && contains.get(wrapper.parentElement)?.size === 1) {
      wrapper = wrapper.parentElement;
    }
    const current = wrappers.get(urn);
    if (!current || wrapper.contains(current)) wrappers.set(urn, wrapper);
  }

  // Drop posts nested inside another post (reshares): the outer post gets the button.
  const all = [...wrappers.values()];
  return [...wrappers]
    .filter(([, el]) => !all.some(other => other !== el && other.contains(el)))
    .map(([id, container]) => ({ id, container }));
}
