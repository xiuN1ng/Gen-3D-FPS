import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CombatFeelVfxController } from './combatFeelVfx.ts';
import type { EcsCombatBridge } from './ecsCombatBridge.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type TacticalPropKind = 'sake_cask' | 'updraft_vent' | 'spirit_gong';

export interface TacticalPropRaycastHit {
  propIndex: number;
  kind: TacticalPropKind;
  dist: number;
  point: THREE.Vector3;
}

export interface TacticalPropTriggerOutcome {
  triggered: boolean;
  kind: TacticalPropKind | null;
  enemiesHit: number;
  kills: number;
  bossHit: boolean;
  playerHealed: number;
  ultGainPct: number;
}

export interface TacticalArenaCallbacks {
  onPlayerHeal?: (amount: number) => void;
  onGrantUltCharge?: (pct: number) => void;
  onUpdraftLaunch?: (ventPos: THREE.Vector3) => void;
  onEnemyHit?: (enemy: any, damage: number, killed: boolean, point: THREE.Vector3) => void;
  cleaveColossalBoss?: (
    center: THREE.Vector3,
    radius: number,
    amount: number,
    dir: THREE.Vector3,
    source: string
  ) => { hit: boolean; killed: boolean; orbShattered: boolean };
  onHudNotice?: (feedHtml: string, warnText?: string) => void;
  onAudioCue?: (kind: 'cask_boom' | 'updraft' | 'gong_ring') => void;
}

export interface TacticalArenaDiagnostics {
  totalProps: number;
  aliveCasks: number;
  readyGongs: number;
  updraftVents: number;
  updraftBuffSec: number;
  caskDetonations: number;
  gongRings: number;
  updraftLaunches: number;
}

export interface TacticalArenaController {
  readonly root: THREE.Group;
  raycast: (
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist: number
  ) => TacticalPropRaycastHit | null;
  triggerHit: (
    propIndex: number,
    damage: number,
    hitPoint?: { x: number; y: number; z: number } | null,
    hitDir?: { x: number; y: number; z: number } | null
  ) => TacticalPropTriggerOutcome;
  damageSphere: (
    center: { x: number; y: number; z: number },
    radius: number,
    damage: number
  ) => number;
  update: (dt: number, player?: any) => void;
  onWaveStart: () => void;
  setModifiers: (opts: { cooldownScale?: number; damageMult?: number }) => void;
  getUpdraftBuffRemaining: () => number;
  getDamageMultiplier: () => number;
  getDiagnostics: () => TacticalArenaDiagnostics;
  reset: () => void;
  dispose: () => void;
}

interface PropPlacementSpec {
  kind: TacticalPropKind;
  x: number;
  y: number;
  z: number;
}

const PROP_PLACEMENTS: readonly PropPlacementSpec[] = [
  // 6 Explosive Vermilion Raijin Sake Casks (`朱漆雷火酒樽`) across Stages 1, 2 & 3
  { kind: 'sake_cask', x: -44.5, y: 0.0, z: -4.6 },
  { kind: 'sake_cask', x: -25.5, y: 0.0, z: 5.2 },
  { kind: 'sake_cask', x: -6.2, y: 0.0, z: 8.4 },
  { kind: 'sake_cask', x: 14.8, y: 0.0, z: -8.2 },
  { kind: 'sake_cask', x: 31.2, y: 2.8, z: 7.6 },
  { kind: 'sake_cask', x: 49.2, y: 5.2, z: -9.2 },

  // 4 Fūjin Spirit Updraft Vents (`灵风上升踏台`) bridging ground -> high ground
  { kind: 'updraft_vent', x: -31.5, y: 0.0, z: -9.5 },
  { kind: 'updraft_vent', x: -4.8, y: 0.0, z: -19.5 },
  { kind: 'updraft_vent', x: 21.2, y: 0.0, z: 11.5 },
  { kind: 'updraft_vent', x: 43.8, y: 2.8, z: -11.5 },

  // 4 Sacred Resonance Spirit Gongs (`古寺清心梵钟`) at tactical courtyard junctions
  { kind: 'spirit_gong', x: -52.0, y: 0.0, z: 8.8 },
  { kind: 'spirit_gong', x: 4.2, y: 0.0, z: 14.5 },
  { kind: 'spirit_gong', x: -11.5, y: 3.2, z: -37.5 },
  { kind: 'spirit_gong', x: 55.0, y: 5.2, z: 11.8 },
];

const CASK_COUNT = 6;
const VENT_COUNT = 4;
const GONG_COUNT = 4;
const TOTAL_PROPS = PROP_PLACEMENTS.length;
const MAX_PROP_RINGS = 12;

const CASK_MAX_HP = 35;
const CASK_BLAST_RADIUS = 6.5;
const CASK_BLAST_DAMAGE = 210;
const CASK_RESPAWN_SEC = 24.0;

const GONG_COOLDOWN_SEC = 20.0;
const GONG_WAVE_RADIUS = 10.5;
const GONG_WAVE_DAMAGE = 85;
const GONG_HEAL_AMOUNT = 42;
const GONG_ULT_GAIN = 12;

