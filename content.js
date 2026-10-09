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
      position: fixed; z-index: 2147483000; width: 360px; max-width: calc(100vw - 16px);
      background: #fff; color: #1c1b22; border: 1px solid #ececf0; border-radius: 12px;
      box-shadow: 0 12px 32px rgba(20, 20, 40, 0.18); font-size: 14px; line-height: 1.45;
      padding: 14px 16px 16px;
    }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .head .icon { color: #6d4fc2; display: inline-flex; }
    .head h2 { flex: 1; margin: 0; font-size: 15px; font-weight: 600; }
    .library-link { border: 0; background: transparent; color: #6d4fc2; font-size: 13px; font-weight: 600; padding: 3px 8px;
      border-radius: 6px; }
    .library-link:hover { background: #f2eefb; }
    .close { border: 0; background: transparent; color: #6b6a75; font-size: 20px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
    .close:hover { background: #f6f5f9; color: #1c1b22; }
    .meta { margin: -4px 0 8px; font-size: 12px; color: #6b6a75; }
    .link-btn { border: 0; background: transparent; color: #6d4fc2; font-weight: 500; padding: 4px 0; font-size: 14px; }
    .link-btn:hover { color: #5c40ab; text-decoration: underline; }
    form { display: flex; gap: 8px; margin: 4px 0 8px; }
    input[type=text] {
      flex: 1; min-width: 0; padding: 7px 10px; border: 1px solid #d9d8df; border-radius: 8px;
      font: inherit; font-size: 14px; color: #1c1b22; background: #fff;
    }
    input[type=text]:focus { outline: none; border-color: #6d4fc2; box-shadow: 0 0 0 3px #f2eefb; }
    .list { list-style: none; margin: 4px -16px 10px; padding: 0; overflow-y: auto;
      max-height: clamp(180px, calc(100vh - 360px), 400px);
      border-top: 1px solid #ececf0; border-bottom: 1px solid #ececf0; }
    .list li { display: flex; align-items: center; }
    .list li + li { border-top: 1px solid #ececf0; }
    .list label { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 16px; cursor: pointer; }
    .list li:hover { background: #f6f5f9; }
    .list input { width: 16px; height: 16px; margin: 0; accent-color: #6d4fc2; flex: none; }
    .list span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hint { font-size: 12px; color: #6b6a75; margin: 0 0 10px; }
    .btn { border: 1px solid #ececf0; background: #fff; border-radius: 8px; padding: 8px 14px; font-weight: 500; font-size: 14px; color: #1c1b22; }
    .btn.primary { background: #6d4fc2; border-color: #6d4fc2; color: #fff; }
    .btn.primary:hover { background: #5c40ab; }
    .btn.danger { background: #b4262c; border-color: #b4262c; color: #fff; }
    .btn.danger:hover { background: #9a1f25; }
    .btn.block { width: 100%; }
    .btn:disabled { opacity: 0.55; cursor: default; }
    .btn.saved, .btn.saved:disabled { opacity: 1; background: #edf7f0; border-color: #cfe8d7; color: #2f7d4f; font-weight: 600; }
    .error { margin: 8px 0; padding: 8px 10px; border-radius: 6px; background: #fdf0f0; color: #b4262c; font-size: 13px; }
    .list li:hover .del, .del:focus-visible { opacity: 1; }
    .query-wrap { margin: 0 0 6px; }
    .query { width: 100%; }
    .keys { margin: 6px 0 0; font-size: 11px; color: #8a8994; }
    kbd { display: inline-block; padding: 0 5px; border: 1px solid #dedde4; border-bottom-width: 2px; border-radius: 4px;
      background: #f7f7f9; font: inherit; font-size: 11px; font-weight: 600; color: #55545e; }
    .list li.active { background: #f2eefb; box-shadow: inset 3px 0 0 #6d4fc2; }
    .row-actions { display: flex; align-items: center; gap: 2px; padding-right: 8px; flex: none; }
    .more { opacity: 0; border: 0; background: transparent; color: #6b6a75; font-size: 16px; line-height: 1;
      padding: 4px 8px; border-radius: 6px; }
    .more:hover { background: #ececf0; color: #1c1b22; }
    .list li:hover .more, .list li.active .more, .more:focus-visible { opacity: 1; }
    .mini { border: 0; background: transparent; color: #5c40ab; font-size: 13px; font-weight: 600; padding: 4px 8px;
      border-radius: 6px; }
    .mini:hover { background: #f2eefb; }
    .mini.danger { color: #b4262c; }
    .mini.danger:hover { background: #fdf0f0; }
    .rename { flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 6px 12px 6px 16px; }
    .rename input { width: 100%; box-sizing: border-box; }
    .rename .error { margin: 0; }
    .warn { margin: 8px 0 4px; padding: 18px 16px 16px; border-radius: 14px; text-align: center;
      background: linear-gradient(120deg, #fff4cc 0%, #ffe9d2 55%, #ffe1d8 100%); }
    .warn p { margin: 0 0 6px; }
    .warn .title { font-weight: 700; font-size: 15px; }
    .warn .actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .warn .btn { border: 0; border-radius: 999px; font-weight: 600; }
    .create-btn { flex: 1; display: flex; align-items: center; gap: 10px; padding: 9px 16px; border: 0; background: transparent;
      color: #5c40ab; font-size: 14px; font-weight: 500; text-align: left; }
    .create-btn .plus { width: 16px; text-align: center; font-weight: 700; }
    .panel { transition: opacity 0.18s ease; }
    .panel.fading { opacity: 0; }
    .confirm {
      display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 9px 12px;
      border-radius: 8px; background: #edf7f0; color: #2f7d4f; text-align: center;
    }
    .confirm-title { font-weight: 700; font-size: 14px; }
    .confirm-labels { font-size: 13px; color: #33503e; overflow-wrap: anywhere; }
    .status { margin-top: 8px; text-align: center; font-size: 13px; color: #2f7d4f; font-weight: 500; }
    .loading { color: #6b6a75; padding: 12px 0; }
  `;

  const buttons = new Map(); // post id -> { host, button, container }
  let savedIds = new Set();
  let savedNames = {}; // post ID -> its label names, shown on the button
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
    // Lists without a reactions bar (like LinkedIn's Saved posts page): the bottom right of
    // the post's card. (Squeezing it next to the ••• menu got it hidden on the real page.)
    if (bar) bar.after(host);
    else container.append(host);
    buttons.set(id, { host, button, container });
    paintButton(id);
  }

  // What a saved post's button says: its label names when they're short, else the first
  // one and how many more ("Cold email +2").
  function buttonText(names) {
    if (!names.length) return 'Labeled';
    const short = n => (n.length > 18 ? `${n.slice(0, 17)}…` : n);
    if (names.length === 1) return short(names[0]);
    const both = names.join(', ');
    if (names.length === 2 && both.length <= 24) return both;
    return `${short(names[0])} +${names.length - 1}`;
  }

  function paintButton(id) {
    const entry = buttons.get(id);
    if (!entry) return;
    const saved = savedIds.has(id);
    const names = savedNames[id] ?? [];
    entry.button.className = `label-btn${saved ? ' saved' : ''}`;
    entry.button.innerHTML = TAG_ICON;
    entry.button.append(h('span', null, saved ? buttonText(names) : 'Label'));
    entry.button.setAttribute(
      'aria-label',
      saved ? `Edit labels for this post (${names.join(', ') || 'saved'})` : 'Label this post',
    );
    if (saved && names.length) entry.button.title = `Labeled: ${names.join(', ')}`;
    else entry.button.removeAttribute('title');
  }

  // LinkedIn is a single-page app and can keep the page you just left (often the feed) in a
  // hidden <main> next to the one you're looking at, so every <main> gets scanned, and when a
  // post shows up twice, the copy on screen gets the button.
  const onScreen = el => el.getClientRects().length > 0;

  function scan() {
    const mains = [...document.querySelectorAll('main')];
    let found;
    try {
      found = (mains.length ? mains : [document.body]).flatMap(root => labelsFindPosts(root));
    } catch (err) {
      console.warn('Labels: could not scan the page', err);
      return;
    }
    const best = new Map();
    for (const post of found) {
      const current = best.get(post.id);
      if (!current || (!onScreen(current.container) && onScreen(post.container))) best.set(post.id, post);
    }
    for (const { id, container } of best.values()) {
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

  // Expands the post ("…see more") and returns its text once the rest has loaded.
  async function readFullText(container) {
    const before = labelsPostText(container).text;
    if (!labelsExpandPost(container)) return before;
    let text = before;
    for (let i = 0; i < 12 && text.length <= before.length; i++) {
      await new Promise(r => setTimeout(r, 50));
      text = labelsPostText(container).text;
    }
    return text;
  }

  function openPanel(postId, container, anchor, { viaKeyboard = false } = {}) {
    closePanel();
    const host = h('div', { 'data-labels-ui': 'panel' });
    const root = host.attachShadow({ mode: 'open' });
    root.append(h('style', null, PANEL_CSS));
    const box = h('div', { class: 'panel', role: 'dialog', 'aria-label': 'Save to Labels' });
    root.append(box);
    // Keep LinkedIn's keyboard shortcuts from firing while typing in the picker.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      box.addEventListener(type, e => {
        // Esc is handled once, by the page-level listener (it runs first, in the capture phase).
        if (type === 'keydown' && e.key !== 'Escape') holdOpen();
        // Enter on a label checkbox saves, so the picker works from the keyboard alone.
        if (type === 'keydown' && e.key === 'Enter' && e.target.type === 'checkbox' && panel && !panel.saving) {
          e.preventDefault();
          save();
        }
        e.stopPropagation();
      });
    }
    // Moving the mouse over the picker keeps it open after a keyboard save.
    // Ignores the synthetic moves Chrome sends when content changes under a still mouse.
    let lastPointer = null;
    box.addEventListener('pointermove', e => {
      const moved = lastPointer && Math.abs(e.clientX - lastPointer.x) + Math.abs(e.clientY - lastPointer.y) > 2;
      lastPointer = { x: e.clientX, y: e.clientY };
      if (moved) holdOpen();
    });
    document.body.append(host);

    const text = container ? labelsPostText(container).text : '';
    // Outline the post being labeled, so it's always clear which one it is.
    const outline = container && { outline: container.style.outline, outlineOffset: container.style.outlineOffset };
    if (container) Object.assign(container.style, { outline: '2px solid #6d4fc2', outlineOffset: '2px' });
    panel = {
      postId,
      // Who wrote it and its image, for the Library's cards.
      meta: container ? labelsPostMeta(container) : null,
      host,
      box,
      anchor,
      container,
      outline,
      viaKeyboard,
      focusKey: 'close',
      text,
      loading: true,
      labels: [],
      post: null,
      selection: new Set(),
      query: '', // the type-to-filter box
      active: -1, // highlighted option (-1 = none)
      added: [], // labels ticked in this session, newest last (Backspace removes)
      createError: '',
      error: '',
      status: '',
      saving: false,
      menu: null, // label ID whose ⋯ (Rename, Delete) is open
      renaming: null, // { id, value, error }
      deleting: null, // { id, error } while the delete warning shows
    };
    // Read the whole post in the background; saving waits for it.
    const p = panel;
    p.textReady = container
      ? readFullText(container)
          .then(async full => {
            if (panel === p && full.length > p.text.length) {
              p.text = full;
              renderPanel();
            }
            // Already saved with less (older save, or cut off by "…see more"): fill it in.
            await p.stateReady;
            const saved = p.post;
            if (!saved) return;
            const moreText = full.length > (saved.text?.length ?? 0);
            const newAuthor =
              p.meta.name && (p.meta.name !== saved.author?.name || p.meta.avatar !== saved.author?.avatar);
            const newImage = p.meta.image && p.meta.image !== saved.image;
            if (moreText || newAuthor || newImage) await send('fillText', { postId, text: full, meta: p.meta });
          })
          .catch(() => {})
      : Promise.resolve();
    renderPanel();

    p.stateReady = send('getState', { postId })
      .then(state => {
        if (panel?.postId !== postId) return;
        panel.loading = false;
        panel.labels = state.labels;
        panel.post = state.post;
        panel.wasSaved = Boolean(state.post);
        panel.selection = new Set(state.post?.labelIds ?? []);
        panel.focusKey = 'query';
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
    clearTimeout(panel.closeTimer);
    const { anchor, container, outline } = panel;
    panel.host.remove();
    panel = null;
    if (container) Object.assign(container.style, outline);
    if (anchor?.isConnected && anchor.matches?.('button')) anchor.focus({ preventScroll: true });
  }

  function positionPanel() {
    if (!panel) return;
    // Keep the last spot if the anchor went away (LinkedIn re-rendered the post).
    if (panel.anchor.isConnected) panel.anchorRect = panel.anchor.getBoundingClientRect();
    const r = panel.anchorRect;
    if (!r) return;
    const box = panel.box;
    const width = box.offsetWidth;
    let height = box.offsetHeight;
    // Decide above/below once, so the picker doesn't jump as its contents change.
    if (!panel.placement) {
      const fitsBelow = r.bottom + 6 + height <= window.innerHeight - 8;
      panel.placement = fitsBelow || r.top - height - 6 <= 8 ? 'below' : 'above';
    }
    // When space is tight, shorten the (scrollable) label list instead of covering the
    // post's Label button.
    const list = box.querySelector('.list');
    const room = panel.placement === 'below' ? window.innerHeight - 8 - (r.bottom + 6) : r.top - 6 - 8;
    if (list && height > room) {
      const listHeight = list.getBoundingClientRect().height;
      list.style.maxHeight = `${Math.max(120, listHeight - (height - room))}px`;
      height = box.offsetHeight;
    }
    let top = panel.placement === 'below' ? r.bottom + 6 : r.top - height - 6;
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    Object.assign(box.style, { top: `${top}px`, left: `${left}px` });
  }

  function renderPanel() {
    const p = panel;
    if (!p) return;
    const focused = p.box.getRootNode().activeElement;
    const focusedKey = focused?.dataset?.focus;
    const caret = focused?.type === 'text' ? focused.selectionStart : null;
    const scroll = p.box.querySelector('.list')?.scrollTop ?? 0;
    const existing = p.post;
    const excerpt = shortPreview(p.text) || existing?.excerpt || '';

    const parts = [
      h(
        'div',
        { class: 'head' },
        h('span', { class: 'icon' }),
        h('h2', null, 'Save to Labels'),
        // Browsing and organizing live in the Library.
        h(
          'button',
          {
            class: 'library-link',
            type: 'button',
            title: 'Open your Labels Library',
            'data-focus': 'library',
            onClick: () => send('openLibrary').catch(err => console.warn('Labels:', err)),
          },
          'Library',
        ),
        h(
          'button',
          { class: 'close', type: 'button', 'aria-label': 'Close', 'data-focus': 'close', onClick: closePanel },
          '\u00D7',
        ),
      ),
      p.wasSaved && h('p', { class: 'meta' }, 'Already saved. Change its labels and click Update.'),
      p.loading ? h('div', { class: 'loading' }, 'Loading your labels\u2026') : renderPickerBody(),
    ];
    p.box.replaceChildren(...parts.filter(Boolean));
    // No preview on screen; the captured text stays on the element (used by the tests).
    p.box.dataset.excerpt = excerpt;
    const icon = p.box.querySelector('.icon');
    if (icon) icon.innerHTML = TAG_ICON;
    const list = p.box.querySelector('.list');
    if (list) list.scrollTop = scroll;
    const key = p.focusKey || focusedKey;
    p.focusKey = null;
    const target = key && p.box.querySelector(`[data-focus="${CSS.escape(key)}"]`);
    if (target) {
      target.focus({ preventScroll: true });
      if (target.type === 'text') {
        const at = key === focusedKey && caret != null ? Math.min(caret, target.value.length) : target.value.length;
        target.setSelectionRange(at, at);
      }
    }
    p.box.querySelector('.list li.active')?.scrollIntoView({ block: 'nearest' });
    positionPanel();
  }

  // Labels matching the filter box (prefix matches first), plus "Create …" when no label
  // has exactly that name.
  function labelOptions(p) {
    const q = labelsClean(p.query).toLocaleLowerCase();
    let labels = p.labels;
    if (q) {
      const matches = labels.filter(l => l.name.toLocaleLowerCase().includes(q));
      const starts = matches.filter(l => l.name.toLocaleLowerCase().startsWith(q));
      labels = [...starts, ...matches.filter(l => !starts.includes(l))];
    }
    const options = labels.map(label => ({ kind: 'label', label }));
    if (q && !p.labels.some(l => l.name.toLocaleLowerCase() === q)) {
      options.push({ kind: 'create', name: labelsClean(p.query) });
    }
    return options;
  }

  async function choose(option) {
    const p = panel;
    p.createError = '';
    if (option.kind === 'label') {
      const id = option.label.id;
      if (p.selection.has(id)) {
        p.selection.delete(id);
        p.added = p.added.filter(a => a !== id);
      } else {
        p.selection.add(id);
        p.added.push(id);
      }
    } else {
      try {
        const state = await send('createLabel', { name: option.name, postId: p.postId });
        if (panel !== p) return;
        p.labels = state.labels;
        p.selection.add(state.created.id);
        p.added.push(state.created.id);
      } catch (err) {
        p.createError = err.message;
        p.focusKey = 'query';
        renderPanel();
        return;
      }
    }
    p.query = '';
    p.active = -1;
    p.status = '';
    p.focusKey = 'query';
    renderPanel();
  }

  function onQueryKey(e) {
    const p = panel;
    const options = labelOptions(p);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      p.active =
        p.active < 0 ? (step > 0 ? 0 : options.length - 1) : (p.active + step + options.length) % options.length;
      p.focusKey = 'query';
      renderPanel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (p.saving) return;
      if (e.metaKey || e.ctrlKey) saveAndClose();
      else if (p.active >= 0 && options[p.active]) choose(options[p.active]);
      else if (!labelsClean(p.query)) saveAndClose();
    } else if (e.key === 'Backspace' && !p.query && p.added.length) {
      e.preventDefault();
      p.selection.delete(p.added.pop());
      p.focusKey = 'query';
      renderPanel();
    }
  }

  function renderQuery() {
    const p = panel;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    return h(
      'div',
      { class: 'query-wrap' },
      h('input', {
        type: 'text',
        class: 'query',
        value: p.query,
        placeholder: 'Type to find or create a label…',
        'aria-label': 'Find or create a label',
        maxlength: '80',
        autocomplete: 'off',
        spellcheck: 'false',
        'data-focus': 'query',
        onInput: e => {
          p.query = e.target.value;
          p.active = labelsClean(p.query) ? 0 : -1;
          p.createError = '';
          renderPanel();
        },
        onKeydown: onQueryKey,
      }),
      h(
        'p',
        { class: 'keys' },
        h('kbd', null, 'Enter'),
        ' tick · ',
        h('kbd', null, mac ? '⌘ Enter' : 'Ctrl Enter'),
        ' save · ',
        h('kbd', null, 'Esc'),
        ' close',
      ),
      p.createError && h('div', { class: 'error', role: 'alert' }, p.createError),
    );
  }

  function renderPickerBody() {
    const p = panel;
    const existing = p.post;
    const options = labelOptions(p);
    if (p.deleting && !p.labels.some(l => l.id === p.deleting.id)) p.deleting = null;
    if (p.deleting) return h('div', null, renderDeleteWarning());
    return h(
      'div',
      null,
      renderQuery(),
      options.length
        ? h(
            'ul',
            { class: 'list', role: 'listbox', 'aria-label': 'Labels' },
            options.map((option, index) => {
              const active = index === p.active ? ' active' : '';
              if (option.kind === 'create') {
                return h(
                  'li',
                  { class: `create${active}` },
                  h(
                    'button',
                    { type: 'button', class: 'create-btn', onClick: () => choose(option) },
                    h('span', { class: 'plus' }, '+'),
                    h('span', null, `Create “${option.name}”`),
                  ),
                );
              }
              const label = option.label;
              if (p.renaming?.id === label.id) return renderRenameRow(label);
              return h(
                'li',
                { class: active.trim() || null },
                h(
                  'label',
                  null,
                  h('input', {
                    type: 'checkbox',
                    checked: p.selection.has(label.id),
                    'data-focus': `cb-${label.id}`,
                    onChange: e => {
                      if (e.target.checked) {
                        p.selection.add(label.id);
                        p.added.push(label.id);
                      } else {
                        p.selection.delete(label.id);
                        p.added = p.added.filter(a => a !== label.id);
                      }
                      p.status = '';
                      renderPanel();
                    },
                  }),
                  h('span', null, label.name),
                ),
                renderRowActions(label),
              );
            }),
          )
        : h('p', { class: 'hint' }, 'No labels yet. Type a name above to create one.'),
      !p.closing && !p.selection.size && !existing && h('p', { class: 'hint' }, 'Pick or create a label to save.'),
      p.error && h('div', { class: 'error', role: 'alert' }, p.error),
      p.closing
        ? h(
            'div',
            { class: 'confirm', role: 'status' },
            h('span', { class: 'confirm-title' }, p.closing.title),
            p.closing.labels && h('span', { class: 'confirm-labels' }, p.closing.labels),
          )
        : !p.selection.size
          ? existing
            ? // Unticking every label on a saved post removes it from Labels.
              h(
                'button',
                {
                  class: 'btn danger block',
                  type: 'button',
                  disabled: p.saving,
                  'data-focus': 'save',
                  onClick: save,
                },
                'Remove from Labels',
              )
            : h('button', { class: 'btn primary block', type: 'button', disabled: true, 'data-focus': 'save' }, 'Save')
          : unchanged(p)
            ? // Saved and nothing changed since: say so instead of offering a button with nothing to do.
              h(
                'button',
                { class: 'btn saved block', type: 'button', disabled: true, 'data-focus': 'save' },
                'Saved \u2713',
              )
            : h(
                'button',
                {
                  class: 'btn primary block',
                  type: 'button',
                  disabled: p.saving,
                  'data-focus': 'save',
                  onClick: save,
                },
                existing ? 'Update' : 'Save',
              ),
      !p.closing && p.status === 'Removed from Labels' && h('div', { class: 'status', role: 'status' }, p.status),
    );
  }

  // Keyboard save: show what was saved for a moment, then fade out. Moving the mouse over
  // the picker or pressing a key (other than Esc) keeps it open.
  const CONFIRM_MS = 1500;
  async function saveAndClose() {
    const p = panel;
    if (!p.selection.size && !p.post) {
      p.error = 'Pick or create a label first.';
      p.focusKey = 'query';
      renderPanel();
      return;
    }
    const ok = await save();
    if (!ok || panel !== p) return;
    const names = p.labels.filter(l => p.selection.has(l.id)).map(l => l.name);
    p.closing = names.length
      ? { title: 'Saved \u2713', labels: names.join(', ') }
      : { title: 'Removed from Labels', labels: '' };
    p.status = names.length ? 'Saved \u2713' : '';
    p.focusKey = 'query';
    renderPanel();
    clearTimeout(p.closeTimer);
    p.closeTimer = setTimeout(() => {
      if (panel !== p || !p.closing) return;
      p.box.classList.add('fading');
      p.closeTimer = setTimeout(() => panel === p && p.closing && closePanel(), 180);
    }, CONFIRM_MS);
  }

  function holdOpen() {
    const p = panel;
    if (!p?.closing) return;
    clearTimeout(p.closeTimer);
    p.box.classList.remove('fading');
    p.closing = null;
    renderPanel();
  }

  // True when the post is saved and the ticked labels match what's saved.
  function unchanged(p) {
    if (!p.post) return false;
    const saved = p.post.labelIds;
    return saved.length === p.selection.size && saved.every(id => p.selection.has(id));
  }

  // Esc backs out of renaming, the delete warning or a ⋯ menu first, then closes.
  function escape() {
    const p = panel;
    if (p.renaming || p.deleting || p.menu) {
      const id = p.renaming?.id ?? p.deleting?.id ?? p.menu;
      p.renaming = p.deleting = p.menu = null;
      p.focusKey = `more-${id}`;
      renderPanel();
    } else closePanel();
  }

  // ---------- Rename and Delete a label (the ⋯ on each row) ----------

  function applyLabelState(p, state) {
    p.labels = state.labels;
    p.post = state.post;
    if (!state.post) p.wasSaved = false;
    const ids = new Set(state.labels.map(l => l.id));
    p.selection = new Set([...p.selection].filter(id => ids.has(id)));
    p.added = p.added.filter(id => ids.has(id));
  }

  async function renameLabel() {
    const p = panel;
    const { id, value } = p.renaming;
    try {
      const state = await send('renameLabel', { labelId: id, name: value, postId: p.postId });
      if (panel !== p) return;
      applyLabelState(p, state);
      p.renaming = null;
      p.focusKey = 'query';
    } catch (err) {
      if (panel !== p) return;
      p.renaming = { ...p.renaming, error: err.message };
      p.focusKey = `rename-${id}`;
    }
    renderPanel();
  }

  async function deleteLabel() {
    const p = panel;
    const { id } = p.deleting;
    try {
      const state = await send('deleteLabel', { labelId: id, postId: p.postId });
      if (panel !== p) return;
      applyLabelState(p, state);
      p.deleting = null;
      p.focusKey = 'query';
    } catch (err) {
      if (panel !== p) return;
      p.deleting = { id, error: err.message };
    }
    renderPanel();
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function renderDeleteWarning() {
    const p = panel;
    const label = p.labels.find(l => l.id === p.deleting.id);
    if (!label) return null;
    const { count, only } = label;
    let also = '';
    if (only && only === count) {
      also =
        count === 1
          ? 'That post has no other label, so it will be deleted too.'
          : 'Those posts have no other label, so they will be deleted too.';
    } else if (only) {
      also = `${plural(only, 'post')} ${only === 1 ? 'has' : 'have'} no other label and will be deleted too.`;
    }
    return h(
      'div',
      { class: 'warn', role: 'alertdialog', 'aria-label': 'Delete label' },
      h(
        'p',
        { class: 'title' },
        'Deleting the ',
        h('em', null, label.name),
        count
          ? ` label will remove it from ${plural(count, 'post')} and cannot be undone.`
          : ' label cannot be undone.',
      ),
      also && h('p', null, also),
      h('p', null, 'Do you want to permanently delete it?'),
      p.deleting.error && h('div', { class: 'error', role: 'alert' }, p.deleting.error),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          { class: 'btn primary', type: 'button', 'data-focus': 'delete-cancel', onClick: escape },
          'Never mind',
        ),
        h('button', { class: 'btn danger', type: 'button', onClick: deleteLabel }, 'Permanently delete it'),
      ),
    );
  }

  function renderRenameRow(label) {
    const p = panel;
    return h(
      'li',
      null,
      h(
        'div',
        { class: 'rename' },
        h('input', {
          type: 'text',
          value: p.renaming.value,
          maxlength: '80',
          autocomplete: 'off',
          spellcheck: 'false',
          'aria-label': `Rename ${label.name}`,
          'data-focus': `rename-${label.id}`,
          onInput: e => {
            p.renaming.value = e.target.value;
            p.renaming.error = '';
          },
          onKeydown: e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            renameLabel();
          },
        }),
        p.renaming.error && h('div', { class: 'error', role: 'alert' }, p.renaming.error),
      ),
      h('div', { class: 'row-actions' }, h('button', { class: 'mini', type: 'button', onClick: renameLabel }, 'Save')),
    );
  }

  function renderRowActions(label) {
    const p = panel;
    if (p.menu !== label.id) {
      return h(
        'div',
        { class: 'row-actions' },
        h(
          'button',
          {
            class: 'more',
            type: 'button',
            'aria-label': `Options for ${label.name}`,
            title: 'Rename or delete',
            'data-focus': `more-${label.id}`,
            onClick: () => {
              p.menu = label.id;
              p.focusKey = `rename-btn-${label.id}`;
              renderPanel();
            },
          },
          '\u22EF',
        ),
      );
    }
    return h(
      'div',
      { class: 'row-actions' },
      h(
        'button',
        {
          class: 'mini',
          type: 'button',
          'data-focus': `rename-btn-${label.id}`,
          onClick: () => {
            p.menu = null;
            p.renaming = { id: label.id, value: label.name, error: '' };
            p.focusKey = `rename-${label.id}`;
            renderPanel();
          },
        },
        'Rename',
      ),
      h(
        'button',
        {
          class: 'mini danger',
          type: 'button',
          onClick: () => {
            p.menu = null;
            p.deleting = { id: label.id, error: '' };
            p.focusKey = 'delete-cancel';
            renderPanel();
          },
        },
        'Delete',
      ),
    );
  }

  async function save() {
    const p = panel;
    const returnFocus = p.box.getRootNode().activeElement?.dataset?.focus || 'save';
    p.saving = true;
    p.error = '';
    p.status = '';
    renderPanel();
    try {
      await p.textReady;
      const state = await send('savePost', {
        postId: p.postId,
        text: p.text,
        meta: p.meta,
        labelIds: [...p.selection],
      });
      if (panel !== p) return false;
      p.labels = state.labels;
      p.post = state.post;
      p.status = state.removed ? 'Removed from Labels' : 'Saved ✓';
      savedIds = new Set(state.savedIds);
      savedNames = state.savedLabels ?? {};
      buttons.forEach((_, id) => paintButton(id));
    } catch (err) {
      // Keep the selection so the user can retry.
      p.error = err.message;
    }
    if (panel !== p) return false;
    p.saving = false;
    p.focusKey = returnFocus;
    renderPanel();
    return !p.error;
  }

  // ---------- keyboard shortcut ----------

  // The post the shortcut means: the one under the mouse, otherwise the one filling the
  // most of the screen. It gets outlined while the picker is open, so the choice is visible.
  function postForShortcut() {
    scan();
    // Only posts actually on screen (LinkedIn keeps pages you've left around, squashed to nothing).
    const entries = [...buttons].filter(([, e]) => {
      if (!e.host.isConnected || !e.container.isConnected) return false;
      const r = e.container.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const hovered = [...document.querySelectorAll(':hover')].pop();
    if (hovered) {
      const match = entries.find(([, e]) => e.container.contains(hovered));
      if (match) return match;
    }
    let best = null;
    let bestVisible = 0;
    for (const entry of entries) {
      const r = entry[1].container.getBoundingClientRect();
      const visible = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      if (visible > bestVisible) {
        best = entry;
        bestVisible = visible;
      }
    }
    return best;
  }

  // The shortcut reaches every LinkedIn frame in the tab (LinkedIn shows some pages, like Saved
  // posts, inside an embedded frame). The frame with a post on screen handles it; when none has
  // one, only the frame holding the page's main content says so. Returns whether this frame acted.
  const isTop = window === window.top;
  const isBig = () => window.innerWidth > 200 && window.innerHeight > 200;
  const bigLinkedInFrame = () =>
    [...document.querySelectorAll('iframe')].some(f => {
      const r = f.getBoundingClientRect();
      return r.width > 200 && r.height > 200 && /^https:\/\/www\.linkedin\.com\//.test(f.src);
    });

  function handleShortcut() {
    if (panel) {
      closePanel();
      return true;
    }
    if (!isBig()) return false;
    const found = postForShortcut();
    if (!found) {
      if (isTop ? bigLinkedInFrame() : false) return false;
      if (!isTop && !buttons.size) return false;
      toast('No post to label here. Scroll to a post, or point at one, and try again.');
      return true;
    }
    const [id, entry] = found;
    const r = entry.button.getBoundingClientRect();
    const buttonInView = r.top >= 0 && r.bottom <= window.innerHeight;
    openPanel(id, entry.container, buttonInView ? entry.button : entry.container, { viaKeyboard: true });
    return true;
  }

  let toastTimer = 0;
  function toast(message) {
    document.querySelector('[data-labels-ui="toast"]')?.remove();
    const host = h('div', { 'data-labels-ui': 'toast' });
    const root = host.attachShadow({ mode: 'open' });
    root.append(
      h(
        'style',
        null,
        `${BASE_CSS} .toast { position: fixed; z-index: 2147483000; left: 50%; bottom: 24px; transform: translateX(-50%);
          background: #1c1b22; color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 14px;
          box-shadow: 0 8px 24px rgba(20, 20, 40, 0.25); max-width: calc(100vw - 32px); }`,
      ),
      h('div', { class: 'toast', role: 'status' }, message),
    );
    document.body.append(host);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => host.remove(), 3500);
  }

  // ---------- wiring ----------

  document.addEventListener(
    'click',
    e => {
      // Ignore clicks that aren't the user's (like Labels expanding a post's "…see more").
      if (!panel || !e.isTrusted) return;
      const path = e.composedPath();
      if (path.includes(panel.host) || path.includes(panel.anchor)) return;
      closePanel();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    e => {
      if (panel && e.key === 'Escape') escape();
    },
    true,
  );
  window.addEventListener('resize', positionPanel);
  window.addEventListener('scroll', positionPanel, { passive: true });

  async function refreshSaved() {
    try {
      const state = await send('getState', { postId: panel?.postId });
      savedIds = new Set(state.savedIds);
      savedNames = state.savedLabels ?? {};
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.type === 'labels-shortcut' && handleShortcut()) sendResponse({ handled: true });
    return false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') refreshSaved();
  });

  // Look again when LinkedIn changes the page. It's a single-page app: moving between pages
  // swaps content in place, and some lists (like Saved posts) add a post's ID to its card a
  // moment after the card itself, so new IDs and removed buttons count too, not just new nodes.
  const ID_ATTRIBUTES = [
    'href',
    'data-urn',
    'data-id',
    'data-chameleon-result-urn',
    'data-activity-urn',
    'componentkey',
  ];
  const ours = n => n.nodeType === 1 && n.hasAttribute?.('data-labels-ui');
  const lostButton = n =>
    n.nodeType === 1 && (n.matches?.('[data-labels-ui="button"]') || n.querySelector?.('[data-labels-ui="button"]'));
  new MutationObserver(mutations => {
    const changed = mutations.some(m =>
      m.type === 'attributes'
        ? !m.target.closest?.('[data-labels-ui]')
        : [...m.addedNodes].some(n => n.nodeType === 1 && !ours(n)) || [...m.removedNodes].some(lostButton),
    );
    if (changed) scheduleScan();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ID_ATTRIBUTES,
  });

  // After moving to another LinkedIn page, check a few more times while it finishes loading.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    for (const ms of [300, 1000, 2500, 5000]) setTimeout(scan, ms);
  }, 500);

  refreshSaved().finally(scan);
})();
