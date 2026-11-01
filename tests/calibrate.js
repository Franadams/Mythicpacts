/* Calibration for the Oracle's picture of the opponent's hand (HAND_WEIGHTS in src/engine.js)
   and the data behind the 'could-start' gift rule. Not part of tests/run.sh.

   Run from the project folder:
     JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
     $JSC src/engine.js tests/calibrate.js -- games=4000
   Options:
     games=N     games between Apprentices that play with random noise 0-3 (default 2000)
     oracle=N    extra games of the Oracle (80 samples) against a noisy Apprentice (default 0; slow)
     seed=N      first game seed; runs with different seeds are independent
     out=FILE    save the raw data instead of fitting, so several runs can go in parallel
     merge=F1,F2 fit and report from saved runs

   METHOD
   At every decision of every game, from the point of view of the player to move, each card that
   player cannot see is one observation: its public evidence (handEvidence() in the engine) and
   whether it really was in the opponent's hand. Under uniform dealing every such card has the same
   chance, u / (number of unseen cards), where u is how many unknown cards the opponent holds.
   1. Raw table: for each evidence bucket, (cards that were in the hand) / (sum of the uniform
      chances), a frequency ratio against the base rate. Standard errors are clustered by game,
      because the same card is observed at many decisions of one game.
   2. Fitted weights: the engine deals the opponent's hand by weighted sampling without replacement,
      where a card's chance of being dealt is close to 1 - exp(-weight * t), with t set so the
      chances add up to u (Rosen's approximation for successive sampling). Starting from weight 1,
      each weight is multiplied by observed / predicted for its bucket until they agree (iterative
      proportional fitting). The ratio in step 1 is not used directly because it saturates when
      the opponent's hand is a large share of the unseen cards.
   3. Checks on held-out games (every fifth game): log-loss of the predicted chances against the
      truth for uniform dealing, the fitted table and the table in engine.js, and the engine's
      own determinize() run 8 times per decision, whose dealing frequency per bucket should match
      how often such cards really were in the hand.
   4. Gifts: every discard is followed to see whether the opponent took it from the pile and
      ended the round with it on a line. */

const args = {};
for (const a of (typeof arguments !== 'undefined' ? arguments : [])) {
  const i = a.indexOf('=');
  if (i > 0) args[a.slice(0, i)] = a.slice(i + 1);
}
const PHASES = 3, KINDS = EVIDENCE.length, CELLS = KINDS * PHASES;
const CHECK_DRAWS = 8;
const HEAD = 4;   // each saved decision is [u, held out?, opponent is Oracle?, game, ...card codes]
const isTest = game => game % 5 === 4;

function newData() {
  return {
    games: 0, oracleGames: 0, testGames: 0,
    obs: [],          // per decision: HEAD values, then one code per unseen card: kind | phase << 4 | inHand << 8
    cell: Array.from({ length: CELLS }, () => ({ n: 0, y: 0, e: 0, yy: 0, ee: 0, ye: 0 })),
    byOpp: Array.from({ length: 2 }, () => Array.from({ length: KINDS }, () => ({ n: 0, y: 0, e: 0 }))),
    check: Array.from({ length: KINDS }, () => ({ n: 0, y: 0, dealt: 0 })),
    gifts: {},        // key -> [discards, taken, taken and played]
  };
}

// ---- playing and recording ----
function oracleBest(st) {
  const g = analyze(st, st.turn, 80, (Math.imul(st.deck.length + 1, 2654435761) ^ st.hands[st.turn][0]) >>> 0);
  let x;
  while (!(x = g.next()).done);
  return x.value.best;
}
const apprentice = noise => ({ oracle: false, move: (st, r) => heuristicMove(st, r, noise), draw: (st, r) => heuristicDraw(st, r, noise) });
const oracle = { oracle: true, move: st => { const b = oracleBest(st); return { type: b.type, card: b.card }; }, draw: st => oracleBest(st).src };

