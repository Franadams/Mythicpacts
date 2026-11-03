/* A neural-network player for Mythic Pacts.

   The network is a value function: from one player's side of the table (only what that player can see)
   it predicts how far ahead that player will finish the round, in points. The player picks the move whose
   resulting position the network likes best: after a play or discard, the position it will draw from; after
   a draw, the position the opponent faces (for a card from the deck, the average over the cards it could be).

   Its shape follows the game: the five realms are scored separately and are interchangeable, so one small
   network reads each realm (the same weights for all five), the five readings are added up, and a second
   small network turns that sum, plus how many cards are left and whose turn it is, into the prediction.
   That makes a pattern learned in one realm apply in all of them.

   Positions are stored compactly (encodeState: one byte per card, from nobody's side) so training data can
   be read from either player's side later, and the game, training and the published page all use these same
   functions, so the network plays exactly as it was trained.

   The network can also sit inside the Oracle's search (netAnalyze, "the Seer", at the end of this file):
   the Oracle's simulated futures are cut short after a few decisions and the network judges where they got
   to, instead of the rules of thumb playing them to the end. Needs src/engine.js loaded first. */

const NET = {
  CATS: 9,                  // where a card is, from one player's side: see featurize()
  ONEHOT: 12 * 9,           // the 12 cards of a realm x 9 places
  DENSE: 22,                // per-realm summary numbers
  GLOBAL: 4,                // cards left, whose turn, which half of the turn, odd or even cards left
  SCALE: 50,                // the network predicts the final lead divided by this
  RECORD: 64,               // bytes per stored position
};
NET.F = NET.ONEHOT + NET.DENSE;

/* ---- stored positions ----
   One byte per card: low 3 bits where it is (0 deck, 1 hand of player 0, 2 hand of player 1, 3 line of
   player 0, 4 line of player 1, 5 top of its discard pile, 6 second from the top, 7 deeper), plus 8 when it
   sits in a hand and the other player knows it (it was taken from a discard pile). Then the deck size, a byte
   of flags (bit 0: player 1 to move; bit 1: drawing; bits 2-4: the pile just discarded on, plus 1; bit 5: the
   first position of a game), and two bytes for player 0's final lead (filled in when the round ends). */
function encodeState(st, out = new Uint8Array(NET.RECORD), at = 0) {
  for (let c = 0; c < DECK_SIZE; c++) out[at + c] = 0;
  for (let p = 0; p < 2; p++) {
    for (const c of st.hands[p]) out[at + c] = 1 + p;
    for (const c of st.known[p]) out[at + c] |= 8;
    for (const pile of st.exp[p]) for (const c of pile) out[at + c] = 3 + p;
  }
  for (const pile of st.discard) {
    for (let i = 0; i < pile.length; i++) {
      const depth = pile.length - 1 - i;
      out[at + pile[i]] = depth === 0 ? 5 : depth === 1 ? 6 : 7;
    }
  }
  out[at + 60] = st.deck.length;
  out[at + 61] = (st.turn & 1) | (st.phase === 'draw' ? 2 : 0) | ((st.lastDiscard + 1) << 2);
  out[at + 62] = 0; out[at + 63] = 0;
  return out;
}
function setRecordLead(buf, at, lead0) {
  const v = Math.max(-32768, Math.min(32767, Math.round(lead0))) & 0xffff;
  buf[at + 62] = v & 0xff; buf[at + 63] = v >> 8;
}
function recordLead(buf, at) {
  const v = buf[at + 62] | (buf[at + 63] << 8);
  return v >= 32768 ? v - 65536 : v;
}

// The stored position after the player to move plays (code 0-59) or discards (60-119) a card, when that
// player is drawing next. It works on the stored bytes, so training can score the Oracle's estimate for
// each move it considered without rebuilding the game. Writes the result into dst at 0.
function recordAfterMove(src, at, code, dst) {
  for (let i = 0; i < NET.RECORD; i++) dst[i] = src[at + i];
  const mover = dst[61] & 1, discard = code >= 60, c = discard ? code - 60 : code, r = Math.floor(c / 12);
  if (discard) {
    for (let k = 0; k < 12; k++) { const x = r * 12 + k, loc = dst[x] & 7; if (loc === 5) dst[x] = 6; else if (loc === 6) dst[x] = 7; }
    dst[c] = 5;
  } else dst[c] = 3 + mover;
  dst[61] = mover | 2 | ((discard ? r + 1 : 0) << 2);
  return dst;
}

