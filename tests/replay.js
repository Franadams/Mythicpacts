/* Replay recorded games against the Oracle and measure its decisions.

   Recorded games come from the published page (the page saves each finished round to its own storage)
   or from a browser's localStorage. Put them in a JSON file as an array of records, then run:

     JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
     $JSC src/engine.js tests/replay.js -- games=path/to/games.json
     $JSC src/engine.js tests/replay.js -- games=games.json candidate=path/to/other_engine.js
     $JSC src/engine.js tests/replay.js -- games=games.json json=decisions.json   (every decision, for analysis)

   For every Oracle decision (play or discard) it:
   - checks the replay matches the recording exactly;
   - scores each legal move with hindsight of the opponent's real hand (the deck order is reshuffled, so
     it does not know the future): the average final lead over `samples` simulated endings;
   - reports the regret of the Oracle's move: how many points worse it was than the best move by that
     hindsight score, as a range. The low end is cross-fitted (the best move is picked on one half of the
     simulated endings and measured on the other, both ways round), which errs low; the high end takes
     the best average directly, which errs high because the luckiest move looks best. Individual
     decisions are noisy: use 2,400+ samples before reading much into one.
   Caveats: the hindsight score plays the future out with the same rules of thumb the Oracle searches
   with, so mistakes rooted in those rules look like good play, and costs that only arrive later (too
   many lines open, say) are hard for it to see. Compare engine versions with whole-game benchmarks too. With candidate=FILE it also reports the regret of what that engine would have chosen
     in the same position (using only fair information), so engines can be compared on your own games.
   This uses the opponent's hidden cards, so it is a way to measure decisions after the fact, never a
   way to make them. */

const args = {};
for (const a of (typeof arguments !== 'undefined' ? arguments : [])) {
  const i = a.indexOf('=');
  if (i > 0) args[a.slice(0, i)] = a.slice(i + 1);
}
const records = JSON.parse(readFile(args.games));
const SAMPLES = +(args.samples || 300), ADVICE = +(args.advice || 80);
const name = c => ['Fairy', 'Siren', 'Dryad', 'Angel', 'Nymph'][realmOf(c)] + ' ' + (valueOf(c) || 'Pact');
const moveName = m => (m.type === 'play' ? 'play ' : 'discard ') + name(m.card);

let candidate = null;
if (args.candidate) candidate = new Function(readFile(args.candidate) + '\nreturn { analyze };')();

function startState(rec) {
  return {
    hands: [rec.hands[0].slice(), rec.hands[1].slice()], exp: [emptyRows(), emptyRows()], discard: emptyRows(),
    deck: rec.deck.slice(), turn: rec.first, phase: 'play', lastDiscard: -1, known: [[], []], over: false,
  };
}

// Average final lead for player p after each legal move, knowing the opponent's real hand. Two
// independent halves of the simulated endings: `pick` chooses the best move and `score` measures it,
// so the lucky noise that makes some move look best does not also inflate how much better it looks.
function hindsight(st, p, seed) {
  const opts = legalMoves(st), totals = opts.map(() => [0, 0]);
  const rnd = makeRng(seed);
  for (let i = 0; i < SAMPLES; i++) {
    const world = cloneState(st);
    shuffle(world.deck, rnd);
    const rs = (rnd() * 4294967296) >>> 0;
    opts.forEach((o, j) => {
      const s = cloneState(world);
      applyMove(s, o);
      rollout(s, makeRng(rs), ROLLOUT_NOISE);
      totals[j][i % 2] += playerTotal(s, p) - playerTotal(s, p ^ 1);
    });
  }
  const nA = Math.ceil(SAMPLES / 2), nB = Math.floor(SAMPLES / 2);   // worlds 0, 2, 4... and 1, 3, 5...
  return opts.map((o, j) => Object.assign({}, o, { a: totals[j][0] / nA, b: totals[j][1] / nB }));
}

function choose(E, st, p, seed) {
  const g = E.analyze(cloneState(st), p, ADVICE, seed);
  let x;
  while (!(x = g.next()).done);
  return x.value.best;
}

