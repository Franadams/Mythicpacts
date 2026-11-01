/* =====================================================================
   INTERFACE
   ===================================================================== */
const $ = s => document.querySelector(s);

// Order, colours and symbols follow the artwork's game board.
const REALM_UI = [
  { key: 'fairy', name: 'Fairies', one: 'Fairy', hex: '#de5f8c' },
  { key: 'siren', name: 'Sirens',  one: 'Siren', hex: '#4a6fd6' },
  { key: 'dryad', name: 'Dryads',  one: 'Dryad', hex: '#4f9d45' },
  { key: 'angel', name: 'Angels',  one: 'Angel', hex: '#c99434' },
  { key: 'nymph', name: 'Nymphs',  one: 'Nymph', hex: '#9b72dc' },
];

const SIGIL = {
  fairy: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.2 11.5C10 7.5 7 4 3.8 4.3 1.6 4.5 1.7 7.6 3 9.6c1 1.6 2.7 2.4 4.6 2.6-2 .8-3.5 2.4-3.4 4.4.2 2.6 3 3.2 5 1.4 1.1-1 1.7-2.6 2-4.3z"/><path d="M12.8 11.5C14 7.5 17 4 20.2 4.3c2.2.2 2.1 3.3.8 5.3-1 1.6-2.7 2.4-4.6 2.6 2 .8 3.5 2.4 3.4 4.4-.2 2.6-3 3.2-5 1.4-1.1-1-1.7-2.6-2-4.3z"/><rect x="11.3" y="7" width="1.4" height="12" rx=".7"/></svg>',
  siren: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 9.5c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3"/><path d="M2 16.5c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3"/></svg>',
  dryad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M4 20C4 11 10 4 20 4c0 10-7 16-16 16z" fill="currentColor" fill-opacity=".4"/><path d="M4 20l9-9"/></svg>',
  angel: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5l2.2 7.6 7.8 2.9-7.8 2.9L12 22.5l-2.2-7.6L2 12l7.8-2.9z"/><path d="M18.4 5.6l-3 4.2M5.6 5.6l3 4.2M18.4 18.4l-3-4.2M5.6 18.4l3-4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  nymph: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.5c2.2 2.6 3.1 5.8 2.5 9.6-.4 2.3-1.3 4.1-2.5 5.4-1.2-1.3-2.1-3.1-2.5-5.4-.6-3.8.3-7 2.5-9.6z"/><path d="M2.5 9.5c3.6-.2 6.5 1.8 7.8 5.6.4 1.2.6 2.4.7 3.4-3.3-.3-6-1.8-7.4-4.4-.8-1.4-1.1-3-1.1-4.6zM21.5 9.5c-3.6-.2-6.5 1.8-7.8 5.6-.4 1.2-.6 2.4-.7 3.4 3.3-.3 6-1.8 7.4-4.4.8-1.4 1.1-3 1.1-4.6z" fill-opacity=".75"/><path d="M4 20.5h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  pact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="8.5" cy="12" r="5.5"/><circle cx="15.5" cy="12" r="5.5"/></svg>',
};

const CRYSTAL_SVG = '<svg viewBox="0 0 40 56" aria-hidden="true">'
  + '<polygon points="20,1 37,16 31,48 20,55 9,48 3,16" fill="currentColor"/>'
  + '<polygon points="20,1 37,16 20,21 3,16" fill="#fff" fill-opacity=".5"/>'
  + '<polygon points="3,16 20,21 9,48" fill="#fff" fill-opacity=".2"/>'
  + '<polygon points="37,16 31,48 20,21" fill="#000" fill-opacity=".2"/>'
  + '<polygon points="20,21 31,48 20,55 9,48" fill="#000" fill-opacity=".06"/>'
  + '<polyline points="20,1 20,21 20,55" stroke="#fff" stroke-opacity=".4" fill="none"/>'
  + '</svg>';

const ADVISOR_SAMPLES = 200;
const ORACLE_SAMPLES = 80;
const SAVE_KEY = 'mythic-pacts:v3';
const ONLINE_KEY = 'mythic-pacts:online';
const PROFILE_KEY = 'mythic-pacts:profile';   // what the Oracle has learned about this player's habits
const RECORDS_KEY = 'mythic-pacts:games';     // finished rounds against the computer, move by move
// Which Oracle played a recorded game, so games can be compared across versions.
const ENGINE_VERSION = 'oracle-2026-11-01-keepnext';
const PID_KEY = 'mythic-pacts:pid';
// Online play for two devices is built (src/online.js) but switched off for now.
const ONLINE_ENABLED = false;

/* ---------- art ----------
   prepare_art.py cuts your images into pieces and lists them in assets/art.js
   (build.py puts them inside the page itself). Anything missing falls back
   to a drawn placeholder. */
const ART = Object.assign({}, window.ART_FILES || {});
const cardArt = (R, v) => v ? (ART[`${R.key}-${v}`] || ART[R.key]) : (ART[`${R.key}-pact`] || ART[R.key]);
const crystalArt = R => ART[`crystal-${R.key}`] || ART.crystal;
const realmArt = R => ART[`realm-${R.key}`];

function applyTableArt() {
  if (ART.backdrop) {
    document.querySelector('.sky').style.setProperty('--backdrop', `url("${ART.backdrop}")`);
    document.body.classList.add('has-backdrop');
  }
  if (!ART.table) return;
  const felt = $('#felt');
  felt.style.setProperty('--table-art', `url("${ART.table}")`);
  felt.classList.add('has-table-art');
}

/* ---------- state ---------- */
const ui = {
  match: null,        // { mode: 'ai' | 'online', skill, rounds, round, names, totals, results, first, scored, started }
  st: null,           // engine state for the current round
  me: 0,              // my seat: 0 against the computer, the session's seat online
  busy: false,        // the computer is choosing a move
  locked: false,      // a card is flying across the table
  running: false,     // a game is in progress (not just dealt behind the menu)
  selected: null,     // card picked in the hand (by tap or while dragging)
  dragCard: null,
  incoming: null,     // card hidden at its destination until its flight lands
  fresh: null,        // last card placed, so a new crystal can celebrate it
  showOdds: true,
  analysis: null,
  progress: 0,
  version: 0,
  gen: 0,
  log: [],
  pid: null,          // stable id for this browser, used to keep an online seat
};

// Online play. The `room` capability is only there when the page is opened on claude.ai.
const net = { room: null, ready: false, session: null, unsub: [], seq: 0, rounds: 3, queue: Promise.resolve() };

