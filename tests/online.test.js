/* Online play tests for src/online.js. Pure JavaScript, no browser needed.
   Run:  tests/run.sh   (uses macOS's built-in JavaScriptCore; src/engine.js and src/online.js load first)

   The real transport is the artifact platform's "room" capability. FakeNet below reproduces
   its documented behaviour on a fake clock, so every test is deterministic and fast:
   - join() resolves after a round trip. A newcomer sees itself first and each page already
     there a few hundred ms later, so the first onPeers delivery does not show the room yet.
   - presence(patch) merges into the page's own object (a top-level null removes a field), is
     applied locally at once and reaches others after a network delay. Past 4096 bytes of
     JSON, or with keys that aren't identifiers, or nested deeper than 8, it rejects
     invalid_argument and changes nothing.
   - onPeers delivers at most once per 16 ms frame with the net change, and its first delivery
     lists everyone as joined. Peers and presence are frozen and keep their identity until
     they change; peer/by/isMe/sameTab/kind are stamped by the "platform".
   - Leaving or closing a page clears its presence for everyone. A disconnect looks like a
     leave to the others; on reconnect the page's presence is re-asserted and its view of
     the room reconciled.
   - Tests can drop a page's presence updates, end a room with an error code, or make
     join() fail. Room events (emit) are refused, as they are for non-editors. */

let failures = 0, checks = 0;
function check(cond, what) {
  checks++;
  if (!cond) { failures++; print(`FAIL ${what}`); }
}
function eq(actual, expected, what) {
  checks++;
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) { failures++; print(`FAIL ${what}: got ${a}, expected ${b}`); }
}
// JSON with sorted keys, written independently of online.js's own.
function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canon(x[k])).join(',') + '}';
  return JSON.stringify(x);
}
const same = (a, b) => canon(a) === canon(b);
const utf8 = s => unescape(encodeURIComponent(s)).length;   // independent of online.js's byte counter
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); };

/* ---------- a fake clock: tests move time forward by hand ---------- */
// Let every queued promise job run. jsc's drainMicrotasks() does it at once; a real timer also
// works (it fires only after every promise job) but macOS may delay it when the machine is busy.
const realTick = typeof drainMicrotasks === 'function'
  ? async () => { drainMicrotasks(); await null; drainMicrotasks(); }
  : () => new Promise(res => setTimeout(res, 0));

function makeClock() {
  let now = 0, ids = 0;
  const queue = [];
  return {
    now: () => now,
    setTimeout: (fn, ms) => { queue.push({ id: ++ids, at: now + Math.max(0, Number(ms) || 0), fn, dead: false }); return ids; },
    clearTimeout: id => { for (const t of queue) if (t.id === id) t.dead = true; },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await realTick();
        let k = -1;
        for (let i = 0; i < queue.length; i++) {
          const t = queue[i];
          if (t.at <= end && (k < 0 || t.at < queue[k].at || (t.at === queue[k].at && t.id < queue[k].id))) k = i;
        }
        if (k < 0) break;
        const t = queue.splice(k, 1)[0];
        if (t.dead) continue;
        now = t.at;
        t.fn();
      }
      now = end;
      await realTick();
    },
  };
}

/* ---------- a fake "room" platform ---------- */
const ROOM_NAME = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const PROTO_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype).concat('prototype'));
const roomError = (code, message) => Object.assign(new Error(message || code), { code });

function deepFreeze(x) {
  if (x && typeof x === 'object') { for (const v of Object.values(x)) deepFreeze(v); Object.freeze(x); }
  return x;
}
// The platform's presence rules: plain JSON, identifier keys, at most 8 levels deep.
function presenceOk(x, depth) {
  if (x === null || typeof x === 'boolean' || typeof x === 'string') return true;
  if (typeof x === 'number') return Number.isFinite(x);
  if (typeof x !== 'object' || depth > 8) return false;
  if (Array.isArray(x)) return x.every(v => presenceOk(v, depth + 1));
  return Object.keys(x).every(k => IDENT.test(k) && !PROTO_NAMES.has(k) && presenceOk(x[k], depth + 1));
}

class FakeNet {
  constructor(clock, opts = {}) {
    this.clock = clock;
    this.latency = opts.latency ?? 30;         // ms for presence to reach another page
    this.jitter = opts.jitter ?? 0;            // extra random delay; one sender's updates still arrive in order
    this.discoverMs = opts.discoverMs ?? 300;  // a newcomer hears of the first page already there after this long...
    this.staggerMs = opts.staggerMs ?? 150;    // ...and of each further one this much later
    this.frameMs = 16;
    this.limit = 4096;
    this.rnd = makeRng(opts.seed ?? 7);
    this.rooms = new Map();      // room name -> Set of FakeRoom objects the server has
    this.version = 0;            // stamps every change, so an older delivery never overwrites a newer one
    this.arrivals = new Map();   // "from>to" -> latest arrival time scheduled
    this.joinFailures = [];      // error codes for the next join() calls
    this.labels = 0;
    this.emits = 0;
    this.dropped = 0;
  }
  page(opts) { return new FakePage(this, opts || {}); }
  members(name) { return this.rooms.get(name) || new Set(); }
  send(from, to, presence, version) {
    const key = from.page.label + '>' + to.page.label;
    const at = Math.max(this.clock.now() + this.latency + this.rnd() * this.jitter, this.arrivals.get(key) || 0);
    this.arrivals.set(key, at);
    this.clock.setTimeout(() => to.receive(from, presence, version), at - this.clock.now());
  }
  // A presence call: may be lost when a test asks for it.
  broadcast(from) {
    const version = ++this.version;
    if (from.page.dropping > 0) { from.page.dropping--; this.dropped++; return; }
    from.served = { presence: from.mine, version };
    for (const to of this.members(from.name)) if (to !== from) this.send(from, to, from.mine, version);
  }
  // Joining or reconnecting: the platform itself asserts the page's presence. Never lost.
  announce(from) {
    const version = ++this.version;
    from.served = { presence: from.mine, version };
    for (const to of this.members(from.name)) if (to !== from) this.send(from, to, from.mine, version);
  }
  enter(r) {
    if (!this.rooms.has(r.name)) this.rooms.set(r.name, new Set());
    const set = this.rooms.get(r.name), already = [...set];
    set.add(r);
    this.announce(r);
    this.clock.setTimeout(() => r.reconcile(false), this.latency);   // the first answer: just this page
    already.forEach((m, i) => this.clock.setTimeout(() => {
      if (this.members(r.name).has(m) && m.served) r.receive(m, m.served.presence, m.served.version);
    }, this.discoverMs + this.staggerMs * i));
  }
  exit(r) {
    const set = this.rooms.get(r.name);
    if (!set || !set.has(r)) return;
    set.delete(r);
    const version = ++this.version;
    for (const to of set) this.send(r, to, null, version);
  }
  reenter(r) {
    if (!this.rooms.has(r.name)) this.rooms.set(r.name, new Set());
    this.rooms.get(r.name).add(r);
    this.announce(r);
    this.clock.setTimeout(() => r.reconcile(true), this.latency);
  }
}

