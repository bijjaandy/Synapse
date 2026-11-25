// Landing page scene: the inspection pipeline as five glass layers that separate as you scroll.
// setProgress(0..1) is driven by the page scroll; the scene eases toward it every frame.
// Only three.js and its bundled examples (offline). Pauses when off-screen or hidden; degrades itself when slow.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

const INTRO_SHIFT = 0.21;   // share of the screen width the stack moves right during the intro
const STAGE_SHIFT = 0.14;   // and during the stages, so the caption card on the left and the stack sit side by side
const C = { forest: 0x243b35, sage: 0x6b8e7b, mist: 0xb7c9b1, cream: 0xf1e9d2, defect: 0xc2571a, amber: 0xe0b341 };
const W = 2.2, H = 1.5, DEPTH = 0.07;          // layer size
export const STAGES = 7;                        // intro, 5 layers, outro
export const LAYER_NAMES = ["The photo", "Seeing in patches", "Good-part memory", "Comparison", "The decision"];
const SPOT = { x: 0.62, y: 0.42 };             // heat spot on the sample photo (fraction of width/height)
const PARTICLES = 400, MEMORY = 240, STREAM = 18, GRID = 28;
const MAX_TILT = THREE.MathUtils.degToRad(6);
const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => { const x = clamp01(v); return x * x * (3 - 2 * x); };

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
const glow = (hex, k) => new THREE.Color(hex).multiplyScalar(k);   // > 1 so bloom picks it up (toneMapped: false)

export class PipelineScene {
  /** opts.onHover(index | null, x, y) and opts.onPick(index) let the page show a tag and scroll to a stage. */
  constructor(host, photoSrc, opts = {}) {
    this.host = host;
    this.opts = opts;
    this.target = 0; this.p = 0;
    this.clock = new THREE.Clock();
    this.disposables = [];
    this.running = true; this.visible = true; this.inView = true;
    this.slow = 0; this.degraded = false;
    this.tilt = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
    this.hovered = -1; this.hoverAmt = [0, 0, 0, 0, 0];

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.info.autoReset = false;   // count all passes of a frame (reset at the start of each frame)
    host.appendChild(r.domElement);
    r.domElement.style.touchAction = "pan-y";

    const scene = this.scene = new THREE.Scene();
    // background: soft radial gradient, cream centre -> mist -> deep forest at the edges (screen space)
    this.bg = canvasTexture((g, w, h) => {
      const grad = g.createRadialGradient(w * 0.62, h * 0.45, 0, w * 0.62, h * 0.45, w * 0.78);
      grad.addColorStop(0, "#F1E9D2"); grad.addColorStop(0.42, "#EAE6D3"); grad.addColorStop(0.68, "#B7C9B1");
      grad.addColorStop(0.88, "#6B8E7B"); grad.addColorStop(1, "#243B35");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    }, 1024, 640);
    scene.background = this.bg;
    scene.fog = new THREE.Fog(0xdfe6d3, 9, 19);   // far dust fades into the mist

    const pmrem = new THREE.PMREMGenerator(r);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = this.env;
    scene.environmentIntensity = 0.38;

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
    this.camera.position.set(0, 1.2, 7.4);
    this.lookAt = new THREE.Vector3();

    const key = new THREE.DirectionalLight(0xffe4bd, 1.5); key.position.set(3, 5, 4); scene.add(key);       // warm key
    const rim = new THREE.DirectionalLight(0xbcd6ff, 1.2); rim.position.set(-4, 2, -5); scene.add(rim);     // cool rim
    scene.add(new THREE.HemisphereLight(0xf1e9d2, 0x243b35, 0.6));

    // contact shadow: a blurred dark ellipse under the stack (no grid)
    const shadowTex = canvasTexture((g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, "rgba(36,59,53,0.55)"); grad.addColorStop(0.5, "rgba(36,59,53,0.22)"); grad.addColorStop(1, "rgba(36,59,53,0)");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    }, 256, 256);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 3.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, fog: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.set(0.2, -1.9, -0.3);
    scene.add(this.shadow);

