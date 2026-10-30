# WellWrite

A private desktop journal for Windows. Every entry is encrypted with your password and stays on your computer.

## Install

Run **WellWrite-Setup.exe**. Because the app isn't code-signed, Windows SmartScreen may say "Windows protected your PC" — click **More info → Run anyway**.

Prefer no installer? **WellWrite-Portable.exe** runs on its own (your journal is still saved in your user folder, not next to the exe).

## What it does

- **Calendar** — gold dots mark days you wrote. Click a day to see its entries, or write one for that date.
- **Search and tags** — search titles, tags and full text as you type. Click a tag to filter. Type `#tag` in search to match tags.
- **On this day** — shows what you wrote on today's date in earlier years.
- **Categories** — give each entry one category (like a section of a notebook), each with its own colour. Filter the sidebar by category, and edit or delete categories in Settings.
- **Links between entries** — type `[[` (or use the toolbar button) to link to another entry, or create a new one on the spot. Links show the other entry's current title; click one to open it, then "Back" to return. Under every entry you'll see the entries that link to it, the ones it links to, and ones that share its tags.
- **Tags** — click a tag on an entry to see every entry with that tag.
- **Rich text** — bold, italic, underline, strikethrough, headings, quotes, lists, highlight, links, section breaks.
- **Photos** — add with the toolbar button, paste, or drag in. Large photos are resized to keep the journal light. Double-click a photo to view it full size.
- **Autosave** — saves as you type. Change an entry's date or time by clicking it.
- **Lock** — locks after inactivity (you choose how long), when Windows locks or sleeps, and optionally when minimised. Ctrl+L locks now.
- **Automatic backups** — to Google Drive (a "WellWrite backups" folder in your Drive), to a folder on this computer or a USB drive, or both. Daily, weekly or each time you close WellWrite, only when something changed, keeping the newest 5, 10 or 30 in each place. Each place keeps its own schedule, so an unplugged USB drive doesn't stop Drive backups. They run even while the journal is locked, because backups are the already-encrypted files.
- **Backup files** — Settings → Save a backup file makes one encrypted `.wellwrite` file (backups from when the app was called Daybook, `.daybook`, still work). Import merges a backup into your journal (newer versions win). On a new computer, choose "Restore from a backup instead" at setup and pick Google Drive or a file.
- **Readable export** — one web page with every entry and photo, for printing or keeping. It is not encrypted.
- **Spell check** with right-click suggestions, light/dark themes, adjustable text size, writing streak and word counts.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl+N | New entry |
| Ctrl+F | Search |
| Ctrl+L | Lock |
| Ctrl+S | Save now |
| Ctrl+K | Add link |
| Ctrl+B / I / U | Bold / italic / underline |
| Ctrl+, | Settings |
| Ctrl+click | Open a link in your browser |

## Security

- Your password is turned into a key with scrypt; a random 256-bit key encrypts every entry and the search index with AES-256-GCM. Changing your password re-wraps that key, so it's instant.
- Nothing readable is written to disk while you use the app. Locking wipes the key from memory and clears the screen.
- **There is no password recovery.** If you forget it, your entries cannot be opened — keep a backup and write the password down somewhere safe.
- Journal folder: `%APPDATA%\WellWrite\journal` (Settings → Show folder).

## Building from source

Requires Node.js 20+.

```
npm install
npm start            # run the app
npm test             # encryption and storage tests
npm run dist         # build the Windows installer into dist/
```

Building the Windows installer on Linux/macOS needs Wine (64- and 32-bit).

## Google Drive setup (for builds)

Google Drive backups need an OAuth client from Google Cloud (type: Desktop app, scope `drive.file`, publishing status: In production). Add its values as repository secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; the release workflow writes them into `src/google-config.json` (not committed). For local runs, set `WELLWRITE_GOOGLE_CLIENT_ID` and `WELLWRITE_GOOGLE_CLIENT_SECRET`. Without them, WellWrite still works and offers folder backups only.

## Releasing an update

Bump `version` in `package.json`, commit and push to `main`. GitHub Actions (`.github/workflows/release.yml`) runs the tests, builds the installer on Windows and publishes it as release `v<version>`.

Installed copies check for updates a few seconds after launch and every 6 hours, download in the background, and offer "Restart to update".