class FakeRoom {
  constructor(page, name) {
    this.page = page;
    this.net = page.net;
    this.name = name;
    this.alive = true;
    this.endCode = null;
    this.mine = deepFreeze({});
    this.mineText = '{}';
    this.served = null;          // what the server last got from this page
    this.view = new Map();       // label -> frozen Peer, as this page sees the room
    this.seen = new Map();       // label -> newest version applied
    this.cache = null;
    this.answered = false;
    this.listeners = [];
    this.connListeners = [];
    this.frame = false;
    this.maxBytes = 0;
  }
  // ---- the NamedRoom API ----
  presence(patch) {
    if (!this.alive) return Promise.reject(roomError(this.endCode, 'not in this room'));
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return Promise.reject(roomError('invalid_argument', 'presence needs an object'));
    const merged = Object.assign({}, this.mine);
    for (const k of Object.keys(patch)) { if (patch[k] === null) delete merged[k]; else merged[k] = patch[k]; }
    let text;
    try { text = JSON.stringify(merged); } catch (e) { return Promise.reject(roomError('invalid_argument', 'not JSON')); }
    if (!presenceOk(merged, 1)) return Promise.reject(roomError('invalid_argument', 'keys must be identifiers and nesting at most 8 deep'));
    const bytes = utf8(text);
    if (bytes > this.net.limit) return Promise.reject(roomError('invalid_argument', `presence is ${bytes} bytes; the limit is ${this.net.limit}`));
    this.maxBytes = Math.max(this.maxBytes, bytes);
    if (text === this.mineText) return Promise.resolve();   // nothing changed
    this.mineText = text;
    this.mine = deepFreeze(JSON.parse(text));
    this.setSelf();
    if (this.page.connected && this.net.members(this.name).has(this)) this.net.broadcast(this);
    return Promise.resolve();
  }
  peers() {
    if (!this.cache) this.cache = Object.freeze([...this.view.values()]);
    return this.cache;
  }
  onPeers(handler, onError) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    const l = { handler, onError, first: true, pending: new Map(), dead: false };
    this.listeners.push(l);
    this.scheduleFrame();
    return () => { l.dead = true; this.listeners = this.listeners.filter(x => x !== l); };
  }
  connected() { return this.alive && this.page.connected; }
  onConnection(handler, onError) {
    const l = { handler, onError, dead: false };
    this.connListeners.push(l);
    Promise.resolve().then(() => { if (!l.dead && this.alive) handler(this.connected()); });
    return () => { l.dead = true; this.connListeners = this.connListeners.filter(x => x !== l); };
  }
  leave() {
    if (this.alive) {
      this.alive = false;
      this.endCode = 'invalid_argument';
      for (const l of this.listeners.concat(this.connListeners)) l.dead = true;
      this.listeners = [];
      this.connListeners = [];
      this.net.exit(this);
      if (this.page.rooms.get(this.name) === this) this.page.rooms.delete(this.name);
    }
    return Promise.resolve();
  }
  emit() { this.net.emits++; return Promise.reject(roomError('not_permitted', 'topics are admin-only')); }
  on() { return () => {}; }

  // ---- the platform's side ----
  receive(from, presence, version) {
    if (!this.alive || !this.page.connected) return;
    const label = from.page.label;
    if (version <= (this.seen.get(label) || 0)) return;
    this.seen.set(label, version);
    const old = this.view.get(label);
    if (presence === null) {
      if (old) { this.view.delete(label); this.changed(label, 'left', old); }
      return;
    }
    if (old && old.presence === presence) return;
    const src = from.page, me = this.page;
    this.view.set(label, Object.freeze({
      peer: label, by: src.by, isMe: src.kind === 'viewer' && src.by !== null && src.by === me.by, sameTab: false,
      kind: src.kind, guest: false, presence, updatedAt: this.net.clock.now(),
    }));
    this.changed(label, old ? 'updated' : 'joined', null);
  }
  setSelf() {
    if (!this.answered) return;
    const label = this.page.label, old = this.view.get(label);
    if (old && old.presence === this.mine) return;
    this.view.set(label, Object.freeze({
      peer: label, by: this.page.by, isMe: true, sameTab: true, kind: this.page.kind, guest: false,
      presence: this.mine, updatedAt: this.net.clock.now(),
    }));
    this.changed(label, old ? 'updated' : 'joined', null);
  }
  // The platform answers: this page itself, and after a reconnect everyone else as they are now.
  reconcile(everyone) {
    if (!this.alive || !this.page.connected) return;
    this.answered = true;
    this.setSelf();
    if (!everyone) return;
    const here = new Set();
    for (const m of this.net.members(this.name)) {
      if (m === this) continue;
      here.add(m.page.label);
      if (m.served) this.receive(m, m.served.presence, m.served.version);
    }
    for (const [label, old] of [...this.view]) {
      if (label !== this.page.label && !here.has(label)) { this.view.delete(label); this.changed(label, 'left', old); }
    }
  }
  changed(label, kind, old) {
    this.cache = null;
    for (const l of this.listeners) {
      const prev = l.pending.get(label);
      if (!prev) l.pending.set(label, { kind, old });
      else if (prev.kind === 'joined') { if (kind === 'left') l.pending.delete(label); }
      else if (prev.kind === 'left') { if (kind === 'joined') l.pending.set(label, { kind: 'updated', old: null }); }
      else if (kind === 'left') l.pending.set(label, { kind: 'left', old });
    }
    this.scheduleFrame();
  }
  scheduleFrame() {
    if (this.frame) return;
    this.frame = true;
    this.net.clock.setTimeout(() => this.flush(), this.net.frameMs);
  }
  flush() {
    this.frame = false;
    if (!this.alive) return;
    const peers = this.peers();
    for (const l of this.listeners.slice()) {
      if (l.dead) continue;
      let change;
      if (l.first) {
        if (!this.answered) continue;   // the first delivery waits for the platform's first answer
        l.first = false;
        l.pending.clear();
        change = { peers, joined: peers, left: [], updated: [] };
      } else {
        if (!l.pending.size) continue;
        const joined = [], left = [], updated = [];
        for (const [label, p] of l.pending) {
          if (p.kind === 'left') left.push(p.old);
          else (p.kind === 'joined' ? joined : updated).push(this.view.get(label));
        }
        l.pending.clear();
        change = { peers, joined, left, updated };
      }
      l.handler(Object.freeze(change));
    }
  }
  tellConnection() {
    for (const l of this.connListeners.slice()) {
      Promise.resolve().then(() => { if (!l.dead && this.alive) l.handler(this.connected()); });
    }
  }
  // The room ends for this page (the platform could not keep it): every listener hears one error.
  end(code) {
    if (!this.alive) return;
    this.alive = false;
    this.endCode = code;
    const all = this.listeners.concat(this.connListeners);
    this.listeners = [];
    this.connListeners = [];
    this.net.exit(this);
    if (this.page.rooms.get(this.name) === this) this.page.rooms.delete(this.name);
    for (const l of all) {
      l.dead = true;
      if (l.onError) Promise.resolve().then(() => l.onError({ code, message: `room ended: ${code}` }));
    }
  }
}

// One open document of the artifact: what claude.use("room") returns on that page.
class FakePage {
  constructor(net, opts) {
    this.net = net;
    this.label = 'peer' + (++net.labels);
    this.by = opts.by === undefined ? null : opts.by;
    this.kind = opts.kind || 'viewer';
    this.connected = true;
    this.closed = false;
    this.dropping = 0;
    this.rooms = new Map();
  }
  join(name) {
    if (this.closed) return Promise.reject(roomError('upstream_error', 'page closed'));
    if (typeof name !== 'string' || !ROOM_NAME.test(name)) return Promise.reject(roomError('invalid_argument', 'bad room name'));
    if (this.net.joinFailures.length) return Promise.reject(roomError(this.net.joinFailures.shift(), 'join refused'));
    const existing = this.rooms.get(name);
    if (existing) return Promise.resolve(existing);
    const r = new FakeRoom(this, name);
    this.rooms.set(name, r);
    if (this.connected) this.net.enter(r);
    return new Promise(res => this.net.clock.setTimeout(() => res(r), this.net.latency));
  }
  disconnect() {
    if (!this.connected) return;
    this.connected = false;
    for (const r of this.rooms.values()) { this.net.exit(r); r.tellConnection(); }
  }
  reconnect() {
    if (this.connected || this.closed) return;
    this.connected = true;
    for (const r of this.rooms.values()) { this.net.reenter(r); r.tellConnection(); }
  }
  close() {   // the tab is closed or reloaded: every room is left
    for (const r of [...this.rooms.values()]) r.leave();
    this.closed = true;
    this.connected = false;
  }
  drop(n) { this.dropping += n; }   // the next n presence updates from this page are lost
  kill(name, code) { const r = this.rooms.get(name); if (r) r.end(code); }
  presenceIn(name) { const r = this.rooms.get(name); return r ? r.mine : null; }
  bytesIn(name) { const r = this.rooms.get(name); return r ? utf8(r.mineText) : 0; }
}

