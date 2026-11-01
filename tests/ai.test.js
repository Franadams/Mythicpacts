/* Tests for the move advice in src/engine.js: gift classification, the decision rule,
   the shape of analyze()'s result, determinism and fairness.
   Run:  tests/run.sh   (uses macOS's built-in JavaScriptCore) */

let failures = 0;
function eq(actual, expected, what) {
  if (actual !== expected) { failures++; print(`FAIL ${what}: got ${actual}, expected ${expected}`); }
}
function ok(cond, what) { if (!cond) { failures++; print(`FAIL ${what}`); } }
function finish(gen) { let x; while (!(x = gen.next()).done); return x.value; }

const N = (realm, value) => numberCard(realm, value);
const PACT = (realm, i = 0) => realm * PER_REALM + i;

/* Build a position for player 0 to move. Lines are lists of card ids; discard piles likewise
   (top = last). The cards left over fill the opponent's hand (8 cards, those listed in
   theirHand first), then the deck (deckSize cards); any surplus is buried under the discard
   piles, where it is public and out of play. */
function position({ mine = [], myLines = {}, theirLines = {}, theirHand = [], known = [], piles = {}, deckSize = 30, phase = 'play' }) {
  const st = newRound(0, makeRng(1));
  st.exp = [[[], [], [], [], []], [[], [], [], [], []]];
  st.discard = [[], [], [], [], []];
  for (const r in myLines) st.exp[0][r] = myLines[r].slice();
  for (const r in theirLines) st.exp[1][r] = theirLines[r].slice();
  for (const r in piles) st.discard[r] = piles[r].slice();
  const used = new Set([].concat(mine, theirHand, ...Object.values(myLines), ...Object.values(theirLines), ...Object.values(piles)));
  const rest = [];
  for (let c = 0; c < DECK_SIZE; c++) if (!used.has(c)) rest.push(c);
  st.hands = [mine.slice(), theirHand.slice()];
  while (st.hands[1].length < HAND) st.hands[1].push(rest.shift());
  st.deck = rest.splice(rest.length - deckSize, deckSize);
  rest.forEach((c, i) => st.discard[i % REALMS].unshift(c));
  st.known = [[], known.slice()];
  st.turn = 0; st.phase = phase; st.lastDiscard = -1; st.over = false;
  const all = [].concat(st.hands[0], st.hands[1], st.deck, ...st.exp[0], ...st.exp[1], ...st.discard);
  if (all.length !== DECK_SIZE || new Set(all).size !== DECK_SIZE) throw new Error('bad test position');
  return st;
}

