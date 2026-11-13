// A herd of elk that hangs around wherever you are driving and gets in the way.
//  - The herd picks a spot (usually on a road) and drifts there, each elk grazing around its own place in the group.
//  - When a moving car comes close they lift their heads and stand there staring at it – right where they are.
//  - Hit one and it is shoved aside (the car loses a chunk of speed), then it trots off and wanders back.
//  - Leave them behind and, a few seconds later, the herd turns up again somewhere on the road ahead.
// Directions: yaw 0 faces +z, forward = (sin yaw, cos yaw) – the same as the car.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HERD = ['bull', 'bull', 'cow', 'cow', 'cow', 'cow', 'cow', 'cow', 'cow', 'calf', 'calf', 'calf'];
const SCALE = { bull: 1.15, cow: 1, calf: 0.62 };
const SPREAD = 9;                 // m, how far from the herd's spot an elk grazes
const ROADS = [2, 3, 4];          // surface classes that count as "in the way": dirt trail, asphalt, gravel
const STARE_R = 28;               // m – a moving car this close makes them look up and freeze
const WALK = 1.4, TROT = 5, BOLT = 8;                 // m/s
const HEAD_GRAZE = 1.9, HEAD_WALK = 0.3, HEAD_UP = -0.15;   // neck angle (rad, + = down)
const ELK_R = 0.75, CAR_R = 0.95;                     // collision circles (elk's is scaled with its size)
const ELK_SHARE = 0.25;           // elk's share of the combined mass: how much of a hit the car feels
const C = { coat: 0xa9825a, dark: 0x4e3524, rump: 0xe9dcb8, antler: 0xd9c9a3, nose: 0x2b1d14 };

const rnd = (a, b) => a + Math.random() * (b - a);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- model
function tint(g, hex) {
  g = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex), a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g;
}
const box = (w, h, d, x, y, z, hex) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);
function bar(p0, p1, th, hex, th2 = th) {          // a tapered stick from p0 to p1
  _a.set(...p0); _b.set(...p1).sub(_a);
  const len = _b.length(), g = new THREE.CylinderGeometry(th2, th, len, 5);
  g.applyQuaternion(_q.setFromUnitVectors(_Y, _b.normalize())).translate(...p0.map((v, i) => (v + p1[i]) / 2));
  return tint(g, hex);
}

function buildParts(kind) {
  const body = [
    tint(new THREE.CylinderGeometry(0.33, 0.37, 1.7, 7).rotateX(Math.PI / 2).scale(1, 1.15, 1).translate(0, 1.15, 0), C.coat),
    box(0.5, 0.3, 0.5, 0, 1.42, 0.52, C.coat),                    // shoulder hump
    box(0.46, 0.5, 0.06, 0, 1.2, -0.86, C.rump),                  // pale rump patch
    box(0.1, 0.22, 0.06, 0, 1.3, -0.9, C.rump),                   // tail
  ];
  const neck = [
    bar([0, -0.05, -0.05], [0, 0.62, 0.42], 0.2, C.dark, 0.14),
    box(0.24, 0.27, 0.5, 0, 0.7, 0.62, C.dark),                   // head
    box(0.17, 0.18, 0.2, 0, 0.65, 0.94, C.nose),                  // muzzle
    box(0.07, 0.17, 0.1, 0.17, 0.87, 0.42, C.dark), box(0.07, 0.17, 0.1, -0.17, 0.87, 0.42, C.dark),   // ears
  ];
  if (kind === 'bull') for (const s of [1, -1]) {
    neck.push(bar([s * 0.09, 0.8, 0.45], [s * 0.38, 1.25, 0.2], 0.045, C.antler, 0.04),         // main beam, up and out
      bar([s * 0.38, 1.25, 0.2], [s * 0.46, 1.75, -0.25], 0.04, C.antler, 0.02),
      bar([s * 0.13, 0.87, 0.42], [s * 0.2, 1.0, 0.8], 0.03, C.antler, 0.012),                  // brow tine
      bar([s * 0.3, 1.12, 0.27], [s * 0.4, 1.4, 0.6], 0.03, C.antler, 0.012),
      bar([s * 0.38, 1.25, 0.2], [s * 0.56, 1.6, 0.4], 0.03, C.antler, 0.012),
      bar([s * 0.42, 1.5, -0.03], [s * 0.6, 1.8, 0.05], 0.028, C.antler, 0.012));
  }
  const leg = mergeGeometries([bar([0, 0, 0], [0, -0.5, 0], 0.09, C.dark, 0.06), bar([0, -0.5, 0], [0, -0.93, 0], 0.055, C.dark, 0.05)]);
  return { body: mergeGeometries(body), neck: mergeGeometries(neck), leg };
}
const LEGS = [[0.2, 0.93, 0.6], [-0.2, 0.93, 0.6], [0.2, 0.93, -0.68], [-0.2, 0.93, -0.68]];   // hip positions

