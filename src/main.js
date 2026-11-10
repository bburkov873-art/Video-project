import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import * as S from './shaders.js';

const Q = new URLSearchParams(location.search);
const W = +Q.get('w') || 1080, H = +Q.get('h') || 1920;
const TEXQ = +Q.get('texq') || 1;
const SAMPLES = Q.has('samples') ? +Q.get('samples') : 4;
const DURATION = 65;

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Everything is a pure function of time, so frames can be rendered in any order.
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const rand = mulberry32(20261110);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, W / H, 0.5, 400000);
scene.add(camera);

// ---------- layout (stylised distances, sun at origin) ----------
const P = {
  mercury: V3(220, 0, 30), venus: V3(340, 6, -45), earth: V3(500, 0, 35), mars: V3(660, -6, -35),
  jupiter: V3(1080, 0, 70), saturn: V3(1450, 0, -90), uranus: V3(1760, 12, 70), neptune: V3(1960, -10, -60),
};
P.moon = P.earth.clone().add(V3(8, 20, 10));
const SAT_TILT = 15 * Math.PI / 180;
const satN = V3(-Math.sin(SAT_TILT), Math.cos(SAT_TILT), 0);
const satU = V3(Math.cos(SAT_TILT), Math.sin(SAT_TILT), 0);
// point in Saturn's ring frame: a = along the sun line, b = sideways, h = height above the rings
const sat = (a, b, h) => P.saturn.clone().addScaledVector(satU, a).add(V3(0, 0, b)).addScaledVector(satN, h);
const cometAt = (t) => V3(800, 42, 190).addScaledVector(V3(-5, -0.6, -2.5), t - 27.5);
const issAt = (t) => V3(501, 6.5, 57).addScaledVector(V3(9.5, -0.2, -1.6), t - 18.5);

// ---------- camera choreography ----------
function track(keys) {
  const n = keys.length;
  const m = keys.map((k, i) => {
    const a = keys[Math.max(i - 1, 0)], b = keys[Math.min(i + 1, n - 1)];
    // a repeated key is a hold: zero tangent there, so the value neither drifts nor overshoots
    if (i > 0 && i < n - 1 && (a[1].equals(k[1]) || b[1].equals(k[1]))) return V3();
    return b[1].clone().sub(a[1]).divideScalar(b[0] - a[0]);
  });
  return (t, out) => {
    t = clamp(t, keys[0][0], keys[n - 1][0]);
    let i = 0; while (i < n - 2 && t > keys[i + 1][0]) i++;
    const [t0, p0] = keys[i], [t1, p1] = keys[i + 1];
    const dt = t1 - t0, s = (t - t0) / dt, s2 = s * s, s3 = s2 * s;
    return out.set(0, 0, 0)
      .addScaledVector(p0, 2 * s3 - 3 * s2 + 1).addScaledVector(m[i], dt * (s3 - 2 * s2 + s))
      .addScaledVector(p1, -2 * s3 + 3 * s2).addScaledVector(m[i + 1], dt * (s3 - s2));
  };
}

const posTrack = track([
  [0, V3(-80, 45, 340)], [3, V3(30, 32, 235)],
  [6, V3(192, 5, 54)], [8, V3(238, 5, 2)],                      // Mercury
  [10.5, V3(316, 10, -10)], [12.5, V3(372, 12, -20)],           // Venus
  [15, V3(455, 4, 5)], [17.5, V3(488, 8, 68)], [20, V3(522, 6, 62)], [22, V3(560, 4, 30)], // Earth
  [24.5, V3(636, -2, -12)], [26.5, V3(690, 4, -5)],             // Mars
  [29, V3(800, 14, 30)],                                        // asteroid belt
  [31, V3(930, 15, -20)], [34, V3(1050, 30, -95)], [37, V3(1200, 25, -60)], // Jupiter arc
  [39.5, sat(-150, 55, 40)], [42, sat(-88, 62, 12)], [44.5, sat(-25, 68, 8)], [46.5, sat(40, 66, 9)], [48.5, sat(120, 60, 25)],
  [51, V3(1712, 22, 28)], [53.5, V3(1840, 6, 5)],               // Uranus
  [55, V3(1915, -4, -12)], [56.5, V3(1985, 5, 20)],             // Neptune
  [58, V3(2100, 40, 60)], [65, V3(2500, 150, 200)],
]);
const lookTrack = track([
  [0, V3(0, 0, 0)], [3.5, V3(40, 0, 10)],
  [5.5, P.mercury], [7.2, P.mercury],
  [8.8, P.venus], [11.4, P.venus],
  [13.4, P.earth], [20.5, P.earth],
  [23.5, P.mars], [25.5, P.mars],
  [27.3, cometAt(27.3)], [28.2, cometAt(28.2)],
  [30.5, P.jupiter], [35.5, P.jupiter],
  [38.5, P.saturn], [41, sat(0, 25, 0)], [44, sat(60, 22, 2)], [46.5, sat(150, 45, 10)],
  [49, P.uranus], [51.8, P.uranus],
  [53.5, P.neptune], [55.5, P.neptune],
  [58.5, V3(600, 0, 0)], [60, V3(0, 0, 0)], [65, V3(0, 0, 0)],
]);
const PULL_DIR = V3(1, 0.3, 0.35).normalize();
const camPos = (t, out) => {
  posTrack(t, out);
  const tau = Math.max(t - 57, 0);
  return out.addScaledVector(PULL_DIR, 20 * tau ** 4); // accelerating pull-back
};

