// Run with: node --test tests/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl, cleanPostText, makeExcerpt, TEXT_LIMIT } from '../lib/post.js';
import {
  createStore,
  exportBackup,
  labelsWithCounts,
  postsForLabel,
  postsOnlyIn,
  PINNED_ID,
  pinnedCount,
  cleanMeta,
  dayKey,
  todayIsNew,
  todayPosts,
  postsAsMarkdown,
  searchPosts,
  STORAGE_KEY,
  validateBackup,
} from '../lib/store.js';

function memoryArea() {
  const mem = {};
  return {
    mem,
    get: async key => (key in mem ? { [key]: structuredClone(mem[key]) } : {}),
    set: async obj => Object.assign(mem, structuredClone(obj)),
  };
}

const POST_A = 'https://www.linkedin.com/feed/update/urn:li:activity:7212345678901234567/';
const POST_B = 'https://www.linkedin.com/posts/jane-doe_hiring-product-activity-7200000000000000001-AbCd/';

test('classifyUrl identifies feed/update posts and strips tracking', () => {
  const r = classifyUrl(
    'https://www.linkedin.com/feed/update/urn:li:activity:7212345678901234567/?utm_source=share&utm_medium=member_desktop#comments',
  );
  assert.deepEqual(r, { kind: 'post', id: 'urn:li:activity:7212345678901234567', url: POST_A });
  assert.equal(classifyUrl('https://linkedin.com/feed/update/urn%3Ali%3Aactivity%3A7212345678901234567').id, r.id);
  assert.equal(classifyUrl('https://www.linkedin.com/feed/update/urn:li:ugcPost:123/').id, 'urn:li:ugcPost:123');
  assert.equal(classifyUrl('https://www.linkedin.com/feed/update/urn:li:share:123').id, 'urn:li:share:123');
});

test('classifyUrl identifies /posts/ slugs', () => {
  const r = classifyUrl(`${POST_B}?utm_source=share&rcm=abc`);
  assert.deepEqual(r, { kind: 'post', id: 'urn:li:activity:7200000000000000001', url: POST_B });
  assert.equal(
    classifyUrl('https://www.linkedin.com/posts/acme_launch-ugcPost-7200000000000000009-x1y2').id,
    'urn:li:ugcPost:7200000000000000009',
  );
});

test('classifyUrl refuses feeds and non-posts', () => {
  assert.equal(classifyUrl('https://www.linkedin.com/feed/').kind, 'linkedin-other');
  assert.equal(classifyUrl('https://www.linkedin.com/in/someone/').kind, 'linkedin-other');
  assert.equal(classifyUrl('https://www.linkedin.com/posts/someone_no-id-here/').kind, 'post-unidentified');
  assert.equal(classifyUrl('https://www.linkedin.com/feed/update/urn:li:fsd_profile:abc/').kind, 'post-unidentified');
  assert.equal(classifyUrl('https://example.com/feed/update/urn:li:activity:1/').kind, 'other');
  assert.equal(classifyUrl('https://notlinkedin.com/feed/update/urn:li:activity:1/').kind, 'other');
  assert.equal(classifyUrl('chrome://extensions').kind, 'other');
  assert.equal(classifyUrl('').kind, 'other');
});

test('makeExcerpt collapses whitespace and cuts at a word boundary', () => {
  assert.equal(makeExcerpt('  Hello\n\nworld  \t again '), 'Hello world again');
  const long = `${'word '.repeat(40)}end`;
  const ex = makeExcerpt(long);
  assert.ok(ex.endsWith('…'));
  assert.ok(ex.length <= 161);
  assert.ok(!/\s…$/.test(ex));
  assert.equal(
    ex
      .slice(0, -1)
      .split(' ')
      .every(w => w === 'word'),
    true,
  );
  assert.equal(makeExcerpt('a'.repeat(160)), 'a'.repeat(160));
  assert.equal(makeExcerpt(''), '');
});