export function createElk({ scene, world, car, effects }) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const parts = {};
  const group = new THREE.Group(); group.visible = false; scene.add(group);
  const elk = HERD.map(kind => {
    const P = parts[kind] ||= buildParts(kind), s = SCALE[kind] * rnd(0.94, 1.06);
    const mesh = new THREE.Group(); mesh.scale.setScalar(s); mesh.rotation.order = 'YXZ';
    const body = new THREE.Mesh(P.body, mat); body.castShadow = true;
    const neck = new THREE.Mesh(P.neck, mat); neck.castShadow = true; neck.position.set(0, 1.33, 0.72); neck.rotation.order = 'YXZ';
    const legs = LEGS.map(p => { const l = new THREE.Mesh(P.leg, mat); l.castShadow = true; l.position.set(...p); return l; });
    mesh.add(body, neck, ...legs); group.add(mesh);
    return { kind, s, r: ELK_R * s, mesh, neck, legs, x: 0, z: 0, y: 0, yaw: 0, speed: 0, sx: 0, sz: 0,
      kx: 0, kz: 0, vy: 0, air: false, roll: 0, boltT: 0, hitT: 0, idleT: 0, headUp: false, moving: false, phase: rnd(0, 6) };
  });

  // ---------------------------------------------------------------- where elk can stand
  const wet = (x, z) => world.waterLevelAt(x, z) > -Infinity;
  function inBuilding(x, z) {
    for (const b of world.buildingsNear(x, z, 2)) {
      const pts = b.pts; if (!pts) continue;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [x1, z1] = pts[j], [x2, z2] = pts[i];
        if (((z2 > z) !== (z1 > z)) && (x < (x1 - x2) * (z - z2) / (z1 - z2) + x2)) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }
  const blocked = (x, z) => !world.loadedAt(x, z) || wet(x, z) || inBuilding(x, z);
  const onRoad = (x, z) => world.loadedAt(x, z) && ROADS.includes(world.surfaceAt(x, z)) && !wet(x, z);

  // a point on some road within r of (x, z): scan random lines until one crosses a road
  function findRoad(x, z, r) {
    for (let k = 0; k < 14; k++) {
      const a = rnd(0, Math.PI * 2), d = Math.sqrt(Math.random()) * r, b = rnd(0, Math.PI * 2);
      const px = x + Math.sin(a) * d, pz = z + Math.cos(a) * d, ux = Math.sin(b), uz = Math.cos(b);
      for (let s = 0; s < r; s += 3) if (onRoad(px + ux * s, pz + uz * s)) return [px + ux * s, pz + uz * s];
    }
    return null;
  }
  // follow the road the car is on for `dist` metres: where it will be if it keeps going
  function traceRoad(x, z, fx, fz, dist) {
    if (!onRoad(x, z)) return null;
    let h = Math.atan2(fx, fz), run = 0;
    trace: while (run < dist) {
      for (const dh of [0, 0.12, -0.12, 0.25, -0.25, 0.45, -0.45, 0.7, -0.7]) {
        const nx = x + Math.sin(h + dh) * 5, nz = z + Math.cos(h + dh) * 5;
        if (onRoad(nx, nz)) { x = nx; z = nz; h += dh; run += 5; continue trace; }
      }
      break;
    }
    return run >= Math.min(dist, 60) ? [x, z] : null;
  }

  // ---------------------------------------------------------------- the herd
  const goal = { x: 0, z: 0 };
  let placed = false, goalT = 0, awayT = 0, awayWait = 4, retryT = 0, bump = 0;
  function newSlot(e) { const a = rnd(0, Math.PI * 2), d = Math.sqrt(Math.random()) * SPREAD; e.sx = Math.sin(a) * d; e.sz = Math.cos(a) * d; }

  // put the whole herd down on the road ahead of the car
  function relocate(cs) {
    let fx, fz;
    if (cs > 5) { fx = car.vel.x / cs; fz = car.vel.z / cs; }
    else { _a.set(0, 0, 1).applyQuaternion(car.quat); const l = Math.hypot(_a.x, _a.z) || 1; fx = _a.x / l; fz = _a.z / l; }
    const D = placed ? clamp(cs * 6, 220, 450) : 90, cx = car.pos.x, cz = car.pos.z;
    let p = traceRoad(cx, cz, fx, fz, D) || findRoad(cx + fx * D, cz + fz * D, 90);
    if (!p && !blocked(cx + fx * D, cz + fz * D)) p = [cx + fx * D, cz + fz * D];
    if (!p || Math.hypot(p[0] - cx, p[1] - cz) < 50) return;          // nowhere good yet (tile still streaming in?): try again soon
    goal.x = p[0]; goal.z = p[1]; placed = true; goalT = rnd(15, 30); awayT = 0; awayWait = rnd(4, 12);
    for (const e of elk) {
      newSlot(e);
      if (blocked(goal.x + e.sx, goal.z + e.sz)) e.sx = e.sz = 0;
      e.x = goal.x + e.sx; e.z = goal.z + e.sz; e.y = world.heightAt(e.x, e.z); e.yaw = rnd(0, Math.PI * 2);
      e.speed = e.kx = e.kz = e.vy = e.roll = e.boltT = e.hitT = 0; e.air = e.moving = false; e.idleT = rnd(0, 8); e.headUp = Math.random() < 0.3;
      e.neck.rotation.x = e.headUp ? HEAD_WALK : HEAD_GRAZE;
    }
  }
  // amble to a new spot nearby – mostly onto a road, and drifting toward the car
  function wander(dg) {
    let bx = goal.x, bz = goal.z;
    if (dg < 400 && dg > 1) { const k = Math.min(30, dg) / dg; bx += (car.pos.x - goal.x) * k; bz += (car.pos.z - goal.z) * k; }
    let p = Math.random() < 0.75 ? findRoad(bx, bz, 45) : null;
    if (!p) { const a = rnd(0, Math.PI * 2), d = rnd(5, 35); p = [bx + Math.sin(a) * d, bz + Math.cos(a) * d]; if (blocked(p[0], p[1])) return; }
    goal.x = p[0]; goal.z = p[1];
    for (const e of elk) newSlot(e);
  }

  // car against elk; runs every physics step, right after car.step
  function collide() {
    if (!placed || Math.abs(car.pos.x - goal.x) > 150 || Math.abs(car.pos.z - goal.z) > 150) return;
    for (const zo of [-1.4, 0, 1.4]) {
      _a.set(0, 0, zo).applyQuaternion(car.quat).add(car.pos);
      for (const e of elk) {
        const dx = _a.x - e.x, dz = _a.z - e.z, min = CAR_R + e.r;
        if (Math.abs(dx) > min || Math.abs(dz) > min || _a.y - e.y > 1.9 * e.s || _a.y - e.y < -1) continue;   // flying over / under a knocked one
        const d = Math.hypot(dx, dz); if (d >= min || d < 1e-4) continue;
        const nx = dx / d, nz = dz / d, pen = min - d;                  // n points from the elk to the car
        car.pos.x += nx * pen * 0.35; car.pos.z += nz * pen * 0.35; _a.x += nx * pen * 0.35; _a.z += nz * pen * 0.35;
        e.x -= nx * pen * 0.65; e.z -= nz * pen * 0.65;
        const vn = (car.vel.x - e.kx) * nx + (car.vel.z - e.kz) * nz;
        if (vn >= 0 || e.hitT > 0) continue;                           // one knock per hit, then it is just pushed along
        car.vel.x -= nx * vn * ELK_SHARE * 1.3; car.vel.z -= nz * vn * ELK_SHARE * 1.3;
        if (vn < -2) {
          car.vel.multiplyScalar(0.92);
          _b.set(0, 0, 1).applyQuaternion(car.quat);
          car.ang.y += Math.sign(zo) * (nx * _b.z - nz * _b.x) * vn * 0.02;
          const k = Math.min(-vn * 0.8, 16);                            // the elk is shoved off, with a little hop on a hard hit
          e.kx = -nx * k; e.kz = -nz * k;
          if (vn < -5 && !e.air) { e.air = true; e.vy = Math.min(6.5, -vn * 0.22); }
          e.boltT = rnd(3, 5); e.hitT = 0.4;
          if (vn < -6) car.drifting = false;
          if (-vn * 0.5 > bump) { bump = -vn * 0.5; effects?.emit(_b.set(e.x, e.y + 0.6, e.z), car.vel, world.surfaceAt(e.x, e.z), 1); }
        }
      }
    }
  }

  // once a frame: herd decisions, each elk's walking, and the models
  function update(dt) {
    if (bump) { car.hit = Math.max(car.hit, bump); bump = 0; }            // camera shake / sound for the hit
    const cx = car.pos.x, cz = car.pos.z, cs = Math.hypot(car.vel.x, car.vel.z);
    const gx = goal.x - cx, gz = goal.z - cz, dg = Math.hypot(gx, gz);
    awayT = placed && dg > 160 && cs > 8 && car.vel.x * gx + car.vel.z * gz < 0 ? awayT + dt : 0;    // driven past and leaving
    retryT -= dt;
    if (retryT <= 0 && (!placed || dg > 500 || awayT > awayWait || !world.loadedAt(goal.x, goal.z))) { retryT = 0.5; relocate(cs); }
    group.visible = placed;
    if (!placed) return;
    goalT -= dt;
    if (goalT <= 0) { goalT = rnd(18, 38); wander(dg); }

    for (const e of elk) {
      e.hitT -= dt;
      // shoved by the car: slide (and maybe hop) until it stops
      if (e.air || e.kx * e.kx + e.kz * e.kz > 0.04) {
        const nx = e.x + e.kx * dt, nz = e.z + e.kz * dt;
        if (blocked(nx, nz) && !blocked(e.x, e.z)) e.kx = e.kz = 0; else { e.x = nx; e.z = nz; }
        if (!e.air) { const f = Math.exp(-3 * dt); e.kx *= f; e.kz *= f; }
      } else e.kx = e.kz = 0;
      const ground = world.heightAt(e.x, e.z);
      if (e.air) {
        e.vy -= 22 * dt; e.y += e.vy * dt; e.roll += Math.sign(e.kx * Math.cos(e.yaw) - e.kz * Math.sin(e.yaw) || 1) * 5 * dt;
        if (e.y <= ground && e.vy < 0) { e.air = false; e.vy = 0; }
      }
      if (!e.air) { e.y = ground; e.roll = wrap(e.roll); e.roll *= Math.exp(-8 * dt); }

      const dx = goal.x + e.sx - e.x, dz = goal.z + e.sz - e.z, d = Math.hypot(dx, dz);
      const tcx = cx - e.x, tcz = cz - e.z, cd = Math.hypot(tcx, tcz);
      let want = 0, wantYaw = e.yaw, head = HEAD_WALK, look = 0, turn = 2.2;
      if (e.boltT > 0) {                                                 // just been hit: trot away from the car
        e.boltT -= dt; want = BOLT; wantYaw = Math.atan2(-tcx, -tcz); head = HEAD_UP; turn = 5; e.moving = true;
      } else if (cd < STARE_R && cs > 4) {                               // car coming: stand and stare
        head = HEAD_UP; look = clamp(wrap(Math.atan2(tcx, tcz) - e.yaw), -1.4, 1.4);
      } else if (d > (e.moving ? 1 : 3.5)) {                             // walk to its place in the herd
        want = d > 45 ? TROT : WALK; wantYaw = Math.atan2(dx, dz); e.moving = true;
      } else {                                                           // graze, now and then look up or shuffle along
        e.moving = false; head = e.headUp ? HEAD_WALK : HEAD_GRAZE;
        if ((e.idleT -= dt) <= 0) { e.idleT = rnd(4, 14); e.headUp = Math.random() < 0.3; if (Math.random() < 0.5) newSlot(e); }
      }
      const dy = wrap(wantYaw - e.yaw);
      e.yaw += clamp(dy, -turn * dt, turn * dt);
      e.speed += (want * (Math.abs(dy) < 1.2 ? 1 : 0.3) - e.speed) * Math.min(1, dt * 3);
      if (e.speed > 0.05 && !e.air) {
        const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
        if (blocked(e.x + fx * 1.5, e.z + fz * 1.5) && !blocked(e.x, e.z)) {      // pond, wall or the map edge ahead
          e.speed = 0;
          if (e.boltT > 0) e.yaw += 3 * dt; else newSlot(e);
        } else { e.x += fx * e.speed * dt; e.z += fz * e.speed * dt; }
      }
      world.treesNear(e.x, e.z, 2.5, (tx, tz, tr) => {                   // walk round tree trunks
        const ox = e.x - tx, oz = e.z - tz, od = Math.hypot(ox, oz), min = tr + 0.45 * e.s;
        if (od < min && od > 1e-4) { e.x += ox / od * (min - od); e.z += oz / od * (min - od); }
      });

      e.phase += (e.air ? 14 : e.speed * 2.6 / e.s) * dt;
      const amp = e.air ? 0.6 : Math.min(0.55, e.speed * 0.4);
      e.legs.forEach((l, i) => { l.rotation.x = Math.sin(e.phase + (i === 0 || i === 3 ? 0 : Math.PI)) * amp; });
      const kn = Math.min(1, dt * 4);
      e.neck.rotation.x += (head - e.neck.rotation.x) * kn; e.neck.rotation.y += (look - e.neck.rotation.y) * kn;
      e.mesh.position.set(e.x, e.y, e.z); e.mesh.rotation.y = e.yaw; e.mesh.rotation.z = e.roll;
    }
    // keep them off each other
    for (let i = 0; i < elk.length; i++) for (let j = i + 1; j < elk.length; j++) {
      const a = elk[i], b = elk[j], ox = a.x - b.x, oz = a.z - b.z, od = Math.hypot(ox, oz), min = (a.r + b.r) * 0.95;
      if (od < min && od > 1e-4) { const p = (min - od) / od * 0.5; a.x += ox * p; a.z += oz * p; b.x -= ox * p; b.z -= oz * p; }
    }
  }

  return { elk, goal, group, collide, update, relocate: () => relocate(Math.hypot(car.vel.x, car.vel.z)), get placed() { return placed; } };
}
