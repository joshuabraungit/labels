# Labels

A small Chrome extension (Manifest V3) for saving LinkedIn posts with your own labels and finding them later.

**Save:** open a LinkedIn post on its own page → click the Labels toolbar icon → pick labels → Save.

**Find:** click Labels → Your labels → click a label → click a preview to open the original post.

Labels uses its own save action. It doesn't touch LinkedIn's Save button or Saved posts list, and it doesn't import posts you saved on LinkedIn before.

## Install (unpacked)

1. Download `release/labels-extension-1.0.1.zip` and unzip it. You should get a folder with `manifest.json` at the top.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped folder.
5. Click the puzzle icon in the toolbar and pin **Labels** so the button is always visible.

To update, unzip the new version over the same folder and click the reload icon on the Labels card in `chrome://extensions`. Your saves are kept. (Removing the extension can delete them, so export a backup first.)

## How it works

- **Which post gets saved.** The popup only offers saving on an individual post page:
  - `linkedin.com/feed/update/urn:li:activity:…` (also `share:` and `ugcPost:`)
  - `linkedin.com/posts/<name>_<words>-activity-…`

  On the feed, a profile, search or any other page it shows _"Open the LinkedIn post you want to save, then click Labels."_ It never guesses which feed post you meant. To get to a post's own page, click its timestamp, or use **… → Copy link to post** and open that link.

- **Stable ID and link.** The post's URN (for example `urn:li:activity:7212345678901234567`) is the record ID, so saving the same post again updates it instead of creating a duplicate. Query strings and fragments (`utm_source`, `rcm`, `#comments`, …) are stripped from the stored link.
- **Excerpt.** When you click the toolbar button, a one-off script reads the visible text of that one post: no comments, author info, images or other posts. Line breaks become spaces and the excerpt stops at a word boundary within 160 characters, with `…` if it was cut. It tries LinkedIn's known post-text elements first, then the page's own description of that post, then a layout-based search between the post header and its reactions bar, and finally the tab title (with the author's name removed). If nothing is found (image-only posts, a LinkedIn layout it doesn't recognize), you can still save: the preview reads **Open saved post · saved <date>**, and it fills in automatically the next time you open that post and click Labels. The Save view also offers **Copy page info**, a text-free outline of the page layout (no post text or names) that can be shared to adjust the reader.
- **If the link can't be identified** (a post-looking page without a usable ID), saving is blocked with an error.
- **Uncategorized** holds saved posts with no labels. It can't be renamed or deleted.
- **Labels** are unique ignoring capitalization and surrounding spaces. "Uncategorized" is reserved.
- **Deleting a label** keeps every saved post. Posts left without any label show up in Uncategorized.
- **Deleted LinkedIn posts.** The saved link and excerpt stay in Labels, but Labels can't restore content LinkedIn has removed or made private.

## Storage and privacy

- Everything is stored in `chrome.storage.local` in this Chrome profile. No account, no server, nothing sent anywhere.
- Saves persist across browser restarts but don't sync between devices.
- Uninstalling the extension can remove the data. Use **Help → Export backup** to keep a copy.
- **Import backup** (Help) validates the whole file before changing anything, then merges: posts are matched by ID, labels by name (ignoring case), and nothing gets duplicated. Import opens in a tab because Chrome closes toolbar popups when a file picker opens.

### Permissions

| Permission  | Why                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------- |
| `storage`   | Keep your labels and saved posts locally.                                                 |
| `activeTab` | Read the current tab's URL and text, only after you click the Labels button.              |
| `scripting` | Run the one-off excerpt reader in that tab (only possible while `activeTab` is granted). |

No host permissions, no history, no cookies, no content scripts. Nothing is injected into LinkedIn pages unless you click the button, and Labels doesn't automate LinkedIn or crawl posts.

Labels is an independent tool. It isn't affiliated with or endorsed by LinkedIn, and reading a post's visible text when you click the button isn't something LinkedIn has approved.

## Files

```
manifest.json      MV3 manifest
popup.html/.css/.js  Toolbar popup (Save this post, Your labels, label screen, Help)
lib/post.js        Post URL detection, URL normalization, excerpt rules
lib/capture.js     Function injected on click to read the post's visible text
lib/store.js       Storage, labels, Uncategorized, backup export/import
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

1. Open your feed and click Labels: it should open on Your labels, and Save this post should show the "Open the LinkedIn post…" message.
2. Click a post's timestamp to open it on its own page, click Labels: the preview should match that post's first lines (not a comment).
3. Create two labels, save, then reopen the popup: it should say Update with both labels checked.
4. Open the label and click the preview: the same post should open in a new tab.
5. Rename and delete labels and confirm the posts move as expected (Uncategorized when no labels remain).
6. Quit and restart Chrome: everything should still be there.
7. Export a backup, import it again: the counts shouldn't change.
