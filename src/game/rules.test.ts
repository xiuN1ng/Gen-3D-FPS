import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  lerp,
  clamp01,
  smoothstep,
  damp,
  createRng,
  createEventBus,
  selectQualityPreset,
  formatTime,
  computeDebriefRating,
  computeWaveDirectionLabel,
  solveTwoBoneIK,
  createNavGrid,
} from './rules.ts';

test('math utilities clamp, lerp, smoothstep, and damp behave accurately', () => {
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp01(1.4), 1);
  assert.equal(clamp01(-0.2), 0);
  assert.equal(lerp(10, 20, 0.25), 12.5);
  assert.equal(smoothstep(0, 10, 0), 0);
  assert.equal(smoothstep(0, 10, 5), 0.5);
  assert.equal(smoothstep(0, 10, 10), 1);

  const d = damp(0, 10, 5, 0.1);
  assert.ok(d > 0 && d < 10);
});

test('Mulberry32 PRNG is deterministic and supports fork/range/int/pick', () => {
  const rngA = createRng(4207);
  const rngB = createRng(4207);
  for (let i = 0; i < 10; i++) {
    assert.equal(rngA(), rngB());
  }
  const forkedA = rngA.fork(3);
  const forkedB = rngB.fork(3);
  assert.equal(forkedA(), forkedB());

  for (let i = 0; i < 25; i++) {
    const r = rngA.range(-5, 5);
    assert.ok(r >= -5 && r <= 5);
    const n = rngA.int(2, 6);
    assert.ok(Number.isInteger(n) && n >= 2 && n <= 6);
    const s = rngA.sign();
    assert.ok(s === -1 || s === 1);
  }
  const item = rngA.pick(['甲', '乙', '丙']);
  assert.ok(['甲', '乙', '丙'].includes(item));
});

test('Event bus subscribes, emits payloads, and unsubscribes cleanly', () => {
  const bus = createEventBus();
  const received: number[] = [];
  const off = bus.on('objective:done', (payload) => {
    received.push((payload as { index: number }).index);
  });
  bus.emit('objective:done', { index: 1 });
  bus.emit('objective:done', { index: 2 });
  off();
  bus.emit('objective:done', { index: 3 });
  assert.deepEqual(received, [1, 2]);
});

test('selectQualityPreset chooses test, low on mobile, medium on SwiftShader/Intel, high on discrete GPU', () => {
  assert.equal(selectQualityPreset('test').name, 'test');
  assert.equal(selectQualityPreset('ultra').name, 'ultra');
  assert.equal(selectQualityPreset('', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)').name, 'low');
  assert.equal(selectQualityPreset('', 'Mozilla/5.0', 'Google SwiftShader').name, 'medium');
  assert.equal(selectQualityPreset('', 'Mozilla/5.0', 'NVIDIA GeForce RTX 4080').name, 'high');
});

test('formatTime and computeDebriefRating match tactical debrief rules', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(65.8), '01:05');
  assert.equal(formatTime(270), '04:30');

  const perfect = computeDebriefRating({ time: 195, shots: 100, hits: 62, retries: 0 });
  assert.equal(perfect.scoreIndex, 5);
  assert.equal(perfect.rating, '完美突击');

  const rough = computeDebriefRating({ time: 450, shots: 100, hits: 15, retries: 2 });
  assert.equal(rough.scoreIndex, 0);
  assert.equal(rough.rating, '险象环生');
});

test('computeWaveDirectionLabel maps 8 compass bearings accurately', () => {
  assert.equal(computeWaveDirectionLabel(0, -10), '北方');
  assert.equal(computeWaveDirectionLabel(10, 0), '东方');
  assert.equal(computeWaveDirectionLabel(0, 10), '南方');
  assert.equal(computeWaveDirectionLabel(-10, 0), '西方');
});

test('solveTwoBoneIK places knee joint at valid segment lengths l1 and l2', () => {
  const root = { x: 0, y: 0.5, z: 0 };
  const target = { x: 0, y: 0, z: 0.2 };
  const pole = { x: 0, y: 0.3, z: 1 };
  const l1 = 0.32;
  const l2 = 0.34;
  const knee = solveTwoBoneIK(root, target, pole, l1, l2);
  const d1 = Math.hypot(knee.x - root.x, knee.y - root.y, knee.z - root.z);
  const d2 = Math.hypot(target.x - knee.x, target.y - knee.y, target.z - knee.z);
  assert.ok(Math.abs(d1 - l1) < 1e-3, `Expected d1=${d1} to equal l1=${l1}`);
  assert.ok(Math.abs(d2 - l2) < 1e-3, `Expected d2=${d2} to equal l2=${l2}`);
});

