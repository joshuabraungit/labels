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
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest));
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
const FEED2 = 'https://www.linkedin.com/feed/following/';
const FEED3 = 'https://www.linkedin.com/feed/hashtag/sdui/';
const SAVED = 'https://www.linkedin.com/my-items/saved-posts/';
const POST_C = 'https://www.linkedin.com/feed/update/urn:li:activity:7333333333333333333/';
const POST_D = 'https://www.linkedin.com/feed/update/urn:li:activity:7444444444444444444/';
const POST_E = 'https://www.linkedin.com/feed/update/urn:li:activity:7555555555555555555/';
// POST_E starts out without readable text, then "loads" it, to test preview backfill.
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
        : read('post-no-text.html');
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
      'Click the Label button on any post to save it. Or open a post and click Labels here.',
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
    // Already saved and unchanged: the button says so and can't be clicked.
    assert.equal(await p.getByRole('button', { name: 'Saved \u2713' }).isDisabled(), true);
    assert.equal(await p.getByRole('button', { name: 'Update' }).count(), 0);
    assert.equal(await p.locator('.check-row input:checked').count(), 2, 'existing labels shown');
    await p.locator('.check-row', { hasText: 'ai' }).locator('input').uncheck();
    await p.getByRole('button', { name: 'Update' }).click();
    await p.getByRole('button', { name: 'Saved \u2713' }).waitFor();
    // Changing it back to what's saved also shows Saved, no Update needed.
    await p.locator('.check-row', { hasText: 'ai' }).locator('input').check();
    assert.equal(await p.getByRole('button', { name: 'Update' }).count(), 1);
    await p.locator('.check-row', { hasText: 'ai' }).locator('input').uncheck();
    assert.equal(await p.getByRole('button', { name: 'Saved \u2713' }).isDisabled(), true);
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

  await check('layout without known class names: captures the post, not header or comments', async () => {
    const tab = await context.newPage();
    await tab.goto(POST_C);
    const p = await openPopup(context, extId, POST_C);
    const preview = await p.locator('.preview').textContent();
    assert.ok(
      preview.startsWith('Contrary to seemingly every single person in tech / SaaS, I hate Wispr Flow.'),
      preview,
    );
    for (const bad of ['Finn', 'Founder', 'Follow', 'COMMENT', 'Struggling', 'reactions', 'more', '10h']) {
      assert.ok(!preview.includes(bad), `preview contains ${bad}: ${preview}`);
    }
    await p.close();
    await tab.close();
  });

  await check('falls back to the tab title without the author name', async () => {
    const tab = await context.newPage();
    await tab.goto(POST_D);
    const p = await openPopup(context, extId, POST_D);
    assert.equal(
      await p.locator('.preview').textContent(),
      'Cold email is not dead, your offer is. Here is the 3-line email',
    );
    await p.close();
    await tab.close();
  });

  await check('missing previews show the save date, offer page info, and fill in later', async () => {
    const tab = await context.newPage();
    await tab.goto(POST_E);
    let p = await openPopup(context, extId, POST_E);
    assert.equal(await p.locator('.preview').textContent(), 'Open saved post');
    // Headless Chrome won't grant clipboard access to extension pages, so capture the write.
    await p.evaluate(() => {
      navigator.clipboard.writeText = async text => (window.copiedText = text);
    });
    await p.getByRole('button', { name: 'Copy page info' }).click();
    await p.getByText('Copied.', { exact: false }).waitFor();
    const outline = await p.evaluate(() => window.copiedText);
    assert.match(outline, /container: found-by-class/);
    assert.match(outline, /data-urn="urn:li:activity:<ID>"/);
    assert.ok(!/Image only post|LinkedIn/.test(outline.split('\n').slice(5).join('\n')), 'outline has no page text');
    await p.getByRole('button', { name: 'Save', exact: true }).click();
    await p.getByText('Saved \u2713').waitFor();
    await p.getByRole('tab', { name: 'Your labels' }).click();
    await p.locator('.label-row', { hasText: 'Uncategorized' }).click();
    assert.match(await p.locator('.post-open').first().textContent(), /^Open saved post \u00B7 saved \w{3} \d{1,2}$/);
    await p.close();

    postEHasText = true;
    await tab.reload();
    p = await openPopup(context, extId, POST_E);
    await p.getByRole('tab', { name: 'Your labels' }).click();
    await p.locator('.label-row', { hasText: 'Uncategorized' }).click();
    assert.ok((await p.locator('.post-open').first().textContent()).startsWith('Contrary to seemingly'));
    await p.close();
    await tab.close();
  });

  // ---------- Label buttons in the feed ----------

  const feedButton = (page, id) => page.locator(`[data-labels-post="${id}"] button`);
  const panel = page => page.locator('[data-labels-ui="panel"] .panel');
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
    const preview = await panel(feed).locator('.preview').textContent();
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
    await feedButton(feed, ID1).getByText('Labeled').waitFor();
    const p = await openPopup(context, extId, FEED);
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
    await p.close();
  });

  await check('feed: Escape and outside clicks close the picker; reopening shows it is saved', async () => {
    await feed.keyboard.press('Escape');
    await panel(feed).waitFor({ state: 'detached' });
    await feedButton(feed, ID1).click();
    await panel(feed).getByRole('button', { name: 'Saved \u2713' }).waitFor();
    assert.equal(await panel(feed).getByRole('button', { name: 'Saved \u2713' }).isDisabled(), true);
    assert.equal(await panel(feed).locator('label', { hasText: 'Feed picks' }).locator('input').isChecked(), true);
    // Any change turns it back into Update; undoing the change goes back to Saved.
    await panel(feed).locator('label', { hasText: 'Feed picks' }).locator('input').uncheck();
    await panel(feed).getByRole('button', { name: 'Update' }).waitFor();
    await panel(feed).locator('label', { hasText: 'Feed picks' }).locator('input').check();
    await panel(feed).getByRole('button', { name: 'Saved \u2713' }).waitFor();
    await feed.mouse.click(5, 880);
    await panel(feed).waitFor({ state: 'detached' });
  });

  await check("feed: picker shows post counts that list the label's posts in place", async () => {
    await feedButton(feed, ID1).click();
    const pill = panel(feed).locator('li', { hasText: 'Feed picks' }).locator('.count');
    await pill.waitFor();
    assert.equal(await pill.textContent(), '1 \u203A');
    assert.equal(await pill.getAttribute('title'), 'View 1 saved post');
    assert.equal(
      await panel(feed).locator('li', { hasText: 'Launches' }).locator('.count').count(),
      1,
      'labels with posts get a pill',
    );
    const before = await panel(feed).locator('li', { hasText: 'Feed picks' }).locator('input').isChecked();
    await pill.click();
    // The label's posts show inside the picker, no new tab.
    await panel(feed).locator('.label-view').waitFor();
    assert.equal(await panel(feed).locator('.label-view h2').textContent(), 'Feed picks');
    const rows = panel(feed).locator('.posts a');
    assert.equal(await rows.count(), 1);
    assert.ok((await rows.first().textContent()).startsWith('Feed post one'));
    assert.equal(await rows.first().getAttribute('href'), `https://www.linkedin.com/feed/update/${ID1}/`);
    assert.match(await rows.first().textContent(), /This post$/, 'marks the post being labeled');
    // Esc (or Back) returns to the picker as it was, without ticking anything.
    await feed.keyboard.press('Escape');
    await panel(feed).locator('.label-view').waitFor({ state: 'detached' });
    assert.equal(
      await panel(feed).locator('li', { hasText: 'Feed picks' }).locator('input').isChecked(),
      before,
      'clicking the count does not tick the box',
    );
    await pill.click();
    await panel(feed).getByRole('button', { name: 'Back' }).click();
    await panel(feed).getByLabel('Find or create a label').waitFor();
    await feed.keyboard.press('Escape');
    await panel(feed).waitFor({ state: 'detached' });
  });

  await check('feed: post found only by its timestamp link saves to Uncategorized; no duplicates', async () => {
    await feedButton(feed, ID2).click();
    assert.equal(
      await panel(feed).locator('.preview').textContent(),
      'Feed post two is identified only by its timestamp link, nothing else at all.',
    );
    await panel(feed).getByRole('button', { name: 'Save', exact: true }).click();
    await panel(feed).getByRole('button', { name: 'Saved \u2713' }).waitFor();
    // Saving the same post again (keyboard save) doesn't create a second record.
    await panel(feed).getByLabel('Find or create a label').press('Control+Enter');
    await panel(feed).locator('.confirm').waitFor();
    await feed.keyboard.press('Escape');
    const p = await openPopup(context, extId, FEED);
    const stored = await storedData(p);
    assert.equal(Object.keys(stored.posts).filter(id => id === ID2).length, 1);
    assert.deepEqual(stored.posts[ID2].labelIds, []);
    await p.locator('.label-row', { hasText: 'Uncategorized' }).click();
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

  await check('feed: buttons update when a post is removed in the popup', async () => {
    const p = await openPopup(context, extId, FEED);
    await p.locator('.label-row', { hasText: 'Feed picks' }).click();
    await p.getByRole('button', { name: 'Saved post options' }).click();
    await p.getByRole('menuitem', { name: 'Remove saved post' }).click();
    await p.getByRole('button', { name: 'Remove', exact: true }).click();
    await p.close();
    await feedButton(feed, ID1).getByText('Label', { exact: true }).waitFor();
  });

  await check('feed: popup on the feed points to the buttons and can copy page info', async () => {
    const p = await openPopup(context, extId, FEED2);
    await p.getByRole('tab', { name: 'Save this post' }).click();
    assert.match(await p.locator('.notice').textContent(), /Label button on any post/);
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
    assert.equal(
      await panel(sdui).locator('.preview').textContent(),
      'SDUI post one: here is one of the best cold DMs I have ever received. He told me exactly who he is.',
    );
    await panel(sdui).getByRole('button', { name: 'Save', exact: true }).click();
    await panel(sdui).getByText('Saved \u2713').waitFor();
    await sdui.keyboard.press('Escape');

    await feedButton(sdui, S3).click();
    assert.equal(
      await panel(sdui).locator('.preview').textContent(),
      'SDUI post three has comments loaded underneath it.',
    );
    await sdui.keyboard.press('Escape');

    const p = await openPopup(context, extId, FEED);
    const stored = await storedData(p);
    assert.equal(stored.posts[S1].url, `https://www.linkedin.com/feed/update/${S1}/`);
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
      await panel(saved).locator('.preview').textContent(),
      'Saved post one: I collect cold email subject lines I wish I wrote. Here are 7 from people who study outbound.',
    );
    await saved.keyboard.press('Escape');
    await saved.close();
  });

  // ---------- keyboard shortcut ----------
  // Automation can't press a Chrome command shortcut, so these send the same message the
  // background worker sends when the shortcut is pressed.
  const pressShortcut = async tabUrl => {
    const p = await openPopup(context, extId, FEED);
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
    assert.equal(
      await panel(sdui).locator('.preview').textContent(),
      'SDUI post three has comments loaded underneath it.',
    );
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
    const p = await openPopup(context, extId, FEED);
    const stored = await storedData(p);
    assert.deepEqual(stored.posts[S3].labelIds.map(id => stored.labels[id].name).sort(), [
      'Feed picks',
      'Keyboard only',
    ]);
    await p.close();

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
    assert.match(await panel(sdui).locator('.preview').textContent(), /^SDUI post one/);
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
    const p = await openPopup(context, extId, FEED);
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