/* ---------- helpers ---------- */
function makeWorld(opts = {}) {
  const clock = makeClock();
  const net = new FakeNet(clock, opts);
  const w = {
    clock, net,
    timers: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    wait: ms => clock.advance(ms),
    // Move fake time on until the promise settles; fail loudly rather than hang.
    async settle(promise, ms = 3000) {
      const box = track(promise);
      for (let t = 0; t < ms && !box.done; t += 50) await clock.advance(50);
      if (!box.done) throw Object.assign(new Error(`still pending after ${ms} ms of fake time`), { code: 'test_pending' });
      if (box.error) throw box.error;
      return box.value;
    },
    async rejection(promise, ms = 10000) {
      try { await w.settle(promise, ms); } catch (e) { return e; }
      return null;
    },
  };
  return w;
}
function track(promise) {
  const box = { done: false, value: undefined, error: undefined };
  promise.then(v => { box.done = true; box.value = v; }, e => { box.done = true; box.error = e; });
  return box;
}
const PID = { host: 'host-0000-aaaa', guest: 'guest-1111-bbbb', other: 'other-2222-cccc' };

async function startGame(w, extra = {}) {
  const hostPage = w.net.page({ by: 'alice' }), guestPage = w.net.page({ by: 'bob' });
  const host = await w.settle(Online.create(Object.assign({ room: hostPage, pid: PID.host, name: 'Alice', timers: w.timers }, extra)));
  const guest = await w.settle(Online.join(Object.assign({ room: guestPage, pid: PID.guest, name: 'Bob', code: host.code, timers: w.timers }, extra)));
  await w.wait(300);
  return { hostPage, guestPage, host, guest, room: 'mp-' + host.code };
}
function record(session) {
  const log = { snapshot: [], opponent: [], error: [], connection: [] };
  session.on('snapshot', (snap, info) => log.snapshot.push({ seq: snap.seq, fromOpponent: info.fromOpponent, previousSeq: info.previousSeq }));
  session.on('opponent', ev => log.opponent.push(ev));
  session.on('error', ev => log.error.push(ev.code));
  session.on('connection', up => log.connection.push(up));
  return log;
}
function match(names = ['Alice', 'Bob'], first = 0) {
  return { rounds: 3, round: 1, totals: [0, 0], results: [], first, scored: 0, names };
}
const deal = (seed, first = 0) => ({ st: newRound(first, makeRng(seed)), match: match(['Alice', 'Bob'], first), lastMove: null });

// One play or one draw by whoever's turn it is, as the UI would commit it.
function step(session) {
  const snap = session.snapshot(), st = snap.st, p = st.turn;
  let lastMove;
  if (st.phase === 'play') {
    const m = heuristicMove(st, null, 0);
    applyMove(st, m);
    lastMove = { p, kind: m.type, card: m.card, src: null, drawn: null };
  } else {
    const src = heuristicDraw(st, null, 0);
    lastMove = { p, kind: 'draw', card: null, src, drawn: applyDraw(st, src) };
  }
  return session.commit({ st, match: snap.match, lastMove }, snap.seq);
}

