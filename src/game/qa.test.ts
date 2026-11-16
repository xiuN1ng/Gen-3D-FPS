import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCoplanarZFighting,
  runCharacterStateMachineChecks,
  runFullQaSuite,
  runNumericalBalanceChecks,
  runPerformanceBudgetChecks,
  runProceduralObjectChecks,
  runTextureSanityChecks,
} from './qaPipeline.ts';

test('QA Detector Self-Check: detectCoplanarZFighting catches overlapping different-material slabs and ignores separated planes', () => {
  const overlapping = detectCoplanarZFighting([
    {
      matKey: 'villageCobble',
      axis: 1,
      sign: 1,
      plane: 0.002, // Within 6mm Z-fighting threshold of y=0.00 ground apron!
      minU: -20,
      maxU: -10,
      minV: -5,
      maxV: 5,
      area: 100,
    },
  ]);
  assert.equal(overlapping.length, 1);
  assert.equal(overlapping[0].matA, 'villageCobble');
  assert.equal(overlapping[0].matB, '__groundApron');
  assert.equal(overlapping[0].overlapArea, 100);

  const separated = detectCoplanarZFighting([
    {
      matKey: 'graniteSteps',
      axis: 1,
      sign: 1,
      plane: 0.24, // Properly raised stone curb/plinth (24cm above ground) -> zero Z-fighting!
      minU: -20,
      maxU: -10,
      minV: -5,
      maxV: 5,
      area: 100,
    },
  ]);
  assert.equal(separated.length, 0);
});

test('QA Pillar 1 [生成式物件合理性检查]: Hanamura scene, enemy rigs & hero weapons pass geometry bounds & 0 Z-fighting overlaps', async () => {
  const report = await runProceduralObjectChecks();
  assert.equal(
    report.passed,
    true,
    `Procedural Object QA failures:\n${report.failures.join('\n')}`
  );
  assert.equal(report.metrics.coplanarZFightingConflicts, 0);
});

test('QA Pillar 2 [贴图合理性检查]: All Hanamura PBR maps & CanvasTextures pass dimensions, variance, luminance, normal Z>0 & colorSpace', async () => {
  const report = await runTextureSanityChecks();
  assert.equal(
    report.passed,
    true,
    `Texture Sanity QA failures:\n${report.failures.join('\n')}`
  );
});

test('QA Pillar 3 [性能检测]: Static world batching (>95% reduction), scene draw-call budget (<=220), instancing & CPU update budget', async () => {
  const report = await runPerformanceBudgetChecks();
  assert.equal(
    report.passed,
    true,
    `Performance Budget QA failures:\n${report.failures.join('\n')}`
  );
  assert.ok(
    Number(report.metrics.combinedSceneDrawCalls) <= 220,
    `Expected combined scene draw calls <= 220, got ${report.metrics.combinedSceneDrawCalls}`
  );
});

test('QA Pillar 4 [角色状态机检测]: Mid-run hero lock, clean restart-on-reselect, authentic Gunner/Genji talents & skill FSMs', async () => {
  const report = await runCharacterStateMachineChecks();
  assert.equal(
    report.passed,
    true,
    `Character State Machine QA failures:\n${report.failures.join('\n')}`
  );
});

test('QA Pillar 5 [数值检测]: Genji vs Gunner DPS/TTK parity, projectile velocity floors, max-stack cooldown floors & Wave 1-15 scaling', async () => {
  const report = await runNumericalBalanceChecks();
  assert.equal(
    report.passed,
    true,
    `Numerical Balance QA failures:\n${report.failures.join('\n')}`
  );
});

test('QA Unified Runner [全量流水线汇总]: runFullQaSuite executes all 5 QA pillars cleanly with 0 failed assertions', async () => {
  const full = await runFullQaSuite();
  assert.equal(full.allPassed, true, `Full QA Suite had ${full.failedChecks} failed assertions`);
  assert.ok(full.totalChecks >= 24, `Expected >= 24 QA assertions, got ${full.totalChecks}`);
});
