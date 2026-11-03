/* Benchmarks for the move advice in src/engine.js. They take minutes, so they are
   not part of tests/run.sh (the file name has no .test.js on purpose).

   Run from the project folder (JSC is macOS's built-in JavaScriptCore):
     JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
     $JSC src/engine.js tests/benchmark.js -- task=strength a=oracle b=apprentice games=400
     $JSC src/engine.js tests/benchmark.js -- task=strength a=oracle b=old:oracle old=path/to/engine.js games=400
     $JSC src/engine.js tests/benchmark.js -- task=gifts positions=2000 old=path/to/engine.js
     $JSC src/engine.js tests/benchmark.js -- task=timing
     $JSC src/engine.js nn/net.js tests/benchmark.js -- task=strength a=seer b=oracle seer=nn/weights.json
   Options:
     seed=N        first deal (runs with different seeds are independent)
     from=N        task=gifts: start at position N of that seed's sequence, so one run can be split in parts
     samples=N     simulations per Oracle decision (default 80) or per gift position (default 200)
     old=FILE      a second engine to compare against, for example a saved copy of an older version;
                   policies from it are written old:oracle and old:apprentice
     json=FILE     also save the raw per-game or per-position results
     merge=F1,F2   combine saved results from parallel runs instead of playing (they must be the same
                   task and players, and no deal may appear twice)
   With nn/net.js loaded too, the neural-network players: net (net=FILE, chooses each move with the
   network alone), net2 (the same with net2=FILE), and seer and seer2 (seer=FILE / seer2=FILE: the
   Oracle's search with the network judging each simulated future after depth=N decisions, default 8;
   advice=net or advice=heuristic adds the Oracle's decision rule, anchored on the network's or the rules
   of thumb's move; seersamples=N gives the Seer its own number of simulated deals, so it can face an
   Oracle with more, say; seerdeny=1 lets the players in the Seer's simulated futures pick up a card just
   to keep it from the other player, as they did up to engine seer-v5-2026-11-03-keepown).

   task=strength plays duplicate pairs: each deal is played twice with the seats swapped, so
   the luck of the deal cancels out. Standard errors are computed over pairs.
   task=gifts takes one play-phase position from each of many self-play games (Apprentice with
   a little noise on both sides), runs the advice of both engines on it with the same seed, and
   counts how often the recommended move is a discard that giftRisk() flags. */

const args = {};
for (const a of (typeof arguments !== 'undefined' ? arguments : [])) {
  const i = a.indexOf('=');
  if (i > 0) args[a.slice(0, i)] = a.slice(i + 1);
}
const TASK = args.task || 'strength';

// The engine loaded on the command line, plus an optional second one read from a file.
const engines = {
  new: { analyze, heuristicMove, heuristicDraw },
};
if (args.old) {
  const src = readFile(args.old);
  engines.old = new Function(src + '\nreturn { analyze, heuristicMove, heuristicDraw };')();
}

function runAnalysis(E, st, samples, seed) {
  const g = E.analyze(st, st.turn, samples, seed);
  let x;
  while (!(x = g.next()).done);
  return x.value;
}

// "oracle", "apprentice", "old:oracle", "old:apprentice", and with nn/net.js loaded "net" / "net2"
function policy(spec, samples) {
  const [eng, kind] = spec.indexOf(':') > 0 ? spec.split(':') : ['new', spec];
  const E = engines[eng];
  if (!E) throw new Error(`Unknown engine in ${spec}: pass old=FILE`);
  if (kind === 'apprentice') return { move: st => E.heuristicMove(st, null, 0), draw: st => E.heuristicDraw(st, null, 0) };
  if (kind === 'oracle') return {
    move: (st, rnd) => { const b = runAnalysis(E, st, samples, (rnd() * 4294967296) >>> 0).best; return { type: b.type, card: b.card }; },
    draw: (st, rnd) => runAnalysis(E, st, samples, (rnd() * 4294967296) >>> 0).best.src,
  };
  // The neural-network player (nn/net.js loaded too): net uses net=FILE, net2 uses net2=FILE.
  if (kind === 'net' || kind === 'net2') {
    if (typeof netMove !== 'function' || !args[kind]) throw new Error(`${kind} needs nn/net.js loaded and ${kind}=FILE`);
    const W = netFromJSON(JSON.parse(readFile(args[kind])));
    return { move: st => netMove(W, st), draw: st => netDraw(W, st) };
  }
  if (kind === 'seer' || kind === 'seer2') {
    if (typeof netSearch !== 'function' || !args[kind]) throw new Error(`${kind} needs nn/net.js loaded and ${kind}=FILE`);
    const W = netFromJSON(JSON.parse(readFile(args[kind]))), depth = +(args.depth || 8);
    const n = +(args.seersamples || samples);
    const deny = args.seerdeny === undefined ? undefined : args.seerdeny === '1';
    const pick = (st, rnd) => netSearch(W, st, n, (rnd() * 4294967296) >>> 0, depth, { advice: args.advice, deny });
    return { move: (st, rnd) => { const b = pick(st, rnd); return { type: b.type, card: b.card }; }, draw: (st, rnd) => pick(st, rnd).src };
  }
  throw new Error(`Unknown policy ${spec}`);
}

