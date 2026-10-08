// End-to-end check in real Chromium with the extension loaded.
// Usage: node tests/e2e.mjs   (needs Playwright; set PLAYWRIGHT_PATH if it isn't resolvable)
//
// LinkedIn itself can't be used in automation (login, changing markup), so LinkedIn URLs are
// served from local fixtures. Two test-only tweaks are applied to a temporary copy of the
// extension, never to the shipped files:
//   - host access to www.linkedin.com, so tab URLs are visible to the shim below;
//   - a shim that points chrome.tabs.query at a chosen fixture tab ("the tab next to the
//     side panel"), because automation opens the Library as a page, not in the side panel.
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
for (const file of ['popup.html', 'sidepanel.html']) {
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

// Opens the Library (sidepanel.html) as a page; `target` is the tab "next to" the panel.
async function openLibrary(context, extId, target, query = '') {
  const page = await context.newPage();
  const qs = new URLSearchParams(query);
  if (target) qs.set('target', target);
  await page.goto(`chrome-extension://${extId}/sidepanel.html?${qs}`);
  await page.locator('body[data-ready]').waitFor();
  return page;
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

const labelsRows = page =>
  page
    .locator('.label-row')
    .evaluateAll(rows =>
      rows.map(r => `${r.querySelector('.name').textContent}:${r.querySelector('.count').textContent}`),
    );

async function createLabel(page, name) {
  await page.getByRole('button', { name: '+ New label' }).click();
  await page.getByLabel('New label name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
}

async function storedData(page) {
  return page.evaluate(async () => (await chrome.storage.local.get('labels.data.v1'))['labels.data.v1']);
}

let { context, extId } = await launch();
try {
  const postTab = await context.newPage();
  await postTab.goto(`${POST_A}?utm_source=share&utm_medium=member_desktop`);
  const feedTab = await context.newPage();
  await feedTab.goto(FEED);
  const noTextTab = await context.newPage();
  await noTextTab.goto(`${POST_B}?rcm=tracking`);

  await check('Library: empty to start, with a tip on how to label', async () => {
    const p = await openLibrary(context, extId, FEED);
    assert.deepEqual(await p.locator('h1.section-title').allTextContents(), ['Your labels']);
    assert.equal(await p.getByRole('tab').count(), 0, 'no tabs');
    assert.match(await p.locator('.tip').textContent(), /^To label a post, click Label under it on LinkedIn/);
    await p.getByText('Nothing saved yet.').waitFor();
    assert.equal(await p.getByRole('button', { name: /^(Save|Update)$/ }).count(), 0, 'nothing to save here');
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
  await check('new labels are auto-selected; multiple labels save', async () => {
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
    const p = await openLibrary(context, extId, FEED);
    const data = await storedData(p);
    const post = data.posts[ID_A];
    assert.equal(post.url, POST_A, 'tracking params stripped');
    assert.equal(post.labelIds.length, 2);
    assert.ok(post.text.startsWith('Design systems are not a project.'), 'full text saved');
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
    const p = await openLibrary(context, extId, FEED);
    const data = await storedData(p);
    assert.equal(Object.keys(data.posts).length, 1);
    assert.deepEqual(data.posts[ID_A].labelIds, [designId]);
    await p.close();
  });

  await check('saving needs a label; a post without readable text gets a fallback preview', async () => {
    const picker = await openPicker(noTextTab, ID_B);
    assert.equal(await picker.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
    await picker.getByText('Pick or create a label to save.').waitFor();
    await picker.locator('li', { hasText: 'ai' }).locator('input').check();
    await picker.getByRole('button', { name: 'Save', exact: true }).click();
    await picker.getByRole('button', { name: 'Saved ✓' }).waitFor();
    const p = await openLibrary(context, extId, FEED);
    assert.deepEqual(await labelsRows(p), ['ai:1', 'Design:1']);
    await shot(p, '4-your-labels');
    await p.locator('.label-row', { hasText: 'ai' }).click();
    assert.match(await p.locator('.post-open').first().textContent(), /^Open saved post · saved \w{3} \d{1,2}$/);
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

  await check('Library: a label lists its posts; clicking one opens it in the tab next to the panel', async () => {
    const scratch = await context.newPage();
    await scratch.goto(SCRATCH);
    const p = await openLibrary(context, extId, SCRATCH);
    await p.locator('.label-row', { hasText: 'Design' }).click();
    assert.equal(await p.locator('.header h2').textContent(), 'Design');
    assert.equal(await p.getByRole('button', { name: 'Options', exact: true }).count(), 1);
    await shot(p, '5-label-screen');
    await p.locator('.post-open').first().click();
    await scratch.waitForURL(POST_A);
    await p.close();
    await scratch.close();
  });

  await check('rename keeps posts and re-sorts', async () => {
    const p = await openLibrary(context, extId, FEED);
    await p.locator('.label-row', { hasText: 'Design' }).click();
    await p.getByRole('button', { name: 'Options', exact: true }).click();
    assert.equal(await p.locator('.menu-caption').textContent(), 'EDIT THIS LABEL');
    await shot(p, '6-options-menu');
    await p.getByRole('menuitem', { name: 'Rename' }).click();
    await p.getByLabel('Label name').fill('AI');
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    assert.match(await p.locator('.dialog .error').textContent(), /already have a label called "ai"/);
    await p.getByLabel('Label name').fill('Zeta design');
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    assert.equal(await p.locator('.header h2').textContent(), 'Zeta design');
    assert.equal(await p.locator('.post-open').count(), 1);
    await p.getByRole('button', { name: 'Back' }).click();
    assert.deepEqual(await labelsRows(p), ['ai:1', 'Zeta design:1']);
    await p.close();
  });

  await check('edit labels from a row; deleting a label warns and removes posts with no other label', async () => {
    const p = await openLibrary(context, extId, FEED);
    await p.locator('.label-row', { hasText: 'Zeta design' }).click();
    await p.getByRole('button', { name: 'Saved post options' }).click();
    await p.getByRole('menuitem', { name: 'Edit labels' }).click();
    await p.locator('.check-row', { hasText: 'ai' }).locator('input').check();
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    await p.getByRole('button', { name: 'Back' }).click();
    assert.deepEqual(await labelsRows(p), ['ai:2', 'Zeta design:1']);

    // Deleting "ai" warns about the one post that only has "ai", removes it, and keeps
    // the post that also has Zeta design.
    await p.locator('.label-row', { hasText: 'ai' }).click();
    await p.getByRole('button', { name: 'Options', exact: true }).click();
    await p.getByRole('menuitem', { name: 'Delete' }).click();
    assert.deepEqual(await p.locator('.dialog p').allTextContents(), [
      'Deleting the ai label will remove it from 2 posts and cannot be undone.',
      '1 post has no other label and will be deleted too.',
      'Do you want to permanently delete it?',
    ]);
    await shot(p, '7-delete-dialog');
    await p.getByRole('button', { name: 'Permanently delete it' }).click();
    assert.deepEqual(await labelsRows(p), ['Zeta design:1']);
    assert.deepEqual(Object.keys((await storedData(p)).posts), ['urn:li:activity:7212345678901234567']);

    // A label whose posts all have other labels too: plain confirm.
    await createLabel(p, 'Spare');
    await p.locator('.label-row', { hasText: 'Spare' }).click();
    await p.getByRole('button', { name: 'Options', exact: true }).click();
    await p.getByRole('menuitem', { name: 'Delete' }).click();
    assert.deepEqual(await p.locator('.dialog p').allTextContents(), [
      'Deleting the Spare label cannot be undone.',
      'Do you want to permanently delete it?',
    ]);
    await p.getByRole('button', { name: 'Permanently delete it' }).click();

    // Deleting the last label removes its post.
    await p.locator('.label-row', { hasText: 'Zeta design' }).click();
    await p.getByRole('button', { name: 'Options', exact: true }).click();
    await p.getByRole('menuitem', { name: 'Delete' }).click();
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
    const p = await openLibrary(context, extId, FEED);
    assert.deepEqual(await labelsRows(p), ['Launches:2']);
    await p.close();
  });

  await check('pin posts in the Library: pinned go first, and show under Pinned', async () => {
    const p = await openLibrary(context, extId, FEED);
    await p.locator('.label-row', { hasText: 'Launches' }).click();
    const opened = () => p.locator('.post-open').evaluateAll(els => els.map(e => e.title));
    const [first, second] = await opened();
    const row = p.locator('.post-row', { has: p.locator(`[title="${second}"]`) });
    await row.hover();
    await row.getByRole('button', { name: 'Pin post' }).click();
    assert.deepEqual(await opened(), [second, first], 'pinned post moves to the top');
    assert.equal(await p.getByRole('button', { name: 'Unpin post' }).getAttribute('aria-pressed'), 'true');
    await p.getByRole('button', { name: 'Back' }).click();
    assert.deepEqual(await labelsRows(p), ['Pinned:1', 'Launches:2']);
    await p.locator('.label-row', { hasText: 'Pinned' }).click();
    assert.equal(await p.locator('.header h2').textContent(), 'Pinned');
    await p.getByRole('button', { name: 'Options', exact: true }).click();
    assert.deepEqual(await p.getByRole('menuitem').allTextContents(), ['Copy as list'], 'Pinned only offers copying');
    await p.keyboard.press('Escape');
    await p.locator('.menu').waitFor({ state: 'detached' });
    assert.deepEqual(await opened(), [second]);
    // Unpin from the post's menu.
    await p.getByRole('button', { name: 'Saved post options' }).click();
    await p.getByRole('menuitem', { name: 'Unpin' }).click();
    await p.getByText('No pinned posts.').waitFor();
    await p.getByRole('button', { name: 'Back' }).click();
    assert.deepEqual(await labelsRows(p), ['Launches:2'], 'Pinned row hides when empty');
    await p.close();
  });

  await check('search, notes, label colors and copy as list in the Library', async () => {
    const p = await openLibrary(context, extId, FEED);
    const search = p.getByRole('searchbox', { name: 'Search saved posts' });
    await search.fill('design systems');
    assert.equal(await p.locator('.results-count').textContent(), '1 post found');
    assert.equal(await p.locator('.post-open').getAttribute('title'), POST_A);
    assert.deepEqual(await p.locator('.chip').allTextContents(), ['Launches'], 'results show their labels');
    await search.fill('zzzz nothing');
    assert.equal(await p.locator('.results-count').textContent(), 'No saved posts match \u201Czzzz nothing\u201D.');
    await p.getByRole('button', { name: 'Clear search' }).click();
    assert.deepEqual(await labelsRows(p), ['Launches:2'], 'labels are back after clearing');

    // Notes: add one from the post's menu; it shows in the list and is searchable.
    await p.locator('.label-row', { hasText: 'Launches' }).click();
    const rowA = p.locator('.post-row', { has: p.locator(`[title="${POST_A}"]`) });
    await rowA.getByRole('button', { name: 'Saved post options' }).click();
    await p.getByRole('menuitem', { name: 'Add note' }).click();
    assert.equal(await p.evaluate(() => document.activeElement?.id), 'edit-note', 'note field is focused');
    await p.getByLabel('Note').fill('Use in the Q3 deck');
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    assert.equal(await rowA.locator('.note').textContent(), 'Use in the Q3 deck');
    assert.equal((await storedData(p)).posts['urn:li:activity:7212345678901234567'].note, 'Use in the Q3 deck');
    await rowA.getByRole('button', { name: 'Saved post options' }).click();
    assert.equal(await p.getByRole('menuitem', { name: 'Edit note' }).count(), 1);
    await p.keyboard.press('Escape');

    // Color: pick one from the label's options; a dot shows next to the name.
    await p.getByRole('button', { name: 'Options', exact: true }).click();
    await p.getByRole('button', { name: 'Color blue' }).click();
    assert.equal(Object.values((await storedData(p)).labels)[0].color, 'blue');
    assert.equal(await p.locator('.header .dot').count(), 1);

    // Copy as list.
    await p.evaluate(() => {
      navigator.clipboard.writeText = async text => (window.copiedText = text);
    });
    await p.getByRole('button', { name: 'Options', exact: true }).click();
    await p.getByRole('menuitem', { name: 'Copy as list' }).click();
    await p.locator('.toast', { hasText: 'Copied 2 links' }).waitFor();
    const copied = await p.evaluate(() => window.copiedText);
    assert.match(copied, /^- \[.+\]\(https:\/\/www\.linkedin\.com\/.+\)/);
    assert.ok(copied.includes(`(${POST_A}) - Use in the Q3 deck`), 'notes ride along');

    await p.getByRole('button', { name: 'Back' }).click();
    assert.equal(await p.locator('.label-row .dot').count(), 1, 'color dot in the label list');
    await search.fill('q3 deck');
    assert.equal(await p.locator('.results-count').textContent(), '1 post found', 'notes are searchable');
    await p.close();
  });

  await check('full-page view: sidebar of labels, full text, search', async () => {
    const popup = await openLibrary(context, extId, FEED);
    const [p] = await Promise.all([
      context.waitForEvent('page'),
      popup.getByRole('button', { name: 'Open Labels in a tab' }).click(),
    ]);
    await popup.close();
    assert.match(p.url(), /popup\.html\?mode=page$/);
    await p.setViewportSize({ width: 1100, height: 800 });
    await p.locator('.sidebar .label-row').first().waitFor();
    assert.equal(await p.locator('.main .header h2').textContent(), 'Launches', 'opens on the first label');
    assert.equal(await p.locator('.main .header-count').textContent(), '2 posts');
    assert.equal(await p.locator('.main .back').count(), 0, 'no Back in the full view');
    assert.equal(await p.locator('.label-item.active .name').textContent(), 'Launches');
    const fullA = await p
      .locator('.main .post-open', { has: p.locator('.excerpt') })
      .evaluateAll(els => els.map(e => e.textContent));
    assert.ok(
      fullA.some(t => t.startsWith('Design systems')),
      'shows the full text',
    );
    // The post saved without readable text is flagged as partial; the full one isn't.
    assert.equal(await p.locator('.main .partial').count(), 1);
    await shot(p, '13-full-page');
    await p.getByRole('searchbox', { name: 'Search saved posts' }).fill('q3');
    assert.equal(await p.locator('.main .section-title').textContent(), 'Search');
    assert.equal(await p.locator('.main .results-count').textContent(), '1 post found');
    await p.locator('.chip', { hasText: 'Launches' }).click();
    assert.equal(await p.locator('.main .header h2').textContent(), 'Launches', 'chip opens the label');
    await p.close();
  });

  await check('delete a label from the Library list, with a warning', async () => {
    const p = await openLibrary(context, extId, FEED);
    await createLabel(p, 'Gone');
    // Give one post the label, from the post's menu.
    await p.locator('.label-row', { hasText: 'Launches' }).click();
    await p.getByRole('button', { name: 'Saved post options' }).first().click();
    await p.getByRole('menuitem', { name: 'Edit labels' }).click();
    await p.locator('.check-row', { hasText: 'Gone' }).locator('input').check();
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    await p.getByRole('button', { name: 'Back' }).click();
    assert.deepEqual(await labelsRows(p), ['Gone:1', 'Launches:2']);
    const row = p.locator('.label-item', { hasText: 'Gone' });
    await row.hover();
    await row.getByRole('button', { name: 'Delete label Gone' }).click();
    assert.deepEqual(await p.locator('.dialog p').allTextContents(), [
      'Deleting the Gone label will remove it from 1 post and cannot be undone.',
      'Do you want to permanently delete it?',
    ]);
    await p.getByRole('button', { name: 'Never mind' }).click();
    assert.deepEqual(await labelsRows(p), ['Gone:1', 'Launches:2']);
    await row.hover();
    await row.getByRole('button', { name: 'Delete label Gone' }).click();
    await p.getByRole('button', { name: 'Permanently delete it' }).click();
    assert.deepEqual(await labelsRows(p), ['Launches:2']);
    await p.close();
  });

  let backupPath;
  await check('export backup', async () => {
    const p = await openLibrary(context, extId, FEED);
    await p.getByRole('button', { name: 'Help' }).click();
    await shot(p, '8-help');
    const [download] = await Promise.all([
      p.waitForEvent('download'),
      p.getByRole('button', { name: 'Export backup' }).click(),
    ]);
    backupPath = join(work, 'backup.json');
    await download.saveAs(backupPath);
    const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
    assert.equal(backup.format, 'labels-backup');
    assert.equal(backup.posts.length, 2);
    assert.deepEqual(
      backup.labels.map(l => l.name),
      ['Launches'],
    );
    await p.close();
  });

  await check('data persists after restarting Chrome', async () => {
    await context.close();
    ({ context, extId } = await launch());
    const p = await openLibrary(context, extId, FEED);
    assert.deepEqual(await labelsRows(p), ['Launches:2']);
    await p.close();
  });

  await check('import validates and merges without duplicates', async () => {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extId}/popup.html?mode=tab#help`);
    await p.locator('.help').waitFor();
    await shot(p, '9-import-tab');

    const badPath = join(work, 'bad.json');
    writeFileSync(
      badPath,
      '{"format":"labels-backup","version":1,"labels":[],"posts":[{"url":"https://www.linkedin.com/feed/"}]}',
    );
    await p.setInputFiles('#import-file', badPath);
    await p.locator('.error', { hasText: 'individual LinkedIn post' }).waitFor();

    // Same data again: nothing duplicated.
    await p.setInputFiles('#import-file', backupPath);
    await p.locator('.status', { hasText: 'Imported 0 new posts, updated 0 posts, added 0 labels.' }).waitFor();
    assert.equal(Object.keys((await storedData(p)).posts).length, 2);

    // Wipe, then restore from the backup.
    await p.evaluate(() => chrome.storage.local.clear());
    await p.setInputFiles('#import-file', backupPath);
    await p.locator('.status', { hasText: 'Imported 2 new posts, updated 0 posts, added 1 label.' }).waitFor();
    const data = await storedData(p);
    assert.equal(Object.keys(data.posts).length, 2);
    assert.equal(data.posts['urn:li:activity:7212345678901234567'].url, POST_A);
    assert.ok(data.posts['urn:li:activity:7212345678901234567'].excerpt.startsWith('Design systems'));
    await p.close();
  });

  await check('remove saved post deletes only the record', async () => {
    const p = await openLibrary(context, extId, FEED);
    await p.locator('.label-row', { hasText: 'Launches' }).click();
    await p.getByRole('button', { name: 'Saved post options' }).first().click();
    // Removes right away, no confirm dialog; Undo puts it back.
    await p.getByRole('menuitem', { name: 'Remove saved post' }).click();
    assert.equal(await p.locator('.dialog').count(), 0, 'no confirm dialog');
    assert.equal(await p.locator('.post-open').count(), 1);
    await p.getByRole('button', { name: 'Undo' }).click();
    assert.equal(await p.locator('.post-open').count(), 2, 'back after Undo');
    assert.equal(Object.keys((await storedData(p)).posts).length, 2);
    await p.getByRole('button', { name: 'Saved post options' }).first().click();
    await p.getByRole('menuitem', { name: 'Remove saved post' }).click();
    assert.equal(await p.locator('.post-open').count(), 1);
    await p.getByRole('button', { name: 'Back' }).click();
    assert.deepEqual(await labelsRows(p), ['Launches:1']);
    assert.equal(Object.keys((await storedData(p)).labels).length, 1, 'labels are kept');
    await p.close();
  });

  await check('unticking every label on a saved post offers Remove from Labels', async () => {
    const list = await openLibrary(context, extId, FEED);
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
    const p = await openLibrary(context, extId, FEED);
    assert.equal(Object.keys((await storedData(p)).posts).length, 0);
    assert.deepEqual(await labelsRows(p), ['Launches:0']);
    await p.close();
    await tab.close();
  });

  await check('layout without known class names: reads the post, not header or comments', async () => {
    const tab = await context.newPage();
    await tab.goto(POST_C);
    const picker = await openPicker(tab, 'urn:li:activity:7333333333333333333');
    const preview = await picker.getAttribute('data-excerpt');
    assert.ok(
      preview.startsWith('Contrary to seemingly every single person in tech / SaaS, I hate Wispr Flow.'),
      preview,
    );
    for (const bad of ['Finn', 'Founder', 'Follow', 'COMMENT', 'Struggling', 'reactions', '10h']) {
      assert.ok(!preview.includes(bad), `preview contains ${bad}: ${preview}`);
    }
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
    let p = await openLibrary(context, extId, FEED);
    await p.locator('.label-row', { hasText: 'Launches' }).click();
    assert.match(await p.locator('.post-open').first().textContent(), /^Open saved post · saved \w{3} \d{1,2}$/);

    // The text loads later; just opening the post's picker saves it, no changes needed.
    postEHasText = true;
    await tab.reload();
    picker = await openPicker(tab, ID_E);
    await p.locator('.post-open', { hasText: 'Contrary to seemingly' }).waitFor();
    assert.ok((await storedData(p)).posts[ID_E].text.startsWith('Contrary to seemingly'));
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
    // The side panel can't open in headless Chrome, so Labels falls back to a Library tab.
    const opened = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await panel(feed).getByRole('button', { name: 'Library' }).click();
    const page = await opened;
    if (page) {
      assert.match(page.url(), /popup\.html\?mode=page$/);
      await page.close();
    }
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
    await p.locator('.label-row', { hasText: 'Launches' }).click();
    assert.ok(
      (await p.locator('.post-open').allTextContents()).includes(
        'Feed post two is identified only by its timestamp link, nothing else at all.',
      ),
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
    await p.locator('.label-row', { hasText: 'Feed picks' }).click();
    await p.getByRole('button', { name: 'Saved post options' }).click();
    await p.getByRole('menuitem', { name: 'Remove saved post' }).click();
    await p.getByRole('button', { name: 'Undo' }).waitFor();
    await p.close();
    await feedButton(feed, ID1).getByText('Label', { exact: true }).waitFor();
  });

  await check('feed: Help offers Copy page info on LinkedIn pages', async () => {
    const p = await openLibrary(context, extId, FEED2);
    // Troubleshooting lives in Help now.
    await p.getByRole('button', { name: 'Help' }).click();
    await p.evaluate(() => {
      navigator.clipboard.writeText = async text => (window.copiedText = text);
    });
    await p.getByRole('button', { name: 'Copy page info' }).click();
    await p.getByText('Copied.', { exact: false }).waitFor();
    const outline = await p.evaluate(() => window.copiedText);
    assert.match(outline, /posts-with-id-found: 4/);
    assert.ok(!/Feed post|Alice|Struggling/.test(outline), 'outline has no page text');
    await p.close();
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

  await check("LinkedIn's Saved posts page: button sits in each post's top row", async () => {
    const saved = await context.newPage();
    await saved.setViewportSize({ width: 1100, height: 900 });
    await saved.goto(SAVED);
    const P1 = 'urn:li:activity:7340000000000000001';
    const P2 = 'urn:li:activity:7340000000000000002';
    await feedButton(saved, P2).waitFor();
    for (const id of [P1, P2]) {
      const where = await saved.locator(`[data-labels-post="${id}"]`).evaluate(host => ({
        row: host.parentElement.className,
        next: host.nextElementSibling?.querySelector('.entity-result__actions-overflow-menu-dropdown') !== null,
        inItem: host.closest('[data-chameleon-result-urn]')?.getAttribute('data-chameleon-result-urn'),
      }));
      assert.equal(where.row, 'display-flex mb3 ml4', 'in the top row');
      assert.equal(where.next, true, 'right before the ••• menu');
      assert.equal(where.inItem, id, "inside that post's own card");
    }
    await feedButton(saved, P1).click();
    assert.equal(
      await panel(saved).getAttribute('data-excerpt'),
      'Saved post one: I collect cold email subject lines I wish I wrote. Here are 7 from people who study outbound.',
    );
    await saved.keyboard.press('Escape');
    await saved.close();
  });

  await check("LinkedIn's Saved posts page: select several posts and label them at once", async () => {
    const saved = await context.newPage();
    await saved.setViewportSize({ width: 1100, height: 900 });
    await saved.goto(SAVED);
    const P1 = 'urn:li:activity:7340000000000000001';
    const P2 = 'urn:li:activity:7340000000000000002';
    await feedButton(saved, P2).waitFor();
    const bar = saved.locator('[data-labels-ui="bulk"] .bar');
    const pick = id => saved.locator(`[data-labels-post="${id}"] .pick`);
    assert.equal(await pick(P1).isVisible(), false, 'no checkboxes until selecting');
    await bar.getByRole('button', { name: 'Select posts to label' }).click();
    await pick(P1).check();
    assert.equal(await bar.locator('.count').textContent(), '1 selected');
    await bar.getByRole('button', { name: 'Select all' }).click();
    assert.equal(await bar.locator('.count').textContent(), '2 selected');
    await shot(saved, '14-bulk-select');
    await bar.getByRole('button', { name: 'Label 2 posts' }).click();
    assert.equal(await panel(saved).locator('.head h2').textContent(), 'Label 2 posts');
    await panel(saved).locator('label', { hasText: 'Launches' }).locator('input').check();
    await panel(saved).getByRole('button', { name: 'Label 2 posts' }).click();
    assert.equal(await panel(saved).locator('.confirm-title').textContent(), 'Labeled 2 posts \u2713');
    await feedButton(saved, P1).getByText('Launches', { exact: true }).waitFor();
    await feedButton(saved, P2).getByText('Launches', { exact: true }).waitFor();
    await bar.getByRole('button', { name: 'Select posts to label' }).waitFor();
    assert.equal(await pick(P1).isVisible(), false, 'checkboxes hide when done');
    await panel(saved).waitFor({ state: 'detached', timeout: 4000 });
    const p = await openLibrary(context, extId, FEED);
    const stored = await storedData(p);
    for (const id of [P1, P2]) {
      assert.deepEqual(
        stored.posts[id].labelIds.map(l => stored.labels[l].name),
        ['Launches'],
      );
      assert.ok(stored.posts[id].text.startsWith('Saved post'), 'text captured for each post');
    }
    await p.close();
    // No bar on other pages.
    const feedPage = await context.newPage();
    await feedPage.goto(FEED2);
    await feedButton(feedPage, ID1).waitFor();
    assert.equal(await feedPage.locator('[data-labels-ui="bulk"]').count(), 0);
    await feedPage.close();
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

  await check('shortcut: registered, and shown in Help', async () => {
    const p = await openLibrary(context, extId, FEED);
    const commands = await p.evaluate(() => chrome.commands.getAll());
    assert.ok(
      commands.some(c => c.name === 'label-post'),
      'label-post command is registered',
    );
    await p.getByRole('button', { name: 'Help' }).click();
    await p.locator('.shortcut').waitFor();
    assert.match(await p.locator('.shortcut').textContent(), /keyboard shortcut/i);
    await p.close();
  });

  console.log(`\nAll ${step} end-to-end checks passed.`);
} finally {
  await context.close();
  rmSync(work, { recursive: true, force: true });
}