// ---------- texture baking ----------
const bakeScene = new THREE.Scene(), bakeCam = new THREE.Camera();
const bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
bakeQuad.frustumCulled = false; bakeScene.add(bakeQuad);
function bake(type, w, uA = V3(0, 1, 0), uB = V3(1, 0, 0), float = false) {
  w = Math.round(w * TEXQ); const h = w / 2;
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: float ? THREE.HalfFloatType : THREE.UnsignedByteType,
    minFilter: float ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: !float, wrapS: THREE.RepeatWrapping, depthBuffer: false,
  });
  rt.texture.anisotropy = 8;
  bakeQuad.material = new THREE.ShaderMaterial({
    vertexShader: S.BAKE_VS, fragmentShader: S.NOISE + S.BAKE_FS, defines: { TYPE: type },
    uniforms: { uA: { value: uA }, uB: { value: uB } },
  });
  renderer.setRenderTarget(rt); renderer.render(bakeScene, bakeCam); renderer.setRenderTarget(null);
  bakeQuad.material.dispose();
  return rt.texture;
}
const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;

// ---------- sky ----------
const sky = new THREE.Group(); scene.add(sky);
const GAL_N = V3(0.25, 0.9, -0.3).normalize();
const GAL_CORE = V3(1, 0.1, 0.25).projectOnPlane(GAL_N).normalize();
const skyMat = new THREE.ShaderMaterial({
  vertexShader: S.UV_VS, fragmentShader: S.SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false,
  uniforms: { map: { value: bake(10, 4096, GAL_N, GAL_CORE, true) }, uI: { value: 1 } },
});
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(45000, 64, 32), skyMat);
skyMesh.renderOrder = -10; skyMesh.frustumCulled = false; sky.add(skyMesh);

const starMat = new THREE.ShaderMaterial({
  vertexShader: S.STAR_VS, fragmentShader: S.STAR_FS, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  uniforms: { uScale: { value: H / 1920 }, uTime: { value: 0 } },
});
{
  const N = 22000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), ph = new Float32Array(N);
  const d = V3(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    d.set(gauss(), gauss(), gauss()).normalize();
    const inBand = i > N * 0.42;
    if (inBand) d.projectOnPlane(GAL_N).normalize().addScaledVector(GAL_N, gauss() * 0.15).normalize();
    d.multiplyScalar(40000).toArray(pos, i * 3);
    const big = Math.pow(rand(), 9);
    size[i] = (inBand ? 1.6 : 2.0) + rand() * 1.6 + big * 7;
    const tint = rand();
    if (tint < 0.55) c.setRGB(0.72, 0.84, 1.0); else if (tint < 0.85) c.setRGB(1, 1, 1); else c.setRGB(1.0, 0.84, 0.66);
    const b = (0.25 + 0.75 * Math.pow(rand(), 2.2)) * (inBand ? 0.75 : 1) + big * 2.2;
    col[i * 3] = c.r * b; col[i * 3 + 1] = c.g * b; col[i * 3 + 2] = c.b * b;
    ph[i] = rand();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const stars = new THREE.Points(g, starMat); stars.frustumCulled = false; stars.renderOrder = -9; sky.add(stars);
}

