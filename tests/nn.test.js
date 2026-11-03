/* Tests for the neural-network player in nn/net.js: stored positions, features (and that they never show
   the opponent's hidden cards), the gradients training relies on, and that the player's moves are legal.
   Run:  tests/run.sh */

let failures = 0;
function eq(actual, expected, what) { if (actual !== expected) { failures++; print(`FAIL ${what}: got ${actual}, expected ${expected}`); } }
function ok(cond, what) { if (!cond) { failures++; print(`FAIL ${what}`); } }

// A position some way into a round, played by the rules of thumb.
function midGame(seed, turns) {
  const rnd = makeRng(seed), st = newRound(seed % 2, rnd);
  for (let t = 0; t < turns && !st.over; t++) {
    applyMove(st, heuristicMove(st, rnd, 1));
    if (!st.over) applyDraw(st, heuristicDraw(st, rnd, 1));
  }
  return st;
}

// ---- stored positions and features ----
{
  const buf = new Uint8Array(NET.RECORD);
  setRecordLead(buf, 0, -73); eq(recordLead(buf, 0), -73, 'a negative lead survives storage');
  setRecordLead(buf, 0, 158); eq(recordLead(buf, 0), 158, 'a positive lead survives storage');

  const st = midGame(11, 14), f = newFeatures();
  encodeState(st, buf, 0);
  for (const p of [0, 1]) {
    featurize(buf, 0, p, f);
    let mine = 0, mineKnown = 0;
    for (let i = 0; i < 60; i++) { const place = f.idx[i] % NET.CATS; if (place === 1 || place === 8) mine++; if (place === 8) mineKnown++; }
    eq(mine, st.hands[p].length, `player ${p} sees its own ${st.hands[p].length} cards in hand`);
    eq(mineKnown, st.known[p].length, `player ${p} sees which of its cards the opponent knows about`);
    for (let r = 0; r < 5; r++) eq(f.dense[r * NET.DENSE + 21], Math.fround(st.deck.length / 44), `player ${p}, realm ${r}: cards left`);
    for (let r = 0; r < 5; r++) {
      const want = scorePile(st.exp[p][r]).total, got = Math.round(f.dense[r * NET.DENSE + 5] * 60);
      eq(got, want, `player ${p}, realm ${r}: line score feature`);
      eq(Math.round(f.dense[r * NET.DENSE + 12] * 60), scorePile(st.exp[p ^ 1][r]).total, `player ${p}, realm ${r}: opponent's line score feature`);
    }
    eq(f.glob[1], st.turn === p ? 1 : 0, `player ${p}: whose turn`);
  }

  // Swapping the opponent's hidden cards with cards in the deck changes nothing player 0 can see.
  const a = cloneState(st), b = cloneState(st);
  const hidden = b.hands[1].filter(c => b.known[1].indexOf(c) < 0);
  for (let k = 0; k < Math.min(3, hidden.length, b.deck.length); k++) {
    const c = hidden[k], i = b.hands[1].indexOf(c), d = b.deck[k];
    b.hands[1][i] = d; b.deck[k] = c;
  }
  const fa = newFeatures(), fb = newFeatures(), ba = encodeState(a), bb = encodeState(b);
  featurize(ba, 0, 0, fa); featurize(bb, 0, 0, fb);
  ok(fa.idx.every((x, i) => x === fb.idx[i]) && fa.dense.every((x, i) => x === fb.dense[i]), "the opponent's hidden cards are invisible to the features");
  featurize(ba, 0, 1, fa); featurize(bb, 0, 1, fb);
  ok(!fa.idx.every((x, i) => x === fb.idx[i]), 'but the opponent sees its own hand change');
}

// ---- the position after a move, worked out on the stored bytes, matches the real thing ----
{
  let checked = 0, bad = 0;
  for (const seed of [31, 32, 33, 34]) {
    const st = midGame(seed, 9);
    if (st.over) continue;
    const before = encodeState(st), dst = new Uint8Array(NET.RECORD);
    for (const m of legalMoves(st)) {
      const s = cloneState(st);
      applyMove(s, m);
      const want = encodeState(s), got = recordAfterMove(before, 0, m.type === 'play' ? m.card : 60 + m.card, dst);
      checked++;
      for (let i = 0; i < 62; i++) if (want[i] !== got[i]) { bad++; break; }
    }
  }
  ok(checked > 40 && bad === 0, `the stored position after a move matches the game's (${checked - bad}/${checked})`);
}

// ---- gradients: the backward pass matches finite differences ----
{
  const net = newNet(3, 16, 8, 16), st = midGame(5, 10), buf = encodeState(st), f = newFeatures(), a = newActs(net);
  featurize(buf, 0, 0, f);
  const target = 0.7;
  const loss = () => { const y = netForward(net, f, a) - target; return 0.5 * y * y; };
  const grad = {};
  for (const k of NET_PARAMS) grad[k] = new Float32Array(net[k].length);
  netBackward(net, f, a, netForward(net, f, a) - target, grad, newBackScratch(net));
  const rnd = makeRng(9);
  let checked = 0, bad = 0;
  for (const k of NET_PARAMS) {
    for (let t = 0; t < 12; t++) {
      const i = Math.floor(rnd() * net[k].length), w0 = net[k][i], h = 1e-3;
      net[k][i] = w0 + h; const up = loss();
      net[k][i] = w0 - h; const down = loss();
      net[k][i] = w0;
      const numeric = (up - down) / (2 * h), analytic = grad[k][i];
      checked++;
      if (Math.abs(numeric - analytic) > 1e-3 + 0.03 * Math.max(Math.abs(numeric), Math.abs(analytic))) {
        bad++;
        if (bad <= 3) print(`  ${k}[${i}]: analytic ${analytic.toFixed(5)}, numeric ${numeric.toFixed(5)}`);
      }
    }
  }
  ok(bad <= 2, `gradients match finite differences (${checked - bad}/${checked}; a ReLU kink can spoil one or two)`);
}