// The same round played offline by the same policy: the answer the network must reproduce.
function replay(seed, first) {
  const st = newRound(first, makeRng(seed));
  while (!st.over) {
    if (st.phase === 'play') applyMove(st, heuristicMove(st, null, 0));
    else applyDraw(st, heuristicDraw(st, null, 0));
  }
  return st;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* =====================================================================
   TESTS
   ===================================================================== */

test('host creates a game, guest joins with the code, host deals', async () => {
  const w = makeWorld();
  const hostPage = w.net.page({ by: 'alice' }), guestPage = w.net.page({ by: 'bob' });
  const host = await w.settle(Online.create({ room: hostPage, pid: PID.host, name: 'Alice', timers: w.timers }));
  const room = 'mp-' + host.code;
  check(/^[abcdefghjkmnpqrstuvwxyz23456789]{6}$/.test(host.code), `code uses the 31-character alphabet: ${host.code}`);
  eq(host.seat, 0, 'host has seat 0');
  check(hostPage.rooms.has(room), 'host joined room mp-<code>');
  eq(hostPage.presenceIn(room), { app: 'mythic-pacts', v: 1, pid: PID.host, seat: 0, name: 'Alice' }, 'host presence before a guest');
  eq(host.names(), ['Alice', null], 'host names before a guest');
  eq([host.opponentConnected(), host.snapshot()], [false, null], 'no opponent and no game yet');
  const hostLog = record(host);
  host.on('opponent', ev => { if (ev.connected && !host.snapshot()) host.commit(deal(11)); });   // what the UI does

  const guest = await w.settle(Online.join({ room: guestPage, pid: PID.guest, name: 'Bob', code: `  ${host.code.toUpperCase()} `, timers: w.timers }));
  eq([guest.code, guest.seat], [host.code, 1], 'guest code normalised, seat 1');
  eq(guest.names(), ['Alice', 'Bob'], 'guest knows both names');
  eq(guest.opponentConnected(), true, 'guest sees the host at once');
  const guestLog = record(guest);
  await w.wait(500);
  eq(hostLog.opponent, [{ connected: true, name: 'Bob' }], 'host told once that Bob arrived');
  eq(host.names(), ['Alice', 'Bob'], 'host knows both names');
  eq([hostPage.presenceIn(room).vs, guestPage.presenceIn(room).vs], [PID.guest, PID.host], 'each presence names its opponent');
  eq(guestLog.snapshot, [{ seq: 1, fromOpponent: true, previousSeq: 0 }], 'guest received the deal');
  check(same(guest.snapshot(), host.snapshot()) && same(guest.snapshot().st, newRound(0, makeRng(11))), 'both hold the dealt game');
  eq(w.net.emits, 0, 'no room events were sent (only presence)');
});

test('bad codes are refused before touching the room', async () => {
  const w = makeWorld();
  for (const bad of ['', '   ', 'abc', 'abcdefg', 'abcde1', 'ABCDE0', 'abcdeo', 'abcdel', 'abcdei', 'ab_cde', 'mp-abcdef', null, 42, undefined]) {
    const page = w.net.page({ by: 'bob' });
    const e = await w.rejection(Online.join({ room: page, pid: PID.guest, name: 'Bob', code: bad, timers: w.timers }));
    eq(e && e.code, 'bad_code', `code ${JSON.stringify(bad)} is bad_code`);
    eq(page.rooms.size, 0, `code ${JSON.stringify(bad)} joined no room`);
  }
  eq([' k7qm2x ', 'K7QM-2X', 'K7 QM 2X'].map(Online.normalizeCode), ['k7qm2x', 'k7qm2x', 'k7qm2x'], 'normalizeCode trims, lower-cases, drops spaces and dashes');
});

test('not_found only after the timeout; a slow-to-answer host is still found', async () => {
  const w = makeWorld();
  const page = w.net.page({ by: 'bob' });
  const box = track(Online.join({ room: page, pid: PID.guest, name: 'Bob', code: 'abcdef', timers: w.timers }));
  await w.wait(7900);
  check(!box.done, 'still waiting at 7.9 s (default timeout 8 s)');
  await w.wait(200);
  eq(box.error && box.error.code, 'not_found', 'not_found at 8 s');
  eq(w.net.members('mp-abcdef').size, 0, 'the guest left the empty room');

  const w2 = makeWorld();
  const p2 = w2.net.page({ by: 'bob' });
  const t0 = w2.clock.now();
  const e2 = await w2.rejection(Online.join({ room: p2, pid: PID.guest, code: 'abcdef', timers: w2.timers, timeoutMs: 1000 }));
  eq([e2 && e2.code, w2.clock.now() - t0 <= 1100], ['not_found', true], 'timeoutMs is honoured');

  // The host only becomes visible 2.5 s after the guest joins: earlier deliveries show the guest alone.
  const w3 = makeWorld({ discoverMs: 2500 });
  const host = await w3.settle(Online.create({ room: w3.net.page({ by: 'alice' }), pid: PID.host, name: 'Alice', timers: w3.timers }));
  const start = w3.clock.now();
  const guest = await w3.settle(Online.join({ room: w3.net.page({ by: 'bob' }), pid: PID.guest, name: 'Bob', code: host.code, timers: w3.timers }), 5000);
  check(w3.clock.now() - start >= 2500 && guest.seat === 1, 'did not conclude "no host" from the first deliveries');
});

test('a third player is refused with full, even while the guest is away', async () => {
  const w = makeWorld();
  const g = await startGame(w);
  g.host.commit(deal(3));
  await w.wait(300);
  const third = w.net.page({ by: 'carol' });
  const e1 = await w.rejection(Online.join({ room: third, pid: PID.other, name: 'Carol', code: g.host.code, timers: w.timers }));
  eq(e1 && e1.code, 'full', 'full while both players are here');
  eq(third.rooms.size, 0, 'the refused player left the room');

  g.guestPage.close();
  await w.wait(3000);
  const e2 = await w.rejection(Online.join({ room: w.net.page({ by: 'carol' }), pid: PID.other, name: 'Carol', code: g.host.code, timers: w.timers }));
  eq(e2 && e2.code, 'full', 'the seat stays held for the guest who left');

  const e3 = await w.rejection(Online.join({ room: w.net.page({ by: 'alice' }), pid: PID.host, name: 'Alice', code: g.host.code, timers: w.timers }));
  eq(e3 && e3.code, 'full', "joining one's own game with the host's pid is refused");
  check(e3 && /same player id/.test(e3.message), 'and the message says why');
  eq(g.host.names(), ['Alice', 'Bob'], 'the host still plays Bob');
});

test('two guests joining at the same moment: exactly one gets the seat', async () => {
  const w = makeWorld();
  const host = await w.settle(Online.create({ room: w.net.page({ by: 'alice' }), pid: PID.host, name: 'Alice', timers: w.timers }));
  const a = track(Online.join({ room: w.net.page({ by: 'bob' }), pid: PID.guest, name: 'Bob', code: host.code, timers: w.timers }));
  const b = track(Online.join({ room: w.net.page({ by: 'carol' }), pid: PID.other, name: 'Carol', code: host.code, timers: w.timers }));
  const errs = new Map();
  for (let t = 0; t < 3000; t += 50) {
    await w.wait(50);
    for (const box of [a, b]) if (box.done && box.value && !box.hooked) { box.hooked = true; box.value.on('error', ev => errs.set(box, ev.code)); }
  }
  check(a.done && b.done, 'both joins settled');
  const seated = host.names()[1];
  check(seated === 'Bob' || seated === 'Carol', `host paired with one of them (${seated})`);
  const winner = seated === 'Bob' ? a : b, loser = seated === 'Bob' ? b : a;
  check(winner.value && !errs.has(winner), 'the winner joined without errors');
  const lostAtJoin = loser.error && loser.error.code === 'full';
  const lostLater = loser.value && errs.get(loser) === 'full';
  check(lostAtJoin || lostLater, 'the other was told the game is full');
  if (lostLater) {
    let code = null;
    try { loser.value.commit({ x: 1 }); } catch (e) { code = e.code; }
    eq(code, 'full', "the loser can't commit");
  }
  host.commit(deal(5));
  await w.wait(300);
  check(same(winner.value.snapshot(), host.snapshot()), 'the winner gets the game');
  if (lostLater) eq(loser.value.snapshot(), null, 'the loser never adopts it');
});

test('the same player re-joining with the code takes the seat back', async () => {
  const w = makeWorld();
  const g = await startGame(w);
  const log = record(g.host);
  g.host.commit(deal(8));
  await w.wait(300);
  step(g.host); step(g.host);
  await w.wait(300);
  g.guestPage.close();
  await w.wait(3000);
  eq(log.opponent, [{ connected: false, name: 'Bob' }], 'host told Bob left (after the grace period)');
  const again = await w.settle(Online.join({ room: w.net.page({ by: 'bob' }), pid: PID.guest, name: 'Bob', code: g.host.code, timers: w.timers }));
  eq(again.seat, 1, 'seat 1 again');
  check(same(again.snapshot(), g.host.snapshot()) && again.snapshot().seq === 3, 'the current game comes back at once');
  await w.wait(300);
  eq(log.opponent.slice(1), [{ connected: true, name: 'Bob' }], 'host told Bob is back');
  step(again);
  await w.wait(300);
  eq(g.host.snapshot().seq, 4, 'and play carries on');
});

test('snapshots flow both ways; commit stamps seq and keeps its own copy', async () => {
  const w = makeWorld();
  const g = await startGame(w);
  const hostLog = record(g.host), guestLog = record(g.guest);
  const dealt = deal(21);
  const stored = g.host.commit(dealt);
  eq([stored.seq, dealt.seq], [1, 1], 'commit sets seq on the stored snapshot and on the object passed in');
  stored.st.deck.length = 0;
  dealt.st.hands[0].length = 0;
  eq(g.host.snapshot().st.deck.length, 44, "changing either object afterwards doesn't touch the session's copy");
  await w.wait(200);
  eq(g.guest.snapshot().seq, 1, 'guest has the deal');
  step(g.host); step(g.host);   // play, then draw, in the same instant
  await w.wait(200);
  step(g.guest);
  await w.wait(200);
  step(g.guest);
  await w.wait(200);
  check(same(g.host.snapshot(), g.guest.snapshot()) && g.host.snapshot().seq === 5, 'both at seq 5 with the same game');
  eq(guestLog.snapshot, [
    { seq: 1, fromOpponent: true, previousSeq: 0 },
    { seq: 3, fromOpponent: true, previousSeq: 1 },   // seq 2 was overtaken within one frame: snapshots are whole, so nothing is lost
    { seq: 4, fromOpponent: false, previousSeq: 3 },
    { seq: 5, fromOpponent: false, previousSeq: 4 },
  ], 'guest events');
  eq(hostLog.snapshot.map(e => [e.seq, e.fromOpponent]), [[1, false], [2, false], [3, false], [4, true], [5, true]], 'host events');
  let code = null;
  try { g.guest.commit({ x: 1 }, 4); } catch (e) { code = e.code; }
  eq([code, g.guest.snapshot().seq], ['stale', 5], 'a move built on an old update is refused with stale');
});

test('higher seq is adopted and mirrored; lower seq is ignored', async () => {
  const w = makeWorld();
  const g = await startGame(w);
  g.host.commit(deal(4));
  step(g.host); step(g.host);
  await w.wait(300);
  const hostP = g.hostPage.presenceIn(g.room).game, guestP = g.guestPage.presenceIn(g.room).game;
  check(guestP.seq === 3 && same(guestP, hostP), "the guest's presence mirrors the host's snapshot");
  // A stale second tab of the guest offers an older snapshot.
  const stale = w.net.page({ by: 'bob' });
  const r = await w.settle(stale.join(g.room));
  const old = Object.assign(deal(4), { seq: 1 });
  await r.presence({ app: 'mythic-pacts', v: 1, pid: PID.guest, seat: 1, name: 'Bob', vs: PID.host, game: old });
  const log = record(g.host);
  await w.wait(1000);
  eq([g.host.snapshot().seq, log.snapshot.length], [3, 0], 'host ignores the older snapshot');
  step(g.guest);
  await w.wait(300);
  eq(g.host.snapshot().seq, 4, 'and still follows the real guest');
});

test('either side reloads and recovers the latest game, even from an old save', async () => {
  const w = makeWorld();
  const g = await startGame(w);
  g.host.commit(deal(9));
  await w.wait(200);
  const oldHostSave = g.host.save();
  step(g.host); step(g.host);
  await w.wait(300);
  const guestSave = g.guest.save();
  eq([guestSave.code, guestSave.seat, guestSave.pid, guestSave.name, guestSave.mate, guestSave.mateBy, guestSave.snap.seq],
    [g.host.code, 1, PID.guest, 'Bob', PID.host, 'alice', 3], 'save() has code, seat, pid, name, the pairing and the snapshot');
  eq([g.host.save().mate, g.host.save().mateBy], [PID.guest, 'bob'], "the host's save has its pairing too");
  check(utf8(JSON.stringify(guestSave)) < 2500, 'save() is small');

  // Guest reloads with an up-to-date save.
  g.guestPage.close();
  const guestPage2 = w.net.page({ by: 'bob' });
  const guest2 = await w.settle(Online.resume({ room: guestPage2, pid: PID.guest, saved: guestSave, timers: w.timers }));
  eq([guest2.seat, guest2.code, guest2.snapshot().seq], [1, g.host.code, 3], 'guest resumes at once from its save');
  let code = null;
  try { guest2.commit({ x: 1 }); } catch (e) { code = e.code; }
  eq(code, 'not_synced', "a resumed player can't commit before hearing from the opponent");
  await w.wait(800);
  eq(guest2.opponentConnected(), true, 'then it sees the host');
  step(guest2);
  await w.wait(300);
  eq(g.host.snapshot().seq, 4, 'host follows the resumed guest');

  // Host reloads with a save from seq 1: the guest's mirror brings it to seq 4.
  g.hostPage.close();
  const host2 = await w.settle(Online.resume({ room: w.net.page({ by: 'alice' }), pid: PID.host, saved: oldHostSave, timers: w.timers }));
  const log = record(host2);
  eq(host2.snapshot().seq, 1, 'host starts from its old save');
  await w.wait(800);
  check(host2.snapshot().seq === 4 && same(host2.snapshot(), guest2.snapshot()), 'and recovers seq 4 from the guest');
  eq(log.snapshot, [{ seq: 4, fromOpponent: true, previousSeq: 1 }], 'with one snapshot event');
  eq(host2.names(), ['Alice', 'Bob'], 'names survive the reload');

  // The host leaves while the guest moves; it comes back with its save and catches up.
  step(guest2);
  await w.wait(300);
  const hostSave = host2.save();
  await host2.leave();
  await w.wait(300);
  step(guest2);
  await w.wait(300);
  const host3 = await w.settle(Online.resume({ room: w.net.page({ by: 'alice' }), pid: PID.host, saved: hostSave, timers: w.timers }));
  await w.wait(800);
  check(host3.snapshot().seq === 6 && same(host3.snapshot(), guest2.snapshot()), 'moves made while the host was away are recovered');

  const bad = [null, {}, { v: 1, code: 'abc', seat: 0, pid: PID.host }, Object.assign({}, guestSave, { mate: null }),
    Object.assign({}, guestSave, { snap: { seq: 0 } }), Object.assign({}, guestSave, { seat: 2 }), Object.assign({}, guestSave, { pid: 'x' })];
  for (const saved of bad) {
    const e = await w.rejection(Online.resume({ room: w.net.page({}), pid: PID.guest, saved, timers: w.timers }));
    eq(e && e.code, 'bad_save', `damaged save ${JSON.stringify(saved).slice(0, 40)} is refused`);
  }
});

test('opponent connection: brief drops are smoothed, real ones reported, commits survive', async () => {
  const w = makeWorld();
  const g = await startGame(w);
  const hostLog = record(g.host), guestLog = record(g.guest);
  g.host.commit(deal(12));   // host moves first
  await w.wait(300);
  g.guestPage.disconnect();
  await w.wait(1000);
  g.guestPage.reconnect();
  await w.wait(2500);
  eq([hostLog.opponent, guestLog.connection], [[], []], 'a 1 s drop produces no events on either side');

  step(g.host);
  g.guestPage.disconnect();
  await w.wait(1500);
  eq(hostLog.opponent, [], 'nothing yet 1.5 s into a longer drop');
  await w.wait(1000);
  eq(hostLog.opponent, [{ connected: false, name: 'Bob' }], 'reported after the 2 s grace period');
  eq(g.host.opponentConnected(), false, 'opponentConnected() agrees');
  eq(guestLog.connection, [false], "the guest's own link is reported down too");
  step(g.host);   // the host draws while the guest is away
  await w.wait(500);
  eq(g.guest.snapshot().seq, 1, "the disconnected guest hasn't seen it");
  g.guestPage.reconnect();
  await w.wait(300);
  eq(hostLog.opponent.slice(1), [{ connected: true, name: 'Bob' }], 'reconnect reported at once');
  eq([g.guest.snapshot().seq, guestLog.connection], [3, [false, true]], 'the guest catches up on reconnect');

  // The guest moves while cut off; the move arrives when its presence is re-asserted.
  g.guestPage.disconnect();
  step(g.guest);
  await w.wait(1000);
  eq(g.host.snapshot().seq, 3, 'host has not seen the offline move');
  g.guestPage.reconnect();
  await w.wait(300);
  eq(g.host.snapshot().seq, 4, 'it arrives after the reconnect');

  // A lost presence update is recovered by the next reconnect.
  g.guestPage.drop(1);
  step(g.guest);
  await w.wait(1000);
  eq([g.host.snapshot().seq, w.net.dropped], [4, 1], 'the dropped update did not arrive');
  g.guestPage.disconnect(); g.guestPage.reconnect();
  await w.wait(300);
  check(g.host.snapshot().seq === 5 && same(g.host.snapshot(), g.guest.snapshot()), 're-asserted presence delivers it');
});

test('simultaneous commits at the same seq: the host copy wins on both sides', async () => {
  const w = makeWorld();
  const g = await startGame(w);
  g.host.commit({ note: 'deal' });
  await w.wait(300);
  const guestLog = record(g.guest);
  g.host.commit({ note: 'host move' });
  g.guest.commit({ note: 'guest move' });
  await w.wait(500);
  eq([g.host.snapshot(), g.guest.snapshot()], [{ note: 'host move', seq: 2 }, { note: 'host move', seq: 2 }], 'both hold the host copy');
  eq(guestLog.snapshot.map(e => [e.seq, e.fromOpponent]), [[2, false], [2, true]], 'the guest was told its copy was replaced');
  check(same(g.hostPage.presenceIn(g.room).game, g.guestPage.presenceIn(g.room).game), 'and both presences agree');
});

test('hostile or malformed presence is ignored', async () => {
  const w = makeWorld();
  const g = await startGame(w);
  g.host.commit(deal(2));
  await w.wait(300);
  const hostLog = record(g.host), guestLog = record(g.guest);
  const before = [g.host.snapshot(), g.guest.snapshot()];
  const evil = { seq: 999, st: 'pwned' };
  const strangers = [
    { app: 'other-app', v: 1, pid: 'mallory-1', seat: 1, game: evil },
    { app: 'mythic-pacts', v: 1, pid: 'x', seat: 1, game: evil },                                    // pid too short
    { app: 'mythic-pacts', v: 1, pid: 'mallory-1', seat: 1, name: 'M', game: evil },               // not the paired guest
    { app: 'mythic-pacts', v: 1, pid: 'mallory-1', seat: 1, vs: PID.host, game: evil },
    { app: 'mythic-pacts', v: 1, pid: 'mallory-1', seat: 0, vs: PID.guest, game: evil },          // a second "host"
    { app: 'mythic-pacts', v: 1, pid: PID.host, seat: 0, vs: PID.guest, name: 'Alice', game: evil },   // copies the host's pid...
    { app: 'mythic-pacts', v: 1, pid: PID.guest, seat: 1, vs: PID.host, name: 'Bob', game: evil },     // ...or the guest's, as another user
    { app: 'mythic-pacts', v: 2, pid: PID.guest, seat: 1, vs: PID.host, game: evil },             // another version
    { app: 'mythic-pacts', v: '1', pid: PID.guest, seat: 1, game: evil },
    { app: 'mythic-pacts', v: 1, pid: PID.guest, seat: '1', game: evil },
    { app: 'mythic-pacts', v: 1, pid: PID.guest, seat: 3, game: evil },
    { app: 'mythic-pacts', v: 1, pid: { a: 1 }, seat: 1, game: evil },
    { app: 'mythic-pacts', v: 1, pid: PID.guest, seat: 1, vs: 7, game: evil },
  ];
  const mallory = w.net.page({ by: 'mallory' });
  const r = await w.settle(mallory.join(g.room));
  for (const p of strangers) {
    await r.presence(Object.assign({ app: null, v: null, pid: null, seat: null, name: null, vs: null, game: null }, p));
    await w.wait(200);
  }
  // An agent peer copying the guest's identity, and an agent "host".
  const agent = w.net.page({ kind: 'agent' });
  const ra = await w.settle(agent.join(g.room));
  await ra.presence({ app: 'mythic-pacts', v: 1, pid: PID.guest, seat: 1, vs: PID.host, game: evil });
  await w.wait(300);
  await ra.presence({ app: 'mythic-pacts', v: 1, pid: PID.host, seat: 0, vs: PID.guest, game: evil });
  await w.wait(300);
  check(same([g.host.snapshot(), g.guest.snapshot()], before), 'neither side adopted anything (a copied pid under another user id included)');
  eq([hostLog.snapshot.length, guestLog.snapshot.length, hostLog.opponent.length, guestLog.opponent.length], [0, 0, 0, 0], 'and no events fired');

  // Badly shaped games under the opponent's own pid (a second tab of theirs): ignored, reported once each.
  const twin = w.net.page({ by: 'bob' });
  const rt = await w.settle(twin.join(g.room));
  const shapes = [{ seq: 'fifty' }, [1, 2, 3], 'text', { seq: 50.5 }, { seq: 0 }, { seq: 1e12 }, { seq: 50, s: 'a\u0007b' }];
  for (const game of shapes) {
    await rt.presence({ app: 'mythic-pacts', v: 1, pid: PID.guest, seat: 1, vs: PID.host, name: 'Bob', game });
    await w.wait(150);
    await r.presence({ name: 'poke' + Math.random().toString(36).slice(2, 6) });   // unrelated change: the room is delivered again
    await w.wait(150);
  }
  check(same(g.host.snapshot(), before[0]), 'host kept its game');
  eq(hostLog.error, Array(shapes.length).fill('bad_snapshot'), 'one bad_snapshot error per bad shape, not one per delivery');
  await rt.presence({ game: null });
  await w.wait(3000);
  eq(hostLog.error.filter(c => c === 'duplicate').length, 0, 'a second guest tab does not trigger the host-side duplicate warning');

  // Names are cut to 24 characters and stripped of control and bidi characters; HTML stays text for the UI to escape.
  eq(Online.cleanName('‮Al\u0000ice​ <b>' + 'x'.repeat(40)), 'Alice <b>xxxxxxxxxxxxxxx', 'cleanName strips and cuts to 24');
  eq(Online.cleanName('  Zoë 👩‍👩‍👧 \n\t Li  '), 'Zoë 👩‍👩‍👧 Li', 'cleanName keeps accents and joined emoji');
});

test('accept() vets opponent snapshots before they are adopted or mirrored', async () => {
  const w = makeWorld();
  const seen = [];
  const accept = (next, prev) => { seen.push([next.seq, prev && prev.seq]); return next.ok === true; };
  const g = await startGame(w, { accept });
  const hostLog = record(g.host);
  g.host.commit({ ok: true });
  await w.wait(300);
  eq(g.guest.snapshot(), { ok: true, seq: 1 }, 'guest accepted the deal');
  g.guest.commit({ ok: false, cheat: 1 });
  await w.wait(1000);
  eq(g.host.snapshot(), { ok: true, seq: 1 }, 'host refused the bad update');
  eq(g.hostPage.presenceIn(g.room).game, { ok: true, seq: 1 }, 'and did not mirror it');
  eq(hostLog.error, ['rejected'], 'one rejected error');
  g.guest.commit({ ok: true, fixed: 1 });
  await w.wait(300);
  eq(g.host.snapshot(), { ok: true, fixed: 1, seq: 3 }, 'a later good update is adopted');
  eq(seen, [[1, null], [2, 1], [3, 1]], 'accept(next, prev) saw each candidate once');
});

test('worst-case snapshot fits in presence with a wide margin; oversize and bad shapes are refused', async () => {
  // Every card id from 10 to 59 has two digits. The longest engine state puts both hands on
  // two-digit cards, marks all 16 as taken from a discard pile, and keeps every line and pile
  // empty (each empty list saves a comma's worth only when it holds cards).
  const st = newRound(0, makeRng(1));
  st.hands = [[44, 45, 46, 47, 48, 49, 50, 51], [52, 53, 54, 55, 56, 57, 58, 59]];
  st.known = [st.hands[0].slice(), st.hands[1].slice()];
  st.deck = Array.from({ length: 44 }, (_, i) => i);
  st.exp = [[[], [], [], [], []], [[], [], [], [], []]];
  st.discard = [[], [], [], [], []];
  Object.assign(st, { turn: 1, phase: 'draw', lastDiscard: -1, over: false });
  const longName = '🃏'.repeat(24);   // 24 four-byte characters: the longest name cleanName allows, in bytes
  const worst = {
    st,
    match: {
      mode: 'online', skill: 'apprentice', started: false, rounds: 5, round: 5, first: 1, scored: 5,
      totals: [-2000, -2000], results: Array.from({ length: 5 }, () => [-400, -400]), names: [longName, longName],
    },
    lastMove: { p: 1, kind: 'discard', card: 59, src: -1, drawn: 59 },
  };
  const pidA = 'a'.repeat(64), pidB = 'b'.repeat(64);
  const w = makeWorld();
  const page = w.net.page({ by: 'alice' });
  const saved = { v: 1, code: 'k7qm2x', seat: 0, pid: pidA, name: longName, mate: pidB, oppName: longName, snap: { seq: 2147483646 } };
  const host = await w.settle(Online.resume({ room: page, pid: pidA, saved, timers: w.timers }));
  host._synced = true;   // nobody else is in this room; skip waiting for the opponent
  const stored = host.commit(worst);
  const bytes = page.bytesIn('mp-k7qm2x');
  eq(stored.seq, 2147483647, 'the largest seq');
  print(`   worst-case presence: ${bytes} bytes of ${Online.PRESENCE_LIMIT} (${(100 * bytes / Online.PRESENCE_LIMIT).toFixed(1)}%), `
    + `with 64-character pids, 24 four-byte characters per name, a 10-digit seq and 5 rounds of results`);
  check(bytes <= 0.5 * Online.PRESENCE_LIMIT, 'worst case uses at most half of the 4 KiB limit');

  // Real games: every snapshot of 2,000 simulated rounds (same long pids and names).
  const sizes = [];
  const header = { app: 'mythic-pacts', v: 1, pid: pidA, seat: 0, name: longName, vs: pidB };
  for (let i = 0; i < 2000; i++) {
    const s = newRound(i % 2, makeRng(5000 + i));
    let seq = 1;
    const m = Object.assign({}, worst.match, { rounds: 3, round: 3, results: [[-80, 45], [12, -3]], totals: [-68, 42] });
    let biggest = 0;
    while (!s.over) {
      let lastMove;
      if (s.phase === 'play') { const mv = heuristicMove(s, null, 0); applyMove(s, mv); lastMove = { p: s.turn, kind: mv.type, card: mv.card, src: null, drawn: null }; }
      else { const p = s.turn, src = heuristicDraw(s, null, 0); lastMove = { p, kind: 'draw', card: null, src, drawn: applyDraw(s, src) }; }
      seq++;
      biggest = Math.max(biggest, utf8(JSON.stringify(Object.assign({}, header, { game: { st: s, match: m, lastMove, seq: seq + 1000 } }))));
    }
    sizes.push(biggest);
  }
  const big = Math.max(...sizes);
  print(`   largest presence in each of ${sizes.length} simulated rounds: mean ${mean(sizes).toFixed(1)} bytes (SD ${sd(sizes).toFixed(1)}, `
    + `SE ${(sd(sizes) / Math.sqrt(sizes.length)).toFixed(2)}), max ${big}; analytic worst case ${bytes}`);
  check(big <= bytes, 'no simulated state exceeds the constructed worst case');

  let code = null;
  try { host.commit({ ok: 1 }); } catch (e) { code = e.code; }
  eq([code, host.snapshot().seq], ['invalid_snapshot', 2147483647], 'past the largest seq, commits are refused');

  // Over the limit, or outside the platform's rules: refused before anything is sent.
  const g = await startGame(w);
  g.host.commit({ note: 'deal' });
  const sentBefore = g.hostPage.bytesIn(g.room);
  const tries = [
    [{ blob: Array.from({ length: 5 }, () => 'x'.repeat(1000)) }, 'too_large'],
    [{ s: 'x'.repeat(1100) }, 'invalid_snapshot'],
    [{ 'not ok': 1 }, 'invalid_snapshot'],
    [{ constructor: 1 }, 'invalid_snapshot'],
    [{ a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } }, 'invalid_snapshot'],   // 8 levels in the snapshot: 9 in presence
    [{ list: Array(65).fill(0) }, 'invalid_snapshot'],
    [{ big: 10n }, 'invalid_snapshot'],
    [[1, 2], 'invalid_snapshot'],
    [null, 'invalid_snapshot'],
  ];
  const cyclic = { a: 1 }; cyclic.self = cyclic;
  tries.push([cyclic, 'invalid_snapshot']);
  for (const [game, want] of tries) {
    code = null;
    try { g.host.commit(game); } catch (e) { code = e.code; }
    eq(code, want, `commit(${String(JSON.stringify(game, (k, v) => typeof v === 'bigint' ? 'bigint' : (k === 'self' ? '[cycle]' : v))).slice(0, 40)}) refused`);
  }
  eq([g.host.snapshot(), g.hostPage.bytesIn(g.room)], [{ note: 'deal', seq: 1 }, sentBefore], 'refused commits changed nothing');
  const deepest = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };   // 7 levels in the snapshot: 8 in presence, the limit
  eq(g.host.commit(deepest).seq, 2, 'the deepest allowed snapshot is accepted');
  await w.wait(300);
  check(same(g.guest.snapshot(), g.host.snapshot()), 'and the platform delivers it');
  eq(page.rooms.get('mp-k7qm2x').maxBytes, bytes, 'the fake platform never saw anything larger than the worst case');
});