test('labels: create, duplicates, rename, delete', async () => {
  const store = createStore(memoryArea());
  const { result: ai } = await store.createLabel('  AI   tools ');
  assert.equal(ai.name, 'AI tools');
  await assert.rejects(store.createLabel('ai TOOLS'), /already have/);
  await assert.rejects(store.createLabel('   '), /Enter a label/);
  const { result: hiring } = await store.createLabel('Hiring');

  await store.savePost({ id: 'urn:li:activity:1', url: POST_A, excerpt: 'one', labelIds: [ai.id, hiring.id] });
  await store.savePost({ id: 'urn:li:activity:2', url: POST_A, excerpt: 'two', labelIds: [ai.id] });

  // Case-only rename of the same label is allowed; renaming onto another label is not.
  await store.renameLabel(ai.id, 'ai tools');
  await assert.rejects(store.renameLabel(ai.id, 'HIRING'), /already have/);
  let { data } = await store.renameLabel(ai.id, 'Zebra');
  assert.deepEqual(
    labelsWithCounts(data).map(r => [r.name, r.count]),
    [
      ['Hiring', 1],
      ['Zebra', 2],
    ],
  );

  // Deleting a label removes the posts that had only that label and keeps the rest.
  assert.equal(postsOnlyIn(data, ai.id), 1);
  let result;
  ({ data, result } = await store.deleteLabel(ai.id));
  assert.equal(result.removed, 1);
  assert.deepEqual(Object.keys(data.posts), ['urn:li:activity:1']);
  assert.deepEqual(data.posts['urn:li:activity:1'].labelIds, [hiring.id]);
  assert.deepEqual(
    labelsWithCounts(data).map(r => r.name),
    ['Hiring'],
  );
});

test('saving twice updates the same record', async () => {
  const store = createStore(memoryArea());
  const { result: l } = await store.createLabel('Ideas');
  const { result: m } = await store.createLabel('More');
  const first = await store.savePost({ id: 'urn:li:activity:1', url: POST_A, excerpt: 'hi', labelIds: [m.id] });
  assert.equal(first.result.created, true);
  assert.deepEqual(postsForLabel(first.data, m.id).length, 1);
  const second = await store.savePost({ id: 'urn:li:activity:1', url: POST_A, excerpt: '', labelIds: [l.id] });
  assert.equal(second.result.created, false);
  assert.equal(Object.keys(second.data.posts).length, 1);
  assert.equal(second.data.posts['urn:li:activity:1'].excerpt, 'hi', 'empty capture keeps old excerpt');
  assert.equal(second.data.posts['urn:li:activity:1'].savedAt, first.data.posts['urn:li:activity:1'].savedAt);
  assert.equal(postsForLabel(second.data, m.id).length, 0);
});

test('a post needs at least one label', async () => {
  const store = createStore(memoryArea());
  await assert.rejects(
    store.savePost({ id: 'urn:li:activity:1', url: POST_A, excerpt: 'hi', labelIds: [] }),
    /Pick or create a label/,
  );
  const { result: l } = await store.createLabel('Ideas');
  await store.savePost({ id: 'urn:li:activity:1', url: POST_A, excerpt: 'hi', labelIds: [l.id] });
  // Saving an existing post with no labels removes it.
  const cleared = await store.savePost({ id: 'urn:li:activity:1', url: POST_A, excerpt: '', labelIds: [] });
  assert.equal(cleared.result.removed, true);
  assert.equal(Object.keys(cleared.data.posts).length, 0);
  await store.savePost({ id: 'urn:li:activity:2', url: POST_A, excerpt: 'hi', labelIds: [l.id] });
  const { data } = await store.setPostLabels('urn:li:activity:2', []);
  assert.equal(Object.keys(data.posts).length, 0);
});

test('unlabeled posts from older versions are dropped', async () => {
  const area = memoryArea();
  area.mem[STORAGE_KEY] = {
    version: 1,
    labels: { l1: { id: 'l1', name: 'Keep', createdAt: 1 } },
    posts: {
      'urn:li:activity:1': { id: 'urn:li:activity:1', url: POST_A, excerpt: '', labelIds: ['l1'], savedAt: 1 },
      'urn:li:activity:2': { id: 'urn:li:activity:2', url: POST_A, excerpt: '', labelIds: [], savedAt: 1 },
    },
  };
  const { data } = await createStore(area).createLabel('New');
  assert.deepEqual(Object.keys(data.posts), ['urn:li:activity:1']);
});

