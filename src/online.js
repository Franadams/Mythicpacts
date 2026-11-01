/* =====================================================================
   ONLINE PLAY
   Two people on different devices play one game through the page's
   "room" capability (claude.use("room")). There is no game server, and
   sending room events needs editor rights, so everything travels in
   PRESENCE: one small object per page (at most 4 KiB of JSON) that the
   platform shares with everyone in the room, re-sends after a
   reconnect, hands to newcomers and clears when the page leaves.

   Each player's presence is
     { app: 'mythic-pacts', v: 1, pid, seat, name, vs, game }
     pid   this player's id, made by the UI and kept across reloads
     seat  0 for the host, who created the game; 1 for the guest
     vs    the pid of the player they are paired with (absent until then)
     game  the latest full game snapshot this player knows, with a
           number `seq` that goes up by one with every commit

   The protocol:
   - The player to move commits a new snapshot with seq + 1.
   - Each side adopts an opponent snapshot whose seq is higher than its
     own and copies it into its own presence. Both presences then hold
     the latest game, so either player can reload and get it back from
     the other.
   - Equal seq but different content (both committed at once, which the
     UI should prevent): the host's copy wins, so the two sides agree.
   This file knows nothing about the rules beyond seq: the UI decides
   when a commit is allowed, and may pass `accept` to vet opponent
   snapshots before they are adopted. Everything received is untrusted:
   shapes are checked, nothing is run, and names come back as plain
   text that the UI must still escape before putting it into HTML.

   Identity: a pid is only a claim, and anyone in the room can read and
   copy it. Where the platform stamps peers with a user id (`by`, present
   when the page declares the `user` capability), each side also binds its
   opponent to that id when they pair, and ignores pages that claim the
   opponent's pid under another id. Without `by`, the pid is all there is.
   ===================================================================== */