const UPDRAFT_TRIGGER_RADIUS = 1.85;
const UPDRAFT_LAUNCH_VEL_Y = 11.4;
const UPDRAFT_BUFF_SEC = 3.2;

function stripToPosNormalUv(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!nonIndexed.getAttribute('normal')) {
    nonIndexed.computeVertexNormals();
  }
  const pos = nonIndexed.getAttribute('position');
  if (!nonIndexed.getAttribute('uv')) {
    const uvs = new Float32Array(pos.count * 2);
    nonIndexed.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  for (const key of Object.keys(nonIndexed.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv') {
      nonIndexed.deleteAttribute(key);
    }
  }
  return nonIndexed;
}

export function createTacticalArenaProps(
  rawG: Record<string, any>,
  cb: TacticalArenaCallbacks = {}
): TacticalArenaController {
  const G = rawG || {};
  const root = new THREE.Group();
  root.name = 'hanamura-tactical-arena-props';
  if (G.scene && typeof G.scene.add === 'function') {
    G.scene.add(root);
  }

  const uClock = { value: 0 };

  // =========================================================================
  // 1. GPU-INSTANCED VERMILION RAIJIN SAKE CASKS (`朱漆雷火酒樽`, 1 Draw Call)
  // =========================================================================
  const caskBody = new THREE.CylinderGeometry(0.42, 0.38, 0.96, 12);
  caskBody.translate(0, 0.49, 0);
  const caskBelly = new THREE.CylinderGeometry(0.47, 0.47, 0.44, 12);
  caskBelly.translate(0, 0.49, 0);
  const caskHoopTop = new THREE.TorusGeometry(0.43, 0.032, 6, 14);
  caskHoopTop.rotateX(Math.PI / 2);
  caskHoopTop.translate(0, 0.80, 0);
  const caskHoopBot = new THREE.TorusGeometry(0.42, 0.032, 6, 14);
  caskHoopBot.rotateX(Math.PI / 2);
  caskHoopBot.translate(0, 0.20, 0);
  const caskCrest = new THREE.OctahedronGeometry(0.16, 0);
  caskCrest.translate(0, 1.12, 0);

  const caskMergedGeo = mergeGeometries(
    [
      stripToPosNormalUv(caskBody),
      stripToPosNormalUv(caskBelly),
      stripToPosNormalUv(caskHoopTop),
      stripToPosNormalUv(caskHoopBot),
      stripToPosNormalUv(caskCrest),
    ],
    false
  );
  caskBody.dispose();
  caskBelly.dispose();
  caskHoopTop.dispose();
  caskHoopBot.dispose();
  caskCrest.dispose();

  const caskMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xc82818),
    emissive: new THREE.Color(0xff5418),
    emissiveIntensity: 0.42,
    roughness: 0.38,
    metalness: 0.22,
  });
  const caskInstMesh = new THREE.InstancedMesh(caskMergedGeo, caskMat, CASK_COUNT);
  caskInstMesh.name = 'tactical-raijin-casks';
  caskInstMesh.frustumCulled = false;
  caskInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(caskInstMesh);

  // =========================================================================
  // 2. GPU-INSTANCED FŪJIN SPIRIT UPDRAFT VENTS (`灵风上升踏台`, 1 Draw Call)
  // =========================================================================
  const ventPlinth = new THREE.CylinderGeometry(1.18, 1.32, 0.14, 16);
  ventPlinth.translate(0, 0.08, 0);
  const ventFunnel = new THREE.CylinderGeometry(1.05, 0.62, 1.45, 16, 1, true);
  ventFunnel.translate(0, 0.82, 0);
  const ventMergedGeo = mergeGeometries(
    [stripToPosNormalUv(ventPlinth), stripToPosNormalUv(ventFunnel)],
    false
  );
  ventPlinth.dispose();
  ventFunnel.dispose();

  const ventShaderMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uClock },
    vertexShader: `
      varying vec2 vUv;
      varying float vLocalY;
      void main() {
        vUv = uv;
        vLocalY = position.y;
        #ifdef USE_INSTANCING
          vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        #endif
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying float vLocalY;
      void main() {
        float heightNorm = clamp(vLocalY / 1.55, 0.0, 1.0);
        float spiral = 0.5 + 0.5 * sin(vUv.x * 25.1327 + heightNorm * 9.0 - uTime * 7.5);
        float verticalFade = (1.0 - smoothstep(0.55, 1.0, heightNorm)) * (0.35 + 0.65 * spiral);
        float baseRim = 1.0 - smoothstep(0.0, 0.16, vLocalY);
        float alpha = clamp(verticalFade * 0.62 + baseRim * 0.55, 0.0, 0.88);
        if (alpha < 0.02) discard;
        vec3 jade = vec3(0.24, 0.98, 0.72);
        vec3 sky = vec3(0.42, 0.92, 1.0);
        vec3 col = mix(jade, sky, heightNorm) * (1.55 + 0.45 * spiral);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const updraftInstMesh = new THREE.InstancedMesh(ventMergedGeo, ventShaderMat, VENT_COUNT);
  updraftInstMesh.name = 'tactical-fujin-updrafts';
  updraftInstMesh.frustumCulled = false;
  updraftInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(updraftInstMesh);

  // =========================================================================
  // 3. GPU-INSTANCED SACRED SPIRIT GONGS (`古寺清心梵钟`, 1 Draw Call)
  // =========================================================================
  const gongPillarL = new THREE.CylinderGeometry(0.075, 0.085, 1.95, 8);
  gongPillarL.translate(-0.62, 0.98, 0);
  const gongPillarR = new THREE.CylinderGeometry(0.075, 0.085, 1.95, 8);
  gongPillarR.translate(0.62, 0.98, 0);
  const gongBeam = new THREE.BoxGeometry(1.58, 0.14, 0.16);
  gongBeam.translate(0, 1.92, 0);
  const gongDisc = new THREE.CylinderGeometry(0.46, 0.46, 0.09, 16);
  gongDisc.rotateX(Math.PI / 2);
  gongDisc.translate(0, 1.24, 0);
  const gongMergedGeo = mergeGeometries(
    [
      stripToPosNormalUv(gongPillarL),
      stripToPosNormalUv(gongPillarR),
      stripToPosNormalUv(gongBeam),
      stripToPosNormalUv(gongDisc),
    ],
    false
  );
  gongPillarL.dispose();
  gongPillarR.dispose();
  gongBeam.dispose();
  gongDisc.dispose();

  const gongMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    emissive: new THREE.Color(0xffb838),
    emissiveIntensity: 0.36,
    roughness: 0.30,
    metalness: 0.72,
  });
  const gongInstMesh = new THREE.InstancedMesh(gongMergedGeo, gongMat, GONG_COUNT);
  gongInstMesh.name = 'tactical-spirit-gongs';
  gongInstMesh.frustumCulled = false;
  gongInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  gongInstMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(GONG_COUNT * 3),
    3
  );
  gongInstMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  root.add(gongInstMesh);

  // =========================================================================
  // 4. TRANSIENT BLAST / SONIC SHOCKWAVE RINGS (`0` DC when idle, `1` DC active)
  // =========================================================================
  const ringPlaneGeo = new THREE.PlaneGeometry(2, 2);
  ringPlaneGeo.rotateX(-Math.PI / 2);
  const ringInstData = new Float32Array(MAX_PROP_RINGS * 4); // (r, g, b, progress)
  const ringInstAttr = new THREE.InstancedBufferAttribute(ringInstData, 4);
  ringInstAttr.setUsage(THREE.DynamicDrawUsage);
  ringPlaneGeo.setAttribute('aRingData', ringInstAttr);

  const ringShaderMat = new THREE.ShaderMaterial({
    vertexShader: `
      attribute vec4 aRingData;
      varying vec2 vLocal;
      varying vec3 vColor;
      varying float vProg;
      void main() {
        vLocal = position.xz;
        vColor = aRingData.xyz;
        vProg = aRingData.w;
        #ifdef USE_INSTANCING
          vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        #endif
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec2 vLocal;
      varying vec3 vColor;
      varying float vProg;
      void main() {
        float r = length(vLocal);
        if (r > 1.0) discard;
        float front = max(0.12, vProg);
        float band = exp(-pow((r - front) * 10.5, 2.0));
        float innerGlow = (1.0 - smoothstep(0.0, front, r)) * 0.22 * (1.0 - vProg);
        float fade = 1.0 - smoothstep(0.65, 1.0, vProg);
        float alpha = (band + innerGlow) * fade;
        if (alpha < 0.015) discard;
        gl_FragColor = vec4(vColor * (2.2 + band * 1.2), clamp(alpha, 0.0, 0.95));
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const shockRingInstMesh = new THREE.InstancedMesh(ringPlaneGeo, ringShaderMat, MAX_PROP_RINGS);
  shockRingInstMesh.name = 'tactical-prop-shock-rings';
  shockRingInstMesh.frustumCulled = false;
  shockRingInstMesh.count = 0;
  shockRingInstMesh.visible = false;
  shockRingInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(shockRingInstMesh);

  // Register batch savings with CombatFeelVfx telemetry if installed!
  const combatVfx = G.combatVfx as CombatFeelVfxController | undefined;
  if (combatVfx && typeof combatVfx.registerBatch === 'function') {
    combatVfx.registerBatch({
      name: 'hanamura_tactical_casks',
      meshes: [caskInstMesh],
      getActiveCount: () => caskInstMesh.count,
      legacyMeshesPerItem: 4,
      eliminatedSceneMeshes: CASK_COUNT * 4 - 1,
    });
    combatVfx.registerBatch({
      name: 'hanamura_tactical_updrafts',
      meshes: [updraftInstMesh],
      getActiveCount: () => updraftInstMesh.count,
      legacyMeshesPerItem: 2,
      eliminatedSceneMeshes: VENT_COUNT * 2 - 1,
    });
    combatVfx.registerBatch({
      name: 'hanamura_tactical_gongs',
      meshes: [gongInstMesh],
      getActiveCount: () => gongInstMesh.count,
      legacyMeshesPerItem: 4,
      eliminatedSceneMeshes: GONG_COUNT * 4 - 1,
    });
    combatVfx.registerBatch({
      name: 'hanamura_tactical_rings',
      meshes: [shockRingInstMesh],
      getActiveCount: () => shockRingInstMesh.count,
      legacyMeshesPerItem: 1,
    });
  }

  // =========================================================================
  // ZERO-GC TYPEDARRAY SOA STATE
  // =========================================================================
  const propKindCode = new Uint8Array(TOTAL_PROPS); // 0=cask, 1=vent, 2=gong
  const propAlive = new Uint8Array(TOTAL_PROPS);
  const propPosX = new Float32Array(TOTAL_PROPS);
  const propPosY = new Float32Array(TOTAL_PROPS);
  const propPosZ = new Float32Array(TOTAL_PROPS);
  const propCenterY = new Float32Array(TOTAL_PROPS);
  const propHitRadius = new Float32Array(TOTAL_PROPS);
  const propHp = new Float32Array(TOTAL_PROPS);
  const propCooldown = new Float32Array(TOTAL_PROPS);
  const propWobbleT = new Float32Array(TOTAL_PROPS);

  const ringActive = new Uint8Array(MAX_PROP_RINGS);
  const ringPosX = new Float32Array(MAX_PROP_RINGS);
  const ringPosY = new Float32Array(MAX_PROP_RINGS);
  const ringPosZ = new Float32Array(MAX_PROP_RINGS);
  const ringMaxR = new Float32Array(MAX_PROP_RINGS);
  const ringAge = new Float32Array(MAX_PROP_RINGS);
  const ringDur = new Float32Array(MAX_PROP_RINGS);
  const ringColR = new Float32Array(MAX_PROP_RINGS);
  const ringColG = new Float32Array(MAX_PROP_RINGS);
  const ringColB = new Float32Array(MAX_PROP_RINGS);
  let ringCursor = 0;

  let updraftBuffTimer = 0;
  let caskDetonations = 0;
  let gongRings = 0;
  let updraftLaunches = 0;
  let cooldownScale = 1.0;
  let propDmgMult = 1.0;

  // Scratch math objects (strictly zero per-frame allocations)
  const _mat4 = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _euler = new THREE.Euler();
  const _scale = new THREE.Vector3(1, 1, 1);
  const _color = new THREE.Color();
  const _hitPtOut = new THREE.Vector3();
  const _blastCenter = new THREE.Vector3();
  const _blastDir = new THREE.Vector3();
  const _ecsCandidates: any[] = [];
  const _rayHitResult: TacticalPropRaycastHit = {
    propIndex: 0,
    kind: 'sake_cask',
    dist: 0,
    point: _hitPtOut,
  };

  function initPropsState() {
    for (let i = 0; i < TOTAL_PROPS; i++) {
      const spec = PROP_PLACEMENTS[i];
      propPosX[i] = spec.x;
      propPosY[i] = spec.y;
      propPosZ[i] = spec.z;
      propAlive[i] = 1;
      propCooldown[i] = 0;
      propWobbleT[i] = 0;
      if (spec.kind === 'sake_cask') {
        propKindCode[i] = 0;
        propCenterY[i] = spec.y + 0.56;
        propHitRadius[i] = 0.68;
        propHp[i] = CASK_MAX_HP;
      } else if (spec.kind === 'updraft_vent') {
        propKindCode[i] = 1;
        propCenterY[i] = spec.y + 0.65;
        propHitRadius[i] = 0;
        propHp[i] = 0;
      } else {
        propKindCode[i] = 2;
        propCenterY[i] = spec.y + 1.24;
        propHitRadius[i] = 0.72;
        propHp[i] = 1;
      }
    }
    ringActive.fill(0);
    shockRingInstMesh.count = 0;
    shockRingInstMesh.visible = false;
    updraftBuffTimer = 0;
    syncPropInstances(0);
  }

  function spawnExpandingRing(
    x: number,
    y: number,
    z: number,
    maxRadius: number,
    durationSec: number,
    r: number,
    g: number,
    b: number
  ) {
    const slot = ringCursor;
    ringCursor = (ringCursor + 1) % MAX_PROP_RINGS;
    ringActive[slot] = 1;
    ringPosX[slot] = x;
    ringPosY[slot] = y + 0.12;
    ringPosZ[slot] = z;
    ringMaxR[slot] = maxRadius;
    ringAge[slot] = 0;
    ringDur[slot] = durationSec;
    ringColR[slot] = r;
    ringColG[slot] = g;
    ringColB[slot] = b;
  }

  function syncPropInstances(timeSec: number) {
    // 1. Update Casks (`0..5`)
    let caskCount = 0;
    for (let i = 0; i < CASK_COUNT; i++) {
      if (!propAlive[i]) continue;
      const pulse = 1.0 + 0.025 * Math.sin(timeSec * 4.2 + i * 1.3);
      _pos.set(propPosX[i], propPosY[i], propPosZ[i]);
      _euler.set(0, i * 0.95, Math.sin(propWobbleT[i] * 28) * propWobbleT[i] * 0.25);
      _quat.setFromEuler(_euler);
      _scale.set(pulse, 1.0, pulse);
      _mat4.compose(_pos, _quat, _scale);
      caskInstMesh.setMatrixAt(caskCount, _mat4);
      caskCount++;
    }
    caskInstMesh.count = caskCount;
    caskInstMesh.visible = caskCount > 0;
    caskInstMesh.instanceMatrix.needsUpdate = true;

    // 2. Update Updraft Vents (`6..9`)
    for (let v = 0; v < VENT_COUNT; v++) {
      const idx = CASK_COUNT + v;
      _pos.set(propPosX[idx], propPosY[idx], propPosZ[idx]);
      _euler.set(0, timeSec * 1.4 + v * 1.57, 0);
      _quat.setFromEuler(_euler);
      _scale.setScalar(1.0);
      _mat4.compose(_pos, _quat, _scale);
      updraftInstMesh.setMatrixAt(v, _mat4);
    }
    updraftInstMesh.count = VENT_COUNT;
    updraftInstMesh.instanceMatrix.needsUpdate = true;

    // 3. Update Sacred Spirit Gongs (`10..13`)
    for (let g = 0; g < GONG_COUNT; g++) {
      const idx = CASK_COUNT + VENT_COUNT + g;
      const ready = propCooldown[idx] <= 0.01;
      const swing = propWobbleT[idx] > 0 ? Math.sin(propWobbleT[idx] * 22) * propWobbleT[idx] * 0.35 : 0;
      _pos.set(propPosX[idx], propPosY[idx], propPosZ[idx]);
      _euler.set(swing, g * 0.78, 0);
      _quat.setFromEuler(_euler);
      _scale.setScalar(1.0);
      _mat4.compose(_pos, _quat, _scale);
      gongInstMesh.setMatrixAt(g, _mat4);
      if (ready) {
        _color.setHex(0xffd86b);
      } else {
        _color.setHex(0x4f493e);
      }
      gongInstMesh.setColorAt(g, _color);
    }
    gongInstMesh.count = GONG_COUNT;
    gongInstMesh.instanceMatrix.needsUpdate = true;
    if (gongInstMesh.instanceColor) {
      gongInstMesh.instanceColor.needsUpdate = true;
    }
  }

  function queryNearbyEnemies(cx: number, cy: number, cz: number, radius: number): any[] {
    const liveEcs = G.ecsCombat as EcsCombatBridge | undefined;
    if (liveEcs && typeof liveEcs.queryEnemiesInSphere === 'function') {
      liveEcs.queryEnemiesInSphere(cx, cy, cz, radius + 1.2, _ecsCandidates);
      return _ecsCandidates;
    }
    _ecsCandidates.length = 0;
    const rawList: any[] = G.enemies && Array.isArray(G.enemies.list) ? G.enemies.list : [];
    const r2 = (radius + 1.2) * (radius + 1.2);
    for (let i = 0; i < rawList.length; i++) {
      const en = rawList[i];
      if (!en || !en.alive || !en.pos) continue;
      const dx = en.pos.x - cx;
      const dy = en.pos.y + 0.9 - cy;
      const dz = en.pos.z - cz;
      if (dx * dx + dy * dy + dz * dz <= r2) {
        _ecsCandidates.push(en);
      }
    }
    return _ecsCandidates;
  }

  function detonateSakeCask(idx: number): TacticalPropTriggerOutcome {
    propAlive[idx] = 0;
    propHp[idx] = 0;
    propCooldown[idx] = CASK_RESPAWN_SEC * cooldownScale;
    caskDetonations++;

    const cx = propPosX[idx];
    const cy = propPosY[idx];
    const cz = propPosZ[idx];
    _blastCenter.set(cx, cy + 0.65, cz);

    spawnExpandingRing(cx, cy, cz, CASK_BLAST_RADIUS, 0.46, 1.0, 0.44, 0.12);
    const vfx = G.combatVfx as CombatFeelVfxController | undefined;
    if (vfx) {
      vfx.triggerImpact({
        point: _blastCenter,
        dir: null,
        weak: true,
        killed: true,
        heavy: true,
        colorHex: 0xff6e24,
      });
    }
    if (G.render && G.render.lightPool && typeof G.render.lightPool.flash === 'function') {
      G.render.lightPool.flash(_blastCenter, 0xff6820, 95, CASK_BLAST_RADIUS * 2.4, 0.34);
    }
    if (G.player && typeof G.player.addShake === 'function' && G.player.pos) {
      const dp = G.player.pos.distanceTo(_blastCenter);
      if (dp < 18) {
        G.player.addShake(Math.max(0.08, 0.34 * (1 - dp / 18)));
      }
    }
    if (G.level && typeof G.level.damageInRadius === 'function') {
      _blastDir.set(0, 1, 0);
      G.level.damageInRadius(_blastCenter, CASK_BLAST_RADIUS * 0.85, 140 * propDmgMult, _blastDir);
    }

    let enemiesHit = 0;
    let kills = 0;
    const cands = queryNearbyEnemies(cx, cy + 0.9, cz, CASK_BLAST_RADIUS);
    for (let i = 0; i < cands.length; i++) {
      const en = cands[i];
      if (!en || !en.alive || !en.pos) continue;
      const dx = en.pos.x - cx;
      const dy = en.pos.y + 0.9 - (cy + 0.65);
      const dz = en.pos.z - cz;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > CASK_BLAST_RADIUS) continue;

      const falloff = Math.max(0.55, 1 - dist / (CASK_BLAST_RADIUS * 1.25));
      const dmg = Math.round(CASK_BLAST_DAMAGE * propDmgMult * falloff);
      _blastDir.set(dx || 0.1, 0.35, dz || 0.1).normalize();
      en.__bypassShieldOnce = true;
      en.__guardBrokenT = Math.max(en.__guardBrokenT || 0, 1.8);
      const killed = en.damage(dmg, en.pos, _blastDir, 'splash') === true;
      if (en.alive) {
        en.__bleedT = 3.0;
        en.__bleedDps = Math.max(en.__bleedDps || 0, Math.round(22 * propDmgMult));
      }
      enemiesHit++;
      if (killed) kills++;
      cb.onEnemyHit?.(en, dmg, killed, _blastCenter);
    }

    let bossHit = false;
    if (cb.cleaveColossalBoss) {
      _blastDir.set(0, 1, 0);
      const bRes = cb.cleaveColossalBoss(
        _blastCenter,
        CASK_BLAST_RADIUS + 1.2,
        Math.round(240 * propDmgMult),
        _blastDir,
        'sake_cask'
      );
      bossHit = bRes.hit;
    }

    cb.onAudioCue?.('cask_boom');
    cb.onHudNotice?.('<b>引爆 · 朱漆雷火酒樽</b><em>破盾爆轰 + 烈焰灼烧</em>');

    return {
      triggered: true,
      kind: 'sake_cask',
      enemiesHit,
      kills,
      bossHit,
      playerHealed: 0,
      ultGainPct: 0,
    };
  }

  function ringSacredGong(idx: number): TacticalPropTriggerOutcome {
    propCooldown[idx] = GONG_COOLDOWN_SEC * cooldownScale;
    propWobbleT[idx] = 0.75;
    gongRings++;

    const gx = propPosX[idx];
    const gy = propPosY[idx];
    const gz = propPosZ[idx];
    _blastCenter.set(gx, gy + 1.2, gz);

    spawnExpandingRing(gx, gy, gz, GONG_WAVE_RADIUS, 0.56, 1.0, 0.84, 0.32);
    const vfx = G.combatVfx as CombatFeelVfxController | undefined;
    if (vfx) {
      vfx.triggerImpact({
        point: _blastCenter,
        dir: null,
        weak: true,
        killed: false,
        heavy: true,
        colorHex: 0xffdc6b,
      });
    }
    if (G.render && G.render.lightPool && typeof G.render.lightPool.flash === 'function') {
      G.render.lightPool.flash(_blastCenter, 0xffd65c, 78, GONG_WAVE_RADIUS * 1.9, 0.32);
    }

    const gongDmg = Math.round(GONG_WAVE_DAMAGE * propDmgMult);
    let enemiesHit = 0;
    let kills = 0;
    const cands = queryNearbyEnemies(gx, gy + 1.0, gz, GONG_WAVE_RADIUS);
    for (let i = 0; i < cands.length; i++) {
      const en = cands[i];
      if (!en || !en.alive || !en.pos) continue;
      const dx = en.pos.x - gx;
      const dy = en.pos.y + 0.9 - (gy + 1.0);
      const dz = en.pos.z - gz;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > GONG_WAVE_RADIUS) continue;

      _blastDir.set(dx || 0.1, 0.2, dz || 0.1).normalize();
      en.__bypassShieldOnce = true;
      en.__guardBrokenT = Math.max(en.__guardBrokenT || 0, 2.0);
      en.__gongStaggerT = 1.2;
      const killed = en.damage(gongDmg, en.pos, _blastDir, 'splash') === true;
      enemiesHit++;
      if (killed) kills++;
      cb.onEnemyHit?.(en, gongDmg, killed, _blastCenter);
    }

    let bossHit = false;
    if (cb.cleaveColossalBoss) {
      _blastDir.set(0, 1, 0);
      const bRes = cb.cleaveColossalBoss(
        _blastCenter,
        GONG_WAVE_RADIUS,
        Math.round(110 * propDmgMult),
        _blastDir,
        'spirit_gong'
      );
      bossHit = bRes.hit;
    }

    cb.onPlayerHeal?.(GONG_HEAL_AMOUNT);
    cb.onGrantUltCharge?.(GONG_ULT_GAIN);
    cb.onAudioCue?.('gong_ring');
    cb.onHudNotice?.(
      `<b>鸣响 · 古寺清心梵钟</b><em>生命 +${GONG_HEAL_AMOUNT} · 奥义 +${GONG_ULT_GAIN}% · 震慑破盾</em>`
    );

    return {
      triggered: true,
      kind: 'spirit_gong',
      enemiesHit,
      kills,
      bossHit,
      playerHealed: GONG_HEAL_AMOUNT,
      ultGainPct: GONG_ULT_GAIN,
    };
  }

  function raycast(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist: number
  ): TacticalPropRaycastHit | null {
    if (maxDist <= 0) return null;
    let bestDist = maxDist;
    let bestIdx = -1;

    for (let i = 0; i < TOTAL_PROPS; i++) {
      const r = propHitRadius[i];
      if (r <= 0) continue;
      if (propKindCode[i] === 0 && !propAlive[i]) continue;
      if (propKindCode[i] === 2 && propCooldown[i] > 0.01) continue;

      const ocx = origin.x - propPosX[i];
      const ocy = origin.y - propCenterY[i];
      const ocz = origin.z - propPosZ[i];
      const b = ocx * dir.x + ocy * dir.y + ocz * dir.z;
      const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      const hitT = t >= 0 ? t : 0;
      if (hitT <= bestDist && c <= maxDist * maxDist + r * r) {
        if (t < 0 && -b + Math.sqrt(disc) < 0) continue;
        bestDist = hitT;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) return null;
    _hitPtOut.set(
      origin.x + dir.x * bestDist,
      origin.y + dir.y * bestDist,
      origin.z + dir.z * bestDist
    );
    _rayHitResult.propIndex = bestIdx;
    _rayHitResult.kind = propKindCode[bestIdx] === 0 ? 'sake_cask' : 'spirit_gong';
    _rayHitResult.dist = bestDist;
    return _rayHitResult;
  }

  function triggerHit(
    propIndex: number,
    damage: number,
    _hitPoint?: { x: number; y: number; z: number } | null,
    _hitDir?: { x: number; y: number; z: number } | null
  ): TacticalPropTriggerOutcome {
    if (propIndex < 0 || propIndex >= TOTAL_PROPS || damage <= 0) {
      return {
        triggered: false,
        kind: null,
        enemiesHit: 0,
        kills: 0,
        bossHit: false,
        playerHealed: 0,
        ultGainPct: 0,
      };
    }

    const code = propKindCode[propIndex];
    if (code === 0) {
      if (!propAlive[propIndex]) {
        return {
          triggered: false,
          kind: 'sake_cask',
          enemiesHit: 0,
          kills: 0,
          bossHit: false,
          playerHealed: 0,
          ultGainPct: 0,
        };
      }
      propHp[propIndex] -= damage;
      propWobbleT[propIndex] = 0.25;
      if (propHp[propIndex] <= 0) {
        return detonateSakeCask(propIndex);
      }
      return {
        triggered: false,
        kind: 'sake_cask',
        enemiesHit: 0,
        kills: 0,
        bossHit: false,
        playerHealed: 0,
        ultGainPct: 0,
      };
    }

    if (code === 2 && propCooldown[propIndex] <= 0.01) {
      return ringSacredGong(propIndex);
    }

    return {
      triggered: false,
      kind: code === 2 ? 'spirit_gong' : 'updraft_vent',
      enemiesHit: 0,
      kills: 0,
      bossHit: false,
      playerHealed: 0,
      ultGainPct: 0,
    };
  }

  function damageSphere(
    center: { x: number; y: number; z: number },
    radius: number,
    damage: number
  ): number {
    if (damage <= 0 || radius <= 0) return 0;
    let triggeredCount = 0;
    for (let i = 0; i < TOTAL_PROPS; i++) {
      const r = propHitRadius[i];
      if (r <= 0) continue;
      if (propKindCode[i] === 0 && !propAlive[i]) continue;
      if (propKindCode[i] === 2 && propCooldown[i] > 0.01) continue;

      const dx = propPosX[i] - center.x;
      const dy = propCenterY[i] - center.y;
      const dz = propPosZ[i] - center.z;
      if (dx * dx + dy * dy + dz * dz <= (radius + r) * (radius + r)) {
        const res = triggerHit(i, damage, center, null);
        if (res.triggered) triggeredCount++;
      }
    }
    return triggeredCount;
  }

  function update(dt: number, playerArg?: any) {
    if (dt <= 0) return;
    uClock.value += dt;
    updraftBuffTimer = Math.max(0, updraftBuffTimer - dt);

    const p = playerArg ?? G.player;

    for (let i = 0; i < TOTAL_PROPS; i++) {
      if (propWobbleT[i] > 0) {
        propWobbleT[i] = Math.max(0, propWobbleT[i] - dt * 2.2);
      }
      if (propCooldown[i] > 0) {
        propCooldown[i] = Math.max(0, propCooldown[i] - dt);
        if (propKindCode[i] === 0 && propCooldown[i] === 0 && !propAlive[i]) {
          propAlive[i] = 1;
          propHp[i] = CASK_MAX_HP;
        }
      }

      // Check player stepping onto Fūjin Spirit Updraft Vent (`灵风上升踏台`)
      if (propKindCode[i] === 1 && propCooldown[i] <= 0 && p && p.alive && p.pos && p.vel) {
        const dx = p.pos.x - propPosX[i];
        const dz = p.pos.z - propPosZ[i];
        const dy = p.pos.y - propPosY[i];
        if (
          dx * dx + dz * dz <= UPDRAFT_TRIGGER_RADIUS * UPDRAFT_TRIGGER_RADIUS &&
          dy >= -0.45 &&
          dy <= 1.85
        ) {
          propCooldown[i] = 1.45;
          p.vel.y = Math.max(p.vel.y, UPDRAFT_LAUNCH_VEL_Y);
          p.onGround = false;
          updraftBuffTimer = UPDRAFT_BUFF_SEC;
          updraftLaunches++;
          _blastCenter.set(propPosX[i], propPosY[i], propPosZ[i]);
          spawnExpandingRing(propPosX[i], propPosY[i], propPosZ[i], 3.2, 0.36, 0.28, 0.98, 0.78);
          cb.onUpdraftLaunch?.(_blastCenter);
          cb.onAudioCue?.('updraft');
          cb.onHudNotice?.('<b>灵风踏台 · 飞檐腾空</b><em>3.2秒内滞空伤害 +18%</em>');
        }
      }
    }

    syncPropInstances(uClock.value);

    // Step transient expanding blast/sonic rings
    let activeRingCount = 0;
    for (let r = 0; r < MAX_PROP_RINGS; r++) {
      if (!ringActive[r]) continue;
      ringAge[r] += dt;
      if (ringAge[r] >= ringDur[r]) {
        ringActive[r] = 0;
        continue;
      }
      const prog = ringAge[r] / ringDur[r];
      _pos.set(ringPosX[r], ringPosY[r], ringPosZ[r]);
      _quat.identity();
      _scale.set(ringMaxR[r], 1, ringMaxR[r]);
      _mat4.compose(_pos, _quat, _scale);
      shockRingInstMesh.setMatrixAt(activeRingCount, _mat4);
      const base4 = activeRingCount * 4;
      ringInstData[base4] = ringColR[r];
      ringInstData[base4 + 1] = ringColG[r];
      ringInstData[base4 + 2] = ringColB[r];
      ringInstData[base4 + 3] = prog;
      activeRingCount++;
    }

    shockRingInstMesh.count = activeRingCount;
    shockRingInstMesh.visible = activeRingCount > 0;
    if (activeRingCount > 0) {
      shockRingInstMesh.instanceMatrix.needsUpdate = true;
      ringInstAttr.needsUpdate = true;
    }
  }

  function onWaveStart() {
    for (let i = 0; i < TOTAL_PROPS; i++) {
      if (propKindCode[i] === 0) {
        propAlive[i] = 1;
        propHp[i] = CASK_MAX_HP;
        propCooldown[i] = 0;
      } else if (propKindCode[i] === 2) {
        propCooldown[i] = 0;
      }
    }
    syncPropInstances(uClock.value);
  }

  function reset() {
    caskDetonations = 0;
    gongRings = 0;
    updraftLaunches = 0;
    initPropsState();
  }

  function dispose() {
    if (root.parent) root.parent.remove(root);
    caskMergedGeo.dispose();
    caskMat.dispose();
    ventMergedGeo.dispose();
    ventShaderMat.dispose();
    gongMergedGeo.dispose();
    gongMat.dispose();
    ringPlaneGeo.dispose();
    ringShaderMat.dispose();
  }

  initPropsState();

  return {
    root,
    raycast,
    triggerHit,
    damageSphere,
    update,
    onWaveStart,
    setModifiers(opts: { cooldownScale?: number; damageMult?: number }) {
      if (opts.cooldownScale !== undefined && Number.isFinite(opts.cooldownScale)) {
        cooldownScale = Math.max(0.2, Math.min(2.0, opts.cooldownScale));
      }
      if (opts.damageMult !== undefined && Number.isFinite(opts.damageMult)) {
        propDmgMult = Math.max(0.5, Math.min(3.0, opts.damageMult));
      }
    },
    getUpdraftBuffRemaining: () => updraftBuffTimer,
    getDamageMultiplier: () => (updraftBuffTimer > 0 ? 1.18 : 1.0),
    getDiagnostics(): TacticalArenaDiagnostics {
      let aliveCasks = 0;
      let readyGongs = 0;
      for (let i = 0; i < CASK_COUNT; i++) {
        if (propAlive[i]) aliveCasks++;
      }
      for (let g = 0; g < GONG_COUNT; g++) {
        if (propCooldown[CASK_COUNT + VENT_COUNT + g] <= 0.01) readyGongs++;
      }
      return {
        totalProps: TOTAL_PROPS,
        aliveCasks,
        readyGongs,
        updraftVents: VENT_COUNT,
        updraftBuffSec: +updraftBuffTimer.toFixed(2),
        caskDetonations,
        gongRings,
        updraftLaunches,
      };
    },
    reset,
    dispose,
  };
}
