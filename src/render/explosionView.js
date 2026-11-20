import * as THREE from 'three';
import { TIERS } from './quality.js';
import { CONFIG } from '../config.js';
import { createRng } from '../rng.js';
import { NOISE_GLSL } from './glslNoise.js';
import { createDustView } from './dustView.js';
import { createVaporizeView } from './vaporizeView.js';

// 爆発の見た目: 一発ごとの光の球と地面を走る衝撃波の輪、爆心から街を照らす光、閃光・揺れ・熱のゆがみの量、
// 粉（DustEvent）と土煙の輪、光に溶ける建物。
// 色: 白い芯 → 淡い金の内側 → 明るい表面の帯 → 縁だけ冷たい青紫。夕暮れの暖色の街に対して、縁の冷たい色で球を立たせる。

const AFTER_GROW = 0.07;     // 消えながら、さらに広がる割合
const RING_AHEAD = 1.03;     // 衝撃波の輪は球の少し先を走る
const FLASH_SEC = 0.07;
const MAX_SPHERES = 6;
const SPEED_REF = 800;        // 弾ける期の最大の速さの目安 (m/s)。揺れ・粉の量の基準
const SHAKE_K = 0.012 / SPEED_REF; // front の速さ (m/s) あたりの揺れ (rad)
const DONE_RING_SPEED = 128;  // 前線が届いたあとの衝撃波の輪の速さ (m/s)
const BURST_FLARE_SEC = 0.22; // 弾けた瞬間の光の強まり
// 小爆発（shot.small）: 街の画面を白く飛ばさない弱い閃光と、小さな揺れ（連打しても広場が見え続ける）
const PUFF_FX = { flash: 0.18, shake: 0.25 };
const BURST_SHAKE = 0.007;    // 弾けた瞬間の揺れの一撃 (rad、最大の一発)
const HUM_HZ = 5;             // じわじわ期の球の脈打ち

