// Injected into the active LinkedIn tab only when the user clicks the Labels toolbar
// button (via chrome.scripting.executeScript + activeTab). It must stay self-contained:
// Chrome serializes the function, so it can't use imports or outer variables.
//
// It reads the visible text of the one post identified by `postId` and nothing else:
// no comments, author details, images or other posts.
//
// LinkedIn ships more than one page markup (and changes it), so it tries, in order:
//   1. known post-text elements inside the post's container
//   2. the page's own description of this post (meta tags, checked against the post ID)
//   3. a layout-based search inside the post's container: the longest text block between
//      the post header (timestamp) and the reactions bar / comment box
//   4. the tab title ("Name on LinkedIn: text…"), with the name stripped
//
// With `mode === 'diagnose'` it returns a text-free outline of the page structure instead,
// which the user can choose to copy and share when previews aren't found.

export function capturePostText(postId, mode) {
  const MAX_CHARS = 1000;
  const numericId = (String(postId).match(/(\d+)$/) || [])[1] || '';
  const clean = s =>
    String(s || '')
      .replace(/[​-‍﻿]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  // Make sure the page is still showing the post the popup identified.
  let path = location.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }
  if (!numericId || !path.includes(numericId)) return { text: '', source: 'url-mismatch' };

  const root = document.querySelector('main') || document.body;
  const COMMENTS =
    '.comments-comments-list, .comments-comment-item, .comments-comment-entity, .comments-comment-list, ' +
    '.comments-comment-box, [data-test-id="comments-section"], section.comments, .comment, ' +
    '[class*="comments-comment"], [data-testid*="comment" i], [aria-label*="comment" i][role="list"]';
  const TEXT = [
    '.feed-shared-update-v2__description',
    '.feed-shared-inline-show-more-text',
    '.update-components-text',
    '.feed-shared-text',
    '[data-test-id="main-feed-activity-card__commentary"]',
    '.attributed-text-segment-list__content',
    '[data-testid="expandable-text-box"]',
    '[data-testid*="commentary" i]',
  ].join(', ');

  // ---- find the post's container ----
  // Prefer an element whose attributes mention this post's ID. querySelectorAll returns
  // document order, so the first hit is the outermost one (the post wrapper).
  const mentionsId = el => {
    for (const attr of el.attributes) {
      if (attr.name !== 'href' && attr.value.includes(numericId)) return true;
    }
    return false;
  };
  let container = null;
  let containerById = false;
  for (const el of root.querySelectorAll('*')) {
    if (el.attributes.length && mentionsId(el)) {
      container = el;
      containerById = true;
      break;
    }
  }
  if (!container) {
    container = root.querySelector(
      '.feed-shared-update-v2, article[data-activity-urn], [data-test-id="main-feed-activity-card"], [data-urn^="urn:li:activity"]',
    );
  }

  const meta = name =>
    document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') || '';
  const canonical = meta('og:url') || document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';

  if (mode === 'diagnose') return { diagnosis: diagnose() };

  const textOf = el => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('button, script, style, svg, .visually-hidden, .a11y-text').forEach(n => n.remove());
    copy.querySelectorAll('br').forEach(br => br.replaceWith(' '));
    copy.querySelectorAll('p, div, li, h1, h2, h3, h4').forEach(n => n.append(' '));
    return clean(copy.textContent);
  };

  // ---- 1. known post-text elements ----
  if (container) {
    const known = [...container.querySelectorAll(TEXT)].find(el => !el.closest(COMMENTS));
    const text = known && textOf(known);
    if (text) return { text: text.slice(0, MAX_CHARS), source: 'known' };
  }

  // ---- 2. the page's description of this post, only if it's about this post ----
  if (canonical.includes(numericId)) {
    const description = clean(meta('og:description') || meta('description'));
    if (description) return { text: description.slice(0, MAX_CHARS), source: 'meta' };
  }

  // ---- 3. layout-based search inside the post's container ----
  if (container && containerById) {
    const text = layoutSearch(container);
    if (text) return { text: text.slice(0, MAX_CHARS), source: 'layout' };
  }

  // ---- 4. the tab title, minus the author's name ----
  const title = clean(document.title.replace(/^\(\d+\+?\)\s*/, ''));
  const onLinkedIn = title.match(/^.{1,120}? on LinkedIn: (.+)$/);
  if (onLinkedIn) {
    const text = clean(onLinkedIn[1].replace(/\s*\|\s*(LinkedIn|\d[\d,.]*\s+\S+)\s*$/i, ''));
    if (text) return { text: text.slice(0, MAX_CHARS), source: 'title' };
  }

  return { text: '', source: container ? 'no-text' : 'no-post' };

  // The post text sits after the header (author, headline, timestamp) and before the
  // reactions bar and comment box. Pick the longest plain text block in between.
  function layoutSearch(scope) {
    const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const all = [...scope.querySelectorAll('*')];

    const TIMESTAMP = /^(\d+\s?(s|m|h|d|w|mo|y|yr|min|hr)s?|edited|now|just now)\b/i;
    const header = all.find(
      el => el.tagName === 'TIME' || (el.children.length === 0 && TIMESTAMP.test(clean(el.textContent))),
    );

    const isSocialButton = el => {
      const label = clean(el.getAttribute('aria-label') || el.textContent).toLowerCase();
      return /^(like|react|comment|repost|send|share)\b/.test(label);
    };
    const footer = all.find(
      el =>
        el.matches('[role="textbox"], [contenteditable="true"], textarea, form') ||
        (el.matches('button, [role="button"]') && isSocialButton(el)) ||
        el.matches(COMMENTS),
    );

    const OFF_LIMITS =
      'a[href*="/in/"], a[href*="/company/"], a[href*="/school/"], header, nav, aside, button, [role="button"], ' +
      'time, figure, [role="dialog"]';
    const MEDIA = 'img, video, svg image, time, textarea, [role="textbox"], [contenteditable="true"], figure';

    let best = '';
    for (const el of all) {
      if (header && !before(header, el)) continue;
      if (footer && (el === footer || !before(el, footer) || el.contains(footer))) continue;
      if (el.closest(OFF_LIMITS) || el.closest(COMMENTS)) continue;
      if (el.querySelector(MEDIA)) continue;
      // Long buttons inside mean this block holds controls, not just text ("…more" is fine).
      if ([...el.querySelectorAll('button, [role="button"]')].some(b => clean(b.textContent).length > 15)) continue;
      const text = textOf(el);
      if (text.length > best.length && text.length >= 15 && text.includes(' ')) best = text;
    }
    return best;
  }

  // A text-free outline of the post area: tags and attribute names/short values only, with
  // every piece of text replaced by its length. Nothing the user wrote or read is included.
  function diagnose() {
    const scope = container || root;
    const lines = [
      `url-kind: ${path.startsWith('/posts/') ? 'posts' : 'feed-update'}`,
      `container: ${container ? (containerById ? 'found-by-id' : 'found-by-class') : 'none'}`,
      `title-has-on-linkedin: ${/ on LinkedIn: /.test(document.title)}`,
      `meta-og-url-matches: ${canonical.includes(numericId)}`,
      `meta-description-length: ${clean(meta('og:description') || meta('description')).length}`,
      '',
    ];
    const SAFE_ATTRS = /^(class|role|dir|data-[\w-]+|componentkey|aria-hidden|contenteditable|type|tabindex)$/;
    let count = 0;
    const walk = (node, depth) => {
      if (count > 2500 || depth > 40) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const len = clean(node.textContent).length;
        if (len) lines.push(`${'  '.repeat(depth)}#text(${len})`);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|SVG|PATH|NOSCRIPT)$/i.test(node.tagName)) return;
      count++;
      const attrs = [...node.attributes]
        .filter(a => SAFE_ATTRS.test(a.name))
        .map(a => {
          let v = a.value.replace(/\d{6,}/g, n => (n === numericId ? '<POST_ID>' : '<ID>'));
          if (v.length > 80) v = `${v.slice(0, 80)}…`;
          return `${a.name}="${v}"`;
        });
      const extra = [];
      if (node.hasAttribute('aria-label')) extra.push(`aria-label(${node.getAttribute('aria-label').length})`);
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') || '';
        extra.push(
          `href-kind=${(href.match(/linkedin\.com\/(\w+)|^\/(\w+)/) || []).slice(1).find(Boolean) || 'other'}`,
        );
      }
      lines.push(
        `${'  '.repeat(depth)}<${node.tagName.toLowerCase()} ${[...attrs, ...extra].join(' ')}>`.replace(/ >$/, '>'),
      );
      for (const child of node.childNodes) walk(child, depth + 1);
    };
    walk(scope, 0);
    return lines.join('\n').slice(0, 120000);
  }
}