const isOnline = () => !!ui.match && ui.match.mode === 'online';
const nm = p => escapeHTML(ui.match.names[p] || (p === 0 ? 'Host' : 'Guest'));
const who = p => p === ui.me ? 'You' : nm(p);
const possessive = p => p === ui.me ? 'Your' : `${nm(p)}’s`;
const escapeHTML = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const signed = (n, d = 0) => { const x = +n.toFixed(d); return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d); };
const pct = x => x > 0 && x < 0.005 ? '<1%' : x < 1 && x >= 0.995 ? '>99%' : `${Math.round(x * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const wait = ms => new Promise(res => setTimeout(res, ms));
const isPact = c => valueOf(c) === 0;
const clone = o => JSON.parse(JSON.stringify(o));
const topOf = pile => pile[pile.length - 1];
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
// Whether a card moving between these two places is animated (sounds are timed to match).
const willFly = (from, to) => !!(from && to) && !reduceMotion();
// How long ago `card` landed, if it is the card that just landed (for flare-ups that must survive redraws).
const sinceLanded = card => (ui.flare && ui.flare.card === card ? performance.now() - ui.flare.at : Infinity);

function cardName(c) {
  const R = REALM_UI[realmOf(c)], v = valueOf(c);
  return v ? `${R.one} ${v}` : `${R.one} Pact`;
}

// My turn in the game's eyes (used for wording)...
function myTurnState() {
  const st = ui.st;
  return !!st && ui.running && !st.over && st.turn === ui.me && (!isOnline() || !!net.session);
}
// ...and whether my hands may move cards right now.
function isHumanTurn() {
  return myTurnState() && !ui.busy && !ui.locked;
}

/* ---------- card markup ---------- */
function cardFace(c, cls = '') {
  const r = realmOf(c), v = valueOf(c), R = REALM_UI[r];
  const img = cardArt(R, v);
  const mark = v ? `<b>${v}</b>` : `<i class="ico pact">${SIGIL.pact}</i>`;
  return `<span class="card ${img ? 'has-art' : ''} ${ui.incoming === c ? 'incoming' : ''} ${cls}" data-cid="${c}" style="--cc:${R.hex}">`
    + `<span class="art"${img ? ` style="background-image:url('${img}')"` : ''}>${img ? '' : `<span class="sigil">${SIGIL[R.key]}</span>`}</span>`
    + `<span class="pip tl">${mark}<i class="ico">${SIGIL[R.key]}</i></span>`
    + `<span class="pip br">${mark}</span>`
    + (v ? '' : '<span class="pact-band">PACT</span>')
    + '</span>';
}

function cardBack(cls = '') {
  return ART['card-back']
    ? `<span class="card back has-art ${cls}"><span class="art" style="background-image:url('${ART['card-back']}')"></span></span>`
    : `<span class="card back ${cls}"><span class="back-mark">${CRYSTAL_SVG}</span></span>`;
}

function crystalMark(R) {
  const img = crystalArt(R);
  return img ? `<img class="crystal-art" src="${img}" alt="">` : `<i class="ico">${CRYSTAL_SVG}</i>`;
}

/* ---------- rendering ---------- */
function render() {
  if (!ui.st) return;
  const focusKey = rememberFocus();
  renderHeader();
  renderSeat();
  renderBoard();
  renderPrompt();
  renderHand();
  renderOdds();
  fitTable();
  restoreFocus(focusKey);
}

// Shrink the board cards just enough for the whole table, hand included, to fit the window.
function fitTable() {
  const felt = $('#felt'), well = document.querySelector('.well');
  if (!well) return;
  felt.style.setProperty('--cw-fit', '999px');
  // Side-by-side layout: only the board has to fit. Stacked layout: board and hand together.
  const sideBySide = getComputedStyle(felt).display === 'grid';
  for (let i = 0; i < 5; i++) {
    const cw = well.offsetWidth;
    const scalable = $('#board').offsetHeight + (sideBySide ? 0 : $('#hand').offsetHeight);
    const bottom = window.scrollY + (sideBySide ? $('#board').getBoundingClientRect().bottom + 24 : $('.table').getBoundingClientRect().bottom);
    const over = bottom + 20 - window.innerHeight;
    const floor = sideBySide ? 62 : 52;   // cards shrink only as far as stays readable; very long lines may still scroll
    if (over <= 1 || cw <= floor) break;
    felt.style.setProperty('--cw-fit', `${Math.max(floor, Math.floor(cw * (scalable - over) / scalable))}px`);
  }
}

function rememberFocus() {
  const a = document.activeElement;
  if (!a || !a.dataset) return null;
  for (const k of ['card', 'well', 'stack', 'deck']) if (a.dataset[k] !== undefined) return [k, a.dataset[k]];
  return null;
}
function restoreFocus(key) {
  if (!key) return;
  const el = document.querySelector(`[data-${key[0]}="${key[1]}"]`);
  if (el && !el.disabled) el.focus({ preventScroll: true });
}

function renderHeader() {
  const m = ui.match;
  const roundTxt = m.rounds > 1 ? `Round ${m.round} of ${m.rounds}` : 'Single round';
  $('#matchInfo').innerHTML = `<span class="label">${roundTxt}</span>`
    + `<span class="score">${nm(0)} <b>${m.totals[0]}</b> · <b>${m.totals[1]}</b> ${nm(1)}</span>`;
  $('#btnOdds').setAttribute('aria-pressed', String(ui.showOdds));
  $('#layout').classList.toggle('no-odds', !ui.showOdds);
}

function renderSeat() {
  const st = ui.st, op = ui.me ^ 1, hand = st.hands[op], known = st.known[op];
  const unknown = hand.length - known.length;
  const active = !st.over && st.turn === op && ui.running;
  let mini = '';
  for (let i = 0; i < unknown; i++) mini += cardBack();
  for (const c of known.slice().sort((a, b) => a - b)) mini += `<span class="known" title="${cardName(c)}: they took it from a discard pile">${cardFace(c)}</span>`;
  let status = '';
  if (isOnline() && net.session) {
    const on = net.session.opponentConnected();
    status = `<span class="presence ${on ? 'on' : ''}">${on ? 'Online' : 'Away'}</span>`;
  }
  $('#oppSeat').innerHTML = `<div class="seat-id">`
    + `<span class="seat-name">${active ? '<span class="turn-dot"></span> ' : ''}${nm(op)}</span>${status}`
    + (studiedNote() ? `<span class="seat-sub studied" title="After each round it looks back at what you were holding, and adjusts how it pictures your hand">${studiedNote()}</span>` : '')
    + `<span class="seat-sub">${hand.length} cards in hand${known.length ? ` · ${known.length} face up because they took ${known.length > 1 ? 'them' : 'it'} from a discard pile` : ''}</span>`
    + `</div><div class="mini-hand" aria-label="${nm(op)}’s hand">${mini}</div>`;
}

function studiedNote() {
  if (isOnline() || ui.match.skill !== 'oracle') return '';
  const n = loadProfile().rounds;
  return n ? `has studied ${plural(n, 'round')} of yours` : 'learns your habits as you play';
}

function stackHTML(pile, side, r, clickable) {
  const R = REALM_UI[r], s = scorePile(pile);
  let cards = '';
  pile.forEach((c, i) => { cards += `<span class="slot" style="--i:${i}">${cardFace(c)}</span>`; });
  const ghost = `<span class="ghost"><i class="ico">${SIGIL[R.key]}</i></span>`;
  const tally = pile.length
    ? `<span class="tally ${s.total < 0 ? 'neg' : ''}">${signed(s.total)}${s.pacts ? `<small>×${s.mult}</small>` : ''}</span>`
    : '<span class="tally none">—</span>';
  let progress = '';
  if (s.crystal) {
    // The crystal itself goes to its owner's tray beside the scores; the line just notes it.
    progress = `<span class="crystal-bonus"><i class="mini">${crystalMark(R)}</i>crystal +20</span>`;
  } else if (pile.length) {
    let g = '';
    for (let i = 0; i < CRYSTAL_AT; i++) g += `<i class="${i < pile.length ? 'on' : ''}"></i>`;
    progress = `<span class="gems" title="${pile.length} of ${CRYSTAL_AT} cards toward a crystal">${g}</span>`;
  }
  // A crystal line glows once its 8th card has landed (later cards don't dim it), around the cards that
  // have landed; the glow flares up as the 8th lands, carrying on from where it was if the board redraws.
  const last = topOf(pile), flying = ui.incoming === last ? 1 : 0, t = sinceLanded(last);
  const flare = s.crystal && pile.length === CRYSTAL_AT && t < 1100;
  const glow = s.crystal && (pile.length > CRYSTAL_AT || !flying) ? (flare ? 'crystal-line new' : 'crystal-line') : '';
  const tag = clickable ? 'button' : 'div';
  const attrs = clickable ? ` type="button" data-stack="${r}" aria-label="Play onto your ${R.one} line"` : '';
  return `<${tag} class="stack ${side} ${clickable ? 'target' : ''} ${glow}" style="--cc:${R.hex};--n:${pile.length};--lit:${pile.length - flying};${flare ? `--flare:-${Math.round(t)}ms;` : ''}grid-column:${r + 1}"${attrs}>`
    + `<span class="pile ${pile.length ? '' : 'empty'}">${cards || ghost}</span>`
    + `<span class="foot">${tally}${progress}</span>`
    + `</${tag}>`;
}

// The crystals a player has earned, kept beside their score near the middle of the board so they stay
// in view however long the lines grow. A brand-new one appears once its card has landed.
function crystalTray(p) {
  const st = ui.st;
  let html = '';
  for (let r = 0; r < REALMS; r++) {
    const pile = st.exp[p][r];
    if (pile.length < CRYSTAL_AT) continue;
    const R = REALM_UI[r], last = topOf(pile);
    const t = sinceLanded(last), fresh = pile.length === CRYSTAL_AT && t < 1000;
    const state = pile.length === CRYSTAL_AT && ui.incoming === last ? 'pending' : fresh ? 'new' : '';
    html += `<span class="tray-crystal ${state}" style="--cc:${R.hex}${fresh ? `;--flare:-${Math.round(t)}ms` : ''}" title="${R.one} crystal: a line of 8 or more cards, +20">${crystalMark(R)}</span>`;
  }
  return html ? `<span class="crystal-tray">${html}</span>` : '';
}

function analysisFresh() {
  return ui.analysis && ui.analysis.version === ui.version ? ui.analysis : null;
}

function renderBoard() {
  const st = ui.st, me = ui.me, op = me ^ 1;
  const mine = myTurnState();
  const sel = ui.selected, selR = sel != null ? realmOf(sel) : -1;
  const playing = mine && st.phase === 'play';
  const drawing = mine && st.phase === 'draw';
  const an = analysisFresh();
  const bestDraw = drawing && an ? an.best.src : null;
  let html = '';

  for (let r = 0; r < REALMS; r++) {
    const R = REALM_UI[r];
    html += stackHTML(st.exp[op][r], 'opp', r, false);

    const pile = st.discard[r], top = topOf(pile);
    const canTake = drawing && pile.length > 0 && r !== st.lastDiscard;
    const isTarget = playing && selR === r;
    const label = isTarget ? `Discard ${cardName(sel)} here`
      : canTake ? `Take ${cardName(top)} from the ${R.one} discard pile`
      : `${R.name} discard pile, ${plural(pile.length, 'card')}`;
    html += `<button type="button" class="well ${canTake ? 'can-take' : ''} ${isTarget ? 'target' : ''}" style="--cc:${R.hex};grid-column:${r + 1}" data-well="${r}" ${canTake || isTarget ? '' : 'disabled'} aria-label="${label}">`
      + `<span class="well-pool ${pile.length > 1 ? 'deep' : ''}">`
      + (pile.length ? cardFace(top)
        : realmArt(R) ? `<span class="well-portrait" style="background-image:url('${realmArt(R)}')"></span>`
        : `<span class="well-empty"><i class="ico">${SIGIL[R.key]}</i></span>`)
      + (bestDraw === r ? '<span class="best-tag">Best</span>' : '')
      + `</span><span class="label">${R.name}${pile.length > 1 ? ` · ${pile.length}` : ''}</span></button>`;

    const playable = playing && selR === r && canPlay(st.exp[me][r], sel);
    html += stackHTML(st.exp[me][r], 'mine', r, playable);
  }

  const oppTotal = playerTotal(st, op), myTotal = playerTotal(st, me);
  html += `<div class="seat-score opp"><span class="label" title="${nm(op)}">${nm(op)}</span><b class="${oppTotal < 0 ? 'neg' : ''}">${signed(oppTotal)}</b><span class="label">this round</span>${crystalTray(op)}</div>`;
  html += `<button type="button" class="deck ${drawing ? 'can-take' : ''}" data-deck="1" ${drawing ? '' : 'disabled'} aria-label="Draw from the deck, ${plural(st.deck.length, 'card')} left">`
    + `<span class="deck-pool">${st.deck.length ? cardBack() : ''}<span class="deck-count">${st.deck.length}</span>`
    + (bestDraw === -1 ? '<span class="best-tag">Best</span>' : '')
    + `</span><span class="label">Deck</span></button>`;
  html += `<div class="seat-score mine">${crystalTray(me)}<span class="label">this round</span><b class="${myTotal < 0 ? 'neg' : ''}">${signed(myTotal)}</b><span class="label" title="${nm(me)}">${nm(me)}</span></div>`;

  $('#board').innerHTML = html;
}

function renderPrompt() {
  const st = ui.st, el = $('#prompt'), op = ui.me ^ 1;
  let steps = '', text = '', acts = '';

  if (st.over) {
    text = 'The deck is empty. The round is over.';
    if (ui.match.scored === ui.match.round) acts = '<button type="button" class="act primary" data-act="results">See results</button>';
  }
  else if (!ui.running) text = 'Choose how to play from the menu.';
  else if (ui.busy) text = `${nm(op)} is ${ui.match.skill === 'oracle' ? 'simulating possible endings' : 'thinking'}<span class="thinking"><i></i><i></i><i></i></span>`;
  else if (myTurnState()) {
    steps = `<span class="steps"><span class="step ${st.phase === 'play' ? 'on' : 'done'}">1 · Play or discard</span><span class="step ${st.phase === 'draw' ? 'on' : ''}">2 · Draw</span></span>`;
    if (st.phase === 'play') {
      if (ui.selected != null) {
        const c = ui.selected, R = REALM_UI[realmOf(c)], pile = st.exp[ui.me][realmOf(c)];
        text = canPlay(pile, c)
          ? `<strong>${cardName(c)}</strong>: drop it on your glowing ${R.one} line to play it, or on the ${R.one} discard pile to throw it away.`
          : `<strong>${cardName(c)}</strong> can’t go on your ${R.one} line (${whyNot(pile, c)}). Drop it on the ${R.one} discard pile.`;
      } else text = 'Your turn. Drag a card onto your line to play it, or onto its discard pile to throw it away.';
    } else {
      text = 'Now draw: tap the deck or the top card of a discard pile'
        + (st.lastDiscard >= 0 ? `, but not the ${REALM_UI[st.lastDiscard].one} card you just threw away.` : '.');
    }
  } else if (isOnline()) {
    const away = net.session && !net.session.opponentConnected();
    text = away ? `Waiting for ${nm(op)}, who seems to be away. Their move will appear here when they come back.`
      : `${nm(op)} is choosing a move<span class="thinking"><i></i><i></i><i></i></span>`;
  } else text = `${nm(op)} is playing…`;
  el.innerHTML = `<div class="prompt-main">${steps}<p class="prompt-text">${text}</p></div><div class="prompt-acts">${acts}</div>`;
}

function whyNot(pile, c) {
  if (isPact(c)) return 'Pacts must come before any numbers';
  return `it’s at ${topValue(pile)} and must go up`;
}

function renderHand() {
  const st = ui.st, me = ui.me, el = $('#hand');
  const canAct = isHumanTurn() && st.phase === 'play';
  const an = canAct ? analysisFresh() : null;
  const hand = st.hands[me].slice().sort((a, b) => a - b);
  el.innerHTML = hand.map(c => {
    const dead = !canPlay(st.exp[me][realmOf(c)], c);
    const sel = ui.selected === c;
    const best = an && an.best.card === c ? `<span class="best-tag">Best: ${an.best.type}</span>` : '';
    const cls = `hand-card ${dead ? 'dead' : ''} ${ui.dragCard === c ? 'dragging' : ''}`;
    return `<span class="hand-slot"><button type="button" class="${cls}" data-card="${c}" aria-pressed="${sel}" aria-label="${cardName(c)}${dead ? ', can only be discarded' : ''}" ${canAct ? '' : 'disabled'}>${cardFace(c)}${best}</button></span>`;
  }).join('');
}

/* ---------- odds panel ---------- */
// What this player can know about each card: in their hand, on top of a discard pile,
// still unseen (deck or the opponent's hidden cards), or out of reach.
function cardStates(p) {
  const st = ui.st, s = new Array(DECK_SIZE).fill('unseen');
  for (const side of st.exp) for (const pile of side) for (const c of pile) s[c] = 'out';
  for (const pile of st.discard) pile.forEach((c, i) => { s[c] = i === pile.length - 1 ? 'top' : 'out'; });
  for (const c of st.known[p ^ 1]) s[c] = 'out';
  for (const c of st.hands[p]) s[c] = 'hand';
  return s;
}

// Chance that k specific unseen cards miss all of the m deck draws I will make,
// when unseen cards are spread evenly over S places (deck + opponent's unknown cards).
function chanceNone(S, m, k) {
  let p = 1;
  for (let i = 0; i < k; i++) { if (S - m - i <= 0) return 0; p *= (S - m - i) / (S - i); }
  return p;
}

function moveLabel(o) {
  if (o.type === 'play') return `Play ${cardName(o.card)}`;
  if (o.type === 'discard') return `Discard ${cardName(o.card)}`;
  if (o.src < 0) return 'Draw from the deck';
  return `Take ${cardName(topOf(ui.st.discard[o.src]))}`;
}

function giftText(gift, op) {
  const R = REALM_UI[gift.realm];
  return gift.kind === 'feeds' ? `${nm(op)} can play it on their ${R.one} line` : `${nm(op)} could use it to start ${R.name}`;
}

function renderOdds() {
  const el = $('#odds');
  el.hidden = !ui.showOdds;
  if (!ui.showOdds) return;
  const st = ui.st, me = ui.me, op = me ^ 1;
  const D = st.deck.length, T = Math.ceil(D / 2);
  const head = `<div><div class="odds-head"><h2>Odds</h2><span class="quiet">for ${nm(me)}</span></div>`
    + `<p class="odds-meta"><b>${D}</b> card${D === 1 ? '' : 's'} in the deck · ${D === 1 ? 'the next draw ends the round' : `about <b>${T}</b> more turn${T === 1 ? '' : 's'} each`}</p></div>`;

  // Best move
  let rec;
  const an = analysisFresh();
  if (!ui.running) rec = '<p class="quiet">Start a game to see the odds for each move.</p>';
  else if (st.over) rec = '<p class="quiet">Round over.</p>';
  else if (!myTurnState()) rec = `<p class="quiet">Waiting for ${nm(st.turn)}.</p>`;
  else if (!an) rec = `<p class="quiet">Simulating possible endings of the round…</p><div class="progress"><i id="progBar" style="width:${Math.round(ui.progress * 100)}%"></i></div>`;
  else {
    const best = an.best;
    const top = an.options.slice(0, 5);
    if (!top.includes(best)) top[4] = best;
    const maxAbs = Math.max(1, ...top.map(o => Math.abs(o.mean)));
    // Older engines report only `anchored`; newer ones name the option they passed over and why.
    const avoided = an.avoided !== undefined ? an.avoided : (an.anchored ? an.options[0] : null);
    const reason = an.avoidedReason || (avoided ? 'noise' : null);
    let notes = '';
    if (avoided && reason === 'open') {
      const R = REALM_UI[avoided.open.realm];
      notes += `<p class="rec-note">${moveLabel(avoided)} scored ${an.edge.toFixed(1)} higher (±${an.edgeSe.toFixed(1)}), but it starts a new ${R.one} line, which costs 20 points${avoided.open.contested ? ` in a realm ${nm(op)} is already collecting` : ''}${avoided.open.linesOpen >= 2 ? `, on top of the ${avoided.open.linesOpen} lines you already have open` : ''}, and that edge isn’t big enough to commit. The advice waits.</p>`;
    } else if (avoided && reason === 'skip') {
      notes += `<p class="rec-note">${moveLabel(avoided)} scored ${an.edge.toFixed(1)} higher (±${an.edgeSe.toFixed(1)}), but it jumps over lower ${REALM_UI[realmOf(avoided.card)].name} you could still play (${avoided.skip.skipped.join(', ')}), worth about ${avoided.skip.loss.toFixed(1)} points. The advice waits for them.</p>`;
    } else if (avoided && reason === 'own') {
      notes += avoided.own.next
        ? `<p class="rec-note">${moveLabel(avoided)} scored ${an.edge.toFixed(1)} higher (±${an.edgeSe.toFixed(1)}), but it throws away the next card for your ${REALM_UI[avoided.own.realm].one} line, and playing it there can only add points. The advice keeps it.</p>`
        : `<p class="rec-note">${moveLabel(avoided)} scored ${an.edge.toFixed(1)} higher (±${an.edgeSe.toFixed(1)}), but it throws away a card your ${REALM_UI[avoided.own.realm].one} line could use, and ${nm(op)} would likely pick it up to deny you. The advice keeps it.</p>`;
    } else if (avoided && reason === 'gift') {
      notes += `<p class="rec-note">${moveLabel(avoided)} scored ${an.edge.toFixed(1)} higher (±${an.edgeSe.toFixed(1)}), but it hands ${nm(op)} a card they can use, and a gain that small or that uncertain isn’t worth it. The advice plays it safe.</p>`;
    } else if (avoided) {
      notes += `<p class="rec-note">Close call: ${moveLabel(avoided)} scored ${an.edge.toFixed(1)} higher, but that is within one standard error (±${an.edgeSe.toFixed(1)}), so the advice sticks with the rules-of-thumb move.</p>`;
    }
    if (best.gift) notes += `<p class="rec-note">This helps ${nm(op)} a little (${giftText(best.gift, op)}), but every alternative scored clearly worse.</p>`;
    if (best.skip) notes += `<p class="rec-note">This jumps over lower ${REALM_UI[realmOf(best.card)].name} (${best.skip.skipped.join(', ')}), but every alternative scored clearly worse.</p>`;
    if (best.own) notes += `<p class="rec-note">This throws away a card your own ${REALM_UI[best.own.realm].one} line could use, but every alternative scored clearly worse.</p>`;
    rec = `<div class="rec-top"><span class="rec-move">${moveLabel(best)}</span><span class="rec-ev ${best.mean < 0 ? 'neg' : ''}">${signed(best.mean, 1)}</span></div>`
      + `<p class="rec-note">Your average lead over ${nm(op)} when the round ends, across ${an.samples} simulated deals (standard error ±${best.se.toFixed(1)}).</p>`
      + notes
      + '<ol class="alts">' + top.map(o => {
        const w = Math.abs(o.mean) / maxAbs * 50;
        const bar = o.mean >= 0 ? `<i style="left:50%;width:${w}%"></i>` : `<i class="neg" style="left:${50 - w}%;width:${w}%"></i>`;
        const gift = (o.gift ? `<span class="gift-tag" title="${giftText(o.gift, op)}">helps ${nm(op)}</span>` : '')
          + (o.own ? `<span class="own-tag" title="Your ${REALM_UI[o.own.realm].one} line could still use this card">fits your line</span>` : '')
          + (o.open && o.open.contested ? `<span class="gift-tag" title="${nm(op)} has already started ${REALM_UI[o.open.realm].name}: they hold many of its cards">contested</span>` : '')
          + (o.skip ? `<span class="own-tag" title="Jumps over ${o.skip.skipped.join(', ')}, which you could still play">jumps ${o.skip.skipped.length > 1 ? `${o.skip.skipped[0]}–${o.skip.skipped[o.skip.skipped.length - 1]}` : o.skip.skipped[0]}</span>` : '');
        return `<li class="alt ${o.recommended ? 'is-best' : ''}" title="${moveLabel(o)}: ${signed(o.mean, 1)} ± ${o.se.toFixed(1)}"><span class="alt-name"><span class="alt-label">${moveLabel(o)}</span>${gift}</span><span class="alt-bar">${bar}</span><span class="alt-val">${signed(o.mean, 1)}</span></li>`;
      }).join('') + '</ol>';
  }

  // Card count
  const states = cardStates(me);
  let count = '<div class="count">';
  for (let r = 0; r < REALMS; r++) {
    const R = REALM_UI[r];
    let row = `<div class="count-row" style="--cc:${R.hex}"><i class="ico" title="${R.name}">${SIGIL[R.key]}</i>`;
    let unseen = 0;
    for (let k = 0; k < PER_REALM; k++) {
      const c = r * PER_REALM + k, s = states[c];
      if (s === 'unseen') unseen++;
      row += s === 'out'
        ? '<span class="pipc out" aria-hidden="true"></span>'
        : `<span class="pipc ${s}" title="${cardName(c)}">${k < 3 ? 'P' : k - 1}</span>`;
    }
    count += row + `<span class="count-sum">${unseen} unseen</span></div>`;
  }
  count += '</div><div class="legend">'
    + '<span><span class="pipc">7</span>Unseen</span>'
    + '<span><span class="pipc hand">7</span>In your hand</span>'
    + '<span><span class="pipc top">7</span>Top of a discard pile</span></div>';

  // Selected card
  let insight = '<p class="quiet">Pick a card to see the chances behind it.</p>';
  if (ui.selected != null && myTurnState()) insight = insightHTML(ui.selected, states);

  const log = ui.log.slice(0, 8).map(e => `<li>${e.text}</li>`).join('') || '<li class="quiet">No moves yet.</li>';

  el.innerHTML = head
    + `<section><h3>Best move</h3>${rec}</section>`
    + `<section><h3>Card count</h3>${count}</section>`
    + `<section class="insight"><h3>Selected card</h3>${insight}</section>`
    + `<section><h3>Moves</h3><ol class="log">${log}</ol></section>`
    + `<section class="method"><details><summary>How these numbers work</summary>${METHOD_HTML}</details></section>`;
}

const METHOD_HTML = '<p><strong>Card count.</strong> Any card that isn’t in your hand, on the table, or known to be in your opponent’s hand is unseen: it is either in the deck or among your opponent’s hidden cards.</p>'
  + '<p><strong>Chance a card reaches you.</strong> If both players keep drawing from the deck, you draw about half of what is left. Your number of draws divided by the number of hidden places gives the chance for each card. The chance of getting at least one of several cards comes from the hypergeometric distribution.</p>'
  + `<p><strong>Best move.</strong> For every legal move, the game deals the unseen cards ${ADVISOR_SAMPLES} times, plays both sides to the end of the round with a rules-of-thumb strategy, and averages your final lead. The deals lean toward what your opponent’s play has revealed: a player who has started a realm is more likely to be holding more of it. Every move is tested on the same deals, so the differences come from the move rather than the luck of the draw.</p>`
  + '<p><strong>Safe moves first.</strong> A discard your opponent could put straight onto one of their lines is only recommended when it beats the best safe move by at least 3 points and by more than twice the margin of error; one that could help them start a new line must win by 1.5 points. Throwing away a card your own line could still use must win by at least half the points it is worth there, because your opponent will often take it to deny you, and the next card for one of your lines, with nothing in between left to wait for, is never thrown away: playing it can only add points. The advice also stays with the rules-of-thumb move unless another move is clearly better, because chasing the highest noisy average picks lucky moves, not good ones.</p>'
  + '<p><strong>Starting a new line.</strong> A new line costs 20 points, so the advice only starts one the rules of thumb would not when it wins clearly: by more in a realm your opponent is already collecting, because they hold many of its cards.</p>'
  + '<p><strong>Waiting for low cards.</strong> Playing a card that jumps over lower ones you could still play (opening a line with a 7 early in the round, say) must win by half the points those lower cards are expected to be worth. Late in the round that expectation is small, so the jump becomes fine.</p>'
  + '<p><strong>Learning your habits.</strong> After each round against the Oracle, it looks back at what you were really holding at each of its decisions and compares that with what it expected. Over a few rounds it learns, for example, whether you hold on to high cards or Pacts, and leans its simulated deals that way. It never uses your hidden cards in the round being played.</p>';

function insightHTML(c, states) {
  const st = ui.st, me = ui.me, op = me ^ 1;
  const r = realmOf(c), v = valueOf(c), R = REALM_UI[r];
  const pile = st.exp[me][r], t = topValue(pile);
  const D = st.deck.length;
  const S = D + st.hands[op].length - st.known[op].length;
  const m = Math.ceil(D / 2);
  const pEach = S ? m / S : 0;
  const lines = [];

  if (canPlay(pile, c)) {
    const after = scorePile(pile.concat([c]));
    const skipped = [];
    if (v) for (let w = Math.max(t, 1) + 1; w < v; w++) if (states[numberCard(r, w)] === 'unseen') skipped.push(w);
    lines.push(`<p>Playing it ${pile.length ? `takes your ${R.one} line from ${t || 'Pact'} to ${v || 'another Pact'}` : `starts your ${R.one} line at a cost of 20`}. If the round ended now that line would score <span class="big">${signed(after.total)}</span>.</p>`);
    if (skipped.length) lines.push(`<p>It skips ${skipped.join(', ')}: still unseen and lost to you if you play this.</p>`);
    const blocked = st.hands[me].filter(x => x !== c && realmOf(x) === r && canPlay(pile, x) && !canPlay([c], x)).map(valueOf);
    if (blocked.length) lines.push(`<p>It also blocks the ${blocked.sort((a, b) => a - b).map(x => x || 'Pact').join(', ')} in your own hand. Play ${blocked.length > 1 ? 'those' : 'that'} first to keep ${blocked.length > 1 ? 'them' : 'it'}.</p>`);
  } else lines.push(`<p>Your ${R.one} line can’t take it any more, so it can only be discarded.</p>`);

  const floor = Math.max(v, t, 1);
  const higher = [];
  for (let w = floor + 1; w <= 10; w++) if (states[numberCard(r, w)] === 'unseen') higher.push(w);
  if (higher.length) {
    const pAny = 1 - chanceNone(S, m, higher.length);
    lines.push(`<p>Unseen ${R.name} above ${floor}: <strong>${higher.join(' · ')}</strong>. Each has a <span class="big">${pct(pEach)}</span> chance of reaching your hand. Chance of at least one: <span class="big">${pct(pAny)}</span>.</p>`);
  } else lines.push(`<p>No unseen ${R.name} above ${floor} are left.</p>`);

  if (pile.length && canPlay(pile, c)) lines.push(`<p class="warn">If you discard it, you give up what it’s worth on your ${R.one} line, and ${nm(op)} may take it to deny you.</p>`);
  const gift = typeof giftRisk === 'function' ? giftRisk(st, me, c)
    : (st.exp[op][r].length && canPlay(st.exp[op][r], c) ? { kind: 'feeds', realm: r } : null);
  if (gift) lines.push(`<p class="warn">If you discard it, ${giftText(gift, op)}.</p>`);
  return lines.join('');
}

function updateProgress() {
  const bar = document.getElementById('progBar');
  if (bar) bar.style.width = `${Math.round(ui.progress * 100)}%`;
}

/* ---------- simulation runner (keeps the page responsive) ---------- */
let job = null;
function runAnalysis(st, p, samples, onProgress, settings) {
  if (job) job.cancelled = true;
  const mine = job = { cancelled: false };
  const gen = analyze(cloneState(st), p, samples, (Math.random() * 4294967296) >>> 0, settings);
  return new Promise(resolve => {
    function step() {
      if (mine.cancelled) return resolve(null);
      const t0 = performance.now();
      let r;
      do { r = gen.next(); } while (!r.done && performance.now() - t0 < 14);
      if (r.done) { if (job === mine) job = null; resolve(r.value); }
      else { if (onProgress) onProgress(r.value); setTimeout(step, 0); }
    }
    setTimeout(step, 0);
  });
}

function requestAnalysis() {
  if (!ui.showOdds || !myTurnState()) return;
  const v = ui.version;
  ui.progress = 0;
  runAnalysis(ui.st, ui.me, ADVISOR_SAMPLES, prog => {
    if (ui.version === v) { ui.progress = prog; updateProgress(); }
  }).then(res => {
    if (!res || ui.version !== v) return;
    ui.analysis = Object.assign(res, { version: v });
    if (drag && drag.started) return;   // don't redraw the hand under a card being dragged
    const focusKey = rememberFocus();
    renderOdds();
    renderHand();
    renderBoard();
    restoreFocus(focusKey);
  });
}

/* ---------- cards in flight ----------
   Every move slides a card from where it was to where it lands. Drawing from the
   deck adds a 3D turn, a zoom and a glow before the card settles in your hand. */
const cardEl = (c, scope = '#board') => document.querySelector(`${scope} [data-cid="${c}"]`);
const rectOf = el => el ? el.getBoundingClientRect() : null;
function seatRect(p) {
  const el = p === ui.me ? $('#hand') : $('#oppSeat .mini-hand');
  return rectOf(el && (el.lastElementChild || el));
}

function flyCard({ card = null, from, to, flip = false, showcase = false, duration = 460 }) {
  if (!willFly(from, to)) return Promise.resolve();
  // The card is drawn at the largest size it reaches and only ever scaled down, so it stays sharp.
  // A zoomed card is capped near the art's own resolution (cards on the sheets are about 300 pixels wide).
  const sw = showcase ? Math.min(Math.max(to.width * 2, 160), 220, window.innerWidth * 0.5) : to.width;
  const w = sw, h = sw * to.height / to.width;
  const fly = document.createElement('div');
  fly.className = 'fly';
  fly.style.width = `${w}px`;
  fly.style.height = `${h}px`;
  fly.style.setProperty('--fw', `${w}px`);
  if (card != null) fly.style.setProperty('--cc', REALM_UI[realmOf(card)].hex);
  fly.innerHTML = '<div class="fly-glow"></div><div class="fly-inner">'
    + (card != null ? `<div class="fly-face front">${cardFace(card)}</div>` : '')
    + `<div class="fly-face back">${cardBack()}</div></div>`;
  document.body.appendChild(fly);
  const inner = fly.querySelector('.fly-inner'), glow = fly.querySelector('.fly-glow');
  const at = (x, y, s) => `translate(${x}px, ${y}px) scale(${s})`;
  const start = at(from.left, from.top, from.width / w), end = at(to.left, to.top, to.width / w);

  let frames, turn, glowFrames = null;
  if (showcase) {
    // Lift the card to a point between the deck and the hand, a little larger than life.
    const sh = h;
    let cx = (from.left + from.width / 2 + to.left + to.width / 2) / 2;
    let cy = Math.min((from.top + from.height / 2 + to.top + to.height / 2) / 2, window.innerHeight * 0.48);
    cx = Math.min(Math.max(cx, sw / 2 + 12), window.innerWidth - sw / 2 - 12);
    cy = Math.min(Math.max(cy, sh / 2 + 12), window.innerHeight - sh / 2 - 12);
    const show = at(cx - sw / 2, cy - sh / 2, 1);
    frames = [
      { offset: 0, transform: start, easing: 'cubic-bezier(.3,.1,.2,1)' },
      { offset: 0.42, transform: show },
      { offset: 0.72, transform: show, easing: 'cubic-bezier(.5,0,.2,1)' },
      { offset: 1, transform: end },
    ];
    turn = flip ? [{ offset: 0, transform: 'rotateY(180deg)' }, { offset: 0.42, transform: 'rotateY(0deg)' }, { offset: 1, transform: 'rotateY(0deg)' }] : null;
    glowFrames = [{ offset: 0, opacity: 0 }, { offset: 0.4, opacity: 1 }, { offset: 0.72, opacity: 1 }, { offset: 1, opacity: 0 }];
  } else {
    frames = [{ transform: start }, { transform: end }];
    turn = flip ? [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }] : null;
  }
  // A card nobody may see yet travels face down. Otherwise the faces swap at the moment
  // the turning card is edge-on, so the flip never depends on 3D back-face hiding.
  const front = fly.querySelector('.fly-face.front'), back = fly.querySelector('.fly-face.back');
  if (card == null) inner.style.transform = 'rotateY(180deg)';
  else if (flip) front.style.opacity = '0';
  else back.style.opacity = '0';

  const timing = { duration, easing: showcase ? 'linear' : 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' };
  const anims = [fly.animate(frames, timing)];
  if (turn) {
    const mid = showcase ? 0.21 : 0.5;   // when the rotation passes 90 degrees
    const swap = (a, b) => [{ offset: 0, opacity: a }, { offset: mid, opacity: a }, { offset: mid + 0.001, opacity: b }, { offset: 1, opacity: b }];
    anims.push(inner.animate(turn, { duration, fill: 'forwards', easing: showcase ? 'linear' : 'ease-in-out' }));
    anims.push(front.animate(swap(0, 1), { duration, fill: 'forwards' }));
    anims.push(back.animate(swap(1, 0), { duration, fill: 'forwards' }));
  }
  if (glowFrames) anims.push(glow.animate(glowFrames, { duration, fill: 'forwards' }));
  return Promise.all(anims.map(a => a.finished)).catch(() => {}).then(() => fly.remove());
}

async function land(flight) {
  try { await flight; } finally {
    ui.incoming = null;
    document.querySelectorAll('.card.incoming').forEach(el => el.classList.remove('incoming'));
  }
}

/* ---------- game flow ---------- */
function changed() {
  ui.version++;
  save();
  render();
}

function note(p, kind, a, card) {
  let text;
  if (kind === 'play') text = `${who(p)} played ${cardName(a)}`;
  else if (kind === 'discard') text = `${who(p)} discarded ${cardName(a)}`;
  else if (a < 0) text = `${who(p)} drew from the deck`;
  else text = `${who(p)} took ${cardName(card)} from the discard`;
  ui.log.unshift({ p, text });
  if (ui.log.length > 40) ui.log.length = 40;
}

function crystalToast(p, r) {
  const R = REALM_UI[r];
  Sound.play('twinkle', { quiet: p !== ui.me });
  const mark = `<span class="toast-crystal" style="--cc:${R.hex}">${crystalMark(R)}</span>`;
  toast(p === ui.me ? `${mark}Crystal! Your ${R.one} line has 8 cards: +20 points.` : `${mark}${nm(p)} earned a crystal on their ${R.one} line.`);
}

function newMatch(opts, start) {
  ui.gen++;
  if (job) job.cancelled = true;
  ui.match = {
    mode: 'ai', skill: opts.skill, rounds: opts.rounds,
    names: opts.names, round: 1, totals: [0, 0], results: [], first: 0, scored: 0,
    started: !!start,
  };
  ui.me = 0;
  ui.running = !!start;
  startRound();
}

/* ---------- the Oracle learns your habits ----------
   During a round against the Oracle, each of its decisions is noted (what it could see, and what you
   were really holding). Only when the round is over is that added to what it has learned, so the
   round being played never uses your hidden cards. Kept in this browser. */
const learningOn = () => typeof studyDecision === 'function' && !isOnline() && ui.match.skill === 'oracle';

function loadProfile() {
  try {
    const s = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (s && s.v === 1 && s.study && Array.isArray(s.study.held)) return s;
  } catch (e) { /* storage unavailable */ }
  return { v: 1, rounds: 0, study: typeof emptyStudy === 'function' ? emptyStudy() : null };
}
function oracleSettings() {
  const prof = loadProfile();
  return prof.rounds > 0 && prof.study && typeof personalWeights === 'function' ? { handWeights: personalWeights(prof.study) } : {};
}
function learnFromRound() {
  if (!ui.roundStudy) return;
  const prof = loadProfile();
  if (!prof.study) return;
  mergeStudy(prof.study, ui.roundStudy);
  prof.rounds++;
  ui.roundStudy = null;
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(prof)); } catch (e) { /* storage unavailable */ }
}

/* ---------- your games against the computer ----------
   Each finished round is kept move by move: the deal, every play, discard and draw, and the scores.
   They are saved in this browser and, on the published page, in the page's own storage, which only
   the page's owner can read or write. Played back, they show where the Oracle loses points against you. */
const store = { db: null, remote: [] };

async function initStore() {
  if (!window.claude || typeof window.claude.use !== 'function') return;
  try { store.db = await window.claude.use('db'); } catch (e) { store.db = null; }
  if (!store.db) return;
  try {
    const q = await store.db.collection('games').orderBy('endedAt', 'desc').limit(500).get();
    store.remote = q.docs.map(d => d.data());
  } catch (e) { store.remote = []; }
}

function startRecord() {
  const st = ui.st, m = ui.match;
  return {
    v: 1, id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, engine: ENGINE_VERSION,
    skill: m.skill, rounds: m.rounds, round: m.round, humanSeat: ui.me, first: st.turn, startedAt: Date.now(),
    studied: m.skill === 'oracle' ? loadProfile().rounds : 0,
    hands: [st.hands[0].slice(), st.hands[1].slice()], deck: st.deck.slice(), moves: [],
  };
}

function finishRecord(s0, s1) {
  const rec = ui.record;
  if (!rec || !ui.st.over) return;
  ui.record = null;
  rec.endedAt = Date.now();
  rec.scores = [s0, s1];
  rec.lines = [0, 1].map(p => ui.st.exp[p].map(pile => pile.slice()));
  const list = loadRecords();
  list.push(rec);
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(list.slice(-80))); } catch (e) { /* storage unavailable */ }
  if (store.db) store.db.collection('games').doc(rec.id).set(rec).catch(() => { /* only the page's owner saves games */ });
}

function loadRecords() {
  try {
    const list = JSON.parse(localStorage.getItem(RECORDS_KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}

// Your results against one computer opponent, from this browser and the page's storage together.
function scoreboard(skill) {
  const seen = new Set(), rounds = [];
  for (const r of store.remote.concat(loadRecords())) {
    if (!r || seen.has(r.id) || r.skill !== skill || !Array.isArray(r.scores)) continue;
    seen.add(r.id);
    rounds.push(r.scores[r.humanSeat] - r.scores[r.humanSeat ^ 1]);
  }
  if (!rounds.length) return null;
  return { n: rounds.length, won: rounds.filter(d => d > 0).length, lost: rounds.filter(d => d < 0).length,
    avg: rounds.reduce((a, b) => a + b, 0) / rounds.length };
}

function scoreboardLine(skill) {
  const b = scoreboard(skill);
  if (!b) return '';
  const who = skill === 'oracle' ? 'the Oracle' : 'the Apprentice';
  return `Your rounds against ${who}: won ${b.won}, lost ${b.lost}${b.n - b.won - b.lost ? `, tied ${b.n - b.won - b.lost}` : ''} (average margin ${signed(b.avg, 1)} for you).`;
}

function startRound() {
  ui.gen++;
  const m = ui.match;
  ui.st = newRound(m.first, makeRng((Math.random() * 4294967296) >>> 0));
  ui.roundStudy = learningOn() ? emptyStudy() : null;
  ui.oracleSettings = learningOn() ? oracleSettings() : {};
  ui.record = ui.running && !isOnline() ? startRecord() : null;
  ui.selected = null;
  ui.analysis = null;
  ui.busy = false;
  ui.locked = false;
  ui.log = [];
  changed();
  if (ui.running) afterTurn();
}

function afterTurn() {
  const st = ui.st;
  if (st.over) { setTimeout(endRound, 700); return; }
  if (!isOnline() && st.turn !== ui.me) aiTurn();
  else if (st.turn === ui.me) requestAnalysis();
}

// Play or discard a card, sliding it from `fromRect` (the hand or the dragged card) to where it lands.
async function playOrDiscard(p, move, fromRect) {
  const st = ui.st, r = realmOf(move.card), pile = st.exp[p][r];
  if (move.type === 'play' && !canPlay(pile, move.card)) {
    toast(`${cardName(move.card)} can’t go there: ${whyNot(pile, move.card)}.`);
    return false;
  }
  const from = fromRect || seatRect(p);
  applyMove(st, move);
  note(p, move.type, move.card);
  if (ui.record) ui.record.moves.push([p, move.type === 'play' ? 'p' : 'd', move.card]);
  if (p === ui.me) commitOnline({ p, kind: move.type, card: move.card });
  ui.selected = null;
  ui.incoming = move.card;
  ui.locked = true;
  changed();
  const ms = p === ui.me ? 420 : 640, to = rectOf(cardEl(move.card));
  Sound.play('place', { ms: willFly(from, to) ? ms : 0, quiet: p !== ui.me });
  await land(flyCard({ card: move.card, from, to, flip: p !== ui.me, duration: ms }));
  ui.flare = { card: move.card, at: performance.now() };
  ui.locked = false;
  render();
  if (move.type === 'play' && pile.length === CRYSTAL_AT) crystalToast(p, r);
  if (p === ui.me) requestAnalysis();
  return true;
}

// Draw from the deck (src -1) or a discard pile, then pass the turn.
async function drawCard(p, src) {
  const st = ui.st;
  const from = rectOf(src < 0 ? document.querySelector('#board .deck-pool .card') : cardEl(topOf(st.discard[src])));
  const card = applyDraw(st, src);
  note(p, 'draw', src, card);
  if (ui.record) ui.record.moves.push([p, 'r', src, card]);
  if (p === ui.me) commitOnline({ p, kind: 'draw', src, card });
  ui.locked = true;
  let flight;
  if (p === ui.me) {
    ui.incoming = card;
    changed();
    const to = rectOf(cardEl(card, '#hand'));
    Sound.play('pickup', { settle: willFly(from, to) ? 1900 * 0.72 : 0 });   // the showcase slides into the hand for its last 28%
    flight = flyCard({ card, from, to, flip: src < 0, showcase: true, duration: 1900 });
  } else {
    changed();
    Sound.play('pickup', { quiet: true });
    flight = flyCard({ card: src < 0 ? null : card, from, to: seatRect(p), duration: 560 });
  }
  await land(flight);
  ui.locked = false;
  render();
  afterTurn();
}

async function aiTurn() {
  const gen = ui.gen, st = ui.st, ai = st.turn, oracle = ui.match.skill === 'oracle';
  ui.busy = true;
  renderPrompt();
  await wait(450);
  if (gen !== ui.gen) return;

  if (st.phase === 'play') {
    if (ui.roundStudy) studyDecision(ui.roundStudy, st, ai);
    let move = oracle ? (await runAnalysis(st, ai, ORACLE_SAMPLES, null, ui.oracleSettings))?.best : null;
    if (gen !== ui.gen) return;
    if (!move) move = heuristicMove(st, Math.random, 0);
    ui.busy = false;
    await playOrDiscard(ai, { type: move.type, card: move.card });
    if (gen !== ui.gen) return;
    ui.busy = true;
    renderPrompt();
    await wait(300);
    if (gen !== ui.gen) return;
  }

  let src = oracle ? (await runAnalysis(st, ai, ORACLE_SAMPLES, null, ui.oracleSettings))?.best?.src : null;
  if (gen !== ui.gen) return;
  if (src == null) src = heuristicDraw(st, Math.random, 0);
  ui.busy = false;
  await drawCard(ai, src);
}

function endRound() {
  const st = ui.st, m = ui.match;
  if (!st.over) return;
  if (m.scored !== m.round) {
    const s0 = playerTotal(st, 0), s1 = playerTotal(st, 1);
    m.totals[0] += s0;
    m.totals[1] += s1;
    m.results.push([s0, s1]);
    m.scored = m.round;
    learnFromRound();
    finishRecord(s0, s1);
    changed();
  }
  showRoundEnd();
}

function nextRound() {
  const m = ui.match;
  if (isOnline()) {
    if (ui.me !== 0) return;          // the host deals every round
    m.round++;
    m.first ^= 1;
    ui.st = newRound(m.first, makeRng((Math.random() * 4294967296) >>> 0));
    ui.log = [];
    ui.selected = null;
    ui.analysis = null;
    commitOnline(null);
    closeDialog();
    changed();
    afterTurn();
    return;
  }
  m.round++;
  m.first ^= 1;
  closeDialog();
  startRound();
}

function playAgain() {
  closeDialog();
  if (isOnline()) {
    if (ui.me === 0) startOnlineMatch(ui.match.rounds);
    return;
  }
  newMatch(ui.match, true);
}

/* ---------- online play ---------- */
// One player id per browser TAB (sessionStorage survives a refresh of that tab), so two tabs
// on one computer can play each other, which is handy for trying online play alone.
function loadPid() {
  try {
    let id = sessionStorage.getItem(PID_KEY);
    if (!id) { id = `p${Math.random().toString(36).slice(2, 12)}`; sessionStorage.setItem(PID_KEY, id); }
    return id;
  } catch (e) { return `p${Math.random().toString(36).slice(2, 12)}`; }
}

async function initRoom() {
  if (!ONLINE_ENABLED) { net.ready = true; return; }
  if (window.claude && typeof window.claude.use === 'function' && typeof Online !== 'undefined' && Online.create) {
    try { net.room = await window.claude.use('room'); } catch (e) { net.room = null; }
  }
  net.ready = true;
  refreshMenuOnline();
  // Coming back from a page refresh in the middle of an online game: pick it straight back up.
  if (net.room && net.resumeOnReady) { net.resumeOnReady = false; rejoinOnline(); }
}

const onlineAvailable = () => net.ready && !!net.room;

function attachSession(session, rounds) {
  detachSession();
  net.session = session;
  net.rounds = rounds || net.rounds;
  net.seq = session.snapshot() ? session.snapshot().seq : 0;
  net.unsub.push(session.on('snapshot', (snap, info) => {
    if (info && info.fromOpponent) net.queue = net.queue.then(() => adoptSnapshot(snap)).catch(err => console.error(err));
  }));
  net.unsub.push(session.on('opponent', o => onOpponent(o)));
  net.unsub.push(session.on('error', e => toast(e && e.message ? escapeHTML(e.message) : 'The connection had a problem.')));
  saveOnline();
}

function detachSession() {
  net.unsub.forEach(f => { try { f(); } catch (e) { /* already gone */ } });
  net.unsub = [];
  net.session = null;
}

function leaveOnline() {
  const s = net.session;
  detachSession();
  if (s) { try { s.leave(); } catch (e) { /* already gone */ } }
  clearOnline();
  if (isOnline()) { ui.running = false; ui.match.started = false; }
}

function onOpponent(o) {
  const s = net.session;
  if (!s) return;
  if (o.connected && s.seat === 0 && !s.snapshot()) { startOnlineMatch(net.rounds); return; }
  if (ui.st && isOnline()) { renderSeat(); renderPrompt(); }
  if (o.connected === false && isOnline() && ui.running) toast(`${nm(ui.me ^ 1)} left the table. Their seat is kept for them.`);
}

// The host deals; the guest's page takes the table from the host's snapshot.
function startOnlineMatch(rounds) {
  const s = net.session;
  const [h, g] = s.names();
  ui.gen++;
  if (job) job.cancelled = true;
  ui.match = {
    mode: 'online', skill: null, rounds: rounds || 3,
    names: [h || 'Host', g || 'Guest'], round: 1, totals: [0, 0], results: [], first: 0, scored: 0, started: true,
  };
  ui.me = 0;
  ui.running = true;
  ui.busy = false;
  ui.locked = false;
  ui.st = newRound(0, makeRng((Math.random() * 4294967296) >>> 0));
  ui.log = [];
  ui.selected = null;
  ui.analysis = null;
  commitOnline(null);
  closeDialog();
  changed();
  afterTurn();
}

function commitOnline(last) {
  if (!isOnline() || !net.session) return;
  try {
    const snap = net.session.commit({ match: clone(ui.match), st: clone(ui.st), last: last || null });
    if (snap && typeof snap.seq === 'number') net.seq = snap.seq;
  } catch (e) {
    toast('Your move could not be sent. Check your connection.');
  }
  saveOnline();
}

// A newer table arrived from the other player: take it, and replay their move on screen.
async function adoptSnapshot(snap) {
  if (!snap || !snap.st || !snap.match || !net.session) return;
  if (typeof snap.seq === 'number' && snap.seq <= net.seq && ui.running && isOnline()) return;
  const joining = !ui.running || !isOnline();
  const last = snap.last;
  const step = !joining && ui.st && last && snap.seq === net.seq + 1 && last.p !== ui.me;
  const newRoundStarted = !joining && (snap.match.round !== ui.match.round || !last);

  // Where the opponent's card starts its flight, measured on the table as it was.
  let from = null;
  if (step) {
    if (last.kind === 'draw') from = rectOf(last.src < 0 ? document.querySelector('#board .deck-pool .card') : cardEl(topOf(ui.st.discard[last.src] || [])));
    else from = seatRect(last.p);
  }

  ui.match = clone(snap.match);
  ui.st = clone(snap.st);
  ui.me = net.session.seat;
  ui.running = true;
  ui.busy = false;
  ui.selected = null;
  net.seq = snap.seq;
  if (joining || newRoundStarted) { ui.log = []; closeDialog(); }
  if (step) note(last.p, last.kind, last.kind === 'draw' ? last.src : last.card, last.card);

  if (step && last.kind !== 'draw') {
    ui.incoming = last.card;
    ui.locked = true;
    changed();
    await land(flyCard({ card: last.card, from, to: rectOf(cardEl(last.card)), flip: true, duration: 640 }));
    ui.flare = { card: last.card, at: performance.now() };
    ui.locked = false;
    render();
    const pile = ui.st.exp[last.p][realmOf(last.card)];
    if (last.kind === 'play' && pile.length === CRYSTAL_AT && topOf(pile) === last.card) crystalToast(last.p, realmOf(last.card));
  } else if (step) {
    ui.locked = true;
    changed();
    await land(flyCard({ card: last.src < 0 ? null : last.card, from, to: seatRect(last.p), duration: 560 }));
    ui.locked = false;
    render();
  } else {
    changed();
  }
  saveOnline();
  if (ui.st.over) setTimeout(endRound, 700);
  else if (ui.st.turn === ui.me) requestAnalysis();
}

async function hostOnline(name, rounds) {
  const session = await Online.create({ room: net.room, pid: ui.pid, name });
  if (ui.match && ui.match.mode === 'ai') { ui.gen++; ui.running = false; }
  attachSession(session, rounds);
  showWaiting();
}

async function joinOnline(name, code) {
  const session = await Online.join({ room: net.room, pid: ui.pid, name, code });
  if (ui.match && ui.match.mode === 'ai') { ui.gen++; ui.running = false; }
  attachSession(session);
  const snap = session.snapshot();
  if (snap && snap.st) await adoptSnapshot(snap);
  else showGuestWaiting();
}

async function rejoinOnline() {
  const saved = loadOnline();
  if (!saved || !onlineAvailable()) return;
  try {
    // Rejoin with the id that held the seat (it may be another tab's, after the tab was closed).
    if (saved.pid) {
      ui.pid = saved.pid;
      try { sessionStorage.setItem(PID_KEY, ui.pid); } catch (e) { /* storage unavailable */ }
    }
    const session = await Online.resume({ room: net.room, pid: ui.pid, saved: saved.session });
    attachSession(session, saved.rounds);
    net.seq = 0;
    const snap = session.snapshot();
    if (snap && snap.st) { ui.running = false; await adoptSnapshot(snap); }
    else if (session.seat === 0) showWaiting(); else showGuestWaiting();
  } catch (e) {
    toast('That online game could not be reopened.');
    clearOnline();
    showMenu();
  }
}

function showWaiting() {
  const code = net.session.code.toUpperCase();
  openDialog(`
    <p class="eyebrow">Online game</p>
    <h2 id="dlgTitle">Waiting for your friend</h2>
    <p>Ask your friend to open this page, choose <strong>A friend online</strong>, then <strong>Join a game</strong>, and enter this code:</p>
    <p class="game-code" aria-label="Game code ${code.split('').join(' ')}">${code}</p>
    <p class="quiet">Your friend must be signed in to claude.ai, and you need to have shared this page with them by inviting their email address. Keep this page open; the game starts as soon as they join.</p>
    <div class="dlg-actions"><button type="button" class="act" data-dlg="leave-online" autofocus>Cancel</button></div>`);
}

function showGuestWaiting() {
  const [h] = net.session.names();
  openDialog(`
    <p class="eyebrow">Online game · ${escapeHTML(net.session.code.toUpperCase())}</p>
    <h2 id="dlgTitle">You’re in</h2>
    <p>Waiting for ${escapeHTML(h || 'the host')} to deal the cards…</p>
    <div class="dlg-actions"><button type="button" class="act" data-dlg="leave-online" autofocus>Leave</button></div>`);
}

const JOIN_ERRORS = {
  bad_code: 'That code doesn’t look right. Codes are 6 letters and numbers.',
  not_found: 'No game with that code is open right now. Check the code, and ask your friend to keep the page open.',
  full: 'That game already has two players.',
  unavailable: 'Online play isn’t available right now. Try again in a moment.',
};

/* ---------- dialogs ---------- */
let dialogOpts = null;
function openDialog(html, opts = {}) {
  const d = $('#dialog');
  d.className = 'dialog ' + (opts.wide ? 'wide' : '');
  d.innerHTML = html;
  $('#overlay').hidden = false;
  $('.shell').inert = true;   // nothing behind the dialog can be clicked or tabbed to
  dialogOpts = opts;
  d.scrollTop = 0;
  const f = d.querySelector('[autofocus]') || d.querySelector('button, input');
  if (f) f.focus({ preventScroll: true });
}
function closeDialog() {
  $('#overlay').hidden = true;
  $('.shell').inert = false;
  dialogOpts = null;
}

function realmRow() {
  if (REALM_UI.every(realmArt)) {
    return `<div class="realm-row portraits" aria-hidden="true">${REALM_UI.map(R => `<span class="portrait" style="background-image:url('${realmArt(R)}')"></span>`).join('')}</div>`;
  }
  return `<div class="realm-row" aria-hidden="true">${[10, 7, 4, 0, 9].map((v, r) => cardFace(v ? numberCard(r, v) : r * PER_REALM)).join('')}</div>`;
}

function onlineNote() {
  if (!net.ready) return 'Checking whether online play is available here…';
  if (!net.room) return 'Online play works on the published page at claude.ai, opened while signed in. Both players need access to the page: share it with your friend by inviting their email address (a public link isn’t enough).';
  return 'You and your friend each play on your own device. One of you creates a game and shares its code; the other joins with it.';
}

function showMenu(error) {
  const m = ui.match;
  const canContinue = !!ui.st && m.started !== false && m.mode === 'ai';
  const inOnlineGame = isOnline() && ui.running && !!net.session;
  const savedOnline = inOnlineGame || !ONLINE_ENABLED ? null : loadOnline();
  const mode = ONLINE_ENABLED && m.mode === 'online' ? 'online' : 'ai';
  const name0 = m.names[ui.me] && !['You', 'Host', 'Guest'].includes(m.names[ui.me]) ? m.names[ui.me] : '';
  openDialog(`
    <div class="menu-grid">
    <div class="menu-intro">
      <p class="eyebrow">A card game of risk and reward</p>
      <h2 class="title" id="dlgTitle">Mythic Pacts</h2>
      <p class="lede">Lead the Fairies, Sirens, Dryads, Angels and Nymphs. Every line you start costs 20 points, Pacts multiply the result, and a line of 8 cards earns a crystal worth 20 more.</p>
      ${realmRow()}
      ${scoreboardLine('oracle') ? `<p class="quiet small">${scoreboardLine('oracle')}</p>` : ''}
    </div>
    <form class="menu-form" id="menuForm" novalidate>
      <fieldset ${ONLINE_ENABLED ? '' : 'hidden'}>
        <legend>Opponent</legend>
        <div class="seg">
          <label><input type="radio" name="mode" id="modeAi" value="ai" ${mode === 'ai' ? 'checked' : ''}><span><b>The computer</b><small>Play on your own</small></span></label>
          <label><input type="radio" name="mode" id="modeOnline" value="online" ${mode === 'online' ? 'checked' : ''}><span><b>A friend online</b><small>Each of you on your own device</small></span></label>
        </div>
      </fieldset>
      <fieldset id="skillSet">
        <legend>Computer skill</legend>
        <div class="seg">
          <label><input type="radio" name="skill" id="skillApprentice" value="apprentice" ${m.skill === 'apprentice' ? 'checked' : ''}><span><b>Apprentice</b><small>Plays by rules of thumb</small></span></label>
          <label><input type="radio" name="skill" id="skillOracle" value="oracle" ${m.skill !== 'apprentice' ? 'checked' : ''}><span><b>Oracle</b><small>Simulates ${ORACLE_SAMPLES} possible endings before each move, and learns your habits</small></span></label>
        </div>
      </fieldset>
      <fieldset id="onlineSet">
        <legend>Online game</legend>
        <div class="seg">
          <label><input type="radio" name="online" id="onlineCreate" value="create" checked><span><b>Create a game</b><small>Get a code to send your friend</small></span></label>
          <label><input type="radio" name="online" id="onlineJoin" value="join"><span><b>Join a game</b><small>Enter your friend’s code</small></span></label>
        </div>
        <label class="code-field" id="codeWrap" for="gameCode">Game code<input id="gameCode" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7Q2MX"></label>
        <p class="online-note" id="onlineNote">${onlineNote()}</p>
      </fieldset>
      <fieldset id="roundsSet">
        <legend>Match length</legend>
        <div class="seg">
          <label><input type="radio" name="rounds" id="rounds1" value="1" ${m.rounds === 1 ? 'checked' : ''}><span><b>One round</b><small>About 10 minutes</small></span></label>
          <label><input type="radio" name="rounds" id="rounds3" value="3" ${m.rounds !== 1 ? 'checked' : ''}><span><b>Three rounds</b><small>Scores add up across rounds</small></span></label>
        </div>
      </fieldset>
      <div class="names">
        <label for="name0">Your name<input id="name0" maxlength="16" placeholder="You" value="${escapeHTML(name0)}"></label>
      </div>
      <p class="form-error" id="menuError" role="alert">${error ? escapeHTML(error) : ''}</p>
      <div class="menu-actions">
        <button type="submit" class="act primary" id="menuStart" autofocus>Start new game</button>
        ${canContinue ? '<button type="button" class="act" data-dlg="continue">Continue current game</button>' : ''}
        ${inOnlineGame ? '<button type="button" class="act" data-dlg="close">Back to the online game</button>' : ''}
        ${savedOnline ? `<button type="button" class="act" data-dlg="rejoin" ${onlineAvailable() ? '' : 'disabled'}>Rejoin online game ${escapeHTML(String(savedOnline.code || '').toUpperCase())}</button>` : ''}
        <button type="button" class="act ghost" data-dlg="rules">How to play</button>
        ${loadProfile().rounds ? `<button type="button" class="act ghost" data-dlg="forget">Make the Oracle forget your ${plural(loadProfile().rounds, 'round')}</button>` : ''}
      </div>
      ${inOnlineGame ? '<p class="quiet small">Starting a new game leaves the online game.</p>' : ''}
    </form>
    </div>`, { wide: true, dismiss: inOnlineGame || (canContinue && ui.running) ? closeDialog : canContinue ? continueGame : null, back: showMenu });

  const form = $('#menuForm');
  form.addEventListener('change', syncMenu);
  syncMenu();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#name0').value.trim();
    const rounds = +form.rounds.value;
    if (!ONLINE_ENABLED || form.mode.value === 'ai') {
      leaveOnline();
      closeDialog();
      newMatch({ skill: form.skill.value, rounds, names: [name || 'You', form.skill.value === 'oracle' ? 'Oracle' : 'Apprentice'] }, true);
      return;
    }
    if (!onlineAvailable()) return;
    const btn = $('#menuStart'), err = $('#menuError');
    const joining = form.online.value === 'join';
    btn.disabled = true;
    btn.dataset.busy = '1';
    btn.textContent = joining ? 'Joining…' : 'Creating…';
    err.textContent = '';
    leaveOnline();
    try {
      if (joining) await joinOnline(name || 'Guest', $('#gameCode').value);
      else await hostOnline(name || 'Host', rounds);
    } catch (ex) {
      err.textContent = JOIN_ERRORS[ex && ex.code] || 'Something went wrong connecting. Try again.';
      delete btn.dataset.busy;
      syncMenu();
    }
  });
}

// Show the parts of the menu that fit the chosen options.
function syncMenu() {
  const form = $('#menuForm');
  if (!form) return;
  const online = ONLINE_ENABLED && form.mode.value === 'online', joining = online && form.online.value === 'join';
  $('#skillSet').hidden = online;
  $('#onlineSet').hidden = !online;
  $('#codeWrap').hidden = !joining;
  $('#roundsSet').hidden = joining;
  $('#onlineNote').textContent = onlineNote();
  const btn = $('#menuStart');
  if (btn.dataset.busy) return;   // "Joining…" stays until the attempt finishes
  btn.textContent = !online ? 'Start new game' : joining ? 'Join game' : 'Create game';
  btn.disabled = online && !onlineAvailable();
}

function refreshMenuOnline() {
  if ($('#menuForm')) {
    syncMenu();
    const rejoin = document.querySelector('[data-dlg="rejoin"]');
    if (rejoin) rejoin.disabled = !onlineAvailable();
  }
}

function continueGame() {
  closeDialog();
  const st = ui.st;
  if (st.over) { ui.running = true; endRound(); return; }   // scores the round if needed, then shows results
  if (ui.running) return;
  ui.running = true;
  ui.busy = false;
  ui.locked = false;
  ui.me = 0;
  render();
  if (st.turn !== ui.me) aiTurn(); else requestAnalysis();
}

function showRules() {
  const back = dialogOpts && dialogOpts.back;
  openDialog(`
    <p class="eyebrow">How to play</p>
    <h2 id="dlgTitle">Mythic Pacts</h2>
    <p>Two players race to build profitable lines of mythical creatures. It plays like the card game Lost Cities.${ONLINE_ENABLED ? ' Play the computer, or a friend online on their own device.' : ''}</p>
    <h3>The cards</h3>
    <p>60 cards in five realms: <strong>Fairies, Sirens, Dryads, Angels and Nymphs</strong>. Each realm has the numbers 2 to 10 and three <strong>Pact</strong> cards. You hold 8 cards.</p>
    <h3>Your turn has two steps</h3>
    <ol>
      <li><strong>Play or discard.</strong> Drag a card from your hand onto your line for its realm, or onto that realm’s discard pile to throw it away. You can also tap the card, then tap where it should go.</li>
      <li><strong>Draw.</strong> Tap the deck, or the top card of any discard pile. You can’t take back the card you just threw away.</li>
    </ol>
    <h3>Lines only go up</h3>
    <ul>
      <li>Each card you add must be higher than the last one in that line. Gaps are allowed.</li>
      <li>Pacts must be played before any numbers in that line.</li>
      <li>The round ends the moment someone draws the last card from the deck.</li>
    </ul>
    <h3>Scoring each line you started</h3>
    <ul>
      <li>Add up the numbers and <strong>subtract 20</strong>, the cost of starting the line.</li>
      <li>Multiply by <strong>one more than the number of Pacts</strong>: 1 Pact doubles it, 2 Pacts triple it, 3 Pacts quadruple it. Losses get multiplied too.</li>
      <li><strong>Crystal:</strong> a line of 8 or more cards earns a crystal worth <strong>+20</strong>, added after multiplying.</li>
      <li>Lines you never started score nothing.</li>
    </ul>
    <div class="example" style="--cc:${REALM_UI[0].hex}">
      <span class="cards">${[0, numberCard(0, 3), numberCard(0, 5), numberCard(0, 8), numberCard(0, 9)].map(c => cardFace(c)).join('')}</span>
      <code>(3 + 5 + 8 + 9 − 20) × 2 = +10</code>
    </div>
    <h3>The Odds panel</h3>
    <p>It counts which cards you haven’t seen yet, shows the chance each one reaches you, and simulates possible endings of the round to estimate which move leaves you furthest ahead. It flags discards your opponent could use.</p>
    <h3>Keyboard</h3>
    <p>Tab to a card and press Enter to pick it, then press <strong>P</strong> to play it or <strong>D</strong> to discard it.</p>
    <div class="dlg-actions"><button type="button" class="act primary" data-dlg="${back ? 'back' : 'close'}" autofocus>${back ? 'Back' : 'Got it'}</button></div>`,
    { wide: false, dismiss: back || closeDialog, backFn: back });
}

function breakdownHTML(p) {
  const st = ui.st;
  let rows = '', total = 0;
  for (let r = 0; r < REALMS; r++) {
    const R = REALM_UI[r], s = scorePile(st.exp[p][r]);
    total += s.total;
    rows += `<tr style="--cc:${R.hex}"><td><span class="realm-tag"><i class="ico">${SIGIL[R.key]}</i>${R.name}</span></td>`;
    rows += s.cards
      ? `<td>${s.sum}</td><td>−20</td><td>${s.pacts ? '×' + s.mult : '—'}</td><td>${s.crystal ? `<span class="crystal">${crystalMark(R)}+20</span>` : `${s.cards}/8`}</td><td class="${s.total < 0 ? 'neg' : ''}">${signed(s.total)}</td></tr>`
      : '<td colspan="4" class="notyet">Not started</td><td>0</td></tr>';
  }
  return `<div><div class="who"><b>${who(p) === 'You' ? `${nm(p)} (you)` : nm(p)}</b><span class="${total < 0 ? 'neg' : ''}">${signed(total)}</span></div>`
    + `<div class="table-wrap"><table class="bd"><thead><tr><th>Realm</th><th>Sum</th><th>Cost</th><th>Pacts</th><th>Crystal</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function showRoundEnd() {
  const m = ui.match, [s0, s1] = m.results[m.results.length - 1];
  const last = m.round >= m.rounds;
  const diff = Math.abs(s0 - s1);
  const winLine = (p, what) => p === ui.me ? `You win ${what}` : `${nm(p)} wins ${what}`;
  const roundLine = s0 === s1 ? 'The round is a tie' : `${winLine(s0 > s1 ? 0 : 1, 'the round')} by ${diff}`;
  let matchPart = '';
  if (m.rounds > 1) {
    matchPart = `<h3>Match</h3><div class="table-wrap"><table class="match-table"><thead><tr><th></th>${m.results.map((_, i) => `<th>Round ${i + 1}</th>`).join('')}<th>Total</th></tr></thead><tbody>`
      + [0, 1].map(p => `<tr><td>${nm(p)}</td>${m.results.map(r => `<td>${signed(r[p])}</td>`).join('')}<td>${m.totals[p]}</td></tr>`).join('')
      + '</tbody></table></div>';
  }
  let headline = roundLine;
  if (last && m.rounds > 1) {
    const [t0, t1] = m.totals;
    headline = t0 === t1 ? 'The match is a tie' : `${winLine(t0 > t1 ? 0 : 1, 'the match')} ${Math.max(t0, t1)} to ${Math.min(t0, t1)}`;
  }
  // Online, the host deals the next round; the guest waits for it.
  const guestWaits = isOnline() && ui.me !== 0;
  let actions;
  if (guestWaits) {
    actions = `<p class="quiet">${last ? `Waiting for ${nm(0)} to start a new match.` : `Waiting for ${nm(0)} to deal round ${m.round + 1}.`}</p>`
      + '<button type="button" class="act ghost" data-dlg="close">View the table</button><button type="button" class="act ghost" data-dlg="leave-online">Leave online game</button>';
  } else {
    actions = (last ? '<button type="button" class="act primary" data-dlg="again" autofocus>Play again</button>'
                    : `<button type="button" class="act primary" data-dlg="next" autofocus>Start round ${m.round + 1}</button>`)
      + (isOnline() ? '<button type="button" class="act ghost" data-dlg="leave-online">Leave online game</button>'
                    : last ? '<button type="button" class="act" data-dlg="menu">Change settings</button>' : '')
      + '<button type="button" class="act ghost" data-dlg="close">View the table</button>';
  }
  openDialog(`
    <p class="eyebrow">${last ? (m.rounds > 1 ? 'Final result' : 'Round over') : `Round ${m.round} of ${m.rounds} complete`}</p>
    <h2 id="dlgTitle">${headline}</h2>
    ${!isOnline() && scoreboardLine(m.skill) ? `<p class="quiet small">${scoreboardLine(m.skill)}</p>` : ''}
    ${last && m.rounds > 1 ? `<p>${roundLine} (round ${m.round}).</p>` : ''}
    <div class="results">${breakdownHTML(ui.me)}${breakdownHTML(ui.me ^ 1)}</div>
    ${matchPart}
    <div class="dlg-actions">${actions}</div>`, { wide: true, dismiss: closeDialog });
}

