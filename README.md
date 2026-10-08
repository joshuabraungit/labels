# Labels

A small Chrome extension (Manifest V3) for saving LinkedIn posts with your own labels and finding them later.

Labels has two parts:

- **On LinkedIn: the Label button and picker**, for labeling. Every post gets a purple **Label** button. Click it, type to find or create a label, tick, Save. The button then shows the post's labels (for example **Cold email** or **Cold email +2**).
- **Beside LinkedIn: your Library**, for finding and organizing. Click the Labels icon in Chrome's toolbar (or **Library** in the picker) and the Library opens in Chrome's side panel, docked next to the page. It stays open while you browse.

**From the keyboard:** press **Alt+Shift+L** (⌥⇧L on Mac) to open the picker for the post under your mouse, or the one filling most of the screen. That post is outlined in purple while the picker is open. Then type to filter your labels: **Enter** ticks the highlighted one (↑/↓ to move), typing a name that doesn't exist offers **Create "name"**, **Backspace** in the empty box unticks the last label you added, and **Enter** on an empty box (or **Ctrl/⌘+Enter** anytime) saves, shows **Saved ✓** with the labels for a moment, then closes by itself (move the mouse over it or press a key to keep it open). **Esc** closes without saving. Change the shortcut at `chrome://extensions/shortcuts`. Off LinkedIn, the shortcut opens the Library.

**In the Library:** search every saved post (full text, notes and label names), click a label to read its posts in full, and click a post to open it in the tab next to the panel. Each post's ⋯ menu pins it, adds a note, edits its labels or removes it. A label's ••• menu sets its color, copies it as a list, renames or deletes it. The ↗ button opens the same Library as a full page in a tab, for big screens. Backup export/import and Help are under **?**.

**Posts you saved with LinkedIn's own Save button:** open LinkedIn's Saved posts page (`linkedin.com/my-items/saved-posts/`). Each post there gets a Label button next to its ••• menu. To label many at once, click **Select posts to label** in the bar at the bottom, tick posts (or **Select all**), click **Label N posts** and pick labels; they're added to every selected post. Labels doesn't import them automatically and doesn't change LinkedIn's saved list.

Labels uses its own save action. It doesn't touch LinkedIn's Save button or Saved posts list.

## Install (unpacked)

1. Download `release/labels-extension-1.8.0.zip` and unzip it. You should get a folder with `manifest.json` at the top.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped folder.
5. Click the puzzle icon in the toolbar and pin **Labels** so the Library is one click away. (Needs Chrome 116 or newer for the side panel.)

To update, unzip the new version over the same folder and click the reload icon on the Labels card in `chrome://extensions`. Your saves are kept. (Removing the extension can delete them, so export a backup first.)

## How it works

- **Which post gets saved.** Labels adds a small **Label** button after the reactions bar (Like · Comment · Repost · Send) of each post on linkedin.com. A post only gets a button when its LinkedIn post ID (for example `urn:li:activity:…`) can be found in the page, in an attribute or a link such as the timestamp. Posts without one (some ads, for example) get no button, so a click always saves the post the button sits on. Reshared posts get one button, for the outer post.

  Single post pages (`linkedin.com/feed/update/…`, `linkedin.com/posts/…`) get a Label button too. Labels never guesses which post you meant.

- **Stable ID and link.** The post's URN (for example `urn:li:activity:7212345678901234567`) is the record ID, so saving the same post again updates it instead of creating a duplicate. Query strings and fragments (`utm_source`, `rcm`, `#comments`, …) are stripped from the stored link.
- **Excerpt.** When you label a post, Labels reads the visible text of that one post: no comments, author info, images or other posts. The preview stops at a word boundary within 160 characters, with `…` if it was cut. It tries LinkedIn's known post-text elements first, then a layout-based search between the post header and its reactions bar. If nothing is found (image-only posts, a LinkedIn layout it doesn't recognize), you can still save: the preview reads **Open saved post · saved <date>**, and it fills in the next time you open that post's picker. **Copy page info** (Help, in the Library, with a LinkedIn tab open) copies a text-free outline of the page layout (no post text or names) that can be shared to adjust the reader.
- **If the link can't be identified** (a post-looking page without a usable ID), saving is blocked with an error.
- **Full text.** Besides the 160-character preview, Labels keeps the post's full visible text (up to 4,000 characters) for search and the Library. LinkedIn collapses long posts behind "…see more", so when you label a post Labels clicks that link first and then reads the whole post. A later, longer capture replaces the saved text; a shorter one never does. In the Library, posts that only have part of their text (saved before 1.8.0, or cut off) say so; open their Label picker on LinkedIn once and the rest is saved, no changes needed.
- **Notes.** Use **Add note** in a post's ⋯ menu for a line about why you saved it. Notes show under the preview, are searchable, and are kept in backups and copied lists.
- **Label colors and Copy as list.** A label's ••• menu has color swatches (shown as dots everywhere the label appears) and **Copy as list**, which copies its posts as Markdown links (with notes) to paste into a doc or chat.
- **Pinned posts.** Hover a post in the Library and click the pin icon, or use **Pin** in a post's ⋯ menu. Pinned posts sit at the top of every label they're in, and a **Pinned** row at the top of your labels lists them all. Pins are kept in backups.
- **Every saved post has at least one label.** Save stays greyed out until you pick or create one. Untick all of a saved post's labels and the button turns into **Remove from Labels**.
- **Labels** are unique ignoring capitalization and surrounding spaces.
- **Deleting a label** works from the trash icon that shows when you hover a label in the Library, or from a label's ••• menu. Either way you get a warning that says how many posts have that label. Posts with no other label are deleted along with it; posts with other labels keep them.
- **Deleted LinkedIn posts.** The saved link and excerpt stay in Labels, but Labels can't restore content LinkedIn has removed or made private.

