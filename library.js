// The Library: every saved post as a card, with labels and people to filter by and a search
// box. Opens in a tab from the Labels toolbar icon (or the picker's "Library" link).
import {
  createStore,
  emptyData,
  exportBackup,
  labelsWithCounts,
  LabelsError,
  postsOnlyIn,
  searchPosts,
  sortedLabels,
  STORAGE_KEY,
  TODAY_COUNT,
  todayCandidates,
  todayPosts,
  toSortLabelId,
} from './lib/store.js';

const store = createStore(chrome.storage.local);
const app = document.getElementById('app');
const importInput = document.getElementById('import-file');

const state = {
  data: emptyData(),
  // { kind: 'today' } | { kind: 'all' } | { kind: 'label', id } | { kind: 'person', name }
  filter: { kind: 'all' },
  query: '',
  expanded: new Set(), // post IDs showing their whole text
  editing: null, // post ID whose "Edit labels" popover is open
  editQuery: '',
  newLabel: null, // { value, error } while adding a label in the sidebar
  renaming: null, // { id, value, error }
  menu: null, // { labelId, x, y }
  dialog: null, // { labelId } for the delete-label warning
  toast: '',
  shortcut: '',
  focus: null,
  // Sort mode: one post at a time from "To sort". { queue, index, chosen, query, sorted, skipped, error }
  sort: null,
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

function icon(paths) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

const ICONS = {
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  open: ['M14 4h6v6', 'M20 4l-8 8', 'M10 5H5v14h14v-5'],
  expand: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
  collapse: ['M4 14h6v6', 'M20 10h-6V4', 'M14 10l7-7', 'M3 21l7-7'],
  tag: ['M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z', 'M7.5 7.5h.01'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M5 20h14'],
  sun: [
    'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M12 2v2',
    'M12 20v2',
    'M4.9 4.9l1.4 1.4',
    'M17.7 17.7l1.4 1.4',
    'M2 12h2',
    'M20 12h2',
    'M4.9 19.1l1.4-1.4',
    'M17.7 6.3l1.4-1.4',
  ],
  upload: ['M12 20V8', 'M7 13l5-5 5 5', 'M5 4h14'],
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function errorMessage(err) {
  if (err instanceof LabelsError) return err.message;
  console.error(err);
  return 'Something went wrong. Please try again.';
}

// Today's cards: "From 4 months ago".
function fromAgo(ms) {
  const days = Math.round((Date.now() - ms) / 86400000);
  if (days >= 60) return `From ${Math.round(days / 30)} months ago`;
  if (days >= 14) return `From ${Math.round(days / 7)} weeks ago`;
  return `From ${days} day${days === 1 ? '' : 's'} ago`;
}

function savedAgo(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'Saved just now';
  if (mins < 60) return `Saved ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Saved ${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `Saved ${days}d ago`;
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return `Saved ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}`;
}

function initials(name) {
  const parts = String(name || '?')
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase();
}

// A profile photo, or the person's initials if there isn't one (or it no longer loads).
function avatar(url, name, cls) {
  const fallback = () => h('span', { class: `${cls} initials`, 'aria-hidden': 'true' }, initials(name));
  if (!url) return fallback();
  const img = h('img', { class: cls, src: url, alt: '', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(fallback()));
  return img;
}

// Saved before Labels kept full text, or cut off by LinkedIn's "…see more".
const isPartial = post => !post.text || /(…|\.\.\.)$/.test(post.text.trim());

function showToast(text) {
  clearTimeout(state.toastTimer);
  state.toast = text;
  state.toastTimer = setTimeout(() => {
    state.toast = '';
    render();
  }, 2500);
  render();
}

async function run(action) {
  try {
    const { data } = await action();
    state.data = data;
  } catch (err) {
    showToast(errorMessage(err));
  }
  render();
}

// ---------- what to show ----------

// The people you've saved posts from, most saved first.
function people() {
  const byName = new Map();
  for (const post of Object.values(state.data.posts)) {
    const name = post.author?.name;
    if (!name) continue;
    const row = byName.get(name) ?? { name, avatar: '', count: 0 };
    row.count++;
    row.avatar ||= post.author.avatar || '';
    byName.set(name, row);
  }
  return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function visiblePosts() {
  const q = state.query.trim();
  const f = state.filter;
  if (f.kind === 'today') {
    // In the order they were picked; search narrows them down.
    const matches = q ? new Set(searchPosts(state.data, q).map(p => p.id)) : null;
    return todayPosts(state.data).filter(p => !matches || matches.has(p.id));
  }
  let posts = q ? searchPosts(state.data, q) : Object.values(state.data.posts);
  if (f.kind === 'label') posts = posts.filter(p => p.labelIds.includes(f.id));
  if (f.kind === 'person') posts = posts.filter(p => p.author?.name === f.name);
  return posts.sort((a, b) => b.savedAt - a.savedAt);
}

function setFilter(filter) {
  state.filter = filter;
  state.editing = null;
  render();
  window.scrollTo(0, 0);
}

// ---------- sidebar ----------

function navItem({ label, count, active, onClick, lead, cls = '' }) {
  return h(
    'button',
    { class: `nav-item ${cls}${active ? ' active' : ''}`, 'aria-current': active ? 'true' : null, onClick },
    lead,
    h('span', { class: 'name' }, label),
    h('span', { class: 'count' }, String(count)),
  );
}

function renderNewLabel() {
  const nl = state.newLabel;
  if (!nl) return null;
  const submit = async e => {
    e.preventDefault();
    try {
      const { data } = await store.createLabel(nl.value);
      state.data = data;
      state.newLabel = null;
    } catch (err) {
      nl.error = errorMessage(err);
      state.focus = 'new-label';
    }
    render();
  };
  return h(
    'div',
    null,
    h(
      'form',
      { class: 'inline-form', onSubmit: submit },
      h('input', {
        class: 'field',
        type: 'text',
        value: nl.value,
        maxlength: '80',
        placeholder: 'Label name',
        'aria-label': 'New label name',
        'data-focus': 'new-label',
        onInput: e => (nl.value = e.target.value),
        onKeydown: e => e.key === 'Escape' && ((state.newLabel = null), render()),
      }),
      h('button', { class: 'btn primary', type: 'submit' }, 'Add'),
    ),
    nl.error && h('p', { class: 'error', role: 'alert' }, nl.error),
  );
}

function renderLabelRow(row) {
  const r = state.renaming;
  if (r?.id === row.id) {
    const submit = async e => {
      e.preventDefault();
      try {
        const { data } = await store.renameLabel(row.id, r.value);
        state.data = data;
        state.renaming = null;
      } catch (err) {
        r.error = errorMessage(err);
        state.focus = 'rename';
      }
      render();
    };
    return h(
      'div',
      null,
      h(
        'form',
        { class: 'inline-form', onSubmit: submit },
        h('input', {
          class: 'field',
          type: 'text',
          value: r.value,
          maxlength: '80',
          'aria-label': 'Label name',
          'data-focus': 'rename',
          onInput: e => (r.value = e.target.value),
          onKeydown: e => e.key === 'Escape' && ((state.renaming = null), render()),
        }),
        h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      ),
      r.error && h('p', { class: 'error', role: 'alert' }, r.error),
    );
  }
  const active = state.filter.kind === 'label' && state.filter.id === row.id;
  return h(
    'div',
    { class: 'label-row' },
    navItem({ label: row.name, count: row.count, active, onClick: () => setFilter({ kind: 'label', id: row.id }) }),
    h(
      'button',
      {
        class: 'icon-btn more',
        'aria-label': `Options for ${row.name}`,
        title: 'Rename or delete',
        onClick: e => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          state.menu = state.menu?.labelId === row.id ? null : { labelId: row.id, x: r.left, y: r.bottom + 4 };
          render();
        },
      },
      '⋯',
    ),
  );
}

function renderSidebar() {
  const total = Object.keys(state.data.posts).length;
  const sortId = toSortLabelId(state.data);
  const labels = labelsWithCounts(state.data).filter(l => l.id !== sortId);
  const toSort = sortId ? (labelsWithCounts(state.data).find(l => l.id === sortId)?.count ?? 0) : 0;
  const folks = people();
  return h(
    'aside',
    { class: 'sidebar' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-32.png', alt: '' }), 'Labels'),
    h(
      'div',
      { class: 'backup' },
      h('button', { class: 'btn', onClick: onExport, title: 'Download a backup file' }, icon(ICONS.download), 'Export'),
      h(
        'button',
        { class: 'btn', onClick: () => importInput.click(), title: 'Restore from a backup file' },
        icon(ICONS.upload),
        'Import',
      ),
    ),
    navItem({
      label: 'Today',
      count: todayPosts(state.data).length,
      active: state.filter.kind === 'today',
      cls: 'today',
      lead: icon(ICONS.sun),
      onClick: () => setFilter({ kind: 'today' }),
    }),
    navItem({
      label: 'All Posts',
      count: total,
      active: state.filter.kind === 'all',
      cls: 'all',
      onClick: () => setFilter({ kind: 'all' }),
    }),
    toSort > 0 &&
      navItem({
        label: 'To sort',
        count: toSort,
        active: state.filter.kind === 'label' && state.filter.id === sortId,
        cls: 'to-sort',
        lead: h('span', { class: 'sort-dot', 'aria-hidden': 'true' }),
        onClick: () => setFilter({ kind: 'label', id: sortId }),
      }),
    h(
      'div',
      { class: 'section-head' },
      'Labels',
      h(
        'button',
        {
          class: 'icon-btn',
          'aria-label': 'Add a label',
          title: 'Add a label',
          onClick: () => {
            state.newLabel = { value: '', error: '' };
            state.focus = 'new-label';
            render();
          },
        },
        '+',
      ),
    ),
    renderNewLabel(),
    labels.map(renderLabelRow),
    !labels.length && !state.newLabel && h('p', { class: 'hint' }, 'No labels yet.'),
    folks.length > 0 && h('div', { class: 'section-head' }, 'People'),
    folks.map(p =>
      navItem({
        label: p.name,
        count: p.count,
        active: state.filter.kind === 'person' && state.filter.name === p.name,
        lead: avatar(p.avatar, p.name, 'avatar-sm'),
        onClick: () => setFilter({ kind: 'person', name: p.name }),
      }),
    ),
    h(
      'p',
      { class: 'tip' },
      'Save posts with the Label button under any post on LinkedIn',
      state.shortcut ? [' or ', h('kbd', null, state.shortcut)] : '',
      '.',
    ),
  );
}

// ---------- main column ----------

function renderEditPopover(post) {
  const q = state.editQuery.trim();
  const sortId = toSortLabelId(state.data);
  const labels = sortedLabels(state.data).filter(
    l => l.id !== sortId && l.name.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
  );
  const exists = sortedLabels(state.data).some(l => l.name.toLocaleLowerCase() === q.toLocaleLowerCase());
  const only = post.labelIds.length === 1;
  const toggle = (id, on) =>
    run(() => store.setPostLabels(post.id, on ? [...post.labelIds, id] : post.labelIds.filter(x => x !== id)));
  const create = async () => {
    try {
      const { result } = await store.createLabel(q);
      const { data } = await store.setPostLabels(post.id, [...post.labelIds, result.id]);
      state.data = data;
      state.editQuery = '';
      state.focus = 'edit-query';
    } catch (err) {
      showToast(errorMessage(err));
    }
    render();
  };
  return h(
    'div',
    { class: 'popover', role: 'dialog', 'aria-label': 'Edit labels', onClick: e => e.stopPropagation() },
    h('input', {
      class: 'field',
      type: 'text',
      value: state.editQuery,
      placeholder: 'Find or create a label…',
      'aria-label': 'Find or create a label',
      'data-focus': 'edit-query',
      onInput: e => {
        state.editQuery = e.target.value;
        render();
      },
      onKeydown: e => {
        if (e.key === 'Escape') {
          state.editing = null;
          render();
        } else if (e.key === 'Enter' && q && !exists) create();
      },
    }),
    h(
      'div',
      { class: 'checks' },
      labels.map(l => {
        const on = post.labelIds.includes(l.id);
        const locked = on && only;
        return h(
          'label',
          { class: `check${locked ? ' locked' : ''}`, title: locked ? 'A post needs at least one label' : null },
          h('input', {
            type: 'checkbox',
            checked: on,
            disabled: locked,
            onChange: e => toggle(l.id, e.target.checked),
          }),
          l.name,
        );
      }),
      q && !exists && h('button', { class: 'create', type: 'button', onClick: create }, `+ Create “${q}”`),
    ),
  );
}

function renderCard(post) {
  const expanded = state.expanded.has(post.id);
  const body = post.text || post.excerpt;
  const long = body.length > 200 || body.split('\n').length > 4;
  const labels = post.labelIds
    .map(id => state.data.labels[id])
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const name = post.author?.name || 'LinkedIn post';
  const image =
    post.image && h('img', { class: 'post-image', src: post.image, alt: '', referrerpolicy: 'no-referrer' });
  image?.addEventListener('error', () => image.remove());
  return h(
    'article',
    { class: 'card', 'data-post': post.id },
    h(
      'div',
      { class: 'card-body' },
      h(
        'div',
        { class: 'author' },
        avatar(post.author?.avatar, post.author?.name, 'avatar'),
        h(
          'div',
          { class: 'who' },
          h('div', { class: 'name' }, name),
          post.author?.headline && h('div', { class: 'headline', title: post.author.headline }, post.author.headline),
          h('div', { class: 'when' }, state.filter.kind === 'today' ? fromAgo(post.savedAt) : savedAgo(post.savedAt)),
        ),
      ),
      image,
      body
        ? h('p', { class: `text${long && !expanded ? ' clamped' : ''}` }, body)
        : h('p', { class: 'text fallback' }, 'No text was saved for this post. Open it to see it on LinkedIn.'),
      isPartial(post) &&
        body &&
        h(
          'p',
          { class: 'partial' },
          'Only part of this post was saved. Open its Label picker on LinkedIn to get the rest.',
        ),
      h(
        'div',
        { class: 'chips' },
        labels.map(l => h('button', { class: 'chip', onClick: () => setFilter({ kind: 'label', id: l.id }) }, l.name)),
      ),
    ),
    h(
      'div',
      { class: 'card-actions' },
      h('button', { class: 'action', onClick: () => chrome.tabs.create({ url: post.url }) }, icon(ICONS.open), 'Open'),
      long &&
        h(
          'button',
          {
            class: 'action',
            onClick: () => {
              if (expanded) state.expanded.delete(post.id);
              else state.expanded.add(post.id);
              render();
            },
          },
          icon(expanded ? ICONS.collapse : ICONS.expand),
          expanded ? 'Collapse' : 'Expand',
        ),
      h(
        'button',
        {
          class: 'action',
          'aria-label': 'Edit labels',
          title: 'Edit labels',
          'aria-expanded': String(state.editing === post.id),
          onClick: e => {
            e.stopPropagation();
            state.editing = state.editing === post.id ? null : post.id;
            state.editQuery = '';
            state.focus = state.editing ? 'edit-query' : null;
            render();
          },
        },
        icon(ICONS.tag),
        'Labels',
      ),
      h(
        'button',
        {
          class: 'action delete',
          'aria-label': 'Delete post',
          title: 'Delete from Labels',
          onClick: () => {
            run(() => store.removePost(post.id));
            showToast('Post deleted');
          },
        },
        icon(ICONS.trash),
      ),
      state.editing === post.id && renderEditPopover(post),
    ),
  );
}

// ---------- Today ----------

function renderTodayHeader(count) {
  if (!count) return null;
  return h(
    'div',
    { class: 'today-head' },
    h('h1', null, 'Today'),
    h('p', null, `${plural(count, 'post')} from your library, picked for today. New ones tomorrow.`),
  );
}

function renderTodayMore() {
  if (!todayPosts(state.data).length) return null;
  const left = todayCandidates(state.data, Date.now(), state.data.today?.ids ?? []).length;
  const more = async () => {
    try {
      const { data, result } = await store.moreToday();
      state.data = data;
      if (!result) showToast('That\u2019s everything for now.');
    } catch (err) {
      showToast(errorMessage(err));
    }
    render();
  };
  return h(
    'div',
    { class: 'today-more' },
    left
      ? h('button', { class: 'btn', onClick: more }, `Show ${Math.min(TODAY_COUNT, left)} more`)
      : h('p', { class: 'hint' }, 'That\u2019s everything for now. More tomorrow.'),
  );
}

// A new day's picks (and the badge on the toolbar icon) when the Library opens or comes back.
async function refreshToday() {
  try {
    const { data } = await store.ensureToday();
    state.data = data;
    if (data.today?.fresh && todayPosts(data).length) {
      state.filter = { kind: 'today' };
      render();
      const { data: seen } = await store.seenToday();
      state.data = seen;
    }
  } catch (err) {
    console.warn('Labels: could not pick today\u2019s posts', err);
  }
  render();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !state.sort) refreshToday();
});

// ---------- sort mode ----------

function renderSortBanner() {
  const sortId = toSortLabelId(state.data);
  const count = sortId ? Object.values(state.data.posts).filter(p => p.labelIds.includes(sortId)).length : 0;
  if (!count || state.query.trim() || state.filter.kind === 'person') return null;
  if (state.filter.kind === 'label' && state.filter.id !== sortId) return null;
  return h(
    'div',
    { class: 'sort-banner' },
    h('span', null, h('strong', null, plural(count, 'post')), ' to sort. Give each one a label with a key press.'),
    h('button', { class: 'btn primary', 'data-focus': 'start-sorting', onClick: startSorting }, 'Start sorting'),
  );
}

function startSorting() {
  const sortId = toSortLabelId(state.data);
  const queue = sortId
    ? Object.values(state.data.posts)
        .filter(p => p.labelIds.includes(sortId))
        .sort((a, b) => b.savedAt - a.savedAt)
        .map(p => p.id)
    : [];
  state.sort = { queue, index: 0, chosen: new Set(), query: '', sorted: 0, skipped: 0, error: '' };
  state.editing = null;
  render();
  window.scrollTo(0, 0);
}

function stopSorting() {
  state.sort = null;
  if (location.hash === '#sort') history.replaceState(null, '', location.pathname);
  render();
}

// The post being sorted, skipping any that were labeled or deleted elsewhere meanwhile.
function currentSortPost() {
  const s = state.sort;
  const sortId = toSortLabelId(state.data);
  while (s.index < s.queue.length) {
    const post = state.data.posts[s.queue[s.index]];
    if (post && sortId && post.labelIds.includes(sortId)) return post;
    s.index++;
  }
  return null;
}

function sortLabels() {
  const sortId = toSortLabelId(state.data);
  const q = state.sort.query.trim().toLocaleLowerCase();
  return sortedLabels(state.data).filter(l => l.id !== sortId && l.name.toLocaleLowerCase().includes(q));
}

function nextSortPost() {
  const s = state.sort;
  s.index++;
  s.chosen = new Set();
  s.query = '';
  s.error = '';
}

const sortActions = {
  toggle(id) {
    const s = state.sort;
    if (s.chosen.has(id)) s.chosen.delete(id);
    else s.chosen.add(id);
    s.error = '';
    render();
  },
  // Moves on right away so fast typing never lands on the post just saved; the write
  // happens in the background, and a failure shows up as a message.
  save() {
    const s = state.sort;
    const post = currentSortPost();
    if (!post) return;
    if (!s.chosen.size) {
      s.error = 'Pick a label first (number keys), or press S to skip.';
      return render();
    }
    const ids = [...s.chosen];
    s.sorted++;
    nextSortPost();
    render();
    store.setPostLabels(post.id, ids).then(
      ({ data }) => {
        state.data = data;
        render();
      },
      err => {
        s.sorted--;
        showToast(errorMessage(err));
      },
    );
  },
  skip() {
    state.sort.skipped++;
    nextSortPost();
    render();
  },
  remove() {
    const post = currentSortPost();
    if (!post) return;
    nextSortPost();
    render();
    store.removePost(post.id).then(
      ({ data }) => {
        state.data = data;
        render();
      },
      err => showToast(errorMessage(err)),
    );
  },
  // Enter in the find box: tick the one match, or create the label.
  async pick() {
    const s = state.sort;
    const q = s.query.trim();
    if (!q) return;
    const exact = sortedLabels(state.data).find(l => l.name.toLocaleLowerCase() === q.toLocaleLowerCase());
    const matches = sortLabels();
    try {
      let id = exact?.id ?? (matches.length === 1 ? matches[0].id : null);
      if (!id) {
        const { data, result } = await store.createLabel(q);
        state.data = data;
        id = result.id;
      }
      s.chosen.add(id);
      s.query = '';
      s.error = '';
    } catch (err) {
      s.error = errorMessage(err);
    }
    render();
  },
};

function renderSorter() {
  const s = state.sort;
  const post = currentSortPost();
  const total = s.queue.length;
  if (!post) {
    return h(
      'main',
      { class: 'main' },
      h(
        'div',
        { class: 'sorter done' },
        h('h1', null, s.skipped ? 'Done for now' : 'All sorted!'),
        h(
          'p',
          null,
          `You labeled ${plural(s.sorted, 'post')}.`,
          s.skipped
            ? ` ${plural(s.skipped, 'post')} you skipped ${s.skipped === 1 ? 'is' : 'are'} still in To sort.`
            : '',
        ),
        h('button', { class: 'btn primary', 'data-focus': 'sort-done', onClick: stopSorting }, 'Back to Library'),
      ),
    );
  }
  const labels = sortLabels();
  const body = post.text || post.excerpt;
  const image =
    post.image && h('img', { class: 'post-image', src: post.image, alt: '', referrerpolicy: 'no-referrer' });
  image?.addEventListener('error', () => image.remove());
  return h(
    'main',
    { class: 'main' },
    h(
      'div',
      { class: 'sorter' },
      h(
        'div',
        { class: 'sorter-head' },
        h('h1', null, 'Sorting'),
        h('span', { class: 'progress', role: 'status' }, `${Math.min(s.index + 1, total)} of ${total}`),
        h('button', { class: 'btn', onClick: stopSorting }, 'Done'),
      ),
      h('div', { class: 'progress-bar' }, h('span', { style: `width:${(100 * s.index) / Math.max(total, 1)}%` })),
      h(
        'article',
        { class: 'card sort-card', 'data-post': post.id },
        h(
          'div',
          { class: 'card-body' },
          h(
            'div',
            { class: 'author' },
            avatar(post.author?.avatar, post.author?.name, 'avatar'),
            h(
              'div',
              { class: 'who' },
              h('div', { class: 'name' }, post.author?.name || 'LinkedIn post'),
              post.author?.headline && h('div', { class: 'headline' }, post.author.headline),
              h(
                'div',
                { class: 'when' },
                h('a', { href: post.url, target: '_blank', rel: 'noopener' }, 'Open on LinkedIn'),
              ),
            ),
          ),
          image,
          body
            ? h('p', { class: 'text sort-text' }, body)
            : h('p', { class: 'text fallback' }, 'No text was saved for this post.'),
        ),
      ),
      h(
        'div',
        { class: 'sort-labels', role: 'group', 'aria-label': 'Labels' },
        labels.map((l, i) =>
          h(
            'button',
            {
              class: `sort-label${s.chosen.has(l.id) ? ' on' : ''}`,
              'aria-pressed': String(s.chosen.has(l.id)),
              onClick: () => sortActions.toggle(l.id),
            },
            i < 9 && !s.query && h('kbd', null, String(i + 1)),
            l.name,
          ),
        ),
        h('input', {
          class: 'field sort-find',
          type: 'text',
          value: s.query,
          placeholder: 'Find or create a label\u2026  ( / )',
          'aria-label': 'Find or create a label',
          'data-focus': 'sort-find',
          onInput: e => {
            s.query = e.target.value;
            render();
          },
          onKeydown: e => {
            e.stopPropagation();
            if (e.key === 'Enter') sortActions.pick().then(() => document.activeElement?.blur());
            else if (e.key === 'Escape') {
              s.query = '';
              render();
              document.activeElement?.blur();
            }
          },
        }),
      ),
      s.error && h('p', { class: 'error sort-error', role: 'alert' }, s.error),
      h(
        'div',
        { class: 'sort-actions' },
        h('button', { class: 'btn', onClick: sortActions.skip }, 'Skip ', h('kbd', null, 'S')),
        h('button', { class: 'btn', onClick: sortActions.remove }, 'Delete ', h('kbd', null, '\u232B')),
        h(
          'button',
          { class: 'btn primary', disabled: !s.chosen.size, onClick: sortActions.save },
          'Save & next ',
          h('kbd', null, 'Enter'),
        ),
      ),
    ),
  );
}

// Sort mode's keys (not while typing in the find box).
document.addEventListener('keydown', e => {
  if (!state.sort || state.dialog || e.target.matches?.('input, textarea')) return;
  if (!currentSortPost()) {
    if (e.key === 'Enter' || e.key === 'Escape') stopSorting();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 9) {
    const label = sortLabels()[n - 1];
    if (label) sortActions.toggle(label.id);
  } else if (e.key === 'Enter') sortActions.save();
  else if (e.key === 's' || e.key === 'S') sortActions.skip();
  else if (e.key === 'Delete' || e.key === 'Backspace') sortActions.remove();
  else if (e.key === 'Escape') stopSorting();
  else if (e.key === '/') {
    state.focus = 'sort-find';
    render();
  } else return;
  e.preventDefault();
});

function renderMain() {
  if (state.sort) return renderSorter();
  const posts = visiblePosts();
  const total = Object.keys(state.data.posts).length;
  const today = state.filter.kind === 'today';
  let empty = null;
  if (!total) empty = 'Nothing saved yet. Click Label under any post on LinkedIn and it shows up here.';
  else if (today && !posts.length && !state.query.trim())
    empty = 'Nothing to resurface yet. Posts show up here a few days after you save them.';
  else if (!posts.length)
    empty = state.query.trim() ? `No saved posts match “${state.query.trim()}”.` : 'No posts here yet.';
  return h(
    'main',
    { class: 'main' },
    h(
      'div',
      { class: 'topbar' },
      h(
        'div',
        { class: 'search' },
        icon(ICONS.search),
        h('input', {
          type: 'text',
          role: 'searchbox',
          value: state.query,
          placeholder: 'Search posts, people and labels…',
          'aria-label': 'Search posts',
          'data-focus': 'search',
          onInput: e => {
            state.query = e.target.value;
            render();
          },
          onKeydown: e => e.key === 'Escape' && ((state.query = ''), render()),
        }),
      ),
      h('span', { class: 'total', role: 'status' }, plural(posts.length, 'post')),
    ),
    today && renderTodayHeader(posts.length),
    !today && renderSortBanner(),
    empty ? h('p', { class: 'empty' }, empty) : h('div', { class: 'list' }, posts.map(renderCard)),
    today && !state.query.trim() && renderTodayMore(),
  );
}

// ---------- menu, dialog ----------

function renderMenu() {
  const m = state.menu;
  const close = () => (state.menu = null);
  return h(
    'div',
    { class: 'menu', role: 'menu', style: `left:${m.x}px;top:${m.y}px`, onClick: e => e.stopPropagation() },
    h(
      'button',
      {
        role: 'menuitem',
        onClick: () => {
          close();
          state.renaming = { id: m.labelId, value: state.data.labels[m.labelId]?.name ?? '', error: '' };
          state.focus = 'rename';
          render();
        },
      },
      'Rename',
    ),
    h(
      'button',
      {
        role: 'menuitem',
        class: 'danger',
        onClick: () => {
          close();
          state.dialog = { labelId: m.labelId };
          state.focus = 'dialog-cancel';
          render();
        },
      },
      'Delete',
    ),
  );
}

function renderDialog() {
  const { labelId } = state.dialog;
  const label = state.data.labels[labelId];
  if (!label) return null;
  const count = Object.values(state.data.posts).filter(p => p.labelIds.includes(labelId)).length;
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
  const close = () => {
    state.dialog = null;
    render();
  };
  const confirm = async () => {
    state.dialog = null;
    if (state.filter.kind === 'label' && state.filter.id === labelId) state.filter = { kind: 'all' };
    await run(() => store.deleteLabel(labelId));
  };
  return h(
    'div',
    {
      class: 'backdrop',
      onClick: e => e.target === e.currentTarget && close(),
      onKeydown: e => e.key === 'Escape' && close(),
    },
    h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Delete label' },
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
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary', 'data-focus': 'dialog-cancel', onClick: close }, 'Never mind'),
        h('button', { class: 'btn danger', onClick: confirm }, 'Permanently delete it'),
      ),
    ),
  );
}

// ---------- render ----------

function render() {
  const active = document.activeElement;
  const focusKey = state.focus ?? active?.dataset?.focus;
  const caret = active?.type === 'text' ? active.selectionStart : null;
  state.focus = null;

  app.replaceChildren(renderSidebar(), renderMain());
  if (state.menu) app.append(renderMenu());
  if (state.dialog) app.append(renderDialog() ?? '');
  if (state.toast) app.append(h('div', { class: 'toast', role: 'status' }, state.toast));

  const el = focusKey && app.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
  if (el) {
    el.focus({ preventScroll: true });
    if (el.type === 'text') {
      const at = caret ?? el.value.length;
      el.setSelectionRange(at, at);
    }
  }
}

// Clicking anywhere else closes the label menu and the "Edit labels" popover.
document.addEventListener('click', () => {
  if (!state.menu && !state.editing) return;
  state.menu = null;
  state.editing = null;
  render();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || (!state.menu && !state.editing)) return;
  state.menu = null;
  state.editing = null;
  render();
});

// ---------- backup ----------

function onExport() {
  const blob = new Blob([JSON.stringify(exportBackup(state.data), null, 2)], { type: 'application/json' });
  const a = h('a', {
    href: URL.createObjectURL(blob),
    download: `labels-backup-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

importInput.addEventListener('change', async () => {
  const file = importInput.files?.[0];
  importInput.value = ''; // so picking the same file again still fires "change"
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    showToast('That file isn’t a Labels backup.');
    return;
  }
  try {
    const { data, result } = await store.importBackup(parsed);
    state.data = data;
    showToast(
      `Imported ${plural(result.postsAdded, 'new post')}, updated ${plural(result.postsUpdated, 'post')}, added ${plural(result.labelsAdded, 'label')}.`,
    );
  } catch (err) {
    showToast(errorMessage(err));
  }
});

// ---------- start ----------

// Saves from LinkedIn show up here right away.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  state.data = await store.load();
  render();
});

async function init() {
  chrome.commands
    .getAll()
    .then(commands => {
      state.shortcut = commands.find(c => c.name === 'label-post')?.shortcut ?? '';
      render();
    })
    .catch(() => {});
  state.data = await store.load();
  render();
  if (location.hash === '#sort') startSorting();
  else await refreshToday();
  document.body.dataset.ready = 'true';
}

// "Sort them" on LinkedIn's Saved posts page opens the Library at #sort.
window.addEventListener('hashchange', () => {
  if (location.hash === '#sort' && !state.sort) startSorting();
});

init();