function recordDecision(D, st, p, players, game, perGame, rnd) {
  const o = p ^ 1, ev = handEvidence(st, p), u = st.hands[o].length - st.known[o].length;
  const inHand = handMask(st.hands[o]);
  let pool = 0;
  for (let c = 0; c < DECK_SIZE; c++) if (ev.kind[c] >= 0) pool++;
  if (!pool || u <= 0) return;
  const base = u / pool, test = isTest(game) ? 1 : 0, opp = players[o].oracle ? 1 : 0;
  const row = [u, test, opp, game];
  let dealt = null;
  if (test) {   // how often the engine's own sampler deals each card to the opponent
    dealt = new Uint8Array(DECK_SIZE);
    const w = opponentWeights(st, p);
    for (let k = 0; k < CHECK_DRAWS; k++) for (const c of determinize(st, p, rnd, w).hands[o]) dealt[c]++;
  }
  for (let c = 0; c < DECK_SIZE; c++) {
    const k = ev.kind[c];
    if (k < 0) continue;
    const y = inHand[c], cell = k * PHASES + ev.phase;
    row.push(k | ev.phase << 4 | y << 8);
    perGame[cell].y += y; perGame[cell].e += base; D.cell[cell].n++;
    const bo = D.byOpp[opp][k]; bo.n++; bo.y += y; bo.e += base;
    if (dealt) { const ch = D.check[k]; ch.n++; ch.y += y; ch.dealt += dealt[c] / CHECK_DRAWS; }
  }
  D.obs.push(row);
}

function playGame(D, players, game, seed) {
  const rnd = makeRng(seed), st = newRound(game % 2, rnd);
  const perGame = D.cell.map(() => ({ y: 0, e: 0 }));
  const watch = [];   // discards we follow to see if the opponent takes and plays them
  while (!st.over) {
    const p = st.turn;
    recordDecision(D, st, p, players, game, perGame, rnd);
    if (st.phase === 'play') {
      const m = players[p].move(st, rnd);
      if (m.type === 'discard') {
        const o = p ^ 1, r = realmOf(m.card), theirs = st.exp[o][r], n = st.deck.length;
        const cat = theirs.length ? (canPlay(theirs, m.card) ? 'feeds' : 'dead') : 'unstarted';
        const key = [cat, valueOf(m.card), n >= 30 ? 3 : n >= 16 ? 2 : n >= 8 ? 1 : 0,
          st.exp[p][r].length ? 1 : 0, giftKind(st, p, m.card), players[o].oracle ? 'oracle' : 'apprentice'].join();
        watch.push({ card: m.card, o, key, taken: 0 });
      }
      applyMove(st, m);
    } else {
      const src = players[p].draw(st, rnd), card = applyDraw(st, src);
      if (src >= 0) for (const w of watch) if (w.card === card && w.o === p) w.taken = 1;
    }
  }
  for (const w of watch) {
    const g = D.gifts[w.key] || (D.gifts[w.key] = [0, 0, 0]);
    g[0]++; g[1] += w.taken;
    if (w.taken && st.exp[w.o][realmOf(w.card)].indexOf(w.card) >= 0) g[2]++;
  }
  // Per-game sums for standard errors clustered by game.
  perGame.forEach((x, i) => { const a = D.cell[i]; a.y += x.y; a.e += x.e; a.yy += x.y * x.y; a.ee += x.e * x.e; a.ye += x.y * x.e; });
  D.games++;
  if (isTest(game)) D.testGames++;
}

function play() {
  const D = newData(), seed0 = +(args.seed || 1), games = +(args.games || 2000), oracles = +(args.oracle || 0);
  for (let i = 0; i < games + oracles; i++) {
    const game = seed0 * 100000 + i, rnd = makeRng(game ^ 0x2545F491);
    const noise = () => (rnd() * 4) | 0;
    let players = [apprentice(noise()), apprentice(noise())];
    if (i >= games) { players[i % 2] = oracle; D.oracleGames++; }
    playGame(D, players, game, game);
  }
  return D;
}

// ---- fitting ----
// Chance that each card is dealt when `u` of them are drawn in proportion to the weights (Rosen).
function inclusion(ws, u, out) {
  let sum = 0;
  for (const w of ws) sum += w;
  let t = u / sum;
  for (let k = 0; k < 40; k++) {   // Newton's method on a concave increasing function, from below
    let g = -u, d = 0;
    for (const w of ws) { const e = Math.exp(-w * t); g += 1 - e; d += w * e; }
    const step = g / d;
    t -= step;
    if (Math.abs(step) < 1e-10 * t) break;
  }
  for (let i = 0; i < ws.length; i++) out[i] = 1 - Math.exp(-ws[i] * t);
}

const cellOf = code => (code & 15) * PHASES + (code >> 4 & 3);

function predictions(rows, hand, fn) {
  for (const row of rows) {
    const u = row[0], n = row.length - HEAD, ws = new Float64Array(n), pi = new Float64Array(n);
    for (let i = 0; i < n; i++) ws[i] = hand[cellOf(row[i + HEAD])];
    if (u >= n) pi.fill(1); else inclusion(ws, u, pi);
    for (let i = 0; i < n; i++) fn(row[i + HEAD], pi[i], row);
  }
}