test('saving refuses bad IDs and missing labels', async () => {
  const store = createStore(memoryArea());
  await assert.rejects(
    store.savePost({ id: 'nope', url: POST_A, excerpt: '', labelIds: [] }),
    /couldn.t be identified/,
  );
  await assert.rejects(
    store.savePost({ id: 'urn:li:activity:1', url: POST_A, excerpt: '', labelIds: ['l_gone'] }),
    /no longer exists/,
  );
});

test('posts sort newest saved first', async () => {
  const store = createStore(memoryArea());
  const { result: l } = await store.createLabel('Ideas');
  await store.savePost({ id: 'urn:li:activity:1', url: POST_A, excerpt: 'old', labelIds: [l.id] });
  await new Promise(r => setTimeout(r, 5));
  const { data } = await store.savePost({ id: 'urn:li:activity:2', url: POST_A, excerpt: 'new', labelIds: [l.id] });
  assert.deepEqual(
    postsForLabel(data, l.id).map(p => p.excerpt),
    ['new', 'old'],
  );
});

test('pinned posts sort first and survive backup', async () => {
  const A = 'urn:li:activity:7212345678901234567';
  const B = 'urn:li:activity:7200000000000000001';
  const store = createStore(memoryArea());
  const { result: l } = await store.createLabel('Ideas');
  await store.savePost({ id: A, url: POST_A, excerpt: 'old', labelIds: [l.id] });
  await new Promise(r => setTimeout(r, 5));
  await store.savePost({ id: B, url: POST_B, excerpt: 'new', labelIds: [l.id] });
  let { data } = await store.setPinned(A, true);
  assert.deepEqual(
    postsForLabel(data, l.id).map(p => p.excerpt),
    ['old', 'new'],
    'pinned on top',
  );
  assert.deepEqual(
    postsForLabel(data, PINNED_ID).map(p => p.excerpt),
    ['old'],
  );
  assert.equal(pinnedCount(data), 1);
  // Saving again keeps the pin.
  ({ data } = await store.savePost({ id: A, url: POST_A, excerpt: '', labelIds: [l.id] }));
  assert.ok(data.posts[A].pinnedAt);

  const backup = JSON.parse(JSON.stringify(exportBackup(data)));
  const other = createStore(memoryArea());
  const { data: imported } = await other.importBackup(backup);
  assert.ok(imported.posts[A].pinnedAt);
  assert.equal(imported.posts[B].pinnedAt, undefined);

  ({ data } = await store.setPinned(A, false));
  assert.equal(pinnedCount(data), 0);
  await assert.rejects(store.setPinned('urn:li:activity:9', true), /no longer exists/);
});

test('full text, notes, colors and search', async () => {
  const A = 'urn:li:activity:7212345678901234567';
  const B = 'urn:li:activity:7200000000000000001';
  const store = createStore(memoryArea());
  const { result: cold } = await store.createLabel('Cold email');
  const { result: hire } = await store.createLabel('Hiring');
  const long = `Opening line here.\n\n\n\nSecond   paragraph about subject lines. ${'x'.repeat(5000)}`;
  await store.savePost({ id: A, url: POST_A, excerpt: makeExcerpt(long), text: long, labelIds: [cold.id] });
  await store.savePost({
    id: B,
    url: POST_B,
    excerpt: 'Interview tips',
    text: 'Interview tips for AEs',
    labelIds: [hire.id],
  });
  let data = await store.load();
  assert.ok(data.posts[A].text.startsWith('Opening line here.\n\nSecond paragraph'));
  assert.equal(data.posts[A].text.length, TEXT_LIMIT);
  // A shorter capture later doesn't replace the longer text.
  ({ data } = await store.savePost({ id: A, url: POST_A, excerpt: '', text: 'Opening', labelIds: [cold.id] }));
  assert.equal(data.posts[A].text.length, TEXT_LIMIT);

  ({ data } = await store.setNote(B, '  use for   Q3 hiring push '));
  assert.equal(data.posts[B].note, 'use for Q3 hiring push');
  ({ data } = await store.setLabelColor(cold.id, 'blue'));
  assert.equal(data.labels[cold.id].color, 'blue');
  ({ data } = await store.setLabelColor(cold.id, 'neon'));
  assert.equal(data.labels[cold.id].color, undefined, 'unknown colors are cleared');

  const ids = q => searchPosts(data, q).map(p => p.id);
  assert.deepEqual(ids('subject lines'), [A], 'matches full text beyond the preview');
  assert.deepEqual(ids('q3'), [B], 'matches notes');
  assert.deepEqual(ids('hiring'), [B], 'matches label names');
  assert.deepEqual(ids('interview q3'), [B], 'all words must match');
  assert.deepEqual(ids('nothing-like-this'), []);
  assert.deepEqual(ids('  '), []);

  assert.equal(postsAsMarkdown(data, hire.id), `- [Interview tips](${POST_B}) - use for Q3 hiring push`);

  ({ data } = await store.setNote(B, ''));
  assert.equal(data.posts[B].note, undefined);
  assert.equal(cleanPostText(' a \r\n b '), 'a\nb');
});

