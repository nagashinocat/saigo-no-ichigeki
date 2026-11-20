import * as THREE from 'three';

// 止まった瓦礫（world/rubble.js）を1つの InstancedMesh で描く。
// 瓦礫は動かないので、置いた・消えた slot の行列だけを書き、その範囲だけ GPU へ送る（何も変わらないフレームは何もしない）。
export function createRubbleView(material, rubble) {
  const capacity = rubble.capacity;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, capacity);
  mesh.name = 'rubble';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  return {
    mesh,
    update() {
      const { slots, highWater } = rubble.takeChanges();
      mesh.count = highWater;
      if (!slots.length) return;
      const d = rubble.data;
      let lo = Infinity, hi = -1;
      for (const k of slots) {
        if (rubble.isLive(k)) {
          e.set(d.rx[k], d.ry[k], d.rz[k]);
          mesh.setMatrixAt(k, m.compose(p.set(d.px[k], d.py[k], d.pz[k]), q.setFromEuler(e), s.set(d.sx[k], d.sy[k], d.sz[k])));
          mesh.setColorAt(k, c.setRGB(d.cr[k], d.cg[k], d.cb[k]));
        } else mesh.setMatrixAt(k, ZERO);
        lo = Math.min(lo, k); hi = Math.max(hi, k);
      }
      // 範囲は足すだけ（描く前に何回か進めても前の変更を落とさない）。送り終えたら three が範囲を空にする
      for (const [attr, size] of [[mesh.instanceMatrix, 16], [mesh.instanceColor, 3]]) {
        attr.addUpdateRange(lo * size, (hi - lo + 1) * size);
        attr.needsUpdate = true;
      }
    },
  };
}
