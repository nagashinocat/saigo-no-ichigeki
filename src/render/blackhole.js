import * as THREE from 'three';
import { toLocal } from './blastFrame.js';
import { BLACKHOLE, stageAt, cuesBetween, collapseAt, splitLensAt, fullLensAt, isFullscreen } from './blackholeTimeline.js';
import { planBlackholeCamera, BH_CAMERA } from './blackholePlan.js';
import { createLensFx, projectToRect } from './lensFx.js';
import { barsFor } from './cinematic.js';

// 時間切れの結末（仕様 12 章「時間切れの結末」）の演出。時間割と写し方は blackholeTimeline.js、カメラは blackholePlan.js、
// ゆがみの描き方は lensFx.js。
//   1. 2画面のまま: 手の中の球が内側へつぶれて黒い球と光の輪になり、両手が引き込まれる（手の画面のレンズ）。
//      上の街の画面でも主人公のところに小さな黒い点が生まれ、まわりがゆがむ
//   2. 画面全体: 夕日を背にした主人公が黒い球。重力レンズのゆがみが育ち、街が渦を巻いて中心へ流れ込む
//   3. 街に続いて、夕焼けの空・雲・夕日・地平線も引き伸ばされ、光の筋になって渦を巻きながら中心へ
//   4. 何もない真っ暗な空間に、黒い球と光の輪（光子の輪と、飲んだ光でできた円盤）だけ
//   5. 暗転 → 'end'（結果「ブラックホールになった」）。そのあとは黒のまま待つ
// 音の段取りは 'cue'（collapse: 低い唸り、cut: BGM を引き伸ばす、void: 無音）で知らせる。

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeInOut = (x) => { const t = clamp01(x); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };
const DISK_TILT = -0.2; // 円盤の傾き（画面の上で少し右下がり）

