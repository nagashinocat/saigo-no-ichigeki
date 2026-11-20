import * as THREE from 'three';
import { createScreenFx } from './screenFx.js';
import { createCameraFollow, wholeFitPullback } from './blastCamera.js';

// 1つの WebGLRenderer で「街（上空）」と「手」の2画面を描く。縦横どちらも、街が上、手が下の帯（どちらも全幅）。
// HUD は DOM を街の画面の上端に重ねる（WebGL では何も描かない）。

const CITY_FRAC = 0.65;  // 街は上 65%、手は下 35%
const HUD_FRAC = 0.12;   // HUD を重ねる帯: 街の画面の上端から、街の高さのこの割合

// Rect は WebGL と同じ左下原点。すべて整数で、街と手の2つで画面をすき間なく埋める。hud は街の中の上端の帯。
export function layoutViews(width, height) {
  const W = Math.max(0, Math.floor(width)), H = Math.max(0, Math.floor(height));
  const cityH = Math.round(H * CITY_FRAC), handH = H - cityH;
  const hudH = Math.round(cityH * HUD_FRAC);
  return {
    city: { x: 0, y: handH, w: W, h: cityH },
    hand: { x: 0, y: 0, w: W, h: handH },
    hud: { x: 0, y: H - hudH, w: W, h: hudH },
  };
}

// 上空カメラ: 主人公（原点）の斜め上から街を見下ろす。広場は画面の中ほどより下、
// 街の遠い端の先に地平があり、画面の上 15% ほどに夕空が入るよう、向きは画角から決める。
// 広場と、軍勢が現れる 60〜90m の輪は、縦長でも横長でも画面に収まる（tests/render/cityCamera.test.js）。
// 街と軍勢が大きく見えるよう近め（高さ 175m・後ろ 160m）。輪の見通しは広場のまわりのビルの高さ制限（cityGen.js）と合わせて決めた。
// 道路の格子にまっすぐ沿って見下ろすと、通りが地平の夕空へ吸い込まれ、輪の上の道路も見通しやすい。
export const CITY_CAMERA = { height: 175, distance: 160, azimuthDeg: 0, minHFovDeg: 62, vFovDeg: 80, horizonNdc: 0.7 };

export function createCityCamera(opts = CITY_CAMERA) {
  const cam = new THREE.PerspectiveCamera(opts.vFovDeg, 1, 1, 6000);
  cam.userData.cityOpts = opts;
  fitCityCamera(cam, 1);
  return cam;
}

// 縦長の画面でも街の横幅が切れすぎないよう、横の画角に下限を設ける。
// 見下ろす角度は「地平が画面の高さの horizonNdc（-1〜1）の位置に来る」ように決める。
export function fitCityCamera(cam, aspect) {
  const opts = cam.userData.cityOpts ?? CITY_CAMERA;
  cam.aspect = aspect;
  const hHalf = THREE.MathUtils.degToRad(opts.minHFovDeg) / 2;
  const vNeeded = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hHalf) / aspect));
  cam.fov = Math.min(84, Math.max(opts.vFovDeg, vNeeded));
  cam.updateProjectionMatrix();
  const pitch = Math.atan(opts.horizonNdc * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
  const az = THREE.MathUtils.degToRad(opts.azimuthDeg);
  cam.position.set(Math.sin(az) * opts.distance, opts.height, Math.cos(az) * opts.distance);
  const p = cam.position;
  cam.lookAt(p.x - Math.sin(az) * Math.cos(pitch), p.y - Math.sin(pitch), p.z - Math.cos(az) * Math.cos(pitch));
  cam.updateMatrixWorld();
  // 爆発に合わせて下がる・揺れるときの基準の姿勢
  cam.userData.basePos = cam.position.clone();
  cam.userData.baseQuat = cam.quaternion.clone();
}

const WHITE = new THREE.Color(1, 1, 1);
const _clear = new THREE.Color();