// ---- giftRisk ----
{
  const st = position({
    mine: [N(0, 7), N(0, 2), N(0, 5), PACT(0), PACT(1), N(1, 6), N(2, 5), N(2, 2)],
    theirLines: { 0: [N(0, 3)], 1: [PACT(1, 1)] },
    deckSize: 30,
  });
  const g = c => JSON.stringify(giftRisk(st, 0, c));
  eq(g(N(0, 7)), '{"kind":"feeds","realm":0}', 'a number above their top feeds their line');
  eq(g(N(0, 5)), '{"kind":"feeds","realm":0}', 'any higher number feeds, gaps or not');
  eq(g(N(0, 2)), 'null', 'a number below their top is useless to them');
  eq(g(PACT(0)), 'null', 'a Pact after their numbers is useless to them');
  eq(g(PACT(1)), '{"kind":"feeds","realm":1}', 'a Pact feeds a Pact-only line');
  eq(g(N(1, 6)), '{"kind":"feeds","realm":1}', 'a number feeds a Pact-only line');
  eq(g(N(2, 5)), '{"kind":"could-start","realm":2}', 'a 5 of an untouched realm with time left could start a line');
  eq(g(N(2, 2)), 'null', 'a 2 of an untouched realm is not flagged');
  eq(g(PACT(2)), 'null', 'a Pact of an untouched realm is not flagged');
  st.deck.length = START_GIFT_MIN_DECK - 1;   // the deck is only shortened for this check
  eq(g(N(2, 5)), 'null', 'too late in the round to start a line');
  eq(g(N(0, 7)), '{"kind":"feeds","realm":0}', 'feeding is a gift at any time');
}
{
  const st = position({ mine: [N(3, 4), N(3, 9), N(4, 8)], myLines: { 3: [N(3, 2)] }, deckSize: 30 });
  eq(giftRisk(st, 0, N(3, 9)), null, 'a realm we started ourselves is not flagged as a starter for them');
  eq(JSON.stringify(giftRisk(st, 0, N(4, 8))), '{"kind":"could-start","realm":4}', 'an 8 of an untouched realm could start a line');
  // Seen from the other side, the same rule applies to player 1.
  eq(JSON.stringify(giftRisk(st, 1, N(3, 9))), '{"kind":"feeds","realm":3}', 'giftRisk works for either player');
}
// Property over real games: 'feeds' exactly when the opponent's started line accepts the card.
{
  const rnd = makeRng(5);
  let checked = 0;
  for (let gameNo = 0; gameNo < 30; gameNo++) {
    const st = newRound(gameNo % 2, rnd);
    while (!st.over) {
      if (st.phase === 'play') {
        const p = st.turn, o = p ^ 1;
        for (const c of st.hands[p]) {
          const theirs = st.exp[o][realmOf(c)], g = giftRisk(st, p, c);
          const feeds = theirs.length > 0 && canPlay(theirs, c);
          if (feeds !== (g !== null && g.kind === 'feeds')) { failures++; print(`FAIL feeds classification for card ${c}`); }
          if (g && g.kind === 'could-start' && theirs.length) { failures++; print('FAIL could-start on a started realm'); }
          if (g && g.realm !== realmOf(c)) { failures++; print('FAIL gift realm'); }
          checked++;
        }
        applyMove(st, heuristicMove(st, rnd, 1));
      } else applyDraw(st, heuristicDraw(st, rnd, 1));
    }
  }
  ok(checked > 1000, `gift property checked on ${checked} cards`);
}

// ---- the rules of thumb avoid feeding the opponent when a harmless discard exists ----
{
  // From a self-play game: the opponent's Nymphs line is Pact, 3, 4 and nothing is worth playing.
  // The previous version discarded the Nymphs 9 (card 58), which fits that line; a Pact of an
  // untouched realm is a harmless alternative.
  const st = {
    hands: [[36, 35, 47, 58, 33, 44, 19, 23], [57, 22, 56, 30, 11, 54, 10, 34]],
    exp: [[[], [], [28, 29], [], []], [[], [15], [], [], [50, 52, 53]]],
    discard: [[2, 0, 5], [13], [27, 26], [43], []],
    deck: [45, 55, 59, 7, 37, 42, 38, 1, 24, 14, 16, 6, 17, 46, 18, 39, 9, 49, 31, 25, 3, 20, 48, 51, 12, 4, 40, 21, 32, 41, 8],
    turn: 0, phase: 'play', lastDiscard: -1, known: [[], []], over: false,
  };
  eq(JSON.stringify(giftRisk(st, 0, 58)), '{"kind":"feeds","realm":4}', 'setup: the 9 feeds their line');
  const m = heuristicMove(st, null, 0);
  ok(!(m.type === 'discard' && giftRisk(st, 0, m.card)), `rules of thumb avoid the gift: ${JSON.stringify(m)}`);
}

