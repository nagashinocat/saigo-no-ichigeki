import * as THREE from 'three';

// リプレイの最後のカット「光の中心に立つ主人公の影」の光。
// 主人公を包む大きな光の殻（内側から見る）。主人公の向こうがいちばん白く熱く、まわりへ橙に落ち、ゆっくり回る光の筋が出る。
// 加算で重ね、深度は読むが書かない: 殻より手前にある主人公や破片は光に塗られず、黒い影絵として残る。
const VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */`
uniform vec3 uCam, uCore, uHot, uWarm;
uniform float uI, uTime, uCoreK;
varying vec3 vWorld;
void main() {
  vec3 dir = normalize(vWorld - uCam);
  vec3 cd = normalize(uCore - uCam);
  float c = max(dot(dir, cd), 0.0);
  // 光の筋: 主人公の向こうの一点から放射状に
  vec3 t = normalize(cross(cd, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
  vec3 b = cross(cd, t);
  float ang = atan(dot(dir, b), dot(dir, t));
  float rays = 0.5 + 0.5 * sin(ang * 19.0 + 2.0 * sin(ang * 5.0 + uTime * 0.7) + uTime * 0.25);
  rays *= 0.5 + 0.5 * sin(ang * 7.0 - uTime * 0.4);
  // 芯は主人公の体のすぐ外まで（影の輪郭に光の冠ができる）、そのまわりに広い光
  float core = pow(c, 70.0) * 1.6 + pow(c, 14.0) * 0.5 + pow(c, 3.0) * 0.2;
  float glow = 0.1 + core * uCoreK + rays * pow(c, 2.0) * 0.25;
  // 下（地面の側）は少し暗く、上は明るい（光の中にも上下がある）
  glow *= 0.75 + 0.25 * smoothstep(-0.6, 0.5, dir.y);
  vec3 col = mix(uWarm, uHot, clamp(core * 0.6 + 0.25, 0.0, 1.0));
  gl_FragColor = vec4(col * glow * uI, 1.0);
}`;

export function createReplayLight() {
  const uniforms = {
    uCam: { value: new THREE.Vector3() },
    uCore: { value: new THREE.Vector3(0, 1.0, 0) },
    uHot: { value: new THREE.Color(1.0, 0.96, 0.88) },
    uWarm: { value: new THREE.Color(1.0, 0.58, 0.26) },
    uI: { value: 0 },
    uCoreK: { value: 1 },
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.name = 'replay-light';
  mesh.frustumCulled = false;
  mesh.renderOrder = 3; // 球や粉より先（光の中の粉は光の上に重なる）
  mesh.visible = false;

  return {
    mesh,
    // intensity: 0 で消える。coreK: 主人公の向こうの白い芯の強さ。radius: 殻の大きさ（カメラは中）
    update({ camera, intensity, coreK = 1, time = 0, radius = 220, center = [0, 1.0, 0] }) {
      mesh.visible = intensity > 0.002;
      uniforms.uI.value = intensity;
      uniforms.uCoreK.value = coreK;
      uniforms.uTime.value = time;
      uniforms.uCam.value.copy(camera.position);
      uniforms.uCore.value.fromArray(center);
      mesh.position.fromArray(center);
      mesh.scale.setScalar(radius);
    },
    hide() { mesh.visible = false; },
  };
}
