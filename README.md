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
| 3 | [claude.ai/artifact/6XNcL3kBMJ8rccLZ6oCK2V](https://claude.ai/artifact/6XNcL3kBMJ8rccLZ6oCK2V) | | branch `version-3` |

What's new in version 3:
- The computer opponent is now the **Seer**, which replaces the Oracle. It searches like the Oracle (80 possible deals, every move tried in each), but plays each future only 8 decisions ahead and lets a small neural network, trained on 24,000 games, judge who is ahead. It keeps the Oracle's safe-move rules, made stricter about throwing away cards its own lines could use, and still learns your habits. How it was built is described in *The Seer's neural network* below.
- In testing the Seer beat the Oracle in 62% of 1,000 games, by 11.1 ± 1.1 points a round. Before the stricter discard rule, which made no measurable difference to its strength, it also beat an Oracle doing four times the work, by 5.2 ± 1.3. It also decides faster than the Oracle: about 8 ms a decision against 13 ms on a Mac.
- The Odds panel's Best move advice works as before (the Oracle's method, with 200 deals).
- On your own computer (`index.html`), a game saved by version 2 continues against the Seer. The published version 3 page is a new page, so it starts fresh: no saved game, no learned habits, an empty scoreboard. The scoreboard counts rounds against the Seer on their own.

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
| `nn/` | The Seer's neural network: `net.js` (the network, its players and the Seer; the game loads it), `seer-weights.js` (the network the game plays with, a copy of `v5.json` that `build.py` writes), `selfplay.js` (training games), `train.js`, and the trained weights `v2s1.json` (called v2 below), `v3.json`, `v4.json` and `v5.json` (v5 is the strongest). Training games, logs and test results go in `nn/data/`, which is not in git. See *The Seer's neural network* below. |
| `prepare_art.py` | Cuts the art sheets in `art/` into cards, crystals and portraits in `assets/`. |
| `build.py` | Packs everything into one self-contained file, `dist/mythic-pacts.html` (about 8 MB). |

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

**Oracle (Monte Carlo simulation).** The computer opponent in versions 1 and 2, and still the method behind the Odds panel's advice. On every decision it:
1. **Deals a possible world.** The cards it hasn't seen are split between the opponent's hidden hand and the deck. The split leans on what the opponent's play has revealed (see *Reading the opponent*).
2. **Plays every legal move to the end of the round** in that world, with the Apprentice strategy on both sides, and records the final lead.
3. **Repeats this for 80 worlds** (200 for the Odds panel). Every move is tested on the same worlds (*common random numbers*), so the comparison measures the move, not the luck of the deal.
4. **Decides cautiously.** Moves are compared by their *paired* differences, world by world, with standard errors:
   - A discard the opponent could use (a *gift*) is only chosen when it beats the best safe move clearly and by enough points. A card that fits a line they've started must win by at least 3 points and by more than two standard errors.
   - Throwing away a card that fits its **own** line must win by at least half the points that card is worth there. The simulated opponent takes such cards to deny it, and the extra turn that buys looked worth giving up a sure 10 in simulation; in real games it wasn't. The next card for one of its lines, with nothing in between left to wait for, is never thrown away: once a line is started, playing that card can only add points.
   - Opening a new line commits 20 points. Unless the rules of thumb would open it too, an opening must win by a few points, plus more for each card the opponent already has in that realm (Pacts count double), because they will be holding many of its cards. The rules of thumb also stopped starting doomed lines just to avoid feeding the opponent.
   - Jumping over lower cards it could still play (opening a line with a 7 early in the round, say) must win by half the points those lower cards are expected to be worth: a lower card in hand is lost for sure, an unseen one only might arrive in time. Late in the round that expectation is small, so the jump becomes fine.
   - Otherwise the rules-of-thumb move stays unless another move beats it by more than one standard error. Picking the highest noisy average chases luck, not skill.

