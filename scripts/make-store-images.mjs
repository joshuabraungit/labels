// Builds the Chrome Web Store images in store/: screenshots (1280x800), small promo tile
// (440x280) and marquee tile (1400x560), as JPEGs (the store wants no alpha channel).
// It loads the real extension in Chromium with sample data and captures its actual UI.
// Usage: node scripts/make-store-images.mjs   (needs Playwright + Chromium)
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'store');
const profile = mkdtempSync(join(process.env.STORE_TMP || tmpdir(), 'labels-store-'));

const day = 86400000;
const now = Date.now();
const L = {
  cold: { id: 'l_cold', name: 'Cold email', createdAt: now, color: 'purple' },
  disc: { id: 'l_disc', name: 'Discovery calls', createdAt: now, color: 'blue' },
  hire: { id: 'l_hire', name: 'Hiring', createdAt: now, color: 'green' },
  swipe: { id: 'l_swipe', name: 'Swipe file', createdAt: now, color: 'orange' },
  write: { id: 'l_write', name: 'Writing tips', createdAt: now, color: 'pink' },
  ai: { id: 'l_ai', name: 'AI for sales', createdAt: now, color: 'yellow' },
};
const post = (n, excerpt, labelIds, ageDays) => ({
  id: `urn:li:activity:74000000000000000${String(n).padStart(2, '0')}`,
  url: `https://www.linkedin.com/feed/update/urn:li:activity:74000000000000000${String(n).padStart(2, '0')}/`,
  excerpt,
  labelIds,
  savedAt: now - ageDays * day,
  updatedAt: now - ageDays * day,
});
const posts = [
  post(
    1,
    'Stop opening cold emails with "I hope this finds you well." Lead with the problem you noticed and why it matters to them now.',
    ['l_cold', 'l_swipe'],
    1,
  ),
  post(
    2,
    'Three-line cold email that booked 14 meetings last quarter: the trigger, the proof, one easy question. Template inside.',
    ['l_cold'],
    3,
  ),
  post(
    3,
    'Your first line decides whether the rest gets read. Here are 9 openers that sound like a person, not a sequence.',
    ['l_cold', 'l_write'],
    6,
  ),
  post(
    4,
    'Personalization isn’t their name and company. It’s showing you understand the job they’re trying to get done.',
    ['l_cold'],
    9,
  ),
  post(
    5,
    'The follow-up that revived a deal after 4 months of silence. Short, specific, and easy to say yes to.',
    ['l_cold', 'l_swipe'],
    14,
  ),
  post(6, 'Best discovery question I’ve heard: "What happens if you do nothing?" Then stay quiet.', ['l_disc'], 2),
  post(7, 'Hiring lesson: ask candidates what they changed their mind about this year.', ['l_hire'], 4),
  post(8, 'A simple way to use AI for account research without sounding like a robot in your outreach.', ['l_ai'], 5),
  post(9, 'Write like you talk, then cut every sentence that doesn’t earn its place.', ['l_write'], 8),
  post(10, 'Open saved post placeholder', ['l_swipe'], 11),
];
posts[9].excerpt = '';
// Full text, a note and a pin, as a real library would have.
posts[0].text =
  'Stop opening cold emails with "I hope this finds you well."\n\nLead with the problem you noticed and why it matters to them now. One line on the trigger, one on the proof, one easy question.\n\nThe best replies I get come from emails that read like a note from a colleague, not a sequence.';
posts[0].note = 'Use this opener framework for the Q3 outbound push';
posts[0].pinnedAt = now;
posts[1].text =
  'Three-line cold email that booked 14 meetings last quarter: the trigger, the proof, one easy question.\n\nTemplate inside. Steal it, tweak the trigger for your market, and keep it under 75 words.';
posts[1].pinnedAt = now - 1000;
// Every sample post has its full text (no "only part of this post" notes).
for (const p of posts) if (!p.text && p.excerpt) p.text = p.excerpt;
posts[2].text =
  'Your first line decides whether the rest gets read. Here are 9 openers that sound like a person, not a sequence.';
// Sample authors (made-up people) with simple initial avatars, and two post images.
const svg = body => `data:image/svg+xml;base64,${Buffer.from(body).toString('base64')}`;
const face = (bg, letters) =>
  svg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${bg}"/><text x="48" y="60" font-size="36" text-anchor="middle" fill="#fff" font-family="Arial" font-weight="700">${letters}</text></svg>`,
  );
