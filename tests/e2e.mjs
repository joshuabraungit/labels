// End-to-end check in real Chromium with the extension loaded.
// Usage: node tests/e2e.mjs   (needs Playwright; set PLAYWRIGHT_PATH if it isn't resolvable)
//
// LinkedIn itself can't be used in automation (login, changing markup), so LinkedIn URLs are
// served from local fixtures. Two test-only tweaks are applied to a temporary copy of the
// extension, never to the shipped files:
//   - host access to www.linkedin.com, because automation can't click the toolbar button to
//     grant activeTab;
//   - a shim that points chrome.tabs.query at the fixture tab, because the popup is opened as
//     a page instead of from the toolbar.
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
manifest.background = { service_worker: 'sw.js' };
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest));
writeFileSync(join(extDir, 'sw.js'), '');
writeFileSync(
  join(extDir, 'test-shim.js'),
  `const target = new URLSearchParams(location.search).get('target');
if (target) {
  const query = (globalThis.realTabsQuery = chrome.tabs.query.bind(chrome.tabs));
  chrome.tabs.query = async () => (await query({})).filter(t => (t.url || '').split(/[?#]/)[0] === target).slice(0, 1);
}`,
);
const html = readFileSync(join(extDir, 'popup.html'), 'utf8');
writeFileSync(
  join(extDir, 'popup.html'),
  html.replace('<script type="module"', '<script src="test-shim.js"></script><script type="module"'),
);

const POST_A = 'https://www.linkedin.com/feed/update/urn:li:activity:7212345678901234567/';
const POST_B = 'https://www.linkedin.com/posts/jane-doe_launch-activity-7200000000000000001-AbCd/';
const FEED = 'https://www.linkedin.com/feed/';

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
    const file = url.includes('activity:7212345678901234567')
      ? 'post-page.html'
      : url.includes('activity-7200000000000000001')
        ? 'post-no-text.html'
        : 'feed.html';
    return route.fulfill({ contentType: 'text/html', body: readFileSync(join(fixtures, file)) });
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