/* ---------- saving ---------- */
function serialize() {
  return { v: 3, match: ui.match, st: ui.st, log: ui.log, showOdds: ui.showOdds, running: ui.running };
}
function save() {
  if (isOnline()) { saveOnline(); return; }
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize())); } catch (e) { /* storage unavailable */ }
}
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return s && s.v === 3 && s.st && s.match && s.match.mode === 'ai' && Array.isArray(s.st.deck) ? s : null;
  } catch (e) { return null; }
}
function restore(s) {
  ui.match = s.match;
  ui.st = s.st;
  ui.log = s.log || [];
  ui.showOdds = s.showOdds !== false;
  ui.me = 0;
  ui.running = false;
}
// The online game is saved for this tab (to survive a refresh) and for the browser
// (to rejoin after closing the tab). This tab's own copy wins when there is one.
function saveOnline() {
  if (!net.session) return;
  const data = JSON.stringify({ v: 1, code: net.session.code, rounds: net.rounds, pid: ui.pid, session: net.session.save() });
  try { sessionStorage.setItem(ONLINE_KEY, data); } catch (e) { /* storage unavailable */ }
  try { localStorage.setItem(ONLINE_KEY, data); } catch (e) { /* storage unavailable */ }
}
function loadOnline() {
  for (const store of ['sessionStorage', 'localStorage']) {
    try {
      const s = JSON.parse(window[store].getItem(ONLINE_KEY));
      if (s && s.v === 1 && s.session) return s;
    } catch (e) { /* storage unavailable */ }
  }
  return null;
}
function clearOnline() {
  try { sessionStorage.removeItem(ONLINE_KEY); } catch (e) { /* storage unavailable */ }
  try { localStorage.removeItem(ONLINE_KEY); } catch (e) { /* storage unavailable */ }
}

