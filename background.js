// Handles storage for the feed buttons (content.js), so labels and saved posts are read
// and written by the same code the toolbar popup uses.
import { classifyUrl, makeExcerpt } from './lib/post.js';
import { createStore, LabelsError, sortedLabels } from './lib/store.js';

const store = createStore(chrome.storage.local);

function view(data, postId) {
  return {
    labels: sortedLabels(data).map(l => ({ id: l.id, name: l.name })),
    post: postId ? (data.posts[postId] ?? null) : null,
    savedIds: Object.keys(data.posts),
  };
}

const handlers = {
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