test('leave is idempotent and silences the session', async () => {
  const w = makeWorld();
  const g = await startGame(w);
  const hostLog = record(g.host), guestLog = record(g.guest);
  g.host.commit({ note: 1 });
  await w.wait(300);
  const p1 = g.guest.leave(), p2 = g.guest.leave();
  check(p1 === p2, 'leave() twice returns the same promise');
  await w.settle(p1);
  g.host.commit({ note: 2 });
  await w.wait(3000);
  eq(guestLog.snapshot.length, 1, 'no events after leave');
  let code = null;
  try { g.guest.commit({ note: 3 }); } catch (e) { code = e.code; }
  eq(code, 'closed', 'commit after leave throws closed');
  check(!g.guestPage.rooms.has(g.room), 'guest page left the room');
  eq(hostLog.opponent, [{ connected: false, name: 'Bob' }], 'host saw the guest go');
  eq(g.host.leave() === g.host.leave(), true, 'host leave idempotent too');
});

test('unavailable rooms, refused joins and other versions', async () => {
  const w = makeWorld();
  const e1 = await w.rejection(Online.create({ room: null, pid: PID.host, name: 'Alice', timers: w.timers }));
  eq(e1 && e1.code, 'unavailable', 'no room capability: create rejects unavailable');
  const e2 = await w.rejection(Online.join({ room: null, pid: PID.guest, code: 'abcdef', timers: w.timers }));
  eq(e2 && e2.code, 'unavailable', 'no room capability: join rejects unavailable');
  w.net.joinFailures.push('limit_reached');
  const e3 = await w.rejection(Online.create({ room: w.net.page({}), pid: PID.host, timers: w.timers }));
  eq([e3 && e3.code, e3 && e3.reason], ['unavailable', 'limit_reached'], "a refused join is unavailable, with the platform's reason");
  let threw = null;
  try { await Online.create({ room: w.net.page({}), pid: 'bad pid!', timers: w.timers }); } catch (e) { threw = e; }
  check(threw instanceof TypeError, 'a malformed pid is a TypeError');

  // A host running another version of the protocol.
  const old = w.net.page({ by: 'alice' });
  const r = await w.settle(old.join('mp-abcdef'));
  await r.presence({ app: 'mythic-pacts', v: 2, pid: PID.host, seat: 0, name: 'Alice' });
  const e4 = await w.rejection(Online.join({ room: w.net.page({ by: 'bob' }), pid: PID.guest, code: 'abcdef', timers: w.timers }));
  eq(e4 && e4.code, 'unavailable', 'a host with another version: unavailable');
  check(e4 && /different version/.test(e4.message), 'with a message saying so');

  // Two pages claim the same host pid under different platform users. Seen together, the guest
  // doesn't guess which is real; seen one after the other, it binds to the first and ignores the other.
  for (const staggerMs of [0, 150]) {
    const w2 = makeWorld({ staggerMs });
    const real = await w2.settle(Online.create({ room: w2.net.page({ by: 'alice' }), pid: PID.host, name: 'Alice', timers: w2.timers }));
    const fake = await w2.settle(w2.net.page({ by: 'mallory' }).join('mp-' + real.code));
    await fake.presence({ app: 'mythic-pacts', v: 1, pid: PID.host, seat: 0, name: 'Alice' });
    const box = track(Online.join({ room: w2.net.page({ by: 'bob' }), pid: PID.guest, name: 'Bob', code: real.code, timers: w2.timers }));
    await w2.wait(3000);
    if (staggerMs === 0) { eq(box.error && box.error.code, 'unavailable', 'two users claiming to host, seen at once: unavailable'); continue; }
    const guest = box.value;
    eq([guest && guest.save().mateBy, real.names()[1]], ['alice', 'Bob'], 'seen in turn: the guest pairs with the first host it saw');
    real.commit({ note: 'real' });
    await fake.presence({ vs: PID.guest, game: { note: 'fake', seq: 99 } });
    await w2.wait(1000);
    eq(guest.snapshot(), { note: 'real', seq: 1 }, "the impostor's snapshot is ignored");
  }
});