async function openPopup(context, extId, target, query = '') {
  const page = await context.newPage();
  const qs = new URLSearchParams(query);
  if (target) qs.set('target', target);
  await page.goto(`chrome-extension://${extId}/popup.html?${qs}`);
  await page.locator('.content').waitFor();
  return page;
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

  await check('feed page refuses to save and defaults to Your labels', async () => {
    const p = await openPopup(context, extId, FEED);
    assert.equal(await p.locator('h1.section-title').textContent(), 'Your labels');
    await p.getByRole('tab', { name: 'Save this post' }).click();
    assert.equal(
      await p.locator('.notice').textContent(),
      'Open the LinkedIn post you want to save, then click Labels.',
    );
    assert.equal(await p.getByRole('button', { name: /^(Save|Update)$/ }).count(), 0);
    await shot(p, '1-feed-page');
    await p.close();
  });

  await check('post page captures only the selected post text', async () => {
    const p = await openPopup(context, extId, POST_A);
    assert.equal(await p.getByRole('tab', { name: 'Save this post' }).getAttribute('aria-selected'), 'true');
    const preview = await p.locator('.preview').textContent();
    assert.ok(preview.startsWith('Design systems are not a project. They are a product with customers'), preview);
    assert.ok(preview.endsWith('…') && preview.length <= 161, preview);
    for (const bad of ['COMMENT', 'OTHER POST', 'Jane Author', 'hashtag', 'more', '\n']) {
      assert.ok(!preview.includes(bad), `preview contains ${bad}`);
    }
    await p.close();
  });

  let designId;
  await check('new labels are auto-selected; multiple labels save', async () => {
    const p = await openPopup(context, extId, POST_A);
    await createLabel(p, 'Design');
    await createLabel(p, 'ai');
    await createLabel(p, ' design ');
    assert.match(await p.locator('.error').textContent(), /already have a label called "Design"/);
    await p.getByLabel('New label name').fill('Uncategorized');
    await p.getByRole('button', { name: 'Create' }).click();
    assert.match(await p.locator('.error').textContent(), /reserved/);
    await p.getByLabel('New label name').press('Escape');
    assert.deepEqual(await p.locator('.check-row span').allTextContents(), ['ai', 'Design']);
    assert.equal(await p.locator('.check-row input:checked').count(), 2);
    await shot(p, '2-save-view');
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    await p.getByText('Saved ✓').waitFor();
    const data = await storedData(p);
    const post = data.posts['urn:li:activity:7212345678901234567'];
    assert.equal(post.url, POST_A, 'tracking params stripped');
    assert.equal(post.labelIds.length, 2);
    designId = Object.values(data.labels).find(l => l.name === 'Design').id;
    await shot(p, '3-saved');
    await p.close();
  });

  await check('saving again updates the same record', async () => {
    const p = await openPopup(context, extId, POST_A);
    assert.equal(await p.getByRole('button', { name: 'Update' }).count(), 1);
    assert.equal(await p.locator('.check-row input:checked').count(), 2, 'existing labels shown');
    await p.locator('.check-row', { hasText: 'ai' }).locator('input').uncheck();
    await p.getByRole('button', { name: 'Update' }).click();
    await p.getByText('Saved ✓').waitFor();
    const data = await storedData(p);
    assert.equal(Object.keys(data.posts).length, 1);
    assert.deepEqual(data.posts['urn:li:activity:7212345678901234567'].labelIds, [designId]);
    await p.close();
  });

  await check('post without readable text saves to Uncategorized with fallback preview', async () => {
    const p = await openPopup(context, extId, POST_B);
    assert.equal(await p.locator('.preview').textContent(), 'Open saved post');
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    await p.getByText('Saved ✓').waitFor();
    await p.getByRole('tab', { name: 'Your labels' }).click();
    assert.deepEqual(await labelsRows(p), ['ai:0', 'Design:1', 'Uncategorized:1']);
    await shot(p, '4-your-labels');
    await p.close();
  });

  await check('errors keep label selections for retry', async () => {
    const p = await openPopup(context, extId, POST_B);
    await p.locator('.check-row', { hasText: 'ai' }).locator('input').check();
    await p.locator('.check-row', { hasText: 'Design' }).locator('input').check();
    await p.evaluate(() => {
      const area = chrome.storage.local;
      const set = area.set.bind(area);
      let failures = 1;
      area.set = (...args) => (failures-- > 0 ? Promise.reject(new Error('simulated disk error')) : set(...args));
    });
    await p.getByRole('button', { name: 'Update' }).click();
    await p.locator('.error').waitFor();
    assert.equal(await p.locator('.check-row input:checked').count(), 2, 'selection kept after error');
    await p.getByRole('button', { name: 'Update' }).click();
    await p.getByText('Saved ✓').waitFor();
    const data = await storedData(p);
    assert.equal(data.posts['urn:li:activity:7200000000000000001'].labelIds.length, 2);
    // Put it back in Uncategorized for the next steps.
    await p.locator('.check-row', { hasText: 'ai' }).locator('input').uncheck();
    await p.locator('.check-row', { hasText: 'Design' }).locator('input').uncheck();
    await p.getByRole('button', { name: 'Update' }).click();
    await p.getByText('Saved ✓').waitFor();
    await p.close();
  });

  await check('label screen lists previews and opens the original URL', async () => {
    const p = await openPopup(context, extId, FEED);
    await p.locator('.label-row', { hasText: 'Design' }).click();
    assert.equal(await p.locator('.header h2').textContent(), 'Design');
    assert.equal(await p.getByRole('button', { name: 'Options', exact: true }).count(), 1);
    await shot(p, '5-label-screen');
    assert.equal(await openedUrl(p, () => p.locator('.post-open').first().click()), POST_A);
    await p.getByRole('button', { name: 'Back' }).click();
    await p.locator('.label-row', { hasText: 'Uncategorized' }).click();
    assert.equal(
      await p.getByRole('button', { name: 'Options', exact: true }).count(),
      0,
      'Uncategorized has no options',
    );
    assert.equal(await openedUrl(p, () => p.locator('.post-open').first().click()), POST_B);
    await p.close();
  });

  await check('rename keeps posts and re-sorts', async () => {
    const p = await openPopup(context, extId, FEED);
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
    assert.deepEqual(await labelsRows(p), ['ai:0', 'Uncategorized:1', 'Zeta design:1']);
    await p.close();
  });

  await check('edit labels from a row; multiple labels; delete moves posts to Uncategorized', async () => {
    const p = await openPopup(context, extId, FEED);
    await p.locator('.label-row', { hasText: 'Zeta design' }).click();
    await p.getByRole('button', { name: 'Saved post options' }).click();
    await p.getByRole('menuitem', { name: 'Edit labels' }).click();
    await p.locator('.check-row', { hasText: 'ai' }).locator('input').check();
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    await p.getByRole('button', { name: 'Back' }).click();
    assert.deepEqual(await labelsRows(p), ['ai:1', 'Uncategorized:1', 'Zeta design:1']);

    // Deleting "ai" keeps the post under Zeta design.
    await p.locator('.label-row', { hasText: 'ai' }).click();
    await p.getByRole('button', { name: 'Options', exact: true }).click();
    await p.getByRole('menuitem', { name: 'Delete' }).click();
    assert.equal(
      await p.locator('.dialog p').textContent(),
      'Delete this label? Your saved posts will be kept. Posts without another label will appear in Uncategorized.',
    );
    await shot(p, '7-delete-dialog');
    await p.getByRole('button', { name: 'Delete', exact: true }).click();
    assert.deepEqual(await labelsRows(p), ['Uncategorized:1', 'Zeta design:1']);

    // Deleting the last label sends the post to Uncategorized.
    await p.locator('.label-row', { hasText: 'Zeta design' }).click();
    await p.getByRole('button', { name: 'Options', exact: true }).click();
    await p.getByRole('menuitem', { name: 'Delete' }).click();
    await p.getByRole('button', { name: 'Delete', exact: true }).click();
    assert.deepEqual(await labelsRows(p), ['Uncategorized:2']);
    assert.equal(Object.keys((await storedData(p)).posts).length, 2);
    await p.close();
  });

  await check('assigning a label removes a post from Uncategorized', async () => {
    const p = await openPopup(context, extId, POST_B);
    await createLabel(p, 'Launches');
    await p.getByRole('button', { name: 'Update' }).click();
    await p.getByText('Saved ✓').waitFor();
    await p.getByRole('tab', { name: 'Your labels' }).click();
    assert.deepEqual(await labelsRows(p), ['Launches:1', 'Uncategorized:1']);
    await p.close();
  });

  let backupPath;
  await check('export backup', async () => {
    const p = await openPopup(context, extId, FEED);
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
    const p = await openPopup(context, extId, FEED);
    assert.deepEqual(await labelsRows(p), ['Launches:1', 'Uncategorized:1']);
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
    const p = await openPopup(context, extId, FEED);
    await p.locator('.label-row', { hasText: 'Uncategorized' }).click();
    await p.getByRole('button', { name: 'Saved post options' }).click();
    await p.getByRole('menuitem', { name: 'Remove saved post' }).click();
    await p.getByRole('button', { name: 'Remove', exact: true }).click();
    assert.equal(await p.locator('.empty').count(), 1);
    await p.getByRole('button', { name: 'Back' }).click();
    assert.deepEqual(await labelsRows(p), ['Launches:1', 'Uncategorized:0']);
    await p.close();
  });

  console.log(`\nAll ${step} end-to-end checks passed.`);
} finally {
  await context.close();
  rmSync(work, { recursive: true, force: true });
}