**Seer (version 3's opponent).** The Oracle's search with a neural network inside it: the same deals and the same cautious decision rule (stricter about throwing away its own cards), but each simulated future stops after 8 decisions and the network judges where it got to, instead of the rules of thumb playing on to the end. See *The Seer's neural network* below.

**Reading the opponent.** Players keep cards that fit their lines and throw away the ones they can't use, so the table gives clues. Each unseen card is sorted by public information only (the lines, the discard piles, cards the opponent visibly took, and how many cards are left), and the opponent's hand is dealt with matching weights. The weights were fitted with `tests/calibrate.js` on 5,280 simulated games (628,104 decisions, 18.6 million observations of an unseen card). For example, a card well above the top of a line they've started is about 3 times as likely as average to be in their hand; one they can never play is about a quarter as likely. On 1,320 held-out games the weighted deal predicts the opponent's hand better than an even split (log-loss 0.502 vs 0.532 nats per card), and the share of each kind of card it deals them matches the truth within 2 percentage points.

**Learning your habits.** After each round against the Seer (the Oracle in version 2), it looks back at every decision it made: which unseen cards were you really holding, compared with what its model expected? Counted per kind of card, that shows whether you hold on to, say, high cards or Pacts more than the model assumes, and its simulated deals lean that way next time (shrunk towards the population model until there is enough evidence). It only learns from finished rounds, so it never uses your hidden cards in the round being played. What it learns is kept in your browser, and the menu has a button to make it forget. In tests against simulated players, after 30 rounds of study it predicted the hidden hand of a player who hoards high cards 2.0–2.6% better (log-loss on held-out rounds) and of a typical player 0.4–0.9% better; it was never worse.

**Measured against your games.** Every round you finish against the computer is recorded move by move: the deal, every play, discard and draw, and the scores. Records are kept in your browser and, on the published page, in the page's own storage, which only the page's owner can read or write. The round-end screen and the menu show your record against the Seer. `tests/replay.js` plays recorded rounds back and scores every decision the computer made against the alternatives, with hindsight of what you were really holding. That shows how many points each of its moves cost against you, and whether another version of the engine (`candidate=FILE`) would have done better in the same positions. Hindsight is only used to judge decisions afterwards, never to make them.

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
- *Best move:* the average final lead for each move, its standard error, and a red "helps Seer" tag on discards the opponent could use. When the advice passes over a higher-scoring move, it says why.

This is the same kind of reasoning used to price a sports market: count what you know, model what the other side's behaviour reveals, simulate what you don't know, and only act when the edge is bigger than the noise.

## The Seer's neural network

The Oracle plays every simulated future to the end with the rules of thumb. The question was whether a neural network, trained on the Oracle's own games, could judge positions better, and then play better. It could: the Seer, built on it, is the computer opponent in version 3.

**What the network is.** A small network (about 17,000 weights, pure JavaScript, no GPU) that looks at the table from one player's side and predicts how far ahead that player will finish the round. It sees only what that player could see: where each card is (in its hand, on either player's lines, in a discard pile, unseen, or known to be in the opponent's hand because they took it from a pile), a few summary numbers per realm (line score, cards that still fit, cards left), and whose turn it is. The five realms are read by the same small sub-network and added up, because the realms are interchangeable; a pattern learned in one realm applies to all five.

**How it plays.**
- *On its own:* for each legal move it imagines the position afterwards and picks the one it rates highest. Well under a millisecond a move.
- *The Seer:* the Oracle's search with the network inside it. Like the Oracle, it deals 80 possible worlds and tries every move in each, but each simulated future is cut short after 8 decisions (a play or a draw each, so about two turns per player) and the network judges where it got to. The Oracle's cautious decision rule then picks the move, anchored on the network's own choice and stricter about throwing away its own cards (see below). A little faster than the Oracle. This is the opponent the game plays with, using v5.

**How it was trained** (`nn/selfplay.js`, `nn/train.js`):
1. 10,000 Oracle-vs-Oracle games: 1.07 million positions. For every play or discard the Oracle considered, its estimate of the final lead was stored too (7.9 million estimates).
2. The network learned from both: how each game really ended, and the Oracle's estimate for every play or discard it weighed.
3. The first network trained on both (v1b) then played 6,000 games against the Oracle, and the Oracle scored every position, including the network's own (an "expert iteration" round: the learner visits its own positions and the expert says what each move there was worth).
4. Network v3 was trained on all 16,000 games, starting from v2 (the second network, trained on the first 10,000 with the fixes below).
5. Another round: the Seer with v3 played 4,000 games against the Oracle, scored the same way, and v4 was trained on all 20,000 games, starting from v3.
6. And one more: the Seer with v4 played 4,000 games against the Oracle, and v5 (the current network, `nn/v5.json`) was trained on all 24,000 games, starting from v4.

Each network trained for several passes over its games with 5% of the games held back, and the pass that predicted the held-back games best was kept (pass 2 of 6 for v3 and v4, pass 1 of 6 for v5).

**What made the difference.**
- *Learning from final scores alone fails.* A network trained only on how games ended started 4.4 lines a round but put only 12 cards on them in all, so most of those lines finished below zero. It lost 99% of its games to the Oracle and 98% to the Apprentice. In good players' games a started line usually means a strong hand, so it learned "started lines go with winning". The Oracle's estimates for the moves nobody played (starting a weak line, say) fixed that.
- *The Oracle's estimates run optimistic*, most likely because the opponents it imagines hold weaker hands than real ones keep. Its estimates came out higher than the real result by about 10 points through the middle of the round, peaking near 12 with 12 cards left, and by about 1 at the start and end. Training measures that gap for each number of cards left and takes it off.
- *Exact endings.* With one card left the result is known: the player who draws it ends the round. The network's players and the Seer play that moment exactly instead of guessing.
- *Repeating the loop.* Each round of games against the Oracle, with the Oracle scoring every position, made the next network stronger. On its own against the Oracle, v3 averaged −0.8 points a game, v4 +3.5 and v5 +6.9. The network learns most from the positions it reaches itself, and those change as it gets better.
- *Guarding its own cards.* The network rates throwing away a card its own line could use a few points too high. When every move carried some risk, the Oracle's rule also stopped checking such discards. On the first version 3 page the Seer threw away a 9 and an 8 it could have played, and its opponent simply took them. Now such a discard must win by the card's full worth (the Oracle asks for half), even when every move is risky. Against the Oracle that cut these discards from 0.21 to 0.07 a round (160 games each; its opponent had taken 25 of the 33), with no loss of strength: +0.2 ± 0.7 points a game over 1,000 games on the same deals.
- *Two independent code reviews* (16 and 15 AI reviewers, every finding reproduced before it counted) found the optimistic estimates and the end-of-round problem described above, and several smaller ones, before the long runs.

**Results** (duplicate pairs against the 80-simulation Oracle unless noted):

| Player | Games | Result |
|---|---|---|
| First network, trained on final scores only | 402 | won 0.9%, lost by 106 points a game |
| First network, with the Oracle's estimates (v1b) | 400 | won 42.8%, by −12.8 ± 2.1 points a game |
| Network v2 on its own (estimates de-biased, exact endings) | 400 | won 43.1% ± 2.4%, by −5.9 ± 2.1 |
| Network v3 on its own (after the expert-iteration round) | 400 | won 52.1% ± 2.3%, by −0.8 ± 1.9: level with the Oracle |
| Seer with v2, picking the highest average | 400 | won 47.4%, by −3.3 ± 2.0 |
| Seer with v2, with the Oracle's decision rule | 1,000 | won 52.9% ± 1.5%, by +3.3 ± 1.2 |
| Seer with v3, with the Oracle's decision rule | 1,000 | won 57.4% ± 1.5%, by +5.4 ± 1.2 points a game |
| Network v4 on its own | 1,000 | won 55.9% ± 1.5%, by +3.5 ± 1.1 |
| Seer with v4, with the Oracle's decision rule | 1,000 | won 56.4% ± 1.5%, by +6.8 ± 1.2 |
| **Network v5 on its own** (no search, under a millisecond a move) | **1,000** | **won 57.8% ± 1.4%, by +6.9 ± 1.1** |
| Seer with v5, with the Oracle's decision rule | 1,000 | won 61.1% ± 1.4%, by +10.8 ± 1.1 (4.0 ± 1.6 better than v4 on the same deals) |
| **Seer with v5, stricter about its own cards (the game's opponent)** | **1,000** | **won 61.9% ± 1.4%, by +11.1 ± 1.1** |
| Seer with v3 against the Apprentice | 400 | won 76.5% ± 2.0%, by +23.9 ± 1.7 (the Oracle: 67.6%, +16.3) |
| Network v3 on its own against the Apprentice | 400 | won 67.0% ± 2.3%, by +13.7 ± 1.7 |
| Seer with v5 against the Apprentice | 402 | won 75.4% ± 2.0%, by +24.0 ± 1.5 |
| Network v5 on its own against the Apprentice | 402 | won 70.6% ± 2.2%, by +17.3 ± 1.5 |
| Seer with v3 (80 simulations) against an Oracle with 320 | 402 | won 47.4% ± 2.3%, by −3.2 ± 1.8: an Oracle given four times the work still edges it |
| Seer with v3, both at 320 simulations | 400 | won 52.0% ± 2.3%, by +2.1 ± 1.9 |
| Seer with v4 (80 simulations) against an Oracle with 320 | 402 | won 53.2% ± 2.0%, by +2.2 ± 1.8 (5.5 ± 2.4 better than v3 on the same deals) |
| Network v4 on its own against an Oracle with 320 | 402 | won 49.5% ± 2.2%, by −1.8 ± 1.8: level |
| **Seer with v5 (80 simulations) against an Oracle with 320** | **804** | **won 55.2% ± 1.6%, by +5.2 ± 1.3: it beats an Oracle doing four times the work** |
| Network v5 on its own against an Oracle with 320 | 804 | won 52.0% ± 1.6%, by +2.3 ± 1.3 |
| Seer looking 2, 4 or 12 decisions ahead instead of 8 (with v2) | 200–400 each | none better than 8; 4 clearly weaker, 2 and 12 within noise |

**How long the runs took** on a 6-core Mac (pure JavaScript, one core per job):

| Run | Time |
|---|---|
| 10,000 Oracle-vs-Oracle training games | 1 h 41 min on 6 cores |
| 6,000 network-vs-Oracle games, every position scored by the Oracle | 1 h 1 min on 5 cores |
| 4,000 Seer-vs-Oracle games, every position scored by the Oracle | 49–52 min on 5 cores |
| Training one network on 16,000–24,000 games (6 passes) | 25–45 min on one core |
| 1,000 Seer-vs-Oracle test games | about 8 min on 5 cores (five 200-game runs at once) |

Training needs about 1.3 GB of memory per job, so on an 8 GB machine with other apps open, run one training job at a time.

To reproduce, from the project folder (`JSC` is macOS's built-in JavaScript engine; each step was split into parallel jobs with consecutive seeds):
```
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
# Oracle-vs-Oracle games (40 jobs like this, seeds 10001-10040)
$JSC src/engine.js nn/net.js nn/selfplay.js -- games=250 seed=10001 a=oracle b=oracle out=nn/data/oracle-10001.bin
# v2, from scratch, on those games
$JSC src/engine.js nn/net.js nn/train.js -- data=nn/data/oracle-10001.bin,... out=nn/v2s1.json epochs=10 qkeep=0.25
# A round against the Oracle, every position scored by it (20 jobs; the original round used v1b, whose weights no longer load)
$JSC src/engine.js nn/net.js nn/selfplay.js -- games=300 seed=20001 a=net b=oracle net=nn/v2s1.json label=oracle out=nn/data/r2-20001.bin
# The next network, starting from the last one, on all games so far
$JSC src/engine.js nn/net.js nn/train.js -- data=nn/data/oracle-10001.bin,...,nn/data/r2-20001.bin,... init=nn/v2s1.json out=nn/v3.json epochs=6 lr=0.0005 qkeep=0.25
# Later rounds use the Seer (20 jobs of 200 games), then train v4 from v3 and v5 from v4 the same way
$JSC src/engine.js nn/net.js nn/selfplay.js -- games=200 seed=30001 a=seer b=oracle net=nn/v3.json depth=8 advice=net label=oracle out=nn/data/r3-seer-30001.bin
# Test: five 200-game jobs (seeds 1-5), then merge them
$JSC src/engine.js nn/net.js tests/benchmark.js -- task=strength a=seer b=oracle seer=nn/v5.json depth=8 advice=net games=200 seed=1 json=seer-1.json
$JSC src/engine.js nn/net.js tests/benchmark.js -- merge=seer-1.json,seer-2.json,seer-3.json,seer-4.json,seer-5.json
```

