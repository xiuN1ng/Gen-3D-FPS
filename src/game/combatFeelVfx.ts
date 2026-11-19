import * as THREE from 'three';

export interface InstancedBatchSpec {
  name: string;
  meshes: THREE.InstancedMesh[];
  getActiveCount: () => number;
  legacyMeshesPerItem: number;
  eliminatedSceneMeshes?: number;
  eliminatedShaderMaterials?: number;
}

export interface CombatBatchingSnapshot {
  registeredBatches: number;
  activeInstances: number;
  instancedDrawCalls: number;
  unbatchedDrawCalls: number;
  savedDrawCalls: number;
  peakSavedDrawCalls: number;
  eliminatedSceneMeshes: number;
  eliminatedShaderMaterials: number;
  activeCritFlares: number;
  activeHitStreaks: number;
  activeHitCoronas: number;
  weakspotConfirmCount: number;
  killBurstCount: number;
}

export interface TriggerImpactFeelOptions {
  point: { x: number; y: number; z: number };
  dir?: { x: number; y: number; z: number } | null;
  enemy?: any;
  weak?: boolean;
  killed?: boolean;
  heavy?: boolean;
  colorHex?: number;
}

export interface CombatFeelVfxController {
  readonly root: THREE.Group;
  readonly critFlareMesh: THREE.InstancedMesh;
  readonly hitStreakMesh: THREE.InstancedMesh;
  readonly hitCoronaMesh: THREE.InstancedMesh;
  registerBatch: (spec: InstancedBatchSpec) => void;
  triggerImpact: (opts: TriggerImpactFeelOptions) => void;
  notifyHitstop: (durationSec: number) => void;
  getHitstopVisualScale: (remainingSec: number) => number;
  getCameraRollOffset: () => number;
  update: (dt: number) => void;
  sampleTelemetry: () => CombatBatchingSnapshot;
  reset: () => void;
  dispose: () => void;
}

const MAX_CRIT_FLARES = 48;
const MAX_HIT_STREAKS = 160;
const MAX_HIT_CORONAS = 32;

/**
 * Pure asymmetric hitstop visual time-dilation curve:
 * - Holds crisp 0.08x impact freeze through the opening 65% of the hitstop window.
 * - Smoothly ramps from 0.08x -> 0.86x over the final 35% recovery tail so heavy hits
 *   feel weighty and snappy without jarring binary frame-stutter.
 */
export function computeHitstopDilation(remainingSec: number, totalSec: number): number {
  if (remainingSec <= 0 || totalSec <= 1e-5) return 1.0;
  const elapsedRatio = Math.min(1, Math.max(0, 1 - remainingSec / totalSec));
  if (elapsedRatio < 0.65) {
    return 0.08;
  }
  const tailT = (elapsedRatio - 0.65) / 0.35;
  const smooth = tailT * tailT * (3 - 2 * tailT);
  return 0.08 + smooth * 0.78;
}