test('createNavGrid routes around AABB obstacles and string-pulls open paths', () => {
  const obstacle = {
    minX: -2,
    maxX: 2,
    minY: 0,
    maxY: 2.5,
    minZ: -4,
    maxZ: 4,
  };
  const nav = createNavGrid({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, 0.5, [obstacle]);
  assert.equal(nav.isWalkable(0, 0), false);
  assert.equal(nav.isWalkable(-6, 0), true);

  // Direct unobstructed path is a single segment
  const direct = nav.findPath({ x: -6, z: -6 }, { x: -6, z: 6 });
  assert.equal(direct.length, 1);

  // Path obstructed by central wall routes around it
  const around = nav.findPath({ x: -6, z: 0 }, { x: 6, z: 0 });
  assert.ok(around.length >= 2);
  for (const wp of around) {
    assert.equal(nav.isWalkable(wp.x, wp.z), true);
  }
});

test('computeBipedalGaitPose produces anatomically valid knee flexion and opposing hip swing', async () => {
  const { computeBipedalGaitPose } = await import('./rules.ts');
  const runPose = computeBipedalGaitPose(Math.PI / 2, 1, 0);
  assert.ok(runPose.hipL > 0.4 && runPose.hipR < -0.4);
  assert.ok(runPose.kneeL >= 0.05 && runPose.kneeR >= 0.05);

  const crouchPose = computeBipedalGaitPose(0, 0, 1);
  assert.ok(crouchPose.pelvisBob < -0.2);
  assert.ok(crouchPose.kneeL > 0.9 && crouchPose.kneeR > 0.9);
});

test('Genji upgrade drafting respects maxStacks, returns 3 distinct cards, and applies stat modifiers', async () => {
  const {
    createBaseGenjiStats,
    computeGenjiBuildStats,
    draftUpgradeChoices,
  } = await import('./roguelike.ts');

  const base = createBaseGenjiStats();
  assert.equal(base.shurikenPerVolley, 3);
  assert.equal(base.deflectHomingWeakspot, false);

  const rng = createRng(9001);
  const choices = draftUpgradeChoices({}, rng, true);
  assert.equal(choices.length, 3);
  assert.notEqual(choices[0].id, choices[1].id);
  assert.notEqual(choices[1].id, choices[2].id);
  assert.notEqual(choices[0].id, choices[2].id);
  // Guaranteed rare+ on slot 0
  assert.notEqual(choices[0].rarity, 'common');

  // Maxed card should never appear in draft
  const maxedStacks = { deflect_homing: 1, shuriken_penta: 1 };
  for (let i = 0; i < 15; i++) {
    const roll = draftUpgradeChoices(maxedStacks, rng, false);
    assert.ok(!roll.some((c) => c.id === 'deflect_homing'));
  }

  const upgraded = computeGenjiBuildStats(maxedStacks);
  assert.equal(upgraded.shurikenPerVolley, 5);
  assert.equal(upgraded.magSize, 36);
  assert.equal(upgraded.deflectHomingWeakspot, true);
  assert.ok(upgraded.deflectMultiplier >= 3.2);
});

test('Genji elimination resets Swift Strike cooldown and extends Dragonblade or charges Ult', async () => {
  const {
    computeGenjiBuildStats,
    applyGenjiEliminationReset,
    addUltimateDamageCharge,
  } = await import('./roguelike.ts');

  const baseStats = computeGenjiBuildStats({ dragon_feast: 1 });
  const resetNormal = applyGenjiEliminationReset(
    { swiftCd: 6.2, deflectCd: 4.0, deflectActiveT: 0, ultCharge: 40, dragonActiveT: 0, dragonMaxT: 6.5 },
    baseStats,
    false
  );
  assert.equal(resetNormal.swiftCd, 0);
  assert.ok(resetNormal.ultCharge > 40);

  const resetDuringDragon = applyGenjiEliminationReset(
    { swiftCd: 5.0, deflectCd: 2.0, deflectActiveT: 0, ultCharge: 0, dragonActiveT: 3.0, dragonMaxT: 6.5 },
    baseStats,
    false
  );
  assert.equal(resetDuringDragon.swiftCd, 0);
  assert.ok(Math.abs(resetDuringDragon.dragonActiveT - 4.6) < 1e-6);

  const charged = addUltimateDamageCharge(50, 190, 1.0, false);
  assert.ok(charged > 65 && charged <= 100);
  // No ult charge gained from damage while Dragonblade is active
  assert.equal(addUltimateDamageCharge(10, 500, 1.0, true), 10);
});

test('Cyber-Agility supports double jump in air and vertical wall climb until stamina depletes', async () => {
  const { createBaseGenjiStats, stepCyberAgility } = await import('./roguelike.ts');
  const stats = createBaseGenjiStats();

  // Reset on ground
  let res = stepCyberAgility({
    state: { airJumpsLeft: 0, wallClimbTimeLeft: 0, isWallClimbing: false },
    stats,
    onGround: true,
    jumpJustPressed: false,
    jumpHeld: false,
    facingVerticalWall: false,
    dt: 0.016,
  });
  assert.equal(res.next.airJumpsLeft, 1);
  assert.ok(res.next.wallClimbTimeLeft > 0.9);

  // Double jump in mid-air
  res = stepCyberAgility({
    state: res.next,
    stats,
    onGround: false,
    jumpJustPressed: true,
    jumpHeld: true,
    facingVerticalWall: false,
    dt: 0.016,
  });
  assert.equal(res.didAirJump, true);
  assert.equal(res.next.airJumpsLeft, 0);

  // Wall climb against container wall
  res = stepCyberAgility({
    state: res.next,
    stats,
    onGround: false,
    jumpJustPressed: false,
    jumpHeld: true,
    facingVerticalWall: true,
    dt: 0.25,
  });
  assert.equal(res.next.isWallClimbing, true);
  assert.equal(res.climbVelY, stats.wallClimbSpeed);
});

test('Deflect cone detection, weakspot homing vector, fan angles, and wave/boss schedule work accurately', async () => {
  const {
    computeDeflectDirection,
    computeShurikenFanAngles,
    isBoltInDeflectCone,
    computeWavePlan,
  } = await import('./roguelike.ts');

  const fan3 = computeShurikenFanAngles(3, 0.2);
  assert.equal(fan3.length, 3);
  assert.ok(fan3[0] < 0 && Math.abs(fan3[1]) < 1e-9 && fan3[2] > 0);

  const inCone = isBoltInDeflectCone({
    playerEye: { x: 0, y: 1.6, z: 0 },
    playerForward: { x: 0, y: 0, z: -1 },
    boltPos: { x: 0.2, y: 1.5, z: -1.8 },
    boltDir: { x: 0, y: 0, z: 1 },
  });
  assert.equal(inCone, true);

  const behindPlayer = isBoltInDeflectCone({
    playerEye: { x: 0, y: 1.6, z: 0 },
    playerForward: { x: 0, y: 0, z: -1 },
    boltPos: { x: 0, y: 1.5, z: 2.0 },
    boltDir: { x: 0, y: 0, z: -1 },
  });
  assert.equal(behindPlayer, false);

  const homed = computeDeflectDirection(
    { x: 0, y: 1.5, z: -1 },
    { x: 0, y: 0, z: -1 },
    { x: 3, y: 1.5, z: -5 }
  );
  assert.ok(homed.x > 0.5 && homed.z < -0.7);

  const w1 = computeWavePlan(1);
  assert.equal(w1.isBossWave, false);
  assert.equal(w1.isHarborEvent, false);

  const w3 = computeWavePlan(3);
  assert.equal(w3.isHarborEvent, true);
  assert.ok(w3.spawns.includes('sniper'));

  const w5 = computeWavePlan(5);
  assert.equal(w5.isBossWave, true);
  assert.equal(w5.spawns[0], 'boss');
});

test('Mobile virtual joystick, calibrated radian swipe look curve, floating origin, and aim assist behave deterministically', async () => {
  const {
    computeVirtualStick,
    computeFloatingStickOrigin,
    computeTouchLookDelta,
    computeTouchAimAssist,
    shouldEnableTouchUi,
  } = await import('./roguelike.ts');

  // Inside deadzone -> zero movement
  const idle = computeVirtualStick(2, -1, 42, 0.08);
  assert.equal(idle.moveX, 0);
  assert.equal(idle.moveY, 0);
  assert.equal(idle.sprint, false);

  // Full forward push (-dy in screen space) -> clamped nub, +moveY, sprint enabled
  const fullFwd = computeVirtualStick(0, -80, 42, 0.08);
  assert.equal(fullFwd.nubY, -42);
  assert.ok(fullFwd.moveY > 0.99);
  assert.equal(fullFwd.sprint, true);

  // Dynamic floating stick origin follows thumb beyond maxRadius + slack so reverse strafing has zero lag
  const floated = computeFloatingStickOrigin({
    originX: 100,
    originY: 300,
    pointerX: 168, // +68px right (> 42 + 6 = 48px)
    pointerY: 300,
    maxRadiusPx: 42,
    followSlackPx: 6,
  });
  assert.equal(floated.originX, 120);
  assert.equal(floated.originY, 300);

  // Touch look outputs calibrated RADIANS (never >0.1 rad for 1px micro-aim!), accelerates on fast flicks, and clamps spikes
  const microLook = computeTouchLookDelta(1, 0, 1.0, false);
  assert.ok(
    microLook.dx > 0.003 && microLook.dx < 0.012,
    `Expected 1px micro-aim in 0.003..0.012 rad, got ${microLook.dx}`
  );
  const fastFlick = computeTouchLookDelta(30, 0, 1.0, false);
  assert.ok(
    fastFlick.dx / 30 > microLook.dx * 1.5,
    'Fast thumb flick should smoothly accelerate rad/px above slow micro-aim'
  );
  const normalLook = computeTouchLookDelta(25, -15, 1.0, false);
  assert.ok(normalLook.dx > 0 && normalLook.dy < 0);
  const invertedLook = computeTouchLookDelta(25, -15, 1.0, true);
  assert.ok(Math.abs(invertedLook.dy + normalLook.dy) < 1e-9);
  const spikeClamped = computeTouchLookDelta(9999, 0, 1.0, false);
  const maxAllowed = computeTouchLookDelta(140, 0, 1.0, false);
  assert.equal(spikeClamped.dx, maxAllowed.dx);

  // Mobile Aim Assist: applies reticle friction (< 0.80x) and gentle yaw/pitch magnetism toward in-cone target
  const assistHit = computeTouchAimAssist({
    enabled: true,
    eyePos: { x: 0, y: 1.65, z: 0 },
    yaw: 0,
    pitch: 0,
    rawLookDx: 0.01,
    rawLookDy: 0,
    moveMagnitude: 0.8,
    isFiringOrDrawing: true,
    dt: 0.016,
    candidates: [
      { id: 7, aimPoint: { x: 0.6, y: 1.95, z: -16 } }, // slightly right (+X -> negative targetYaw) and up (+Y -> positive targetPitch)
    ],
  });
  assert.equal(assistHit.lockedTargetId, 7);
  assert.ok(assistHit.frictionScale < 0.82 && assistHit.frictionScale >= 0.62);
  assert.ok(assistHit.yawPullRad < 0, 'Target to +X right should pull yaw negatively');
  assert.ok(assistHit.pitchPullRad > 0, 'Target above eye should pull pitch positively');

  // Disabled or out-of-cone target produces zero assist
  const assistOff = computeTouchAimAssist({
    enabled: false,
    eyePos: { x: 0, y: 1.65, z: 0 },
    yaw: 0,
    pitch: 0,
    rawLookDx: 0.01,
    rawLookDy: 0,
    moveMagnitude: 1,
    isFiringOrDrawing: true,
    dt: 0.016,
    candidates: [{ id: 7, aimPoint: { x: 0.6, y: 1.95, z: -16 } }],
  });
  assert.equal(assistOff.frictionScale, 1);
  assert.equal(assistOff.yawPullRad, 0);

  // Touch UI detection rules
  assert.equal(shouldEnableTouchUi({ viewportWidth: 1440, coarsePointer: false, maxTouchPoints: 0 }), false);
  assert.equal(shouldEnableTouchUi({ viewportWidth: 390, coarsePointer: true, maxTouchPoints: 5 }), true);
  assert.equal(shouldEnableTouchUi({ viewportWidth: 844, coarsePointer: false, maxTouchPoints: 0 }), true);
  assert.equal(shouldEnableTouchUi({ viewportWidth: 1440, userPref: 'on' }), true);
  assert.equal(shouldEnableTouchUi({ viewportWidth: 390, coarsePointer: true, userPref: 'off' }), false);
  assert.equal(shouldEnableTouchUi({ viewportWidth: 1440, urlTouchParam: '1' }), true);
});

test('Swept-segment Deflect catches high-speed bolts that would tunnel past point checks, and ignores bolts behind player', async () => {
  const { checkSweptBoltDeflect } = await import('./roguelike.ts');

  // High-speed sniper round jumps from z = -4.2 to z = +0.6 in a single 50ms frame
  const caught = checkSweptBoltDeflect({
    playerEye: { x: 0, y: 1.65, z: 0 },
    playerForward: { x: 0, y: 0, z: -1 },
    boltStart: { x: 0.35, y: 1.55, z: -4.2 },
    boltEnd: { x: 0.15, y: 1.55, z: 0.6 },
    boltDir: { x: -0.04, y: 0, z: 0.999 },
  });
  assert.equal(caught.hit, true);
  assert.ok(caught.point.z < -0.5 && caught.point.z > -3.0);

  // Bolt behind player traveling away -> never deflected
  const behind = checkSweptBoltDeflect({
    playerEye: { x: 0, y: 1.65, z: 0 },
    playerForward: { x: 0, y: 0, z: -1 },
    boltStart: { x: 0, y: 1.6, z: 1.5 },
    boltEnd: { x: 0, y: 1.6, z: 4.5 },
    boltDir: { x: 0, y: 0, z: 1 },
  });
  assert.equal(behind.hit, false);
});

test('Destructible village architecture transitions intact -> damaged -> destroyed and Upgrade Catalog is 100% classical', async () => {
  const { stepDestructibleStructure, UPGRADE_CATALOG } = await import('./roguelike.ts');
  type DestructibleState = import('./roguelike.ts').DestructibleState;

  let st: DestructibleState = { hp: 120, maxHp: 120, stage: 'intact' };
  const hit1 = stepDestructibleStructure(st, 65);
  assert.equal(hit1.becameDamaged, true);
  assert.equal(hit1.becameDestroyed, false);
  assert.equal(hit1.next.stage, 'damaged');
  assert.ok(hit1.debrisCount >= 5);

  st = hit1.next;
  const hit2 = stepDestructibleStructure(st, 80);
  assert.equal(hit2.becameDestroyed, true);
  assert.equal(hit2.next.stage, 'destroyed');
  assert.equal(hit2.next.hp, 0);
  assert.ok(hit2.debrisCount >= 15);

  for (const card of UPGRADE_CATALOG) {
    assert.ok(!card.title.includes('赛博') && !card.description.includes('赛博'), `Unexpected cyber copy in ${card.id}`);
  }
});

test('Hanamura PBR presets and procedural samplers cover Wood, Stone, and Tile with physical AO/roughness/metalness separation', async () => {
  const { HANAMURA_PBR_PRESETS, sampleHanamuraMaterialPbr } = await import('./villageMaterials.ts');
  const presets = Object.values(HANAMURA_PBR_PRESETS);

  const categories = new Set(presets.map((p) => p.category));
  assert.deepEqual(categories, new Set(['wood', 'stone', 'tile']));

  for (const p of presets) {
    assert.ok(p.roughnessRange[0] >= 0 && p.roughnessRange[0] < p.roughnessRange[1] && p.roughnessRange[1] <= 1);
    assert.ok(p.metalnessRange[0] >= 0 && p.metalnessRange[0] <= p.metalnessRange[1] && p.metalnessRange[1] <= 1);
    assert.ok(p.aoRange[0] >= 0.1 && p.aoRange[1] === 1.0);
    assert.ok(p.normalScale > 0.5 && p.aoMapIntensity >= 1.0 && p.envMapIntensity > 0.5);

    // Seamless periodic wrap across [0, 1] UV boundary + valid [0..1] physical channels
    const s0 = sampleHanamuraMaterialPbr(p.id, 0.25, 0.35);
    const sWrap = sampleHanamuraMaterialPbr(p.id, 1.25, 2.35);
    assert.ok(Math.abs(s0.rough - sWrap.rough) < 1e-9 && Math.abs(s0.ao - sWrap.ao) < 1e-9);
    for (const ch of [s0.r, s0.g, s0.b, s0.ao, s0.rough, s0.metal, s0.height]) {
      assert.ok(Number.isFinite(ch) && ch >= 0 && ch <= 1, `Out-of-bounds PBR channel in ${p.id}: ${ch}`);
    }
  }

  // Wood (`木材`): Bridge plank V-groove seam has deep AO & matte roughness, plank face is satin, iron nail is metallic
  const plankSeam = sampleHanamuraMaterialPbr('bridgePlank', 0.001, 0.25);
  const plankFace = sampleHanamuraMaterialPbr('bridgePlank', 0.08, 0.25);
  const plankNail = sampleHanamuraMaterialPbr('bridgePlank', 0.24 / 6, 0.048 / 2);
  assert.ok(plankSeam.ao < 0.30 && plankFace.ao > 0.90);
  assert.ok(plankSeam.rough - plankFace.rough > 0.25);
  assert.ok(plankNail.metal > 0.65 && plankNail.rough < 0.42);
  assert.ok(HANAMURA_PBR_PRESETS.vermilionLacquer.clearcoat >= 0.5);

  // Stone (`石材`): Ishigaki & Ishidatami exhibit deep crevice AO (<0.35) vs stone crown (>0.85) and >=0.30 roughness span
  for (const stoneId of ['ishigakiStone', 'villageCobble'] as const) {
    let minAo = 1;
    let maxAo = 0;
    let minRough = 1;
    let maxRough = 0;
    for (let iy = 0; iy < 24; iy++) {
      for (let ix = 0; ix < 24; ix++) {
        const s = sampleHanamuraMaterialPbr(stoneId, ix / 24, iy / 24);
        minAo = Math.min(minAo, s.ao);
        maxAo = Math.max(maxAo, s.ao);
        minRough = Math.min(minRough, s.rough);
        maxRough = Math.max(maxRough, s.rough);
      }
    }
    assert.ok(minAo < 0.35 && maxAo > 0.85, `${stoneId} AO range too flat: [${minAo}, ${maxAo}]`);
    assert.ok(maxRough - minRough >= 0.30, `${stoneId} roughness span too narrow: ${maxRough - minRough}`);
  }

  // Tile (`瓦片`): Kawara marugawara rib crest has ibushi-gin metallic sheen & lower roughness than eave under-lip shadow
  const kawaraEaveLip = sampleHanamuraMaterialPbr('kawaraTile', 0.78 / 6, 0.008 / 6);
  const kawaraRibCrest = sampleHanamuraMaterialPbr('kawaraTile', 0.78 / 6, 0.55 / 6);
  assert.ok(kawaraEaveLip.ao < 0.30 && kawaraRibCrest.ao > 0.85);
  assert.ok(kawaraRibCrest.rough < kawaraEaveLip.rough - 0.30);
  assert.ok(kawaraRibCrest.metal > kawaraEaveLip.metal + 0.10);
  assert.equal(HANAMURA_PBR_PRESETS.kawaraTile.roofPitchUv, true);
});

test('Hipped curved roof stepped colliders prevent roof interior clipping and keep step rise under capsule step-up height', async () => {
  const {
    computeHippedRoofHalfExtents,
    evalHippedRoofSurfaceY,
    computePitchedRoofColliderBoxes,
    computeFujiProfileSample,
  } = await import('./roguelike.ts');

  // Rectangular Machiya roof (`13.4 x 9.4 x 2.1`) forms a longitudinal ridge along X (`ridgeHalfX > 1.5, ridgeHalfZ === 0`)
  const machiyaSpec = { widthX: 13.4, depthZ: 9.4, heightY: 2.1, overhangScale: 1.04, eaveYOffset: 0.17 };
  const ridgeExt = computeHippedRoofHalfExtents(machiyaSpec, 1.0);
  assert.ok(ridgeExt.ridgeHalfX > 1.5, `Expected longitudinal Machiya ridgeHalfX > 1.5, got ${ridgeExt.ridgeHalfX}`);
  assert.equal(ridgeExt.ridgeHalfZ, 0);

  const cases = [
    { cx: -23.5, baseY: 5.55, cz: -15.5, rotY: 0, spec: machiyaSpec },
    {
      cx: -32.0,
      baseY: 2.80,
      cz: -56.0,
      rotY: Math.PI / 2,
      spec: { widthX: 12.6, depthZ: 10.2, heightY: 4.6, overhangScale: 1.02, eaveYOffset: 0.10 },
    },
    {
      cx: 43.0,
      baseY: 7.40,
      cz: -26.0,
      rotY: 0,
      spec: { widthX: 9.2, depthZ: 9.2, heightY: 2.0, overhangScale: 1.04, eaveYOffset: 0.17 },
    },
  ];

  for (const c of cases) {
    const boxes = computePitchedRoofColliderBoxes(c.cx, c.baseY, c.cz, c.spec, c.rotY);
    assert.ok(boxes.length >= 6);
    for (let i = 1; i < boxes.length; i++) {
      const stepRise = boxes[i].maxY - boxes[i - 1].maxY;
      assert.ok(stepRise > 0 && stepRise <= 0.36, `Step rise ${stepRise} exceeds capsule step-up budget 0.42m`);
    }

    // Across a dense 25x25 sample grid inside the roof footprint, the supporting collider top must strictly exceed visual roof Y!
    const swap = Math.abs(Math.sin(c.rotY)) > 0.707;
    const { eaveHalfX, eaveHalfZ } = computeHippedRoofHalfExtents(c.spec, 0);
    const maxDx = swap ? eaveHalfZ : eaveHalfX;
    const maxDz = swap ? eaveHalfX : eaveHalfZ;

    for (let ix = -12; ix <= 12; ix++) {
      for (let iz = -12; iz <= 12; iz++) {
        const dx = (ix / 12) * (maxDx * 0.98);
        const dz = (iz / 12) * (maxDz * 0.98);
        const surfY = evalHippedRoofSurfaceY(c.baseY, dx, dz, c.spec, c.rotY);
        assert.ok(surfY !== null);
        const wx = c.cx + dx;
        const wz = c.cz + dz;
        let supportY = -Infinity;
        for (const b of boxes) {
          if (wx >= b.minX && wx <= b.maxX && wz >= b.minZ && wz <= b.maxZ) {
            supportY = Math.max(supportY, b.maxY);
          }
        }
        assert.ok(
          supportY >= surfY + 0.015,
          `Roof clipping detected at (${dx.toFixed(2)}, ${dz.toFixed(2)}): supportY=${supportY.toFixed(3)} < surfY=${surfY.toFixed(3)}`
        );
      }
    }
  }

  // Concave catenary Mount Fuji profile & jagged Yukigata snowline
  const fSummit = computeFujiProfileSample(0.01, 0.2);
  const fMid = computeFujiProfileSample(0.5, 0.2);
  const fBase = computeFujiProfileSample(0.98, 0.2);
  assert.ok(fMid.radiusRatio < 0.5 * (fSummit.radiusRatio + fBase.radiusRatio), 'Fuji slope must be concave');
  assert.equal(fSummit.snowMask, 1);
  assert.equal(fBase.snowMask, 0);
  const gullyA = computeFujiProfileSample(0.32, 0.15);
  const gullyB = computeFujiProfileSample(0.32, 0.62);
  assert.notEqual(gullyA.snowMask, gullyB.snowMask);
});

test('Colossal Giant Boss weakspot orbs shatter with 12% HP burst + 2.2s stun and transition phases cleanly', async () => {
  const { createColossalBossState, stepColossalBossDamage } = await import('./roguelike.ts');

  const boss = createColossalBossState(1);
  assert.equal(boss.maxHp, 1550);
  assert.deepEqual(boss.orbsAlive, [true, true, true, true]);
  assert.equal(boss.phase, 1);

  // Chip orb 0 without shattering yet (`orbMaxHp = 95`, deal `50` -> `1.35x = 68` boss damage)
  const hit1 = stepColossalBossDamage(boss, 50, 0);
  assert.equal(hit1.orbShattered, false);
  assert.equal(hit1.totalDamage, 68);
  assert.equal(boss.orbHp[0], 45);

  // Shatter orb 0 (`rawDamage = 60 >= 45`): deals `round(60*1.35) + round(1550*0.12) = 81 + 186 = 267`, stuns for 2.2s!
  boss.activeAttack = 'odachi_slam';
  const hit2 = stepColossalBossDamage(boss, 60, 0);
  assert.equal(hit2.orbShattered, true);
  assert.equal(hit2.shatteredOrbIndex, 0);
  assert.equal(boss.orbsAlive[0], false);
  assert.equal(hit2.totalDamage, 267);
  assert.ok(boss.stunTimer >= 2.2);
  assert.equal(boss.activeAttack, null);

  // While stunned (`stunTimer > 0`), body hits deal 1.25x exposed finisher damage (`200 * 1.25 = 250`)
  const hitStunned = stepColossalBossDamage(boss, 200, -1);
  assert.equal(hitStunned.totalDamage, 250);
  assert.equal(hitStunned.newPhase, 2); // HP dropped below 70% (`1550 - 68 - 267 - 250 = 965 <= 1085`)
  assert.equal(hitStunned.phaseChanged, true);

  // Push into Phase 3 (`<= 35%` = `542`) and then lethal finish
  boss.stunTimer = 0;
  const hitP3 = stepColossalBossDamage(boss, 450, -1);
  assert.equal(hitP3.newPhase, 3);
  assert.equal(hitP3.killed, false);

  const lethal = stepColossalBossDamage(boss, 999, -1);
  assert.equal(lethal.killed, true);
  assert.equal(boss.hp, 0);
});

test('Shinobi Spirit-Sense Enemy Locator computes Y-elevation tags, relative yaw sign, and straggler urgency', async () => {
  const { computeEnemyLocatorInfo } = await import('./roguelike.ts');

  // Rooftop sniper +6.2m above and to the right of a player facing +X (`forward = (1, 0)`)
  // In Three.js Y-up right-handed coords: forward=(+1, 0) -> right=(0, +1) (+Z)
  const highRight = computeEnemyLocatorInfo({
    playerX: -50,
    playerY: 0,
    playerZ: 0,
    forwardX: 1,
    forwardZ: 0,
    enemyX: -32,
    enemyY: 6.2,
    enemyZ: 9,
    remainingHostiles: 6,
  });
  assert.equal(highRight.elevation, 'high');
  assert.equal(highRight.elevationLabel, '▲+6m');
  assert.ok(highRight.relYawRad > 0.2, `Expected positive right yaw, got ${highRight.relYawRad}`);
  assert.equal(highRight.isBehind, false);
  assert.equal(highRight.shouldShowMarker, true);
  assert.equal(highRight.urgency, 'priority');

  // Lower canal gorge enemy -3.8m below and behind player
  const lowBehind = computeEnemyLocatorInfo({
    playerX: 0,
    playerY: 3.6,
    playerZ: -18,
    forwardX: 1,
    forwardZ: 0,
    enemyX: -14,
    enemyY: -0.2,
    enemyZ: -24,
    remainingHostiles: 8,
  });
  assert.equal(lowBehind.elevation, 'low');
  assert.equal(lowBehind.elevationLabel, '▼-4m');
  assert.equal(lowBehind.isBehind, true);
  assert.ok(lowBehind.relYawRad < -1.5, `Expected negative left-behind yaw, got ${lowBehind.relYawRad}`);
  assert.equal(lowBehind.shouldShowMarker, true);
});

test('Projectile trajectory prediction converges hand-to-reticle, pulls back wall-blocked hands, prevents cross-eye parallax, and guarantees visibility', async () => {
  const {
    computeConvergedLaunchVector,
    computeProjectileVisualPosition,
    computeProjectileVisualScale,
    isProjectileOutOfPlayableBounds,
  } = await import('./roguelike.ts');

  const camPos = { x: -42, y: 1.65, z: 0 };
  const camFwd = { x: 1, y: 0, z: 0 };
  const rawHand = { x: -41.64, y: 1.55, z: 0.16 };

  // 1. Open medium-range shot (`24m` ahead): launches from unobstructed hand and converges cleanly onto reticle point
  const aim24m = { x: -18, y: 1.65, z: 0 };
  const openShot = computeConvergedLaunchVector({
    cameraPos: camPos,
    cameraForward: camFwd,
    rawHandOrigin: rawHand,
    aimHitPoint: aim24m,
    handBlockedDist: null,
    projectileSpeed: 96,
  });
  assert.equal(openShot.handWasObstructed, false);
  assert.deepEqual(openShot.safeOrigin, rawHand);
  assert.ok(Math.abs(Math.hypot(openShot.dir.x, openShot.dir.y, openShot.dir.z) - 1) < 1e-9);
  // Hand is at z=+0.16, target at z=0 -> converged launch vector angles slightly left (-z) to hit exact crosshair!
  assert.ok(openShot.dir.x > 0.99 && openShot.dir.z < -0.004);
  assert.ok(openShot.minVisualDuration > 0.20);

  // 2. Standing flush beside a Machiya pillar (`handBlockedDist = 0.22m`): pulls safeOrigin inside 0.36m capsule!
  const wallBlocked = computeConvergedLaunchVector({
    cameraPos: camPos,
    cameraForward: camFwd,
    rawHandOrigin: rawHand,
    aimHitPoint: aim24m,
    handBlockedDist: 0.22,
    projectileSpeed: 96,
  });
  assert.equal(wallBlocked.handWasObstructed, true);
  const safeDistFromCam = Math.hypot(
    wallBlocked.safeOrigin.x - camPos.x,
    wallBlocked.safeOrigin.y - camPos.y,
    wallBlocked.safeOrigin.z - camPos.z
  );
  assert.ok(safeDistFromCam < 0.25, `Expected safeOrigin inside 0.36m capsule, got ${safeDistFromCam}`);

  // 3. Point-blank target (`0.35m` in front of camera) & degenerate NaN guard: never shoots backwards/sideways, enforces >= 88ms visual transit!
  const pointBlank = computeConvergedLaunchVector({
    cameraPos: camPos,
    cameraForward: camFwd,
    rawHandOrigin: rawHand,
    aimHitPoint: { x: -41.65, y: 1.65, z: 0 },
    handBlockedDist: null,
    projectileSpeed: 96,
  });
  assert.ok(pointBlank.dir.x > 0.85, `Expected forward launch dir, got ${JSON.stringify(pointBlank.dir)}`);
  assert.ok(pointBlank.minVisualDuration >= 0.088);

  const nanGuard = computeConvergedLaunchVector({
    cameraPos: camPos,
    cameraForward: { x: NaN, y: 0, z: 0 },
    rawHandOrigin: { x: NaN, y: 1, z: 0 },
    aimHitPoint: { x: NaN, y: NaN, z: NaN },
    handBlockedDist: null,
    projectileSpeed: NaN,
  });
  assert.ok(
    Number.isFinite(nanGuard.dir.x) &&
      Number.isFinite(nanGuard.safeOrigin.x) &&
      Math.abs(Math.hypot(nanGuard.dir.x, nanGuard.dir.y, nanGuard.dir.z) - 1) < 1e-9
  );

  // 4. Visual transit interpolation smoothly advances from hand to impact point before retiring
  const midVis = computeProjectileVisualPosition(
    { x: 0, y: 1.5, z: 0 },
    { x: 4, y: 1.5, z: 0 },
    0.045,
    0.090
  );
  assert.equal(midVis.done, false);
  assert.ok(Math.abs(midVis.pos.x - 2.0) < 1e-6);
  const endVis = computeProjectileVisualPosition(
    { x: 0, y: 1.5, z: 0 },
    { x: 4, y: 1.5, z: 0 },
    0.095,
    0.090
  );
  assert.equal(endVis.done, true);
  assert.equal(endVis.pos.x, 4);

  // 5. Perspective-compensated scale & out-of-bounds watchdog
  assert.equal(computeProjectileVisualScale(2.0, 1.0), 1.0);
  assert.ok(computeProjectileVisualScale(45.0, 1.0) > 2.5);
  assert.equal(isProjectileOutOfPlayableBounds({ x: 10, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }, 130), false);
  assert.equal(isProjectileOutOfPlayableBounds({ x: 145, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }, 130), true);
  assert.equal(isProjectileOutOfPlayableBounds({ x: 0, y: 95, z: 0 }, { x: 0, y: 2, z: 0 }, 130), true);
  assert.equal(isProjectileOutOfPlayableBounds({ x: NaN, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }, 130), true);
});

test('Dragonblade kill extensions cap strictly at 3 per activation while Swift Strike still resets on every kill', async () => {
  const {
    computeGenjiBuildStats,
    applyGenjiEliminationReset,
  } = await import('./roguelike.ts');

  const stats = computeGenjiBuildStats({ dragon_feast: 1, dragon_wave: 1 });
  assert.ok(stats.dragonbladeLungeRange > 10.0, 'dragon_wave upgrades Dragonblade lunge dash distance');

  let cd: import('./roguelike.ts').GenjiCooldownState = {
    swiftCd: 6.0,
    deflectCd: 3.0,
    deflectActiveT: 0,
    ultCharge: 0,
    dragonActiveT: 2.0,
    dragonMaxT: 7.0,
    dragonExtendsUsed: 0,
    maxDragonExtensions: 3,
  };

  // First 3 kills each extend Dragonblade by +1.6s (`2.0 -> 3.6 -> 5.2 -> 6.8`)
  for (let k = 1; k <= 3; k++) {
    cd.swiftCd = 5.5;
    cd = applyGenjiEliminationReset(cd, stats, false);
    assert.equal(cd.swiftCd, 0);
    assert.equal(cd.dragonExtendsUsed, k);
  }
  const afterThreeKills = cd.dragonActiveT;
  assert.ok(Math.abs(afterThreeKills - 6.8) < 1e-6, `Expected 6.8s after 3 kills, got ${afterThreeKills}`);

  // Kills 4..10 MUST NOT extend Dragonblade duration any further (no infinite Dragonblade!), though Swift Strike still resets!
  for (let k = 4; k <= 10; k++) {
    cd.swiftCd = 7.0;
    cd = applyGenjiEliminationReset(cd, stats, true);
    assert.equal(cd.swiftCd, 0);
    assert.equal(cd.dragonExtendsUsed, 3);
    assert.equal(cd.dragonActiveT, afterThreeKills);
  }
});

test('Arena Air-Wall clamps ground players, high lunges, and flying drones inside castle-town walls', async () => {
  const { ARENA_AIR_WALL_BOUNDS, clampActorToAirWall } = await import('./roguelike.ts');

  // Player attempting to dash past East wall (`x = +84`) or climb over ceiling (`y = +32`)
  const playerClamped = clampActorToAirWall({
    pos: { x: 84, y: 32, z: -59 },
    vel: { x: 25, y: 12, z: -18 },
    radius: 0.4,
    isFlying: false,
  });
  assert.equal(playerClamped.clampedX, true);
  assert.equal(playerClamped.clampedY, true);
  assert.equal(playerClamped.clampedZ, true);
  assert.ok(playerClamped.pos.x <= ARENA_AIR_WALL_BOUNDS.maxX - 0.39);
  assert.ok(playerClamped.pos.z >= ARENA_AIR_WALL_BOUNDS.minZ + 0.39);
  assert.equal(playerClamped.pos.y, ARENA_AIR_WALL_BOUNDS.maxY);
  assert.equal(playerClamped.vel.x, 0);

  // Flying drone (`gull`) trying to fly out over North wall (`z = -60, y = 24`): clamped & bounced back inward!
  const droneClamped = clampActorToAirWall({
    pos: { x: 0, y: 24, z: -60 },
    vel: { x: 2, y: 6, z: -14 },
    radius: 0.6,
    isFlying: true,
  });
  assert.ok(droneClamped.pos.z >= ARENA_AIR_WALL_BOUNDS.minZ + 0.59);
  assert.equal(droneClamped.pos.y, ARENA_AIR_WALL_BOUNDS.droneMaxY);
  assert.ok(droneClamped.vel.z > 0, 'Outward drone Z velocity should reflect inward');
  assert.ok(droneClamped.vel.y < 0, 'Upward drone Y velocity at ceiling should reflect downward');
});

test('Multi-legged mech spawns, Shield Guard frontal ricochet vs flank bypass, and Gunner Tactical Visor lock work accurately', async () => {
  const {
    computeWavePlan,
    computeShieldedEnemyDamage,
    computeGunnerBuildStats,
    selectTacticalVisorTarget,
  } = await import('./roguelike.ts');

  const w2 = computeWavePlan(2);
  assert.ok(w2.spawns.includes('spider_mech'));
  assert.ok(w2.spawns.includes('shield_guard'));
  assert.ok(w2.spawns.includes('mortar_crab'));

  // Shield Guard facing -X (`(-1, 0, 0)`) shot from front (`toSource = (-1, 0, 0)`) blocks 78%
  const frontal = computeShieldedEnemyDamage({
    rawDamage: 100,
    toSourceDir: { x: -1, y: 0, z: 0 },
    enemyForward: { x: -1, y: 0, z: 0 },
  });
  assert.equal(frontal.blocked, true);
  assert.equal(frontal.finalDamage, 22);

  // Flanked from behind (`toSource = (+1, 0, 0)`) or hit by Helix splash (`bypassShield = true`) deals 100%
  const flanked = computeShieldedEnemyDamage({
    rawDamage: 100,
    toSourceDir: { x: 1, y: 0, z: 0 },
    enemyForward: { x: -1, y: 0, z: 0 },
  });
  assert.equal(flanked.blocked, false);
  assert.equal(flanked.finalDamage, 100);

  const splashed = computeShieldedEnemyDamage({
    rawDamage: 100,
    toSourceDir: { x: -1, y: 0, z: 0 },
    enemyForward: { x: -1, y: 0, z: 0 },
    bypassShield: true,
  });
  assert.equal(splashed.blocked, false);
  assert.equal(splashed.finalDamage, 100);

  // Gunner build stats & Tactical Visor target selection
  const gunner = computeGunnerBuildStats({ shuriken_penta: 1, dragon_wave: 1, cyber_triple_jump: 1 });
  assert.equal(gunner.magSize, 52);
  assert.equal(gunner.helixRocketCount, 4);
  assert.equal(gunner.visorMicroMissiles, true);
  assert.equal(gunner.maxAirJumps, 2);
  assert.ok(gunner.rifleProjectileSpeed >= 450, `Expected ultra-fast rifle bolts >= 450 m/s, got ${gunner.rifleProjectileSpeed}`);
  assert.ok(gunner.helixSpeed >= 140, `Expected fast helix rockets >= 140 m/s, got ${gunner.helixSpeed}`);

  const lock = selectTacticalVisorTarget({
    eyePos: { x: 0, y: 1.65, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    candidates: [
      { id: 1, aimPoint: { x: 18, y: 1.65, z: -4 } }, // Outside visor cone
      { id: 2, aimPoint: { x: 2.2, y: 1.8, z: -18 }, hpRatio: 0.4 }, // Inside visor cone, slightly off-center
      { id: 3, aimPoint: { x: 0.3, y: 1.7, z: -15 }, hpRatio: 0.8 }, // Nearest reticle center!
    ],
  });
  assert.ok(lock.target !== null);
  assert.equal(lock.target?.id, 3);
  assert.ok(lock.lockCos > 0.99);
});

test('Gunner Focused Plasma Overcharge, Biotic amp, headshot crits & Hanamura multi-tier stairways pass strict parity checks', async () => {
  const {
    createBaseGunnerStats,
    computeGunnerShotDamage,
    validateArenaStairway,
  } = await import('./roguelike.ts');

  const base = createBaseGunnerStats();
  const baseDps = base.rifleDamage / base.rifleFireInterval;
  assert.ok(baseDps >= 420, `Expected Gunner baseline sustained DPS >= 420, got ${baseDps}`);
  assert.equal(base.maxAirJumps, 1);

  const coldBody = computeGunnerShotDamage({
    baseDamage: base.rifleDamage,
    consecutiveHits: 0,
    inBioticField: false,
    isWeakspot: false,
    isVisorLock: false,
  });
  assert.equal(coldBody.damage, 34);
  assert.equal(coldBody.isCrit, false);

  const maxOverchargeBioticHeadshot = computeGunnerShotDamage({
    baseDamage: base.rifleDamage,
    consecutiveHits: 12, // clamps at 10 stacks (+35%)
    inBioticField: true, // +20%
    isWeakspot: true,    // 1.75x
    isVisorLock: false,
  });
  assert.equal(maxOverchargeBioticHeadshot.overchargeRatio, 1);
  assert.equal(maxOverchargeBioticHeadshot.isCrit, true);
  assert.ok(maxOverchargeBioticHeadshot.damage >= 95);

  // Verify Hanamura's 3 core elevation stairways (`0->3.2m` Arcade/Cloister, `0->2.8m` Castle Garden, `2.8->5.2m` Tenshu Dojo)
  assert.equal(validateArenaStairway({ fromY: 0, toY: 3.2, steps: 12, width: 3.6 }).valid, true);
  assert.equal(validateArenaStairway({ fromY: 0, toY: 2.8, steps: 10, width: 9.6 }).valid, true);
  assert.equal(validateArenaStairway({ fromY: 2.8, toY: 5.2, steps: 9, width: 9.6 }).valid, true);
});

test('Runtime hero switch viewmodel visibility stays active across playing, intro, paused, and upgrade states for Genji, Gunner, and Hanzo', async () => {
  const { computeHeroViewmodelVisibility } = await import('./roguelike.ts');

  // Playing & Intro states: active hero's weapon & hands are strictly visible
  assert.deepEqual(computeHeroViewmodelVisibility('playing', 'genji'), {
    genjiVisible: true,
    gunnerVisible: false,
    hanzoVisible: false,
  });
  assert.deepEqual(computeHeroViewmodelVisibility('playing', 'gunner'), {
    genjiVisible: false,
    gunnerVisible: true,
    hanzoVisible: false,
  });
  assert.deepEqual(computeHeroViewmodelVisibility('playing', 'hanzo'), {
    genjiVisible: false,
    gunnerVisible: false,
    hanzoVisible: true,
  });
  assert.deepEqual(computeHeroViewmodelVisibility('intro', 'hanzo'), {
    genjiVisible: false,
    gunnerVisible: false,
    hanzoVisible: true,
  });

  // Pause menu & Upgrade scroll modal: never lose active hero's weapon/hands!
  assert.deepEqual(computeHeroViewmodelVisibility('paused', 'gunner'), {
    genjiVisible: false,
    gunnerVisible: true,
    hanzoVisible: false,
  });
  assert.deepEqual(computeHeroViewmodelVisibility('paused', 'hanzo'), {
    genjiVisible: false,
    gunnerVisible: false,
    hanzoVisible: true,
  });
  assert.deepEqual(computeHeroViewmodelVisibility('upgrade', 'hanzo'), {
    genjiVisible: false,
    gunnerVisible: false,
    hanzoVisible: true,
  });

  // Title, Dead, and `?noweapon=1` cleanly hide all three viewmodels
  assert.deepEqual(computeHeroViewmodelVisibility('title', 'hanzo'), {
    genjiVisible: false,
    gunnerVisible: false,
    hanzoVisible: false,
  });
  assert.deepEqual(computeHeroViewmodelVisibility('dead', 'gunner'), {
    genjiVisible: false,
    gunnerVisible: false,
    hanzoVisible: false,
  });
  assert.deepEqual(computeHeroViewmodelVisibility('playing', 'genji', true), {
    genjiVisible: false,
    gunnerVisible: false,
    hanzoVisible: false,
  });
});

test('Stylized hero-shooter rendering pipeline enforces zero military grit, balanced anti-overexposure daylight, Half-Lambert lift, and Fresnel rim separation', async () => {
  const {
    STYLIZED_HERO_PIPELINE_SPEC,
    evaluateStylizedHalfLambert,
    evaluateStylizedRimFactor,
  } = await import('./roguelike.ts');

  // 1. Zero military-sim grit artifacts (no film grain, lens dirt, CA, rain wetness, or heavy vignette/shadow crush)
  assert.equal(STYLIZED_HERO_PIPELINE_SPEC.filmGrain, 0);
  assert.equal(STYLIZED_HERO_PIPELINE_SPEC.lensDirt, 0);
  assert.equal(STYLIZED_HERO_PIPELINE_SPEC.chromaticAberration, 0);
  assert.equal(STYLIZED_HERO_PIPELINE_SPEC.rainWetness, 0);
  assert.ok(STYLIZED_HERO_PIPELINE_SPEC.vignette <= 0.08, 'Vignette must stay minimal and clean');
  assert.ok(STYLIZED_HERO_PIPELINE_SPEC.lookPower <= 1.08, 'Gamma/contrast power must not crush shadow detail');
  assert.ok(STYLIZED_HERO_PIPELINE_SPEC.lookSat >= 1.22, 'Hero-shooter color grading must be vibrant');

  // 2. Calibrated daylight exposure window: never dark-crushed AND never over-exposed / clamped above 1.0
  assert.ok(
    STYLIZED_HERO_PIPELINE_SPEC.forwardExposureScale >= 0.75 &&
      STYLIZED_HERO_PIPELINE_SPEC.forwardExposureScale <= 0.92,
    'Forward ACES exposure must sit in balanced midtone window'
  );
  assert.ok(
    STYLIZED_HERO_PIPELINE_SPEC.postMinExposure >= 0.45 &&
      STYLIZED_HERO_PIPELINE_SPEC.postMinExposure <= 0.68,
    'Auto-exposure min shutter must allow stopping down in bright sunlight'
  );
  assert.ok(
    STYLIZED_HERO_PIPELINE_SPEC.postMaxExposure >= 0.90 &&
      STYLIZED_HERO_PIPELINE_SPEC.postMaxExposure <= 1.12,
    'Auto-exposure max gain must prevent interior-to-exterior blowout'
  );
  assert.ok(
    STYLIZED_HERO_PIPELINE_SPEC.sunIntensity >= 2.0 &&
      STYLIZED_HERO_PIPELINE_SPEC.sunIntensity <= 2.9,
    'Key sunlight must stay rich without bleaching sunlit plaster/stone'
  );
  assert.ok(
    STYLIZED_HERO_PIPELINE_SPEC.hemiIntensity >= 0.55 &&
      STYLIZED_HERO_PIPELINE_SPEC.hemiIntensity <= 0.85,
    'Hemisphere fill must lift shadows cleanly without washing out midtones'
  );

  // 3. Linear-space vibrant cerulean sky & grounded periwinkle horizon fog (never >0.75 linear whitewash)
  assert.ok(STYLIZED_HERO_PIPELINE_SPEC.skyZenithRgb[2] > STYLIZED_HERO_PIPELINE_SPEC.skyZenithRgb[0] * 8);
  assert.ok(STYLIZED_HERO_PIPELINE_SPEC.skyZenithRgb[2] <= 0.65);
  assert.ok(
    STYLIZED_HERO_PIPELINE_SPEC.fogColorRgb[2] >= 0.45 &&
      STYLIZED_HERO_PIPELINE_SPEC.fogColorRgb[2] <= 0.72 &&
      STYLIZED_HERO_PIPELINE_SPEC.fogColorRgb[0] <= 0.35,
    'Linear fog color must stay rich blue-lavender rather than white haze'
  );

  // 4. Half-Lambert terminator lift (`N·L = 0` yields `0.25` soft bounce instead of `0.0` harsh cutoff)
  assert.equal(evaluateStylizedHalfLambert(1, 0.5), 1);
  assert.ok(Math.abs(evaluateStylizedHalfLambert(0, 0.5) - 0.25) < 1e-6);
  assert.equal(evaluateStylizedHalfLambert(-1, 0.5), 0);

  // 5. Fresnel rim highlights peak cleanly at silhouette grazing angles (`N·V -> 0`) and vanish head-on (`N·V = 1`)
  assert.equal(evaluateStylizedRimFactor(1.0, 2.8, 1.2), 0);
  assert.ok(evaluateStylizedRimFactor(0.15, 2.8, 1.2) > evaluateStylizedRimFactor(0.65, 2.8, 1.2) * 5);
  assert.ok(Math.abs(evaluateStylizedRimFactor(0.0, 2.8, 1.2) - 1.2) < 1e-6);
});

test('Mid-run hero lock forbids switching outside title and Gunner & Hanzo drafts resolve 100% hero-authentic modules', async () => {
  const {
    UPGRADE_CATALOG,
    canSwitchHeroInState,
    draftUpgradeChoices,
    resolveUpgradeCardForHero,
    computeGunnerBuildStats,
    computeHanzoBuildStats,
  } = await import('./roguelike.ts');

  assert.equal(canSwitchHeroInState('title'), true);
  for (const lockedState of ['intro', 'playing', 'paused', 'upgrade', 'dead', 'complete']) {
    assert.equal(canSwitchHeroInState(lockedState), false, `Expected ${lockedState} to forbid hero switching`);
  }

  for (const raw of UPGRADE_CATALOG) {
    const gunnerCard = resolveUpgradeCardForHero(raw, 'gunner');
    const hanzoCard = resolveUpgradeCardForHero(raw, 'hanzo');
    const genjiCard = resolveUpgradeCardForHero(raw, 'genji');
    assert.notEqual(gunnerCard.title, genjiCard.title, `Expected distinct Gunner title for ${raw.id}`);
    assert.notEqual(hanzoCard.title, genjiCard.title, `Expected distinct Hanzo title for ${raw.id}`);
    assert.notEqual(hanzoCard.title, gunnerCard.title, `Expected distinct Hanzo vs Gunner title for ${raw.id}`);
    assert.ok(!gunnerCard.description.includes('手里剑') && !gunnerCard.description.includes('龙神剑'));
    assert.ok(!hanzoCard.description.includes('手里剑') && !hanzoCard.description.includes('脉冲步枪'));
  }

  const rng = createRng(2026);
  const gDraft = draftUpgradeChoices({}, rng, true, 'gunner');
  assert.equal(gDraft.length, 3);
  const pickedStacks = { [gDraft[0].id]: 1, deflect_iaido: 1 };
  const gStats = computeGunnerBuildStats(pickedStacks);
  assert.ok(gStats.bioticPulseShockwave >= 100, 'deflect_iaido grants Gunner Biotic EMP shockwave damage');

  const hDraft = draftUpgradeChoices({}, rng, true, 'hanzo');
  assert.equal(hDraft.length, 3);
  const hStats = computeHanzoBuildStats({ shuriken_penta: 1, deflect_iaido: 1, dragon_wave: 1 });
  assert.equal(hStats.stormArrowCount, 7);
  assert.ok(hStats.sonicPulseDamage >= 95);
  assert.ok(hStats.dragonstrikeRadius > 5.5);
});

test('Shimada Hanzo Storm Bow draw curve, Storm Arrow smart ricochet, and elimination cooldown refunds are deterministic', async () => {
  const {
    createBaseHanzoStats,
    computeHanzoBowDraw,
    computeStormArrowRicochet,
    applyHanzoEliminationReset,
  } = await import('./roguelike.ts');

  const stats = createBaseHanzoStats();
  const tapShot = computeHanzoBowDraw({ holdSeconds: 0, stats });
  assert.equal(tapShot.drawRatio, 0);
  assert.equal(tapShot.damage, stats.minArrowDamage);
  assert.equal(tapShot.speed, stats.minArrowSpeed);
  assert.equal(tapShot.isFullDraw, false);

  const fullShot = computeHanzoBowDraw({ holdSeconds: stats.fullDrawTime + 0.15, stats });
  assert.equal(fullShot.drawRatio, 1);
  assert.equal(fullShot.damage, stats.maxArrowDamage);
  assert.equal(fullShot.speed, stats.maxArrowSpeed);
  assert.ok(fullShot.gravityDrop < tapShot.gravityDrop, 'Full draw arrow flies flatter than tap shot');
  assert.equal(fullShot.isFullDraw, true);

  const stormShot = computeHanzoBowDraw({ holdSeconds: 0, stats, isStormArrow: true });
  assert.equal(stormShot.drawRatio, 1);
  assert.equal(stormShot.damage, stats.stormArrowDamage);
  assert.ok(stormShot.speed > stats.maxArrowSpeed);
  assert.equal(stormShot.isFullDraw, true);

  // Specular wall bounce without nearby enemy target
  const pureBounce = computeStormArrowRicochet({
    incidentDir: { x: 0.6, y: 0, z: -0.8 },
    surfaceNormal: { x: 0, y: 0, z: 1 },
  });
  assert.equal(pureBounce.snappedToTarget, false);
  assert.ok(Math.abs(pureBounce.outDir.x - 0.6) < 1e-5);
  assert.ok(Math.abs(pureBounce.outDir.z - 0.8) < 1e-5);

  // Smart target snap within reflection cone
  const smartBounce = computeStormArrowRicochet({
    incidentDir: { x: 0.6, y: 0, z: -0.8 },
    surfaceNormal: { x: 0, y: 0, z: 1 },
    candidateTargetDirs: [{ x: 0.72, y: 0.08, z: 0.68 }],
    minSnapCos: 0.72,
  });
  assert.equal(smartBounce.snappedToTarget, true);
  assert.ok(smartBounce.outDir.z > 0.6);

  // Elimination cooldown refund & ult charge
  const resetCd = applyHanzoEliminationReset(
    {
      sonicCd: 8.0,
      sonicArmed: false,
      sonicActiveT: 0,
      stormCd: 6.0,
      stormActiveT: 0,
      stormArrowsLeft: 0,
      lungeCd: 3.5,
      ultCharge: 20,
      dragonActiveT: 0,
      drawRatio: 0,
    },
    stats,
    true
  );
  assert.ok(resetCd.sonicCd < 6.0);
  assert.ok(resetCd.lungeCd < 1.2);
  assert.ok(resetCd.stormCd <= 4.0);
  assert.ok(resetCd.ultCharge > 40);
});

test('Genji canonical single-katana state machine strictly exposes 0 blades in shuriken stance and 1 katana in Q/E/V (never 2)', async () => {
  const { computeGenjiSingleBladeState } = await import('./roguelike.ts');

  const idleShuriken = computeGenjiSingleBladeState({
    isDragonblade: false,
    dragonSheatheT: 0,
    isDeflect: false,
    deflectOutroT: 0,
    meleeTimer: 0,
  });
  assert.deepEqual(idleShuriken, {
    katanaDrawn: false,
    visibleBladeCount: 0,
    mode: 'sheathed',
  });

  const deflectIai = computeGenjiSingleBladeState({
    isDragonblade: false,
    dragonSheatheT: 0,
    isDeflect: true,
    deflectOutroT: 0,
    meleeTimer: 0,
  });
  assert.equal(deflectIai.katanaDrawn, true);
  assert.equal(deflectIai.visibleBladeCount, 1);
  assert.equal(deflectIai.mode, 'deflect_iaido');

  const dragonQ = computeGenjiSingleBladeState({
    isDragonblade: true,
    dragonSheatheT: 0,
    isDeflect: false,
    deflectOutroT: 0,
    meleeTimer: 0,
  });
  assert.equal(dragonQ.katanaDrawn, true);
  assert.equal(dragonQ.visibleBladeCount, 1);
  assert.equal(dragonQ.mode, 'dragonblade');

  const quickMelee = computeGenjiSingleBladeState({
    isDragonblade: false,
    dragonSheatheT: 0,
    isDeflect: false,
    deflectOutroT: 0,
    meleeTimer: 0.22,
  });
  assert.equal(quickMelee.katanaDrawn, true);
  assert.equal(quickMelee.visibleBladeCount, 1);
  assert.equal(quickMelee.mode, 'quick_melee');
});

test('Sniper laser sight segment terminates safely in front of camera near plane and clamps cleanly on walls', async () => {
  const { computeSniperLaserSegment } = await import('./roguelike.ts');

  const playerEye = { x: 0, y: 1.65, z: 0 };
  const muzzle = { x: 0, y: 6.2, z: -28 };

  // Unobstructed shot: terminates >= 0.34m away from eye with chest Y offset so camera near plane (0.1m) never clips it
  const seg = computeSniperLaserSegment({
    muzzlePos: muzzle,
    playerEye,
    worldHitDist: null,
    nearPlaneGuard: 0.34,
  });
  assert.equal(seg.visible, true);
  const distToEye = Math.hypot(
    seg.end.x - playerEye.x,
    seg.end.y - playerEye.y,
    seg.end.z - playerEye.z
  );
  assert.ok(distToEye >= 0.30, `Expected sniper laser end >= 0.30m from eye, got ${distToEye}`);
  assert.ok(seg.end.z < -0.25, 'Laser endpoint must remain in front of player eye along ray');

  // Wall occlusion clamps beam length strictly at wall impact
  const blocked = computeSniperLaserSegment({
    muzzlePos: muzzle,
    playerEye,
    worldHitDist: 11.5,
    nearPlaneGuard: 0.34,
  });
  assert.equal(blocked.visible, true);
  assert.ok(Math.abs(blocked.length - 11.5) < 1e-5);

  // Point-blank safety hides beam cleanly instead of inverting direction
  const tooClose = computeSniperLaserSegment({
    muzzlePos: { x: 0, y: 1.6, z: -0.3 },
    playerEye,
    worldHitDist: null,
    nearPlaneGuard: 0.34,
  });
  assert.equal(tooClose.visible, false);
});

test('Landscape-only mobile policy blocks portrait phones while allowing all landscape mobile and desktop viewports', async () => {
  const { isPortraitViewportBlocked, shouldEnableTouchUi } = await import('./roguelike.ts');

  // Portrait phone & compact tablet viewports are blocked
  assert.equal(isPortraitViewportBlocked({ width: 390, height: 844 }), true);
  assert.equal(isPortraitViewportBlocked({ width: 430, height: 932 }), true);
  assert.equal(isPortraitViewportBlocked({ width: 768, height: 1024 }), true);

  // Landscape phone viewports (`844x390`, `932x430`, `812x375`) and desktop (`1440x900`, `1920x1080`) are allowed
  assert.equal(isPortraitViewportBlocked({ width: 844, height: 390 }), false);
  assert.equal(isPortraitViewportBlocked({ width: 932, height: 430 }), false);
  assert.equal(isPortraitViewportBlocked({ width: 812, height: 375 }), false);
  assert.equal(isPortraitViewportBlocked({ width: 1440, height: 900 }), false);
  assert.equal(isPortraitViewportBlocked({ width: 1920, height: 1080 }), false);

  // Large landscape phones (`932x430`, `980x440`) enable touch UI cleanly while desktop (`1440x900`) stays mouse/keyboard
  assert.equal(shouldEnableTouchUi({ viewportWidth: 932, viewportHeight: 430 }), true);
  assert.equal(shouldEnableTouchUi({ viewportWidth: 980, viewportHeight: 440 }), true);
  assert.equal(shouldEnableTouchUi({ viewportWidth: 1440, viewportHeight: 900 }), false);
});

test('Biomechanical robot locomotion prevents moonwalking, eliminates idle leg skating, and banks drones into velocity', async () => {
  const {
    computeBipedalGaitPose,
    computeMultiLegGaitPose,
    computeDroneAerodynamicTilt,
  } = await import('./rules.ts');

  // 1. Bipedal gait: forward swing (`phase = 0`, `d(hipL)/d(phase) > 0`) lifts left knee higher than backward stance (`phase = π`)
  const midForwardSwingL = computeBipedalGaitPose(0, 1.0, 0);
  const midStancePushL = computeBipedalGaitPose(Math.PI, 1.0, 0);
  assert.ok(
    midForwardSwingL.kneeL > midStancePushL.kneeL + 0.5,
    `Forward swing kneeL (${midForwardSwingL.kneeL}) must exceed stance kneeL (${midStancePushL.kneeL})`
  );
  assert.ok(
    midStancePushL.kneeR > midForwardSwingL.kneeR + 0.5,
    'Opposite leg R lifts during phase = π forward swing'
  );

  // Double-frequency pelvic vaulting: mid-stance (`phase = 0`) vaults higher than double-support (`phase = π/2`)
  const doubleSupport = computeBipedalGaitPose(Math.PI / 2, 1.0, 0);
  assert.ok(midForwardSwingL.pelvisBob > doubleSupport.pelvisBob + 0.04);

  // Stationary (`speedNorm = 0`): zero hip/pelvis/twist oscillation across phases (no stationary foot paddling)
  const idleA = computeBipedalGaitPose(0.4, 0, 0);
  const idleB = computeBipedalGaitPose(2.3, 0, 0);
  assert.ok(Math.abs(idleA.hipL) === 0 && Math.abs(idleB.hipL) === 0);
  assert.ok(Math.abs(idleA.torsoTwist) === 0 && Math.abs(idleB.torsoTwist) === 0);

  // 2. Multi-leg arthropod gait (`spider_mech` / `mortar_crab`): zero motion when idle, 62% grounded stance + 38% lifted swing
  const spiderIdle = computeMultiLegGaitPose({
    phase: 1.7,
    moveIntensity: 0,
    turnRateNorm: 0,
    groupIndex: 0,
    side: 1,
  });
  assert.equal(spiderIdle.coxaYawDelta, 0);
  assert.equal(spiderIdle.femurLift, 0);
  assert.equal(spiderIdle.tibiaFlex, 0);
  assert.equal(spiderIdle.isGrounded, true);

  // At phase = 0.25 * 2π (`u = 0.25 < 0.62`), group 0 is planted in grounded stance while group 1 (`u = 0.75 >= 0.62`) is in arched swing!
  const group0Stance = computeMultiLegGaitPose({
    phase: 0.25 * Math.PI * 2,
    moveIntensity: 1.0,
    turnRateNorm: 0,
    groupIndex: 0,
    side: 1,
  });
  const group1Swing = computeMultiLegGaitPose({
    phase: 0.25 * Math.PI * 2,
    moveIntensity: 1.0,
    turnRateNorm: 0,
    groupIndex: 1,
    side: 1,
  });
  assert.equal(group0Stance.isGrounded, true);
  assert.equal(group0Stance.femurLift, 0);
  assert.equal(group0Stance.tibiaFlex, 0);
  assert.equal(group1Swing.isGrounded, false);
  assert.ok(group1Swing.femurLift > 0.15 && group1Swing.tibiaFlex > 0.10);

  // 3. Quadcopter aerodynamic banking: nose pitches down (`pitch > 0`) into forward travel and rolls into lateral strafe across any world yaw
  for (const yaw of [0, Math.PI / 2, -Math.PI * 0.75]) {
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    const cruiseFwd = computeDroneAerodynamicTilt({
      velX: fwdX * 8,
      velZ: fwdZ * 8,
      accelX: fwdX * 3,
      accelZ: fwdZ * 3,
      yaw,
    });
    assert.ok(cruiseFwd.pitch > 0.25, `Expected positive nose-down pitch at yaw=${yaw}, got ${cruiseFwd.pitch}`);
    assert.ok(Math.abs(cruiseFwd.roll) < 1e-6);

    const strafeRight = computeDroneAerodynamicTilt({
      velX: rightX * 7,
      velZ: rightZ * 7,
      accelX: rightX * 2,
      accelZ: rightZ * 2,
      yaw,
    });
    assert.ok(strafeRight.roll < -0.22, `Expected negative roll banking right at yaw=${yaw}, got ${strafeRight.roll}`);
    assert.ok(Math.abs(strafeRight.pitch) < 1e-6);
  }
});
