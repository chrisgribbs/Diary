'use strict';
// The 66 books, in order, with the names used by each source text.
const RAW = [
  ['Genesis', 'genesis'], ['Exodus', 'exodus'], ['Leviticus', 'leviticus'], ['Numbers', 'numbers'], ['Deuteronomy', 'deuteronomy'],
  ['Joshua', 'joshua'], ['Judges', 'judges'], ['Ruth', 'ruth'], ['1 Samuel', '1samuel'], ['2 Samuel', '2samuel'],
  ['1 Kings', '1kings'], ['2 Kings', '2kings'], ['1 Chronicles', '1chronicles'], ['2 Chronicles', '2chronicles'], ['Ezra', 'ezra'],
  ['Nehemiah', 'nehemiah'], ['Esther', 'esther'], ['Job', 'job'], ['Psalms', 'psalms'], ['Proverbs', 'proverbs'],
  ['Ecclesiastes', 'ecclesiastes'], ['Song of Solomon', 'songofsolomon', "Solomon's Song"], ['Isaiah', 'isaiah'], ['Jeremiah', 'jeremiah'], ['Lamentations', 'lamentations'],
  ['Ezekiel', 'ezekiel'], ['Daniel', 'daniel'], ['Hosea', 'hosea'], ['Joel', 'joel'], ['Amos', 'amos'],
  ['Obadiah', 'obadiah'], ['Jonah', 'jonah'], ['Micah', 'micah'], ['Nahum', 'nahum'], ['Habakkuk', 'habakkuk'],
  ['Zephaniah', 'zephaniah'], ['Haggai', 'haggai'], ['Zechariah', 'zechariah'], ['Malachi', 'malachi'],
  ['Matthew', 'matthew'], ['Mark', 'mark'], ['Luke', 'luke'], ['John', 'john'], ['Acts', 'acts'],
  ['Romans', 'romans'], ['1 Corinthians', '1corinthians'], ['2 Corinthians', '2corinthians'], ['Galatians', 'galatians'], ['Ephesians', 'ephesians'],
  ['Philippians', 'philippians'], ['Colossians', 'colossians'], ['1 Thessalonians', '1thessalonians'], ['2 Thessalonians', '2thessalonians'], ['1 Timothy', '1timothy'],
  ['2 Timothy', '2timothy'], ['Titus', 'titus'], ['Philemon', 'philemon'], ['Hebrews', 'hebrews'], ['James', 'james'],
  ['1 Peter', '1peter'], ['2 Peter', '2peter'], ['1 John', '1john'], ['2 John', '2john'], ['3 John', '3john'],
  ['Jude', 'jude'], ['Revelation', 'revelation'],
];
const BOOKS = RAW.map(([name, web, kjv]) => ({ name, web, kjv: kjv || name }));
const OT_BOOKS = 39;
module.exports = { BOOKS, OT_BOOKS };