// ---- the decision rule on synthetic simulation results ----
{
  // Three options simulated on the same 100 worlds: a gift discard, a safe play and a safe discard.
  // The gift's lead over the safe play is `edge` on average, swinging by +-15 from world to world,
  // so the paired standard error is 1.5 points.
  const n = 100, rnd = makeRng(3), base = Array.from({ length: n }, () => (rnd() - 0.5) * 40);
  const SE = 15 / Math.sqrt(n - 1);
  const make = (edge, anchorJ) => {
    const margins = [base.map((x, i) => x + edge + (i % 2 ? 15 : -15)), base.slice(), base.map(x => x - 5)];
    const opts = [
      { type: 'discard', card: N(0, 9), gift: { kind: 'feeds', realm: 0 } },
      { type: 'play', card: N(1, 5), gift: null },
      { type: 'discard', card: N(2, 2), gift: null },
    ].map((o, j) => Object.assign(o, meanSe(margins[j]), { j })).sort((x, y) => y.mean - x.mean);
    return { opts, margins, r: pickAdvice(opts, margins, opts.find(o => o.j === anchorJ)) };
  };
  const FZ = GIFT_RULES.feeds.z;
  // Gift ahead, but by less than its required number of standard errors: not recommended.
  let { opts, r } = make(0.5 * FZ * SE, 1);
  eq(opts[0].j, 0, 'setup: the gift has the highest average');
  eq(r.best.j, 1, 'a feeds discard within the margin is not recommended');
  eq(r.avoidedReason, 'gift', 'and the reason given is the gift');
  eq(r.avoided && r.avoided.j, 0, 'the gift is reported as avoided');
  ok(Math.abs(r.edge - 0.5 * FZ * SE) < 1e-9 && Math.abs(r.edgeSe - SE) < 1e-9, 'edge and edgeSe describe avoided vs best');
  // The same when the rules of thumb themselves picked the gift.
  ({ r } = make(0.5 * FZ * SE, 0));
  eq(r.best.j, 1, 'a gift anchor within the margin falls back to the best non-gift');
  // Gift ahead by well over the margin: allowed, and clearly better than the anchor.
  ({ r } = make((Math.max(FZ, ANCHOR_Z) + 2) * SE, 1));
  eq(r.best.j, 0, 'a gift that clearly beats every alternative is recommended');
  eq(r.avoided, null, 'nothing avoided');
  // Gift clearly better than the safe play, which is the rules-of-thumb move, but the safe discard is the
  // anchor: the gift still has to beat the anchor clearly too, which it does by a wide margin.
  ({ r } = make((FZ + 2) * SE, 2));
  eq(r.best.j, 0, 'an allowed gift beats a weak anchor');
  // A gift that is reliably ahead but only by a sliver is still not worth handing over: with a tiny
  // standard error (0.2 points) it must also win by GIFT_RULES.feeds.minEdge points.
  {
    const tight = edge => {
      const margins = [base.map((x, i) => x + edge + (i % 2 ? 2 : -2)), base.slice(), base.map(x => x - 5)];
      const o = [
        { type: 'discard', card: N(0, 9), gift: { kind: 'feeds', realm: 0 } },
        { type: 'play', card: N(1, 5), gift: null },
        { type: 'discard', card: N(2, 2), gift: null },
      ].map((x, j) => Object.assign(x, meanSe(margins[j]), { j })).sort((x, y) => y.mean - x.mean);
      return pickAdvice(o, margins, o.find(x => x.j === 1));
    };
    const small = GIFT_RULES.feeds.minEdge - 1, big = GIFT_RULES.feeds.minEdge + 1;
    eq(tight(small).best.j, 1, `a feeds discard ${small} points ahead (far beyond its standard error) is not recommended`);
    eq(tight(small).avoidedReason, 'gift', 'and the gift is named as the reason');
    eq(tight(big).best.j, 0, `a feeds discard ${big} points ahead is recommended`);
  }
  // Throwing away a card our own line could use (here a 10 worth 10 points) must win by half its worth.
  if (typeof OWN_SHARE !== 'undefined') {
    const own = edge => {
      const margins = [base.map((x, i) => x + edge + (i % 2 ? 2 : -2)), base.slice(), base.map(x => x - 5)];
      const o = [
        { type: 'discard', card: N(0, 10), gift: null, own: { realm: 0, worth: 10 } },
        { type: 'play', card: N(1, 5), gift: null, own: null },
        { type: 'discard', card: N(2, 2), gift: null, own: null },
      ].map((x, j) => Object.assign(x, meanSe(margins[j]), { j })).sort((x, y) => y.mean - x.mean);
      return pickAdvice(o, margins, o.find(x => x.j === 1));
    };
    eq(own(4).best.j, 1, 'throwing away our own 10 for a 4-point edge is not recommended');
    eq(own(4).avoidedReason, 'own', 'and the reason is that our own line could use it');
    eq(own(6).best.j, 0, 'a 6-point edge (more than half of 10) is allowed');
  }
  // No gift ahead; the safe play beats the anchor (safe discard) by 5 with no noise: clearly better.
  ({ r } = make(-30, 2));
  eq(r.best.j, 1, 'a clear improvement replaces the rules-of-thumb move');
  // A close call between two safe options keeps the anchor and reports noise.
  {
    const margins = [base.map((x, i) => x + 0.5 + (i % 2 ? 10 : -10)), base.slice()];
    const o2 = [{ type: 'play', card: N(1, 5), gift: null }, { type: 'discard', card: N(2, 2), gift: null }]
      .map((o, j) => Object.assign(o, meanSe(margins[j]), { j })).sort((x, y) => y.mean - x.mean);
    const r2 = pickAdvice(o2, margins, o2.find(o => o.j === 1));
    eq(r2.best.j, 1, 'a close call keeps the rules-of-thumb move');
    eq(r2.avoidedReason, 'noise', 'and the reason given is noise');
  }
}

