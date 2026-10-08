// Handles storage for the Label buttons and picker (content.js), so labels and saved posts
// are read and written by the same code the Library uses. Also opens the Library.
import { classifyUrl, makeExcerpt } from './lib/post.js';
import { createStore, LabelsError, labelsWithCounts } from './lib/store.js';

const store = createStore(chrome.storage.local);

function view(data, postId) {
  return {
    labels: labelsWithCounts(data).map(l => ({
      id: l.id,
      name: l.name,
      count: l.count,
      color: data.labels[l.id]?.color ?? null,
    })),
    post: postId ? (data.posts[postId] ?? null) : null,
    savedIds: Object.keys(data.posts),
    // Label names per saved post (A to Z), shown on the feed buttons.
    savedLabels: Object.fromEntries(
      Object.values(data.posts).map(p => [
        p.id,
        p.labelIds
          .map(id => data.labels[id]?.name)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
      ]),
    ),
  };
}

const handlers = {
  // Adds labels to several posts at once (the Saved posts page's "select posts").
  async labelMany({ posts, labelIds }) {
    const records = (Array.isArray(posts) ? posts : []).flatMap(({ postId, text }) => {
      const page = classifyUrl(`https://www.linkedin.com/feed/update/${postId}/`);
      if (page.kind !== 'post' || page.id !== postId) return [];
      return [{ id: page.id, url: page.url, excerpt: makeExcerpt(text), text }];
    });
    const { data, result } = await store.labelMany(records, labelIds);
    return { ...view(data, null), ...result };
  },

  // The picker's "Library" link.
  async openLibrary(message, sender) {
    await openLibrary({ tabId: sender.tab?.id, windowId: sender.tab?.windowId });
    return {};
  },

  // Adds the full text (and a preview, if missing) to an already-saved post. Never shortens.
  async fillText({ postId, text }) {
    await store.fillExcerpt(postId, makeExcerpt(text), text);
    return {};
  },

  async getState({ postId }) {
    return view(await store.load(), postId);
  },

  async createLabel({ name, postId }) {
    const { data, result } = await store.createLabel(name);
    return { ...view(data, postId), created: result };
  },

  async savePost({ postId, text, labelIds }) {
    // Rebuild the link from the ID so only a real post URL can be stored.
    const page = classifyUrl(`https://www.linkedin.com/feed/update/${postId}/`);
    if (page.kind !== 'post' || page.id !== postId) {
      throw new LabelsError('This post’s link couldn’t be identified, so it wasn’t saved.');
    }
    const { data, result } = await store.savePost({
      id: page.id,
      url: page.url,
      excerpt: makeExcerpt(text),
      text,
      labelIds,
    });
    return { ...view(data, postId), created: result.created, removed: Boolean(result.removed) };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = message?.type && handlers[message.type];
  if (!handler || sender.id !== chrome.runtime.id) return false;
  handler(message, sender)
    .then(result => sendResponse({ ok: true, result }))
    .catch(err => {
      if (!(err instanceof LabelsError)) console.error(err);
      sendResponse({
        ok: false,
        error: err instanceof LabelsError ? err.message : 'Something went wrong. Please try again.',
      });
    });
  return true;
});

// The toolbar icon opens the Library in Chrome's side panel, next to the page.
function panelOnClick() {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(err => console.warn(err));
}
chrome.runtime.onInstalled.addListener(panelOnClick);
chrome.runtime.onStartup.addListener(panelOnClick);
panelOnClick();

// Opens the Library in the side panel, or as a tab if the panel can't open.
async function openLibrary({ tabId, windowId }) {
  try {
    await chrome.sidePanel.open(tabId ? { tabId } : { windowId });
  } catch (err) {
    console.warn('Labels: could not open the side panel', err);
    await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?mode=page') });
  }
}

// Keyboard shortcut (Alt+Shift+L by default, changeable at chrome://extensions/shortcuts).
// On LinkedIn it opens the label picker for the post being looked at; elsewhere it opens
// the Library.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'label-post') return;
  const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  try {
    if (!target?.id) throw new Error('no tab');
    const reply = await chrome.tabs.sendMessage(target.id, { type: 'labels-shortcut' });
    if (reply?.handled) return;
  } catch {
    // Not a LinkedIn tab (or it was open before Labels was installed).
  }
  await openLibrary({ windowId: target?.windowId });
});
