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

// 上空カメラ: 主人公（原点）の斜め上から、広場とそれを囲む最初の一周の 8 つの街区を見下ろす（持ち主の決定、仕様 12 章）。
// 8 つの街区（±frameHalf m の正方形、屋上は frameTop m まで）がしっかり画面に入り、その外の一周は切れるくらいまで寄る。
// 広場の中心は画面の高さの plazaNdc（上端の HUD の帯の分だけ中央より少し下）。距離は画面の縦横比ごとに解く:
// 正方形と屋上の点が、横は ±marginX、縦は ndcBottom〜ndcTop（HUD の帯より下）に収まる一番近い距離（tests/render/cityCamera.test.js）。
// 仰角は、手前の街区の建物（cityGen.js の高さ制限）が広場を隠さないよう高め。道路の格子にまっすぐ沿って見下ろす。
// 縦画面の横の画角は minHFovDeg（縦は約 69°）、横長の画面の縦の画角は vFovDeg（横の端のゆがみを抑える）。
// 縦画面では広場まで約 115m（小さな一発でカメラが押されない遠さ。blastCamera.js）。
export const CITY_CAMERA = {
  elevationDeg: 62, azimuthDeg: 0, minHFovDeg: 52, vFovDeg: 46,
  frameHalf: 35, frameTop: 22,
  marginX: 0.92, ndcTop: 0.7, ndcBottom: -0.94, plazaNdc: -0.1,
};

export function createCityCamera(opts = CITY_CAMERA) {
  const cam = new THREE.PerspectiveCamera(opts.vFovDeg, 1, 1, 6000);
  cam.userData.cityOpts = opts;
  fitCityCamera(cam, 1);
  return cam;
}

// 正方形の角・辺の中点（地面と屋上の高さ）
function framePoints(half, top) {
  const pts = [];
  for (const x of [-half, 0, half]) for (const z of [-half, 0, half]) {
    if (!x && !z) continue;
    pts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, top, z));
  }
  return pts;
}

const _v = new THREE.Vector3();

// 距離 dist、見下ろしの向きのずれ tilt（ラジアン、正で上を向く）に置いたとき、枠の点が収まるか
function place(cam, opts, dist, tilt) {
  const el = THREE.MathUtils.degToRad(opts.elevationDeg), az = THREE.MathUtils.degToRad(opts.azimuthDeg);
  cam.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
  // 原点を見て、そこから tilt だけ上を向く
  const pitch = el - tilt;
  cam.lookAt(cam.position.x - Math.sin(az) * Math.cos(pitch), cam.position.y - Math.sin(pitch), cam.position.z - Math.cos(az) * Math.cos(pitch));
  cam.updateMatrixWorld();
}

function fits(cam, opts, pts) {
  for (const p of pts) {
    _v.copy(p).project(cam);
    if (_v.z > 1 || Math.abs(_v.x) > opts.marginX || _v.y > opts.ndcTop || _v.y < opts.ndcBottom) return false;
  }
  return true;
}

// 縦長の画面でも横が切れすぎないよう、横の画角に下限を設ける。向きは広場の中心が画面の高さの plazaNdc に来るように、
// 距離は枠が収まる一番近いものを探す。
export function fitCityCamera(cam, aspect) {
  const opts = cam.userData.cityOpts ?? CITY_CAMERA;
  cam.aspect = aspect;
  const hHalf = THREE.MathUtils.degToRad(opts.minHFovDeg) / 2;
  const vNeeded = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hHalf) / aspect));
  cam.fov = Math.min(84, Math.max(opts.vFovDeg, vNeeded));
  cam.updateProjectionMatrix();
  // 原点が画面の高さ plazaNdc に来る、視線の上向きのずれ（距離によらない）
  const tilt = -Math.atan(opts.plazaNdc * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
  const pts = framePoints(opts.frameHalf, opts.frameTop);
  let lo = 1, hi = 2000;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    place(cam, opts, mid, tilt);
    if (fits(cam, opts, pts)) hi = mid; else lo = mid;
  }
  place(cam, opts, hi, tilt);
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
    // 画面全体を真っ白にする（大きな一発を放った瞬間）。warm { scene, camera, fx } を渡すと、先にその場面を画面全体で、
    // 閃光をいっぱいにして描いてから白で塗る: 画面全体の大きさの画面効果のレンダーターゲット（mid/high）や、low の閃光と
    // 重ね描きのシェーダーを白の間に作っておく（白が明けて閃光の残る街へ切り替わるフレームで止まらない）。白の間の最初のフレームだけ渡せばよい
    renderWhite(warm = null) {
      if (warm) this.renderFull(warm.scene, warm.camera, { ...warm.fx, flash: 1 });
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
