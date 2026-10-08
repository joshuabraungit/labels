import { classifyUrl, makeExcerpt } from './lib/post.js';
import {
  createStore,
  emptyData,
  exportBackup,
  labelName,
  labelsWithCounts,
  LabelsError,
  postsForLabel,
  sortedLabels,
  LABEL_COLORS,
  NOTE_MAX,
  pinnedCount,
  PINNED_ID,
  postsAsMarkdown,
  postsOnlyIn,
  searchPosts,
  STORAGE_KEY,
} from './lib/store.js';

const store = createStore(chrome.storage.local);
const mode = new URLSearchParams(location.search).get('mode');
// 'tab': the popup UI in a tab (for import). 'page': the full-page view.
const isPage = mode === 'page';
const isTab = mode === 'tab' || isPage;
const app = document.getElementById('app');
const importInput = document.getElementById('import-file');

// Runs lib/capture.js in the tab, then capturePostText(postId, mode) from it.
async function runCapture(tabId, postId, mode) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/capture.js'] });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    // Expands a collapsed post ("…see more") first, so the whole text gets saved.
    func: async (id, how) => {
      if (how === 'capture' && labelsExpandPost(labelsContainerFor(id))) await new Promise(r => setTimeout(r, 600));
      return capturePostText(id, how);
    },
    args: [postId, mode],
  });
  return injection?.result;
}
const FALLBACK_PREVIEW = 'Open saved post';
function svgIcon(paths, fillFirst = false) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  paths.forEach((d, i) => {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', fillFirst && i === 0 ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  });
  return svg;
}

const trashIcon = () => svgIcon(['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3']);
const PIN_PATH = 'M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z';
const pinIcon = (filled = false) => svgIcon([PIN_PATH, 'M12 15v6'], filled);

const searchIcon = () => svgIcon(['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4']);
const expandIcon = () => svgIcon(['M14 4h6v6', 'M20 4l-8 8', 'M10 5H5v14h14v-5']);

// Swatches for the stored color keys (LABEL_COLORS in lib/store.js).
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

function colorDot(color) {
  return color ? h('span', { class: 'dot', style: `background:${COLOR_HEX[color]}`, 'aria-hidden': 'true' }) : null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const state = {
  data: emptyData(),
  view: 'labels', // save | labels | label | edit | help
  helpReturn: 'labels',
  page: { kind: 'other' }, // what the active tab shows; see classifyUrl
  selection: new Set(),
  saving: false,
  saveStatus: '',
  saveError: '',
  newLabel: { open: false, value: '', error: '' },
  labelId: null,
  editPostId: null,
  editSelection: new Set(),
  editError: '',
  editNote: '',
  editReturn: 'label', // where Back/Save in the edit view go
  query: '', // search box
  toast: '', // short confirmation, e.g. 'Copied 5 links'
  menu: null, // { kind: 'label' | 'post', postId?, rect }
  dialog: null, // { kind: 'rename' | 'delete', value?, error? }
  undo: null, // { post, timer }: a just-removed post that can be put back
  helpMessage: '',
  helpError: '',
  diagStatus: '',
  shortcut: null, // current key for the label-post command ('' if unassigned)
  focus: null,
};

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

function errorMessage(err) {
  if (err instanceof LabelsError) return err.message;
  console.error(err);
  return 'Something went wrong. Please try again.';
}

function go(view, extra = {}) {
  clearTimeout(state.undo?.timer);
  state.undo = null;
  Object.assign(state, { view, menu: null, dialog: null, newLabel: { open: false, value: '', error: '' } }, extra);
  render();
}

function savedDate(ms) {
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function openPost(url) {
  chrome.tabs.create({ url });
}

// ---------- rendering ----------

function render() {
  // Keep scroll positions and focus across re-renders.
  const scrolls = {};
  app.querySelectorAll('[data-scroll]').forEach(el => (scrolls[el.dataset.scroll] = el.scrollTop));
  const active = document.activeElement;
  const focusKey = state.focus ?? active?.dataset?.focus;
  const caret = active && 'selectionStart' in active && active.type === 'text' ? active.selectionStart : null;
  state.focus = null;

  const views = { save: renderHome, labels: renderHome, label: renderLabel, edit: renderEdit, help: renderHelp };
  app.replaceChildren(renderTopbar());
  if (isPage) {
    pickPageLabel();
    app.append(
      h(
        'div',
        { class: 'content page-grid', inert: Boolean(state.dialog) },
        h('aside', { class: 'sidebar' }, renderSearch(), renderLabels({ sidebar: true })),
        h('main', { class: 'main' }, renderPageMain()),
      ),
    );
  } else {
    app.append(h('div', { class: 'content', inert: Boolean(state.dialog) }, views[state.view]()));
  }
  if (state.menu) app.append(renderMenu());
  if (state.dialog) app.append(renderDialog());

  app.querySelectorAll('[data-scroll]').forEach(el => (el.scrollTop = scrolls[el.dataset.scroll] ?? 0));
  if (focusKey) {
    const el = app.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
    if (el) {
      el.focus();
      if (caret != null && el.type === 'text') el.setSelectionRange(caret, caret);
    }
  }
  positionMenu();
}

function renderTopbar() {
  return h(
    'div',
    { class: 'topbar' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-32.png', alt: '' }), 'Labels'),
    h(
      'div',
      { class: 'topbar-actions' },
      !isPage &&
        h(
          'button',
          {
            class: 'icon-btn svg',
            'aria-label': 'Open Labels in a tab',
            title: 'Open Labels in a tab',
            'data-focus': 'open-page',
            onClick: () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?mode=page') }),
          },
          expandIcon(),
        ),
      h(
        'button',
        {
          class: 'icon-btn',
          'aria-label': 'Help',
          title: 'Help',
          'data-focus': 'help',
          onClick: () => go('help', { helpReturn: state.view === 'help' ? state.helpReturn : state.view }),
        },
        '?',
      ),
    ),
  );
}

function renderNewLabel(onCreated) {
  const nl = state.newLabel;
  if (!nl.open) {
    return h(
      'button',
      {
        class: 'link-btn',
        'data-focus': 'new-label-toggle',
        onClick: () => {
          state.newLabel = { open: true, value: '', error: '' };
          state.focus = 'new-label-input';
          render();
        },
      },
      '+ New label',
    );
  }

  const create = async () => {
    try {
      const { data, result: label } = await store.createLabel(nl.value);
      state.data = data;
      state.newLabel = { open: false, value: '', error: '' };
      onCreated?.(label);
    } catch (err) {
      nl.error = errorMessage(err);
      state.focus = 'new-label-input';
    }
    render();
  };

  return h(
    'div',
    null,
    h(
      'form',
      {
        class: 'new-label',
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
        'data-focus': 'new-label-input',
        onInput: e => (nl.value = e.target.value),
        onKeydown: e => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            state.newLabel = { open: false, value: '', error: '' };
            state.focus = 'new-label-toggle';
            render();
          }
        },
      }),
      h('button', { class: 'btn primary', type: 'submit' }, 'Create'),
    ),
    nl.error && h('div', { class: 'error', role: 'alert' }, nl.error),
  );
}

function renderChecklist(selection, onChange) {
  const labels = sortedLabels(state.data);
  if (!labels.length) return h('p', { class: 'hint' }, 'No labels yet. Create one above.');
  return h(
    'div',
    { class: 'scroll', 'data-scroll': 'checklist' },
    h(
      'ul',
      { class: 'list' },
      labels.map(label =>
        h(
          'li',
          null,
          h(
            'label',
            { class: 'check-row' },
            h('input', {
              type: 'checkbox',
              checked: selection.has(label.id),
              'data-focus': `cb-${label.id}`,
              onChange: e => {
                if (e.target.checked) selection.add(label.id);
                else selection.delete(label.id);
                onChange?.();
                render();
              },
            }),
            colorDot(label.color),
            h('span', null, label.name),
          ),
        ),
      ),
    ),
  );
}

function renderPreview(excerpt) {
  return h('p', { class: `preview${excerpt ? '' : ' fallback'}` }, h('span', null, excerpt || FALLBACK_PREVIEW));
}

function renderSave() {
  const page = state.page;
  if (page.kind === 'post-unidentified') {
    return h(
      'div',
      null,
      h(
        'div',
        { class: 'error', role: 'alert' },
        'Labels can’t identify a reliable link for this post, so it can’t be saved. Open the post from its timestamp, then click Labels again.',
      ),
    );
  }

  const existing = state.data.posts[page.id];
  // Saved, and the ticked labels match what's saved: nothing to do.
  const unchanged =
    Boolean(existing) &&
    existing.labelIds.length === state.selection.size &&
    existing.labelIds.every(id => state.selection.has(id));
  const clearStatus = () => {
    state.saveStatus = '';
  };

  return h(
    'div',
    null,
    renderPreview(page.excerpt || existing?.excerpt),
    !page.excerpt && !existing?.excerpt && renderPreviewHelp(),
    state.wasSaved && h('p', { class: 'meta' }, 'Already saved. Change its labels and click Update.'),
    renderNewLabel(label => {
      state.selection.add(label.id);
      clearStatus();
    }),
    renderChecklist(state.selection, clearStatus),
    !state.selection.size && !existing && h('p', { class: 'hint' }, 'Pick or create a label to save.'),
    state.saveError && h('div', { class: 'error', role: 'alert' }, state.saveError),
    state.saveStatus === 'Removed' && h('p', { class: 'meta', role: 'status' }, 'Removed from Labels.'),
    unchanged
      ? h('button', { class: 'btn saved block', disabled: true, 'data-focus': 'save' }, 'Saved \u2713')
      : !state.selection.size && existing
        ? h(
            'button',
            { class: 'btn danger block', disabled: state.saving, 'data-focus': 'save', onClick: onSave },
            'Remove from Labels',
          )
        : h(
            'button',
            {
              class: 'btn primary block',
              disabled: state.saving || !state.selection.size,
              'data-focus': 'save',
              onClick: onSave,
            },
            existing ? 'Update' : 'Save',
          ),
  );
}

// Shown when no preview text was found. Copies a text-free outline of the page so the
// reader can be adjusted to LinkedIn's current layout.
function renderPreviewHelp() {
  return h('p', { class: 'meta' }, 'No preview found. You can still save. ', renderCopyPageInfo());
}

function renderCopyPageInfo() {
  const copy = async () => {
    try {
      const result = await runCapture(state.page.tabId, state.page.id ?? null, 'diagnose');
      await navigator.clipboard.writeText(result?.diagnosis || 'no diagnosis');
      state.diagStatus = 'Copied. It shows the page layout only, no post text or names.';
    } catch (err) {
      console.warn('Labels: could not copy page info', err);
      state.diagStatus = 'Couldn\u2019t copy the page info.';
    }
    render();
  };
  return h(
    'span',
    null,
    h('button', { class: 'link-btn inline', onClick: copy }, 'Copy page info'),
    state.diagStatus && h('span', { class: 'diag' }, ` ${state.diagStatus}`),
  );
}

async function onSave() {
  const page = state.page;
  state.saving = true;
  state.saveError = '';
  state.saveStatus = '';
  render();
  try {
    const { data, result } = await store.savePost({
      id: page.id,
      url: page.url,
      excerpt: page.excerpt,
      text: page.text,
      labelIds: [...state.selection],
    });
    state.data = data;
    state.saveStatus = result.removed ? 'Removed' : 'Saved ✓';
    if (result.removed) state.wasSaved = false;
  } catch (err) {
    // Keep the selection so the user can retry.
    state.saveError = errorMessage(err);
  }
  state.saving = false;
  state.focus = 'save';
  render();
}

// The popup's main screen: "Save this post" when the tab shows a single post (saving
// elsewhere happens on the post itself), then the label list.
function renderHome() {
  const page = state.page;
  const onPost = page.kind === 'post' || page.kind === 'post-unidentified';
  return h(
    'div',
    null,
    onPost &&
      h('section', { class: 'save-section' }, h('h1', { class: 'section-title' }, 'Save this post'), renderSave()),
    renderLabels({ compact: onPost }),
  );
}

function renderTip() {
  const key = state.shortcut;
  return h(
    'p',
    { class: 'tip' },
    'To label a post, click ',
    h('strong', null, 'Label'),
    ' under it on LinkedIn',
    key ? [' or press ', h('kbd', null, key)] : '',
    '.',
  );
}

function renderSearch() {
  const clear = () => {
    state.query = '';
    state.focus = 'search';
    render();
  };
  return h(
    'div',
    { class: 'search' },
    h('span', { class: 'search-icon' }, searchIcon()),
    h('input', {
      class: 'field search-input',
      type: 'text',
      role: 'searchbox',
      placeholder: 'Search saved posts',
      'aria-label': 'Search saved posts',
      value: state.query,
      'data-focus': 'search',
      onInput: e => {
        state.query = e.target.value;
        render();
      },
      onKeydown: e => e.key === 'Escape' && state.query && (e.stopPropagation(), clear()),
    }),
    state.query &&
      h('button', { class: 'search-clear', type: 'button', 'aria-label': 'Clear search', onClick: clear }, '×'),
  );
}

function renderSearchResults() {
  const results = searchPosts(state.data, state.query);
  return h(
    'div',
    { class: 'results' },
    h(
      'p',
      { class: 'meta results-count', role: 'status' },
      results.length ? `${plural(results.length, 'post')} found` : `No saved posts match “${state.query.trim()}”.`,
    ),
    results.length > 0 &&
      h(
        'div',
        { class: `scroll${isPage ? '' : ' tall'}`, 'data-scroll': 'search' },
        h(
          'ul',
          { class: 'list' },
          results.map(post => renderPostRow(post, { showLabels: true })),
        ),
      ),
  );
}

function renderLabelRow(row, { pinned = false } = {}) {
  const active = isPage && !state.query && ['label', 'labels'].includes(state.view) && state.labelId === row.id;
  return h(
    'li',
    { class: `label-item${active ? ' active' : ''}` },
    h(
      'button',
      {
        class: `label-row${pinned ? ' pinned-row' : ''}`,
        'data-focus': `label-${row.id}`,
        'aria-current': active ? 'true' : null,
        onClick: () => go('label', { labelId: row.id, query: '' }),
      },
      pinned ? h('span', { class: 'pin-mark' }, pinIcon(true)) : colorDot(row.color),
      h('span', { class: 'name' }, row.name),
      h(
        'span',
        { class: 'count', 'aria-label': `${row.count} ${pinned ? 'pinned' : 'saved'} posts` },
        String(row.count),
      ),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
    ),
    pinned
      ? h('span', { class: 'del-spacer', 'aria-hidden': 'true' })
      : h(
          'button',
          {
            class: 'del',
            title: 'Delete label',
            'aria-label': `Delete label ${row.name}`,
            'data-focus': `del-${row.id}`,
            onClick: () => {
              state.dialog = { kind: 'delete', labelId: row.id };
              state.focus = 'dialog-cancel';
              render();
            },
          },
          trashIcon(),
        ),
  );
}

// The label list. In the popup it has the search box (results replace the list while
// searching); in the full-page view it's the sidebar and search sits above it.
function renderLabels({ compact = false, sidebar = false } = {}) {
  const rows = labelsWithCounts(state.data).map(r => ({ ...r, color: state.data.labels[r.id]?.color }));
  const pins = pinnedCount(state.data);
  const nothingSaved = Object.keys(state.data.posts).length === 0;
  const searching = !sidebar && state.query;
  return h(
    'div',
    null,
    h('h1', { class: 'section-title' }, 'Your labels'),
    !sidebar && !nothingSaved && renderSearch(),
    // On a post page, "+ New label" lives in the Save section above.
    !searching && !compact && renderNewLabel(),
    searching
      ? renderSearchResults()
      : h(
          'div',
          { class: sidebar ? 'sidebar-list' : `scroll${compact ? '' : ' tall'}`, 'data-scroll': 'labels' },
          h(
            'ul',
            { class: 'list' },
            // Pinned shows first, like a label, once anything is pinned.
            pins > 0 && renderLabelRow({ id: PINNED_ID, name: 'Pinned', count: pins }, { pinned: true }),
            rows.map(row => renderLabelRow(row)),
          ),
        ),
    !searching && nothingSaved && h('p', { class: 'hint' }, 'Nothing saved yet.'),
    !searching && !sidebar && renderTip(),
  );
}

// The full-page view always shows a label: the one picked, else Pinned, else the first.
function pickPageLabel() {
  const valid = id => (id === PINNED_ID ? pinnedCount(state.data) > 0 : Boolean(state.data.labels[id]));
  if (!valid(state.labelId)) {
    state.labelId = pinnedCount(state.data) ? PINNED_ID : (sortedLabels(state.data)[0]?.id ?? null);
  }
}

// The full-page view's main column: search results, a label's posts, help or editing.
function renderPageMain() {
  if (state.view === 'help') return renderHelp();
  if (state.view === 'edit') return renderEdit();
  if (state.query) return h('div', null, h('h1', { class: 'section-title' }, 'Search'), renderSearchResults());
  if (!state.labelId) {
    return h(
      'div',
      { class: 'page-empty' },
      h('h1', { class: 'section-title' }, 'Nothing saved yet'),
      h('p', null, 'Click Label under a post in your LinkedIn feed and it will show up here.'),
    );
  }
  return renderLabel();
}

// Removes right away, no confirm. An Undo bar shows for a few seconds instead.
async function removePost(postId) {
  const post = state.data.posts[postId];
  state.menu = null;
  if (!post) return render();
  try {
    const { data } = await store.removePost(postId);
    state.data = data;
    clearTimeout(state.undo?.timer);
    state.undo = { post, timer: setTimeout(() => ((state.undo = null), render()), 6000) };
    state.focus = 'undo';
  } catch (err) {
    console.error(err);
  }
  render();
}

async function undoRemove() {
  const undo = state.undo;
  if (!undo) return;
  clearTimeout(undo.timer);
  state.undo = null;
  try {
    const { data } = await store.restorePost(undo.post);
    state.data = data;
  } catch (err) {
    alert(errorMessage(err));
  }
  render();
}

function renderUndo() {
  return (
    state.undo &&
    h(
      'div',
      { class: 'undo', role: 'status' },
      h('span', null, 'Removed from Labels'),
      h('button', { type: 'button', 'data-focus': 'undo', onClick: undoRemove }, 'Undo'),
    )
  );
}

async function togglePin(postId) {
  const post = state.data.posts[postId];
  state.menu = null;
  if (!post) return render();
  try {
    const { data } = await store.setPinned(postId, !post.pinnedAt);
    state.data = data;
    state.focus = `pin-${postId}`;
  } catch (err) {
    alert(errorMessage(err));
  }
  render();
}

function renderPinButton(post) {
  const pinned = Boolean(post.pinnedAt);
  return h(
    'button',
    {
      class: `icon-btn pin${pinned ? ' on' : ''}`,
      'aria-label': pinned ? 'Unpin post' : 'Pin post',
      'aria-pressed': String(pinned),
      title: pinned ? 'Unpin' : 'Pin',
      'data-focus': `pin-${post.id}`,
      onClick: () => togglePin(post.id),
    },
    pinIcon(pinned),
  );
}

// One saved post: its preview (the full text in the full-page view), note, and, in search
// results and Pinned, its labels.
function renderPostRow(post, { showLabels = false } = {}) {
  const labels = showLabels
    ? post.labelIds
        .map(id => state.data.labels[id])
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    : [];
  const body = isPage ? post.text || post.excerpt : post.excerpt;
  return h(
    'li',
    { class: 'post-row' },
    h(
      'div',
      { class: 'post-main' },
      h(
        'button',
        { class: 'post-open', title: post.url, onClick: () => openPost(post.url) },
        h(
          'span',
          { class: `excerpt${body ? '' : ' fallback'}` },
          body || `${FALLBACK_PREVIEW} · saved ${savedDate(post.savedAt)}`,
        ),
      ),
      post.note && h('p', { class: 'note' }, post.note),
      isPage &&
        isPartial(post) &&
        h(
          'p',
          { class: 'partial' },
          'Only part of this post was saved. Click its Label button on LinkedIn to get the rest.',
        ),
      labels.length > 0 &&
        h(
          'div',
          { class: 'chips' },
          labels.map(l =>
            h(
              'button',
              { class: 'chip', type: 'button', onClick: () => go('label', { labelId: l.id, query: '' }) },
              colorDot(l.color),
              l.name,
            ),
          ),
        ),
    ),
    renderPinButton(post),
    h(
      'button',
      {
        class: 'icon-btn',
        'aria-label': 'Saved post options',
        title: 'More',
        'aria-haspopup': 'menu',
        'data-focus': `post-menu-${post.id}`,
        onClick: e => toggleMenu(e, { kind: 'post', postId: post.id }),
      },
      '⋯',
    ),
  );
}

// Saved before Labels kept full text, or cut off by LinkedIn's "…see more".
function isPartial(post) {
  return !post.text || /(…|\.\.\.)$/.test(post.text.trim());
}

function showToast(text) {
  clearTimeout(state.toastTimer);
  state.toast = text;
  state.toastTimer = setTimeout(() => {
    state.toast = '';
    render();
  }, 2500);
  render();
}

async function copyList(labelId) {
  const n = postsForLabel(state.data, labelId).length;
  try {
    await navigator.clipboard.writeText(postsAsMarkdown(state.data, labelId));
    showToast(`Copied ${plural(n, 'link')}`);
  } catch (err) {
    console.warn('Labels: could not copy', err);
    showToast('Couldn’t copy the list.');
  }
}

async function setColor(labelId, color) {
  try {
    const { data } = await store.setLabelColor(labelId, color);
    state.data = data;
  } catch (err) {
    alert(errorMessage(err));
  }
  render();
}

function renderLabel() {
  const isPinned = state.labelId === PINNED_ID;
  const label = state.data.labels[state.labelId];
  const name = isPinned ? 'Pinned' : label?.name;
  if (!name) {
    state.view = 'labels';
    return renderHome();
  }
  const posts = postsForLabel(state.data, state.labelId);

  return h(
    'div',
    null,
    h(
      'div',
      { class: 'header' },
      !isPage &&
        h('button', { class: 'icon-btn back', 'aria-label': 'Back', title: 'Back', onClick: () => go('labels') }, '‹'),
      isPinned ? h('span', { class: 'pin-mark' }, pinIcon(true)) : colorDot(label.color),
      h('h2', { title: name }, name),
      isPage && h('span', { class: 'header-count' }, plural(posts.length, 'post')),
      h(
        'button',
        {
          class: 'icon-btn',
          'aria-label': 'Options',
          title: 'Options',
          'aria-haspopup': 'menu',
          'aria-expanded': String(state.menu?.kind === 'label'),
          'data-focus': 'label-options',
          onClick: e => toggleMenu(e, { kind: 'label' }),
        },
        '•••',
      ),
    ),
    state.toast && h('p', { class: 'toast', role: 'status' }, state.toast),
    posts.length
      ? h(
          'div',
          { class: `scroll${isPage ? '' : ' tall'}`, 'data-scroll': `posts-${state.labelId}` },
          h(
            'ul',
            { class: 'list' },
            posts.map(post => renderPostRow(post, { showLabels: isPinned })),
          ),
        )
      : h('p', { class: 'empty' }, isPinned ? 'No pinned posts.' : 'No saved posts with this label yet.'),
    renderUndo(),
  );
}

function openEdit(postId, focus) {
  const post = state.data.posts[postId];
  go('edit', {
    editPostId: postId,
    editSelection: new Set(post?.labelIds ?? []),
    editNote: post?.note ?? '',
    editError: '',
    editReturn: state.view === 'edit' ? state.editReturn : state.view,
    focus: focus ?? null,
  });
}

function renderEdit() {
  const post = state.data.posts[state.editPostId];
  const back = () => go(state.editReturn || 'label');
  if (!post) {
    state.view = state.editReturn || 'label';
    return isPage ? renderPageMain() : state.view === 'label' ? renderLabel() : renderHome();
  }
  const save = async () => {
    state.editError = '';
    try {
      let { data } = await store.setPostLabels(post.id, [...state.editSelection]);
      // No labels left removes the post, note and all.
      if (data.posts[post.id]) ({ data } = await store.setNote(post.id, state.editNote));
      state.data = data;
      back();
    } catch (err) {
      state.editError = errorMessage(err);
      render();
    }
  };
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'header' },
      h('button', { class: 'icon-btn back', 'aria-label': 'Back', title: 'Back', onClick: back }, '‹'),
      h('h2', null, 'Edit post'),
    ),
    renderPreview(post.excerpt),
    h('label', { class: 'field-label', for: 'edit-note' }, 'Note'),
    h('textarea', {
      id: 'edit-note',
      class: 'field note-field',
      rows: '2',
      maxlength: String(NOTE_MAX),
      placeholder: 'Why you saved it, how you’ll use it…',
      value: state.editNote,
      'data-focus': 'edit-note',
      onInput: e => (state.editNote = e.target.value),
    }),
    h('p', { class: 'field-label' }, 'Labels'),
    renderNewLabel(label => state.editSelection.add(label.id)),
    renderChecklist(state.editSelection),
    !state.editSelection.size && h('p', { class: 'hint' }, 'No labels ticked, so this removes the post from Labels.'),
    state.editError && h('div', { class: 'error', role: 'alert' }, state.editError),
    state.editSelection.size
      ? h('button', { class: 'btn primary block', 'data-focus': 'edit-save', onClick: save }, 'Save')
      : h('button', { class: 'btn danger block', 'data-focus': 'edit-save', onClick: save }, 'Remove from Labels'),
  );
}