test('a lost room is re-joined by itself; a revoked one is reported', async () => {
  const w = makeWorld();
  const g = await startGame(w);
  const guestLog = record(g.guest), hostLog = record(g.host);
  g.host.commit(deal(30));
  await w.wait(300);
  g.guestPage.kill(g.room, 'upstream_error');
  await w.wait(100);
  check(!g.guestPage.rooms.has(g.room), 'the room ended for the guest');
  await w.wait(1500);
  check(g.guestPage.rooms.has(g.room), 'the guest re-joined after about a second');
  await w.wait(600);
  eq([guestLog.connection, hostLog.opponent], [[], []], 'quick enough that nobody was told of a disconnect');
  step(g.host);
  await w.wait(300);
  eq(g.guest.snapshot().seq, 2, 'sync works after the re-join');

  g.guestPage.kill(g.room, 'revoked');
  await w.wait(5000);
  eq(guestLog.error, ['revoked'], 'revoked is reported');
  check(!g.guestPage.rooms.has(g.room), 'and not retried');
  eq(guestLog.connection, [false], 'the link is reported down');
});

test('the same seat open in two tabs is reported after the grace period', async () => {
  const w = makeWorld();
  const g = await startGame(w);
  g.host.commit({ note: 1 });
  await w.wait(300);
  const guestLog = record(g.guest);
  const tab2 = await w.settle(Online.resume({ room: w.net.page({ by: 'bob' }), pid: PID.guest, saved: g.guest.save(), timers: w.timers }));
  const tab2Log = record(tab2);
  await w.wait(1000);
  eq(guestLog.error, [], 'not before the grace period');
  await w.wait(2000);
  eq([guestLog.error, tab2Log.error], [['duplicate'], ['duplicate']], 'both tabs warned once');
});