export function createCombatFeelVfx(rawG: Record<string, any>): CombatFeelVfxController {
  const G = rawG || {};
  const root = new THREE.Group();
  root.name = 'combat-feel-instanced-vfx';
  if (G.scene && typeof G.scene.add === 'function') {
    G.scene.add(root);
  }

  const uClock = { value: 0 };

  // =========================================================================
  // 1. GPU-INSTANCED CRIT / WEAKSPOT STAR-FLARES (`MAX_CRIT_FLARES = 48`, 1 DC)
  // =========================================================================
  const flareGeo = new THREE.PlaneGeometry(1, 1);
  const flareInstData = new Float32Array(MAX_CRIT_FLARES * 4);
  const flareInstAttr = new THREE.InstancedBufferAttribute(flareInstData, 4);
  flareInstAttr.setUsage(THREE.DynamicDrawUsage);
  flareGeo.setAttribute('aInstData', flareInstAttr);

  const flareShaderMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uClock,
    },
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
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vProgress;
      void main() {
        float r = length(vUv);
        if (r > 1.0) discard;
        float ang = atan(vUv.y, vUv.x);
        float starMain = pow(abs(cos(ang * 2.0)), 16.0) * smoothstep(1.0, 0.04, r);
        float starDiag = pow(abs(cos((ang + 0.785398) * 2.0)), 20.0) * smoothstep(0.76, 0.04, r) * 0.65;
        float ringR = mix(0.18, 0.88, vProgress);
        float shockRing = exp(-pow((r - ringR) * 10.5, 2.0)) * (1.0 - smoothstep(0.45, 1.0, vProgress));
        float pinCore = exp(-r * r * 26.0) * (1.0 - vProgress * 0.72);
        float fade = 1.0 - smoothstep(0.32, 1.0, vProgress);
        float a = clamp((starMain * 0.92 + starDiag + shockRing * 0.85 + pinCore) * fade, 0.0, 0.96) * smoothstep(1.0, 0.82, r);
        if (a < 0.012) discard;
        vec3 hotCol = mix(vColor, vec3(1.0, 0.98, 0.90), clamp(pinCore * 1.25 + starMain * 0.45, 0.0, 1.0));
        gl_FragColor = vec4(hotCol * 2.45, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const critFlareMesh = new THREE.InstancedMesh(flareGeo, flareShaderMat, MAX_CRIT_FLARES);
  critFlareMesh.frustumCulled = false;
  critFlareMesh.castShadow = false;
  critFlareMesh.receiveShadow = false;
  critFlareMesh.count = 0;
  critFlareMesh.visible = false;
  critFlareMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(critFlareMesh);

  // SoA state for crit flares (zero-GC)
  const flareActive = new Uint8Array(MAX_CRIT_FLARES);
  const flarePosX = new Float32Array(MAX_CRIT_FLARES);
  const flarePosY = new Float32Array(MAX_CRIT_FLARES);
  const flarePosZ = new Float32Array(MAX_CRIT_FLARES);
  const flareLife = new Float32Array(MAX_CRIT_FLARES);
  const flareMaxLife = new Float32Array(MAX_CRIT_FLARES);
  const flareMaxScale = new Float32Array(MAX_CRIT_FLARES);
  const flareRoll = new Float32Array(MAX_CRIT_FLARES);
  const flareColR = new Float32Array(MAX_CRIT_FLARES);
  const flareColG = new Float32Array(MAX_CRIT_FLARES);
  const flareColB = new Float32Array(MAX_CRIT_FLARES);
  let flareCursor = 0;

  // =========================================================================
  // 2. GPU-INSTANCED DIRECTIONAL HIT / SLASH STREAKS (`MAX_HIT_STREAKS = 160`, 1 DC)
  // =========================================================================
  const streakGeo = new THREE.OctahedronGeometry(0.018, 0);
  streakGeo.scale(0.46, 0.46, 4.1);
  const streakMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });

  const hitStreakMesh = new THREE.InstancedMesh(streakGeo, streakMat, MAX_HIT_STREAKS);
  hitStreakMesh.frustumCulled = false;
  hitStreakMesh.castShadow = false;
  hitStreakMesh.receiveShadow = false;
  hitStreakMesh.count = 0;
  hitStreakMesh.visible = false;
  hitStreakMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Pre-allocate instanceColor buffer up front so zero lazy allocation happens mid-combat
  const streakColorBuf = new Float32Array(MAX_HIT_STREAKS * 3);
  hitStreakMesh.instanceColor = new THREE.InstancedBufferAttribute(streakColorBuf, 3);
  hitStreakMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  root.add(hitStreakMesh);

  const streakActive = new Uint8Array(MAX_HIT_STREAKS);
  const streakPosX = new Float32Array(MAX_HIT_STREAKS);
  const streakPosY = new Float32Array(MAX_HIT_STREAKS);
  const streakPosZ = new Float32Array(MAX_HIT_STREAKS);
  const streakVelX = new Float32Array(MAX_HIT_STREAKS);
  const streakVelY = new Float32Array(MAX_HIT_STREAKS);
  const streakVelZ = new Float32Array(MAX_HIT_STREAKS);
  const streakLife = new Float32Array(MAX_HIT_STREAKS);
  const streakMaxLife = new Float32Array(MAX_HIT_STREAKS);
  const streakScale = new Float32Array(MAX_HIT_STREAKS);
  const streakColR = new Float32Array(MAX_HIT_STREAKS);
  const streakColG = new Float32Array(MAX_HIT_STREAKS);
  const streakColB = new Float32Array(MAX_HIT_STREAKS);
  let streakCursor = 0;

  // =========================================================================
  // 3. GPU-INSTANCED ENEMY HIT-FLASH RIM CORONA (`MAX_HIT_CORONAS = 32`, 1 DC)
  //    Zero mutation of shared EnemyPbrSuite materials!
  // =========================================================================
  const coronaGeo = new THREE.SphereGeometry(0.62, 12, 10);
  const coronaInstData = new Float32Array(MAX_HIT_CORONAS * 4);
  const coronaInstAttr = new THREE.InstancedBufferAttribute(coronaInstData, 4);
  coronaInstAttr.setUsage(THREE.DynamicDrawUsage);
  coronaGeo.setAttribute('aInstData', coronaInstAttr);

  const coronaShaderMat = new THREE.ShaderMaterial({
    vertexShader: `
      attribute vec4 aInstData;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aInstData.xyz;
        vAlpha = aInstData.w;
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
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float ndv = clamp(abs(dot(normalize(vNormalV), normalize(vViewDir))), 0.0, 1.0);
        float rim = pow(1.0 - ndv, 1.85);
        float core = pow(ndv, 2.2) * 0.28;
        float a = clamp((rim * 0.92 + core) * vAlpha, 0.0, 0.88);
        if (a < 0.012) discard;
        vec3 col = mix(vColor, vec3(1.0, 0.98, 0.92), rim * 0.55);
        gl_FragColor = vec4(col * 2.2, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    toneMapped: false,
  });

  const hitCoronaMesh = new THREE.InstancedMesh(coronaGeo, coronaShaderMat, MAX_HIT_CORONAS);
  hitCoronaMesh.frustumCulled = false;
  hitCoronaMesh.castShadow = false;
  hitCoronaMesh.receiveShadow = false;
  hitCoronaMesh.count = 0;
  hitCoronaMesh.visible = false;
  hitCoronaMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(hitCoronaMesh);

  const coronaActive = new Uint8Array(MAX_HIT_CORONAS);
  const coronaEnemyRef: any[] = new Array(MAX_HIT_CORONAS).fill(null);
  const coronaPosX = new Float32Array(MAX_HIT_CORONAS);
  const coronaPosY = new Float32Array(MAX_HIT_CORONAS);
  const coronaPosZ = new Float32Array(MAX_HIT_CORONAS);
  const coronaOffsetY = new Float32Array(MAX_HIT_CORONAS);
  const coronaScaleX = new Float32Array(MAX_HIT_CORONAS);
  const coronaScaleY = new Float32Array(MAX_HIT_CORONAS);
  const coronaLife = new Float32Array(MAX_HIT_CORONAS);
  const coronaMaxLife = new Float32Array(MAX_HIT_CORONAS);
  const coronaColR = new Float32Array(MAX_HIT_CORONAS);
  const coronaColG = new Float32Array(MAX_HIT_CORONAS);
  const coronaColB = new Float32Array(MAX_HIT_CORONAS);
  let coronaCursor = 0;

  // =========================================================================
  // 4. CAMERA MICRO-ROLL & HITSTOP FEEL STATE
  // =========================================================================
  let cameraRollOffset = 0;
  let cameraRollVel = 0;
  let rollAlternator = 1;
  let lastHitstopTotal = 0.04;

  let prngState = 0x9e3779b9;
  function fastRand(): number {
    prngState = (prngState + 0x6d2b79f5) | 0;
    let t = Math.imul(prngState ^ (prngState >>> 15), 1 | prngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Scratch math objects (zero per-frame allocations)
  const _pos = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _rollQuat = new THREE.Quaternion();
  const _scale = new THREE.Vector3();
  const _mat4 = new THREE.Matrix4();
  const _zPos = new THREE.Vector3(0, 0, 1);
  const _col = new THREE.Color();
  const _flashPos = new THREE.Vector3();

  // Telemetry state
  const registeredBatches: InstancedBatchSpec[] = [];
  const registeredNames = new Set<string>();
  let weakspotConfirmCount = 0;
  let killBurstCount = 0;
  let peakSavedDrawCalls = 0;
  let activeFlareCount = 0;
  let activeStreakCount = 0;
  let activeCoronaCount = 0;

  const snapshot: CombatBatchingSnapshot = {
    registeredBatches: 0,
    activeInstances: 0,
    instancedDrawCalls: 0,
    unbatchedDrawCalls: 0,
    savedDrawCalls: 0,
    peakSavedDrawCalls: 0,
    eliminatedSceneMeshes: 0,
    eliminatedShaderMaterials: 0,
    activeCritFlares: 0,
    activeHitStreaks: 0,
    activeHitCoronas: 0,
    weakspotConfirmCount: 0,
    killBurstCount: 0,
  };

  function registerBatch(spec: InstancedBatchSpec): void {
    if (registeredNames.has(spec.name)) {
      for (let i = 0; i < registeredBatches.length; i++) {
        if (registeredBatches[i].name === spec.name) {
          registeredBatches[i] = spec;
          return;
        }
      }
    }
    registeredNames.add(spec.name);
    registeredBatches.push(spec);
  }

  // Register our own 3 GPU-instanced combat-feel layers
  registerBatch({
    name: 'combat_crit_flares',
    meshes: [critFlareMesh],
    getActiveCount: () => activeFlareCount,
    legacyMeshesPerItem: 1,
    eliminatedSceneMeshes: 0,
  });
  registerBatch({
    name: 'combat_hit_streaks',
    meshes: [hitStreakMesh],
    getActiveCount: () => activeStreakCount,
    legacyMeshesPerItem: 1,
    eliminatedSceneMeshes: 0,
  });
  registerBatch({
    name: 'combat_hit_coronas',
    meshes: [hitCoronaMesh],
    getActiveCount: () => activeCoronaCount,
    legacyMeshesPerItem: 1,
    eliminatedSceneMeshes: 0,
  });

  function spawnCritFlare(
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number,
    maxScale: number,
    duration: number,
  ): void {
    let slot = -1;
    for (let i = 0; i < MAX_CRIT_FLARES; i++) {
      const idx = (flareCursor + i) % MAX_CRIT_FLARES;
      if (!flareActive[idx]) {
        slot = idx;
        flareCursor = (idx + 1) % MAX_CRIT_FLARES;
        break;
      }
    }
    if (slot < 0) {
      slot = flareCursor;
      flareCursor = (flareCursor + 1) % MAX_CRIT_FLARES;
    }
    flareActive[slot] = 1;
    flarePosX[slot] = x;
    flarePosY[slot] = y;
    flarePosZ[slot] = z;
    flareMaxLife[slot] = duration;
    flareLife[slot] = duration;
    flareMaxScale[slot] = maxScale;
    flareRoll[slot] = fastRand() * Math.PI;
    flareColR[slot] = r;
    flareColG[slot] = g;
    flareColB[slot] = b;
  }

  function spawnHitStreakBurst(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    count: number,
    r: number,
    g: number,
    b: number,
    speedBase: number,
    scaleMult: number,
  ): void {
    for (let k = 0; k < count; k++) {
      let slot = -1;
      for (let i = 0; i < MAX_HIT_STREAKS; i++) {
        const idx = (streakCursor + i) % MAX_HIT_STREAKS;
        if (!streakActive[idx]) {
          slot = idx;
          streakCursor = (idx + 1) % MAX_HIT_STREAKS;
          break;
        }
      }
      if (slot < 0) {
        slot = streakCursor;
        streakCursor = (streakCursor + 1) % MAX_HIT_STREAKS;
      }
      const theta = fastRand() * Math.PI * 2;
      const radial = (2.6 + fastRand() * 6.8) * speedBase;
      const reflect = -2.8 - fastRand() * 4.5;

      streakActive[slot] = 1;
      streakPosX[slot] = x;
      streakPosY[slot] = y;
      streakPosZ[slot] = z;
      streakVelX[slot] = dirX * reflect + Math.cos(theta) * radial;
      streakVelY[slot] = dirY * reflect + 1.4 + fastRand() * 4.4;
      streakVelZ[slot] = dirZ * reflect + Math.sin(theta) * radial;
      const dur = 0.11 + fastRand() * 0.11;
      streakMaxLife[slot] = dur;
      streakLife[slot] = dur;
      streakScale[slot] = scaleMult * (0.82 + fastRand() * 0.45);
      streakColR[slot] = r;
      streakColG[slot] = g;
      streakColB[slot] = b;
    }
  }

  function spawnEnemyHitCorona(
    enemy: any,
    fallbackX: number,
    fallbackY: number,
    fallbackZ: number,
    r: number,
    g: number,
    b: number,
    duration: number,
  ): void {
    let slot = -1;
    if (enemy) {
      for (let i = 0; i < MAX_HIT_CORONAS; i++) {
        if (coronaActive[i] && coronaEnemyRef[i] === enemy) {
          slot = i;
          break;
        }
      }
    }
    if (slot < 0) {
      for (let i = 0; i < MAX_HIT_CORONAS; i++) {
        const idx = (coronaCursor + i) % MAX_HIT_CORONAS;
        if (!coronaActive[idx]) {
          slot = idx;
          coronaCursor = (idx + 1) % MAX_HIT_CORONAS;
          break;
        }
      }
    }
    if (slot < 0) {
      slot = coronaCursor;
      coronaCursor = (coronaCursor + 1) % MAX_HIT_CORONAS;
    }

    const isGully = enemy && enemy.type === 'gull';
    const isHound = enemy && enemy.type === 'hound';
    const isBoss = enemy && enemy.__variant === 'boss';
    const isMech =
      enemy && (enemy.__variant === 'spider_mech' || enemy.__variant === 'mortar_crab');

    coronaActive[slot] = 1;
    coronaEnemyRef[slot] = enemy || null;
    coronaOffsetY[slot] = isGully ? 0.05 : isHound ? 0.58 : 0.96;
    coronaPosX[slot] = enemy && enemy.pos ? enemy.pos.x : fallbackX;
    coronaPosY[slot] =
      enemy && enemy.pos ? enemy.pos.y + coronaOffsetY[slot] : fallbackY;
    coronaPosZ[slot] = enemy && enemy.pos ? enemy.pos.z : fallbackZ;
    coronaScaleX[slot] = isBoss ? 1.48 : isMech ? 1.35 : isGully ? 0.72 : 0.92;
    coronaScaleY[slot] = isBoss ? 1.95 : isMech ? 1.15 : isGully ? 0.68 : isHound ? 0.85 : 1.42;
    coronaMaxLife[slot] = duration;
    coronaLife[slot] = duration;
    coronaColR[slot] = r;
    coronaColG[slot] = g;
    coronaColB[slot] = b;
  }

  function triggerImpact(opts: TriggerImpactFeelOptions): void {
    const pt = opts.point;
    const dx = opts.dir ? opts.dir.x : 0;
    const dy = opts.dir ? opts.dir.y : 0;
    const dz = opts.dir ? opts.dir.z : -1;
    const isWeak = !!opts.weak;
    const isKilled = !!opts.killed;
    const isHeavy = !!opts.heavy;

    if (opts.colorHex !== undefined) {
      _col.setHex(opts.colorHex);
    } else if (isKilled && isWeak) {
      _col.setHex(0xffe066);
    } else if (isWeak) {
      _col.setHex(0xffc940);
    } else if (isKilled) {
      _col.setHex(0xff5238);
    } else {
      _col.setHex(0x6cf0ff);
    }

    const cr = _col.r;
    const cg = _col.g;
    const cb = _col.b;

    if (isWeak) weakspotConfirmCount++;
    if (isKilled) killBurstCount++;

    if (isWeak || isKilled || isHeavy) {
      const flareScale = isKilled
        ? isWeak
          ? 2.35
          : 1.95
        : isWeak
          ? 1.65
          : 1.35;
      const flareDur = isKilled ? 0.22 : 0.16;
      spawnCritFlare(pt.x, pt.y, pt.z, cr, cg, cb, flareScale, flareDur);

      // Tactile non-disruptive Z-roll camera impulse
      rollAlternator = -rollAlternator;
      const impulse = (isKilled ? 0.16 : isWeak ? 0.10 : 0.07) * rollAlternator;
      cameraRollVel = Math.max(-0.32, Math.min(0.32, cameraRollVel + impulse));

      if (G.render && G.render.lightPool && typeof G.render.lightPool.flash === 'function') {
        _flashPos.set(pt.x, pt.y, pt.z);
        G.render.lightPool.flash(
          _flashPos,
          isWeak ? 0xffd24c : 0xff5838,
          isKilled ? 34 : 22,
          isKilled ? 6.8 : 4.6,
          isKilled ? 0.085 : 0.055,
        );
      }
    }

    const streakCount = isKilled ? 14 : isWeak ? 10 : 5;
    const speedMult = isKilled ? 1.25 : isWeak ? 1.12 : 0.85;
    const scaleMult = isKilled ? 1.35 : isWeak ? 1.2 : 0.92;
    spawnHitStreakBurst(
      pt.x,
      pt.y,
      pt.z,
      dx,
      dy,
      dz,
      streakCount,
      cr,
      cg,
      cb,
      speedMult,
      scaleMult,
    );

    if (opts.enemy) {
      spawnEnemyHitCorona(
        opts.enemy,
        pt.x,
        pt.y,
        pt.z,
        cr,
        cg,
        cb,
        isKilled ? 0.12 : isWeak ? 0.095 : 0.07,
      );
    }
  }

  function notifyHitstop(durationSec: number): void {
    if (durationSec > 0.005) {
      lastHitstopTotal = Math.max(durationSec, 0.015);
    }
  }

  function getHitstopVisualScale(remainingSec: number): number {
    return computeHitstopDilation(remainingSec, lastHitstopTotal);
  }

  function getCameraRollOffset(): number {
    return cameraRollOffset;
  }

  // Subscribe to global combat events if G.events is available
  const unsubscribes: Array<() => void> = [];
  if (G.events && typeof G.events.on === 'function') {
    const offHitEnemy = G.events.on('player:hitEnemy', (payload: any) => {
      if (!payload) return;
      const en = payload.enemy;
      const isWeak = !!(payload.weak || payload.part === 'weak' || payload.part === 'head');
      const isKilled = !!payload.killed;
      let px = 0;
      let py = 1.0;
      let pz = 0;
      if (payload.point && Number.isFinite(payload.point.x)) {
        px = payload.point.x;
        py = payload.point.y;
        pz = payload.point.z;
      } else if (isWeak && en && en.headPos && Number.isFinite(en.headPos.x)) {
        px = en.headPos.x;
        py = en.headPos.y;
        pz = en.headPos.z;
      } else if (en && en.pos && Number.isFinite(en.pos.x)) {
        px = en.pos.x;
        py = en.pos.y + (en.type === 'gull' ? 0.1 : en.type === 'hound' ? 0.62 : 1.15);
        pz = en.pos.z;
      } else {
        return;
      }

      let dx = 0;
      let dy = 0;
      let dz = -1;
      if (G.player && G.player.forward) {
        dx = G.player.forward.x;
        dy = G.player.forward.y;
        dz = G.player.forward.z;
      }
      _pos.set(px, py, pz);
      _dir.set(dx, dy, dz);
      triggerImpact({
        point: _pos,
        dir: _dir,
        enemy: en,
        weak: isWeak,
        killed: isKilled,
      });
    });
    if (typeof offHitEnemy === 'function') unsubscribes.push(offHitEnemy);
  }

  function update(dt: number): void {
    if (dt <= 0) return;
    const clampedDt = Math.min(dt, 0.05);
    uClock.value += clampedDt;

    // Spring-damper camera micro-roll recovery (critically damped ~24 rad/s)
    const springK = 420;
    const springC = 36;
    cameraRollVel += (-cameraRollOffset * springK - cameraRollVel * springC) * clampedDt;
    cameraRollOffset += cameraRollVel * clampedDt;
    if (Math.abs(cameraRollOffset) < 1e-5 && Math.abs(cameraRollVel) < 1e-4) {
      cameraRollOffset = 0;
      cameraRollVel = 0;
    }

    const camQuat = G.camera && G.camera.quaternion ? G.camera.quaternion : null;

    // 1. Update Crit Flares -> pack active into [0..fIdx-1]
    let fIdx = 0;
    for (let i = 0; i < MAX_CRIT_FLARES; i++) {
      if (!flareActive[i]) continue;
      const nextLife = flareLife[i] - clampedDt;
      if (nextLife <= 0) {
        flareActive[i] = 0;
        continue;
      }
      flareLife[i] = nextLife;
      const progress = 1 - nextLife / flareMaxLife[i];
      const curScale = 0.22 + progress * flareMaxScale[i];

      _pos.set(flarePosX[i], flarePosY[i], flarePosZ[i]);
      if (camQuat) {
        _quat.copy(camQuat);
      } else {
        _quat.identity();
      }
      _rollQuat.setFromAxisAngle(_zPos, flareRoll[i] + progress * 0.45);
      _quat.multiply(_rollQuat);
      _scale.set(curScale, curScale, curScale);
      _mat4.compose(_pos, _quat, _scale);
      critFlareMesh.setMatrixAt(fIdx, _mat4);

      const d4 = fIdx * 4;
      flareInstData[d4] = flareColR[i];
      flareInstData[d4 + 1] = flareColG[i];
      flareInstData[d4 + 2] = flareColB[i];
      flareInstData[d4 + 3] = progress;
      fIdx++;
    }
    activeFlareCount = fIdx;
    if (critFlareMesh.count !== fIdx || fIdx > 0) {
      critFlareMesh.count = fIdx;
      critFlareMesh.visible = fIdx > 0;
      if (fIdx > 0) {
        critFlareMesh.instanceMatrix.needsUpdate = true;
        flareInstAttr.needsUpdate = true;
      }
    }

    // 2. Update Directional Hit Streaks -> pack active into [0..sIdx-1]
    let sIdx = 0;
    for (let i = 0; i < MAX_HIT_STREAKS; i++) {
      if (!streakActive[i]) continue;
      const nextLife = streakLife[i] - clampedDt;
      if (nextLife <= 0) {
        streakActive[i] = 0;
        continue;
      }
      streakLife[i] = nextLife;

      const vy = streakVelY[i] - 18.5 * clampedDt;
      const drag = Math.exp(-3.2 * clampedDt);
      const vx = streakVelX[i] * drag;
      const vz = streakVelZ[i] * drag;
      streakVelX[i] = vx;
      streakVelY[i] = vy;
      streakVelZ[i] = vz;

      const px = streakPosX[i] + vx * clampedDt;
      const py = streakPosY[i] + vy * clampedDt;
      const pz = streakPosZ[i] + vz * clampedDt;
      streakPosX[i] = px;
      streakPosY[i] = py;
      streakPosZ[i] = pz;

      const fade = nextLife / streakMaxLife[i];
      const sc = streakScale[i] * fade;

      _pos.set(px, py, pz);
      _dir.set(vx, vy, vz);
      if (_dir.lengthSq() > 1e-5) {
        _dir.normalize();
        _quat.setFromUnitVectors(_zPos, _dir);
      } else {
        _quat.identity();
      }
      _scale.set(Math.max(0.05, sc), Math.max(0.05, sc), Math.max(0.08, sc * (0.9 + fade * 0.9)));
      _mat4.compose(_pos, _quat, _scale);
      hitStreakMesh.setMatrixAt(sIdx, _mat4);

      const c3 = sIdx * 3;
      streakColorBuf[c3] = streakColR[i] * 2.3;
      streakColorBuf[c3 + 1] = streakColG[i] * 2.3;
      streakColorBuf[c3 + 2] = streakColB[i] * 2.3;
      sIdx++;
    }
    activeStreakCount = sIdx;
    if (hitStreakMesh.count !== sIdx || sIdx > 0) {
      hitStreakMesh.count = sIdx;
      hitStreakMesh.visible = sIdx > 0;
      if (sIdx > 0) {
        hitStreakMesh.instanceMatrix.needsUpdate = true;
        if (hitStreakMesh.instanceColor) {
          hitStreakMesh.instanceColor.needsUpdate = true;
        }
      }
    }

    // 3. Update Per-Enemy 3D Hit-Flash Rim Coronas -> pack active into [0..cIdx-1]
    let cIdx = 0;
    for (let i = 0; i < MAX_HIT_CORONAS; i++) {
      if (!coronaActive[i]) continue;
      const nextLife = coronaLife[i] - clampedDt;
      if (nextLife <= 0) {
        coronaActive[i] = 0;
        coronaEnemyRef[i] = null;
        continue;
      }
      coronaLife[i] = nextLife;

      const en = coronaEnemyRef[i];
      if (en && en.active !== false && en.pos) {
        coronaPosX[i] = en.pos.x;
        coronaPosY[i] = en.pos.y + coronaOffsetY[i];
        coronaPosZ[i] = en.pos.z;
      }

      const fade = nextLife / coronaMaxLife[i];
      const pop = 1.0 + (1.0 - fade) * 0.16;
      _pos.set(coronaPosX[i], coronaPosY[i], coronaPosZ[i]);
      _quat.identity();
      _scale.set(coronaScaleX[i] * pop, coronaScaleY[i] * pop, coronaScaleX[i] * pop);
      _mat4.compose(_pos, _quat, _scale);
      hitCoronaMesh.setMatrixAt(cIdx, _mat4);

      const d4 = cIdx * 4;
      coronaInstData[d4] = coronaColR[i];
      coronaInstData[d4 + 1] = coronaColG[i];
      coronaInstData[d4 + 2] = coronaColB[i];
      coronaInstData[d4 + 3] = fade;
      cIdx++;
    }
    activeCoronaCount = cIdx;
    if (hitCoronaMesh.count !== cIdx || cIdx > 0) {
      hitCoronaMesh.count = cIdx;
      hitCoronaMesh.visible = cIdx > 0;
      if (cIdx > 0) {
        hitCoronaMesh.instanceMatrix.needsUpdate = true;
        coronaInstAttr.needsUpdate = true;
      }
    }
  }

  function sampleTelemetry(): CombatBatchingSnapshot {
    let activeInstances = 0;
    let instancedDrawCalls = 0;
    let unbatchedDrawCalls = 0;
    let eliminatedSceneMeshes = 0;
    let eliminatedShaderMaterials = 0;

    for (let i = 0; i < registeredBatches.length; i++) {
      const b = registeredBatches[i];
      eliminatedSceneMeshes += b.eliminatedSceneMeshes ?? 0;
      eliminatedShaderMaterials += b.eliminatedShaderMaterials ?? 0;

      const count = Math.max(0, b.getActiveCount() | 0);
      if (count > 0) {
        activeInstances += count;
        unbatchedDrawCalls += count * Math.max(1, b.legacyMeshesPerItem);
        let meshDc = 0;
        for (let m = 0; m < b.meshes.length; m++) {
          const im = b.meshes[m];
          if (im && im.count > 0 && im.visible !== false) {
            meshDc++;
          }
        }
        instancedDrawCalls += meshDc > 0 ? meshDc : b.meshes.length;
      }
    }

    const savedDrawCalls = Math.max(0, unbatchedDrawCalls - instancedDrawCalls);
    if (savedDrawCalls > peakSavedDrawCalls) {
      peakSavedDrawCalls = savedDrawCalls;
    }

    snapshot.registeredBatches = registeredBatches.length;
    snapshot.activeInstances = activeInstances;
    snapshot.instancedDrawCalls = instancedDrawCalls;
    snapshot.unbatchedDrawCalls = unbatchedDrawCalls;
    snapshot.savedDrawCalls = savedDrawCalls;
    snapshot.peakSavedDrawCalls = peakSavedDrawCalls;
    snapshot.eliminatedSceneMeshes = eliminatedSceneMeshes;
    snapshot.eliminatedShaderMaterials = eliminatedShaderMaterials;
    snapshot.activeCritFlares = activeFlareCount;
    snapshot.activeHitStreaks = activeStreakCount;
    snapshot.activeHitCoronas = activeCoronaCount;
    snapshot.weakspotConfirmCount = weakspotConfirmCount;
    snapshot.killBurstCount = killBurstCount;
    return snapshot;
  }

  function reset(): void {
    flareActive.fill(0);
    streakActive.fill(0);
    coronaActive.fill(0);
    coronaEnemyRef.fill(null);
    activeFlareCount = 0;
    activeStreakCount = 0;
    activeCoronaCount = 0;
    cameraRollOffset = 0;
    cameraRollVel = 0;
    critFlareMesh.count = 0;
    critFlareMesh.visible = false;
    hitStreakMesh.count = 0;
    hitStreakMesh.visible = false;
    hitCoronaMesh.count = 0;
    hitCoronaMesh.visible = false;
  }

  function dispose(): void {
    reset();
    for (let i = 0; i < unsubscribes.length; i++) {
      try {
        unsubscribes[i]();
      } catch {
        // ignore
      }
    }
    unsubscribes.length = 0;
    root.removeFromParent();
    flareGeo.dispose();
    flareShaderMat.dispose();
    streakGeo.dispose();
    streakMat.dispose();
    coronaGeo.dispose();
    coronaShaderMat.dispose();
  }

  return {
    root,
    critFlareMesh,
    hitStreakMesh,
    hitCoronaMesh,
    registerBatch,
    triggerImpact,
    notifyHitstop,
    getHitstopVisualScale,
    getCameraRollOffset,
    update,
    sampleTelemetry,
    reset,
    dispose,
  };
}
