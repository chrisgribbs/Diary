'use strict';
/*
 * The time of day for the day's prayer.
 *
 * Each day has three prayers: one for the morning, one for the day, one for the evening, and the page shows the
 * one for now. A prayer that speaks of the morning (waking, a new day, dawn) is kept for mornings; one that speaks
 * of the evening (the night, sleep, the day's end) for evenings; every other prayer suits any hour.
 * Worked out from the prayer's own words, so prayers others share with you find their hour too.
 */
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /** The part of the day a moment falls in: 'morning' (4am to noon), 'day' (noon to 6pm), 'evening' (6pm to 4am). */
  function partOfDay(d = new Date()) {
    const h = d.getHours();
    return h >= 4 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'day' : 'evening';
  }

  // The title says it plainly…
  const TITLE_MORNING = /\b(morning|matins|lauds|dawn|daybreak|sunrise|new day|i arise|arise today)\b/i;
  const TITLE_EVENING = /\b(evening|evensong|vespers|compline|night|sleep(?:ing)?|lying down|bedtime|sunset|stay with us)\b/i;
  // …or the prayer itself does.
  const MORNING = [
    /\bthis (?:new )?morning\b/i, /\bin the morning\b(?! and)/i, /\b(?:a|this|the) new day\b/i, /\bbeginning of (?:this|the) day\b/i,
    /\b(?:dawn|daybreak|sunrise)\b/i, /\bi arise today\b/i, /\bcome i this day\b/i, /\brisen today\b/i,
    /\b(?:woke|wak(?:e|ing)|awaken(?:ed)?) (?:us |me )?(?:up|from sleep)\b/i,
    /\bthrough the night (?:past|gone)\b/i, /\bsafely (?:to|through) the night\b/i, /\bthe night (?:is )?(?:past|gone)\b/i,
    /\bday ahead\b/i, /\bbegin (?:this|the) day\b/i,
    // "keep us this day", "direct our steps this day", "I commit this day…": asking for the day ahead
    /\b(?:keep|kept|direct|guide|guard|lead|defend|commit|preserve|protect|govern|order)\b[^.;:!?]{0,40}\bthis day\b/i,
  ];
  const EVENING = [
    /\bthis (?:night|evening)\b/i, /\btonight\b(?!,? and for ?ever)/i, /\b(?:in|at|through) the night\b/i,
    /\bthe evening\b(?! and (?:the )?morning)/i, /\bcoming night\b/i, /\bnightfall\b/i,
    /\b(?:we|i) (?:will |may |shall )?(?:sleep|slumber)\b/i, /\b(?:as|while) we sleep\b/i, /\bsleep in peace\b/i,
    /\b(?:we|i) lie down\b/i, /\blie down in peace\b/i, /\bto bed\b/i,
    /\b(?:close|end) of (?:this|the) day\b/i, /\bday is (?:far )?(?:spent|over|past|done|ending|gone)\b/i, /\bspent day\b/i,
    /\bas we rest\b/i, /\brest (?:this night|tonight)\b/i, /\bnight (?:watches|hours)\b/i,
  ];

  /** The words a prayer is judged by: its title and its text (not a second, older version printed with it). */
  const wordsOf = q => String((q && q.text) || '').split(/\n\s*Version in traditional English/i)[0];

  /** 'morning', 'evening', or '' for a prayer that suits any hour. */
  function prayerTime(q) {
    if (!q) return '';
    const title = String(q.title || '');
    const tm = TITLE_MORNING.test(title), te = TITLE_EVENING.test(title);
    if (tm && !te) return 'morning';
    if (te && !tm) return 'evening';
    const t = wordsOf(q);
    const m = MORNING.filter(r => r.test(t)).length, e = EVENING.filter(r => r.test(t)).length;
    if (m && !e) return 'morning';
    if (e && !m) return 'evening';
    // Both: the stronger, if clearly so (a morning prayer can thank God for the night's sleep).
    if (m >= e + 2) return 'morning';
    if (e >= m + 2) return 'evening';
    return '';
  }

  const api = { partOfDay, prayerTime, PARTS: ['morning', 'day', 'evening'] };
  root.WellWritePrayerTimes = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