/* ---------- whole rounds over the network ---------- */

// Acts like the UI: deals on the first connect, then on its turn plays and draws, committing after each,
// and keeps session.save() as localStorage would (plus the last few, to test reloads from an old save).
function makeDriver(w, seat, seed, first) {
  const d = {
    seat, session: null, saved: null, history: [], page: null, pending: false,
    commits: 0, skipped: 0, notSynced: 0, errors: {},
    attach(session, page) {
      d.session = session;
      d.page = page;
      d.saved = session.save();
      session.on('error', ev => { d.errors[ev.code] = (d.errors[ev.code] || 0) + 1; });
      session.on('snapshot', (snap, info) => {
        d.saved = session.save();
        d.history.push(d.saved);
        if (d.history.length > 4) d.history.shift();
        if (info.fromOpponent && snap.seq > info.previousSeq + 1) d.skipped += snap.seq - info.previousSeq - 1;
        d.poke();
      });
      session.on('opponent', ev => {
        d.saved = session.save();
        if (ev.connected && seat === 0 && !session.snapshot()) {
          session.commit({ st: newRound(first, makeRng(seed)), match: match(['Alice', 'Bob'], first), lastMove: null });
          d.commits++;
        }
        d.poke();
      });
      d.poke();
    },
    poke() {
      if (d.pending) return;
      d.pending = true;
      w.clock.setTimeout(() => { d.pending = false; d.act(); }, 40);   // a person takes a moment
    },
    act() {
      const s = d.session;
      if (!s) return;
      const snap = s.snapshot();
      if (!snap || snap.st.over || snap.st.turn !== seat) return;
      try { step(s); d.commits++; } catch (e) {
        if (e.code === 'not_synced') { d.notSynced++; return; }   // the 'opponent' event will poke again
        throw e;
      }
      d.poke();
    },
  };
  return d;
}