// ---------- helpers ----------
const billboards = [];
function glow(size, color, core, { I = 1, A = 6, B = 40 } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    vertexShader: S.UV_VS, fragmentShader: S.GLOW_FS, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    uniforms: { color: { value: new THREE.Color(...color) }, core: { value: new THREE.Color(...core) }, uI: { value: I }, uA: { value: A }, uB: { value: B } },
  }));
  m.scale.setScalar(size); m.frustumCulled = false; billboards.push(m);
  return m;
}

// ---------- sun ----------
const sunMat = new THREE.ShaderMaterial({ vertexShader: S.WORLD_VS, fragmentShader: S.NOISE + S.SUN_FS, uniforms: { uTime: { value: 0 } } });
scene.add(new THREE.Mesh(new THREE.SphereGeometry(25, 64, 32), sunMat));
const sunHalo = glow(520, [0.5, 0.6, 1.0], [1.0, 0.66, 0.34], { I: 0.55, A: 7, B: 60 });
sunHalo.material.uniforms.core.value.multiplyScalar(1.6);
scene.add(sunHalo);
scene.add(new THREE.PointLight(0xfff2dd, 4, 0, 0));
scene.add(new THREE.AmbientLight(0x243a66, 0.25));
const earthShine = new THREE.PointLight(0x4a7dff, 1.6, 120, 0); earthShine.position.set(500, 0, 35); scene.add(earthShine);

// ---------- planets ----------
const sphereGeo = new THREE.SphereGeometry(1, 128, 64);
const planets = {};
function makePlanet(name, o) {
  const group = new THREE.Group(); group.position.copy(P[name]);
  const axis = (o.axis || V3(0, 1, 0)).clone().normalize();
  group.quaternion.setFromUnitVectors(V3(0, 1, 0), axis);
  const ring = o.ring || { kind: 0, inner: 1, outer: 2 };
  const ringU = { ringKind: { value: ring.kind }, ringIn: { value: ring.inner }, ringOut: { value: ring.outer }, center: { value: P[name] }, ringN: { value: axis } };
  const mat = new THREE.ShaderMaterial({
    vertexShader: S.WORLD_VS, fragmentShader: S.RING + S.PLANET_FS,
    uniforms: {
      map: { value: bake(o.type, o.tex || 2048, o.uA) }, nightMap: { value: o.night ? bake(o.night, o.tex) : black }, hasNight: { value: o.night ? 1 : 0 },
      spec: { value: o.spec || 0 }, atmColor: { value: new THREE.Color(...(o.atm || [0, 0, 0])) }, atmPow: { value: o.atmPow || 3 }, atmStr: { value: o.atmStr || 0 },
      ...ringU,
    },
  });
  const body = new THREE.Mesh(sphereGeo, mat); body.scale.setScalar(o.r); body.rotation.y = o.spin0 || 0; group.add(body);
  if (o.shell) {
    const s = o.shell.scale;
    const shell = new THREE.Mesh(sphereGeo, new THREE.ShaderMaterial({
      vertexShader: S.WORLD_VS, fragmentShader: S.ATMO_FS, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      uniforms: { color: { value: new THREE.Color(...o.shell.color) }, str: { value: o.shell.str }, muL: { value: Math.sqrt(1 - 1 / (s * s)) } },
    }));
    shell.scale.setScalar(o.r * s); group.add(shell);
  }
  if (o.ring) {
    const rings = new THREE.Mesh(new THREE.RingGeometry(ring.inner, ring.outer, 256, 1), new THREE.ShaderMaterial({
      vertexShader: S.RING_VS, fragmentShader: S.RING + S.RING_FS, side: THREE.DoubleSide, transparent: true, depthWrite: false,
      uniforms: { ...ringU, planetR: { value: o.r } },
    }));
    rings.rotation.x = -Math.PI / 2; group.add(rings);
  }
  // tiny glow so the planet stays readable during the final pull-back
  const marker = glow(1, o.dot || [0.6, 0.75, 1], o.dot || [0.6, 0.75, 1], { I: 0, A: 5, B: 30 });
  marker.position.copy(P[name]); scene.add(marker);
  scene.add(group);
  planets[name] = { group, body, marker, spin: o.spin || 0.01, spin0: o.spin0 || 0, r: o.r };
}
makePlanet('mercury', { type: 0, r: 5, spin: 0.004 });
makePlanet('venus', { type: 1, r: 9, atm: [1.0, 0.85, 0.5], atmStr: 0.55, shell: { color: [1.0, 0.78, 0.42], scale: 1.07, str: 0.7 }, dot: [1, 0.85, 0.6] });
makePlanet('earth', { type: 2, night: 3, tex: 4096, r: 10, spec: 0.9, axis: V3(0.24, 0.92, 0.2), spin0: 2.2, spin: 0.012, atm: [0.3, 0.55, 1.0], atmPow: 2.6, atmStr: 0.5, shell: { color: [0.22, 0.48, 1.0], scale: 1.06, str: 0.6 }, dot: [0.4, 0.65, 1] });
makePlanet('moon', { type: 4, r: 2.7, spin: 0.002 });
makePlanet('mars', { type: 5, r: 6, axis: V3(0.3, 0.9, -0.2), atm: [0.95, 0.55, 0.32], atmStr: 0.22, shell: { color: [0.9, 0.5, 0.3], scale: 1.035, str: 0.3 }, dot: [1, 0.55, 0.35] });
makePlanet('jupiter', { type: 6, tex: 4096, r: 45, uA: V3(-0.78, -0.36, -0.5), axis: V3(0.05, 1, 0.02), spin: 0.012, atm: [0.8, 0.72, 0.62], atmStr: 0.22, shell: { color: [0.7, 0.66, 0.62], scale: 1.02, str: 0.35 }, dot: [1, 0.85, 0.7] });
makePlanet('saturn', { type: 7, r: 38, axis: satN, ring: { kind: 1, inner: 48, outer: 90 }, atm: [0.9, 0.8, 0.6], atmStr: 0.22, shell: { color: [0.85, 0.75, 0.55], scale: 1.02, str: 0.3 }, dot: [1, 0.9, 0.7] });
makePlanet('uranus', { type: 8, r: 18, axis: V3(-0.8, 0.3, 0.52), ring: { kind: 2, inner: 29, outer: 37 }, atm: [0.5, 0.9, 1.0], atmStr: 0.5, shell: { color: [0.4, 0.85, 1.0], scale: 1.04, str: 0.6 }, dot: [0.55, 0.9, 1] });
makePlanet('neptune', { type: 9, r: 17, uA: V3(-0.55, -0.3, 0.75), axis: V3(0.3, 0.9, 0.25), atm: [0.3, 0.5, 1.0], atmStr: 0.6, shell: { color: [0.25, 0.45, 1.0], scale: 1.04, str: 0.7 }, dot: [0.35, 0.5, 1] });