function fit(rows) {
  const hand = new Float64Array(CELLS).fill(1);
  for (let it = 0; it < 12; it++) {
    const obs = new Float64Array(CELLS), pred = new Float64Array(CELLS);
    predictions(rows, hand, (code, pi) => { const j = cellOf(code); obs[j] += code >> 8; pred[j] += pi; });
    for (let j = 0; j < CELLS; j++) if (obs[j] > 0 && pred[j] > 0) hand[j] *= obs[j] / pred[j];
  }
  // Only ratios between weights matter; scale them so the average unseen card has weight 1.
  let sw = 0, n = 0;
  for (const row of rows) for (let i = HEAD; i < row.length; i++) { sw += hand[cellOf(row[i])]; n++; }
  for (let j = 0; j < CELLS; j++) hand[j] /= sw / n;
  return hand;
}

function logLoss(rows, hand) {
  const perGame = new Map();
  let total = 0, n = 0;
  rows.forEach(row => {
    let ll = 0;
    predictions([row], hand, (code, pi) => {
      const p = Math.min(Math.max(pi, 1e-9), 1 - 1e-9);
      ll -= code >> 8 ? Math.log(p) : Math.log(1 - p);
      n++;
    });
    total += ll;
    perGame.set(row[3], (perGame.get(row[3]) || 0) + ll);
  });
  return { perObs: total / n, perGame };
}

// ---- reporting ----
const f2 = x => x.toFixed(2), f3 = x => x.toFixed(3), pad = (s, n) => String(s).padStart(n);
function ratio(a) {   // observed / expected with a standard error clustered by game (delta method)
  const R = a.y / a.e;
  return [R, Math.sqrt(Math.max(0, a.yy - 2 * R * a.ye + R * R * a.ee)) / a.e];
}
const phaseName = ['30+', '15-29', '<15'];

