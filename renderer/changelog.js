'use strict';
// What's new: every version of WellWrite, newest first. Shown in Settings → What's new, and written out to
// CHANGELOG.md by `npm run changelog`. Add the new version here whenever package.json's version changes
// (test/changelog.test.js checks this).
// Each version: { v, date (YYYY-MM-DD, Brisbane time), title, new: [], improved: [], fixed: [] }.
const WELLWRITE_CHANGELOG = [
  {
    v: '1.24.1', date: '2026-11-11', title: 'Handwriting on the phone',
    improved: [
      'On a phone the pen button comes first in the formatting bar above the keyboard, so it’s visible without scrolling.',
      '“Write by hand” is in the ⋯ menu too, so it doesn’t need the keyboard up.',
      'On a phone the writing page is wider than the screen so the lines are far enough apart to write between. Scroll it in any direction with a finger.',
      'The keyboard goes away while you write by hand.',
    ],
  },
  {
    v: '1.24.0', date: '2026-11-11', title: 'What’s new',
    new: ['Settings → What’s new: every version of WellWrite since the first, with what was added, improved and fixed, and when.'],
  },
  {
    v: '1.23.0', date: '2026-11-11', title: 'Write by hand',
    new: [
      'Handwriting: the pen button in the toolbar opens a lined page to write on with a pen, finger or mouse. Lines get thicker the harder you press. Choose from four ink colours and three pen sizes, with an eraser, undo and redo.',
      'Handwritten pages go into the entry, encrypted with everything else. Tap one on a tablet (or double-click on Windows) to add to it or delete it.',
      'Every pen stroke is kept with its pressure and timing, so handwriting can later be turned into typed text.',
      'Once a pen has been used, a finger scrolls the page instead of writing, so a resting palm leaves no marks.',
    ],
    improved: [
      'Tighter paragraph spacing. A blank line between paragraphs now adds a little space rather than a whole empty line.',
      'Handwritten pages aren’t counted as photos and don’t appear in the Photos view.',
    ],
  },
  {
    v: '1.22.0', date: '2026-11-05', title: 'Delete a single photo',
    new: ['Delete one photo without touching the rest of the entry: tap it (or double-click on Windows) and choose Delete photo, or do it from the Photos view.'],
  },
  {
    v: '1.21.1', date: '2026-11-05', title: 'Tablets',
    improved: ['Tablets get the phone layout when held upright, and the full layout with a camera button and bigger touch targets when turned sideways.'],
  },
  {
    v: '1.21.0', date: '2026-11-05', title: 'Updates inside the phone app',
    new: ['On Android, new versions download and install from inside WellWrite.', 'Swipe left or right to move between Bible chapters.'],
  },
  {
    v: '1.20.1', date: '2026-11-05', title: 'Finding updates on the phone',
    improved: ['New versions are easier to spot on the phone: in the ⋯ menu, as a dot on the menu buttons, and in Settings → About.'],
  },
  {
    v: '1.20.0', date: '2026-11-05', title: 'A proper phone app',
    new: ['Bottom tab bar with the camera in the middle, and a top bar with New entry and a ⋯ menu.', 'Settings on the phone is a list of sections, each with its own page.'],
    improved: ['Formatting buttons sit above the keyboard, and the keyboard only appears when you’re typing.', 'The theme setting works on Android, with matching status bar colours.'],
    fixed: ['Nothing overlaps or runs off the screen on a phone.', 'The Back button goes where you expect, ending at the journal.'],
  },
  {
    v: '1.19.0', date: '2026-11-05', title: 'A photo journal',
    new: [
      'Camera button: a photo goes straight into today’s entry, ready for a caption.',
      'Photos from your gallery start an entry on the day they were taken.',
      'Photos view: every photo in your journal, newest first, by month. Tap one to open its entry.',
    ],
  },
  {
    v: '1.18.0', date: '2026-11-05', title: 'WellWrite for Android',
    new: ['WellWrite on Android phones, with the same journal, encryption and features as on Windows, laid out for a phone.'],
  },
  {
    v: '1.17.0', date: '2026-11-02', title: 'A Bible to read and search',
    new: [
      'The Bible tab has Read, Search and Plans.',
      'Read any book and chapter in your version, with verse numbers, headings and poetry set out. WellWrite remembers where you were.',
      'Tap verses to select them, then copy them or “Write about this” to put them in today’s entry with the reference.',
      'Search by words, a phrase in quotes, or a reference typed any common way (Jn 3:16, 1 Cor 13, Ps 23). The built-in versions search offline.',
    ],
  },
  {
    v: '1.16.0', date: '2026-11-02', title: 'Writers’ lives; a tidier sidebar',
    new: [
      'Tap a writer’s name under any quote for a short biography and their journey with God. “Read more” opens a full page with their life, what shaped their faith, what to read next, and their quotes in your collection. 31 writers.',
      'All entries: a page with every entry, with search and filters for category, tag and month.',
    ],
    improved: ['The sidebar shows your two most recent days, then “All entries”.'],
  },
  {
    v: '1.15.1', date: '2026-11-01', title: 'Classics in contemporary English',
    improved: ['All 147 classics readings are in contemporary English (no thee/thou or old word order), with the same meaning and voice. Brother Lawrence’s reported sayings are in his own first person.'],
  },
  {
    v: '1.15.0', date: '2026-11-01', title: 'Classics of Christian formation',
    new: [
      '147 readings from the classics, built in: Julian of Norwich, Teresa of Ávila, John of the Cross, Brother Lawrence, Thomas à Kempis, Thérèse of Lisieux, de Caussade, Francis de Sales, The Cloud of Unknowing, Evelyn Underhill, Augustine and others. Each quote was checked word for word against its source.',
      'Each built-in collection has its own on/off switch in Settings → Quotes & readings.',
    ],
  },
  {
    v: '1.14.0', date: '2026-11-01', title: 'An edited set of built-in writing',
    improved: [
      'The built-in writing was reviewed for a wider reader. Pieces for particular people or occasions were removed, themes were corrected, and psalm passages that stopped mid-sentence now run to its end (181 pieces).',
      'Your own prayers and blessings come once a year each, in the week that suits them best.',
    ],
  },
  {
    v: '1.13.0', date: '2026-10-31', title: 'Settings in tabs',
    improved: ['Settings is a page with tabs: General, Quotes & readings, Bible, Privacy & lock, Backups, WordPress and About. It opens on the tab you used last.'],
    fixed: ['Long entry titles wrap onto more lines instead of being cut off.'],
  },
  {
    v: '1.12.0', date: '2026-10-31', title: 'Post to WordPress',
    new: [
      'Connect your own WordPress site in Settings, then “Post to WordPress” on an entry. Headings, formatting, lists, quotes, photos, date, category and tags carry over.',
      'Posts start as drafts. “Update post” changes the same post later, and nothing is sent unless you press the button.',
    ],
  },
  {
    v: '1.11.2', date: '2026-10-31', title: 'Switch Bible version from the verse',
    new: ['Tap the version name under any verse to switch versions everywhere.'],
    improved: ['Connecting an API.Bible key adds the popular English versions your plan allows (NIV, ESV, NLT, NKJV and others) straight away.'],
  },
  {
    v: '1.11.1', date: '2026-10-31', title: 'Variety in the daily readings',
    fixed: ['The same writer never appears two days running.'],
  },
  {
    v: '1.11.0', date: '2026-10-31', title: 'Pieces for their own day',
    new: ['A piece can belong to a day (Good Friday, Easter Day, Christmas Day, Anzac Day, Mother’s Day…) or a season (Lent, Advent…). It appears only then, and on its own day it comes first.'],
    improved: ['Built-in excerpts were widened so each makes sense on its own.'],
  },
  {
    v: '1.10.0', date: '2026-10-31', title: 'More Bible versions',
    new: [
      'Connect an API.Bible key to add more translations, used in the verse of the day, weekly pages and reading plans. The key is kept encrypted on this computer.',
      'If you’re offline, the built-in World English Bible is shown instead.',
    ],
  },
  {
    v: '1.9.0', date: '2026-10-31', title: 'A picture for every week',
    new: [
      'A picture for each week: public-domain paintings and NASA photos, credited under the picture and kept in your journal. Use your own picture or remove it.',
      'Readings are planned across the year, so every quote has its turn before any repeats.',
    ],
    improved: ['Settings and Your quotes fill the window.'],
  },
  {
    v: '1.8.1', date: '2026-10-31', title: 'Quote and verse above every entry',
    improved: [
      'Every entry shows the quote and verse for its own day, and both are shown by default.',
      'Bible poetry on the Week page is set out one line per line, as printed Bibles do.',
    ],
  },
  {
    v: '1.8.0', date: '2026-10-31', title: 'Readings that keep themselves up to date',
    new: [
      '204 built-in psalm passages, poems, prayers, blessings and reflections by Chris Gribble, updated with the app.',
      'Your readings file: choose a text file of quotes once, and WellWrite keeps your collection in step with it, without duplicates.',
    ],
  },
  {
    v: '1.7.2', date: '2026-10-31', title: 'Psalms as reflections',
    improved: ['Your psalms always become the weekly Reflection.'],
    new: ['In Your quotes, delete all the quotes a filter or search is showing at once.'],
  },
  {
    v: '1.7.1', date: '2026-10-31', title: 'Longer writing as the Reflection',
    improved: ['Longer pieces of your own writing become the week’s Reflection; shorter ones join the daily readings.'],
    fixed: ['Importing a poem with dash lines inside it no longer mistakes them for the writer’s name.'],
  },
  {
    v: '1.7.0', date: '2026-10-31', title: 'The weekly page',
    new: [
      'The Week page, laid out like a devotional book: theme, Bible verses, a reflection, today’s quote and question, readings, a prayer and a benediction. 90 weeks written for the year.',
      'Mark quotes as your own writing (poem, psalm, prayer, blessing, reflection), and they take their place in the weekly pages.',
    ],
  },
  {
    v: '1.6.0', date: '2026-10-31', title: 'A year of themes',
    new: [
      'Each day’s quote and writing question follow the Christian year (Advent, Lent, Easter, Pentecost…) or a theme for the month.',
      '“Write about this” brings the question into your entry.',
    ],
  },
  {
    v: '1.5.1', date: '2026-10-31', title: 'Remember my password',
    new: ['Settings → Privacy: ask for your password every time, remember it for an hour, or trust this computer. Your writing is still hidden whenever WellWrite locks.'],
    fixed: ['A stray “null” in Settings on an empty journal.'],
  },
  {
    v: '1.5.0', date: '2026-10-31', title: 'Quotes and Bible reading plans',
    new: [
      'Quote of the day from your own encrypted collection, with a starter set, favourites, and Kindle import.',
      'Bible reading plans (a year, the New Testament, the Gospels, Psalms & Proverbs) with WEB and KJV built in, and a verse of the day.',
      'Journal, Bible and Quote views.',
    ],
  },
  {
    v: '1.4.0', date: '2026-10-30', title: 'Categories and Tags tabs',
    new: ['Sidebar tabs for Calendar, Categories and Tags, with counts.', 'Subcategories, two levels deep.'],
  },
  {
    v: '1.3.2', date: '2026-10-30', title: 'Version in the sidebar',
    new: ['The version number shows in the sidebar. Click it to check for updates.'],
  },
  {
    v: '1.3.1', date: '2026-10-30', title: 'Entries titled with their date',
    improved: ['A new entry’s title starts as its date. Add to it or replace it.'],
  },
  {
    v: '1.3.0', date: '2026-10-30', title: 'Categories and links between entries',
    new: [
      'Categories with colours, and a sidebar filter.',
      'Link entries by typing [[, and see what each entry links to, is linked from, and shares tags with.',
      'Click a tag to see every entry with it.',
    ],
  },
  {
    v: '1.2.2', date: '2026-10-30', title: 'Show/hide password',
    new: ['Every password box has a show/hide button.'],
    improved: ['The WellWrite name uses Calibri.'],
  },
  {
    v: '1.2.1', date: '2026-10-30', title: 'Calendar fix',
    fixed: ['Clicking an empty day in the calendar opens a blank page for that day instead of showing the last entry.'],
  },
  {
    v: '1.2.0', date: '2026-10-30', title: 'Daybook becomes WellWrite',
    improved: ['The app was renamed from Daybook to WellWrite. Your journal moved across automatically, and old .daybook backups still restore.'],
  },
  {
    v: '1.1.0', date: '2026-10-30', title: 'Automatic backups',
    new: ['Encrypted backups daily, weekly or on close, to a folder on this computer, to Google Drive, or both, keeping the newest few. A reminder appears if backups stop working.'],
  },
  {
    v: '1.0.1', date: '2026-10-28', title: 'The first version (as Daybook)',
    new: ['A private, encrypted desktop journal for Windows: calendar, search, tags, rich text and photos, a password lock, and automatic updates.'],
  },
];
if (typeof window !== 'undefined') window.WellWriteChangelog = WELLWRITE_CHANGELOG;
if (typeof module !== 'undefined') module.exports = WELLWRITE_CHANGELOG;
