/* =====================================================================
   GAME ENGINE
   Pure rules and AI. No drawing code lives here, so it can be tested
   on its own. A card is a number from 0 to 59:
     realm = card / 12 (rounded down), and within a realm
     0-2 are the three Pact cards, 3-11 are the numbers 2-10.
   ===================================================================== */
const REALMS = 5;
const PER_REALM = 12;
const DECK_SIZE = 60;
const HAND = 8;
const COST = 20;           // starting a line costs 20 points
const CRYSTAL_AT = 8;      // a line of 8 or more cards earns a crystal
const CRYSTAL_BONUS = 20;

const realmOf = c => (c / PER_REALM) | 0;
const valueOf = c => { const k = c % PER_REALM; return k < 3 ? 0 : k - 1; };   // 0 means Pact
const numberCard = (realm, value) => realm * PER_REALM + value + 1;

// Small seeded random number generator (mulberry32), so simulations can be replayed.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

const emptyRows = () => [[], [], [], [], []];

function newRound(first, rnd) {
  const deck = shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i), rnd);
  const hands = [[], []];
  for (let i = 0; i < HAND; i++) { hands[0].push(deck.pop()); hands[1].push(deck.pop()); }
  return {
    hands,
    exp: [emptyRows(), emptyRows()],   // each player's five lines
    discard: emptyRows(),              // five shared discard piles
    deck,                              // top of the deck is the end of the array
    turn: first,
    phase: 'play',                     // 'play' -> 'draw' -> next player's 'play'
    lastDiscard: -1,                   // realm discarded to this turn (can't draw it back)
    known: [[], []],                   // cards each player took from a discard pile: public knowledge
    over: false,
  };
}

function topValue(pile) { return pile.length ? valueOf(pile[pile.length - 1]) : -1; }

// Lines must go up. Pacts may only be played before any numbers.
function canPlay(pile, card) {
  const t = topValue(pile);
  if (t < 0) return true;
  const v = valueOf(card);
  return v === 0 ? t === 0 : v > t;
}

function scorePile(pile) {
  let sum = 0, pacts = 0;
  for (const c of pile) { const v = valueOf(c); if (v) sum += v; else pacts++; }
  if (!pile.length) return { cards: 0, sum: 0, pacts: 0, mult: 1, base: 0, crystal: false, total: 0 };
  const mult = pacts + 1;
  const base = (sum - COST) * mult;
  const crystal = pile.length >= CRYSTAL_AT;
  return { cards: pile.length, sum, pacts, mult, base, crystal, total: base + (crystal ? CRYSTAL_BONUS : 0) };
}

function pileTotal(pile) {
  if (!pile.length) return 0;
  let sum = 0, pacts = 0;
  for (const c of pile) { const v = valueOf(c); if (v) sum += v; else pacts++; }
  return (sum - COST) * (pacts + 1) + (pile.length >= CRYSTAL_AT ? CRYSTAL_BONUS : 0);
}

function playerTotal(st, p) {
  let t = 0;
  for (const pile of st.exp[p]) t += pileTotal(pile);
  return t;
}

function removeFrom(arr, x) {
  const i = arr.indexOf(x);
  if (i >= 0) arr.splice(i, 1);
  return i >= 0;
}

function legalMoves(st) {
  const p = st.turn, hand = st.hands[p], out = [];
  for (const c of hand) {
    // Pacts of the same realm are interchangeable, so list only one of them.
    if (valueOf(c) === 0 && hand.some(d => d < c && realmOf(d) === realmOf(c) && valueOf(d) === 0)) continue;
    if (canPlay(st.exp[p][realmOf(c)], c)) out.push({ type: 'play', card: c });
    out.push({ type: 'discard', card: c });
  }
  return out;
}

function legalDraws(st) {
  const out = [-1];
  for (let r = 0; r < REALMS; r++) if (st.discard[r].length && r !== st.lastDiscard) out.push(r);
  return out;
}

function applyMove(st, move) {
  const p = st.turn, c = move.card, r = realmOf(c);
  if (st.phase !== 'play' || st.hands[p].indexOf(c) < 0) throw new Error('Illegal move');
  if (move.type === 'play' && !canPlay(st.exp[p][r], c)) throw new Error('Illegal play');
  removeFrom(st.hands[p], c);
  removeFrom(st.known[p], c);
  if (move.type === 'play') { st.exp[p][r].push(c); st.lastDiscard = -1; }
  else { st.discard[r].push(c); st.lastDiscard = r; }
  st.phase = 'draw';
}