/* ---------- small helpers ---------- */
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function drawStars() {
  const cv = $('#stars'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const rnd = makeRng(11);
  const n = Math.round(w * h / 8000);
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(237,232,247,${(0.12 + rnd() * 0.45).toFixed(2)})`;
    g.beginPath();
    g.arc(rnd() * w, rnd() * h, rnd() * 1.1 + 0.2, 0, Math.PI * 2);
    g.fill();
  }
}

/* ---------- dragging a card from the hand to the board ---------- */
let drag = null;
let suppressClick = false;

$('#hand').addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const b = e.target.closest('[data-card]');
  if (!b || b.disabled || !isHumanTurn() || ui.st.phase !== 'play') return;
  drag = { c: +b.dataset.card, x: e.clientX, y: e.clientY, id: e.pointerId, el: b, started: false, over: null };
});
window.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return;
    startDrag();
  }
  moveDrag(e.clientX, e.clientY);
});
window.addEventListener('pointerup', e => { if (drag && e.pointerId === drag.id) endDrag(); });
window.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) endDrag(true); });

function startDrag() {
  const r = drag.el.getBoundingClientRect();
  drag.started = true;
  drag.dx = drag.x - r.left;
  drag.dy = drag.y - r.top;
  const g = document.createElement('div');
  g.className = 'drag-ghost';
  g.style.width = `${r.width}px`;
  g.style.height = `${r.height}px`;
  g.style.setProperty('--fw', `${r.width}px`);
  g.innerHTML = cardFace(drag.c);
  document.body.appendChild(g);
  drag.ghost = g;
  document.body.classList.add('is-dragging');
  ui.selected = drag.c;
  ui.dragCard = drag.c;
  Sound.play('click');
  render();   // the card's targets light up
}

function moveDrag(x, y) {
  drag.ghost.style.transform = `translate(${x - drag.dx}px, ${y - drag.dy}px) rotate(-3deg) scale(1.05)`;
  const t = dropTargetAt(x, y);
  if (t !== drag.over) {
    if (drag.over) drag.over.classList.remove('hover');
    drag.over = t;
    if (t) t.classList.add('hover');
  }
}

// The card's own line (when it can go there) or its realm's discard pile.
function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const t = el && el.closest('#board [data-stack], #board [data-well]');
  if (!t || t.disabled) return null;
  const r = realmOf(drag.c);
  if (t.dataset.stack !== undefined) return +t.dataset.stack === r ? t : null;
  return +t.dataset.well === r ? t : null;
}

async function endDrag(cancelled) {
  const d = drag;
  drag = null;
  if (!d.started) return;   // a plain tap: the click handler picks the card
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  document.body.classList.remove('is-dragging');
  if (d.over) d.over.classList.remove('hover');
  const ghostRect = d.ghost.getBoundingClientRect();
  ui.dragCard = null;
  if (!cancelled && d.over && isHumanTurn()) {
    d.ghost.remove();
    await playOrDiscard(ui.me, { type: d.over.dataset.stack !== undefined ? 'play' : 'discard', card: d.c }, ghostRect);
    return;
  }
  // Dropped somewhere else: the card glides back into the hand and stays picked.
  render();
  const home = rectOf(document.querySelector(`#hand [data-card="${d.c}"]`));
  if (home && !reduceMotion()) {
    await d.ghost.animate([{ transform: d.ghost.style.transform }, { transform: `translate(${home.left}px, ${home.top}px)` }],
      { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' }).finished.catch(() => {});
  }
  d.ghost.remove();
}

/* ---------- input ---------- */
$('#hand').addEventListener('click', e => {
  if (suppressClick) return;
  const b = e.target.closest('[data-card]');
  if (!b || b.disabled || !isHumanTurn()) return;
  const c = +b.dataset.card;
  // A double-click plays the card straight away. (The first click re-renders the hand,
  // so a separate dblclick listener would never fire; the click's detail count still does.)
  if (e.detail === 2 && canPlay(ui.st.exp[ui.me][realmOf(c)], c)) {
    playOrDiscard(ui.me, { type: 'play', card: c }, rectOf(b));
    return;
  }
  ui.selected = ui.selected === c ? null : c;
  Sound.play('click');
  render();
});
$('#board').addEventListener('click', e => {
  if (!isHumanTurn()) return;
  const st = ui.st, sel = ui.selected;
  const well = e.target.closest('[data-well]'), stack = e.target.closest('[data-stack]'), deck = e.target.closest('[data-deck]');
  if (st.phase === 'play' && sel != null) {
    const from = rectOf(document.querySelector(`#hand [data-card="${sel}"]`));
    if (well && !well.disabled && +well.dataset.well === realmOf(sel)) playOrDiscard(ui.me, { type: 'discard', card: sel }, from);
    else if (stack && +stack.dataset.stack === realmOf(sel)) playOrDiscard(ui.me, { type: 'play', card: sel }, from);
  } else if (st.phase === 'draw') {
    if (deck && !deck.disabled) drawCard(ui.me, -1);
    else if (well && !well.disabled) drawCard(ui.me, +well.dataset.well);
  }
});
$('#prompt').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b && b.dataset.act === 'results') showRoundEnd();
});
$('#dialog').addEventListener('click', e => {
  const b = e.target.closest('[data-dlg]');
  if (!b || b.disabled) return;
  const a = b.dataset.dlg;
  if (a === 'continue') continueGame();
  else if (a === 'rules') {
    // Keep whatever was chosen in the menu when coming back from the rules.
    const f = $('#menuForm');
    if (f) {
      const v = { mode: f.mode.value, skill: f.skill.value, online: f.online.value, code: $('#gameCode').value, rounds: f.rounds.value, n0: f.name0.value };
      dialogOpts.back = () => {
        showMenu();
        const g = $('#menuForm');
        g.mode.value = v.mode; g.skill.value = v.skill; g.online.value = v.online; g.rounds.value = v.rounds;
        $('#gameCode').value = v.code; g.name0.value = v.n0;
        syncMenu();
      };
    }
    showRules();
  }
  else if (a === 'back') (dialogOpts && dialogOpts.backFn ? dialogOpts.backFn : closeDialog)();
  else if (a === 'close') closeDialog();
  else if (a === 'next') nextRound();
  else if (a === 'again') playAgain();
  else if (a === 'menu') showMenu();
  else if (a === 'rejoin') { closeDialog(); rejoinOnline(); }
  else if (a === 'leave-online') { leaveOnline(); showMenu(); }
  else if (a === 'forget') {
    try { localStorage.removeItem(PROFILE_KEY); } catch (e) { /* storage unavailable */ }
    ui.oracleSettings = {};
    toast('The Oracle has forgotten what it learned about your play.');
    showMenu();
  }
});
$('#btnOdds').addEventListener('click', () => {
  ui.showOdds = !ui.showOdds;
  save();
  render();
  if (ui.showOdds && !analysisFresh()) requestAnalysis();
});
$('#btnRules').addEventListener('click', () => showRules());