test('backups keep text, notes and colors', async () => {
  const A = 'urn:li:activity:7212345678901234567';
  const a = createStore(memoryArea());
  const { result: l } = await a.createLabel('Design');
  await a.setLabelColor(l.id, 'green');
  await a.savePost({ id: A, url: POST_A, excerpt: 'A', text: 'A full text', labelIds: [l.id] });
  const { data: aData } = await a.setNote(A, 'remember this');
  const backup = JSON.parse(JSON.stringify(exportBackup(aData)));
  const b = createStore(memoryArea());
  const { data } = await b.importBackup(backup);
  const post = data.posts[A];
  assert.equal(post.text, 'A full text');
  assert.equal(post.note, 'remember this');
  assert.equal(data.labels[post.labelIds[0]].color, 'green');
});

test('author and image: saved, refreshed, searchable, kept in backups', async () => {
  const A = 'urn:li:activity:7212345678901234567';
  const store = createStore(memoryArea());
  const { result: l } = await store.createLabel('Ideas');
  const meta = {
    name: '  Jane   Author ',
    headline: 'Head of Design',
    avatar: 'https://media.licdn.com/a.jpg',
    image: 'https://media.licdn.com/p.jpg',
  };
  let { data } = await store.savePost({ id: A, url: POST_A, excerpt: 'x', labelIds: [l.id], meta });
  assert.deepEqual(data.posts[A].author, {
    name: 'Jane Author',
    headline: 'Head of Design',
    avatar: 'https://media.licdn.com/a.jpg',
  });
  assert.equal(data.posts[A].image, 'https://media.licdn.com/p.jpg');
  assert.deepEqual(
    searchPosts(data, 'jane').map(p => p.id),
    [A],
    'search finds the author',
  );
  // A later capture refreshes the author (photo links expire) but keeps the image if none is found.
  ({ data } = await store.fillExcerpt(A, '', '', { name: 'Jane Author', avatar: 'https://media.licdn.com/b.jpg' }));
  assert.equal(data.posts[A].author.avatar, 'https://media.licdn.com/b.jpg');
  assert.equal(data.posts[A].image, 'https://media.licdn.com/p.jpg');

  const other = createStore(memoryArea());
  const { data: imported } = await other.importBackup(JSON.parse(JSON.stringify(exportBackup(data))));
  assert.equal(imported.posts[A].author.name, 'Jane Author');
  assert.equal(imported.posts[A].image, 'https://media.licdn.com/p.jpg');
});

test('cleanMeta fixes names saved from avatar status text', () => {
  assert.deepEqual(cleanMeta({ name: 'Status is offline', headline: 'Max Toone' }), { author: { name: 'Max Toone' } });
  assert.deepEqual(cleanMeta({ name: 'Status is reachable' }), {});
});

test('cleanMeta drops unsafe or empty values', () => {
  assert.deepEqual(cleanMeta({ name: '', image: '' }), {});
  assert.deepEqual(cleanMeta({ name: 'X', avatar: 'javascript:alert(1)', image: 'http://insecure/p.jpg' }), {
    author: { name: 'X' },
  });
  assert.equal(
    cleanMeta({ name: 'X', avatar: 'data:image/png;base64,AAA' }).author.avatar,
    'data:image/png;base64,AAA',
  );
});