const chart = svg(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="560"><rect width="1200" height="560" fill="#f1edfb"/><text x="80" y="110" font-size="44" font-family="Arial" font-weight="700" fill="#2b2540">Reply rate by first line</text>${[
    220, 320, 180, 400, 290,
  ]
    .map(
      (v, i) =>
        `<rect x="${110 + i * 210}" y="${480 - v}" width="130" height="${v}" rx="10" fill="${i === 3 ? '#6d4fc2' : '#c9bdf0'}"/>`,
    )
    .join('')}</svg>`,
);
const people = {
  maya: {
    name: 'Maya Chen',
    headline: 'VP Sales at Northwind | Outbound that sounds human',
    avatar: face('#7c5cd6', 'MC'),
  },
  ravi: {
    name: 'Ravi Patel',
    headline: 'Founder, Pipeline Lab | Cold email & discovery coach',
    avatar: face('#22a06b', 'RP'),
  },
  sara: {
    name: 'Sara Lind',
    headline: 'Head of Talent | Hiring for early-stage startups',
    avatar: face('#f08c00', 'SL'),
  },
  tom: {
    name: 'Tom Okafor',
    headline: 'Writer | I help founders write posts people finish',
    avatar: face('#3b82f6', 'TO'),
  },
};
const byAuthor = ['maya', 'ravi', 'ravi', 'maya', 'ravi', 'maya', 'sara', 'tom', 'tom', 'sara'];
posts.forEach((p, i) => (p.author = people[byAuthor[i]]));
posts[1].image = chart;

const data = {
  version: 1,
  labels: Object.fromEntries(Object.values(L).map(l => [l.id, l])),
  posts: Object.fromEntries(posts.map(p => [p.id, p])),
};

const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: 'chromium',
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--headless=new'],
});
try {
  await context.route('https://www.linkedin.com/**', r =>
    r.fulfill({ contentType: 'text/html', body: readFileSync(join(out, 'demo-feed.html')) }),
  );
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;

  // The Library.
  const page = await context.newPage();
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.goto(`chrome-extension://${extId}/library.html`);
  await page.evaluate(d => chrome.storage.local.set({ 'labels.data.v1': d }), data);
  await page.reload();
  await page.locator('.card').first().waitFor();
  await page.waitForTimeout(300);
  const shotView = async () => `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
  const libraryView = await shotView();
  await page.getByRole('searchbox', { name: 'Search posts' }).fill('cold email');
  const searchView = await shotView();
  await page.getByRole('searchbox', { name: 'Search posts' }).fill('');
  await page.locator('.nav-item', { hasText: 'Ravi Patel' }).click();
  const peopleView = await shotView();
  await page.locator('.nav-item', { hasText: 'All Posts' }).click();
  await page.locator('.card').first().getByRole('button', { name: 'Edit labels' }).click();
  const editView = await shotView();

  // The Label button and picker on a sample feed.
  const feed = await context.newPage();
  await feed.setViewportSize({ width: 900, height: 860 });
  await feed.goto('https://www.linkedin.com/feed/');
  const button = feed.locator('[data-labels-post="urn:li:activity:7511803322715041792"] button');
  await button.waitFor();
  await button.click();
  const panel = feed.locator('[data-labels-ui="panel"] .panel');
  await panel.locator('label', { hasText: 'Cold email' }).waitFor();
  await panel.locator('label', { hasText: 'Cold email' }).locator('input').check();
  await panel.locator('label', { hasText: 'Swipe file' }).locator('input').check();
  await feed.evaluate(() => window.scrollTo(0, 0));
  const feedShot = `data:image/png;base64,${(await feed.screenshot()).toString('base64')}`;
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await panel.getByText('Saved ✓').waitFor();
  const feedSaved = `data:image/png;base64,${(await feed.screenshot()).toString('base64')}`;

  const icon = `data:image/png;base64,${readFileSync(join(root, 'icons', 'icon-128.png')).toString('base64')}`;

  // Compose at 1x so the files are exactly the sizes the store asks for.
  const composer = await chromium.launch({ channel: 'chromium' });
  const compose = await composer.newPage({ deviceScaleFactor: 1 });
  const render = async (name, width, height, html) => {
    await compose.setViewportSize({ width, height });
    await compose.setContent(`<!doctype html><html><head><style>
      * { box-sizing: border-box; }
      body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1c1b22;
        background: linear-gradient(135deg, #f6f3fd 0%, #ece6fa 100%); }
      .row { display: flex; align-items: center; height: 100%; padding: 0 72px; gap: 56px; }
      .copy { flex: 0 0 360px; }
      .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 22px; color: #5c40ab; margin-bottom: 28px; }
      .brand img { width: 36px; height: 36px; }
      h1 { font-size: 44px; line-height: 1.12; margin: 0 0 18px; letter-spacing: -0.02em; }
      p { font-size: 20px; line-height: 1.5; color: #4a4955; margin: 0; }
      .shot { flex: 1; display: flex; justify-content: center; align-items: center; gap: 28px; }
      .shot img { border-radius: 14px; box-shadow: 0 24px 60px rgba(60, 40, 120, 0.22); background: #fff; }
    </style></head><body>${html}</body></html>`);
    await compose.waitForFunction(() => [...document.images].every(i => i.complete));
    await compose.screenshot({ path: join(out, name), type: 'jpeg', quality: 92 });
    console.log(`Wrote store/${name}`);
  };
  const slide = (title, text, images) => `<div class="row">
      <div class="copy"><div class="brand"><img src="${icon}">Labels</div><h1>${title}</h1><p>${text}</p></div>
      <div class="shot">${images}</div></div>`;

  await render(
    'screenshot-1-save.jpg',
    1280,
    800,
    slide(
      'Save any post in one click',
      'Click Label under a post in your feed, pick your labels and save. No more endless Saved list.',
      `<img src="${feedShot}" style="height:690px">`,
    ),
  );
  const wide = src => `<img src="${src}" style="width:740px">`;
  await render(
    'screenshot-2-labels.jpg',
    1280,
    800,
    slide(
      'Your Library, all in one place',
      'Click the Labels icon: every saved post as a card, with its author, image, text and labels.',
      wide(libraryView),
    ),
  );
  await render(
    'screenshot-3-find.jpg',
    1280,
    800,
    slide(
      'Find it again in seconds',
      'Search the full text of every post you saved, plus authors and labels.',
      wide(searchView),
    ),
  );
  await render(
    'screenshot-4-organize.jpg',
    1280,
    800,
    slide(
      'Sort by label or by person',
      'See everything from one label, or every post you saved from one person.',
      wide(peopleView),
    ),
  );
  await render(
    'screenshot-5-private.jpg',
    1280,
    800,
    slide(
      'Private by design',
      'No account. Everything stays in your browser on your device. Export a backup whenever you like.',
      wide(editView),
    ),
  );

  await render(
    'promo-small-440x280.jpg',
    440,
    280,
    `<div style="height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 36px;background:linear-gradient(135deg,#6d4fc2,#4f3596);color:#fff">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px"><img src="${icon}" style="width:56px;height:56px;border-radius:14px;box-shadow:0 0 0 2px rgba(255,255,255,.35)">
      <span style="font-size:34px;font-weight:700;letter-spacing:-0.01em">Labels</span></div>
      <div style="font-size:21px;line-height:1.35;font-weight:500;opacity:.95">Save LinkedIn posts with your own labels. Find them in seconds.</div></div>`,
  );
  await render(
    'promo-marquee-1400x560.jpg',
    1400,
    560,
    `<div style="height:100%;display:flex;align-items:center;gap:64px;padding:0 80px;background:linear-gradient(135deg,#6d4fc2,#4f3596);color:#fff">
      <div style="flex:0 0 470px"><div style="display:flex;align-items:center;gap:16px;margin-bottom:22px"><img src="${icon}" style="width:64px;height:64px;border-radius:16px;box-shadow:0 0 0 2px rgba(255,255,255,.35)">
      <span style="font-size:40px;font-weight:700">Labels</span></div>
      <div style="font-size:44px;line-height:1.12;font-weight:700;letter-spacing:-0.02em;margin-bottom:16px">Stop losing the posts worth keeping.</div>
      <div style="font-size:21px;line-height:1.45;opacity:.92">One-click labels in your LinkedIn feed. Private, on your device.</div></div>
      <div style="flex:1;display:flex;justify-content:center"><img src="${feedSaved}" style="height:480px;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.35)"></div></div>`,
  );
  await composer.close();
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
