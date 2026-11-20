import * as THREE from 'three';
import { createScreenFx } from './screenFx.js';

// 1つの WebGLRenderer で「街（上空）」と「手」の2画面を描く。HUD の区画は DOM を重ねる場所で、WebGL では塗りつぶすだけ。

const PORTRAIT = { city: 0.65, hand: 0.6 };  // 縦長: 街は上 65%、下の帯の左 60% が手
const LANDSCAPE = { city: 0.7, hand: 0.6 };  // 横長: 街は左 70%、右列の上 60% が手

// Rect は WebGL と同じ左下原点。すべて整数で、3つ合わせて画面をすき間なく埋める（端数は HUD 側へ）。
export function layoutViews(width, height) {
  const W = Math.max(0, Math.floor(width)), H = Math.max(0, Math.floor(height));
  if (H >= W) {
    const cityH = Math.round(H * PORTRAIT.city), stripH = H - cityH;
    const handW = Math.round(W * PORTRAIT.hand);
    return {
      city: { x: 0, y: stripH, w: W, h: cityH },
      hand: { x: 0, y: 0, w: handW, h: stripH },
      hud: { x: handW, y: 0, w: W - handW, h: stripH },
    };
  }
  const cityW = Math.round(W * LANDSCAPE.city), colW = W - cityW;
  const handH = Math.round(H * LANDSCAPE.hand), hudH = H - handH;
  return {
    city: { x: 0, y: 0, w: cityW, h: H },
    hand: { x: cityW, y: hudH, w: colW, h: handH },
    hud: { x: cityW, y: 0, w: colW, h: hudH },
  };
}

// 上空カメラ: 主人公（原点）の斜め上から街を見下ろす。広場は画面の中ほどより下、
// 街の遠い端の先に地平があり、画面の上 15% ほどに夕空が入るよう、向きは画角から決める。
// 広場と、軍勢が現れる 60〜90m の輪は、縦長でも横長でも画面に収まる（tests/render/cityCamera.test.js）。
// 道路の格子にまっすぐ沿って見下ろすと、通りが地平の夕空へ吸い込まれ、輪の上の道路も見通しやすい。
export const CITY_CAMERA = { height: 280, distance: 260, azimuthDeg: 0, minHFovDeg: 62, vFovDeg: 74, horizonNdc: 0.7 };

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

// 視線 dir（単位ベクトル）と逆向きに t 下がると、原点からの距離が minDist 以上になる最小の t（0 以上）。
export function pullbackDistance(pos, dir, minDist) {
  const pp = pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2];
  if (pp >= minDist * minDist) return 0;
  const pd = pos[0] * dir[0] + pos[1] * dir[1] + pos[2] * dir[2];
  // |pos - t dir|² = minDist² を t について解く（大きい方の根）
  return pd + Math.sqrt(pd * pd - pp + minDist * minDist);
}

// 爆発の球がカメラを飲み込まないよう、上空カメラを視線に沿って後ろ（上）へ引く量。
// goal（その一発が最後に届く半径）× goalRatio まで先回りしてなめらかに下がり（ばねで、動き出しの速さは0）、
// front（今の球の半径）× ratio より近づくことは決してない。終われば goal=0 でゆっくり戻る。
// goalRatio は球の全体が画面に収まりやすい距離（球の見かけの半角が画角の半分ほど）。
export function createCameraFollow({ ratio = 1.3, goalRatio = 1.7, outRate = 4, backRate = 1.6 } = {}) {
  let t = 0, v = 0;
  return {
    get t() { return t; },
    update(dt, pos, dir, front, goal) {
      const need = pullbackDistance(pos, dir, front * ratio);
      const want = Math.max(need, pullbackDistance(pos, dir, goal * goalRatio));
      if (dt > 0) {
        const w = want > t ? outRate : backRate;
        // 臨界減衰のばね（半陰的に積分して、大きな dt でも振動しない）
        v = (v + w * w * (want - t) * dt) / (1 + 2 * w * dt + w * w * dt * dt);
        t += v * dt;
      }
      if (t < need) { t = need; v = Math.max(v, 0); }
      if (t < 0) { t = 0; v = 0; }
      return t;
    },
  };
}

