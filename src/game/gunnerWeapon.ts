/**
 * Masterwork Tactical Gunner (`神机统帅 · 重型脉冲步枪 MK-76`) First-Person Viewmodel & Ballistic Combat System
 * Tactical Pulse & Heavy Ordinance Kit:
 * - LMB: Heavy Pulse Rifle (`重型脉冲步枪`, 480 m/s high-impact plasma-ballistic rounds, volumetric tracer beams,
 *        spinning brass-plasma shell ejection, radial impact sparks, and Focused Plasma Overcharge streak)
 * - RMB: Helix Rockets (`螺旋飞弹`, 3+ corkscrew spiral warheads with high-damage AOE splash & building breach)
 * - Shift: Tactical Sprint (`战术疾跑`, cross-chest sprint pose + 1.65x speed + passive magazine auto-feed)
 * - E: Biotic Overdrive Field (`生物力场`, 3D healing + 28% fire-rate + 20% weapon damage amp ring)
 * - V: Tactical Rifle-Butt Bash (`枪托猛击`)
 * - Q: Tactical Visor (`战术目镜 · 歼灭火力`, zero-ammo-cost auto-lock onto visible enemies + homing micro-missiles)
 */

import {
  clamp01,
  computeConvergedLaunchVector,
  computeGunnerShotDamage,
  computeProjectileVisualPosition,
  computeProjectileVisualScale,
  isProjectileOutOfPlayableBounds,
  selectTacticalVisorTarget,
  type GunnerStats,
  type VisorCandidate,
} from './roguelike.ts';
import { clamp, damp } from './rules.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  PROJECTILE_KIND,
  type EcsCombatBridge,
} from './ecsCombatBridge.ts';
import type { CombatFeelVfxController } from './combatFeelVfx.ts';
import type { GenjiAudioController } from './genjiAudio.ts';
import {
  buildMasterworkPulseRifleRig,
  getHeroViewmodelPbrSuite,
} from './heroViewmodels.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Spring1D {
  x: number;
  v: number;
  k: number;
  c: number;
}

function makeSpring(k: number, c: number): Spring1D {
  return { x: 0, v: 0, k, c };
}

function stepSpring(s: Spring1D, target: number, dt: number): number {
  const steps = dt > 0.012 ? Math.ceil(dt / 0.008) : 1;
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.v += ((target - s.x) * s.k - s.v * s.c) * h;
    s.x += s.v * h;
  }
  return s.x;
}

export interface GunnerWeaponCallbacks {
  getStats: () => GunnerStats;
  isActive: () => boolean;
  isSprinting: () => boolean;
  onCancelSprint: () => void;
  isVisorActive: () => boolean;
  isInBioticField: () => boolean;
  tryConsumeHelixCooldown: () => boolean;
  onDamageDealt: (
    amount: number,
    enemy: any,
    killed: boolean,
    weak: boolean,
    source: string
  ) => void;
  onHeavyHit?: (hitstopSec: number, fovPunchDeg?: number) => void;
  audio: GenjiAudioController;
  raycastColossalBoss?: (
    origin: any,
    dir: any,
    maxDist: number
  ) => { dist: number; point: any; normal: any; orbIndex: number } | null;
  damageColossalBoss?: (
    amount: number,
    point: any,
    dir: any,
    orbIndex: number,
    source: string
  ) => { killed: boolean; orbShattered: boolean };
  cleaveColossalBoss?: (
    center: any,
    radius: number,
    amount: number,
    dir: any,
    source: string
  ) => { hit: boolean; killed: boolean; orbShattered: boolean };
  getColossalBossVisorCandidate?: () => VisorCandidate | null;
  touch?: {
    isFireHeld: () => boolean;
    consumeFirePressed: () => boolean;
    consumeFanPressed: () => boolean;
    consumeMeleePressed: () => boolean;
    consumeReloadPressed: () => boolean;
  };
}

export interface VisorLockHudState {
  active: boolean;
  locked: boolean;
  xNorm: number;
  yNorm: number;
  targetName: string;
}

