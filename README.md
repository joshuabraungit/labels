# Labels

A small Chrome extension (Manifest V3) for saving LinkedIn posts with your own labels and finding them later.

**Save from the feed:** click the purple **Label** button under any post → pick labels → Save.

In the picker, labels that already have posts show a count like `3 ›`. Click it to see that label's posts right in the picker (click one to open the original post in a new tab). Each row has a **✕** that removes the post from that label. Its other labels stay; if it was the post's last label, the saved post is deleted. **‹ Back** or **Esc** returns to the picker. Clicking the label name still just ticks the box.

**Posts you saved with LinkedIn's own Save button:** open LinkedIn's Saved posts page (`linkedin.com/my-items/saved-posts/`). Each post there gets a Label button next to its ••• menu. To label many at once, click **Select posts to label** in the bar at the bottom, tick posts (or **Select all**), click **Label N posts** and pick labels; they're added to every selected post. Labels doesn't import them automatically and doesn't change LinkedIn's saved list.

**Or from the keyboard:** press **Alt+Shift+L** (⌥⇧L on Mac) to open the picker for the post under your mouse, or the one filling most of the screen. That post is outlined in purple while the picker is open. Then type to filter your labels: **Enter** ticks the highlighted one (↑/↓ to move), typing a name that doesn't exist offers **Create "name"**, **Backspace** in the empty box unticks the last label you added, and **Enter** on an empty box (or **Ctrl/⌘+Enter** anytime) saves, shows **Saved ✓** with the labels for a moment, then closes by itself (move the mouse over it or press a key to keep it open). **Esc** closes without saving. Change the shortcut at `chrome://extensions/shortcuts`. Off LinkedIn, the shortcut opens the Labels popup.

**Or from a post page:** open a LinkedIn post on its own page → click the Labels toolbar icon. The popup shows **Save this post** above your labels.

The toolbar popup opens to **Your labels**. "Save this post" only appears there when the tab shows a single post; on the feed you save with the Label buttons or the shortcut.

**Find:** click Labels → Your labels → click a label → click a preview to open the original post. Or type in **Search saved posts**: it looks through each post's full text, your notes and label names. The ↗ button in the popup opens a **full-page view** in a tab, with your labels on the left and full post text on the right.

**Feed buttons** show the post's labels once it's saved (for example **Cold email** or **Cold email +2**; hover for the full list).

Labels uses its own save action. It doesn't touch LinkedIn's Save button or Saved posts list, and it doesn't import posts you saved on LinkedIn before.

## Install (unpacked)

1. Download `release/labels-extension-1.8.0.zip` and unzip it. You should get a folder with `manifest.json` at the top.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped folder.
5. Click the puzzle icon in the toolbar and pin **Labels** so the button is always visible.

To update, unzip the new version over the same folder and click the reload icon on the Labels card in `chrome://extensions`. Your saves are kept. (Removing the extension can delete them, so export a backup first.)

## How it works

- **Which post gets saved.** Labels adds a small **Label** button after the reactions bar (Like · Comment · Repost · Send) of each post on linkedin.com. A post only gets a button when its LinkedIn post ID (for example `urn:li:activity:…`) can be found in the page, in an attribute or a link such as the timestamp. Posts without one (some ads, for example) get no button, so a click always saves the post the button sits on. Reshared posts get one button, for the outer post.

  The toolbar popup also saves on an individual post page:
  - `linkedin.com/feed/update/urn:li:activity:…` (also `share:` and `ugcPost:`)
  - `linkedin.com/posts/<name>_<words>-activity-…`

  On other pages it shows _"Click the Label button on any post to save it. Or open a post and click Labels here."_ It never guesses which post you meant.