// src = -1 for the deck, or a realm index for that discard pile. Returns the card drawn.
function applyDraw(st, src) {
  const p = st.turn;
  if (st.phase !== 'draw') throw new Error('Not time to draw');
  let card;
  if (src < 0) card = st.deck.pop();
  else {
    if (src === st.lastDiscard || !st.discard[src].length) throw new Error('Illegal draw');
    card = st.discard[src].pop();
    st.known[p].push(card);
  }
  st.hands[p].push(card);
  st.lastDiscard = -1;
  if (!st.deck.length) { st.over = true; st.phase = 'over'; }   // the round ends the moment the deck runs out
  else { st.turn ^= 1; st.phase = 'play'; }
  return card;
}

function cloneState(st) {
  return {
    hands: [st.hands[0].slice(), st.hands[1].slice()],
    exp: [st.exp[0].map(a => a.slice()), st.exp[1].map(a => a.slice())],
    discard: st.discard.map(a => a.slice()),
    deck: st.deck.slice(),
    turn: st.turn,
    phase: st.phase,
    lastDiscard: st.lastDiscard,
    known: [st.known[0].slice(), st.known[1].slice()],
    over: st.over,
  };
}

/* ---------------------------------------------------------------------
   GIFTS
   A discard is a gift when the opponent could pick it up and use it.
   - 'feeds': they have started that realm and the card fits their line
     (a number above their top card, or a Pact while their line holds
     only Pacts). In simulated games the opponent took such a discard
     and ended the round with it on a line 59% of the time against the
     Apprentice (243 discards) and 67% against the Oracle (12).
   - 'could-start': they have not started that realm, the card is a
     number from START_GIFT_MIN_VALUE up, at least START_GIFT_MIN_DECK
     cards are left so there is time to build on it, and we have not
     started that realm ourselves (then most of its cards are ours).
     Those discards were taken and played 36% of the time against the
     Apprentice (8,532 discards) and 52% against the Oracle (399); every
     other unstarted-realm discard only 7% and 16% (tests/calibrate.js).
   Cards the opponent can never use, such as numbers below their top
   card, are not gifts.
   --------------------------------------------------------------------- */
const START_GIFT_MIN_VALUE = 3;
const START_GIFT_MIN_DECK = 8;

// 0 = not a gift, 1 = feeds a line they have started, 2 = could start one.
function giftKind(st, p, card) {
  const o = p ^ 1, r = realmOf(card), theirs = st.exp[o][r];
  if (theirs.length) return canPlay(theirs, card) ? 1 : 0;
  if (valueOf(card) < START_GIFT_MIN_VALUE || st.deck.length < START_GIFT_MIN_DECK) return 0;
  return st.exp[p][r].length ? 0 : 2;
}

// What discarding `card` would cost player p's own lines: null, or { realm, worth, next } when p has
// started that realm and could still play the card on it. worth is the points it would add there now
// (a Pact counts as 5). The opponent can pick such a discard up to deny it. next: the card is a number
// that goes straight onto the line, with every card in between already on a line and, on a line of
// Pacts only, no Pact of that realm still to come (a number ends the Pacts), so nothing it could wait
// for: playing it can only add points (the 20-point cost is already paid), and throwing it away is
// never right.
function ownLoss(st, p, card) {
  const r = realmOf(card), pile = st.exp[p][r];
  if (!pile.length || !canPlay(pile, card)) return null;
  const s = scorePile(pile), v = valueOf(card);
  let next = v > 0;
  if (next && topValue(pile) === 0) {   // a number ends the Pacts: only next when none can still come
    const live = liveMap(st);
    for (let k = 0; next && k < 3; k++) next = !live[r * PER_REALM + k];
  }
  for (let w = Math.max(topValue(pile), 1) + 1; next && w < v; w++) {
    const c = numberCard(r, w);
    next = st.exp[0][r].indexOf(c) >= 0 || st.exp[1][r].indexOf(c) >= 0;
  }
  return { realm: r, worth: v ? v * s.mult : 5, next };
}

