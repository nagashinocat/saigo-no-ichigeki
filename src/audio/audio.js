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

// 最後の天井（リミッター）: 効果音・演出の音・BGM はすべてこれを通ってスピーカーへ。
// 最高潮の BGM に払うの爆発と貯めの唸りが重なっても 1 を超えず、スマホで割れない（天井 -2 dBFS、強い比、速いアタック）
export const LIMITER = { threshold: -2, knee: 0, ratio: 20, attack: 0.002, release: 0.2 };

// 爆発の音の設計図（音の部品は知らない純粋な関数。boom が組み立てる）。実際の爆発の聞こえ方を層に分ける:
//   crack  最初の衝撃。数十 ms の広帯域のノイズの破裂（近いほど明るく大きい）
//   punch  衝撃の芯。急に下がる低い一打（大きいほど低く長い）
//   roar   続くうなり。明るい轟音が暗く落ちていく（大きいほど長く暗い。最後の一発は hold の間鳴り続け、open の間に開く）
//   air    空気を裂く中域のノイズ（帯域が下がりながら消える）
//   sub    地響き。超低域がゆっくり来てゆっくり引き、揺れる（wobble）
//   taps   遠くのビルから遅れて届く反射音（大きいほど遅く、遠いものほど暗く小さく、左右に散る）
//   debris 崩れる破片のぱらぱら（衝撃のあとに始まり、だんだん疎らに。粒は重ならない）
// 時間はすべて爆発の瞬間からの秒。rng は粒と反射音のばらつき（テストで決まった値にする）
export function boomRecipe(size, { hold = 0, open = 0, rng = Math.random } = {}) {
  const s = Math.max(0, Math.min(1, size));
  const h = Math.max(0, hold);
  const crack = { dur: 0.03 + 0.045 * s, attack: 0.001, hp: 1100 - 650 * s, gain: 0.62 - 0.17 * s };
  const punch = { f0: 150 - 95 * s, f1: 48 - 24 * s, dur: 0.16 + 0.55 * s, attack: 0.003, gain: 0.55 + 0.15 * s };
  const roarDur = 0.5 + 3.0 * s;
  const roar = {
    dur: roarDur + h, hold: h, open: Math.max(0, open), f0: 5200 - 3000 * s, f1: 170 - 100 * s,
    attack: 0.004 + 0.02 * s, gain: 0.34 + 0.2 * s, drop: 0.4, knee: 0.08 + 0.35 * s,
  };
  const air = { dur: 0.22 + 1.2 * s, freq: 1700 - 800 * s, q: 1.1, attack: 0.002, gain: 0.22 + 0.06 * s };
  const sub = {
    dur: 0.45 + 4.6 * s ** 1.3 + h, hold: h, cutoff: 115 - 60 * s, attack: 0.015 + 0.2 * s, gain: 0.3 + 0.6 * s,
    wobble: { rate: (6 - 3 * s) * (0.9 + 0.2 * rng()), depth: 0.1 + 0.18 * s },
  };
  const taps = [];
  const nTaps = 2 + Math.round(3 * s), first = 0.04 + 0.3 * s;
  for (let i = 0; i < nTaps; i++) {
    taps.push({
      delay: first * (1 + 0.85 * i) * (0.93 + 0.14 * rng()),
      gain: (0.5 - 0.12 * s) * 0.65 ** i,
      cutoff: (3200 - 2000 * s) * 0.72 ** i,
      pan: (i % 2 ? 1 : -1) * (0.25 + 0.45 * rng()),
    });
  }
  const grains = [];
  const n = Math.round(7 + 38 * s + 8 * h), start = crack.dur + 0.05 + 0.3 * s, span = 0.35 + 2.6 * s + 0.8 * h;
  const us = Array.from({ length: n }, () => rng()).sort((x, y) => x - y);
  for (const u of us) {
    const chunk = rng() < 0.15; // ときどき重い塊
    let t = start + span * u ** 1.7;
    const prev = grains[grains.length - 1];
    if (prev && t <= prev.t + prev.len + 0.001) t = prev.t + prev.len + 0.002;
    const fade = 1 - 0.6 * Math.min(1, (t - start) / span);
    grains.push({
      t,
      len: chunk ? 0.04 + 0.03 * rng() : 0.008 + 0.025 * rng(),
      f: chunk ? 350 + 550 * rng() : 1800 + 4500 * rng(),
      g: (chunk ? 0.16 : 0.07 + 0.08 * rng()) * fade,
    });
  }
  // 全体の大きさ: 大きいほど少しだけ大きい（リミッターが重なりを受け止める）
  return { size: s, level: 0.85 + 0.15 * s, crack, punch, roar, air, sub, taps, debris: { grains } };
}

