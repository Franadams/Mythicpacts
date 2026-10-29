# Mythic Pacts

A two-player card game of risk and reward, inspired by Reiner Knizia's *Lost Cities* and re-themed around five mythical realms: Sirens, Fairies, Dryads, Nymphs and Angels. You can play against the computer or with a friend on one screen. An Odds panel shows the probability and expected-value reasoning behind every move.

## Play it

Double-click `index.html`. It opens in your web browser. Nothing needs to be installed.

## Versions

| Version | Published page | Saved copy | In git |
|---|---|---|---|
| 1 | [claude.ai/artifact/VkrmMfEm4K25VUdz2XsJRb](https://claude.ai/artifact/VkrmMfEm4K25VUdz2XsJRb) | `versions/v1/mythic-pacts-v1.html` (open it in any browser) | tag `v1` |
| 2 | in progress | | branch `version-2` |

The saved copy is the exact page published as version 1. The source code at the `v1` tag also includes the card-back art, which was added just after version 1 was published.

## The art

The artwork lives in `art/` as the sheets made in ChatGPT:

| File | What the game takes from it |
|---|---|
| `Fairies.png`, `Sirens.png`, `Dryads.png`, `Angels.png`, `Nymphs.png` | Each sheet holds 11 cards: 1–6 on the top row, then 7, 8, 9, 10 and ×. Cards 2–10 become the number cards and × becomes the Pact. Card 1 isn't used, because the game's numbers start at 2. |
| `Cystals.png` | The five crystals, in the order Fairies, Sirens, Dryads, Nymphs, Angels. They're cut out with a transparent background. |
| `GameBoard.png` | The five realm portraits. They become the empty discard spaces in the middle of the table and the row of portraits on the start screen. |
| `card-back.png` (optional) | The back of the cards. Without it, the game draws a crystal pattern. |

If you change any art, run:

```
cd ~/mythic-cards
python3 prepare_art.py
```

It finds every card on a sheet automatically. It fills the background in from the edges, and since each card frame is a closed border, whatever the fill can't reach is a card. It saves the pieces to `assets/` and lists them in `assets/art.js`. Then refresh the browser. It only uses Python's standard library and macOS's built-in `sips` tool.

## Make a shareable version

```
cd ~/mythic-cards
python3 build.py
```

This runs `prepare_art.py`, then packs the game and all 60 images into one file, `dist/mythic-pacts.html` (about 7 MB). That file works anywhere: as an email attachment, on a USB stick, or uploaded to a website.

## How it works (talking points)

**The rules engine** is a set of small, pure functions with no drawing code. A card is just a number from 0 to 59, which makes the game state quick to copy. That speed is what makes thousands of simulations per move possible.

**Apprentice (rules of thumb).** It plays the lowest card that fits a line, avoids skipping cards that could still turn up, only starts a line when its cards are likely to cover the 20-point cost, and avoids discarding cards its opponent needs. It sees only what a human player would see.

**Oracle (Monte Carlo simulation).** On every decision it:
1. Deals the cards it hasn't seen at random between the deck and the opponent's hand. This is called *determinization*. Cards the opponent visibly took from a discard pile stay in the opponent's hand.
2. For every legal move, plays the rest of the round out with the Apprentice strategy on both sides.
3. Repeats this 80 times and averages the final point margin for each move.

Two statistical details make the Oracle stronger:
- **Common random numbers.** Every move is tested on the same simulated deals, so the comparison measures the move, not the luck of the deal.
- **A significance check.** The Oracle only moves away from the rules-of-thumb choice when another move wins by more than one standard error of the paired difference. Taking the highest noisy average tends to pick lucky moves rather than good ones. Without this check the search actually lost to the simpler player.

**Measured results** (computer-vs-computer runs, seats alternated):

| Matchup | Games | Result |
|---|---|---|
| Apprentice vs random play | 300 | Apprentice won all 300 |
| Oracle vs Apprentice | 200 | Oracle won 146 (73% ± 3%); average score 46 to 25 |
| Oracle without the significance check vs Apprentice | 200 | Oracle won 89 (44% ± 4%); average score 34 to 34 |

**The Odds panel** uses the same engine for the human player:
- *Card count:* every card is either in your hand, on the table, known to be held by your opponent, or unseen.
- *Chance a card reaches you:* each unseen card is equally likely to be in any of the hidden places (the deck plus the opponent's unknown cards). You draw about half of the remaining deck, so each card's chance is your draws divided by the hidden places. The chance of getting at least one of several cards comes from the hypergeometric distribution.
- *Best move and forecast:* 200 simulated endings per decision, with the average lead, its margin of error, and for each line the chance of finishing in profit or earning a crystal.

This is the same kind of reasoning used to price a sports market: count what you know, simulate what you don't, and only act when the edge is bigger than the noise.