/* ---- features, from player p's side ----
   For each realm, its 12 cards one-hot over 9 places: 0 unseen (the deck or the opponent's hidden hand),
   1 my hand, 2 my line, 3 the opponent's line, 4 top of the discard pile, 5 second, 6 deeper, 7 in the
   opponent's hand and known, 8 in my hand and known to the opponent (I took it from a discard pile, which
   changes how the opponent plays). Then 22 summary numbers: my line (started, cards, Pacts, top value, sum,
   score, crystal), the opponent's line (the same 7), my playable hand cards (count, sum of values, Pacts),
   the unseen cards (count, and the count and sum of those my line could still take), whether this pile
   was just discarded on (it can't be drawn from this turn), and the cards left, so each realm's reading
   knows how much time there is to fill its line. Globals: cards left, my turn, drawing, and whether an odd
   number of cards is left (if everyone draws from the deck, that decides who takes the last card).
   Writes into f = { idx: Int32Array(5*12), dense: Float32Array(5*22), glob: Float32Array(4) }. */
function newFeatures() {
  return { idx: new Int32Array(5 * 12), dense: new Float32Array(5 * NET.DENSE), glob: new Float32Array(NET.GLOBAL) };
}
const NET_CAT = [
  // code low bits -> place, for p = 0 and p = 1 (known cards in the opponent's hand handled separately)
  [0, 1, 0, 2, 3, 4, 5, 6],
  [0, 0, 1, 3, 2, 4, 5, 6],
];
function featurize(buf, at, p, f) {
  const deck = buf[at + 60], flags = buf[at + 61];
  const toMove = (flags & 1) === p ? 1 : 0, drawing = flags & 2 ? 1 : 0, lastDiscard = ((flags >> 2) & 7) - 1;
  const cat = NET_CAT[p], oppHand = 2 - p;   // code of the opponent's hand
  for (let r = 0; r < 5; r++) {
    // First pass: places, and the shape of both lines.
    let myN = 0, myP = 0, myTop = 0, mySum = 0, opN = 0, opP = 0, opTop = 0, opSum = 0;
    for (let k = 0; k < 12; k++) {
      const code = buf[at + r * 12 + k], loc = code & 7;
      let place = cat[loc];
      if (code & 8) place = loc === oppHand ? 7 : 8;   // only cards in a hand are marked known
      f.idx[r * 12 + k] = k * NET.CATS + place;
      const v = k < 3 ? 0 : k - 1;
      if (place === 2) { myN++; if (v) { mySum += v; if (v > myTop) myTop = v; } else myP++; }
      else if (place === 3) { opN++; if (v) { opSum += v; if (v > opTop) opTop = v; } else opP++; }
    }
    // Second pass: what my line could still take, from my hand and from the unseen cards.
    let hN = 0, hSum = 0, hP = 0, uN = 0, uFit = 0, uSum = 0;
    for (let k = 0; k < 12; k++) {
      const place = f.idx[r * 12 + k] - k * NET.CATS, v = k < 3 ? 0 : k - 1;
      const fits = myN === 0 || (v === 0 ? myTop === 0 : v > myTop);
      if ((place === 1 || place === 8) && fits) { hN++; if (v) hSum += v; else hP++; }
      if (place === 0) { uN++; if (fits) { uFit++; uSum += v; } }
    }
    const score = (n, pacts, sum) => n ? (sum - 20) * (1 + pacts) + (n >= CRYSTAL_AT ? CRYSTAL_BONUS : 0) : 0;
    const d = f.dense, o = r * NET.DENSE;
    d[o] = myN ? 1 : 0; d[o + 1] = myN / 8; d[o + 2] = myP / 3; d[o + 3] = myTop / 10; d[o + 4] = mySum / 54;
    d[o + 5] = score(myN, myP, mySum) / 60; d[o + 6] = myN >= CRYSTAL_AT ? 1 : 0;
    d[o + 7] = opN ? 1 : 0; d[o + 8] = opN / 8; d[o + 9] = opP / 3; d[o + 10] = opTop / 10; d[o + 11] = opSum / 54;
    d[o + 12] = score(opN, opP, opSum) / 60; d[o + 13] = opN >= CRYSTAL_AT ? 1 : 0;
    d[o + 14] = hN / 8; d[o + 15] = hSum / 54; d[o + 16] = hP / 3;
    d[o + 17] = uN / 12; d[o + 18] = uFit / 12; d[o + 19] = uSum / 54;
    d[o + 20] = drawing && lastDiscard === r ? 1 : 0;
    d[o + 21] = deck / 44;
  }
  f.glob[0] = deck / 44; f.glob[1] = toMove; f.glob[2] = drawing; f.glob[3] = deck & 1;
  return f;
}

