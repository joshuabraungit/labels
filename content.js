// Adds a small "Label" button to each LinkedIn post (feed and post pages) that opens a
// label picker for that post. Posts are only given a button when their LinkedIn post ID
// can be found in the page, so a click always saves the post the button sits on.
// Uses lib/capture.js (loaded before this file) to find posts and read their text.
// Nothing is clicked, fetched or automated on LinkedIn; reading happens on click only.

(() => {
  if (window.labelsContentLoaded) return;
  window.labelsContentLoaded = true;

  const TAG_ICON =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2 2.75C2 2.34 2.34 2 2.75 2h4.69c.2 0 .39.08.53.22l6.06 6.06c.3.3.3.77 0 1.06l-4.69 4.69a.75.75 0 0 1-1.06 0L2.22 7.97A.75.75 0 0 1 2 7.44zm3 3.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5"/></svg>';

  const BASE_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    button { font: inherit; cursor: pointer; }
  `;

  const BUTTON_CSS = `${BASE_CSS}
    .label-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px; border-radius: 999px;
      border: 1px solid #d9d3ee; background: #fff; color: #5c40ab;
      font-size: 13px; font-weight: 600; line-height: 1.2;
    }
    .label-btn:hover { background: #f2eefb; }
    .label-btn.saved { background: #6d4fc2; border-color: #6d4fc2; color: #fff; }
    .label-btn.saved:hover { background: #5c40ab; }
    .label-btn:focus-visible { outline: 2px solid #6d4fc2; outline-offset: 2px; }
  `;

  const PANEL_CSS = `${BASE_CSS}
    .panel {
      position: fixed; z-index: 2147483000; width: 320px; max-width: calc(100vw - 16px);
      background: #fff; color: #1c1b22; border: 1px solid #ececf0; border-radius: 12px;
      box-shadow: 0 12px 32px rgba(20, 20, 40, 0.18); font-size: 14px; line-height: 1.45;
      padding: 14px 16px 16px;
    }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .head .icon { color: #6d4fc2; display: inline-flex; }
    .head h2 { flex: 1; margin: 0; font-size: 15px; font-weight: 600; }
    .close { border: 0; background: transparent; color: #6b6a75; font-size: 20px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
    .close:hover { background: #f6f5f9; color: #1c1b22; }
    .preview { margin: 0 0 12px; padding: 10px 12px; border: 1px solid #ececf0; border-radius: 8px; }
    .preview span {
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere;
    }
    .preview.fallback { color: #6b6a75; font-style: italic; }
    .meta { margin: -4px 0 8px; font-size: 12px; color: #6b6a75; }
    .link-btn { border: 0; background: transparent; color: #6d4fc2; font-weight: 500; padding: 4px 0; font-size: 14px; }
    .link-btn:hover { color: #5c40ab; text-decoration: underline; }
    form { display: flex; gap: 8px; margin: 4px 0 8px; }
    input[type=text] {
      flex: 1; min-width: 0; padding: 7px 10px; border: 1px solid #d9d8df; border-radius: 8px;
      font: inherit; font-size: 14px; color: #1c1b22; background: #fff;
    }
    input[type=text]:focus { outline: none; border-color: #6d4fc2; box-shadow: 0 0 0 3px #f2eefb; }
    .list { list-style: none; margin: 4px -16px 10px; padding: 0; max-height: 220px; overflow-y: auto;
      border-top: 1px solid #ececf0; border-bottom: 1px solid #ececf0; }
    .list li + li { border-top: 1px solid #ececf0; }
    .list label { display: flex; align-items: center; gap: 10px; padding: 8px 16px; cursor: pointer; }
    .list label:hover { background: #f6f5f9; }
    .list input { width: 16px; height: 16px; margin: 0; accent-color: #6d4fc2; flex: none; }
    .list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hint { font-size: 12px; color: #6b6a75; margin: 0 0 10px; }
    .btn { border: 1px solid #ececf0; background: #fff; border-radius: 8px; padding: 8px 14px; font-weight: 500; font-size: 14px; color: #1c1b22; }
    .btn.primary { background: #6d4fc2; border-color: #6d4fc2; color: #fff; }
    .btn.primary:hover { background: #5c40ab; }
    .btn.block { width: 100%; }
    .btn:disabled { opacity: 0.55; cursor: default; }
    .error { margin: 8px 0; padding: 8px 10px; border-radius: 6px; background: #fdf0f0; color: #b4262c; font-size: 13px; }
    .status { min-height: 20px; margin-top: 8px; text-align: center; font-size: 13px; color: #2f7d4f; font-weight: 500; }
    .loading { color: #6b6a75; padding: 12px 0; }
  `;

  const FALLBACK_PREVIEW = 'Open saved post';
  const buttons = new Map(); // post id -> { host, button, container }
  let savedIds = new Set();
  let panel = null; // open picker state

  // ---------- helpers ----------

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'checked' || key === 'disabled' || key === 'value') el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  async function send(type, payload = {}) {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type, ...payload });
    } catch {
      throw new Error('Labels was updated or reloaded. Refresh this page and try again.');
    }
    if (!response?.ok) throw new Error(response?.error || 'Something went wrong. Please try again.');
    return response.result;
  }

  function shortPreview(text) {
    const clean = labelsClean(text);
    if (clean.length <= 160) return clean;
    let cut = clean.slice(0, 160);
    const space = cut.lastIndexOf(' ');
    if (space > 0) cut = cut.slice(0, space);
    return `${cut.replace(/[\s.,;:!?-]+$/, '')}…`;
  }

  // ---------- buttons on posts ----------

  function actionBar(container) {
    const social = [...container.querySelectorAll('button, [role="button"], a[aria-label]')].filter(
      b => labelsIsSocialButton(b) && !b.closest(LABELS_COMMENTS) && !b.closest('[data-labels-ui]'),
    );
    if (!social.length) return null;
    // The reactions bar is the nearest ancestor holding several of these (Like, Comment, Repost, Send).
    for (let el = social[0].parentElement; el && el !== container; el = el.parentElement) {
      const count = social.filter(b => el.contains(b)).length;
      if (count >= 3) return el;
    }
    return null;
  }

  function addButton(id, container) {
    const host = h('div', { 'data-labels-ui': 'button', 'data-labels-post': id });
    Object.assign(host.style, { display: 'flex', justifyContent: 'flex-end', padding: '4px 12px 8px' });
    const root = host.attachShadow({ mode: 'open' });
    root.append(h('style', null, BUTTON_CSS));
    const button = h('button', {
      class: 'label-btn',
      type: 'button',
      onClick: e => {
        e.preventDefault();
        e.stopPropagation();
        const entry = buttons.get(id);
        if (panel?.postId === id) closePanel();
        else openPanel(id, entry.container, button);
      },
    });
    root.append(button);
    const bar = actionBar(container);
    if (bar) bar.after(host);
    else container.prepend(host);
    buttons.set(id, { host, button, container });
    paintButton(id);
  }

  function paintButton(id) {
    const entry = buttons.get(id);
    if (!entry) return;
    const saved = savedIds.has(id);
    entry.button.className = `label-btn${saved ? ' saved' : ''}`;
    entry.button.innerHTML = `${TAG_ICON}<span>${saved ? 'Labeled' : 'Label'}</span>`;
    entry.button.setAttribute('aria-label', saved ? 'Edit labels for this post' : 'Label this post');
  }

  function scan() {
    const root = document.querySelector('main') || document.body;
    let posts;
    try {
      posts = labelsFindPosts(root);
    } catch (err) {
      console.warn('Labels: could not scan the page', err);
      return;
    }
    for (const { id, container } of posts) {
      const entry = buttons.get(id);
      if (entry && entry.host.isConnected && container.contains(entry.host)) continue;
      entry?.host.remove();
      addButton(id, container);
    }
  }

  let scanTimer = 0;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      scan();
    }, 400);
  }

  // ---------- picker panel ----------

  function openPanel(postId, container, anchor) {
    closePanel();
    const host = h('div', { 'data-labels-ui': 'panel' });
    const root = host.attachShadow({ mode: 'open' });
    root.append(h('style', null, PANEL_CSS));
    const box = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Save to Labels' });
    root.append(box);
    // Keep LinkedIn's keyboard shortcuts from firing while typing in the picker.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      box.addEventListener(type, e => {
        if (type === 'keydown' && e.key === 'Escape') closePanel();
        e.stopPropagation();
      });
    }
    document.body.append(host);

    const text = labelsPostText(container).text;
    panel = {
      postId,
      host,
      box,
      anchor,
      text,
      loading: true,
      labels: [],
      post: null,
      selection: new Set(),
      newLabel: { open: false, value: '', error: '' },
      error: '',
      status: '',
      saving: false,
    };
    renderPanel();

    send('getState', { postId })
      .then(state => {
        if (panel?.postId !== postId) return;
        panel.loading = false;
        panel.labels = state.labels;
        panel.post = state.post;
        panel.selection = new Set(state.post?.labelIds ?? []);
        renderPanel();
      })
      .catch(err => {
        if (panel?.postId !== postId) return;
        panel.loading = false;
        panel.error = err.message;
        renderPanel();
      });
  }

  function closePanel() {
    if (!panel) return;
    const anchor = panel.anchor;
    panel.host.remove();
    panel = null;
    if (anchor?.isConnected) anchor.focus({ preventScroll: true });
  }

  function positionPanel() {
    if (!panel) return;
    const r = panel.anchor.getBoundingClientRect();
    const box = panel.box;
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    let top = r.bottom + 6;
    if (top + height > window.innerHeight - 8 && r.top - height - 6 > 8) top = r.top - height - 6;
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    Object.assign(box.style, { top: `${top}px`, left: `${left}px` });
  }

  function renderPanel() {
    const p = panel;
    if (!p) return;
    const focusNewLabel =
      p.box.contains(p.box.getRootNode().activeElement) && p.box.getRootNode().activeElement?.type === 'text';
    const scroll = p.box.querySelector('.list')?.scrollTop ?? 0;
    const existing = p.post;
    const excerpt = shortPreview(p.text) || existing?.excerpt || '';

    const parts = [
      h(
        'div',
        { class: 'head' },
        h('span', { class: 'icon' }),
        h('h2', null, 'Save to Labels'),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close', onClick: closePanel }, '×'),
      ),
      h('p', { class: `preview${excerpt ? '' : ' fallback'}` }, h('span', null, excerpt || FALLBACK_PREVIEW)),
      existing && h('p', { class: 'meta' }, 'Already saved. Change its labels and click Update.'),
      p.loading ? h('div', { class: 'loading' }, 'Loading your labels…') : renderPickerBody(),
    ];
    p.box.replaceChildren(...parts.filter(Boolean));
    p.box.querySelector('.icon').innerHTML = TAG_ICON;
    const list = p.box.querySelector('.list');
    if (list) list.scrollTop = scroll;
    if (p.newLabel.open && (p.newLabel.focus || focusNewLabel)) {
      const input = p.box.querySelector('input[type=text]');
      input?.focus();
      p.newLabel.focus = false;
    }
    positionPanel();
  }

  function renderPickerBody() {
    const p = panel;
    const existing = p.post;
    return h(
      'div',
      null,
      renderNewLabel(),
      p.labels.length
        ? h(
            'ul',
            { class: 'list' },
            p.labels.map(label =>
              h(
                'li',
                null,
                h(
                  'label',
                  null,
                  h('input', {
                    type: 'checkbox',
                    checked: p.selection.has(label.id),
                    onChange: e => {
                      if (e.target.checked) p.selection.add(label.id);
                      else p.selection.delete(label.id);
                      p.status = '';
                      renderPanel();
                    },
                  }),
                  h('span', null, label.name),
                ),
              ),
            ),
          )
        : h('p', { class: 'hint' }, 'No labels yet. Create one above.'),
      h('p', { class: 'hint' }, 'Posts without a label go to Uncategorized.'),
      p.error && h('div', { class: 'error', role: 'alert' }, p.error),
      h(
        'button',
        { class: 'btn primary block', type: 'button', disabled: p.saving, onClick: save },
        existing ? 'Update' : 'Save',
      ),
      h('div', { class: 'status', role: 'status' }, p.status),
    );
  }

  function renderNewLabel() {
    const p = panel;
    const nl = p.newLabel;
    if (!nl.open) {
      return h(
        'button',
        {
          class: 'link-btn',
          type: 'button',
          onClick: () => {
            p.newLabel = { open: true, value: '', error: '', focus: true };
            renderPanel();
          },
        },
        '+ New label',
      );
    }
    const create = async () => {
      try {
        const state = await send('createLabel', { name: nl.value, postId: p.postId });
        if (panel !== p) return;
        p.labels = state.labels;
        p.selection.add(state.created.id);
        p.newLabel = { open: false, value: '', error: '' };
        p.status = '';
      } catch (err) {
        nl.error = err.message;
        nl.focus = true;
      }
      renderPanel();
    };
    return h(
      'div',
      null,
      h(
        'form',
        {
          onSubmit: e => {
            e.preventDefault();
            create();
          },
        },
        h('input', {
          type: 'text',
          value: nl.value,
          placeholder: 'Label name',
          'aria-label': 'New label name',
          maxlength: '80',
          onInput: e => (nl.value = e.target.value),
        }),
        h('button', { class: 'btn primary', type: 'submit' }, 'Create'),
      ),
      nl.error && h('div', { class: 'error', role: 'alert' }, nl.error),
    );
  }

  async function save() {
    const p = panel;
    p.saving = true;
    p.error = '';
    p.status = '';
    renderPanel();
    try {
      const state = await send('savePost', { postId: p.postId, text: p.text, labelIds: [...p.selection] });
      if (panel !== p) return;
      p.labels = state.labels;
      p.post = state.post;
      p.status = 'Saved ✓';
      savedIds = new Set(state.savedIds);
      buttons.forEach((_, id) => paintButton(id));
    } catch (err) {
      // Keep the selection so the user can retry.
      p.error = err.message;
    }
    p.saving = false;
    renderPanel();
  }

  // ---------- wiring ----------

  document.addEventListener(
    'click',
    e => {
      if (!panel) return;
      const path = e.composedPath();
      if (path.includes(panel.host) || path.includes(panel.anchor)) return;
      closePanel();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    e => {
      if (panel && e.key === 'Escape') closePanel();
    },
    true,
  );
  window.addEventListener('resize', positionPanel);
  window.addEventListener('scroll', positionPanel, { passive: true });

  async function refreshSaved() {
    try {
      const state = await send('getState', { postId: panel?.postId });
      savedIds = new Set(state.savedIds);
      buttons.forEach((_, id) => paintButton(id));
      if (panel && !panel.loading && state) {
        panel.labels = state.labels;
        panel.post = state.post;
        // Drop selections for labels deleted elsewhere.
        const ids = new Set(state.labels.map(l => l.id));
        panel.selection = new Set([...panel.selection].filter(id => ids.has(id)));
        renderPanel();
      }
    } catch {
      // Extension reloaded; buttons keep their last state.
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') refreshSaved();
  });

  new MutationObserver(mutations => {
    if (mutations.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && !n.hasAttribute?.('data-labels-ui')))) {
      scheduleScan();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  refreshSaved().finally(scan);
})();
