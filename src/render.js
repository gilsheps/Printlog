// three.js rendering: off-screen thumbnails and the interactive viewer
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function buildGroup(parts) {
  const group = new THREE.Group();
  for (const p of parts) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color), roughness: 0.55, metalness: 0.05, flatShading: false, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(g, mat));
  }
  // 3MF/STL are Z-up; three is Y-up
  group.rotation.x = -Math.PI / 2;
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // sit on the plate, centred
  group.position.set(-center.x, -box.min.y, -center.z);
  group.updateMatrixWorld(true);
  // dims in model space (x, y, z) = (three x, three z, three y)
  const dims = { x: size.x, y: size.z, z: size.y };
  return { group, dims, radius: size.length() / 2 || 1, height: size.y };
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 1.3));
  const d1 = new THREE.DirectionalLight(0xffffff, 1.6);
  d1.position.set(1, 1.6, 1.2);
  scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.5);
  d2.position.set(-1.2, 0.6, -1);
  scene.add(d2);
}

function frameCamera(camera, radius, height, dir = new THREE.Vector3(1, 0.8, 1.15)) {
  const dist = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.08;
  const target = new THREE.Vector3(0, height / 2, 0);
  camera.position.copy(target).add(dir.normalize().multiplyScalar(dist));
  camera.near = dist / 100;
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  camera.lookAt(target);
  return target;
}

// Bambu Studio lays plates out in a grid: columns = ceil-ish sqrt(n), gap = 1/5 of the bed
export function bedLayout(parts, plateCount, bedW = 256, bedD = 256) {
  const n = Math.max(plateCount || 1, ...parts.map((p) => p.plate || 1));
  const v = Math.sqrt(n), r = Math.round(v);
  const cols = v > r ? r + 1 : r;
  const beds = new Map();
  for (let id = 1; id <= n; id++) {
    const i = id - 1;
    beds.set(id, { id, x: (i % cols) * bedW * 1.2, y: -Math.floor(i / cols) * bedD * 1.2, w: bedW, d: bedD });
  }
  // sanity check: every plate's objects must sit on (or near) its bed
  let ok = true;
  for (const p of parts) {
    const b = beds.get(p.plate || 1);
    const a = p.positions;
    for (let k = 0; k < a.length && ok; k += 3 * 97) {
      if (a[k] < b.x - 40 || a[k] > b.x + b.w + 40 || a[k + 1] < b.y - 40 || a[k + 1] > b.y + b.d + 40) ok = false;
    }
    if (!ok) break;
  }
  return { ok, beds };
}

function disposeGroup(group) {
  group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
}

let thumbRenderer = null;
export async function renderThumbnail(parts, size = 360) {
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setPixelRatio(1);
    thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  thumbRenderer.setSize(size, size, false);
  const scene = new THREE.Scene();
  addLights(scene);
  const { group, dims, radius, height } = buildGroup(parts);
  scene.add(group);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10000);
  frameCamera(camera, radius, height);
  thumbRenderer.setClearColor(0x000000, 0);
  thumbRenderer.render(scene, camera);
  const blob = await new Promise((res) => thumbRenderer.domElement.toBlob(res, 'image/png'));
  disposeGroup(group);
  return { blob, dims };
}

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    addLights(this.scene);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.plate = this.makePlate(256);
    this.scene.add(this.plate);
    this.group = null;
    this.wire = false;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }
  makePlate(sz) {
    const g = new THREE.Group();
    const css = getComputedStyle(document.documentElement);
    const gridMajor = new THREE.Color(css.getPropertyValue('--plate-major').trim() || '#555');
    const gridMinor = new THREE.Color(css.getPropertyValue('--plate-minor').trim() || '#333');
    const grid = new THREE.GridHelper(sz, sz / 16, gridMajor, gridMinor);
    grid.material.transparent = true;
    grid.material.opacity = 0.7;
    g.add(grid);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), new THREE.MeshBasicMaterial({ color: css.getPropertyValue('--plate-fill').trim() || '#222', transparent: true, opacity: 0.55 }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.05;
    g.add(plane);
    return g;
  }
  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  // Bambu-style: objects stay where they are on the bed; one bed per plate
  showOnBeds(parts, beds) {
    if (this.group) { this.scene.remove(this.group); disposeGroup(this.group); }
    const group = new THREE.Group();
    const objs = new THREE.Group();
    for (const p of parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      g.computeVertexNormals();
      objs.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color), roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide })));
    }
    objs.rotation.x = -Math.PI / 2; // model (x, y, z) -> three (x, z, -y)
    group.add(objs);
    const css = getComputedStyle(document.documentElement);
    const major = new THREE.Color(css.getPropertyValue('--plate-major').trim() || '#555');
    const minor = new THREE.Color(css.getPropertyValue('--plate-minor').trim() || '#333');
    const fill = css.getPropertyValue('--plate-fill').trim() || '#222';
    const all = new THREE.Box3();
    for (const b of beds) {
      const cx = b.x + b.w / 2, cz = -(b.y + b.d / 2);
      const grid = new THREE.GridHelper(Math.max(b.w, b.d), Math.round(Math.max(b.w, b.d) / 16), major, minor);
      grid.material.transparent = true; grid.material.opacity = 0.7;
      grid.scale.set(b.w / Math.max(b.w, b.d), 1, b.d / Math.max(b.w, b.d));
      grid.position.set(cx, 0, cz);
      group.add(grid);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.d), new THREE.MeshBasicMaterial({ color: fill, transparent: true, opacity: 0.6 }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(cx, -0.05, cz);
      group.add(plane);
      all.expandByPoint(new THREE.Vector3(b.x, 0, -b.y)).expandByPoint(new THREE.Vector3(b.x + b.w, 0, -(b.y + b.d)));
    }
    group.updateMatrixWorld(true);
    const ob = new THREE.Box3().setFromObject(objs);
    const osize = ob.isEmpty() ? new THREE.Vector3() : ob.getSize(new THREE.Vector3());
    if (!ob.isEmpty()) all.union(ob);
    const c = all.getCenter(new THREE.Vector3());
    group.position.set(-c.x, 0, -c.z);
    this.group = group;
    this.scene.add(group);
    this.plate.visible = false;
    const size = all.getSize(new THREE.Vector3());
    this.radius = Math.max(size.x, size.z) * 0.62 || 100;
    this.height = Math.min(osize.y, this.radius);
    this.setWire(this.wire);
    this.resetView();
    return { x: osize.x, y: osize.z, z: osize.y };
  }
  show(parts) {
    this.plate.visible = true;
    if (this.group) { this.scene.remove(this.group); disposeGroup(this.group); }
    const { group, dims, radius, height } = buildGroup(parts);
    this.group = group;
    this.radius = radius;
    this.height = height;
    this.scene.add(group);
    this.setWire(this.wire);
    // show plate only when the model fits a printer-ish scale
    this.plate.visible = radius < 400;
    const s = Math.max(1, Math.ceil(Math.max(dims.x, dims.y) / 256));
    this.plate.scale.setScalar(s);
    this.resetView();
    return dims;
  }
  resetView() {
    if (!this.group) return;
    const t = frameCamera(this.camera, this.radius, this.height);
    this.controls.target.copy(t);
    this.controls.update();
  }
  setWire(on) {
    this.wire = on;
    if (this.group) this.group.traverse((o) => { if (o.material) o.material.wireframe = on; });
  }
  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    if (this.group) disposeGroup(this.group);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
