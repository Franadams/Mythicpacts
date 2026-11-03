/* Self-play games for training the network. Every position where a player has to decide (a play or a
   draw) is stored with encodeState(), and when the round ends each of its positions gets player 0's final
   lead, so training can read every position from either side.

   Run from the project folder (JSC is macOS's built-in JavaScriptCore):
     $JSC src/engine.js nn/net.js nn/selfplay.js -- games=200 seed=1001 a=oracle b=oracle out=nn/data/oracle-1001.bin
   Players (a = seat 0 in even games; seats alternate, like the first player):
     oracle       the Monte Carlo player (samples=N simulated deals per decision, default 80)
     apprentice   the rules of thumb
     net          the network in net=FILE; noise=N adds up to +-N points to each move's value, for variety
     seer         the Oracle's search with the network in net=FILE judging each simulated future after
                  depth=N decisions (default 8; samples=N worlds, like the Oracle); advice=net or
                  advice=heuristic adds the Oracle's decision rule, anchored on that player's move
   Deals come from seed (use seeds well away from the benchmark's, which start at 1). Over every four games
   each player moves first in each seat. Two predictable players (the rules of thumb, or networks without
   noise) can trade the same cards between the discard piles forever (both refusing to take the last card),
   so when both are predictable a game that repeats a position stops there and is scored as it stands: the
   lines can't change inside such a loop, so that is how it would end. With a player who chooses at random
   (the Oracle, the Seer, a network with noise) the game goes on, since that player can break out; repeated
   positions are just not stored again. Any game still going after 500 decisions is scored as it stands,
   the same as the benchmark does. Both are counted; a real round takes 90-250 decisions.
   When an Oracle decides, its estimate for every move it considered is stored too, in FILE.q next to the
   positions: 8 bytes each, the position's number (uint32), the move (uint16: 0-59 play that card, 60-119
   discard card - 60, 120 draw from the deck, 121-125 draw from pile 0-4) and the Oracle's average lead
   after it, in tenths of a point (int16). Those are far less noisy than one game's final lead.
   label=oracle asks the Oracle for its estimates at every decision, the other player's too, so a network's
   own positions get the Oracle's opinion of every move it could have made (its choices are still its own). */

const args = {};
for (const a of (typeof arguments !== 'undefined' ? arguments : [])) {
  const i = a.indexOf('=');
  if (i > 0) args[a.slice(0, i)] = a.slice(i + 1);
}
const GAMES = +(args.games || 100), SEED = +(args.seed || 1001), SAMPLES = +(args.samples || 80), NOISE = +(args.noise || 0);
const DEPTH = +(args.depth || 8);
const WEIGHTS = args.net ? netFromJSON(JSON.parse(readFile(args.net))) : null;
const LABEL = args.label === 'oracle';

let qbuf = new Uint8Array(1 << 20), qn = 0;
function noteEstimates(rec, options) {
  if (rec < 0) return;   // a repeated position, not stored
  for (const o of options) {
    if ((qn + 1) * 8 > qbuf.length) { const bigger = new Uint8Array(qbuf.length * 2); bigger.set(qbuf); qbuf = bigger; }
    const code = o.type === 'play' ? o.card : o.type === 'discard' ? 60 + o.card : 121 + o.src;
    const v = Math.max(-32768, Math.min(32767, Math.round(o.mean * 10))) & 0xffff, at = qn * 8;
    qbuf[at] = rec & 0xff; qbuf[at + 1] = (rec >> 8) & 0xff; qbuf[at + 2] = (rec >> 16) & 0xff; qbuf[at + 3] = (rec >>> 24) & 0xff;
    qbuf[at + 4] = code & 0xff; qbuf[at + 5] = code >> 8; qbuf[at + 6] = v & 0xff; qbuf[at + 7] = v >> 8;
    qn++;
  }
}
function oracleBest(st, rnd, rec) {
  const g = analyze(cloneState(st), st.turn, SAMPLES, (rnd() * 4294967296) >>> 0);
  let x;
  while (!(x = g.next()).done);
  noteEstimates(rec, x.value.options);
  return x.value.best;
}
function player(kind) {
  if (kind === 'oracle') return {
    oracle: true,
    move: (st, rnd, rec) => { const b = oracleBest(st, rnd, rec); return { type: b.type, card: b.card }; },
    draw: (st, rnd, rec) => oracleBest(st, rnd, rec).src,
  };
  if (kind === 'apprentice') return { predictable: true, move: st => heuristicMove(st, null, 0), draw: st => heuristicDraw(st, null, 0) };
  if (kind === 'net') {
    if (!WEIGHTS) throw new Error('net needs net=FILE');
    return { predictable: !NOISE, move: (st, rnd) => netMove(WEIGHTS, st, rnd, NOISE), draw: (st, rnd) => netDraw(WEIGHTS, st, rnd, NOISE) };
  }
  if (kind === 'seer') {
    if (!WEIGHTS) throw new Error('seer needs net=FILE');
    const pick = (st, rnd) => netSearch(WEIGHTS, st, SAMPLES, (rnd() * 4294967296) >>> 0, DEPTH, { advice: args.advice });
    return { move: (st, rnd) => { const b = pick(st, rnd); return { type: b.type, card: b.card }; }, draw: (st, rnd) => pick(st, rnd).src };
  }
  throw new Error(`unknown player ${kind}`);
}

