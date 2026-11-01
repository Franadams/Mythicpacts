/* Rules and AI tests for src/engine.js. Pure JavaScript, no browser needed.
   Run:  tests/run.sh   (uses macOS's built-in JavaScriptCore) */

let failures = 0;
function eq(actual, expected, what) {
  if (actual !== expected) { failures++; print(`FAIL ${what}: got ${actual}, expected ${expected}`); }
}
const line = (realm, values, pacts = 0) => {
  const a = [];
  for (let i = 0; i < pacts; i++) a.push(realm * PER_REALM + i);
  for (const v of values) a.push(numberCard(realm, v));
  return a;
};

// ---- scoring ----
eq(pileTotal(line(0, [3, 5, 8, 9], 1)), 10, 'rules example: (25 - 20) x 2');
eq(pileTotal([]), 0, 'an unstarted line scores nothing');
eq(pileTotal(line(1, [2])), -18, 'a lone 2 loses 18');
eq(pileTotal(line(1, [2], 3)), -72, 'three Pacts multiply a loss by 4');
eq(pileTotal(line(2, [2, 3, 4, 5, 6, 7, 8, 9])), 44, '8 cards: (44 - 20) + 20 crystal');
eq(pileTotal(line(2, [2, 3, 4, 5, 6, 7, 8])), 15, '7 cards: no crystal');
eq(pileTotal(line(2, [4, 5, 6, 7, 8], 3)), 60, 'crystal is added after multiplying');
eq(scorePile(line(2, [4, 5, 6, 7, 8], 3)).crystal, true, '3 Pacts + 5 numbers is 8 cards');

// ---- legality ----
eq(canPlay(line(0, [5]), 0), false, 'no Pact after a number');
eq(canPlay(line(0, [], 1), 1), true, 'Pact after Pact');
eq(canPlay(line(0, [5]), numberCard(0, 5)), false, 'equal value is not allowed');
eq(canPlay(line(0, [5]), numberCard(0, 6)), true, 'higher value is allowed');

// ---- whole games: every card accounted for, lines always ascend ----
function check(st) {
  const all = [].concat(st.hands[0], st.hands[1], st.deck, ...st.exp[0], ...st.exp[1], ...st.discard);
  if (all.length !== DECK_SIZE || new Set(all).size !== DECK_SIZE) throw new Error('cards lost or duplicated');
  for (const side of st.exp) for (const pile of side)
    for (let i = 1; i < pile.length; i++) if (!canPlay(pile.slice(0, i), pile[i])) throw new Error('line out of order');
  for (const p of [0, 1]) for (const k of st.known[p]) if (st.hands[p].indexOf(k) < 0) throw new Error('known card not in hand');
}
function playGame(policies, seed) {
  const rnd = makeRng(seed), st = newRound(seed % 2, rnd);
  for (let turns = 0; !st.over; turns++) {
    check(st);
    if (turns > 2000) return { stalled: true };
    const pol = policies[st.turn];
    if (st.phase === 'play') applyMove(st, pol.move(st, rnd));
    else applyDraw(st, pol.draw(st, rnd));
  }
  check(st);
  return { s0: playerTotal(st, 0), s1: playerTotal(st, 1) };
}
const apprentice = { move: (st, r) => heuristicMove(st, r, 0), draw: (st, r) => heuristicDraw(st, r, 0) };
const random = {
  move: (st, r) => { const m = legalMoves(st); return m[(r() * m.length) | 0]; },
  draw: (st, r) => { const d = legalDraws(st); return d[(r() * d.length) | 0]; },
};
let stalls = 0, wins = 0;
for (let i = 0; i < 200; i++) {
  const swap = i % 2, res = playGame(swap ? [random, apprentice] : [apprentice, random], 1000 + i);
  if (res.stalled) { stalls++; continue; }
  if ((swap ? res.s1 : res.s0) > (swap ? res.s0 : res.s1)) wins++;
}
eq(stalls, 0, 'no game stalls');
if (wins < 190) { failures++; print(`FAIL Apprentice should crush random play: won ${wins}/200`); }

// ---- the simulation never peeks at hidden cards ----
{
  const st = newRound(0, makeRng(42));
  const before = JSON.stringify(st.hands[1]) + JSON.stringify(st.deck);
  const g = analyze(st, 0, 20, 7); let x; while (!(x = g.next()).done);
  eq(JSON.stringify(st.hands[1]) + JSON.stringify(st.deck), before, 'analyze leaves the real game untouched');
  // Results must not depend on the opponent's actual hand: shuffle it with the deck and compare.
  const alt = cloneState(st), pool = alt.hands[1].concat(alt.deck);
  shuffle(pool, makeRng(9)); alt.hands[1] = pool.slice(0, HAND); alt.deck = pool.slice(HAND);
  const g2 = analyze(alt, 0, 20, 7); let y; while (!(y = g2.next()).done);
  eq(JSON.stringify(y.value.options.map(o => o.mean)), JSON.stringify(x.value.options.map(o => o.mean)), 'advice is identical whatever the hidden cards are');
}

print(failures ? `${failures} test(s) failed` : 'All engine tests passed');