/* ---- the network ----
   realm reader: F -> H1 -> H2 (ReLU), shared by the five realms; the five outputs are added;
   head: (H2 + 3) -> H3 -> H3 (ReLU) -> 1. Weights are row-major [input][output]. */
function gaussian(rnd) { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }
function newNet(seed = 1, H1 = 64, H2 = 32, H3 = 64) {
  const rnd = makeRng(seed);
  const layer = (n, m) => { const W = new Float32Array(n * m), s = Math.sqrt(2 / n); for (let i = 0; i < W.length; i++) W[i] = gaussian(rnd) * s; return W; };
  const G = NET.GLOBAL;
  return {
    H1, H2, H3,
    W1: layer(NET.F, H1), b1: new Float32Array(H1),
    W2: layer(H1, H2), b2: new Float32Array(H2),
    W3: layer(H2 + G, H3), b3: new Float32Array(H3),
    W4: layer(H3, H3), b4: new Float32Array(H3),
    W5: layer(H3, 1).map(x => x * 0.1), b5: new Float32Array(1),
  };
}
const NET_PARAMS = ['W1', 'b1', 'W2', 'b2', 'W3', 'b3', 'W4', 'b4', 'W5', 'b5'];
function netToJSON(net) {
  const o = { H1: net.H1, H2: net.H2, H3: net.H3 };
  for (const k of NET_PARAMS) o[k] = Array.from(net[k], x => Math.round(x * 1e6) / 1e6);
  return o;
}
function netFromJSON(o) {
  if (o.W1.length !== NET.F * o.H1) throw new Error(`these weights were trained on ${o.W1.length / o.H1} features, not ${NET.F}: retrain them`);
  const net = { H1: o.H1, H2: o.H2, H3: o.H3 };
  for (const k of NET_PARAMS) net[k] = Float32Array.from(o[k]);
  // Weights from before the odd-or-even input: give it a weight of zero, so they work exactly as before
  // and further training can learn to use it.
  const W3 = (o.H2 + NET.GLOBAL) * o.H3;
  if (net.W3.length === W3 - o.H3) { const w = new Float32Array(W3); w.set(net.W3); net.W3 = w; }
  if (net.W3.length !== W3) throw new Error(`these weights expect ${net.W3.length / o.H3 - o.H2} overall inputs, not ${NET.GLOBAL}`);
  return net;
}

// Activations for one position (kept so training can run the network backwards).
function newActs(net) {
  return {
    h1: new Float32Array(5 * net.H1), h2: new Float32Array(5 * net.H2),
    z: new Float32Array(net.H2 + NET.GLOBAL), a1: new Float32Array(net.H3), a2: new Float32Array(net.H3), y: 0,
  };
}
function netForward(net, f, a) {
  const { H1, H2, H3, W1, b1, W2, b2, W3, b3, W4, b4, W5, b5 } = net, F = NET.F, D = NET.DENSE;
  const z = a.z;
  for (let j = 0; j < H2; j++) z[j] = 0;
  for (let r = 0; r < 5; r++) {
    const h1 = a.h1, o1 = r * H1;
    for (let j = 0; j < H1; j++) h1[o1 + j] = b1[j];
    for (let k = 0; k < 12; k++) { const row = f.idx[r * 12 + k] * H1; for (let j = 0; j < H1; j++) h1[o1 + j] += W1[row + j]; }
    for (let i = 0; i < D; i++) {
      const x = f.dense[r * D + i];
      if (x === 0) continue;
      const row = (NET.ONEHOT + i) * H1;
      for (let j = 0; j < H1; j++) h1[o1 + j] += x * W1[row + j];
    }
    for (let j = 0; j < H1; j++) if (h1[o1 + j] < 0) h1[o1 + j] = 0;
    const h2 = a.h2, o2 = r * H2;
    for (let j = 0; j < H2; j++) h2[o2 + j] = b2[j];
    for (let i = 0; i < H1; i++) {
      const x = h1[o1 + i];
      if (x === 0) continue;
      const row = i * H2;
      for (let j = 0; j < H2; j++) h2[o2 + j] += x * W2[row + j];
    }
    for (let j = 0; j < H2; j++) { if (h2[o2 + j] < 0) h2[o2 + j] = 0; z[j] += h2[o2 + j]; }
  }
  for (let g = 0; g < NET.GLOBAL; g++) z[H2 + g] = f.glob[g];
  const a1 = a.a1, a2 = a.a2, Z = H2 + NET.GLOBAL;
  for (let j = 0; j < H3; j++) a1[j] = b3[j];
  for (let i = 0; i < Z; i++) { const x = z[i]; if (x === 0) continue; const row = i * H3; for (let j = 0; j < H3; j++) a1[j] += x * W3[row + j]; }
  for (let j = 0; j < H3; j++) if (a1[j] < 0) a1[j] = 0;
  for (let j = 0; j < H3; j++) a2[j] = b4[j];
  for (let i = 0; i < H3; i++) { const x = a1[i]; if (x === 0) continue; const row = i * H3; for (let j = 0; j < H3; j++) a2[j] += x * W4[row + j]; }
  let y = b5[0];
  for (let j = 0; j < H3; j++) { if (a2[j] < 0) a2[j] = 0; y += a2[j] * W5[j]; }
  a.y = y;
  return y;
}

