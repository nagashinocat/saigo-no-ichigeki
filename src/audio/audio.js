// Web Audio で合成する音。素材ファイルは使わない。
// 世界の音は master を経由するので、silence で全部まとめて黙らせられる（演出の音は cine から鳴る）。
// boom を鳴らすまでの待ち（秒）: 無音の間（silenceEnd まで）に弾けても、無音が明けてから鳴らす
export function boomDelay(silenceEnd, now) {
  return Math.max(0, silenceEnd - now);
}

// 崩落の音の最短の間隔（秒）。毎フレーム何発も重ねると、中くらいの Android で音の部品が百近く同時に鳴ってしまう
export const CRUMBLE_GAP_SEC = 0.05;

// 崩落の音の間引き: 間隔が空くまでの命中はためておき、次に鳴らす一回にまとめる。take は今鳴らす数（0 なら鳴らさない）
export function createCrumbleGate(gap = CRUMBLE_GAP_SEC) {
  let last = -Infinity, pending = 0;
  return {
    take(count, now) {
      pending += Math.max(0, count);
      if (pending <= 0 || now - last < gap - 1e-9) return 0;
      last = now;
      const out = pending;
      pending = 0;
      return out;
    },
  };
}

export function createAudio() {
  const crumbleGate = createCrumbleGate();
  let silenceEnd = 0;
  let ctx = null, master = null, hum = null, rumbleNode = null, noiseBuf = null;
  // 最後の一発の演出: 世界の音（master）と演出の音（cine: 心臓の鼓動・地鳴り）は、どちらも out のこもりを通る
  let cine = null, out = null;

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    out = ctx.createBiquadFilter();
    out.type = 'lowpass'; out.frequency.value = 20000; out.Q.value = 0.5;
    out.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(out);
    cine = ctx.createGain();
    cine.gain.value = 0.9;
    cine.connect(out);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // 貯めの唸り: 低い正弦波 2 つの周波数差がうなりになる
    const humGain = ctx.createGain(); humGain.gain.value = 0;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = o2.type = 'sine';
    o1.connect(humGain); o2.connect(humGain); humGain.connect(master);
    o1.start(); o2.start();
    hum = { o1, o2, gain: humGain };
    // 爆発のじわじわ期の低い脈動
    const rg = ctx.createGain(); rg.gain.value = 0;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 90;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0;
    lfo.connect(lfoGain); lfoGain.connect(rg.gain);
    src.connect(lp); lp.connect(rg); rg.connect(master);
    src.start(); lfo.start();
    rumbleNode = { gain: rg, lfoGain };
  }

  const ready = () => ctx && ctx.state === 'running';
  const now = () => ctx.currentTime;

  function noiseBurst({ dur, freq, gain, attack = 0.005, when = 0, q = 0.7, dest = null }) {
    const t = now() + when;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = q;
    lp.frequency.setValueAtTime(freq, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.15), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp); lp.connect(g); g.connect(dest ?? master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  // 低い正弦波の一打（周波数は f0 から f1 へ下がる）
  function thump({ f0, f1, dur, gain, when = 0, dest, attack = 0.008 }) {
    const t = now() + when;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  return {
    // 最初のユーザー操作で呼ぶ（ブラウザの自動再生の制限）
    unlock() {
      if (!ctx) build();
      if (ctx && ctx.state !== 'running') ctx.resume();
    },
    get running() { return !!ctx && ctx.state === 'running'; },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    // level 0〜1。0 で止まる
    chargeHum(level) {
      if (!ready()) return;
      const l = Math.max(0, Math.min(1, level));
      const t = now();
      const f = 55 + 150 * l;
      hum.o1.frequency.setTargetAtTime(f, t, 0.05);
      hum.o2.frequency.setTargetAtTime(f + 2 + 7 * l, t, 0.05);
      hum.gain.gain.setTargetAtTime(l > 0 ? 0.05 + 0.2 * l : 0, t, 0.08);
    },
    // 爆発のじわじわ期の低い脈動。level 0〜1、0 で止まる
    rumble(level) {
      if (!ready()) return;
      const l = Math.max(0, Math.min(1, level));
      const t = now();
      rumbleNode.gain.gain.setTargetAtTime(l > 0 ? 0.25 * l + 0.08 : 0, t, 0.15);
      rumbleNode.lfoGain.gain.setTargetAtTime(0.12 * l, t, 0.15);
    },
    // ---- 最後の一発の演出 ----
    // 放った瞬間から、世界の音を消す（演出の音だけが鳴る）
    silence() {
      if (!ready()) return;
      const t = now();
      silenceEnd = Infinity;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0, t);
      out.frequency.cancelScheduledValues(t);
      out.frequency.setValueAtTime(20000, t);
    },
    // 時間が戻る: 世界の音が一気に戻る
    unsilence() {
      if (!ready()) return;
      const t = now();
      silenceEnd = t;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0.8, t);
    },
    // 心臓の鼓動（ドクン）。i: 何回目か（だんだん強く）
    heartbeat(i = 0) {
      if (!ready()) return;
      const k = Math.min(1, 0.6 + 0.2 * i);
      thump({ f0: 62, f1: 38, dur: 0.22, gain: 0.85 * k, dest: cine });
      noiseBurst({ dur: 0.09, freq: 160, gain: 0.25 * k, attack: 0.004, dest: cine });
      thump({ f0: 70, f1: 44, dur: 0.18, gain: 0.55 * k, when: 0.21, dest: cine });
      noiseBurst({ dur: 0.07, freq: 140, gain: 0.15 * k, attack: 0.004, when: 0.21, dest: cine });
    },
    // 宇宙へ: 音が遠くこもって消えていく（sec 秒で無音へ）
    muffle(sec = 1.5) {
      if (!ready()) return;
      const t = now();
      out.frequency.cancelScheduledValues(t);
      out.frequency.setValueAtTime(900, t);
      out.frequency.exponentialRampToValueAtTime(140, t + 0.4);
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0.8, t);
      master.gain.linearRampToValueAtTime(0, t + sec);
    },
    // 無音のあとの、低い地鳴り（長くゆっくり来て、ゆっくり引く）
    deepRumble() {
      if (!ready()) return;
      const t = now();
      out.frequency.cancelScheduledValues(t);
      out.frequency.setValueAtTime(400, t);
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 70; lp.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.9, t + 1.2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
      src.connect(lp); lp.connect(g); g.connect(cine);
      src.start(t); src.stop(t + 6.1);
      thump({ f0: 36, f1: 24, dur: 5, gain: 0.5, dest: cine, attack: 1.0 });
      // 地鳴りが引いたら、こもりと世界の音量を元に戻す（このあとの音がこもったまま・無音のままにならない）
      const back = t + 6.2;
      out.frequency.setValueAtTime(400, back);
      out.frequency.exponentialRampToValueAtTime(20000, back + 0.3);
      master.gain.cancelScheduledValues(back);
      master.gain.setValueAtTime(0, back);
      master.gain.linearRampToValueAtTime(0.8, back + 0.3);
    },
    // size 0〜1: 大きいほど長く低い
    boom(size) {
      if (!ready()) return;
      const s = Math.max(0, Math.min(1, size));
      const wait = boomDelay(silenceEnd, now());
      if (!Number.isFinite(wait)) return; // 演出の無音の間は鳴らさない
      noiseBurst({ dur: 0.8 + 2.6 * s, freq: 500 + 900 * s, gain: 0.5 + 0.5 * s, attack: 0.01, q: 1, when: wait });
      const t = now() + wait;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.6 + s);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.7, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8 + 1.6 * s);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 2.6 + s);
    },
    // 壊れた数に応じた短いノイズ。約 50 ms に一度だけ鳴らし、その間の命中はまとめる（毎フレーム呼んでよい）
    crumble(count) {
      if (!ready()) return;
      const n = crumbleGate.take(count, now());
      if (n <= 0) return;
      // 一度に鳴らすのは一つだけ。まとめた命中が多いほど大きく、長く
      const k = Math.min(1, Math.sqrt(n) / 8);
      noiseBurst({ dur: 0.14 + 0.16 * k + Math.random() * 0.08, freq: 700 + Math.random() * 900, gain: 0.12 * (1 + 1.4 * k), attack: 0.003 });
    },
  };
}