// ---------- orbit lines (pull-back only) ----------
const orbitMat = new THREE.LineBasicMaterial({ color: 0x5a8cff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
for (const name of Object.keys(planets)) {
  if (name === 'moon') continue;
  const a = P[name].clone().normalize(), b = V3().crossVectors(a, V3(0, 1, 0)).normalize(), R = P[name].length(), pts = [];
  for (let i = 0; i < 360; i++) { const th = i / 360 * Math.PI * 2; pts.push(a.clone().multiplyScalar(R * Math.cos(th)).addScaledVector(b, R * Math.sin(th))); }
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), orbitMat); line.frustumCulled = false; scene.add(line);
}

// ---------- space station ----------
const iss = new THREE.Group();
{
  const white = new THREE.MeshStandardMaterial({ color: 0xd9dde6, roughness: 0.55, metalness: 0.25 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x23408f, roughness: 0.3, metalness: 0.65, emissive: 0x0a1840 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xcaa24c, roughness: 0.4, metalness: 0.7 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); iss.add(m); return m; };
  add(new THREE.BoxGeometry(4.4, 0.1, 0.1), white, 0, 0, 0);
  const pg = new THREE.BoxGeometry(0.36, 0.012, 1.35), frame = new THREE.BoxGeometry(0.03, 0.03, 2.9);
  for (const side of [-1, 1]) for (const k of [0, 1]) {
    const x = side * (1.25 + k * 0.82);
    add(frame, gold, x, 0, 0);
    for (const dz of [-1, 1]) for (const dx of [-0.2, 0.2]) add(pg, panel, x + dx, 0, dz * 0.78, 0, 0, 0.45);
  }
  const rad = new THREE.BoxGeometry(0.3, 0.012, 0.75);
  for (const side of [-1, 1]) add(rad, white, side * 0.55, 0, -0.5, 0, 0, 1.2);
  const cyl = (r, l) => new THREE.CylinderGeometry(r, r, l, 20);
  add(cyl(0.12, 1.7), white, 0, -0.14, 0.25, Math.PI / 2);
  add(cyl(0.1, 0.9), white, 0.3, -0.14, 0.75, 0, 0, Math.PI / 2);
  add(cyl(0.1, 0.7), gold, -0.25, -0.14, 0.2, 0, 0, Math.PI / 2);
  add(cyl(0.09, 0.6), white, 0, -0.42, 0.9);
  add(new THREE.SphereGeometry(0.15, 16, 12), white, 0, -0.14, 1.12);
  iss.scale.setScalar(0.5);
  scene.add(iss);
}