// ---- analyze(): result contract, gift rule on real positions, determinism ----
const feedsPositions = [
  // Their Sirens line is 2-3; we hold the 9 and the 10 of Sirens and little else of use.
  { mine: [N(0, 9), N(0, 10), N(1, 2), N(2, 4), N(3, 3), N(4, 2), PACT(4), N(2, 6)], theirLines: { 0: [N(0, 2), N(0, 3)] }, deckSize: 24 },
  // Their Fairies line holds only a Pact; we hold Fairies cards and a dead card.
  { mine: [PACT(1, 1), N(1, 5), N(1, 8), N(2, 2), N(3, 9), N(4, 4), N(4, 7), N(0, 6)], theirLines: { 1: [PACT(1)], 0: [N(0, 7)] }, myLines: { 4: [N(4, 3)] }, deckSize: 18 },
  // Late in the round with several lines on both sides.
  { mine: [N(0, 8), N(1, 9), N(2, 10), N(3, 4), N(4, 6), N(1, 3), N(2, 5), N(3, 6)], theirLines: { 0: [N(0, 4)], 1: [N(1, 5)], 2: [N(2, 6)] }, myLines: { 3: [N(3, 2), N(3, 3)], 4: [N(4, 2)] }, deckSize: 8 },
];
let feedsSeen = 0;
feedsPositions.forEach((spec, idx) => {
  const st = position(spec);
  for (const seed of [1, 2, 3]) {
    const res = finish(analyze(st, 0, 60, seed));
    // shape
    const keys = Object.keys(res).sort().join();
    eq(keys, 'anchored,avoided,avoidedReason,best,edge,edgeSe,options,rollouts,samples', `result keys (position ${idx})`);
    eq(res.samples, 60, 'samples');
    eq(res.rollouts, 60 * res.options.length, 'rollouts');
    eq(res.options.filter(o => o.recommended).length, 1, 'exactly one recommended option');
    ok(res.best.recommended && res.options.indexOf(res.best) >= 0, 'best is the recommended option object');
    for (let i = 1; i < res.options.length; i++) ok(res.options[i - 1].mean >= res.options[i].mean, 'options sorted by mean');
    for (const o of res.options) {
      ok(o.type === 'play' || o.type === 'discard', 'play-phase options are plays or discards');
      ok(typeof o.card === 'number' && typeof o.mean === 'number' && typeof o.se === 'number' && typeof o.j === 'number', 'option fields');
      ok(!('realms' in o), 'no per-realm forecast');
      const want = o.type === 'discard' ? JSON.stringify(giftRisk(st, 0, o.card)) : 'null';
      eq(JSON.stringify(o.gift), want, 'option gift matches giftRisk');
      if (o.gift && o.gift.kind === 'feeds') feedsSeen++;
    }
    ok((res.avoided === null) === (res.avoidedReason === null), 'avoided and avoidedReason go together');
    eq(res.anchored, res.avoidedReason === 'noise', 'anchored means avoided for noise');
    if (res.avoided) {
      eq(res.avoided, res.options[0], 'avoided is the top-scoring option');
      ok(res.avoided !== res.best, 'avoided is not the advice');
      if (res.avoidedReason === 'gift') ok(res.avoided.gift !== null, 'a gift-avoided option is a gift');
    } else eq(res.best, res.options[0], 'with nothing avoided the advice is the top option');
    // The gift rule: a 'feeds' recommendation must clearly beat the best non-gift option.
    if (res.best.gift && res.best.gift.kind === 'feeds') {
      const safe = res.options.find(o => !o.gift);
      ok(!safe || res.best.mean - safe.mean > 0, 'a recommended feeds discard has a higher mean than every non-gift option');
    }
    // determinism
    const again = finish(analyze(st, 0, 60, seed));
    eq(JSON.stringify(again), JSON.stringify(res), `same seed gives the same result (position ${idx}, seed ${seed})`);
  }
});
ok(feedsSeen > 0, 'the positions include feeds discards');
{
  // Draw-phase contract.
  const st = position({ mine: [N(0, 5), N(1, 6), N(2, 7), N(3, 8), N(4, 9), N(0, 6), N(1, 7)], piles: { 2: [N(2, 9)], 3: [N(3, 4)] }, deckSize: 20, phase: 'draw' });
  const res = finish(analyze(st, 0, 40, 9));
  ok(res.options.every(o => o.type === 'draw' && typeof o.src === 'number' && o.gift === null), 'draw options carry src and no gift');
  ok(res.options.some(o => o.src === -1), 'the deck is a draw option');
  eq(res.options.filter(o => o.recommended).length, 1, 'one recommended draw');
}

