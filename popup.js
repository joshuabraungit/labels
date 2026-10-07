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
  postsOnlyIn,
  STORAGE_KEY,
} from './lib/store.js';

const store = createStore(chrome.storage.local);
const isTab = new URLSearchParams(location.search).get('mode') === 'tab';
const app = document.getElementById('app');
const importInput = document.getElementById('import-file');

// Runs lib/capture.js in the tab, then capturePostText(postId, mode) from it.
async function runCapture(tabId, postId, mode) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/capture.js'] });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (id, how) => capturePostText(id, how),
    args: [postId, mode],
  });
  return injection?.result;
}
const FALLBACK_PREVIEW = 'Open saved post';
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
  app.append(h('div', { class: 'content', inert: Boolean(state.dialog) }, views[state.view]()));
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

function renderLabels({ compact = false } = {}) {
  const rows = labelsWithCounts(state.data);
  const nothingSaved = Object.keys(state.data.posts).length === 0;
  return h(
    'div',
    null,
    h('h1', { class: 'section-title' }, 'Your labels'),
    // On a post page, "+ New label" lives in the Save section above.
    !compact && renderNewLabel(),
    h(
      'div',
      { class: `scroll${compact ? '' : ' tall'}`, 'data-scroll': 'labels' },
      h(
        'ul',
        { class: 'list' },
        rows.map(row =>
          h(
            'li',
            null,
            h(
              'button',
              {
                class: 'label-row',
                'data-focus': `label-${row.id}`,
                onClick: () => go('label', { labelId: row.id }),
              },
              h('span', { class: 'name' }, row.name),
              h('span', { class: 'count', 'aria-label': `${row.count} saved posts` }, String(row.count)),
              h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
            ),
          ),
        ),
      ),
    ),
    nothingSaved && h('p', { class: 'hint' }, 'Nothing saved yet.'),
    renderTip(),
  );
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

function renderLabel() {
  const name = labelName(state.data, state.labelId);
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
      h('button', { class: 'icon-btn back', 'aria-label': 'Back', title: 'Back', onClick: () => go('labels') }, '‹'),
      h('h2', { title: name }, name),
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
    posts.length
      ? h(
          'div',
          { class: 'scroll tall', 'data-scroll': `posts-${state.labelId}` },
          h(
            'ul',
            { class: 'list' },
            posts.map(post =>
              h(
                'li',
                { class: 'post-row' },
                h(
                  'button',
                  { class: 'post-open', title: post.url, onClick: () => openPost(post.url) },
                  h(
                    'span',
                    { class: `excerpt${post.excerpt ? '' : ' fallback'}` },
                    post.excerpt || `${FALLBACK_PREVIEW} \u00B7 saved ${savedDate(post.savedAt)}`,
                  ),
                ),
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
              ),
            ),
          ),
        )
      : h('p', { class: 'empty' }, 'No saved posts with this label yet.'),
    renderUndo(),
  );
}

function renderEdit() {
  const post = state.data.posts[state.editPostId];
  if (!post) {
    state.view = 'label';
    return renderLabel();
  }
  const save = async () => {
    state.editError = '';
    try {
      const { data } = await store.setPostLabels(post.id, [...state.editSelection]);
      state.data = data;
      go('label');
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
      h('button', { class: 'icon-btn back', 'aria-label': 'Back', title: 'Back', onClick: () => go('label') }, '‹'),
      h('h2', null, 'Edit labels'),
    ),
    renderPreview(post.excerpt),
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

  if (m.kind === 'label') {
    return h(
      'div',
      { class: 'menu', role: 'menu' },
      h('div', { class: 'menu-caption' }, 'EDIT THIS LABEL'),
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
    item('Edit labels', () => {
      const post = state.data.posts[m.postId];
      go('edit', { editPostId: m.postId, editSelection: new Set(post?.labelIds ?? []), editError: '' });
    }),
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
    confirmText = 'Delete';
    confirmClass = 'btn danger';
    const only = postsOnlyIn(state.data, state.labelId);
    body = h(
      'p',
      null,
      only
        ? `Delete this label? ${plural(only, 'saved post')} with no other label will be removed from Labels. Posts with other labels are kept.`
        : 'Delete this label? Your saved posts will be kept.',
    );
    onConfirm = async () => {
      try {
        const { data } = await store.deleteLabel(state.labelId);
        state.data = data;
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
      { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h3', null, title),
      body,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', 'data-focus': 'dialog-cancel', onClick: closeDialog }, 'Cancel'),
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
  return { ...page, tabId: tab.id, excerpt: makeExcerpt(text) };
}

async function init() {
  if (isTab) document.body.classList.add('tab-mode');
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
    // Posts saved before a preview could be read get one the next time they're opened.
    if (!existing.excerpt && page.excerpt) {
      try {
        state.data = (await store.fillExcerpt(page.id, page.excerpt)).data;
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
}

init();
