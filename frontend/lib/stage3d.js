// 3D relief view of one inspection. The photo becomes a surface; the model's anomaly scores raise it,
// so defects stand up and glow. It's a relief made from ONE photo, not a scan of the real part's shape.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { animate, createTimeline, stagger } from "animejs";

const SEG = 127;                       // plane is (SEG+1) x (SEG+1) vertices
const BASE_RELIEF = 0.05;              // photo brightness gives the surface a little texture
const DEFECT_LIFT = 0.34;              // how far the worst areas rise
const SIGNAL = 0xe0b341, REJECT = 0xc2571a;   // template palette: amber scan, --defect
const CAMERA_HOME = new THREE.Vector3(0, -2.55, 2.25);
const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

function loadImage(blob) {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error("Could not read the photo for the 3D view."));
    img.src = URL.createObjectURL(blob);
  });
}

// score grid is grid_size x grid_size, row 0 at the top, values in threshold units (1.0 = the line)
function sampleGrid(grid, n, u, v) {
  const x = Math.min(n - 1, Math.max(0, u * (n - 1))), y = Math.min(n - 1, Math.max(0, v * (n - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
  const fx = x - x0, fy = y - y0, g = (r, c) => grid[r * n + c];
  return (g(y0, x0) * (1 - fx) + g(y0, x1) * fx) * (1 - fy) + (g(y1, x0) * (1 - fx) + g(y1, x1) * fx) * fy;
}

const lift = s => Math.min(1, Math.max(0, (s - 0.75) / 1.25));  // below 0.75x the threshold stays flat

export class InspectionStage {
  constructor(host, labelLayer) {
    this.host = host;
    this.labelLayer = labelLayer;
    this.anims = [];
    this.pins = [];

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.prepend(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(CAMERA_HOME);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.4;
    this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI * 0.46;   // never look from under the part
    this.controls.target.set(0, 0, 0.05);

    this.scene.add(new THREE.HemisphereLight(0xf1e9d2, 0x243b35, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-2.2, -1.6, 3.2);
    this.scene.add(sun);

    // inspection plate under the part, with a faint blueprint grid
    const plate = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x2c4640, roughness: 0.9 }));
    plate.position.z = -0.06;
    this.scene.add(plate);
    const grid = new THREE.GridHelper(2.5, 20, 0x6b8e7b, 0x3b5a51);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.015;
    this.scene.add(grid);

    // the scan: a thin signal-yellow bar plus a soft light sheet above it
    this.scan = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.018, 0.018), new THREE.MeshBasicMaterial({ color: SIGNAL }));
    bar.position.z = 0.02;
    const fade = document.createElement("canvas");
    fade.width = 2; fade.height = 64;
    const fctx = fade.getContext("2d"), grad = fctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, "#000"); grad.addColorStop(1, "#fff");   // alpha map: clear at the top, bright at the bar
    fctx.fillStyle = grad; fctx.fillRect(0, 0, 2, 64);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55),
      new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true, opacity: 0.45, alphaMap: new THREE.CanvasTexture(fade),
                                    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    sheet.rotation.x = Math.PI / 2;
    sheet.position.z = 0.28;
    this.scan.add(bar, sheet);
    this.scan.visible = false;
    this.scene.add(this.scan);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.placeLabels();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    this.anims.forEach(a => a.pause());
    this.anims = [];
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      [this.mesh.material.map, this.mesh.material.emissiveMap].forEach(t => t && t.dispose());
      this.mesh.material.dispose();
      this.mesh = null;
    }
    this.pins.forEach(p => {
      this.scene.remove(p.group, p.ring);
      p.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      p.ring.geometry.dispose(); p.ring.material.dispose();
      p.label.remove();
    });
    this.pins = [];
  }

  /** Show one result. `onPinsLanded` fires when the sequence finishes (for the verdict stamp). */
  async show(result, photoBlob, onDone = () => {}) {
    this.clear();
    const img = await loadImage(photoBlob);
    const n = SEG + 1;

    // photo brightness at each vertex, for a little surface texture
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, n, n);
    const px = ctx.getImageData(0, 0, n, n).data;

    const geo = new THREE.PlaneGeometry(2, 2, SEG, SEG);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const base = new Float32Array(pos.count), defect = new Float32Array(pos.count);
    const flagged = result.label === "defective" || result.label === "unsure";
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i), v = 1 - uv.getY(i);   // v: 0 at the top, like the score grid
      const p = (Math.round(v * SEG) * n + Math.round(u * SEG)) * 4;
      base[i] = ((px[p] + px[p + 1] + px[p + 2]) / 765) * BASE_RELIEF;
      if (result.label !== "retake") defect[i] = lift(sampleGrid(result.grid, result.grid_size, u, v)) * DEFECT_LIFT;
    }

    // glow texture: red to yellow where the score is high
    const g = result.grid_size, hc = document.createElement("canvas");
    hc.width = hc.height = g;
    const hctx = hc.getContext("2d"), heat = hctx.createImageData(g, g);
    for (let i = 0; i < g * g; i++) {
      const t = result.label === "retake" ? 0 : lift(result.grid[i]);
      heat.data[i * 4] = 255 * Math.min(1, t * 1.6);
      heat.data[i * 4 + 1] = 200 * Math.max(0, t - 0.55);
      heat.data[i * 4 + 2] = 0;
      heat.data[i * 4 + 3] = 255;
    }
    hctx.putImageData(heat, 0, 0);
    const heatTex = new THREE.CanvasTexture(hc);
    const photoTex = new THREE.Texture(img);
    photoTex.colorSpace = THREE.SRGBColorSpace;
    photoTex.needsUpdate = true;

    const mat = new THREE.MeshStandardMaterial({ map: photoTex, emissive: 0xffffff, emissiveMap: heatTex,
                                                 emissiveIntensity: 0, roughness: 0.75, metalness: 0.08 });
    if (result.label === "retake") mat.color.setScalar(0.55);   // dimmed: this photo can't be judged
    this.mesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.mesh);

    const state = { rise: 0, glow: 0, scan: -1.2 };
    const applyHeights = () => {
      for (let i = 0; i < pos.count; i++) pos.setZ(i, base[i] + defect[i] * state.rise);
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    };
    applyHeights();

    // pins over each region, highest score first (numbered by severity)
    const heightAt = (x, y) => {
      const col = Math.round(x * SEG), row = Math.round(y * SEG);
      const i = row * n + col;
      return base[i] + defect[i];
    };
    if (flagged) {
      (result.regions || []).forEach((r, k) => {
        const group = new THREE.Group();
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 14), new THREE.MeshStandardMaterial({ color: REJECT, roughness: 0.4 }));
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xf1e9d2 }));
        stem.rotation.x = Math.PI / 2;
        stem.position.z = -0.15;
        head.position.z = 0;
        group.add(head, stem);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.085, 40),
          new THREE.MeshBasicMaterial({ color: REJECT, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
        const x = (r.x - 0.5) * 2, y = (0.5 - r.y) * 2, surface = heightAt(r.x, r.y);
        ring.position.set(x, y, surface + 0.01);
        group.position.set(x, y, surface + 0.33);
        group.userData.finalZ = surface + 0.33;
        this.scene.add(group, ring);
        const label = document.createElement("div");
        label.className = "pin-label";
        label.textContent = String(k + 1);
        this.labelLayer.append(label);
        this.pins.push({ group, ring, label, region: r });
        group.visible = ring.visible = false;
      });
    }

    const finish = () => {
      state.rise = 1; state.glow = flagged ? 1.4 : 0.5; applyHeights();
      mat.emissiveIntensity = state.glow;
      this.scan.visible = false;
      this.pins.forEach(p => { p.group.visible = p.ring.visible = true; p.group.position.z = p.group.userData.finalZ; });
      if (!reduceMotion && this.pins.length) {
        this.anims.push(animate(this.pins.map(p => p.ring.scale), { x: [1, 2.1], y: [1, 2.1], duration: 1300, ease: "outSine", loop: true }));
        this.anims.push(animate(this.pins.map(p => p.ring.material), { opacity: [0.9, 0], duration: 1300, ease: "outSine", loop: true }));
      }
      onDone();
    };

    if (reduceMotion) { this.camera.position.copy(CAMERA_HOME); return finish(); }

    // one orchestrated sequence: camera settles, scan sweeps, surface rises, glow, pins drop in
    this.controls.enabled = false;
    this.scan.visible = true;
    this.scan.position.set(0, state.scan, 0.08);
    const from = this.camera.position.clone();
    const cam = { t: 0 };
    const tl = createTimeline({ onComplete: () => { this.controls.enabled = true; } });
    tl.add(cam, { t: 1, duration: 900, ease: "inOutQuad",
                  onUpdate: () => this.camera.position.lerpVectors(from, CAMERA_HOME, cam.t) }, 0)
      .add(state, { scan: 1.2, duration: 950, ease: "inOutSine",
                    onUpdate: () => this.scan.position.setY(state.scan),
                    onComplete: () => { this.scan.visible = false; } }, 150)
      .add(state, { rise: 1, duration: 750, ease: "outCubic", onUpdate: applyHeights }, 800)
      .add(state, { glow: flagged ? 1.4 : 0.5, duration: 500, ease: "outQuad",
                    onUpdate: () => { mat.emissiveIntensity = state.glow; } }, 1150);
    this.anims.push(tl);

    if (!this.pins.length) { setTimeout(finish, 1700); return; }
    setTimeout(() => {
      this.pins.forEach(p => { p.group.visible = true; p.group.position.z = p.group.userData.finalZ + 1.2; });
      this.anims.push(animate(this.pins.map(p => p.group.position), {
        z: (target, i) => this.pins[i].group.userData.finalZ,
        duration: 750, ease: "outBounce", delay: stagger(140),
        onComplete: () => { this.pins.forEach(p => { p.ring.visible = true; }); finish(); },
      }));
    }, 1500);
  }

  placeLabels() {
    const w = this.host.clientWidth, h = this.host.clientHeight, v = new THREE.Vector3();
    for (const p of this.pins) {
      if (!p.group.visible) { p.label.style.opacity = 0; continue; }
      v.copy(p.group.position).setZ(p.group.position.z + 0.11).project(this.camera);
      p.label.style.opacity = v.z < 1 ? 1 : 0;
      p.label.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
    }
  }

  resetView() { this.camera.position.copy(CAMERA_HOME); this.controls.target.set(0, 0, 0.05); }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.clear();
    this.resizeObserver?.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
