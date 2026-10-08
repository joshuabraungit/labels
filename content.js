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
    .pick { width: 18px; height: 18px; margin: 0 8px 0 0; accent-color: #6d4fc2; cursor: pointer; align-self: center; }
    .pick[hidden] { display: none; }
  `;

  // The "select posts" bar on LinkedIn's Saved posts page.
  const BULK_CSS = `${BASE_CSS}
    .bar {
      position: fixed; z-index: 2147482000; left: 50%; bottom: 20px; transform: translateX(-50%);
      display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 14px;
      background: #1c1b22; color: #fff; border-radius: 999px; box-shadow: 0 8px 28px rgba(20, 20, 40, 0.28);
      font-size: 14px; white-space: nowrap;
    }
    .bar .icon { display: inline-flex; color: #c9b8ff; }
    .bar button { border: 0; border-radius: 999px; padding: 7px 14px; font-weight: 600; font-size: 13px; cursor: pointer; }
    .bar .ghost { background: transparent; color: #e4def6; }
    .bar .ghost:hover { background: rgba(255, 255, 255, 0.1); }
    .bar .primary { background: #6d4fc2; color: #fff; }
    .bar .primary:hover { background: #7d62cc; }
    .bar .primary:disabled { opacity: 0.5; cursor: default; }
    .bar .count { color: #fff; font-weight: 600; padding: 0 4px; }
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
    .list .dot { flex: none; width: 9px; height: 9px; border-radius: 50%; margin-right: -2px; }
    .query-wrap { margin: 0 0 6px; }
    .query { width: 100%; }
    .keys { margin: 6px 0 0; font-size: 11px; color: #8a8994; }
    kbd { display: inline-block; padding: 0 5px; border: 1px solid #dedde4; border-bottom-width: 2px; border-radius: 4px;
      background: #f7f7f9; font: inherit; font-size: 11px; font-weight: 600; color: #55545e; }
    .list li.active { background: #f2eefb; box-shadow: inset 3px 0 0 #6d4fc2; }
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

  const FALLBACK_PREVIEW = 'Open saved post';
  const buttons = new Map(); // post id -> { host, button, container }
  let savedIds = new Set();
  let savedNames = {}; // post ID -> its label names, shown on the button
  // Bulk labeling on LinkedIn's Saved posts page.
  let selectMode = false;
  const selected = new Set();
  let bulkHost = null;
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

  // Same swatches as the popup (keys from LABEL_COLORS in lib/store.js).
  const COLOR_HEX = {
    purple: '#7c5cd6',
    blue: '#3b82f6',
    green: '#22a06b',
    yellow: '#d9a400',
    orange: '#f08c00',
    red: '#e5484d',
    pink: '#d6409f',
    gray: '#8b8d98',
  };
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

  // The post's own "•••" menu (outside comments), or null.
  function overflowMenu(container) {
    const menu = [
      ...container.querySelectorAll(
        '.entity-result__actions-overflow-menu-dropdown, [class*="actions-overflow-menu"], [class*="control-menu"]',
      ),
    ].find(el => !el.closest(LABELS_COMMENTS) && !el.closest('[data-labels-ui]'));
    if (!menu) return null;
    // Insert next to the menu's wrapper, so the button joins the same row.
    return menu.parentElement && menu.parentElement !== container ? menu.parentElement : menu;
  }

  function addButton(id, container) {
    const host = h('div', { 'data-labels-ui': 'button', 'data-labels-post': id });
    Object.assign(host.style, { display: 'flex', justifyContent: 'flex-end', padding: '4px 12px 8px' });
    const root = host.attachShadow({ mode: 'open' });
    root.append(h('style', null, BUTTON_CSS));
    // Shown only while selecting posts on the Saved posts page.
    const check = h('input', {
      type: 'checkbox',
      class: 'pick',
      hidden: true,
      'aria-label': 'Select this post',
      onChange: e => {
        if (e.target.checked) selected.add(id);
        else selected.delete(id);
        renderBulkBar();
      },
    });
    root.append(check);
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
    const menu = bar ? null : overflowMenu(container);
    if (bar) bar.after(host);
    else if (menu) {
      // Lists without a reactions bar (e.g. LinkedIn's Saved posts page): sit in the
      // post's top row, just left of its ••• menu.
      Object.assign(host.style, { padding: '0 8px 0 8px', marginLeft: 'auto', alignItems: 'flex-start' });
      menu.before(host);
    } else container.prepend(host);
    buttons.set(id, { host, button, container, check });
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
    entry.check.hidden = !selectMode;
    entry.check.checked = selected.has(id);
  }

  const isSavedPage = () => /^\/my-items\/saved-posts/.test(location.pathname);

  function setSelectMode(on) {
    selectMode = on;
    selected.clear();
    buttons.forEach((_, id) => paintButton(id));
    renderBulkBar();
  }

  // The floating bar on the Saved posts page: "Select posts to label", then
  // "3 selected · Select all · Label 3 posts · Cancel".
  function renderBulkBar() {
    if (!isSavedPage() || !buttons.size) {
      bulkHost?.remove();
      bulkHost = null;
      if (selectMode) selectMode = false;
      return;
    }
    if (!bulkHost) {
      bulkHost = h('div', { 'data-labels-ui': 'bulk' });
      bulkHost.attachShadow({ mode: 'open' });
    }
    if (!bulkHost.isConnected) document.body.append(bulkHost);
    const root = bulkHost.shadowRoot;
    const n = selected.size;
    const posts = `${n} post${n === 1 ? '' : 's'}`;
    const bar = selectMode
      ? h(
          'div',
          { class: 'bar', role: 'toolbar', 'aria-label': 'Label several posts' },
          h('span', { class: 'count', role: 'status' }, `${n} selected`),
          h(
            'button',
            {
              class: 'ghost',
              type: 'button',
              onClick: () => {
                buttons.forEach((_, id) => selected.add(id));
                buttons.forEach((_, id) => paintButton(id));
                renderBulkBar();
              },
            },
            'Select all',
          ),
          h(
            'button',
            {
              class: 'primary',
              type: 'button',
              disabled: !n,
              onClick: e => openPanel(null, null, e.currentTarget, { bulk: [...selected] }),
            },
            `Label ${posts}`,
          ),
          h('button', { class: 'ghost', type: 'button', onClick: () => setSelectMode(false) }, 'Cancel'),
        )
      : h(
          'div',
          { class: 'bar' },
          h('span', { class: 'icon' }),
          h('button', { class: 'ghost', type: 'button', onClick: () => setSelectMode(true) }, 'Select posts to label'),
        );
    root.replaceChildren(h('style', null, BULK_CSS), bar);
    const icon = root.querySelector('.icon');
    if (icon) icon.innerHTML = TAG_ICON;
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
    renderBulkBar();
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

  function openPanel(postId, container, anchor, { viaKeyboard = false, bulk = null } = {}) {
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

    // Bulk mode (several posts from the Saved posts page) has no single post to read or outline.
    const text = container ? labelsPostText(container).text : '';
    // Outline the post being labeled, so it's always clear which one it is.
    const outline = container && { outline: container.style.outline, outlineOffset: container.style.outlineOffset };
    if (container) Object.assign(container.style, { outline: '2px solid #6d4fc2', outlineOffset: '2px' });
    panel = {
      postId,
      bulk,
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
            // Already saved with less text (older save, or cut off by "…see more"): fill it in.
            if (savedIds.has(postId) && full && full.length > (p.post?.text?.length ?? 0)) {
              await send('fillText', { postId, text: full });
            }
          })
          .catch(() => {})
      : Promise.resolve();
    renderPanel();

    send('getState', { postId })
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
    // Keep the last spot if the anchor went away (the bulk bar redraws after saving).
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
        h('h2', null, p.bulk ? `Label ${p.bulk.length} post${p.bulk.length === 1 ? '' : 's'}` : 'Save to Labels'),
        // Browsing and organizing live in the Library (Chrome's side panel).
        h(
          'button',
          {
            class: 'library-link',
            type: 'button',
            title: 'Open your Library in the side panel',
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
                  label.color && h('span', { class: 'dot', style: `background:${COLOR_HEX[label.color]}` }),
                  h('span', null, label.name),
                ),
              );
            }),
          )
        : h('p', { class: 'hint' }, 'No labels yet. Type a name above to create one.'),
      !p.closing &&
        (p.bulk
          ? h('p', { class: 'hint' }, 'Ticked labels are added to every selected post. Their other labels stay.')
          : !p.selection.size && !existing && h('p', { class: 'hint' }, 'Pick or create a label to save.')),
      p.error && h('div', { class: 'error', role: 'alert' }, p.error),
      p.bulk && !p.closing
        ? h(
            'button',
            {
              class: 'btn primary block',
              type: 'button',
              disabled: p.saving || !p.selection.size,
              'data-focus': 'save',
              onClick: saveAndClose,
            },
            `Label ${p.bulk.length} post${p.bulk.length === 1 ? '' : 's'}`,
          )
        : p.closing
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
              : h(
                  'button',
                  { class: 'btn primary block', type: 'button', disabled: true, 'data-focus': 'save' },
                  'Save',
                )
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
    if (p.bulk) return bulkSave();
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

  function escape() {
    closePanel();
  }

  // Picks up what the background sent back after labeling several posts.
  function applyLabels(p, state) {
    p.labels = state.labels;
    p.post = state.post;
    savedIds = new Set(state.savedIds);
    savedNames = state.savedLabels ?? {};
    buttons.forEach((_, id) => paintButton(id));
  }

  // Adds the ticked labels to every selected post, then confirms and closes.
  async function bulkSave() {
    const p = panel;
    if (!p.selection.size) {
      p.error = 'Pick or create a label first.';
      p.focusKey = 'query';
      renderPanel();
      return;
    }
    p.saving = true;
    p.error = '';
    renderPanel();
    try {
      const posts = [];
      for (const id of p.bulk) {
        const container = buttons.get(id)?.container;
        posts.push({ postId: id, text: container ? await readFullText(container) : '' });
      }
      const state = await send('labelMany', { posts, labelIds: [...p.selection] });
      if (panel !== p) return;
      applyLabels(p, state);
      const n = p.bulk.length;
      const names = p.labels.filter(l => p.selection.has(l.id)).map(l => l.name);
      p.closing = { title: `Labeled ${n} post${n === 1 ? '' : 's'} \u2713`, labels: names.join(', ') };
      setSelectMode(false);
      p.saving = false;
      renderPanel();
      clearTimeout(p.closeTimer);
      p.closeTimer = setTimeout(() => {
        if (panel !== p || !p.closing) return;
        p.box.classList.add('fading');
        p.closeTimer = setTimeout(() => panel === p && p.closing && closePanel(), 180);
      }, CONFIRM_MS);
    } catch (err) {
      p.saving = false;
      p.error = err.message;
      renderPanel();
    }
  }

  async function save() {
    const p = panel;
    if (p.bulk) {
      await bulkSave();
      return false;
    }
    const returnFocus = p.box.getRootNode().activeElement?.dataset?.focus || 'save';
    p.saving = true;
    p.error = '';
    p.status = '';
    renderPanel();
    try {
      await p.textReady;
      const state = await send('savePost', { postId: p.postId, text: p.text, labelIds: [...p.selection] });
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
    const entries = [...buttons].filter(([, e]) => e.host.isConnected && e.container.isConnected);
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

  function handleShortcut() {
    if (panel) {
      closePanel();
      return;
    }
    const found = postForShortcut();
    if (!found) {
      toast('No post to label here. Scroll to a post, or point at one, and try again.');
      return;
    }
    const [id, entry] = found;
    const r = entry.button.getBoundingClientRect();
    const buttonInView = r.top >= 0 && r.bottom <= window.innerHeight;
    openPanel(id, entry.container, buttonInView ? entry.button : entry.container, { viaKeyboard: true });
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
    if (message?.type === 'labels-shortcut') {
      handleShortcut();
      sendResponse({ handled: true });
    } else if (message?.type === 'labels-diagnose') {
      // Help's "Copy page info": a text-free outline of this page's layout.
      sendResponse(capturePostText(null, 'diagnose'));
    }
    return false;
  });

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