function report(D) {
  const rows = D.obs, train = rows.filter(r => !r[1]), test = rows.filter(r => r[1]);
  const nObs = rows.reduce((s, r) => s + r.length - HEAD, 0);
  print(`Games: ${D.games} (${D.oracleGames} with an Oracle seat), ${D.testGames} held out for testing.`);
  print(`Decisions: ${rows.length}; card observations: ${nObs} (train ${train.reduce((s, r) => s + r.length - HEAD, 0)}).`);

  print('\n1. In-hand frequency / uniform base rate, by evidence and cards left in the deck (all games; SE clustered by game)');
  print(`   ${'evidence'.padEnd(16)}` + phaseName.map(p => pad(p, 24)).join(''));
  for (let k = 0; k < KINDS; k++) {
    let line = `   ${EVIDENCE[k].padEnd(16)}`;
    for (let ph = 0; ph < PHASES; ph++) {
      const a = D.cell[k * PHASES + ph], [R, se] = ratio(a);
      line += pad(`${f2(R)} +-${f2(se)} n=${a.n}`, 24);
    }
    print(line);
  }
  print('   Same ratio by who the opponent was (all phases pooled):  Apprentice   |   Oracle');
  for (let k = 0; k < KINDS; k++) print(`   ${EVIDENCE[k].padEnd(16)}` + [0, 1].map(o => {
    const a = D.byOpp[o][k];
    return a.n ? pad(`${f2(a.y / a.e)} n=${a.n}`, 18) : pad('-', 18);
  }).join(''));

  print('\n2. Fitted sampling weights (training games); paste into engine.js');
  const F = fit(train);
  print('const HAND_WEIGHTS = [\n  // 30+   15-29  <15 cards left in the deck');
  for (let k = 0; k < KINDS; k++) print(`  [${[0, 1, 2].map(ph => f2(F[k * PHASES + ph])).join(', ')}],   // ${EVIDENCE[k]}`);
  print('];');

  print('\n3. Held-out games: mean log-loss per card observation (lower is better)');
  const uniform = logLoss(test, new Float64Array(CELLS).fill(1));
  const fitted = logLoss(test, F);
  const engHand = new Float64Array(CELLS);
  for (let k = 0; k < KINDS; k++) for (let ph = 0; ph < PHASES; ph++) engHand[k * PHASES + ph] = HAND_WEIGHTS[k][ph];
  const engine = logLoss(test, engHand);
  for (const [name, L] of [['uniform dealing', uniform], ['fitted table', fitted], ['table in engine.js', engine]]) {
    const gains = [];
    for (const [game, ll] of uniform.perGame) gains.push(ll - L.perGame.get(game));
    const m = gains.reduce((a, b) => a + b, 0) / gains.length;
    const se = Math.sqrt(gains.reduce((a, b) => a + (b - m) * (b - m), 0) / (gains.length - 1) / gains.length);
    print(`   ${name.padEnd(20)} ${f3(L.perObs)}   improvement over uniform: ${f2(m)} +- ${f2(se)} nats per game (${gains.length} games)`);
  }
  print('   The engine\'s determinize(), 8 deals per held-out decision: share of cards dealt to the opponent vs truth');
  for (let k = 0; k < KINDS; k++) {
    const c = D.check[k];
    if (c.n) print(`   ${EVIDENCE[k].padEnd(16)} dealt ${f3(c.dealt / c.n)}  truly in hand ${f3(c.y / c.n)} +-${f3(Math.sqrt(c.y / c.n * (1 - c.y / c.n) / c.n))}  (n=${c.n})`);
  }

  print('\n4. Discards: share the opponent took from the pile and ended the round with on a line');
  const G = Object.entries(D.gifts).map(([k, v]) => { const p = k.split(','); return { cat: p[0], v: +p[1], dk: +p[2], mine: +p[3], rule: +p[4], who: p[5], n: v[0], taken: v[1], played: v[2] }; });
  const rate = (list, label) => {
    const n = list.reduce((s, x) => s + x.n, 0), pl = list.reduce((s, x) => s + x.played, 0), tk = list.reduce((s, x) => s + x.taken, 0);
    if (!n) return;
    const p = pl / n;
    print(`   ${label.padEnd(58)} ${f3(p)} +-${f3(Math.sqrt(p * (1 - p) / n))}  (taken ${f3(tk / n)}, n=${n})`);
  };
  for (const who of ['apprentice', 'oracle']) {
    const W = G.filter(x => x.who === who);
    if (!W.length) continue;
    print(`   -- opponent is the ${who}`);
    rate(W.filter(x => x.cat === 'feeds'), "fits a line they started ('feeds')");
    rate(W.filter(x => x.cat === 'dead'), 'below their line (can never be used)');
    rate(W.filter(x => x.rule === 2), "unstarted realm, the 'could-start' rule");
    rate(W.filter(x => x.cat === 'unstarted' && x.rule !== 2), 'unstarted realm, every other discard');
    const dkName = ['<8', '8-15', '16-29', '30+'];
    for (const mine of [0, 1]) {
      print(`   unstarted for them, ${mine ? '' : 'not '}started by the discarder: taken and played, by value and cards left`);
      print(`     ${'value'.padEnd(8)}` + dkName.map(d => pad(d, 20)).join(''));
      for (const [lo, hi, name] of [[0, 0, 'Pact'], [2, 2, '2'], [3, 3, '3'], [4, 6, '4-6'], [7, 9, '7-9'], [10, 10, '10']]) {
        print(`     ${name.padEnd(8)}` + [0, 1, 2, 3].map(dk => {
          const L = W.filter(x => x.cat === 'unstarted' && x.mine === mine && x.dk === dk && x.v >= lo && x.v <= hi);
          const n = L.reduce((s, x) => s + x.n, 0), pl = L.reduce((s, x) => s + x.played, 0);
          return pad(n ? `${f3(pl / n)} n=${n}` : '-', 20);
        }).join(''));
      }
    }
  }
}

// ---- main ----
if (args.merge) {
  const D = newData();
  for (const f of args.merge.split(',')) {
    const P = JSON.parse(readFile(f));
    D.games += P.games; D.oracleGames += P.oracleGames; D.testGames += P.testGames;
    for (const r of P.obs) D.obs.push(r);
    for (const key of ['cell', 'check']) P[key].forEach((a, i) => { for (const f2 in a) D[key][i][f2] += a[f2]; });
    P.byOpp.forEach((row, o) => row.forEach((a, k) => { for (const f2 in a) D.byOpp[o][k][f2] += a[f2]; }));
    for (const k in P.gifts) { const g = D.gifts[k] || (D.gifts[k] = [0, 0, 0]); P.gifts[k].forEach((x, i) => { g[i] += x; }); }
  }
  report(D);
} else {
  const t0 = Date.now(), D = play();
  if (args.out) { writeFile(args.out, JSON.stringify(D)); print(`saved ${D.games} games to ${args.out} in ${(Date.now() - t0) / 1000} s`); }
  else report(D);
}