    // dust in the light: ~400 glowing points drifting slowly, additive, fading with depth (fog)
    const sprite = canvasTexture((g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.35, "rgba(255,240,200,0.55)"); grad.addColorStop(1, "rgba(255,240,200,0)");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    }, 64, 64);
    this.sprite = sprite;
    const pos = new Float32Array(PARTICLES * 3), col = new Float32Array(PARTICLES * 3);
    this.dustSeed = [];
    const palette = [new THREE.Color(C.amber), new THREE.Color(C.cream), new THREE.Color(C.mist)];
    for (let i = 0; i < PARTICLES; i++) {
      const s = [(Math.random() - 0.5) * 16, (Math.random() - 0.5) * 9, -8 + Math.random() * 10, Math.random() * Math.PI * 2, 0.2 + Math.random() * 0.6];
      this.dustSeed.push(s);
      pos.set([s[0], s[1], s[2]], i * 3);
      const c = palette[i % 3]; col.set([c.r, c.g, c.b], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    dustGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.07, map: sprite, vertexColors: true, transparent: true, opacity: 0.85,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    scene.add(this.dust);

    // the stack sits inside a tilt group (pointer parallax)
    this.tiltGroup = new THREE.Group(); scene.add(this.tiltGroup);
    this.stack = new THREE.Group(); this.stack.rotation.set(-0.95, 0, 0.42); this.tiltGroup.add(this.stack);
    this.layers = [];
    this.build(photoSrc);

    // post: subtle bloom on the glowing parts only (threshold above the cream background)
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 1.0);   // threshold 1: only the deliberately bright parts glow
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // pointer: parallax (whole window), hover + click on the layers (canvas)
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2(2, 2);
    this.onWindowPointer = (e) => {
      if (reduceMotion || e.pointerType === "touch") return;
      this.tilt.tx = ((e.clientY / window.innerHeight) - 0.5) * 2 * MAX_TILT;
      this.tilt.ty = ((e.clientX / window.innerWidth) - 0.5) * 2 * MAX_TILT;
    };
    this.onCanvasPointer = (e) => {
      const b = r.domElement.getBoundingClientRect();
      this.ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    };
    this.onCanvasLeave = () => { this.ndc.set(2, 2); };
    this.onCanvasClick = () => { if (this.hovered >= 0 && this.opts.onPick) this.opts.onPick(this.hovered); };
    this.onOrientation = (e) => {   // touch devices: gentle tilt from the device, if it reports one
      if (reduceMotion || e.beta == null || e.gamma == null) return;
      this.tilt.tx = THREE.MathUtils.clamp((e.beta - 45) / 45, -1, 1) * MAX_TILT;
      this.tilt.ty = THREE.MathUtils.clamp(e.gamma / 45, -1, 1) * MAX_TILT;
    };
    window.addEventListener("pointermove", this.onWindowPointer, { passive: true });
    r.domElement.addEventListener("pointermove", this.onCanvasPointer, { passive: true });
    r.domElement.addEventListener("pointerleave", this.onCanvasLeave);
    r.domElement.addEventListener("click", this.onCanvasClick);
    if (window.matchMedia("(pointer: coarse)").matches) window.addEventListener("deviceorientation", this.onOrientation);

    // pause when off-screen or the tab is hidden
    this.io = new IntersectionObserver(([en]) => { this.inView = en.isIntersecting; this.wake(); }, { threshold: 0 });
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

  async build(photoSrc) {
    const photo = await loadImage(photoSrc);
    if (this.disposed) return;
    const drawPhoto = (g, w, h, alpha = 1) => {
      g.fillStyle = "#d8d5cc"; g.fillRect(0, 0, w, h);
      if (photo) { g.globalAlpha = alpha; const s = Math.max(w / photo.width, h / photo.height);
        g.drawImage(photo, (w - photo.width * s) / 2, (h - photo.height * s) / 2, photo.width * s, photo.height * s); g.globalAlpha = 1; }
    };
    const heat = (g, w, h, r, a = 0.95) => {
      const grad = g.createRadialGradient(w * SPOT.x, h * SPOT.y, 0, w * SPOT.x, h * SPOT.y, r);
      grad.addColorStop(0, `rgba(255,98,26,${a})`); grad.addColorStop(0.45, `rgba(224,179,65,${a * 0.5})`); grad.addColorStop(1, "rgba(194,87,26,0)");
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    };
    const faces = [
      canvasTexture((g, w, h) => drawPhoto(g, w, h)),                                         // 1 photo
      canvasTexture((g, w, h) => { drawPhoto(g, w, h, 0.3); g.fillStyle = "rgba(36,59,53,.35)"; g.fillRect(0, 0, w, h); }), // 2 under the tiles
      canvasTexture((g, w, h) => {                                                            // 3 memory: dark glass
        const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, "#2c4640"); grad.addColorStop(1, "#1d302b");
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
        g.strokeStyle = "rgba(183,201,177,.12)";
        for (let i = 0; i < w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); }
        for (let i = 0; i < h; i += 32) { g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
      }),
      canvasTexture((g, w, h) => drawPhoto(g, w, h, 0.6)),                                     // 4 compare (heat spot is its own plane)
      canvasTexture((g, w, h) => drawPhoto(g, w, h)),                                          // 5 decide
    ];
    this.finalTex = canvasTexture((g, w, h) => { drawPhoto(g, w, h, 0.85); heat(g, w, h, w * 0.22);       // outro: the final heatmap
      g.strokeStyle = "#C2571A"; g.lineWidth = 6; g.beginPath(); g.arc(w * SPOT.x, h * SPOT.y, w * 0.08, 0, Math.PI * 2); g.stroke(); });
    this.heatTex = canvasTexture((g, w, h) => heat(g, w, h, w * 0.22), 512, 350);

    const slabGeo = new RoundedBoxGeometry(W, H, DEPTH, 3, 0.05);
    const faceGeo = new THREE.PlaneGeometry(W * 0.94, H * 0.92);
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(W * 1.004, H * 1.004, DEPTH * 0.6));
    this.disposables.push(slabGeo, faceGeo, edgeGeo);
    faces.forEach((map, i) => {
      const glass = new THREE.MeshPhysicalMaterial({ color: 0xf6f3ea, roughness: 0.18, metalness: 0, transmission: 0.55, thickness: 0.4,
        ior: 1.4, clearcoat: 1, clearcoatRoughness: 0.12, transparent: true, opacity: 0.92, envMapIntensity: 0.55 });
      const slab = new THREE.Mesh(slabGeo, glass);
      const face = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false }));
      face.position.z = DEPTH / 2 + 0.004;
      const edge = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: glow(C.mist, 1.1), transparent: true, opacity: 0.85, toneMapped: false }));
      slab.add(face, edge);
      slab.userData.layer = i; face.userData.layer = i;
      this.stack.add(slab);
      this.layers.push({ slab, face, edge, glass, map });
    });

    // layer 2: 28 x 28 patch tiles that light up in a wave (one instanced draw)
    const tileGeo = new THREE.PlaneGeometry((W * 0.94) / GRID * 0.78, (H * 0.92) / GRID * 0.78);
    this.tiles = new THREE.InstancedMesh(tileGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, toneMapped: false }), GRID * GRID);
    this.disposables.push(tileGeo);
    const m = new THREE.Matrix4();
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      m.makeTranslation(((x + 0.5) / GRID - 0.5) * W * 0.94, (0.5 - (y + 0.5) / GRID) * H * 0.92, DEPTH / 2 + 0.008);
      this.tiles.setMatrixAt(y * GRID + x, m);
      this.tiles.setColorAt(y * GRID + x, new THREE.Color(C.sage));
    }
    this.layers[1].slab.add(this.tiles);
    this.tileColor = new THREE.Color();

    // layer 3: memory points that flow up from the patches and gather into clusters
    const memGeo = new THREE.BufferGeometry();
    memGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MEMORY * 3), 3));
    this.memory = new THREE.Points(memGeo, new THREE.PointsMaterial({ size: 0.055, map: this.sprite, color: glow(C.cream, 1.6), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    const centres = [[-0.55, 0.25], [0.35, 0.3], [-0.1, -0.3], [0.65, -0.2], [-0.7, -0.25]];
    this.memSeeds = Array.from({ length: MEMORY }, (_, i) => {
      const c = centres[i % centres.length], a = Math.random() * Math.PI * 2, rr = Math.random() * 0.22;
      return { sx: (Math.random() - 0.5) * W * 0.9, sy: (Math.random() - 0.5) * H * 0.9, cx: c[0] + Math.cos(a) * rr, cy: c[1] + Math.sin(a) * rr * 0.8, d: Math.random() };
    });
    this.stack.add(this.memory);

    // layer 4: scan beam + heat spot
    this.scan = new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, 0.022, 0.03), new THREE.MeshBasicMaterial({ color: glow(C.amber, 2.6), toneMapped: false }));
    this.heatSpot = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ map: this.heatTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.heatSpot.position.z = DEPTH / 2 + 0.01;
    this.layers[3].slab.add(this.scan, this.heatSpot);

    // layer 5: ring pulse + pin
    const ringGeo = new THREE.RingGeometry(0.15, 0.175, 48);
    this.disposables.push(ringGeo);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: glow(C.defect, 2.2), transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
    this.ring.position.set((SPOT.x - 0.5) * W * 0.94, (0.5 - SPOT.y) * H * 0.92, DEPTH / 2 + 0.012);
    this.layers[4].slab.add(this.ring);
    this.pin = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.08, 20, 14), new THREE.MeshPhysicalMaterial({ color: C.defect, roughness: 0.25, clearcoat: 1, emissive: C.defect, emissiveIntensity: 0.35 }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 8), new THREE.MeshStandardMaterial({ color: C.cream, roughness: 0.4 }));
    stem.rotation.x = Math.PI / 2; stem.position.z = -0.25;
    this.pin.add(head, stem);
    this.stack.add(this.pin);

    // data stream between layers during the transitions
    const streamGeo = new THREE.BufferGeometry();
    streamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(STREAM * 3), 3));
    this.stream = new THREE.Points(streamGeo, new THREE.PointsMaterial({ size: 0.09, map: this.sprite, color: glow(C.amber, 2.2), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.streamSeeds = Array.from({ length: STREAM }, () => [(Math.random() - 0.5) * W * 0.7, (Math.random() - 0.5) * H * 0.7, Math.random()]);
    this.stack.add(this.stream);
    this.ready = true;
  }

  setProgress(p) { this.target = clamp01(p); this.wake(); }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Too slow for this machine (frames over 33 ms for 2 s): no bloom, no glass pass, half the dust. */
  degrade() {
    if (this.degraded) return;
    this.degraded = true;
    this.dust.geometry.setDrawRange(0, PARTICLES / 2);
    this.layers.forEach((L) => { L.glass.transmission = 0; L.glass.opacity = 0.8; L.glass.needsUpdate = true; });
  }

  frame() {
    this.renderer.info.reset();
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    if (!this.degraded) { this.slow = dt > 0.033 ? this.slow + dt : 0; if (this.slow > 2) this.degrade(); }
    this.p += (this.target - this.p) * (reduceMotion ? 1 : Math.min(1, dt * 6));
    const s = this.p * (STAGES - 1);                 // 0 intro, 1..5 layers, 6 outro
    const active = Math.round(s) - 1;                // layer in focus (-1 none)
    const outro = smooth((s - 5.18) / 0.4);          // 0 -> 1 as the layers collapse into one card (early in the last stage)
    const spread = Math.min(1, s) * (1 - outro);
    const gap = 0.14 + 0.74 * Math.max(0, spread);

    // pointer parallax: spring towards the target tilt
    if (!reduceMotion) {
      const k = 40, d = 11;
      for (const [a, v, tg] of [["x", "vx", "tx"], ["y", "vy", "ty"]]) {
        this.tilt[v] += ((this.tilt[tg] - this.tilt[a]) * k - this.tilt[v] * d) * dt;
        this.tilt[a] += this.tilt[v] * dt;
      }
      this.tiltGroup.rotation.set(this.tilt.x, this.tilt.y, 0);
    }

    // dust drifts slowly
    if (!reduceMotion) {
      const arr = this.dust.geometry.attributes.position.array;
      for (let i = 0; i < PARTICLES; i++) {
        const sd = this.dustSeed[i];
        arr[i * 3] = sd[0] + Math.sin(t * 0.05 * sd[4] + sd[3]) * 0.6;
        arr[i * 3 + 1] = sd[1] + Math.sin(t * 0.08 * sd[4] + sd[3] * 2) * 0.4;
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
    }

    if (this.ready) {
      // hover: which layer is under the pointer
      let hit = -1;
      if (this.ndc.x <= 1 && outro < 0.5) {
        this.raycaster.setFromCamera(this.ndc, this.camera);
        const hits = this.raycaster.intersectObjects(this.layers.map((L) => L.slab), false);
        if (hits.length) hit = hits[0].object.userData.layer;
      }
      if (hit !== this.hovered) {
        this.hovered = hit;
        this.renderer.domElement.style.cursor = hit >= 0 ? "pointer" : "";
        if (hit < 0 && this.opts.onHover) this.opts.onHover(null, 0, 0);
      }

      const v = new THREE.Vector3();
      this.layers.forEach((L, i) => {
        const focus = i === active ? 1 : 0;
        this.hoverAmt[i] += ((i === this.hovered ? 1 : 0) - this.hoverAmt[i]) * Math.min(1, dt * 10);
        const lift = this.hoverAmt[i] * 0.14;
        const z = (2 - i) * gap * (1 - outro) + lift;
        L.slab.position.set(focus * 0.22 * (1 - outro), focus * 0.16 * (1 - outro), z);
        const k = 1 + focus * 0.05 + outro * (i === 4 ? 0.1 : 0);
        L.slab.scale.setScalar(L.slab.scale.x + (k - L.slab.scale.x) * 0.15);
        // edges: mist at rest, brighter on hover, defect on the focused layer, amber on the final card
        const edgeCol = i === 4 && outro > 0.3 ? glow(C.amber, 2.4) : focus ? glow(C.defect, 2) : glow(C.mist, 1.1 + this.hoverAmt[i] * 1.2);
        L.edge.material.color.copy(edgeCol);
        const fade = i < 4 ? 1 - outro : 1;            // the outro keeps only the last layer, as one glowing card
        L.face.material.opacity = (active < 0 || focus || s > 5.2 ? 1 : 0.6) * fade;
        L.glass.opacity = (this.degraded ? 0.8 : 0.92) * fade;
        L.edge.material.opacity = 0.85 * fade;
        L.slab.visible = fade > 0.35;   // coplanar fading glass would stack its reflections on the final card
        if (i === 4) { L.glass.envMapIntensity = 0.55 - outro * 0.4; L.glass.clearcoat = 1 - outro * 0.7; }
        if (i === 4) L.face.material.map = outro > 0.4 ? this.finalTex : L.map;
      });
      if (this.hovered >= 0 && this.opts.onHover) {   // tag position: the hovered layer's corner, in page pixels
        const L = this.layers[this.hovered];
        L.slab.localToWorld(v.set(W / 2, H / 2, 0)).project(this.camera);
        const b = this.renderer.domElement.getBoundingClientRect();
        this.opts.onHover(this.hovered, b.left + (v.x + 1) / 2 * b.width, b.top + (1 - v.y) / 2 * b.height);
      }

      // patches light up in a wave while layer 2 is in focus
      const wave = active === 1 ? 1 : 0.25;
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
        const w = reduceMotion ? 0.6 : 0.5 + 0.5 * Math.sin(t * 2.4 - (x + y) * 0.35);
        const b = 0.35 + wave * w * 0.9;
        this.tileColor.setHex(C.sage).lerp(new THREE.Color(C.mist), w * wave).multiplyScalar(0.7 + b);
        this.tiles.setColorAt(y * GRID + x, this.tileColor);
      }
      this.tiles.instanceColor.needsUpdate = true;
      this.tiles.material.opacity = 0.9 * (1 - outro);

      // memory: from the patch layer up into clusters on the memory layer (stage 3 onwards)
      const arr = this.memory.geometry.attributes.position.array;
      const from = this.layers[1].slab.position.z + DEPTH, to = this.layers[2].slab.position.z + DEPTH;
      const flow = clamp01((s - 2.3) * 1.2);
      this.memSeeds.forEach((m, i) => {
        const f = smooth(flow * 1.4 - m.d * 0.4);
        arr[i * 3] = m.sx + (m.cx - m.sx) * f;
        arr[i * 3 + 1] = m.sy + (m.cy - m.sy) * f;
        arr[i * 3 + 2] = from + (to - from) * f + (reduceMotion ? 0 : Math.sin(t * 2 + i) * 0.008);
      });
      this.memory.geometry.attributes.position.needsUpdate = true;
      this.memory.material.opacity = s > 2.2 ? 0.9 * (1 - outro) : 0;

      // comparison: scan sweeps, then the heat spot appears
      const sweep = clamp01(s - 3.5);
      this.scan.visible = s > 3.4 && s < 4.7;
      this.scan.position.set(0, H * 0.46 - sweep * H * 0.92, DEPTH / 2 + 0.02);
      this.heatSpot.material.opacity = clamp01((sweep - 0.4) * 2) * (1 - outro);

      // decision: ring pulse + pin drop
      const decide = clamp01((s - 4.5) * 2);
      const pulse = reduceMotion ? 0.5 : (t * 0.9) % 1;
      this.ring.scale.setScalar(0.8 + pulse * 0.9);
      this.ring.material.opacity = decide * (1 - pulse) * 0.9;
      const dec = this.layers[4].slab.position;
      this.pin.visible = s > 4.5;
      this.pin.position.set(dec.x + (SPOT.x - 0.5) * W * 0.94, dec.y + (0.5 - SPOT.y) * H * 0.92, dec.z + 0.55 + (1 - smooth(decide)) * 1.3);

      // data stream: a few particles travel from one layer to the next during each transition
      const sa = Math.floor(s), frac = s - sa, from2 = sa - 1;
      const streamOn = !reduceMotion && sa >= 1 && sa <= 4 && frac > 0.2 && frac < 0.85;
      this.stream.visible = streamOn;
      if (streamOn) {
        const za = this.layers[from2].slab.position.z, zb = this.layers[from2 + 1].slab.position.z;
        const sp = this.stream.geometry.attributes.position.array;
        this.streamSeeds.forEach(([x, y, o], i) => {
          const q = ((frac - 0.2) / 0.65 + o * 0.6) % 1;
          sp[i * 3] = x * (1 - q * 0.4); sp[i * 3 + 1] = y * (1 - q * 0.4); sp[i * 3 + 2] = za + (zb - za) * q;
        });
        this.stream.geometry.attributes.position.needsUpdate = true;
      }

      this.shadow.material.opacity = 0.9 - spread * 0.35;
    }

    // the stack: slow turn at rest (more in the intro), flatter for the final card
    const intro = reduceMotion ? (s < 0.5 ? 1 : 0) : clamp01(1 - s);
    const spin = reduceMotion ? 0 : Math.sin(t * 0.25) * 0.05 + intro * Math.sin(t * 0.18) * 0.12;
    this.stack.rotation.set(-0.95 + outro * 0.35, 0, 0.42 + spin + this.p * 0.5 - outro * 0.9);   // keep a little tilt: flat to the camera mirrors the light
    const focusZ = active >= 0 && this.ready ? this.layers[Math.min(active, 4)].slab.position.z : 0;
    this.lookAt.lerp(new THREE.Vector3(0, focusZ * 0.55 * (1 - outro), 0), reduceMotion ? 1 : 0.08);
    const narrow = this.host.clientWidth <= 820;
    const fit = narrow ? Math.min(2, Math.max(1, 0.9 / this.camera.aspect)) : 1;   // portrait phones: step back so the stack fits
    const dist = (7.4 - Math.min(1, s) * 1.2 + outro * 0.6) * fit;
    this.camera.position.lerp(new THREE.Vector3(Math.sin(this.p * 1.6) * 1.2 * (1 - outro), 1.2 + focusZ * 0.55 * (1 - outro), dist), reduceMotion ? 1 : 0.08);
    this.camera.lookAt(this.lookAt);

    // intro: the stack sits in the right half (view offset = screen-space shift), easing back into stage 1
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const ease = smooth(intro);
    const shift = STAGE_SHIFT + (INTRO_SHIFT - STAGE_SHIFT) * ease;
    if (w > 820 && h) this.camera.setViewOffset(w, h, -shift * w, 0, w, h);
    else if (h) this.camera.setViewOffset(w, h, 0, 0.16 * h, w, h);   // phones: the stack sits above the caption

    if (this.degraded) this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
    if ((this.frames = (this.frames || 0) + 1) % 10 === 0) {   // for checks: draw calls per frame and whether it degraded
      this.host.dataset.calls = String(this.renderer.info.render.calls);
      this.host.dataset.degraded = String(this.degraded);
      if (this.ready) {   // the stack's on-screen box (CSS px of the canvas), for the "no text over the 3D" check
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; const v = new THREE.Vector3();
        const cw = this.host.clientWidth, ch = this.host.clientHeight;
        this.layers.forEach((L) => { if (!L.slab.visible) return; for (const x of [-W / 2, W / 2]) for (const y of [-H / 2, H / 2]) for (const z of [-DEPTH / 2, DEPTH / 2]) {
          L.slab.localToWorld(v.set(x, y, z)).project(this.camera);
          const px = (v.x + 1) / 2 * cw, py = (1 - v.y) / 2 * ch;
          minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        } });
        this.host.dataset.stack = [minX, minY, maxX, maxY].map(Math.round).join(",");
      }
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.resizeObserver.disconnect();
    this.io.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pointermove", this.onWindowPointer);
    window.removeEventListener("deviceorientation", this.onOrientation);
    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.onCanvasPointer); el.removeEventListener("pointerleave", this.onCanvasLeave); el.removeEventListener("click", this.onCanvasClick);
    const textures = new Set([this.bg, this.sprite, this.env, this.finalTex, this.heatTex]);
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((mm) => { if (mm.map) textures.add(mm.map); mm.dispose(); });
    });
    this.layers.forEach((L) => textures.add(L.map));
    textures.forEach((tx) => tx && tx.dispose());
    this.disposables.forEach((g) => g.dispose());
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    el.remove();
  }
}