- **Stable ID and link.** The post's URN (for example `urn:li:activity:7212345678901234567`) is the record ID, so saving the same post again updates it instead of creating a duplicate. Query strings and fragments (`utm_source`, `rcm`, `#comments`, …) are stripped from the stored link.
- **Excerpt.** When you click the toolbar button, a one-off script reads the visible text of that one post: no comments, author info, images or other posts. Line breaks become spaces and the excerpt stops at a word boundary within 160 characters, with `…` if it was cut. It tries LinkedIn's known post-text elements first, then the page's own description of that post, then a layout-based search between the post header and its reactions bar, and finally the tab title (with the author's name removed). If nothing is found (image-only posts, a LinkedIn layout it doesn't recognize), you can still save: the preview reads **Open saved post · saved <date>**, and it fills in automatically the next time you open that post and click Labels. The Save view also offers **Copy page info**, a text-free outline of the page layout (no post text or names) that can be shared to adjust the reader.
- **If the link can't be identified** (a post-looking page without a usable ID), saving is blocked with an error.
- **Full text.** Besides the 160-character preview, Labels keeps the post's full visible text (up to 4,000 characters) for search and the full-page view. A collapsed post ("…see more") gives less text; a later, longer capture replaces it, a shorter one never does.
- **Notes.** Use **Add note** in a post's ⋯ menu for a line about why you saved it. Notes show under the preview, are searchable, and are kept in backups and copied lists.
- **Label colors and Copy as list.** A label's ••• menu has color swatches (shown as dots everywhere the label appears) and **Copy as list**, which copies its posts as Markdown links (with notes) to paste into a doc or chat.
- **Pinned posts.** Hover a post in any label's list (popup or picker) and click the pin icon, or use **Pin** in a post's ⋯ menu. Pinned posts sit at the top of every label they're in, and a **Pinned** row at the top of your labels lists them all. Pins are kept in backups.
- **Every saved post has at least one label.** Save stays greyed out until you pick or create one. Untick all of a saved post's labels and the button turns into **Remove from Labels**.
- **Labels** are unique ignoring capitalization and surrounding spaces.
- **Deleting a label** works from the trash icon that shows when you hover a label (in the popup's label list or the picker), or from a label's ••• menu. Either way you get a warning that says how many posts have that label. Posts with no other label are deleted along with it; posts with other labels keep them.
- **Deleted LinkedIn posts.** The saved link and excerpt stay in Labels, but Labels can't restore content LinkedIn has removed or made private.

## Storage and privacy

- Everything is stored in `chrome.storage.local` in this Chrome profile. No account, no server, nothing sent anywhere.
- Saves persist across browser restarts but don't sync between devices.
- Uninstalling the extension can remove the data. Use **Help → Export backup** to keep a copy.
- **Import backup** (Help) validates the whole file before changing anything, then merges: posts are matched by ID, labels by name (ignoring case), and nothing gets duplicated. Import opens in a tab because Chrome closes toolbar popups when a file picker opens.

### Permissions

Chrome shows **"Read and change your data on www.linkedin.com"** at install, because of the Label buttons.

| Permission / access          | Why                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `storage`                    | Keep your labels and saved posts locally.                                            |
| Content script on `www.linkedin.com` | Add the Label button to posts and show the label picker. Nothing runs on other sites. |
| `activeTab` + `scripting`    | Let the toolbar popup read the current post when you click it.                       |

No history, no cookies, no other sites. The content script only adds the Label buttons. It reads a post's text only when you click Label (or the toolbar button), and it doesn't click, fetch, scroll or automate anything on LinkedIn.

Labels is an independent tool. It isn't affiliated with or endorsed by LinkedIn, and adding buttons to LinkedIn pages or reading a post's visible text isn't something LinkedIn has approved. If LinkedIn changes its page layout, the buttons may stop appearing until Labels is updated. The toolbar popup still works on post pages, and **Copy page info** (in the popup on any LinkedIn page) gives a text-free outline of the page to help fix it.

## Files

```
manifest.json      MV3 manifest
background.js      Storage requests from the Label buttons
content.js         Label buttons and picker on linkedin.com
popup.html/.css/.js  Toolbar popup (Save this post, Your labels, label screen, Help)
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

The end-to-end test loads the extension in Chromium and serves LinkedIn-shaped fixture pages in place of linkedin.com, since automation can't log in to LinkedIn or click the toolbar button. For that it gives a temporary copy of the extension host access to linkedin.com and points the popup at the fixture tab. The shipped files are never changed.

## Manual check in Chrome

The automated tests use fixture pages, so do one pass on real LinkedIn after installing:

1. Open your feed: posts should have a purple **Label** button after Like · Comment · Repost · Send. Click one, create a label and Save: the button turns into **Labeled** and the post shows up under that label in the popup.
2. Click a post's timestamp to open it on its own page, click Labels: the preview should match that post's first lines (not a comment).
3. Create two labels, save, then reopen the popup: it should say Update with both labels checked.
4. Open the label and click the preview: the same post should open in a new tab.
5. Rename and delete labels and confirm the posts update as expected (posts left with no label are removed).
6. Quit and restart Chrome: everything should still be there.
7. Export a backup, import it again: the counts shouldn't change.