// What playing `card` now would give up on p's line: the lower numbers it jumps over. Each one in p's
// hand becomes unplayable (a sure loss); each one still unseen might have arrived in time, with chance
// (p's turns left) / (hidden places). Returns null for a small loss, else { loss, skipped }.
function skipLoss(st, p, card) {
  const r = realmOf(card), v = valueOf(card), pile = st.exp[p][r];
  if (!v || !canPlay(pile, card)) return null;
  const D = st.deck.length, T = Math.ceil(D / 2), o = p ^ 1;
  const hidden = D + st.hands[o].length - st.known[o].length;
  const pGet = hidden ? Math.min(1, T / hidden) : 0;
  const live = liveMap(st), mine = handMask(st.hands[p]);
  let loss = 0;
  const skipped = [];
  for (let w = Math.max(topValue(pile), 1) + 1; w < v; w++) {
    const c = numberCard(r, w);
    if (mine[c]) { loss += w; skipped.push(w); }
    else if (live[c] && st.known[o].indexOf(c) < 0) { loss += w * pGet; skipped.push(w); }
  }
  return loss >= SKIP_MIN ? { loss, skipped } : null;
}

// Playing the first card of a realm commits 20 points. contested counts the opponent's cards in that
// realm (Pacts twice: they show conviction), since they will be holding many of its remaining cards.
function openRisk(st, p, card) {
  const r = realmOf(card);
  if (st.exp[p][r].length) return null;
  let contested = 0;
  for (const c of st.exp[p ^ 1][r]) contested += valueOf(c) ? 1 : 2;
  return { realm: r, contested };
}

// What discarding `card` would hand player p's opponent: null, or { kind: 'feeds' | 'could-start', realm }.
function giftRisk(st, p, card) {
  const k = giftKind(st, p, card);
  return k ? { kind: k === 1 ? 'feeds' : 'could-start', realm: realmOf(card) } : null;
}

/* ---------------------------------------------------------------------
   RULES-OF-THUMB PLAYER ("Apprentice")
   Uses only what a real player can see: its own hand, the table, and
   how many cards are left. It is also the quick policy used to play
   out every simulated future in the Monte Carlo search below.
   --------------------------------------------------------------------- */

// Cards that could still turn up: not on any line and not buried in a discard pile.
function liveMap(st) {
  const live = new Uint8Array(DECK_SIZE).fill(1);
  for (const side of st.exp) for (const pile of side) for (const c of pile) live[c] = 0;
  for (const pile of st.discard) for (let i = 0; i < pile.length - 1; i++) live[pile[i]] = 0;
  return live;
}

function handMask(hand) {
  const m = new Uint8Array(DECK_SIZE);
  for (const c of hand) m[c] = 1;
  return m;
}

// Count still-live cards strictly between two values that we don't already hold.
function gapsBetween(r, lo, hi, live, mask) {
  let n = 0;
  for (let w = Math.max(lo, 1) + 1; w < hi; w++) {
    const c = numberCard(r, w);
    if (live[c] && !mask[c]) n++;
  }
  return n;
}

// Expected points from unseen cards above `above` that may still reach us.
function expectedExtra(r, above, live, mask, pGet) {
  let s = 0;
  for (let w = Math.max(above, 1) + 1; w <= 10; w++) {
    const c = numberCard(r, w);
    if (live[c] && !mask[c]) s += w;
  }
  return s * pGet * 0.55;
}

// Gift avoidance in the discard choice. Keep scores: about -8 for a card we can never play, -4 to +3
// for most cards of realms we have not started, 6 and up for cards that fit our own lines.
const SAFE_FEED_KEEP = 3;      // rather than feed their line, discard any card we value at most this
const SAFE_START_KEEP = 0;     // rather than hand them a line starter, discard any card we value at most this
const PLAY_OVER_FEED = -3;    // rather than feed their line, make our best play if it scores above this

