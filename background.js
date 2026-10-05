// Handles storage for the feed buttons (content.js), so labels and saved posts are read
// and written by the same code the toolbar popup uses.
import { classifyUrl, makeExcerpt } from './lib/post.js';
import { createStore, LabelsError, labelsWithCounts, postsForLabel, UNCATEGORIZED_ID } from './lib/store.js';

const store = createStore(chrome.storage.local);

function view(data, postId) {
  return {
    labels: labelsWithCounts(data)
      .filter(l => l.id !== UNCATEGORIZED_ID)
      .map(l => ({ id: l.id, name: l.name, count: l.count })),
    post: postId ? (data.posts[postId] ?? null) : null,
    savedIds: Object.keys(data.posts),
  };
}

const handlers = {
  // A label's saved posts, newest first, for the list inside the picker.
  async labelPosts({ labelId }) {
    const data = await store.load();
    return {
      posts: postsForLabel(data, labelId).map(p => ({ id: p.id, url: p.url, excerpt: p.excerpt, savedAt: p.savedAt })),
    };
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
      labelIds,
    });
    return { ...view(data, postId), created: result.created };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = message?.type && handlers[message.type];
  if (!handler || sender.id !== chrome.runtime.id) return false;
  handler(message)
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

// Keyboard shortcut (Alt+Shift+L by default, changeable at chrome://extensions/shortcuts).
// On LinkedIn it opens the label picker for the post being looked at; elsewhere it opens
// the Labels popup.
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
  try {
    await chrome.action.openPopup();
  } catch (err) {
    console.warn('Labels: could not open the popup', err);
  }
});
