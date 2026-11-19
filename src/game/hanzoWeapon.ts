/**
 * Masterwork Shimada Hanzo (`岛田半藏 · 风林岚弓`) First-Person Viewmodel & Ballistic Combat System
 * Classical Kyudo & Spirit-Dragon Archery Kit:
 * - LMB: Storm Bow (`风 · 蓄力岚弓`, hold to draw 0..100%, release to fire high-impact ballistic arrow; RMB cancels draw)
 * - E: Storm Arrows (`岚 · 岚矢`, instant-nock rapid-fire azure arrows with wall/floor specular + smart ricochet)
 * - Shift: Sonic Arrow (`音 · 音障探测矢`, deploys a 3D Azure Sonar Recon Dome revealing enemies & amplifying damage by 1.25x+)
 * - V: Bow-Limb Strike (`弓身速击`, quick close-quarters arc strike)
 * - Q: Dragonstrike (`龙 · 龙魂双生`, spirit arrow erupts into Twin Spiraling Azure Spirit Dragons piercing all walls & terrain)
 *
 * Strictly Zero-GC in per-frame combat loops: all vectors, matrices, instanced meshes, sonic domes,
 * impact sparks, slipstream wakes, and Twin Spirit Dragon rigs are pre-allocated at initialization.
 */

import {
  clamp01,
  computeConvergedLaunchVector,
  computeHanzoBowDraw,
  computeStormArrowRicochet,
  isProjectileOutOfPlayableBounds,
  type HanzoStats,
  type Vec3Like,
} from './roguelike.ts';
import { clamp, damp } from './rules.ts';
import {
  PROJECTILE_KIND,
  type EcsCombatBridge,
} from './ecsCombatBridge.ts';
import type { CombatFeelVfxController } from './combatFeelVfx.ts';
import type { GenjiAudioController } from './genjiAudio.ts';
import {
  buildMasterworkStormBowRig,
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

export interface HanzoWeaponCallbacks {
  getStats: () => HanzoStats;
  isActive: () => boolean;
  isStormActive: () => boolean;
  getStormArrowsLeft: () => number;
  consumeStormArrow: () => void;
  hasSmartRicochet: () => boolean;
  hasStormSiphon: () => boolean;
  hasLightDrawMove: () => boolean;
  isSonicArmed: () => boolean;
  consumeSonicArmed: () => void;
  onSonicFieldDeployed?: (duration: number) => void;
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
  touch?: {
    isFireHeld: () => boolean;
    consumeFirePressed: () => boolean;
    consumeFanPressed: () => boolean;
    consumeMeleePressed: () => boolean;
    consumeReloadPressed?: () => boolean;
  };
}

export interface HanzoBowHudState {
  drawRatio: number;
  isDrawing: boolean;
  arrowMode: 'normal' | 'sonic' | 'storm';
  stormArrowsLeft: number;
  sonicActiveT: number;
}

export function createHanzoWeapon(G: any, cb: HanzoWeaponCallbacks) {
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

  const makeGlowMat = (hex: number, opacity = 0.9, additive = true, boost = 1.9) =>
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex).multiplyScalar(boost),
      transparent: opacity < 0.999 || additive,
      opacity,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !additive && opacity >= 0.999,
      toneMapped: false,
      side: THREE.DoubleSide,
    });

  // ==========================================================================
  // 1. FIRST-PERSON MASTERWORK KYUDO STORM BOW VIEWMODEL (`VIEW_LAYER = 1`)
  // ==========================================================================
  const root = new THREE.Group();
  root.name = 'viewmodel-hanzo-root';
  root.visible = false;

  const pbrMats = getHeroViewmodelPbrSuite(G);
  const bowRig = buildMasterworkStormBowRig(THREE, pbrMats);
  const { bowGroup } = bowRig;

  // Traditional ergonomic canted Kyudo posture (`斜倾射法`):
  // Framed so BOTH Left `押手` Bow-Grip Hand/Forearm and Right `胜手三弽` String-Drawing Hand/Forearm
  // stay 100% inside the camera frustum from 0% idle to 100% full draw while keeping `(0,0)` crosshair clear!
  const BASE_POS = { x: 0.105, y: -0.102, z: -0.545 };
  const BASE_ROT = { x: 0.030, y: -0.115, z: -0.44 };
  bowGroup.position.set(BASE_POS.x, BASE_POS.y, BASE_POS.z);
  bowGroup.rotation.set(BASE_ROT.x, BASE_ROT.y, BASE_ROT.z);
  root.add(bowGroup);

  const hanzoShaderClock = { value: 0 };

  // Ethereal Polar Spirit-Wind Release Burst Shader (replaces crossed rectangular PlaneGeometries!)
  const releaseBurstUniforms = {
    uTime: hanzoShaderClock,
    uProgress: { value: 0 },
  };
  const matBowReleaseBurstShader = new THREE.ShaderMaterial({
    uniforms: releaseBurstUniforms,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uProgress;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float ang = atan(vUv.y, vUv.x);
        float ringR = mix(0.16, 0.88, uProgress);
        float shockRing = exp(-pow((r - ringR) * 7.5, 2.0));
        float windSpiral = pow(max(0.0, sin(ang * 4.0 - r * 6.5 + uTime * 22.0)), 4.0) * smoothstep(1.0, 0.12, r);
        float core = exp(-r * r * 18.0) * (1.0 - uProgress);
        float fade = 1.0 - smoothstep(0.35, 1.0, uProgress);
        float a = (shockRing * 0.78 + windSpiral * 0.52 + core * 0.85) * fade * smoothstep(1.0, 0.82, r);
        if (a < 0.015) discard;
        vec3 col = mix(vec3(0.22, 0.82, 1.0), vec3(0.92, 0.99, 1.0), clamp(core + shockRing * 0.65, 0.0, 1.0));
        gl_FragColor = vec4(col * 2.1, clamp(a, 0.0, 0.92));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const releaseFlashGroup = new THREE.Group();
  releaseFlashGroup.position.set(0.016, 0.038, -0.26);
  releaseFlashGroup.visible = false;
  const releaseBurstQuad = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    matBowReleaseBurstShader
  );
  releaseFlashGroup.add(releaseBurstQuad);
  bowGroup.add(releaseFlashGroup);

  setViewLayerRecursive(root);
  (G.camera || G.viewCamera).add(root);

  // ==========================================================================
  // 2. WORLD-SPACE POOLED ARROWS, SONIC DOMES & TWIN SPIRIT DRAGONS (ZERO-GC)
  // ==========================================================================
  const worldGroup = new THREE.Group();
  worldGroup.name = 'hanzo-world-fx';
  G.scene.add(worldGroup);

  const matArrowCarbon = pbrMats.carbonWeave;
  const matArrowHeadAzure = makeGlowMat(0x5ceaff, 0.96, true, 2.4);

  // Grazing-dissolved + longitudinal end-feathered Instanced Slipstream Shader (zero hard cylinder edges!)
  const matHanzoSlipstreamShader = new THREE.ShaderMaterial({
    uniforms: {
      uTime: hanzoShaderClock,
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
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float silhouetteSoft = pow(ndv, 1.35);
        float endFade = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.14, vUv.y);
        float helix = 0.62 + 0.38 * sin(vUv.y * 20.0 - uTime * 34.0 + vUv.x * 12.56637);
        float a = silhouetteSoft * endFade * helix * 0.78;
        if (a < 0.012) discard;
        vec3 col = mix(vec3(0.14, 0.72, 1.0), vec3(0.86, 0.98, 1.0), pow(ndv, 2.2) * 0.75);
        gl_FragColor = vec4(col * 1.95, clamp(a, 0.0, 0.88));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  // (A) Pooled Ballistic Arrows (`MAX_ARROWS = 64`)
  const MAX_ARROWS = 64;
  const arrowShaftGeo = new THREE.CylinderGeometry(0.011, 0.013, 0.92, 6);
  arrowShaftGeo.rotateX(Math.PI / 2);
  const arrowHeadGeo = new THREE.ConeGeometry(0.032, 0.18, 6);
  arrowHeadGeo.rotateX(-Math.PI / 2);
  arrowHeadGeo.translate(0, 0, -0.50);
  const arrowWakeGeo = new THREE.CylinderGeometry(0.014, 0.052, 1.55, 12, 1, true);
  arrowWakeGeo.rotateX(Math.PI / 2);
  arrowWakeGeo.translate(0, 0, 0.68);

  const arrowShaftInst = new THREE.InstancedMesh(arrowShaftGeo, matArrowCarbon, MAX_ARROWS);
  const arrowHeadInst = new THREE.InstancedMesh(arrowHeadGeo, matArrowHeadAzure, MAX_ARROWS);
  const arrowWakeInst = new THREE.InstancedMesh(arrowWakeGeo, matHanzoSlipstreamShader, MAX_ARROWS);
  for (const im of [arrowShaftInst, arrowHeadInst, arrowWakeInst]) {
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    im.count = 0;
    worldGroup.add(im);
  }

  interface ActiveArrow {
    active: boolean;
    pos: any;
    prev: any;
    origin: any;
    vel: any;
    dir: any;
    gravityDrop: number;
    damage: number;
    drawRatio: number;
    isStorm: boolean;
    isSonic: boolean;
    isDragonCatalyst: boolean;
    bouncesLeft: number;
    pierceLeft: number;
    bleedDps: number;
    life: number;
    elapsed: number;
    hitIds: Set<number>;
  }

  const arrowPool: ActiveArrow[] = [];
  for (let i = 0; i < MAX_ARROWS; i++) {
    arrowPool.push({
      active: false,
      pos: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      origin: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, -1),
      gravityDrop: 3.0,
      damage: 125,
      drawRatio: 1,
      isStorm: false,
      isSonic: false,
      isDragonCatalyst: false,
      bouncesLeft: 0,
      pierceLeft: 0,
      bleedDps: 0,
      life: 0,
      elapsed: 0,
      hitIds: new Set<number>(),
    });
  }

  const _ecsCand: any[] = [];
  const ecsCombat = G.ecsCombat as EcsCombatBridge | undefined;
  if (ecsCombat) {
    ecsCombat.registerProjectilePool({
      name: 'hanzo_arrows',
      kind: PROJECTILE_KIND.HANZO_ARROW,
      faction: 0,
      items: arrowPool,
      isActive: (a) => a.active,
    });
  }

  // (B) Pooled Slipstream Trail Streaks (`MAX_SLIPSTREAMS = 36`) for crisp ballistic trajectory feedback
  const MAX_SLIPSTREAMS = 36;
  const slipstreamGeo = new THREE.CylinderGeometry(0.014, 0.026, 1.0, 10, 1, true);
  slipstreamGeo.rotateX(Math.PI / 2);
  const slipstreamInst = new THREE.InstancedMesh(
    slipstreamGeo,
    matHanzoSlipstreamShader,
    MAX_SLIPSTREAMS
  );
  slipstreamInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  slipstreamInst.frustumCulled = false;
  slipstreamInst.count = 0;
  worldGroup.add(slipstreamInst);

  interface ActiveSlipstream {
    active: boolean;
    mid: any;
    quat: any;
    len: number;
    width: number;
    life: number;
    maxLife: number;
  }
  const slipstreamPool: ActiveSlipstream[] = [];
  for (let i = 0; i < MAX_SLIPSTREAMS; i++) {
    slipstreamPool.push({
      active: false,
      mid: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      len: 1,
      width: 1,
      life: 0,
      maxLife: 0.16,
    });
  }

  // (C) Pooled Velocity-Aligned Needle Impact Spark Bursts (`MAX_IMPACT_SPARKS = 40`)
  const MAX_IMPACT_SPARKS = 40;
  const sparkGeo = new THREE.OctahedronGeometry(0.022, 0);
  sparkGeo.scale(0.45, 0.45, 3.8);
  const sparkInst = new THREE.InstancedMesh(
    sparkGeo,
    makeGlowMat(0xa8f8ff, 0.96, true, 2.7),
    MAX_IMPACT_SPARKS
  );
  sparkInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparkInst.frustumCulled = false;
  sparkInst.count = 0;
  worldGroup.add(sparkInst);

  interface ImpactSpark {
    active: boolean;
    pos: any;
    vel: any;
    life: number;
    maxLife: number;
    scale: number;
  }
  const sparkPool: ImpactSpark[] = [];
  for (let i = 0; i < MAX_IMPACT_SPARKS; i++) {
    sparkPool.push({
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 0.18,
      scale: 1,
    });
  }

  // (D) Pooled 3D Azure Acoustic Recon Fields (`音障探测矢声呐领域`, `MAX_SONIC_DOMES = 3`)
  // Uses custom spherical wavefront + polar ground-ripple GLSL shaders (zero plastic dome shell!)
  const MAX_SONIC_DOMES = 3;
  interface ActiveSonicDome {
    active: boolean;
    center: any;
    radius: number;
    life: number;
    maxLife: number;
    pulsePhase: number;
    group: any;
    shell: any;
    pulseRing: any;
    beaconSpike: any;
    shellUniforms: any;
    groundUniforms: any;
  }
  const sonicDomePool: ActiveSonicDome[] = [];
  const domeSphereGeo = new THREE.SphereGeometry(1.0, 28, 18);
  const domeGroundPlaneGeo = new THREE.PlaneGeometry(2.0, 2.0).rotateX(-Math.PI / 2);
  const domeBeaconGeo = new THREE.CylinderGeometry(0.008, 0.036, 0.65, 8);

  for (let i = 0; i < MAX_SONIC_DOMES; i++) {
    const grp = new THREE.Group();
    grp.visible = false;
    grp.frustumCulled = false;

    const shellUniforms = {
      uTime: hanzoShaderClock,
      uPulse: { value: 0 },
      uFade: { value: 1 },
    };
    const shellMat = new THREE.ShaderMaterial({
      uniforms: shellUniforms,
      vertexShader: `
        varying vec3 vLocalPos;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          vLocalPos = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormalV = normalize(normalMatrix * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uPulse;
        uniform float uFade;
        varying vec3 vLocalPos;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          if (vLocalPos.y < -0.02) discard;
          // Spherical latitude sweep from apex (+1) down to ground horizon (0)
          float lat = clamp(1.0 - vLocalPos.y, 0.0, 1.0);
          float scanBand = exp(-pow((lat - uPulse) * 14.0, 2.0));
          float horizonLine = exp(-pow(vLocalPos.y * 18.0, 2.0));
          float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
          float rimWhisper = pow(1.0 - ndv, 3.2) * smoothstep(0.0, 0.25, vLocalPos.y);
          float hexRipple = 0.6 + 0.4 * sin(vLocalPos.x * 22.0 + cos(vLocalPos.z * 22.0) * 1.5 - uTime * 5.0);
          float a = (scanBand * 0.52 * hexRipple + horizonLine * 0.42 + rimWhisper * 0.16) * uFade;
          if (a < 0.012) discard;
          vec3 col = mix(vec3(0.16, 0.82, 1.0), vec3(0.82, 0.99, 1.0), scanBand);
          gl_FragColor = vec4(col * 1.9, clamp(a, 0.0, 0.72));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const groundUniforms = {
      uTime: hanzoShaderClock,
      uPulse: shellUniforms.uPulse,
      uFade: shellUniforms.uFade,
    };
    const groundMat = new THREE.ShaderMaterial({
      uniforms: groundUniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uPulse;
        uniform float uFade;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float ang = atan(vUv.y, vUv.x);
          float outerBoundary = exp(-pow((r - 0.97) * 28.0, 2.0));
          float sonarWave = exp(-pow((r - uPulse) * 14.0, 2.0)) * (1.0 - smoothstep(0.86, 1.0, uPulse));
          float compassTicks = pow(abs(cos(ang * 8.0)), 18.0) * smoothstep(0.86, 0.97, r) * (1.0 - smoothstep(0.98, 1.0, r));
          float centerPing = exp(-r * r * 48.0) * (0.65 + 0.35 * sin(uTime * 10.0));
          float a = (outerBoundary * 0.62 + sonarWave * 0.68 + compassTicks * 0.45 + centerPing * 0.75) * uFade;
          if (a < 0.012) discard;
          vec3 col = mix(vec3(0.18, 0.86, 1.0), vec3(0.88, 0.99, 1.0), sonarWave + centerPing);
          gl_FragColor = vec4(col * 2.0, clamp(a, 0.0, 0.85));
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

    const shell = new THREE.Mesh(domeSphereGeo, shellMat);
    shell.renderOrder = 4;
    const pulseRing = new THREE.Mesh(domeGroundPlaneGeo, groundMat);
    pulseRing.position.y = 0.04;
    pulseRing.renderOrder = 5;
    const beaconSpike = new THREE.Mesh(domeBeaconGeo, matHanzoSlipstreamShader);
    beaconSpike.position.y = 0.34;
    grp.add(shell, pulseRing, beaconSpike);
    worldGroup.add(grp);

    sonicDomePool.push({
      active: false,
      center: new THREE.Vector3(),
      radius: 13.0,
      life: 0,
      maxLife: 6.5,
      pulsePhase: 0,
      group: grp,
      shell,
      pulseRing,
      beaconSpike,
      shellUniforms,
      groundUniforms,
    });
  }

  // (E) Pooled Ultimate: Twin Spiraling Azure Spirit Dragons (`龙 · 龙魂双生`, `MAX_DRAGONSTRIKES = 2`)
  // Grazing-dissolved + longitudinal segment-feathered FBM Spirit-Fire Shader (supports InstancedMesh!)
  const dragonScaleShaderMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: hanzoShaderClock,
      uOpacity: { value: 0.94 },
    },
    vertexShader: `
      #ifdef USE_INSTANCING
        attribute float aSegOpacity;
      #endif
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      varying float vSegOpacity;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING
          vSegOpacity = aSegOpacity;
          vec4 mvPos = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        #else
          vSegOpacity = 1.0;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
        #endif
        vViewPos = -mvPos.xyz;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      varying float vSegOpacity;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        vec3 viewDir = normalize(vViewPos);
        float ndv = abs(dot(viewDir, normalize(vNormal)));
        // Dissolve silhouette at grazing angles so individual segments NEVER show plastic edges!
        float silhouetteSoft = pow(ndv, 1.28);
        // Smoothly feather both segment ends so overlapping segments fuse into one continuous river of chi!
        float endFade = smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.78, vUv.y);

        vec2 flowUv = vec2(vUv.x * 6.0, vUv.y * 7.5 - uTime * 4.8);
        float n1 = vnoise(flowUv);
        float n2 = vnoise(flowUv * 2.15 + vec2(1.7, -uTime * 3.2));
        float spiritFire = n1 * 0.62 + n2 * 0.38;
        float scalePattern = 0.5 + 0.5 * sin(vUv.y * 26.0 - uTime * 15.0 + sin(vUv.x * 18.8495) * 1.45);
        float spineCore = pow(ndv, 2.6) * (0.55 + 0.45 * spiritFire);

        vec3 deepIndigo = vec3(0.04, 0.28, 0.95);
        vec3 luminousCyan = vec3(0.20, 0.88, 1.0);
        vec3 celestialWhite = vec3(0.92, 0.99, 1.0);

        vec3 col = mix(deepIndigo, luminousCyan, spiritFire * 0.68 + scalePattern * 0.32);
        col = mix(col, celestialWhite, clamp(spineCore * 1.15, 0.0, 1.0));

        float effOpacity = uOpacity * vSegOpacity;
        float alpha = silhouetteSoft * endFade * (0.36 + spiritFire * 0.48 + spineCore * 0.34) * effOpacity;
        if (alpha < 0.012) discard;
        gl_FragColor = vec4(col * 2.05, clamp(alpha, 0.0, 0.92));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  // Ethereal Spirit-Flame Mane, Antler & Whisker Shader (supports InstancedMesh!)
  const dragonManeWispMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: hanzoShaderClock,
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
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float soft = pow(ndv, 0.95);
        float tipFade = smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.68, 1.0, vUv.x));
        float lick = 0.62 + 0.38 * sin(vUv.x * 18.0 - uTime * 20.0 + vUv.y * 6.283);
        float a = soft * (0.35 + 0.65 * tipFade) * lick * 0.86;
        if (a < 0.015) discard;
        vec3 col = mix(vec3(0.24, 0.86, 1.0), vec3(0.95, 0.99, 1.0), pow(ndv, 1.6));
        gl_FragColor = vec4(col * 2.2, clamp(a, 0.0, 0.92));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const dragonAxisVortexMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: hanzoShaderClock,
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float core = pow(ndv, 1.9);
        float endFade = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.84, vUv.y);
        float vortex = 0.55 + 0.45 * sin(vUv.y * 28.0 - uTime * 22.0 + vUv.x * 12.56637);
        float a = core * endFade * vortex * 0.42;
        if (a < 0.01) discard;
        vec3 col = mix(vec3(0.10, 0.62, 1.0), vec3(0.75, 0.96, 1.0), core);
        gl_FragColor = vec4(col * 1.85, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const dragonEyeMat = makeGlowMat(0xffffff, 0.98, true, 3.2);

  const DRAGON_SEGMENTS = 18;
  const DRAGON_BODY_LEN = 18.5;
  // Smooth 14-radial overlapping spirit-tube segments so consecutive segments blend seamlessly!
  const segBodyGeo = new THREE.CylinderGeometry(0.45, 0.54, 1.72, 14, 1, true);
  segBodyGeo.rotateX(Math.PI / 2);

  // Organic curved dorsal spirit-flame mane ribbon (`TubeGeometry` instead of sharp 4-sided Cone!)
  const dorsalManeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.34, -0.35),
    new THREE.Vector3(0, 0.68, 0.05),
    new THREE.Vector3(0, 0.82, 0.52),
  ]);
  const segFinGeo = new THREE.TubeGeometry(dorsalManeCurve, 8, 0.085, 6, false);

  // Sculpted organic head geometries (shared across both spirit dragons, zero BoxGeometry!)
  const dragonCraniumGeo = new THREE.SphereGeometry(0.58, 16, 12);
  dragonCraniumGeo.scale(0.92, 0.74, 1.32);
  const dragonSnoutGeo = new THREE.SphereGeometry(0.42, 14, 10);
  dragonSnoutGeo.scale(0.84, 0.52, 1.78);
  const dragonJawGeo = new THREE.SphereGeometry(0.34, 12, 8);
  dragonJawGeo.scale(0.76, 0.36, 1.55);
  const dragonPearlGeo = new THREE.SphereGeometry(0.22, 12, 10);
  const dragonEyeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  dragonEyeGeo.scale(0.75, 0.58, 1.75);

  function buildSpiritDragonHead(): any {
    const head = new THREE.Group();
    head.frustumCulled = false;

    const cranium = new THREE.Mesh(dragonCraniumGeo, dragonScaleShaderMat);
    const upperSnout = new THREE.Mesh(dragonSnoutGeo, dragonScaleShaderMat);
    upperSnout.position.set(0, 0.06, -0.82);

    const lowerJaw = new THREE.Mesh(dragonJawGeo, dragonScaleShaderMat);
    lowerJaw.position.set(0, -0.22, -0.68);
    lowerJaw.rotation.x = 0.26;

    const spiritPearl = new THREE.Mesh(dragonPearlGeo, dragonManeWispMat);
    spiritPearl.position.set(0, -0.05, -0.74);

    head.add(cranium, upperSnout, lowerJaw, spiritPearl);

    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(dragonEyeGeo, dragonEyeMat);
      eye.position.set(sx * 0.38, 0.18, -0.42);

      const antlerCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx * 0.24, 0.28, 0.02),
        new THREE.Vector3(sx * 0.42, 0.62, 0.48),
        new THREE.Vector3(sx * 0.32, 0.94, 1.08),
      ]);
      const antlerMain = new THREE.Mesh(
        new THREE.TubeGeometry(antlerCurve, 10, 0.062, 6, false),
        dragonManeWispMat
      );

      const whiskerCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(sx * 0.28, -0.02, -1.06),
        new THREE.Vector3(sx * 0.62, 0.10, -0.62),
        new THREE.Vector3(sx * 0.82, -0.08, 0.16),
      ]);
      const whisker = new THREE.Mesh(
        new THREE.TubeGeometry(whiskerCurve, 10, 0.024, 5, false),
        dragonManeWispMat
      );

      head.add(eye, antlerMain, whisker);
    }
    return head;
  }

  interface SingleDragonChain {
    head: any;
  }
  interface ActiveDragonstrike {
    active: boolean;
    headPos: any;
    dir: any;
    right: any;
    up: any;
    speed: number;
    radius: number;
    twinScale: number;
    dps: number;
    life: number;
    maxLife: number;
    spinPhase: number;
    tickAccum: number;
    group: any;
    dragonA: SingleDragonChain;
    dragonB: SingleDragonChain;
    coreAxisBeam: any;
  }

  const MAX_DRAGONSTRIKES = 2;
  const TOTAL_DRAGON_SEG_INSTANCES = MAX_DRAGONSTRIKES * 2 * DRAGON_SEGMENTS;
  const segBodyOpacityData = new Float32Array(TOTAL_DRAGON_SEG_INSTANCES).fill(1);
  const segBodyOpacityAttr = new THREE.InstancedBufferAttribute(segBodyOpacityData, 1);
  segBodyOpacityAttr.setUsage(THREE.DynamicDrawUsage);
  segBodyGeo.setAttribute('aSegOpacity', segBodyOpacityAttr);

  const dragonSegBodyInst = new THREE.InstancedMesh(
    segBodyGeo,
    dragonScaleShaderMat,
    TOTAL_DRAGON_SEG_INSTANCES,
  );
  dragonSegBodyInst.frustumCulled = false;
  dragonSegBodyInst.count = 0;
  dragonSegBodyInst.visible = false;
  dragonSegBodyInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  worldGroup.add(dragonSegBodyInst);

  const dragonSegFinInst = new THREE.InstancedMesh(
    segFinGeo,
    dragonManeWispMat,
    TOTAL_DRAGON_SEG_INSTANCES,
  );
  dragonSegFinInst.frustumCulled = false;
  dragonSegFinInst.count = 0;
  dragonSegFinInst.visible = false;
  dragonSegFinInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  worldGroup.add(dragonSegFinInst);

  const dragonPool: ActiveDragonstrike[] = [];
  const axisBeamGeo = new THREE.CylinderGeometry(0.42, 0.42, DRAGON_BODY_LEN, 12, 1, true);
  axisBeamGeo.rotateX(Math.PI / 2);
  axisBeamGeo.translate(0, 0, DRAGON_BODY_LEN * 0.5);

  for (let dIdx = 0; dIdx < MAX_DRAGONSTRIKES; dIdx++) {
    const grp = new THREE.Group();
    grp.visible = false;
    grp.frustumCulled = false;

    const makeChain = (): SingleDragonChain => {
      const head = buildSpiritDragonHead();
      grp.add(head);
      return { head };
    };

    const dragonA = makeChain();
    const dragonB = makeChain();
    const coreAxisBeam = new THREE.Mesh(axisBeamGeo, dragonAxisVortexMat);
    grp.add(coreAxisBeam);
    worldGroup.add(grp);

    dragonPool.push({
      active: false,
      headPos: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      speed: 20,
      radius: 4.4,
      twinScale: 1.0,
      dps: 260,
      life: 0,
      maxLife: 4.8,
      spinPhase: 0,
      tickAccum: 0,
      group: grp,
      dragonA,
      dragonB,
      coreAxisBeam,
    });
  }

  const combatVfx = G.combatVfx as CombatFeelVfxController | undefined;
  if (combatVfx) {
    combatVfx.registerBatch({
      name: 'hanzo_arrows',
      meshes: [arrowShaftInst, arrowHeadInst, arrowWakeInst],
      getActiveCount: () => arrowShaftInst.count,
      legacyMeshesPerItem: 3,
    });
    combatVfx.registerBatch({
      name: 'hanzo_slipstreams',
      meshes: [slipstreamInst],
      getActiveCount: () => slipstreamInst.count,
      legacyMeshesPerItem: 1,
    });
    combatVfx.registerBatch({
      name: 'hanzo_impact_sparks',
      meshes: [sparkInst],
      getActiveCount: () => sparkInst.count,
      legacyMeshesPerItem: 1,
    });
    combatVfx.registerBatch({
      name: 'hanzo_dragon_segments',
      meshes: [dragonSegBodyInst, dragonSegFinInst],
      getActiveCount: () => dragonSegBodyInst.count,
      legacyMeshesPerItem: 2,
      eliminatedSceneMeshes: TOTAL_DRAGON_SEG_INSTANCES * 2 - 2,
    });
  }

  // --- Pre-Allocated Scratch Math & Ricochet Candidate Buffers (Zero-GC) ---
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  const _v4 = new THREE.Vector3();
  const _v5 = new THREE.Vector3();
  const _segA = new THREE.Vector3();
  const _segB = new THREE.Vector3();
  const _closest = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _q1 = new THREE.Quaternion();
  const _mat4 = new THREE.Matrix4();
  const _scale = new THREE.Vector3();
  const _zNeg = new THREE.Vector3(0, 0, -1);

  const MAX_RICOCHET_CANDS = 16;
  const ricochetCandPool: Vec3Like[] = [];
  for (let i = 0; i < MAX_RICOCHET_CANDS; i++) {
    ricochetCandPool.push({ x: 0, y: 0, z: -1 });
  }
  const ricochetCandSlice: Vec3Like[] = [];

  // --- Runtime Bow & Ability State ---
  let state: 'idle' | 'drawing' | 'storm' | 'melee' = 'idle';
  let drawHoldTime = 0;
  let visualDrawRatio = 0;
  let isDrawingBow = false;
  let cancelHoldUntilRelease = false;
  let releaseCooldown = 0;
  let releaseFlashT = 0;
  let meleeTimer = 0;
  let clockT = 0;

  const spKickZ = makeSpring(280, 24);
  const spKickPitch = makeSpring(250, 22);
  const spSwayX = makeSpring(155, 18);
  const spSwayY = makeSpring(155, 18);

  const bowHudState: HanzoBowHudState = {
    drawRatio: 0,
    isDrawing: false,
    arrowMode: 'normal',
    stormArrowsLeft: 0,
    sonicActiveT: 0,
  };

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

  function getBowLaunchWorldOrigin(out: any): any {
    const cam = G.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    return out
      .copy(cam.position)
      .addScaledVector(_right, 0.16)
      .addScaledVector(_up, -0.09)
      .addScaledVector(_fwd, 0.52);
  }

  function checkLaunchObstruction(launchOrigin: any): number | null {
    const cam = G.camera;
    _v4.copy(launchOrigin).sub(cam.position);
    const dist = _v4.length();
    if (dist < 1e-4) return null;
    _v4.multiplyScalar(1 / dist);
    const hit =
      G.physics && typeof G.physics.raycast === 'function'
        ? G.physics.raycast(cam.position, _v4, dist + 0.05)
        : null;
    return hit ? hit.dist : null;
  }

  function computeCrosshairAimPoint(origin: any, dir: any, maxRange: number, out: any): any {
    let bestD = maxRange;
    const wHit =
      G.physics && typeof G.physics.raycast === 'function'
        ? G.physics.raycast(origin, dir, maxRange)
        : null;
    if (wHit && wHit.dist < bestD) bestD = wHit.dist;
    if (G.level && typeof G.level.raycastDestructible === 'function') {
      const dHit = G.level.raycastDestructible(origin, dir, bestD);
      if (dHit && dHit.dist < bestD) bestD = dHit.dist;
    }
    const cHit = cb.raycastColossalBoss ? cb.raycastColossalBoss(origin, dir, bestD) : null;
    if (cHit && cHit.dist < bestD) bestD = cHit.dist;
    const eHit =
      G.enemies && typeof G.enemies.raycast === 'function'
        ? G.enemies.raycast(origin, dir, bestD)
        : null;
    if (eHit && eHit.dist < bestD) bestD = eHit.dist;
    return out.copy(origin).addScaledVector(dir, bestD);
  }

  function spawnSlipstreamSegment(start: any, end: any, width = 1.0, maxLife = 0.16) {
    _v4.copy(end).sub(start);
    const len = _v4.length();
    if (len < 0.18) return;
    let slot: ActiveSlipstream | null = null;
    for (let i = 0; i < slipstreamPool.length; i++) {
      if (!slipstreamPool[i].active) {
        slot = slipstreamPool[i];
        break;
      }
    }
    if (!slot) slot = slipstreamPool[0];
    slot.active = true;
    slot.mid.copy(start).addScaledVector(_v4, 0.5);
    _v4.multiplyScalar(1 / len);
    slot.quat.setFromUnitVectors(_zNeg, _v4);
    slot.len = len;
    slot.width = width;
    slot.maxLife = maxLife;
    slot.life = maxLife;
  }

  function spawnImpactSparks(pt: any, dir: any, count = 6, scaleBoost = 1.0) {
    let spawned = 0;
    for (let i = 0; i < sparkPool.length && spawned < count; i++) {
      const s = sparkPool[i];
      if (s.active) continue;
      s.active = true;
      s.pos.copy(pt);
      s.vel.set(
        -dir.x * 3.8 + (Math.random() - 0.5) * 6.5,
        -dir.y * 2.5 + 1.8 + Math.random() * 4.2,
        -dir.z * 3.8 + (Math.random() - 0.5) * 6.5
      );
      s.maxLife = 0.16 + Math.random() * 0.08;
      s.life = s.maxLife;
      s.scale = (0.85 + Math.random() * 0.55) * scaleBoost;
      spawned++;
    }
  }

  function deploySonicReconDome(impactPt: any) {
    const stats = cb.getStats();
    let dome: ActiveSonicDome | null = null;
    for (let i = 0; i < sonicDomePool.length; i++) {
      if (!sonicDomePool[i].active) {
        dome = sonicDomePool[i];
        break;
      }
    }
    if (!dome) dome = sonicDomePool[0];

    dome.active = true;
    dome.center.copy(impactPt);
    dome.radius = stats.sonicRadius;
    dome.maxLife = stats.sonicDuration;
    dome.life = stats.sonicDuration;
    dome.pulsePhase = 0;
    dome.group.position.copy(impactPt);
    dome.shell.scale.setScalar(stats.sonicRadius);
    dome.group.children[1].scale.setScalar(stats.sonicRadius); // baseRing
    dome.pulseRing.scale.setScalar(0.5);
    dome.group.visible = true;

    cb.audio.sonicArrowPulse();
    cb.onSonicFieldDeployed?.(stats.sonicDuration);

    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(impactPt, 0x4ef6ff, 26, stats.sonicRadius * 0.9, 0.22);
    }

    // Optional `共鸣震波·破障鸣矢` (`deflect_iaido` override): AoE sonic shockwave damage on deploy!
    if (stats.sonicPulseDamage > 0) {
      const pulseDmg = stats.sonicPulseDamage;
      if (G.level && G.level.damageInRadius) {
        G.level.damageInRadius(impactPt, stats.sonicRadius * 0.75, pulseDmg, _zNeg);
      }
      if (cb.cleaveColossalBoss) {
        cb.cleaveColossalBoss(impactPt, stats.sonicRadius, pulseDmg, _zNeg, 'sonic_pulse');
      }
      if (G.enemies && G.enemies.list) {
        for (const en of G.enemies.list) {
          if (!en.alive) continue;
          const dx = en.pos.x - impactPt.x;
          const dy = en.pos.y + 0.9 - impactPt.y;
          const dz = en.pos.z - impactPt.z;
          if (dx * dx + dy * dy + dz * dz <= stats.sonicRadius * stats.sonicRadius) {
            _v4.set(en.pos.x, en.pos.y + 0.9, en.pos.z);
            const killed = en.damage(pulseDmg, _v4, _zNeg, 'splash') === true;
            G.events.emit('player:hitEnemy', { enemy: en, part: 'body', killed, weak: false });
            cb.onDamageDealt(pulseDmg, en, killed, false, 'sonic_pulse');
          }
        }
      }
    }
  }

  function isPointInSonicField(pos: Vec3Like): boolean {
    for (let i = 0; i < sonicDomePool.length; i++) {
      const d = sonicDomePool[i];
      if (!d.active || d.life <= 0) continue;
      const dx = pos.x - d.center.x;
      const dy = pos.y - d.center.y;
      const dz = pos.z - d.center.z;
      if (dx * dx + dy * dy + dz * dz <= d.radius * d.radius) {
        return true;
      }
    }
    return false;
  }

  function getSonicDamageMultiplier(pos: Vec3Like): number {
    return isPointInSonicField(pos) ? cb.getStats().sonicAmpMultiplier : 1.0;
  }

  function spawnDragonstrikeEntity(spawnPos: any, forwardDir: any) {
    const stats = cb.getStats();
    let ds: ActiveDragonstrike | null = null;
    for (let i = 0; i < dragonPool.length; i++) {
      if (!dragonPool[i].active) {
        ds = dragonPool[i];
        break;
      }
    }
    if (!ds) ds = dragonPool[0];

    ds.active = true;
    ds.dir.copy(forwardDir).normalize();
    // Advance headPos forward so the 10.8m Twin Spirit Dragon helix uncoils cleanly right in front of Hanzo
    ds.headPos.copy(spawnPos).addScaledVector(ds.dir, 5.2);
    if (Math.abs(ds.dir.y) > 0.92) {
      ds.right.set(1, 0, 0).cross(ds.dir).normalize();
    } else {
      ds.right.set(0, 1, 0).cross(ds.dir).normalize();
    }
    ds.up.copy(ds.dir).cross(ds.right).normalize();

    ds.speed = stats.dragonstrikeSpeed;
    ds.radius = stats.dragonstrikeRadius;
    ds.twinScale = stats.dragonstrikeTwinScale;
    ds.dps = stats.dragonstrikeDps;
    ds.maxLife = stats.dragonstrikeDuration;
    ds.life = stats.dragonstrikeDuration;
    ds.spinPhase = 0;
    ds.tickAccum = 0.14; // trigger immediate corridor wave on eruption
    ds.group.visible = true;

    if (G.player && G.player.addShake) {
      G.player.addShake(0.32);
    }
    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(spawnPos, 0x38d8ff, 42, 16, 0.35);
    }
  }

  function fireArrow(holdSec: number, isStormShot: boolean, isDragonCatalyst = false) {
    const stats = cb.getStats();
    const drawSpec = computeHanzoBowDraw({
      holdSeconds: isDragonCatalyst ? stats.fullDrawTime : holdSec,
      stats,
      isStormArrow: isStormShot || isDragonCatalyst,
    });

    if (G.combat && G.combat.stats) G.combat.stats.shots++;

    const cam = G.camera;
    const rawOrigin = getBowLaunchWorldOrigin(_v1);
    const blockedDist = checkLaunchObstruction(rawOrigin);
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);

    computeCrosshairAimPoint(cam.position, _fwd, 138, _v2);
    const pred = computeConvergedLaunchVector({
      cameraPos: cam.position,
      cameraForward: _fwd,
      rawHandOrigin: rawOrigin,
      aimHitPoint: _v2,
      handBlockedDist: blockedDist,
      projectileSpeed: drawSpec.speed,
    });

    let arrow: ActiveArrow | null = null;
    for (let i = 0; i < arrowPool.length; i++) {
      if (!arrowPool[i].active) {
        arrow = arrowPool[i];
        break;
      }
    }
    if (!arrow) arrow = arrowPool[0];

    const sonicArmed = !isDragonCatalyst && cb.isSonicArmed();
    if (sonicArmed) {
      cb.consumeSonicArmed();
    }
    if (isStormShot && !isDragonCatalyst) {
      cb.consumeStormArrow();
    }

    arrow.active = true;
    arrow.origin.set(pred.safeOrigin.x, pred.safeOrigin.y, pred.safeOrigin.z);
    arrow.pos.copy(arrow.origin);
    arrow.prev.copy(arrow.origin);
    arrow.dir.set(pred.dir.x, pred.dir.y, pred.dir.z);
    arrow.vel.copy(arrow.dir).multiplyScalar(isDragonCatalyst ? 22 : drawSpec.speed);
    arrow.gravityDrop = isDragonCatalyst ? 0 : drawSpec.gravityDrop;
    arrow.damage = isDragonCatalyst ? Math.round(stats.maxArrowDamage * 1.15) : drawSpec.damage;
    arrow.drawRatio = drawSpec.drawRatio;
    arrow.isStorm = isStormShot;
    arrow.isSonic = sonicArmed;
    arrow.isDragonCatalyst = isDragonCatalyst;
    arrow.bouncesLeft = isStormShot ? stats.stormRicochetBounces : 0;
    arrow.pierceLeft = isDragonCatalyst ? 99 : stats.pierceCount;
    arrow.bleedDps = stats.bleedDps;
    arrow.life = isDragonCatalyst ? 0.22 : 3.2;
    arrow.elapsed = 0;
    arrow.hitIds.clear();

    releaseFlashT = 0.085;
    releaseFlashGroup.rotation.z = Math.random() * Math.PI * 2;
    const flashScale = 0.85 + drawSpec.drawRatio * 0.55;
    releaseFlashGroup.scale.setScalar(flashScale);

    cb.audio.bowRelease(drawSpec.drawRatio, isStormShot || isDragonCatalyst);
    spKickZ.v += 1.65 + drawSpec.drawRatio * 1.45;
    spKickPitch.v += 0.55 + drawSpec.drawRatio * 0.72;
    if (G.player && G.player.addShake) {
      G.player.addShake(0.03 + drawSpec.drawRatio * 0.045);
    }
    if (G.render && G.render.lightPool && (isStormShot || sonicArmed || drawSpec.isFullDraw)) {
      G.render.lightPool.flash(arrow.origin, 0x4ee8ff, 18, 4.8, 0.045);
    }
  }

  function triggerBowMelee() {
    if (meleeTimer > 0) return;
    isDrawingBow = false;
    drawHoldTime = 0;
    meleeTimer = 0.28;
    state = 'melee';
    cb.audio.meleeSlash();

    const cam = G.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _v3.copy(cam.position).addScaledVector(_fwd, 1.85);
    if (G.level && G.level.damageInRadius) {
      G.level.damageInRadius(_v3, 2.1, 72, _fwd);
    }
    if (cb.cleaveColossalBoss) {
      cb.cleaveColossalBoss(cam.position, 4.2, 75, _fwd, 'melee');
    }
    if (G.enemies && G.enemies.list) {
      for (const en of G.enemies.list) {
        if (!en.alive) continue;
        _v1.copy(en.pos).setY(en.pos.y + 0.9).sub(cam.position);
        const dist = _v1.length();
        if (dist <= 3.3 && (dist < 1.3 || _v1.normalize().dot(_fwd) > 0.35)) {
          const hitPt = _v2.copy(en.pos).setY(en.pos.y + 0.9);
          const sonicMult = getSonicDamageMultiplier(hitPt);
          const dmg = Math.round(72 * sonicMult);
          const killed = en.damage(dmg, hitPt, _fwd, 'splash') === true;
          cb.audio.bladeCleaveImpact(killed);
          cb.onHeavyHit?.(killed ? 0.04 : 0.022, 2.0);
          G.events.emit('player:hitEnemy', { enemy: en, part: 'body', killed, weak: false });
          cb.onDamageDealt(dmg, en, killed, false, 'melee');
        }
      }
    }
  }

  function gatherRicochetCandidates(impactPoint: any): Vec3Like[] {
    ricochetCandSlice.length = 0;
    if (!cb.hasSmartRicochet() || !G.enemies || !G.enemies.list) {
      return ricochetCandSlice;
    }
    const liveEcs = (G.ecsCombat as EcsCombatBridge | undefined) ?? ecsCombat;
    let candList: any[] = G.enemies.list;
    if (liveEcs) {
      liveEcs.queryEnemiesInSphere(impactPoint.x, impactPoint.y, impactPoint.z, 26.5, _ecsCand);
      candList = _ecsCand;
    }
    let used = 0;
    for (let i = 0; i < candList.length && used < MAX_RICOCHET_CANDS; i++) {
      const en = candList[i];
      if (!en.alive) continue;
      const aimY = en.pos.y + (en.type === 'gull' ? 0.15 : en.type === 'hound' ? 0.65 : 1.35);
      const dx = en.pos.x - impactPoint.x;
      const dy = aimY - impactPoint.y;
      const dz = en.pos.z - impactPoint.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 0.25 || d2 > 26 * 26) continue;
      const inv = 1 / Math.sqrt(d2);
      const slot = ricochetCandPool[used++];
      slot.x = dx * inv;
      slot.y = dy * inv;
      slot.z = dz * inv;
      ricochetCandSlice.push(slot);
    }
    return ricochetCandSlice;
  }

  function updateDragonstrikes(dt: number, visualOnly: boolean) {
    const stats = cb.getStats();
    hanzoShaderClock.value = clockT;
    dragonScaleShaderMat.uniforms.uOpacity.value = 0.94;

    let segInstIdx = 0;
    for (let i = 0; i < dragonPool.length; i++) {
      const ds = dragonPool[i];
      if (!ds.active) continue;

      if (!visualOnly) {
        ds.life -= dt;
        if (ds.life <= 0) {
          ds.active = false;
          ds.group.visible = false;
          continue;
        }
        ds.headPos.addScaledVector(ds.dir, ds.speed * dt);
        ds.spinPhase += dt * 7.2;
      }

      const fadeRatio =
        Math.min(1, (ds.maxLife - ds.life) / 0.25) * Math.min(1, ds.life / 0.45);

      // Position axis core beam along `[headPos - dir * DRAGON_BODY_LEN, headPos]`
      ds.coreAxisBeam.position.copy(ds.headPos);
      _q1.setFromUnitVectors(_zNeg, ds.dir);
      ds.coreAxisBeam.quaternion.copy(_q1);
      ds.coreAxisBeam.scale.set(ds.twinScale, ds.twinScale, 1.0);

      const helixRadius = 1.42 * ds.twinScale;
      const updateSingleChain = (chain: SingleDragonChain, basePhaseOffset: number) => {
        // Head leads at `s = 0`
        const headAng = ds.spinPhase + basePhaseOffset;
        _v1
          .copy(ds.headPos)
          .addScaledVector(ds.right, Math.cos(headAng) * helixRadius)
          .addScaledVector(ds.up, Math.sin(headAng) * helixRadius);
        // Tangent direction of helix for graceful dragon head orientation
        _v2
          .copy(ds.dir)
          .addScaledVector(ds.right, -Math.sin(headAng) * 0.42)
          .addScaledVector(ds.up, Math.cos(headAng) * 0.42)
          .normalize();
        chain.head.position.copy(_v1);
        _q1.setFromUnitVectors(_zNeg, _v2);
        chain.head.quaternion.copy(_q1);
        chain.head.scale.setScalar(1.08 * ds.twinScale);

        for (let s = 0; s < DRAGON_SEGMENTS; s++) {
          const segDist = (s + 0.85) * (DRAGON_BODY_LEN / DRAGON_SEGMENTS);
          const ang = ds.spinPhase + basePhaseOffset - (s + 1) * 0.52;
          const rWave = helixRadius * (1.0 - (s / DRAGON_SEGMENTS) * 0.18);
          _v1
            .copy(ds.headPos)
            .addScaledVector(ds.dir, -segDist)
            .addScaledVector(ds.right, Math.cos(ang) * rWave)
            .addScaledVector(ds.up, Math.sin(ang) * rWave);
          _v2
            .copy(ds.dir)
            .addScaledVector(ds.right, -Math.sin(ang) * 0.38)
            .addScaledVector(ds.up, Math.cos(ang) * 0.38)
            .normalize();
          _q1.setFromUnitVectors(_zNeg, _v2);
          const taper = (1.0 - (s / DRAGON_SEGMENTS) * 0.56) * ds.twinScale;
          _scale.setScalar(taper);
          _mat4.compose(_v1, _q1, _scale);
          if (segInstIdx < TOTAL_DRAGON_SEG_INSTANCES) {
            dragonSegBodyInst.setMatrixAt(segInstIdx, _mat4);
            dragonSegFinInst.setMatrixAt(segInstIdx, _mat4);
            segBodyOpacityData[segInstIdx] = fadeRatio;
            segInstIdx++;
          }
        }
      };

      updateSingleChain(ds.dragonA, 0);
      updateSingleChain(ds.dragonB, Math.PI);

      // Corridor wall-piercing AoE tick (`0.14s` cadence)
      if (!visualOnly) {
        ds.tickAccum += dt;
        const TICK_DT = 0.14;
        while (ds.tickAccum >= TICK_DT) {
          ds.tickAccum -= TICK_DT;
          const tickDamageBase = Math.max(8, Math.round(ds.dps * TICK_DT));
          _segA.copy(ds.headPos).addScaledVector(ds.dir, 1.5);
          _segB.copy(ds.headPos).addScaledVector(ds.dir, -DRAGON_BODY_LEN);
          _v3.copy(_segB).sub(_segA);
          const abLen2 = Math.max(1e-5, _v3.lengthSq());

          // Shatter destructible props along the dragon path
          if (G.level && G.level.damageInRadius) {
            G.level.damageInRadius(ds.headPos, ds.radius * 0.95, tickDamageBase * 1.4, ds.dir);
          }

          // Cleave Colossal Boss
          if (cb.cleaveColossalBoss) {
            const cRes = cb.cleaveColossalBoss(
              ds.headPos,
              ds.radius + 2.4,
              tickDamageBase,
              ds.dir,
              'dragonstrike'
            );
            if (cRes.hit && stats.dragonstrikeLifestealRatio > 0 && G.player) {
              G.player.heal(Math.max(1, Math.round(tickDamageBase * stats.dragonstrikeLifestealRatio)));
            }
          }

          // Continuous corridor cleave on all enemies within `ds.radius` of `[segB, segA]` (pierces all walls!)
          if (G.enemies && G.enemies.list) {
            const rSq = ds.radius * ds.radius;
            for (const en of G.enemies.list) {
              if (!en.alive) continue;
              _v4.set(en.pos.x, en.pos.y + 0.95, en.pos.z);
              _v5.copy(_v4).sub(_segA);
              const tProj = clamp(_v5.dot(_v3) / abLen2, 0, 1);
              _closest.copy(_segA).addScaledVector(_v3, tProj);
              if (_closest.distanceToSquared(_v4) <= rSq) {
                const sonicMult = getSonicDamageMultiplier(_v4);
                const finalDmg = Math.round(tickDamageBase * sonicMult);
                const killed = en.damage(finalDmg, _v4, ds.dir, 'splash') === true;
                if (G.combat && G.combat.stats) G.combat.stats.hits++;
                if (stats.dragonstrikeLifestealRatio > 0 && G.player) {
                  G.player.heal(
                    Math.max(1, Math.round(finalDmg * stats.dragonstrikeLifestealRatio))
                  );
                }
                G.events.emit('player:hitEnemy', {
                  enemy: en,
                  part: 'body',
                  killed,
                  weak: false,
                });
                cb.onDamageDealt(finalDmg, en, killed, false, 'dragonstrike');
                if (killed) cb.onHeavyHit?.(0.032, 1.8);
              }
            }
          }
        }
      }
    }

    if (dragonSegBodyInst.count !== segInstIdx || segInstIdx > 0) {
      const hasSegs = segInstIdx > 0;
      dragonSegBodyInst.count = segInstIdx;
      dragonSegFinInst.count = segInstIdx;
      dragonSegBodyInst.visible = hasSegs;
      dragonSegFinInst.visible = hasSegs;
      if (hasSegs) {
        dragonSegBodyInst.instanceMatrix.needsUpdate = true;
        dragonSegFinInst.instanceMatrix.needsUpdate = true;
        segBodyOpacityAttr.needsUpdate = true;
      }
    }
  }

  function updateWorldProjectiles(dt: number, visualOnly = false) {
    const stats = cb.getStats();

    // 1. Update Pooled Ballistic Arrows
    let arrowInstIdx = 0;
    for (let i = 0; i < arrowPool.length; i++) {
      const a = arrowPool[i];
      if (!a.active) continue;

      if (!visualOnly) {
        a.elapsed += dt;
        a.life -= dt;
        if (a.life <= 0) {
          if (a.isDragonCatalyst) {
            spawnDragonstrikeEntity(a.pos, a.dir);
          }
          a.active = false;
          continue;
        }

        a.prev.copy(a.pos);
        a.vel.y -= a.gravityDrop * dt;
        _v1.copy(a.vel).multiplyScalar(dt);
        const stepDist = _v1.length();

        if (stepDist > 1e-5) {
          a.dir.copy(_v1).multiplyScalar(1 / stepDist);

          // Dragonstrike spirit catalyst arrow flies `0.34s` then erupts into Twin Spirit Dragons (or earlier if hitting world/enemy)
          let bestDist = stepDist;
          let hitKind: 'none' | 'world' | 'destructible' | 'colossus' | 'enemy' = 'none';

          const wHit =
            G.physics && typeof G.physics.raycast === 'function'
              ? G.physics.raycast(a.prev, a.dir, bestDist)
              : null;
          if (wHit && wHit.dist < bestDist) {
            bestDist = wHit.dist;
            hitKind = 'world';
          }
          const dHit =
            G.level && typeof G.level.raycastDestructible === 'function'
              ? G.level.raycastDestructible(a.prev, a.dir, bestDist)
              : null;
          if (dHit && dHit.dist < bestDist) {
            bestDist = dHit.dist;
            hitKind = 'destructible';
          }
          const cHit = cb.raycastColossalBoss
            ? cb.raycastColossalBoss(a.prev, a.dir, bestDist)
            : null;
          if (cHit && cHit.dist < bestDist) {
            bestDist = cHit.dist;
            hitKind = 'colossus';
          }
          const eHit =
            G.enemies && typeof G.enemies.raycast === 'function'
              ? G.enemies.raycast(a.prev, a.dir, bestDist)
              : null;
          if (eHit && eHit.enemy && !a.hitIds.has(eHit.enemy.id) && eHit.dist < bestDist) {
            bestDist = eHit.dist;
            hitKind = 'enemy';
          }

          if (a.isDragonCatalyst && hitKind !== 'none') {
            _v2.copy(a.prev).addScaledVector(a.dir, bestDist);
            spawnDragonstrikeEntity(_v2, a.dir);
            a.active = false;
            continue;
          }

          if (hitKind === 'enemy' && eHit) {
            a.hitIds.add(eHit.enemy.id);
            const isHead = eHit.part === 'head' || eHit.part === 'weak' || !!eHit.weak;
            if (a.isSonic) {
              a.isSonic = false;
              deploySonicReconDome(eHit.point);
            }
            const sonicMult = getSonicDamageMultiplier(eHit.point);
            const critMult = isHead ? stats.headshotMultiplier : 1.0;
            const finalDmg = Math.max(1, Math.round(a.damage * critMult * sonicMult));

            const killed =
              eHit.enemy.damage(finalDmg, eHit.point, a.dir, isHead ? 'head' : 'body') === true;
            if (a.bleedDps > 0 && eHit.enemy.alive) {
              eHit.enemy.__bleedT = stats.bleedDuration;
              eHit.enemy.__bleedDps = a.bleedDps;
            }
            if (G.combat && G.combat.stats) G.combat.stats.hits++;

            // Storm Siphon (`风林流转`) + Headshot/Dragon Blood lifesteal (`苍龙汲魂`)
            if (a.isStorm && cb.hasStormSiphon() && G.player) {
              G.player.heal(8);
            }
            if (isHead && a.drawRatio >= 0.9 && stats.dragonstrikeLifestealRatio > 0 && G.player) {
              G.player.heal(Math.max(1, Math.round(finalDmg * stats.dragonstrikeLifestealRatio)));
            }

            cb.audio.bulletHitConfirm(isHead);
            spawnSlipstreamSegment(a.prev, eHit.point, isHead ? 1.45 : 1.0, 0.16);
            spawnImpactSparks(eHit.point, a.dir, isHead ? 10 : 6, isHead ? 1.35 : 1.0);
            if (isHead || killed) {
              cb.onHeavyHit?.(isHead ? 0.042 : 0.025, isHead ? 2.4 : 1.5);
            }

            G.events.emit('player:hitEnemy', {
              enemy: eHit.enemy,
              part: isHead ? 'weak' : eHit.part,
              killed,
              weak: isHead,
            });
            cb.onDamageDealt(finalDmg, eHit.enemy, killed, isHead, a.isStorm ? 'storm_arrow' : 'bow');

            if (a.pierceLeft > 0) {
              a.pierceLeft--;
              a.pos.copy(a.prev).addScaledVector(a.dir, stepDist);
            } else {
              a.active = false;
              continue;
            }
          } else if (hitKind === 'colossus' && cHit && cb.damageColossalBoss) {
            const isWeak = cHit.orbIndex >= 0;
            if (a.isSonic) {
              a.isSonic = false;
              deploySonicReconDome(cHit.point);
            }
            const sonicMult = getSonicDamageMultiplier(cHit.point);
            const critMult = isWeak ? stats.headshotMultiplier : 1.0;
            const finalDmg = Math.max(1, Math.round(a.damage * critMult * sonicMult));
            const res = cb.damageColossalBoss(
              finalDmg,
              cHit.point,
              a.dir,
              cHit.orbIndex,
              a.isStorm ? 'storm_arrow' : 'bow'
            );
            if (G.combat && G.combat.stats) G.combat.stats.hits++;
            cb.audio.bulletHitConfirm(isWeak);
            spawnSlipstreamSegment(a.prev, cHit.point, 1.35, 0.16);
            spawnImpactSparks(cHit.point, a.dir, 9, 1.25);
            cb.onDamageDealt(finalDmg, null, res.killed, isWeak, a.isStorm ? 'storm_arrow' : 'bow');
            a.active = false;
            continue;
          } else if (hitKind === 'destructible' && dHit) {
            if (a.isSonic) {
              a.isSonic = false;
              deploySonicReconDome(dHit.point);
            }
            if (G.level && typeof G.level.damageDestructible === 'function') {
              const res = G.level.damageDestructible(dHit.item, a.damage * 1.05, dHit.point, a.dir);
              if (res && res.destroyed) cb.audio.structureBreak(true);
            }
            spawnSlipstreamSegment(a.prev, dHit.point, 1.0, 0.14);
            spawnImpactSparks(dHit.point, a.dir, 6, 1.0);
            if (a.pierceLeft > 0) {
              a.pierceLeft--;
              a.pos.copy(a.prev).addScaledVector(a.dir, stepDist);
            } else {
              a.active = false;
              continue;
            }
          } else if (hitKind === 'world' && wHit) {
            spawnSlipstreamSegment(a.prev, wHit.point, a.isStorm ? 1.25 : 0.95, 0.16);
            if (a.isSonic) {
              a.isSonic = false;
              deploySonicReconDome(wHit.point);
            }
            if (a.bouncesLeft > 0 && wHit.normal) {
              a.bouncesLeft--;
              const cands = gatherRicochetCandidates(wHit.point);
              const bounce = computeStormArrowRicochet({
                incidentDir: a.dir,
                surfaceNormal: wHit.normal,
                candidateTargetDirs: cands,
                minSnapCos: cb.hasSmartRicochet() ? 0.35 : 0.85,
              });
              const spd = a.vel.length() * 0.96;
              a.dir.set(bounce.outDir.x, bounce.outDir.y, bounce.outDir.z);
              a.vel.copy(a.dir).multiplyScalar(spd);
              if (bounce.snappedToTarget && cb.hasSmartRicochet()) {
                a.damage = Math.round(a.damage * 1.15);
              }
              a.pos.copy(wHit.point).addScaledVector(a.dir, 0.08);
              a.hitIds.clear();
              cb.audio.stormRicochet();
              spawnImpactSparks(wHit.point, a.dir, 7, 1.15);
            } else {
              spawnImpactSparks(wHit.point, a.dir, 5, 0.95);
              a.active = false;
              continue;
            }
          } else {
            a.pos.copy(a.prev).addScaledVector(_v1, 1.0);
            if (a.isStorm || a.drawRatio >= 0.65) {
              spawnSlipstreamSegment(a.prev, a.pos, a.isStorm ? 1.15 : 0.85, 0.11);
            }
            if (isProjectileOutOfPlayableBounds(a.pos, a.origin, 148)) {
              a.active = false;
              continue;
            }
          }
        }
      }

      // Render pooled instanced arrow shaft + broadhead + azure wake
      _q1.setFromUnitVectors(_zNeg, a.dir);
      const vScale = a.isDragonCatalyst ? 1.65 : a.isStorm ? 1.25 : 1.05;
      _scale.set(vScale, vScale, vScale);
      _mat4.compose(a.pos, _q1, _scale);
      arrowShaftInst.setMatrixAt(arrowInstIdx, _mat4);
      arrowHeadInst.setMatrixAt(arrowInstIdx, _mat4);
      _scale.set(
        vScale * (a.isStorm ? 1.35 : 1.0),
        vScale * (a.isStorm ? 1.35 : 1.0),
        vScale * (0.65 + a.drawRatio * 0.65)
      );
      _mat4.compose(a.pos, _q1, _scale);
      arrowWakeInst.setMatrixAt(arrowInstIdx, _mat4);
      arrowInstIdx++;
    }

    if (arrowShaftInst.count !== arrowInstIdx || arrowInstIdx > 0) {
      arrowShaftInst.count = arrowInstIdx;
      arrowHeadInst.count = arrowInstIdx;
      arrowWakeInst.count = arrowInstIdx;
      arrowShaftInst.instanceMatrix.needsUpdate = true;
      arrowHeadInst.instanceMatrix.needsUpdate = true;
      arrowWakeInst.instanceMatrix.needsUpdate = true;
    }

    // 2. Update Pooled Slipstream Segments
    let slipIdx = 0;
    for (let i = 0; i < slipstreamPool.length; i++) {
      const sl = slipstreamPool[i];
      if (!sl.active) continue;
      if (!visualOnly) {
        sl.life -= dt;
        if (sl.life <= 0) {
          sl.active = false;
          continue;
        }
      }
      const ratio = clamp01(sl.life / sl.maxLife);
      _scale.set(sl.width * ratio, sl.width * ratio, sl.len);
      _mat4.compose(sl.mid, sl.quat, _scale);
      slipstreamInst.setMatrixAt(slipIdx++, _mat4);
    }
    if (slipstreamInst.count !== slipIdx || slipIdx > 0) {
      slipstreamInst.count = slipIdx;
      slipstreamInst.instanceMatrix.needsUpdate = true;
    }

    // 3. Update Pooled Velocity-Aligned Needle Impact Sparks
    let spIdx = 0;
    for (let i = 0; i < sparkPool.length; i++) {
      const sp = sparkPool[i];
      if (!sp.active) continue;
      if (!visualOnly) {
        sp.life -= dt;
        if (sp.life <= 0) {
          sp.active = false;
          continue;
        }
        sp.vel.y -= 14.0 * dt;
        sp.pos.addScaledVector(sp.vel, dt);
      }
      const s = sp.scale * clamp01(sp.life / sp.maxLife);
      _v2.copy(sp.vel);
      if (_v2.lengthSq() > 1e-4) {
        _v2.normalize();
        _q1.setFromUnitVectors(_zNeg, _v2);
      } else {
        _q1.identity();
      }
      _scale.set(Math.max(0.06, s), Math.max(0.06, s), Math.max(0.08, s * 1.45));
      _mat4.compose(sp.pos, _q1, _scale);
      sparkInst.setMatrixAt(spIdx++, _mat4);
    }
    if (sparkInst.count !== spIdx || spIdx > 0) {
      sparkInst.count = spIdx;
      sparkInst.instanceMatrix.needsUpdate = true;
    }

    // 4. Update Pooled 3D Azure Sonar Recon Fields
    hanzoShaderClock.value = clockT;
    let maxSonicRemaining = 0;
    for (let i = 0; i < sonicDomePool.length; i++) {
      const d = sonicDomePool[i];
      if (!d.active) continue;
      if (!visualOnly) {
        d.life -= dt;
        if (d.life <= 0) {
          d.active = false;
          d.group.visible = false;
          continue;
        }
        d.pulsePhase = (d.pulsePhase + dt * 0.72) % 1.0;
      }
      if (d.life > maxSonicRemaining) maxSonicRemaining = d.life;
      const lifeFade = Math.min(1, d.life / 0.65);
      d.shellUniforms.uPulse.value = d.pulsePhase;
      d.shellUniforms.uFade.value = lifeFade;
      d.pulseRing.scale.setScalar(d.radius);
      d.beaconSpike.position.y = 0.34 + Math.sin(clockT * 4.5) * 0.05;
    }
    bowHudState.sonicActiveT = maxSonicRemaining;

    // 5. Update Twin Spiraling Azure Spirit Dragons
    updateDragonstrikes(dt, visualOnly);
  }

  function updateViewmodelTransform(dt: number, stats: HanzoStats) {
    hanzoShaderClock.value = clockT;
    const stormOn = cb.isStormActive();
    const sonicOn = cb.isSonicArmed();
    const arrowMode: 'normal' | 'sonic' | 'storm' = stormOn
      ? 'storm'
      : sonicOn
        ? 'sonic'
        : 'normal';

    const targetDraw = stormOn ? 0.58 : isDrawingBow ? clamp01(drawHoldTime / stats.fullDrawTime) : 0;
    visualDrawRatio = damp(visualDrawRatio, targetDraw, isDrawingBow ? 22 : 18, dt);

    const showArrow = releaseCooldown <= 0.045;
    const releaseOpen = releaseCooldown > 0 ? clamp01(releaseCooldown / 0.18) : 0;
    bowRig.updateBowDraw(visualDrawRatio, arrowMode, showArrow, releaseOpen);

    if (releaseFlashT > 0) {
      releaseFlashT = Math.max(0, releaseFlashT - dt);
      releaseBurstUniforms.uProgress.value = clamp01(1 - releaseFlashT / 0.095);
      releaseFlashGroup.visible = true;
    } else {
      releaseFlashGroup.visible = false;
    }

    const moveSpd =
      G.player && G.player.vel ? Math.hypot(G.player.vel.x, G.player.vel.z) : 0;
    const onGround = !!(G.player && G.player.onGround);
    const bobAmp = onGround ? clamp01(moveSpd / 8.5) * (isDrawingBow ? 0.45 : 1.0) : 0.15;
    const bobX = Math.cos(clockT * 7.8) * 0.008 * bobAmp;
    const bobY = Math.abs(Math.sin(clockT * 7.8)) * -0.010 * bobAmp;

    const kickZ = stepSpring(spKickZ, 0, dt);
    const kickP = stepSpring(spKickPitch, 0, dt);
    const lookDx = G.input && Number.isFinite(G.input.lookDX) ? G.input.lookDX : 0;
    const lookDy = G.input && Number.isFinite(G.input.lookDY) ? G.input.lookDY : 0;
    const swayX = stepSpring(spSwayX, clamp(-lookDx * 0.0005, -0.022, 0.022), dt);
    const swayY = stepSpring(spSwayY, clamp(lookDy * 0.0005, -0.022, 0.022), dt);

    // Authentic Kyudo `会 (Kai)` full-draw alignment: bow settles steadily toward sightline while keeping `(0,0)` reticle clear & both hands in view!
    const drawShiftX = -visualDrawRatio * 0.036;
    const drawShiftY = visualDrawRatio * 0.018;
    const drawShiftZ = visualDrawRatio * 0.010;
    const drawCant = BASE_ROT.z + visualDrawRatio * 0.10;

    let meleeOffX = 0;
    let meleeOffZ = 0;
    let meleeYaw = 0;
    if (meleeTimer > 0) {
      const mProg = 1 - meleeTimer / 0.28;
      const swing = Math.sin(mProg * Math.PI);
      meleeOffX = swing * 0.12;
      meleeOffZ = -swing * 0.15;
      meleeYaw = -swing * 0.78;
    }

    bowGroup.position.set(
      BASE_POS.x + drawShiftX + bobX + swayX + meleeOffX,
      BASE_POS.y + drawShiftY + bobY + swayY,
      BASE_POS.z + drawShiftZ + kickZ * 0.038 + meleeOffZ
    );
    bowGroup.rotation.set(
      BASE_ROT.x + kickP * 0.10,
      BASE_ROT.y + meleeYaw,
      drawCant
    );

    bowHudState.drawRatio = isDrawingBow ? clamp01(drawHoldTime / stats.fullDrawTime) : stormOn ? 1 : 0;
    bowHudState.isDrawing = isDrawingBow;
    bowHudState.arrowMode = arrowMode;
    bowHudState.stormArrowsLeft = cb.getStormArrowsLeft();
  }

  function update(dt: number) {
    clockT += dt;
    const stats = cb.getStats();

    if (releaseCooldown > 0) releaseCooldown = Math.max(0, releaseCooldown - dt);
    if (meleeTimer > 0) {
      meleeTimer = Math.max(0, meleeTimer - dt);
      if (meleeTimer <= 0 && state === 'melee') state = 'idle';
    }

    if (cb.isActive() && G.player && G.player.enabled && G.player.alive) {
      const firePressed =
        consumeRawMouseLatch(0) ||
        !!(G.input && G.input.firePressed) ||
        !!(cb.touch && cb.touch.consumeFirePressed());
      const fireHeld =
        rawMouseHeld.has(0) ||
        !!(G.input && G.input.fire) ||
        !!(cb.touch && cb.touch.isFireHeld());
      const cancelPressed =
        consumeRawMouseLatch(2) ||
        rawMouseHeld.has(2) ||
        !!(G.input && G.input.ads) ||
        !!(cb.touch && cb.touch.consumeFanPressed());
      const meleePressed =
        !!(G.input && G.input.melee) || !!(cb.touch && cb.touch.consumeMeleePressed());
      if (G.input) G.input.melee = false;

      if (!fireHeld) {
        cancelHoldUntilRelease = false;
      }

      if (meleePressed && meleeTimer <= 0) {
        triggerBowMelee();
      } else if (cb.isStormActive() && cb.getStormArrowsLeft() > 0) {
        // Storm Arrows (`岚矢`): instant rapid-fire on click or hold!
        isDrawingBow = false;
        drawHoldTime = 0;
        state = 'storm';
        if ((firePressed || fireHeld) && !cancelHoldUntilRelease && releaseCooldown <= 0 && meleeTimer <= 0) {
          fireArrow(stats.fullDrawTime, true, false);
          releaseCooldown = stats.stormArrowInterval;
        }
      } else {
        // Primary Storm Bow (`风 · 蓄力岚弓`): hold LMB to draw, release LMB to loose; RMB cancels draw cleanly
        if (cancelPressed && isDrawingBow) {
          isDrawingBow = false;
          drawHoldTime = 0;
          cancelHoldUntilRelease = true;
          state = 'idle';
        } else if (
          (firePressed || fireHeld) &&
          !cancelHoldUntilRelease &&
          releaseCooldown <= 0 &&
          meleeTimer <= 0
        ) {
          if (!isDrawingBow) {
            isDrawingBow = true;
            drawHoldTime = 0;
            state = 'drawing';
            cb.audio.bowDrawStart();
          }
          drawHoldTime = Math.min(stats.fullDrawTime * 1.5, drawHoldTime + dt);
          // Gentle draw movement penalty (mitigated by `弓圣体魄` talent)
          if (G.player && G.player.onGround && G.player.vel) {
            const dampMul = cb.hasLightDrawMove() ? 0.985 : 0.955;
            G.player.vel.x *= Math.pow(dampMul, dt * 60);
            G.player.vel.z *= Math.pow(dampMul, dt * 60);
          }
        } else if (isDrawingBow && !fireHeld) {
          // Loose arrow on LMB release!
          const heldT = Math.max(0.06, drawHoldTime);
          isDrawingBow = false;
          drawHoldTime = 0;
          state = 'idle';
          fireArrow(heldT, false, false);
          releaseCooldown = 0.20;
        } else if (!isDrawingBow && meleeTimer <= 0) {
          state = 'idle';
        }
      }
    } else {
      isDrawingBow = false;
      drawHoldTime = 0;
    }

    updateViewmodelTransform(dt, stats);
    updateWorldProjectiles(dt, false);
  }

  function updateVisualsOnly(dt: number) {
    clockT += dt;
    updateWorldProjectiles(dt, true);
  }

  function onCastDragonstrike() {
    isDrawingBow = false;
    drawHoldTime = 0;
    cb.audio.dragonstrikeCast();
    fireArrow(cb.getStats().fullDrawTime, true, true);
    releaseCooldown = 0.36;
  }

  function clearProjectiles() {
    for (const a of arrowPool) a.active = false;
    for (const sl of slipstreamPool) sl.active = false;
    for (const sp of sparkPool) sp.active = false;
    for (const dm of sonicDomePool) {
      dm.active = false;
      dm.group.visible = false;
    }
    for (const ds of dragonPool) {
      ds.active = false;
      ds.group.visible = false;
    }
    dragonSegBodyInst.count = 0;
    dragonSegFinInst.count = 0;
    dragonSegBodyInst.visible = false;
    dragonSegFinInst.visible = false;
    arrowShaftInst.count = 0;
    arrowHeadInst.count = 0;
    arrowWakeInst.count = 0;
    slipstreamInst.count = 0;
    sparkInst.count = 0;
    arrowShaftInst.instanceMatrix.needsUpdate = true;
    arrowHeadInst.instanceMatrix.needsUpdate = true;
    arrowWakeInst.instanceMatrix.needsUpdate = true;
    slipstreamInst.instanceMatrix.needsUpdate = true;
    sparkInst.instanceMatrix.needsUpdate = true;
  }

  function reset() {
    clearProjectiles();
    isDrawingBow = false;
    drawHoldTime = 0;
    visualDrawRatio = 0;
    cancelHoldUntilRelease = false;
    releaseCooldown = 0;
    releaseFlashT = 0;
    meleeTimer = 0;
    state = 'idle';
    rawMouseLatched.clear();
    rawMouseHeld.clear();
    bowRig.updateBowDraw(0, 'normal', true);
  }

  function onEquip() {
    isDrawingBow = false;
    drawHoldTime = 0;
    releaseCooldown = 0.12;
    spKickZ.v -= 1.4;
  }

  function setVisible(v: boolean) {
    root.visible = v;
  }

  function getActiveProjectileCount(): number {
    let n = 0;
    for (let i = 0; i < arrowPool.length; i++) if (arrowPool[i].active) n++;
    for (let i = 0; i < dragonPool.length; i++) if (dragonPool[i].active) n++;
    return n;
  }

  const _activeSonicDomesBuf: { center: Vec3Like; radius: number }[] = [];
  function getActiveSonicDomes(): readonly { center: Vec3Like; radius: number }[] {
    _activeSonicDomesBuf.length = 0;
    for (let i = 0; i < sonicDomePool.length; i++) {
      if (sonicDomePool[i].active && sonicDomePool[i].life > 0) {
        _activeSonicDomesBuf.push(sonicDomePool[i]);
      }
    }
    return _activeSonicDomesBuf;
  }

  function getPoolDiagnostics() {
    let activeArrows = 0;
    for (let i = 0; i < arrowPool.length; i++) if (arrowPool[i].active) activeArrows++;
    let activeSonicDomes = 0;
    for (let i = 0; i < sonicDomePool.length; i++) if (sonicDomePool[i].active) activeSonicDomes++;
    let activeDragons = 0;
    for (let i = 0; i < dragonPool.length; i++) if (dragonPool[i].active) activeDragons++;
    return {
      arrowPoolCapacity: arrowPool.length,
      slipstreamPoolCapacity: slipstreamPool.length,
      sparkPoolCapacity: sparkPool.length,
      sonicDomeCapacity: sonicDomePool.length,
      dragonstrikeCapacity: dragonPool.length,
      activeArrows,
      activeSonicDomes,
      activeDragons,
    };
  }

  return {
    name: '岛田半藏 · 岚弓',
    noReload: true,
    get ammo() {
      return cb.isStormActive() ? cb.getStormArrowsLeft() : 1;
    },
    get magSize() {
      return cb.isStormActive() ? cb.getStats().stormArrowCount : 1;
    },
    reserve: 999,
    get spread() {
      return isDrawingBow ? 0.002 : 0.008;
    },
    get state() {
      return state;
    },
    root,
    bowGroup,
    update,
    updateVisualsOnly,
    onCastDragonstrike,
    clearProjectiles,
    reset,
    onEquip,
    setVisible,
    getActiveProjectileCount,
    getBowHudState: () => bowHudState,
    isPointInSonicField,
    getSonicDamageMultiplier,
    getActiveSonicDomes,
    getPoolDiagnostics,
  };
}