// 最後の一発の爆発の音の取り決め（演出の時刻表 tl から）: 時間が戻る瞬間（resume。ガラスの一拍の終わり、肩越しの乗り手が
// 光の壁に飲まれる直前）から宇宙へ切り替わる（chaseEnd）までうなりと地響きが鳴り続け、burstRamp 秒でこもった音から開く
export function finaleBoomOpts(tl, burstRamp) {
  return { hold: Math.max(0, tl.chaseEnd - (tl.resume ?? tl.snap)), open: Math.max(0, burstRamp) };
}

// 爆発の衝撃と地響きを軽く歪ませる曲線（tanh。k が大きいほど強く）
function softClip(k, n = 1024) {
  const c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}
const punchCurve = softClip(2.2), subCurve = softClip(1.6);

// 爆発の音のまとめの道の天井: 払うが続けて重なる・大きな一発と重なると、鋭い衝撃の頭がリミッター（アタック 2 ms）を
// すり抜けて 1 を超えることがある。爆発の音だけをまとめて、knee までは素通し、その上はなめらかに ceil へ寄せる
// （入力 ±range を曲線の ±1 に写す。ゲインは前段の 1 / range）
export const BOOM_CLIP = { range: 2, knee: 0.6, ceil: 1.0 };
export function boomClipCurve({ range, knee, ceil } = BOOM_CLIP, n = 2049) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * range, a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee)));
  }
  return c;
}

// AudioParam の一打の形: 無音から attack で peak へ、dur で無音へ（指数）
function env(param, t, attack, peak, dur) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + dur);
}

