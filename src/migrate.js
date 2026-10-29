'use strict';
/**
 * The app was called Daybook before 1.2.0. Windows keeps app data in a folder
 * named after the app, so on first launch as WellWrite we move the journal
 * from %APPDATA%\Daybook\journal to %APPDATA%\WellWrite\journal.
 *
 * Safe by design: never overwrites a journal, falls back to copying (and
 * leaving the original) if the folder can't be moved, and only reports
 * success once the encrypted vault is in the new place.
 */
const fs = require('fs');
const path = require('path');

const hasJournal = dir => fs.existsSync(path.join(dir, 'vault.json'));

/** @returns {'none'|'moved'|'copied'|'skipped'} */
function migrateJournal(oldDir, newDir) {
  if (hasJournal(newDir)) return 'skipped';   // already using the new folder
  if (!hasJournal(oldDir)) return 'none';      // nothing to bring across
  fs.mkdirSync(path.dirname(newDir), { recursive: true });

  // A new folder without a journal (e.g. only settings) is set aside, not deleted.
  if (fs.existsSync(newDir)) fs.renameSync(newDir, `${newDir}-before-move-${Date.now()}`);

  try {
    fs.renameSync(oldDir, newDir);
    if (hasJournal(newDir)) {
      note(oldDir, newDir);
      return 'moved';
    }
  } catch { /* different drive, or a file is in use: copy instead */ }

  if (fs.existsSync(newDir) && !hasJournal(newDir)) fs.rmSync(newDir, { recursive: true, force: true });
  fs.cpSync(oldDir, newDir, { recursive: true, errorOnExist: true, force: false });
  if (!hasJournal(newDir)) throw new Error('Could not copy the journal to its new folder');
  return 'copied';
}

function note(oldDir, newDir) {
  try {
    fs.writeFileSync(path.join(path.dirname(oldDir), 'Your journal has moved.txt'),
      `Daybook is now called WellWrite.\r\n\r\nYour journal was moved to:\r\n${newDir}\r\n\r\nYou can delete this folder.\r\n`);
  } catch { /* only a courtesy */ }
}

module.exports = { migrateJournal };
