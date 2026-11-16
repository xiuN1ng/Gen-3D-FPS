/**
 * Pure core rules, math, PRNG, IK, and A* navigation logic for Hanamura Vanguard.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface QualityPreset {
  name: 'test' | 'low' | 'medium' | 'high' | 'ultra';
  scale: number;
  msaa: number;
  shadow: number;
  tex: number;
  volSteps: number;
  ao: boolean;
  planar: number;
  bloom: boolean;
  motionBlur: boolean;
  rain: number;
}

export const QUALITY_PRESETS: Record<QualityPreset['name'], QualityPreset> = {
  test: { name: 'test', scale: 1, msaa: 0, shadow: 1024, tex: 256, volSteps: 10, ao: true, planar: 0.5, bloom: true, motionBlur: false, rain: 0.4 },
  low: { name: 'low', scale: 0.7, msaa: 0, shadow: 2048, tex: 512, volSteps: 12, ao: false, planar: 0, bloom: true, motionBlur: false, rain: 0.5 },
  medium: { name: 'medium', scale: 0.85, msaa: 2, shadow: 2048, tex: 1024, volSteps: 16, ao: true, planar: 0.5, bloom: true, motionBlur: false, rain: 0.8 },
  high: { name: 'high', scale: 1, msaa: 4, shadow: 4096, tex: 1024, volSteps: 24, ao: true, planar: 0.5, bloom: true, motionBlur: true, rain: 1 },
  ultra: { name: 'ultra', scale: 1, msaa: 4, shadow: 4096, tex: 2048, volSteps: 40, ao: true, planar: 1, bloom: true, motionBlur: true, rain: 1 },
};

export const COMPASS_DIRECTIONS_8 = ['北方', '东北方', '东方', '东南方', '南方', '西南方', '西方', '西北方'] as const;

export const DEBRIEF_RATINGS = ['险象环生', '火力全开', '稳扎稳打', '干净利落', '精准果断', '完美突击'] as const;

export function clamp(val: number, min: number, max: number): number {
  return val < min ? min : val > max ? max : val;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(val: number): number {
  return val < 0 ? 0 : val > 1 ? 1 : val;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export interface RngFn {
  (): number;
  range: (min: number, max: number) => number;
  int: (min: number, max: number) => number;
  pick: <T>(arr: readonly T[]) => T;
  sign: () => -1 | 1;
  fork: (offset?: number) => RngFn;
}

/**
 * Deterministic Mulberry32 PRNG (`il` in engine).
 */
export function createRng(seed = 1337): RngFn {
  let state = seed >>> 0 || 1;
  const next = (() => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as RngFn;

  next.range = (min: number, max: number) => min + (max - min) * next();
  next.int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  next.pick = <T>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)];
  next.sign = () => (next() < 0.5 ? -1 : 1);
  next.fork = (offset = 1) => createRng((state ^ Math.imul(offset + 1, 2654435761)) >>> 0);
  return next;
}

/**
 * Lightweight pub/sub event bus (`Dy` in engine).
 */
