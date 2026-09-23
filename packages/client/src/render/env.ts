import * as THREE from 'three';

/**
 * The room the balls reflect.
 *
 * A dark box with the table lamp's glowing panels overhead, rendered once into an environment
 * map. It is why a ball shows a crisp rectangular highlight on top — the shape of the lamp above
 * it — rather than the anonymous white dot of a generic light.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer, lamp: string, room: string): THREE.Texture {
  const scene = new THREE.Scene();
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(12, 6, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(room).multiplyScalar(1.6).offsetHSL(0, 0, 0.04), side: THREE.BackSide })
  );
  scene.add(walls);

  const lampColor = new THREE.Color(lamp);
  const panel = new THREE.MeshBasicMaterial({ color: lampColor.clone().multiplyScalar(9) });
  // Three shades in a row over the table, as in any hall.
  for (const x of [-1.1, 0, 1.1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.34), panel);
    p.position.set(x, 2.2, 0);
    p.rotation.x = Math.PI / 2;
    scene.add(p);
  }
  // A soft wash from the walls, so the undersides of balls aren't pitch black.
  const wash = new THREE.MeshBasicMaterial({ color: lampColor.clone().multiplyScalar(0.35) });
  for (const [x, z, ry] of [
    [0, -4.9, 0],
    [0, 4.9, Math.PI],
    [-5.9, 0, Math.PI / 2],
    [5.9, 0, -Math.PI / 2],
  ] as const) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.2), wash);
    w.position.set(x, 0.8, z);
    w.rotation.y = ry;
    scene.add(w);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, 0.035).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return texture;
}
