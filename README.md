# Labels

A Chrome extension (Manifest V3) for saving LinkedIn posts with your own labels and finding them later.

It has two parts:

1. **On LinkedIn, the Label button.** Every post gets a purple **Label** button. Click it, type to find or create a label, tick, **Save**. The button then shows the post's labels (for example **Cold email** or **Cold email +2**). Keyboard: **Alt+Shift+L** (⌥⇧L on Mac) opens it for the post under your mouse.
2. **Your Library.** Click the Labels icon in Chrome's toolbar (or **Library** in the picker). It opens in a tab:
   - **Left:** All Posts, your labels (with counts, **+** to add, ⋯ to rename or delete), the people you've saved posts from, and Export / Import.
   - **Right:** a search box and every saved post as a card: the author's photo, name and headline, when you saved it, the post's image, its text (**Expand** for long posts) and its labels. Each card has **Open** (on LinkedIn), **Edit labels** and delete.

**Posts you saved with LinkedIn's own Save button:** open LinkedIn's Saved posts page (`linkedin.com/my-items/saved-posts/`) and scroll down until everything you want has loaded. A bar at the bottom says **Add N posts to Labels**; one click brings them all in under **To sort**, with their text, author and image. Then click **Sort N posts** (or **Start sorting** in the Library) to go through them one at a time: number keys **1–9** tick labels, **/** finds or creates one, **Enter** saves and moves on, **S** skips, **Delete** removes. A post leaves To sort as soon as it has a real label, and To sort disappears when it's empty. LinkedIn's own Saved list isn't changed.

Every saved post has at least one label. Deleting a label warns you first and says how many posts go with it (posts with other labels keep them).

## Install (unpacked)

1. Download `release/labels-extension-3.2.0.zip` and unzip it. You should get a folder with `manifest.json` at the top.
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Click the puzzle icon in the toolbar and pin **Labels** so the Library is one click away.

To update, unzip the new version over the same folder and click the reload icon on the Labels card in `chrome://extensions`. Your saves are kept. (Removing the extension can delete them, so export a backup first.)

## How it works

- **Which post gets saved.** A post only gets a Label button when its LinkedIn post ID (for example `urn:li:activity:…`) can be found in the page, so a click always saves the post the button sits on. Single post pages and LinkedIn's Saved posts page get buttons too. The post ID is the record ID, so saving the same post again updates it instead of making a duplicate. Tracking parameters are stripped from the stored link.
- **What's read.** When you open a post's picker, Labels reads that one post: its visible text (it clicks the post's own "…see more" first so it gets the whole thing, up to 4,000 characters), its author's name, headline and photo, and its main image. Never comments or other posts. If you open the picker on a post you saved earlier, anything newer or longer is filled in automatically.
- **Pictures.** Labels saves the links to the author's photo and the post's image, not the images themselves. The Library loads them from LinkedIn's image servers when you look at it. LinkedIn's image links can expire; then the Library shows the author's initials and no image.
- **Search** looks through post text, author names and headlines, and label names.

## Storage and privacy

- Everything is stored in `chrome.storage.local` in this Chrome profile. No account, no server, no analytics.
- Saves persist across browser restarts but don't sync between devices. Use **Export** to keep a backup; **Import** validates the whole file first, then merges without duplicates.

| Permission / access                  | Why                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `storage`                            | Keep your labels and saved posts locally.                               |
| Content script on `www.linkedin.com` | Add the Label button to posts and show the picker. Nothing runs on other sites. |

Chrome shows **"Read and change your data on www.linkedin.com"** at install, because of the Label buttons. The only thing Labels clicks on LinkedIn is the "…see more" link of the post you're labeling.

Labels is an independent tool. It isn't affiliated with or endorsed by LinkedIn. If LinkedIn changes its page layout, the buttons may stop appearing until Labels is updated.

## Files

```
manifest.json      MV3 manifest
background.js      Storage requests from the Label buttons; opens the Library
content.js         Label buttons and picker on linkedin.com
library.html/.css/.js  The Library page
lib/capture.js     Finds posts and their IDs; reads a post's text, author and image
lib/post.js        Post URL detection and excerpt rules
lib/store.js       Storage, labels, search, backup export/import
icons/             Icons
scripts/           build-zip.sh, make-icons.mjs, make-store-images.mjs
tests/             Unit tests and a Chromium end-to-end test (not shipped in the zip)
```

## Development

No build step. Edit the files and reload the extension.

```bash
node --test tests/unit.test.mjs   # logic tests
node tests/e2e.mjs                # end-to-end in Chromium (needs Playwright)
./scripts/build-zip.sh            # writes release/labels-extension-<version>.zip
```

The end-to-end test serves LinkedIn-shaped fixture pages in place of linkedin.com (automation can't log in to LinkedIn), from a temporary copy of the extension. The shipped files are never changed.

## Manual check in Chrome

1. Open your feed and click **Label** on a long post. Create a label and Save: the button shows the label's name.
2. Click the Labels toolbar icon: the Library opens with that post's author, headline, photo, image and full text.
3. Search for a word from the end of the post: it's found.
4. Click the author under People: only their posts show.
5. Edit labels on the card, rename and delete a label: the counts update.
6. Restart Chrome: everything is still there. Export, then Import the file: nothing is duplicated.
