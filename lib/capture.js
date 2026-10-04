// Reads LinkedIn posts. Shared by:
//   - the feed buttons (content.js loads this file as a content script), and
//   - the toolbar popup (injects it on click via chrome.scripting + activeTab).
// It's a classic script made only of function declarations, so loading it twice in the
// same page is harmless.
//
// It only ever reads the visible text of one post: no comments, author details, images
// or other posts. LinkedIn ships more than one page markup (and changes it), so text is
// looked for in this order:
//   1. known post-text elements inside the post
//   2. (post pages only) the page's own description of this post, checked against its ID
//   3. a layout-based search inside the post: the longest text block between the post
//      header (timestamp) and the reactions bar / comment box
//   4. (post pages only) the tab title ("Name on LinkedIn: text…"), with the name stripped

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
].join(', ');

/** Visible text of an element, without buttons ("…more") or screen-reader-only labels. */
function labelsTextOf(el) {
  const copy = el.cloneNode(true);
  copy
    .querySelectorAll('button, script, style, svg, .visually-hidden, .a11y-text, [data-labels-ui]')
    .forEach(n => n.remove());
  copy.querySelectorAll('br').forEach(br => br.replaceWith(' '));
  copy.querySelectorAll('p, div, li, h1, h2, h3, h4').forEach(n => n.append(' '));
  return labelsClean(copy.textContent);
}

/** Text of one post container, or '' if none is found. */
function labelsPostText(container) {
  const MAX_CHARS = 1000;
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
  return /^(like|react|comment|repost|send|share)\b/.test(label);
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

/**
 * Used by the toolbar popup on an individual post page. Checks the page still shows
 * `postId`, then reads its text. With mode 'diagnose', returns a text-free outline of
 * the page instead (works on any LinkedIn page).
 */
function capturePostText(postId, mode) {
  const MAX_CHARS = 1000;
  const numericId = (String(postId || '').match(/(\d+)$/) || [])[1] || '';
  const root = document.querySelector('main') || document.body;
  const meta = name =>
    document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') || '';
  const canonical = meta('og:url') || document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';

  let path = location.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }

  // The post's wrapper: an element that carries this post's ID.
  let container = null;
  let containerById = false;
  if (numericId) {
    const match = labelsFindPosts(root).find(p => p.id.endsWith(`:${numericId}`));
    if (match) {
      container = match.container;
      containerById = true;
    }
  }
  if (!container && numericId) {
    container = root.querySelector(
      '.feed-shared-update-v2, article[data-activity-urn], [data-test-id="main-feed-activity-card"], [data-urn^="urn:li:activity"]',
    );
  }

  if (mode === 'diagnose') {
    const posts = labelsFindPosts(root);
    return {
      diagnosis: labelsDiagnose(container || posts[0]?.container || root, numericId, [
        `page-kind: ${path.startsWith('/posts/') ? 'posts' : path.startsWith('/feed/update/') ? 'feed-update' : path.split('/')[1] || 'home'}`,
        `posts-with-id-found: ${posts.length}`,
        `container: ${container ? (containerById ? 'found-by-id' : 'found-by-class') : 'none'}`,
        `title-has-on-linkedin: ${/ on LinkedIn: /.test(document.title)}`,
        `meta-og-url-matches: ${Boolean(numericId) && canonical.includes(numericId)}`,
        `meta-description-length: ${labelsClean(meta('og:description') || meta('description')).length}`,
      ]),
    };
  }

  // Make sure the page is still showing the post the popup identified.
  if (!numericId || !path.includes(numericId)) return { text: '', source: 'url-mismatch' };

  // 1. known post-text elements
  if (container) {
    const known = [...container.querySelectorAll(LABELS_TEXT)].find(el => !el.closest(LABELS_COMMENTS));
    const text = known ? labelsTextOf(known) : '';
    if (text) return { text: text.slice(0, MAX_CHARS), source: 'known' };
  }

  // 2. the page's description of this post, only if it's about this post
  if (canonical.includes(numericId)) {
    const description = labelsClean(meta('og:description') || meta('description'));
    if (description) return { text: description.slice(0, MAX_CHARS), source: 'meta' };
  }

  // 3. layout-based search inside the post's wrapper
  if (container && containerById) {
    const text = labelsLayoutSearch(container);
    if (text) return { text: text.slice(0, MAX_CHARS), source: 'layout' };
  }

  // 4. the tab title, minus the author's name
  const title = labelsClean(document.title.replace(/^\(\d+\+?\)\s*/, ''));
  const onLinkedIn = title.match(/^.{1,120}? on LinkedIn: (.+)$/);
  if (onLinkedIn) {
    const text = labelsClean(onLinkedIn[1].replace(/\s*\|\s*(LinkedIn|\d[\d,.]*\s+\S+)\s*$/i, ''));
    if (text) return { text: text.slice(0, MAX_CHARS), source: 'title' };
  }

  return { text: '', source: container ? 'no-text' : 'no-post' };
}

/**
 * A text-free outline of part of the page: tags and attribute names/short values only,
 * with every piece of text replaced by its length. No post text, names or links.
 */
function labelsDiagnose(scope, numericId, headerLines) {
  const lines = [...headerLines, ''];
  const SAFE_ATTRS = /^(class|role|dir|data-[\w-]+|componentkey|aria-hidden|contenteditable|type|tabindex)$/;
  let count = 0;
  const walk = (node, depth) => {
    if (count > 2500 || depth > 40) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = labelsClean(node.textContent).length;
      if (len) lines.push(`${'  '.repeat(depth)}#text(${len})`);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|SVG|PATH|NOSCRIPT)$/i.test(node.tagName)) return;
    if (node.hasAttribute('data-labels-ui')) return;
    count++;
    const attrs = [...node.attributes]
      .filter(a => SAFE_ATTRS.test(a.name))
      .map(a => {
        let v = a.value.replace(/\d{6,}/g, n => (numericId && n === numericId ? '<POST_ID>' : '<ID>'));
        if (v.length > 80) v = `${v.slice(0, 80)}…`;
        return `${a.name}="${v}"`;
      });
    const extra = [];
    if (node.hasAttribute('aria-label')) extra.push(`aria-label(${node.getAttribute('aria-label').length})`);
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      const kind = (href.match(/linkedin\.com\/(\w+)|^\/(\w+)/) || []).slice(1).find(Boolean) || 'other';
      extra.push(`href-kind=${kind}${labelsUrnFrom(href) ? '+post-id' : ''}`);
    }
    lines.push(
      `${'  '.repeat(depth)}<${node.tagName.toLowerCase()} ${[...attrs, ...extra].join(' ')}>`.replace(/ >$/, '>'),
    );
    for (const child of node.childNodes) walk(child, depth + 1);
  };
  walk(scope, 0);
  return lines.join('\n').slice(0, 120000);
}
