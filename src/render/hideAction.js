import * as THREE from 'three';
import { hideMotionAt } from '../game/hideMotion.js';

// R1f（持ち主 18:14「派手でかっこいいアクション（跳ぶ・壁を蹴る・残像・光の尾・着地のしゃがみ・短い効果音）」）: 物陰へ跳ぶ見た目。
// 動き（道すじ・高さ・しゃがみ）は game/hideMotion.js。ここは上空から見える安い飾りだけ（網 4 つ、毎フレーム行列と uniform・頂点を書き換える）:
//  - 残像: 主人公の体の写し GHOSTS 体（少し前の時刻の道すじの所、加算の暖かい色。古いほど薄い）
//  - 光の尾: 道すじに沿う明るい帯（水平と縦の 2 枚。今の所から TRAIL の割合だけ後ろまで。着地のあと fadeSec 秒で消える）
//  - 着地の光: 物陰の足元で広がる輪と、きらりと光る十字（着地の瞬間から burstSec 秒）
// update(hero, dt) は { y（体を持ち上げる高さ m）, crouch（0〜1）, landed（この呼び出しで着地した）, started（跳び始めた）} を返す
// 上空のカメラ（主人公は画面で 10 px ほど）から見えるよう、どれも体より大きく明るく（残像は体の ghostScale 倍、踏み切りにも小さな輪）
export const HIDE_FX = { ghosts: 4, ghostGap: 0.04, ghostScale: 2.2, trail: 0.75, trailW: 3.2, trailH: 2.2, trailN: 14, fadeSec: 0.32, burstSec: 0.36, burstR: 6.5, glint: 5, launchR: 4 };