function heuristicMove(st, rnd, noise) {
  const p = st.turn, hand = st.hands[p], mine = st.exp[p], opp = st.exp[p ^ 1];
  const D = st.deck.length, T = Math.ceil(D / 2);   // turns I have left, including this one
  const pGet = T / (D + HAND);
  const live = liveMap(st), mask = handMask(hand);

  const plan = [];
  let pending = 0;
  for (let r = 0; r < REALMS; r++) {
    const pile = mine[r];
    let lowest = -1, lowNum = -1, sum = 0, n = 0, pacts = 0;
    for (let k = 0; k < PER_REALM; k++) {
      const c = r * PER_REALM + k;
      if (!mask[c] || !canPlay(pile, c)) continue;
      if (lowest < 0) lowest = c;
      const v = valueOf(c);
      if (v) { sum += v; n++; if (lowNum < 0) lowNum = c; } else pacts++;
    }
    plan.push({ pile, lowest, lowNum, sum, n, pacts, started: pile.length > 0, t: topValue(pile) });
    if (pile.length) pending += n + pacts;
  }
  const rush = pending >= T;   // more cards to place than turns left

  let best = -1, bestScore = 0, fallback = -1, fallbackScore = -Infinity;
  for (let r = 0; r < REALMS; r++) {
    const pl = plan[r];
    if (pl.lowest < 0) continue;
    const v = valueOf(pl.lowest);
    let s, card = pl.lowest;
    if (pl.started) {
      if (v === 0 && pl.sum + expectedExtra(r, 1, live, mask, pGet) >= 24) s = 3;   // another Pact on a Pact-only line
      else if (pl.lowNum >= 0) {
        card = pl.lowNum;
        s = 7 - 2.5 * gapsBetween(r, pl.t, valueOf(card), live, mask) + (rush ? 8 : 0);
      } else s = -3;
    } else if (pl.n + pl.pacts > T) {
      // Not enough turns to play every card: judge the line on the best ones there is time for.
      const vals = [];
      for (let k = 3; k < PER_REALM; k++) if (mask[r * PER_REALM + k]) vals.push(k - 1);
      const keep = vals.slice(-T);
      const proj = keep.reduce((a, b) => a + b, 0) - COST;
      if (proj > 0) { card = numberCard(r, keep[0]); s = proj / 3; } else s = -9;
    } else {
      let contested = 0;
      for (const c of opp[r]) contested += valueOf(c) ? 1 : 2;
      const proj = pl.sum + expectedExtra(r, v || 1, live, mask, pGet) - COST - HEUR_CONTEST * contested;
      if (v === 0) s = proj >= 8 ? proj * (pl.pacts + 1) / 6 : -9;
      else s = proj / 3 - 0.3 * (v - 2);
    }
    if (noise) s += (rnd() - 0.5) * noise;
    if (s > bestScore) { bestScore = s; best = card; }
    if (pl.started && s > fallbackScore) { fallbackScore = s; fallback = card; }
  }
  if (best >= 0) return { type: 'play', card: best };

  // Nothing worth playing: discard the card we need least and that helps the opponent least,
  // but avoid gifts (cards the opponent could pick up and use) when a cheap alternative exists.
  let worst = hand[0], worstKeep = Infinity, noFeed = -1, noFeedKeep = Infinity, noGift = -1, noGiftKeep = Infinity;
  for (const c of hand) {
    const r = realmOf(c), v = valueOf(c), pl = plan[r];
    let keep;
    if (!canPlay(pl.pile, c)) keep = -8;
    else if (pl.started) keep = 6 + v * 0.3;
    else keep = Math.max(-4, (pl.sum + expectedExtra(r, 1, live, mask, pGet) - COST) / 3) + (v ? v * 0.12 : -0.5);
    const op = opp[r];
    if (canPlay(op, c)) {
      if (op.length) keep += v ? Math.max(0, 7 - 1.5 * (v - Math.max(topValue(op), 1) - 1)) : 3;
      else keep += v * 0.15;
    }
    if (noise) keep += (rnd() - 0.5) * noise;
    const gift = giftKind(st, p, c);
    if (keep < worstKeep) { worstKeep = keep; worst = c; }
    if (gift !== 1 && keep < noFeedKeep) { noFeedKeep = keep; noFeed = c; }
    if (!gift && keep < noGiftKeep) { noGiftKeep = keep; noGift = c; }
  }
  if (giftKind(st, p, worst) && noGiftKeep <= SAFE_START_KEEP) worst = noGift;
  if (giftKind(st, p, worst) === 1) {
    if (noFeedKeep <= SAFE_FEED_KEEP) worst = noFeed;
    else if (fallbackScore > PLAY_OVER_FEED) return { type: 'play', card: fallback };
  }
  return { type: 'discard', card: worst };
}

function heuristicDraw(st, rnd, noise) {
  const p = st.turn, mine = st.exp[p], opp = st.exp[p ^ 1];
  const live = liveMap(st), mask = handMask(st.hands[p]);
  let bestSrc = -1, bestVal = 1 + (noise ? (rnd() - 0.5) * noise : 0);
  for (let r = 0; r < REALMS; r++) {
    const pile = st.discard[r];
    if (!pile.length || r === st.lastDiscard) continue;
    const c = pile[pile.length - 1], v = valueOf(c), mp = mine[r];
    let val = -3;
    if (canPlay(mp, c)) {
      if (mp.length) val = v ? 5.5 - 2 * gapsBetween(r, topValue(mp), v, live, mask) : 0.5;
      else {
        let sum = v;
        for (let k = 3; k < PER_REALM; k++) if (mask[r * PER_REALM + k]) sum += k - 1;
        val = (sum - COST) / 3;
      }
    }
    const op = opp[r];
    if (op.length && v && canPlay(op, c)) val = Math.max(val, 0) + Math.max(0, 2.5 - 0.5 * (v - Math.max(topValue(op), 1) - 1));
    if (noise) val += (rnd() - 0.5) * noise;
    if (val > bestVal) { bestVal = val; bestSrc = r; }
  }
  return bestSrc;
}

