import * as THREE from 'three';

// 最後の一発の演出で、宙に浮いたガラス片に映る軍勢の一人の目（片目の大写し）。レンダーターゲットに描き、ガラス片が映す。
// ヘルメットのつばの下端と覆面の上端のあいだの、片目だけ。
//   uOpen  0: 細く硬いにらみ → 1: 黒目の上に白目がのぞく、凍りついた見開き
//   uLight 0〜1: 瞳に映る光（地平の街の影の上に光の半球が育ち、瞳からあふれる）
//   uFlood 0〜1: 瞳の光が画面全体へあふれる（時間が戻る瞬間の白へつなぐ）
// 色は enemyView の目のアップと同じ（同じ人は同じ目の色・肌の色）。

export const EYE_ASPECT = 1.6;

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */`
uniform float uTime, uSeed, uOpen, uLight, uFlood, uLook;
uniform vec3 uIris, uSkin;
varying vec2 vUv;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return vn(p) * 0.5 + vn(p * 2.1 + 3.7) * 0.3 + vn(p * 4.3 + 7.1) * 0.2; }

void main() {
  vec2 p = (vUv - 0.5) * vec2(${EYE_ASPECT.toFixed(2)}, 1.0);
  // こわばった細かい震え（恐怖が増すほど）
  p += vec2(sin(uTime * 53.0 + uSeed * 9.0), cos(uTime * 41.0)) * 0.0018 * (0.3 + uOpen);
  vec2 E = vec2(-0.02, -0.01);
  float a = 0.5;
  float t = clamp((p.x - E.x) / a, -1.2, 1.2);
  float w = max(1.0 - t * t, 0.0);
  float hu = mix(0.07, 0.275, uOpen), hl = mix(0.085, 0.14, uOpen);
  float yU = E.y + 0.035 * t + hu * pow(w, 0.55) * (1.0 + 0.18 * t);
  float yL = E.y + 0.02 * t - hl * pow(w, 0.8);
  float aa = 0.004;
  float inside = smoothstep(-aa, aa, p.y - yL) * smoothstep(-aa, aa, yU - p.y) * step(abs(t), 1.0);

  // ---- 肌（まぶたのまわり）: くすんだ肌に毛穴、下から迫る光、上はつばの影 ----
  vec3 sk = mix(uSkin, vec3(dot(uSkin, vec3(0.3, 0.59, 0.11))), 0.35);
  float pores = 0.88 + 0.12 * fbm(p * 140.0 + uSeed * 30.0);
  vec3 col = sk * pores * mix(0.26, 0.62, smoothstep(0.32, -0.25, p.y));
  col += vec3(1.0, 0.55, 0.25) * uLight * uLight * 0.9 * smoothstep(0.35, -0.3, p.y);
  // まぶたの溝（上まぶたのたるみの線）と、目のまわりのくぼみの陰
  float crease = yU + mix(0.05, 0.09, uOpen) * pow(w, 0.4);
  col *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.018, abs(p.y - crease))) * smoothstep(1.05, 0.5, abs(t));
  col *= 1.0 - 0.35 * smoothstep(0.65, 0.0, length((p - E) * vec2(0.8, 2.0)));

  // ---- 目 ----
  vec2 I = vec2(E.x + 0.025 + uLook * 0.03, E.y + 0.004 + 0.012 * uOpen);
  float ri = 0.168;
  vec2 d = p - I;
  float r = length(d) / ri;
  // 白目: くすんだ白に、目じり・目頭の赤み、細い血の筋、上まぶたの落とす影
  vec3 white = mix(vec3(0.5, 0.47, 0.46), vec3(0.86, 0.83, 0.79), smoothstep(yU, yU - 0.12, p.y));
  white = mix(white, vec3(0.75, 0.42, 0.38), smoothstep(0.55, 1.0, abs(t)) * 0.6);
  float vein = smoothstep(0.82, 0.97, vn(vec2(p.x * 38.0 + uSeed * 5.0, p.y * 9.0) + vn(p * 24.0) * 2.0)) * smoothstep(0.3, 0.9, abs(t));
  white = mix(white, vec3(0.6, 0.1, 0.08), vein * 0.7);
  white *= 0.85 + 0.15 * smoothstep(1.4, 1.0, r); // 黒目のまわりはわずかに暗い
  vec3 c = white;
  if (r < 1.0) {
    float ang = atan(d.y, d.x);
    // 虹彩: 放射状の筋、瞳のまわりの明るい輪、外の濃い縁の輪
    float fib = vn(vec2(ang * 26.0, r * 5.0 + uSeed * 4.0)) * 0.6 + vn(vec2(ang * 61.0, r * 13.0)) * 0.4;
    vec3 iris = uIris * (0.55 + 0.9 * fib);
    iris = mix(iris, uIris * 1.9 + vec3(0.08, 0.05, 0.0), smoothstep(0.62, 0.45, r) * 0.7);
    iris = mix(iris, vec3(0.015, 0.012, 0.01), smoothstep(0.8, 0.98, r));
    // 迫る光で虹彩の下半分が熱く照らされる
    iris += vec3(1.0, 0.5, 0.2) * uLight * 0.7 * smoothstep(0.2, -0.9, d.y / ri) * fib;
    float pr = mix(0.43, 0.3, smoothstep(0.0, 0.8, uLight));
    iris = mix(vec3(0.004), iris, smoothstep(pr - 0.03, pr + 0.03, r));
    c = iris;
  }
  // ---- 角膜に映るもの: 地平の街の影と、その上に育つ光の半球（凸面鏡なので地平は弧を描く） ----
  float cornea = 1.0 - smoothstep(1.0, 1.08, r);
  {
    vec2 q = d / ri; // 黒目の大きさで 1
    float yh = -0.12 - 0.35 * q.x * q.x;
    // 街の影: 不ぞろいな四角いビル
    float bx = floor(q.x * 22.0 + 40.0);
    float bh = (0.04 + 0.16 * h21(vec2(bx, uSeed * 13.0))) * (0.5 + 0.5 * smoothstep(0.9, 0.2, abs(q.x)));
    float city = step(q.y, yh + bh) * step(yh - 0.6, q.y);
    vec3 refl = mix(vec3(0.05, 0.035, 0.05), vec3(0.18, 0.1, 0.08), smoothstep(-0.2, 0.6, q.y)); // 夕方の空
    // 光の半球: 地平の上に、中心は白、外へ金から橙。光が強いほど大きく、街の影を飲み込む
    float rd = mix(0.04, 1.05, pow(uLight, 1.6));
    vec2 dc = (q - vec2(0.08, yh)) / max(rd, 1e-3);
    float dome = smoothstep(1.0, 0.92, length(dc * vec2(1.0, 1.15))) * step(yh - 0.02, q.y);
    float halo = exp(-max(length(dc) - 0.9, 0.0) * 2.4) * (0.4 + uLight);
    vec3 domeC = mix(vec3(4.0, 1.7, 0.55), vec3(6.0, 5.4, 4.6), smoothstep(0.9, 0.2, length(dc)));
    refl = mix(refl, vec3(0.01), city * (1.0 - smoothstep(0.6, 1.0, uLight)));
    refl += vec3(1.6, 0.75, 0.3) * halo * (1.0 - city * 0.7);
    refl = mix(refl, domeC * (0.6 + 1.2 * uLight), dome);
    // 瞳の上ではくっきり、虹彩の上では半ば透けて
    float over = mix(0.45, 1.0, smoothstep(0.5, 0.35, r));
    c = mix(c, c * 0.5 + refl, cornea * over);
    // 小さく鋭い光ひとつ（空の映り込み）
    vec2 cl = q - vec2(-0.42, 0.42);
    c += vec3(2.2, 2.3, 2.5) * (1.0 - smoothstep(0.06, 0.09, length(cl * vec2(1.0, 1.4)))) * cornea;
  }
  // 上まぶたが落とす濃い影と、下まぶたの濡れた縁の光
  c *= 1.0 - 0.75 * smoothstep(yU - 0.05, yU, p.y);
  c += vec3(1.0, 0.75, 0.55) * (1.0 - smoothstep(0.0, 0.006, abs(p.y - yL - 0.008))) * smoothstep(1.0, 0.3, abs(t)) * (0.5 + uLight);
  col = mix(col, c, inside);

  // まつげ: 上は濃く長く外へ反り、下は短くまばら
  float above = p.y - yU;
  float lashU = smoothstep(0.075, 0.0, above) * step(0.0, above) * smoothstep(1.0, 0.6, abs(t));
  float sU = fract(p.x * 85.0 + above * 30.0 * sign(t + 0.2) + h21(vec2(floor(p.x * 85.0), 2.0)) * 0.4);
  col = mix(col, vec3(0.012, 0.01, 0.01), lashU * smoothstep(0.32, 0.0, abs(sU - 0.5)) * 0.95);
  col = mix(col, vec3(0.015, 0.01, 0.01), (1.0 - smoothstep(0.0, 0.012, abs(above - 0.002))) * smoothstep(1.02, 0.85, abs(t)));
  float below = yL - p.y;
  float lashL = smoothstep(0.03, 0.0, below) * step(0.0, below) * smoothstep(0.9, 0.3, abs(t));
  float sL = fract(p.x * 60.0 - below * 20.0);
  col = mix(col, vec3(0.03, 0.02, 0.02), lashL * smoothstep(0.2, 0.0, abs(sL - 0.5)) * 0.7);

  // ---- ヘルメットのつば（上）と覆面（下） ----
  float top = 0.33 - 0.07 * p.x * p.x;
  float bot = -0.31 + 0.05 * p.x * p.x;
  if (p.y > top) {
    float k = (p.y - top) / 0.2;
    vec3 helm = mix(vec3(0.05, 0.055, 0.065), vec3(0.012, 0.014, 0.018), clamp(k, 0.0, 1.0));
    helm += vec3(0.5, 0.55, 0.7) * 0.07 * smoothstep(0.3, 0.0, abs(k - 0.6 + 0.3 * p.x));
    // つばの縁: 迫る光で熱く光る線
    helm += vec3(1.0, 0.62, 0.32) * (0.25 + 2.5 * uLight * uLight) * (1.0 - smoothstep(0.0, 0.018, p.y - top));
    col = helm;
  } else {
    col *= mix(0.35, 1.0, smoothstep(0.0, 0.07, top - p.y)); // つばの下の陰
  }
  if (p.y < bot) {
    float weave = 0.82 + 0.18 * vn(p * vec2(300.0, 160.0));
    vec3 mask = vec3(0.04, 0.04, 0.045) * weave * (0.85 + 0.15 * sin(p.x * 11.0 + vn(p * 5.0) * 3.0));
    mask += vec3(1.0, 0.55, 0.25) * uLight * uLight * 0.25 * smoothstep(0.08, 0.0, bot - p.y);
    col = mask;
  }
  // 周りを暗く絞る
  col *= 1.0 - 0.6 * smoothstep(0.45, 1.0, length(p * vec2(0.75, 1.3)));
  // 瞳の光が画面じゅうへあふれる
  float fl = smoothstep(uFlood * 1.6, uFlood * 1.6 - 0.25, length(p - I)) * step(0.001, uFlood);
  col = mix(col, vec3(6.0, 5.6, 5.0), fl);
  gl_FragColor = vec4(col, 1.0);
}`;

// 目の板（EYE_ASPECT × 1、正面が +z）と、それを写す正投影カメラ
export function createCineEye() {
  const uniforms = {
    uTime: { value: 0 }, uSeed: { value: 0.37 }, uOpen: { value: 0 }, uLight: { value: 0 }, uFlood: { value: 0 }, uLook: { value: 0 },
    uIris: { value: new THREE.Color(0.25, 0.16, 0.09) }, uSkin: { value: new THREE.Color(0.55, 0.36, 0.27) },
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(EYE_ASPECT, 1), new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG }));
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-EYE_ASPECT / 2, EYE_ASPECT / 2, 0.5, -0.5, 0.1, 10);
  camera.position.z = 1;
  return {
    scene, camera, uniforms,
    // 同じ人は同じ目: enemyView の目のアップの色をそのまま使う
    setIdentity({ iris, skin, seed }) {
      if (iris) uniforms.uIris.value.copy(iris);
      if (skin) uniforms.uSkin.value.copy(skin);
      if (seed !== undefined) uniforms.uSeed.value = seed;
    },
    render(renderer, target) {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(prev);
    },
  };
}
