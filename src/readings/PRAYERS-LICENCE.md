# Daily prayers (`prayers.json`): licence

WellWrite's own code is MIT-licensed. **The prayers in `prayers.json` are not.** Each prayer carries its own
`licence` and `credit`, and WellWrite shows the credit with the prayer and keeps it when a prayer is shared.

- **`cc-by-nc-nd`** (343 prayers): versions and translations by Paul C. Stratman, from
  [A Collection of Prayers](https://acollectionofprayers.com), licensed
  [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/). They may be shared **unchanged**, **with their
  credit** ("Prayer from www.acollectionofprayers.com. Used with permission."), and **not for commercial use**.
- **`public-domain`** (22 prayers): from sources published before 1929, as printed on that site.

## If WellWrite is ever sold

The CC BY-NC-ND prayers can't ship in a paid app. Set `COMMERCIAL = true` in `src/backend.js`: the built-in
Daily prayers then load only the public-domain ones, unless the author has given written permission for commercial
use (contact via acollectionofprayers.com).

## What was left out, and why

The prayers were chosen from the 1,621 posts on the site, sorted by licence. Left out: 38 marked "All rights reserved"
(*Prayers Ancient Made Modern*, 2024), 46 reprinted from modern copyrighted books (for example *Christian Worship*
1993, *A Lutheran Prayer Book* 1960, *The Catholic Prayer Book* 1984), and reblogs from other blogs.
