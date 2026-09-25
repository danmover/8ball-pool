import * as THREE from 'three';
import type { TableStyle } from '@8ball/shared';

/**
 * The room the balls reflect, rendered once per table into an environment map.
 *
 * Not a photograph of a room but a lighting rig drawn for the camera overhead: one big warm
 * softbox up and to the left of the screen, which every ball shows as the same crisp glint
 * clear of its number; a cool rim low on the opposite side that edges each ball against the
 * cloth; a dim canopy that gives rail tops a sheen; and dark everywhere else, so the edges of
 * balls fall away into a clean silhouette. Built for "up-left" in landscape — the view turns
 * the map a quarter for portrait so the glint stays where the eye expects it.
 */

/** Direction on the sky, from its tilt off straight up and its heading in the x/z plane. */
function sky(tilt: number, hx: number, hz: number, distance: number): THREE.Vector3 {
  const h = Math.hypot(hx, hz) || 1;
  const s = Math.sin(tilt);
  return new THREE.Vector3((hx / h) * s, Math.cos(tilt), (hz / h) * s).multiplyScalar(distance);
}

/** A flat panel facing the centre of the room. */
function panel(scene: THREE.Scene, at: THREE.Vector3, w: number, h: number, color: THREE.Color, round = 0): void {
  const shape = new THREE.Shape();
  const r = Math.min(round, w / 2, h / 2);
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  mesh.position.copy(at);
  mesh.lookAt(0, 0, 0);
  scene.add(mesh);
}

export function buildEnvironment(renderer: THREE.WebGLRenderer, style: TableStyle): THREE.Texture {
  const scene = new THREE.Scene();
  const lamp = new THREE.Color(style.lamp);
  const room = new THREE.Color(style.room);
  const power = style.lampPower;

  // The shell: a dark room graded from a faintly lamp-warmed ceiling down to near-black below,
  // with a hint of the cloth in the bounce so balls sit in their table rather than on it.
  const shell = new THREE.SphereGeometry(8, 48, 24);
  const ceiling = room.clone().multiplyScalar(2.2).lerp(lamp, 0.05);
  const wall = room.clone().multiplyScalar(1.6);
  const ground = room.clone().multiplyScalar(0.5).lerp(new THREE.Color(style.cloth), 0.05);
  const colors: number[] = [];
  const pos = shell.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const e = pos.getY(i) / 8;
    if (e >= 0) c.copy(wall).lerp(ceiling, Math.pow(e, 0.7));
    else c.copy(wall).lerp(ground, Math.min(1, -e * 2.5));
    colors.push(c.r, c.g, c.b);
  }
  shell.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(shell, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  // Key: the lamp as a softbox, up and to the left on screen (-x, -z), about 40° off vertical.
  panel(scene, sky(0.7, -0.8, -0.6, 4), 2.3, 1.3, lamp.clone().multiplyScalar(16 * power), 0.25);
  // A small hard kicker beside it, which reads as a sparkle on glossy finishes.
  panel(scene, sky(0.36, -0.5, -0.9, 4), 0.34, 0.34, lamp.clone().multiplyScalar(22 * power), 0.17);
  // Canopy: the underside of the lamp, dim, so anything facing straight up gets a soft sheen.
  panel(scene, new THREE.Vector3(0, 4, 0), 3.4, 1.6, lamp.clone().multiplyScalar(0.9 * power), 0.8);

  // Rim: cool (or the table's neon), low on the side opposite the key. Balls pick it up right at
  // their lower-right edge, which is what separates a dark ball from the cloth under it.
  const rimColor = new THREE.Color(style.neon ?? '#6fb6ff').multiplyScalar(style.neon ? 3.2 : 2.6);
  // A band of sky 18–60° below the horizon, centred on (+0.8, +0.6): seen from overhead, that is
  // what the outer tenth of a ball reflects.
  const heading = Math.atan2(0.6, -0.8);
  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(7, 32, 8, heading - 1, 2, THREE.MathUtils.degToRad(108), THREE.MathUtils.degToRad(42)),
    new THREE.MeshBasicMaterial({ color: rimColor, side: THREE.BackSide })
  );
  scene.add(rim);

  // Wall washes all round the horizon, faint, so rail bevels always find something to catch.
  const wash = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 7, 1.1, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: lamp.clone().multiplyScalar(0.28 * power), side: THREE.BackSide })
  );
  wash.position.y = 0.6;
  scene.add(wash);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return texture;
}
