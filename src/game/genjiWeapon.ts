/**
 * 100% Procedural Classical Shinobi First-Person Viewmodel (`笼手·风魔十字镖·胁差·玉钢太刀龙丸`),
 * Custom GLSL Twin-Helix Spirit Dragon (`Q · 斩`), Custom GLSL Crescent Sword-Ki Waves (`升龙剑气`),
 * Dual-Blade Figure-8 Deflect Vortex + World Parry Shockwaves (`E · 闪`), and Destructible Building Impact Hooks.
 * Zero external assets (.glb/.png/.mp3) and zero cyberpunk neon strips.
 */

import {
  clamp01,
  computeConvergedLaunchVector,
  computeGenjiSingleBladeState,
  computeProjectileVisualPosition,
  computeProjectileVisualScale,
  computeShurikenFanAngles,
  isProjectileOutOfPlayableBounds,
  type GenjiBuildStats,
} from './roguelike.ts';
import { clamp, damp } from './rules.ts';
import type { GenjiAudioController } from './genjiAudio.ts';
import {
  buildHeldShurikenAssembly,
  buildMasterworkKatana,
  buildMasterworkShurikenGeo,
  buildShinobiGauntletArm,
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

export interface GenjiWeaponCallbacks {
  getStats: () => GenjiBuildStats;
  onDamageDealt: (
    amount: number,
    enemy: any,
    killed: boolean,
    weak: boolean,
    source: string
  ) => void;
  onHeavyHit?: (hitstopSec: number, fovPunchDeg?: number) => void;
  onDragonbladeLunge?: (dir: any, rangeMeters: number) => void;
  onParryFeedback?: () => void;
  isDeflecting: () => boolean;
  isDragonblade: () => boolean;
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
    consumeReloadPressed: () => boolean;
  };
}

