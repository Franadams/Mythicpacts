# Mythic Pacts

A two-player card game of risk and reward, inspired by Reiner Knizia's *Lost Cities* and re-themed around five mythical realms: Fairies, Sirens, Dryads, Angels and Nymphs. You play against the computer. An Odds panel shows the probability and expected-value reasoning behind every move.

## Play it

Double-click `index.html`. It opens in your web browser. Nothing needs to be installed.

- **Play or discard:** drag a card from your hand onto your line for its realm, or onto that realm's discard pile. The places it can go glow while you drag. You can also tap the card, then tap where it goes.
- **Draw:** tap the deck or the top card of a discard pile. A card from the deck turns over in 3D, zooms in with a glow, then slides into your hand.
- **Sound:** cards swish as they are played and picked up, picking a card in your hand clicks, and a crystal twinkles. The Sound button in the header turns it off.

## Versions

| Version | Published page | Saved copy | In git |
|---|---|---|---|
| 1 | [claude.ai/artifact/VkrmMfEm4K25VUdz2XsJRb](https://claude.ai/artifact/VkrmMfEm4K25VUdz2XsJRb) | `versions/v1/mythic-pacts-v1.html` (open it in any browser) | tag `v1` |
| 2 | [claude.ai/artifact/S2cQ7jYQgJ8x6naNGGWhrz](https://claude.ai/artifact/S2cQ7jYQgJ8x6naNGGWhrz) | | branch `version-2` |

What's new in version 2:
- You drag cards onto the table; the Play and Discard buttons are gone.
- Drawing from the deck shows a 3D turn, zoom and glow.
- The Oracle reads its opponent's play, avoids handing them useful cards, no longer throws away cards its own lines could use, waits for low cards before opening a line, and learns your habits from round to round (details below).
- A new backdrop (dark linen with gold moons) that fills the screen, full screen included, bigger cards on the table, and the realm portraits fill the empty discard piles.
- Crystals sit beside each player's score, and a line that has earned one glows in its creature's colour.
- Sound effects, made in the browser (`src/sound.js`): no sound files.
- The Odds panel is simpler: no realm forecast, and the card count shows only what is unseen, in your hand, or on top of a discard pile.
- The same-screen two-player mode was removed. Online play for two devices is written (`src/online.js`, with its own tests) but switched off for now (`ONLINE_ENABLED` in `src/ui.js`).

## Files

| File | What it is |
|---|---|
| `index.html` | The page. It loads everything below. |
| `src/engine.js` | Rules and AI: pure functions with no drawing code. |
| `src/ui.js` | Everything on screen: the table, dragging, animations, the Odds panel, menus. |
| `src/styles.css` | The look. |
| `src/sound.js` | The sound effects, synthesised with the Web Audio API. |
| `src/online.js` | Online play for two devices (switched off for now). |
| `tests/` | Tests you can run with `tests/run.sh` (no installs: it uses macOS's built-in JavaScriptCore), plus `calibrate.js` and `benchmark.js` for the measurements below. |
| `prepare_art.py` | Cuts the art sheets in `art/` into cards, crystals and portraits in `assets/`. |
| `build.py` | Packs everything into one self-contained file, `dist/mythic-pacts.html` (about 7 MB). |

## The art

The artwork lives in `art/` as the sheets made in ChatGPT:

| File | What the game takes from it |
|---|---|
| `Fairies.png`, `Sirens.png`, `Dryads.png`, `Angels.png`, `Nymphs.png` | Each sheet holds 11 cards: 1–6 on the top row, then 7, 8, 9, 10 and ×. Cards 2–10 become the number cards and × becomes the Pact. Card 1 isn't used, because the game's numbers start at 2. |
| `Cystals.png` | The five crystals, in the order Fairies, Sirens, Dryads, Nymphs, Angels. They're cut out with a transparent background. |
| `GameBoard.png` | The five realm portraits. They become the empty discard spaces in the middle of the table and the row of portraits on the start screen. |
| `card-back.png` | The back of the cards. |

If you change any art, run `python3 prepare_art.py` and refresh the browser. It finds every card on a sheet automatically: it fills the background in from the edges, and since each card frame is a closed border, whatever the fill can't reach is a card.

To make the shareable single file, run `python3 build.py`.

## How the bot works (talking points)

**The rules engine** is a set of small, pure functions. A card is just a number from 0 to 59, which makes the game state quick to copy. That speed is what makes thousands of simulations per move possible.

**Apprentice (rules of thumb).** It plays the lowest card that fits a line, avoids skipping cards that could still turn up, only starts a line when its cards are likely to cover the 20-point cost, and avoids discarding cards its opponent could use. It sees only what a human player would see.

**Oracle (Monte Carlo simulation).** On every decision it:
1. **Deals a possible world.** The cards it hasn't seen are split between the opponent's hidden hand and the deck. The split leans on what the opponent's play has revealed (see *Reading the opponent*).
2. **Plays every legal move to the end of the round** in that world, with the Apprentice strategy on both sides, and records the final lead.
3. **Repeats this for 80 worlds** (200 for the Odds panel). Every move is tested on the same worlds (*common random numbers*), so the comparison measures the move, not the luck of the deal.
4. **Decides cautiously.** Moves are compared by their *paired* differences, world by world, with standard errors:
   - A discard the opponent could use (a *gift*) is only chosen when it beats the best safe move clearly and by enough points. A card that fits a line they've started must win by at least 3 points and by more than two standard errors.
   - Throwing away a card that fits its **own** line must win by at least half the points that card is worth there. The simulated opponent takes such cards to deny it, and the extra turn that buys looked worth giving up a sure 10 in simulation; in real games it wasn't. The next card for one of its lines, with nothing in between left to wait for, is never thrown away: once a line is started, playing that card can only add points.
   - Opening a new line commits 20 points. Unless the rules of thumb would open it too, an opening must win by a few points, plus more for each card the opponent already has in that realm (Pacts count double), because they will be holding many of its cards. The rules of thumb also stopped starting doomed lines just to avoid feeding the opponent.
   - Jumping over lower cards it could still play (opening a line with a 7 early in the round, say) must win by half the points those lower cards are expected to be worth: a lower card in hand is lost for sure, an unseen one only might arrive in time. Late in the round that expectation is small, so the jump becomes fine.
   - Otherwise the rules-of-thumb move stays unless another move beats it by more than one standard error. Picking the highest noisy average chases luck, not skill.

**Reading the opponent.** Players keep cards that fit their lines and throw away the ones they can't use, so the table gives clues. Each unseen card is sorted by public information only (the lines, the discard piles, cards the opponent visibly took, and how many cards are left), and the opponent's hand is dealt with matching weights. The weights were fitted with `tests/calibrate.js` on 5,280 simulated games (628,104 decisions, 18.6 million observations of an unseen card). For example, a card well above the top of a line they've started is about 3 times as likely as average to be in their hand; one they can never play is about a quarter as likely. On 1,320 held-out games the weighted deal predicts the opponent's hand better than an even split (log-loss 0.502 vs 0.532 nats per card), and the share of each kind of card it deals them matches the truth within 2 percentage points.

**Learning your habits.** After each round against the Oracle, it looks back at every decision it made: which unseen cards were you really holding, compared with what its model expected? Counted per kind of card, that shows whether you hold on to, say, high cards or Pacts more than the model assumes, and its simulated deals lean that way next time (shrunk towards the population model until there is enough evidence). It only learns from finished rounds, so it never uses your hidden cards in the round being played. What it learns is kept in your browser, and the menu has a button to make it forget. In tests against simulated players, after 30 rounds of study it predicted the hidden hand of a player who hoards high cards 2.0–2.6% better (log-loss on held-out rounds) and of a typical player 0.4–0.9% better; it was never worse.

**Measured against your games.** Every round you finish against the computer is recorded move by move: the deal, every play, discard and draw, and the scores. Records are kept in your browser and, on the published page, in the page's own storage, which only the page's owner can read or write. The round-end screen and the menu show your record against the Oracle. `tests/replay.js` plays recorded rounds back and scores every Oracle decision against the alternatives, with hindsight of what you were really holding. That shows how many points each of its moves cost against you, and whether another version of the engine (`candidate=FILE`) would have done better in the same positions. Hindsight is only used to judge decisions afterwards, never to make them.

**Why gifts matter.** In those simulations, when a player discarded a card that fit a line the opponent had started, the opponent took it and finished the round with it on a line 59% of the time against the Apprentice and 67% against the Oracle. Early-round discards that could start a new line for them were used 36% and 52% of the time.

**Measured results** (computer-vs-computer runs; "duplicate pairs" means each deal is played twice with the seats swapped, so the luck of the deal cancels out):

| What was measured | Sample | Result |
|---|---|---|
| Version 2 Oracle vs version 1 Oracle | 400 games | Version 2 won 54.6% ± 2.4%, by 5.9 ± 1.9 points a game |
| Version 2 Oracle vs the (improved) Apprentice | 400 games | Oracle won 67.6% ± 2.1%, by 16.3 ± 1.6 points a game |
| Stricter gift rule vs the first version 2 Oracle | 400 games | 52.1% ± 1.4% for the stricter rule, by 1.3 ± 1.0 points a game: no loss of strength |
| Own-line rule vs the Oracle without it | 400 games | 53.9% ± 1.7% for the rule, by 3.7 ± 1.3 points a game |
| Opening rule: lines the Oracle opened in 120 games | 431 → 355 lines | below zero 23% → 18%; average line +11.4 → +15.0; weak openings 197 → 107 |
| Opening rule vs the Oracle without it | 400 games | 50.5% ± 2.3%: level in self-play (its value shows against human play, which self-play can't measure) |
| Waiting-for-low-cards rule vs the Oracle without it | 400 games | 52.7% ± 2.2%, by 2.4 ± 1.5 points a game: no loss of strength |
| Oracle opens a line early with a 6 or higher | about 300 openings each | down by about a third with the waiting rule |
| Oracle throws away a card that fits its own line | about 2,970 decisions each | 0.9% → **0.07%** with the own-line rule |
| Never throwing away the next card for its own line, vs the Oracle without that rule | 400 games | 50.4% ± 0.5%, by 0.5 ± 0.3 points a game: it rarely applies, and costs nothing when it does |
| *Tried, not adopted:* a "line budget" (every line already open raises the bar for opening another), vs the Oracle without it | 800 games | 50.7% ± 1.6%: level. Against the Apprentice it opened fewer lines (3.12 → 2.92 a round) and fewer finished below zero (19% → 15%), but the Odds advice gave away a card that could start an opponent's line more often (4.1% → 6.7% of 1,000 positions), because the simulated opponent also became slow to start lines. Applying it to the advice only removed that side effect and also the gain (41.6 → 41.2 points a round). |
| Advice feeds a card onto a line the opponent started | 2,000 positions | 2.2% (version 1) → 1.9% → **0.9%** with the stricter rule |
| Advice gives away a card that could start an opponent's line | 2,000 positions | 5.1% (version 1) → **1.5%** |
| Version 1: Oracle with vs without the significance check, each against the Apprentice | 200 + 200 games | 73% vs 44% wins: without the check, the search lost to the simpler player |

**The Odds panel** uses the same engine for the human player:
- *Card count:* which cards are still unseen, in your hand, or on top of a discard pile.
- *Chance a card reaches you:* you draw about half of the remaining deck, so each unseen card's chance is your draws divided by the number of hidden places. The chance of getting at least one of several cards comes from the hypergeometric distribution.
- *Best move:* the average final lead for each move, its standard error, and a red "helps Oracle" tag on discards the opponent could use. When the advice passes over a higher-scoring move, it says why.

This is the same kind of reasoning used to price a sports market: count what you know, model what the other side's behaviour reveals, simulate what you don't know, and only act when the edge is bigger than the noise.