// ---- fairness: nothing hidden influences the advice ----
{
  const rnd = makeRng(77);
  const st = newRound(0, rnd);
  while (st.deck.length > 26 || st.phase !== 'play' || st.turn !== 0 || !st.known[1].length) {
    if (st.over) throw new Error('fairness setup ran out of cards');
    if (st.phase === 'play') applyMove(st, heuristicMove(st, rnd, 2));
    else applyDraw(st, st.turn === 1 && legalDraws(st).length > 1 ? legalDraws(st)[1] : heuristicDraw(st, rnd, 0));
  }
  const a = finish(analyze(st, 0, 40, 5));
  // Rearrange the opponent's unknown cards and the deck (the known cards stay in their hand).
  const alt = cloneState(st), known = alt.known[1];
  const pool = alt.hands[1].filter(c => known.indexOf(c) < 0).concat(alt.deck);
  shuffle(pool, makeRng(123));
  const u = alt.hands[1].length - known.length;
  alt.hands[1] = known.concat(pool.slice(0, u));
  alt.deck = pool.slice(u);
  ok(JSON.stringify(alt.hands[1]) !== JSON.stringify(st.hands[1]), 'fairness setup changed the hidden hand');
  const b = finish(analyze(alt, 0, 40, 5));
  eq(JSON.stringify(b), JSON.stringify(a), 'mid-round advice is identical however the hidden cards lie');
  eq(JSON.stringify(Array.from(opponentWeights(alt, 0))), JSON.stringify(Array.from(opponentWeights(st, 0))), 'opponent weights use public information only');
}

// ---- the opponent model ----
{
  const st = position({ mine: [N(1, 2), N(1, 3), N(2, 2), N(2, 3), N(3, 2), N(3, 3), N(4, 2), N(4, 3)], theirLines: { 0: [N(0, 3)] }, deckSize: 43 });
  const w = opponentWeights(st, 0);
  for (const c of st.hands[0]) eq(w[c], 0, 'our own cards are never dealt to the opponent');
  ok(w[N(0, 2)] < w[N(0, 10)], 'a card below their line is less likely in their hand than a high card above it');
  const pool = [];
  for (let c = 0; c < DECK_SIZE; c++) if (w[c] > 0) pool.push(c);
  eq(pool.length, st.hands[1].length + st.deck.length, 'every unseen card has a weight');
  // Weighted dealing: the 10 above their line turns up in their hand more often than the dead 2.
  const rnd = makeRng(4);
  let ten = 0, two = 0;
  for (let i = 0; i < 2000; i++) {
    const s = determinize(st, 0, rnd, w);
    if (s.hands[1].indexOf(N(0, 10)) >= 0) ten++;
    if (s.hands[1].indexOf(N(0, 2)) >= 0) two++;
    if (i === 0) eq(s.hands[1].length, HAND, 'the opponent is dealt a full hand');
  }
  ok(ten > 2 * two, `weighted dealing favours the 10 (${ten}) over the dead 2 (${two})`);
}

