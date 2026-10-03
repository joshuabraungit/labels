// Run with: node --test tests/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl, makeExcerpt } from '../lib/post.js';
import {
  createStore,
  exportBackup,
  labelsWithCounts,
  postsForLabel,
  UNCATEGORIZED_ID,
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

test('labels: create, duplicates, reserved name, rename, delete', async () => {
  const store = createStore(memoryArea());
  const { result: ai } = await store.createLabel('  AI   tools ');
  assert.equal(ai.name, 'AI tools');
  await assert.rejects(store.createLabel('ai TOOLS'), /already have/);
  await assert.rejects(store.createLabel(' uncategorized '), /reserved/);
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
      ['Uncategorized', 0],
      ['Zebra', 2],
    ],
  );

  ({ data } = await store.deleteLabel(ai.id));
  assert.equal(Object.keys(data.posts).length, 2, 'posts are kept');
  assert.deepEqual(data.posts['urn:li:activity:1'].labelIds, [hiring.id]);
  assert.deepEqual(
    postsForLabel(data, UNCATEGORIZED_ID).map(p => p.id),
    ['urn:li:activity:2'],
  );
  await assert.rejects(store.deleteLabel(UNCATEGORIZED_ID), /can.t be deleted/);
  await assert.rejects(store.renameLabel(UNCATEGORIZED_ID, 'x'), /can.t be renamed/);
});

test('saving twice updates the same record', async () => {
  const store = createStore(memoryArea());
  const { result: l } = await store.createLabel('Ideas');
  const first = await store.savePost({ id: 'urn:li:activity:1', url: POST_A, excerpt: 'hi', labelIds: [] });
  assert.equal(first.result.created, true);
  assert.deepEqual(postsForLabel(first.data, UNCATEGORIZED_ID).length, 1);
  const second = await store.savePost({ id: 'urn:li:activity:1', url: POST_A, excerpt: '', labelIds: [l.id] });
  assert.equal(second.result.created, false);
  assert.equal(Object.keys(second.data.posts).length, 1);
  assert.equal(second.data.posts['urn:li:activity:1'].excerpt, 'hi', 'empty capture keeps old excerpt');
  assert.equal(second.data.posts['urn:li:activity:1'].savedAt, first.data.posts['urn:li:activity:1'].savedAt);
  assert.equal(postsForLabel(second.data, UNCATEGORIZED_ID).length, 0);
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
  await store.savePost({ id: 'urn:li:activity:1', url: POST_A, excerpt: 'old', labelIds: [] });
  await new Promise(r => setTimeout(r, 5));
  const { data } = await store.savePost({ id: 'urn:li:activity:2', url: POST_A, excerpt: 'new', labelIds: [] });
  assert.deepEqual(
    postsForLabel(data, UNCATEGORIZED_ID).map(p => p.excerpt),
    ['new', 'old'],
  );
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
    labelIds: [],
  });
  const backup = JSON.parse(JSON.stringify(exportBackup(aData)));

  // Import into a store that already has an overlapping post and a case-variant label.
  const b = createStore(memoryArea());
  const { result: l2 } = await b.createLabel('design');
  const { result: l3 } = await b.createLabel('Other');
  await b.savePost({ id: 'urn:li:activity:7212345678901234567', url: POST_A, excerpt: 'A', labelIds: [l3.id] });

  const first = await b.importBackup(backup);
  assert.deepEqual(first.result, { labelsAdded: 1, postsAdded: 1, postsUpdated: 1 });
  const data = first.data;
  assert.equal(Object.keys(data.posts).length, 2);
  assert.equal(Object.keys(data.labels).length, 3);
  assert.deepEqual(data.posts['urn:li:activity:7212345678901234567'].labelIds.sort(), [l2.id, l3.id].sort());
  assert.equal(data.posts['urn:li:activity:7200000000000000001'].url, POST_B);

  // Importing the same file again changes nothing.
  const again = await b.importBackup(backup);
  assert.deepEqual(again.result, { labelsAdded: 0, postsAdded: 0, postsUpdated: 0 });
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
    posts: [{ url: `${POST_A}?utm_source=x`, labels: ['Uncategorized', ' x '], savedAt: '2026-01-01T00:00:00Z' }],
  });
  assert.equal(ok.posts[0].url, POST_A);
  assert.deepEqual(ok.posts[0].labels, ['x']);
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