// Gradient of the loss with respect to every weight, for one position whose forward pass left its
// activations in a, where dy is the loss's slope at the output (for squared error, prediction - target).
// Adds into grad (same keys as the weights); b is scratch space from newBackScratch().
function newBackScratch(net) {
  return { da2: new Float32Array(net.H3), da1: new Float32Array(net.H3), dz: new Float32Array(net.H2 + NET.GLOBAL),
    dh2: new Float32Array(net.H2), dh1: new Float32Array(net.H1) };
}
function netBackward(net, f, a, dy, grad, b) {
  const { H1, H2, H3, W2, W3, W4, W5 } = net, Z = H2 + NET.GLOBAL, D = NET.DENSE;
  const { h1, h2, z, a1, a2 } = a, { da2, da1, dz, dh2, dh1 } = b;
  grad.b5[0] += dy;
  for (let j = 0; j < H3; j++) { grad.W5[j] += dy * a2[j]; da2[j] = a2[j] > 0 ? dy * W5[j] : 0; grad.b4[j] += da2[j]; }
  for (let i = 0; i < H3; i++) {
    const x = a1[i], row = i * H3;
    let s = 0;
    for (let j = 0; j < H3; j++) { if (x) grad.W4[row + j] += x * da2[j]; s += W4[row + j] * da2[j]; }
    da1[i] = x > 0 ? s : 0;
  }
  for (let j = 0; j < H3; j++) grad.b3[j] += da1[j];
  for (let i = 0; i < Z; i++) {
    const x = z[i], row = i * H3;
    let s = 0;
    for (let j = 0; j < H3; j++) { if (x) grad.W3[row + j] += x * da1[j]; s += W3[row + j] * da1[j]; }
    dz[i] = s;
  }
  for (let r = 0; r < 5; r++) {
    const o1 = r * H1, o2 = r * H2;
    for (let j = 0; j < H2; j++) { dh2[j] = h2[o2 + j] > 0 ? dz[j] : 0; grad.b2[j] += dh2[j]; }
    for (let i = 0; i < H1; i++) {
      const x = h1[o1 + i], row = i * H2;
      if (x <= 0) { dh1[i] = 0; continue; }
      let s = 0;
      for (let j = 0; j < H2; j++) { grad.W2[row + j] += x * dh2[j]; s += W2[row + j] * dh2[j]; }
      dh1[i] = s;
    }
    for (let j = 0; j < H1; j++) grad.b1[j] += dh1[j];
    for (let k = 0; k < 12; k++) { const row = f.idx[r * 12 + k] * H1; for (let j = 0; j < H1; j++) grad.W1[row + j] += dh1[j]; }
    for (let i = 0; i < D; i++) {
      const x = f.dense[r * D + i];
      if (x === 0) continue;
      const row = (NET.ONEHOT + i) * H1;
      for (let j = 0; j < H1; j++) grad.W1[row + j] += x * dh1[j];
    }
  }
}

/* ---- the network as a player ---- */
const netScratch = { buf: new Uint8Array(NET.RECORD), f: newFeatures(), acts: null, net: null };
// The network's prediction of player p's final lead (in points) in state st, seen from p's side.
function netLead(net, st, p) {
  const s = netScratch;
  if (s.net !== net) { s.net = net; s.acts = newActs(net); }
  encodeState(st, s.buf, 0);
  featurize(s.buf, 0, p, s.f);
  return netForward(net, s.f, s.acts) * NET.SCALE;
}