const SPHERE_VERT = /* glsl */`
uniform float uTime, uSeed, uRadius;
varying vec3 vWorld;
varying vec3 vDir;
${NOISE_GLSL}
void main() {
  vDir = normalize(position);
  // 表面をわずかに波打たせて、輪郭を生きたものにする
  float bump = xnoise3(vDir * 4.0 + vec3(0.0, -uTime * 1.2, uSeed)) - 0.5;
  vec3 p = position * (1.0 + bump * 0.035 * smoothstep(0.0, 0.25, vDir.y + 0.1));
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SPHERE_FRAG = /* glsl */`
uniform float uTime, uSeed, uRadius, uFade, uBirth, uScale;
uniform vec3 uCore, uDeep, uInner, uBand, uRimA, uRimB;
varying vec3 vWorld;
varying vec3 vDir;
${NOISE_GLSL}
float fbm(vec3 p) {
  float v = xnoise3(p) * 0.55 + xnoise3(p * 2.1 + 3.1) * 0.3;
  #ifdef FBM3
  v += xnoise3(p * 4.3 + 7.7) * 0.15;
  #else
  v += 0.075;
  #endif
  return v;
}
void main() {
  // 視線が球の中心からどれだけ離れて通るか（0: 芯を貫く, 1: 縁をかすめる）
  vec3 D = normalize(vWorld - cameraPosition);
  vec3 oc = cameraPosition;
  float tc = -dot(oc, D);
  float rn = clamp(length(oc + D * tc) / uRadius, 0.0, 1.0);
  float mu = sqrt(max(0.0, 1.0 - rn * rn));
  // 表面の帯（殻）を通る長さ。縁で長く、まん中で短い → 縁が明るい帯になる
  const float INNER = 0.84;
  float innerChord = sqrt(max(0.0, INNER * INNER - rn * rn));
  float shell = (mu - innerChord) / sqrt(1.0 - INNER * INNER);
  // 時間で揺らぐ表面。上へ流れるノイズと、ゆっくり回るノイズ
  vec3 sp = vDir * uScale;
  float n1 = fbm(sp + vec3(0.0, -uTime * 0.9, 0.0) + uSeed);
  float n2 = fbm(sp * 2.2 + vec3(uTime * 0.35, uTime * 0.2, -uTime * 0.3) + uSeed * 1.7);
  float plasma = n1 * 0.62 + n2 * 0.38;
  float flow = smoothstep(0.4, 0.72, plasma);
  float core = exp(-rn * rn * 34.0) * (0.85 + 0.6 * uBirth);
  // 球の中身: 流れる熱の模様を3色の段で塗る（深い橙 → 琥珀 → 淡い黄の筋）。明るさは 1 未満に抑えて色を残す
  float tone = xcel(clamp(plasma * 1.25 - 0.18 + core * 0.6 + (1.0 - mu) * 0.15, 0.0, 0.999), 3.0, 0.05);
  vec3 body = mix(uDeep, uInner, smoothstep(0.2, 0.45, tone));
  body = mix(body, uBand * 0.95, smoothstep(0.55, 0.8, tone));
  vec3 col = body * (0.7 + 0.3 * mu);
  float a = 0.6 + 0.3 * mu;
  // 熱の模様の境目に走る細い光の筋
  float crack = (1.0 - smoothstep(0.0, 0.018 + 0.02 * (1.0 - mu), abs(plasma - 0.56))) * (0.4 + 0.6 * mu);
  col = mix(col, uBand * 1.8, crack * 0.8);
  // 表面の帯: 縁の近くで殻を長く通るところだけ、白熱して明るい
  float band = smoothstep(0.5, 0.9, shell * (0.55 + 0.75 * flow));
  col = mix(col, uBand * 2.4, band);
  a = max(a, band * 0.9);
  // 白い芯
  col = mix(col, uCore * 2.4, smoothstep(0.15, 0.7, core));
  a = max(a, core * 0.95);
  // 縁: 冷たい青紫の細い帯と、いちばん外のくっきりした線
  float fringe = smoothstep(0.9, 0.98, rn);
  vec3 rim = mix(uRimA, uRimB, smoothstep(0.35, 0.65, n2));
  col = mix(col, rim * (1.3 + flow), fringe * 0.9);
  float line = smoothstep(0.968, 0.99, rn) * (1.0 - smoothstep(0.994, 1.0, rn));
  // 生まれた瞬間は全体が白く飛ぶ
  col = mix(col, uCore * 3.0, uBirth * 0.8);
  a = max(a, uBirth * 0.8);
  // 消えるとき: 表面がノイズでほどけていく
  float keep = uFade >= 0.999 ? 1.0 : smoothstep(1.0 - uFade - 0.12, 1.0 - uFade + 0.12, plasma * 0.85 + mu * 0.25);
  float k = keep * uFade;
  vec3 outC = col * a + vec3(0.8, 0.92, 1.0) * line * 2.4;
  gl_FragColor = vec4(outC * k, a * k);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RING_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const RING_FRAG = /* glsl */`
uniform float uRing, uFade, uTime;
uniform vec3 uLine, uGlow;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  float d = length(vWorld.xz);
  float x = d - uRing; // 輪の先頭からの距離 (m)。負が内側
  float w = 1.2 + uRing * 0.006;
  // くっきりした先頭の線、そのすぐ内側の暗いゆがみの帯、外へにじむ光
  float line = 1.0 - smoothstep(0.0, w, abs(x));
  float wake = smoothstep(-w * 9.0, -w, x) * (1.0 - smoothstep(-w, 0.0, x));
  float glow = exp(-max(x, 0.0) / (6.0 + uRing * 0.04)) * step(0.0, x);
  float a = atan(vWorld.z, vWorld.x);
  float broken = 0.75 + 0.25 * xnoise2(vec2(a * 40.0, uTime * 3.0));
  vec3 col = uLine * line * 2.6 * broken + uGlow * glow * 0.9;
  float alpha = clamp(line * 0.9 + glow * 0.45 + wake * 0.18, 0.0, 1.0) * uFade;
  // 暗い帯はアルファだけ（下の地面を少し沈ませ、光の線を際立たせる）
  gl_FragColor = vec4(col * uFade, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const linear = (r, g, b, k = 1) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace).multiplyScalar(k);

// 前線が届いてから age 秒の球の濃さ（1 → 0、CONFIG.blast.fadeSec で消える）
export function sphereFade(age, cfg = CONFIG) {
  const k = Math.min(1, Math.max(0, age / cfg.blast.fadeSec));
  return 1 - k * k * (3 - 2 * k);
}

export function createExplosionView(scene, tierName, { sunDir = null, seed = 7 } = {}) {
  const tier = TIERS[tierName] ?? TIERS.mid;
  const rng = createRng(seed ^ 0xe7b1a5);
  const group = new THREE.Group();
  group.name = 'explosion';
  scene.add(group);

  const dust = createDustView(tier.dustMax);
  const vapor = createVaporizeView({ rng, sparks: Math.round(tier.dustMax * 1.2), sparksPer: tier.bloom ? 40 : 20 });
  group.add(dust.mesh, vapor.group);

  // 爆心から街を照らす光（建物の中心向きの面が明るくなる）
  const light = new THREE.PointLight(linear(1.0, 0.82, 0.62), 0, 0, 1);
  light.position.set(0, 20, 0);
  group.add(light);

  const sphereGeo = new THREE.SphereGeometry(1, tier.bloom ? 128 : 72, tier.bloom ? 40 : 24, 0, Math.PI * 2, 0, Math.PI / 2 + 0.05);
  const ringGeo = new THREE.CircleGeometry(1, 128).rotateX(-Math.PI / 2);
  const sharedColors = {
    uCore: { value: linear(1.0, 0.99, 0.95) },
    uDeep: { value: linear(0.78, 0.16, 0.05) },
    uInner: { value: linear(0.98, 0.42, 0.07) },
    uBand: { value: linear(1.0, 0.86, 0.48) },
    uRimA: { value: linear(0.5, 0.78, 1.0) },
    uRimB: { value: linear(0.72, 0.52, 1.0) },
  };

  function makeSphere() {
    const uniforms = {
      uTime: { value: 0 }, uSeed: { value: 0 }, uRadius: { value: 1 }, uFade: { value: 1 }, uBirth: { value: 0 }, uScale: { value: 3 },
      ...sharedColors,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: SPHERE_VERT, fragmentShader: SPHERE_FRAG,
      defines: tier.heatHaze ? { FBM3: '' } : {},
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    const ringU = {
      uRing: { value: 0 }, uFade: { value: 1 }, uTime: { value: 0 },
      uLine: { value: linear(0.86, 0.94, 1.0) }, uGlow: { value: linear(1.0, 0.7, 0.45) },
    };
    const ringMat = new THREE.ShaderMaterial({
      uniforms: ringU, vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.15;
    ring.frustumCulled = false;
    ring.renderOrder = 4;
    return { mesh, ring, uniforms, ringU, id: null, active: false };
  }
  const spheres = Array.from({ length: MAX_SPHERES }, makeSphere);
  for (const s of spheres) { s.mesh.visible = s.ring.visible = false; group.add(s.mesh, s.ring); }

  let time = 0, flash = 0, shake = 0;
  // 毎フレーム作り直さず、中身だけ書き換えて返す
  const cameraInfo = { front: 0, shake: 0 };
  const heat = { center: [0, 0, 0], radius: 0, strength: 0 };
  const screen = { flash: 0, time: 0, heat: null };
  // 地面のえぐれへ: 球の明るさ（穴の中が内側から照らされ、割れ目が溶けて光る）と熾火の残り
  const ground = { heat: 0, ember: 0 };
  const live = new Map(); // blast id -> sphere slot
  const seen = new Set();
  const evicted = new Set(); // 球を取られた一発（もう球を作り直さない）

  function startSphere(b) {
    // 空きがなければ一番古い球を使い回す（古い一発の対応は外す）
    const s = spheres.find((x) => !x.active) ?? spheres.reduce((a, x) => (x.age > a.age ? x : a));
    if (live.get(s.id) === s) { live.delete(s.id); evicted.add(s.id); }
    Object.assign(s, { active: true, id: b.id, small: !!b.shot.small, radius: b.shot.radius, front: 0, prev: 0, age: 0, done: false, fadeAge: 0, ringFront: 0, dustAcc: 0, burstAge: Infinity, burst: false });
    s.uniforms.uSeed.value = rng() * 100;
    s.mesh.visible = s.ring.visible = true;
    live.set(b.id, s);
    return s;
  }


  // 衝撃波が地面を走るとき、先頭で土煙が舞い上がる
  function ringDust(s, grow) {
    const ratePerM = Math.min(0.5, (tier.dustMax * 0.35) / 2.2 / SPEED_REF); // 寿命 × 速さで上限の35%以内
    s.dustAcc += grow * ratePerM;
    const tint = [0.76, 0.68, 0.62];
    while (s.dustAcc >= 1) {
      s.dustAcc -= 1;
      const a = rng() * Math.PI * 2, r = s.ringFront * (0.97 + 0.04 * rng());
      const out = 60 + 70 * rng();
      dust.spawn(time, {
        pos: [Math.cos(a) * r, 1 + rng() * 3, Math.sin(a) * r],
        vel: [Math.cos(a) * out, 4 + 10 * rng(), Math.sin(a) * out], drag: 2.2,
        rise: 3 + 4 * rng(), size: 7 + 9 * rng() + s.radius * 0.02, grow: 2.2, life: 1.8 + 0.8 * rng(), tint,
      });
    }
  }

  return {
    group, light,
    // 最初の一発で止まらないよう、隠れている材質のシェーダーを先に作っておく
    warmup(renderer, camera) {
      const hidden = [];
      group.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      renderer.compile(scene, camera);
      for (const o of hidden) o.visible = false;
    },
    // 放つ瞬間（'shot'）: 小さな一発は白い閃光。大きな一発は演出が画面を白くするので、ここでは光らない
    // （じわじわ始まって、弾けた瞬間の閃光が主役になる）
    begin(shot) {
      if (shot.isBig || shot.small) return; // 小爆発は手の画面が光り、街の画面は弾けた瞬間の弱い閃光だけ
      flash = Math.max(flash, 0.55 + 0.45 * shot.radius / CONFIG.radius.max);
    },
    // blasts: game.blasts（[{ id, shot, front }]）。一発ごとに球を描く。
    // camera は上空カメラ（粉の陰影の向き）、pointScale は 1m を画素へ直す係数（光の粒の大きさ）、
    // crater は地面のえぐれの半径（粉が穴の中まで下りられる）
    update(dt, blasts, camera, pointScale, crater = 0) {
      time += dt;
      seen.clear();
      let shakeWant = 0;
      for (const b of blasts) {
        seen.add(b.id);
        if (evicted.has(b.id)) continue;
        const s = live.get(b.id) ?? startSphere(b);
        s.prev = s.front;
        s.front = b.front;
        if (!s.burst && s.front >= CONFIG.blast.creepFrac * s.radius) {
          // 突然弾ける: 光が跳ね上がり、画面が一撃揺れ、輪の土煙が一気に増える
          s.burst = true; s.burstAge = 0;
          const big = Math.sqrt(s.radius / CONFIG.radius.max);
          flash = Math.max(flash, s.small ? PUFF_FX.flash : 0.55 + 0.45 * big); // 一番強い閃光（放つ瞬間より強く、大きな一発ほど強い）
          shake = Math.max(shake, BURST_SHAKE * (0.35 + 0.65 * big) * (s.small ? PUFF_FX.shake : 1));
        }
        if (dt > 0 && s.burst) shakeWant += ((s.front - s.prev) / dt) * SHAKE_K * (0.35 + 0.65 * Math.sqrt(s.radius / CONFIG.radius.max)) * (s.small ? PUFF_FX.shake : 1);
      }
      for (const [id, s] of live) if (!seen.has(id)) { s.done = true; s.front = s.radius; live.delete(id); }
      for (const id of evicted) if (!seen.has(id)) evicted.delete(id);

      let maxFront = 0, cover = 0, lightI = 0;
      for (const s of spheres) {
        if (!s.active) continue;
        s.age += dt;
        s.burstAge += dt;
        let fade = 1, r = Math.max(0.5, s.front);
        // じわじわ期は球が低く唸るように脈打つ
        const hum = s.burst || s.done ? 0 : 1;
        const pulse = 1 + hum * 0.07 * Math.sin(time * Math.PI * 2 * HUM_HZ + s.id);
        if (s.done) {
          s.fadeAge += dt;
          const k = Math.min(1, s.fadeAge / CONFIG.blast.fadeSec);
          fade = sphereFade(s.fadeAge);
          r = s.radius * (1 + AFTER_GROW * Math.sqrt(k));
          if (k >= 1) { s.active = false; s.mesh.visible = s.ring.visible = false; continue; }
        }
        const prevRing = s.ringFront;
        s.ringFront = s.done ? Math.max(s.ringFront, s.radius * RING_AHEAD) + DONE_RING_SPEED * dt : r * RING_AHEAD + 2;
        // 小爆発の衝撃波は、届いた先（軍勢を払える範囲）より外では土煙を立てない
        if (s.ringFront > prevRing && fade > 0.4 && !(s.small && s.done)) ringDust(s, s.ringFront - prevRing);
        s.mesh.scale.setScalar(r * pulse);
        const u = s.uniforms;
        u.uTime.value = time;
        u.uRadius.value = r * pulse;
        u.uFade.value = fade;
        u.uBirth.value = (s.burst ? 1 : 0.3) * Math.exp(-(s.burst ? s.burstAge : s.age) / (s.burst ? BURST_FLARE_SEC : 0.12));
        u.uScale.value = 3.5 + r / 60;
        const ringR = s.ringFront * 1.25 + 10;
        s.ring.scale.setScalar(ringR);
        s.ringU.uRing.value = s.ringFront;
        s.ringU.uTime.value = time;
        s.ringU.uFade.value = s.done ? Math.max(0, 1 - s.fadeAge / (CONFIG.blast.fadeSec * 1.2)) : 1;
        maxFront = Math.max(maxFront, r);
        cover = Math.max(cover, fade);
        lightI = Math.max(lightI, fade * (1 + 2 * u.uBirth.value) * r);
      }

      // えぐれた地面の熾火は、球が消えてからゆっくり冷える
      if (maxFront > 0) ground.ember = Math.max(ground.ember, cover);
      if (cover === 0) ground.ember *= Math.exp(-dt / 2.5);
      ground.heat = cover;

      // 爆心の光: 球が大きいほど強く、球の上の方から街を照らす
      light.intensity = lightI * 0.7;
      light.distance = maxFront * 3.2 + 1;
      light.position.y = Math.max(8, maxFront * 0.45);
      // light.visible は切り替えない（光の数が変わると、街のすべての材質が作り直しになって止まる）

      flash *= Math.exp(-dt / FLASH_SEC);
      if (flash < 0.004) flash = 0;
      // 揺れ: 速く来て、ゆっくり収まる
      shake += (shakeWant - shake) * (1 - Math.exp(-dt / (shakeWant > shake ? 0.05 : 0.3)));

      dust.uniforms.uFront.value = maxFront;
      dust.uniforms.uCrater.value = crater;
      dust.uniforms.uCover.value = cover;
      dust.uniforms.uGlow.value = cover;
      dust.update(time, camera, sunDir);
      vapor.update(time, pointScale);
      cameraInfo.front = maxFront; cameraInfo.shake = shake;
      heat.radius = maxFront; heat.strength = cover;
      screen.flash = flash; screen.time = time; screen.heat = maxFront > 0 ? heat : null;
    },
    // 遠くへ飛んだ破片が変わる粉（DustEvent: { pos, size }）
    dust(events) {
      const n = Math.min(events.length, Math.ceil(tier.dustMax / 6));
      for (let i = 0; i < n; i++) {
        const e = events[i];
        const size = Math.min(14, Math.max(2.5, e.size * 1.7));
        dust.spawn(time, {
          pos: e.pos, vel: [(rng() - 0.5) * 4, 1 + rng() * 2, (rng() - 0.5) * 4], drag: 1.2,
          rise: 0.8 + rng() * 1.5, size, grow: 1.8 + rng(), life: 2.2 + rng() * 1.4, tint: [0.8, 0.74, 0.7],
        });
      }
    },
    // 爆心近くで光に溶ける対象: { x, z, w, d, h, color }
    vaporize(target) { vapor.add(time, target); },
    get busy() { return flash > 0 || spheres.some((s) => s.active) || vapor.busy(time); },
    // 上空カメラへ: 見えている球の一番大きい半径・揺れ (rad)
    get cameraInfo() { return cameraInfo; },
    // 画面効果へ: 閃光・熱のゆがみ
    get screen() { return screen; },
    // 地面のえぐれへ: { heat, ember }
    get ground() { return ground; },
  };
}
