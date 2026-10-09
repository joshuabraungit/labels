// End-to-end check in real Chromium with the extension loaded.
// Usage: node tests/e2e.mjs   (needs Playwright; set PLAYWRIGHT_PATH if it isn't resolvable)
//
// LinkedIn itself can't be used in automation (login, changing markup), so LinkedIn URLs are
// served from local fixtures. Two test-only tweaks are applied to a temporary copy of the
// extension, never to the shipped files:
//   - host access to www.linkedin.com, so tab URLs are visible to the shim below;
//   - a shim that can point chrome.tabs.query at a chosen fixture tab, used to send the
//     keyboard-shortcut message to a LinkedIn tab from an extension page.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'tests', 'fixtures');
const work = mkdtempSync(join(process.env.E2E_TMP || tmpdir(), 'labels-e2e-'));
const extDir = join(work, 'ext');
const profile = join(work, 'profile');
const shots = process.env.SCREENSHOT_DIR;

cpSync(root, extDir, {
  recursive: true,
  filter: src => !src.includes(`${join(root, 'tests')}`) && !src.includes('release'),
});
const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['https://www.linkedin.com/*'];
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest));
writeFileSync(
  join(extDir, 'test-shim.js'),
  `const target = new URLSearchParams(location.search).get('target');
if (target) {
  const query = (globalThis.realTabsQuery = chrome.tabs.query.bind(chrome.tabs));
  chrome.tabs.query = async () => (await query({})).filter(t => (t.url || '').split(/[?#]/)[0] === target).slice(0, 1);
}`,
);
for (const file of ['library.html']) {
  const html = readFileSync(join(extDir, file), 'utf8');
  writeFileSync(
    join(extDir, file),
    html.replace('<script type="module"', '<script src="test-shim.js"></script><script type="module"'),
  );
}

const POST_A = 'https://www.linkedin.com/feed/update/urn:li:activity:7212345678901234567/';
const POST_B = 'https://www.linkedin.com/posts/jane-doe_launch-activity-7200000000000000001-AbCd/';
const FEED = 'https://www.linkedin.com/feed/';
const FEED2 = 'https://www.linkedin.com/feed/following/';
const FEED3 = 'https://www.linkedin.com/feed/hashtag/sdui/';
const SAVED = 'https://www.linkedin.com/my-items/saved-posts/';
const POST_C = 'https://www.linkedin.com/feed/update/urn:li:activity:7333333333333333333/';
const POST_D = 'https://www.linkedin.com/feed/update/urn:li:activity:7444444444444444444/';
const POST_E = 'https://www.linkedin.com/feed/update/urn:li:activity:7555555555555555555/';
// POST_E starts out without readable text, then "loads" it, to test preview backfill.
const SCRATCH = 'https://www.linkedin.com/in/scratch/'; // a tab for the Library to open posts in
const ID_A = 'urn:li:activity:7212345678901234567';
const ID_B = 'urn:li:activity:7200000000000000001';
let postEHasText = false;

async function launch() {
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium',
    viewport: { width: 360, height: 600 },
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--headless=new'],
  });
  await context.route('https://www.linkedin.com/**', route => {
    const url = route.request().url();
    const read = file => readFileSync(join(fixtures, file), 'utf8');
    let body;
    if (url.includes('activity:7212345678901234567')) body = read('post-page.html');
    else if (url.includes('activity-7200000000000000001')) body = read('post-no-text.html');
    else if (url.includes('activity:7333333333333333333')) body = read('post-new-markup.html');
    else if (url.includes('activity:7444444444444444444')) body = read('post-title-only.html');
    else if (url.includes('activity:7555555555555555555')) {
      body = postEHasText
        ? read('post-new-markup.html').replaceAll('7333333333333333333', '7555555555555555555')
        : read('post-no-text.html').replaceAll('7200000000000000001', '7555555555555555555');
    } else if (url.startsWith(FEED2)) body = read('feed-new-markup.html');
    else if (url.startsWith(FEED3)) body = read('feed-sdui.html');
    else if (url.startsWith(SAVED)) body = read('saved-posts.html');
    else body = read('feed.html');
    return route.fulfill({ contentType: 'text/html', body });
  });
  // LinkedIn's image server: a tiny picture for every avatar and post image.
  await context.route('https://media.licdn.com/**', route =>
    route.fulfill({
      contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'),
    }),
  );
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  return { context, extId };
}

let step = 0;
async function check(name, fn) {
  step++;
  await fn();
  console.log(`ok ${step} - ${name}`);
}

// Opens the Library page. `target` points the test shim's chrome.tabs.query at that tab.
async function openLibrary(context, extId, target) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1200, height: 900 });
  const qs = new URLSearchParams();
  if (target) qs.set('target', target);
  await page.goto(`chrome-extension://${extId}/library.html?${qs}`);
  await page.locator('body[data-ready]').waitFor();
  return page;
}

// Sidebar label rows as "name:count".
const labelsRows = page =>
  page
    .locator('.label-row .nav-item')
    .evaluateAll(rows =>
      rows.map(r => `${r.querySelector('.name').textContent}:${r.querySelector('.count').textContent}`),
    );