// Play or discard: the move after which the network likes p's position best. noise (points, optional) adds
// a random amount to each move's value, for variety when generating training games.
// With one card left the round ends when this player takes it (netDraw always does), so the move's value is
// known exactly: the lead after it. The network only breaks ties there, and noise is left out.
function netMove(net, st, rnd = null, noise = 0) {
  const p = st.turn, last = st.deck.length === 1;
  let best = null, bestV = -Infinity;
  for (const m of legalMoves(st)) {
    const s = cloneState(st);
    applyMove(s, m);
    let v = last ? playerTotal(s, p) - playerTotal(s, p ^ 1) + 1e-3 * netLead(net, s, p) : netLead(net, s, p);
    if (noise && rnd && !last) v += (rnd() - 0.5) * 2 * noise;
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}

// With one card left: the play or discard after which the player to move leads by most (they then take the
// last card, ending the round).
function bestLastMove(st) {
  const p = st.turn;
  let best = null, bestV = -Infinity;
  for (const m of legalMoves(st)) {
    const s = cloneState(st);
    applyMove(s, m);
    const v = playerTotal(s, p) - playerTotal(s, p ^ 1);
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}

// Draw: a discard pile's top card is known, so that position is scored directly; a card from the deck is
// averaged over every card it could be, each weighted by its chance of being in the deck rather than the
// opponent's hidden hand, by the same public clues and the same model the Oracle deals with: the weights
// were fitted for sampling without replacement, where a card is in the hand with chance 1 - exp(-w t), t
// set so those chances add up to the hidden hand's size (tests/calibrate.js). With one card left it always
// takes it, ending the round: taking a pile instead can't raise the lead against an opponent who would then
// discard and take the last card themselves (and two players who both refuse would trade cards forever).
function netDraw(net, st, rnd = null, noise = 0) {
  const p = st.turn, o = p ^ 1;
  if (st.deck.length === 1) return -1;
  let best = -1, bestV = -Infinity;
  for (const src of legalDraws(st)) {
    let v;
    if (src >= 0) {
      const s = cloneState(st);
      applyDraw(s, src);
      v = netLead(net, s, p);
    } else {
      const w = opponentWeights(st, p), unknown = st.hands[o].length - st.known[o].length;
      let t = 0;
      if (unknown > 0) {
        let lo = 0, hi = 1e3;
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) / 2;
          let inHand = 0;
          for (let c = 0; c < DECK_SIZE; c++) if (w[c] > 0) inHand += 1 - Math.exp(-w[c] * mid);
          if (inHand < unknown) lo = mid; else hi = mid;
        }
        t = (lo + hi) / 2;
      }
      const s = cloneState(st);
      // Turn the hypothetical deck draw into a position: the card joins p's hand, the deck shrinks by one.
      const top = s.deck.pop();
      s.hands[p].push(top);
      s.lastDiscard = -1; s.turn = o; s.phase = 'play';
      const handAt = s.hands[p].length - 1;
      let total = 0, weight = 0;
      for (let c = 0; c < DECK_SIZE; c++) {
        if (w[c] <= 0) continue;   // seen by p: can't be on the deck
        const pTop = Math.exp(-w[c] * t);   // chance c is in the deck, so equally likely to be its top card
        s.hands[p][handAt] = c;
        // c may really be in the opponent's hand or deeper in the deck; from p's side both are just unseen,
        // so only p's hand and the deck size matter for the features.
        const oi = s.hands[o].indexOf(c), di = s.deck.indexOf(c);
        if (oi >= 0) s.hands[o][oi] = top; else if (di >= 0) s.deck[di] = top;
        total += pTop * netLead(net, s, p);
        weight += pTop;
        if (oi >= 0) s.hands[o][oi] = c; else if (di >= 0) s.deck[di] = c;
      }
      v = weight ? total / weight : 0;
    }
    if (noise && rnd) v += (rnd() - 0.5) * 2 * noise;
    if (v > bestV) { bestV = v; best = src; }
  }
  return best;
}

/* ---- the network inside the Oracle's search: the Seer ----
   The Oracle (analyze in src/engine.js) deals out possible worlds for the cards it can't see, tries every
   move in each, and plays each future to the end with the rules of thumb. The Seer plays each future only
   `depth` decisions ahead with the same rules of thumb and then asks the network how the round will end
   from there, from p's side. The network has learned how good players finish such positions, which the
   rules of thumb only approximate, and a short future varies far less than a whole one. Once one card is
   left the end is played out exactly instead (the best last move, then the last card), however deep that
   is, since the result is then known. Returns the options best first, each with its mean and standard error.
   settings.advice = 'net' or 'heuristic' adds the Oracle's decision rule (pickAdvice): risky discards and
   openings must clearly beat the best safe move, and the anchor move (the network's own choice, or the rules
   of thumb's) stands unless another is clearly better on the same worlds. */