test('a "To sort" label left from older versions is an ordinary label now', async () => {
  const A = 'urn:li:activity:7212345678901234567';
  const store = createStore(memoryArea());
  const { result: sort } = await store.createLabel('To sort');
  const { result: ideas } = await store.createLabel('Ideas');
  await store.savePost({ id: A, url: POST_A, excerpt: 'a', labelIds: [sort.id] });
  const { data } = await store.setPostLabels(A, [sort.id, ideas.id]);
  assert.deepEqual(data.posts[A].labelIds, [sort.id, ideas.id], 'both labels stay');
  const { data: after } = await store.removePost(A);
  assert.equal(after.labels[sort.id].name, 'To sort', 'the label stays when empty');
});

test('Highlights: 5 older posts a day, no repeats for 30 days, never brand-new saves', async () => {
  const DAY = 86400000;
  const now = new Date(2026, 9, 9, 9).getTime();
  const area = memoryArea();
  const store = createStore(area);
  const { result: l } = await store.createLabel('Ideas');
  const url = id => `https://www.linkedin.com/feed/update/${id}/`;
  const ids = Array.from({ length: 12 }, (_, i) => `urn:li:activity:73000000000000000${String(i + 10)}`);
  for (const id of ids) await store.savePost({ id, url: url(id), excerpt: id, labelIds: [l.id] });
  const fresh = 'urn:li:activity:7399999999999999999';
  await store.savePost({ id: fresh, url: url(fresh), excerpt: 'new', labelIds: [l.id] });
  // Everything was saved 40 days ago except one post saved today.
  for (const p of Object.values(area.mem[STORAGE_KEY].posts)) p.savedAt = p.id === fresh ? now : now - 40 * DAY;

  let data = await store.load();
  assert.equal(todayIsNew(data, now), true, 'a new day is waiting');
  ({ data } = await store.ensureToday(now));
  const first = todayPosts(data, now).map(p => p.id);
  assert.equal(first.length, 5);
  assert.ok(!first.includes(fresh), 'not a post saved today');
  // Same day: same picks. Seeing them clears the badge.
  ({ data } = await store.ensureToday(now + 3600000));
  assert.deepEqual(
    todayPosts(data, now).map(p => p.id),
    first,
  );
  ({ data } = await store.seenToday());
  assert.equal(todayIsNew(data, now), false);
  // "Show 5 more" adds different posts.
  let added;
  ({ data, result: added } = await store.moreToday(now));
  assert.equal(added, 5);
  const shown = todayPosts(data, now).map(p => p.id);
  assert.equal(new Set(shown).size, 10);
  // Next day: only the 2 never shown are left (30-day rule), no repeats.
  ({ data } = await store.ensureToday(now + DAY));
  const next = todayPosts(data, now + DAY).map(p => p.id);
  assert.equal(next.length, 2);
  assert.ok(next.every(id => !shown.includes(id)));
  assert.equal(dayKey(now), '2026-10-09');
});

test('backup round trip merges without duplicates', async () => {
  const a = createStore(memoryArea());
  const { result: l1 } = await a.createLabel('Design');
  await a.createLabel('Empty label');
  await a.savePost({ id: 'urn:li:activity:7212345678901234567', url: POST_A, excerpt: 'A', labelIds: [l1.id] });
  const { data: aData } = await a.savePost({
    id: 'urn:li:activity:7200000000000000001',
    url: POST_B,
    excerpt: 'B',
    labelIds: [l1.id],
  });
  const backup = JSON.parse(JSON.stringify(exportBackup(aData)));
  // A post with no labels in the file is skipped.
  backup.posts.push({ url: 'https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000001/', labels: [] });

  // Import into a store that already has an overlapping post and a case-variant label.
  const b = createStore(memoryArea());
  const { result: l2 } = await b.createLabel('design');
  const { result: l3 } = await b.createLabel('Other');
  await b.savePost({ id: 'urn:li:activity:7212345678901234567', url: POST_A, excerpt: 'A', labelIds: [l3.id] });

  const first = await b.importBackup(backup);
  assert.deepEqual(first.result, { labelsAdded: 1, postsAdded: 1, postsUpdated: 1, postsSkipped: 1 });
  const data = first.data;
  assert.equal(Object.keys(data.posts).length, 2);
  assert.equal(Object.keys(data.labels).length, 3);
  assert.deepEqual(data.posts['urn:li:activity:7212345678901234567'].labelIds.sort(), [l2.id, l3.id].sort());
  assert.equal(data.posts['urn:li:activity:7200000000000000001'].url, POST_B);

  // Importing the same file again changes nothing.
  const again = await b.importBackup(backup);
  assert.deepEqual(again.result, { labelsAdded: 0, postsAdded: 0, postsUpdated: 0, postsSkipped: 1 });
  assert.equal(Object.keys(again.data.posts).length, 2);
});