// What else decides how the players play: weight files (by content, since training rewrites them in place),
// the Seer's depth and decision rule, and the old engine. Saved with the results so merge= can check it.
function contentHash(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
function playerConfig() {
  const c = {};
  for (const k of ['net', 'net2', 'seer', 'seer2']) if (args[k]) c[k] = `${args[k]}#${contentHash(readFile(args[k]))}`;
  // seerdeny is always recorded, so results from before it existed (when the Seer's futures always denied) won't merge with newer ones.
  if (c.seer || c.seer2) { c.depth = +(args.depth || 8); c.advice = args.advice || null; c.seersamples = +(args.seersamples || 0) || null; c.seerdeny = args.seerdeny === '1'; }
  if (args.old) c.old = `${args.old}#${contentHash(readFile(args.old))}`;
  return c;
}

function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function se(a) {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1) / a.length);
}
const f1 = x => x.toFixed(1), f3 = x => x.toFixed(3);

// ---- strength: duplicate pairs ----
// Two deterministic players (networks, say) can trade the same cards between the discard piles forever, so a
// game that runs past 500 decisions (a real round takes 90-250) ends there and is scored as it stands (the
// lines can't change inside such a loop), and the report says how many did.
function playGame(players, first, dealSeed) {
  const st = newRound(first, makeRng(dealSeed));
  const rnd = makeRng((dealSeed ^ 0x5bd1e995) >>> 0);   // seeds for the players' own simulations
  for (let steps = 0; !st.over && steps < 500; steps++) {
    const pl = players[st.turn];
    if (st.phase === 'play') applyMove(st, pl.move(st, rnd));
    else applyDraw(st, pl.draw(st, rnd));
  }
  return [playerTotal(st, 0), playerTotal(st, 1), !st.over];
}

function strength() {
  const samples = +(args.samples || 80), pairs = Math.ceil(+(args.games || 400) / 2), seed0 = +(args.seed || 1);
  const A = policy(args.a || 'oracle', samples), B = policy(args.b || 'apprentice', samples);
  const rows = [];
  const t0 = Date.now();
  for (let i = 0; i < pairs; i++) {
    const dealSeed = (seed0 * 1000003 + i) >>> 0, first = i % 2;
    const g1 = playGame([A, B], first, dealSeed);   // A in seat 0
    const g2 = playGame([B, A], first, dealSeed);   // same deal, A in seat 1
    rows.push({ deal: dealSeed, a: [g1[0], g2[1]], b: [g1[1], g2[0]], capped: [g1[2], g2[2]] });
  }
  return { task: 'strength', a: args.a || 'oracle', b: args.b || 'apprentice', samples, config: playerConfig(), rows, seconds: (Date.now() - t0) / 1000 };
}

function reportStrength(res) {
  const rows = res.rows;
  const winPts = (x, y) => x > y ? 1 : x === y ? 0.5 : 0;
  const pairWin = rows.map(r => (winPts(r.a[0], r.b[0]) + winPts(r.a[1], r.b[1])) / 2);
  const pairMargin = rows.map(r => (r.a[0] - r.b[0] + r.a[1] - r.b[1]) / 2);
  let wins = 0, ties = 0;
  for (const r of rows) for (const k of [0, 1]) { if (r.a[k] > r.b[k]) wins++; else if (r.a[k] === r.b[k]) ties++; }
  const games = rows.length * 2;
  print(`${res.a} vs ${res.b}: ${games} games (${rows.length} duplicate pairs), ${res.samples} samples per Oracle decision`);
  print(`  ${res.a} won ${wins}, tied ${ties}, lost ${games - wins - ties}: win share ${f3(mean(pairWin))} +- ${f3(se(pairWin))} (ties count half)`);
  print(`  average score ${f1(mean(rows.flatMap(r => r.a)))} to ${f1(mean(rows.flatMap(r => r.b)))}; margin ${f1(mean(pairMargin))} +- ${f1(se(pairMargin))} per game`);
  const capped = rows.filter(r => r.capped && (r.capped[0] || r.capped[1]));
  if (capped.length) {
    const rest = rows.filter(r => capped.indexOf(r) < 0).map(r => (r.a[0] - r.b[0] + r.a[1] - r.b[1]) / 2);
    print(`  ${capped.length} pairs had a game stopped at 500 decisions and scored as it stood; without them the margin is ${rest.length > 1 ? `${f1(mean(rest))} +- ${f1(se(rest))}` : 'unknown'}`);
  }
}

