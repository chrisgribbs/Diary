'use strict';
/*
 * A year of themes for the daily quote and writing question.
 *
 *  - "christian": the Christian year. Easter moves, so its dates are worked out
 *    for each year (Western/Gregorian reckoning), and Lent, Holy Week, Pentecost
 *    and Advent follow from it and from Christmas.
 *  - "spiritual": one theme for each month.
 *
 * Each season lists the quote themes that suit it (best first) and questions to
 * prompt each day's writing.
 */
(function () {
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day = (y, m, d) => new Date(y, m - 1, d);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  /** Easter Sunday (Gregorian), anonymous algorithm. */
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), dd = ((h + l - 7 * m + 114) % 31) + 1;
    return day(y, month, dd);
  }
  /** First Sunday of Advent: the fourth Sunday before Christmas Day. */
  function adventSunday(y) {
    const xmas = day(y, 12, 25);
    const back = xmas.getDay() === 0 ? 7 : xmas.getDay();
    return addDays(xmas, -back - 21);
  }

  const S = {
    christmas: { name: 'Christmas', about: 'God with us: gift, joy and wonder', themes: ['Joy', 'Wonder & beauty', 'Love & belonging', 'Gratitude', 'Blessing'], prompts: [
      'What gift came to you this year that you did not earn or expect?',
      'Where did you glimpse something holy in an ordinary place today?',
      'Who has been “God with us” for you, a presence that made the dark bearable?',
      'What would it look like to receive, rather than give, this Christmas?',
      'Write about a small joy from today in as much detail as you can.',
      'What are you quietly carrying into the new year, and what would you like to set down?',
      'Who do you miss this Christmas? Write them a few lines.',
      'Where is wonder hiding in your life right now?',
      'What does peace on earth look like in your own house?',
      'What did this year teach you that you want to remember?',
      'Name three people you are grateful for, and why.',
      'What light would you like to carry into the year ahead?',
    ] },
    epiphany: { name: 'Epiphany', about: 'Light, seeking and new beginnings', themes: ['Hope & renewal', 'The path', 'Wonder & beauty', 'Faith & doubt', 'Courage & vulnerability'], prompts: [
      'What star are you following this year? Where do you hope it leads?',
      'What has recently become clear to you that was hidden before?',
      'What gift do you have to offer, like the Magi with their treasures?',
      'Where are you being invited to begin again?',
      'What old way of seeing is ready to be left behind?',
      'Who has been a light for you on a dark stretch of road?',
      'What question do you want to live with this year?',
      'Write about a moment when you suddenly understood something.',
      'What small step could you take today toward the life you long for?',
      'Where do you need to “go home by another road”?',
    ] },
    love: { name: 'Love and belonging', about: 'Friendship, family and the people who hold us', themes: ['Love & belonging', 'Community & place', 'Blessing', 'Gratitude'], prompts: [
      'Who truly sees you? What is it like to be seen by them?',
      'Write about a place where you feel you belong.',
      'Which relationship needs more of your attention this week?',
      'What is hard about loving someone well right now?',
      'Who could you encourage today, and how?',
      'Describe a friendship that has changed you.',
      'Where do you hold back from being fully known? Why?',
      'What does your community need from you, and you from it?',
      'Write a blessing for someone you love.',
      'When did someone love you without you having to earn it?',
    ] },
    lent: { name: 'Lent', about: 'Return, simplicity and honest prayer', themes: ['Simplicity', 'Humility', 'True self', 'Prayer', 'Darkness & suffering', 'Wholeness'], prompts: [
      'What are you hungry for underneath your everyday hungers?',
      'What could you let go of this Lent to make room for something better?',
      'Where have you wandered from yourself, and what would returning look like?',
      'Write honestly about something you have been avoiding.',
      'What clutter, inside or out, keeps you from being present?',
      'What is the wilderness you are walking through right now?',
      'Where do you need forgiveness? Where do you need to offer it?',
      'What small daily practice could you keep for these forty days?',
      'What does your heart say when you are completely quiet?',
      'Which voice in you tells the truth, and which tells you stories?',
      'What would a simpler version of this week look like?',
      'Pray, or write, about the thing you most fear to ask for.',
    ] },
    holyweek: { name: 'Holy Week', about: 'Love that suffers and stays', themes: ['Darkness & suffering', 'Love & belonging', 'Paradox', 'Prayer', 'Faith & doubt'], prompts: [
      'Where are you being asked to stay with someone in their pain?',
      'What does it mean to you that love would walk toward suffering?',
      'Write about a time you felt abandoned, and what helped.',
      'What do you need to lay down at the foot of the cross?',
      'Whose feet could you wash, in the small ways this week allows?',
      'What is dying in you that may need to die?',
      'Sit with Holy Saturday’s silence: what is it like to wait without answers?',
    ] },
    easter: { name: 'Easter', about: 'New life and resurrection hope', themes: ['Hope & renewal', 'Joy', 'Wonder & beauty', 'Faith & doubt', 'Earth & creation'], prompts: [
      'Where have you seen new life come out of something that looked finished?',
      'What would it mean to “practise resurrection” today?',
      'What stone would you like rolled away?',
      'Write about a hope you had given up on that has come back.',
      'Where is joy surprising you this season?',
      'Like Thomas, what do you need to see before you can believe?',
      'Who in your life needs to hear good news?',
      'Describe something in nature that is coming back to life.',
      'What fear has lost some of its power over you?',
      'Where are you being sent, now that the tomb is empty?',
      'What does peace feel like in your body today?',
      'Write about a meal shared that felt like a gift.',
    ] },
    pentecost: { name: 'Pentecost', about: 'Spirit, courage and calling', themes: ['Vocation & calling', 'Courage & vulnerability', 'Soul', 'Community & place', 'Creativity & art'], prompts: [
      'Where do you feel the wind of the Spirit moving in your life?',
      'What is your work in the world, beneath your job title?',
      'What would you do if you were less afraid?',
      'Which of your gifts are you not yet using?',
      'Write about a time you spoke up when it was hard.',
      'Who do you understand better now than you once did?',
      'What fire would you like rekindled in you?',
      'What is calling you, quietly and persistently?',
      'Where could your courage make a difference this week?',
      'What does it mean for you to live a creative life?',
    ] },
    rest: { name: 'Rest and presence', about: 'Sabbath, stillness and attention', themes: ['Slowness & presence', 'Simplicity', 'Prayer', 'Earth & creation', 'Wonder & beauty'], prompts: [
      'What would a true day of rest look like for you?',
      'Sit for five minutes. What did you notice?',
      'Where are you rushing, and what are you missing because of it?',
      'What does your body need today?',
      'Describe one ordinary thing as if seeing it for the first time.',
      'What can wait?',
      'Where do you find stillness, and how often do you go there?',
      'What would it mean to stop trying for a day?',
      'Write a slow, unhurried prayer, or simply list what is around you.',
      'What quiet miracle did you nearly overlook today?',
    ] },
    trueself: { name: 'True self and wholeness', about: 'Becoming who you are', themes: ['True self', 'Wholeness', 'Soul', 'Paradox', 'Courage & vulnerability'], prompts: [
      'Who are you when no one needs anything from you?',
      'What part of yourself have you been hiding?',
      'Where is your life asking you to be more whole, not more perfect?',
      'What story about yourself is no longer true?',
      'What are you good at that you rarely give yourself credit for?',
      'Which two opposite truths are you learning to hold together?',
      'What does your soul want, as distinct from what your ego wants?',
      'Write about a time you felt fully yourself.',
      'What would it mean to let your life speak?',
      'Where are your outer life and inner life out of step?',
    ] },
    creation: { name: 'Season of Creation', about: 'The earth, our place and our care for it', themes: ['Earth & creation', 'Wonder & beauty', 'Community & place', 'Gratitude', 'Humility'], prompts: [
      'Go outside. Write about what you saw, heard and smelled.',
      'What place on earth do you love most, and why?',
      'How does where you live shape who you are?',
      'What small act of care could you offer the earth this week?',
      'What do the seasons where you live teach you?',
      'Write about a tree, a river or a hill that you know well.',
      'Where do you feel most at home in creation?',
      'What do you consume that you could do without?',
      'What does it mean to you that creation is “good”?',
      'Who are your neighbours, human and otherwise?',
    ] },
    courage: { name: 'Courage and the path', about: 'Walking on when the way is unclear', themes: ['Courage & vulnerability', 'The path', 'Faith & doubt', 'Vocation & calling', 'Darkness & suffering'], prompts: [
      'What is the next courageous step that is closer than you think?',
      'Where do you not know the way, and how are you walking anyway?',
      'What fear has been making your decisions for you?',
      'Write about a door that closed and what opened afterwards.',
      'What would you attempt if failure were survivable?',
      'Where are you being asked to be more vulnerable?',
      'What has your road taught you so far this year?',
      'Who walks beside you? Who could you walk beside?',
      'What doubt are you carrying, and what is it trying to tell you?',
      'Describe a time you surprised yourself with your own strength.',
    ] },
    saints: { name: 'All Saints and gratitude', about: 'Remembering and giving thanks', themes: ['Gratitude', 'Love & belonging', 'Darkness & suffering', 'Humility', 'Community & place'], prompts: [
      'Who are the “saints” in your life, living or gone?',
      'Write a letter of thanks to someone who shaped you.',
      'Whom are you grieving, and what do you want to remember about them?',
      'What ordinary thing are you grateful for today?',
      'Name five things that went right this week.',
      'What has someone else’s faithfulness made possible for you?',
      'What are you grateful for that also cost you something?',
      'How would you like to be remembered?',
      'Who has quietly helped you without being thanked?',
      'Write about a tradition or story handed down to you.',
    ] },
    advent: { name: 'Advent', about: 'Waiting, longing and hope', themes: ['Slowness & presence', 'Hope & renewal', 'Prayer', 'Soul', 'Darkness & suffering', 'Faith & doubt'], prompts: [
      'What are you waiting for that you cannot hurry?',
      'Where in your life is it dark, and where do you see a small light?',
      'What do you long for this Advent?',
      'How can you make room this week for what matters most?',
      'Write about a time waiting turned out to be a gift.',
      'What would it mean to prepare a way in your own heart?',
      'Where is hope stubbornly alive in you?',
      'What noise could you turn down to hear more clearly?',
      'Who needs your patience this season?',
      'What promise are you holding on to?',
      'Like Mary, what are you being asked to say yes to?',
      'Write a short prayer for the world as it is.',
    ] },
    // spiritual-only months reuse several of the above, plus:
    newbeginnings: { name: 'New beginnings', about: 'Hope, intention and fresh starts', themes: ['Hope & renewal', 'The path', 'Courage & vulnerability', 'Vocation & calling'], prompts: [
      'What do you want this year to be about, in one word?',
      'What are you ready to begin?',
      'What did last year teach you about yourself?',
      'What would you like to do differently this time?',
      'What small daily habit would change your year?',
      'Describe the person you hope to be by December.',
      'What are you leaving behind?',
      'What fresh start do you need to give someone else?',
    ] },
    simplicity: { name: 'Simplicity', about: 'Less, but better', themes: ['Simplicity', 'Slowness & presence', 'Humility', 'True self'], prompts: [
      'What could you remove from your life to make room for what matters?',
      'What is enough?',
      'Where are you making things more complicated than they need to be?',
      'Describe a simple pleasure from today.',
      'What possessions, habits or worries are you ready to let go of?',
      'What is the one thing that matters most this week?',
      'When are you most content? What does that say?',
      'What would a simpler version of your day look like?',
    ] },
    renewal: { name: 'Renewal', about: 'What is coming back to life', themes: ['Hope & renewal', 'Earth & creation', 'Joy', 'Wonder & beauty'], prompts: [
      'What in you is coming back to life?',
      'Where have you seen something grow lately?',
      'What would you like to plant, in the garden or in yourself?',
      'What tired part of your life needs refreshing?',
      'Write about a second chance you were given.',
      'What makes you feel alive?',
      'Where is hope returning?',
      'What could you start again, gently?',
    ] },
    joy: { name: 'Joy and wonder', about: 'Delight in what is given', themes: ['Joy', 'Wonder & beauty', 'Gratitude', 'Blessing'], prompts: [
      'What made you smile today?',
      'Describe something beautiful you saw this week.',
      'When did you last laugh until it hurt?',
      'Where does wonder find you most easily?',
      'What would it mean to be joyful “because it is humanly possible”?',
      'Write about a moment you wish you could live again.',
      'Who brings you joy, and have you told them?',
      'What is the best part of an ordinary day for you?',
    ] },
    calling: { name: 'Calling', about: 'Work, gifts and purpose', themes: ['Vocation & calling', 'Creativity & art', 'Courage & vulnerability', 'True self'], prompts: [
      'What work makes you lose track of time?',
      'What do people often come to you for?',
      'What would you do even if no one paid you?',
      'Where does your deep gladness meet the world’s need?',
      'What is your work asking of you right now?',
      'What part of your calling have you been postponing?',
      'Write about the work you hope to be remembered for.',
      'What would “wholeheartedness” look like in your work this week?',
    ] },
    waiting: { name: 'Waiting and wonder', about: 'Light in the darkest month', themes: ['Hope & renewal', 'Prayer', 'Soul', 'Wonder & beauty', 'Joy'], prompts: [
      'What are you waiting for?',
      'Where do you see light in the dark this month?',
      'What would you like this year to end with?',
      'What has surprised you this year?',
      'Write about a gift you were given that cannot be wrapped.',
      'What do you long for as the year turns?',
      'Who will you hold in your heart this December?',
      'What are you grateful for in the year now ending?',
    ] },
  };

  /** The Christian year, as dated seasons covering the whole calendar year. */
  function christianYear(y) {
    const e = easter(y), ash = addDays(e, -46), palm = addDays(e, -7), pent = addDays(e, 49);
    let pentEnd = day(y, 6, 30);
    if (pentEnd - pent < 14 * 864e5) pentEnd = addDays(pent, 13);
    const adv = adventSunday(y);
    return [
      ['christmas', day(y, 1, 1), day(y, 1, 5)],
      ['epiphany', day(y, 1, 6), day(y, 1, 31)],
      ['love', day(y, 2, 1), addDays(ash, -1)],
      ['lent', ash, addDays(palm, -1)],
      ['holyweek', palm, addDays(e, -1)],
      ['easter', e, addDays(pent, -1)],
      ['pentecost', pent, pentEnd],
      ['rest', addDays(pentEnd, 1), day(y, 7, 31)],
      ['trueself', day(y, 8, 1), day(y, 8, 31)],
      ['creation', day(y, 9, 1), day(y, 10, 4)],
      ['courage', day(y, 10, 5), day(y, 10, 31)],
      ['saints', day(y, 11, 1), addDays(adv, -1)],
      ['advent', adv, day(y, 12, 24)],
      ['christmas', day(y, 12, 25), day(y, 12, 31)],
    ].filter(([, a, b]) => b >= a);
  }

  const MONTHS = ['newbeginnings', 'love', 'simplicity', 'renewal', 'joy', 'calling', 'rest', 'trueself', 'creation', 'courage', 'saints', 'waiting'];
  function spiritualYear(y) {
    return MONTHS.map((id, m) => [id, day(y, m + 1, 1), new Date(y, m + 1, 0)]);
  }

  function seasonsFor(year, mode) {
    return (mode === 'spiritual' ? spiritualYear(year) : christianYear(year)).map(([id, a, b]) => ({ id, ...S[id], start: iso(a), end: iso(b) }));
  }

  /** The season a date falls in, with how far into it the date is (Christmas runs over New Year). */
  function seasonOn(dateIso, mode) {
    const y = +dateIso.slice(0, 4);
    const list = seasonsFor(y, mode);
    const s = list.find(x => x.start <= dateIso && dateIso <= x.end);
    if (!s) return null;
    let start = s.start;
    if (mode !== 'spiritual' && s.id === 'christmas' && dateIso.slice(5) <= '01-05') start = `${y - 1}-12-25`;
    const dayIndex = Math.round((new Date(dateIso + 'T00:00:00') - new Date(start + 'T00:00:00')) / 864e5);
    const end = s.id === 'christmas' && dateIso.slice(5) >= '12-25' ? `${y + 1}-01-05` : s.end;
    const length = Math.round((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 864e5) + 1;
    return { ...s, start, end, dayIndex, length };
  }

  window.WellWriteSeasons = { easter: y => iso(easter(y)), adventSunday: y => iso(adventSunday(y)), seasonsFor, seasonOn, SEASONS: S };
})();
