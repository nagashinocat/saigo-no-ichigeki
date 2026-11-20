import * as CANNON from 'cannon-es';
import { DEBRIS } from './debris.js';

// 手前（焦点の近く）の破片だけを cannon-es で動かす。数は budget まで。
// chunkWorldBox: { min:[x,y,z], max:[x,y,z] }（ワールド座標）
export function createNearPhysics(budget, rng = Math.random) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -DEBRIS.gravity, 0) });
  world.allowSleep = false;
  world.solver.iterations = 6;
  const matGround = new CANNON.Material('ground'), matChunk = new CANNON.Material('chunk');
  world.addContactMaterial(new CANNON.ContactMaterial(matGround, matChunk, { restitution: DEBRIS.restitution, friction: 0.6 }));
  world.addContactMaterial(new CANNON.ContactMaterial(matChunk, matChunk, { restitution: 0.15, friction: 0.5 }));
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: matGround });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);

  const bodies = [];
  let limit = budget;

  return {
    bodies,
    setBudget(n) { limit = n; },
    add(box, vel) {
      if (bodies.length >= limit) return false;
      const size = [0, 1, 2].map((a) => box.max[a] - box.min[a]);
      const body = new CANNON.Body({
        mass: Math.min(200, Math.max(1, size[0] * size[1] * size[2] * 0.05)),
        shape: new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)),
        material: matChunk,
        position: new CANNON.Vec3((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2),
        velocity: new CANNON.Vec3(vel[0], vel[1], vel[2]),
        angularVelocity: new CANNON.Vec3((rng() - 0.5) * 8, (rng() - 0.5) * 8, (rng() - 0.5) * 8),
        linearDamping: 0.02, angularDamping: 0.1,
      });
      body.userData = { size, origin: [body.position.x, body.position.y, body.position.z], age: 0, rest: 0, color: box.color ?? [0.7, 0.7, 0.7] };
      world.addBody(body);
      bodies.push(body);
      return true;
    },
    // 進める。役目を終えた（飛びすぎ・古い・止まった）物体を外して、粉の DustEvent を返す。
    step(dt) {
      world.step(1 / 60, dt, 3);
      const dust = [];
      for (let i = bodies.length - 1; i >= 0; i--) {
        const b = bodies[i], u = b.userData;
        u.age += dt;
        const calm = b.velocity.length() < 1.2 && b.position.y < Math.max(...u.size) + 0.5;
        u.rest = calm ? u.rest + dt : 0;
        const dx = b.position.x - u.origin[0], dy = b.position.y - u.origin[1], dz = b.position.z - u.origin[2];
        if (u.age > DEBRIS.maxAge + 1 || u.rest > DEBRIS.maxRest || dx * dx + dy * dy + dz * dz > DEBRIS.maxTravel ** 2) {
          dust.push({ pos: [b.position.x, Math.max(0, b.position.y), b.position.z], size: Math.max(...u.size) });
          world.removeBody(b);
          bodies.splice(i, 1);
        }
      }
      return dust;
    },
  };
}