export function createGenjiWeapon(G: any, cb: GenjiWeaponCallbacks) {
  const THREE = G.THREE;
  const VIEW_LAYER = 1;

  // =========================================================================
  // 1. CLASSICAL SHINOBI & TAMAHAGANE PBR MATERIALS (Zero Cyber Neon)
  // =========================================================================
  const matIndigoHemp = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.095, 0.135, 0.215),
    roughness: 0.76,
    metalness: 0.08,
  });
  const matLacquerIron = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.13, 0.14, 0.16),
    roughness: 0.28,
    metalness: 0.78,
  });
  const matTamahagane = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.76, 0.80, 0.84),
    roughness: 0.16,
    metalness: 0.94,
  });
  const matDarkFoldedSteel = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.24, 0.26, 0.29),
    roughness: 0.34,
    metalness: 0.88,
  });
  const matAgedBronze = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.68, 0.50, 0.22),
    roughness: 0.32,
    metalness: 0.86,
  });
  const matCrimsonCord = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.46, 0.08, 0.06),
    roughness: 0.78,
    metalness: 0.06,
  });
  const matRaySkin = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.84, 0.80, 0.72),
    roughness: 0.68,
    metalness: 0.05,
  });

  const makeGlowMat = (hex: number, opacity = 1, additive = true) =>
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(hex),
      toneMapped: true,
      fog: false,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });

  const matWindJade = makeGlowMat(0x22e678, 0.72, true);
  const matGoldHot = makeGlowMat(0xffc854, 0.80, true);
  const matSteelFlash = makeGlowMat(0x7af5be, 0.62, true);

  // =========================================================================
  // 2. CUSTOM GLSL SHADERS FOR SPIRIT DRAGON, SWORD-KI WAVES & DEFLECT VORTEX
  // =========================================================================
  const spiritDragonUniforms = {
    uTime: { value: 0 },
    uAlpha: { value: 1 },
  };

  const matSpiritDragonShader = new THREE.ShaderMaterial({
    uniforms: spiritDragonUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
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
      uniform float uAlpha;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float core = pow(ndv, 1.85);
        float rim = pow(1.0 - ndv, 1.55);

        // Flowing classical dragon-scale & spirit-cloud bands surging along body
        float flow = vUv.x * 34.0 - uTime * 7.5;
        float row = vUv.y * 12.0;
        float scaleCell = sin(flow + sin(row * 3.14159) * 1.35) * 0.5 + 0.5;
        float spiritPulse = sin(vUv.x * 14.0 - uTime * 11.0) * 0.5 + 0.5;

        // Taper cleanly at tail (vUv.x -> 0) and snout join (vUv.x -> 1)
        float taper = smoothstep(0.0, 0.14, vUv.x) * (0.55 + 0.45 * smoothstep(1.0, 0.82, vUv.x));

        vec3 jadeDeep = vec3(0.03, 0.56, 0.28);
        vec3 jadeBright = vec3(0.14, 0.88, 0.48);
        vec3 goldSpine = vec3(0.96, 0.78, 0.30);

        vec3 col = mix(jadeDeep, jadeBright, scaleCell * 0.75 + spiritPulse * 0.25);
        col = mix(col, goldSpine, core * 0.68 + pow(scaleCell, 4.0) * 0.28);
        col += vec3(0.18, 0.78, 0.44) * rim * 0.65;

        // Dissolve grazing silhouette edges smoothly so the spirit tube never looks like solid plastic!
        float silhouetteSoft = smoothstep(0.02, 0.42, ndv);
        float a = (0.30 + core * 0.52 + rim * 0.24 + scaleCell * 0.20) * silhouetteSoft * taper * uAlpha;
        if (a < 0.012) discard;
        gl_FragColor = vec4(col * 1.45, clamp(a, 0.0, 0.88));
      }
    `,
    toneMapped: false,
  });

  const matSwordKiShader = new THREE.ShaderMaterial({
    uniforms: {
      uTime: spiritDragonUniforms.uTime,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vPos2;
      void main() {
        // waveGeo was rotated Y by PI/2, so local Z/Y hold crescent plane coordinates
        vPos2 = vec2(-position.z, position.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vPos2;
      void main() {
        float r = length(vPos2);
        float ang = atan(vPos2.y, vPos2.x);
        // Leading outer razor edge at r ~ 1.48, trailing wake inward to ~ 0.92
        float edge = smoothstep(0.95, 1.46, r) * (1.0 - smoothstep(1.47, 1.56, r));
        float hotRazor = smoothstep(1.34, 1.48, r) * (1.0 - smoothstep(1.48, 1.55, r));
        float tipFade = 1.0 - smoothstep(0.95, 1.42, abs(ang));
        float streak = sin(ang * 18.0 + uTime * 28.0) * 0.22 + 0.78;

        vec3 jade = vec3(0.08, 0.84, 0.44);
        vec3 goldAmber = vec3(0.98, 0.82, 0.34);
        vec3 col = mix(jade, goldAmber, hotRazor * 0.85 + 0.12) * (0.78 + hotRazor * 0.65) * streak;
        float a = clamp((edge * 0.72 + hotRazor * 0.75) * tipFade, 0.0, 0.88);
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  });

  const deflectShaderUniforms = {
    uTime: { value: 0 },
    uPulse: { value: 0 },
  };

  const matDeflectVortexShader = new THREE.ShaderMaterial({
    uniforms: deflectShaderUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
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
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        if (r > 1.0 || r < 0.30) discard;
        float ang = atan(vUv.y, vUv.x);

        // Rapid counter-spinning katana steel-wind arcs (keeps center 30% crystal clear for aiming!)
        float bladeA = pow(max(0.0, sin(ang * 3.0 - uTime * 32.0 + r * 4.5)), 8.0);
        float bladeB = pow(max(0.0, sin(ang * 2.0 + uTime * 26.0 - r * 5.0)), 7.0);
        float outerRing = smoothstep(0.89, 0.95, r) * (1.0 - smoothstep(0.96, 1.0, r));
        float innerRing = smoothstep(0.31, 0.35, r) * (1.0 - smoothstep(0.36, 0.41, r));

        float intensity = bladeA * 0.75 + bladeB * 0.55 + outerRing * 0.62 + innerRing * 0.28;
        intensity *= (1.0 + uPulse * 1.4);

        vec3 windCol = mix(vec3(0.12, 0.82, 0.46), vec3(0.96, 0.80, 0.34), bladeA * 0.65 + uPulse * 0.5);
        float alpha = clamp(intensity * 0.36, 0.0, 0.56);
        gl_FragColor = vec4(windCol * 0.78, alpha);
      }
    `,
  });

  // Non-rectangular Custom GLSL Polar Shuriken Chakra Star-Halo (Supports InstancedMesh via USE_INSTANCING!)
  const matShurikenChakraShader = new THREE.ShaderMaterial({
    uniforms: {
      uTime: spiritDragonUniforms.uTime,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        #ifdef USE_INSTANCING
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        #endif
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float ang = atan(vUv.y, vUv.x) + uTime * 28.0 - r * 2.4;
        // Razor-sharp 4-point Fuma star silhouette + pinpoint golden-white core (zero blurry round blob!)
        float blades = pow(abs(cos(ang * 2.0)), 9.5) * smoothstep(1.0, 0.08, r);
        float core = exp(-r * r * 20.0);
        float a = clamp(core * 0.98 + blades * 0.88, 0.0, 0.98) * smoothstep(1.0, 0.72, r);
        if (a < 0.018) discard;
        vec3 col = mix(vec3(0.18, 0.98, 0.62), vec3(1.0, 0.96, 0.68), clamp(core * 1.3 + blades * 0.45, 0.0, 1.0));
        gl_FragColor = vec4(col, a);
      }
    `,
  });

  // Hairline Trajectory Impact Pip Shader (Shown only during active volleys, zero idle floating rings!)
  const matAimSightShader = new THREE.ShaderMaterial({
    uniforms: {
      uTime: spiritDragonUniforms.uTime,
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        #ifdef USE_INSTANCING
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        #endif
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float crossHair = pow(abs(cos(atan(vUv.y, vUv.x) * 2.0)), 14.0) * smoothstep(0.95, 0.25, r);
        float pip = exp(-r * r * 36.0);
        float a = clamp(crossHair * 0.45 + pip * 0.62, 0.0, 0.65);
        if (a < 0.015) discard;
        vec3 col = mix(vec3(0.32, 0.98, 0.68), vec3(1.0, 0.92, 0.56), pip);
        gl_FragColor = vec4(col, a);
      }
    `,
  });

  // Feathered Aerodynamic Helical Wind-Wake Shader for Shurikens & Swift-Strike Spiral (Supports InstancedMesh!)
  const matWindStreamShader = new THREE.ShaderMaterial({
    uniforms: {
      uTime: spiritDragonUniforms.uTime,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        #endif
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float endFade = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.18, vUv.x);
        float sideFade = sin(clamp(vUv.y, 0.0, 1.0) * 3.14159265);
        float swirl = sin(vUv.x * 22.0 - uTime * 32.0 + vUv.y * 6.28318) * 0.26 + 0.74;
        float a = endFade * pow(max(0.0, sideFade), 0.72) * swirl * 0.84;
        if (a < 0.012) discard;
        vec3 col = mix(vec3(0.14, 0.94, 0.56), vec3(0.99, 0.88, 0.46), smoothstep(0.40, 0.95, vUv.x) * 0.68);
        gl_FragColor = vec4(col, a);
      }
    `,
  });

  // Polar Crescent First-Person Slash Ribbon Shader (Eliminates segmented RingGeometry rectangle facets!)
  const viewSlashUniforms = {
    uTime: spiritDragonUniforms.uTime,
    uProgress: { value: 0.5 },
  };
  const matViewSlashShader = new THREE.ShaderMaterial({
    uniforms: viewSlashUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
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
        if (r > 1.0 || r < 0.34) discard;
        float ang = atan(vUv.y, vUv.x);
        float arcMask = 1.0 - smoothstep(0.75, 1.82, abs(ang));
        if (arcMask <= 0.005) discard;
        // Progressive katana blade wipe from start of swing (-1.75) to follow-through (+1.75)
        float sweepFront = mix(-1.45, 1.95, uProgress);
        float sweepTail = mix(-2.25, 0.65, uProgress);
        float wipe = smoothstep(sweepTail, sweepTail + 0.85, ang) * (1.0 - smoothstep(sweepFront - 0.18, sweepFront + 0.15, ang));
        float outerShift = 0.94 - 0.12 * (abs(ang) / 1.82);
        float innerShift = 0.54 + 0.18 * (abs(ang) / 1.82);
        float body = smoothstep(innerShift, outerShift - 0.05, r) * (1.0 - smoothstep(outerShift - 0.02, outerShift + 0.04, r));
        float razor = smoothstep(outerShift - 0.09, outerShift - 0.015, r) * (1.0 - smoothstep(outerShift - 0.01, outerShift + 0.035, r));
        float filament = sin(r * 38.0 - ang * 7.0 - uTime * 24.0) * 0.20 + 0.80;
        float fadeOut = 1.0 - smoothstep(0.72, 1.0, uProgress);
        float a = clamp((body * 0.58 + razor * 0.95) * pow(arcMask, 1.35) * wipe * filament * fadeOut, 0.0, 0.92);
        if (a < 0.012) discard;
        vec3 col = mix(vec3(0.12, 0.92, 0.52), vec3(1.0, 0.92, 0.52), clamp(razor * 1.2 + 0.15, 0.0, 1.0));
        gl_FragColor = vec4(col * 1.55, a);
      }
    `,
  });

  // Polar Shockwave Burst Shader for Parry & Cleave Rings (Zero rectangular quad edges!)
  const matShockwaveBurstShader = new THREE.ShaderMaterial({
    uniforms: {
      uTime: spiritDragonUniforms.uTime,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float ang = atan(vUv.y, vUv.x);
        float ring = smoothstep(0.56, 0.78, r) * (1.0 - smoothstep(0.80, 0.98, r));
        float rays = pow(abs(cos(ang * 4.0 + uTime * 8.0)), 10.0) * smoothstep(1.0, 0.18, r);
        float a = clamp(ring * 0.82 + rays * 0.58, 0.0, 0.88) * smoothstep(1.0, 0.84, r);
        if (a < 0.012) discard;
        vec3 col = mix(vec3(0.18, 0.92, 0.56), vec3(1.0, 0.86, 0.40), ring * 0.65 + rays * 0.55);
        gl_FragColor = vec4(col, a);
      }
    `,
  });

  // =========================================================================
  // 3. CLASSICAL COLD-FORGED FUMA SHURIKEN (`风魔十字铁镖`)
  // =========================================================================
  function buildShurikenGroup(scale = 1): any {
    const grp = new THREE.Group();
    const shape = new THREE.Shape();
    const outerR = 0.054 * scale;
    const innerR = 0.015 * scale;
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      const r = i % 2 === 0 ? outerR : innerR;
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();

    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.0085 * scale, 0, Math.PI * 2, false);
    shape.holes.push(hole);

    const bladeGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.0038 * scale,
      bevelEnabled: true,
      bevelThickness: 0.0016 * scale,
      bevelSize: 0.0024 * scale,
      bevelSegments: 1,
    });
    bladeGeo.center();

    const bladeMesh = new THREE.Mesh(bladeGeo, matTamahagane);
    const hubMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.0115 * scale, 0.0026 * scale, 6, 16),
      matAgedBronze
    );
    grp.add(bladeMesh, hubMesh);
    return grp;
  }

  const pbrSuite = getHeroViewmodelPbrSuite(G);
  const sharedHeldShurikenGeo = buildMasterworkShurikenGeo(THREE, 0.068);

  function buildWorldShurikenGeometry(): any {
    return buildMasterworkShurikenGeo(THREE, 0.15);
  }

  // =========================================================================
  // 4. FIRST-PERSON VIEWMODEL ROOT (Layer 1) — Strictly ONE Single Katana (`龙丸一把佩刀`) + Shurikens!
  // =========================================================================
  const root = new THREE.Group();
  root.name = 'viewmodel-genji-classical';

  // --- A. RIGHT SHINOBI FOREARM (`笼手·手甲`), ANATOMICAL 3-PHALANX HAND & 3 FUMA SHURIKENS ---
  const rightBuilt = buildShinobiGauntletArm(THREE, pbrSuite, 1, 'shurikenPinch');
  const rightArm = rightBuilt.armGroup;
  const reloadHatch = rightBuilt.reloadHatch;
  const hatchRoll = rightBuilt.hatchRoll;
  rightArm.position.set(0.165, -0.106, -0.38);

  // 3 Fanned Damascus Fuma Shurikens pinched right between index & middle fingers!
  const heldShurikensGroup = new THREE.Group();
  heldShurikensGroup.position.set(-0.004, 0.004, -0.124);
  const heldShurikens: any[] = [];
  const fanOffsets = [-0.24, 0, 0.24];
  for (let i = 0; i < 3; i++) {
    const sh = buildHeldShurikenAssembly(THREE, pbrSuite, sharedHeldShurikenGeo);
    sh.rotation.set(Math.PI * 0.08, fanOffsets[i] * 0.85, fanOffsets[i] * 0.25);
    sh.position.set(
      fanOffsets[i] * 0.068,
      Math.abs(fanOffsets[i]) * -0.008,
      -Math.abs(fanOffsets[i]) * 0.018
    );
    heldShurikens.push(sh);
    heldShurikensGroup.add(sh);
  }

  rightArm.add(heldShurikensGroup);
  root.add(rightArm);

  // --- B. LEFT SHINOBI FOREARM, ANATOMICAL KUJI-IN HAND & SAYA SCABBARD (`黑漆金莳绘太刀鞘`) ---
  const leftBuilt = buildShinobiGauntletArm(THREE, pbrSuite, -1, 'kujiGuard');
  const leftArm = leftBuilt.armGroup;
  leftArm.position.set(-0.185, -0.128, -0.38);

  // Curved Kuro-Urushi Lacquered Saya Scabbard (`黑漆太刀鞘`) held by left hand whenever Genji's single katana (`龙丸`) is drawn (`Q`, `E`, `V`)!
  const sayaScabbard = new THREE.Group();
  const sayaPts: any[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    sayaPts.push(
      new THREE.Vector3(
        0,
        0.04 - t * 0.78,
        0.01 - Math.sin(t * Math.PI * 0.65) * 0.09
      )
    );
  }
  const sayaBody = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sayaPts), 18, 0.019, 10, false),
    pbrSuite.urushiLacquer
  );
  sayaBody.scale.set(0.56, 1, 1.26);
  const koiguchiMouth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.022, 0.034, 12),
    pbrSuite.forgedGold
  );
  koiguchiMouth.position.set(0, 0.042, 0.01);
  const koiguchiGlow = new THREE.Mesh(
    new THREE.TorusGeometry(0.024, 0.0036, 6, 16).rotateX(Math.PI / 2),
    matGoldHot
  );
  koiguchiMouth.add(koiguchiGlow);
  const sageoKnot = new THREE.Mesh(
    new THREE.TorusGeometry(0.022, 0.0058, 6, 14).rotateX(Math.PI / 2),
    pbrSuite.tsukaSilk
  );
  sageoKnot.position.set(0, -0.08, -0.008);
  sayaScabbard.add(sayaBody, koiguchiMouth, sageoKnot);
  sayaScabbard.position.set(0.01, -0.01, -0.055);
  sayaScabbard.visible = false;

  leftArm.add(sayaScabbard);
  root.add(leftArm);

  // --- C. CLEAN PERIPHERAL `E` DEFLECT (`心眼·闪`) WIND-RIM (100% Unobstructed Center Crosshair!) ---
  const deflectVfxGroup = new THREE.Group();
  deflectVfxGroup.position.set(0, -0.02, -0.48);
  deflectVfxGroup.visible = false;

  const matPeripheralWind = makeGlowMat(0x7affbe, 0.20, true);
  const matParryFlashRing = makeGlowMat(0xffe17d, 0.72, true);

  const deflectVortexDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.42),
    matDeflectVortexShader
  );
  deflectVortexDisc.visible = false;

  const deflectArc1 = new THREE.Mesh(
    new THREE.TorusGeometry(0.39, 0.0022, 6, 36, Math.PI * 0.85),
    matPeripheralWind
  );
  const deflectArc2 = new THREE.Mesh(
    new THREE.TorusGeometry(0.43, 0.0018, 6, 32, Math.PI * 0.72),
    matPeripheralWind
  );
  const deflectArc3 = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.0042, 8, 36, Math.PI * 1.45),
    matParryFlashRing
  );
  deflectArc3.visible = false;
  deflectVfxGroup.add(deflectVortexDisc, deflectArc1, deflectArc2, deflectArc3);
  root.add(deflectVfxGroup);

  // --- D. FORGED TAMAHAGANE DRAGON ODACHI (`传世玉钢大太刀 · 龙丸`, Q Ultimate Viewmodel) ---
  const dragonKatana = buildMasterworkKatana(THREE, pbrSuite, {
    bladeLen: 0.84,
    hiltLen: 0.24,
    soriCurve: 0.095,
    withDragonVein: true,
  });
  dragonKatana.position.set(0.22, -0.24, -0.38);
  dragonKatana.visible = false;

  const katanaTsubaAura = new THREE.Mesh(
    new THREE.TorusGeometry(0.052, 0.0042, 8, 24).rotateX(Math.PI / 2),
    matGoldHot
  );
  katanaTsubaAura.position.y = 0.012;

  const bladeAuraPts: any[] = [];
  const bladeEdgePts: any[] = [];
  for (let s = 0; s <= 10; s++) {
    const t = s / 10;
    const by = 0.04 + t * 0.84;
    const bz = Math.pow(t, 1.85) * 0.095;
    const swirlX = Math.sin(t * Math.PI * 3.0) * 0.014;
    bladeAuraPts.push(new THREE.Vector3(swirlX, by, bz + 0.012));
    bladeEdgePts.push(new THREE.Vector3(0, by, bz - 0.016));
  }
  const spiritCoiledAura = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bladeAuraPts), 28, 0.013, 8, false),
    matSpiritDragonShader
  );
  const spiritRazorThread = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bladeEdgePts), 24, 0.0045, 6, false),
    matGoldHot
  );

  // Anatomical Right Shinobi Gauntlet Grip on the upper Odachi Tsuka during `Q` Dragonblade (forearm pitched safely down-right away from camera near plane)
  const katanaGripBuilt = buildShinobiGauntletArm(THREE, pbrSuite, 1, 'katanaGrip');
  const katanaRightGrip = katanaGripBuilt.armGroup;
  katanaRightGrip.position.set(0.014, -0.095, 0.018);
  katanaRightGrip.rotation.set(-0.62, -0.28, 0.42);

  dragonKatana.add(
    katanaTsubaAura,
    spiritCoiledAura,
    spiritRazorThread,
    katanaRightGrip
  );

  const viewSlashArc = new THREE.Group();
  viewSlashArc.position.set(0, -0.01, -0.44);
  viewSlashArc.visible = false;
  const viewSlashDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(1.18, 1.18),
    matViewSlashShader
  );
  viewSlashArc.add(viewSlashDisc);
  root.add(dragonKatana, viewSlashArc);

  root.traverse((obj: any) => {
    obj.layers.set(VIEW_LAYER);
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = false;
    }
  });
  G.camera.add(root);

  // =========================================================================
  // 5. WORLD-SPACE POOLS (Layer 0): Shurikens, Chakra Halos, Sword-Ki Waves, Parry Shockwaves, Spirit Dragon
  // =========================================================================
  const worldGroup = new THREE.Group();
  worldGroup.name = 'genji-world-fx';
  G.scene.add(worldGroup);

  // --- Pool 1: World Shurikens + Polar Chakra Star Halo + Helical Wind-Wake + Trajectory Preview (`72` max) ---
  const MAX_SHURIKENS = 72;
  const matWorldShurikenSteel = pbrSuite.damascusBlade.clone();
  matWorldShurikenSteel.emissive = new THREE.Color(0.14, 0.58, 0.36);
  matWorldShurikenSteel.emissiveIntensity = 0.72;
  const shurikenInstMesh = new THREE.InstancedMesh(
    buildWorldShurikenGeometry(),
    matWorldShurikenSteel,
    MAX_SHURIKENS
  );
  shurikenInstMesh.frustumCulled = false;
  shurikenInstMesh.count = 0;
  shurikenInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Billboarded polar chakra star-glow so shurikens are 100% visible from Frame 0 and never vanish edge-on!
  const shurikenHaloMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    matShurikenChakraShader,
    MAX_SHURIKENS
  );
  shurikenHaloMesh.frustumCulled = false;
  shurikenHaloMesh.count = 0;
  shurikenHaloMesh.renderOrder = 8;
  shurikenHaloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Twisted Helical Wind-Wake Tube (elongated 2.85m continuous aerodynamic trajectory streak!)
  const wakePts: any[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const ang = t * Math.PI * 3.2;
    const rad = (1 - t) * 0.032;
    wakePts.push(new THREE.Vector3(Math.cos(ang) * rad, Math.sin(ang) * rad, t * 2.85));
  }
  const trailGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wakePts), 16, 0.026, 6, false);
  const shurikenTrailMesh = new THREE.InstancedMesh(trailGeo, matWindStreamShader, MAX_SHURIKENS);
  shurikenTrailMesh.frustumCulled = false;
  shurikenTrailMesh.count = 0;
  shurikenTrailMesh.renderOrder = 7;
  shurikenTrailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // Live 3D Wind-Sight Trajectory Impact Preview (`5` max: shown cleanly during active volleys)
  const MAX_AIM_PREVIEWS = 5;
  const aimPreviewMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.20, 0.20),
    matAimSightShader,
    MAX_AIM_PREVIEWS
  );
  aimPreviewMesh.frustumCulled = false;
  aimPreviewMesh.count = 0;
  aimPreviewMesh.renderOrder = 6;
  aimPreviewMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  worldGroup.add(shurikenInstMesh, shurikenHaloMesh, shurikenTrailMesh, aimPreviewMesh);

  interface ActiveShuriken {
    active: boolean;
    originPos: any;
    pos: any;
    visualPos: any;
    impactPoint: any;
    impactResolved: boolean;
    elapsed: number;
    minVisualDuration: number;
    traveledDist: number;
    maxRange: number;
    prevPos: any;
    dir: any;
    speed: number;
    damage: number;
    life: number;
    spin: number;
    pierceLeft: number;
    homing: boolean;
    hitIds: Set<number>;
  }

  const shurikenPool: ActiveShuriken[] = [];
  for (let i = 0; i < MAX_SHURIKENS; i++) {
    shurikenPool.push({
      active: false,
      originPos: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      visualPos: new THREE.Vector3(),
      impactPoint: new THREE.Vector3(),
      impactResolved: false,
      elapsed: 0,
      minVisualDuration: 0.088,
      traveledDist: 0,
      maxRange: 130,
      prevPos: new THREE.Vector3(),
      dir: new THREE.Vector3(0, 0, -1),
      speed: 96,
      damage: 34,
      life: 0,
      spin: 0,
      pierceLeft: 0,
      homing: false,
      hitIds: new Set<number>(),
    });
  }

  // --- Pool 2: Custom GLSL Crescent Sword-Ki Waves (`升龙裂空波`, `18` max) ---
  const MAX_WAVES = 18;
  const crescentShape = new THREE.Shape();
  crescentShape.absarc(0, 0, 1.54, -Math.PI * 0.46, Math.PI * 0.46, false);
  const innerArc = new THREE.Path();
  innerArc.absarc(-0.28, 0, 1.04, Math.PI * 0.46, -Math.PI * 0.46, true);
  const waveRibbonShape = new THREE.Shape([
    ...crescentShape.getPoints(32),
    ...innerArc.getPoints(32),
  ]);
  const waveGeo = new THREE.ShapeGeometry(waveRibbonShape, 18);
  waveGeo.rotateY(Math.PI / 2);

  interface ActiveCrescentWave {
    active: boolean;
    mesh: any;
    pos: any;
    dir: any;
    speed: number;
    damage: number;
    life: number;
    maxLife: number;
    roll: number;
    radius: number;
    hitIds: Set<number>;
    hitBldgIds: Set<string>;
    hitColossus: boolean;
  }

  const wavePool: ActiveCrescentWave[] = [];
  for (let i = 0; i < MAX_WAVES; i++) {
    const mesh = new THREE.Mesh(waveGeo, matSwordKiShader);
    mesh.visible = false;
    mesh.frustumCulled = false;
    worldGroup.add(mesh);
    wavePool.push({
      active: false,
      mesh,
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      speed: 44,
      damage: 95,
      life: 0,
      maxLife: 0.7,
      roll: 0,
      radius: 2.3,
      hitIds: new Set<number>(),
      hitBldgIds: new Set<string>(),
      hitColossus: false,
    });
  }

  // --- Pool 3: Spiraling Wind-Vortex Swift-Strike & Slipstream Trails (`28` max, Zero Straight Cylinder Rods!) ---
  const MAX_BEAMS = 28;
  const spiralBeamPtsA: any[] = [];
  const spiralBeamPtsB: any[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const envelope = Math.sin(t * Math.PI);
    const ang = t * Math.PI * 5.0;
    spiralBeamPtsA.push(
      new THREE.Vector3(Math.cos(ang) * 0.055 * envelope, Math.sin(ang) * 0.055 * envelope, t)
    );
    spiralBeamPtsB.push(
      new THREE.Vector3(
        Math.cos(ang + Math.PI) * 0.042 * envelope,
        Math.sin(ang + Math.PI) * 0.042 * envelope,
        t
      )
    );
  }
  const beamGeoA = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(spiralBeamPtsA),
    24,
    0.032,
    7,
    false
  );
  const beamGeoB = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(spiralBeamPtsB),
    24,
    0.022,
    6,
    false
  );

  interface ActiveBeam {
    active: boolean;
    mesh: any;
    start: any;
    end: any;
    life: number;
    maxLife: number;
    width: number;
  }

  const beamPool: ActiveBeam[] = [];
  for (let i = 0; i < MAX_BEAMS; i++) {
    const grp = new THREE.Group();
    const mA = new THREE.Mesh(beamGeoA, matWindStreamShader);
    const mB = new THREE.Mesh(beamGeoB, matWindStreamShader);
    grp.add(mA, mB);
    grp.visible = false;
    worldGroup.add(grp);
    beamPool.push({
      active: false,
      mesh: grp,
      start: new THREE.Vector3(),
      end: new THREE.Vector3(),
      life: 0,
      maxLife: 0.38,
      width: 1,
    });
  }

  // --- Pool 4: Polar GLSL Parry Shockwave Bursts & Tapered Diamond Steel Sparks ---
  interface ParryRing {
    active: boolean;
    mesh: any;
    life: number;
    maxLife: number;
    maxScale: number;
  }
  const parryRings: ParryRing[] = [];
  const ringDiscGeo = new THREE.PlaneGeometry(0.72, 0.72);
  for (let i = 0; i < 14; i++) {
    const mesh = new THREE.Mesh(ringDiscGeo, matShockwaveBurstShader);
    mesh.visible = false;
    mesh.frustumCulled = false;
    worldGroup.add(mesh);
    parryRings.push({ active: false, mesh, life: 0, maxLife: 0.26, maxScale: 3.4 });
  }

  const MAX_PARRY_SPARKS = 96;
  const sparkStreakGeo = new THREE.OctahedronGeometry(0.016, 0);
  sparkStreakGeo.scale(0.55, 0.55, 3.6);
  const sparkInstMesh = new THREE.InstancedMesh(sparkStreakGeo, matGoldHot, MAX_PARRY_SPARKS);
  sparkInstMesh.frustumCulled = false;
  sparkInstMesh.count = 0;
  sparkInstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  worldGroup.add(sparkInstMesh);

  interface SparkParticle {
    active: boolean;
    pos: any;
    vel: any;
    life: number;
    maxLife: number;
  }
  const sparkPool: SparkParticle[] = [];
  for (let i = 0; i < MAX_PARRY_SPARKS; i++) {
    sparkPool.push({
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 0.25,
    });
  }

  function spawnParryBurst(worldPt: any, big = false) {
    let ring: ParryRing | null = null;
    for (let i = 0; i < parryRings.length; i++) {
      if (!parryRings[i].active) {
        ring = parryRings[i];
        break;
      }
    }
    if (!ring) ring = parryRings[0];
    ring.active = true;
    ring.maxLife = big ? 0.34 : 0.14;
    ring.life = ring.maxLife;
    ring.maxScale = big ? 4.2 : 0.44;
    ring.mesh.position.copy(worldPt);
    ring.mesh.quaternion.copy(G.camera.quaternion);
    ring.mesh.scale.setScalar(big ? 0.25 : 0.12);
    ring.mesh.visible = true;

    const sparkCount = big ? 16 : 6;
    let spawned = 0;
    for (let i = 0; i < sparkPool.length && spawned < sparkCount; i++) {
      if (sparkPool[i].active) continue;
      const sp = sparkPool[i];
      sp.active = true;
      sp.pos.copy(worldPt);
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI * 0.72;
      const spd = (big ? 9.5 : 3.4) + Math.random() * (big ? 8.5 : 3.8);
      sp.vel.set(
        Math.cos(theta) * Math.cos(phi) * spd,
        Math.sin(phi) * spd + (big ? 2.0 : 0.8),
        Math.sin(theta) * Math.cos(phi) * spd
      );
      sp.maxLife = (big ? 0.22 : 0.11) + Math.random() * 0.08;
      sp.life = sp.maxLife;
      spawned++;
    }
  }

  // --- Pool 5: Bleed Status Tracker (`裂甲透骨镖` DoT) ---
  interface BleedEntry {
    enemy: any;
    dps: number;
    timeLeft: number;
    tickAcc: number;
  }
  const activeBleeds = new Map<number, BleedEntry>();

  // =========================================================================
  // 6. CUSTOM GLSL TWIN-HELIX SPIRIT DRAGON (`Q · 斩·龙神之剑` Organic Sculpt!)
  // =========================================================================
  const dragonSpirit = new THREE.Group();
  dragonSpirit.visible = false;
  worldGroup.add(dragonSpirit);

  const buildHelixTube = (
    phaseOffset: number,
    radiusStart: number,
    radiusEnd: number,
    tubeRad: number,
    mat: any
  ) => {
    const pts: any[] = [];
    const count = 44;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const angle = t * Math.PI * 5.8 + phaseOffset;
      const r = radiusStart * (1 - t * 0.48) + radiusEnd * (t * 0.48);
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r * 0.82 + Math.sin(t * Math.PI) * 1.45;
      const z = -t * 11.8;
      pts.push(new THREE.Vector3(x, y, z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 76, tubeRad, 14, false);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return { mesh, headPos: pts[pts.length - 1], preHeadPos: pts[pts.length - 2] };
  };

  const primaryCoil = buildHelixTube(0, 1.65, 0.52, 0.29, matSpiritDragonShader);
  const coreSpineCoil = buildHelixTube(0, 1.65, 0.52, 0.095, matGoldHot);
  const twinGoldWindCoil = buildHelixTube(Math.PI, 1.28, 0.40, 0.15, matSpiritDragonShader);
  dragonSpirit.add(primaryCoil.mesh, coreSpineCoil.mesh, twinGoldWindCoil.mesh);

  // Organically Sculpted Roaring Eastern Dragon Head (Zero BoxGeometry — Curved Dome, Tapered Snout, Stag Antlers & Flowing Whiskers!)
  const dragonHead = new THREE.Group();
  dragonHead.position.copy(primaryCoil.headPos);
  const headDir = new THREE.Vector3()
    .subVectors(primaryCoil.headPos, primaryCoil.preHeadPos)
    .normalize();
  dragonHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), headDir);

  const craniumDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 16, 12),
    matSpiritDragonShader
  );
  craniumDome.scale.set(0.92, 0.72, 1.25);

  const snoutBridge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.28, 0.74, 12).rotateX(Math.PI / 2),
    matSpiritDragonShader
  );
  snoutBridge.scale.set(1.05, 0.68, 1.0);
  snoutBridge.position.set(0, 0.03, -0.48);

  const noseFlare = new THREE.Mesh(
    new THREE.SphereGeometry(0.20, 12, 10),
    matSpiritDragonShader
  );
  noseFlare.scale.set(1.12, 0.65, 0.95);
  noseFlare.position.set(0, 0.08, -0.82);

  const lowerJaw = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.22, 0.64, 10).rotateX(Math.PI / 2),
    matSpiritDragonShader
  );
  lowerJaw.scale.set(0.95, 0.48, 1.0);
  lowerJaw.position.set(0, -0.20, -0.44);
  lowerJaw.rotation.x = -0.36;

  const dragonPearl = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), matGoldHot);
  dragonPearl.position.set(0, -0.06, -0.44);

  for (const side of [-1, 1]) {
    // Blazing Almond-Shaped Ellipsoid Dragon Eyes + Swept Brow Crest
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), matGoldHot);
    eye.scale.set(0.65, 0.55, 1.65);
    eye.position.set(side * 0.25, 0.12, -0.22);
    eye.rotation.set(0.12, side * -0.28, side * -0.22);

    const browPts = [
      new THREE.Vector3(side * 0.16, 0.18, -0.34),
      new THREE.Vector3(side * 0.30, 0.26, -0.10),
      new THREE.Vector3(side * 0.36, 0.36, 0.26),
    ];
    const browCrest = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(browPts), 12, 0.038, 7, false),
      matGoldHot
    );

    // Curved Branched Stag Antlers (`龙角`)
    const antlerPts = [
      new THREE.Vector3(side * 0.18, 0.22, 0.08),
      new THREE.Vector3(side * 0.28, 0.48, 0.42),
      new THREE.Vector3(side * 0.42, 0.78, 0.88),
      new THREE.Vector3(side * 0.34, 1.02, 1.24),
    ];
    const antlerMain = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(antlerPts), 16, 0.042, 7, false),
      matGoldHot
    );
    const tinePts = [
      new THREE.Vector3(side * 0.29, 0.50, 0.45),
      new THREE.Vector3(side * 0.48, 0.72, 0.52),
      new THREE.Vector3(side * 0.56, 0.90, 0.72),
    ];
    const antlerTine = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tinePts), 10, 0.025, 6, false),
      matWindJade
    );

    // Sinuous Flowing Dragon Whiskers (`龙须`) + Curved Fangs
    const whiskerPts = [
      new THREE.Vector3(side * 0.17, 0.04, -0.78),
      new THREE.Vector3(side * 0.46, 0.14, -0.56),
      new THREE.Vector3(side * 0.68, -0.06, -0.05),
      new THREE.Vector3(side * 0.52, 0.12, 0.55),
    ];
    const whisker = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(whiskerPts), 18, 0.020, 6, false),
      matGoldHot
    );
    const fang = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.16, 6), matGoldHot);
    fang.position.set(side * 0.14, -0.05, -0.72);
    fang.rotation.x = Math.PI * 0.92;

    dragonHead.add(eye, browCrest, antlerMain, antlerTine, whisker, fang);
  }
  dragonHead.add(craniumDome, snoutBridge, noseFlare, lowerJaw, dragonPearl);
  dragonSpirit.add(dragonHead);

  // Expanding Polar Shockwave Disc on `Q` Cast!
  const dragonCastRing = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 2.2).rotateX(-Math.PI / 2),
    matShockwaveBurstShader
  );
  dragonCastRing.visible = false;
  dragonCastRing.frustumCulled = false;
  worldGroup.add(dragonCastRing);

  // 64 Orbiting Spirit Embers around the Coiled Dragon (sleek ellipsoid streaks, zero square corners!)
  const DRAGON_SHARDS = 64;
  const dragonShards = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.048, 7, 5),
    matGoldHot,
    DRAGON_SHARDS
  );
  dragonShards.frustumCulled = false;
  dragonSpirit.add(dragonShards);

  let dragonManifestT = 0;
  const dragonOrigin = new THREE.Vector3();
  const dragonQuat = new THREE.Quaternion();

  // --- Pre-allocated Math Scratch Objects (Zero per-frame GC!) ---
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  const _v4 = new THREE.Vector3();
  const _v5 = new THREE.Vector3();
  const _rayBack = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _q1 = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const _mat4 = new THREE.Matrix4();
  const _scale = new THREE.Vector3();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _negZAxis = new THREE.Vector3(0, 0, -1);
  const _impactNorm = new THREE.Vector3(0, 0, 1);
  const _eul = new THREE.Euler(0, 0, 0, 'YXZ');

  // --- Weapon & Choreography Runtime State ---
  let ammo = 30;
  let magSize = 30;
  let state: 'idle' | 'burst' | 'reload' | 'melee' | 'dragon' = 'idle';
  let fireCooldown = 0;
  let burstQueue = 0;
  let burstTimer = 0;
  let reloadTimer = 0;
  let reloadDuration = 0.88;
  let meleeTimer = 0;
  let dragonUnsheatheT = 0;
  let dragonSheatheT = 0;
  let dragonSwingT = 0;
  let dragonSwingSide = 1;
  let dragonComboIdx = 0;
  let wasDragonActive = false;
  let wasDeflectActive = false;
  let deflectIntroT = 0;
  let deflectOutroT = 0;
  let deflectParryT = 0;
  let parryHandSide = 1;
  let viewSlashT = 0;
  let viewSlashRoll = 0;
  let deflectPulse = 0;
  let slashBufferT = 0;
  let throwAnimT = 0;
  let throwAnimDur = 0.14;
  let throwAnimKind: 'linear' | 'fan' = 'linear';
  let throwBurstStep = 0;
  let clockT = 0;

  const rawMouseLatched = new Set<number>();
  if (typeof window !== 'undefined') {
    window.addEventListener('mousedown', (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest && el.closest('button, input, .menu.open, .g-draft.on, #g-touch')) {
        return;
      }
      if (G.player && G.player.enabled && G.player.alive) {
        rawMouseLatched.add(e.button);
      }
    });
    window.addEventListener('blur', () => rawMouseLatched.clear());
  }
  function consumeRawMouseLatch(button: number): boolean {
    if (rawMouseLatched.has(button)) {
      rawMouseLatched.delete(button);
      return true;
    }
    return false;
  }

  const spKickZ = makeSpring(260, 22);
  const spKickPitch = makeSpring(240, 20);
  const spKickYaw = makeSpring(210, 19);
  const spSwayX = makeSpring(150, 18);
  const spSwayY = makeSpring(150, 18);

  function spawnBeam(a: any, b: any, duration = 0.36, width = 1) {
    let slot: ActiveBeam | null = null;
    for (let i = 0; i < beamPool.length; i++) {
      if (!beamPool[i].active) {
        slot = beamPool[i];
        break;
      }
    }
    if (!slot) slot = beamPool[0];
    slot.active = true;
    slot.start.copy(a);
    slot.end.copy(b);
    slot.life = duration;
    slot.maxLife = duration;
    slot.width = width;
    slot.mesh.visible = true;
  }

  /**
   * Back-stepped world AABB raycast: `G.physics.raycast` only detects slabs with `t_enter > 0`,
   * so backing up `0.16m` guarantees boundary/grazing/pierced origins never slip inside walls!
   */
  function raycastWorldSafe(origin: any, dir: any, maxDist: number) {
    const back = 0.16;
    _rayBack.copy(origin).addScaledVector(dir, -back);
    const hit = G.physics.raycast(_rayBack, dir, maxDist + back);
    if (!hit) return null;
    return {
      dist: Math.max(0, hit.dist - back),
      point: hit.point,
      normal: hit.normal,
      surface: hit.surface,
    };
  }

  function getHandWorldOrigin(out: any): any {
    const cam = G.camera;
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    out
      .copy(cam.position)
      .addScaledVector(_right, 0.16)
      .addScaledVector(_up, -0.10)
      .addScaledVector(_fwd, 0.36);
    return out;
  }

  function checkHandObstructionDist(rawHandOrigin: any): number | null {
    const cam = G.camera;
    _v4.subVectors(rawHandOrigin, cam.position);
    const len = _v4.length();
    if (len < 1e-4) return null;
    _v4.divideScalar(len);
    const hit = G.physics.raycast(cam.position, _v4, len + 0.08);
    return hit ? hit.dist : null;
  }

  function computeRayImpactPoint(rayOrigin: any, rayDir: any, maxRange: number, out: any): { point: any; dist: number; hitSurface: boolean } {
    const wHit = G.physics.raycast(rayOrigin, rayDir, maxRange);
    const dHit =
      G.level && G.level.raycastDestructible
        ? G.level.raycastDestructible(rayOrigin, rayDir, wHit ? wHit.dist + 0.1 : maxRange)
        : null;
    const worldLimit = Math.min(wHit ? wHit.dist : maxRange, dHit ? dHit.dist : maxRange);
    const eHit = G.enemies.raycast(rayOrigin, rayDir, worldLimit);
    const cHit = cb.raycastColossalBoss
      ? cb.raycastColossalBoss(rayOrigin, rayDir, eHit ? eHit.dist : worldLimit)
      : null;

    if (cHit) {
      out.copy(cHit.point);
      return { point: out, dist: cHit.dist, hitSurface: true };
    }
    if (eHit) {
      out.copy(eHit.point);
      return { point: out, dist: eHit.dist, hitSurface: true };
    }
    if (dHit && (!wHit || dHit.dist <= wHit.dist + 0.05)) {
      out.copy(dHit.point);
      return { point: out, dist: dHit.dist, hitSurface: true };
    }
    if (wHit) {
      out.copy(wHit.point);
      return { point: out, dist: wHit.dist, hitSurface: true };
    }
    out.copy(rayOrigin).addScaledVector(rayDir, maxRange);
    return { point: out, dist: maxRange, hitSurface: false };
  }

  function spawnSingleShuriken(
    origin: any,
    dir: any,
    stats: GenjiBuildStats,
    homing = false,
    customDmg?: number,
    minVisSec = 0.092,
    predictedDist = 85
  ) {
    let s: ActiveShuriken | null = null;
    for (let i = 0; i < shurikenPool.length; i++) {
      if (!shurikenPool[i].active) {
        s = shurikenPool[i];
        break;
      }
    }
    if (!s) s = shurikenPool[0];
    s.active = true;
    s.dir.copy(dir).normalize();
    s.originPos.copy(origin);
    s.prevPos.copy(origin);
    s.pos.copy(origin);
    s.visualPos.copy(origin);
    s.impactPoint.copy(origin).addScaledVector(s.dir, predictedDist);
    s.impactResolved = false;
    s.elapsed = 0;
    s.minVisualDuration = Math.max(0.088, minVisSec);
    s.traveledDist = 0;
    s.maxRange = 130;
    s.speed = stats.shurikenSpeed;
    s.damage = customDmg ?? stats.shurikenDamage;
    s.life = Math.min(1.65, s.maxRange / Math.max(24, stats.shurikenSpeed) + 0.22);
    s.spin = Math.random() * Math.PI * 2;
    s.pierceLeft = stats.pierceCount;
    s.homing = homing;
    s.hitIds.clear();
  }

  function fireLinearSingle() {
    if (ammo <= 0) return;
    const stats = cb.getStats();
    ammo = Math.max(0, ammo - 1);
    if (G.combat && G.combat.stats) G.combat.stats.shots++;

    const cam = G.camera;
    const rawHand = getHandWorldOrigin(_v1);
    const handBlockedDist = checkHandObstructionDist(rawHand);
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const aimRes = computeRayImpactPoint(cam.position, _fwd, 125, _v2);

    const pred = computeConvergedLaunchVector({
      cameraPos: cam.position,
      cameraForward: _fwd,
      rawHandOrigin: rawHand,
      aimHitPoint: aimRes.point,
      handBlockedDist,
      projectileSpeed: stats.shurikenSpeed,
    });

    _v3.set(pred.dir.x, pred.dir.y, pred.dir.z);
    _v5.set(pred.safeOrigin.x, pred.safeOrigin.y, pred.safeOrigin.z);
    spawnSingleShuriken(
      _v5,
      _v3,
      stats,
      false,
      undefined,
      pred.minVisualDuration,
      pred.predictedDistance
    );
    // Emit crisp initial wind-thread wake from fingertips so even 12-20 FPS software GL reads instant launch!
    _v4.copy(_v5).addScaledVector(_v3, Math.min(pred.predictedDistance, 5.5));
    spawnBeam(_v5, _v4, 0.11, 0.36);

    cb.audio.shurikenThrow(false);

    // Expressive Shinobi Wrist-Snap & Forearm Flick Animation (`手里剑手部甩腕投掷动作`)!
    throwAnimKind = 'linear';
    throwAnimDur = Math.max(0.12, Math.min(0.17, stats.primaryBurstGap * 2.15));
    throwAnimT = throwAnimDur;
    throwBurstStep = (throwBurstStep + 1) % 3;

    spKickZ.v += 1.25;
    spKickPitch.v += 0.78;
    spKickYaw.v += (throwBurstStep === 1 ? -1 : 1) * 0.45;

    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(_v5, 0x62ffb0, 14, 4.2, 0.035);
    }
    G.events.emit('weapon:fire', {
      origin: cam.position,
      dir: _v3,
      muzzle: _v5,
      ads: 0,
    });
  }

  function fireFanVolley() {
    if (ammo <= 0) return;
    const stats = cb.getStats();
    const count = Math.min(stats.shurikenPerVolley, Math.max(1, ammo));
    ammo = Math.max(0, ammo - count);
    if (G.combat && G.combat.stats) G.combat.stats.shots += count;

    const cam = G.camera;
    const rawHand = getHandWorldOrigin(_v1);
    const handBlockedDist = checkHandObstructionDist(rawHand);
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);

    const angles = computeShurikenFanAngles(count, stats.fanSpreadRad);
    for (const ang of angles) {
      _q1.setFromAxisAngle(_up, -ang);
      // Trace each individual fan blade's own camera ray so every shuriken in the spread converges onto its true target!
      const bladeCamRay = _v4.copy(_fwd).applyQuaternion(_q1).normalize();
      const bladeAim = computeRayImpactPoint(cam.position, bladeCamRay, 125, _v2);
      const pred = computeConvergedLaunchVector({
        cameraPos: cam.position,
        cameraForward: bladeCamRay,
        rawHandOrigin: rawHand,
        aimHitPoint: bladeAim.point,
        handBlockedDist,
        projectileSpeed: stats.shurikenSpeed,
      });

      _v3.set(pred.dir.x, pred.dir.y, pred.dir.z);
      _v5.set(pred.safeOrigin.x, pred.safeOrigin.y, pred.safeOrigin.z);
      spawnSingleShuriken(
        _v5,
        _v3,
        stats,
        false,
        undefined,
        pred.minVisualDuration,
        pred.predictedDistance
      );
      const wakeEnd = _rayBack.copy(_v5).addScaledVector(_v3, Math.min(pred.predictedDistance, 4.8));
      spawnBeam(_v5, wakeEnd, 0.11, 0.34);
    }

    cb.audio.shurikenThrow(true);

    // Wide Cross-Body Horizontal Backhand Fan Whip (`扇形齐射横扫甩手动作`)!
    throwAnimKind = 'fan';
    throwAnimDur = 0.27;
    throwAnimT = 0.27;

    spKickZ.v += 1.85;
    spKickPitch.v += 1.05;
    spKickYaw.v -= 1.35;
    if (G.player && G.player.addShake) G.player.addShake(0.09);
    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(rawHand, 0x62ffb0, 22, 5.5, 0.05);
    }
    G.events.emit('weapon:fire', {
      origin: cam.position,
      dir: _fwd,
      muzzle: rawHand,
      ads: 0,
    });
  }

  function startReload() {
    const stats = cb.getStats();
    magSize = stats.magSize;
    if (reloadTimer > 0 || ammo >= magSize || cb.isDragonblade()) return;
    state = 'reload';
    burstQueue = 0;
    reloadDuration = stats.reloadTime;
    reloadTimer = reloadDuration;
    cb.audio.shurikenReload();
  }

  function damageDestructiblesAround(center: any, radius: number, damage: number, dir: any) {
    if (G.level && G.level.damageInRadius) {
      const hitCount = G.level.damageInRadius(center, radius, damage, dir);
      if (hitCount > 0) {
        cb.audio.structureBreak(damage >= 85);
      }
    }
  }

  function triggerQuickMelee() {
    if (meleeTimer > 0 || cb.isDragonblade() || cb.isDeflecting()) return;
    const stats = cb.getStats();
    meleeTimer = 0.32;
    state = 'melee';
    burstQueue = 0;
    viewSlashT = 0.24;
    viewSlashRoll = -0.22;
    cb.audio.meleeSlash();

    const cam = G.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);

    // Cleave destructible shoji screens / bamboo fences in front of Genji!
    _v3.copy(cam.position).addScaledVector(_fwd, 1.8);
    damageDestructiblesAround(_v3, 2.2, 55, _fwd);

    // Cleave Colossal Boss if within quick-melee reach!
    if (cb.cleaveColossalBoss) {
      const cRes = cb.cleaveColossalBoss(cam.position, 4.4, 58, _fwd, 'melee');
      if (cRes.hit) {
        cb.audio.bladeCleaveImpact(cRes.killed);
        cb.onHeavyHit?.(cRes.orbShattered ? 0.06 : 0.03, 2.5);
      }
    }

    if (G.enemies && G.enemies.list) {
      for (const en of G.enemies.list) {
        if (!en.alive) continue;
        _v1.copy(en.pos).setY(en.pos.y + 0.9).sub(cam.position);
        const dist = _v1.length();
        if (dist <= 3.3 && (dist < 1.2 || _v1.normalize().dot(_fwd) > 0.38)) {
          const hitPt = _v2.copy(en.pos).setY(en.pos.y + 0.9);
          const killed = en.damage(48, hitPt, _fwd, 'body') === true;
          if (G.combat && G.combat.stats) G.combat.stats.hits++;
          spawnParryBurst(hitPt, false);
          cb.audio.bladeCleaveImpact(killed);
          cb.onHeavyHit?.(killed ? 0.042 : 0.025, 2.2);
          if (stats.dragonbladeLifestealRatio > 0 && G.player) {
            G.player.heal(Math.round(48 * stats.dragonbladeLifestealRatio));
          }
          G.events.emit('player:hitEnemy', { enemy: en, part: 'body', killed, weak: false });
          cb.onDamageDealt(48, en, killed, false, 'melee');
        }
      }
    }
  }

  function spawnCrescentWave(damage: number, rangeMeters: number, rollRad: number, scale = 1.45) {
    let w: ActiveCrescentWave | null = null;
    for (let i = 0; i < wavePool.length; i++) {
      if (!wavePool[i].active) {
        w = wavePool[i];
        break;
      }
    }
    if (!w) w = wavePool[0];
    const cam = G.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    w.active = true;
    w.pos.copy(cam.position).addScaledVector(_fwd, 1.0);
    w.dir.copy(_fwd);
    w.speed = 46;
    w.damage = damage;
    w.maxLife = rangeMeters / w.speed;
    w.life = w.maxLife;
    w.roll = rollRad;
    w.radius = 2.4 * scale;
    w.hitIds.clear();
    w.hitBldgIds.clear();
    w.hitColossus = false;
    w.mesh.scale.setScalar(scale);
    w.mesh.visible = true;
  }

  function triggerDeflectDrawSlash() {
    const stats = cb.getStats();
    deflectIntroT = 0.24;
    deflectOutroT = 0;
    burstQueue = 0;
    reloadTimer = 0;
    viewSlashT = 0.28;
    // Crisp upward-diagonal Iaijutsu Draw-Slash (`拔刀斩击`: bottom-left Saya -> top-right guard)
    viewSlashRoll = -0.52;

    const cam = G.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    cb.audio.meleeSlash();
    if (G.player && G.player.addShake) G.player.addShake(0.18);
    spKickZ.v += 1.35;
    spKickPitch.v += 0.65;
    spKickYaw.v -= 1.15;

    // Golden Habaki spark flash at the scabbard mouth on Iaijutsu draw!
    getHandWorldOrigin(_v1);
    spawnParryBurst(_v1, false);
    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(_v1, 0x7affbe, 42, 8.5, 0.11);
    }

    // Cleave destructible screens & fences directly in front of Genji!
    _v3.copy(cam.position).addScaledVector(_fwd, 2.2);
    damageDestructiblesAround(_v3, 2.8, 75, _fwd);

    const drawDamage = 85;
    let hitAny = false;
    let killedAny = false;

    if (cb.cleaveColossalBoss) {
      const cRes = cb.cleaveColossalBoss(cam.position, 5.2, drawDamage, _fwd, 'deflect_draw');
      if (cRes.hit) {
        hitAny = true;
        if (cRes.killed) killedAny = true;
      }
    }

    if (G.enemies && G.enemies.list) {
      for (const en of G.enemies.list) {
        if (!en.alive) continue;
        _v1.copy(en.pos).setY(en.pos.y + 0.92).sub(cam.position);
        const dist = _v1.length();
        if (dist <= 4.6 && (dist < 1.65 || _v1.normalize().dot(_fwd) > 0.24)) {
          const hitPt = _v2.copy(en.pos).setY(en.pos.y + 0.92);
          const killed = en.damage(drawDamage, hitPt, _fwd, 'body') === true;
          hitAny = true;
          if (killed) killedAny = true;
          spawnParryBurst(hitPt, false);
          if (stats.dragonbladeLifestealRatio > 0 && G.player) {
            G.player.heal(Math.round(drawDamage * stats.dragonbladeLifestealRatio));
          }
          if (G.combat && G.combat.stats) {
            G.combat.stats.shots++;
            G.combat.stats.hits++;
          }
          _impactNorm.copy(_fwd).negate();
          G.events.emit('impact', {
            point: hitPt,
            normal: _impactNorm,
            dist,
            surface: 'enemy',
            enemy: en,
            part: 'body',
            dir: _fwd,
            from: 'player',
            killed,
          });
          G.events.emit('player:hitEnemy', { enemy: en, part: 'body', killed, weak: false });
          cb.onDamageDealt(drawDamage, en, killed, false, 'deflect_draw');
        }
      }
    }

    if (hitAny) {
      cb.audio.bladeCleaveImpact(killedAny);
      cb.onHeavyHit?.(killedAny ? 0.045 : 0.030, 3.2);
    }
  }

  function performDragonbladeSlash() {
    const stats = cb.getStats();
    dragonSwingT = stats.dragonbladeSlashInterval;
    dragonComboIdx = (dragonComboIdx + 1) % 3;
    dragonSwingSide = dragonComboIdx === 1 ? -1 : 1;
    viewSlashT = 0.30;
    // 3-Combo Martial Choreography: 0 = Kesa-giri (右袈裟), 1 = Gyaku-kesa (左逆袈裟), 2 = Yoko-Ichimonji (横一文字)
    viewSlashRoll = dragonComboIdx === 0 ? 0.42 : dragonComboIdx === 1 ? 2.72 : 0.04;

    const cam = G.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    cb.audio.dragonSlash(true);
    if (G.player && G.player.addShake) G.player.addShake(dragonComboIdx === 2 ? 0.34 : 0.26);
    spKickZ.v += 1.65;
    spKickYaw.v += dragonSwingSide * 1.55;
    if (G.render && G.render.lightPool) {
      _v1.copy(cam.position).addScaledVector(_fwd, 1.6);
      G.render.lightPool.flash(_v1, 0x7affbe, 65, 11, 0.12);
    }

    // Cleave destructible village pavilions, watchtowers & shoji walls right in front of the odachi!
    _v3.copy(cam.position).addScaledVector(_fwd, 3.0);
    damageDestructiblesAround(_v3, 3.8, stats.dragonbladeSlashDamage, _fwd);

    let hitAny = false;
    let killedAny = false;

    // Cleave Colossal Boss (`荒神大天狗`) & its Raijin Weakspot Orbs!
    if (cb.cleaveColossalBoss) {
      const cRes = cb.cleaveColossalBoss(
        cam.position,
        stats.dragonbladeSlashRange + 2.4,
        stats.dragonbladeSlashDamage,
        _fwd,
        'dragonblade'
      );
      if (cRes.hit) {
        hitAny = true;
        if (cRes.killed) killedAny = true;
        if (stats.dragonbladeLifestealRatio > 0 && G.player) {
          G.player.heal(Math.round(stats.dragonbladeSlashDamage * stats.dragonbladeLifestealRatio));
        }
      }
    }

    if (G.enemies && G.enemies.list) {
      for (const en of G.enemies.list) {
        if (!en.alive) continue;
        _v1.copy(en.pos).setY(en.pos.y + 0.95).sub(cam.position);
        const dist = _v1.length();
        if (
          dist <= stats.dragonbladeSlashRange &&
          (dist < 1.85 || _v1.normalize().dot(_fwd) > 0.18)
        ) {
          const hitPt = _v2.copy(en.pos).setY(en.pos.y + 0.95);
          const killed = en.damage(stats.dragonbladeSlashDamage, hitPt, _fwd, 'body') === true;
          hitAny = true;
          if (killed) killedAny = true;
          spawnParryBurst(hitPt, true);

          if (stats.dragonbladeLifestealRatio > 0 && G.player) {
            G.player.heal(Math.round(stats.dragonbladeSlashDamage * stats.dragonbladeLifestealRatio));
          }
          if (G.combat && G.combat.stats) {
            G.combat.stats.shots++;
            G.combat.stats.hits++;
          }
          _impactNorm.copy(_fwd).negate();
          G.events.emit('impact', {
            point: hitPt,
            normal: _impactNorm,
            dist,
            surface: 'enemy',
            enemy: en,
            part: 'body',
            dir: _fwd,
            from: 'player',
            killed,
          });
          G.events.emit('player:hitEnemy', { enemy: en, part: 'body', killed, weak: false });
          cb.onDamageDealt(stats.dragonbladeSlashDamage, en, killed, false, 'dragonblade');
        }
      }
    }

    if (hitAny) {
      cb.audio.bladeCleaveImpact(killedAny);
      cb.onHeavyHit?.(killedAny ? 0.055 : 0.038, 4.2);
    } else if (G.combat && G.combat.stats) {
      G.combat.stats.shots++;
    }

    // Dragonblade LMB performs a crisp forward Samurai Lunge Cleave (`拔刀突进斩`)!
    cb.onDragonbladeLunge?.(_fwd, stats.dragonbladeLungeRange || 7.6);
  }

  function summonDragonManifestation() {
    dragonManifestT = 2.35;
    dragonUnsheatheT = 0.32;
    dragonSheatheT = 0;
    dragonComboIdx = 2;
    burstQueue = 0;
    reloadTimer = 0;
    viewSlashT = 0.28;
    viewSlashRoll = -0.45;
    const cam = G.camera;
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    dragonOrigin.copy(cam.position).addScaledVector(_fwd, 1.85);
    dragonOrigin.y -= 0.42;
    _eul.set(
      clamp(G.player.pitch * 0.45, -0.35, 0.45),
      G.player.yaw,
      0,
      'YXZ'
    );
    dragonQuat.setFromEuler(_eul);
    dragonSpirit.position.copy(dragonOrigin);
    dragonSpirit.quaternion.copy(dragonQuat);
    dragonSpirit.visible = true;

    dragonCastRing.position.set(G.player.pos.x, G.player.pos.y + 0.06, G.player.pos.z);
    dragonCastRing.scale.setScalar(0.8);
    dragonCastRing.visible = true;

    // Golden Habaki spark flash at the scabbard mouth on Iaijutsu draw!
    getHandWorldOrigin(_v1);
    spawnParryBurst(_v1, false);

    damageDestructiblesAround(G.player.pos, 4.5, 90, _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion));

    if (G.render && G.render.lightPool) {
      G.render.lightPool.flash(cam.position, 0x62ffb0, 95, 18, 0.45);
    }
  }

  function finishShurikenOnImpact(s: ActiveShuriken, impactPt: any): boolean {
    s.impactPoint.copy(impactPt);
    s.impactResolved = true;
    // If the projectile already flew visibly for `minVisualDuration`, retire immediately;
    // otherwise keep its visual mesh gliding smoothly from `originPos -> impactPoint` so point-blank shots never skip!
    if (s.elapsed >= s.minVisualDuration) {
      s.active = false;
      return true;
    }
    return false;
  }

  function advancePiercedShurikenSafely(s: ActiveShuriken, hitPt: any, stepForward: number): boolean {
    const behindWall = raycastWorldSafe(hitPt, s.dir, stepForward + 0.06);
    if (behindWall) {
      G.events.emit('impact', {
        point: behindWall.point,
        normal: behindWall.normal,
        dist: behindWall.dist,
        surface: behindWall.surface,
        enemy: null,
        dir: s.dir,
        from: 'player',
      });
      return finishShurikenOnImpact(s, behindWall.point);
    }
    s.pos.copy(hitPt).addScaledVector(s.dir, stepForward);
    s.traveledDist += stepForward;
    return false;
  }

  function updateWorldProjectiles(dt: number, visualsOnly = false) {
    const stats = cb.getStats();

    // Tick Bleed DoTs (`裂甲透骨镖`) only during active simulation
    if (!visualsOnly && activeBleeds.size > 0) {
      for (const [id, bl] of activeBleeds) {
        if (!bl.enemy || !bl.enemy.alive || bl.timeLeft <= 0) {
          activeBleeds.delete(id);
          continue;
        }
        bl.timeLeft -= dt;
        bl.tickAcc += dt;
        if (bl.tickAcc >= 0.35) {
          const dmg = Math.max(1, Math.round(bl.dps * bl.tickAcc));
          bl.tickAcc = 0;
          const killed = bl.enemy.damage(dmg, bl.enemy.pos, _zAxis, 'body') === true;
          cb.onDamageDealt(dmg, bl.enemy, killed, false, 'bleed');
          if (killed) activeBleeds.delete(id);
        }
      }
    }

    // 1. Update spinning 3D Fuma Shurikens + Polar Chakra Star-Halos + Helical Wind-Wakes
    //    Combines back-stepped swept collision, out-of-bounds watchdog, guaranteed minimum visual transit,
    //    and perspective-compensated scaling so bullets NEVER get stuck mid-air and are ALWAYS visible!
    let instIdx = 0;
    const camPos = G.camera.position;
    const camQuat = G.camera.quaternion;

    for (let i = 0; i < shurikenPool.length; i++) {
      const s = shurikenPool[i];
      if (!s.active) continue;

      s.elapsed += dt;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        continue;
      }

      if (s.impactResolved) {
        // Simulation already hit a target on an earlier sub-frame; finish smooth visual glide to `impactPoint`!
        const vis = computeProjectileVisualPosition(
          s.originPos,
          s.impactPoint,
          s.elapsed,
          s.minVisualDuration
        );
        if (vis.done) {
          s.active = false;
          continue;
        }
        s.visualPos.set(vis.pos.x, vis.pos.y, vis.pos.z);
      } else if (visualsOnly) {
        // Slow-motion visual continuity during brief combat hitstop (`hitstopT > 0`)
        s.visualPos.addScaledVector(s.dir, s.speed * dt);
      } else {
        try {
          if (
            s.traveledDist >= s.maxRange ||
            isProjectileOutOfPlayableBounds(s.pos, s.originPos, s.maxRange)
          ) {
            s.active = false;
            continue;
          }

          if (s.homing && G.enemies && G.enemies.list) {
            let bestEn: any = null;
            let bestD = 36;
            for (const en of G.enemies.list) {
              if (!en.alive || s.hitIds.has(en.id)) continue;
              const d = en.pos.distanceTo(s.pos);
              if (d < bestD) {
                bestD = d;
                bestEn = en;
              }
            }
            if (bestEn) {
              _v1.copy(bestEn.pos).setY(bestEn.pos.y + 1.05).sub(s.pos).normalize();
              s.dir.lerp(_v1, Math.min(1, dt * 15)).normalize();
            }
          }

          s.prevPos.copy(s.pos);
          const stepDist = Math.min(s.maxRange - s.traveledDist, Math.max(0.04, s.speed * dt));

          const dHit =
            G.level && G.level.raycastDestructible
              ? G.level.raycastDestructible(s.pos, s.dir, stepDist)
              : null;
          const wHit = raycastWorldSafe(s.pos, s.dir, stepDist);
          const wallDist = Math.min(dHit ? dHit.dist : Infinity, wHit ? wHit.dist : Infinity);
          const maxRay = Number.isFinite(wallDist) ? wallDist : stepDist;
          const eHit = G.enemies.raycast(s.pos, s.dir, maxRay);
          const cHit = cb.raycastColossalBoss
            ? cb.raycastColossalBoss(s.pos, s.dir, eHit ? eHit.dist : maxRay)
            : null;

          if (cHit && cb.damageColossalBoss) {
            spawnBeam(s.prevPos, cHit.point, 0.18, 0.62);
            spawnParryBurst(cHit.point, cHit.orbIndex >= 0);
            const cRes = cb.damageColossalBoss(
              s.damage,
              cHit.point,
              s.dir,
              cHit.orbIndex,
              'shuriken'
            );
            if (cHit.orbIndex >= 0 && stats.primaryCycleTime < 0.44) {
              ammo = clamp(ammo + 2, 0, stats.magSize);
            }
            if (G.combat && G.combat.stats) G.combat.stats.hits++;
            if (s.pierceLeft > 0 && !cRes.orbShattered) {
              s.pierceLeft--;
              if (advancePiercedShurikenSafely(s, cHit.point, 0.42)) continue;
            } else if (finishShurikenOnImpact(s, cHit.point)) {
              continue;
            }
          } else if (eHit && eHit.enemy && !s.hitIds.has(eHit.enemy.id)) {
            const en = eHit.enemy;
            s.hitIds.add(en.id);
            const isWeak = eHit.part === 'weak';
            const dmg = s.damage * (isWeak ? 2.0 : 1.0);
            const killed = en.damage(dmg, eHit.point, s.dir, eHit.part) === true;

            spawnBeam(s.prevPos, eHit.point, 0.17, 0.58);
            if (isWeak) spawnParryBurst(eHit.point, false);

            if (isWeak && stats.primaryCycleTime < 0.44) {
              ammo = clamp(ammo + 2, 0, stats.magSize);
            }
            if (!killed && stats.bleedDps > 0) {
              activeBleeds.set(en.id, {
                enemy: en,
                dps: stats.bleedDps,
                timeLeft: stats.bleedDuration,
                tickAcc: 0,
              });
            }

            if (G.combat && G.combat.stats) G.combat.stats.hits++;
            _impactNorm.copy(s.dir).negate();
            G.events.emit('impact', {
              point: eHit.point,
              normal: eHit.normal || _impactNorm,
              dist: eHit.dist,
              surface: 'enemy',
              enemy: en,
              part: eHit.part,
              dir: s.dir,
              from: 'player',
              killed,
            });
            G.events.emit('player:hitEnemy', { enemy: en, part: eHit.part, killed, weak: isWeak });
            cb.onDamageDealt(dmg, en, killed, isWeak, 'shuriken');

            if (s.pierceLeft > 0) {
              s.pierceLeft--;
              if (advancePiercedShurikenSafely(s, eHit.point, 0.34)) continue;
            } else if (finishShurikenOnImpact(s, eHit.point)) {
              continue;
            }
          } else if (dHit && dHit.item && (!wHit || dHit.dist <= wHit.dist + 0.08)) {
            spawnBeam(s.prevPos, dHit.point, 0.16, 0.52);
            const res = G.level.damageDestructible(dHit.item, s.damage, dHit.point, s.dir);
            if (res && (res.damaged || res.destroyed)) {
              cb.audio.structureBreak(res.destroyed);
            }
            if (s.pierceLeft > 0) {
              s.pierceLeft--;
              if (advancePiercedShurikenSafely(s, dHit.point, 0.36)) continue;
            } else if (finishShurikenOnImpact(s, dHit.point)) {
              continue;
            }
          } else if (wHit) {
            spawnBeam(s.prevPos, wHit.point, 0.16, 0.50);
            G.events.emit('impact', {
              point: wHit.point,
              normal: wHit.normal,
              dist: wHit.dist,
              surface: wHit.surface,
              enemy: null,
              dir: s.dir,
              from: 'player',
            });
            if (finishShurikenOnImpact(s, wHit.point)) {
              continue;
            }
          } else {
            s.pos.addScaledVector(s.dir, stepDist);
            s.traveledDist += stepDist;
            if (
              s.traveledDist >= s.maxRange ||
              isProjectileOutOfPlayableBounds(s.pos, s.originPos, s.maxRange)
            ) {
              s.active = false;
              continue;
            }
          }

          if (s.impactResolved) {
            const vis = computeProjectileVisualPosition(
              s.originPos,
              s.impactPoint,
              s.elapsed,
              s.minVisualDuration
            );
            s.visualPos.set(vis.pos.x, vis.pos.y, vis.pos.z);
          } else {
            s.visualPos.copy(s.pos);
          }
        } catch {
          // Defensive safety: never allow a projectile exception to leave stuck instances in mid-air
          s.active = false;
          continue;
        }
      }

      const distToCam = s.visualPos.distanceTo(camPos);
      const visScale = Math.min(2.4, computeProjectileVisualScale(distToCam, 1.0));

      s.spin += dt * 48;
      _q1.setFromUnitVectors(_zAxis, s.dir);
      _q2.setFromAxisAngle(_yAxis, s.spin);
      _q1.multiply(_q2);
      _scale.setScalar(1.26 * visScale);
      _mat4.compose(s.visualPos, _q1, _scale);
      shurikenInstMesh.setMatrixAt(instIdx, _mat4);

      // Camera-facing Razor 4-Point Chakra Star-Halo (100% visible at any pitch, distance, or background contrast!)
      _scale.setScalar(1.32 * visScale);
      _mat4.compose(s.visualPos, camQuat, _scale);
      shurikenHaloMesh.setMatrixAt(instIdx, _mat4);

      // Helical Wind-Wake streaming behind the shuriken (clamped to distance traveled from origin so it never pokes behind Genji's camera!)
      const flownLen = Math.max(0.18, s.visualPos.distanceTo(s.originPos));
      const wakeZScale = Math.min(1.65 * Math.min(1.8, visScale), flownLen / 2.85);
      _q1.setFromUnitVectors(_zAxis, _v1.copy(s.dir).negate());
      _q2.setFromAxisAngle(_zAxis, s.spin * 0.55);
      _q1.multiply(_q2);
      _scale.set(1.35 * visScale, 1.35 * visScale, Math.max(0.10, wakeZScale));
      _mat4.compose(s.visualPos, _q1, _scale);
      shurikenTrailMesh.setMatrixAt(instIdx, _mat4);
      instIdx++;
    }

    if (instIdx > 0 || shurikenInstMesh.count > 0) {
      shurikenInstMesh.count = instIdx;
      shurikenInstMesh.instanceMatrix.needsUpdate = true;
      shurikenHaloMesh.count = instIdx;
      shurikenHaloMesh.instanceMatrix.needsUpdate = true;
      shurikenTrailMesh.count = instIdx;
      shurikenTrailMesh.instanceMatrix.needsUpdate = true;
    }

    // 2. Update Custom GLSL Crescent Sword-Ki Waves (slices enemies, Colossal Boss & destructibles!)
    for (let i = 0; i < wavePool.length; i++) {
      const w = wavePool[i];
      if (!w.active) continue;
      w.life -= dt;
      if (w.life <= 0) {
        w.active = false;
        w.mesh.visible = false;
        continue;
      }
      const stepDist = w.speed * dt;
      w.pos.addScaledVector(w.dir, stepDist);
      w.mesh.position.copy(w.pos);
      _q1.setFromUnitVectors(_negZAxis, w.dir);
      _q2.setFromAxisAngle(_negZAxis, w.roll);
      w.mesh.quaternion.copy(_q1).multiply(_q2);

      if (w.damage > 0 && G.level && Array.isArray(G.level.destructibles)) {
        for (const bldg of G.level.destructibles) {
          if (!bldg || bldg.state.stage === 'destroyed' || w.hitBldgIds.has(bldg.id)) continue;
          const dxz = Math.hypot(bldg.center.x - w.pos.x, bldg.center.z - w.pos.z);
          const dy = Math.abs(bldg.center.y - w.pos.y);
          if (dxz <= w.radius + 2.2 && dy <= 3.8) {
            w.hitBldgIds.add(bldg.id);
            const res = G.level.damageDestructible(bldg, w.damage, w.pos, w.dir);
            if (res && (res.damaged || res.destroyed)) {
              cb.audio.structureBreak(res.destroyed);
            }
          }
        }
      }

      if (!w.hitColossus && w.damage > 0 && cb.cleaveColossalBoss) {
        const cRes = cb.cleaveColossalBoss(w.pos, w.radius + 1.8, w.damage, w.dir, 'dragon_wave');
        if (cRes.hit) {
          w.hitColossus = true;
          spawnParryBurst(w.pos, true);
          if (stats.dragonbladeLifestealRatio > 0 && G.player) {
            G.player.heal(Math.round(w.damage * stats.dragonbladeLifestealRatio));
          }
        }
      }

      if (w.damage > 0 && G.enemies && G.enemies.list) {
        for (const en of G.enemies.list) {
          if (!en.alive || w.hitIds.has(en.id)) continue;
          _v1.copy(en.pos).setY(en.pos.y + 0.95);
          if (_v1.distanceTo(w.pos) <= w.radius) {
            w.hitIds.add(en.id);
            const killed = en.damage(w.damage, _v1, w.dir, 'body') === true;
            spawnParryBurst(_v1, false);
            if (stats.dragonbladeLifestealRatio > 0 && G.player) {
              G.player.heal(Math.round(w.damage * stats.dragonbladeLifestealRatio));
            }
            if (G.combat && G.combat.stats) G.combat.stats.hits++;
            G.events.emit('player:hitEnemy', { enemy: en, part: 'body', killed, weak: false });
            cb.onDamageDealt(w.damage, en, killed, false, 'dragon_wave');
          }
        }
      }
    }

    // 3. Update Spiraling Wind-Vortex Swift Strike & Slipstream Trails
    for (let i = 0; i < beamPool.length; i++) {
      const b = beamPool[i];
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      _v1.subVectors(b.end, b.start);
      const len = _v1.length();
      if (len < 0.05) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      _v1.divideScalar(len);
      b.mesh.position.copy(b.start);
      _q1.setFromUnitVectors(_zAxis, _v1);
      _q2.setFromAxisAngle(_zAxis, clockT * 14 + i);
      b.mesh.quaternion.copy(_q1).multiply(_q2);
      const fade = clamp01(b.life / b.maxLife);
      b.mesh.scale.set(b.width * fade, b.width * fade, len);
    }

    // 4. Update Polar GLSL Parry Shockwaves & Diamond Steel Sparks
    for (let i = 0; i < parryRings.length; i++) {
      const r = parryRings[i];
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const p = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(0.25 + p * r.maxScale);
      r.mesh.quaternion.copy(camQuat);
    }

    let spCount = 0;
    for (let i = 0; i < sparkPool.length; i++) {
      const sp = sparkPool[i];
      if (!sp.active) continue;
      sp.life -= dt;
      if (sp.life <= 0) {
        sp.active = false;
        continue;
      }
      sp.vel.y -= 18 * dt;
      sp.pos.addScaledVector(sp.vel, dt);
      _v1.copy(sp.vel).normalize();
      _q1.setFromUnitVectors(_zAxis, _v1);
      const fade = clamp01(sp.life / sp.maxLife);
      _scale.set(fade, fade, 0.8 + fade * 1.4);
      _mat4.compose(sp.pos, _q1, _scale);
      sparkInstMesh.setMatrixAt(spCount++, _mat4);
    }
    if (spCount > 0 || sparkInstMesh.count > 0) {
      sparkInstMesh.count = spCount;
      sparkInstMesh.instanceMatrix.needsUpdate = true;
    }

    // 5. Animate Custom GLSL Twin-Helix Spirit Dragon (`Q` Ultimate!)
    if (dragonManifestT > 0) {
      dragonManifestT -= dt;
      if (dragonManifestT <= 0) {
        dragonSpirit.visible = false;
        dragonCastRing.visible = false;
      } else {
        const progress = 1 - dragonManifestT / 2.35;
        const baseAlpha =
          progress < 0.12
            ? progress / 0.12
            : progress > 0.72
              ? (1 - progress) / 0.28
              : 1.0;
        spiritDragonUniforms.uAlpha.value = baseAlpha * 0.58;

        _fwd.set(0, 0, -1).applyQuaternion(dragonQuat);
        dragonSpirit.position.copy(dragonOrigin).addScaledVector(_fwd, progress * 15.5);
        dragonSpirit.position.y += Math.sin(progress * Math.PI) * 1.25;
        _q1.setFromAxisAngle(_negZAxis, clockT * 5.2);
        dragonSpirit.quaternion.copy(dragonQuat).multiply(_q1);
        const s = progress < 0.14 ? 0.35 + (progress / 0.14) * 0.65 : 1.0;
        dragonSpirit.scale.setScalar(s);

        // Animate roaring lower jaw!
        lowerJaw.rotation.x = -0.32 - Math.abs(Math.sin(clockT * 11.0)) * 0.24;

        if (progress < 0.38) {
          const rp = progress / 0.38;
          dragonCastRing.visible = true;
          dragonCastRing.scale.setScalar(0.8 + rp * 5.4);
        } else {
          dragonCastRing.visible = false;
        }

        for (let k = 0; k < DRAGON_SHARDS; k++) {
          const u = (k / DRAGON_SHARDS + clockT * 0.75) % 1;
          const ang = u * Math.PI * 6.5 + k;
          const rad = 1.75 * (1 - u * 0.45);
          _v1.set(Math.cos(ang) * rad, Math.sin(ang) * rad * 0.85 + 0.45, -u * 11.4);
          _v2.set(-Math.sin(ang) * 0.65, Math.cos(ang) * 0.55, -1.0).normalize();
          _q2.setFromUnitVectors(_zAxis, _v2);
          const pulse = 0.65 + 0.45 * Math.sin(clockT * 10 + k);
          _scale.set(0.42 * pulse, 0.42 * pulse, 2.8 * pulse);
          _mat4.compose(_v1, _q2, _scale);
          dragonShards.setMatrixAt(k, _mat4);
        }
        dragonShards.instanceMatrix.needsUpdate = true;
      }
    }
  }

  function updateViewmodel(dt: number) {
    clockT += dt;
    spiritDragonUniforms.uTime.value = clockT;
    deflectShaderUniforms.uTime.value = clockT;

    const input = G.input;
    const player = G.player;
    const stats = cb.getStats();
    magSize = stats.magSize;
    if (ammo > magSize) ammo = magSize;

    const isDragon = cb.isDragonblade();
    const isDeflect = cb.isDeflecting();

    // Detect `Q` Dragonblade end -> trigger crisp Chiburi + Noto Scabbard Resheathe (`血振纳刀`)!
    if (wasDragonActive && !isDragon) {
      dragonSheatheT = 0.34;
      cb.audio.katanaSheathe();
    }
    wasDragonActive = isDragon;

    // Detect `E` Deflect start / end -> Single-Katana Iai Draw-Slash (`拔刀斩击`) & Noto Sheathe!
    if (!wasDeflectActive && isDeflect) {
      if (deflectIntroT <= 0) {
        triggerDeflectDrawSlash();
      }
    } else if (wasDeflectActive && !isDeflect) {
      if (!isDragon) {
        deflectOutroT = 0.24;
        cb.audio.katanaSheathe();
      }
      viewSlashT = 0.16;
      viewSlashRoll = 0.10;
    }
    wasDeflectActive = isDeflect;

    if (reloadTimer > 0) {
      reloadTimer -= dt;
      if (reloadTimer <= 0) {
        reloadTimer = 0;
        ammo = magSize;
        state = 'idle';
      }
    }

    if (
      burstQueue > 0 &&
      reloadTimer <= 0 &&
      !isDragon &&
      !isDeflect &&
      dragonSheatheT <= 0 &&
      deflectOutroT <= 0
    ) {
      burstTimer -= dt;
      if (burstTimer <= 0) {
        if (ammo > 0) {
          fireLinearSingle();
          burstQueue--;
          burstTimer = stats.primaryBurstGap;
        } else {
          burstQueue = 0;
          startReload();
        }
      }
    }

    fireCooldown = Math.max(0, fireCooldown - dt);
    meleeTimer = Math.max(0, meleeTimer - dt);
    dragonUnsheatheT = Math.max(0, dragonUnsheatheT - dt);
    dragonSheatheT = Math.max(0, dragonSheatheT - dt);
    dragonSwingT = Math.max(0, dragonSwingT - dt);
    deflectIntroT = Math.max(0, deflectIntroT - dt);
    deflectOutroT = Math.max(0, deflectOutroT - dt);
    deflectParryT = Math.max(0, deflectParryT - dt);
    viewSlashT = Math.max(0, viewSlashT - dt);
    throwAnimT = Math.max(0, throwAnimT - dt);
    deflectPulse = Math.max(0, deflectPulse - dt * 4.5);
    deflectShaderUniforms.uPulse.value = deflectPulse;

    const tIn = cb.touch;
    const tFirePressed = tIn ? tIn.consumeFirePressed() : false;
    const tFireHeld = tIn ? tIn.isFireHeld() : false;
    const tFanPressed = tIn ? tIn.consumeFanPressed() : false;
    const tMeleePressed = tIn ? tIn.consumeMeleePressed() : false;
    const tReloadPressed = tIn ? tIn.consumeReloadPressed() : false;
    const rawLmb = consumeRawMouseLatch(0);
    const rawRmb = consumeRawMouseLatch(2);
    slashBufferT = Math.max(0, slashBufferT - dt);
    if (rawLmb || input.pressed('fire') || tFirePressed || tMeleePressed) {
      slashBufferT = 0.28;
    }

    if (player && player.alive && player.enabled) {
      if (isDragon && !isDeflect) {
        state = 'dragon';
        // Responsive per-LMB slash: allow seamless combo re-triggering during tail recovery (`<= 24%` left)
        const allowNextCombo =
          dragonSwingT <= 0 ||
          (slashBufferT > 0.20 && dragonSwingT <= stats.dragonbladeSlashInterval * 0.24);
        if (
          (input.fire ||
            slashBufferT > 0 ||
            tFireHeld ||
            tFanPressed) &&
          allowNextCombo &&
          dragonUnsheatheT <= 0.08
        ) {
          slashBufferT = 0;
          performDragonbladeSlash();
        }
      } else if (!isDeflect && dragonSheatheT <= 0.08 && deflectOutroT <= 0.08) {
        if (input.pressed('reload') || tReloadPressed) {
          startReload();
        } else if (input.pressed('melee') || tMeleePressed) {
          triggerQuickMelee();
        } else if (
          reloadTimer <= 0 &&
          meleeTimer <= 0 &&
          burstQueue <= 0 &&
          fireCooldown <= 0
        ) {
          if (rawRmb || input.pressed('ads') || input.ads || tFanPressed) {
            if (ammo > 0) {
              fireFanVolley();
              fireCooldown = stats.fanCycleTime;
            } else {
              startReload();
            }
          } else if (
            rawLmb ||
            input.fire ||
            input.pressed('fire') ||
            tFireHeld ||
            tFirePressed ||
            slashBufferT > 0
          ) {
            slashBufferT = 0;
            if (ammo > 0) {
              fireLinearSingle();
              burstQueue = stats.shurikenPerVolley - 1;
              burstTimer = stats.primaryBurstGap;
              fireCooldown = stats.primaryCycleTime;
              state = 'burst';
            } else {
              startReload();
            }
          }
        }
      }
    }

    if (
      ammo <= 0 &&
      reloadTimer <= 0 &&
      burstQueue <= 0 &&
      !isDragon &&
      !isDeflect &&
      meleeTimer <= 0
    ) {
      startReload();
    }

    stepSpring(spSwayX, clamp(-input.look.dx * 16, -0.09, 0.09), dt);
    stepSpring(spSwayY, clamp(-input.look.dy * 16, -0.09, 0.09), dt);
    stepSpring(spKickZ, 0, dt);
    stepSpring(spKickPitch, 0, dt);
    stepSpring(spKickYaw, 0, dt);

    const speedRatio = player ? clamp01(player.speed / 7.2) : 0;
    const bobX = Math.sin(clockT * 9.2) * 0.012 * speedRatio;
    const bobY = Math.abs(Math.cos(clockT * 9.2)) * -0.015 * speedRatio;

    // Strictly ONE single katana (`dragonKatana`, `龙丸一把佩刀`) governs `Q` Dragonblade, `E` Deflect Draw-Slash, and `V` Quick Melee!
    const singleBlade = computeGenjiSingleBladeState({
      isDragonblade: isDragon,
      dragonSheatheT,
      isDeflect,
      deflectOutroT,
      meleeTimer,
    });
    const showKatana = singleBlade.katanaDrawn;

    rightArm.visible = !showKatana;
    dragonKatana.visible = showKatana;
    // Full emerald dragon spirit coils glow when `Q` Dragonblade is unsheathed; `E` & `V` gleam with cold Tamahagane steel!
    spiritCoiledAura.visible = isDragon || dragonSheatheT > 0;
    spiritRazorThread.visible = isDragon || isDeflect;
    katanaTsubaAura.visible = isDragon || deflectParryT > 0;
    heldShurikensGroup.visible = !showKatana;

    const visibleHeld = reloadTimer > 0 || showKatana ? 0 : Math.min(3, ammo);
    for (let i = 0; i < 3; i++) {
      heldShurikens[i].visible = i < visibleHeld;
      heldShurikens[i].rotation.z = fanOffsets[i] + Math.sin(clockT * 3.8 + i) * 0.04;
    }

    // =========================================================================
    // RIGHT ARM SHURIKEN CHOREOGRAPHY (Active when single katana is sheathed!)
    // =========================================================================
    if (!showKatana) {
      if (reloadTimer > 0) {
        const rp = 1 - reloadTimer / Math.max(0.2, reloadDuration);
        const openAmt = Math.sin(rp * Math.PI);
        reloadHatch.position.y = 0.018 + openAmt * 0.028;
        hatchRoll.rotation.z = rp * Math.PI * 4;
        heldShurikensGroup.position.set(-0.004, 0.004, -0.124);
        rightArm.position.set(0.135 + bobX, -0.095 + openAmt * 0.035 + bobY, -0.36);
        rightArm.rotation.set(0.34 + 0.18 * openAmt, 0.32 + 0.22 * openAmt, 0.28 * openAmt);
      } else if (throwAnimT > 0) {
        reloadHatch.position.y = damp(reloadHatch.position.y, 0.018, 16, dt);
        const tp = clamp01(1 - throwAnimT / Math.max(0.08, throwAnimDur));
        if (throwAnimKind === 'linear') {
          const alt = throwBurstStep === 1 ? -1 : throwBurstStep === 2 ? 1 : 0;
          if (tp < 0.24) {
            const u = tp / 0.24;
            rightArm.position.set(0.165 - u * 0.032 + bobX, -0.106 + u * 0.034 + bobY, -0.38 + u * 0.035);
            rightArm.rotation.set(0.24 + u * 0.26, 0.18 + u * 0.20, -0.16 - u * 0.34);
            heldShurikensGroup.position.set(-0.004, 0.006, -0.124 - u * 0.014);
          } else if (tp < 0.64) {
            const u = (tp - 0.24) / 0.40;
            const snap = 1 - Math.pow(1 - u, 3);
            rightArm.position.set(
              0.133 + snap * (0.026 + alt * 0.022) + bobX,
              -0.072 - snap * 0.048 + bobY,
              -0.345 - snap * 0.125
            );
            rightArm.rotation.set(
              0.50 - snap * 0.62,
              0.38 - snap * (0.36 - alt * 0.12),
              -0.50 + snap * 0.68
            );
            heldShurikensGroup.position.set(-0.004, 0.004, -0.112 - snap * 0.012);
          } else {
            const u = (tp - 0.64) / 0.36;
            const ease = 1 - Math.pow(1 - u, 2);
            rightArm.position.set(
              0.159 + (0.165 - 0.159) * ease + bobX,
              -0.120 + (-0.106 - -0.120) * ease + bobY,
              -0.47 + (-0.38 - -0.47) * ease
            );
            rightArm.rotation.set(
              -0.12 + (0.24 - -0.12) * ease,
              0.02 + (0.18 - 0.02) * ease,
              0.18 + (-0.16 - 0.18) * ease
            );
            heldShurikensGroup.position.set(-0.004, 0.004, -0.124);
          }
        } else {
          if (tp < 0.26) {
            const u = tp / 0.26;
            rightArm.position.set(0.165 - u * 0.145 + bobX, -0.106 + u * 0.036 + bobY, -0.38 + u * 0.025);
            rightArm.rotation.set(0.24 + u * 0.18, 0.18 + u * 0.56, -0.16 - u * 0.72);
            heldShurikensGroup.position.set(-0.004, 0.008, -0.132);
          } else if (tp < 0.68) {
            const u = (tp - 0.26) / 0.42;
            const whip = 1 - Math.pow(1 - u, 3);
            rightArm.position.set(0.02 + whip * 0.24 + bobX, -0.070 - whip * 0.042 + bobY, -0.355 - whip * 0.105);
            rightArm.rotation.set(0.42 - whip * 0.46, 0.74 - whip * 1.02, -0.88 + whip * 1.12);
            heldShurikensGroup.position.set(-0.004, 0.004, -0.118 - whip * 0.006);
          } else {
            const u = (tp - 0.68) / 0.32;
            const ease = 1 - Math.pow(1 - u, 2);
            rightArm.position.set(0.26 + (0.165 - 0.26) * ease + bobX, -0.112 + ease * 0.006 + bobY, -0.46 + ease * 0.08);
            rightArm.rotation.set(-0.04 + 0.28 * ease, -0.28 + 0.46 * ease, 0.24 + (-0.16 - 0.24) * ease);
            heldShurikensGroup.position.set(-0.004, 0.004, -0.124);
          }
        }
      } else {
        reloadHatch.position.y = damp(reloadHatch.position.y, 0.018, 16, dt);
        heldShurikensGroup.position.set(-0.004, 0.004, -0.124);
        const breathY = Math.sin(clockT * 2.8) * 0.0035;
        rightArm.position.set(
          0.162 + bobX + spSwayX.x * 0.38,
          -0.102 + breathY + bobY + spSwayY.x * 0.38,
          -0.375 + spKickZ.x * 0.04
        );
        rightArm.rotation.set(
          0.09 + spKickPitch.x * 0.14 + spSwayY.x * 0.55,
          0.16 + spKickYaw.x * 0.14 + spSwayX.x * 0.55,
          -0.12 + spKickYaw.x * 0.10
        );
      }
    }

    // =========================================================================
    // LEFT ARM & SINGLE KATANA (`龙丸`) CHOREOGRAPHY (`Normal Kuji` / `V Iai` / `E 拔刀斩击 & Parry` / `Q 龙神三段连斩`)
    // =========================================================================
    sayaScabbard.visible =
      (dragonUnsheatheT > 0 ||
        dragonSheatheT > 0 ||
        deflectIntroT > 0 ||
        deflectOutroT > 0 ||
        meleeTimer > 0) &&
      dragonSwingT <= 0;
    leftArm.visible = true;
    deflectVfxGroup.visible = isDeflect;

    const showFanLeftHand = !showKatana && throwAnimT > 0 && throwAnimKind === 'fan';
    if (!showKatana) {
      if (showFanLeftHand) {
        const tp = clamp01(1 - throwAnimT / Math.max(0.08, throwAnimDur));
        const wave = Math.sin(tp * Math.PI);
        leftArm.position.set(-0.185 + wave * 0.045, -0.128 + wave * 0.042, -0.38 - wave * 0.03);
        leftArm.rotation.set(0.28 + wave * 0.22, -0.22 + wave * 0.28, 0.28 + wave * 0.28);
      } else {
        const throwKick = throwAnimT > 0 ? Math.sin(clamp01(1 - throwAnimT / Math.max(0.08, throwAnimDur)) * Math.PI) : 0;
        const breathY = Math.cos(clockT * 2.8) * 0.003;
        leftArm.position.set(
          -0.178 - bobX * 0.8 + spSwayX.x * 0.32 - throwKick * 0.014,
          -0.118 + breathY + bobY * 0.85 + spSwayY.x * 0.32 + throwKick * 0.018,
          -0.372 + throwKick * 0.022
        );
        leftArm.rotation.set(
          0.12 + throwKick * 0.14 + spSwayY.x * 0.45,
          -0.22 - throwKick * 0.10 + spSwayX.x * 0.45,
          0.22 + throwKick * 0.12
        );
      }
    } else if (dragonSheatheT > 0 || deflectOutroT > 0) {
      // Smooth Chiburi + Noto Scabbard Resheathe (`血振纳刀`) of the single katana!
      const rem = dragonSheatheT > 0 ? dragonSheatheT : deflectOutroT;
      const tot = dragonSheatheT > 0 ? 0.34 : 0.24;
      const p = clamp01(1 - rem / tot);
      leftArm.position.set(-0.18, -0.135 + Math.sin(p * Math.PI) * 0.032, -0.38);
      leftArm.rotation.set(0.28, 0.38, 0.48);
      sayaScabbard.visible = true;
      sayaScabbard.rotation.set(-0.42, 0.18, -0.95);
      if (p < 0.36) {
        const cp = p / 0.36;
        dragonKatana.position.set(0.18 + cp * 0.09, -0.135 + cp * 0.035, -0.39);
        dragonKatana.rotation.set(-0.12, -0.32 - cp * 0.38, -0.48 - cp * 0.56);
      } else {
        const np = (p - 0.36) / 0.64;
        const ease = 1 - Math.pow(1 - np, 2);
        dragonKatana.position.set(0.27 - ease * 0.44, -0.10 - ease * 0.055, -0.39 + ease * 0.02);
        dragonKatana.rotation.set(-0.12 - ease * 0.58, -0.70 + ease * 1.25, -1.04 - ease * 0.34);
      }
    } else if (isDeflect) {
      // `E` Single-Katana Iaijutsu Draw-Slash (`拔刀斩击`) -> Poised Single-Katana Parry Guard + Reactive Single-Blade Slashes!
      leftArm.position.set(-0.195, -0.142, -0.38);
      leftArm.rotation.set(0.30, 0.36, 0.48);
      sayaScabbard.visible = true;
      sayaScabbard.rotation.set(-0.38, 0.20, -0.88);

      if (deflectIntroT > 0) {
        // Dramatic Upward-Diagonal Iai Draw-Slash from left-hip Saya across center screen to upper-right guard!
        const p = clamp01(1 - deflectIntroT / 0.24);
        const whip = 1 - Math.pow(1 - p, 3);
        dragonKatana.position.set(
          -0.22 + whip * 0.38,
          -0.22 + Math.sin(p * Math.PI * 0.85) * 0.12,
          -0.48 - Math.sin(p * Math.PI) * 0.06
        );
        dragonKatana.rotation.set(
          -0.76 + whip * 0.28,
          0.62 - whip * 0.40,
          -0.88 + whip * 1.44
        );
      } else if (deflectParryT > 0) {
        // Reactive Single-Blade Parry Slash snapping across screen on every deflected bullet!
        const pp = clamp01(1 - deflectParryT / 0.16);
        const snap = Math.sin(pp * Math.PI);
        const side = parryHandSide;
        dragonKatana.position.set(
          0.12 - side * snap * 0.24,
          -0.19 + snap * 0.05,
          -0.48 - snap * 0.06
        );
        dragonKatana.rotation.set(
          -0.48 + snap * 0.18,
          0.22 + side * snap * 0.65,
          0.54 + side * snap * 0.92
        );
      } else {
        // Poised Single-Katana `心眼` Deflect Guard weaving tight figure-8 defensive arcs across center-right screen!
        const w = clockT * 14.5;
        dragonKatana.position.set(
          0.16 + Math.cos(w) * 0.055,
          -0.195 + Math.sin(w * 2) * 0.022,
          -0.48 - deflectPulse * 0.04
        );
        dragonKatana.rotation.set(
          -0.48 + Math.sin(w * 1.5) * 0.14,
          0.22 - Math.cos(w) * 0.28,
          0.56 + Math.sin(w) * 0.38
        );
      }

      deflectArc1.rotation.z = clockT * 18;
      deflectArc1.rotation.x = Math.sin(clockT * 8) * 0.18;
      deflectArc2.rotation.z = -clockT * 22;
      deflectArc2.rotation.y = Math.cos(clockT * 9) * 0.20;
      deflectArc3.visible = deflectParryT > 0;
      if (deflectParryT > 0) {
        const pp = 1 - deflectParryT / 0.16;
        deflectArc3.rotation.z = parryHandSide * (0.4 + pp * 2.4);
        deflectArc3.scale.setScalar(0.82 + pp * 0.55);
      }
      deflectVfxGroup.scale.setScalar(1 + deflectPulse * 0.16);
    } else if (meleeTimer > 0 && !isDragon) {
      // `V` Quick Melee: Fast Single-Katana Iai Draw-Slash (`拔刀速斩`)!
      const mp = clamp01(1 - meleeTimer / 0.32);
      const whip = Math.sin(mp * Math.PI);
      leftArm.position.set(-0.19, -0.14, -0.38);
      leftArm.rotation.set(0.30, 0.35, 0.46);
      sayaScabbard.visible = true;
      sayaScabbard.rotation.set(-0.38, 0.20, -0.90);
      dragonKatana.position.set(-0.24 + mp * 0.50, -0.20 + whip * 0.09, -0.48 - whip * 0.06);
      dragonKatana.rotation.set(-0.62 + mp * 0.18, 0.54 - mp * 0.96, -0.78 + mp * 1.65);
    } else if (dragonUnsheatheT > 0) {
      const up = clamp01(1 - dragonUnsheatheT / 0.32);
      const ease = 1 - Math.pow(1 - up, 3);
      leftArm.position.set(-0.19 + ease * 0.012, -0.14 + ease * 0.018, -0.38);
      leftArm.rotation.set(0.28, 0.40 - ease * 0.08, 0.50 - ease * 0.08);
      sayaScabbard.visible = true;
      sayaScabbard.rotation.set(-0.38, 0.22, -1.02 + ease * 0.24);

      dragonKatana.position.set(
        -0.22 + ease * 0.46,
        -0.22 + Math.sin(up * Math.PI) * 0.09 + ease * 0.01,
        -0.48 - Math.sin(up * Math.PI) * 0.05 - ease * 0.02
      );
      dragonKatana.rotation.set(
        -0.78 + ease * 0.22,
        0.66 - ease * 0.40,
        -0.84 + ease * 1.28
      );
    } else if (dragonSwingT > 0) {
      // Wide, Unmistakable Full-Screen Dragonblade Slash on EVERY LMB Attack (`右袈裟 -> 左逆袈裟 -> 横一文字`)!
      const sp = clamp01(1 - dragonSwingT / Math.max(0.22, stats.dragonbladeSlashInterval));
      let slashProg = 0;
      if (sp < 0.14) {
        slashProg = -(sp / 0.14) * 0.18;
      } else if (sp < 0.54) {
        const ap = (sp - 0.14) / 0.40;
        slashProg = -0.18 + (1 - Math.pow(1 - ap, 3)) * 1.28;
      } else {
        const rp = (sp - 0.54) / 0.46;
        slashProg = 1.10 - rp * 0.35;
      }

      const dir = dragonSwingSide;
      const isHoriz = dragonComboIdx === 2;
      const kx = dir * (0.28 - slashProg * 0.54);
      const ky = isHoriz
        ? -0.19 + Math.sin(Math.max(0, slashProg) * Math.PI) * 0.035
        : -0.15 - slashProg * 0.09;
      const kz = -0.49 - Math.sin(clamp01(slashProg) * Math.PI) * 0.08;

      dragonKatana.position.set(kx, ky, kz);
      dragonKatana.rotation.set(
        isHoriz ? -0.46 : -0.56 + slashProg * 0.24,
        dir * (0.22 + slashProg * 0.62),
        isHoriz ? dir * (1.28 - slashProg * 0.85) : dir * (0.34 + slashProg * 1.12)
      );
      leftArm.position.set(-0.185, -0.135, -0.39);
      leftArm.rotation.set(0.28, 0.32, 0.42);
    } else {
      // Poised `Q` Dragonblade Ready Stance: Unsheathed `龙丸` blade & emerald dragon coils prominently framed diagonally across viewport!
      const kx = 0.24 + bobX + spSwayX.x * 0.35;
      const ky = -0.21 + bobY + Math.sin(clockT * 3.5) * 0.007;
      dragonKatana.position.set(kx, ky, -0.50);
      dragonKatana.rotation.set(-0.56 + spSwayY.x * 0.40, 0.26 + spSwayX.x * 0.40, 0.44);
      leftArm.position.set(-0.178 - bobX * 0.7, -0.128 + bobY * 0.8, -0.38);
      leftArm.rotation.set(0.28, 0.32, 0.42);
      sayaScabbard.visible = true;
      sayaScabbard.rotation.set(-0.34, 0.22, -0.78);
    }

    if (viewSlashT > 0) {
      viewSlashArc.visible = true;
      const slashProg = clamp01(1 - viewSlashT / 0.30);
      viewSlashUniforms.uProgress.value = slashProg;
      viewSlashArc.rotation.z = viewSlashRoll + slashProg * 0.85;
      const s = 0.92 + slashProg * 0.48;
      viewSlashArc.scale.setScalar(s);
    } else {
      viewSlashArc.visible = false;
    }

    // Update Live 3D Wind-Sight Trajectory Impact Preview (`Center + Fan` landing pips during active throws/aiming only!)
    const activelyAimingOrThrowing =
      fireCooldown > 0 || burstQueue > 0 || input.fire || input.ads || tFireHeld;
    const showAimPreview =
      activelyAimingOrThrowing &&
      root.visible &&
      player &&
      player.alive &&
      player.enabled &&
      !isDragon &&
      !isDeflect &&
      reloadTimer <= 0 &&
      ammo > 0;
    if (showAimPreview) {
      const cam = G.camera;
      _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      const fanCount = Math.min(MAX_AIM_PREVIEWS, Math.max(3, stats.shurikenPerVolley));
      const angles = computeShurikenFanAngles(fanCount, stats.fanSpreadRad);
      let pipCount = 0;
      for (let i = 0; i < angles.length && pipCount < MAX_AIM_PREVIEWS; i++) {
        const ang = angles[i];
        _q1.setFromAxisAngle(_up, -ang);
        _v4.copy(_fwd).applyQuaternion(_q1).normalize();
        const hit = computeRayImpactPoint(cam.position, _v4, 85, _v2);
        if (!hit.hitSurface) continue;
        const isCenter = Math.abs(ang) < 1e-4;
        _v5.copy(hit.point).addScaledVector(_v4, -0.05);
        const pScale = Math.min(0.45, computeProjectileVisualScale(hit.dist, isCenter ? 0.24 : 0.16));
        _scale.setScalar(pScale);
        _mat4.compose(_v5, cam.quaternion, _scale);
        aimPreviewMesh.setMatrixAt(pipCount++, _mat4);
      }
      if (pipCount > 0 || aimPreviewMesh.count > 0) {
        aimPreviewMesh.count = pipCount;
        aimPreviewMesh.instanceMatrix.needsUpdate = true;
      }
    } else if (aimPreviewMesh.count > 0) {
      aimPreviewMesh.count = 0;
      aimPreviewMesh.instanceMatrix.needsUpdate = true;
    }
  }

  function clearProjectiles() {
    for (const s of shurikenPool) {
      s.active = false;
      s.impactResolved = false;
    }
    shurikenInstMesh.count = 0;
    shurikenInstMesh.instanceMatrix.needsUpdate = true;
    shurikenHaloMesh.count = 0;
    shurikenHaloMesh.instanceMatrix.needsUpdate = true;
    shurikenTrailMesh.count = 0;
    shurikenTrailMesh.instanceMatrix.needsUpdate = true;
    aimPreviewMesh.count = 0;
    aimPreviewMesh.instanceMatrix.needsUpdate = true;

    for (const w of wavePool) {
      w.active = false;
      w.mesh.visible = false;
    }
    for (const b of beamPool) {
      b.active = false;
      b.mesh.visible = false;
    }
    for (const r of parryRings) {
      r.active = false;
      r.mesh.visible = false;
    }
    for (const sp of sparkPool) sp.active = false;
    sparkInstMesh.count = 0;
    sparkInstMesh.instanceMatrix.needsUpdate = true;
  }

  function reset() {
    const stats = cb.getStats();
    magSize = stats.magSize;
    ammo = magSize;
    state = 'idle';
    fireCooldown = 0;
    burstQueue = 0;
    burstTimer = 0;
    reloadTimer = 0;
    meleeTimer = 0;
    dragonUnsheatheT = 0;
    dragonSheatheT = 0;
    dragonSwingT = 0;
    dragonManifestT = 0;
    wasDragonActive = false;
    wasDeflectActive = false;
    deflectIntroT = 0;
    deflectOutroT = 0;
    deflectParryT = 0;
    dragonSpirit.visible = false;
    dragonCastRing.visible = false;
    activeBleeds.clear();
    clearProjectiles();
  }

  const api = {
    name: '风魔手里剑 · 龙丸',
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
    spread: 0.005,
    damage: 34,
    rpm: 420,
    root,
    update(dt: number) {
      updateViewmodel(dt);
      updateWorldProjectiles(dt, false);
    },
    updateVisualsOnly(dt: number) {
      clockT += dt;
      spiritDragonUniforms.uTime.value = clockT;
      deflectShaderUniforms.uTime.value = clockT;
      updateWorldProjectiles(dt, true);
    },
    clearProjectiles,
    getActiveProjectileCount() {
      return shurikenInstMesh.count;
    },
    reset,
    setVisible(v: boolean) {
      root.visible = !!v;
      if (!v && aimPreviewMesh.count > 0) {
        aimPreviewMesh.count = 0;
        aimPreviewMesh.instanceMatrix.needsUpdate = true;
      }
    },
    onEquip() {
      rawMouseLatched.clear();
      reloadTimer = 0;
      meleeTimer = 0;
      burstQueue = 0;
      throwAnimT = 0;
      dragonUnsheatheT = 0;
      dragonSheatheT = 0;
      dragonSwingT = 0;
      deflectIntroT = 0;
      deflectOutroT = 0;
      deflectParryT = 0;
      viewSlashT = 0;
      wasDragonActive = cb.isDragonblade();
      wasDeflectActive = cb.isDeflecting();
      state = 'idle';
      spKickZ.x = spKickZ.v = 0;
      spKickPitch.x = spKickPitch.v = 0;
      spKickYaw.x = spKickYaw.v = 0;
      spSwayX.x = spSwayX.v = 0;
      spSwayY.x = spSwayY.v = 0;
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
    onDeflectParry(worldPoint?: any) {
      deflectPulse = 1.0;
      deflectParryT = 0.16;
      parryHandSide *= -1;
      viewSlashT = 0.16;
      viewSlashRoll = parryHandSide > 0 ? 0.36 : 2.78;
      spKickZ.v += 1.25;
      spKickPitch.v += 0.52;
      spKickYaw.v += parryHandSide * 0.88;
      if (worldPoint) {
        G.camera.updateMatrixWorld();
        _v1.set(parryHandSide * 0.24, -0.06, 0).applyQuaternion(G.camera.quaternion).add(worldPoint);
        spawnParryBurst(_v1, false);
      }
      cb.onParryFeedback?.();
    },
    triggerDeflectDrawSlash,
    performDragonbladeSlash,
    spawnParryBurst,
    onCastDragonblade() {
      summonDragonManifestation();
    },
    spawnDashRibbon(start: any, end: any, wide = false) {
      spawnBeam(start, end, wide ? 0.55 : 0.42, wide ? 3.2 : 2.2);
    },
    spawnHomingKunai(origin: any, count: number, damage: number) {
      const stats = cb.getStats();
      for (let i = 0; i < count; i++) {
        const ang = (i / Math.max(1, count)) * Math.PI * 2;
        _v1.set(Math.cos(ang) * 0.65, 0.25 + (i % 2) * 0.2, Math.sin(ang) * 0.65).normalize();
        spawnSingleShuriken(origin, _v1, stats, true, damage, 0.12, 55);
      }
    },
    spawnShockwaveSlash(damage: number) {
      spawnCrescentWave(damage, 16, 0, 1.55);
      viewSlashT = 0.26;
      viewSlashRoll = 0.12;
    },
    getBladeDiagnostics() {
      const st = computeGenjiSingleBladeState({
        isDragonblade: cb.isDragonblade(),
        dragonSheatheT,
        isDeflect: cb.isDeflecting(),
        deflectOutroT,
        meleeTimer,
      });
      return {
        totalBladeMeshes: 1,
        visibleBladeCount: dragonKatana.visible ? 1 : 0,
        visibleBladeMeshes: dragonKatana.visible ? 1 : 0,
        dragonKatanaVisible: dragonKatana.visible,
        sayaVisible: sayaScabbard.visible,
        dragonSwingT,
        deflectIntroT,
        viewSlashT,
        mode: st.mode,
      };
    },
    getPoolDiagnostics() {
      return {
        shurikenCap: MAX_SHURIKENS,
        shurikenActive: shurikenInstMesh.count,
        waveCap: MAX_WAVES,
        beamCap: MAX_BEAMS,
        sparkCap: MAX_PARRY_SPARKS,
        sparkActive: sparkInstMesh.count,
      };
    },
  };

  reset();
  return api;
}