export function createAudio() {
  const crumbleGate = createCrumbleGate();
  let silenceEnd = 0;
  let ctx = null, master = null, hum = null, rumbleNode = null, noiseBuf = null, brownBuf = null;
  // 最後の一発の演出: 世界の音（master）と演出の音（cine: 心臓の鼓動・地鳴り）は、どちらも out のこもりを通る
  let cine = null, out = null;
  // BGM の出口（bgm.js が鳴らす）。最後の一発の演出の無音・こもり・地鳴り（master と out を動かす）とは別の道で、
  // master・out を通さずリミッターへ直接つなぐ: 地鳴りが master を 0 に保つ間にも、リプレイの静かな変奏を鳴らせるように。
  // BGM は放った瞬間に自分で止まるので、演出の無音を邪魔しない
  let bgmBus = null;
  let boomBus = null; // 爆発の音のまとめ（天井の曲線を通って master へ）
  let drone = null; // 時間切れの結末の低い唸り（鳴っている間だけ）
  let hidden = false; // タブが隠れている間（suspend から resume まで）

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const limiter = ctx.createDynamicsCompressor();
    for (const k of Object.keys(LIMITER)) limiter[k].value = LIMITER[k];
    limiter.connect(ctx.destination);
    out = ctx.createBiquadFilter();
    out.type = 'lowpass'; out.frequency.value = 20000; out.Q.value = 0.5;
    out.connect(limiter);
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(out);
    cine = ctx.createGain();
    cine.gain.value = 0.9;
    cine.connect(out);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // 地響き用のブラウンノイズ（低域に力がある。白いノイズを積分して、ずれを漏らし、大きさをそろえる）
    brownBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const bd = brownBuf.getChannelData(0);
    let acc = 0, peak = 1e-9;
    for (let i = 0; i < bd.length; i++) { acc = acc * 0.998 + d[i] * 0.05; bd[i] = acc; peak = Math.max(peak, Math.abs(acc)); }
    for (let i = 0; i < bd.length; i++) bd[i] /= peak;
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
    bgmBus = ctx.createGain();
    bgmBus.gain.value = 1;
    bgmBus.connect(limiter);
    boomBus = ctx.createGain();
    boomBus.gain.value = 1 / BOOM_CLIP.range;
    const clip = ctx.createWaveShaper(); clip.curve = boomClipCurve(); clip.oversample = '2x';
    boomBus.connect(clip); clip.connect(master);
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
    // BGM の出口（unlock の前は null）
    get bgmOutput() { return ctx && bgmBus ? { ctx, dest: bgmBus } : null; },
    // タブが隠れた / 戻った。止める処理（suspend）は少しあとで終わるので、終わったときにもう戻っていたら鳴らし直す
    // （すぐ戻ると、戻した時点ではまだ running のままで、そのあと止まりっぱなしになる）。
    // 戻ったら suspended でなくても（iOS の interrupted など）鳴らし直す
    suspend() {
      hidden = true;
      if (!ctx || ctx.state !== 'running') return;
      Promise.resolve(ctx.suspend()).then(() => { if (!hidden && ctx.state !== 'running') ctx.resume(); }, () => {});
    },
    resume() {
      hidden = false;
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') Promise.resolve(ctx.resume()).catch(() => {});
    },
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
    // ---- 時間切れの結末（ブラックホール）----
    // 低い唸り: rise 秒かけて、うなる低音（正弦波と鋸歯の重なり）が上がりながら強まり、吸い込む風の音が細く高くなる。
    // 演出の道（cine）から鳴らす。droneCut でぴたりと止める（何もない空間の無音）
    blackholeDrone(rise = 7) {
      if (!ready()) return;
      this.droneCut();
      const t = now(), end = t + rise;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.3, t + 1.5);
      g.gain.linearRampToValueAtTime(0.85, end);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
      lp.frequency.setValueAtTime(90, t); lp.frequency.exponentialRampToValueAtTime(900, end);
      lp.connect(g);
      const srcs = [];
      const osc = (type, f0, f1, gain, dest) => {
        const o = ctx.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, end);
        const og = ctx.createGain(); og.gain.value = gain;
        o.connect(og); og.connect(dest); o.start(t); o.stop(end + 3);
        srcs.push(o);
      };
      osc('sine', 29, 52, 0.9, g);
      osc('sawtooth', 29.4, 52.9, 0.35, lp);
      osc('sine', 43.5, 78, 0.25, g); // 五度上の薄い倍音
      // 吸い込む風: 帯域のノイズが細く高くなる
      const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
      bp.frequency.setValueAtTime(180, t); bp.frequency.exponentialRampToValueAtTime(1600, end);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.5, end);
      n.connect(bp); bp.connect(ng); ng.connect(g);
      n.start(t); n.stop(end + 3);
      srcs.push(n);
      g.connect(cine);
      drone = { g, srcs };
    },
    droneCut() {
      if (!drone || !ready()) { drone = null; return; }
      const t = now();
      drone.g.gain.cancelScheduledValues(t);
      drone.g.gain.setValueAtTime(drone.g.gain.value, t);
      drone.g.gain.linearRampToValueAtTime(0.0001, t + 0.05);
      for (const s of drone.srcs) s.stop(t + 0.1);
      drone = null;
    },
    // 爆発の音（boomRecipe の層を組み立てる）。size 0〜1: 大きいほど長く・低く・反射音が遅れて届く。
    // opts.hold / opts.open: 最後の一発だけ（演出の時刻表の「弾ける」から追われる間ずっと鳴り続け、時間が戻る間に開く）
    boom(size, opts = {}) {
      if (!ready()) return;
      const wait = boomDelay(silenceEnd, now());
      if (!Number.isFinite(wait)) return; // 演出の無音の間は鳴らさない
      const r = boomRecipe(size, opts);
      const t = now() + wait;
      const bus = ctx.createGain(); bus.gain.value = r.level; bus.connect(boomBus);
      // 反射音へ送る道（衝撃・中域・うなりの一部）。遠くのビルから遅れて、暗く小さく、左右から返ってくる
      const send = ctx.createGain(); send.gain.value = 1;
      for (const tap of r.taps) {
        const d = ctx.createDelay(2); d.delayTime.value = tap.delay;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = tap.cutoff; lp.Q.value = 0.6;
        const g = ctx.createGain(); g.gain.value = tap.gain;
        const pan = ctx.createStereoPanner(); pan.pan.value = tap.pan;
        send.connect(d); d.connect(lp); lp.connect(g); g.connect(pan); pan.connect(bus);
      }
      const noise = (buf, end, loop = false) => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = loop;
        src.start(t, Math.random() * (loop ? buf.duration ?? 1 : 0.5)); src.stop(t + end + 0.05);
        return src;
      };
      // 1. 最初の衝撃: 広帯域のノイズの破裂と、急に下がる低い一打。軽く歪ませて（倍音で小さなスピーカーでも重く）
      const shaper = ctx.createWaveShaper(); shaper.curve = punchCurve; shaper.connect(bus); shaper.connect(send);
      const c = r.crack, crackSrc = noise(noiseBuf, c.dur);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = c.hp; hp.Q.value = 0.5;
      const cg = ctx.createGain(); env(cg.gain, t, c.attack, c.gain, c.dur);
      crackSrc.connect(hp); hp.connect(cg); cg.connect(shaper);
      const p = r.punch, o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(p.f0, t); o.frequency.exponentialRampToValueAtTime(p.f1, t + p.dur * 0.6);
      const pg = ctx.createGain(); env(pg.gain, t, p.attack, p.gain, p.dur);
      o.connect(pg); pg.connect(shaper); o.start(t); o.stop(t + p.dur + 0.05);
      // 2. うなり: 明るい轟音から暗い尾へ（最後の一発は、時間が戻る間にこもった音から開き、追われる間は鳴り続ける）
      const w = r.roar, roarSrc = noise(noiseBuf, w.dur, true);
      const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.Q.value = 0.7;
      if (w.open > 0) {
        rlp.frequency.setValueAtTime(w.f0 * 0.18, t);
        rlp.frequency.exponentialRampToValueAtTime(w.f0, t + w.open);
      } else rlp.frequency.setValueAtTime(w.f0, t);
      rlp.frequency.exponentialRampToValueAtTime(w.f1, t + Math.max(w.open + 0.1, w.dur * 0.7));
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(0.0001, t);
      rg.gain.linearRampToValueAtTime(w.gain, t + w.attack);
      rg.gain.exponentialRampToValueAtTime(w.gain * w.drop, t + w.knee);
      if (w.hold > w.knee) rg.gain.exponentialRampToValueAtTime(w.gain * w.drop * 0.6, t + w.hold);
      rg.gain.exponentialRampToValueAtTime(0.0001, t + w.dur);
      const rs = ctx.createGain(); rs.gain.value = 0.5;
      roarSrc.connect(rlp); rlp.connect(rg); rg.connect(bus); rg.connect(rs); rs.connect(send);
      // 3. 空気を裂く中域: 帯域のノイズが下がりながら消える
      const a = r.air, airSrc = noise(noiseBuf, a.dur);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = a.q;
      bp.frequency.setValueAtTime(a.freq, t); bp.frequency.exponentialRampToValueAtTime(a.freq * 0.45, t + a.dur);
      const ag = ctx.createGain(); env(ag.gain, t, a.attack, a.gain, a.dur);
      airSrc.connect(bp); bp.connect(ag); ag.connect(bus); ag.connect(send);
      // 4. 地響き: 超低域のノイズ（ブラウン）がゆっくり来てゆっくり引き、揺れる。軽く歪ませて、倍音でスマホでも聞こえる
      const b = r.sub, subSrc = noise(brownBuf, b.dur, true);
      const slp = ctx.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = b.cutoff; slp.Q.value = 0.9;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.linearRampToValueAtTime(b.gain, t + b.attack);
      if (b.hold > b.attack) sg.gain.exponentialRampToValueAtTime(b.gain * 0.7, t + b.hold);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + b.dur);
      const wob = ctx.createGain(); wob.gain.value = 1;
      const lfo = ctx.createOscillator(); lfo.frequency.value = b.wobble.rate;
      const lg = ctx.createGain(); lg.gain.value = b.wobble.depth;
      lfo.connect(lg); lg.connect(wob.gain); lfo.start(t); lfo.stop(t + b.dur + 0.05);
      const ss = ctx.createWaveShaper(); ss.curve = subCurve;
      subSrc.connect(slp); slp.connect(sg); sg.connect(wob); wob.connect(ss); ss.connect(bus);
      // 5. 破片のぱらぱら: 一つのノイズの音量を粒ごとに跳ね上げ、帯域を粒ごとに変える
      const dg = r.debris.grains;
      if (dg.length) {
        const last = dg[dg.length - 1], dEnd = last.t + last.len;
        const dSrc = noise(noiseBuf, dEnd, true);
        const dbp = ctx.createBiquadFilter(); dbp.type = 'bandpass'; dbp.Q.value = 2.2;
        const dgg = ctx.createGain(); dgg.gain.setValueAtTime(0.0001, t);
        for (const gr of dg) {
          dbp.frequency.setValueAtTime(gr.f, t + gr.t);
          dgg.gain.setValueAtTime(0.0001, t + gr.t);
          dgg.gain.linearRampToValueAtTime(gr.g, t + gr.t + 0.0015);
          dgg.gain.exponentialRampToValueAtTime(0.0001, t + gr.t + gr.len);
        }
        dSrc.connect(dbp); dbp.connect(dgg); dgg.connect(bus);
      }
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