// ---- gifts: how often the advice hands the opponent a usable card ----
function gifts() {
  const samples = +(args.samples || 200), n = +(args.positions || 2000), seed0 = +(args.seed || 1), from = +(args.from || 0);
  const rows = [];
  const t0 = Date.now();
  for (let i = from; i < from + n; i++) {
    const dealSeed = (seed0 * 1000003 + i) >>> 0, rnd = makeRng(dealSeed);
    const st = newRound(i % 2, rnd);
    // Play a random number of turns with a slightly noisy Apprentice on both sides, then stop at a play decision.
    const stopAt = (rnd() * 40) | 0;
    let turns = 0;
    while (!st.over && !(st.phase === 'play' && turns >= stopAt)) {
      if (st.phase === 'play') { applyMove(st, heuristicMove(st, rnd, 1)); turns++; }
      else applyDraw(st, heuristicDraw(st, rnd, 1));
    }
    if (st.over) continue;
    const row = { deal: dealSeed, deck: st.deck.length };
    const p = st.turn, aSeed = (rnd() * 4294967296) >>> 0;
    const kind = m => m.type === 'discard' ? (giftRisk(st, p, m.card) || { kind: '' }).kind : '';
    for (const name of Object.keys(engines)) {
      const E = engines[name];
      const res = runAnalysis(E, cloneState(st), samples, aSeed);
      row[name] = kind(res.best);
      row[name + 'Move'] = res.best.type[0] + res.best.card;
      row[name + 'Rule'] = kind(E.heuristicMove(st, null, 0));
      row[name + 'Reason'] = res.avoidedReason || (res.anchored ? 'noise' : '');
    }
    rows.push(row);
  }
  return { task: 'gifts', samples, engines: Object.keys(engines), config: playerConfig(), rows, seconds: (Date.now() - t0) / 1000 };
}

function reportGifts(res) {
  const rows = res.rows;
  print(`Gift rate of the recommended move over ${rows.length} positions (${res.samples} samples each); SE = binomial`);
  const frac = (key, kind) => { const x = rows.map(r => r[key] === kind ? 1 : 0); return [mean(x), se(x), x]; };
  for (const kind of ['feeds', 'could-start']) {
    for (const name of res.engines) for (const key of [name, name + 'Rule']) {
      const [m, s] = frac(key, kind);
      print(`  ${kind.padEnd(12)} ${(key === name ? name + ' advice' : name + ' rules of thumb').padEnd(24)} ${f3(m)} +- ${f3(s)}`);
    }
    if (res.engines.length > 1) {
      const d = rows.map(r => (r.new === kind ? 1 : 0) - (r.old === kind ? 1 : 0));
      print(`  ${kind.padEnd(12)} ${'new - old advice'.padEnd(24)} ${f3(mean(d))} +- ${f3(se(d))} (paired)`);
    }
  }
  const avoided = rows.filter(r => r.newReason === 'gift').length;
  print(`  new advice passed over a higher-scoring gift in ${avoided} positions (${f3(avoided / rows.length)})`);
}

// ---- timing: analyze(st, p, 200) at the start of a round ----
function timing() {
  const samples = +(args.samples || 200), reps = +(args.reps || 20);
  for (const name of Object.keys(engines)) {
    const times = [];
    for (let k = 0; k < reps + 3; k++) {
      const st = newRound(0, makeRng(100 + k));
      const t0 = preciseTime();
      runAnalysis(engines[name], st, samples, k);
      if (k >= 3) times.push((preciseTime() - t0) * 1000);   // the first runs warm up the JIT
    }
    times.sort((a, b) => a - b);
    print(`${name}: analyze(${samples} samples) at round start: median ${f1(times[times.length >> 1])} ms, min ${f1(times[0])}, max ${f1(times[times.length - 1])} (${reps} runs)`);
  }
}

if (args.merge) {
  const files = args.merge.split(','), parts = files.map(f => JSON.parse(readFile(f))), deals = new Set();
  parts.forEach((p, i) => {
    for (const k of ['task', 'a', 'b', 'samples', 'config', 'engines']) {
      const x = JSON.stringify(p[k]), y = JSON.stringify(parts[0][k]);
      if (x !== y) throw new Error(`${files[i]} has ${k}=${x}, not ${y} like ${files[0]}`);
    }
    for (const r of p.rows) {
      if (deals.has(r.deal)) throw new Error(`deal ${r.deal} appears twice (again in ${files[i]}): were two runs given the same seed?`);
      deals.add(r.deal);
    }
  });
  const res = Object.assign({}, parts[0], { rows: parts.flatMap(p => p.rows), seconds: parts.reduce((s, p) => s + p.seconds, 0) });
  if (res.task === 'strength') reportStrength(res); else reportGifts(res);
} else if (TASK === 'timing') timing();
else {
  const res = TASK === 'gifts' ? gifts() : strength();
  if (args.json) writeFile(args.json, JSON.stringify(res));
  if (TASK === 'gifts') reportGifts(res); else reportStrength(res);
  print(`  (${f1(res.seconds)} s)`);
}