function renderHelp() {
  return h(
    'div',
    { class: 'help' },
    h(
      'div',
      { class: 'header' },
      !isTab &&
        h(
          'button',
          { class: 'icon-btn back', 'aria-label': 'Back', title: 'Back', onClick: () => go(state.helpReturn) },
          '‹',
        ),
      h('h2', null, 'Help'),
    ),
    h(
      'p',
      null,
      'To save a post, click the Label button under it in your LinkedIn feed. Or open the post on its own page and click the Labels toolbar button.',
    ),
    state.shortcut !== null &&
      h(
        'p',
        { class: 'shortcut' },
        state.shortcut
          ? [
              'Keyboard shortcut: ',
              h('kbd', null, state.shortcut),
              ' labels the post under your mouse, or the one most in view. Type to find or create a label, Enter to tick, Enter again to save. ',
            ]
          : 'Set a keyboard shortcut to label the post you\u2019re looking at. ',
        h(
          'button',
          { class: 'link-btn inline', onClick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) },
          state.shortcut ? 'Change' : 'Set shortcut',
        ),
      ),
    h(
      'ul',
      null,
      h('li', null, 'Search finds posts by their full text, your notes and label names.'),
      h('li', null, 'Use a post\u2019s \u22EF menu to pin it, add a note or edit its labels.'),
      h('li', null, 'On LinkedIn\u2019s Saved posts page, use Select posts to label to label many at once.'),
      h('li', null, 'Saves are stored in this Chrome profile.'),
      h('li', null, 'They do not automatically sync between devices.'),
      h('li', null, 'Uninstalling the extension can remove local data. Export a backup to keep a copy.'),
      h(
        'li',
        null,
        'Posts saved with LinkedIn\u2019s own Save aren\u2019t imported automatically, but you can label them on LinkedIn\u2019s Saved posts page.',
      ),
      h(
        'li',
        null,
        'If a post is later deleted or made private, the saved link stays here, but Labels can’t restore the post.',
      ),
    ),
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn', onClick: onExport }, 'Export backup'),
      h('button', { class: 'btn', onClick: onImportClick }, 'Import backup'),
    ),
    !isTab && h('p', { class: 'hint' }, 'Import opens in a new tab so you can choose a file.'),
    state.page.tabId &&
      h('p', { class: 'meta troubleshoot' }, 'Label buttons not showing on LinkedIn? ', renderCopyPageInfo()),
    state.helpError && h('div', { class: 'error', role: 'alert' }, state.helpError),
    state.helpMessage && h('div', { class: 'status', role: 'status' }, state.helpMessage),
    h(
      'p',
      { class: 'fine-print' },
      'Labels is an independent tool and isn’t affiliated with or endorsed by LinkedIn. It adds a Label button to posts on linkedin.com and reads a post’s visible text only when you click Label, press the shortcut or click the toolbar button.',
    ),
  );
}