const same = (a, b) => a.type === b.type && realmOf(a.card) === realmOf(b.card) && valueOf(a.card) === valueOf(b.card);
let decisions = 0, regretOracle = 0, upperOracle = 0, regretCandidate = 0, rounds = 0, humanLead = 0;
const worst = [];
for (const rec of records) {
  if (!rec || rec.skill !== 'oracle' || !Array.isArray(rec.moves)) continue;
  const st = startState(rec), oracleSeat = rec.humanSeat ^ 1;
  rounds++;
  for (const mv of rec.moves) {
    const [p, kind] = mv;
    if (kind === 'r') {
      const card = applyDraw(st, mv[2]);
      if (card !== mv[3]) throw new Error(`replay mismatch in ${rec.id}: drew ${card}, recorded ${mv[3]}`);
      continue;
    }
    const move = { type: kind === 'p' ? 'play' : 'discard', card: mv[2] };
    if (p === oracleSeat) {
      decisions++;
      const scored = hindsight(st, p, decisions * 7919);
      // Cross-fitted regret: choose the best move on one half and measure it on the other, both ways round.
      // This errs low (the half-picked move is sometimes not the true best); the plain max of the means errs high.
      const bestA = scored.reduce((x, y) => (y.a > x.a ? y : x)), bestB = scored.reduce((x, y) => (y.b > x.b ? y : x));
      const regretOf = c => ((bestA.b - c.b) + (bestB.a - c.a)) / 2;
      const upperOf = c => Math.max(...scored.map(o => (o.a + o.b) / 2)) - (c.a + c.b) / 2;
      const best = bestA, chosen = scored.find(o => same(o, move));
      const r1 = regretOf(chosen);
      upperOracle += upperOf(chosen);
      regretOracle += r1;
      if (candidate) {
        const c = choose(candidate, st, p, decisions * 104729);
        regretCandidate += regretOf(scored.find(o => same(o, c)));
      }
      const r = realmOf(move.card), mine = st.exp[p];
      worst.push({ game: rec.id, deck: st.deck.length, chose: moveName(move), better: moveName(best), cost: r1,
        type: move.type, value: valueOf(move.card), opening: move.type === 'play' && !mine[r].length,
        linesOpen: mine.filter(l => l.length).length, contested: st.exp[p ^ 1][r].length,
        jump: move.type === 'play' && valueOf(move.card) ? valueOf(move.card) - Math.max(topValue(mine[r]), 1) - 1 : 0,
      });
    }
    applyMove(st, move);
  }
  if (Array.isArray(rec.scores)) {
    if (playerTotal(st, 0) !== rec.scores[0] || playerTotal(st, 1) !== rec.scores[1]) throw new Error(`score mismatch in ${rec.id}`);
    humanLead += rec.scores[rec.humanSeat] - rec.scores[oracleSeat];
  }
}

if (args.json) writeFile(args.json, JSON.stringify(worst));
print(`${rounds} recorded rounds against the Oracle; average margin for the human ${(humanLead / Math.max(1, rounds)).toFixed(1)}`);
print(`${decisions} Oracle decisions, each scored with ${SAMPLES} simulated endings knowing the opponent's hand`);
print(`  points lost per decision by the Oracle that played: between ${(regretOracle / Math.max(1, decisions)).toFixed(2)} (cross-fitted, errs low) and ${(upperOracle / Math.max(1, decisions)).toFixed(2)} (plain maximum, errs high)`);
if (candidate) print(`  average points lost per decision by ${args.candidate.split('/').pop()}: ${(regretCandidate / Math.max(1, decisions)).toFixed(2)}`);
print('  costliest Oracle decisions:');
for (const w of worst.sort((a, b) => b.cost - a.cost).slice(0, 8)) print(`    ${w.game} (deck ${w.deck}): chose ${w.chose}, hindsight prefers ${w.better}, about ${w.cost.toFixed(1)} points`);
