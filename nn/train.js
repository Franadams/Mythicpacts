/* Train the network on stored self-play positions (nn/selfplay.js).

   Run from the project folder:
     $JSC src/engine.js nn/net.js nn/train.js -- data=nn/data/a.bin,nn/data/b.bin out=nn/weights.json epochs=8
   Options: init=FILE (start from earlier weights), lr=0.001 (falls smoothly to a twentieth by the end),
   batch=256, val=0.05 (share of games held out to check the network on positions it never trained on),
   seed=1, hidden=64,32,64 (layer sizes for a new network), q=W (weight of the Oracle's estimates, below;
   default 1), qkeep=K (use a random share K of those estimates each epoch, to save time), debias=0 (keep
   the Oracle's estimates as they are).

   Every position is used from both players' sides; the target is that player's final lead. The loss is the
   squared error, so the network learns the expected lead. Games are split into training and held-out games
   whole (picked by a hash of the deal, so the choice doesn't depend on file order or on who sat where), so
   the check is fair. The epoch that does best on the held-out games is the one saved.
   Every play or discard an Oracle considered (FILE.q next to each data file) adds an example: the position
   after that move, from the mover's side, with the Oracle's average lead after it as the target. One game's
   final lead is noisy (about 30 points either way) and only says how the move actually played turned out;
   the Oracle's estimates are far less noisy and cover the moves nobody played. Without them (q=0) the
   network learns that starting a line goes with winning, because good players only start good lines, and
   plays badly. The estimates run optimistic, though: the opponents the Oracle imagines hold weaker hands
   than real opponents keep, by up to 12 points mid-round. So the average gap between the estimate for the
   move actually played and how the game really ended is measured for each number of cards left (training
   games only, pooled with the neighbouring counts) and taken off every estimate made with that many cards
   left. With one card left the estimate is replaced by the exact answer, the lead after the move: the
   network's players always take the last card then (see netDraw), and against an opponent who would end
   the round anyway taking a pile can't do better. */

const args = {};
for (const a of (typeof arguments !== 'undefined' ? arguments : [])) {
  const i = a.indexOf('=');
  if (i > 0) args[a.slice(0, i)] = a.slice(i + 1);
}
const EPOCHS = +(args.epochs || 8), LR = +(args.lr || 0.001), BATCH = +(args.batch || 256), SEED = +(args.seed || 1);
const QW = args.q === undefined ? 1 : +args.q, QKEEP = +(args.qkeep || 1), DEBIAS = args.debias !== '0';
const R = NET.RECORD;