export function createEventBus() {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  return {
    on(event: string, fn: (payload: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
      return () => this.off(event, fn);
    },
    off(event: string, fn: (payload: unknown) => void) {
      const list = listeners.get(event);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    emit(event: string, payload?: unknown) {
      const list = listeners.get(event);
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        list[i](payload);
      }
    },
  };
}

/**
 * Selects quality preset based on explicit override, mobile heuristics, or WebGL renderer string (`zy` in engine).
 */
export function selectQualityPreset(
  requested?: string,
  userAgent = '',
  rendererString = '',
  maxTouchPoints = 0,
  minScreenDim = 1080
): QualityPreset {
  if (requested && requested in QUALITY_PRESETS) {
    return { ...QUALITY_PRESETS[requested as QualityPreset['name']] };
  }
  if (/Android|iPhone|iPad|Mobile/i.test(userAgent) || (maxTouchPoints > 1 && minScreenDim < 900)) {
    return { ...QUALITY_PRESETS.low };
  }
  const isIntegratedOrSoftware =
    /SwiftShader|llvmpipe|Software|Mali|Adreno|PowerVR/i.test(rendererString) ||
    (/Intel/i.test(rendererString) && !/Arc/i.test(rendererString));
  return { ...(isIntegratedOrSoftware ? QUALITY_PRESETS.medium : QUALITY_PRESETS.high) };
}

/**
 * Formats elapsed seconds as `MM:SS` (`O` in menu controller `pM`).
 */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Computes debrief accuracy and 6-tier tactical rating (`ee` in game controller `mM`).
 */
export function computeDebriefRating(params: {
  time: number;
  shots: number;
  hits: number;
  retries: number;
}): { accuracy: number | null; scoreIndex: number; rating: (typeof DEBRIEF_RATINGS)[number] } {
  const { time, shots, hits, retries } = params;
  const accuracy = shots > 0 ? clamp(hits / shots, 0, 1) : null;
  const timePts = time < 270 ? 2 : time < 400 ? 1 : 0;
  const accPts = accuracy !== null && accuracy >= 0.5 ? 2 : accuracy !== null && accuracy >= 0.3 ? 1 : 0;
  const retryPts = retries === 0 ? 1 : 0;
  const scoreIndex = clamp(timePts + accPts + retryPts, 0, DEBRIEF_RATINGS.length - 1);
  return {
    accuracy,
    scoreIndex,
    rating: DEBRIEF_RATINGS[scoreIndex],
  };
}

/**
 * Computes the 8-direction Chinese compass sector label for an enemy wave spawn offset (`F` in `mM`).
 */
export function computeWaveDirectionLabel(dx: number, dz: number): (typeof COMPASS_DIRECTIONS_8)[number] {
  const deg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  const idx = Math.round(deg / 45) % 8;
  return COMPASS_DIRECTIONS_8[idx];
}

/**
 * Analytical 2-bone Inverse Kinematics solver (`q_` in engine, used for quadruped robot legs & weapon hands).
 */
export function solveTwoBoneIK(
  root: Vec3Like,
  target: Vec3Like,
  pole: Vec3Like,
  len1: number,
  len2: number
): Vec3Like {
  let dx = target.x - root.x;
  let dy = target.y - root.y;
  let dz = target.z - root.z;
  const dist = Math.hypot(dx, dy, dz);
  const minReach = Math.abs(len1 - len2) + 1e-4;
  const maxReach = len1 + len2 - 1e-4;
  const clampedDist = clamp(dist, minReach, maxReach);

  if (dist > 1e-6) {
    dx /= dist;
    dy /= dist;
    dz /= dist;
  } else {
    dx = 0;
    dy = -1;
    dz = 0;
  }

  // Project pole vector perpendicular to root->target axis
  const dotPole = pole.x * dx + pole.y * dy + pole.z * dz;
  let px = pole.x - dx * dotPole;
  let py = pole.y - dy * dotPole;
  let pz = pole.z - dz * dotPole;
  const pLen = Math.hypot(px, py, pz);
  if (pLen > 1e-5) {
    px /= pLen;
    py /= pLen;
    pz /= pLen;
  } else {
    px = 1;
    py = 0;
    pz = 0;
  }

  const cosAngle = clamp(
    (len1 * len1 + clampedDist * clampedDist - len2 * len2) / (2 * len1 * clampedDist),
    -1,
    1
  );
  const sinAngle = Math.sqrt(Math.max(0, 1 - cosAngle * cosAngle));

  return {
    x: root.x + dx * (cosAngle * len1) + px * (sinAngle * len1),
    y: root.y + dy * (cosAngle * len1) + py * (sinAngle * len1),
    z: root.z + dz * (cosAngle * len1) + pz * (sinAngle * len1),
  };
}

export interface BipedalGaitPose {
  hipL: number;
  kneeL: number;
  ankleL: number;
  hipR: number;
  kneeR: number;
  ankleR: number;
  pelvisBob: number;
  pelvisRoll: number;
  torsoTwist: number;
}

/**
 * Computes procedural bipedal humanoid joint angles (hips, knees, ankles, pelvis bob/sway, torso counter-twist)
 * given a distance-synced gait phase (rad), normalized speed (0..1), and crouch factor (0..1).
 *
 * Biomechanical phase convention:
 * - `hipL = sin(phase) * strideAmp`:
 *   - `cos(phase) > 0` (`phase ∈ (-π/2, +π/2)`): forward swing phase (`d(hipL)/d(phase) > 0`) — knee flexes to clear ground!
 *   - `cos(phase) < 0` (`phase ∈ (+π/2, 3π/2)`): grounded stance push-off (`d(hipL)/d(phase) < 0`) — leg extended bearing weight!
 * - `pelvisBob`: 2x stride frequency (`cos(2 * phase)`), highest at mid-stance vault (`phase = 0, π`) and lowest at double-support (`phase = ±π/2`).
 */
export function computeBipedalGaitPose(phase: number, speedNorm: number, crouch = 0): BipedalGaitPose {
  const s = clamp01(speedNorm);
  const cr = clamp01(crouch);
  const strideAmp = 0.62 * s;
  const kneeAmp = 0.88 * s;
  const crouchHip = -0.52 * cr;
  const crouchKnee = 0.96 * cr;

  const sinL = Math.sin(phase);
  const sinR = Math.sin(phase + Math.PI);
  // Peak knee lift occurs during forward swing (`cos(phase - 0.18) > 0`), plus slight heel-strike cushion (`sin > 0`)
  const swingLiftL = Math.max(0, Math.cos(phase - 0.18));
  const swingLiftR = Math.max(0, Math.cos(phase + Math.PI - 0.18));
  const stanceCushionL = Math.max(0, Math.sin(phase - 0.85)) * 0.12;
  const stanceCushionR = Math.max(0, Math.sin(phase + Math.PI - 0.85)) * 0.12;

  const hipL = sinL * strideAmp + crouchHip;
  const hipR = sinR * strideAmp + crouchHip;
  const kneeL = (swingLiftL + stanceCushionL) * kneeAmp + crouchKnee + 0.06;
  const kneeR = (swingLiftR + stanceCushionR) * kneeAmp + crouchKnee + 0.06;

  // Toe push-off plantarflexion at end of stance (`sinL -> -1`) and dorsiflexion during forward swing
  const pushOffL = Math.max(0, -sinL) * 0.24 * s;
  const pushOffR = Math.max(0, -sinR) * 0.24 * s;
  const ankleL = -hipL * 0.32 - kneeL * 0.28 + pushOffL;
  const ankleR = -hipR * 0.32 - kneeR * 0.28 + pushOffR;

  const pelvisBob = (Math.cos(phase * 2) * 0.034 - 0.022) * s - cr * 0.26;
  const pelvisRoll = sinL * 0.046 * s;
  const torsoTwist = -sinL * 0.12 * s;

  return {
    hipL,
    kneeL,
    ankleL,
    hipR,
    kneeR,
    ankleR,
    pelvisBob,
    pelvisRoll,
    torsoTwist,
  };
}

export interface MultiLegJointPose {
  coxaYawDelta: number;
  femurLift: number;
  tibiaFlex: number;
  isGrounded: boolean;
}

/**
 * Computes anatomically grounded arthropod / multi-leg robot joint articulation for:
 * - `legCount === 4` (`spider_mech`): Diagonal trot gait (`FR + RL` vs `FL + RR`, `diagGroup ∈ {0, 1}`)
 * - `legCount === 6` (`mortar_crab`): Alternating hexapod tripod gait (`L0+R1+L2` vs `R0+L1+R2`, `group ∈ {0, 1}`)
 *
 * Uses a 62% grounded stance / 38% arched swing duty cycle so planted feet push linearly backward without
 * floating, and returns zero displacement when `moveIntensity` & `turnRateNorm` are zero (eliminating idle skating).
 */
export function computeMultiLegGaitPose(
  params: {
    phase: number;
    moveIntensity: number;
    turnRateNorm: number;
    groupIndex: 0 | 1;
    side: 1 | -1;
    strideYawAmp?: number;
    liftAmp?: number;
  },
  out?: MultiLegJointPose
): MultiLegJointPose {
  const res = out ?? { coxaYawDelta: 0, femurLift: 0, tibiaFlex: 0, isGrounded: true };
  const move = clamp01(params.moveIntensity);
  const turn = clamp(params.turnRateNorm, -1, 1);
  const activity = clamp01(Math.max(move, Math.abs(turn) * 0.85));
  if (activity < 1e-4) {
    res.coxaYawDelta = 0;
    res.femurLift = 0;
    res.tibiaFlex = 0;
    res.isGrounded = true;
    return res;
  }

  const strideAmp = params.strideYawAmp ?? 0.32;
  const liftMax = params.liftAmp ?? 0.28;

  // Normalize cycle u in [0, 1): [0, 0.62) = grounded stance (front -> back), [0.62, 1.0) = lifted swing (back -> front)
  const raw = (params.phase + (params.groupIndex === 1 ? Math.PI : 0)) / (Math.PI * 2);
  const u = raw - Math.floor(raw);
  const stanceFrac = 0.62;

  let foreNorm = 0; // +1 = max forward reach, -1 = max rear push-off
  let liftNorm = 0; // 0 = planted on ground, 1 = peak swing clearance
  let isGrounded = true;

  if (u < stanceFrac) {
    const t = u / stanceFrac; // 0 -> 1 linearly while foot is planted on ground
    foreNorm = 1 - 2 * t;
    liftNorm = 0;
    isGrounded = true;
  } else {
    const t = (u - stanceFrac) / (1 - stanceFrac); // 0 -> 1 smooth arched swing forward
    const smoothT = t * t * (3 - 2 * t);
    foreNorm = -1 + 2 * smoothT;
    liftNorm = Math.sin(t * Math.PI);
    isGrounded = false;
  }

  // Forward foot reach (`+Z`) requires `-side * foreNorm` around Y for radially/laterally splayed legs
  const transYaw = -params.side * foreNorm * strideAmp * move;
  const turnYaw = foreNorm * strideAmp * 0.65 * turn;
  res.coxaYawDelta = transYaw + turnYaw;
  res.femurLift = liftNorm * liftMax * activity;
  res.tibiaFlex = liftNorm * liftMax * 0.78 * activity;
  res.isGrounded = isGrounded;
  return res;
}

export interface DroneAeroTilt {
  pitch: number;
  roll: number;
}

/**
 * Computes physically authentic multirotor aerodynamic pitch (nose-down into forward velocity/thrust)
 * and roll (banking into lateral velocity/turns) in heading-aligned `YXZ` local space.
 */
export function computeDroneAerodynamicTilt(params: {
  velX: number;
  velZ: number;
  accelX: number;
  accelZ: number;
  yaw: number;
  maxTiltRad?: number;
}): DroneAeroTilt {
  const maxTilt = params.maxTiltRad ?? 0.44;
  const cosY = Math.cos(params.yaw);
  const sinY = Math.sin(params.yaw);

  // Heading forward is `(sinY, 0, cosY)`, heading right is `(cosY, 0, -sinY)`
  const velFwd = params.velX * sinY + params.velZ * cosY;
  const velRight = params.velX * cosY - params.velZ * sinY;
  const accFwd = params.accelX * sinY + params.accelZ * cosY;
  const accRight = params.accelX * cosY - params.accelZ * sinY;

  // In local space (+Z forward, +Y up, +X right): positive X rotation pitches nose (+Z) DOWN!
  // Positive Z rotation rolls right wing (+X) UP / left wing (-X) DOWN, so banking right requires negative Z roll.
  const pitch = clamp(velFwd * 0.042 + accFwd * 0.022, -maxTilt, maxTilt);
  const roll = clamp(-(velRight * 0.040 + accRight * 0.024), -maxTilt, maxTilt);

  return { pitch, roll };
}

export interface AabbCollider {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  noNav?: boolean;
}

/**
 * 2D Grid A* Navigation & String-Pulling Pathfinder (`d3` nav subsystem in engine).
 */
export function createNavGrid(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, step = 0.5, colliders: AabbCollider[] = []) {
  const { minX, maxX, minZ, maxZ } = bounds;
  const cols = Math.floor((maxX - minX) / step);
  const rows = Math.floor((maxZ - minZ) / step);
  const blocked = new Uint8Array(cols * rows);
  const clearance = 0.45;

  for (const b of colliders) {
    if (b.noNav || b.maxY < 0.25 || b.minY > 1.8) continue;
    const x0 = Math.max(0, Math.floor((b.minX - clearance - minX) / step));
    const x1 = Math.min(cols - 1, Math.floor((b.maxX + clearance - minX) / step));
    const z0 = Math.max(0, Math.floor((b.minZ - clearance - minZ) / step));
    const z1 = Math.min(rows - 1, Math.floor((b.maxZ + clearance - minZ) / step));
    for (let z = z0; z <= z1; z++) {
      const rowOffset = z * cols;
      for (let x = x0; x <= x1; x++) {
        blocked[rowOffset + x] = 1;
      }
    }
  }

  const gScore = new Float32Array(cols * rows);
  const fScore = new Float32Array(cols * rows);
  const parent = new Int32Array(cols * rows);
  const stamp = new Uint16Array(cols * rows);
  const heap = new Int32Array(cols * rows);
  let currentStamp = 1;

  const toCell = (x: number, z: number): [number, number] => [
    clamp(Math.floor((x - minX) / step), 0, cols - 1),
    clamp(Math.floor((z - minZ) / step), 0, rows - 1),
  ];

  const toWorld = (cx: number, cz: number): Vec3Like => ({
    x: minX + (cx + 0.5) * step,
    y: 0,
    z: minZ + (cz + 0.5) * step,
  });

  const nearestFree = (cx: number, cz: number): [number, number] => {
    if (!blocked[cz * cols + cx]) return [cx, cz];
    for (let r = 1; r < 14; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx >= 0 && nx < cols && nz >= 0 && nz < rows && !blocked[nz * cols + nx]) {
            return [nx, nz];
          }
        }
      }
    }
    return [cx, cz];
  };

  const lineWalkable = (x0: number, z0: number, x1: number, z1: number): boolean => {
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(dist / (step * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const [cx, cz] = toCell(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (blocked[cz * cols + cx]) return false;
    }
    return true;
  };

  const dirs = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.414],
    [-1, 1, 1.414],
    [1, -1, 1.414],
    [-1, -1, 1.414],
  ] as const;

  return {
    isWalkable(x: number, z: number): boolean {
      const [cx, cz] = toCell(x, z);
      return !blocked[cz * cols + cx];
    },
    findPath(start: { x: number; z: number }, goal: { x: number; z: number }, maxExpansions = 2200): Vec3Like[] {
      if (lineWalkable(start.x, start.z, goal.x, goal.z)) {
        return [{ x: goal.x, y: 0, z: goal.z }];
      }
      let [sx, sz] = toCell(start.x, start.z);
      let [gx, gz] = toCell(goal.x, goal.z);
      [sx, sz] = nearestFree(sx, sz);
      [gx, gz] = nearestFree(gx, gz);
      const startIdx = sz * cols + sx;
      const goalIdx = gz * cols + gx;
      if (startIdx === goalIdx) return [toWorld(gx, gz)];

      currentStamp = (currentStamp + 1) & 0xffff || 1;
      const openStamp = currentStamp;
      currentStamp = (currentStamp + 1) & 0xffff || 1;
      const closedStamp = currentStamp;

      let heapSize = 0;
      const push = (node: number) => {
        let i = heapSize++;
        heap[i] = node;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (fScore[heap[p]] <= fScore[node]) break;
          heap[i] = heap[p];
          i = p;
        }
        heap[i] = node;
      };
      const pop = (): number => {
        const top = heap[0];
        const last = heap[--heapSize];
        let i = 0;
        while ((i << 1) + 1 < heapSize) {
          let child = (i << 1) + 1;
          if (child + 1 < heapSize && fScore[heap[child + 1]] < fScore[heap[child]]) child++;
          if (fScore[last] <= fScore[heap[child]]) break;
          heap[i] = heap[child];
          i = child;
        }
        heap[i] = last;
        return top;
      };

      gScore[startIdx] = 0;
      fScore[startIdx] = Math.hypot(gx - sx, gz - sz);
      parent[startIdx] = -1;
      stamp[startIdx] = openStamp;
      push(startIdx);

      let bestNode = startIdx;
      let bestDist = fScore[startIdx];
      let expansions = 0;

      while (heapSize > 0 && expansions++ < maxExpansions) {
        const cur = pop();
        if (stamp[cur] === closedStamp) continue;
        stamp[cur] = closedStamp;
        if (cur === goalIdx) {
          bestNode = cur;
          break;
        }
        const cx = cur % cols;
        const cz = (cur / cols) | 0;
        for (let d = 0; d < 8; d++) {
          const dx = dirs[d][0];
          const dz = dirs[d][1];
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nx >= cols || nz < 0 || nz >= rows) continue;
          const nIdx = nz * cols + nx;
          if (blocked[nIdx] || stamp[nIdx] === closedStamp) continue;
          if (dx && dz && (blocked[cz * cols + nx] || blocked[nz * cols + cx])) continue;
          const tentativeG = gScore[cur] + dirs[d][2];
          if (stamp[nIdx] !== openStamp || tentativeG < gScore[nIdx]) {
            gScore[nIdx] = tentativeG;
            const h = Math.hypot(gx - nx, gz - nz);
            fScore[nIdx] = tentativeG + h;
            parent[nIdx] = cur;
            stamp[nIdx] = openStamp;
            push(nIdx);
            if (h < bestDist) {
              bestDist = h;
              bestNode = nIdx;
            }
          }
        }
      }

      const raw: Vec3Like[] = [];
      for (let cur = bestNode; cur !== -1 && cur !== startIdx; cur = parent[cur]) {
        raw.push(toWorld(cur % cols, (cur / cols) | 0));
      }
      raw.reverse();
      if (!raw.length) return [toWorld(gx, gz)];

      const smoothed: Vec3Like[] = [];
      let anchor: { x: number; z: number } = start;
      let idx = 0;
      while (idx < raw.length) {
        let furthest = idx;
        for (let probe = raw.length - 1; probe > idx; probe--) {
          if (lineWalkable(anchor.x, anchor.z, raw[probe].x, raw[probe].z)) {
            furthest = probe;
            break;
          }
        }
        smoothed.push(raw[furthest]);
        anchor = raw[furthest];
        idx = furthest + 1;
      }
      return smoothed;
    },
  };
}