// views: createViews の戻り値（2画面の配置と画面全体の大きさ、上空カメラ）、hand: createHandView の戻り値。
// opts.renderer: 描く先（テストでは描かないので何でもよい）、opts.scene: 街の場面、opts.sky: 空の網、
// opts.buildings: カメラをビルの上に置くため、opts.getTier: 画質の段（始めるたびに読む）
export function createBlackhole(views, hand, { renderer, scene, sky = null, sunDir, buildings = [], tier = 'high', getTier = () => tier, B = BLACKHOLE } = {}) {
  const listeners = {};
  const emit = (name, payload) => { for (const fn of listeners[name] ?? []) fn(payload); };
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 6000);
  const cityLens = createLensFx(renderer, { sky, tier });
  const handLens = createLensFx(renderer, { tier });
  // M1（spec §16）: 主人公は動くので、黒い球は時間切れの瞬間の主人公の位置（play の hero）。カメラの置き場所は主人公を原点として解き、世界へ戻す
  const HERO = new THREE.Vector3(...BH_CAMERA.hero);
  let hc = { x: 0, z: 0 }, localBuildings = buildings;
  const _pos = new THREE.Vector3(), _look = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _center = [0.5, 0.5], _clear = new THREE.Color();
  let active = false, finished = false, t = 0, plan = null, planAspect = 0, shakeClock = 0, tierNow = tier;

  // 画面全体のカメラ: ゆっくり黒い球へ寄り、潮の力で少しずつ傾く。飲み込みの間は低く震える
  function aim(dt) {
    const aspect = views.size.w / Math.max(1, views.size.h);
    if (!plan || Math.abs(aspect - planAspect) > 1e-6) {
      plan = planBlackholeCamera({ aspect, sunDir, buildings: localBuildings });
      plan = { ...plan, pos: [plan.pos[0] + hc.x, plan.pos[1], plan.pos[2] + hc.z], look: [plan.look[0] + hc.x, plan.look[1], plan.look[2] + hc.z] };
      planAspect = aspect;
    }
    const u = clamp01((t - B.cut) / (B.end - B.cut));
    const k = 1 - 0.14 * easeInOut(u);
    _pos.fromArray(plan.pos).sub(HERO).multiplyScalar(k).add(HERO);
    camera.position.copy(_pos);
    camera.aspect = aspect;
    camera.fov = plan.fov * (1 - 0.05 * easeInOut(u));
    camera.updateProjectionMatrix();
    // 黒い球への線に沿って寄るので、向きはそのまま（黒い球は画面の同じ所に留まる）。
    // 空が飲まれていく間に、黒い球を画面の真ん中へ向け直す（最後の何もない空間では、黒い球と輪が中央に残る）
    _look.fromArray(plan.look).sub(_v.fromArray(plan.pos)).add(_pos);
    _look.lerp(HERO, easeInOut((t - B.skyFrom) / (B.void - B.skyFrom)));
    camera.lookAt(_look);
    shakeClock += dt;
    const a = isFullscreen(t, B) ? fullLensAt(t, B).shake : 0;
    const s = shakeClock * 29;
    _e.set(a * (Math.sin(s) * 0.6 + Math.sin(s * 2.3 + 1.7) * 0.4), a * (Math.sin(s * 1.7 + 0.5) * 0.6 + Math.sin(s * 3.1) * 0.4), 0.13 * easeInOut(u));
    camera.quaternion.multiply(_q.setFromEuler(_e));
    camera.updateMatrixWorld();
  }

  const centerOf = (p, cam) => projectToRect(p, cam, _center) ?? [0.5, 0.5];

  return {
    camera,
    get active() { return active; },
    get finished() { return finished; },
    get time() { return t; },
    get stage() { return active ? stageAt(t, B) : 'idle'; },
    // 画面全体を使っているか（2画面の間は false）
    get fullscreen() { return active && isFullscreen(t, B); },
    get timeline() { return B; },
    // 今の画質（始めた時の段と、光の筋の重ね数・解像度の割合）
    get quality() { return { tier: tierNow, lens: cityLens.quality }; },
    on(name, fn) { (listeners[name] ??= []).push(fn); },
    // hero（M1）: 時間切れの瞬間の主人公の位置 { x, z }（省けば原点）
    play(hero = null) {
      hc = { x: hero?.x ?? 0, z: hero?.z ?? 0 };
      HERO.set(BH_CAMERA.hero[0] + hc.x, BH_CAMERA.hero[1], BH_CAMERA.hero[2] + hc.z);
      localBuildings = toLocal(buildings, hc);
      tierNow = getTier();
      cityLens.setTier(tierNow); handLens.setTier(tierNow);
      active = true; finished = false; t = 0; plan = null; shakeClock = 0;
      hand.setCollapse(0);
      aim(0);
      for (const name of cuesBetween(-Infinity, 0, B)) emit('cue', { name });
    },
    update(rawDt) {
      if (!active) return;
      const dt = Number.isFinite(rawDt) ? Math.max(0, rawDt) : 0;
      const t0 = t;
      t += dt;
      hand.setCollapse(collapseAt(t, B));
      aim(dt);
      for (const name of cuesBetween(t0, t, B)) {
        if (name === 'end') { finished = true; emit('end'); } else emit('cue', { name });
      }
    },
    stop() { active = false; finished = false; hand.setCollapse(0); },
    draw() {
      if (!active) return;
      const size = views.size;
      if (t >= B.end) {
        // 暗転のあとは黒のまま（結果画面を重ねる）
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, size.w, size.h);
        renderer.getClearColor(_clear);
        const alpha = renderer.getClearAlpha();
        renderer.setClearColor(0x000000, 1);
        renderer.clear(true, true, false);
        renderer.setClearColor(_clear, alpha);
        return;
      }
      if (isFullscreen(t, B)) {
        const L = fullLensAt(t, B);
        const rect = { x: 0, y: 0, w: size.w, h: size.h };
        cityLens.render(scene, camera, rect, centerOf(HERO, camera), {
          E: L.E, shadow: L.shadow, ring: L.ring, disk: L.disk, fade: L.fade, bars: barsFor(size.w / Math.max(1, size.h)) * L.bars,
          layer: L.city, sky: L.sky, time: t, tilt: DISK_TILT,
        }, size);
        return;
      }
      const S = splitLensAt(t, B);
      const { city, hand: handRect } = views.layout;
      if (city.w > 0 && city.h > 0) {
        cityLens.render(scene, views.cityCamera, city, centerOf(HERO, views.cityCamera), {
          E: S.city.E, shadow: S.city.shadow, ring: S.city.ring, disk: 0, layer: S.city.layer, sky: S.city.layer, time: t, tilt: DISK_TILT,
        }, size);
      }
      if (handRect.w > 0 && handRect.h > 0) {
        handLens.render(hand.scene, hand.camera, handRect, centerOf(hand.orbSphere.center, hand.camera), {
          E: S.hand.E, shadow: S.hand.shadow, ring: S.hand.ring, disk: 0, layer: S.hand.layer, time: t, tilt: DISK_TILT,
        });
      }
    },
    // 前もってシェーダーを作る（呼ぶ側が画面とレンダーターゲットの両方の描き先で呼ぶ: 場面はレンダーターゲットへ、
    // ゆがめる段は画面へ描くので、どちらの材質も両方を用意しておけば初めての一コマで止まらない）
    // レンダーターゲットも今の画面の大きさで作っておく（画面の大きさが変われば、始めた最初の一コマで作り直す）
    warmup() {
      cityLens.warmup(scene, views.cityCamera, views.size);
      handLens.warmup(hand.scene, hand.camera, views.layout.hand);
    },
  };
}