export function createViews(renderer, getTier = () => ({ bloom: false, heatHaze: false })) {
  const cityCamera = createCityCamera();
  const follow = createCameraFollow();
  const screenFx = createScreenFx(renderer);
  const _dir = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  let shakeClock = 0;
  const _blasts = [];
  // 近い上空カメラの位置・視線と、縦横比 aspect のときの半画角の tan
  function viewInfo(aspect) {
    const { basePos, baseQuat } = cityCamera.userData;
    const dir = _dir.set(0, 0, -1).applyQuaternion(baseQuat).toArray();
    const tanV = Math.tan(THREE.MathUtils.degToRad(cityCamera.fov) / 2);
    return { pos: basePos.toArray(), dir, tanV, tanH: tanV * aspect };
  }

  const handCamera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
  handCamera.position.set(0, 0.2, 3);
  handCamera.lookAt(0, 0, 0);

  let layout = layoutViews(1, 1);
  let size = { w: 1, h: 1 };

  const aspectOf = (rect) => rect.w / Math.max(1, rect.h);

  function setRect(rect) {
    renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
    renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
  }

  return {
    cityCamera, handCamera,
    get layout() { return layout; },
    // 画面全体の大きさ（大きな一発の演出は画面全体を使う）
    get size() { return size; },
    get pullback() { return follow.t; },
    resize(w, h) {
      renderer.setSize(w, h, false);
      layout = layoutViews(w, h);
      size = { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
      fitCityCamera(cityCamera, aspectOf(layout.city));
      handCamera.aspect = aspectOf(layout.hand);
      handCamera.updateProjectionMatrix();
    },
    // 上空カメラの姿勢: 爆発に合わせて視線に沿って下がり（blastCamera.js）、shake（ラジアン）だけ揺れる。
    // cam = { front, shake }（front は見えている球の一番大きい半径）、blasts: game.blasts、
    // hold: 大きな一発の演出が遠めの構図で止まっている間 true（終わった一発の「保つ」時間を進めない）
    updateCamera(dt, cam = {}, blasts = [], hold = false) {
      const { basePos, baseQuat } = cityCamera.userData;
      _dir.set(0, 0, -1).applyQuaternion(baseQuat);
      _blasts.length = 0;
      for (const b of blasts) _blasts.push({ id: b.id, radius: b.shot.radius, front: b.front });
      const t = follow.update(dt, { ...viewInfo(cityCamera.aspect), blasts: _blasts, front: cam.front ?? 0, hold });
      cityCamera.position.copy(basePos).addScaledVector(_dir, -t);
      shakeClock += dt;
      const a = cam.shake ?? 0;
      const k = shakeClock * 31;
      _e.set(a * (Math.sin(k) * 0.6 + Math.sin(k * 2.3 + 1.7) * 0.4), a * (Math.sin(k * 1.7 + 0.5) * 0.6 + Math.sin(k * 3.1) * 0.4), a * 0.5 * Math.sin(k * 1.3 + 2.1));
      cityCamera.quaternion.copy(baseQuat).multiply(_q.setFromEuler(_e));
      cityCamera.updateMatrixWorld();
    },
    // 球（半径 radius）の全体が、縦横比 aspect の画面に収まる上空カメラの位置（out に書く）。向きは上空カメラと同じ。
    // 大きな一発の演出が、最後に全体の見える構図で止まるのに使う
    widePosition(radius, aspect, out) {
      const v = viewInfo(aspect);
      const t = wholeFitPullback(radius, v.pos, v.dir, v.tanV, v.tanH);
      return out.copy(cityCamera.userData.basePos).addScaledVector(_dir.fromArray(v.dir), -t);
    },
    // 画面全体を一つのカメラで描く（大きな一発の演出）。手の画面と HUD は描かない
    renderFull(scene, camera, fx) {
      const rect = { x: 0, y: 0, w: size.w, h: size.h };
      renderer.setScissorTest(true);
      setRect(rect);
      screenFx.render(scene, camera, rect, getTier(), fx);
      renderer.setScissorTest(false);
    },
    // 画面全体を真っ白にする（大きな一発を放った瞬間）
    renderWhite() {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, size.w, size.h);
      renderer.getClearColor(_clear);
      const alpha = renderer.getClearAlpha();
      renderer.setClearColor(WHITE, 1);
      renderer.clear(true, true, false);
      renderer.setClearColor(_clear, alpha);
    },
    // fx は screenFx の効果（閃光・熱のゆがみ）。街の画面だけに掛ける。handCam は手の画面のカメラ（手の場面が持つもの）。
    render(cityScene, handScene, fx, handCam = handCamera) {
      renderer.setScissorTest(true);
      const { city, hand } = layout;
      if (city.w > 0 && city.h > 0) {
        setRect(city);
        screenFx.render(cityScene, cityCamera, city, getTier(), fx);
      }
      if (hand.w > 0 && hand.h > 0) {
        setRect(hand);
        renderer.render(handScene, handCam);
      }
      renderer.setScissorTest(false);
    },
  };
}