// ---- jumping over lower cards ----
{
  // Early in a round, opening Fairies with a 7 jumps 2-6: a held 3 is lost for sure, unseen ones may arrive.
  const st = position({ mine: [N(0, 7), N(0, 3), N(1, 9), N(2, 9), N(3, 9), N(4, 9), N(1, 10), N(2, 10)], deckSize: 30 });
  const s = skipLoss(st, 0, N(0, 7));
  ok(s && s.skipped.indexOf(3) >= 0 && s.loss >= 3, `opening with a 7 early gives up the held 3 and more: ${JSON.stringify(s)}`);
  eq(skipLoss(st, 0, N(0, 3)), null, 'opening with the 3 jumps nothing worth counting');
  // Late in the round the unseen lower cards are unlikely to arrive, so the expected loss shrinks.
  const late = position({ mine: [N(0, 7), N(1, 9), N(2, 9), N(3, 9), N(4, 9), N(1, 10), N(2, 10), N(3, 10)], deckSize: 4 });
  const early = position({ mine: [N(0, 7), N(1, 9), N(2, 9), N(3, 9), N(4, 9), N(1, 10), N(2, 10), N(3, 10)], deckSize: 30 });
  const lateLoss = (skipLoss(late, 0, N(0, 7)) || { loss: 0 }).loss, earlyLoss = (skipLoss(early, 0, N(0, 7)) || { loss: 0 }).loss;
  ok(lateLoss < earlyLoss, `the expected loss is smaller late (${lateLoss.toFixed(1)}) than early (${earlyLoss.toFixed(1)})`);
}

// ---- the next card for our own line is never thrown away ----
{
  // A Fairy line with just a Pact, the other two Pacts on the opponent's line: the 2 goes straight on it.
  // A Siren line 3-4 with the 5 on the opponent's line: our 6 is next. A Dryad line at 3 with the 4
  // still unseen: the 5 is not next.
  const st = position({ mine: [N(0, 2), N(1, 6), N(2, 5), N(3, 9)], myLines: { 0: [PACT(0)], 1: [N(1, 3), N(1, 4)], 2: [N(2, 3)] }, theirLines: { 0: [PACT(0, 1), PACT(0, 2)], 1: [N(1, 5)] } });
  eq(ownLoss(st, 0, N(0, 2)).next, true, 'a 2 on a Pact-only line is the next card once no Pact can come');
  const waiting = position({ mine: [N(0, 2), PACT(0, 1)], myLines: { 0: [PACT(0)] } });
  eq(ownLoss(waiting, 0, N(0, 2)).next, false, 'while a Pact of that realm can still come, the 2 is not next (it would end the Pacts)');
  const unseen = position({ mine: [N(0, 2)], myLines: { 0: [PACT(0)] }, piles: { 0: [PACT(0, 1), N(4, 9)] } });
  eq(ownLoss(unseen, 0, N(0, 2)).next, false, 'one Pact buried in a discard pile, one unseen: still not next');
  eq(ownLoss(st, 0, N(1, 6)).next, true, 'a 6 is next when the 5 is on the opponent\'s line');
  eq(ownLoss(st, 0, N(2, 5)).next, false, 'a 5 is not next while the 4 could still come');
  eq(ownLoss(st, 0, N(3, 9)), null, 'a card for a line not started costs our lines nothing');
  // Even a large, sure edge does not make throwing away the next card the advice.
  const n = 100, rnd = makeRng(9), base = Array.from({ length: n }, () => (rnd() - 0.5) * 30);
  const margins = [base.map(x => x + 12), base.slice(), base.map(x => x - 1)];
  const o = [
    { type: 'discard', card: N(0, 2), gift: null, own: { realm: 0, worth: 4, next: true }, skip: null, open: null },
    { type: 'play', card: N(0, 2), gift: null, own: null, skip: null, open: null },
    { type: 'discard', card: N(3, 9), gift: null, own: null, skip: null, open: null },
  ].map((x, j) => Object.assign(x, meanSe(margins[j]), { j })).sort((x, y) => y.mean - x.mean);
  const r = pickAdvice(o, margins, o.find(x => x.j === 0));
  eq(r.best.j, 1, 'a 12-point edge does not make throwing away the next card the advice, even as the rules-of-thumb move');
  eq(r.avoidedReason, 'own', 'and the reason given is our own line');
}