// ---------- asteroid belt ----------
let belt;
{
  let geo = new THREE.IcosahedronGeometry(1, 3); geo.deleteAttribute("normal"); geo.deleteAttribute("uv"); geo = mergeVertices(geo);
  const p = geo.attributes.position, v = V3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const f = 1 + 0.26 * Math.sin(v.x * 3.1 + 1) * Math.sin(v.y * 2.7 + 2) + 0.2 * Math.sin(v.z * 4.3 + v.x * 2) + 0.1 * Math.sin(v.y * 9 + v.z * 7) + 0.05 * Math.sin(v.x * 17 + v.y * 13) * Math.sin(v.z * 15);
    p.setXYZ(i, v.x * f, v.y * f, v.z * f);
  }
  geo.computeVertexNormals();
  const path = []; for (let t = 25; t <= 33; t += 0.05) path.push(camPos(t, V3()));
  const N = 2600, mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.05, transparent: true }), N);
  belt = mesh;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V3(), c = new THREE.Color(), pos = V3();
  for (let i = 0; i < N;) {
    const th = 0.03 + gauss() * 0.2, R = 745 + rand() * 160, size = 0.25 + 1.5 * Math.pow(rand(), 3);
    pos.set(R * Math.cos(th), 12 + gauss() * 10, R * Math.sin(th));
    if (path.some((c) => c.distanceTo(pos) < size * 2 + 7)) continue; // keep the flight path clear
    q.setFromEuler(new THREE.Euler(rand() * 6.3, rand() * 6.3, rand() * 6.3));
    s.set(size * (0.7 + rand() * 0.6), size * (0.6 + rand() * 0.5), size * (0.7 + rand() * 0.6));
    mesh.setMatrixAt(i, m.compose(pos, q, s));
    const g = 0.13 + rand() * 0.2; mesh.setColorAt(i, c.setRGB(g * 1.08, g, g * 0.9));
    i++;
  }
  mesh.frustumCulled = false; scene.add(mesh);
}

// ---------- comet ----------
const cometHead = glow(26, [0.35, 0.7, 1.0], [0.9, 1.0, 1.0], { I: 1.6, A: 7, B: 70 }); scene.add(cometHead);
const tailGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
function tail(color, I, w0, w1, seed) {
  const m = new THREE.Mesh(tailGeo, new THREE.ShaderMaterial({
    vertexShader: S.UV_VS, fragmentShader: S.NOISE + S.TAIL_FS, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(...color) }, uI: { value: I }, uW0: { value: w0 }, uW1: { value: w1 }, uSeed: { value: seed } },
  }));
  m.matrixAutoUpdate = false; m.frustumCulled = false; scene.add(m); return m;
}
const ionTail = tail([0.25, 0.55, 1.0], 1.1, 0.04, 0.2, 1.7);
const dustTail = tail([0.85, 0.85, 0.8], 0.7, 0.07, 0.42, 5.3);
const _x = V3(), _y = V3(), _z = V3();
function aimTail(m, origin, dir, len, width) {
  _x.copy(dir).normalize();
  _y.subVectors(camera.position, origin).cross(_x).normalize();
  _z.crossVectors(_x, _y);
  m.matrix.makeBasis(_x.multiplyScalar(len), _y.multiplyScalar(width), _z).setPosition(origin);
  m.matrixWorldNeedsUpdate = true;
}

// ---------- shooting stars (camera space, behind the planets) ----------
const streakGeo = new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0);
const streaks = [
  [48.7, 1.0, -500, 1250, 420, 520], [50.3, 0.9, 700, 900, -150, 150], [51.6, 1.1, -750, 300, 250, -450],
  [52.9, 0.8, 200, 1350, 800, 700], [54.1, 1.0, 750, -200, -200, -1000], [55.2, 0.9, -650, 1100, 150, 450], [56.3, 1.0, 500, 1300, -400, 500],
].map(([t0, dur, x0, y0, x1, y1]) => {
  const mesh = new THREE.Mesh(streakGeo, new THREE.ShaderMaterial({
    vertexShader: S.UV_VS, fragmentShader: S.STREAK_FS, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, uniforms: { uI: { value: 0 } },
  }));
  mesh.rotation.z = Math.atan2(y1 - y0, x1 - x0); mesh.scale.set(520, 26, 1); mesh.frustumCulled = false; camera.add(mesh);
  return { mesh, t0, dur, x0, y0, x1, y1 };
});

