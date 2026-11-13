'use strict';
// What's new: every version of WellWrite, newest first. Shown in Settings → What's new, and written out to
// CHANGELOG.md by `npm run changelog`. Add the new version here whenever package.json's version changes
// (test/changelog.test.js checks this).
// Each version: { v, date (YYYY-MM-DD, Brisbane time), title, new: [], improved: [], fixed: [] }.
const WELLWRITE_CHANGELOG = [
  {
    v: '1.30.0', date: '2026-11-14', title: 'A prayer for the morning, the day and the evening',
    new: [
      'The prayer for today now changes through the day: a prayer for the morning until noon, another for the day until six, and one for the evening after that. The page changes by itself when the hour turns.',
      'Prayers written for an hour come at that hour: I Arise Today and the morning collects in the morning; Compline, Evensong and “I lie down tonight” in the evening. Mornings and evenings take turns to have one; the rest of the time it’s one of the prayers that suit any hour.',
      'Feast days keep their own prayers, at their own hour: Easter Day’s in the morning.',
      'Pause for prayer at the morning bell prays the morning’s prayer, and at the evening and night bells, the evening’s.',
    ],
    fixed: [
      'With the prayer bell on, WellWrite no longer holds up Windows shutting down, restarting or signing out: it saves and closes straight away.',
      'Settings → Prayer bell no longer shows “nullnullnull” when the bell is off.',
      'If Settings (or any window inside WellWrite) is ever still showing after you close it, it’s now hidden anyway, and the problems log notes it.',
    ],
  },
  {
    v: '1.29.0', date: '2026-11-14', title: 'A prayer for each day',
    new: [
      'Prayer for today: a prayer under the quote and verse each day, following the Christian year, with its own prayer on Ash Wednesday, through Holy Week, on Easter Day, Pentecost, Christmas Eve and Christmas Day. Turn it off in Settings → Quotes & readings.',
      '365 Daily prayers come built in: Celtic prayers from the Carmina Gadelica, Augustine, Thomas à Kempis, Anselm, Columba, the old sacramentaries and more, chosen for quiet, reflective prayer from A Collection of Prayers. Each carries its credit and licence.',
      'Say what you think of each prayer: “I like this” keeps it in your favourites; “Not for me” means it won’t come again (with Undo). Both sync between your devices.',
      'In the morning, Pause for prayer prays the day’s prayer.',
      'Share prayers (Your quotes → Share prayers…): save the prayers you like and your own as a prayer pack that anyone with WellWrite can add with Import from a file. Every prayer keeps its credit and licence; changed copies of licensed prayers stay with you.',
    ],
  },
  {
    v: '1.28.0', date: '2026-11-14', title: 'More Bible versions for everyone',
    new: [
      'More Bible versions, shared by WellWrite: choose them in Settings → Bible with no API key of your own. Your own key still works, and is used first if you add one.',
    ],
  },
  {
    v: '1.27.0', date: '2026-11-14', title: 'The prayer bell, and a week without your password',
    new: [
      'The prayer bell (Settings → Prayer bell): three soft strikes of a bell at the hours you choose (morning, midday, afternoon, evening, night), inviting you to stop and pray. It’s off until you turn it on, and set on each device separately.',
      'Each bell carries a line of Scripture for that hour. Tap it for “Pause for prayer”: a verse, a prayer from the Daily Office (and sometimes one of your own), then Amen, or Write a line in today’s entry.',
      'Easy to quiet: Mute today on every notification, in the menu and in Settings; weekdays only; or a silent notification instead of the bell.',
      'On Windows the bell rings while WellWrite runs, so with the bell on, closing the window keeps WellWrite in the tray (by the clock), with Open, Mute today and Quit. It can start with Windows.',
      'On Android it rings even when WellWrite is closed, and after the phone restarts.',
      'Remember my password can now last a day or a week, and the password screen has “Don’t ask again on this computer for a week”.',
    ],
    improved: [
      'A trusted computer or phone no longer locks just because you minimised WellWrite or switched apps. It still locks after the inactivity time, and opens again with one click.',
    ],
  },
  {
    v: '1.26.1', date: '2026-11-13', title: 'Less empty space at the top',
    fixed: [
      'The big gap above the quote and verse, before you start today’s entry, is gone, and an entry’s page starts a little higher too.',
    ],
  },
  {
    v: '1.26.0', date: '2026-11-12', title: 'Your quotes sync too',
    new: [
      'Your quotes now sync between your devices along with your entries: quotes you add, edit or delete, your favourites, and changes to the built-in readings (deleting one, or editing its themes).',
      'The first time each device syncs its quotes, nothing is lost: quotes from both devices are kept, and favourites and deletions from both count.',
    ],
  },
  {
    v: '1.25.5', date: '2026-11-12', title: 'Turning on sync no longer says “Journal is locked”',
    fixed: [
      'While you sign in to Google in the browser, WellWrite no longer locks itself (with “Lock when I leave WellWrite” or the inactivity timer). That lock is what made turning on sync fail with “Journal is locked”.',
      'If the journal does lock before sync is turned on, unlocking it carries straight on to turning sync on.',
      'On phones and tablets, touching and scrolling count as activity, so reading for a while doesn’t lock the journal.',
    ],
  },
  {
    v: '1.25.4', date: '2026-11-12', title: 'Connect Google Drive on the phone',
    fixed: [
      'On Android, “Connect Google Drive” did nothing (the screen just flickered): the phone app was missing that step. It now opens Google’s sign-in in your browser.',
      'While you sign in, WellWrite stays awake (a quiet “Signing in to Google” notification shows), so Android doesn’t freeze it before Google hands back.',
      'When you’ve signed in, the browser takes you straight back to WellWrite, with a “Back to WellWrite” button if it doesn’t.',
    ],
  },
  {
    v: '1.25.3', date: '2026-11-12', title: 'Google Drive switched on (properly)',
    fixed: ['Google Drive sign-in works on Windows and Android, so you can turn on sync and backups to Drive. (1.25.2 was built with the Google details in the wrong shape.)'],
  },
  {
    v: '1.25.2', date: '2026-11-12', title: 'Google Drive switched on',
    fixed: ['Google Drive now works, on Windows and Android: sync between your devices and automatic backups to Drive. (Earlier versions were built without the Google connection.)'],
  },
  {
    v: '1.25.1', date: '2026-11-12', title: 'A sure way out of Settings',
    fixed: [
      'Settings has a ✕ at the top as well as Done, on the computer and the phone.',
      'On phones, Done and the end of each Settings page stay clear of the navigation bar.',
    ],
    new: [
      'The problems log is on the phone too: Settings → About → Show log, with a Copy button. It records when Settings opens and closes, so if it ever won’t close, the log says why. It never contains your entries.',
    ],
  },
  {
    v: '1.25.0', date: '2026-11-11', title: 'Sync between your devices',
    new: [
      'Settings → Sync keeps your journal the same on your computer, phone and tablet, through your own Google Drive. Anyone can use it with their own Google account.',
      'Everything is encrypted with your journal password before it leaves the device, so Google only sees scrambled files (in a “WellWrite sync” folder).',
      'Changes go up a few seconds after you stop writing, and come down when WellWrite opens and every few minutes. The status bar says Synced, Syncing… or Not synced.',
      'Deleting an entry deletes it everywhere. If the same entry is changed on two devices before they sync, both versions are kept, the other titled “(from another device)”. An edit beats a delete.',
      'Entries and categories sync. Quotes, settings and week pictures stay on each device.',
      'Google Drive now works on Android too: sign in through your phone’s browser, then come back to WellWrite.',
    ],
  },
  {
    v: '1.24.2', date: '2026-11-11', title: 'Settings always closes',
    fixed: [
      'Done and Esc always close Settings (and other windows like Your quotes), even if something inside has gone wrong.',
      'If WellWrite ever stops responding, it offers to reload. Your entries are saved as you type.',
    ],
    new: ['Settings → About → Problems log: a file of error messages (never your entries) that shows what went wrong if something misbehaves.'],
  },
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
