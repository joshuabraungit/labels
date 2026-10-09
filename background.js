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
  // The picker's "Library" link, and "Sort them" on the Saved posts page.
  async openLibrary({ view }) {
    await openLibrary(view === 'sort' ? '#sort' : '');
    return {};
  },

  // "Add N posts to Labels" on LinkedIn's Saved posts page: everything under "To sort".
  async addToSort({ posts }) {
    const records = (Array.isArray(posts) ? posts : []).flatMap(({ postId, text, meta }) => {
      const page = classifyUrl(`https://www.linkedin.com/feed/update/${postId}/`);
      if (page.kind !== 'post' || page.id !== postId) return [];
      return [{ id: page.id, url: page.url, excerpt: makeExcerpt(text), text, meta }];
    });
    const { data, result } = await store.addToSort(records);
    return { ...view(data, null), added: result.added };
  },

  // Adds the full text (and a preview, if missing) to an already-saved post. Never shortens.
  async fillText({ postId, text, meta }) {
    await store.fillExcerpt(postId, makeExcerpt(text), text, meta);
    return {};
  },

  async getState({ postId }) {
    return view(await store.load(), postId);
  },

  async createLabel({ name, postId }) {
    const { data, result } = await store.createLabel(name);
    return { ...view(data, postId), created: result };
  },

  async savePost({ postId, text, labelIds, meta }) {
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
      meta,
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

// The Library is a page in a tab. The toolbar icon (and the picker's "Library" link)
// switches to it if it's already open, or opens it.
const LIBRARY_URL = chrome.runtime.getURL('library.html');

async function openLibrary(hash = '') {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    const open = contexts.find(c => c.tabId >= 0 && c.documentUrl?.startsWith(LIBRARY_URL));
    if (open) {
      await chrome.tabs.update(open.tabId, { active: true, ...(hash ? { url: LIBRARY_URL + hash } : {}) });
      await chrome.windows.update(open.windowId, { focused: true });
      return;
    }
  } catch (err) {
    console.warn('Labels: could not look for an open Library tab', err);
  }
  await chrome.tabs.create({ url: LIBRARY_URL + hash });
}

chrome.action.onClicked.addListener(() => openLibrary());

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
  await openLibrary();
});