const HUD_CLEAR = new THREE.Color(0x0b0d16);

export function createViews(renderer, getTier = () => ({ bloom: false, heatHaze: false })) {
  const cityCamera = createCityCamera();
  const follow = createCameraFollow();
  const screenFx = createScreenFx(renderer);
  const _dir = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  let shakeClock = 0;

  const handCamera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
  handCamera.position.set(0, 0.2, 3);
  handCamera.lookAt(0, 0, 0);

  let layout = layoutViews(1, 1);

  const aspectOf = (rect) => rect.w / Math.max(1, rect.h);

  function setRect(rect) {
    renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
    renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
  }

  return {
    cityCamera, handCamera,
    get layout() { return layout; },
    get pullback() { return follow.t; },
    resize(w, h) {
      renderer.setSize(w, h, false);
      layout = layoutViews(w, h);
      fitCityCamera(cityCamera, aspectOf(layout.city));
      handCamera.aspect = aspectOf(layout.hand);
      handCamera.updateProjectionMatrix();
    },
    // 上空カメラの姿勢: 爆発の球に合わせて視線に沿って下がり、shake（ラジアン）だけ揺れる。
    // cam = { front, goal, shake }（front/goal は球の今の半径と、最後に届く半径）
    updateCamera(dt, cam = {}) {
      const { basePos, baseQuat } = cityCamera.userData;
      _dir.set(0, 0, -1).applyQuaternion(baseQuat);
      const t = follow.update(dt, basePos.toArray(), _dir.toArray(), cam.front ?? 0, cam.goal ?? 0);
      cityCamera.position.copy(basePos).addScaledVector(_dir, -t);
      shakeClock += dt;
      const a = cam.shake ?? 0;
      const k = shakeClock * 31;
      _e.set(a * (Math.sin(k) * 0.6 + Math.sin(k * 2.3 + 1.7) * 0.4), a * (Math.sin(k * 1.7 + 0.5) * 0.6 + Math.sin(k * 3.1) * 0.4), a * 0.5 * Math.sin(k * 1.3 + 2.1));
      cityCamera.quaternion.copy(baseQuat).multiply(_q.setFromEuler(_e));
      cityCamera.updateMatrixWorld();
    },
    // fx は screenFx の効果（閃光・熱のゆがみ）。街の画面だけに掛ける。
    render(cityScene, handScene, fx) {
      renderer.setScissorTest(true);
      const { hud, city, hand } = layout;
      if (hud.w > 0 && hud.h > 0) {
        renderer.setScissor(hud.x, hud.y, hud.w, hud.h);
        renderer.setClearColor(HUD_CLEAR, 1);
        renderer.clear(true, true, false);
      }
      if (city.w > 0 && city.h > 0) {
        setRect(city);
        screenFx.render(cityScene, cityCamera, city, getTier(), fx);
      }
      if (hand.w > 0 && hand.h > 0) {
        setRect(hand);
        renderer.render(handScene, handCamera);
      }
      renderer.setScissorTest(false);
    },
  };
}

// 手の画面の場面。今は暗いグラデーションの背景と、仮の光る球だけ（本物の手は Task 10）。
export function createHandScene() {
  const scene = new THREE.Scene();
  const bg = new THREE.Mesh(
    new THREE.SphereGeometry(50, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vDir;
        void main(){
          float t = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = mix(vec3(0.010, 0.008, 0.018), vec3(0.06, 0.05, 0.11), smoothstep(0.2, 0.9, t));
          c += vec3(0.10, 0.04, 0.02) * pow(max(0.0, 1.0 - length(vDir.xy - vec2(0.0, -0.1)) * 1.4), 3.0);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  bg.renderOrder = -1;
  scene.add(bg);

  const placeholder = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.6),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv;
        void main(){
          float r = length(vUv - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - r), 2.5);
          gl_FragColor = vec4(vec3(1.0, 0.55, 0.25) * a, a);
        }`,
    }),
  );
  placeholder.add(halo, core);
  scene.add(placeholder);
  return { scene, placeholder };
}