// ---- opening a new line ----
{
  const st = position({ mine: [N(0, 4), N(1, 9), N(2, 9), N(3, 9), N(4, 9), N(1, 10), N(2, 10), N(3, 10)], theirLines: { 0: [PACT(0), N(0, 2)] }, deckSize: 30 });
  const r = openRisk(st, 0, N(0, 4));
  eq(r && r.contested, 3, 'opening Fairies after the opponent played a Pact and a 2: contested 3 (Pacts count twice)');
  eq(openRisk(st, 0, N(1, 9)) && openRisk(st, 0, N(1, 9)).contested, 0, 'an uncontested realm');
  const st2 = position({ mine: [N(0, 4), N(0, 5)], myLines: { 0: [N(0, 3)] } });
  eq(openRisk(st2, 0, N(0, 4)), null, 'adding to a line already started is not an opening');
}

// ---- the line budget ----
if (typeof OPEN_PER_LINE !== 'undefined') {
  const three = position({ mine: [N(0, 4), N(4, 9)], myLines: { 1: [N(1, 2)], 2: [N(2, 3)], 3: [PACT(3)] } });
  eq(openRisk(three, 0, N(0, 4)).linesOpen, 3, 'three lines already open (a Pact-only line counts)');
  eq(openRisk(position({ mine: [N(0, 4)] }), 0, N(0, 4)).linesOpen, 0, 'no lines open');
  // An opening about 5 points ahead of a safe move (small standard error) is fine as a second line,
  // but not as a fourth: the margin grows to OPEN_MIN + 2 * OPEN_PER_LINE.
  const n = 100, rnd = makeRng(8), base = Array.from({ length: n }, () => (rnd() - 0.5) * 40);
  const pick = linesOpen => {
    const margins = [base.map((x, i) => x + 5 + (i % 2 ? 1 : -1)), base.slice()];
    const o = [
      { type: 'play', card: N(0, 4), gift: null, own: null, skip: null, open: { realm: 0, contested: 0, linesOpen } },
      { type: 'discard', card: N(2, 2), gift: null, own: null, skip: null, open: null },
    ].map((x, j) => Object.assign(x, meanSe(margins[j]), { j })).sort((x, y) => y.mean - x.mean);
    return pickAdvice(o, margins, o.find(x => x.j === 1));
  };
  eq(pick(1).best.j, 0, 'a clearly better second line is opened');
  eq(pick(3).best.j, 1, 'the same edge is not enough for a fourth line');
  eq(pick(3).avoidedReason, 'open', 'and the reason given is the opening');
}

// ---- learning one player's habits ----
{
  const study = emptyStudy();
  eq(JSON.stringify(personalWeights(study)), JSON.stringify(HAND_WEIGHTS), 'with nothing learned, the weights are the population ones');
  // Pretend a player held far more 'gap 4+' cards than the model predicted: their weight must rise.
  study.held[6][0] = 300; study.predicted[6][0] = 100;
  ok(personalWeights(study)[6][0] > HAND_WEIGHTS[6][0], 'holding a kind of card more often than predicted raises its weight');
  ok(personalWeights(study)[6][0] <= 3 * HAND_WEIGHTS[6][0], 'and the change is capped');
  // Studying a real decision counts cards the observer could not see, and only those.
  const st = newRound(0, makeRng(4)), s2 = studyDecision(emptyStudy(), st, 0);
  const held = s2.held.flat().reduce((a, b) => a + b, 0), predicted = s2.predicted.flat().reduce((a, b) => a + b, 0);
  eq(held, HAND, 'every card in the opponent hand is counted once');
  ok(Math.abs(predicted - HAND) < 0.5, `the model predicts about ${HAND} cards in their hand (${predicted.toFixed(2)})`);
}

print(failures ? `${failures} test(s) failed` : 'All AI tests passed');
