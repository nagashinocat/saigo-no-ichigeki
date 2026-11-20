// 爆発まわりのシェーダーで使う軽い値ノイズ（ハッシュのみ、テクスチャ不要）
export const NOISE_GLSL = /* glsl */`
float xhash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float xhash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float xnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(xhash13(i), xhash13(i + vec3(1, 0, 0)), u.x), mix(xhash13(i + vec3(0, 1, 0)), xhash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(xhash13(i + vec3(0, 0, 1)), xhash13(i + vec3(1, 0, 1)), u.x), mix(xhash13(i + vec3(0, 1, 1)), xhash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float xnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(xhash12(i), xhash12(i + vec2(1, 0)), u.x), mix(xhash12(i + vec2(0, 1)), xhash12(i + vec2(1, 1)), u.x), u.y);
}
// 段のついた値（アニメの色の切り替わり）。aa は段の境目のなめらかさ
float xcel(float x, float steps, float aa) {
  float s = x * steps;
  return (floor(s) + smoothstep(0.5 - aa, 0.5 + aa, fract(s))) / steps;
}
`;