const TRAIL_VERT = /* glsl */`
attribute float aU;
varying float vU;
varying float vV;
void main() { vU = aU; vV = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TRAIL_FRAG = /* glsl */`
uniform vec3 uCol;
uniform float uA;
varying float vU;
varying float vV;
void main() {
  float a = uA * pow(vU, 1.1) * (1.0 - smoothstep(0.22, 0.5, abs(vV - 0.5)));
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol * a, 1.0);
}`;
const RING_FRAG = /* glsl */`
uniform vec3 uCol;
uniform float uA;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float a = uA * smoothstep(0.62, 0.86, r) * (1.0 - smoothstep(0.9, 1.0, r));
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol * a, 1.0);
}`;
const GLINT_FRAG = /* glsl */`
uniform vec3 uCol;
uniform float uA;
varying vec2 vUv;
void main() {
  vec2 p = abs(vUv * 2.0 - 1.0);
  float a = uA * (max(1.0 - smoothstep(0.0, 0.12, p.y) , 0.0) * (1.0 - p.x) + max(1.0 - smoothstep(0.0, 0.12, p.x), 0.0) * (1.0 - p.y));
  a += uA * 0.8 * (1.0 - smoothstep(0.0, 0.35, length(p)));
  if (a < 0.004) discard;
  gl_FragColor = vec4(uCol * a, 1.0);
}`;
const UV_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const yawOf = (dx, dz) => Math.atan2(dx, dz); // 体の向き（z 軸から x 軸へ。main.js の syncHero と同じ写し）

export function createHideAction(scene, { heroGeometry }) {
  const F = HIDE_FX;
  const group = new THREE.Group();
  group.name = 'hide-action';
  // 残像
  const ghostMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.5, 0.8), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const ghostOpacity = new Float32Array(F.ghosts);
  ghostMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGhost;\nvarying float vGhost;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGhost = aGhost;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGhost;').replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * vGhost, opacity );');
  };
  const ghostGeo = heroGeometry.clone();
  const ghosts = new THREE.InstancedMesh(ghostGeo, ghostMat, F.ghosts);
  const ghostAttr = new THREE.InstancedBufferAttribute(ghostOpacity, 1);
  ghostGeo.setAttribute('aGhost', ghostAttr);
  ghosts.frustumCulled = false;
  ghosts.name = 'hide-ghosts';
  ghosts.count = 0;
  // 光の尾（水平の帯と縦の帯。頂点は毎フレーム書き換える）
  const trailUni = { uCol: { value: new THREE.Color(1.0, 0.86, 0.5).multiplyScalar(3.0) }, uA: { value: 0 } };
  const trailMat = new THREE.ShaderMaterial({ uniforms: trailUni, vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const mkRibbon = () => {
    const g = new THREE.BufferGeometry();
    const n = F.trailN;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2 * 2), 2));
    g.setAttribute('aU', new THREE.BufferAttribute(new Float32Array(n * 2), 1));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, trailMat);
    m.frustumCulled = false;
    return m;
  };
  const flat = mkRibbon(), tall = mkRibbon();
  flat.name = 'hide-trail'; tall.name = 'hide-trail-v';
  // 着地の輪と十字
  const ringUni = { uCol: { value: new THREE.Color(1.0, 0.85, 0.55).multiplyScalar(1.8) }, uA: { value: 0 } };
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: ringUni, vertexShader: UV_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.name = 'hide-land-ring';
  const glintUni = { uCol: { value: new THREE.Color(1.0, 0.95, 0.8).multiplyScalar(2.2) }, uA: { value: 0 } };
  const glint = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: glintUni, vertexShader: UV_VERT, fragmentShader: GLINT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  glint.name = 'hide-glint';
  for (const m of [ring, glint]) { m.frustumCulled = false; m.visible = false; }
  group.add(ghosts, flat, tall, ring, glint);
  scene.add(group);

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(F.ghostScale, F.ghostScale, F.ghostScale), _e = new THREE.Euler();
  let plan = null, lastT = -1, fade = 0, burstT = Infinity, burstAt = null;

  function ribbon(mesh, pts, vertical) {
    const P = mesh.geometry.attributes.position.array, U = mesh.geometry.attributes.uv.array, A = mesh.geometry.attributes.aU.array;
    const n = pts.length;
    for (let i = 0; i < F.trailN; i++) {
      const p = pts[Math.min(i, n - 1)], q = pts[Math.min(i + 1, n - 1)], o = pts[Math.max(i - 1, 0)];
      let dx = q.x - o.x, dz = q.z - o.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const u = n > 1 ? Math.min(i, n - 1) / (n - 1) : 1;
      for (let s = 0; s < 2; s++) {
        const k = (i * 2 + s) * 3, side = s ? 0.5 : -0.5;
        if (vertical) { P[k] = p.x; P[k + 1] = p.y + 0.4 + side * F.trailH * 2; P[k + 2] = p.z; }
        else { P[k] = p.x - dz * side * F.trailW * 2 * 0.5; P[k + 1] = p.y + 0.6; P[k + 2] = p.z + dx * side * F.trailW * 2 * 0.5; }
        U[(i * 2 + s) * 2] = u; U[(i * 2 + s) * 2 + 1] = s; A[i * 2 + s] = u;
      }
    }
    mesh.geometry.attributes.position.needsUpdate = mesh.geometry.attributes.uv.needsUpdate = mesh.geometry.attributes.aU.needsUpdate = true;
  }

  return {
    group, ghosts, trail: flat, ring, glint,
    // hero: game.hero（action = { plan, t } を読む）。dt: 描く間の秒
    update(hero, dt) {
      const act = hero.action;
      let started = false, landed = false, y = 0, crouch = 0;
      if (act && act.plan !== plan) { plan = act.plan; lastT = -1; started = true; burstT = 0; burstAt = { x: plan.from.x, z: plan.from.z, launch: true }; }
      if (act) {
        const t = act.t;
        if (lastT < plan.sec && t >= plan.sec) { landed = true; burstT = 0; burstAt = { x: plan.to.x, z: plan.to.z }; }
        lastT = t;
        const m = hideMotionAt(plan, t);
        y = m.y; crouch = m.crouch;
        fade = 1;
        // 残像: 少し前の時刻の所（跳ぶ間だけ。着地のあとは同じ所に重なって消えていく）
        let n = 0;
        for (let k = 1; k <= F.ghosts; k++) {
          const tk = t - k * F.ghostGap;
          if (tk < plan.crouchSec * 0.5 || tk > plan.sec) continue;
          const g = hideMotionAt(plan, tk), g2 = hideMotionAt(plan, Math.min(plan.sec, tk + 0.01));
          const dx = g2.x - g.x, dz = g2.z - g.z;
          _p.set(g.x, g.y, g.z);
          _q.setFromEuler(_e.set(0.35, Math.hypot(dx, dz) > 1e-4 ? yawOf(dx, dz) : 0, 0, 'YXZ'));
          ghosts.setMatrixAt(n, _m.compose(_p, _q, _s));
          ghostOpacity[n] = 0.95 * (1 - (k - 1) / F.ghosts) * (t > plan.sec ? Math.max(0, 1 - (t - plan.sec) / plan.landSec) : 1);
          n++;
        }
        ghosts.count = n;
        ghosts.instanceMatrix.needsUpdate = true;
        ghostAttr.needsUpdate = true;
        // 光の尾: 道すじの s0〜s（s0 = s − trail）
        const s1 = m.s, s0 = Math.max(0, s1 - F.trail);
        const pts = [];
        for (let i = 0; i < F.trailN; i++) {
          const s = s0 + ((s1 - s0) * i) / (F.trailN - 1);
          // s から時刻を逆に引かず、跳ぶ間の高さの形だけを借りる（道すじの点は hideMotionAt の s と同じ）
          const tt = plan.crouchSec + (plan.sec - plan.crouchSec) * (1 - Math.sqrt(Math.max(0, 1 - (s - plan.crouchCreep) / (1 - plan.crouchCreep))));
          const p = hideMotionAt(plan, s <= plan.crouchCreep ? 0 : Math.min(plan.sec - 1e-6, tt));
          pts.push({ x: p.x, z: p.z, y: p.y });
        }
        ribbon(flat, pts, false); ribbon(tall, pts, true);
      } else {
        ghosts.count = 0;
        fade = Math.max(0, fade - dt / F.fadeSec);
        plan = fade > 0 ? plan : null;
      }
      trailUni.uA.value = fade * (act && act.t > plan?.sec ? Math.max(0.3, 1 - (act.t - plan.sec) / F.fadeSec) : 1) * 0.95;
      flat.visible = tall.visible = fade > 0 && !!plan;
      // 着地の輪と十字
      if (burstT < F.burstSec && burstAt) {
        burstT += landed || started ? 0 : dt;
        const u = Math.min(1, burstT / F.burstSec);
        ring.visible = glint.visible = true;
        const r = 0.6 + ((burstAt.launch ? F.launchR : F.burstR) - 0.6) * (1 - (1 - u) ** 2);
        ring.position.set(burstAt.x, 0.08, burstAt.z); ring.scale.set(r, 1, r);
        ringUni.uA.value = 1.0 * (1 - u);
        const gs = (burstAt.launch ? 0.5 : 1) * F.glint * Math.sin(Math.PI * Math.min(1, u * 1.6));
        glint.position.set(burstAt.x, 1.4, burstAt.z); glint.scale.set(gs, gs, gs);
        glint.quaternion.copy(_q.setFromEuler(_e.set(-Math.PI / 2 + 0.2, 0, u * 1.5)));
        glintUni.uA.value = 1.2 * (1 - u);
      } else { ring.visible = glint.visible = false; }
      return { y, crouch, landed, started };
    },
  };
}
