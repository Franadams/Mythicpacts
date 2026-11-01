/* Sound effects, made in the browser with the Web Audio API, so there are no sound files to load:
   - a swish when a card is played or discarded, with a soft tap as it lands;
   - a lighter, rising swish when a card is picked up from the deck or a discard pile;
   - a click when you pick a card in your hand;
   - a twinkle of glass bells when a line earns its crystal.
   The Oracle's moves make the same sounds a little quieter. Browsers only allow sound once the player
   has touched the page, so the audio starts on the first tap or key press. The header's Sound button
   turns it on and off, and the choice is remembered in this browser. */

const Sound = (() => {
  const KEY = 'mythic-pacts:sound';
  let on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* storage unavailable: sound stays on */ }
  let live = null;   // the page's audio graph, made on the first tap
  let waking = null;   // while the browser resumes the audio after a tap: its promise

  // An audio graph on context `ctx`: a master volume with a gentle compressor (so overlapping sounds
  // don't clip), a second of white noise (the raw material of swishes and clicks), and a short
  // filtered echo that gives the crystal's bells their sparkling tail.
  function graph(ctx) {
    const master = ctx.createGain();
    master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const echo = ctx.createDelay(1), feedback = ctx.createGain(), tone = ctx.createBiquadFilter(), wet = ctx.createGain();
    echo.delayTime.value = 0.14;
    feedback.gain.value = 0.32;
    tone.type = 'lowpass'; tone.frequency.value = 5200;
    wet.gain.value = 0.45;
    echo.connect(tone).connect(feedback).connect(echo);
    tone.connect(wet).connect(master);
    return { ctx, master, noise, echo };
  }

  function noiseSource(g, t, dur, loop = false) {
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = loop;
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
    return src;
  }
  // A gain that rises to `peak` after `attack` seconds and dies away by `end`.
  function envelope(g, t, peak, attack, end) {
    const e = g.ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(peak, t + attack);
    e.gain.exponentialRampToValueAtTime(0.0001, t + end);
    return e;
  }
  function panned(g, node, pan) {
    if (!pan || !g.ctx.createStereoPanner) return node;
    const p = g.ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    return p;
  }

  // Noise through a band-pass filter whose pitch slides from f0 to f1: the air moving past a card.
  function swish(g, t, dur, f0, f1, peak, pan = 0) {
    const bp = g.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const e = envelope(g, t, peak, dur * 0.35, dur);
    noiseSource(g, t, dur + 0.05, true).connect(bp).connect(e);
    panned(g, e, pan).connect(g.master);
  }
  // A card landing on the table: a low thump with a little papery noise on top.
  function tap(g, t, peak) {
    const o = g.ctx.createOscillator();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.09);
    o.connect(envelope(g, t, peak, 0.004, 0.11)).connect(g.master);
    o.start(t); o.stop(t + 0.12);
    const lp = g.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    noiseSource(g, t, 0.05).connect(lp).connect(envelope(g, t, peak * 0.5, 0.002, 0.04)).connect(g.master);
  }
  // A short, crisp click: a tick of high noise and a falling chirp.
  function click(g, t, peak) {
    const hp = g.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2500;
    noiseSource(g, t, 0.03).connect(hp).connect(envelope(g, t, peak, 0.001, 0.025)).connect(g.master);
    const o = g.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1900, t);
    o.frequency.exponentialRampToValueAtTime(1300, t + 0.04);
    o.connect(envelope(g, t, peak * 0.6, 0.002, 0.05)).connect(g.master);
    o.start(t); o.stop(t + 0.06);
  }
  // A small glass bell: a sine with the out-of-tune overtones (2.76 and 5.4 times the pitch) of a bell.
  function bell(g, t, freq, peak, pan) {
    const e = envelope(g, t, peak, 0.008, 1.1);
    for (const [ratio, level] of [[1, 1], [2.76, 0.28], [5.4, 0.1]]) {
      const o = g.ctx.createOscillator(), lv = g.ctx.createGain();
      o.frequency.value = freq * ratio;
      lv.gain.value = level;
      o.connect(lv).connect(e);
      o.start(t); o.stop(t + 1.15);
    }
    const out = panned(g, e, pan);
    out.connect(g.master);
    out.connect(g.echo);
  }
  // Six bells rising through E major's pentatonic notes, left and right in turn, over a shimmer of high noise.
  function twinkle(g, t, peak) {
    [1318.5, 1661.2, 1975.5, 2217.5, 2637.0, 3322.4].forEach((f, i) => bell(g, t + i * 0.075, f, peak * (0.7 + 0.06 * i), i % 2 ? 0.35 : -0.35));
    const hp = g.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7000;
    noiseSource(g, t, 1, true).connect(hp).connect(envelope(g, t, peak * 0.12, 0.15, 0.9)).connect(g.master);
  }

  // Each sound, scheduled on graph g at time t. quiet: one of the Oracle's moves.
  const SOUNDS = {
    // ms: how long the card flies, so the tap lands with it.
    place: (g, t, { ms = 420, quiet = false } = {}) => {
      const k = quiet ? 0.6 : 1, d = ms / 1000;
      swish(g, t, Math.max(0.18, d * 0.85), 3800, 700, 0.42 * k);
      tap(g, t + Math.max(0.05, d - 0.02), 0.32 * k);
    },
    // settle: also a soft swish as the card slides into the hand that many ms later.
    pickup: (g, t, { quiet = false, settle = 0 } = {}) => {
      const k = quiet ? 0.6 : 1;
      swish(g, t, 0.32, 650, 3400, 0.6 * k);
      if (settle) swish(g, t + settle / 1000, 0.36, 2600, 800, 0.24 * k);
    },
    click: (g, t) => click(g, t, 0.3),
    twinkle: (g, t, { quiet = false } = {}) => twinkle(g, t, quiet ? 0.13 : 0.19),
  };

  function start() {
    if (live || !on) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { live = graph(new AC()); } catch (e) { live = null; }
  }
  // Called on every tap and key press: makes the audio on the first one, and wakes it if the browser paused it.
  function unlock() {
    if (!on) return;
    start();
    if (live && live.ctx.state === 'suspended' && !waking) waking = live.ctx.resume().catch(() => {}).finally(() => { waking = null; });
  }
  function play(name, opts) {
    if (!on || !live || document.hidden) return;
    // Straight after a tap the audio may still be waking up: play once it has.
    if (live.ctx.state === 'suspended' && waking) { waking.then(() => play(name, opts)); return; }
    if (live.ctx.state !== 'running') return;
    try { SOUNDS[name](live, live.ctx.currentTime + 0.01, opts); } catch (e) { /* a sound is never worth breaking the game */ }
  }
  function setOn(v) {
    on = !!v;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* storage unavailable */ }
    if (on) unlock();
    else if (live) live.ctx.suspend().catch(() => {});
  }
  // For tests: renders one sound offline and reports its loudest sample and how long it rings.
  async function measure(name, opts, seconds = 2) {
    const rate = 44100, ctx = new OfflineAudioContext(2, rate * seconds, rate);
    SOUNDS[name](graph(ctx), 0.05, opts);
    const buf = await ctx.startRendering(), data = buf.getChannelData(0);
    let peak = 0, last = 0;
    for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; if (a > 0.001) last = i; }
    return { peak, ringsFor: last / rate };
  }

  return { play, unlock, setOn, isOn: () => on, measure };
})();