// ---- data ----
const files = args.data.split(',');
const parts = files.map(f => readFile(f, 'binary'));
const total = parts.reduce((s, b) => s + b.length, 0);
const buf = new Uint8Array(total);
{ let off = 0; for (const b of parts) { buf.set(b, off); off += b.length; } }
const N = total / R;
const valEvery = Math.max(2, Math.round(1 / +(args.val || 0.05)));
// A well-mixed hash of a game's first position (its deal and who starts), to pick held-out games.
function dealHash(at) {
  let h = 2166136261;
  for (let b = 0; b < 62; b++) h = Math.imul(h ^ (b === 61 ? buf[at + b] & 31 : buf[at + b]), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
let game = -1, held = 0;
const trainIdx = [], valIdx = [], heldOut = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  if (buf[i * R + 61] & 32) { game++; held = (dealHash(i * R) >>> 8) % valEvery === 0 ? 1 : 0; }
  heldOut[i] = held;
  (heldOut[i] ? valIdx : trainIdx).push(i * 2, i * 2 + 1);   // the position from player 0's side, and from player 1's
}
print(`${N} positions from ${game + 1} games: ${trainIdx.length} training examples, ${valIdx.length} held out`);

// The Oracle's estimates for plays and discards (draws are left out: after a draw from a pile the stored
// position can't say which buried card comes up next). Example number 2N + k is estimate k.
let qRec = new Int32Array(0), qCode = new Uint8Array(0), qVal = new Float32Array(0);
const qTrain = [], qHeld = [];
if (QW > 0) {
  const recs = [], codes = [], vals = [];
  let base = 0;
  files.forEach((name, fi) => {
    let qb = null;
    try { qb = readFile(name + '.q', 'binary'); } catch (e) { /* no estimates for this file */ }
    if (qb) {
      for (let at = 0; at + 8 <= qb.length; at += 8) {
        const code = qb[at + 4] | (qb[at + 5] << 8);
        if (code >= 120) continue;
        const rec = base + (qb[at] | (qb[at + 1] << 8) | (qb[at + 2] << 16) | (qb[at + 3] << 24));
        let v = qb[at + 6] | (qb[at + 7] << 8);
        if (v >= 32768) v -= 65536;
        recs.push(rec); codes.push(code); vals.push(v / 10);
      }
    }
    base += parts[fi].length / R;
  });
  qRec = Int32Array.from(recs); qCode = Uint8Array.from(codes); qVal = Float32Array.from(vals);
  if (DEBIAS) {
    // The estimate for the move actually played is the one whose position after it is the next stored
    // position; compare it with how that game really ended, from the mover's side.
    const tmp = new Uint8Array(R), sum = new Float64Array(46), cnt = new Float64Array(46);
    const stage = k => buf[qRec[k] * R + 60];
    for (let k = 0; k < qRec.length; k++) {
      const i = qRec[k], at = i * R, next = at + R;
      if (heldOut[i] || buf[at + 60] === 1 || i + 1 >= N || (buf[next + 61] & 32)) continue;
      recordAfterMove(buf, at, qCode[k], tmp);
      let same = (tmp[61] & 31) === (buf[next + 61] & 31);
      for (let b = 0; same && b < 61; b++) if (tmp[b] !== buf[next + b]) same = false;
      if (!same) continue;
      const l0 = recordLead(buf, at);
      sum[stage(k)] += qVal[k] - (buf[at + 61] & 1 ? -l0 : l0); cnt[stage(k)]++;
    }
    // Each count of cards left, pooled with its neighbours (one card left is answered exactly instead).
    const off = new Float64Array(46);
    for (let d = 2; d <= 44; d++) {
      let x = 0, c = 0;
      for (let e = Math.max(2, d - 1); e <= Math.min(44, d + 1); e++) { x += sum[e]; c += cnt[e]; }
      off[d] = c ? x / c : 0;
    }
    for (let k = 0; k < qRec.length; k++) qVal[k] -= off[stage(k)];
    print(`the Oracle's estimates ran optimistic by ${[2, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44].map(d => `${off[d].toFixed(1)} (${d} left)`).join(', ')} points; taken off`);
  }
  for (let k = 0; k < qRec.length; k++) (heldOut[qRec[k]] ? qHeld : qTrain).push(2 * N + k);
  print(`${qRec.length} Oracle estimates for plays and discards: ${qTrain.length} training, ${qHeld.length} held out (weight ${QW}${QKEEP < 1 ? `, ${QKEEP} of them each epoch` : ''})`);
}

// ---- network and optimiser ----
let net;
if (args.init) net = netFromJSON(JSON.parse(readFile(args.init)));
else { const h = (args.hidden || '64,32,64').split(',').map(Number); net = newNet(SEED, h[0], h[1], h[2]); }
const grad = {}, m1 = {}, m2 = {};
for (const k of NET_PARAMS) { grad[k] = new Float32Array(net[k].length); m1[k] = new Float32Array(net[k].length); m2[k] = new Float32Array(net[k].length); }
let step = 0;
function adam(lr) {
  step++;
  const b1 = 0.9, b2 = 0.999, eps = 1e-8, c1 = 1 - Math.pow(b1, step), c2 = 1 - Math.pow(b2, step);
  for (const k of NET_PARAMS) {
    const w = net[k], g = grad[k], a = m1[k], v = m2[k];
    for (let i = 0; i < w.length; i++) {
      const gi = g[i] / BATCH;
      a[i] = b1 * a[i] + (1 - b1) * gi;
      v[i] = b2 * v[i] + (1 - b2) * gi * gi;
      w[i] -= lr * (a[i] / c1) / (Math.sqrt(v[i] / c2) + eps);
      g[i] = 0;
    }
  }
}

const f = newFeatures(), acts = newActs(net), back = newBackScratch(net), D = NET.DENSE;

const after = new Uint8Array(R);
function example(e) {
  if (e >= 2 * N) {   // an Oracle estimate: the position after the move, from the mover's side
    const k = e - 2 * N, at = qRec[k] * R;
    recordAfterMove(buf, at, qCode[k], after);
    featurize(after, 0, buf[at + 61] & 1, f);
    if (buf[at + 60] === 1) {   // one card left: the mover takes it, so the lead after this move is final
      let now = 0;
      for (let r = 0; r < 5; r++) now += f.dense[r * D + 5] - f.dense[r * D + 12];
      return now * 60 / NET.SCALE;
    }
    return qVal[k] / NET.SCALE;
  }
  const i = e >> 1, p = e & 1;
  featurize(buf, i * R, p, f);
  const lead0 = recordLead(buf, i * R);
  return (p ? -lead0 : lead0) / NET.SCALE;
}

// Squared error of one example; adds its (weighted) gradient into grad.
function trainOne(e) {
  const t = example(e), dy = netForward(net, f, acts) - t;
  netBackward(net, f, acts, e >= 2 * N ? QW * dy : dy, grad, back);
  return dy * dy;
}

// Root-mean-square error in points on a list of examples, and the same for two simple guesses: a lead of
// zero, and the current difference in line scores.
function check(list) {
  let se = 0, se0 = 0, seNow = 0;
  for (const e of list) {
    const t = example(e), y = netForward(net, f, acts);
    se += (y - t) * (y - t); se0 += t * t;
    let now = 0;
    for (let r = 0; r < 5; r++) now += (f.dense[r * D + 5] - f.dense[r * D + 12]) * 60;
    const dn = now / NET.SCALE - t;
    seNow += dn * dn;
  }
  const k = NET.SCALE / Math.sqrt(list.length);
  return { rmse: Math.sqrt(se) * k, zero: Math.sqrt(se0) * k, now: Math.sqrt(seNow) * k };
}

// Root-mean-square error in points against the Oracle's estimates (a sample of the held-out ones).
const qCheckList = qHeld.filter((_, k) => k % Math.max(1, Math.floor(qHeld.length / 100000)) === 0);
function checkQ() {
  let se = 0;
  for (const e of qCheckList) { const t = example(e), y = netForward(net, f, acts); se += (y - t) * (y - t); }
  return qCheckList.length ? Math.sqrt(se / qCheckList.length) * NET.SCALE : 0;
}

// The held-out version of what training minimises: final-lead error and, weighted as in training, the error
// against the Oracle's estimates (in points, root mean square). The best epoch by this is the one saved.
function heldOutLoss(lead, q) {
  const nQ = QW > 0 ? QKEEP * qHeld.length : 0;
  return Math.sqrt((lead * lead * valIdx.length + QW * nQ * q * q) / (valIdx.length + QW * nQ));
}

const rnd = makeRng(SEED * 7919);
let best = null;
const before = check(valIdx);
print(`held-out error before training: ${before.rmse.toFixed(1)} points (guessing a lead of 0: ${before.zero.toFixed(1)}; guessing today's score difference: ${before.now.toFixed(1)})`);
for (let ep = 0; ep < EPOCHS; ep++) {
  const t0 = Date.now();
  const list = trainIdx.slice();
  for (const e of qTrain) if (QKEEP >= 1 || rnd() < QKEEP) list.push(e);
  const order = Int32Array.from(list);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), x = order[i]; order[i] = order[j]; order[j] = x; }
  let se = 0, seQ = 0, nQ = 0, inBatch = 0;
  for (let b = 0; b < order.length; b++) {
    const progress = (ep + b / order.length) / EPOCHS, e2 = trainOne(order[b]);
    if (order[b] >= 2 * N) { seQ += e2; nQ++; } else se += e2;
    if (++inBatch === BATCH) { adam(LR * (0.05 + 0.95 * 0.5 * (1 + Math.cos(Math.PI * progress)))); inBatch = 0; }
  }
  if (inBatch) for (const k of NET_PARAMS) grad[k].fill(0);
  const v = check(valIdx), q = QW > 0 ? checkQ() : 0, loss = heldOutLoss(v.rmse, q), secs = (Date.now() - t0) / 1000;
  const qNote = QW > 0 ? `; against the Oracle's estimates: training ${(Math.sqrt(seQ / Math.max(1, nQ)) * NET.SCALE).toFixed(1)}, held-out ${q.toFixed(1)}` : '';
  const isBest = !best || loss < best.loss;
  if (isBest) best = { loss, lead: v.rmse, q, epoch: ep + 1, w: NET_PARAMS.map(k => Float32Array.from(net[k])) };
  print(`epoch ${ep + 1}/${EPOCHS}: final-lead error training ${(Math.sqrt(se / (order.length - nQ)) * NET.SCALE).toFixed(1)} points, held-out ${v.rmse.toFixed(1)}${qNote}; held-out loss ${loss.toFixed(2)}${isBest ? ' (best so far)' : ''}; ${secs.toFixed(0)} s (${Math.round(order.length / secs)} examples a second)`);
}
if (args.out && best) {
  NET_PARAMS.forEach((k, i) => { net[k] = best.w[i]; });
  writeFile(args.out, JSON.stringify(Object.assign(netToJSON(net), {
    trainedOn: N, oracleWeight: QW, bestEpoch: best.epoch,
    heldOutError: Math.round(best.lead * 10) / 10, heldOutOracleError: Math.round(best.q * 10) / 10,
  })));
  print(`saved ${args.out} (epoch ${best.epoch})`);
}
