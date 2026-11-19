import { SystemPipeline, World } from '../engine/ecs/index.ts';
import type { EcsCombatBridge } from './ecsCombatBridge.ts';
import type { SpatialArenaPhysics } from './spatialPhysicsAdapter.ts';

export interface PerfHudPhaseInput {
  dt: number;
  rawFrameSec: number;
  runInput: () => void;
  runGameplayAndPlayer: () => void;
  runWeapon: () => void;
  runEnemies: () => void;
  runWorldAndAudioHud: () => void;
  runRender: () => void;
}

export interface PerfHudController {
  readonly world: World;
  readonly pipeline: SystemPipeline;
  readonly expanded: boolean;
  stepFrame: (input: PerfHudPhaseInput) => void;
  toggleExpanded: () => void;
  toggleSpatialAcceleration: () => void;
  dispose: () => void;
}

const FRAME_WINDOW = 240;
const SPARK_BARS = 80;
const TEXT_REFRESH_SEC = 0.16;

export function createPerfHud(G: Record<string, any>): PerfHudController {
  const world = G.ecsWorld instanceof World ? G.ecsWorld : new World({ maxEntities: 2048 });
  G.ecsWorld = world;

  const pipeline = new SystemPipeline(world, {
    emaAlpha: 0.12,
    flushAfterEachPhase: false,
    clearEventsAfterTick: true,
  });

  let currentPhaseInput: PerfHudPhaseInput | null = null;

  pipeline
    .addSystem({
      name: 'input',
      phase: 'input',
      budgetMs: 0.5,
      execute() {
        currentPhaseInput?.runInput();
      },
    })
    .addSystem({
      name: 'mobility_game',
      phase: 'mobility',
      budgetMs: 2.0,
      execute() {
        currentPhaseInput?.runGameplayAndPlayer();
      },
    })
    .addSystem({
      name: 'combat_weapon',
      phase: 'projectile',
      budgetMs: 1.5,
      execute() {
        currentPhaseInput?.runWeapon();
      },
    })
    .addSystem({
      name: 'ecs_broadphase',
      phase: 'broadphase',
      budgetMs: 0.5,
      execute() {
        const ecs = G.ecsCombat as EcsCombatBridge | undefined;
        ecs?.syncProjectiles();
      },
    })
    .addSystem({
      name: 'ai_enemies',
      phase: 'combat',
      budgetMs: 2.5,
      execute() {
        currentPhaseInput?.runEnemies();
      },
    })
    .addSystem({
      name: 'world_fx_hud',
      phase: 'cleanup',
      budgetMs: 2.0,
      execute() {
        currentPhaseInput?.runWorldAndAudioHud();
      },
    })
    .addSystem({
      name: 'webgl_render',
      phase: 'telemetry',
      budgetMs: 8.0,
      execute() {
        currentPhaseInput?.runRender();
      },
    });

  // Zero-GC TypedArray frame-time & sparkline ring buffers
  const frameMsRing = new Float32Array(FRAME_WINDOW);
  const frameSortScratch = new Float32Array(FRAME_WINDOW);
  const sparkMsRing = new Float32Array(SPARK_BARS);
  const sparkPhysRing = new Float32Array(SPARK_BARS);

  let frameRingHead = 0;
  let frameRingCount = 0;
  let sparkHead = 0;
  let uiRefreshAcc = TEXT_REFRESH_SEC;
  let isExpanded = true;

  // Enable microsecond physics & ECS combat query timing while HUD is active
  const phys = G.physics as SpatialArenaPhysics | undefined;
  if (phys && phys.telemetry) {
    phys.telemetry.setTimingEnabled(true);
  }
  const initEcs = G.ecsCombat as EcsCombatBridge | undefined;
  if (initEcs && initEcs.telemetry) {
    initEcs.telemetry.setTimingEnabled(true);
  }

  // Build sleek non-intrusive DOM overlay in #app
  const appEl =
    typeof document !== 'undefined' ? document.getElementById('app') : null;

  const root = document.createElement('aside');
  root.id = 'perf-hud';
  root.setAttribute('aria-label', '实时性能监控面板');
  root.style.cssText = [
    'position:absolute',
    'top:calc(52px + env(safe-area-inset-top, 0px))',
    'right:max(14px, env(safe-area-inset-right, 0px))',
    'z-index:85',
    'width:274px',
    'padding:8px 10px 9px',
    'background:rgba(9, 13, 18, 0.80)',
    'backdrop-filter:blur(6px)',
    '-webkit-backdrop-filter:blur(6px)',
    'border:1px solid rgba(60, 255, 120, 0.28)',
    'border-left:2.5px solid #3cff78',
    'border-radius:4px',
    'color:#e8e4da',
    'font:500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    'font-variant-numeric:tabular-nums',
    'pointer-events:auto',
    'user-select:none',
    'box-shadow:0 4px 18px rgba(0,0,0,0.48)',
    'transition:width 0.16s ease, padding 0.16s ease, opacity 0.16s ease',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;gap:6px;cursor:pointer;';

  const titleSpan = document.createElement('span');
  titleSpan.style.cssText =
    'font-weight:700;letter-spacing:0.06em;color:#3cff78;white-space:nowrap;';
  titleSpan.textContent = '⚡ ECS · PERF [F3]';

  const fpsBadge = document.createElement('span');
  fpsBadge.style.cssText =
    'font-weight:800;font-size:13px;color:#3cff78;white-space:nowrap;';
  fpsBadge.textContent = '-- FPS';

  header.append(titleSpan, fpsBadge);

  const body = document.createElement('div');
  body.style.cssText = 'margin-top:6px;display:flex;flex-direction:column;gap:5px;';

  const frameStatsLine = document.createElement('div');
  frameStatsLine.style.cssText =
    'display:flex;justify-content:space-between;color:rgba(232,228,218,0.88);font-size:10.5px;';
  frameStatsLine.textContent = '1% Low: -- | Frame: -- ms';

  const canvas = document.createElement('canvas');
  canvas.width = SPARK_BARS * 3;
  canvas.height = 38;
  canvas.style.cssText =
    'width:100%;height:34px;display:block;background:rgba(4,7,10,0.72);border-radius:2px;border:1px solid rgba(232,228,218,0.12);';
  const ctx2d = canvas.getContext('2d');

  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.style.cssText = [
    'width:100%',
    'padding:3px 6px',
    'border-radius:3px',
    'border:1px solid rgba(60,255,120,0.42)',
    'background:rgba(24,56,38,0.55)',
    'color:#7dffaa',
    'font:700 10.5px/1.3 ui-monospace, monospace',
    'cursor:pointer',
    'text-align:left',
    'display:flex',
    'justify-content:space-between',
    'align-items:center',
  ].join(';');
  modeBtn.innerHTML = '<span>加速: SpatialHashGrid ⚡</span><span style="opacity:.8">[F4]</span>';

  const physLine = document.createElement('div');
  physLine.style.cssText = 'color:#9fe8ff;font-size:10.5px;white-space:pre;';
  physLine.textContent = 'Phys: 0.000 ms | Q: 0R 0G 0C\nGrid: 0 boxes · 0 nodes';

  const ecsEntityLine = document.createElement('div');
  ecsEntityLine.style.cssText =
    'color:#98ffc1;font-size:10px;white-space:pre;border-top:1px solid rgba(232,228,218,0.12);padding-top:4px;';
  ecsEntityLine.textContent = 'ECS: 0 ent (0敌 · 0弹) | 0.000 ms\nBroad: 0Ray 0AoE | DmgEv: 0/s';

  const ecsLine = document.createElement('div');
  ecsLine.style.cssText =
    'color:rgba(232,228,218,0.78);font-size:10px;white-space:pre;border-top:1px solid rgba(232,228,218,0.12);padding-top:4px;';
  ecsLine.textContent = 'Move -- | Wpn -- | AI --\nFX --   | GPU-Sub -- ms';

  const renderLine = document.createElement('div');
  renderLine.style.cssText =
    'color:rgba(255,195,110,0.92);font-size:10px;border-top:1px solid rgba(232,228,218,0.12);padding-top:4px;';
  renderLine.textContent = 'DC: -- | Tris: -- | Scale: --';

  body.append(frameStatsLine, canvas, modeBtn, physLine, ecsEntityLine, ecsLine, renderLine);
  root.append(header, body);

  if (appEl) {
    appEl.appendChild(root);
  }

  function isSpatialActive(): boolean {
    if (phys?.telemetry) return phys.telemetry.spatialAccelerated;
    const ecs = G.ecsCombat as EcsCombatBridge | undefined;
    if (ecs?.telemetry) return ecs.telemetry.spatialAccelerated;
    return true;
  }

  function syncModeButtonVisual(): void {
    const active = isSpatialActive();
    if (active) {
      modeBtn.style.borderColor = 'rgba(60,255,120,0.45)';
      modeBtn.style.background = 'rgba(24,56,38,0.55)';
      modeBtn.style.color = '#7dffaa';
      modeBtn.innerHTML =
        '<span>加速: SpatialHashGrid ⚡</span><span style="opacity:.8">[F4 对比]</span>';
    } else {
      modeBtn.style.borderColor = 'rgba(255,110,72,0.65)';
      modeBtn.style.background = 'rgba(72,24,18,0.65)';
      modeBtn.style.color = '#ff9d80';
      modeBtn.innerHTML =
        '<span>加速: Legacy O(N) 旧遍历</span><span style="opacity:.85">[F4 切回]</span>';
    }
  }

  function toggleExpanded(): void {
    isExpanded = !isExpanded;
    body.style.display = isExpanded ? 'flex' : 'none';
    root.style.width = isExpanded ? '274px' : '168px';
    root.style.padding = isExpanded ? '8px 10px 9px' : '5px 8px';
    titleSpan.textContent = isExpanded ? '⚡ ECS · PERF [F3]' : '⚡ [F3]';
  }

  function toggleSpatialAcceleration(): void {
    const next = !isSpatialActive();
    if (phys && phys.telemetry) {
      phys.telemetry.setSpatialAccelerated(next);
    }
    const ecs = G.ecsCombat as EcsCombatBridge | undefined;
    if (ecs && ecs.telemetry) {
      ecs.telemetry.setSpatialAccelerated(next);
    }
    syncModeButtonVisual();
  }

  header.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleExpanded();
  });

  modeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleSpatialAcceleration();
  });

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.repeat) return;
    if (ev.code === 'F3') {
      ev.preventDefault();
      toggleExpanded();
    } else if (ev.code === 'F4') {
      ev.preventDefault();
      toggleSpatialAcceleration();
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
  }

  function drawSparkline(): void {
    if (!ctx2d || !isExpanded) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx2d.clearRect(0, 0, w, h);

    // 16.7ms (60 FPS) & 8.3ms (120 FPS) reference lines (full scale = 25ms)
    const maxScaleMs = 25;
    const y60 = h - (16.67 / maxScaleMs) * h;
    const y120 = h - (8.33 / maxScaleMs) * h;

    ctx2d.fillStyle = 'rgba(255, 179, 71, 0.22)';
    ctx2d.fillRect(0, Math.round(y60), w, 1);
    ctx2d.fillStyle = 'rgba(60, 255, 120, 0.18)';
    ctx2d.fillRect(0, Math.round(y120), w, 1);

    const barW = w / SPARK_BARS;
    for (let i = 0; i < SPARK_BARS; i++) {
      const idx = (sparkHead + i) % SPARK_BARS;
      const ms = sparkMsRing[idx];
      if (ms <= 0) continue;
      const barH = Math.min(h, Math.max(1, (ms / maxScaleMs) * h));
      ctx2d.fillStyle =
        ms <= 17.2 ? '#3cff78' : ms <= 24.0 ? '#ffb347' : '#ff5a40';
      ctx2d.fillRect(i * barW, h - barH, Math.max(1, barW - 1), barH);

      const pMs = sparkPhysRing[idx];
      if (pMs > 0.01) {
        // Overlay static physics + dynamic ECS combat ms amplified x5 in cyan
        const pH = Math.min(h, Math.max(1, ((pMs * 5) / maxScaleMs) * h));
        ctx2d.fillStyle = '#4ad8ff';
        ctx2d.fillRect(i * barW, h - pH, Math.max(1, barW - 1), pH);
      }
    }
  }

  function refreshMetricsDom(): void {
    if (frameRingCount === 0) return;

    let sumMs = 0;
    for (let i = 0; i < frameRingCount; i++) {
      const v = frameMsRing[i];
      sumMs += v;
      frameSortScratch[i] = v;
    }

    // Insertion sort on scratch slice [0..frameRingCount-1] (zero allocation)
    for (let i = 1; i < frameRingCount; i++) {
      const key = frameSortScratch[i];
      let j = i - 1;
      while (j >= 0 && frameSortScratch[j] > key) {
        frameSortScratch[j + 1] = frameSortScratch[j];
        j--;
      }
      frameSortScratch[j + 1] = key;
    }

    const avgMs = sumMs / frameRingCount;
    const p99Idx = Math.min(frameRingCount - 1, Math.floor(frameRingCount * 0.99));
    const p99Ms = frameSortScratch[p99Idx];
    const fps = avgMs > 0.01 ? 1000 / avgMs : 0;
    const low1Fps = p99Ms > 0.01 ? 1000 / p99Ms : 0;

    fpsBadge.textContent = `${fps.toFixed(0)} FPS`;
    fpsBadge.style.color =
      fps >= 55 ? '#3cff78' : fps >= 35 ? '#ffb347' : '#ff5a40';

    if (!isExpanded) return;

    frameStatsLine.textContent = `1% Low: ${low1Fps.toFixed(0)} FPS | ${avgMs.toFixed(1)}ms (p99 ${p99Ms.toFixed(1)})`;

    if (phys && phys.telemetry) {
      const pt = phys.telemetry;
      const rCalls = pt.raycastCalls + pt.losCalls;
      physLine.textContent =
        `Phys: ${pt.emaPhysicsMs.toFixed(3)} ms (last ${pt.lastPhysicsMs.toFixed(3)})\n` +
        `Q/f: ${rCalls}Ray ${pt.groundCalls}Grd ${pt.capsuleCalls}Cap | ${pt.activeColliders} box`;
    }

    const ecs = G.ecsCombat as EcsCombatBridge | undefined;
    if (ecs && ecs.telemetry) {
      const et = ecs.telemetry;
      ecsEntityLine.textContent =
        `ECS: ${et.activeEntities} ent (${et.enemyEntities}敌 · ${et.projectileEntities}弹) | ${et.emaCombatMs.toFixed(3)} ms\n` +
        `Broad: ${et.enemyRaycastCalls}Ray ${et.aoeQueryCalls}AoE | DmgEv: ${et.damageEventsPerSec.toFixed(0)}/s`;
    } else {
      ecsEntityLine.textContent = `ECS: ${world.aliveCount} ent | Broad: --`;
    }

    const mobT = pipeline.getSystemTiming('mobility_game')?.emaMs ?? 0;
    const wpnT = pipeline.getSystemTiming('combat_weapon')?.emaMs ?? 0;
    const aiT = pipeline.getSystemTiming('ai_enemies')?.emaMs ?? 0;
    const fxT = pipeline.getSystemTiming('world_fx_hud')?.emaMs ?? 0;
    const gpuSubT = pipeline.getSystemTiming('webgl_render')?.emaMs ?? 0;

    const aliveEnemies =
      G.enemies && typeof G.enemies.aliveCount === 'function'
        ? G.enemies.aliveCount()
        : 0;

    ecsLine.textContent =
      `Move ${mobT.toFixed(2)} | Wpn ${wpnT.toFixed(2)} | AI ${aiT.toFixed(2)} (${aliveEnemies})\n` +
      `VFX  ${fxT.toFixed(2)} | Render ${gpuSubT.toFixed(2)} ms`;

    const rStats = G.render && typeof G.render.stats === 'function' ? G.render.stats() : null;
    if (rStats) {
      const trisK = (Number(rStats.tris || 0) / 1000).toFixed(1);
      const qName = (G.quality && G.quality.name) || 'auto';
      const scale = Number(rStats.scale || 1).toFixed(2);
      renderLine.textContent = `DC: ${rStats.calls ?? 0} | Tris: ${trisK}k | ${qName} (${scale}x)`;
    }
  }

  return {
    world,
    pipeline,
    get expanded() {
      return isExpanded;
    },
    stepFrame(input: PerfHudPhaseInput) {
      const ecs = G.ecsCombat as EcsCombatBridge | undefined;
      if (ecs && !ecs.telemetry.timingEnabled) {
        ecs.telemetry.setTimingEnabled(true);
      }

      currentPhaseInput = input;
      pipeline.step(input.dt);
      currentPhaseInput = null;

      const pt = phys?.telemetry;
      const et = ecs?.telemetry;

      const rawMs = input.rawFrameSec * 1000;
      if (rawMs > 0 && rawMs < 500) {
        frameMsRing[frameRingHead] = rawMs;
        frameRingHead = (frameRingHead + 1) % FRAME_WINDOW;
        if (frameRingCount < FRAME_WINDOW) frameRingCount++;

        sparkMsRing[sparkHead] = rawMs;
        sparkPhysRing[sparkHead] =
          (pt ? pt.physicsMsAcc : 0) + (et ? et.combatMsAcc : 0);
        sparkHead = (sparkHead + 1) % SPARK_BARS;
      }

      uiRefreshAcc +=
        input.rawFrameSec > 0 && input.rawFrameSec < 1 ? input.rawFrameSec : input.dt;
      if (uiRefreshAcc >= TEXT_REFRESH_SEC) {
        uiRefreshAcc = 0;
        if (pt) {
          pt.lastPhysicsMs = pt.physicsMsAcc;
          pt.emaPhysicsMs =
            pt.emaPhysicsMs === 0
              ? pt.physicsMsAcc
              : pt.emaPhysicsMs * 0.9 + pt.physicsMsAcc * 0.1;
        }
        if (et) {
          et.lastCombatMs = et.combatMsAcc;
          et.emaCombatMs =
            et.emaCombatMs === 0
              ? et.combatMsAcc
              : et.emaCombatMs * 0.9 + et.combatMsAcc * 0.1;
        }
        refreshMetricsDom();
        drawSparkline();
        pt?.resetFrameCounters();
        et?.resetFrameCounters();
      } else {
        pt?.resetFrameCounters();
        et?.resetFrameCounters();
      }
    },
    toggleExpanded,
    toggleSpatialAcceleration,
    dispose() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', onKeyDown);
      }
      root.remove();
    },
  };
}
