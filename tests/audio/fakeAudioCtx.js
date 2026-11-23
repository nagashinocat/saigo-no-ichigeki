// 身代わりの AudioContext を使うテストの共通部（replaySkip.test.js・puffThump.test.js）
// 身代わりの AudioContext（roundReset.test.js と同じ形。止めた時刻 stopT・外した道 cuts も記録する）
export function param(v0) {
  let ev = [];
  const p = {
    value: v0,
    setValueAtTime(v, t) { ev.push({ k: 'set', t, v }); return p; },
    linearRampToValueAtTime(v, t) { ev.push({ k: 'lin', t, v }); return p; },
    exponentialRampToValueAtTime(v, t) { ev.push({ k: 'exp', t, v }); return p; },
    setTargetAtTime(v, t, tc) { ev.push({ k: 'target', t, v, tc }); return p; },
    cancelScheduledValues(t) { ev = ev.filter((e) => e.t < t); return p; },
    at(t) {
      let v = p.value, tv = 0, target = null;
      for (const e of [...ev].sort((a, b) => a.t - b.t)) {
        if (e.t > t) {
          if (target) break;
          if (e.k === 'lin') return v + (e.v - v) * (t - tv) / (e.t - tv);
          if (e.k === 'exp') return v * (e.v / v) ** ((t - tv) / (e.t - tv));
          break;
        }
        if (target) { v = target.v + (v - target.v) * Math.exp(-(e.t - tv) / target.tc); target = null; }
        if (e.k === 'target') target = e; else v = e.v;
        tv = e.t;
      }
      if (target) v = target.v + (v - target.v) * Math.exp(-(t - tv) / target.tc);
      return v;
    },
  };
  return p;
}
export function fakeCtx() {
  const ctx = { state: 'running', currentTime: 5, sampleRate: 8000, destination: { name: 'destination' }, gains: [], sources: [], oscs: [], links: [], filters: [], cuts: [] };
  const node = (extra) => ({ connect(to) { ctx.links.push([this, to]); return to; }, disconnect() { this.cut = true; ctx.cuts.push(this); }, ...extra });
  Object.assign(ctx, {
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    suspend() { ctx.state = 'suspended'; return Promise.resolve(); },
    createGain() { const g = node({ gain: param(1) }); ctx.gains.push(g); return g; },
    createBiquadFilter() { const f = node({ type: '', frequency: param(350), Q: param(1) }); ctx.filters.push(f); return f; },
    createDynamicsCompressor() { return node({ threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) }); },
    createDelay() { return node({ delayTime: param(0) }); },
    createStereoPanner() { return node({ pan: param(0) }); },
    createWaveShaper() { return node({ curve: null, oversample: 'none' }); },
    createOscillator() { const o = node({ type: '', frequency: param(440), startT: null, stopT: Infinity, start(t = 0) { o.startT = t; }, stop(t = 0) { o.stopT = t; } }); ctx.oscs.push(o); return o; },
    createBuffer(ch, n, sr) { const d = new Float32Array(n); return { duration: n / sr, sampleRate: sr, getChannelData: () => d }; },
    createBufferSource() { const s = node({ buffer: null, loop: false, playbackRate: param(1), startT: null, stopT: Infinity, start(t = 0) { s.startT = t; }, stop(t = 0) { s.stopT = t; } }); ctx.sources.push(s); return s; },
  });
  return ctx;
}