// ---------- menus & dialogs ----------

function toggleMenu(event, menu) {
  event.stopPropagation();
  const same = state.menu && state.menu.kind === menu.kind && state.menu.postId === menu.postId;
  state.menu = same ? null : { ...menu, rect: event.currentTarget.getBoundingClientRect() };
  render();
}

function renderMenu() {
  const m = state.menu;
  const item = (text, onClick, danger) =>
    h(
      'button',
      {
        role: 'menuitem',
        class: danger ? 'danger' : null,
        onClick: e => {
          e.stopPropagation();
          state.menu = null;
          onClick();
        },
      },
      text,
    );

  if (m.kind === 'label' && state.labelId === PINNED_ID) {
    return h(
      'div',
      { class: 'menu', role: 'menu' },
      item('Copy as list', () => copyList(PINNED_ID)),
    );
  }
  if (m.kind === 'label') {
    const current = state.data.labels[state.labelId]?.color ?? null;
    return h(
      'div',
      { class: 'menu', role: 'menu' },
      h('div', { class: 'menu-caption' }, 'EDIT THIS LABEL'),
      h(
        'div',
        { class: 'swatches', role: 'group', 'aria-label': 'Label color' },
        [null, ...LABEL_COLORS].map(color =>
          h('button', {
            class: `swatch${color === current ? ' on' : ''}${color ? '' : ' none'}`,
            type: 'button',
            title: color ? color[0].toUpperCase() + color.slice(1) : 'No color',
            'aria-label': color ? `Color ${color}` : 'No color',
            'aria-pressed': String(color === current),
            style: color ? `background:${COLOR_HEX[color]}` : null,
            onClick: e => {
              e.stopPropagation();
              state.menu = null;
              setColor(state.labelId, color);
            },
          }),
        ),
      ),
      item('Copy as list', () => copyList(state.labelId)),
      item('Rename', () => {
        state.dialog = { kind: 'rename', value: labelName(state.data, state.labelId), error: '' };
        state.focus = 'dialog-input';
        render();
      }),
      item(
        'Delete',
        () => {
          state.dialog = { kind: 'delete' };
          state.focus = 'dialog-cancel';
          render();
        },
        true,
      ),
    );
  }
  return h(
    'div',
    { class: 'menu', role: 'menu' },
    item(state.data.posts[m.postId]?.pinnedAt ? 'Unpin' : 'Pin', () => togglePin(m.postId)),
    item(state.data.posts[m.postId]?.note ? 'Edit note' : 'Add note', () => openEdit(m.postId, 'edit-note')),
    item('Edit labels', () => openEdit(m.postId)),
    item('Remove saved post', () => removePost(m.postId), true),
  );
}