/* ---------------------------------------------------------------------
   READING THE OPPONENT
   Not every unseen card is equally likely to be in the opponent's
   hand. Players hold on to cards that fit their lines and throw away
   the ones they cannot use, so the table gives clues. Each unseen card
   is sorted using public information only: the lines, the discard
   piles, the cards the opponent visibly took from a discard pile, and
   how many cards are left. The hidden cards themselves are never
   looked at.
   --------------------------------------------------------------------- */
const EVIDENCE = [
  'dead',             // below the top of their line in that realm: they can never play it
  'pact',             // a Pact they can still add to their Pact-only line
  'next',             // a number above their top with no live number in between
  'gap 1',            // a number above their top with 1 live number in between (one that could still turn up)
  'gap 2',
  'gap 3',
  'gap 4+',
  'unstarted pact',   // a realm they have not started
  'unstarted 2-3',
  'unstarted 4-10',
  'taken pact',       // a realm they have not started, but they took a card of it from a discard pile
  'taken 2-3',
  'taken 4-10',
];
const phaseOf = deckLeft => deckLeft >= 30 ? 0 : deckLeft >= 15 ? 1 : 2;   // early, middle, late in the round

// HAND_WEIGHTS[kind][phase] is the weight of an unseen card when dealing the opponent's hand.
// A weight of 2 makes a card about twice as likely as an average unseen card to be dealt to them.
// Fitted by tests/calibrate.js on 5,280 of 6,600 simulated games (628,104 decisions, 18.6 million
// observations of an unseen card). On the 1,320 held-out games the table predicts which unseen cards
// the opponent holds better than dealing uniformly (log-loss 0.502 vs 0.532 nats per card), and the
// share of each kind of card it deals to the opponent matches the truth within 2 percentage points.
const HAND_WEIGHTS = [
  // 30+   15-29  <15 cards left in the deck
  [0.23, 0.33, 0.51],   // dead
  [0.45, 0.54, 0.62],   // pact
  [0.92, 0.60, 0.65],   // next
  [1.01, 0.79, 0.99],   // gap 1
  [1.19, 1.08, 1.32],   // gap 2
  [2.31, 2.44, 2.37],   // gap 3
  [3.18, 3.29, 2.93],   // gap 4+
  [0.81, 0.80, 1.01],   // unstarted pact
  [0.82, 0.80, 0.98],   // unstarted 2-3
  [0.99, 1.05, 1.10],   // unstarted 4-10
  [1.48, 1.55, 1.69],   // taken pact
  [0.94, 1.19, 1.54],   // taken 2-3
  [3.03, 2.96, 2.76],   // taken 4-10
];

// Public clues about every card, from player p's side: kind[c] indexes EVIDENCE (-1 for cards p can
// see) and phase indexes the columns of HAND_WEIGHTS.
function handEvidence(st, p) {
  const o = p ^ 1, live = liveMap(st);
  const seen = new Uint8Array(DECK_SIZE);
  for (const c of st.hands[p]) seen[c] = 1;
  for (const side of st.exp) for (const pile of side) for (const c of pile) seen[c] = 1;
  for (const pile of st.discard) for (const c of pile) seen[c] = 1;
  for (const c of st.known[o]) seen[c] = 1;
  const taken = [0, 0, 0, 0, 0];
  for (const c of st.known[o]) taken[realmOf(c)] = 1;
  const kind = new Int8Array(DECK_SIZE).fill(-1);
  for (let c = 0; c < DECK_SIZE; c++) {
    if (seen[c]) continue;
    const r = realmOf(c), v = valueOf(c), theirs = st.exp[o][r];
    if (theirs.length) {
      if (!canPlay(theirs, c)) kind[c] = 0;
      else if (!v) kind[c] = 1;
      else {
        let gap = 0;
        for (let w = Math.max(topValue(theirs), 1) + 1; w < v; w++) if (live[numberCard(r, w)]) gap++;
        kind[c] = 2 + Math.min(gap, 4);
      }
    } else kind[c] = 7 + 3 * taken[r] + (v === 0 ? 0 : v <= 3 ? 1 : 2);
  }
  return { kind, phase: phaseOf(st.deck.length) };
}