export function createGunnerWeapon(G: any, cb: GunnerWeaponCallbacks) {
  const THREE = G.THREE;
  const VIEW_LAYER = 1;

  const setViewLayerRecursive = (obj: any) => {
    obj.layers.set(VIEW_LAYER);
    obj.traverse((ch: any) => {
      ch.layers.set(VIEW_LAYER);
      if (ch.isMesh) {
        ch.castShadow = false;
        ch.receiveShadow = false;
        ch.frustumCulled = false;
      }
    });
  };

  const pbrMats = getHeroViewmodelPbrSuite(G);

  const makeGlowMat = (hex: number, opacity = 1, additive = true, scalar = 2.1) =>
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex).multiplyScalar(scalar),
      toneMapped: false,
      fog: false,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

  const gunnerShaderClock = { value: 0 };

  const makePlasmaStreamShader = (colAHex: number, colBHex: number, alphaBoost = 0.85) => {
    const cA = new THREE.Color(colAHex);
    const cB = new THREE.Color(colBHex);
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: gunnerShaderClock,
        uColA: { value: new THREE.Vector3(cA.r, cA.g, cA.b) },
        uColB: { value: new THREE.Vector3(cB.r, cB.g, cB.b) },
        uAlpha: { value: alphaBoost },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          vUv = uv;
          #ifdef USE_INSTANCING
            vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            vNormalV = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          #else
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vNormalV = normalize(normalMatrix * normal);
          #endif
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColA;
        uniform vec3 uColB;
        uniform float uAlpha;
        varying vec2 vUv;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
          float silhouetteSoft = pow(ndv, 1.38);
          float endFade = smoothstep(0.0, 0.20, vUv.y) * smoothstep(1.0, 0.12, vUv.y);
          float pulse = 0.72 + 0.28 * sin(vUv.y * 24.0 - uTime * 38.0);
          float a = silhouetteSoft * endFade * pulse * uAlpha;
          if (a < 0.012) discard;
          vec3 col = mix(uColA, uColB, pow(ndv, 2.0));
          gl_FragColor = vec4(col * 2.3, clamp(a, 0.0, 0.94));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  };

  const matPulseCyan = makeGlowMat(0x3ce4ff, 0.94, true, 2.3);
  const matPulseCore = makeGlowMat(0xffffff, 0.98, true, 2.8);
  const matStreamCyan = makePlasmaStreamShader(0x1cb8ff, 0xe8ffff, 0.86);
  const matStreamOvercharge = makePlasmaStreamShader(0xff4e18, 0xfff0b8, 0.92);
  const matStreamWhiteCore = makePlasmaStreamShader(0x88f4ff, 0xffffff, 0.94);
  const matRocketPlumeShader = makePlasmaStreamShader(0xff5e14, 0xfff4b8, 0.95);
  const matBioticGold = makeGlowMat(0xffdf6b, 0.82, true, 1.9);
  const matImpactSpark = makeGlowMat(0x9cf4ff, 0.96, true, 2.7);
  const matImpactCrit = makeGlowMat(0xffc857, 0.98, true, 3.0);

  // =========================================================================
  // 1. MASTERWORK PBR HEAVY PULSE RIFLE + ANATOMICAL 3-PHALANX HANDS
  // =========================================================================
  const root = new THREE.Group();
  root.visible = false;

  const rig = buildMasterworkPulseRifleRig(THREE, pbrMats);
  const {
    rifleGroup,
    rightGlove,
    leftSupportHand,
    magGroup,
    boltCarrier,
    opticLens,
    opticWindowGlass,
    ammoBarFill,
    barrelHeatTube,
    helixPod,
  } = rig;

  // Muzzle anchor & radial 3D plasma flash crown + soft polar shock halo
  const muzzleAnchor = new THREE.Group();
  muzzleAnchor.position.set(0, 0.028, -0.618);

  const muzzleFlashStar = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const petal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.011, 0),
      i % 2 === 0 ? matPulseCore : matPulseCyan
    );
    petal.scale.set(0.85, 6.6, 0.9);
    petal.rotation.z = (i * Math.PI) / 4;
    muzzleFlashStar.add(petal);
  }
  const muzzleJet = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.022, 0.24, 10, 1, true).rotateX(Math.PI / 2),
    matStreamCyan
  );
  muzzleJet.position.z = -0.11;
  muzzleFlashStar.add(muzzleJet);
  muzzleFlashStar.visible = false;
  muzzleAnchor.add(muzzleFlashStar);
  rifleGroup.add(muzzleAnchor);

  // First-person Spinning Ejected Brass/Plasma Shell Casings (`VIEW_LAYER`)
  const MAX_SHELLS = 28;
  const shellGeo = new THREE.CylinderGeometry(0.0042, 0.0046, 0.024, 8).rotateX(Math.PI / 2);
  const shellInstMesh = new THREE.InstancedMesh(shellGeo, pbrMats.forgedGold, MAX_SHELLS);
  shellInstMesh.frustumCulled = false;
  shellInstMesh.count = 0;
  root.add(rifleGroup, shellInstMesh);
  setViewLayerRecursive(root);
  G.camera.add(root);

  interface EjectedShell {
    active: boolean;
    pos: any;
    vel: any;
    rot: any;
    rotVel: any;
    life: number;
  }
  const shellPool: EjectedShell[] = [];
  for (let i = 0; i < MAX_SHELLS; i++) {
    shellPool.push({
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      rot: new THREE.Euler(),
      rotVel: new THREE.Vector3(),
      life: 0,
    });
  }

  // =========================================================================
  // 2. WORLD BALLISTIC POOLS: VOLUMETRIC TRACERS, BOLT SPEARS, ROCKETS & SPARKS
  // =========================================================================
  const worldGroup = new THREE.Group();
  G.scene.add(worldGroup);

  // (A) Traveling High-Luminance Plasma Bolt Spears (`MAX_PULSE_BOLTS = 64`)
  const MAX_PULSE_BOLTS = 64;
  const boltWakeGeo = new THREE.CylinderGeometry(0.010, 0.038, 4.4, 10, 1, true).rotateX(Math.PI / 2);
  boltWakeGeo.translate(0, 0, 2.0); // extends backward behind bolt head!
  const pulseBoltMesh = new THREE.InstancedMesh(boltWakeGeo, matStreamCyan, MAX_PULSE_BOLTS);
  pulseBoltMesh.frustumCulled = false;
  pulseBoltMesh.count = 0;

  const boltHeadGeo = new THREE.OctahedronGeometry(0.058, 0);
  boltHeadGeo.scale(0.85, 0.85, 2.8);
  const pulseCoreMesh = new THREE.InstancedMesh(boltHeadGeo, matPulseCore, MAX_PULSE_BOLTS);
  pulseCoreMesh.frustumCulled = false;
  pulseCoreMesh.count = 0;
  worldGroup.add(pulseBoltMesh, pulseCoreMesh);

  // (B) Volumetric Muzzle-to-Target Ballistic Tracer Beams (`MAX_TRACERS = 40`)
  const MAX_TRACERS = 40;
  const tracerOuterGeo = new THREE.CylinderGeometry(0.038, 0.016, 1.0, 10, 1, true).rotateX(Math.PI / 2);
  tracerOuterGeo.translate(0, 0, -0.5);
  const tracerInnerGeo = new THREE.CylinderGeometry(0.015, 0.007, 1.0, 8, 1, true).rotateX(Math.PI / 2);
  tracerInnerGeo.translate(0, 0, -0.5);

  const tracerCyanMesh = new THREE.InstancedMesh(tracerOuterGeo, matStreamCyan, MAX_TRACERS);
  const tracerOverMesh = new THREE.InstancedMesh(tracerOuterGeo, matStreamOvercharge, MAX_TRACERS);
  const tracerWhiteCoreMesh = new THREE.InstancedMesh(tracerInnerGeo, matStreamWhiteCore, MAX_TRACERS);
  for (const tm of [tracerCyanMesh, tracerOverMesh, tracerWhiteCoreMesh]) {
    tm.frustumCulled = false;
    tm.count = 0;
    worldGroup.add(tm);
  }

  interface ActiveTracerBeam {
    active: boolean;
    start: any;
    end: any;
    dir: any;
    length: number;
    life: number;
    maxLife: number;
    overcharged: boolean;
  }
  const tracerPool: ActiveTracerBeam[] = [];
  for (let i = 0; i < MAX_TRACERS; i++) {
    tracerPool.push({
      active: false,
      start: new THREE.Vector3(),
      end: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, -1),
      length: 10,
      life: 0,
      maxLife: 0.115,
      overcharged: false,
    });
  }

  // (C) Radial Bullet Impact Spark Bursts & Shock Rings (`MAX_IMPACT_SPARKS = 96`)
  const MAX_IMPACT_SPARKS = 96;
  const impactSparkGeo = new THREE.OctahedronGeometry(0.022, 0);
  impactSparkGeo.scale(0.55, 0.55, 3.8);
  const impactSparkMesh = new THREE.InstancedMesh(
    impactSparkGeo,
    matImpactSpark,
    MAX_IMPACT_SPARKS
  );
  const impactCritSparkMesh = new THREE.InstancedMesh(
    impactSparkGeo,
    matImpactCrit,
    MAX_IMPACT_SPARKS
  );
  impactSparkMesh.frustumCulled = false;
  impactSparkMesh.count = 0;
  impactCritSparkMesh.frustumCulled = false;
  impactCritSparkMesh.count = 0;
  worldGroup.add(impactSparkMesh, impactCritSparkMesh);

  interface ImpactSpark {
    active: boolean;
    pos: any;
    vel: any;
    life: number;
    maxLife: number;
    crit: boolean;
  }
  const impactSparkPool: ImpactSpark[] = [];
  for (let i = 0; i < MAX_IMPACT_SPARKS; i++) {
    impactSparkPool.push({
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 0.18,
      crit: false,
    });
  }

  const MAX_IMPACT_RINGS = 18;
  const impactRingGeo = new THREE.PlaneGeometry(0.52, 0.52);
  const impactRingInstData = new Float32Array(MAX_IMPACT_RINGS * 4);
  const impactRingInstAttr = new THREE.InstancedBufferAttribute(impactRingInstData, 4);
  impactRingInstAttr.setUsage(THREE.DynamicDrawUsage);
  impactRingGeo.setAttribute('aInstData', impactRingInstAttr);

  const sharedImpactRingMat = new THREE.ShaderMaterial({
    vertexShader: `
      attribute vec4 aInstData;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vProgress;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vColor = aInstData.xyz;
        vProgress = aInstData.w;
        #ifdef USE_INSTANCING
          vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        #endif
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vProgress;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float ringR = mix(0.22, 0.92, vProgress);
        float band = exp(-pow((r - ringR) * 8.5, 2.0));
        float fade = 1.0 - smoothstep(0.35, 1.0, vProgress);
        float a = band * fade * smoothstep(1.0, 0.85, r);
        if (a < 0.015) discard;
        vec3 col = mix(vColor, vec3(0.96, 0.99, 1.0), band * 0.62);
        gl_FragColor = vec4(col * 2.2, clamp(a, 0.0, 0.90));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const impactRingInstMesh = new THREE.InstancedMesh(
    impactRingGeo,
    sharedImpactRingMat,
    MAX_IMPACT_RINGS,
  );
  impactRingInstMesh.frustumCulled = false;
  impactRingInstMesh.count = 0;
  impactRingInstMesh.visible = false;
  impactRingInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  worldGroup.add(impactRingInstMesh);

  interface ImpactRing {
    active: boolean;
    life: number;
    maxLife: number;
    maxScale: number;
    pos: any;
    colR: number;
    colG: number;
    colB: number;
  }
  const impactRingPool: ImpactRing[] = [];
  for (let i = 0; i < MAX_IMPACT_RINGS; i++) {
    impactRingPool.push({
      active: false,
      life: 0,
      maxLife: 0.16,
      maxScale: 1.4,
      pos: new THREE.Vector3(),
      colR: 0.34,
      colG: 0.93,
      colB: 1.0,
    });
  }

  interface ActivePulseBolt {
    active: boolean;
    pos: any;
    prev: any;
    origin: any;
    impactPoint: any;
    dir: any;
    speed: number;
    damage: number;
    pierceLeft: number;
    bleedDps: number;
    life: number;
    elapsed: number;
    minVisDur: number;
    impactResolved: boolean;
    visorLocked: boolean;
    hitIds: Set<number>;
  }

  const pulsePool: ActivePulseBolt[] = [];
  for (let i = 0; i < MAX_PULSE_BOLTS; i++) {
    pulsePool.push({
      active: false,
      pos: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      origin: new THREE.Vector3(),
      impactPoint: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, -1),
      speed: 480,
      damage: 34,
      pierceLeft: 0,
      bleedDps: 0,
      life: 0,
      elapsed: 0,
      minVisDur: 0.095,
      impactResolved: false,
      visorLocked: false,
      hitIds: new Set<number>(),
    });
  }

  // (D) Helix Rockets (`螺旋飞弹` — 120 individual Meshes batched into 5 GPU InstancedMeshes!)
  const MAX_ROCKETS = 20;
  interface ActiveHelixRocket {
    active: boolean;
    basePos: any;
    pos: any;
    prev: any;
    dir: any;
    right: any;
    up: any;
    phase: number;
    spiralRadius: number;
    speed: number;
    directDamage: number;
    splashDamage: number;
    splashRadius: number;
    life: number;
    homing: boolean;
  }

  const rocketPool: ActiveHelixRocket[] = [];
  const rocketNoseGeo = new THREE.ConeGeometry(0.068, 0.22, 10)
    .rotateX(-Math.PI / 2)
    .translate(0, 0, -0.22);
  const rocketTubeGeo = new THREE.CylinderGeometry(0.062, 0.066, 0.26, 10).rotateX(Math.PI / 2);
  const rocketFinGeoA = new THREE.BoxGeometry(0.22, 0.012, 0.09).translate(0, 0, 0.08);
  const rocketFinGeoB = new THREE.BoxGeometry(0.22, 0.012, 0.09)
    .rotateZ(Math.PI / 2)
    .translate(0, 0, 0.08);
  const rocketCrossFinGeo =
    mergeGeometries([rocketFinGeoA, rocketFinGeoB], false) || rocketFinGeoA.clone();
  rocketFinGeoA.dispose();
  rocketFinGeoB.dispose();
  const rocketPlumeGeo = new THREE.CylinderGeometry(0.018, 0.11, 0.72, 12, 1, true)
    .rotateX(Math.PI / 2)
    .translate(0, 0, 0.44);
  const rocketCoreGeo = new THREE.SphereGeometry(0.068, 8, 6).translate(0, 0, 0.15);

  const makeRocketInstLayer = (geo: any, mat: any) => {
    const im = new THREE.InstancedMesh(geo, mat, MAX_ROCKETS);
    im.frustumCulled = false;
    im.castShadow = false;
    im.receiveShadow = false;
    im.count = 0;
    im.visible = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    worldGroup.add(im);
    return im;
  };

  const rocketNoseInst = makeRocketInstLayer(rocketNoseGeo, pbrMats.crimsonAnodized);
  const rocketBodyInst = makeRocketInstLayer(rocketTubeGeo, pbrMats.ceramicShroud);
  const rocketFinInst = makeRocketInstLayer(rocketCrossFinGeo, pbrMats.gunmetal);
  const rocketPlumeInst = makeRocketInstLayer(rocketPlumeGeo, matRocketPlumeShader);
  const rocketCoreInst = makeRocketInstLayer(rocketCoreGeo, matPulseCore);

  for (let i = 0; i < MAX_ROCKETS; i++) {
    rocketPool.push({
      active: false,
      basePos: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      phase: 0,
      spiralRadius: 0.24,
      speed: 148,
      directDamage: 72,
      splashDamage: 68,
      splashRadius: 4.8,
      life: 0,
      homing: false,
    });
  }

  const _ecsCand: any[] = [];
  const ecsCombat = G.ecsCombat as EcsCombatBridge | undefined;
  if (ecsCombat) {
    ecsCombat.registerProjectilePool({
      name: 'gunner_pulse_bolts',
      kind: PROJECTILE_KIND.GUNNER_PULSE,
      faction: 0,
      items: pulsePool,
      isActive: (b) => b.active && !b.impactResolved,
    });
    ecsCombat.registerProjectilePool({
      name: 'gunner_helix_rockets',
      kind: PROJECTILE_KIND.GUNNER_HELIX,
      faction: 0,
      items: rocketPool,
      isActive: (r) => r.active,
      getDamage: (r) => r.directDamage + r.splashDamage,
    });
  }

  // (E) Turbulent Plasma Fireball & Shockwave Spheres (`螺旋飞弹热核冲击云` — 12 Meshes -> 1 GPU InstancedMesh!)
  const MAX_BLASTS = 12;
  interface ActiveBlast {
    active: boolean;
    life: number;
    maxLife: number;
    maxRadius: number;
    pos: any;
    rotY: number;
  }
  const blastPool: ActiveBlast[] = [];
  const blastGeo = new THREE.SphereGeometry(1, 24, 16);
  const blastProgressData = new Float32Array(MAX_BLASTS);
  const blastProgressAttr = new THREE.InstancedBufferAttribute(blastProgressData, 1);
  blastProgressAttr.setUsage(THREE.DynamicDrawUsage);
  blastGeo.setAttribute('aProgress', blastProgressAttr);

  const sharedBlastMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: gunnerShaderClock,
    },
    vertexShader: `
      attribute float aProgress;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      varying vec3 vObjPos;
      varying float vProgress;
      void main() {
        vObjPos = position;
        vProgress = aProgress;
        #ifdef USE_INSTANCING
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vNormalV = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        #else
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormalV = normalize(normalMatrix * normal);
        #endif
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      varying vec3 vObjPos;
      varying float vProgress;
      void main() {
        float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float silhouetteSoft = pow(ndv, 1.45);
        float turb = 0.5 + 0.5 * sin(vObjPos.x * 9.0 + uTime * 18.0 + cos(vObjPos.y * 11.0 - vObjPos.z * 8.0) * 2.2);
        float hotCore = pow(ndv, 2.8) * (1.0 - vProgress * 0.75);
        float shockShell = exp(-pow((ndv - 0.36) * 4.5, 2.0)) * (1.0 - smoothstep(0.45, 1.0, vProgress));
        float fade = 1.0 - smoothstep(0.28, 1.0, vProgress);
        float a = (silhouetteSoft * (0.42 + turb * 0.48) + shockShell * 0.45) * fade;
        if (a < 0.015) discard;
        vec3 col = mix(vec3(1.0, 0.30, 0.06), vec3(1.0, 0.82, 0.28), turb);
        col = mix(col, vec3(1.0, 0.98, 0.86), clamp(hotCore * 1.4, 0.0, 1.0));
        gl_FragColor = vec4(col * 2.4, clamp(a, 0.0, 0.94));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const blastInstMesh = new THREE.InstancedMesh(blastGeo, sharedBlastMat, MAX_BLASTS);
  blastInstMesh.frustumCulled = false;
  blastInstMesh.count = 0;
  blastInstMesh.visible = false;
  blastInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  worldGroup.add(blastInstMesh);

  for (let i = 0; i < MAX_BLASTS; i++) {
    blastPool.push({
      active: false,
      life: 0,
      maxLife: 0.30,
      maxRadius: 4.8,
      pos: new THREE.Vector3(),
      rotY: 0,
    });
  }

  const combatVfx = G.combatVfx as CombatFeelVfxController | undefined;
  if (combatVfx) {
    combatVfx.registerBatch({
      name: 'gunner_pulse_bolts',
      meshes: [pulseBoltMesh, pulseCoreMesh],
      getActiveCount: () => pulseBoltMesh.count,
      legacyMeshesPerItem: 2,
    });
    combatVfx.registerBatch({
      name: 'gunner_tracers',
      meshes: [tracerCyanMesh, tracerOverMesh, tracerWhiteCoreMesh],
      getActiveCount: () => tracerWhiteCoreMesh.count,
      legacyMeshesPerItem: 2,
    });
    combatVfx.registerBatch({
      name: 'gunner_impact_sparks',
      meshes: [impactSparkMesh, impactCritSparkMesh],
      getActiveCount: () => impactSparkMesh.count + impactCritSparkMesh.count,
      legacyMeshesPerItem: 1,
    });
    combatVfx.registerBatch({
      name: 'gunner_impact_rings',
      meshes: [impactRingInstMesh],
      getActiveCount: () => impactRingInstMesh.count,
      legacyMeshesPerItem: 1,
      eliminatedSceneMeshes: MAX_IMPACT_RINGS - 1,
      eliminatedShaderMaterials: MAX_IMPACT_RINGS - 1,
    });
    combatVfx.registerBatch({
      name: 'gunner_helix_rockets',
      meshes: [rocketNoseInst, rocketBodyInst, rocketFinInst, rocketPlumeInst, rocketCoreInst],
      getActiveCount: () => rocketNoseInst.count,
      legacyMeshesPerItem: 6,
      eliminatedSceneMeshes: MAX_ROCKETS * 6 - 5,
    });
    combatVfx.registerBatch({
      name: 'gunner_plasma_blasts',
      meshes: [blastInstMesh],
      getActiveCount: () => blastInstMesh.count,
      legacyMeshesPerItem: 1,
      eliminatedSceneMeshes: MAX_BLASTS - 1,
      eliminatedShaderMaterials: MAX_BLASTS - 1,
    });
    combatVfx.registerBatch({
      name: 'gunner_shells',
      meshes: [shellInstMesh],
      getActiveCount: () => shellInstMesh.count,
      legacyMeshesPerItem: 1,
    });
  }

  // (F) 3D Deployable Biotic Overdrive Field (`生物超载力场信标 + 极坐标全息治疗阵`)
  const bioticFieldUniforms = {
    uTime: gunnerShaderClock,
    uFade: { value: 1 },
  };
  const matBioticGroundShader = new THREE.ShaderMaterial({
    uniforms: bioticFieldUniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uFade;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float ang = atan(vUv.y, vUv.x);
        float outerRing = exp(-pow((r - 0.96) * 26.0, 2.0));
        float pulseR = fract(uTime * 0.85);
        float healWave = exp(-pow((r - pulseR) * 12.0, 2.0)) * (1.0 - smoothstep(0.82, 1.0, pulseR));
        float crossMed = (exp(-pow(vUv.x * 24.0, 2.0)) * step(abs(vUv.y), 0.22) +
                          exp(-pow(vUv.y * 24.0, 2.0)) * step(abs(vUv.x), 0.22)) * 0.38;
        float segs = 0.65 + 0.35 * cos(ang * 12.0 - uTime * 2.5);
        float softFill = (1.0 - smoothstep(0.0, 0.96, r)) * 0.10;
        float a = (outerRing * 0.72 * segs + healWave * 0.62 + crossMed + softFill) * uFade;
        if (a < 0.012) discard;
        vec3 gold = vec3(1.0, 0.86, 0.32);
        vec3 emerald = vec3(0.24, 1.0, 0.64);
        vec3 col = mix(gold, emerald, clamp(healWave * 1.2 + crossMed, 0.0, 1.0));
        gl_FragColor = vec4(col * 1.95, clamp(a, 0.0, 0.88));
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const bioticBeaconGroup = new THREE.Group();
  bioticBeaconGroup.visible = false;
  const beaconCanister = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.18, 0.44, 12),
    pbrMats.cobaltAlloy
  );
  beaconCanister.position.y = 0.22;
  const beaconCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.15, 0.08, 12),
    pbrMats.forgedGold
  );
  beaconCap.position.y = 0.44;
  const beaconCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.115, 0.115, 0.26, 12),
    matBioticGold
  );
  beaconCore.position.y = 0.24;
  const beaconFieldPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(2.0, 2.0).rotateX(-Math.PI / 2),
    matBioticGroundShader
  );
  beaconFieldPlane.position.y = 0.04;
  bioticBeaconGroup.add(
    beaconCanister,
    beaconCap,
    beaconCore,
    beaconFieldPlane
  );
  worldGroup.add(bioticBeaconGroup);

  let bioticFieldTimer = 0;
  let bioticFieldRadius = 5.8;

  // --- Pre-allocated Scratch Math Objects ---
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  const _v4 = new THREE.Vector3();
  const _v5 = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _q1 = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const _mat4 = new THREE.Matrix4();
  const _scale = new THREE.Vector3();
  const _zNeg = new THREE.Vector3(0, 0, -1);
  const _zPos = new THREE.Vector3(0, 0, 1);

  // --- Runtime State ---
  let ammo = 40;
  let magSize = 40;
  let sprintAmmoCarry = 0;
  let state: 'idle' | 'firing' | 'reload' | 'melee' = 'idle';
  let fireCooldown = 0;
  let reloadTimer = 0;
  let reloadDuration = 0.85;
  let meleeTimer = 0;
  let muzzleFlashT = 0;
  let dynamicSpread = 0;
  let shotsInBurst = 0;
  let overchargeStreak = 0;
  let overchargeDecayT = 0;
  let microMissileCounter = 0;
  let helixPodSpin = 0;
  let clockT = 0;

  const visorHudState: VisorLockHudState = {
    active: false,
    locked: false,
    xNorm: 0.5,
    yNorm: 0.5,
    targetName: '',
  };

  const spKickZ = makeSpring(340, 26);
  const spKickPitch = makeSpring(290, 23);
  const spKickYaw = makeSpring(240, 20);
  const spSwayX = makeSpring(165, 18);
  const spSwayY = makeSpring(165, 18);

  const rawMouseLatched = new Set<number>();
  const rawMouseHeld = new Set<number>();
  if (typeof window !== 'undefined') {
    window.addEventListener('mousedown', (e: MouseEvent) => {
      if (!cb.isActive()) return;
      const el = e.target as HTMLElement | null;
      if (el && el.closest && el.closest('button, input, .menu.open, .g-draft.on, #g-touch')) {
        return;
      }
      if (G.player && G.player.enabled && G.player.alive) {
        rawMouseLatched.add(e.button);
        rawMouseHeld.add(e.button);
      }
    });
    window.addEventListener('mouseup', (e: MouseEvent) => {
      rawMouseHeld.delete(e.button);
    });
    window.addEventListener('blur', () => {
      rawMouseLatched.clear();
      rawMouseHeld.clear();
    });
  }
  function consumeRawMouseLatch(button: number): boolean {
    if (rawMouseLatched.has(button)) {
      rawMouseLatched.delete(button);
      return true;
    }
    return false;
  }

  function spawnShellCasing() {
    let sh: EjectedShell | null = null;
    for (let i = 0; i < shellPool.length; i++) {
      if (!shellPool[i].active) {
        sh = shellPool[i];
        break;
      }
    }
    if (!sh) sh = shellPool[0];
    sh.active = true;
    sh.life = 0.42;
    sh.pos.set(
      rifleGroup.position.x + 0.042,
      rifleGroup.position.y + 0.036,
      rifleGroup.position.z - 0.02
    );
    sh.vel.set(
      0.72 + Math.random() * 0.35,
      0.52 + Math.random() * 0.28,
      0.18 + (Math.random() - 0.5) * 0.25
    );
    sh.rot.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    sh.rotVel.set(18 + Math.random() * 14, 22 + Math.random() * 12, 14);
  }

  function spawnTracerBeam(startPt: any, endPt: any, overcharged: boolean) {
    let tr: ActiveTracerBeam | null = null;
    for (let i = 0; i < tracerPool.length; i++) {
      if (!tracerPool[i].active) {
        tr = tracerPool[i];
        break;
      }
    }
    if (!tr) tr = tracerPool[0];
    tr.start.copy(startPt);
    tr.end.copy(endPt);
    tr.dir.subVectors(endPt, startPt);
    const len = tr.dir.length();
    if (len < 0.25) {
      tr.active = false;
      return;
    }
    tr.dir.multiplyScalar(1 / len);
    tr.length = Math.min(125, len);
    tr.maxLife = 0.155;
    tr.life = tr.maxLife;
    tr.overcharged = overcharged;
    tr.active = true;
  }

  function spawnBulletImpactFx(worldPt: any, incomingDir: any, isEnemyHit: boolean, isCrit: boolean) {
    let ring: ImpactRing | null = null;
    for (let i = 0; i < impactRingPool.length; i++) {
      if (!impactRingPool[i].active) {
        ring = impactRingPool[i];
        break;
      }
    }
    if (!ring) ring = impactRingPool[0];
    ring.active = true;
    ring.maxLife = isCrit ? 0.20 : 0.14;
    ring.life = ring.maxLife;
    ring.maxScale = isCrit ? 2.1 : isEnemyHit ? 1.45 : 0.95;
    ring.pos.copy(worldPt).addScaledVector(incomingDir, -0.05);
    if (isCrit) {
      ring.colR = 1.0;
      ring.colG = 0.784;
      ring.colB = 0.29;
    } else if (isEnemyHit) {
      ring.colR = 0.337;
      ring.colG = 0.925;
      ring.colB = 1.0;
    } else {
      ring.colR = 0.604;
      ring.colG = 0.875;
      ring.colB = 1.0;
    }

    const count = isCrit ? 12 : isEnemyHit ? 8 : 5;
    let spawned = 0;
    for (let i = 0; i < impactSparkPool.length && spawned < count; i++) {
      if (impactSparkPool[i].active) continue;
      const sp = impactSparkPool[i];
      sp.active = true;
      sp.crit = isCrit;
      sp.pos.copy(worldPt).addScaledVector(incomingDir, -0.04);
      const theta = Math.random() * Math.PI * 2;
      const spread = 2.8 + Math.random() * (isCrit ? 7.5 : 5.2);
      sp.vel
        .copy(incomingDir)
        .multiplyScalar(-3.2 - Math.random() * 3.8)
        .add(
          _v4.set(
            Math.cos(theta) * spread,
            1.4 + Math.random() * 3.6,
            Math.sin(theta) * spread
          )
        );
      sp.maxLife = 0.12 + Math.random() * 0.09;
      sp.life = sp.maxLife;
      spawned++;
    }

    if (G.render && G.render.lightPool && isEnemyHit) {
      G.render.lightPool.flash(worldPt, isCrit ? 0xffbe46 : 0x4ae6ff, 22, 4.2, 0.05);
    }
  }

  function spawnBlastVisual(center: any, radius: number) {
    let b: ActiveBlast | null = null;
    for (let i = 0; i < blastPool.length; i++) {
      if (!blastPool[i].active) {
        b = blastPool[i];
        break;
      }
    }
    if (!b) b = blastPool[0];
    b.active = true;
    b.maxLife = 0.28;
    b.life = 0.28;
    b.maxRadius = radius;
    b.pos.copy(center);
    b.rotY = Math.random() * Math.PI * 2;
    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(center, 0xff9a3b, 65, radius * 2.4, 0.16);
    }
  }

  function getMuzzleWorldOrigin(out: any) {
    G.camera.updateMatrixWorld(true);
    muzzleAnchor.updateWorldMatrix(true, false);
    return muzzleAnchor.getWorldPosition(out);
  }

  function checkMuzzleObstruction(rawMuzzle: any): number | null {
    const camPos = G.camera.position;
    _v4.copy(rawMuzzle).sub(camPos);
    const dist = _v4.length();
    if (dist < 1e-4) return null;
    _v4.multiplyScalar(1 / dist);
    const wHit = G.physics.raycast(camPos, _v4, dist + 0.06);
    return wHit ? wHit.dist : null;
  }

  function computeRayImpactPoint(origin: any, dir: any, maxRange: number, out: any) {
    let bestDist = maxRange;
    const wHit = G.physics.raycast(origin, dir, bestDist);
    if (wHit && wHit.dist < bestDist) bestDist = wHit.dist;
    const dHit =
      G.level && typeof G.level.raycastDestructible === 'function'
        ? G.level.raycastDestructible(origin, dir, bestDist)
        : null;
    if (dHit && dHit.dist < bestDist) bestDist = dHit.dist;
    const eHit = G.enemies ? G.enemies.raycast(origin, dir, bestDist) : null;
    if (eHit && eHit.dist < bestDist) bestDist = eHit.dist;
    const bHit = cb.raycastColossalBoss ? cb.raycastColossalBoss(origin, dir, bestDist) : null;
    if (bHit && bHit.dist < bestDist) bestDist = bHit.dist;
    out.copy(origin).addScaledVector(dir, bestDist);
    return bestDist;
  }

  const MAX_VISOR_CANDS = 36;
  const visorCandPool: VisorCandidate[] = [];
  for (let i = 0; i < MAX_VISOR_CANDS; i++) {
    visorCandPool.push({
      id: 0,
      aimPoint: { x: 0, y: 0, z: 0 },
      isBoss: false,
      hpRatio: 1,
    });
  }
  const visorActiveSlice: VisorCandidate[] = [];
  const _visorLockOut = { locked: false, aimPoint: { x: 0, y: 0, z: 0 } as any };

  function gatherVisorCandidates(): VisorCandidate[] {
    visorActiveSlice.length = 0;
    let used = 0;
    const camPos = G.camera.position;
    if (G.enemies && G.enemies.list) {
      for (const en of G.enemies.list) {
        if (!en.alive || used >= MAX_VISOR_CANDS - 1) continue;
        const aimY =
          en.pos.y +
          (en.type === 'gull'
            ? 0.18
            : en.__variant === 'spider_mech' || en.__variant === 'mortar_crab'
              ? 0.72
              : en.type === 'hound'
                ? 0.65
                : 1.28);
        _v1.set(en.pos.x, aimY, en.pos.z);
        _v2.copy(_v1).sub(camPos);
        const d = _v2.length();
        if (d < 0.4 || d > 105) continue;
        _v2.multiplyScalar(1 / d);
        const wHit = G.physics.raycast(camPos, _v2, d - 0.35);
        if (wHit) continue;
        const maxHp = en.__maxHp || 100;
        const slot = visorCandPool[used++];
        slot.id = en.id;
        slot.aimPoint.x = _v1.x;
        slot.aimPoint.y = _v1.y;
        slot.aimPoint.z = _v1.z;
        slot.isBoss = en.__variant === 'boss';
        slot.hpRatio = maxHp > 0 ? clamp01(en.hp / maxHp) : 1;
        visorActiveSlice.push(slot);
      }
    }
    const colossusCand = cb.getColossalBossVisorCandidate?.();
    if (colossusCand && used < MAX_VISOR_CANDS) {
      visorActiveSlice.push(colossusCand);
    }
    return visorActiveSlice;
  }

  function updateVisorLockState(stats: GunnerStats): { locked: boolean; aimPoint: any } {
    if (!cb.isVisorActive()) {
      visorHudState.active = false;
      visorHudState.locked = false;
      _visorLockOut.locked = false;
      return _visorLockOut;
    }
    visorHudState.active = true;
    const cam = G.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const candidates = gatherVisorCandidates();
    const res = selectTacticalVisorTarget({
      eyePos: cam.position,
      forward: _fwd,
      candidates,
      minConeCos: stats.visorConeCos,
      maxRange: 105,
    });
    if (!res.target) {
      visorHudState.locked = false;
      visorHudState.xNorm = 0.5;
      visorHudState.yNorm = 0.5;
      _visorLockOut.locked = false;
      return _visorLockOut;
    }
    _v3.set(res.target.aimPoint.x, res.target.aimPoint.y, res.target.aimPoint.z);
    _v4.copy(_v3).project(cam);
    if (_v4.z >= -1 && _v4.z <= 1) {
      visorHudState.locked = true;
      visorHudState.xNorm = clamp01((_v4.x + 1) * 0.5);
      visorHudState.yNorm = clamp01((1 - _v4.y) * 0.5);
      visorHudState.targetName = res.target.isBoss ? '首领锁定' : '目标锁定';
    } else {
      visorHudState.locked = false;
    }
    _visorLockOut.locked = true;
    _visorLockOut.aimPoint.x = _v3.x;
    _visorLockOut.aimPoint.y = _v3.y;
    _visorLockOut.aimPoint.z = _v3.z;
    return _visorLockOut;
  }

  function firePulseRound(stats: GunnerStats) {
    const visorOn = cb.isVisorActive();
    if (ammo <= 0 && !visorOn) return;
    cb.onCancelSprint();
    // Tactical Visor grants infinite zero-ammo-cost sustained fire!
    if (!visorOn) {
      ammo = Math.max(0, ammo - 1);
    } else {
      ammo = magSize;
    }
    if (G.combat && G.combat.stats) G.combat.stats.shots++;

    const cam = G.camera;
    const rawMuzzle = getMuzzleWorldOrigin(_v1);
    const blockedDist = checkMuzzleObstruction(rawMuzzle);
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);

    const visorLock = updateVisorLockState(stats);
    shotsInBurst++;
    if (visorLock.locked && visorLock.aimPoint) {
      _v2.set(visorLock.aimPoint.x, visorLock.aimPoint.y, visorLock.aimPoint.z);
    } else {
      // Controlled burst precision: first 5 rounds are pinpoint laser-accurate!
      const spread = shotsInBurst <= 5 ? 0.0015 : stats.rifleSpreadRad + dynamicSpread;
      const sx = (Math.random() - 0.5) * 2 * spread;
      const sy = (Math.random() - 0.5) * 2 * spread;
      _v5.copy(_fwd).addScaledVector(_right, sx).addScaledVector(_up, sy).normalize();
      computeRayImpactPoint(cam.position, _v5, 128, _v2);
    }

    const pred = computeConvergedLaunchVector({
      cameraPos: cam.position,
      cameraForward: _fwd,
      rawHandOrigin: rawMuzzle,
      aimHitPoint: _v2,
      handBlockedDist: blockedDist,
      projectileSpeed: stats.rifleProjectileSpeed,
    });

    let slot: ActivePulseBolt | null = null;
    for (let i = 0; i < pulsePool.length; i++) {
      if (!pulsePool[i].active) {
        slot = pulsePool[i];
        break;
      }
    }
    if (!slot) slot = pulsePool[0];
    slot.active = true;
    slot.origin.set(pred.safeOrigin.x, pred.safeOrigin.y, pred.safeOrigin.z);
    slot.pos.copy(slot.origin);
    slot.prev.copy(slot.origin);
    slot.dir.set(pred.dir.x, pred.dir.y, pred.dir.z);
    slot.speed = stats.rifleProjectileSpeed;
    slot.damage = stats.rifleDamage;
    slot.pierceLeft = stats.pierceCount;
    slot.bleedDps = stats.bleedDps;
    slot.life = 0.85;
    slot.elapsed = 0;
    // Minimum visual duration 0.085..0.135s so the blazing bolt spear visibly streaks downrange!
    slot.minVisDur = Math.max(0.085, Math.min(0.135, pred.predictedDistance / 185));
    slot.impactResolved = false;
    slot.visorLocked = visorLock.locked;
    slot.impactPoint.copy(slot.origin).addScaledVector(slot.dir, pred.predictedDistance);
    slot.hitIds.clear();

    // Immediate Volumetric Ballistic Tracer Beam from muzzle to target + Spinning Brass Shell Ejection!
    const isHot = visorOn || overchargeStreak >= 6;
    spawnTracerBeam(slot.origin, slot.impactPoint, isHot);
    spawnShellCasing();

    if (shotsInBurst > 5) {
      dynamicSpread = Math.min(0.020, dynamicSpread + 0.0024);
    }
    muzzleFlashT = 0.048;
    muzzleFlashStar.rotation.z = Math.random() * Math.PI * 2;
    const flashScale = 0.92 + Math.random() * 0.35;
    muzzleFlashStar.scale.setScalar(flashScale);

    cb.audio.pulseRifleShot(visorLock.locked || overchargeStreak >= 6);
    spKickZ.v += 1.75;
    spKickPitch.v += visorLock.locked ? 0.38 : 0.72;
    spKickYaw.v += (Math.random() - 0.5) * 0.54;
    if (G.player && G.player.addShake) {
      G.player.addShake(0.022);
    }

    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(slot.origin, isHot ? 0xff6248 : 0x4ce8ff, 22, 5.2, 0.04);
    }

    // Tactical Visor launches homing shoulder micro-missiles every 5th shot baseline (every 3rd with `visorMicroMissiles`!)
    if (visorOn) {
      microMissileCounter++;
      const cadence = stats.visorMicroMissiles ? 3 : 5;
      if (microMissileCounter % cadence === 0) {
        spawnSingleHelixRocket(slot.origin, slot.dir, 0, 0.09, 48, 42, 3.6, true);
      }
    }
  }

  function spawnSingleHelixRocket(
    origin: any,
    dir: any,
    phase: number,
    spiralRadius: number,
    directDmg: number,
    splashDmg: number,
    splashRad: number,
    homing = false
  ) {
    let r: ActiveHelixRocket | null = null;
    for (let i = 0; i < rocketPool.length; i++) {
      if (!rocketPool[i].active) {
        r = rocketPool[i];
        break;
      }
    }
    if (!r) r = rocketPool[0];
    r.active = true;
    r.basePos.copy(origin);
    r.dir.copy(dir).normalize();
    if (Math.abs(r.dir.y) > 0.92) {
      r.right.set(1, 0, 0).cross(r.dir).normalize();
    } else {
      r.right.set(0, 1, 0).cross(r.dir).normalize();
    }
    r.up.copy(r.dir).cross(r.right).normalize();
    r.phase = phase;
    r.spiralRadius = spiralRadius;
    r.speed = cb.getStats().helixSpeed;
    r.directDamage = directDmg;
    r.splashDamage = splashDmg;
    r.splashRadius = splashRad;
    r.life = 2.4;
    r.homing = homing;
    r.pos
      .copy(r.basePos)
      .addScaledVector(r.right, Math.cos(phase) * spiralRadius)
      .addScaledVector(r.up, Math.sin(phase) * spiralRadius);
    r.prev.copy(r.pos);
  }

  function fireHelixVolley(): boolean {
    if (!cb.tryConsumeHelixCooldown()) return false;
    cb.onCancelSprint();
    const stats = cb.getStats();
    const cam = G.camera;
    const rawMuzzle = getMuzzleWorldOrigin(_v1);
    const blockedDist = checkMuzzleObstruction(rawMuzzle);
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);

    const visorLock = updateVisorLockState(stats);
    if (visorLock.locked && visorLock.aimPoint) {
      _v2.set(visorLock.aimPoint.x, visorLock.aimPoint.y, visorLock.aimPoint.z);
    } else {
      computeRayImpactPoint(cam.position, _fwd, 130, _v2);
    }

    const pred = computeConvergedLaunchVector({
      cameraPos: cam.position,
      cameraForward: _fwd,
      rawHandOrigin: rawMuzzle,
      aimHitPoint: _v2,
      handBlockedDist: blockedDist,
      projectileSpeed: stats.helixSpeed,
    });
    _v3.set(pred.safeOrigin.x, pred.safeOrigin.y, pred.safeOrigin.z);
    _v4.set(pred.dir.x, pred.dir.y, pred.dir.z);

    const count = Math.max(3, stats.helixRocketCount);
    for (let i = 0; i < count; i++) {
      const phase = (i / count) * Math.PI * 2;
      spawnSingleHelixRocket(
        _v3,
        _v4,
        phase,
        0.24,
        stats.helixDirectDamage,
        stats.helixSplashDamage,
        stats.helixSplashRadius,
        visorLock.locked
      );
    }

    helixPodSpin += Math.PI * 1.33;
    muzzleFlashT = 0.08;
    cb.audio.helixLaunch();
    spKickZ.v += 3.1;
    spKickPitch.v += 1.65;
    if (G.player && G.player.addShake) G.player.addShake(0.20);
    return true;
  }

  function detonateHelixRocket(r: ActiveHelixRocket, impactPt: any, directEnemy: any) {
    r.active = false;
    cb.audio.helixExplode();
    spawnBlastVisual(impactPt, r.splashRadius);
    spawnBulletImpactFx(impactPt, r.dir, true, true);
    if (G.player && G.player.addShake) {
      const dPlayer = G.player.pos ? G.player.pos.distanceTo(impactPt) : 20;
      if (dPlayer < 18) G.player.addShake(clamp(0.32 * (1 - dPlayer / 18), 0.06, 0.32));
    }

    if (G.level && G.level.damageInRadius) {
      const broken = G.level.damageInRadius(
        impactPt,
        r.splashRadius * 0.95,
        r.directDamage + r.splashDamage,
        r.dir
      );
      if (broken > 0) cb.audio.structureBreak(true);
    }

    const bioticMult = cb.isInBioticField() ? 1.2 : 1.0;

    if (cb.cleaveColossalBoss) {
      const totalCleave = Math.round((r.directDamage + r.splashDamage) * bioticMult);
      const cRes = cb.cleaveColossalBoss(
        impactPt,
        r.splashRadius + 1.6,
        totalCleave,
        r.dir,
        'helix'
      );
      if (cRes.hit) {
        cb.onHeavyHit?.(cRes.orbShattered ? 0.065 : 0.032, 3.0);
      }
    }

    if (G.enemies && G.enemies.list) {
      const stats = cb.getStats();
      const liveEcs = (G.ecsCombat as EcsCombatBridge | undefined) ?? ecsCombat;
      let candList: any[] = G.enemies.list;
      if (liveEcs) {
        liveEcs.queryEnemiesInSphere(
          impactPt.x,
          impactPt.y,
          impactPt.z,
          r.splashRadius + 2.0,
          _ecsCand,
        );
        if (directEnemy && directEnemy.alive && _ecsCand.indexOf(directEnemy) === -1) {
          _ecsCand.push(directEnemy);
        }
        candList = _ecsCand;
      }
      for (let ci = 0; ci < candList.length; ci++) {
        const en = candList[ci];
        if (!en.alive) continue;
        _v1.copy(en.pos).setY(en.pos.y + 0.9);
        const dist = _v1.distanceTo(impactPt);
        const isDirect = directEnemy && en.id === directEnemy.id;
        if (!isDirect && dist > r.splashRadius) continue;

        const falloff = isDirect ? 1 : clamp(1 - dist / (r.splashRadius * 1.18), 0.42, 1);
        const dmg = Math.round(
          (isDirect ? r.directDamage + r.splashDamage : r.splashDamage) * falloff * bioticMult
        );
        const killed = en.damage(dmg, _v1, r.dir, 'splash') === true;
        if (G.combat && G.combat.stats) G.combat.stats.hits++;
        if (stats.visorLifestealRatio > 0 && G.player) {
          G.player.heal(Math.round(dmg * stats.visorLifestealRatio));
        }
        G.events.emit('player:hitEnemy', { enemy: en, part: 'body', killed, weak: false });
        cb.onDamageDealt(dmg, en, killed, false, 'helix');
        if (killed) cb.onHeavyHit?.(0.038, 2.2);
      }
    }
  }

  function startReload() {
    const stats = cb.getStats();
    magSize = stats.magSize;
    if (reloadTimer > 0 || ammo >= magSize || cb.isVisorActive()) return;
    cb.onCancelSprint();
    state = 'reload';
    reloadDuration = stats.reloadTime;
    reloadTimer = reloadDuration;
    cb.audio.shurikenReload();
  }

  function triggerRifleBash() {
    if (meleeTimer > 0) return;
    cb.onCancelSprint();
    meleeTimer = 0.28;
    state = 'melee';
    cb.audio.meleeSlash();

    const cam = G.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _v3.copy(cam.position).addScaledVector(_fwd, 1.9);
    if (G.level && G.level.damageInRadius) {
      G.level.damageInRadius(_v3, 2.2, 68, _fwd);
    }
    if (cb.cleaveColossalBoss) {
      cb.cleaveColossalBoss(cam.position, 4.4, 72, _fwd, 'melee');
    }
    if (G.enemies && G.enemies.list) {
      const liveEcs = (G.ecsCombat as EcsCombatBridge | undefined) ?? ecsCombat;
      let candList: any[] = G.enemies.list;
      if (liveEcs) {
        liveEcs.queryEnemiesInSphere(cam.position.x, cam.position.y, cam.position.z, 4.2, _ecsCand);
        candList = _ecsCand;
      }
      for (let ci = 0; ci < candList.length; ci++) {
        const en = candList[ci];
        if (!en.alive) continue;
        _v1.copy(en.pos).setY(en.pos.y + 0.9).sub(cam.position);
        const dist = _v1.length();
        if (dist <= 3.4 && (dist < 1.3 || _v1.normalize().dot(_fwd) > 0.35)) {
          const hitPt = _v2.copy(en.pos).setY(en.pos.y + 0.9);
          const killed = en.damage(68, hitPt, _fwd, 'splash') === true;
          cb.audio.bladeCleaveImpact(killed);
          cb.onHeavyHit?.(killed ? 0.04 : 0.022, 2.0);
          G.events.emit('player:hitEnemy', { enemy: en, part: 'body', killed, weak: false });
          cb.onDamageDealt(68, en, killed, false, 'melee');
        }
      }
    }
  }

  function updateWorldProjectiles(dt: number, visualOnly = false) {
    const stats = cb.getStats();

    // 1. Update Heavy Pulse Bolts
    let instIdx = 0;
    for (let i = 0; i < pulsePool.length; i++) {
      const b = pulsePool[i];
      if (!b.active) continue;
      b.elapsed += dt;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        continue;
      }

      if (!visualOnly && !b.impactResolved) {
        b.prev.copy(b.pos);
        const stepDist = b.speed * dt;
        _v1.copy(b.dir);

        const wHit = G.physics.raycast(b.prev, _v1, stepDist + 0.08);
        const dHit =
          G.level && typeof G.level.raycastDestructible === 'function'
            ? G.level.raycastDestructible(b.prev, _v1, wHit ? wHit.dist + 0.08 : stepDist + 0.12)
            : null;
        const eHit = G.enemies ? G.enemies.raycast(b.prev, _v1, stepDist + 0.28) : null;
        const cHit = cb.raycastColossalBoss
          ? cb.raycastColossalBoss(b.prev, _v1, stepDist + 0.32)
          : null;

        let bestType: 'none' | 'world' | 'destructible' | 'enemy' | 'colossus' = 'none';
        let bestDist = stepDist;
        if (wHit && wHit.dist <= bestDist) {
          bestDist = wHit.dist;
          bestType = 'world';
        }
        if (dHit && dHit.dist <= bestDist + 0.06) {
          bestDist = dHit.dist;
          bestType = 'destructible';
        }
        if (eHit && eHit.dist <= bestDist + 0.14 && !b.hitIds.has(eHit.enemy.id)) {
          bestDist = eHit.dist;
          bestType = 'enemy';
        }
        if (cHit && cHit.dist <= bestDist + 0.14) {
          bestDist = cHit.dist;
          bestType = 'colossus';
        }

        if (bestType === 'enemy' && eHit) {
          b.hitIds.add(eHit.enemy.id);
          const isHead = eHit.part === 'head' || eHit.part === 'weak';
          const shotRes = computeGunnerShotDamage({
            baseDamage: b.damage,
            consecutiveHits: overchargeStreak,
            inBioticField: cb.isInBioticField(),
            isWeakspot: isHead,
            isVisorLock: b.visorLocked,
          });
          overchargeStreak = Math.min(10, overchargeStreak + 1);
          overchargeDecayT = 1.65;

          const dmg = shotRes.damage;
          const killed = eHit.enemy.damage(dmg, eHit.point, _v1, isHead ? 'weak' : 'body') === true;
          if (G.combat && G.combat.stats) G.combat.stats.hits++;
          if (stats.visorLifestealRatio > 0 && G.player) {
            G.player.heal(Math.max(1, Math.round(dmg * stats.visorLifestealRatio)));
          }
          cb.audio.bulletHitConfirm(isHead);
          spawnBulletImpactFx(eHit.point, _v1, true, isHead || shotRes.overchargeRatio >= 0.6);

          G.events.emit('player:hitEnemy', {
            enemy: eHit.enemy,
            part: isHead ? 'weak' : eHit.part,
            killed,
            weak: isHead,
          });
          cb.onDamageDealt(dmg, eHit.enemy, killed, isHead, b.visorLocked ? 'visor' : 'rifle');
          if (b.pierceLeft > 0) {
            b.pierceLeft--;
            b.pos.copy(b.prev).addScaledVector(_v1, stepDist);
          } else {
            b.impactPoint.copy(eHit.point);
            b.impactResolved = true;
          }
        } else if (bestType === 'colossus' && cHit && cb.damageColossalBoss) {
          const isWeak = cHit.orbIndex >= 0;
          const shotRes = computeGunnerShotDamage({
            baseDamage: b.damage,
            consecutiveHits: overchargeStreak,
            inBioticField: cb.isInBioticField(),
            isWeakspot: isWeak,
            isVisorLock: b.visorLocked,
          });
          overchargeStreak = Math.min(10, overchargeStreak + 1);
          overchargeDecayT = 1.65;

          const res = cb.damageColossalBoss(shotRes.damage, cHit.point, _v1, cHit.orbIndex, 'rifle');
          if (G.combat && G.combat.stats) G.combat.stats.hits++;
          cb.audio.bulletHitConfirm(isWeak);
          spawnBulletImpactFx(cHit.point, _v1, true, isWeak);
          cb.onDamageDealt(shotRes.damage, null, res.killed, isWeak, 'rifle');
          b.impactPoint.copy(cHit.point);
          b.impactResolved = true;
        } else if (bestType === 'destructible' && dHit) {
          if (G.level && typeof G.level.damageDestructible === 'function') {
            const res = G.level.damageDestructible(dHit.item, b.damage * 0.85, dHit.point, _v1);
            if (res && res.destroyed) cb.audio.structureBreak(true);
          }
          spawnBulletImpactFx(dHit.point, _v1, false, false);
          b.impactPoint.copy(dHit.point);
          b.impactResolved = true;
        } else if (bestType === 'world' && wHit) {
          spawnBulletImpactFx(wHit.point, _v1, false, false);
          b.impactPoint.copy(wHit.point);
          b.impactResolved = true;
        } else {
          b.pos.copy(b.prev).addScaledVector(_v1, stepDist);
          if (isProjectileOutOfPlayableBounds(b.pos, b.origin, 135)) {
            b.active = false;
            continue;
          }
        }
      }

      let drawPos = b.pos;
      if (b.impactResolved) {
        const vis = computeProjectileVisualPosition(b.origin, b.impactPoint, b.elapsed, b.minVisDur);
        if (vis.done) {
          b.active = false;
          continue;
        }
        _v5.set(vis.pos.x, vis.pos.y, vis.pos.z);
        drawPos = _v5;
      }

      const camDist = G.camera.position.distanceTo(drawPos);
      const vScale = computeProjectileVisualScale(camDist, 1.15);
      _q1.setFromUnitVectors(_zNeg, b.dir);
      _scale.set(vScale * 1.15, vScale * 1.15, Math.min(2.6, vScale * 1.35));
      _mat4.compose(drawPos, _q1, _scale);
      pulseBoltMesh.setMatrixAt(instIdx, _mat4);
      _scale.setScalar(vScale * 1.28);
      _mat4.compose(drawPos, _q1, _scale);
      pulseCoreMesh.setMatrixAt(instIdx, _mat4);
      instIdx++;
    }
    if (pulseBoltMesh.count !== instIdx || instIdx > 0) {
      pulseBoltMesh.count = instIdx;
      pulseCoreMesh.count = instIdx;
      pulseBoltMesh.instanceMatrix.needsUpdate = true;
      pulseCoreMesh.instanceMatrix.needsUpdate = true;
    }

    // 2. Update Volumetric Muzzle-to-Target Tracer Beams!
    let cyanIdx = 0;
    let overIdx = 0;
    let coreIdx = 0;
    for (let i = 0; i < tracerPool.length; i++) {
      const tr = tracerPool[i];
      if (!tr.active) continue;
      tr.life -= dt;
      if (tr.life <= 0) {
        tr.active = false;
        continue;
      }
      const p = clamp01(tr.life / tr.maxLife);
      // Tracer head sweeps rapidly forward as tail pulls cleanly toward impact!
      const tailAdvance = (1 - p) * Math.min(tr.length * 0.65, 18);
      const drawLen = Math.max(0.2, tr.length - tailAdvance);
      _v1.copy(tr.start).addScaledVector(tr.dir, tailAdvance);
      _q1.setFromUnitVectors(_zNeg, tr.dir);
      const thickness = p * (tr.overcharged ? 1.35 : 1.05);
      _scale.set(thickness, thickness, drawLen);
      _mat4.compose(_v1, _q1, _scale);
      if (tr.overcharged) {
        tracerOverMesh.setMatrixAt(overIdx++, _mat4);
      } else {
        tracerCyanMesh.setMatrixAt(cyanIdx++, _mat4);
      }
      _scale.set(thickness * 0.72, thickness * 0.72, drawLen);
      _mat4.compose(_v1, _q1, _scale);
      tracerWhiteCoreMesh.setMatrixAt(coreIdx++, _mat4);
    }
    if (tracerCyanMesh.count !== cyanIdx || cyanIdx > 0) {
      tracerCyanMesh.count = cyanIdx;
      tracerCyanMesh.instanceMatrix.needsUpdate = true;
    }
    if (tracerOverMesh.count !== overIdx || overIdx > 0) {
      tracerOverMesh.count = overIdx;
      tracerOverMesh.instanceMatrix.needsUpdate = true;
    }
    if (tracerWhiteCoreMesh.count !== coreIdx || coreIdx > 0) {
      tracerWhiteCoreMesh.count = coreIdx;
      tracerWhiteCoreMesh.instanceMatrix.needsUpdate = true;
    }

    // 3. Update Impact Spark Bursts & Shock Rings
    let spNormIdx = 0;
    let spCritIdx = 0;
    for (let i = 0; i < impactSparkPool.length; i++) {
      const sp = impactSparkPool[i];
      if (!sp.active) continue;
      sp.life -= dt;
      if (sp.life <= 0) {
        sp.active = false;
        continue;
      }
      sp.vel.y -= 16 * dt;
      sp.pos.addScaledVector(sp.vel, dt);
      _v2.copy(sp.vel);
      if (_v2.lengthSq() > 1e-4) _v2.normalize();
      _q2.setFromUnitVectors(_zPos, _v2);
      const s = clamp01(sp.life / sp.maxLife) * (sp.crit ? 1.35 : 1.0);
      _scale.set(s, s, s * 1.4);
      _mat4.compose(sp.pos, _q2, _scale);
      if (sp.crit) {
        impactCritSparkMesh.setMatrixAt(spCritIdx++, _mat4);
      } else {
        impactSparkMesh.setMatrixAt(spNormIdx++, _mat4);
      }
    }
    if (impactSparkMesh.count !== spNormIdx || spNormIdx > 0) {
      impactSparkMesh.count = spNormIdx;
      impactSparkMesh.instanceMatrix.needsUpdate = true;
    }
    if (impactCritSparkMesh.count !== spCritIdx || spCritIdx > 0) {
      impactCritSparkMesh.count = spCritIdx;
      impactCritSparkMesh.instanceMatrix.needsUpdate = true;
    }

    let ringIdx = 0;
    const camQuat = G.camera.quaternion;
    for (let i = 0; i < impactRingPool.length; i++) {
      const r = impactRingPool[i];
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        continue;
      }
      const p = clamp01(1 - r.life / r.maxLife);
      const sc = 0.24 + p * r.maxScale;
      _scale.setScalar(sc);
      _mat4.compose(r.pos, camQuat, _scale);
      impactRingInstMesh.setMatrixAt(ringIdx, _mat4);
      const d4 = ringIdx * 4;
      impactRingInstData[d4] = r.colR;
      impactRingInstData[d4 + 1] = r.colG;
      impactRingInstData[d4 + 2] = r.colB;
      impactRingInstData[d4 + 3] = p;
      ringIdx++;
    }
    if (impactRingInstMesh.count !== ringIdx || ringIdx > 0) {
      impactRingInstMesh.count = ringIdx;
      impactRingInstMesh.visible = ringIdx > 0;
      if (ringIdx > 0) {
        impactRingInstMesh.instanceMatrix.needsUpdate = true;
        impactRingInstAttr.needsUpdate = true;
      }
    }

    // 4. Update Corkscrew Helix Rockets (5 GPU InstancedMeshes instead of 120 individual Meshes!)
    gunnerShaderClock.value = clockT;
    let rktIdx = 0;
    const liveEcs = (G.ecsCombat as EcsCombatBridge | undefined) ?? ecsCombat;
    for (let i = 0; i < rocketPool.length; i++) {
      const r = rocketPool[i];
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        continue;
      }

      if (!visualOnly) {
        if (r.homing && G.enemies && G.enemies.list) {
          let bestEn: any = null;
          let bestD2 = 42 * 42;
          let candList: any[] = G.enemies.list;
          if (liveEcs) {
            liveEcs.queryEnemiesInSphere(r.pos.x, r.pos.y, r.pos.z, 42, _ecsCand);
            candList = _ecsCand;
          }
          for (let ci = 0; ci < candList.length; ci++) {
            const en = candList[ci];
            if (!en.alive) continue;
            const d2 = en.pos.distanceToSquared(r.pos);
            if (d2 < bestD2) {
              bestD2 = d2;
              bestEn = en;
            }
          }
          if (bestEn) {
            _v2.copy(bestEn.pos).setY(bestEn.pos.y + 0.95).sub(r.basePos).normalize();
            r.dir.lerp(_v2, clamp01(dt * 8.5)).normalize();
          }
        }

        r.prev.copy(r.pos);
        r.basePos.addScaledVector(r.dir, r.speed * dt);
        r.phase += dt * 22.0;
        r.pos
          .copy(r.basePos)
          .addScaledVector(r.right, Math.cos(r.phase) * r.spiralRadius)
          .addScaledVector(r.up, Math.sin(r.phase) * r.spiralRadius);

        _v1.subVectors(r.pos, r.prev);
        const segLen = _v1.length();
        if (segLen > 1e-4) {
          _v1.multiplyScalar(1 / segLen);
          const wHit = G.physics.raycast(r.prev, _v1, segLen + 0.14);
          const dHit =
            G.level && typeof G.level.raycastDestructible === 'function'
              ? G.level.raycastDestructible(r.prev, _v1, segLen + 0.16)
              : null;
          const eHit = G.enemies ? G.enemies.raycast(r.prev, _v1, segLen + 0.35) : null;
          const cHit = cb.raycastColossalBoss
            ? cb.raycastColossalBoss(r.prev, _v1, segLen + 0.42)
            : null;

          if (eHit && (!wHit || eHit.dist <= wHit.dist + 0.15)) {
            detonateHelixRocket(r, eHit.point, eHit.enemy);
            continue;
          }
          if (cHit && (!wHit || cHit.dist <= wHit.dist + 0.15)) {
            detonateHelixRocket(r, cHit.point, null);
            continue;
          }
          if (dHit && (!wHit || dHit.dist <= wHit.dist + 0.1)) {
            detonateHelixRocket(r, dHit.point, null);
            continue;
          }
          if (wHit) {
            detonateHelixRocket(r, wHit.point, null);
            continue;
          }
        }
      }

      _q1.setFromUnitVectors(_zNeg, r.dir);
      _q2.setFromAxisAngle(_zPos, r.phase);
      _q1.multiply(_q2);
      _scale.setScalar(1);
      _mat4.compose(r.pos, _q1, _scale);
      rocketNoseInst.setMatrixAt(rktIdx, _mat4);
      rocketBodyInst.setMatrixAt(rktIdx, _mat4);
      rocketFinInst.setMatrixAt(rktIdx, _mat4);
      rocketPlumeInst.setMatrixAt(rktIdx, _mat4);
      rocketCoreInst.setMatrixAt(rktIdx, _mat4);
      rktIdx++;
    }
    if (rocketNoseInst.count !== rktIdx || rktIdx > 0) {
      const hasRkts = rktIdx > 0;
      rocketNoseInst.count = rktIdx;
      rocketBodyInst.count = rktIdx;
      rocketFinInst.count = rktIdx;
      rocketPlumeInst.count = rktIdx;
      rocketCoreInst.count = rktIdx;
      rocketNoseInst.visible = hasRkts;
      rocketBodyInst.visible = hasRkts;
      rocketFinInst.visible = hasRkts;
      rocketPlumeInst.visible = hasRkts;
      rocketCoreInst.visible = hasRkts;
      if (hasRkts) {
        rocketNoseInst.instanceMatrix.needsUpdate = true;
        rocketBodyInst.instanceMatrix.needsUpdate = true;
        rocketFinInst.instanceMatrix.needsUpdate = true;
        rocketPlumeInst.instanceMatrix.needsUpdate = true;
        rocketCoreInst.instanceMatrix.needsUpdate = true;
      }
    }

    // 5. Update Turbulent Plasma Fireball Blasts (1 GPU InstancedMesh!)
    let blIdx = 0;
    for (let i = 0; i < blastPool.length; i++) {
      const bl = blastPool[i];
      if (!bl.active) continue;
      bl.life -= dt;
      if (bl.life <= 0) {
        bl.active = false;
        continue;
      }
      const p = clamp01(1 - bl.life / bl.maxLife);
      const ease = 1 - Math.pow(1 - p, 3);
      bl.rotY += dt * 5;
      const halfY = bl.rotY * 0.5;
      _q1.set(0, Math.sin(halfY), 0, Math.cos(halfY));
      _scale.setScalar(0.38 + ease * bl.maxRadius * 0.72);
      _mat4.compose(bl.pos, _q1, _scale);
      blastInstMesh.setMatrixAt(blIdx, _mat4);
      blastProgressData[blIdx] = p;
      blIdx++;
    }
    if (blastInstMesh.count !== blIdx || blIdx > 0) {
      blastInstMesh.count = blIdx;
      blastInstMesh.visible = blIdx > 0;
      if (blIdx > 0) {
        blastInstMesh.instanceMatrix.needsUpdate = true;
        blastProgressAttr.needsUpdate = true;
      }
    }

    // 6. Animate Deployable Biotic Overdrive Beacon & Polar Ground Aura
    if (bioticFieldTimer > 0) {
      bioticFieldTimer -= dt;
      bioticBeaconGroup.visible = true;
      bioticFieldUniforms.uFade.value = Math.min(1, bioticFieldTimer / 0.55);
      beaconFieldPlane.scale.setScalar(bioticFieldRadius);
      beaconCore.rotation.y = clockT * 4.5;
    } else if (bioticBeaconGroup.visible) {
      bioticBeaconGroup.visible = false;
    }
  }

  function updateViewmodel(dt: number) {
    clockT += dt;
    const stats = cb.getStats();
    magSize = stats.magSize;
    if (ammo > magSize) ammo = magSize;

    fireCooldown = Math.max(0, fireCooldown - dt);
    meleeTimer = Math.max(0, meleeTimer - dt);
    muzzleFlashT = Math.max(0, muzzleFlashT - dt);
    dynamicSpread = Math.max(0, dynamicSpread - dt * 0.095);
    muzzleFlashStar.visible = muzzleFlashT > 0;

    if (overchargeDecayT > 0) {
      overchargeDecayT -= dt;
      if (overchargeDecayT <= 0) {
        overchargeStreak = 0;
      }
    }

    if (reloadTimer > 0) {
      reloadTimer -= dt;
      if (reloadTimer <= 0) {
        reloadTimer = 0;
        ammo = magSize;
        state = 'idle';
      }
    }

    const input = G.input;
    const player = G.player;
    const tIn = cb.touch;
    const tFirePressed = tIn ? tIn.consumeFirePressed() : false;
    const tFireHeld = tIn ? tIn.isFireHeld() : false;
    const tFanPressed = tIn ? tIn.consumeFanPressed() : false;
    const tMeleePressed = tIn ? tIn.consumeMeleePressed() : false;
    const tReloadPressed = tIn ? tIn.consumeReloadPressed() : false;
    const rawLmb = consumeRawMouseLatch(0);
    const rawRmb = consumeRawMouseLatch(2);

    updateVisorLockState(stats);
    const visorOn = cb.isVisorActive();

    if (player && player.alive && player.enabled) {
      if ((input.pressed('reload') || tReloadPressed) && !visorOn) {
        startReload();
      } else if (input.pressed('melee') || tMeleePressed) {
        triggerRifleBash();
      } else if (reloadTimer <= 0 && meleeTimer <= 0) {
        if (rawRmb || input.pressed('ads') || tFanPressed) {
          fireHelixVolley();
        }
        const wantFire =
          rawLmb ||
          rawMouseHeld.has(0) ||
          input.fire ||
          input.pressed('fire') ||
          tFireHeld ||
          tFirePressed;
        if (wantFire && fireCooldown <= 0) {
          if (ammo > 0 || visorOn) {
            firePulseRound(stats);
            let rateMult = 1;
            if (visorOn) rateMult += stats.visorFireRateBonus;
            if (cb.isInBioticField()) rateMult += stats.bioticFireRateBonus;
            fireCooldown = stats.rifleFireInterval / rateMult;
            state = 'firing';
          } else {
            startReload();
          }
        } else if (!wantFire) {
          shotsInBurst = 0;
          if (state === 'firing') state = 'idle';
        }
      }
    }

    const isSprinting = cb.isSprinting() && reloadTimer <= 0 && meleeTimer <= 0 && !visorOn;

    // Passive Tactical Sprint Auto-Feed (`10` rounds/sec regenerated while sprinting!)
    if (isSprinting && ammo < magSize) {
      sprintAmmoCarry += dt * 10;
      if (sprintAmmoCarry >= 1) {
        const add = Math.floor(sprintAmmoCarry);
        sprintAmmoCarry -= add;
        ammo = Math.min(magSize, ammo + add);
      }
    } else if (!isSprinting) {
      sprintAmmoCarry = 0;
    }

    if (ammo <= 0 && reloadTimer <= 0 && !visorOn) {
      startReload();
    }

    stepSpring(spSwayX, clamp(-input.look.dx * 16, -0.08, 0.08), dt);
    stepSpring(spSwayY, clamp(-input.look.dy * 16, -0.08, 0.08), dt);
    stepSpring(spKickZ, 0, dt);
    stepSpring(spKickPitch, 0, dt);
    stepSpring(spKickYaw, 0, dt);

    const speedRatio = player ? clamp01(player.speed / 8.5) : 0;
    const bobFreq = isSprinting ? 13.5 : 9.2;
    const bobX = Math.sin(clockT * bobFreq) * (isSprinting ? 0.024 : 0.011) * speedRatio;
    const bobY = Math.abs(Math.cos(clockT * bobFreq)) * -(isSprinting ? 0.026 : 0.013) * speedRatio;

    // Live Reciprocating Gold Bolt Carrier, Rotary Helix Pod, Ammo Bar & Barrel Heat Glow!
    boltCarrier.position.z = -0.02 + Math.min(0.068, spKickZ.x * 0.058);
    helixPod.rotation.z = damp(helixPod.rotation.z, helixPodSpin, 14, dt);

    const ammoFrac = clamp01(ammo / Math.max(1, magSize));
    ammoBarFill.scale.x = Math.max(0.06, ammoFrac);
    ammoBarFill.position.x = -0.022 - (1 - ammoFrac) * 0.015;
    if (visorOn) {
      ammoBarFill.material.color.setHex(0xff4c38).multiplyScalar(2.4);
      opticLens.material.color.setHex(0xff4c38).multiplyScalar(2.5);
      opticWindowGlass.material.color.setHex(0xff4c38);
    } else if (ammoFrac <= 0.25) {
      ammoBarFill.material.color.setHex(0xff842a).multiplyScalar(2.2);
      opticLens.material.color.setHex(0x52ecff).multiplyScalar(2.2);
      opticWindowGlass.material.color.setHex(0x46dcff);
    } else {
      ammoBarFill.material.color.setHex(0x52ecff).multiplyScalar(2.2);
      opticLens.material.color.setHex(0x52ecff).multiplyScalar(2.2);
      opticWindowGlass.material.color.setHex(0x46dcff);
    }

    const heatFrac = visorOn ? 1 : overchargeStreak / 10;
    barrelHeatTube.material.color
      .setHex(heatFrac > 0.55 ? 0xff7642 : 0x52ecff)
      .multiplyScalar(1.8 + heatFrac * 1.4);

    // Update View-Layer Spinning Ejected Shell Casings
    let shCount = 0;
    for (let i = 0; i < shellPool.length; i++) {
      const sh = shellPool[i];
      if (!sh.active) continue;
      sh.life -= dt;
      if (sh.life <= 0) {
        sh.active = false;
        continue;
      }
      sh.vel.y -= 6.8 * dt;
      sh.pos.addScaledVector(sh.vel, dt);
      sh.rot.x += sh.rotVel.x * dt;
      sh.rot.y += sh.rotVel.y * dt;
      sh.rot.z += sh.rotVel.z * dt;
      _q1.setFromEuler(sh.rot);
      _scale.setScalar(1);
      _mat4.compose(sh.pos, _q1, _scale);
      shellInstMesh.setMatrixAt(shCount++, _mat4);
    }
    if (shellInstMesh.count !== shCount || shCount > 0) {
      shellInstMesh.count = shCount;
      shellInstMesh.instanceMatrix.needsUpdate = true;
    }

    if (meleeTimer > 0) {
      const mp = 1 - meleeTimer / 0.28;
      const swing = Math.sin(mp * Math.PI);
      rifleGroup.position.set(0.138 - swing * 0.22, -0.088 + swing * 0.068, -0.45 - swing * 0.12);
      rifleGroup.rotation.set(swing * 0.38, 0.11 + swing * 0.80, -swing * 0.44);
    } else if (reloadTimer > 0) {
      const rp = 1 - reloadTimer / Math.max(0.25, reloadDuration);
      const magOut = Math.sin(rp * Math.PI);
      magGroup.position.set(-magOut * 0.04, -0.068 - magOut * 0.15, -0.08 + magOut * 0.04);
      rifleGroup.position.set(0.122 + bobX, -0.086 + magOut * 0.036 + bobY * 0.6, -0.445);
      rifleGroup.rotation.set(0.20 * magOut, 0.12 + 0.32 * magOut, 0.30 * magOut);
    } else if (isSprinting) {
      magGroup.position.set(0, -0.068, -0.08);
      rifleGroup.position.x = damp(rifleGroup.position.x, 0.042 + bobX, 14, dt);
      rifleGroup.position.y = damp(rifleGroup.position.y, -0.102 + bobY * 0.55, 14, dt);
      rifleGroup.position.z = damp(rifleGroup.position.z, -0.435, 14, dt);
      rifleGroup.rotation.x = damp(rifleGroup.rotation.x, -0.10 + bobY * 1.6, 14, dt);
      rifleGroup.rotation.y = damp(rifleGroup.rotation.y, 0.64 + bobX * 1.6, 14, dt);
      rifleGroup.rotation.z = damp(rifleGroup.rotation.z, 0.22, 14, dt);
    } else {
      magGroup.position.set(0, -0.068, -0.08);
      const visorBrace = visorOn ? 1 : 0;
      rifleGroup.position.x = damp(
        rifleGroup.position.x,
        (visorBrace ? 0.108 : 0.138) + bobX + spSwayX.x * 0.4,
        18,
        dt
      );
      rifleGroup.position.y = damp(
        rifleGroup.position.y,
        (visorBrace ? -0.078 : -0.088) + bobY * 0.65 + spSwayY.x * 0.4,
        18,
        dt
      );
      rifleGroup.position.z = -0.455 + spKickZ.x * 0.042;
      rifleGroup.rotation.set(
        0.032 + spKickPitch.x * 0.12 + spSwayY.x * 0.5,
        (visorBrace ? 0.065 : 0.115) + spKickYaw.x * 0.11 + spSwayX.x * 0.5,
        -0.038 + spKickYaw.x * 0.08
      );
    }
  }

  function clearProjectiles() {
    for (const b of pulsePool) {
      b.active = false;
      b.impactResolved = false;
    }
    pulseBoltMesh.count = 0;
    pulseCoreMesh.count = 0;
    pulseBoltMesh.instanceMatrix.needsUpdate = true;
    pulseCoreMesh.instanceMatrix.needsUpdate = true;

    for (const tr of tracerPool) tr.active = false;
    tracerCyanMesh.count = 0;
    tracerOverMesh.count = 0;
    tracerWhiteCoreMesh.count = 0;
    tracerCyanMesh.instanceMatrix.needsUpdate = true;
    tracerOverMesh.instanceMatrix.needsUpdate = true;
    tracerWhiteCoreMesh.instanceMatrix.needsUpdate = true;

    for (const sp of impactSparkPool) sp.active = false;
    impactSparkMesh.count = 0;
    impactCritSparkMesh.count = 0;
    impactSparkMesh.instanceMatrix.needsUpdate = true;
    impactCritSparkMesh.instanceMatrix.needsUpdate = true;

    for (const r of impactRingPool) r.active = false;
    impactRingInstMesh.count = 0;
    impactRingInstMesh.visible = false;

    for (const sh of shellPool) sh.active = false;
    shellInstMesh.count = 0;
    shellInstMesh.instanceMatrix.needsUpdate = true;

    for (const r of rocketPool) r.active = false;
    rocketNoseInst.count = 0;
    rocketBodyInst.count = 0;
    rocketFinInst.count = 0;
    rocketPlumeInst.count = 0;
    rocketCoreInst.count = 0;
    rocketNoseInst.visible = false;
    rocketBodyInst.visible = false;
    rocketFinInst.visible = false;
    rocketPlumeInst.visible = false;
    rocketCoreInst.visible = false;

    for (const bl of blastPool) bl.active = false;
    blastInstMesh.count = 0;
    blastInstMesh.visible = false;

    bioticFieldTimer = 0;
    bioticBeaconGroup.visible = false;
  }

  function reset() {
    const stats = cb.getStats();
    magSize = stats.magSize;
    ammo = magSize;
    state = 'idle';
    fireCooldown = 0;
    reloadTimer = 0;
    meleeTimer = 0;
    muzzleFlashT = 0;
    dynamicSpread = 0;
    shotsInBurst = 0;
    overchargeStreak = 0;
    overchargeDecayT = 0;
    visorHudState.active = false;
    visorHudState.locked = false;
    clearProjectiles();
  }

  reset();

  return {
    name: '重型脉冲步枪 · 螺旋飞弹',
    get ammo() {
      return ammo;
    },
    set ammo(v: number) {
      ammo = clamp(Math.floor(v), 0, magSize);
    },
    get magSize() {
      return magSize;
    },
    reserve: 999,
    get state() {
      return reloadTimer > 0 ? 'reloading' : state;
    },
    ads: 0,
    spread: 0.0085,
    damage: 34,
    rpm: 770,
    root,
    update(dt: number) {
      updateViewmodel(dt);
      updateWorldProjectiles(dt, false);
    },
    updateVisualsOnly(dt: number) {
      clockT += dt;
      updateWorldProjectiles(dt, true);
    },
    clearProjectiles,
    getActiveProjectileCount() {
      return pulseBoltMesh.count + tracerCyanMesh.count + tracerOverMesh.count;
    },
    reset,
    setVisible(v: boolean) {
      root.visible = !!v;
      if (v) {
        rifleGroup.visible = true;
        rightGlove.visible = true;
        leftSupportHand.visible = true;
      }
    },
    onEquip() {
      rawMouseLatched.clear();
      rawMouseHeld.clear();
      reloadTimer = 0;
      meleeTimer = 0;
      muzzleFlashT = 0;
      muzzleFlashStar.visible = false;
      state = 'idle';
      spKickZ.x = spKickZ.v = 0;
      spKickPitch.x = spKickPitch.v = 0;
      spKickYaw.x = spKickYaw.v = 0;
      spSwayX.x = spSwayX.v = 0;
      spSwayY.x = spSwayY.v = 0;
      rifleGroup.visible = true;
      rightGlove.visible = true;
      leftSupportHand.visible = true;
      magGroup.position.set(0, -0.068, -0.08);
      rifleGroup.position.set(0.162, -0.110, -0.415);
      rifleGroup.rotation.set(0.025, 0.035, -0.018);
      setViewLayerRecursive(root);
      updateViewmodel(0.001);
    },
    setWetness() {},
    reloadNow: startReload,
    addAmmo(n: number) {
      ammo = clamp(ammo + n, 0, cb.getStats().magSize);
    },
    snap() {
      spKickZ.x = spKickZ.v = 0;
      spKickPitch.x = spKickPitch.v = 0;
      spKickYaw.x = spKickYaw.v = 0;
      spSwayX.x = spSwayX.v = 0;
      spSwayY.x = spSwayY.v = 0;
    },
    fireHelixVolley,
    deployBioticField(worldPos: any, duration: number, radius: number) {
      bioticFieldTimer = duration;
      bioticFieldRadius = radius;
      bioticBeaconGroup.position.set(worldPos.x, worldPos.y, worldPos.z);
      beaconFieldPlane.scale.setScalar(radius * 1.05);
      bioticFieldUniforms.uFade.value = 1;
      bioticBeaconGroup.visible = true;
    },
    onCastVisor() {
      const stats = cb.getStats();
      magSize = stats.magSize;
      ammo = magSize;
      reloadTimer = 0;
      state = 'idle';
      spKickZ.v += 1.4;
    },
    getVisorHudState(): VisorLockHudState {
      return visorHudState;
    },
    getPoolDiagnostics() {
      return {
        pulseCap: MAX_PULSE_BOLTS,
        pulseActive: pulseBoltMesh.count,
        tracerCap: MAX_TRACERS,
        rocketCap: MAX_ROCKETS,
        shellCap: MAX_SHELLS,
        sparkCap: MAX_IMPACT_SPARKS,
      };
    },
  };
}