async function playRound(seed, chaos) {
  const w = makeWorld(chaos ? { jitter: 40, seed } : { seed });
  const first = seed % 2;
  const pages = [w.net.page({ by: 'alice' }), w.net.page({ by: 'bob' })];
  const drivers = [makeDriver(w, 0, seed, first), makeDriver(w, 1, seed, first)];
  const host = await w.settle(Online.create({ room: pages[0], pid: PID.host, name: 'Alice', timers: w.timers }));
  drivers[0].attach(host, pages[0]);
  const guest = await w.settle(Online.join({ room: pages[1], pid: PID.guest, name: 'Bob', code: host.code, timers: w.timers }));
  drivers[1].attach(guest, pages[1]);
  const faults = { disconnect: 0, drop: 0, reload: 0, staleReload: 0, kill: 0 };
  const rnd = makeRng(seed * 7919);
  const done = () => drivers.every(d => d.session && d.session.snapshot() && d.session.snapshot().st.over)
    && same(drivers[0].session.snapshot(), drivers[1].session.snapshot());
  let nextFault = 2000;
  for (let t = 0; t < 30 * 60 * 1000 && !done(); t += 100) {
    await w.wait(100);
    if (!chaos || w.clock.now() < nextFault) continue;
    nextFault = w.clock.now() + 1000 + rnd() * 3000;
    const d = drivers[(rnd() * 2) | 0], page = d.page, kind = ['disconnect', 'drop', 'reload', 'kill'][(rnd() * 4) | 0];
    if (!d.session || !page.connected || page.closed) continue;
    faults[kind]++;
    if (kind === 'disconnect') {
      page.disconnect();
      w.clock.setTimeout(() => page.reconnect(), 500 + rnd() * 3500);
    } else if (kind === 'drop') {
      page.drop(1 + ((rnd() * 2) | 0));
      w.clock.setTimeout(() => { page.disconnect(); page.reconnect(); }, 1500);
    } else if (kind === 'kill') {
      page.kill('mp-' + host.code, 'upstream_error');
    } else {
      // Half the reloads use a save from up to four snapshots back, as a UI that saves lazily might.
      const stale = rnd() < 0.5 && d.history.length > 1;
      const saved = stale ? d.history[0] : d.saved, gap = 300 + rnd() * 1200;
      if (stale) { faults.reload--; faults.staleReload++; }
      page.close();
      d.session = null;
      w.clock.setTimeout(() => {
        const fresh = w.net.page({ by: d.seat ? 'bob' : 'alice' });
        Online.resume({ room: fresh, pid: saved.pid, saved, timers: w.timers }).then(s => d.attach(s, fresh));
      }, gap);
    }
  }
  const a = drivers[0].session.snapshot(), b = drivers[1].session.snapshot();
  return {
    ok: done(), same: same(a, b), matchesOffline: !!a && same(a.st, replay(seed, first)),
    commits: drivers[0].commits + drivers[1].commits, seq: a ? a.seq : 0,
    skipped: drivers[0].skipped + drivers[1].skipped, notSynced: drivers[0].notSynced + drivers[1].notSynced,
    ms: w.clock.now(), faults, errors: [drivers[0].errors, drivers[1].errors],
  };
}

test('whole rounds: two sessions play to the end and agree with an offline replay', async () => {
  const N = 12, res = [];
  for (let i = 0; i < N; i++) res.push(await playRound(100 + i, false));
  eq(res.filter(r => r.ok && r.same && r.matchesOffline).length, N, `all ${N} rounds end identical on both sides and equal to the offline game`);
  check(res.every(r => r.seq === r.commits), 'seq counts every commit (deal + each play + each draw)');
  eq(res.map(r => r.errors).filter(e => Object.keys(e[0]).length + Object.keys(e[1]).length), [], 'no error events in clean rounds');
  print(`   ${N} clean rounds: ${mean(res.map(r => r.commits)).toFixed(1)} commits per round, `
    + `${res.reduce((s, r) => s + r.skipped, 0)} intermediate snapshots overtaken in transit, `
    + `${(mean(res.map(r => r.ms)) / 1000).toFixed(1)} s of simulated time per round`);
});

test('whole rounds under faults: drops, disconnects, reloads and lost rooms', async () => {
  const N = 30, res = [];
  for (let i = 0; i < N; i++) res.push(await playRound(500 + i, true));
  const good = res.filter(r => r.ok && r.same && r.matchesOffline).length;
  eq(good, N, `all ${N} faulty rounds converge to the offline game on both sides`);
  const total = { disconnect: 0, drop: 0, reload: 0, staleReload: 0, kill: 0 }, errors = {};
  for (const r of res) {
    for (const k in total) total[k] += r.faults[k];
    for (const e of r.errors) for (const k in e) errors[k] = (errors[k] || 0) + e[k];
  }
  eq(errors, {}, 'no error events under faults (no false "duplicate" during reloads, nothing refused)');
  print(`   ${N} rounds with 40 ms jitter and ${Object.values(total).reduce((a, b) => a + b, 0)} injected faults `
    + `(${total.disconnect} disconnects, ${total.drop} dropped updates, ${total.reload} reloads, `
    + `${total.staleReload} reloads from an old save, ${total.kill} rooms ended): ${good}/${N} identical to the offline game; `
    + `${res.reduce((s, r) => s + r.notSynced, 0)} moves held back until a resumed player had heard from the opponent`);
});

/* ---------- run ---------- */
(async () => {
  for (const t of tests) {
    const before = failures;
    try { await t.fn(); } catch (e) {
      failures++;
      print(`FAIL ${t.name}: ${e && e.stack ? e + '\n' + e.stack : e}`);
    }
    print(`${failures === before ? 'ok  ' : 'BAD '} ${t.name}`);
  }
  print(failures ? `${failures} online check(s) failed (of ${checks})` : `All online tests passed (${checks} checks)`);
  if (failures) setTimeout(() => { throw new Error('online tests failed'); }, 0);   // non-zero exit for run.sh
})().catch(e => setTimeout(() => { throw e; }, 0));