// Weight of every card for dealing the opponent's unknown hand (0 for cards player p can see).
// `table` replaces HAND_WEIGHTS, for example with one learned from a particular player.
function opponentWeights(st, p, table = HAND_WEIGHTS) {
  const ev = handEvidence(st, p), w = new Float64Array(DECK_SIZE);
  for (let c = 0; c < DECK_SIZE; c++) if (ev.kind[c] >= 0) w[c] = table[ev.kind[c]][ev.phase];
  return w;
}

/* ---------------------------------------------------------------------
   LEARNING ONE PLAYER'S HABITS
   After a round is over, every decision the Oracle made can be looked
   back on: which unseen cards was this player really holding, compared
   with what the model above predicted? Counting that per kind of
   evidence shows whether this player holds, say, high cards or Pacts
   more or less often than the model expects, and the weights are
   adjusted by that ratio. The counts only ever come from finished
   rounds, so the round being played never uses the player's hidden cards.
   --------------------------------------------------------------------- */
const PRIOR_STRENGTH = 40;   // until a kind of card has this many predicted holdings, trust the model more than the data

const emptyStudy = () => ({ held: HAND_WEIGHTS.map(r => r.map(() => 0)), predicted: HAND_WEIGHTS.map(r => r.map(() => 0)) });

// Add one decision of player p to `study`: for every card p could not see, was it really in the
// opponent's hand (held), against the model's chance that it was (predicted)?
function studyDecision(study, st, p) {
  const o = p ^ 1, ev = handEvidence(st, p), w = opponentWeights(st, p);
  const unknown = st.hands[o].length - st.known[o].length;
  let sum = 0;
  for (let c = 0; c < DECK_SIZE; c++) sum += w[c];
  if (!sum || !unknown) return study;
  const inHand = handMask(st.hands[o]);
  for (let c = 0; c < DECK_SIZE; c++) {
    const k = ev.kind[c];
    if (k < 0) continue;
    study.predicted[k][ev.phase] += Math.min(1, unknown * w[c] / sum);
    if (inHand[c]) study.held[k][ev.phase] += 1;
  }
  return study;
}

function mergeStudy(into, add) {
  for (let k = 0; k < into.held.length; k++) for (let ph = 0; ph < 3; ph++) {
    into.held[k][ph] += add.held[k][ph];
    into.predicted[k][ph] += add.predicted[k][ph];
  }
  return into;
}

// HAND_WEIGHTS adjusted to one player: each weight is scaled by how much more (or less) often this player
// really held that kind of card than the model predicted, shrunk towards no change while data is thin.
function personalWeights(study) {
  return HAND_WEIGHTS.map((row, k) => row.map((w, ph) => {
    const ratio = (study.held[k][ph] + PRIOR_STRENGTH) / (study.predicted[k][ph] + PRIOR_STRENGTH);
    return w * Math.min(3, Math.max(1 / 3, ratio));
  }));
}

/* ---------------------------------------------------------------------
   MONTE CARLO SEARCH ("Oracle" and the Odds panel)
   1. Deal a possible world: the unseen cards are split between the
      opponent's unknown hand and the deck, leaning on the public clues
      above (determinize). Cards they visibly took stay in their hand.
   2. For every legal move, play the rest of the round out in that world
      with the rules-of-thumb player on both sides, and record the final
      lead. Every move is tested on the same worlds (common random
      numbers), so differences come from the move, not from luck.
   3. Repeat for many worlds and compare moves by their PAIRED
      differences, world by world, with standard errors.
   4. Decide (pickAdvice): a gift may only be recommended when it beats
      the best non-gift clearly and by enough points (GIFT_RULES: a card
      that fits their line must win by 3+ points and 2+ standard errors;
      in 2,000 test positions that halved how often the advice fed the
      opponent, from 1.9% to 0.9%, with no loss of playing strength).
      Throwing away a card our own line could still use must win by at
      least half its worth there (OWN_SHARE): the simulated opponent takes
      such cards to deny us, and the extra turn that buys looked worth 10
      sure points in simulation but wasn't in real games. The rule cut those
      discards from 0.9% of the Oracle's decisions to 0.07% and won 53.9% of
      400 games against the version without it (+3.7 points a game). A
      number that goes straight onto our line, with nothing in between (or,
      on a line of Pacts only, no Pact) left to wait for, is never thrown
      away: playing it can only add points.
      Jumping over lower cards it could still play (opening a line with a
      7 early, say) must win by half their expected worth (SKIP_SHARE).
      That cut early openings with a 6 or higher by about a third, at no
      cost in strength (52.7% of 400 games, +2.4 +- 1.5 points a game).
      Opening a new line commits 20 points, so unless the rules of thumb
      would open it too it must win by OPEN_MIN points, plus OPEN_CONTEST
      per card the opponent already has in that realm (they hold its other
      cards). With the rules of thumb no longer starting a line just to
      avoid feeding the opponent, this cut weak openings (under 15 points
      in hand for that realm) by almost half, raised the average line from
      +11.4 to +15.0 points, and played level with the version without it
      (50.5% of 400 games). The
      rules-of-thumb move stays the default unless another allowed move
      beats it by more than ANCHOR_Z standard errors, because picking
      the highest noisy average chases luck rather than skill.
   --------------------------------------------------------------------- */