test('backup validation rejects bad files', () => {
  assert.throws(() => validateBackup(null), /isn.t a Labels backup/);
  assert.throws(() => validateBackup({ format: 'other' }), /isn.t a Labels backup/);
  const base = { format: 'labels-backup', version: 1, labels: [], posts: [] };
  assert.throws(() => validateBackup({ ...base, version: 9 }), /unsupported version/);
  assert.throws(() => validateBackup({ ...base, posts: [{ url: 'https://www.linkedin.com/feed/' }] }), /individual/);
  assert.throws(
    () => validateBackup({ ...base, posts: [{ url: POST_A, id: 'urn:li:activity:999' }] }),
    /doesn.t match/,
  );
  assert.throws(() => validateBackup({ ...base, posts: [{ url: POST_A, savedAt: 'yesterday' }] }), /invalid date/);
  assert.throws(() => validateBackup({ ...base, labels: [{ name: '' }] }), /invalid name/);
  const ok = validateBackup({
    ...base,
    posts: [{ url: `${POST_A}?utm_source=x`, labels: ['Notes', ' x '], savedAt: '2026-01-01T00:00:00Z' }],
  });
  assert.equal(ok.posts[0].url, POST_A);
  assert.deepEqual(ok.posts[0].labels, ['Notes', 'x']);
});

test('storage failures surface and do not wedge the queue', async () => {
  const area = memoryArea();
  let fail = true;
  const flaky = { get: area.get, set: async obj => (fail ? Promise.reject(new Error('quota')) : area.set(obj)) };
  const store = createStore(flaky);
  await assert.rejects(store.createLabel('One'), /quota/);
  fail = false;
  const { data } = await store.createLabel('One');
  assert.equal(Object.keys(data.labels).length, 1);
});

test('decodes LinkedIn feed thread keys into post URNs', async () => {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const context = vm.createContext({ atob, Date, BigInt, Uint8Array, Number });
  vm.runInContext(readFileSync(new URL('../lib/capture.js', import.meta.url), 'utf8'), context);
  const decode = token => vm.runInContext(`labelsDecodeThreadKey(${JSON.stringify(token)})`, context);
  assert.equal(decode('CgsIgMC7kNTUpL/QAQ'), 'urn:li:activity:7511803322715041792');
  assert.equal(decode('CgsIgMDOuI3rmLXQAQ'), 'urn:li:activity:7508962570318499840');
  assert.equal(decode('EgsIgMC1vLGRp+/OAQ'), 'urn:li:ugcPost:7453261968926224384');
  assert.equal(decode('not-a-token'), null);
  assert.equal(decode('CgIIAg'), null, 'implausible IDs are rejected');
});

test('restorePost puts a deleted post back exactly, dropping labels that no longer exist', async () => {
  const store = createStore(memoryArea());
  const { result: a } = await store.createLabel('A');
  const { result: b } = await store.createLabel('B');
  const { data: before } = await store.savePost({
    id: 'urn:li:activity:1',
    url: POST_A,
    excerpt: 'hello',
    labelIds: [a.id, b.id],
  });
  const record = structuredClone(before.posts['urn:li:activity:1']);
  await store.removePost('urn:li:activity:1');
  await store.deleteLabel(b.id);
  const { data } = await store.restorePost(record);
  const post = data.posts['urn:li:activity:1'];
  assert.deepEqual(post.labelIds, [a.id]);
  assert.equal(post.excerpt, 'hello');
  assert.equal(post.savedAt, record.savedAt);
  await assert.rejects(store.restorePost({ id: 'nope', url: POST_A }), /couldn.t be restored/);
});
