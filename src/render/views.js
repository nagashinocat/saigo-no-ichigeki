import * as THREE from 'three';

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
  const az = THREE.MathUtils.degToRad(opts.azimuthDeg);
  cam.position.set(Math.sin(az) * opts.distance, opts.height, Math.cos(az) * opts.distance);
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
  const p = cam.position;
  cam.lookAt(p.x - Math.sin(az) * Math.cos(pitch), p.y - Math.sin(pitch), p.z - Math.cos(az) * Math.cos(pitch));
  cam.updateMatrixWorld();
}

const HUD_CLEAR = new THREE.Color(0x0b0d16);

export function createViews(renderer) {
  const cityCamera = createCityCamera();

  const handCamera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
  handCamera.position.set(0, 0.2, 3);
  handCamera.lookAt(0, 0, 0);

  let layout = layoutViews(1, 1);

  const aspectOf = (rect) => rect.w / Math.max(1, rect.h);

  function drawRect(rect, scene, camera) {
    if (rect.w <= 0 || rect.h <= 0) return;
    renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
    renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
    renderer.render(scene, camera);
  }

  return {
    cityCamera, handCamera,
    get layout() { return layout; },
    resize(w, h) {
      renderer.setSize(w, h, false);
      layout = layoutViews(w, h);
      fitCityCamera(cityCamera, aspectOf(layout.city));
      handCamera.aspect = aspectOf(layout.hand);
      handCamera.updateProjectionMatrix();
    },
    render(cityScene, handScene) {
      renderer.setScissorTest(true);
      const { hud } = layout;
      if (hud.w > 0 && hud.h > 0) {
        renderer.setScissor(hud.x, hud.y, hud.w, hud.h);
        renderer.setClearColor(HUD_CLEAR, 1);
        renderer.clear(true, true, false);
      }
      drawRect(layout.city, cityScene, cityCamera);
      drawRect(layout.hand, handScene, handCamera);
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