const ROLLOUT_NOISE = 0.5;
const ANCHOR_Z = 1;
// A gift must also beat the best non-gift by a meaningful number of points, not just a reliable sliver:
// handing the opponent a card they can put straight on a line is only worth it for a real gain.
const GIFT_RULES = { feeds: { z: 2, minEdge: 3 }, 'could-start': { z: 1, minEdge: 1.5 } };
// Throwing away a card our own line could use (the opponent will often take it to deny us) must win by
// at least OWN_SHARE of the points that card is worth on our line, and by OWN_Z standard errors.
const OWN_Z = 2, OWN_SHARE = 0.5, OWN_MIN = 3;
// Jumping over lower cards that could still be played (opening a line with a 7 early, say) must win by
// SKIP_SHARE of the expected points given up, and by SKIP_Z standard errors.
const SKIP_Z = 1, SKIP_SHARE = 0.5, SKIP_MIN = 3;
// Opening a new line (unless the rules of thumb would too) must win by OPEN_MIN points, plus
// OPEN_CONTEST for each card the opponent already has in that realm.
const OPEN_RULE = true, OPEN_Z = 1, OPEN_MIN = 3, OPEN_CONTEST = 2;
const HEUR_CONTEST = 0;   // rules of thumb: points knocked off a new line's prospects per opponent card there

// A possible world: the unseen cards dealt between the opponent's unknown hand and the deck.
// The opponent's hand is drawn with the weights above by Efraimidis-Spirakis sampling: each
// unseen card draws the key -ln(U) / weight (U uniform on 0..1) and the cards with the smallest
// keys go to the opponent. That is the same as drawing cards one at a time, each with chance
// proportional to its weight. The rest are shuffled into the deck.
function determinize(st, p, rnd, weights) {
  const s = cloneState(st), o = p ^ 1, w = weights || opponentWeights(st, p);
  const pool = [], key = new Float64Array(DECK_SIZE);
  for (let c = 0; c < DECK_SIZE; c++) if (w[c] > 0) { pool.push(c); key[c] = -Math.log(1 - rnd()) / w[c]; }
  pool.sort((a, b) => key[a] - key[b]);
  const unknown = st.hands[o].length - st.known[o].length;
  s.hands[o] = st.known[o].concat(pool.slice(0, unknown));
  s.deck = shuffle(pool.slice(unknown), rnd);
  return s;
}

function rollout(s, rnd, noise) {
  let guard = 0;
  while (!s.over && guard++ < 500) {
    if (s.phase === 'play') applyMove(s, heuristicMove(s, rnd, noise));
    else applyDraw(s, heuristicDraw(s, rnd, noise));
  }
  return s;
}

// Mean and standard error of a sample.
function meanSe(a) {
  const n = a.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += a[i];
  m /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (a[i] - m) * (a[i] - m);
  return { mean: m, se: n > 1 ? Math.sqrt(v / (n - 1) / n) : 0 };
}