function positionMenu() {
  const menu = app.querySelector('.menu');
  if (!menu || !state.menu) return;
  const r = state.menu.rect;
  const height = menu.offsetHeight;
  const below = r.bottom + 4;
  const top = below + height > window.innerHeight && r.top - height - 4 > 0 ? r.top - height - 4 : below;
  Object.assign(menu.style, { position: 'fixed', top: `${top}px`, right: `${window.innerWidth - r.right}px` });
}

function closeDialog() {
  state.dialog = null;
  render();
}

function renderDialog() {
  const d = state.dialog;
  let title;
  let body;
  let confirmText;
  let confirmClass = 'btn primary';
  let cancelText = 'Cancel';
  let onConfirm;

  if (d.kind === 'rename') {
    title = 'Rename label';
    confirmText = 'Save';
    body = [
      h('input', {
        class: 'field',
        type: 'text',
        value: d.value,
        maxlength: '80',
        'aria-label': 'Label name',
        'data-focus': 'dialog-input',
        onInput: e => (d.value = e.target.value),
        onKeydown: e => e.key === 'Enter' && onConfirm(),
      }),
      d.error && h('div', { class: 'error', role: 'alert' }, d.error),
    ];
    onConfirm = async () => {
      try {
        const { data } = await store.renameLabel(state.labelId, d.value);
        state.data = data;
        state.dialog = null;
      } catch (err) {
        d.error = errorMessage(err);
        state.focus = 'dialog-input';
      }
      render();
    };
  } else if (d.kind === 'delete') {
    title = 'Delete label';
    confirmText = 'Permanently delete it';
    cancelText = 'Never mind';
    confirmClass = 'btn danger';
    // From the label list (d.labelId) or the label screen's options (state.labelId).
    const labelId = d.labelId ?? state.labelId;
    const count = postsForLabel(state.data, labelId).length;
    const only = postsOnlyIn(state.data, labelId);
    let also = '';
    if (only && only === count) {
      also =
        count === 1
          ? 'That post has no other label, so it will be deleted too.'
          : 'Those posts have no other label, so they will be deleted too.';
    } else if (only) {
      also = `${plural(only, 'post')} ${only === 1 ? 'has' : 'have'} no other label and will be deleted too.`;
    }
    body = [
      h(
        'p',
        { class: 'warn-title' },
        'Deleting the ',
        h('em', null, labelName(state.data, labelId)),
        count
          ? ` label will remove it from ${plural(count, 'post')} and cannot be undone.`
          : ' label cannot be undone.',
      ),
      also && h('p', null, also),
      h('p', null, 'Do you want to permanently delete it?'),
    ];
    onConfirm = async () => {
      try {
        const { data } = await store.deleteLabel(labelId);
        state.data = data;
        state.selection?.delete(labelId);
        state.editSelection?.delete(labelId);
        if (state.page?.id) state.wasSaved = Boolean(data.posts[state.page.id]);
        state.saveStatus = '';
        go('labels');
      } catch (err) {
        state.dialog = null;
        render();
        alert(errorMessage(err));
      }
    };
  }

  return h(
    'div',
    {
      class: 'backdrop',
      onClick: e => e.target === e.currentTarget && closeDialog(),
      onKeydown: e => e.key === 'Escape' && closeDialog(),
    },
    h(
      'div',
      {
        class: `dialog${d.kind === 'delete' ? ' warn' : ''}`,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title,
      },
      d.kind !== 'delete' && h('h3', null, title),
      body,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', 'data-focus': 'dialog-cancel', onClick: closeDialog }, cancelText),
        h('button', { class: confirmClass, 'data-focus': 'dialog-confirm', onClick: () => onConfirm() }, confirmText),
      ),
    ),
  );
}

