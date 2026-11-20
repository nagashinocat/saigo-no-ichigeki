import * as THREE from 'three';

// 破片（演出の動き + 手前の物理）を1つの InstancedMesh で描く。
export function createDebrisView(style, pool, nearPhysics, capacity) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), style.props.debris, capacity);
  mesh.name = 'debris';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);

  return {
    mesh,
    update() {
      const d = pool.data;
      let n = 0;
      for (let i = 0; i < pool.count && n < capacity; i++, n++) {
        const k = pool.active[i];
        e.set(d.rx[k], d.ry[k], d.rz[k]);
        q.setFromEuler(e);
        mesh.setMatrixAt(n, m.compose(p.set(d.px[k], d.py[k], d.pz[k]), q, s.set(d.sx[k], d.sy[k], d.sz[k])));
        mesh.setColorAt(n, c.setRGB(d.cr[k], d.cg[k], d.cb[k]));
      }
      for (const b of nearPhysics.bodies) {
        if (n >= capacity) break;
        const u = b.userData;
        mesh.setMatrixAt(n, m.compose(p.set(b.position.x, b.position.y, b.position.z), q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w), s.set(u.size[0], u.size[1], u.size[2])));
        mesh.setColorAt(n, c.setRGB(u.color[0], u.color[1], u.color[2]));
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    },
  };
}