// ---------- post ----------
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: SAMPLES }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.45, 0.85, 0.8));
const grade = new ShaderPass(new THREE.ShaderMaterial({
  vertexShader: S.UV_VS, fragmentShader: S.GRADE_FS,
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 1 }, uRes: { value: new THREE.Vector2(W, H) } },
}));
composer.addPass(grade);

// ---------- per-frame state ----------
const _look = V3(), _c = V3(), _d = V3();
function update(t) {
  camPos(t, camera.position);
  camera.up.set(0, 1, 0);
  camera.lookAt(lookTrack(t, _look));
  camera.rotateZ(0.035 * Math.sin(t * 0.31 + 1));
  camera.updateMatrixWorld();

  sky.position.copy(camera.position);
  starMat.uniforms.uTime.value = t;
  sunMat.uniforms.uTime.value = t;
  sunHalo.scale.setScalar(520 + camera.position.length() * 0.05);
  sunHalo.material.uniforms.uI.value = 0.55 + 2.6 * sstep(3000, 30000, camera.position.length()); // keep the final dot glowing

  const far = sstep(58, 60.5, t);
  for (const pl of Object.values(planets)) {
    pl.body.rotation.y = pl.spin0 + t * pl.spin;
    pl.marker.material.uniforms.uI.value = far * 1.3;
    pl.marker.scale.setScalar(Math.max(camera.position.distanceTo(pl.marker.position) * 0.012, pl.r * 2.5));
  }
  orbitMat.opacity = 0.5 * far * (1 - sstep(62.3, 64.2, t));

  iss.position.copy(issAt(t));
  iss.rotation.set(0.5 + t * 0.03, 0.9 + t * 0.05, 0.25);

  // belt and comet only exist around their own scene; from afar they read as clutter
  belt.material.opacity = sstep(20.5, 23.5, t) * (1 - sstep(33, 35.5, t));
  belt.visible = belt.material.opacity > 0;
  const ck = sstep(22, 25, t) * (1 - sstep(31, 33, t));
  cometHead.material.uniforms.uI.value = 1.6 * ck; ionTail.material.uniforms.uI.value = 1.1 * ck; dustTail.material.uniforms.uI.value = 0.7 * ck;
  _c.copy(cometAt(t));
  cometHead.position.copy(_c);
  _d.copy(_c).normalize();
  aimTail(ionTail, _c, _d, 135, 40);
  aimTail(dustTail, _c, _d.add(V3(0.03, 0.2, 0.12)), 85, 60);

  for (const b of billboards) b.quaternion.copy(camera.quaternion);

  for (const s of streaks) {
    const k = (t - s.t0) / s.dur, on = k > 0 && k < 1;
    s.mesh.visible = on;
    if (!on) continue;
    s.mesh.position.set(s.x0 + (s.x1 - s.x0) * k, s.y0 + (s.y1 - s.y0) * k, -3000);
    s.mesh.material.uniforms.uI.value = Math.sin(Math.PI * k) ** 1.5 * 2.2;
  }

  grade.uniforms.uTime.value = t;
  grade.uniforms.uFade.value = sstep(0, 2.8, t) * (1 - sstep(62.8, 64.9, t));
}

window.DURATION = DURATION;
window.renderFrame = (t, quality = 0.97) => { update(t); composer.render(); return canvas.toDataURL('image/jpeg', quality); };
// screen position (NDC) and distance of the small props, for tuning the choreography
window.debugAt = (t) => {
  update(t);
  const out = {}, v = V3();
  const probe = (k, p) => { v.copy(p).project(camera); out[k] = [+v.x.toFixed(2), +v.y.toFixed(2), +p.distanceTo(camera.position).toFixed(1), v.z < 1 ? 'front' : 'behind']; };
  probe('iss', iss.position); probe('comet', cometHead.position); probe('moon', P.moon); probe('sun', V3(0, 0, 0));
  return out;
};
window.ready = true;

// Opened by hand (not driven by render.mjs): play in real time.
if (!navigator.webdriver) {
  const t0 = performance.now();
  const loop = () => { update(((performance.now() - t0) / 1000) % DURATION); composer.render(); requestAnimationFrame(loop); };
  loop();
}
