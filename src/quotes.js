'use strict';
/**
 * Starter quotes for the daily quote. All are out of copyright (writers who died
 * long ago, or translations published before 1929), so they can ship with the app.
 * Writers still under copyright are added by the user from their own books.
 */
const STARTER_QUOTES = [
  { text: 'All shall be well, and all shall be well, and all manner of thing shall be well.', author: 'Julian of Norwich', source: 'Revelations of Divine Love', themes: ['Hope & renewal', 'Faith & doubt', 'Darkness & suffering'] },
  { text: 'Thou madest us for Thyself, and our heart is restless, until it repose in Thee.', author: 'Augustine of Hippo', source: 'Confessions (trans. E. B. Pusey)', themes: ['Soul', 'Prayer', 'Faith & doubt'] },
  { text: 'Let nothing disturb thee,\nNothing affright thee;\nAll things are passing;\nGod never changeth.', author: 'Teresa of Ávila', source: 'trans. Henry Wadsworth Longfellow', themes: ['Faith & doubt', 'Prayer', 'Darkness & suffering'] },
  { text: 'You never enjoy the world aright, till the Sea itself floweth in your veins, till you are clothed with the heavens, and crowned with the stars.', author: 'Thomas Traherne', source: 'Centuries of Meditations', themes: ['Wonder & beauty', 'Earth & creation', 'Joy'] },
  { text: 'To see a World in a Grain of Sand\nAnd a Heaven in a Wild Flower,\nHold Infinity in the palm of your hand\nAnd Eternity in an hour.', author: 'William Blake', source: 'Auguries of Innocence', themes: ['Wonder & beauty', 'Slowness & presence', 'Earth & creation'] },
  { text: 'The world is charged with the grandeur of God.', author: 'Gerard Manley Hopkins', source: 'God’s Grandeur', themes: ['Wonder & beauty', 'Earth & creation', 'Blessing'] },
  { text: 'I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.', author: 'Henry David Thoreau', source: 'Walden', themes: ['Simplicity', 'Slowness & presence', 'The path'] },
  { text: 'Things do not change; we change.', author: 'Henry David Thoreau', source: 'Walden', themes: ['True self', 'Hope & renewal'] },
  { text: 'Our life is frittered away by detail. … Simplify, simplify.', author: 'Henry David Thoreau', source: 'Walden', themes: ['Simplicity', 'Slowness & presence'] },
  { text: 'Nothing can bring you peace but yourself.', author: 'Ralph Waldo Emerson', source: 'Self-Reliance', themes: ['True self', 'Wholeness'] },
  { text: 'Write it on your heart that every day is the best day in the year.', author: 'Ralph Waldo Emerson', source: 'Society and Solitude', themes: ['Gratitude', 'Joy', 'Slowness & presence'] },
  { text: 'I am certain of nothing but of the holiness of the Heart’s affections and the truth of Imagination.', author: 'John Keats', source: 'Letter to Benjamin Bailey, 1817', themes: ['Creativity & art', 'Love & belonging', 'Soul'] },
  { text: 'Tell all the truth but tell it slant —', author: 'Emily Dickinson', source: '', themes: ['Creativity & art', 'Paradox'] },
  { text: '“Hope” is the thing with feathers —\nThat perches in the soul —', author: 'Emily Dickinson', source: '', themes: ['Hope & renewal', 'Soul'] },
  { text: 'The world is too much with us; late and soon,\nGetting and spending, we lay waste our powers;', author: 'William Wordsworth', source: '', themes: ['Simplicity', 'Earth & creation', 'Slowness & presence'] },
  { text: 'With an eye made quiet by the power\nOf harmony, and the deep power of joy,\nWe see into the life of things.', author: 'William Wordsworth', source: 'Lines Composed a Few Miles above Tintern Abbey', themes: ['Joy', 'Wonder & beauty', 'Slowness & presence'] },
  { text: 'Re-examine all you have been told at school or church or in any book, dismiss whatever insults your own soul.', author: 'Walt Whitman', source: 'Preface to Leaves of Grass (1855)', themes: ['True self', 'Courage & vulnerability', 'Soul'] },
  { text: 'I loafe and invite my soul,\nI lean and loafe at my ease observing a spear of summer grass.', author: 'Walt Whitman', source: 'Song of Myself', themes: ['Slowness & presence', 'Soul', 'Earth & creation'] },
  { text: 'Look within. Within is the fountain of good, and it will ever bubble up, if thou wilt ever dig.', author: 'Marcus Aurelius', source: 'Meditations (trans. George Long)', themes: ['True self', 'Soul', 'Wholeness'] },
  { text: 'I have discovered that all the unhappiness of men arises from one single fact, that they cannot stay quietly in their own chamber.', author: 'Blaise Pascal', source: 'Pensées (trans. W. F. Trotter)', themes: ['Slowness & presence', 'Simplicity', 'Humility'] },
];

module.exports = { STARTER_QUOTES };