// ---------- backup ----------

function onExport() {
  const json = JSON.stringify(exportBackup(state.data), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = h('a', { href: url, download: `labels-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  state.helpError = '';
  const count = Object.keys(state.data.posts).length;
  state.helpMessage = `Exported ${count} saved post${count === 1 ? '' : 's'}.`;
  render();
}

function onImportClick() {
  // Chrome closes the toolbar popup when a file picker opens, so import runs in a tab.
  if (!isTab) {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?mode=tab#help') });
    window.close();
    return;
  }
  importInput.click();
}

importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  importInput.value = ''; // so picking the same file again still fires "change"
  if (!file) return;
  state.helpError = '';
  state.helpMessage = '';
  render();
  try {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new LabelsError('This file isn’t a valid backup (it couldn’t be read as JSON).');
    }
    const { data, result } = await store.importBackup(parsed);
    state.data = data;
    state.helpMessage = `Imported ${plural(result.postsAdded, 'new post')}, updated ${plural(result.postsUpdated, 'post')}, added ${plural(result.labelsAdded, 'label')}.${result.postsSkipped ? ` Skipped ${plural(result.postsSkipped, 'post')} with no labels.` : ''}`;
  } catch (err) {
    state.helpError = errorMessage(err);
  }
  render();
});

// ---------- startup ----------

document.addEventListener('click', e => {
  if (state.menu && !e.target.closest('.menu')) {
    state.menu = null;
    render();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.menu) {
    state.menu = null;
    render();
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  state.data = await store.load();
  render();
});

window.addEventListener('hashchange', () => {
  if (isTab && location.hash === '#help') go('help');
});

async function detectPage() {
  if (isTab) return { kind: 'other' };
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    console.warn('Labels: could not read the active tab', err);
  }
  const page = classifyUrl(tab?.url ?? '');
  if (page.kind === 'linkedin-other') return { ...page, tabId: tab.id };
  if (page.kind !== 'post') return page;

  let text = '';
  try {
    const result = await runCapture(tab.id, page.id, 'capture');
    text = result?.text ?? '';
    console.info('Labels: preview source', result?.source);
  } catch (err) {
    // Saving still works with the "Open saved post" preview.
    console.warn('Labels: could not read the post text', err);
  }
  return { ...page, tabId: tab.id, excerpt: makeExcerpt(text), text };
}

async function init() {
  if (isTab) document.body.classList.add(isPage ? 'page-mode' : 'tab-mode');
  if (isPage) document.title = 'Labels';
  chrome.commands
    .getAll()
    .then(commands => {
      state.shortcut = commands.find(c => c.name === 'label-post')?.shortcut ?? '';
      render();
    })
    .catch(() => {});
  const [data, page] = await Promise.all([store.load(), detectPage()]);
  state.data = data;
  state.page = page;
  const existing = page.kind === 'post' && data.posts[page.id];
  state.wasSaved = Boolean(existing);
  if (existing) {
    state.selection = new Set(existing.labelIds);
    // Posts saved before a preview (or the full text) could be read get it the next time
    // they're opened.
    if ((!existing.excerpt && page.excerpt) || (page.text?.length ?? 0) > (existing.text?.length ?? 0)) {
      try {
        state.data = (await store.fillExcerpt(page.id, page.excerpt, page.text)).data;
      } catch (err) {
        console.warn('Labels: could not add the preview', err);
      }
    }
  }
  const deepLabel = new URLSearchParams(location.search).get('label');
  if (isTab && deepLabel && labelName(state.data, deepLabel)) {
    state.view = 'label';
    state.labelId = deepLabel;
  } else if (isTab) state.view = location.hash === '#help' ? 'help' : 'labels';
  else state.view = 'labels';
  render();
  document.body.dataset.ready = 'true';
}

init();
