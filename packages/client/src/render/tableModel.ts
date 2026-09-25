import * as THREE from 'three';
import { CORNER_MOUTH, CUSHIONS, POCKETS, SIDE_MOUTH, TABLE_LENGTH, type TableStyle } from '@8ball/shared';
import { CUSHION_DEPTH, CUSHION_HEIGHT, HALF_L, HALF_W, RAIL_HEIGHT, RAIL_WIDTH, S, toWorldX, toWorldZ } from './coords';
import { paintCloth, paintRail, paintGlow, shadeHex } from './textures';

/**
 * The table, built from the same geometry the physics uses.
 *
 * Cushion noses are the physics' cushion runs, pocket openings are its mouths, so a ball can
 * only ever be seen to go in where it actually went in. Everything else — rails, rims, sights,
 * the floor — is dressing, drawn from the table's style.
 */

export interface PocketHole {
  index: number;
  x: number;
  z: number;
  radius: number;
}

/** Where each pocket's hole sits in world space. The drop animation aims for these. */
export const POCKET_HOLES: PocketHole[] = POCKETS.map((p) => {
  const corner = p.kind === 'corner';
  const radius = corner ? 0.06 : 0.054;
  // Set back so the hole's edge just meets the mouth: a ball is seen over the hole only once
  // the physics has actually taken it.
  const back = radius + 0.002;
  return {
    index: p.index,
    x: toWorldX(p.mid.x) + p.out.x * back,
    z: toWorldZ(p.mid.y) + p.out.y * back,
    radius,
  };
});

/** Shape space is (worldX, -worldZ); geometries are rotated flat afterwards. */
function v2(x: number, z: number): THREE.Vector2 {
  return new THREE.Vector2(x, -z);
}

function flatten<T extends THREE.BufferGeometry>(g: T): T {
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * The rails' inner boundary: the rectangle behind the cushions with a round notch at each
 * pocket. It is star-shaped from the centre, so it can be traced by casting rays outward and
 * taking the furthest exit — no polygon booleans required.
 */
function innerBoundary(notches: PocketHole[], pad: number): THREE.Vector2[] {
  const hx = HALF_L + CUSHION_DEPTH;
  const hz = HALF_W + CUSHION_DEPTH;
  const out: THREE.Vector2[] = [];
  const N = 900;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const rectExit = Math.min(Math.abs(dx) > 1e-9 ? hx / Math.abs(dx) : Infinity, Math.abs(dz) > 1e-9 ? hz / Math.abs(dz) : Infinity);
    let reach = rectExit;
    for (const n of notches) {
      const r = n.radius + pad;
      const b = dx * n.x + dz * n.z;
      const c = n.x * n.x + n.z * n.z - r * r;
      const disc = b * b - c;
      if (disc <= 0) continue;
      const t1 = b - Math.sqrt(disc);
      const t2 = b + Math.sqrt(disc);
      if (t1 <= rectExit + 1e-6 && t2 > reach) reach = t2;
    }
    out.push(v2(dx * reach, dz * reach));
  }
  return out;
}

function roundedRect(hx: number, hz: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-hx + r, -hz);
  s.lineTo(hx - r, -hz);
  s.quadraticCurveTo(hx, -hz, hx, -hz + r);
  s.lineTo(hx, hz - r);
  s.quadraticCurveTo(hx, hz, hx - r, hz);
  s.lineTo(-hx + r, hz);
  s.quadraticCurveTo(-hx, hz, -hx, hz - r);
  s.lineTo(-hx, -hz + r);
  s.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
  return s;
}

export interface TableModel {
  group: THREE.Group;
  /** Objects whose colours change with the style. */
  dispose(): void;
}

