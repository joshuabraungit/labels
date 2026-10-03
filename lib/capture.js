// Injected into the active LinkedIn tab only when the user clicks the Labels toolbar
// button (via chrome.scripting.executeScript + activeTab). It must stay self-contained:
// Chrome serializes the function, so it can't use imports or outer variables.
//
// It reads the visible text of the one post identified by `postId` and nothing else:
// no comments, author details, images or other posts.

export function capturePostText(postId) {
  const MAX_CHARS = 1000;
  const numericId = (String(postId).match(/(\d+)$/) || [])[1] || '';

  // Make sure the page is still showing the post the popup identified.
  let path = location.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }
  if (!numericId || !path.includes(numericId)) return { text: '', reason: 'url-mismatch' };

  const root = document.querySelector('main') || document.body;
  const COMMENTS =
    '.comments-comments-list, .comments-comment-item, .comments-comment-entity, .comments-comment-list, ' +
    '.comments-comment-box, [data-test-id="comments-section"], section.comments, .comment';
  const TEXT = [
    '.feed-shared-update-v2__description',
    '.feed-shared-inline-show-more-text',
    '.update-components-text',
    '.feed-shared-text',
    '[data-test-id="main-feed-activity-card__commentary"]',
    '.attributed-text-segment-list__content',
  ].join(', ');

  // Prefer the container that carries this post's ID; otherwise the first post on the page.
  let container = null;
  for (const el of root.querySelectorAll('[data-urn], [data-id], [data-activity-urn]')) {
    const urn = el.getAttribute('data-urn') || el.getAttribute('data-id') || el.getAttribute('data-activity-urn') || '';
    if (urn === postId || (urn.startsWith('urn:li:') && urn.endsWith(`:${numericId}`))) {
      container = el;
      break;
    }
  }
  if (!container) {
    container = root.querySelector(
      '.feed-shared-update-v2, article[data-activity-urn], [data-test-id="main-feed-activity-card"], [data-urn^="urn:li:activity"]',
    );
  }
  if (!container) return { text: '', reason: 'no-post' };

  const textEl = [...container.querySelectorAll(TEXT)].find(el => !el.closest(COMMENTS));
  if (!textEl) return { text: '', reason: 'no-text' };

  const clone = textEl.cloneNode(true);
  clone.querySelectorAll('button, script, style, .visually-hidden, .a11y-text').forEach(el => el.remove());
  clone.querySelectorAll('br').forEach(br => br.replaceWith(' '));
  clone.querySelectorAll('p, div, li, h1, h2, h3, h4').forEach(el => el.append(' '));
  const text = (clone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS);
  return { text, reason: text ? 'ok' : 'no-text' };
}