const navTo = (page, name) =>
  page
    .locator('.nav-item', { has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
    .first()
    .click();

const card = (page, id) => page.locator(`.card[data-post="${id}"]`);

async function createLabel(page, name) {
  await page.getByRole('button', { name: 'Add a label' }).click();
  await page.getByLabel('New label name').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

async function labelMenu(page, name, item) {
  await page.getByRole('button', { name: `Options for ${name}` }).click({ force: true });
  await page.getByRole('menuitem', { name: item }).click();
}

const feedButton = (page, id) => page.locator(`[data-labels-post="${id}"] button`);
const panel = page => page.locator('[data-labels-ui="panel"] .panel');

// Opens the picker for a post on a page and waits for its labels to load.
async function openPicker(page, id) {
  await feedButton(page, id).click();
  await panel(page).getByLabel('Find or create a label').waitFor();
  return panel(page);
}

// Returns the URL a click opens in a new tab (read through the tabs API, since tabs the
// extension opens aren't covered by Playwright's network mocks).
async function openedUrl(popup, click) {
  const before = await popup.evaluate(async () =>
    (await (globalThis.realTabsQuery ?? chrome.tabs.query)({})).map(t => t.id),
  );
  await click();
  return popup.evaluate(async before => {
    for (let i = 0; i < 50; i++) {
      const tab = (await (globalThis.realTabsQuery ?? chrome.tabs.query)({})).find(t => !before.includes(t.id));
      if (tab && (tab.pendingUrl || tab.url)) {
        await chrome.tabs.remove(tab.id);
        return tab.pendingUrl || tab.url;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }, before);
}

async function shot(page, name) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
}

async function storedData(page) {
  return page.evaluate(async () => (await chrome.storage.local.get('labels.data.v1'))['labels.data.v1']);
}

let { context, extId } = await launch();
try {
  const postTab = await context.newPage();
  await postTab.goto(`${POST_A}?utm_source=share&utm_medium=member_desktop`);
  const noTextTab = await context.newPage();
  await noTextTab.goto(`${POST_B}?rcm=tracking`);

  await check('Library: empty to start, with a tip on how to save', async () => {
    const p = await openLibrary(context, extId);
    await p.getByText('Nothing saved yet.', { exact: false }).waitFor();
    assert.equal(await p.locator('.nav-item.all .count').textContent(), '0');
    assert.match(await p.locator('.tip').textContent(), /^Save posts with the Label button under any post on LinkedIn/);
    await shot(p, '1-library-empty');
    await p.close();
  });

  await check('post page: the Label button reads only that post', async () => {
    const picker = await openPicker(postTab, ID_A);
    await postTab.waitForFunction(
      () =>
        document.querySelector('[data-labels-ui="panel"]')?.shadowRoot.querySelector('.panel')?.dataset.excerpt
          ?.length > 0,
    );
    const preview = await picker.getAttribute('data-excerpt');
    assert.ok(preview.startsWith('Design systems are not a project. They are a product with customers'), preview);
    for (const bad of ['COMMENT', 'OTHER POST', 'Jane Author', 'hashtag', '\n']) {
      assert.ok(!preview.includes(bad), `preview contains ${bad}`);
    }
  });

  let designId;
  await check('new labels are auto-selected; multiple labels save; author is saved', async () => {
    const picker = panel(postTab);
    const query = picker.getByLabel('Find or create a label');
    await query.fill('Design');
    await query.press('Enter');
    await query.fill('ai');
    await query.press('Enter');
    await picker.locator('li', { hasText: 'ai' }).locator('input:checked').waitFor();
    assert.equal(await picker.locator('li input:checked').count(), 2);
    await shot(postTab, '2-picker');
    await picker.getByRole('button', { name: 'Save', exact: true }).click();
    await picker.getByRole('button', { name: 'Saved ✓' }).waitFor();
    const p = await openLibrary(context, extId);
    const data = await storedData(p);
    const post = data.posts[ID_A];
    assert.equal(post.url, POST_A, 'tracking params stripped');
    assert.equal(post.labelIds.length, 2);
    assert.ok(post.text.startsWith('Design systems are not a project.'), 'full text saved');
    assert.deepEqual(post.author, { name: 'Jane Author', headline: 'Head of Design at Example' });
    designId = Object.values(data.labels).find(l => l.name === 'Design').id;
    // Label names are unique, ignoring case.
    await createLabel(p, ' design ');
    assert.match(await p.locator('.error').textContent(), /already have a label called "Design"/);
    await p.close();
    await postTab.keyboard.press('Escape');
  });

  await check('saving again updates the same record', async () => {
    const picker = await openPicker(postTab, ID_A);
    // Already saved and unchanged: the button says so and can't be clicked.
    assert.equal(await picker.getByRole('button', { name: 'Saved ✓' }).isDisabled(), true);
    assert.equal(await picker.locator('li input:checked').count(), 2, 'existing labels shown');
    await picker.locator('li', { hasText: 'ai' }).locator('input').uncheck();
    await picker.getByRole('button', { name: 'Update' }).click();
    await picker.getByRole('button', { name: 'Saved ✓' }).waitFor();
    // Changing it back to what's saved also shows Saved, no Update needed.
    await picker.locator('li', { hasText: 'ai' }).locator('input').check();
    assert.equal(await picker.getByRole('button', { name: 'Update' }).count(), 1);
    await picker.locator('li', { hasText: 'ai' }).locator('input').uncheck();
    assert.equal(await picker.getByRole('button', { name: 'Saved ✓' }).isDisabled(), true);
    await postTab.keyboard.press('Escape');
    const p = await openLibrary(context, extId);
    const data = await storedData(p);
    assert.equal(Object.keys(data.posts).length, 1);
    assert.deepEqual(data.posts[ID_A].labelIds, [designId]);
    await p.close();
  });

  await check('saving needs a label; a post without readable text still saves', async () => {
    const picker = await openPicker(noTextTab, ID_B);
    assert.equal(await picker.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    await picker.getByText('Pick or create a label to save.').waitFor();
    await picker.locator('li', { hasText: 'ai' }).locator('input').check();
    await picker.getByRole('button', { name: 'Save', exact: true }).click();
    await picker.getByRole('button', { name: 'Saved ✓' }).waitFor();
    const p = await openLibrary(context, extId);
    assert.deepEqual(await labelsRows(p), ['ai:1', 'Design:1']);
    await navTo(p, 'ai');
    await card(p, ID_B).locator('.text.fallback').waitFor();
    assert.equal(await card(p, ID_B).locator('.who .name').textContent(), 'LinkedIn post', 'no author found');
    await p.close();
  });

  await check('errors keep label selections for retry', async () => {
    const picker = panel(noTextTab);
    await picker.locator('li', { hasText: 'Design' }).locator('input').check();
    const [sw] = context.serviceWorkers();
    await sw.evaluate(() => {
      const area = chrome.storage.local;
      const set = area.set.bind(area);
      let failures = 1;
      area.set = (...args) => (failures-- > 0 ? Promise.reject(new Error('simulated disk error')) : set(...args));
    });
    await picker.getByRole('button', { name: 'Update' }).click();
    await picker.locator('.error').waitFor();
    assert.equal(await picker.locator('li input:checked').count(), 2, 'selection kept after error');
    await picker.getByRole('button', { name: 'Update' }).click();
    await picker.getByRole('button', { name: 'Saved ✓' }).waitFor();
    // Back to just "ai" for the next steps.
    await picker.locator('li', { hasText: 'Design' }).locator('input').uncheck();
    await picker.getByRole('button', { name: 'Update' }).click();
    await picker.getByRole('button', { name: 'Saved ✓' }).waitFor();
    await noTextTab.keyboard.press('Escape');
  });

  await check('Library: cards show the author; Open opens the post on LinkedIn', async () => {
    const p = await openLibrary(context, extId);
    assert.equal(await p.locator('.total').textContent(), '2 posts');
    const a = card(p, ID_A);
    assert.equal(await a.locator('.who .name').textContent(), 'Jane Author');
    assert.equal(await a.locator('.who .headline').textContent(), 'Head of Design at Example');
    assert.match(await a.locator('.who .when').textContent(), /^Saved (just now|\d+m ago)$/);
    assert.deepEqual(await a.locator('.chip').allTextContents(), ['Design']);
    await shot(p, '3-library');
    assert.equal(await openedUrl(p, () => a.getByRole('button', { name: 'Open' }).click()), POST_A);
    // Clicking a label (sidebar or chip) filters the list.
    await a.locator('.chip', { hasText: 'Design' }).click();
    assert.equal(await p.locator('.total').textContent(), '1 post');
    assert.equal(await p.locator('.nav-item.active .name').textContent(), 'Design');
    await p.close();
  });

  await check('rename a label from its menu', async () => {
    const p = await openLibrary(context, extId);
    await labelMenu(p, 'Design', 'Rename');
    await p.getByLabel('Label name').fill('AI');
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    assert.match(await p.locator('.error').textContent(), /already have a label called "ai"/);
    await p.getByLabel('Label name').fill('Zeta design');
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    assert.deepEqual(await labelsRows(p), ['ai:1', 'Zeta design:1']);
    assert.deepEqual(await card(p, ID_A).locator('.chip').allTextContents(), ['Zeta design']);
    await p.close();
  });

  await check('edit labels on a card; deleting a label warns and removes posts with no other label', async () => {
    const p = await openLibrary(context, extId);
    await card(p, ID_A).getByRole('button', { name: 'Edit labels' }).click();
    const pop = card(p, ID_A).locator('.popover');
    await pop.locator('.check', { hasText: 'ai' }).locator('input').check();
    assert.deepEqual(await labelsRows(p), ['ai:2', 'Zeta design:1']);
    await p.keyboard.press('Escape');
    await pop.waitFor({ state: 'detached' });

    await labelMenu(p, 'ai', 'Delete');
    assert.deepEqual(await p.locator('.dialog p').allTextContents(), [
      'Deleting the ai label will remove it from 2 posts and cannot be undone.',
      '1 post has no other label and will be deleted too.',
      'Do you want to permanently delete it?',
    ]);
    await shot(p, '4-delete-dialog');
    await p.getByRole('button', { name: 'Permanently delete it' }).click();
    assert.deepEqual(await labelsRows(p), ['Zeta design:1']);
    assert.deepEqual(Object.keys((await storedData(p)).posts), [ID_A]);

    // A label with no posts: plain warning.
    await createLabel(p, 'Spare');
    await labelMenu(p, 'Spare', 'Delete');
    assert.deepEqual(await p.locator('.dialog p').allTextContents(), [
      'Deleting the Spare label cannot be undone.',
      'Do you want to permanently delete it?',
    ]);
    await p.getByRole('button', { name: 'Never mind' }).click();
    assert.deepEqual(await labelsRows(p), ['Spare:0', 'Zeta design:1']);
    await labelMenu(p, 'Spare', 'Delete');
    await p.getByRole('button', { name: 'Permanently delete it' }).click();

    // Deleting the last label removes its post.
    await labelMenu(p, 'Zeta design', 'Delete');
    await p.getByRole('button', { name: 'Permanently delete it' }).click();
    assert.deepEqual(await labelsRows(p), []);
    assert.equal(Object.keys((await storedData(p)).posts).length, 0);
    await p.close();
  });

  await check('labels new posts again for the next steps', async () => {
    let picker = await openPicker(noTextTab, ID_B);
    const query = picker.getByLabel('Find or create a label');
    await query.fill('Launches');
    await query.press('Enter');
    await picker.getByRole('button', { name: 'Save', exact: true }).click();
    await picker.getByRole('button', { name: 'Saved ✓' }).waitFor();
    await noTextTab.keyboard.press('Escape');
    picker = await openPicker(postTab, ID_A);
    await picker.locator('li', { hasText: 'Launches' }).locator('input').check();
    await picker.getByRole('button', { name: 'Save', exact: true }).click();
    await picker.getByRole('button', { name: 'Saved ✓' }).waitFor();
    await postTab.keyboard.press('Escape');
    const p = await openLibrary(context, extId);
    assert.deepEqual(await labelsRows(p), ['Launches:2']);
    await p.close();
  });

  await check('People: filter by who wrote the post', async () => {
    const p = await openLibrary(context, extId);
    assert.deepEqual(await p.locator('.section-head').allTextContents(), ['Labels+', 'People']);
    await navTo(p, 'Jane Author');
    assert.equal(await p.locator('.total').textContent(), '1 post');
    assert.equal(await p.locator('.card').getAttribute('data-post'), ID_A);
    await navTo(p, 'All Posts');
    assert.equal(await p.locator('.total').textContent(), '2 posts');
    await p.close();
  });

  await check('search finds posts by text, author and label', async () => {
    const p = await openLibrary(context, extId);
    const search = p.getByRole('searchbox', { name: 'Search posts' });
    await search.fill('design systems');
    assert.equal(await p.locator('.total').textContent(), '1 post');
    await search.fill('jane');
    assert.equal(await p.locator('.card').getAttribute('data-post'), ID_A);
    await search.fill('launches');
    assert.equal(await p.locator('.total').textContent(), '2 posts');
    await search.fill('zzzz nothing');
    await p.getByText('No saved posts match “zzzz nothing”.').waitFor();
    await search.press('Escape');
    assert.equal(await p.locator('.total').textContent(), '2 posts');
    await p.close();
  });

  await check('search highlights matches, and opens a card when the match is below the fold', async () => {
    const p = await openLibrary(context, extId);
    const before = await storedData(p);
    const id = 'urn:li:activity:7620000000000000001';
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1} about outbound.`);
    lines[8] = 'Line 9: the best Subject line is short.';
    const data = {
      version: 1,
      labels: { l1: { id: 'l1', name: 'Cold email', createdAt: 1 } },
      posts: {
        [id]: {
          id,
          url: `https://www.linkedin.com/feed/update/${id}/`,
          excerpt: lines[0],
          text: lines.join('\n'),
          labelIds: ['l1'],
          savedAt: Date.now(),
          updatedAt: Date.now(),
          author: { name: 'Sam Subjectson', headline: 'Writes about email' },
        },
      },
    };
    await p.evaluate(d => chrome.storage.local.set({ 'labels.data.v1': d }), data);
    const c = card(p, id);
    await c.waitFor();
    const search = p.getByRole('searchbox', { name: 'Search posts' });
    assert.equal(await c.locator('.text.clamped').count(), 1, 'collapsed before searching');
    await search.fill('subject');
    assert.deepEqual(await c.locator('mark').allTextContents(), ['Subject', 'Subject'], 'name and text');
    assert.equal(await c.locator('.text.clamped').count(), 0, 'opened to show the match');
    await c.getByRole('button', { name: 'Collapse' }).click();
    assert.equal(await c.locator('.text.clamped').count(), 1, 'Collapse still works');
    await search.fill('cold');
    assert.equal(await c.locator('.chip mark').textContent(), 'Cold', 'label chips too');
    await search.fill('line 1 about');
    assert.equal(await c.locator('.text.clamped').count(), 1, 'stays collapsed when the match is visible');
    await search.press('Escape');
    assert.equal(await c.locator('mark').count(), 0);
    await p.evaluate(d => chrome.storage.local.set({ 'labels.data.v1': d }), before);
    await p.close();
  });

  await check('long posts expand and collapse', async () => {
    const p = await openLibrary(context, extId);
    const text = (await storedData(p)).posts[ID_A].text;
    const long = text.length > 200 || text.split('\n').length > 4;
    const a = card(p, ID_A);
    assert.equal(await a.getByRole('button', { name: 'Expand' }).count(), long ? 1 : 0);
    if (long) {
      assert.equal(await a.locator('.text.clamped').count(), 1);
      await a.getByRole('button', { name: 'Expand' }).click();
      assert.equal(await a.locator('.text.clamped').count(), 0);
      await a.getByRole('button', { name: 'Collapse' }).click();
      assert.equal(await a.locator('.text.clamped').count(), 1);
    }
    await p.close();
  });

  await check('edit labels on a card: create a label; the last label stays', async () => {
    const p = await openLibrary(context, extId);
    const b = card(p, ID_B);
    await b.getByRole('button', { name: 'Edit labels' }).click();
    const pop = b.locator('.popover');
    // A post's only label can't be unticked (delete the post instead).
    assert.equal(await pop.locator('.check', { hasText: 'Launches' }).locator('input').isDisabled(), true);
    await pop.getByLabel('Find or create a label').fill('Fresh');
    await pop.getByLabel('Find or create a label').press('Enter');
    await pop.locator('.check', { hasText: 'Fresh' }).locator('input:checked').waitFor();
    assert.deepEqual(await b.locator('.chip').allTextContents(), ['Fresh', 'Launches']);
    await pop.locator('.check', { hasText: 'Fresh' }).locator('input').uncheck();
    assert.deepEqual(await b.locator('.chip').allTextContents(), ['Launches']);
    await p.keyboard.press('Escape');
    await p.close();
  });

  let backupPath;
  await check('export backup', async () => {
    const p = await openLibrary(context, extId);
    const [download] = await Promise.all([
      p.waitForEvent('download'),
      p.getByRole('button', { name: 'Export' }).click(),
    ]);
    backupPath = join(work, 'backup.json');
    await download.saveAs(backupPath);
    const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
    assert.equal(backup.format, 'labels-backup');
    assert.equal(backup.posts.length, 2);
    assert.deepEqual(
      backup.labels.map(l => l.name),
      ['Fresh', 'Launches'],
    );
    assert.equal(backup.posts.find(x => x.id === ID_A).author.name, 'Jane Author');
    await p.close();
  });

  await check('data persists after restarting Chrome', async () => {
    await context.close();
    ({ context, extId } = await launch());
    const p = await openLibrary(context, extId);
    assert.deepEqual(await labelsRows(p), ['Fresh:0', 'Launches:2']);
    await p.close();
  });

  await check('import validates and merges without duplicates', async () => {
    const p = await openLibrary(context, extId);
    const badPath = join(work, 'bad.json');
    writeFileSync(
      badPath,
      '{"format":"labels-backup","version":1,"labels":[],"posts":[{"url":"https://www.linkedin.com/feed/"}]}',
    );
    await p.setInputFiles('#import-file', badPath);
    await p.locator('.toast', { hasText: 'individual LinkedIn post' }).waitFor();

    // Same data again: nothing duplicated.
    await p.setInputFiles('#import-file', backupPath);
    await p.locator('.toast', { hasText: 'Imported 0 new posts, updated 0 posts, added 0 labels.' }).waitFor();
    assert.equal(Object.keys((await storedData(p)).posts).length, 2);

    // Wipe, then restore from the backup.
    await p.evaluate(() => chrome.storage.local.clear());
    await p.setInputFiles('#import-file', backupPath);
    await p.locator('.toast', { hasText: 'Imported 2 new posts, updated 0 posts, added 2 labels.' }).waitFor();
    const data = await storedData(p);
    assert.equal(Object.keys(data.posts).length, 2);
    assert.equal(data.posts[ID_A].url, POST_A);
    assert.equal(data.posts[ID_A].author.name, 'Jane Author');
    assert.ok(data.posts[ID_A].excerpt.startsWith('Design systems'));
    await p.close();
  });

  await check('delete a post from its card, no warning', async () => {
    const p = await openLibrary(context, extId);
    await card(p, ID_A).getByRole('button', { name: 'Delete post' }).click();
    await p.locator('.toast', { hasText: 'Post deleted' }).waitFor();
    await card(p, ID_A).waitFor({ state: 'detached' });
    assert.equal(await p.locator('.total').textContent(), '1 post');
    assert.deepEqual(await labelsRows(p), ['Fresh:0', 'Launches:1'], 'labels are kept');
    await p.close();
  });

  await check('unticking every label on a saved post offers Remove from Labels', async () => {
    const list = await openLibrary(context, extId);
    const remaining = Object.values((await storedData(list)).posts);
    await list.close();
    assert.equal(remaining.length, 1);
    const tab = await context.newPage();
    // The test server serves each fixture at the post's original link.
    await tab.goto(remaining[0].id === ID_B ? POST_B : POST_A);
    const picker = await openPicker(tab, remaining[0].id);
    await picker.locator('li', { hasText: 'Launches' }).locator('input').uncheck();
    assert.equal(await picker.getByRole('button', { name: 'Update' }).count(), 0);
    await picker.getByRole('button', { name: 'Remove from Labels' }).click();
    await picker.getByText('Removed from Labels').first().waitFor();
    assert.equal(await picker.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    const p = await openLibrary(context, extId);
    assert.equal(Object.keys((await storedData(p)).posts).length, 0);
    assert.deepEqual(await labelsRows(p), ['Fresh:0', 'Launches:0']);
    await p.close();
    await tab.close();
  });

  await check('layout without known class names: text, author, photo and image', async () => {
    const ID_C = 'urn:li:activity:7333333333333333333';
    const tab = await context.newPage();
    await tab.goto(POST_C);
    const picker = await openPicker(tab, ID_C);
    const preview = await picker.getAttribute('data-excerpt');
    assert.ok(
      preview.startsWith('Contrary to seemingly every single person in tech / SaaS, I hate Wispr Flow.'),
      preview,
    );
    for (const bad of ['Finn', 'Founder', 'Follow', 'COMMENT', 'Struggling', 'reactions', '10h']) {
      assert.ok(!preview.includes(bad), `preview contains ${bad}: ${preview}`);
    }
    await picker.locator('li', { hasText: 'Launches' }).locator('input').check();
    await picker.getByRole('button', { name: 'Save', exact: true }).click();
    await picker.getByRole('button', { name: 'Saved ✓' }).waitFor();
    const p = await openLibrary(context, extId);
    const post = (await storedData(p)).posts[ID_C];
    assert.equal(post.author.name, 'Finn Example');
    assert.ok(post.author.headline.startsWith('Founder Brand & LinkedIn Advisory'));
    assert.equal(post.author.avatar, 'https://media.licdn.com/dms/image/test-avatar.jpg');
    assert.equal(post.image, 'https://media.licdn.com/dms/image/test-post.jpg');
    const c = card(p, ID_C);
    await c.locator('img.avatar').waitFor();
    assert.equal(await c.locator('img.post-image').getAttribute('src'), post.image);
    await shot(p, '5-library-card');
    await p.close();
    await tab.close();
  });

  await check('a post saved without text fills in when you open its picker again', async () => {
    const ID_E = 'urn:li:activity:7555555555555555555';
    const tab = await context.newPage();
    await tab.goto(POST_E);
    let picker = await openPicker(tab, ID_E);
    await picker.locator('li', { hasText: 'Launches' }).locator('input').check();
    await picker.getByRole('button', { name: 'Save', exact: true }).click();
    await picker.getByRole('button', { name: 'Saved ✓' }).waitFor();
    const p = await openLibrary(context, extId);
    await card(p, ID_E).locator('.text.fallback').waitFor();

    // The text loads later; just opening the post's picker saves it, no changes needed.
    postEHasText = true;
    await tab.reload();
    picker = await openPicker(tab, ID_E);
    await card(p, ID_E).locator('.text', { hasText: 'Contrary to seemingly' }).waitFor();
    assert.equal((await storedData(p)).posts[ID_E].author.name, 'Finn Example', 'author filled in too');
    await p.close();
    await tab.close();
  });

  // ---------- Label buttons in the feed ----------

  const ID1 = 'urn:li:activity:7600000000000000001';
  const ID2 = 'urn:li:activity:7600000000000000002';
  const ID3 = 'urn:li:activity:7600000000000000003';

  let feed;
  await check('feed: Label buttons only on posts with a post ID, one per post', async () => {
    feed = await context.newPage();
    await feed.setViewportSize({ width: 1100, height: 900 });
    await feed.goto(FEED2);
    await feedButton(feed, ID3).waitFor();
    const ids = await feed.locator('[data-labels-ui="button"]').evaluateAll(els => els.map(e => e.dataset.labelsPost));
    assert.deepEqual(ids.sort(), [ID1, ID2, ID3]);
    // Placed right after the reactions bar of its own post.
    assert.equal(
      await feed
        .locator('[data-labels-post]')
        .first()
        .evaluate(el => el.previousElementSibling?.className),
      'bar',
    );
    assert.equal(await feedButton(feed, ID1).textContent(), 'Label');
    await shot(feed, '10-feed-buttons');
  });

  await check('feed: picker captures the right post, creates labels, saves', async () => {
    await feedButton(feed, ID1).click();
    await panel(feed).waitFor();
    const preview = await panel(feed).getAttribute('data-excerpt');
    assert.equal(preview, 'Feed post one: the best sales emails are short, specific, and about the buyer, not you.');
    assert.ok(!(await panel(feed).textContent()).includes('null'), 'no stray "null" in the picker');
    // No label called that yet: the filter box offers to create it, and Enter does.
    const query = panel(feed).getByLabel('Find or create a label');
    await query.fill('Feed picks');
    assert.equal(await panel(feed).locator('li.create.active').textContent(), '+Create \u201CFeed picks\u201D');
    await query.press('Enter');
    await panel(feed).locator('label', { hasText: 'Feed picks' }).waitFor();
    assert.equal(await panel(feed).locator('label', { hasText: 'Feed picks' }).locator('input').isChecked(), true);
    await shot(feed, '11-feed-picker');
    await panel(feed).getByRole('button', { name: 'Save', exact: true }).click();
    await panel(feed).getByText('Saved \u2713').waitFor();
    await feedButton(feed, ID1).getByText('Feed picks', { exact: true }).waitFor();
    assert.equal(await feedButton(feed, ID1).getAttribute('title'), 'Labeled: Feed picks', 'button names its labels');
    const p = await openLibrary(context, extId, FEED);
    const stored = await storedData(p);
    const post = stored.posts[ID1];
    assert.equal(post.url, `https://www.linkedin.com/feed/update/${ID1}/`);
    assert.equal(
      post.excerpt,
      'Feed post one: the best sales emails are short, specific, and about the buyer, not you.',
    );
    assert.deepEqual(
      post.labelIds.map(id => stored.labels[id].name),
      ['Feed picks'],
    );
    assert.ok(post.text.startsWith('Feed post one: the best sales emails'), 'full text is stored');
    await p.close();
  });

  await check('feed: Escape and outside clicks close the picker; reopening shows it is saved', async () => {
    await feed.keyboard.press('Escape');
    await panel(feed).waitFor({ state: 'detached' });
    await feedButton(feed, ID1).click();
    await panel(feed).getByRole('button', { name: 'Saved \u2713' }).waitFor();
    assert.equal(await panel(feed).getByRole('button', { name: 'Saved \u2713' }).isDisabled(), true);
    assert.equal(await panel(feed).locator('label', { hasText: 'Feed picks' }).locator('input').isChecked(), true);
    // Unticking its only label offers to remove it; undoing the change goes back to Saved.
    await panel(feed).locator('label', { hasText: 'Feed picks' }).locator('input').uncheck();
    await panel(feed).getByRole('button', { name: 'Remove from Labels' }).waitFor();
    await panel(feed).locator('label', { hasText: 'Feed picks' }).locator('input').check();
    await panel(feed).getByRole('button', { name: 'Saved \u2713' }).waitFor();
    await feed.mouse.click(5, 880);
    await panel(feed).waitFor({ state: 'detached' });
  });

  await check('feed: the picker is for labeling only, with a link to the Library', async () => {
    await feedButton(feed, ID1).click();
    await panel(feed).getByLabel('Find or create a label').waitFor();
    assert.equal(await panel(feed).locator('.count, .del, .pinned-row').count(), 0, 'no counts, trash or Pinned');
    const [page] = await Promise.all([
      context.waitForEvent('page'),
      panel(feed).getByRole('button', { name: 'Library' }).click(),
    ]);
    assert.match(page.url(), /library\.html$/);
    await page.close();
    await feed.keyboard.press('Escape');
    await panel(feed).waitFor({ state: 'detached' });
  });

  await check('feed: rename and delete a label from the picker', async () => {
    await feedButton(feed, ID1).click();
    const query = panel(feed).getByLabel('Find or create a label');
    await query.fill('Picker temp');
    await query.press('Enter');
    const row = name => panel(feed).locator('.list li', { hasText: name });
    await row('Picker temp').hover();
    await panel(feed).getByRole('button', { name: 'Options for Picker temp' }).click();
    await panel(feed).getByRole('button', { name: 'Rename', exact: true }).click();
    // Esc backs out of renaming without closing the picker.
    await feed.keyboard.press('Escape');
    assert.equal(await panel(feed).getByLabel('Rename Picker temp').count(), 0);
    assert.equal(await panel(feed).count(), 1, 'picker still open');
    await panel(feed).getByRole('button', { name: 'Options for Picker temp' }).click();
    await panel(feed).getByRole('button', { name: 'Rename', exact: true }).click();
    await panel(feed).getByLabel('Rename Picker temp').fill('Picker renamed');
    await panel(feed).getByLabel('Rename Picker temp').press('Enter');
    await row('Picker renamed').waitFor();
    assert.equal(await row('Picker renamed').locator('input[type=checkbox]').isChecked(), true, 'still ticked');
    const labelNames = async () => {
      const lib = await openLibrary(context, extId);
      const names = Object.values((await storedData(lib)).labels).map(l => l.name);
      await lib.close();
      await feed.bringToFront();
      return names;
    };
    assert.ok((await labelNames()).includes('Picker renamed'));

    await panel(feed).getByRole('button', { name: 'Options for Picker renamed' }).click();
    await panel(feed).getByRole('button', { name: 'Delete', exact: true }).click();
    const warn = panel(feed).locator('.warn');
    assert.equal(await warn.locator('.title').textContent(), 'Deleting the Picker renamed label cannot be undone.');
    await shot(feed, 'picker-delete-label');
    await warn.getByRole('button', { name: 'Permanently delete it' }).click();
    await warn.waitFor({ state: 'detached' });
    assert.equal(await row('Picker renamed').count(), 0);
    assert.ok(!(await labelNames()).includes('Picker renamed'));
    await feed.keyboard.press('Escape');
    await panel(feed).waitFor({ state: 'detached' });
  });

  await check('feed: post found only by its timestamp link; saving needs a label; no duplicates', async () => {
    await feedButton(feed, ID2).click();
    assert.equal(
      await panel(feed).getAttribute('data-excerpt'),
      'Feed post two is identified only by its timestamp link, nothing else at all.',
    );
    assert.equal(await panel(feed).getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    await panel(feed).getByText('Pick or create a label to save.').waitFor();
    await panel(feed).getByLabel('Find or create a label').press('Control+Enter');
    await panel(feed).locator('.error', { hasText: 'Pick or create a label first.' }).waitFor();
    await panel(feed).locator('label', { hasText: 'Launches' }).locator('input').check();
    await panel(feed).getByRole('button', { name: 'Save', exact: true }).click();
    await panel(feed).getByRole('button', { name: 'Saved \u2713' }).waitFor();
    // Saving the same post again (keyboard save) doesn't create a second record.
    await panel(feed).getByLabel('Find or create a label').press('Control+Enter');
    await panel(feed).locator('.confirm').waitFor();
    await feed.keyboard.press('Escape');
    const p = await openLibrary(context, extId, FEED);
    const stored = await storedData(p);
    assert.equal(Object.keys(stored.posts).filter(id => id === ID2).length, 1);
    assert.deepEqual(
      stored.posts[ID2].labelIds.map(id => stored.labels[id].name),
      ['Launches'],
    );
    await navTo(p, 'Launches');
    assert.equal(
      await card(p, ID2).locator('.text').textContent(),
      'Feed post two is identified only by its timestamp link, nothing else at all.',
    );
    await p.close();
  });

  await check('feed: posts loaded later (scrolling) get buttons too', async () => {
    await feed.evaluate(() => {
      const post = document.createElement('div');
      post.className = 'p0st';
      post.setAttribute('data-urn', 'urn:li:activity:7600000000000000009');
      post.innerHTML =
        '<div class="hd"><span>1h</span></div><div class="bd"><span>A post that arrived while scrolling down the feed.</span></div>' +
        '<div class="bar"><button aria-label="Like">Like</button><button aria-label="Comment">Comment</button><button aria-label="Send">Send</button></div>';
      document.getElementById('feed-list').append(post);
    });
    await feedButton(feed, 'urn:li:activity:7600000000000000009').waitFor();
  });

  await check('feed: buttons update when a post is removed in the Library', async () => {
    const p = await openLibrary(context, extId, FEED);
    await card(p, ID1).getByRole('button', { name: 'Delete post' }).click();
    await card(p, ID1).waitFor({ state: 'detached' });
    await p.close();
    await feedButton(feed, ID1).getByText('Label', { exact: true }).waitFor();
    await feed.close();
  });

  await check('newer LinkedIn feed: posts identified through their comment-thread keys', async () => {
    const sdui = await context.newPage();
    await sdui.setViewportSize({ width: 1100, height: 900 });
    await sdui.goto(FEED3);
    const S1 = 'urn:li:activity:7511803322715041792';
    const S2 = 'urn:li:ugcPost:7453261968926224384';
    const S3 = 'urn:li:activity:7508962570318499840';
    await feedButton(sdui, S3).waitFor();
    const ids = await sdui.locator('[data-labels-ui="button"]').evaluateAll(els => els.map(e => e.dataset.labelsPost));
    assert.deepEqual(ids.sort(), [S1, S3, S2].sort(), 'one button per post, none on the ad');
    for (const id of [S1, S2, S3]) {
      assert.equal(
        await sdui.locator(`[data-labels-post="${id}"]`).evaluate(el => el.previousElementSibling?.className),
        'bar-row',
        `button for ${id} sits right under the icon-only action bar`,
      );
    }
    await shot(sdui, '12-sdui-feed');

    await feedButton(sdui, S1).click();
    // Labels clicks "… more" so the whole post is read.
    await sdui.waitForFunction(() =>
      document
        .querySelector('[data-labels-ui="panel"]')
        ?.shadowRoot.querySelector('.panel')
        ?.dataset.excerpt?.endsWith('one sharp question about our pipeline.'),
    );
    assert.equal(
      await panel(sdui).getAttribute('data-excerpt'),
      'SDUI post one: here is one of the best cold DMs I have ever received. He told me exactly who he is. Then he asked one sharp question about our pipeline.',
    );
    assert.equal(await sdui.locator('[data-testid="expandable-text-button"]').count(), 0, 'post was expanded');
    await panel(sdui).locator('label', { hasText: 'Launches' }).locator('input').check();
    await panel(sdui).getByRole('button', { name: 'Save', exact: true }).click();
    await panel(sdui).getByText('Saved \u2713').waitFor();
    await sdui.keyboard.press('Escape');

    await feedButton(sdui, S3).click();
    assert.equal(await panel(sdui).getAttribute('data-excerpt'), 'SDUI post three has comments loaded underneath it.');
    await sdui.keyboard.press('Escape');

    const p = await openLibrary(context, extId, FEED);
    const stored = await storedData(p);
    assert.equal(stored.posts[S1].url, `https://www.linkedin.com/feed/update/${S1}/`);
    assert.equal(
      stored.posts[S1].text,
      'SDUI post one: here is one of the best cold DMs I have ever received.\n\nHe told me exactly who he is. Then he asked one sharp question about our pipeline.',
      'full text, paragraphs kept',
    );
    await p.close();
    await sdui.close();
  });

  await check("LinkedIn's Saved posts page: a visible button at the bottom of each post's card", async () => {
    const saved = await context.newPage();
    await saved.setViewportSize({ width: 1100, height: 900 });
    await saved.goto(SAVED);
    const P1 = 'urn:li:activity:7340000000000000001';
    const P2 = 'urn:li:activity:7340000000000000002';
    await feedButton(saved, P2).waitFor();
    for (const id of [P1, P2]) {
      const where = await saved.locator(`[data-labels-post="${id}"]`).evaluate(host => ({
        last: host === host.parentElement.lastElementChild,
        inItem: host
          .closest('li')
          ?.querySelector('[data-chameleon-result-urn]')
          ?.getAttribute('data-chameleon-result-urn'),
      }));
      assert.equal(where.last, true, 'at the end of the card');
      assert.equal(where.inItem, id, "inside that post's own card");
      assert.ok(await feedButton(saved, id).isVisible());
    }
    await feedButton(saved, P1).click();
    assert.equal(
      await panel(saved).getAttribute('data-excerpt'),
      'Saved post one: I collect cold email subject lines I wish I wrote. Here are 7 from people who study outbound.',
    );
    await saved.keyboard.press('Escape');
    assert.equal(await saved.locator('[data-labels-ui="import"]').count(), 0, 'no import bar');
    await saved.close();
  });

  // ---------- keyboard shortcut ----------
  // Automation can't press a Chrome command shortcut, so these send the same message the
  // background worker sends when the shortcut is pressed.
  const pressShortcut = async tabUrl => {
    const p = await openLibrary(context, extId, FEED);
    await p.evaluate(async url => {
      const tabs = await globalThis.realTabsQuery({});
      const tab = tabs.find(t => (t.url || '').startsWith(url));
      await chrome.tabs.sendMessage(tab.id, { type: 'labels-shortcut' });
    }, tabUrl);
    await p.close();
  };
  const outlined = (page, id) =>
    page.locator(`[data-labels-post="${id}"]`).evaluate(host => {
      for (let el = host.parentElement; el; el = el.parentElement) if (el.style.outline) return true;
      return false;
    });
  const focusedInPicker = page =>
    page.evaluate(() => document.querySelector('[data-labels-ui="panel"]')?.shadowRoot.activeElement?.dataset.focus);

  await check('shortcut: opens the picker for the post under the mouse, keyboard-only save', async () => {
    const sdui = await context.newPage();
    await sdui.setViewportSize({ width: 1100, height: 900 });
    await sdui.goto(FEED3);
    const S3 = 'urn:li:activity:7508962570318499840';
    await feedButton(sdui, S3).waitFor();
    await sdui.getByText('SDUI post three has comments loaded underneath it.').hover();
    await pressShortcut(FEED3);
    await panel(sdui).waitFor();
    assert.equal(await panel(sdui).getAttribute('data-excerpt'), 'SDUI post three has comments loaded underneath it.');
    assert.equal(await outlined(sdui, S3), true, 'the chosen post is outlined');
    // Never touching the mouse: type to filter, Enter to tick, type a new name, Enter to
    // create it, Backspace to undo, Enter on an empty box to save and close.
    await sdui.waitForFunction(
      () => document.querySelector('[data-labels-ui="panel"]')?.shadowRoot.activeElement?.dataset.focus === 'query',
    );
    const checked = () => panel(sdui).locator('li:has(input:checked) label span').allTextContents();
    await sdui.keyboard.type('fee');
    assert.deepEqual(await panel(sdui).locator('.list li label span').allTextContents(), ['Feed picks']);
    await sdui.keyboard.press('Enter');
    assert.equal(await focusedInPicker(sdui), 'query', 'focus stays in the box');
    assert.equal(await panel(sdui).getByLabel('Find or create a label').inputValue(), '', 'box clears after Enter');
    await sdui.keyboard.type('Keyboard only');
    await sdui.keyboard.press('Enter');
    await panel(sdui).locator('li label span', { hasText: 'Keyboard only' }).waitFor();
    assert.deepEqual(await checked(), ['Feed picks', 'Keyboard only']);
    await sdui.keyboard.press('Backspace');
    assert.deepEqual(await checked(), ['Feed picks'], 'Backspace unticks the last label added');
    await sdui.keyboard.type('key');
    await sdui.keyboard.press('ArrowDown');
    await sdui.keyboard.press('ArrowUp');
    assert.match(await panel(sdui).locator('li.active').textContent(), /^Keyboard only/);
    await sdui.keyboard.press('Enter');
    await sdui.keyboard.press('Enter');
    // Shows what was saved for a moment, then closes by itself.
    assert.equal(await panel(sdui).locator('.confirm').textContent(), 'Saved \u2713Feed picks, Keyboard only');
    await panel(sdui).waitFor({ state: 'detached', timeout: 4000 });
    assert.equal(await outlined(sdui, S3), false, 'outline removed on close');
    const p = await openLibrary(context, extId, FEED);
    const stored = await storedData(p);
    assert.deepEqual(stored.posts[S3].labelIds.map(id => stored.labels[id].name).sort(), [
      'Feed picks',
      'Keyboard only',
    ]);
    await p.close();

    await feedButton(sdui, S3).getByText('Feed picks +1').waitFor();
    // Moving the mouse over the confirmation keeps the picker open.
    await pressShortcut(FEED3);
    await panel(sdui).waitFor();
    await sdui.waitForFunction(
      () => document.querySelector('[data-labels-ui="panel"]')?.shadowRoot.activeElement?.dataset.focus === 'query',
    );
    await sdui.keyboard.press('Control+Enter');
    await panel(sdui).locator('.confirm').waitFor();
    const box = await panel(sdui).boundingBox();
    for (let i = 0; i < 4; i++) await sdui.mouse.move(box.x + 40 + i * 12, box.y + 40);
    await sdui.waitForTimeout(2500);
    assert.equal(await panel(sdui).count(), 1, 'still open after the mouse moved onto it');
    assert.equal(await panel(sdui).locator('.confirm').count(), 0, 'back to the normal picker');
    await sdui.keyboard.press('Escape');
    await panel(sdui).waitFor({ state: 'detached' });

    // Not hovering a post: the post filling most of the screen is used; pressing again closes.
    await sdui.mouse.move(1090, 5);
    await sdui.evaluate(() => window.scrollTo(0, 0));
    await pressShortcut(FEED3);
    await panel(sdui).waitFor();
    assert.match(await panel(sdui).getAttribute('data-excerpt'), /^SDUI post one/);
    await pressShortcut(FEED3);
    await panel(sdui).waitFor({ state: 'detached' });
    await sdui.close();
  });

  await check('shortcut: explains when there is no post to label', async () => {
    const tab = await context.newPage();
    await tab.goto(POST_D);
    await pressShortcut(POST_D);
    await tab.locator('[data-labels-ui="toast"] .toast').waitFor();
    assert.match(await tab.locator('[data-labels-ui="toast"] .toast').textContent(), /No post to label here/);
    await tab.close();
  });

  await check('shortcut: registered, and shown in the Library', async () => {
    const p = await openLibrary(context, extId);
    const commands = await p.evaluate(() => chrome.commands.getAll());
    assert.ok(
      commands.some(c => c.name === 'label-post'),
      'label-post command is registered',
    );
    await p.locator('.tip kbd').waitFor();
    await p.close();
  });

  await check('Highlights: older posts resurface, with a badge, Show 5 more, and the same picks all day', async () => {
    const p = await openLibrary(context, extId);
    const DAY = 86400000;
    const now = Date.now();
    const data = { version: 1, labels: { l1: { id: 'l1', name: 'Ideas', createdAt: 1 } }, posts: {} };
    for (let i = 0; i < 8; i++) {
      const id = `urn:li:activity:76100000000000000${10 + i}`;
      data.posts[id] = {
        id,
        url: `https://www.linkedin.com/feed/update/${id}/`,
        excerpt: `Older post ${i}`,
        labelIds: ['l1'],
        savedAt: now - (40 + i) * DAY,
        updatedAt: now,
      };
    }
    // One saved today: too new to resurface.
    data.posts['urn:li:activity:7619999999999999999'] = {
      ...data.posts['urn:li:activity:7610000000000000010'],
      id: 'urn:li:activity:7619999999999999999',
      url: 'https://www.linkedin.com/feed/update/urn:li:activity:7619999999999999999/',
      excerpt: 'Saved today',
      savedAt: now,
    };
    await p.evaluate(
      d => chrome.storage.local.clear().then(() => chrome.storage.local.set({ 'labels.data.v1': d })),
      data,
    );
    await p.waitForFunction(async () => (await chrome.action.getBadgeText({})) === '5');

    // Opening the Library on a new day shows Highlights first, and clears the badge.
    await p.reload();
    await p.locator('body[data-ready]').waitFor();
    assert.equal(await p.locator('.nav-item.active .name').textContent(), 'Highlights');
    assert.equal(await p.locator('.highlights-head h1').textContent(), 'Highlights');
    assert.equal(await p.locator('.card').count(), 5);
    assert.match(await p.locator('.card .when').first().textContent(), /^From \d+ (weeks|months) ago$/);
    assert.ok(!(await p.locator('.card .text').allTextContents()).includes('Saved today'));
    await p.waitForFunction(async () => (await chrome.action.getBadgeText({})) === '');
    const picked = await p.locator('.card').evaluateAll(cards => cards.map(c => c.dataset.post));
    await shot(p, '8-highlights');

    // Show 5 more: only 3 older posts are left.
    await p.getByRole('button', { name: 'Show 3 more' }).click();
    assert.equal(await p.locator('.card').count(), 8);
    await p.getByText('That’s everything for now. More tomorrow.').waitFor();

    // Same picks after reopening; All Posts still has everything.
    await p.reload();
    await p.locator('body[data-ready]').waitFor();
    await navTo(p, 'Highlights');
    assert.deepEqual(
      (await p.locator('.card').evaluateAll(cards => cards.map(c => c.dataset.post))).slice(0, 5),
      picked,
    );
    await navTo(p, 'All Posts');
    assert.equal(await p.locator('.total').textContent(), '9 posts');
    await p.close();
  });

  console.log(`\nAll ${step} end-to-end checks passed.`);
} finally {
  await context.close();
  rmSync(work, { recursive: true, force: true });
}