function* analyze(st, p, samples, seed, settings = {}) {
  const opts = st.phase === 'play'
    ? legalMoves(st)
    : legalDraws(st).map(src => ({ type: 'draw', src }));
  const k = opts.length;
  const margins = opts.map(() => new Float64Array(samples));
  const weights = opponentWeights(st, p, settings.handWeights);
  const master = makeRng(seed);
  for (let i = 0; i < samples; i++) {
    const world = determinize(st, p, master, weights);
    const seedI = (master() * 4294967296) >>> 0;
    for (let j = 0; j < k; j++) {
      const s = cloneState(world), o = opts[j];
      if (o.type === 'draw') applyDraw(s, o.src); else applyMove(s, o);
      rollout(s, makeRng(seedI), ROLLOUT_NOISE);
      margins[j][i] = playerTotal(s, p) - playerTotal(s, p ^ 1);
    }
    yield (i + 1) / samples;
  }

  const options = opts.map((o, j) => Object.assign({}, o, meanSe(margins[j]), {
    j, gift: o.type === 'discard' ? giftRisk(st, p, o.card) : null,
    own: o.type === 'discard' ? ownLoss(st, p, o.card) : null,
    skip: o.type === 'play' ? skipLoss(st, p, o.card) : null,
    open: o.type === 'play' && OPEN_RULE ? openRisk(st, p, o.card) : null,
  })).sort((a, b) => b.mean - a.mean);
  const h = st.phase === 'play' ? heuristicMove(st, null, 0) : heuristicDraw(st, null, 0);
  const same = (a, b) => realmOf(a) === realmOf(b) && valueOf(a) === valueOf(b);
  const anchor = options.find(o => st.phase === 'play' ? o.type === h.type && same(o.card, h.card) : o.src === h) || null;
  const { best, avoided, avoidedReason, edge, edgeSe } = pickAdvice(options, margins, anchor);
  for (const o of options) o.recommended = o === best;
  return {
    options, best, samples, rollouts: samples * k,
    anchored: avoidedReason === 'noise', edge, edgeSe, avoided, avoidedReason,
  };
}

// The decision rule. options: sorted by mean, each with its index j into margins and its gift (or null);
// margins[j]: the simulated final leads of option j, world by world (the same worlds for every option);
// anchor: the option the rules of thumb would pick, or null.
function pickAdvice(options, margins, anchor) {
  // Paired comparison on the same simulated worlds: how much better is a than b, and how sure are we?
  const paired = (a, b) => meanSe(margins[a.j].map((x, i) => x - margins[b.j][i]));
  const clearlyBetter = (a, b, z, minEdge = 0) => { const d = paired(a, b); return d.mean > Math.max(z * d.se, minEdge); };

  // 1. A risky discard may only be chosen when it clearly beats the best safe option, by enough points:
  //    a gift must be worth handing the opponent a usable card, and a card our own line could use
  //    must be worth throwing away (the opponent will often pick it up to deny us).
  const risky = o => !!(o.gift || o.own || o.skip || o.open);
  const bestSafe = options.find(o => !risky(o));
  const allowed = o => {
    if (o.own && o.own.next) return false;   // playing that card can only add points, so never throw it away
    if (!risky(o) || !bestSafe) return true;
    let z = 0, minEdge = 0;
    if (o.gift) { const rule = GIFT_RULES[o.gift.kind]; z = rule.z; minEdge = rule.minEdge; }
    if (o.own) { z = Math.max(z, OWN_Z); minEdge = Math.max(minEdge, OWN_MIN, OWN_SHARE * o.own.worth); }
    if (o.skip) { z = Math.max(z, SKIP_Z); minEdge = Math.max(minEdge, SKIP_SHARE * o.skip.loss); }
    // An opening the rules of thumb would also make is trusted; any other must clearly earn its 20 points.
    if (o.open && !(anchor && anchor.type === 'play' && anchor.open && realmOf(anchor.card) === o.open.realm)) {
      z = Math.max(z, OPEN_Z); minEdge = Math.max(minEdge, OPEN_MIN + OPEN_CONTEST * o.open.contested);
    }
    return clearlyBetter(o, bestSafe, z, minEdge);
  };
  const top = options.find(allowed);
  // 2. The default is the rules-of-thumb move, or the best non-gift if that move is a gift that is
  //    not allowed. The top allowed move replaces it only if it is clearly better.
  const fallback = anchor && allowed(anchor) ? anchor : bestSafe;
  let best = top;
  if (fallback && best !== fallback && !clearlyBetter(best, fallback, ANCHOR_Z)) best = fallback;

  // Report the higher-scoring move that was passed over, and why.
  let avoided = null, avoidedReason = null, edge = 0, edgeSe = 0;
  if (best !== options[0]) {
    avoided = options[0];
    avoidedReason = allowed(avoided) ? 'noise' : avoided.own ? 'own' : avoided.skip ? 'skip' : avoided.open ? 'open' : 'gift';
    const d = paired(avoided, best);
    edge = d.mean; edgeSe = d.se;
  }
  return { best, avoided, avoidedReason, edge, edgeSe };
}