// Full screen: the browser's own full-screen mode, where the page allows it.
// Sound effects: browsers allow audio only after a tap or key press, so every one wakes it up.
window.addEventListener('pointerdown', Sound.unlock, true);
window.addEventListener('keydown', Sound.unlock, true);
const syncSound = () => $('#btnSound').setAttribute('aria-pressed', String(Sound.isOn()));
syncSound();
$('#btnSound').addEventListener('click', () => {
  Sound.setOn(!Sound.isOn());
  syncSound();
  Sound.play('click');
  toast(Sound.isOn() ? 'Sound on.' : 'Sound off.');
});

const fullEl = () => document.fullscreenElement || document.webkitFullscreenElement;
$('#btnFull').hidden = false;   // where the page may not go full screen itself, the button explains the browser's shortcut
$('#btnFull').addEventListener('click', async () => {
  try {
    if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) throw new Error('not allowed here');
    if (fullEl()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else await (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen).call(document.documentElement);
  } catch (e) {
    toast('Full screen isn’t allowed here. Use your browser’s own full screen instead: Control-Command-F on a Mac, F11 on Windows.');
  }
});
const syncFull = () => {
  const on = !!fullEl();
  $('#btnFull').setAttribute('aria-pressed', String(on));
  $('#btnFull').textContent = on ? 'Exit full screen' : 'Full screen';
  setTimeout(() => { drawStars(); if (ui.st) fitTable(); }, 120);
};
document.addEventListener('fullscreenchange', syncFull);
document.addEventListener('webkitfullscreenchange', syncFull);
$('#btnMenu').addEventListener('click', () => showMenu());
document.addEventListener('keydown', e => {
  if (!$('#overlay').hidden) {
    if (e.key === 'Escape' && dialogOpts && dialogOpts.dismiss) { e.preventDefault(); dialogOpts.dismiss(); }
    return;
  }
  if (e.target.matches && e.target.matches('input')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;   // leave browser shortcuts like Cmd+P alone
  if (e.key === 'Escape' && ui.selected != null) { ui.selected = null; render(); }
  if (!isHumanTurn() || ui.st.phase !== 'play' || ui.selected == null) return;
  const from = rectOf(document.querySelector(`#hand [data-card="${ui.selected}"]`));
  if (e.key === 'p' || e.key === 'P') { if (canPlay(ui.st.exp[ui.me][realmOf(ui.selected)], ui.selected)) playOrDiscard(ui.me, { type: 'play', card: ui.selected }, from); }
  else if (e.key === 'd' || e.key === 'D') playOrDiscard(ui.me, { type: 'discard', card: ui.selected }, from);
});
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { drawStars(); if (ui.st) fitTable(); }, 150);
});

/* ---------- start ---------- */
function boot(data) {
  drawStars();
  $('#brandGem').innerHTML = CRYSTAL_SVG;
  applyTableArt();
  ui.pid = loadPid();
  const hot = data && data.st && data.match ? data : null;
  const saved = hot && hot.match.mode === 'ai' ? hot : loadSaved();
  if (saved) restore(saved);
  else newMatch({ skill: 'oracle', rounds: 3, names: ['You', 'Oracle'] }, false);
  render();
  if (ONLINE_ENABLED && hot && hot.match.mode === 'online' && loadOnline()) net.resumeOnReady = true;   // refreshed mid-game: rejoin quietly
  else if (hot && hot.running && saved) continueGame();
  else showMenu();
  initRoom();
  initStore();
  if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
    window.claude.hot.snapshot(() => isOnline() ? { match: ui.match, st: ui.st, running: ui.running } : serialize());
  }
}
window.claude?.hot?.ready ? window.claude.hot.ready(boot) : boot(window.claude?.hot?.data ?? {});