## Storage and privacy

- Everything is stored in `chrome.storage.local` in this Chrome profile. No account, no server, nothing sent anywhere.
- Saves persist across browser restarts but don't sync between devices.
- Uninstalling the extension can remove the data. Use **Help → Export backup** to keep a copy.
- **Import backup** (Help) validates the whole file before changing anything, then merges: posts are matched by ID, labels by name (ignoring case), and nothing gets duplicated. Import opens in a tab.

### Permissions

Chrome shows **"Read and change your data on www.linkedin.com"** at install, because of the Label buttons.

| Permission / access          | Why                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `storage`                    | Keep your labels and saved posts locally.                                            |
| Content script on `www.linkedin.com` | Add the Label button to posts and show the label picker. Nothing runs on other sites. |
| `sidePanel`                  | Show your Library in Chrome's side panel, next to the page.                          |

No history, no cookies, no other sites. The content script only adds the Label buttons. It reads a post's text only when you open that post's picker (Label button or shortcut). The only thing it clicks is that post's "…see more" link, so it can read the whole post; it doesn't fetch, scroll or automate anything else on LinkedIn.

Labels is an independent tool. It isn't affiliated with or endorsed by LinkedIn, and adding buttons to LinkedIn pages or reading a post's visible text isn't something LinkedIn has approved. If LinkedIn changes its page layout, the buttons may stop appearing until Labels is updated. **Copy page info** (Library → Help, with a LinkedIn tab open) gives a text-free outline of the page to help fix it.

## Files

```
manifest.json      MV3 manifest
background.js      Storage requests from the Label buttons; opens the Library
content.js         Label buttons and picker on linkedin.com
sidepanel.html     The Library in Chrome's side panel
popup.html/.css/.js  The Library's code (also popup.html?mode=page: the full-page Library)
lib/post.js        Post URL detection, URL normalization, excerpt rules
lib/capture.js     Finds posts and their IDs, reads a post's visible text (used by both)
lib/store.js       Storage, labels, backup export/import
icons/             Toolbar icons
scripts/           build-zip.sh, make-icons.mjs
tests/             Unit tests and a Chromium end-to-end test (not shipped in the zip)
```

## Development

No build step. Edit the files and reload the extension.

```bash
node --test tests/unit.test.mjs   # logic tests
node tests/e2e.mjs                # end-to-end in Chromium (needs Playwright)
./scripts/build-zip.sh            # writes release/labels-extension-<version>.zip
```

The end-to-end test loads the extension in Chromium and serves LinkedIn-shaped fixture pages in place of linkedin.com, since automation can't log in to LinkedIn or open the side panel. For that it gives a temporary copy of the extension host access to linkedin.com and opens the Library as a page pointed at a fixture tab. The shipped files are never changed.

## Manual check in Chrome

The automated tests use fixture pages, so do one pass on real LinkedIn after installing:

1. Open your feed: posts should have a purple **Label** button after Like · Comment · Repost · Send. Click one, create a label and Save: the button shows the label's name.
2. Click the Labels toolbar icon: the Library opens in the side panel and the post is under that label, with its full text (long posts too, since Labels expands "…see more").
3. Reopen the post's picker: it should say Saved ✓ with its labels ticked; change one and it says Update.
4. In the Library, click the post: it opens in the tab next to the panel, and the panel stays open.
5. Rename and delete labels and confirm the posts update as expected (posts left with no label are removed).
6. Quit and restart Chrome: everything should still be there.
7. Export a backup, import it again: the counts shouldn't change.