export function buildTable(style: TableStyle, quality: 'low' | 'medium' | 'high'): TableModel {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // ---------------------------------------------------------------- materials
  const cloth = paintCloth(quality === 'low' ? 256 : 512);
  keep(cloth.map);
  keep(cloth.bump);
  cloth.map.repeat.set(6, 3.5);
  cloth.bump.repeat.set(6, 3.5);
  const clothMat = keep(
    new THREE.MeshStandardMaterial({
      color: style.cloth,
      map: cloth.map,
      bumpMap: cloth.bump,
      bumpScale: 0.0006,
      roughness: 0.92,
      metalness: 0,
      envMapIntensity: 0.25,
    })
  );
  const cushionMat = keep(
    new THREE.MeshStandardMaterial({
      color: style.cushion,
      map: cloth.map,
      roughness: 0.9,
      metalness: 0,
      envMapIntensity: 0.25,
    })
  );
  const railTex = keep(paintRail(style.rail, style.grain, style.railFinish));
  railTex.repeat.set(1.6, 1);
  const railMat = keep(
    new THREE.MeshPhysicalMaterial({
      // Wood sits closer to the lamp than the cloth does; take the edge off so walnut reads as walnut.
      color: style.railFinish === 'metal' ? '#ffffff' : '#a8a8a8',
      map: railTex,
      roughness: style.railFinish === 'metal' ? 0.35 : 0.42,
      metalness: style.railFinish === 'metal' ? 0.85 : 0,
      clearcoat: style.railFinish === 'metal' ? 0.2 : 0.85,
      clearcoatRoughness: 0.18,
      envMapIntensity: 0.9,
    })
  );
  const trimMat = keep(
    new THREE.MeshStandardMaterial({ color: style.trim, metalness: 1, roughness: 0.28, envMapIntensity: 1.2 })
  );
  const pocketMat = keep(new THREE.MeshStandardMaterial({ color: '#070707', roughness: 0.95, side: THREE.DoubleSide }));
  const sightMat = keep(
    new THREE.MeshStandardMaterial({
      color: style.sight,
      roughness: 0.25,
      metalness: 0.2,
      emissive: style.sight,
      emissiveIntensity: 0.12,
    })
  );
  const bodyMat = keep(
    new THREE.MeshStandardMaterial({ color: shadeHex(style.rail, -0.45), roughness: 0.6, metalness: style.railFinish === 'metal' ? 0.6 : 0 })
  );

  // ---------------------------------------------------------------- bed
  const bedHalfX = HALF_L + CUSHION_DEPTH + RAIL_WIDTH * 0.95;
  const bedHalfZ = HALF_W + CUSHION_DEPTH + RAIL_WIDTH * 0.95;
  const bed = new THREE.Shape();
  bed.moveTo(-bedHalfX, -bedHalfZ);
  bed.lineTo(bedHalfX, -bedHalfZ);
  bed.lineTo(bedHalfX, bedHalfZ);
  bed.lineTo(-bedHalfX, bedHalfZ);
  bed.lineTo(-bedHalfX, -bedHalfZ);
  for (const hole of POCKET_HOLES) {
    const p = new THREE.Path();
    p.absarc(hole.x, -hole.z, hole.radius, 0, Math.PI * 2, true);
    bed.holes.push(p);
  }
  const bedGeo = keep(flatten(new THREE.ShapeGeometry(bed, 48)));
  // ShapeGeometry's UVs are raw shape coordinates; bring them into 0..1 across the bed.
  const uv = bedGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) + bedHalfX) / (bedHalfX * 2), (uv.getY(i) + bedHalfZ) / (bedHalfZ * 2));
  }
  const bedMesh = new THREE.Mesh(bedGeo, clothMat);
  bedMesh.receiveShadow = true;
  group.add(bedMesh);

  // Head string and spots, faintly chalked on.
  const lineMat = keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.08, depthWrite: false }));
  const headX = toWorldX(TABLE_LENGTH * 0.25);
  const headLine = new THREE.Mesh(keep(flatten(new THREE.PlaneGeometry(0.0022, HALF_W * 2))), lineMat);
  headLine.position.set(headX, 0.0004, 0);
  group.add(headLine);
  for (const x of [headX, toWorldX(TABLE_LENGTH * 0.72)]) {
    const spot = new THREE.Mesh(keep(flatten(new THREE.CircleGeometry(0.0055, 16))), lineMat);
    spot.position.set(x, 0.0005, 0);
    group.add(spot);
  }

  // ---------------------------------------------------------------- pocket cups
  for (const hole of POCKET_HOLES) {
    const cup = new THREE.Mesh(keep(new THREE.CylinderGeometry(hole.radius, hole.radius * 0.82, 0.16, 32, 1, true)), pocketMat);
    cup.position.set(hole.x, -0.08, hole.z);
    group.add(cup);
    const floor = new THREE.Mesh(keep(flatten(new THREE.CircleGeometry(hole.radius * 0.82, 32))), pocketMat);
    floor.position.set(hole.x, -0.159, hole.z);
    group.add(floor);
  }

  // ---------------------------------------------------------------- cushions
  const cornerFacing = CUSHION_DEPTH * 0.95;
  const sideFacing = CUSHION_DEPTH * 0.22;
  const mid = TABLE_LENGTH / 2;
  for (const c of CUSHIONS) {
    const out = c.side; // -1: toward -Z / -X; +1: toward +Z / +X
    const endKind = (along: number): 'corner' | 'side' =>
      c.axis === 'v' || along === CORNER_MOUTH || along === TABLE_LENGTH - CORNER_MOUTH ? 'corner' : Math.abs(along - mid) <= SIDE_MOUTH + 1 ? 'side' : 'corner';
    const facing = (along: number) => (endKind(along) === 'corner' ? cornerFacing : sideFacing);
    const pts: THREE.Vector2[] = [];
    const nose = c.base * S;
    const toW = (along: number, depth: number): THREE.Vector2 => {
      if (c.axis === 'h') return v2(along * S - HALF_L, nose - HALF_W + out * depth);
      return v2(nose - HALF_L + out * depth, along * S - HALF_W);
    };
    const a0 = c.from;
    const a1 = c.to;
    // Nose, with the ends slightly rounded where the physics puts its jaw circles.
    pts.push(toW(a0 + 4, 0));
    pts.push(toW(a1 - 4, 0));
    pts.push(toW(a1, 0.004));
    pts.push(toW(a1 + facing(a1) / S, CUSHION_DEPTH + 0.002));
    pts.push(toW(a0 - facing(a0) / S, CUSHION_DEPTH + 0.002));
    pts.push(toW(a0, 0.004));
    const shape = new THREE.Shape(pts);
    const geo = keep(
      flatten(
        new THREE.ExtrudeGeometry(shape, {
          depth: CUSHION_HEIGHT - 0.004,
          bevelEnabled: true,
          bevelThickness: 0.004,
          bevelSize: 0.003,
          bevelSegments: quality === 'low' ? 1 : 3,
          curveSegments: 4,
        })
      )
    );
    // Planar UVs across the cushion top so the cloth weave continues onto it.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uvs[i * 2] = (pos.getX(i) + bedHalfX) / (bedHalfX * 2);
      uvs[i * 2 + 1] = (pos.getZ(i) + bedHalfZ) / (bedHalfZ * 2) + pos.getY(i) * 2;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    const mesh = new THREE.Mesh(geo, cushionMat);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---------------------------------------------------------------- rails
  const outerX = HALF_L + CUSHION_DEPTH + RAIL_WIDTH;
  const outerZ = HALF_W + CUSHION_DEPTH + RAIL_WIDTH;
  const railShape = roundedRect(outerX, outerZ, 0.04);
  const holePath = new THREE.Path(innerBoundary(POCKET_HOLES, 0).reverse());
  railShape.holes.push(holePath);
  const railGeo = keep(
    flatten(
      new THREE.ExtrudeGeometry(railShape, {
        depth: RAIL_HEIGHT,
        bevelEnabled: true,
        bevelThickness: 0.008,
        bevelSize: 0.007,
        bevelSegments: quality === 'low' ? 2 : 5,
        curveSegments: 12,
      })
    )
  );
  // Wrap the grain around the frame: u along the longer axis of whichever rail a vertex is on.
  {
    const pos = railGeo.attributes.position as THREE.BufferAttribute;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const onLong = Math.abs(z) - HALF_W > Math.abs(x) - HALF_L;
      uvs[i * 2] = onLong ? x * 0.9 : z * 0.9;
      uvs[i * 2 + 1] = onLong ? z * 3 : x * 3;
    }
    railGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  const rail = new THREE.Mesh(railGeo, railMat);
  rail.position.y = 0;
  rail.receiveShadow = true;
  group.add(rail);

  // The table's skirt below the rails, for the tilted camera. Hollow, so it never covers the
  // pocket holes when looked at from above.
  const skirt = 0.02;
  for (const [w, d, x, z] of [
    [outerX * 2 - 0.02, skirt, 0, outerZ - 0.01 - skirt / 2],
    [outerX * 2 - 0.02, skirt, 0, -(outerZ - 0.01 - skirt / 2)],
    [skirt, outerZ * 2 - 0.02, outerX - 0.01 - skirt / 2, 0],
    [skirt, outerZ * 2 - 0.02, -(outerX - 0.01 - skirt / 2), 0],
  ] as const) {
    const wall = new THREE.Mesh(keep(new THREE.BoxGeometry(w, 0.16, d)), bodyMat);
    wall.position.set(x, -0.085, z);
    group.add(wall);
  }

  // ---------------------------------------------------------------- pocket rims
  const rimInner = HALF_L + CUSHION_DEPTH;
  const rimInnerZ = HALF_W + CUSHION_DEPTH;
  for (const hole of POCKET_HOLES) {
    const r = hole.radius + 0.006;
    const pts: THREE.Vector3[] = [];
    const N = 96;
    // Only the part of the circle that lies within the rail.
    const outside: boolean[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = hole.x + Math.cos(a) * r;
      const z = hole.z + Math.sin(a) * r;
      outside.push(Math.abs(x) > rimInner - 0.001 || Math.abs(z) > rimInnerZ - 0.001);
    }
    let start = outside.findIndex((o, i) => o && !outside[(i - 1 + N) % N]);
    if (start === -1) start = 0;
    for (let k = 0; k < N; k++) {
      const i = (start + k) % N;
      if (!outside[i]) break;
      const a = (i / N) * Math.PI * 2;
      pts.push(new THREE.Vector3(hole.x + Math.cos(a) * r, RAIL_HEIGHT + 0.006, hole.z + Math.sin(a) * r));
    }
    if (pts.length < 3) continue;
    const curve = new THREE.CatmullRomCurve3(pts);
    const rim = new THREE.Mesh(keep(new THREE.TubeGeometry(curve, pts.length * 2, 0.0075, 10, false)), trimMat);
    group.add(rim);
  }

  // ---------------------------------------------------------------- sights
  const sightGeo = keep(flatten(new THREE.CircleGeometry(0.0085, 4)));
  const inset = CUSHION_DEPTH + RAIL_WIDTH * 0.5;
  const along = [0.25, 0.5, 0.75];
  for (const f of along) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const d = new THREE.Mesh(sightGeo, sightMat);
        d.position.set(sx * HALF_L * f, RAIL_HEIGHT + 0.0085, sz * (HALF_W + inset));
        d.scale.set(1, 1, 0.7);
        group.add(d);
      }
    }
    for (const sx of [-1, 1]) {
      const d = new THREE.Mesh(sightGeo, sightMat);
      d.position.set(sx * (HALF_L + inset), RAIL_HEIGHT + 0.0085, (f - 0.5) * 2 * HALF_W);
      d.rotation.y = Math.PI / 2;
      d.scale.set(1, 1, 0.7);
      group.add(d);
    }
  }

  // The floor and the table's shadow on it belong to the backdrop (backdrop.ts).
  const glowTex = keep(paintGlow(128));

  if (style.neon) {
    const neonMat = keep(new THREE.MeshBasicMaterial({ color: style.neon, toneMapped: false }));
    const strip = new THREE.Mesh(keep(new THREE.BoxGeometry(outerX * 2 + 0.01, 0.01, outerZ * 2 + 0.01)), neonMat);
    strip.position.y = -0.02;
    group.add(strip);
    const pool = new THREE.Mesh(
      keep(flatten(new THREE.PlaneGeometry(outerX * 3.4, outerZ * 4))),
      keep(new THREE.MeshBasicMaterial({ color: style.neon, alphaMap: glowTex, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }))
    );
    pool.position.y = -0.59;
    group.add(pool);
  }

  return {
    group,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