const Online = (() => {
  'use strict';

  const APP = 'mythic-pacts';
  const VERSION = 1;
  const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // no i, l, o, 0 or 1: easy to misread
  const CODE_LENGTH = 6;                                 // 31^6 = 887,503,681 codes
  const ROOM_PREFIX = 'mp-';
  const PRESENCE_LIMIT = 4096;      // bytes of JSON the platform allows in one presence object
  const JOIN_TIMEOUT_MS = 8000;
  const GRACE_MS = 2000;            // a reload or a brief drop shouldn't read as "opponent left"
  const RETRY_MS = 1000, RETRY_MAX_MS = 16000;
  const NAME_MAX = 24;              // characters
  const MAX_SEQ = 2147483647;
  // The platform's rules for JSON in presence: keys are identifiers, nesting at most
  // 8 deep, strings at most 1 KiB. 64 entries per list is its limit for data handed to
  // Claude; keeping to it here too costs nothing (the longest list in a game is the deck, 44).
  const MAX_DEPTH = 8, MAX_ENTRIES = 64, MAX_STRING_BYTES = 1024;

  const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);
  const PID_RE = /^[A-Za-z0-9_-]{4,64}$/;
  const KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
  const RESERVED = new Set(Object.getOwnPropertyNames(Object.prototype).concat('prototype'));
  // Room errors after which retrying can never help.
  const FATAL = new Set(['not_permitted', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error']);
  const EVENTS = ['snapshot', 'opponent', 'error', 'connection'];

  /* ---------- small helpers ---------- */
  function fail(code, message, reason) {
    const e = new Error(message);
    e.code = code;
    if (reason) e.reason = reason;   // the platform's own error code, when there was one
    return e;
  }
  const codeOf = e => (e && typeof e.code === 'string' ? e.code : 'upstream_error');
  const messageOf = e => (e && typeof e.message === 'string' ? e.message : String(e));
  const copy = x => JSON.parse(JSON.stringify(x));
  const noop = () => {};
  const isPid = x => typeof x === 'string' && PID_RE.test(x);
  const isSeq = n => Number.isInteger(n) && n >= 1 && n <= MAX_SEQ;
  const isPlainObject = x => !!x && typeof x === 'object' && !Array.isArray(x);

  // UTF-8 size of a string, which is how the platform counts presence bytes.
  function utf8Length(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xFC00) === 0xDC00) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  // Run fn after ms and return a cancel function. Timer functions are called without a
  // receiver, so the browser's own setTimeout can be passed in as it is.
  function later(timers, ms, fn) {
    let live = true;
    const set = timers.setTimeout, clear = timers.clearTimeout;
    const id = set(() => { if (live) { live = false; fn(); } }, ms);
    return () => { if (live) { live = false; if (clear) clear(id); } };
  }

  // A yes/no signal that turns on at once but turns off only after staying off for `ms`.
  function steady(timers, ms, onChange) {
    let raw = false, shown = false, cancel = null;
    return {
      shown: () => shown,
      set(on) {
        raw = on;
        if (on) {
          if (cancel) { cancel(); cancel = null; }
          if (!shown) { shown = true; onChange(true); }
        } else if (shown && !cancel) {
          cancel = later(timers, ms, () => { cancel = null; if (!raw) { shown = false; onChange(false); } });
        }
      },
      stop() { if (cancel) cancel(); cancel = null; },
    };
  }

  // "  K7QM 2X " -> "k7qm2x"; null if it can't be a game code.
  function normalizeCode(text) {
    if (typeof text !== 'string') return null;
    const code = text.trim().toLowerCase().replace(/[\s-]/g, '');
    return CODE_RE.test(code) ? code : null;
  }

  function makeCode(random) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      const r = random();
      const k = Number.isFinite(r) ? Math.min(ALPHABET.length - 1, Math.max(0, Math.floor(r * ALPHABET.length))) : 0;
      code += ALPHABET[k];
    }
    return code;
  }

  // Names come from the other player. Keep them short and drop control, format and
  // private-use characters (some of which can reorder text on screen). Plain text, not HTML.
  function cleanName(s) {
    if (typeof s !== 'string') return '';
    const t = s.replace(/\s+/gu, ' ')
      .replace(/[\p{Cc}\p{Co}\p{Cs}]/gu, '')
      .replace(/(?!‍)\p{Cf}/gu, '')   // keep the zero-width joiner that emoji need
      .trim();
    return Array.from(t).slice(0, NAME_MAX).join('').trim();
  }

  /* ---------- snapshots ---------- */

  // Is x plain JSON that fits the platform's presence rules, at most `depth` levels deep?
  function fits(x, depth) {
    if (x === null || typeof x === 'boolean') return true;
    if (typeof x === 'number') return Number.isFinite(x);
    if (typeof x === 'string') return utf8Length(x) <= MAX_STRING_BYTES && !/\p{Cc}/u.test(x);
    if (typeof x !== 'object' || depth < 1) return false;
    if (Array.isArray(x)) return x.length <= MAX_ENTRIES && x.every(v => fits(v, depth - 1));
    const proto = Object.getPrototypeOf(x);
    if (proto !== Object.prototype && proto !== null) return false;
    const keys = Object.keys(x);
    return keys.length <= MAX_ENTRIES && keys.every(k => KEY_RE.test(k) && !RESERVED.has(k) && fits(x[k], depth - 1));
  }

  // A game snapshot: a plain object with a valid seq that fits inside presence (one level down).
  const isSnapshot = g => isPlainObject(g) && isSeq(g.seq) && fits(g, MAX_DEPTH - 1);

  // JSON with sorted keys, so two copies of one game compare equal whatever their key order.
  function canonical(x) {
    if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
    return JSON.stringify(x);
  }

  // Peers' presence objects are frozen and stay the same object until they change, so a
  // snapshot is checked once, however many times the room is delivered.
  const checked = new WeakMap();
  function gameInfo(g) {
    let info = checked.get(g);
    if (!info) {
      const ok = isSnapshot(g);
      info = { ok, key: ok ? canonical(g) : '' };
      checked.set(g, info);
    }
    return info;
  }

  /* ---------- reading the room ---------- */

  // One peer as this game sees it, or null for anything that isn't another page of this game.
  function readPeer(peer) {
    if (!peer || typeof peer !== 'object' || peer.kind !== 'viewer' || peer.sameTab === true) return null;
    const pr = peer.presence;
    if (!isPlainObject(pr) || pr.app !== APP) return null;
    if (pr.v !== VERSION) return { foreign: true, seat: pr.seat };   // another version of the game
    if (!isPid(pr.pid) || (pr.seat !== 0 && pr.seat !== 1)) return null;
    if (pr.vs != null && !isPid(pr.vs)) return null;
    return {
      pid: pr.pid,
      by: typeof peer.by === 'string' && peer.by ? peer.by : null,   // stamped by the platform: can't be forged
      seat: pr.seat,
      vs: pr.vs || null,
      name: cleanName(pr.name),
      game: pr.game == null ? null : pr.game,   // checked before use
      updatedAt: Number.isFinite(peer.updatedAt) ? peer.updatedAt : 0,
    };
  }

  // Who the host pairs with when several guests ask at once: one it played before,
  // then whoever asked first, then the lower pid (so the choice never wobbles).
  const firstClaim = me => (a, b) => (b.vs === me) - (a.vs === me)
    || a.updatedAt - b.updatedAt
    || (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0);

  // What a joining guest makes of the room: { host } to take seat 1, { error } to give up,
  // or null to keep waiting (other pages may still be answering).
  function judgeRoom(peers, pid) {
    const all = [];
    for (const raw of peers) { const p = readPeer(raw); if (p) all.push(p); }
    const hosts = all.filter(p => !p.foreign && p.seat === 0);
    if (!hosts.length) {
      if (all.some(p => p.foreign && p.seat === 0)) {
        return { error: fail('unavailable', 'The host has a different version of Mythic Pacts. Both players should reload the page.') };
      }
      return null;
    }
    const users = new Map();   // pid -> the platform user ids claiming it
    for (const h of hosts) { if (!users.has(h.pid)) users.set(h.pid, new Set()); users.get(h.pid).add(h.by); }
    if ([...users.values()].some(ids => ids.size > 1)) {
      return { error: fail('unavailable', 'More than one page claims to host this game. Ask the host to create a new one.') };
    }
    const mine = hosts.find(h => h.pid !== pid && h.vs === pid);
    if (mine) return { host: mine };   // our seat, kept for us
    const open = hosts.filter(h => h.pid !== pid && !h.vs).sort(firstClaim(pid));
    if (open.length) {
      const host = open[0];
      const rival = all.some(p => !p.foreign && p.seat === 1 && p.pid !== pid && (!p.vs || p.vs === host.pid));
      if (rival) return { error: fail('full', 'Someone else is already joining this game.') };
      return { host };
    }
    if (hosts.some(h => h.pid === pid)) {
      return { error: fail('full', 'This game was created with the same player id, probably in another tab of this browser.') };
    }
    return { error: fail('full', 'This game already has two players.') };
  }

  // Wait until the room shows a host we can join, or give up.
  function findHost(room, pid, timers, timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false, unsubscribe = noop, cancel = noop;
      const finish = (error, host) => {
        if (done) return;
        done = true;
        cancel();
        try { unsubscribe(); } catch (e) { /* already gone */ }
        if (error) reject(error); else resolve(host);
      };
      const look = peers => {
        if (done || !Array.isArray(peers)) return;
        const verdict = judgeRoom(peers, pid);
        if (verdict) finish(verdict.error, verdict.host);
      };
      cancel = later(timers, timeoutMs, () => finish(fail('not_found', 'No game with that code is open right now. Check the code, and that the host still has the game open.')));
      try {
        unsubscribe = room.onPeers(
          change => look(change && Array.isArray(change.peers) ? change.peers : room.peers()),
          e => finish(fail('unavailable', `The online room closed (${codeOf(e)}).`, codeOf(e))));
        look(room.peers());
      } catch (e) {
        finish(fail('unavailable', `Couldn't watch the online room (${messageOf(e)}).`));
      }
    });
  }

  function joinRoom(ns, code) {
    try { return Promise.resolve(ns.join(ROOM_PREFIX + code)); } catch (e) { return Promise.reject(e); }
  }

  async function enter(ns, code) {
    if (!ns || typeof ns.join !== 'function') throw fail('unavailable', 'Online play is not available here.');
    let room;
    try { room = await joinRoom(ns, code); } catch (e) {
      throw fail('unavailable', `Couldn't open the online room (${codeOf(e)}).`, codeOf(e));
    }
    if (!room || ['presence', 'peers', 'onPeers', 'leave'].some(f => typeof room[f] !== 'function')) {
      throw fail('unavailable', 'The online room did not open properly.');
    }
    return room;
  }

  function quietlyLeave(room) {
    try { Promise.resolve(room.leave()).catch(noop); } catch (e) { /* nothing to undo */ }
  }

  /* ---------- the session ---------- */
  class Session {
    constructor(o, room, s) {
      this.code = s.code;
      this.seat = s.seat;
      this.pid = s.pid;
      this._ns = o.ns;
      this._room = room;
      this._timers = o.timers;
      this._accept = o.accept;
      this._graceMs = o.graceMs;
      this._name = s.name;
      this._mate = s.mate || null;         // the opponent's pid
      this._mateBy = s.mateBy || null;     // and their platform user id, when the platform gives one
      this._oppName = s.oppName || null;
      this._snap = s.snap || null;
      this._snapKey = this._snap ? canonical(this._snap) : '';
      this._listeners = { snapshot: [], opponent: [], error: [], connection: [] };
      this._unsubscribe = [];
      this._refused = new WeakSet();       // opponent snapshots already reported as refused
      this._lastBad = undefined;
      this._ousted = false;                // the host paired with someone else
      // After a reload this side may hold an old copy of the game. Until the opponent's presence
      // has been seen (and anything newer adopted) a commit could overwrite real moves, so wait.
      this._synced = !!s.synced;
      this._closed = false;
      this._leaving = null;
      this._retry = null;                  // cancels a pending presence retry
      this._retryMs = RETRY_MS;
      this._rejoin = null;                 // cancels a pending room re-join
      this._twin = null;                   // cancels a pending "open twice" warning
      this._twinWarned = false;
      this._opp = steady(o.timers, o.graceMs, up => this._emit('opponent', { connected: up, name: this._oppName }));
      this._conn = steady(o.timers, o.graceMs, up => this._emit('connection', up));
    }

    /* ----- public API ----- */
    names() {
      const n = [null, null];
      n[this.seat] = this._name;
      n[this.seat ^ 1] = this._oppName;
      return n;
    }

    opponentConnected() { return this._opp.shown(); }

    // This page's own link to the room (debounced like the opponent's).
    connected() { return this._conn.shown(); }

    snapshot() { return this._snap ? copy(this._snap) : null; }

    // Publish my new snapshot. `baseSeq` (optional) is the seq of the snapshot the move was
    // made on; if the game has moved on since, the commit is refused with code 'stale'.
    commit(game, baseSeq) {
      if (this._closed) throw fail('closed', 'This online game has been left.');
      if (this._ousted) throw fail('full', 'The host is playing this game with someone else.');
      if (!this._synced) throw fail('not_synced', "Waiting to hear from the opponent, so an old copy of the game can't overwrite newer moves.");
      const current = this._snap ? this._snap.seq : 0;
      if (baseSeq !== undefined && baseSeq !== current) {
        throw fail('stale', `This move was made on update ${baseSeq}, but the game is already at update ${current}.`);
      }
      if (!isPlainObject(game)) throw fail('invalid_snapshot', 'A game snapshot must be a plain object.');
      if (current >= MAX_SEQ) throw fail('invalid_snapshot', 'This game has run out of update numbers.');
      let snap;
      try { snap = JSON.parse(JSON.stringify(game)); } catch (e) {
        throw fail('invalid_snapshot', `A game snapshot must be plain JSON (${messageOf(e)}).`);
      }
      if (!isPlainObject(snap)) throw fail('invalid_snapshot', 'A game snapshot must be a plain object.');
      snap.seq = current + 1;
      if (!isSnapshot(snap)) {
        throw fail('invalid_snapshot', 'A game snapshot must use identifier keys, nest at most 7 levels, keep lists to 64 entries and keep strings short and free of control characters.');
      }
      const bytes = utf8Length(JSON.stringify(this._presence(snap)));
      if (bytes > PRESENCE_LIMIT) {
        throw fail('too_large', `This snapshot needs ${bytes} bytes of presence; the platform allows ${PRESENCE_LIMIT}.`);
      }
      try { game.seq = snap.seq; } catch (e) { /* a frozen object: the stored copy has the seq */ }
      this._snap = snap;
      this._snapKey = canonical(snap);
      this._publish();
      this._emit('snapshot', copy(snap), { fromOpponent: false, previousSeq: current });
      return copy(snap);
    }

    on(event, fn) {
      if (!EVENTS.includes(event)) throw new TypeError(`Online: unknown event "${event}"`);
      if (typeof fn !== 'function') throw new TypeError('Online: on() needs a function');
      const list = this._listeners[event], entry = { fn };   // one entry per call: two registrations, two unsubscribes
      list.push(entry);
      return () => { const i = list.indexOf(entry); if (i >= 0) list.splice(i, 1); };
    }

    save() {
      return {
        v: 1, code: this.code, seat: this.seat, pid: this.pid, name: this._name,
        mate: this._mate, mateBy: this._mateBy, oppName: this._oppName, snap: this._snap ? copy(this._snap) : null,
      };
    }

    leave() {
      if (!this._leaving) {
        this._closed = true;
        for (const cancel of [this._retry, this._rejoin, this._twin]) if (cancel) cancel();
        this._retry = this._rejoin = this._twin = null;
        this._opp.stop();
        this._conn.stop();
        this._detach();
        for (const event of EVENTS) this._listeners[event].length = 0;
        const room = this._room;
        this._room = null;
        this._leaving = room ? Promise.resolve().then(() => room.leave()).then(noop, noop) : Promise.resolve();
      }
      return this._leaving;
    }

    /* ----- inside ----- */
    _presence(snap = this._snap) {
      // null removes a field, so an unpaired host has no `vs` and a player without a game no `game`.
      return { app: APP, v: VERSION, pid: this.pid, seat: this.seat, name: this._name, vs: this._mate, game: snap };
    }

    // The first presence is awaited, so a refusal fails create/join/resume instead of
    // arriving as an event before the UI could listen.
    async _start() {
      const room = this._room;
      this._attach(room);
      try {
        await room.presence(this._presence());
      } catch (e) {
        await this.leave();
        throw fail('unavailable', `Couldn't take a seat in the online room (${codeOf(e)}).`, codeOf(e));
      }
      return this;
    }

    _attach(room) {
      const lost = e => this._lost(room, e);
      const live = fn => arg => { if (room === this._room && !this._closed) fn(arg); };
      try {
        this._unsubscribe = [
          room.onPeers(live(change => this._sync(change && Array.isArray(change.peers) ? change.peers : room.peers())), lost),
        ];
        if (typeof room.onConnection === 'function') this._unsubscribe.push(room.onConnection(live(up => this._connected(up === true)), lost));
      } catch (e) {
        lost(e);
        return;
      }
      try { if (typeof room.connected === 'function') this._conn.set(room.connected() === true); } catch (e) { /* unknown yet */ }
      let now = [];
      try { now = room.peers(); } catch (e) { /* the platform hasn't answered yet */ }
      this._sync(now);
    }

    _detach() {
      for (const stop of this._unsubscribe) { try { stop(); } catch (e) { /* already stopped */ } }
      this._unsubscribe = [];
    }

    _connected(up) {
      this._conn.set(up);
      // The platform re-sends presence after a reconnect by itself; sending it again also
      // covers a presence call that failed while the link was down.
      if (up) this._publish();
    }

    // The room changed: pair, adopt a newer opponent snapshot, then report the opponent.
    _sync(peers) {
      if (this._closed) return;
      const others = [];
      let twin = false;
      for (const raw of Array.isArray(peers) ? peers : []) {
        const p = readPeer(raw);
        if (!p || p.foreign) continue;
        if (p.seat === this.seat) { if (p.pid === this.pid) twin = true; continue; }
        others.push(p);
      }
      this._watchTwin(twin);

      // The host pairs with the first guest who asks and from then on listens to that player only.
      if (this.seat === 0 && !this._mate) {
        const asking = others.filter(p => p.pid !== this.pid && (!p.vs || p.vs === this.pid)).sort(firstClaim(this.pid));
        if (asking.length) { this._mate = asking[0].pid; this._mateBy = asking[0].by; this._publish(); }
      }
      let opp = this._mate ? others.filter(p => p.pid === this._mate && (!this._mateBy || p.by === this._mateBy)) : [];
      if (this.seat === 1 && opp.some(p => p.vs && p.vs !== this.pid)) {
        if (!this._ousted) {
          this._ousted = true;
          this._emit('error', { code: 'full', message: 'The host is playing this game with someone else.' });
        }
        opp = [];
      }
      if (this._closed) return;
      this._adoptBest(opp);
      if (opp.length) this._synced = true;

      const named = opp.find(p => p.name);
      const renamed = !!named && named.name !== this._oppName;
      if (renamed) this._oppName = named.name;
      const wasUp = this._opp.shown();
      this._opp.set(opp.length > 0);
      if (renamed && wasUp && this._opp.shown()) this._emit('opponent', { connected: true, name: this._oppName });
    }

    _adoptBest(opp) {
      let best = null, bestKey = '';
      for (const p of opp) {
        const g = p.game;
        if (g === null) continue;
        const info = typeof g === 'object' ? gameInfo(g) : { ok: false };
        if (!info.ok) { this._refuse(g, 'bad_snapshot', "Ignored a game update from the opponent that isn't in the expected format."); continue; }
        // Two tabs of the same opponent: the higher seq, then a fixed order, so the choice is stable.
        if (!best || g.seq > best.seq || (g.seq === best.seq && info.key < bestKey)) { best = g; bestKey = info.key; }
      }
      if (!best) return;
      const mine = this._snap;
      const newer = !mine || best.seq > mine.seq || (best.seq === mine.seq && this.seat === 1 && bestKey !== this._snapKey);
      if (!newer || this._refused.has(best)) return;
      if (this._accept) {
        let ok = false;
        try { ok = this._accept(copy(best), mine ? copy(mine) : null) === true; } catch (e) { ok = false; }
        if (!ok) { this._refuse(best, 'rejected', `Ignored the opponent's update ${best.seq}: it failed the game's checks.`); return; }
      }
      this._snap = copy(best);
      this._snapKey = bestKey;
      this._publish();   // mirror it, so either side can recover the game from the other
      this._emit('snapshot', copy(this._snap), { fromOpponent: true, previousSeq: mine ? mine.seq : 0 });
    }

    // Report a refused opponent snapshot once, not on every delivery of the room.
    _refuse(g, code, message) {
      if (g && typeof g === 'object') {
        if (this._refused.has(g)) return;
        this._refused.add(g);
      } else {
        if (g === this._lastBad) return;
        this._lastBad = g;
      }
      this._emit('error', { code, message });
    }

    // The same player and seat open in another tab: both would move for one player.
    // Warn only if it lasts, since a reloading tab briefly overlaps its old self.
    _watchTwin(present) {
      if (!present) {
        if (this._twin) { this._twin(); this._twin = null; }
        this._twinWarned = false;
        return;
      }
      if (this._twinWarned || this._twin) return;
      this._twin = later(this._timers, this._graceMs, () => {
        this._twin = null;
        this._twinWarned = true;
        this._emit('error', { code: 'duplicate', message: 'This game is also open in another tab or window as the same player. Close one of them.' });
      });
    }

    _publish() {
      const room = this._room;
      if (this._closed || !room) return;
      let sent;
      try { sent = Promise.resolve(room.presence(this._presence())); } catch (e) { sent = Promise.reject(e); }
      sent.then(() => { if (room === this._room) this._retryMs = RETRY_MS; }, e => this._publishFailed(room, e));
    }

    _publishFailed(room, e) {
      if (this._closed || room !== this._room) return;
      const code = codeOf(e);
      if (code === 'invalid_argument' || FATAL.has(code)) {
        this._emit('error', { code, message: `Couldn't share the game with the opponent: ${messageOf(e)}` });
        return;
      }
      if (this._retry) return;   // a retry is already waiting; it sends the latest state
      const ms = this._retryMs;
      this._retryMs = Math.min(ms * 2, RETRY_MAX_MS);
      this._retry = later(this._timers, ms, () => { this._retry = null; this._publish(); });
    }

    // A listener's error means this room has ended for this page. Join it again (with
    // growing pauses) unless the platform says never.
    _lost(room, e) {
      if (this._closed || room !== this._room) return;
      const code = codeOf(e);
      this._detach();
      this._room = null;
      this._conn.set(false);
      this._sync([]);   // the opponent can't be seen now; reported if this outlasts the grace period
      if (FATAL.has(code)) {
        this._emit('error', { code, message: `Online play stopped (${code}).` });
        return;
      }
      this._scheduleRejoin(RETRY_MS);
    }

    _scheduleRejoin(ms) {
      this._rejoin = later(this._timers, ms, () => {
        this._rejoin = null;
        joinRoom(this._ns, this.code).then(room => {
          if (this._closed) { quietlyLeave(room); return; }
          this._room = room;
          this._attach(room);
          this._publish();
        }, e => {
          if (this._closed) return;
          const code = codeOf(e);
          if (FATAL.has(code)) { this._emit('error', { code, message: `Couldn't rejoin the online game (${code}).` }); return; }
          this._scheduleRejoin(Math.min(ms * 2, RETRY_MAX_MS));
        });
      });
    }

    _emit(event, ...args) {
      const list = this._listeners[event];
      for (const entry of list.slice()) {
        if (this._closed) return;
        if (!list.includes(entry)) continue;   // unsubscribed by an earlier listener
        try { entry.fn(...args); } catch (e) {
          later(this._timers, 0, () => { throw e; });   // show the UI's bug without breaking the protocol
        }
      }
    }
  }

  /* ---------- starting a session ---------- */
  function settings(opts) {
    if (!opts || typeof opts !== 'object') throw new TypeError('Online: expected an options object');
    const t = opts.timers;
    const timers = t
      ? { setTimeout: t.setTimeout, clearTimeout: typeof t.clearTimeout === 'function' ? t.clearTimeout : null }
      : {
        setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
        clearTimeout: typeof globalThis.clearTimeout === 'function' ? id => globalThis.clearTimeout(id) : null,
      };
    if (typeof timers.setTimeout !== 'function') throw new TypeError('Online: timers.setTimeout must be a function');
    const ms = (x, d) => (Number.isFinite(x) && x >= 0 ? x : d);
    return {
      ns: opts.room || null,
      pid: opts.pid,
      name: cleanName(opts.name),
      timers,
      accept: typeof opts.accept === 'function' ? opts.accept : null,
      graceMs: ms(opts.graceMs, GRACE_MS),
      timeoutMs: ms(opts.timeoutMs, JOIN_TIMEOUT_MS),
      random: typeof opts.random === 'function' ? opts.random : Math.random,
    };
  }

  function checkPid(pid) {
    if (!isPid(pid)) throw new TypeError('Online: pid must be 4 to 64 letters, digits, "_" or "-"');
  }

  // Host: open a new game and wait for a guest.
  async function create(opts) {
    const o = settings(opts);
    checkPid(o.pid);
    const code = makeCode(o.random);
    const room = await enter(o.ns, code);
    const s = new Session(o, room, { code, seat: 0, pid: o.pid, name: o.name || 'Host', mate: null, oppName: null, snap: null, synced: true });
    return s._start();
  }

  // Guest: take seat 1 in the game with this code.
  async function join(opts) {
    const o = settings(opts);
    checkPid(o.pid);
    const code = normalizeCode(opts.code);
    if (!code) throw fail('bad_code', "That isn't a game code. Codes are 6 letters and digits, like K7QM2X.");
    const room = await enter(o.ns, code);
    let host;
    try { host = await findHost(room, o.pid, o.timers, o.timeoutMs); } catch (e) {
      quietlyLeave(room);
      throw e;
    }
    const s = new Session(o, room, { code, seat: 1, pid: o.pid, name: o.name || 'Guest', mate: host.pid, mateBy: host.by, oppName: host.name || null, snap: null, synced: true });
    return s._start();
  }

  function readSave(x) {
    if (!isPlainObject(x) || x.v !== 1 || normalizeCode(x.code) !== x.code) return null;
    if ((x.seat !== 0 && x.seat !== 1) || !isPid(x.pid)) return null;
    if (x.mate != null && !isPid(x.mate)) return null;
    if (x.seat === 1 && !x.mate) return null;   // a guest always knows its host
    if (x.mateBy != null && (typeof x.mateBy !== 'string' || !x.mateBy)) return null;
    if (x.snap != null && !isSnapshot(x.snap)) return null;
    return {
      code: x.code, seat: x.seat, pid: x.pid,
      name: cleanName(x.name) || (x.seat ? 'Guest' : 'Host'),
      mate: x.mate || null,
      mateBy: x.mateBy || null,
      oppName: cleanName(x.oppName) || null,
      snap: x.snap ? copy(x.snap) : null,
      synced: false,
    };
  }

  // Either player, after a reload: the seat, pairing and last snapshot come from session.save().
  async function resume(opts) {
    const saved = readSave(opts && opts.saved);
    if (!saved) throw fail('bad_save', 'The saved online game is missing or damaged.');
    const o = settings(Object.assign({}, opts, { pid: saved.pid }));
    const room = await enter(o.ns, saved.code);
    return new Session(o, room, saved)._start();
  }

  return Object.freeze({
    create, join, resume, normalizeCode, cleanName,
    APP, VERSION, ALPHABET, PRESENCE_LIMIT, JOIN_TIMEOUT_MS, GRACE_MS,
  });
})();
