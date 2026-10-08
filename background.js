// Handles storage for the feed buttons (content.js), so labels and saved posts are read
// and written by the same code the toolbar popup uses.
import { classifyUrl, makeExcerpt } from './lib/post.js';
import { createStore, LabelsError, labelsWithCounts, pinnedCount, postsForLabel, postsOnlyIn } from './lib/store.js';

const store = createStore(chrome.storage.local);

function view(data, postId) {
  return {
    labels: labelsWithCounts(data).map(l => ({
      id: l.id,
      name: l.name,
      count: l.count,
      only: postsOnlyIn(data, l.id),
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
    pinned: pinnedCount(data),
  };
}

function labelPostRows(data, labelId) {
  return postsForLabel(data, labelId).map(p => ({
    id: p.id,
    url: p.url,
    excerpt: p.excerpt,
    savedAt: p.savedAt,
    pinnedAt: p.pinnedAt || 0,
  }));
}

const handlers = {
  // A label's saved posts, newest first, for the list inside the picker.
  async labelPosts({ labelId }) {
    return { posts: labelPostRows(await store.load(), labelId) };
  },

  // Takes a post out of one label. Other labels are untouched; removing a post's last
  // label deletes the saved post.
  async setInLabel({ postId, labelId, currentPostId }) {
    const post = (await store.load()).posts[postId];
    if (!post) throw new LabelsError('This saved post no longer exists.');
    const labelIds = post.labelIds.filter(id => id !== labelId);
    if (labelIds.length === 0) {
      const { data } = await store.removePost(postId);
      return { ...view(data, currentPostId), posts: labelPostRows(data, labelId) };
    }
    const { data } = await store.setPostLabels(postId, labelIds);
    return { ...view(data, currentPostId), posts: labelPostRows(data, labelId) };
  },

  // Deletes a label from the picker (after it asks). Posts with no other label go with it.
  async deleteLabel({ labelId, postId }) {
    const { data, result } = await store.deleteLabel(labelId);
    return { ...view(data, postId), removed: result.removed };
  },

  // Pins or unpins a post from the picker's list of a label's posts.
  async setPinned({ postId, pinned, labelId, currentPostId }) {
    const { data } = await store.setPinned(postId, pinned);
    return { ...view(data, currentPostId), posts: labelPostRows(data, labelId) };
  },

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
