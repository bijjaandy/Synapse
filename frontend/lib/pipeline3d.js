// Landing page scene: the inspection pipeline as five stacked layers that separate as you scroll.
// setProgress(0..1) is driven by the page scroll; the scene eases toward it every frame.
import * as THREE from "three";
const INTRO_SHIFT = 0.21;  // share of the screen width the stack moves right during the intro

const C = { forest: 0x243b35, sage: 0x6b8e7b, mist: 0xb7c9b1, cream: 0xf1e9d2, defect: 0xc2571a, amber: 0xe0b341 };
const W = 2.2, H = 1.5;                       // layer size
export const STAGES = 7;                      // intro, 5 layers, outro
const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function canvasTexture(draw, w = 512, h = 350) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function loadImage(src) {
  return new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
}

// heat spot location on the sample photo (fraction of width/height)
const SPOT = { x: 0.62, y: 0.42 };

export class PipelineScene {
  constructor(host, photoSrc) {
    this.host = host;
    this.target = 0;
    this.p = 0;
    this.clock = new THREE.Clock();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(C.forest, 7, 16);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
    this.camera.position.set(0, 1.2, 7.4);
    this.lookAt = new THREE.Vector3(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight(0xf1e9d2, 0x243b35, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    this.scene.add(key);

    const grid = new THREE.GridHelper(30, 60, C.sage, 0x2f4a43);
    grid.position.y = -2.6;
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    this.scene.add(grid);

    this.stack = new THREE.Group();
    this.stack.rotation.set(-0.95, 0, 0.42);
    this.scene.add(this.stack);
    this.layers = [];
    this.build(photoSrc);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    const loop = () => { this.frame(); this.raf = requestAnimationFrame(loop); };
    loop();
  }

  async build(photoSrc) {
    const photo = await loadImage(photoSrc);
    const drawPhoto = (g, w, h, alpha = 1) => {
      g.fillStyle = "#d8d5cc"; g.fillRect(0, 0, w, h);
      if (photo) { g.globalAlpha = alpha; const s = Math.max(w / photo.width, h / photo.height);
        g.drawImage(photo, (w - photo.width * s) / 2, (h - photo.height * s) / 2, photo.width * s, photo.height * s); g.globalAlpha = 1; }
    };
    const spot = (g, w, h, r, color) => {
      const grad = g.createRadialGradient(w * SPOT.x, h * SPOT.y, 0, w * SPOT.x, h * SPOT.y, r);
      grad.addColorStop(0, color); grad.addColorStop(1, "rgba(194,87,26,0)");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    };
    const textures = [
      canvasTexture((g, w, h) => drawPhoto(g, w, h)),                                   // 1 photo
      canvasTexture((g, w, h) => {                                                      // 2 patches
        drawPhoto(g, w, h, 0.35);
        const n = 28, cw = w / n, ch = h / n;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const v = 0.25 + 0.6 * Math.abs(Math.sin(x * 1.7 + y * 0.9) * Math.cos(x * 0.3 - y * 1.3));
          g.fillStyle = `rgba(36,59,53,${v * 0.75})`; g.fillRect(x * cw + 1, y * ch + 1, cw - 2, ch - 2);
        }
      }),
      canvasTexture((g, w, h) => {                                                      // 3 memory
        g.fillStyle = "#2c4640"; g.fillRect(0, 0, w, h);
        g.strokeStyle = "rgba(183,201,177,.18)";
        for (let i = 0; i < w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); }
        for (let i = 0; i < h; i += 32) { g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
      }),
      canvasTexture((g, w, h) => { drawPhoto(g, w, h, 0.55); spot(g, w, h, w * 0.2, "rgba(255,98,26,.95)"); }), // 4 compare
      canvasTexture((g, w, h) => {                                                      // 5 decide
        drawPhoto(g, w, h);
        g.strokeStyle = "#c2571a"; g.lineWidth = 7;
        g.beginPath(); g.arc(w * SPOT.x, h * SPOT.y, w * 0.09, 0, Math.PI * 2); g.stroke();
      }),
    ];
    textures.forEach((map, i) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.04),
        [0, 1, 2, 3].map(() => new THREE.MeshStandardMaterial({ color: C.forest, roughness: 0.8 }))
          .concat([new THREE.MeshStandardMaterial({ map, roughness: 0.7, transparent: true }),
                   new THREE.MeshStandardMaterial({ color: C.forest, roughness: 0.8 })]));
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: C.mist, transparent: true }));
      mesh.add(edge);
      this.stack.add(mesh);
      this.layers.push({ mesh, edge, face: mesh.material[4] });
    });

    // memory: points that drift up from the patch layer and settle into the memory layer
    const n = 260;
    this.memory = new THREE.InstancedMesh(new THREE.SphereGeometry(0.028, 8, 6), new THREE.MeshStandardMaterial({ color: C.cream, emissive: C.sage, emissiveIntensity: 0.6 }), n);
    this.memSeeds = Array.from({ length: n }, () => [(Math.random() - 0.5) * W * 0.9, (Math.random() - 0.5) * H * 0.9, Math.random()]);
    this.stack.add(this.memory);

    // scan bar across the compare layer, and the decision pin
    this.scan = new THREE.Mesh(new THREE.BoxGeometry(W * 1.02, 0.03, 0.05), new THREE.MeshBasicMaterial({ color: C.amber }));
    this.stack.add(this.scan);
    this.pin = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 14), new THREE.MeshStandardMaterial({ color: C.defect, roughness: 0.4 }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.55, 8), new THREE.MeshStandardMaterial({ color: C.cream }));
    stem.rotation.x = Math.PI / 2; stem.position.z = -0.28;
    this.pin.add(head, stem);
    this.stack.add(this.pin);
    this.ready = true;
  }

  setProgress(p) { this.target = Math.min(1, Math.max(0, p)); }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.p += (this.target - this.p) * (reduceMotion ? 1 : Math.min(1, dt * 6));
    if (!this.ready) { this.renderer.render(this.scene, this.camera); return; }
    const s = this.p * (STAGES - 1);                 // 0 intro, 1..5 layers, 6 outro
    const active = Math.round(s) - 1;                // which layer is in focus (-1 none)
    const spread = Math.min(1, s) * (s > 5.5 ? 1 - (s - 5.5) * 1.6 : 1);   // explode, then close again at the end
    const gap = 0.16 + 0.72 * Math.max(0, spread);
    const t = this.clock.elapsedTime;

    this.layers.forEach((L, i) => {
      const z = (2 - i) * gap;                       // layer 0 on top
      const focus = i === active ? 1 : 0;
      L.mesh.position.set(focus * 0.25, focus * 0.18, z);
      const k = 1 + focus * 0.06;
      L.mesh.scale.setScalar(L.mesh.scale.x + (k - L.mesh.scale.x) * 0.15);
      L.edge.material.color.setHex(focus ? C.defect : C.mist);
      L.face.opacity = active < 0 || focus || s > 5.5 ? 1 : 0.55;
    });

    // memory points rise from layer 2 to layer 3 during stage 3
    const m = new THREE.Matrix4(), from = (2 - 1) * gap, to = (2 - 2) * gap;
    const flow = Math.min(1, Math.max(0, s - 2.4));
    this.memSeeds.forEach(([x, y, r], i) => {
      const f = Math.min(1, Math.max(0, flow * 1.4 - r * 0.4));
      const z = from + (to - from) * f + 0.06 + Math.sin(t * 2 + i) * 0.01;
      const vis = s > 2.2 && s < 6 ? 1 : 0.001;
      m.makeScale(vis, vis, vis).setPosition(x, y, z);
      this.memory.setMatrixAt(i, m);
    });
    this.memory.instanceMatrix.needsUpdate = true;

    // scan sweeps the compare layer during stage 4
    const sweep = Math.min(1, Math.max(0, s - 3.5));
    this.scan.visible = s > 3.4 && s < 4.6;
    const cmp = this.layers[3].mesh.position;
    this.scan.position.set(cmp.x, H / 2 - sweep * H, cmp.z + 0.05);

    // pin drops onto the decision layer during stage 5
    const dec = this.layers[4].mesh.position;
    const drop = Math.min(1, Math.max(0, (s - 4.5) * 2));
    this.pin.visible = s > 4.5;
    this.pin.position.set(dec.x + (SPOT.x - 0.5) * W, dec.y + (0.5 - SPOT.y) * H, dec.z + 0.6 + (1 - drop) * 1.4);

    // the stack turns slowly at rest and rotates a little with progress
    this.stack.rotation.z = 0.42 + (reduceMotion ? 0 : Math.sin(t * 0.25) * 0.05) + this.p * 0.5;
    const focusZ = active >= 0 ? (2 - active) * gap : 0;
    const camTarget = new THREE.Vector3(0, focusZ * 0.55, 0);
    this.lookAt.lerp(camTarget, 0.08);
    const dist = 7.4 - Math.min(1, s) * 1.2 + (s > 5.5 ? (s - 5.5) * 2.4 : 0);
    this.camera.position.lerp(new THREE.Vector3(Math.sin(this.p * 1.6) * 1.2, 1.2 + focusZ * 0.55, dist), 0.08);
    this.camera.lookAt(this.lookAt);
    // intro (stage 0): the stack sits in the right half so it never covers the headline; it eases back to the
    // centre as the scroll moves into stage 1. A view offset shifts the whole picture in screen space.
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (w > 820 && h) {
      const intro = reduceMotion ? (s < 0.5 ? 1 : 0) : Math.max(0, Math.min(1, 1 - s));
      const ease = intro * intro * (3 - 2 * intro);
      if (ease > 0.001) this.camera.setViewOffset(w, h, -INTRO_SHIFT * w * ease, 0, w, h);
      else if (this.camera.view && this.camera.view.enabled) this.camera.clearViewOffset();
    } else if (this.camera.view && this.camera.view.enabled) this.camera.clearViewOffset();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((mm) => { if (mm.map) mm.map.dispose(); mm.dispose(); }); });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
