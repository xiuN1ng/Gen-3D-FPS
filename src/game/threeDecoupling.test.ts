import './headlessDomShim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  mergeAttributes,
  mergeGeometries,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  bootArenaEngine,
  getHeadlessEnginePrimitives,
  type BootArenaOptions,
  type HeadlessEnginePrimitives,
} from './engine.ts';

const GAME_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(GAME_DIR, '..');
const ENGINE_PATH = path.join(GAME_DIR, 'engine.ts');
const BASELINE_ENGINE_BYTES = 1_434_499;

function walkFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFilesRecursive(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

test('Official three r180 and BufferGeometryUtils resolve from standard npm package', () => {
  assert.equal(THREE.REVISION, '180');
  assert.equal(typeof mergeGeometries, 'function');
  assert.equal(typeof mergeAttributes, 'function');

  const boxA = new THREE.BoxGeometry(1, 1, 1);
  const boxB = new THREE.BoxGeometry(1, 1, 1);
  boxB.translate(2, 0, 0);
  const merged = mergeGeometries([boxA, boxB], false);
  assert.ok(merged instanceof THREE.BufferGeometry);
  assert.equal(
    merged.getAttribute('position').count,
    boxA.getAttribute('position').count + boxB.getAttribute('position').count,
  );
  boxA.dispose();
  boxB.dispose();
  merged.dispose();
});

test('getHeadlessEnginePrimitives exposes exact npm THREE reference, caches singleton, and does not trigger browser boot', () => {
  const opts: BootArenaOptions = { headlessThree: true };
  assert.equal(opts.headlessThree, true);

  const primsA: HeadlessEnginePrimitives = getHeadlessEnginePrimitives();
  const primsB = getHeadlessEnginePrimitives();
  const contractCheck: { THREE: typeof THREE; createPhysics: (G?: unknown) => unknown } = primsA;
  assert.equal(contractCheck.THREE, THREE);
  assert.equal(primsA, primsB, 'Expected getHeadlessEnginePrimitives() to return cached singleton');
  assert.equal(primsA.THREE, THREE, 'Expected HeadlessEnginePrimitives.THREE === npm THREE');
  assert.equal(primsA.THREE.Vector3, THREE.Vector3);
  assert.equal(primsA.THREE.WebGLRenderer, THREE.WebGLRenderer);
  assert.equal(primsA.THREE.ShaderChunk, THREE.ShaderChunk);
  assert.equal(primsA.THREE.FloatType, THREE.FloatType);
  assert.equal(typeof primsA.createPhysics, 'function');

  const directHeadless = bootArenaEngine({ headlessThree: true });
  assert.equal(directHeadless.THREE, THREE);
  assert.equal(typeof directHeadless.createPhysics, 'function');
  assert.notEqual(
    (window as unknown as Record<string, unknown>).__ARENA_BOOTED__,
    true,
    'Headless boot must not set browser __ARENA_BOOTED__ flag',
  );
});

test('engine.ts strips inline Three.js and BufferGeometryUtils (~705 KB reduction) while remaining real TypeScript source', () => {
  const stat = fs.statSync(ENGINE_PATH);
  const shrunkBytes = BASELINE_ENGINE_BYTES - stat.size;

  assert.ok(
    stat.size < 780_000,
    `Expected engine.ts < 780,000 bytes after stripping inline Three.js, got ${stat.size}`,
  );
  assert.ok(
    shrunkBytes >= 650_000,
    `Expected engine.ts reduction >= 650,000 bytes from ${BASELINE_ENGINE_BYTES} baseline, got ${shrunkBytes}`,
  );
  assert.ok(
    stat.size > 100_000,
    `Expected engine.ts to retain typed arena runtime in TypeScript (> 100,000 bytes), got ${stat.size}`,
  );

  const src = fs.readFileSync(ENGINE_PATH, 'utf8');
  const inlineThreeNamespaceSig = 'var lt={};' + 'br(lt,';
  const inlineThreeRevSig = 'M2=' + '"180"';
  const inlineBguSig = 'THREE.BufferGeometryUtils:' + ' .mergeGeometries()';
  const inlineMergeGeoFnSig = 'function sa(' + 'i,e=!1)';

  assert.equal(
    src.includes(inlineThreeNamespaceSig),
    false,
    'Inline minified Three.js namespace table must be stripped from engine.ts',
  );
  assert.equal(
    src.includes(inlineThreeRevSig),
    false,
    'Inline minified Three.js REVISION constant must be stripped from engine.ts',
  );
  assert.equal(
    src.includes(inlineBguSig),
    false,
    'Inline BufferGeometryUtils implementation must be stripped from engine.ts',
  );
  assert.equal(
    src.includes(inlineMergeGeoFnSig),
    false,
    'Inline mergeGeometries implementation must be stripped from engine.ts',
  );
  assert.match(src, /from\s+['"]three['"]/);
  assert.match(src, /BufferGeometryUtils\.js['"]/);
});

test('Zero TypeScript compiler suppression directives exist anywhere under src/', () => {
  const directives = [
    '@' + 'ts-nocheck',
    '@' + 'ts-ignore',
    '@' + 'ts-expect-error',
  ];
  const tsExts = new Set(['.ts', '.tsx', '.mts', '.cts']);
  const violations: string[] = [];

  for (const file of walkFilesRecursive(SRC_DIR)) {
    if (!tsExts.has(path.extname(file).toLowerCase())) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const directive of directives) {
        if (lines[i].includes(directive)) {
          violations.push(`${path.relative(SRC_DIR, file)}:${i + 1} contains ${directive}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('Zero unchecked JavaScript files (.js, .mjs, .cjs, .jsx) exist anywhere under src/', () => {
  const jsExts = new Set(['.js', '.mjs', '.cjs', '.jsx']);
  const jsFiles = walkFilesRecursive(SRC_DIR)
    .filter((file) => jsExts.has(path.extname(file).toLowerCase()))
    .map((file) => path.relative(SRC_DIR, file));

  assert.deepEqual(jsFiles, []);
});

test('createPhysics() operates cleanly in headless mode across zero-arg ground hits, AABB CRUD, raycast, LOS, groundHeight, moveCapsule, and A* nav', () => {
  const { createPhysics } = getHeadlessEnginePrimitives();

  // 1. Zero-argument and null-argument createPhysics() safety on default y=0 ground plane
  const phys = createPhysics();
  const nullPhys = createPhysics(null);
  assert.equal(phys.boxes.length, 0);
  assert.equal(phys.bounds.min.x, -94);
  assert.equal(phys.bounds.max.x, 94);

  const groundHit = phys.raycast(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0), 20);
  assert.ok(groundHit !== null, 'Expected downward raycast to hit y=0 ground plane');
  assert.ok(Math.abs(groundHit.dist - 5) < 1e-6);
  assert.equal(groundHit.normal.y, 1);
  assert.equal(groundHit.surface, 'concrete');
  assert.equal(groundHit.box, null);

  const nullGroundHit = nullPhys.raycast(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, -1, 0), 10);
  assert.ok(nullGroundHit !== null);
  assert.equal(nullGroundHit.surface, 'concrete');

  const dropPos = new THREE.Vector3(0, 0.15, 0);
  const dropVel = new THREE.Vector3(0, -4, 0);
  const dropRes = phys.moveCapsule(dropPos, dropVel, 0.1);
  assert.equal(dropRes.onGround, true);
  assert.equal(dropRes.surface, 'concrete');
  assert.equal(dropPos.y, 0);

  // 2. addBox (tuple & Vector3), groundHeight, raycast, lineOfSight, air-wall projectile pass-through, and removeBox
  const wall = phys.addBox([-2, 0, -5], [2, 3, -4], { surface: 'stone', tag: 'wall-main' });
  const bulletOnlyBox = phys.addBox(
    new THREE.Vector3(-1, 0, 4),
    new THREE.Vector3(1, 4, 6),
    { surface: 'glass', bulletOnly: true },
  );
  const airWall = phys.addBox([-10, 0, -12], [10, 20, -11], { tag: 'air-wall-north-test' });
  assert.equal(phys.boxes.length, 3);

  assert.equal(phys.groundHeight(0, -4.5), 3);
  assert.equal(phys.groundHeight(0, -4.5, 2.0), 0, 'Boxes taller than maxY must be ignored');
  assert.equal(phys.groundHeight(0, 5), 0, 'bulletOnly boxes must not contribute to groundHeight');

  const wallHit = phys.raycast(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 0, -1), 20);
  assert.ok(wallHit !== null);
  assert.ok(Math.abs(wallHit.dist - 4) < 1e-6);
  assert.equal(wallHit.normal.z, 1);
  assert.equal(wallHit.surface, 'stone');
  assert.equal(wallHit.box, wall);

  assert.equal(phys.lineOfSight(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 1.5, -8)), false);
  assert.equal(phys.lineOfSight(new THREE.Vector3(6, 1.5, 0), new THREE.Vector3(6, 1.5, -8)), true);

  // Air-walls pass projectiles (raycast skips tag starting with 'air-wall')
  const airRay = phys.raycast(new THREE.Vector3(0, 10, -8), new THREE.Vector3(0, 0, -1), 10);
  assert.equal(airRay, null, 'air-wall colliders must let projectile raycasts pass through');

  phys.removeBox(wall);
  assert.equal(phys.boxes.length, 2);
  assert.equal(phys.groundHeight(0, -4.5), 0);
  assert.equal(phys.lineOfSight(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 1.5, -8)), true);
  phys.removeBox(bulletOnlyBox);

  // 3. moveCapsule: solid wall blocking, air-wall blocking, and <= 0.42m step-up
  phys.addBox([-2, 0, -5], [2, 3, -4], { surface: 'stone', tag: 'wall-readded' });
  const capPos = new THREE.Vector3(0, 0, -3.2);
  const capVel = new THREE.Vector3(0, 0, -10);
  const wallMove = phys.moveCapsule(capPos, capVel, 0.2, 0.4, 1.8, true);
  assert.equal(wallMove.hitWall, true);
  assert.ok(capPos.z >= -3.6001, `Expected capsule blocked at z >= -3.6, got ${capPos.z}`);

  const airCapPos = new THREE.Vector3(0, 5, -10.4);
  const airCapVel = new THREE.Vector3(0, 0, -10);
  const airMove = phys.moveCapsule(airCapPos, airCapVel, 0.2, 0.4, 1.8, false);
  assert.equal(airMove.hitWall, true, 'air-wall colliders must still block capsule movement');
  phys.removeBox(airWall);

  // Low step (0.35m <= 0.42m step height) climbs cleanly
  phys.addBox([8, 0, -2], [12, 0.35, 2], { surface: 'wood' });
  const stepPos = new THREE.Vector3(7.5, 0, 0);
  const stepVel = new THREE.Vector3(8, 0, 0);
  const stepMove = phys.moveCapsule(stepPos, stepVel, 0.2, 0.32, 1.8, true);
  assert.equal(stepMove.hitWall, false);
  assert.equal(stepMove.onGround, true);
  assert.equal(stepMove.surface, 'wood');
  assert.ok(Math.abs(stepPos.y - 0.35) < 1e-6);

  // 4. 2D NavGrid & octile A* pathfinding around obstacle
  const navPhys = createPhysics();
  navPhys.addBox([-3, 0, -1], [3, 2.5, 1], { surface: 'stone' });
  navPhys.build();

  assert.equal(navPhys.nav.cell, 0.75);
  assert.equal(navPhys.nav.isWalkable(0, 0), false);
  assert.equal(navPhys.nav.isWalkable(0, -6), true);
  assert.equal(navPhys.nav.isWalkable(0, 6), true);
  assert.equal(
    navPhys.nav.clearLine(new THREE.Vector3(0, 0, -6), new THREE.Vector3(0, 0, 6)),
    false,
  );

  const pathNodes = navPhys.nav.findPath(
    new THREE.Vector3(0, 0, -6),
    new THREE.Vector3(0, 0, 6),
  );
  assert.ok(Array.isArray(pathNodes) && pathNodes.length >= 2, 'Expected valid A* detour path');
  for (const wp of pathNodes) {
    assert.equal(navPhys.nav.isWalkable(wp.x, wp.z), true);
  }
  const lastWp = pathNodes[pathNodes.length - 1];
  assert.equal(lastWp.x, 0);
  assert.equal(lastWp.z, 6);

  const samplePt = navPhys.nav.randomPoint(new THREE.Vector3(12, 0, 12), 4);
  assert.equal(navPhys.nav.isWalkable(samplePt.x, samplePt.z), true);
});