// ---- the player ----
{
  const net = newNet(4);
  for (const seed of [21, 22, 23]) {
    const st = midGame(seed, 8);
    if (st.over) continue;
    const m = netMove(net, st);
    ok(legalMoves(st).some(x => x.type === m.type && x.card === m.card), 'the network plays a legal move');
    applyMove(st, m);
    const src = netDraw(net, st);
    ok(legalDraws(st).indexOf(src) >= 0, 'and draws from a legal place');
  }
}

// ---- the last card ----
{
  // Play on until one card is left, then check the player's moves are scored exactly.
  const net = newNet(6);
  let tested = 0;
  for (const seed of [41, 42, 43, 44, 45]) {
    const rnd = makeRng(seed), st = newRound(seed % 2, rnd);
    while (!st.over && !(st.deck.length === 1 && st.phase === 'play')) {
      if (st.phase === 'play') applyMove(st, heuristicMove(st, rnd, 1)); else applyDraw(st, heuristicDraw(st, rnd, 1));
    }
    if (st.over) continue;
    tested++;
    const p = st.turn, m = netMove(net, st);
    let bestExact = -Infinity;
    for (const x of legalMoves(st)) { const s = cloneState(st); applyMove(s, x); bestExact = Math.max(bestExact, playerTotal(s, p) - playerTotal(s, p ^ 1)); }
    const s = cloneState(st);
    applyMove(s, m);
    eq(playerTotal(s, p) - playerTotal(s, p ^ 1), bestExact, 'with one card left the network makes the move with the best final lead');
    applyMove(st, m);
    eq(netDraw(net, st), -1, 'and then takes the last card');
  }
  ok(tested >= 3, `the last-card checks ran (${tested} games)`);
}

// ---- the Seer: the Oracle's search with the network judging each future ----
{
  const net = newNet(7);
  for (const seed of [51, 52]) {
    const st = midGame(seed, 7);
    if (st.over) continue;
    const before = JSON.stringify(st);
    const m = netSearch(net, st, 8, 99, 4);
    ok(legalMoves(st).some(x => x.type === m.type && x.card === m.card), 'the Seer plays a legal move');
    eq(JSON.stringify(st), before, 'and leaves the real game untouched');
    applyMove(st, m);
    ok(legalDraws(st).indexOf(netSearch(net, st, 8, 99, 4).src) >= 0, 'and draws from a legal place');
    const g = netAnalyze(net, st, st.turn, 8, 99, 4);
    let x;
    while (!(x = g.next()).done);
    ok(x.value.options.every((o, i, a) => i === 0 || a[i - 1].mean >= o.mean), 'its options come best first');
  }
}

// ---- the odd-or-even input, and weights from before it ----
{
  const st = midGame(61, 9), f = newFeatures();
  featurize(encodeState(st), 0, st.turn, f);
  eq(f.glob[3], st.deck.length % 2, 'the last overall input says whether an odd number of cards is left');
  // Old weights had no row for it: they load with a zero row, so flipping it changes nothing.
  const o = netToJSON(newNet(9, 8, 4, 8));
  o.W3 = o.W3.slice(0, o.W3.length - o.H3);
  const old = netFromJSON(o), a = newActs(old);
  const y0 = netForward(old, f, a);
  f.glob[3] = 1 - f.glob[3];
  eq(netForward(old, f, a), y0, 'weights from before the odd-or-even input work as they did');
}

// ---- the Seer plays the last turn exactly ----
{
  const net = newNet(10);
  let tested = 0;
  for (const seed of [71, 72, 73, 74, 75]) {
    const rnd = makeRng(seed), st = newRound(seed % 2, rnd);
    while (!st.over && !(st.deck.length === 1 && st.phase === 'play')) {
      if (st.phase === 'play') applyMove(st, heuristicMove(st, rnd, 1)); else applyDraw(st, heuristicDraw(st, rnd, 1));
    }
    if (st.over) continue;
    tested++;
    const p = st.turn, lead = m => { const s = cloneState(st); applyMove(s, m); return playerTotal(s, p) - playerTotal(s, p ^ 1); };
    const m = netSearch(net, st, 6, 5, 2);
    eq(lead(m), lead(bestLastMove(st)), 'with one card left the Seer makes the move with the best final lead');
    applyMove(st, m);
    eq(netSearch(net, st, 6, 5, 2).src, -1, 'and takes the last card');
  }
  ok(tested >= 3, `the Seer's last-turn checks ran (${tested} games)`);
}

// ---- weights for a different set of features are refused, not misread ----
{
  const o = netToJSON(newNet(8, 8, 4, 8));
  o.W1 = o.W1.slice(0, o.W1.length - 8);
  let threw = false;
  try { netFromJSON(o); } catch (e) { threw = true; }
  ok(threw, 'weights trained on other features are refused');
}

print(failures ? `${failures} test(s) failed` : 'All neural-network tests passed');
if (failures) throw new Error('tests failed');   // non-zero exit for run.sh