const A = player(args.a || 'oracle'), B = player(args.b || 'oracle');
const labelRnd = makeRng((SEED * 2654435761) >>> 0);   // the labelling Oracle's own simulations
const MAX_DECISIONS = 500;
let buf = new Uint8Array(GAMES * 110 * NET.RECORD), n = 0;
const t0 = Date.now();
let leadSum = 0, looped = 0, capped = 0;
for (let i = 0; i < GAMES; i++) {
  const dealSeed = (SEED * 1000003 + i) >>> 0, first = i % 2;
  const st = newRound(first, makeRng(dealSeed));
  const rnd = makeRng((dealSeed ^ 0x5bd1e995) >>> 0);
  const seats = (i >> 1) % 2 ? [B, A] : [A, B];
  const start = n, seen = new Set();
  for (let decisions = 0; !st.over; decisions++) {
    if (decisions >= MAX_DECISIONS) { capped++; break; }
    if ((n + 1) * NET.RECORD > buf.length) { const bigger = new Uint8Array(buf.length * 2); bigger.set(buf); buf = bigger; }
    encodeState(st, buf, n * NET.RECORD);
    const key = String.fromCharCode.apply(null, buf.subarray(n * NET.RECORD, n * NET.RECORD + 62));
    let rec = -1;
    if (seen.has(key)) {
      if (A.predictable && B.predictable) { looped++; break; }
    } else {
      seen.add(key);
      if (n === start) buf[n * NET.RECORD + 61] |= 32;   // first position of a game
      rec = n++;
    }
    const pl = seats[st.turn];
    if (LABEL && !pl.oracle && rec >= 0) oracleBest(st, labelRnd, rec);
    if (st.phase === 'play') applyMove(st, pl.move(st, rnd, rec));
    else applyDraw(st, pl.draw(st, rnd, rec));
  }
  const lead0 = playerTotal(st, 0) - playerTotal(st, 1);
  leadSum += Math.abs(lead0);
  for (let k = start; k < n; k++) setRecordLead(buf, k * NET.RECORD, lead0);
}
const secs = (Date.now() - t0) / 1000;
if (args.out) {
  writeFile(args.out, buf.subarray(0, n * NET.RECORD));
  if (qn) writeFile(args.out + '.q', qbuf.subarray(0, qn * 8));
}
const stopped = looped || capped ? `, ${looped + capped} stopped and scored as they stood (${looped} going round in circles between two predictable players, ${capped} at ${MAX_DECISIONS} decisions)` : '';
print(`${GAMES} games (${args.a || 'oracle'} vs ${args.b || 'oracle'}${LABEL ? ', every decision labelled by the Oracle' : ''})${stopped}, ${n} positions, ${qn} Oracle estimates, ${secs.toFixed(1)} s (${(secs / GAMES).toFixed(2)} s a game); average size of the final lead ${(leadSum / GAMES).toFixed(1)}`);