// The Oracle's decision rule, stricter about throwing away a card for its own line. The network rates those
// discards a few points too high, and in testing the opponent picked up three in four of them. So such a discard
// must win by the card's full worth on the line (the Oracle asks for half), and still by that much when every
// option is risky.
const SEER_RULES = { keepOwn: true, ownShare: 1 };
// In the Seer's simulated futures nobody picks up a card just to keep it from the other player (settings.deny = true
// brings that back). The rules of thumb take a card that fits just above the top of the other player's line, which made
// throwing away a card for its own line look like good bait: in a recorded round the simulated opponent took the Seer's
// Dryad 5 in 97% of futures. In the recorded rounds the player took such a card at 5 of 37 chances, where the rules of
// thumb would have taken it at 36, so the bait mostly just lost cards. The player did take 3 of the 5 high ones (7 to 9);
// SEER_RULES still guards those, since throwing one away must win by its full worth.
const SEER_DENY = false;
function* netAnalyze(net, st, p, samples, seed, depth = 8, settings = {}) {
  const opts = st.phase === 'play'
    ? legalMoves(st)
    : (st.deck.length === 1 ? [-1] : legalDraws(st)).map(src => ({ type: 'draw', src }));
  const k = opts.length, deny = settings.deny === undefined ? SEER_DENY : !!settings.deny;
  const margins = opts.map(() => new Float64Array(samples));
  const weights = opponentWeights(st, p, settings.handWeights);
  const master = makeRng(seed);
  for (let i = 0; i < samples; i++) {
    const world = determinize(st, p, master, weights);
    const seedI = (master() * 4294967296) >>> 0;
    for (let j = 0; j < k; j++) {
      const s = cloneState(world), o = opts[j], rnd = makeRng(seedI);
      if (o.type === 'draw') applyDraw(s, o.src); else applyMove(s, o);
      for (let d = 0; !s.over && (d < depth || s.deck.length === 1); d++) {
        const last = s.deck.length === 1;
        if (s.phase === 'play') applyMove(s, last ? bestLastMove(s) : heuristicMove(s, rnd, ROLLOUT_NOISE));
        else applyDraw(s, last ? -1 : heuristicDraw(s, rnd, ROLLOUT_NOISE, deny));
      }
      margins[j][i] = s.over ? playerTotal(s, p) - playerTotal(s, p ^ 1) : netLead(net, s, p);
    }
    yield (i + 1) / samples;
  }
  const options = opts.map((o, j) => Object.assign({}, o, meanSe(margins[j]), { j })).sort((a, b) => b.mean - a.mean);
  if (!settings.advice) return { options, best: options[0], samples };
  for (const o of options) Object.assign(o, {
    gift: o.type === 'discard' ? giftRisk(st, p, o.card) : null,
    own: o.type === 'discard' ? ownLoss(st, p, o.card) : null,
    skip: o.type === 'play' ? skipLoss(st, p, o.card) : null,
    open: o.type === 'play' && OPEN_RULE ? openRisk(st, p, o.card) : null,
  });
  let anchor;
  if (settings.advice === 'net') {
    const m = st.phase === 'play' ? netMove(net, st) : netDraw(net, st);
    anchor = options.find(o => st.phase === 'play' ? o.type === m.type && o.card === m.card : o.src === m) || null;
  } else {
    const h = st.phase === 'play' ? heuristicMove(st, null, 0) : heuristicDraw(st, null, 0);
    const same = (a, b) => realmOf(a) === realmOf(b) && valueOf(a) === valueOf(b);
    anchor = options.find(o => st.phase === 'play' ? o.type === h.type && same(o.card, h.card) : o.src === h) || null;
  }
  return { options, best: pickAdvice(options, margins, anchor, settings.rules || SEER_RULES).best, samples };
}
// The Seer's choice for the player to move (a play or discard, or a draw source in the draw phase).
function netSearch(net, st, samples, seed, depth = 8, settings = {}) {
  const g = netAnalyze(net, st, st.turn, samples, seed, depth, settings);
  let x;
  while (!(x = g.next()).done);
  return x.value.best;
}
