// Landing hero: an isometric scene. A glowing central slab (the inspection camera over a part) with circuit lines
// running to five round nodes (Train, Inspect, Verify, Report, AI assistant); a light pulse travels each line,
// a soft beam falls from above, gentle bloom and mouse parallax. three.js + bundled examples only (offline).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

const C = { bg: 0x0e1714, deep: 0x162420, forest: 0x243b35, sage: 0x6b8e7b, mist: 0xb7c9b1, cream: 0xf1e9d2, amber: 0xe0b341, defect: 0xc2571a };
const NODES = [
  { label: "Train", at: [-3.4, 0, -1.4] }, { label: "Inspect", at: [3.3, 0, -1.6] }, { label: "Verify", at: [3.6, 0, 1.9] },
  { label: "Report", at: [-0.6, 0, 3.4] }, { label: "AI assistant", at: [-3.6, 0, 2.0] },
];
const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const glow = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const MAX_TILT = THREE.MathUtils.degToRad(4);

function canvasTexture(draw, w, h) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class HeroScene {
  constructor(host) {
    this.host = host;
    this.clock = new THREE.Clock();
    this.inView = true; this.visible = true; this.slow = 0; this.degraded = false;
    this.tilt = { x: 0, y: 0, tx: 0, ty: 0 };

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(r.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "hero3d-labels";
    host.appendChild(this.labels.domElement);

    const scene = this.scene = new THREE.Scene();
    // background: a faint lift in the middle, the page's dark forest at the edges (so the canvas blends in)
    this.bg = canvasTexture((g, w, h) => {
      const grad = g.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, w * 0.62);
      grad.addColorStop(0, "#1b2c27"); grad.addColorStop(0.55, "#121e1a"); grad.addColorStop(1, "#0E1714");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    }, 512, 512);
    scene.background = this.bg;

    // isometric camera
    this.camera = new THREE.OrthographicCamera(-6, 6, 4, -4, 0.1, 100);
    this.camera.position.set(9, 8.5, 9);
    this.camera.lookAt(0, 0.4, 0);

    scene.add(new THREE.HemisphereLight(0xdfe9dd, 0x0e1714, 0.7));
    const key = new THREE.DirectionalLight(0xffe2b8, 1.4); key.position.set(4, 9, 3); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd0c0, 0.9); rim.position.set(-6, 3, -5); scene.add(rim);

    this.root = new THREE.Group(); scene.add(this.root);

    // central slab: dark glass base, glowing top panel, camera head with an amber lens ring
    const slab = new THREE.Mesh(new RoundedBoxGeometry(3.0, 0.42, 2.0, 3, 0.12),
      new THREE.MeshPhysicalMaterial({ color: 0x1a2a25, roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.2 }));
    this.root.add(slab);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.5), new THREE.MeshBasicMaterial({ color: glow(C.sage, 0.9), toneMapped: false, transparent: true, opacity: 0.55 }));
    panel.rotation.x = -Math.PI / 2; panel.position.y = 0.215; this.root.add(panel);
    this.panel = panel;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.0, 0.42, 2.0)),
      new THREE.LineBasicMaterial({ color: glow(C.mist, 1.6), toneMapped: false }));
    this.root.add(edge);
    const part = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.13, 20, 40), new THREE.MeshPhysicalMaterial({ color: 0xc9cbc4, metalness: 0.85, roughness: 0.28, clearcoat: 0.6 }));
    part.rotation.x = -Math.PI / 2; part.position.set(0.15, 0.34, 0.05); this.root.add(part);
    this.part = part;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 12), new THREE.MeshStandardMaterial({ color: 0x2c403a, roughness: 0.5 }));
    pole.position.set(-1.1, 1.0, -0.6); this.root.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.08, 0.12), new THREE.MeshStandardMaterial({ color: 0x2c403a, roughness: 0.5 }));
    arm.position.set(-0.5, 1.78, -0.6); arm.rotation.y = 0.45; this.root.add(arm);
    const cam = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.32, 0.36, 2, 0.06), new THREE.MeshPhysicalMaterial({ color: 0x1f302b, roughness: 0.35, clearcoat: 1 }));
    cam.position.set(0.12, 1.7, -0.12); this.root.add(cam);
    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 10, 32), new THREE.MeshBasicMaterial({ color: glow(C.amber, 2.4), toneMapped: false }));
    lens.rotation.x = Math.PI / 2; lens.position.set(0.12, 1.53, -0.12); this.root.add(lens);

    // light beam from above: an open cone with a vertical fade, additive
    const beamTex = canvasTexture((g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(241,233,210,0)"); grad.addColorStop(0.25, "rgba(241,233,210,0.55)"); grad.addColorStop(1, "rgba(183,201,177,0.04)");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    }, 8, 128);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 1.25, 1.35, 32, 1, true),
      new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    this.beam.position.set(0.12, 0.88, -0.08); this.root.add(this.beam);

    // circuit lines (right angles, iso look) to the nodes, each with a travelling pulse
    const sprite = canvasTexture((g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.3, "rgba(255,225,150,0.75)"); grad.addColorStop(1, "rgba(255,225,150,0)");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    }, 64, 64);
    this.sprite = sprite;
    this.paths = [];
    NODES.forEach((n, i) => {
      const [x, , z] = n.at;
      const start = new THREE.Vector3(Math.sign(x) * 1.5, 0, THREE.MathUtils.clamp(z * 0.35, -0.9, 0.9));
      const mid = new THREE.Vector3(x * 0.62, 0, start.z);
      const end = new THREE.Vector3(x, 0, z);
      const corner = new THREE.Vector3(mid.x, 0, z);
      const pts = [start, mid, corner, end].map((v) => v.clone().setY(-0.18));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: glow(C.sage, 1.7), toneMapped: false, transparent: true, opacity: 0.9 }));
      this.root.add(line);
      const lengths = [0]; for (let k = 1; k < pts.length; k++) lengths.push(lengths[k - 1] + pts[k].distanceTo(pts[k - 1]));
      const pulse = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite, color: glow(C.amber, 2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      pulse.scale.setScalar(0.38); this.root.add(pulse);
      // the node: a small round pad with a glowing ring
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.16, 36), new THREE.MeshPhysicalMaterial({ color: 0x1b2b26, roughness: 0.3, clearcoat: 1 }));
      pad.position.set(x, -0.18, z); this.root.add(pad);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 8, 48), new THREE.MeshBasicMaterial({ color: glow(i === 1 ? C.amber : C.mist, 1.9), toneMapped: false }));
      ring.rotation.x = Math.PI / 2; ring.position.set(x, -0.09, z); this.root.add(ring);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: glow(C.cream, 1.6), toneMapped: false }));
      dot.position.set(x, 0.02, z); this.root.add(dot);
      const label = document.createElement("span"); label.className = "hero3d-label"; label.textContent = n.label;
      const tag = new CSS2DObject(label); tag.position.set(x, 0.55, z); this.root.add(tag);
      this.paths.push({ pts, lengths, total: lengths[lengths.length - 1], pulse, offset: i * 0.21, ring });
    });

    // post: bloom (dark background, so a lower threshold is fine)
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.55, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.onPointer = (e) => {
      if (reduceMotion) return;
      this.tilt.ty = ((e.clientX / window.innerWidth) - 0.5) * 2 * MAX_TILT;
      this.tilt.tx = ((e.clientY / window.innerHeight) - 0.5) * 2 * MAX_TILT * 0.7;
    };
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    this.io = new IntersectionObserver(([en]) => { this.inView = en.isIntersecting; this.wake(); });
    this.io.observe(host);
    this.onVisibility = () => { this.visible = document.visibilityState !== "hidden"; this.wake(); };
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.loop = () => { this.raf = 0; if (!this.inView || !this.visible) return; this.frame(); this.raf = requestAnimationFrame(this.loop); };
    this.raf = requestAnimationFrame(this.loop);
  }

  wake() { if (this.inView && this.visible && !this.raf) { this.clock.getDelta(); this.raf = requestAnimationFrame(this.loop); } }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    this.composer.setSize(w, h);
    const aspect = w / h, view = aspect > 1.1 ? 4.6 : 6.2;   // half-height of the iso view; more room when tall
    this.camera.left = -view * aspect; this.camera.right = view * aspect; this.camera.top = view; this.camera.bottom = -view;
    this.camera.updateProjectionMatrix();
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta()), t = this.clock.elapsedTime;
    if (!this.degraded) { this.slow = dt > 0.033 ? this.slow + dt : 0; if (this.slow > 2) this.degraded = true; }
    if (!reduceMotion) {
      this.tilt.x += (this.tilt.tx - this.tilt.x) * Math.min(1, dt * 4);
      this.tilt.y += (this.tilt.ty - this.tilt.y) * Math.min(1, dt * 4);
      this.root.rotation.set(this.tilt.x, this.tilt.y + Math.sin(t * 0.2) * 0.03, 0);
      this.part.rotation.z = t * 0.4;
      this.panel.material.opacity = 0.45 + Math.sin(t * 1.6) * 0.1;
      this.beam.material.opacity = 0.48 + Math.sin(t * 1.1) * 0.08;
    }
    const v = new THREE.Vector3();
    this.paths.forEach((P, i) => {   // a pulse runs out along each circuit line, then the node ring flashes
      const q = reduceMotion ? 0.6 : ((t * 0.32 + P.offset) % 1);
      const d = q * P.total;
      let k = 1; while (k < P.lengths.length - 1 && P.lengths[k] < d) k++;
      const a = P.pts[k - 1], b = P.pts[k], seg = P.lengths[k] - P.lengths[k - 1];
      P.pulse.position.copy(v.copy(a).lerp(b, seg ? (d - P.lengths[k - 1]) / seg : 0));
      P.pulse.material.opacity = Math.min(1, q * 6, (1 - q) * 6);
      const flash = Math.max(0, 1 - Math.abs(q - 0.97) * 12);
      P.ring.scale.setScalar(1 + flash * 0.25);
    });
    if (this.degraded) this.renderer.render(this.scene, this.camera); else this.composer.render(dt);
    this.labels.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.io.disconnect(); this.resizeObserver.disconnect();
    window.removeEventListener("pointermove", this.onPointer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    const tex = new Set([this.bg, this.sprite]);
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((m) => { if (m.map) tex.add(m.map); m.dispose(); });
      if (o.isCSS2DObject) o.element.remove();
    });
    tex.forEach((t) => t && t.dispose());
    this.bloom.dispose(); this.composer.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove(); this.labels.domElement.remove();
  }
}
