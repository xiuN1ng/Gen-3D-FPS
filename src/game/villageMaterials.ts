/**
 * Pure Procedural Classical Japanese Village PBR Material Library (`花村古里 · 木材/石材/瓦片精细化程序化 PBR 材质库`).
 *
 * Defines calibrated physical PBR presets (`HANAMURA_PBR_PRESETS`) and deterministic procedural samplers
 * (`sampleHanamuraMaterialPbr`) across three core classical Japanese architectural material families:
 *   1. Wood (`木材`):
 *      - `agedHinoki` (`古桧木梁柱` — Chamaecyparis obtusa beams, cathedral growth rings, satin latewood vs earlywood, V-groove AO)
 *      - `bridgePlank` (`太鼓桥厚桧木踏板` — heavy adze-planed transverse bridge planks, staggered butt-joints & forged-iron kazari-kugi nails)
 *      - `yakisugiPlank` (`烧杉押缘下见板` — charred cedar board-and-batten siding, pyrolytic alligator-char platelets vs matte soot grooves)
 *      - `vermilionLacquer` (`本朱漆神木高栏` — multi-coat cinnabar shu-nuri urushi lacquer with clearcoat luster over keyaki pores)
 *   2. Stone (`石材`):
 *      - `ishigakiStone` (`打込接山城石垣` — polygonal fitted castle granite, cleaved facets, ya-ana chisel marks, biotite/quartz speckle & mossy crevice AO)
 *      - `villageCobble` (`石叠参道敷石` — coursed multi-size slate & river-granite flagstones, foot-polished crowns vs rough mossy soil joints)
 *      - `graniteSteps` (`御影石切石与算木积` — Setouchi mikage ashlar blocks with edo-giri chiseled perimeter draft & bush-hammered crystal center)
 *   3. Roof Tile (`瓦片`):
 *      - `kawaraTile` (`本瓦葺熏瓦 / いぶし銀瓦` — alternating convex marugawara cover ribs & concave hiragawara pans, crisp eave overlap AO & ibushi-gin carbon sheen)
 *      - `namakoWall` (`海鼠壁平瓦漆喰目地` — 45-degree diagonal charcoal clay wall tiles + raised semi-cylindrical white shikkui plaster kamaboko joints)
 *      - `thatchRoof` (`合掌造茅葺屋顶` — stepped mountain miscanthus reed bundles, stalk micro-relief & north-slope moss)
 */

import { enhanceMaterialStylized } from './stylizedRenderPipeline';

export type HanamuraMaterialCategory = 'wood' | 'stone' | 'tile';

export type HanamuraPresetId =
  | 'agedHinoki'
  | 'bridgePlank'
  | 'yakisugiPlank'
  | 'vermilionLacquer'
  | 'ishigakiStone'
  | 'villageCobble'
  | 'graniteSteps'
  | 'kawaraTile'
  | 'namakoWall'
  | 'thatchRoof';

export interface HanamuraPbrPreset {
  id: HanamuraPresetId;
  label: string;
  category: HanamuraMaterialCategory;
  gpuSet: string | null;
  roughnessRange: [number, number];
  metalnessRange: [number, number];
  aoRange: [number, number];
  normalScale: number;
  aoMapIntensity: number;
  envMapIntensity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  worldUvScale: [number, number];
  roofPitchUv: boolean;
  groundMoss: number;
  macroTint: number;
}

export interface PbrSample {
  r: number;
  g: number;
  b: number;
  ao: number;
  rough: number;
  metal: number;
  height: number;
}

export interface VillageMaterialLibrary {
  ishigakiStone: any;
  graniteSteps: any;
  kawaraTile: any;
  thatchRoof: any;
  agedHinoki: any;
  bridgePlank: any;
  yakisugiPlank: any;
  vermilionLacquer: any;
  shikkuiPlaster: any;
  namakoWall: any;
  washiShoji: any;
  tatamiRush: any;
  villageCobble: any;
  bambooCulm: any;
  sakuraBark: any;
  pineBark: any;
  sakuraBlossomA: any;
  sakuraBlossomB: any;
  autumnMaple: any;
  pineNeedles: any;
  bambooFoliage: any;
  norenIndigo: any;
  bronzeAged: any;
  warmPaperLantern: any;
  brazierEmber: any;
  streamWater: any;
  presets: Record<HanamuraPresetId, HanamuraPbrPreset>;
  update: (dt: number) => void;
}

/**
 * Calibrated physical PBR parameter definitions for Hanamura Classical Village (`花村古里`)
 * Wood (`木材`), Stone (`石材`), and Tile (`瓦片`) materials.
 */
export const HANAMURA_PBR_PRESETS: Record<HanamuraPresetId, HanamuraPbrPreset> = {
  // ---- WOOD (`木材`) ----
  agedHinoki: {
    id: 'agedHinoki',
    label: '古桧木梁柱',
    category: 'wood',
    gpuSet: 'hanamura_hinoki',
    roughnessRange: [0.36, 0.90],
    metalnessRange: [0.0, 0.03],
    aoRange: [0.24, 1.0],
    normalScale: 1.18,
    aoMapIntensity: 1.18,
    envMapIntensity: 0.95,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    worldUvScale: [0.56, 0.46],
    roofPitchUv: false,
    groundMoss: 0.22,
    macroTint: 0.10,
  },
  bridgePlank: {
    id: 'bridgePlank',
    label: '太鼓桥厚桧木踏板',
    category: 'wood',
    gpuSet: 'hanamura_bridge_plank',
    roughnessRange: [0.34, 0.90],
    metalnessRange: [0.0, 0.82],
    aoRange: [0.16, 1.0],
    normalScale: 1.32,
    aoMapIntensity: 1.28,
    envMapIntensity: 1.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    worldUvScale: [0.50, 0.44],
    roofPitchUv: false,
    groundMoss: 0.12,
    macroTint: 0.11,
  },
  yakisugiPlank: {
    id: 'yakisugiPlank',
    label: '烧杉押缘下见板',
    category: 'wood',
    gpuSet: 'hanamura_yakisugi',
    roughnessRange: [0.33, 0.86],
    metalnessRange: [0.0, 0.12],
    aoRange: [0.22, 1.0],
    normalScale: 1.42,
    aoMapIntensity: 1.26,
    envMapIntensity: 1.05,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    worldUvScale: [0.62, 0.54],
    roofPitchUv: false,
    groundMoss: 0.30,
    macroTint: 0.09,
  },
  vermilionLacquer: {
    id: 'vermilionLacquer',
    label: '本朱漆神木高栏',
    category: 'wood',
    gpuSet: 'hanamura_lacquer',
    roughnessRange: [0.20, 0.56],
    metalnessRange: [0.02, 0.05],
    aoRange: [0.80, 1.0],
    normalScale: 0.65,
    aoMapIntensity: 1.05,
    envMapIntensity: 1.28,
    clearcoat: 0.58,
    clearcoatRoughness: 0.22,
    worldUvScale: [0.56, 0.48],
    roofPitchUv: false,
    groundMoss: 0.16,
    macroTint: 0.06,
  },

  // ---- STONE (`石材`) ----
  ishigakiStone: {
    id: 'ishigakiStone',
    label: '打込接山城石垣',
    category: 'stone',
    gpuSet: 'hanamura_ishigaki',
    roughnessRange: [0.46, 0.94],
    metalnessRange: [0.02, 0.08],
    aoRange: [0.14, 1.0],
    normalScale: 1.65,
    aoMapIntensity: 1.36,
    envMapIntensity: 0.92,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    worldUvScale: [0.36, 0.40],
    roofPitchUv: false,
    groundMoss: 0.46,
    macroTint: 0.14,
  },
  villageCobble: {
    id: 'villageCobble',
    label: '石叠参道敷石',
    category: 'stone',
    gpuSet: 'hanamura_ishidatami',
    roughnessRange: [0.35, 0.93],
    metalnessRange: [0.02, 0.05],
    aoRange: [0.22, 1.0],
    normalScale: 1.38,
    aoMapIntensity: 1.26,
    envMapIntensity: 0.98,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    worldUvScale: [0.44, 0.44],
    roofPitchUv: false,
    groundMoss: 0.14,
    macroTint: 0.12,
  },
  graniteSteps: {
    id: 'graniteSteps',
    label: '御影石切石与算木积',
    category: 'stone',
    gpuSet: 'hanamura_mikage',
    roughnessRange: [0.45, 0.93],
    metalnessRange: [0.02, 0.06],
    aoRange: [0.22, 1.0],
    normalScale: 1.18,
    aoMapIntensity: 1.20,
    envMapIntensity: 0.96,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    worldUvScale: [0.56, 0.56],
    roofPitchUv: false,
    groundMoss: 0.24,
    macroTint: 0.08,
  },

  // ---- ROOF & WALL TILE (`瓦片`) ----
  kawaraTile: {
    id: 'kawaraTile',
    label: '本瓦葺熏瓦',
    category: 'tile',
    gpuSet: 'hanamura_kawara',
    roughnessRange: [0.24, 0.88],
    metalnessRange: [0.04, 0.22],
    aoRange: [0.15, 1.0],
    normalScale: 1.72,
    aoMapIntensity: 1.36,
    envMapIntensity: 1.22,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    worldUvScale: [0.56, 0.56],
    roofPitchUv: true,
    groundMoss: 0.0,
    macroTint: 0.09,
  },
  namakoWall: {
    id: 'namakoWall',
    label: '海鼠壁平瓦漆喰目地',
    category: 'tile',
    gpuSet: 'hanamura_namako',
    roughnessRange: [0.30, 0.86],
    metalnessRange: [0.0, 0.12],
    aoRange: [0.28, 1.0],
    normalScale: 1.62,
    aoMapIntensity: 1.28,
    envMapIntensity: 1.05,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    worldUvScale: [0.54, 0.54],
    roofPitchUv: false,
    groundMoss: 0.28,
    macroTint: 0.07,
  },
  thatchRoof: {
    id: 'thatchRoof',
    label: '合掌造茅葺屋顶',
    category: 'tile',
    gpuSet: null,
    roughnessRange: [0.84, 0.98],
    metalnessRange: [0.0, 0.0],
    aoRange: [0.26, 1.0],
    normalScale: 1.48,
    aoMapIntensity: 1.25,
    envMapIntensity: 0.78,
    clearcoat: 0.0,
    clearcoatRoughness: 0.0,
    worldUvScale: [0.42, 0.42],
    roofPitchUv: true,
    groundMoss: 0.0,
    macroTint: 0.13,
  },
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function fract(v: number): number {
  return v - Math.floor(v);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
}

/** Seamless periodic integer lattice hash on `[0..period-1]`. */
function hash2P(ix: number, iy: number, period: number, seed: number): number {
  const px = ((ix % period) + period) % period;
  const py = ((iy % period) + period) % period;
  let h = (px * 374761393 + py * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Seamless tileable 2D value noise on `u, v in [0, 1]` with integer `freq`. */
function tileNoise(u: number, v: number, freq: number, seed: number): number {
  const x = u * freq;
  const y = v * freq;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2P(ix, iy, freq, seed);
  const n10 = hash2P(ix + 1, iy, freq, seed);
  const n01 = hash2P(ix, iy + 1, freq, seed);
  const n11 = hash2P(ix + 1, iy + 1, freq, seed);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

/** Seamless tileable multi-octave FBM on `u, v in [0, 1]`. */
function tileFbm(u: number, v: number, baseFreq: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = baseFreq;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tileNoise(u, v, f, seed + i * 97);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / (norm || 1);
}

/**
 * Seamless periodic Voronoi cellular distance for authentic Japanese polygonal `打込接` castle stone blocks.
 */
function tileVoronoi(
  u: number,
  v: number,
  cellsX: number,
  cellsY: number,
  jitter: number,
  seed: number
): { edge: number; id: number; localX: number; localY: number } {
  const gx = u * cellsX;
  const gy = v * cellsY;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);

  let d1 = 1e9;
  let d2 = 1e9;
  let bestId = 0;
  let bestDx = 0;
  let bestDy = 0;

  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox;
      const cy = iy + oy;
      const wcx = ((cx % cellsX) + cellsX) % cellsX;
      const wcy = ((cy % cellsY) + cellsY) % cellsY;
      const jx = (hash2P(wcx, wcy, 1024, seed) - 0.5) * jitter;
      const jy = (hash2P(wcx, wcy, 1024, seed + 311) - 0.5) * jitter;
      const px = cx + 0.5 + jx;
      const py = cy + 0.5 + jy;
      const dx = (gx - px) * 0.88;
      const dy = gy - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < d1) {
        d2 = d1;
        d1 = dist;
        bestId = hash2P(wcx, wcy, 1024, seed + 733);
        bestDx = dx;
        bestDy = dy;
      } else if (dist < d2) {
        d2 = dist;
      }
    }
  }
  return {
    edge: d2 - d1,
    id: bestId,
    localX: bestDx,
    localY: bestDy,
  };
}

/**
 * Pure deterministic CPU PBR sampler for every Hanamura Wood (`木材`), Stone (`石材`), and Tile (`瓦片`) preset.
 * Returns normalized `[0..1]` sRGB albedo `(r, g, b)`, ambient occlusion `ao`, physical `rough`, `metal`, and `height`.
 */
export function sampleHanamuraMaterialPbr(presetId: HanamuraPresetId, uIn: number, vIn: number): PbrSample {
  const u = fract(uIn);
  const v = fract(vIn);

  switch (presetId) {
    case 'agedHinoki':
    case 'bridgePlank': {
      const isBridge = presetId === 'bridgePlank';
      const planks = isBridge ? 6 : 4;
      const pu = fract(u * planks);
      const pIdx = Math.floor(u * planks);
      const pShift = hash2P(pIdx, 7, 64, isBridge ? 829 : 809);
      const seamD = Math.min(pu, 1 - pu);
      const seam = smoothstep(isBridge ? 0.014 : 0.010, isBridge ? 0.052 : 0.038, seamD);

      let butt = 1.0;
      let nail = 0.0;
      if (isBridge) {
        const by = fract(v * 2 + 0.5 * (pIdx % 2));
        const buttD = Math.min(by, 1 - by);
        butt = smoothstep(0.006, 0.022, buttD);
        const nailX = Math.min(Math.abs(pu - 0.24), Math.abs(pu - 0.76));
        const nailY = Math.abs(buttD - 0.048);
        const nailDist = Math.hypot(nailX * 1.15, nailY * 2.6);
        nail = smoothstep(0.042, 0.020, nailDist);
      }

      const warp = tileFbm(u * 2, fract(v * 0.5 + pShift), 6, 3, 823);
      const rings = Math.sin((pu * 4.5 + warp * 3.6 + pShift * 4) * Math.PI * 2) * 0.5 + 0.5;
      const latewood = smoothstep(0.55, 0.92, rings);
      const fiber = tileNoise(u * 2, v * 0.25, 64, 839);
      const tone = 0.88 + (pShift - 0.5) * 0.16;

      const groove = seam * butt;
      let r = lerp(0.18, (0.66 - latewood * 0.12 + (fiber - 0.5) * 0.05) * tone, groove);
      let g = lerp(0.11, (0.45 - latewood * 0.09 + (fiber - 0.5) * 0.04) * tone, groove);
      let b = lerp(0.06, (0.26 - latewood * 0.06 + (fiber - 0.5) * 0.03) * tone, groove);

      r = lerp(r, 0.24, nail);
      g = lerp(g, 0.24, nail);
      b = lerp(b, 0.27, nail);

      const height = clamp01(
        lerp(
          groove * (0.58 + 0.18 * smoothstep(0.02, 0.14, seamD) - latewood * 0.07 + (fiber - 0.5) * 0.08),
          0.92,
          nail
        )
      );
      const ao = clamp01(lerp(isBridge ? 0.16 : 0.24, 1.0, groove));
      const woodRough = lerp(0.38, 0.62, latewood) + (0.5 - fiber) * 0.08;
      const rough = clamp01(lerp(lerp(0.90, woodRough, groove), 0.34, nail));
      const metal = clamp01(nail * 0.82);
      return { r: clamp01(r), g: clamp01(g), b: clamp01(b), ao, rough, metal, height };
    }

    case 'yakisugiPlank': {
      const boards = 6;
      const bu = fract(u * boards);
      const bIdx = Math.floor(u * boards);
      const bTone = hash2P(bIdx, 11, 64, 863);
      const battenD = Math.min(bu, 1 - bu);
      const batten = 1.0 - smoothstep(0.115, 0.138, battenD);
      const undercut = smoothstep(0.115, 0.142, battenD) * (1.0 - smoothstep(0.142, 0.205, battenD));

      const grain = tileNoise(u * 2, v * 0.35, 64, 877);
      const craze = Math.abs(fract(v * 36 + (grain - 0.5) * 1.6 + bTone * 3) - 0.5) * 2;
      const vFiss = Math.abs(fract(bu * 9 + (grain - 0.5) * 0.7) - 0.5) * 2;
      const platelet = smoothstep(0.14, 0.38, craze) * smoothstep(0.10, 0.28, vFiss);

      const lum = lerp(0.12, 0.24 + bTone * 0.04 + grain * 0.035, platelet) * (1 - undercut * 0.42);
      const r = clamp01(lum * 0.96);
      const g = clamp01(lum * 1.02);
      const b = clamp01(lum * 1.24);
      const height = clamp01(lerp(0.44, 0.86, batten) + platelet * 0.10 + (grain - 0.5) * 0.06);
      const ao = clamp01((1.0 - undercut * 0.72) * lerp(0.68, 1.0, platelet));
      const rough = clamp01(lerp(0.86, 0.34 + (1 - grain) * 0.10, platelet));
      const metal = clamp01(platelet * 0.11);
      return { r, g, b, ao, rough, metal, height };
    }

    case 'vermilionLacquer': {
      const grain = tileFbm(u * 2, v * 0.4, 16, 3, 907);
      const ring = Math.sin((u * 5 + (grain - 0.5) * 1.8) * Math.PI * 2) * 0.5 + 0.5;
      const wear = smoothstep(0.76, 0.94, tileFbm(u, v, 8, 3, 919));
      const r = clamp01(lerp(0.85 + ring * 0.09 + (grain - 0.5) * 0.04, 0.32, wear * 0.45));
      const g = clamp01(lerp(0.18 + ring * 0.03, 0.09, wear * 0.45));
      const b = clamp01(lerp(0.11 + ring * 0.02, 0.06, wear * 0.45));
      const height = clamp01(0.62 + (grain - 0.5) * 0.08 + ring * 0.03 - wear * 0.08);
      const ao = clamp01(1.0 - wear * 0.18);
      const rough = clamp01(lerp(0.22 + (1 - grain) * 0.08, 0.54, wear));
      return { r, g, b, ao, rough, metal: 0.03, height };
    }

    case 'ishigakiStone': {
      const warpU = fract(u + (tileFbm(u, v, 4, 2, 11) - 0.5) * 0.045);
      const warpV = fract(v + (tileFbm(u, v, 4, 2, 29) - 0.5) * 0.045);
      const cell = tileVoronoi(warpU, warpV, 4, 5, 0.74, 101);
      const mortar = smoothstep(0.022, 0.082, cell.edge);
      const bevel = smoothstep(0.024, 0.24, cell.edge);
      const gran = tileFbm(u, v, 16, 3, 211);
      const fine = tileNoise(u, v, 64, 307);
      const chisel = Math.sin((cell.localX * 18 + cell.localY * 12 + cell.id * 9) * Math.PI) * 0.025;

      const warmShift = (cell.id - 0.5) * 0.11;
      let r = (0.45 + warmShift + (gran - 0.5) * 0.11 + (fine - 0.5) * 0.06) * (0.80 + 0.20 * bevel);
      let g = (0.44 + warmShift * 0.75 + (gran - 0.5) * 0.10 + (fine - 0.5) * 0.06) * (0.80 + 0.20 * bevel);
      let b = (0.45 - warmShift * 0.35 + (gran - 0.5) * 0.09 + (fine - 0.5) * 0.06) * (0.80 + 0.20 * bevel);

      const mossPatch = clamp01((1 - bevel) * 1.1 * smoothstep(0.48, 0.76, tileFbm(u, v, 6, 3, 409)));
      r = lerp(0.28, lerp(r, 0.20, mossPatch), mortar);
      g = lerp(0.29, lerp(g, 0.42, mossPatch), mortar);
      b = lerp(0.33, lerp(b, 0.19, mossPatch), mortar);

      const height = clamp01(mortar * (0.28 + 0.50 * bevel + (gran - 0.5) * 0.12 + chisel + (fine - 0.5) * 0.04));
      const ao = clamp01(lerp(0.14, 0.62 + 0.38 * bevel, mortar));
      const rough = clamp01(lerp(0.94, 0.54 + (1 - gran) * 0.20 - (fine > 0.8 ? 0.06 : 0), mortar) + mossPatch * 0.22);
      return { r: clamp01(r), g: clamp01(g), b: clamp01(b), ao, rough, metal: 0.04, height };
    }

    case 'villageCobble':
    case 'graniteSteps': {
      const isMikage = presetId === 'graniteSteps';
      const rows = isMikage ? 4 : 6;
      const cols = isMikage ? 2 : 4;
      const ry = v * rows;
      const row = Math.floor(ry);
      const stag = isMikage ? (row % 2) * 0.5 : hash2P(row, 3, 64, 503);
      const cx = u * cols + stag;
      const colIdx = Math.floor(cx);
      const fx = fract(cx);
      const fy = fract(ry);
      const id = hash2P(colIdx, row, 128, isMikage ? 521 : 1061);

      const warp = (tileNoise(u, v, 32, 541) - 0.5) * (isMikage ? 0.008 : 0.032);
      const jd = Math.min(Math.min(fx, 1 - fx) * (isMikage ? 2.0 : 1.35), Math.min(fy, 1 - fy)) + warp;
      const stone = smoothstep(isMikage ? 0.014 : 0.022, isMikage ? 0.038 : 0.068, jd);
      const crown = smoothstep(0.025, 0.24, jd);
      const draft = isMikage ? stone * (1 - smoothstep(0.05, 0.11, jd)) : 0;

      const speck = tileNoise(u, v, 64, 557);
      const cleav = tileFbm(u, v, 16, 3, 569);
      const base = isMikage
        ? 0.52 + (id - 0.5) * 0.06 + (cleav - 0.5) * 0.07 + (speck - 0.5) * 0.09 + draft * 0.03
        : 0.38 + (id - 0.5) * 0.08 + (cleav - 0.5) * 0.07;

      const mossMix = isMikage ? 0.15 : smoothstep(0.40, 0.76, tileFbm(u, v, 8, 2, 1097));
      const jr = lerp(0.28, 0.18, mossMix);
      const jg = lerp(0.27, 0.38, mossMix);
      const jb = lerp(0.27, 0.17, mossMix);

      const r = clamp01(lerp(jr, base * (isMikage ? 1.02 : 0.96 + (id - 0.5) * 0.06), stone));
      const g = clamp01(lerp(jg, base * (isMikage ? 1.00 : 0.99), stone));
      const b = clamp01(lerp(jb, base * (isMikage ? 0.99 : 1.05 - (id - 0.5) * 0.05), stone));
      const height = clamp01(stone * (0.42 + (isMikage ? 0.36 - draft * 0.05 : 0.42 * crown) + (cleav - 0.5) * 0.10));
      const ao = clamp01(lerp(0.22, 0.72 + 0.28 * crown, stone));
      const stoneRough = isMikage ? lerp(0.72, 0.45, draft) : lerp(0.54, 0.35, crown);
      const rough = clamp01(lerp(0.93, stoneRough, stone));
      return { r, g, b, ao, rough, metal: 0.03, height };
    }

    case 'kawaraTile': {
      const cols = 6;
      const rows = 6;
      const cu = fract(u * cols);
      const rv = fract(v * rows);
      const tileIdx = Math.floor(u * cols) + Math.floor(v * rows) * 13;
      const tileVar = (hash2P(tileIdx, 3, 256, 613) - 0.5) * 0.05;

      const ribDist = Math.abs(cu - 0.78);
      const maruMask = 1.0 - smoothstep(0.17, 0.22, ribDist);
      const maruDome = Math.sqrt(clamp01(1.0 - Math.pow(ribDist / 0.21, 2)));
      const panNorm = clamp01((cu - 0.04) / 0.54);
      const panCurve = 0.18 * Math.pow(panNorm * 2 - 1, 2);
      const profile = lerp(0.26 + panCurve, 0.56 + maruDome * 0.38, maruMask);

      const eaveStep = smoothstep(0.0, 0.11, rv);
      const underShadow = smoothstep(0.0, 0.18, rv);
      const patina = tileFbm(u, v, 12, 3, 641);
      const crestSheen = clamp01((maruDome * maruMask * 0.85 + panCurve * 1.4) * eaveStep);

      const charcoal = (0.25 + tileVar + crestSheen * 0.12 + (patina - 0.5) * 0.04) * lerp(0.45, 1.0, underShadow);
      let r = charcoal * 0.82;
      let g = charcoal * 0.98;
      let b = charcoal * 1.36;

      const lichen = (1 - maruMask) * smoothstep(0.70, 0.88, tileFbm(u, v, 12, 2, 677)) * eaveStep * 0.32;
      r = lerp(r, 0.34, lichen);
      g = lerp(g, 0.44, lichen);
      b = lerp(b, 0.28, lichen);

      const height = clamp01((profile + rv * 0.14) * (0.22 + 0.78 * eaveStep));
      const ao = clamp01(lerp(0.15, 1.0, underShadow) * lerp(0.74, 1.0, maruMask * 0.6 + panCurve * 2));
      const rough = clamp01(lerp(0.64, 0.24, crestSheen) + lichen * 0.26 + (1 - eaveStep) * 0.22);
      const metal = clamp01(lerp(0.04, 0.20, crestSheen) * (1 - lichen));
      return { r: clamp01(r), g: clamp01(g), b: clamp01(b), ao, rough, metal, height };
    }

    case 'namakoWall': {
      const freq = 4;
      const d1 = Math.abs(fract((u + v) * freq) - 0.5) * 2;
      const d2 = Math.abs(fract((u - v) * freq) - 0.5) * 2;
      const dj = Math.min(d1, d2);
      const jointMask = 1.0 - smoothstep(0.155, 0.195, dj);
      const crease = smoothstep(0.145, 0.190, dj) * (1.0 - smoothstep(0.190, 0.255, dj));
      const dome = Math.sqrt(clamp01(1.0 - Math.pow(dj / 0.195, 2)));
      const tilePat = tileFbm(u, v, 16, 2, 983);

      const tileCol = (0.24 + (tilePat - 0.5) * 0.04) * (1 - crease * 0.35);
      const r = clamp01(lerp(tileCol * 0.82, 0.96, jointMask));
      const g = clamp01(lerp(tileCol * 0.96, 0.95, jointMask));
      const b = clamp01(lerp(tileCol * 1.32, 0.92, jointMask));
      const height = clamp01(lerp(0.30 + tilePat * 0.05, 0.44 + dome * 0.52, jointMask));
      const ao = clamp01((1.0 - crease * 0.68) * lerp(0.88, 0.72 + 0.28 * dome, jointMask));
      const rough = clamp01(lerp(0.33, 0.80, jointMask));
      const metal = clamp01(lerp(0.11, 0.0, jointMask));
      return { r, g, b, ao, rough, metal, height };
    }

    case 'thatchRoof': {
      const tierCount = 5;
      const tv = fract(v * tierCount);
      const tierStep = smoothstep(0.0, 0.18, tv);
      const stalk1 = tileNoise(u, v * 0.25, 64, 701);
      const stalk2 = tileNoise(u, v * 0.5, 32, 719);
      const bundle = Math.sin(u * Math.PI * 16 + (tileNoise(u, v, 8, 733) - 0.5) * 1.8) * 0.5 + 0.5;
      const weather = tileFbm(u, v, 6, 3, 751);

      const ao = clamp01((0.26 + 0.74 * tierStep) * (0.78 + 0.22 * bundle));
      let r = (0.58 + (stalk1 - 0.5) * 0.14 + (weather - 0.5) * 0.09) * (0.65 + 0.35 * tierStep);
      let g = (0.47 + (stalk1 - 0.5) * 0.11 + (weather - 0.5) * 0.08) * (0.65 + 0.35 * tierStep);
      let b = (0.29 + (stalk1 - 0.5) * 0.07 + (weather - 0.5) * 0.05) * (0.65 + 0.35 * tierStep);

      const moss = smoothstep(0.66, 0.85, weather) * 0.28;
      r = lerp(r, 0.24, moss);
      g = lerp(g, 0.46, moss);
      b = lerp(b, 0.19, moss);

      const height = clamp01(tierStep * 0.42 + stalk1 * 0.34 + stalk2 * 0.14 + bundle * 0.10);
      const rough = clamp01(0.86 + (1 - stalk1) * 0.11);
      return { r: clamp01(r), g: clamp01(g), b: clamp01(b), ao, rough, metal: 0.0, height };
    }
  }
}

export interface GeneratedPbrMaps {
  map: any;
  normalMap: any;
  ormMap: any;
}

export function buildPbrMaps(
  THREE: any,
  size: number,
  anisotropy: number,
  normalStrength: number,
  sampler: (u: number, v: number) => PbrSample
): GeneratedPbrMaps {
  const total = size * size;
  const albedo = new Uint8Array(total * 4);
  const orm = new Uint8Array(total * 4);
  const normal = new Uint8Array(total * 4);
  const heights = new Float32Array(total);

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const idx = y * size + x;
      const s = sampler(u, v);
      heights[idx] = s.height;
      const p = idx * 4;
      albedo[p] = Math.round(clamp01(s.r) * 255);
      albedo[p + 1] = Math.round(clamp01(s.g) * 255);
      albedo[p + 2] = Math.round(clamp01(s.b) * 255);
      albedo[p + 3] = 255;

      // Packed glTF/Three.js ORM: R = aoMap, G = roughnessMap, B = metalnessMap
      orm[p] = Math.round(clamp01(s.ao) * 255);
      orm[p + 1] = Math.round(clamp01(s.rough) * 255);
      orm[p + 2] = Math.round(clamp01(s.metal) * 255);
      orm[p + 3] = 255;
    }
  }

  // Wrapped 3x3 Sobel filter -> seamless tangent-space normalMap
  const k = normalStrength * (size / 128);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yc = y * size;
    const yp = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;

      const tl = heights[ym + xm];
      const tc = heights[ym + x];
      const tr = heights[ym + xp];
      const ml = heights[yc + xm];
      const mr = heights[yc + xp];
      const bl = heights[yp + xm];
      const bc = heights[yp + x];
      const br = heights[yp + xp];

      const dX = (tr + 2 * mr + br - (tl + 2 * ml + bl)) * 0.125 * k;
      const dY = (bl + 2 * bc + br - (tl + 2 * tc + tr)) * 0.125 * k;
      const invLen = 1 / Math.sqrt(dX * dX + dY * dY + 1);

      const p = (yc + x) * 4;
      normal[p] = Math.round((-dX * invLen * 0.5 + 0.5) * 255);
      normal[p + 1] = Math.round((-dY * invLen * 0.5 + 0.5) * 255);
      normal[p + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      normal[p + 3] = 255;
    }
  }

  const mkTex = (data: Uint8Array, isSrgb: boolean) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.colorSpace = isSrgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };

  return {
    map: mkTex(albedo, true),
    normalMap: mkTex(normal, false),
    ormMap: mkTex(orm, false),
  };
}

export interface WorldUvOptions {
  scaleU: number;
  scaleV: number;
  roofPitchUv?: boolean;
  groundMoss?: number;
  macroTint?: number;
  cacheKey: string;
}

/**
 * Injects world-space architectural UV projection, curved-roof eave-aligned tile UVs (`aUvMode = 1 | 2`),
 * smooth cylindrical world-meter UV wrap (`aUvMode = 3`), and ground-moss / macro weathering patina
 * into `MeshStandardMaterial` or `MeshPhysicalMaterial`.
 */
export function applyArchitecturalWorldUv(THREE: any, mat: any, opts: WorldUvOptions): any {
  const uniforms = {
    uVilUvScale: { value: new THREE.Vector2(opts.scaleU, opts.scaleV) },
    uVilWeather: { value: new THREE.Vector2(opts.groundMoss ?? 0.35, opts.macroTint ?? 0.12) },
  };
  mat.onBeforeCompile = (shader: any) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      `attribute float aUvMode;\nattribute float aArchOcc;\nattribute float aWarmGlow;\nvarying vec3 vVilWorldPos;\nvarying float vVilArchOcc;\nvarying float vVilWarmGlow;\nuniform vec2 uVilUvScale;\n` +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          #ifdef USE_INSTANCING
            mat4 vilM = modelMatrix * instanceMatrix;
          #else
            mat4 vilM = modelMatrix;
          #endif
          vec3 vilWp = (vilM * vec4(transformed, 1.0)).xyz;
          vec3 vilWn = normalize(mat3(vilM) * objectNormal);
          vVilWorldPos = vilWp;
          vVilArchOcc = aArchOcc;
          vVilWarmGlow = aWarmGlow;
          float vilSx = length(vilM[0].xyz);
          float vilSy = length(vilM[1].xyz);
          float vilSz = length(vilM[2].xyz);
          vec2 vilUv;
          if (aUvMode > 3.5) {
            // Mode 4: Pre-computed exact meter-space architectural UV (curved hipped Yosemune/Irimoya roofs & merged static batches)
            vilUv = uv;
          } else if (aUvMode > 2.5) {
            // Mode 3: Cylindrical world-meter circumference x height wrap (pillars, handrails, lanterns, bamboo)
            vilUv = vec2(uv.x * 3.14159265 * 0.5 * (vilSx + vilSz), uv.y * vilSy);
          } else if (aUvMode > 1.5) {
            // Mode 2: Curved Japanese roof +-X slope (eave along local Z, tile course 0 anchored at eave)
            vilUv = vec2(uv.x * vilSz, uv.y * sqrt(0.25 * vilSx * vilSx + vilSy * vilSy));
          } else if (aUvMode > 0.5) {
            // Mode 1: Curved Japanese roof +-Z slope (eave along local X, tile course 0 anchored at eave)
            vilUv = vec2(uv.x * vilSx, uv.y * sqrt(0.25 * vilSz * vilSz + vilSy * vilSy));
          } else {
            vec2 vilHoriz = length(vilWn.xz) > 1e-4 ? normalize(vec2(-vilWn.z, vilWn.x)) : vec2(1.0, 0.0);
            ${
              opts.roofPitchUv
                ? `if (abs(vilWn.y) > 0.94) {
                     vilUv = vilWp.xz;
                   } else {
                     vec3 vilSlope = normalize(cross(vec3(vilHoriz.x, 0.0, vilHoriz.y), vilWn));
                     vilUv = vec2(dot(vilWp.xz, vilHoriz), dot(vilWp - vilM[3].xyz, vilSlope));
                   }`
                : `if (abs(vilWn.y) > 0.78) {
                     vilUv = vilWp.xz;
                   } else {
                     vilUv = vec2(dot(vilWp.xz, vilHoriz), vilWp.y);
                   }`
            }
          }
          vilUv *= uVilUvScale;
          #ifdef USE_MAP
            vMapUv = vilUv;
          #endif
          #ifdef USE_NORMALMAP
            vNormalMapUv = vilUv;
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv = vilUv;
          #endif
          #ifdef USE_METALNESSMAP
            vMetalnessMapUv = vilUv;
          #endif
          #ifdef USE_AOMAP
            vAoMapUv = vilUv;
          #endif
          #ifdef USE_EMISSIVEMAP
            vEmissiveMapUv = vilUv;
          #endif
        }`
      );

    shader.fragmentShader =
      `varying vec3 vVilWorldPos;\nvarying float vVilArchOcc;\nvarying float vVilWarmGlow;\nuniform vec2 uVilWeather;\nfloat vVilMossAmt = 0.0;\n` +
      shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            float vilMacro = sin(vVilWorldPos.x * 0.23 + sin(vVilWorldPos.z * 0.19) * 1.6) * 0.5
                           + cos(vVilWorldPos.z * 0.31 - vVilWorldPos.x * 0.14) * 0.5;
            diffuseColor.rgb *= 1.0 + vilMacro * uVilWeather.y;
            float vilMossBand = (1.0 - smoothstep(0.04, 0.72, vVilWorldPos.y)) * uVilWeather.x;
            vVilMossAmt = clamp(vilMossBand * (0.62 + 0.45 * sin(vVilWorldPos.x * 2.7 + vVilWorldPos.z * 3.1)), 0.0, 0.58);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.44, 0.19), vVilMossAmt);
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = clamp(mix(roughnessFactor, 0.92, vVilMossAmt * 0.8), 0.04, 1.0);`
        )
        .replace(
          '#include <lights_fragment_end>',
          `{
            float vilArchAo = clamp(1.0 - vVilArchOcc, 0.36, 1.0);
            reflectedLight.indirectDiffuse *= vilArchAo;
            reflectedLight.directDiffuse *= mix(1.0, vilArchAo, 0.36);
            reflectedLight.indirectSpecular *= vilArchAo;
            if (vVilWarmGlow > 0.002) {
              vec3 vilWarmRad = vec3(1.08, 0.56, 0.19) * vVilWarmGlow;
              reflectedLight.indirectDiffuse += diffuseColor.rgb * vilWarmRad * 0.85;
              totalEmissiveRadiance += diffuseColor.rgb * vilWarmRad * 0.18;
            }
          }
          #include <lights_fragment_end>`
        );
  };
  mat.customProgramCacheKey = () => `vil-pbr-v5-${opts.cacheKey}-${opts.roofPitchUv ? 'r' : 'b'}`;
  return enhanceMaterialStylized(mat, { role: 'architecture', id: opts.cacheKey });
}

/**
 * Synthesizes all scene-specific classical Japanese PBR materials for Hanamura (`花村古里`).
 */
export function createVillageMaterials(G: any): VillageMaterialLibrary {
  if (G && G.__villageMats) return G.__villageMats;
  const THREE = G.THREE;
  const qTex = G.quality?.tex || 512;
  const hiTex = qTex >= 1024 ? 256 : 192;
  const medTex = qTex >= 1024 ? 192 : 128;
  const maxAniso = Math.min(
    8,
    G.renderer?.capabilities?.getMaxAnisotropy ? G.renderer.capabilities.getMaxAnisotropy() : 2
  );

  // Resolve GPU MRT 16-bit normal + ORM + sRGB albedo set from engine baker (`G.mats.getSet`) when available,
  // with deterministic CPU `buildPbrMaps` fallback.
  function resolvePresetMaps(preset: HanamuraPbrPreset, cpuSize: number, cpuBump: number): GeneratedPbrMaps {
    if (preset.gpuSet && G.mats?.getSet) {
      try {
        const gpu = G.mats.getSet(preset.gpuSet);
        if (gpu && gpu.albedo && gpu.normal && gpu.orm) {
          return {
            map: gpu.albedo,
            normalMap: gpu.normal,
            ormMap: gpu.orm,
          };
        }
      } catch {
        // Fallback to CPU procedural PBR bake below
      }
    }
    return buildPbrMaps(THREE, cpuSize, maxAniso, cpuBump, (u, v) => sampleHanamuraMaterialPbr(preset.id, u, v));
  }

  function createPresetMaterial(presetId: HanamuraPresetId, cpuSize: number, cpuBump: number): any {
    const preset = HANAMURA_PBR_PRESETS[presetId];
    const maps = resolvePresetMaps(preset, cpuSize, cpuBump);
    const usePhysical = preset.clearcoat > 0 && typeof THREE.MeshPhysicalMaterial === 'function';
    const MatCtor = usePhysical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;

    const params: Record<string, any> = {
      color: new THREE.Color(0xffffff),
      map: maps.map,
      normalMap: maps.normalMap,
      roughnessMap: maps.ormMap,
      metalnessMap: maps.ormMap,
      aoMap: maps.ormMap,
      aoMapIntensity: preset.aoMapIntensity,
      envMapIntensity: preset.envMapIntensity,
      roughness: 1.0,
      metalness: 1.0,
      normalScale: new THREE.Vector2(preset.normalScale, preset.normalScale),
    };
    if (usePhysical) {
      params.clearcoat = preset.clearcoat;
      params.clearcoatRoughness = preset.clearcoatRoughness;
    }

    const mat = new MatCtor(params);
    mat.name = `hanamura_${preset.id}`;
    return applyArchitecturalWorldUv(THREE, mat, {
      scaleU: preset.worldUvScale[0],
      scaleV: preset.worldUvScale[1],
      roofPitchUv: preset.roofPitchUv,
      groundMoss: preset.groundMoss,
      macroTint: preset.macroTint,
      cacheKey: preset.id,
    });
  }

  // 1–10. Core Wood (`木材`), Stone (`石材`), and Tile (`瓦片`) Classical Village PBR Materials
  const ishigakiStone = createPresetMaterial('ishigakiStone', hiTex, 2.5);
  const graniteSteps = createPresetMaterial('graniteSteps', medTex, 1.9);
  const villageCobble = createPresetMaterial('villageCobble', hiTex, 2.2);
  const kawaraTile = createPresetMaterial('kawaraTile', hiTex, 2.7);
  kawaraTile.side = THREE.DoubleSide;
  const namakoWall = createPresetMaterial('namakoWall', hiTex, 2.6);
  const thatchRoof = createPresetMaterial('thatchRoof', hiTex, 2.3);
  thatchRoof.side = THREE.DoubleSide;
  const agedHinoki = createPresetMaterial('agedHinoki', hiTex, 1.75);
  const bridgePlank = createPresetMaterial('bridgePlank', hiTex, 2.1);
  const yakisugiPlank = createPresetMaterial('yakisugiPlank', hiTex, 2.1);
  const vermilionLacquer = createPresetMaterial('vermilionLacquer', medTex, 1.1);

  // 11. SHIKKUI WHITE LIME PLASTER (`漆喰白壁` — Hand-Troweled Warm Ivory Lime Wall, GPU MRT backed)
  let shikkuiMaps: GeneratedPbrMaps | null = null;
  if (G.mats?.getSet) {
    try {
      const gpuShikkui = G.mats.getSet('hanamura_shikkui');
      if (gpuShikkui?.albedo) {
        shikkuiMaps = { map: gpuShikkui.albedo, normalMap: gpuShikkui.normal, ormMap: gpuShikkui.orm };
      }
    } catch {
      shikkuiMaps = null;
    }
  }
  if (!shikkuiMaps) {
    shikkuiMaps = buildPbrMaps(THREE, medTex, maxAniso, 1.25, (u, v) => {
      const trowel = Math.sin((u * 3 + tileFbm(u, v, 4, 2, 937) * 1.6) * Math.PI * 2) * 0.5 + 0.5;
      const micro = tileFbm(u, v, 16, 3, 947);
      const stain = tileFbm(u * 0.5, v * 2, 8, 3, 967);
      const lum = 0.73 - stain * 0.08 + (micro - 0.5) * 0.05;
      return {
        r: lum,
        g: lum * 0.96,
        b: lum * 0.90,
        ao: 0.92 + trowel * 0.08,
        rough: clamp01(0.80 + (1 - trowel) * 0.13),
        metal: 0.0,
        height: 0.5 + trowel * 0.18 + micro * 0.22,
      };
    });
  }

  const shikkuiPlaster = applyArchitecturalWorldUv(
    THREE,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      map: shikkuiMaps.map,
      normalMap: shikkuiMaps.normalMap,
      roughnessMap: shikkuiMaps.ormMap,
      aoMap: shikkuiMaps.ormMap,
      aoMapIntensity: 1.05,
      envMapIntensity: 0.88,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(0.92, 0.92),
    }),
    { scaleU: 0.38, scaleV: 0.38, groundMoss: 0.22, macroTint: 0.08, cacheKey: 'shikkui' }
  );

  // 12. WASHI SHOJI PAPER & KUMIKO CEDAR LATTICE (`和纸障子门` — Warm Candlelit Interior Glow)
  const shojiMaps = buildPbrMaps(THREE, hiTex, maxAniso, 1.8, (u, v) => {
    const cols = 6;
    const rows = 10;
    const cu = fract(u * cols);
    const rv = fract(v * rows);
    const barX = cu < 0.09 || cu > 0.91;
    const barY = rv < 0.11 || rv > 0.89;
    const isFrame = barX || barY ? 1.0 : 0.0;
    const fiber = tileFbm(u, v, 24, 3, 1009);

    const paperR = 0.95 - (1 - fiber) * 0.07;
    const paperG = 0.88 - (1 - fiber) * 0.08;
    const paperB = 0.74 - (1 - fiber) * 0.09;

    const r = lerp(paperR, 0.25, isFrame);
    const g = lerp(paperG, 0.15, isFrame);
    const b = lerp(paperB, 0.08, isFrame);
    const height = isFrame > 0.5 ? 0.92 : 0.35 + fiber * 0.08;
    const ao = isFrame > 0.5 ? 0.86 : 0.96;
    const rough = isFrame > 0.5 ? 0.52 : 0.86;
    return { r, g, b, ao, rough, metal: 0.0, height };
  });

  const washiShoji = applyArchitecturalWorldUv(
    THREE,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      map: shojiMaps.map,
      normalMap: shojiMaps.normalMap,
      roughnessMap: shojiMaps.ormMap,
      aoMap: shojiMaps.ormMap,
      emissive: new THREE.Color(0xffa952),
      emissiveMap: shojiMaps.map,
      emissiveIntensity: 0.48,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(1.15, 1.15),
    }),
    { scaleU: 0.65, scaleV: 0.65, groundMoss: 0.0, macroTint: 0.04, cacheKey: 'shoji' }
  );

  // 13. TATAMI RUSH MAT (`叠席蔺草` — Woven Igusa Reed + Dark Indigo Brocade Border)
  const tatamiMaps = buildPbrMaps(THREE, medTex, maxAniso, 1.5, (u, v) => {
    const mu = fract(u * 2);
    const mv = v;
    const heri = mv < 0.055 || mv > 0.945 ? 1.0 : 0.0;
    const borderJoint = mu < 0.015 || mu > 0.985 ? 1.0 : 0.0;
    const weave = Math.sin(mv * Math.PI * 96) * 0.5 + 0.5;
    const stalk = tileNoise(u, v, 32, 1031);

    let r = 0.62 + weave * 0.07 + (stalk - 0.5) * 0.06;
    let g = 0.58 + weave * 0.07 + (stalk - 0.5) * 0.06;
    let b = 0.34 + weave * 0.04 + (stalk - 0.5) * 0.04;

    if (heri > 0.5) {
      const pat = Math.sin((u * 48 + v * 48) * Math.PI) * 0.5 + 0.5;
      r = 0.09 + pat * 0.08;
      g = 0.13 + pat * 0.09;
      b = 0.24 + pat * 0.10;
    }
    if (borderJoint > 0.5) {
      r *= 0.45;
      g *= 0.45;
      b *= 0.45;
    }
    const height = borderJoint > 0.5 ? 0.15 : heri > 0.5 ? 0.68 : 0.5 + weave * 0.22;
    const ao = borderJoint > 0.5 ? 0.32 : 0.88 + weave * 0.12;
    const rough = heri > 0.5 ? 0.72 : 0.64 + (1 - weave) * 0.16;
    return { r, g, b, ao, rough, metal: 0.0, height };
  });

  const tatamiRush = applyArchitecturalWorldUv(
    THREE,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      map: tatamiMaps.map,
      normalMap: tatamiMaps.normalMap,
      roughnessMap: tatamiMaps.ormMap,
      aoMap: tatamiMaps.ormMap,
      aoMapIntensity: 1.15,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(1.0, 1.0),
    }),
    { scaleU: 0.55, scaleV: 0.55, groundMoss: 0.0, macroTint: 0.05, cacheKey: 'tatami' }
  );

  // 14. MOSO BAMBOO CULM (`孟宗竹` — Jointed Green Nodes + Waxy Natural Sheen)
  const bambooMaps = buildPbrMaps(THREE, medTex, maxAniso, 1.6, (u, v) => {
    const nodes = 5;
    const nv = fract(v * nodes);
    const ring = Math.exp(-Math.pow((nv - 0.5) / 0.045, 2));
    const darkLine = Math.exp(-Math.pow((nv - 0.47) / 0.018, 2));
    const striation = tileNoise(u * 4, v * 0.25, 32, 1117);

    const r = 0.22 + striation * 0.07 + ring * 0.12 - darkLine * 0.10;
    const g = 0.42 + striation * 0.10 + ring * 0.10 - darkLine * 0.14;
    const b = 0.14 + striation * 0.04 + ring * 0.06 - darkLine * 0.06;
    const height = 0.45 + ring * 0.48 + striation * 0.07;
    const ao = 1.0 - darkLine * 0.42;
    const rough = clamp01(0.30 + (1 - striation) * 0.14 + ring * 0.24);
    return { r, g, b, ao, rough, metal: 0.02, height };
  });

  const bambooCulm = enhanceMaterialStylized(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      map: bambooMaps.map,
      normalMap: bambooMaps.normalMap,
      roughnessMap: bambooMaps.ormMap,
      aoMap: bambooMaps.ormMap,
      aoMapIntensity: 1.15,
      roughness: 1.0,
      metalness: 0.02,
      normalScale: new THREE.Vector2(1.15, 1.15),
    }),
    { role: 'architecture', id: 'bambooCulm' }
  );

  // 15. ANCIENT SAKURA BARK (`古樱树皮` — Dark Reddish-Brown Bark with Horizontal Lenticels)
  const barkMaps = buildPbrMaps(THREE, medTex, maxAniso, 2.1, (u, v) => {
    const furrow = tileFbm(u * 2, v * 0.5, 12, 3, 1151);
    const lenticel = smoothstep(0.76, 0.90, tileNoise(u * 0.5, v * 4, 32, 1171));
    const moss = smoothstep(0.66, 0.84, tileFbm(u, v, 6, 2, 1187)) * 0.35;

    let r = 0.22 + furrow * 0.11 + lenticel * 0.15;
    let g = 0.14 + furrow * 0.07 + lenticel * 0.10;
    let b = 0.12 + furrow * 0.05 + lenticel * 0.08;
    r = lerp(r, 0.19, moss);
    g = lerp(g, 0.36, moss);
    b = lerp(b, 0.15, moss);
    const height = furrow * 0.72 + lenticel * 0.22;
    const ao = 0.55 + furrow * 0.45;
    const rough = clamp01(0.78 + (1 - furrow) * 0.16);
    return { r, g, b, ao, rough, metal: 0.0, height };
  });

  const sakuraBark = enhanceMaterialStylized(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      map: barkMaps.map,
      normalMap: barkMaps.normalMap,
      roughnessMap: barkMaps.ormMap,
      aoMap: barkMaps.ormMap,
      aoMapIntensity: 1.2,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(1.3, 1.3),
    }),
    { role: 'architecture', id: 'sakuraBark' }
  );

  // 15B. JAPANESE RED PINE BARK (`赤松树皮` — Warm Cinnamon-Terracotta Upper Plates + Dark Furrows)
  const pineBarkMaps = buildPbrMaps(THREE, medTex, maxAniso, 2.2, (u, v) => {
    const plate = tileVoronoi(u, v * 0.55, 5, 6, 0.78, 1193);
    const fissure = smoothstep(0.03, 0.13, plate.edge);
    const grain = tileFbm(u * 2, v, 12, 3, 1199);
    const r = lerp(0.18, 0.48 + (plate.id - 0.5) * 0.08 + (grain - 0.5) * 0.06, fissure);
    const g = lerp(0.11, 0.27 + (plate.id - 0.5) * 0.05 + (grain - 0.5) * 0.04, fissure);
    const b = lerp(0.09, 0.19 + (grain - 0.5) * 0.03, fissure);
    return {
      r: clamp01(r),
      g: clamp01(g),
      b: clamp01(b),
      ao: lerp(0.32, 0.96, fissure),
      rough: lerp(0.94, 0.76, fissure),
      metal: 0.0,
      height: fissure * (0.58 + grain * 0.30),
    };
  });
  const pineBark = enhanceMaterialStylized(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      map: pineBarkMaps.map,
      normalMap: pineBarkMaps.normalMap,
      roughnessMap: pineBarkMaps.ormMap,
      aoMap: pineBarkMaps.ormMap,
      aoMapIntensity: 1.22,
      roughness: 1.0,
      metalness: 0.0,
      normalScale: new THREE.Vector2(1.35, 1.35),
    }),
    { role: 'architecture', id: 'pineBark' }
  );

  // 16. BOTANICAL ALPHA-CUTOUT FOLIAGE SPRIG TEXTURES & SUBSURFACE CANOPY SHADER
  //     Replaces smooth bubble-gum spheres with authentic notched 5-petal Sakura sprays,
  //     palmate Momiji maple leaves, cloud-pruned Akamatsu pine needle fans, and Moso bamboo leaves!
  const foliageTimeUniform = { value: 0 };
  const foliageSunDirUniform = { value: new THREE.Vector3(0.75, 0.41, 0.52).normalize() };

  function makeCanvasSprigTexture(seedBase: number, painter: (ctx: CanvasRenderingContext2D, size: number, rnd: () => number) => void) {
    const size = 256;
    let s = seedBase | 0;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return ((s >>> 0) % 100000) / 100000;
    };

    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = size;
      cv.height = size;
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, size, size);
        painter(ctx, size, rnd);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.anisotropy = maxAniso;
        tex.needsUpdate = true;
        return tex;
      }
    }

    // Headless Node unit-test fallback DataTexture
    const fallback = new Uint8Array(16 * 16 * 4);
    for (let i = 0; i < 16 * 16; i++) {
      fallback[i * 4] = 245;
      fallback[i * 4 + 1] = 195;
      fallback[i * 4 + 2] = 212;
      fallback[i * 4 + 3] = 255;
    }
    const dt = new THREE.DataTexture(fallback, 16, 16, THREE.RGBAFormat);
    dt.colorSpace = THREE.SRGBColorSpace;
    dt.needsUpdate = true;
    return dt;
  }

  function paintTwigs(ctx: CanvasRenderingContext2D, size: number, rnd: () => number, stroke: string, count = 5) {
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const x0 = size * (0.44 + (rnd() - 0.5) * 0.14);
      const y0 = size * (0.86 + (rnd() - 0.5) * 0.08);
      const ang = -Math.PI * 0.5 + (i / Math.max(1, count - 1) - 0.5) * 1.45 + (rnd() - 0.5) * 0.18;
      const len = size * (0.50 + rnd() * 0.24);
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;
      const cx = (x0 + x1) * 0.5 + (rnd() - 0.5) * size * 0.12;
      const cy = (y0 + y1) * 0.5 - rnd() * size * 0.06;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = size * (0.016 - i * 0.0012);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, x1, y1);
      ctx.stroke();
    }
  }

  function drawSakuraFlower(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    rot: number,
    petalColor: string,
    heartColor: string
  ) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = petalColor;
    for (let p = 0; p < 5; p++) {
      ctx.save();
      ctx.rotate((p * Math.PI * 2) / 5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-radius * 0.44, -radius * 0.36, -radius * 0.48, -radius * 0.94, -radius * 0.12, -radius);
      // Classic notched sakura petal tip (`花瓣先端缺刻`)
      ctx.lineTo(0, -radius * 0.80);
      ctx.lineTo(radius * 0.12, -radius);
      ctx.bezierCurveTo(radius * 0.48, -radius * 0.94, radius * 0.44, -radius * 0.36, 0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = heartColor;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.21, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const sakuraTexA = makeCanvasSprigTexture(5101, (ctx, size, rnd) => {
    paintTwigs(ctx, size, rnd, '#3a211d', 5);
    const layers: Array<[number, string[], string, number, number]> = [
      [44, ['#c96f8c', '#d67e9a', '#bf6280'], '#8c2444', 0.052, 0.074],
      [48, ['#f2b5c8', '#f8c8d8', '#eab0c4'], '#a82b50', 0.050, 0.072],
      [42, ['#ffe6ee', '#fff2f6', '#ffd9e6'], '#be385e', 0.046, 0.068],
    ];
    for (const [cnt, cols, heart, rMin, rMax] of layers) {
      for (let i = 0; i < cnt; i++) {
        const ang = rnd() * Math.PI * 2;
        const dist = Math.pow(rnd(), 0.62) * size * 0.40;
        const x = size * 0.5 + Math.cos(ang) * dist * 1.04;
        const y = size * 0.48 + Math.sin(ang) * dist * 0.92;
        const rad = size * (rMin + rnd() * (rMax - rMin));
        const col = cols[Math.floor(rnd() * cols.length)];
        drawSakuraFlower(ctx, x, y, rad, rnd() * Math.PI * 2, col, heart);
      }
    }
  });

  const sakuraTexB = makeCanvasSprigTexture(5209, (ctx, size, rnd) => {
    paintTwigs(ctx, size, rnd, '#361e1a', 5);
    const layers: Array<[number, string[], string, number, number]> = [
      [44, ['#b95878', '#c86888', '#ae4e6e'], '#7d1c3a', 0.052, 0.074],
      [48, ['#eaa0b8', '#f4b6ca', '#e296b0'], '#9c264a', 0.050, 0.072],
      [40, ['#ffd6e4', '#ffe8f0', '#ffc8da'], '#b43258', 0.046, 0.068],
    ];
    for (const [cnt, cols, heart, rMin, rMax] of layers) {
      for (let i = 0; i < cnt; i++) {
        const ang = rnd() * Math.PI * 2;
        const dist = Math.pow(rnd(), 0.62) * size * 0.40;
        const x = size * 0.5 + Math.cos(ang) * dist * 1.04;
        const y = size * 0.48 + Math.sin(ang) * dist * 0.92;
        const rad = size * (rMin + rnd() * (rMax - rMin));
        const col = cols[Math.floor(rnd() * cols.length)];
        drawSakuraFlower(ctx, x, y, rad, rnd() * Math.PI * 2, col, heart);
      }
    }
  });

  const mapleTex = makeCanvasSprigTexture(5303, (ctx, size, rnd) => {
    paintTwigs(ctx, size, rnd, '#331c15', 5);
    const drawMomijiLeaf = (cx: number, cy: number, rad: number, rot: number, col: string) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, rad * 0.18);
      // 7-lobed Japanese Iroha-Momiji star silhouette
      const lobes = [
        [-0.82, 0.25, -0.30, 0.05],
        [-0.95, -0.34, -0.36, -0.16],
        [-0.55, -0.88, -0.18, -0.38],
        [0.0, -1.08, 0.18, -0.38],
        [0.55, -0.88, 0.36, -0.16],
        [0.95, -0.34, 0.30, 0.05],
        [0.82, 0.25, 0.0, 0.18],
      ];
      for (const [lx, ly, vx, vy] of lobes) {
        ctx.lineTo(lx * rad, ly * rad);
        ctx.lineTo(vx * rad, vy * rad);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    const layers: Array<[number, string[], number, number]> = [
      [34, ['#6d1510', '#851b13', '#5c110d'], 0.075, 0.105],
      [38, ['#ba2617', '#d4381c', '#c82e18'], 0.072, 0.100],
      [34, ['#eb5620', '#f37824', '#e0461c', '#f5962a'], 0.065, 0.094],
    ];
    for (const [cnt, cols, rMin, rMax] of layers) {
      for (let i = 0; i < cnt; i++) {
        const ang = rnd() * Math.PI * 2;
        const dist = Math.pow(rnd(), 0.62) * size * 0.39;
        const x = size * 0.5 + Math.cos(ang) * dist * 1.04;
        const y = size * 0.48 + Math.sin(ang) * dist * 0.92;
        drawMomijiLeaf(x, y, size * (rMin + rnd() * (rMax - rMin)), rnd() * Math.PI * 2, cols[Math.floor(rnd() * cols.length)]);
      }
    }
  });

  const pineTex = makeCanvasSprigTexture(5407, (ctx, size, rnd) => {
    paintTwigs(ctx, size, rnd, '#3e2316', 4);
    const drawNeedleFan = (cx: number, cy: number, rad: number, rot: number, col: string) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.6, rad * 0.085);
      ctx.lineCap = 'round';
      for (let n = -6; n <= 6; n++) {
        const a = -Math.PI * 0.5 + n * 0.165;
        const l = rad * (0.78 + (1 - Math.abs(n) / 7) * 0.26);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l);
        ctx.stroke();
      }
      ctx.restore();
    };
    const layers: Array<[number, string[], number, number]> = [
      [30, ['#102416', '#152d1b', '#193520'], 0.095, 0.135],
      [34, ['#1f4024', '#264b29', '#204425'], 0.090, 0.125],
      [28, ['#2f5a2e', '#3a6934', '#46763a'], 0.082, 0.115],
    ];
    for (const [cnt, cols, rMin, rMax] of layers) {
      for (let i = 0; i < cnt; i++) {
        const ang = rnd() * Math.PI * 2;
        const dist = Math.pow(rnd(), 0.60) * size * 0.37;
        const x = size * 0.5 + Math.cos(ang) * dist * 1.12;
        const y = size * 0.52 + Math.sin(ang) * dist * 0.80;
        drawNeedleFan(
          x,
          y,
          size * (rMin + rnd() * (rMax - rMin)),
          (rnd() - 0.5) * 1.1,
          cols[Math.floor(rnd() * cols.length)]
        );
      }
    }
  });

  const bambooLeafTex = makeCanvasSprigTexture(5501, (ctx, size, rnd) => {
    paintTwigs(ctx, size, rnd, '#355422', 4);
    const drawLanceLeaf = (cx: number, cy: number, len: number, rot: number, col: string) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.16, -len * 0.42, 0, -len);
      ctx.quadraticCurveTo(-len * 0.16, -len * 0.42, 0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    const cols = ['#1a3c19', '#254e20', '#316227', '#427630', '#548939'];
    for (let i = 0; i < 82; i++) {
      const ang = rnd() * Math.PI * 2;
      const dist = Math.pow(rnd(), 0.65) * size * 0.36;
      const x = size * 0.5 + Math.cos(ang) * dist;
      const y = size * 0.5 + Math.sin(ang) * dist * 0.88;
      const leafAng = Math.atan2(y - size * 0.55, x - size * 0.5) + Math.PI * 0.5 + (rnd() - 0.5) * 0.85;
      drawLanceLeaf(
        x,
        y,
        size * (0.13 + rnd() * 0.09),
        leafAng,
        cols[Math.min(cols.length - 1, Math.floor((i / 82) * cols.length))]
      );
    }
  });

  function createBotanicalFoliageMaterial(
    tex: any,
    tintHex: number,
    backlightHex: number,
    cacheKey: string,
    swayAmp = 0.075
  ) {
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      color: new THREE.Color(tintHex),
      alphaTest: 0.40,
      side: THREE.DoubleSide,
      roughness: 0.82,
      metalness: 0.0,
      envMapIntensity: 0.85,
    });
    const backCol = new THREE.Color(backlightHex);
    mat.onBeforeCompile = (shader: any) => {
      shader.uniforms.uFolTime = foliageTimeUniform;
      shader.uniforms.uFolSun = foliageSunDirUniform;
      shader.uniforms.uBackCol = { value: backCol };

      shader.vertexShader =
        `attribute vec3 aFolMeta;
         uniform float uFolTime;
         varying vec3 vFolMeta;
         varying vec3 vFolWorldPos;
         varying vec3 vFolSmoothNrm;\n` +
        shader.vertexShader
          .replace(
            '#include <beginnormal_vertex>',
            `#include <beginnormal_vertex>
             #ifdef USE_INSTANCING
               mat4 folNrmMat = modelMatrix * instanceMatrix;
             #else
               mat4 folNrmMat = modelMatrix;
             #endif
             vFolSmoothNrm = normalize(mat3(folNrmMat) * objectNormal);`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             #ifdef USE_INSTANCING
               mat4 folPosMat = modelMatrix * instanceMatrix;
             #else
               mat4 folPosMat = modelMatrix;
             #endif
             vFolMeta = aFolMeta.x > 0.001 ? aFolMeta : vec3(0.88, 0.55, 0.25);
             vec4 folWp = folPosMat * vec4(transformed, 1.0);
             float flutter = sin(uFolTime * 1.85 + folWp.x * 0.42 + folWp.z * 0.37 + vFolMeta.z * 6.2831) * ${swayAmp.toFixed(3)};
             transformed.x += flutter * (0.35 + uv.y * 0.65);
             transformed.z += cos(uFolTime * 1.45 + folWp.z * 0.48 + vFolMeta.z * 4.71) * ${(swayAmp * 0.75).toFixed(3)} * (0.35 + uv.y * 0.65);
             vFolWorldPos = (folPosMat * vec4(transformed, 1.0)).xyz;`
          );

      shader.fragmentShader =
        `uniform vec3 uFolSun;
         uniform vec3 uBackCol;
         varying vec3 vFolMeta;
         varying vec3 vFolWorldPos;
         varying vec3 vFolSmoothNrm;\n` +
        shader.fragmentShader
          .replace(
            '#include <normal_fragment_begin>',
            `// Keep continuous spherical canopy normal on both sides of sprig cards (zero harsh X-card seams!)
             vec3 normal = normalize((viewMatrix * vec4(vFolSmoothNrm, 0.0)).xyz);
             vec3 nonPerturbedNormal = normal;`
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             // Apply inner-to-outer canopy AO & sunlit crown tip warmth
             float canAo = clamp(vFolMeta.x, 0.34, 1.0);
             diffuseColor.rgb *= mix(0.54, 0.98, canAo);`
          )
          .replace(
            '#include <lights_fragment_end>',
            `#include <lights_fragment_end>
             {
               vec3 viewD = normalize(cameraPosition - vFolWorldPos);
               float sunTrans = pow(max(0.0, dot(-viewD, uFolSun)), 2.6) * (0.30 + 0.70 * vFolMeta.y);
               float rimUp = smoothstep(-0.2, 0.85, vFolSmoothNrm.y) * vFolMeta.y;
               reflectedLight.indirectDiffuse += diffuseColor.rgb * uBackCol * (sunTrans * 0.55 + rimUp * 0.14);
             }`
          );
    };
    mat.customProgramCacheKey = () => `hanamura-foliage-v2-${cacheKey}`;
    return mat;
  }

  const sakuraBlossomA = createBotanicalFoliageMaterial(sakuraTexA, 0xffdde8, 0xf282a4, 'sakura-a', 0.075);
  const sakuraBlossomB = createBotanicalFoliageMaterial(sakuraTexB, 0xffd2e2, 0xe87298, 'sakura-b', 0.075);
  const autumnMaple = createBotanicalFoliageMaterial(mapleTex, 0xffffff, 0xe85e1c, 'maple', 0.070);
  const pineNeedles = createBotanicalFoliageMaterial(pineTex, 0xffffff, 0x4e7a34, 'pine', 0.042);
  const bambooFoliage = createBotanicalFoliageMaterial(bambooLeafTex, 0xffffff, 0x7ab444, 'bamboo-leaf', 0.095);

  // 17. INDIGO NOREN SHOP CURTAIN (`蓝染暖帘` — Woven Hemp Cloth + White Kamon Crest)
  const norenMaps = buildPbrMaps(THREE, medTex, maxAniso, 1.2, (u, v) => {
    const weaveU = Math.sin(u * Math.PI * 120) * 0.5 + 0.5;
    const weaveV = Math.sin(v * Math.PI * 120) * 0.5 + 0.5;
    const weave = (weaveU + weaveV) * 0.5;
    const panelU = fract(u * 3) - 0.5;
    const panelV = v - 0.48;
    const rad = Math.sqrt(panelU * panelU + panelV * panelV * 1.4);
    const ring = smoothstep(0.19, 0.17, rad) * smoothstep(0.11, 0.13, rad);
    const bar = Math.abs(panelV) < 0.022 && rad < 0.14 ? 1.0 : 0.0;
    const crest = clamp01(ring + bar);

    const r = lerp(0.08 + weave * 0.04, 0.92, crest);
    const g = lerp(0.14 + weave * 0.05, 0.90, crest);
    const b = lerp(0.28 + weave * 0.07, 0.85, crest);
    return { r, g, b, ao: 0.88 + weave * 0.12, rough: 0.86, metal: 0.0, height: weave * 0.4 + crest * 0.15 };
  });

  const norenIndigo = enhanceMaterialStylized(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      map: norenMaps.map,
      normalMap: norenMaps.normalMap,
      roughnessMap: norenMaps.ormMap,
      aoMap: norenMaps.ormMap,
      roughness: 1.0,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
    { role: 'architecture', id: 'norenIndigo' }
  );

  // 18. AGED TEMPLE BRONZE (`古青铜梵钟 / 拟宝珠 / 鯱鉾` — Patinated Verdigris & Polished Bronze Highlights)
  const bronzeMaps = buildPbrMaps(THREE, medTex, maxAniso, 1.5, (u, v) => {
    const pat = tileFbm(u, v, 8, 3, 1237);
    const verd = smoothstep(0.58, 0.80, pat);
    const r = lerp(0.62, 0.24, verd);
    const g = lerp(0.48, 0.54, verd);
    const b = lerp(0.24, 0.44, verd);
    const rough = lerp(0.26, 0.78, verd);
    const metal = lerp(0.88, 0.25, verd);
    return {
      r,
      g,
      b,
      ao: 0.82 + (1 - verd) * 0.18,
      rough,
      metal,
      height: 0.5 + (1 - verd) * 0.25 + pat * 0.15,
    };
  });

  const bronzeAged = enhanceMaterialStylized(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      map: bronzeMaps.map,
      normalMap: bronzeMaps.normalMap,
      roughnessMap: bronzeMaps.ormMap,
      metalnessMap: bronzeMaps.ormMap,
      aoMap: bronzeMaps.ormMap,
      aoMapIntensity: 1.15,
      envMapIntensity: 1.35,
      roughness: 1.0,
      metalness: 1.0,
    }),
    { role: 'architecture', id: 'bronzeAged' }
  );

  // 19. WARM OILED PAPER CHOCHIN LANTERN & IRON KAGARIBI BRAZIER EMBER
  const warmPaperLantern = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffdfa8),
    emissive: new THREE.Color(0xff9838),
    emissiveIntensity: 2.4,
    roughness: 0.72,
    metalness: 0.0,
  });

  const brazierEmber = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff6b1a),
    toneMapped: false,
  });

  // 20. ANIMATED CRYSTAL MOUNTAIN STREAM WATER (`清流溪水`)
  const streamUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.76, 0.38, 0.52).normalize() },
  };
  const streamWater = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: streamUniforms,
    vertexShader: `
      varying vec3 vWorldPos;
      varying vec2 vUvW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vUvW = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      varying vec3 vWorldPos;
      varying vec2 vUvW;

      float wHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float wNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x),
          mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      void main() {
        vec2 flow1 = vec2(vUvW.x * 0.85 + uTime * 1.55, vUvW.y * 1.45);
        vec2 flow2 = vec2(vUvW.x * 1.65 + uTime * 2.25, vUvW.y * 2.75 + 1.3);
        float n1 = wNoise(flow1 * 2.2);
        float n2 = wNoise(flow2 * 3.1);
        float ripple = n1 * 0.6 + n2 * 0.4;

        vec3 nrm = normalize(vec3((ripple - 0.5) * 0.52, 1.0, (n1 - n2) * 0.45));
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(viewDir, nrm), 0.0), 3.1);
        vec3 halfV = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(nrm, halfV), 0.0), 64.0);

        float bankDist = abs(vWorldPos.z - 25.0);
        float wheelSplash = 1.0 - smoothstep(1.2, 3.8, length(vWorldPos.xz - vec2(-20.5, 25.0)));
        float foam = (smoothstep(1.85, 2.55, bankDist) + wheelSplash * 0.65) * smoothstep(0.38, 0.70, ripple);
        float rapids = smoothstep(0.74, 0.92, ripple) * 0.32;

        vec3 deepJade = vec3(0.09, 0.44, 0.60);
        vec3 skyRefl = vec3(0.52, 0.80, 0.96);
        vec3 sunGlint = vec3(1.0, 0.90, 0.70) * (spec * 1.65);
        vec3 col = mix(deepJade, skyRefl, clamp(fresnel * 0.76 + 0.14, 0.0, 0.86)) + sunGlint;
        col = mix(col, vec3(0.94, 0.98, 1.0), clamp(foam + rapids, 0.0, 0.86));

        float alpha = clamp(0.72 + fresnel * 0.20 + foam * 0.22, 0.0, 0.94);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  function update(dt: number) {
    streamUniforms.uTime.value += dt;
    foliageTimeUniform.value += dt;
  }

  const lib: VillageMaterialLibrary = {
    ishigakiStone,
    graniteSteps,
    kawaraTile,
    thatchRoof,
    agedHinoki,
    bridgePlank,
    yakisugiPlank,
    vermilionLacquer,
    shikkuiPlaster,
    namakoWall,
    washiShoji,
    tatamiRush,
    villageCobble,
    bambooCulm,
    sakuraBark,
    pineBark,
    sakuraBlossomA,
    sakuraBlossomB,
    autumnMaple,
    pineNeedles,
    bambooFoliage,
    norenIndigo,
    bronzeAged,
    warmPaperLantern,
    brazierEmber,
    streamWater,
    presets: HANAMURA_PBR_PRESETS,
    update,
  };
  if (G) G.__villageMats = lib;
  return lib;
}

/**
 * Replaces the industrial port ground material on `G.ground.apron` with a
 * World-Space Classical Japanese Mountain Village Terrain Shader (`三和土村道 · 石叠参道敷石 · 苔庭 · 清流河床`)
 * with full ORM (`aoMap` + `roughnessMap`) and 16-bit Sobel `normalMap` blending!
 */
export function applyClassicalVillageGround(G: any, mats: VillageMaterialLibrary): void {
  const THREE = G.THREE;
  if (!G.ground || !G.ground.apron) return;
  if (G.ground.setRain) G.ground.setRain(0);
  if (G.ground.rain) G.ground.rain.visible = false;

  const qTex = G.quality?.tex || 512;
  const gSize = qTex >= 1024 ? 256 : 192;
  const maxAniso = Math.min(
    8,
    G.renderer?.capabilities?.getMaxAnisotropy ? G.renderer.capabilities.getMaxAnisotropy() : 2
  );

  // Synthesize natural rammed-earth (`三和土 tataki`) + river pebble + moss micro-PBR set
  const earthMaps = buildPbrMaps(THREE, gSize, maxAniso, 2.0, (u, v) => {
    const gran = tileFbm(u, v, 12, 4, 1409);
    const peb = tileVoronoi(u, v, 12, 12, 0.9, 1427);
    const pebBump = smoothstep(0.04, 0.22, peb.edge) * (peb.id > 0.72 ? 1 : 0.25);
    const r = 0.41 + (gran - 0.5) * 0.10 + pebBump * 0.06;
    const g = 0.35 + (gran - 0.5) * 0.09 + pebBump * 0.05;
    const b = 0.27 + (gran - 0.5) * 0.08 + pebBump * 0.05;
    const height = gran * 0.55 + pebBump * 0.45;
    const ao = 0.78 + gran * 0.14 + pebBump * 0.08;
    const rough = clamp01(0.88 - pebBump * 0.22 + (1 - gran) * 0.10);
    return { r, g, b, ao, rough, metal: 0.02, height };
  });

  const groundMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    map: earthMaps.map,
    normalMap: earthMaps.normalMap,
    roughnessMap: earthMaps.ormMap,
    aoMap: earthMaps.ormMap,
    aoMapIntensity: 1.24,
    envMapIntensity: 0.80,
    roughness: 1.0,
    metalness: 0.02,
    normalScale: new THREE.Vector2(1.32, 1.32),
  });

  const cobbleTex = mats.villageCobble.map;
  const cobbleNrm = mats.villageCobble.normalMap;
  const cobbleOrm = mats.villageCobble.roughnessMap;

  groundMat.onBeforeCompile = (shader: any) => {
    shader.uniforms.tCobble = { value: cobbleTex };
    shader.uniforms.tCobbleN = { value: cobbleNrm };
    shader.uniforms.tCobbleR = { value: cobbleOrm };

    shader.vertexShader =
      `varying vec3 vVgWorld;\n` +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vVgWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vec2 vgUv = vVgWorld.xz * 0.38;
        #ifdef USE_MAP
          vMapUv = vgUv;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = vgUv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = vgUv;
        #endif
        #ifdef USE_AOMAP
          vAoMapUv = vgUv;
        #endif`
      );

    shader.fragmentShader =
      `varying vec3 vVgWorld;
       uniform sampler2D tCobble;
       uniform sampler2D tCobbleN;
       uniform sampler2D tCobbleR;
       float vVgRoad = 0.0;
       float vVgWarmPool = 0.0;
       vec4 vVgCobOrm = vec4(1.0);

       float vgBoxMask(vec2 p, vec2 lo, vec2 hi, float feather) {
         vec2 d = max(lo - p, p - hi);
         float outside = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
         return 1.0 - smoothstep(-feather * 0.35, feather, outside);
       }

       float vgRoadMask(vec2 xz) {
         // 1. Stage 1 Ramen & Arcade Attacker Plaza (x: -71.5..-26.0, z: -15.5..+15.5)
         float stage1Plaza = vgBoxMask(xz, vec2(-71.5, -15.5), vec2(-25.5, 15.5), 2.4);
         // 2. Stage 2 Point A Great Bell Courtyard (x: -26.5..+23.8, z: -23.5..+22.0)
         float bellCourtyard = vgBoxMask(xz, vec2(-26.5, -23.5), vec2(23.8, 22.0), 2.6);
         // 3. South Cliffside Sakura Overlook Walk (x: -21.5..+21.0, z: 28.0..45.5)
         float southPromenade = vgBoxMask(xz, vec2(-21.5, 28.0), vec2(21.0, 45.5), 2.8);
         // 4. Flank passages through Choke Gate North/South doors (z around +-30.5)
         float flankN = vgBoxMask(xz, vec2(-36.0, -33.2), vec2(-20.0, -27.8), 1.8);
         float flankS = vgBoxMask(xz, vec2(-36.0, 27.8), vec2(-20.0, 33.2), 1.8);
         return clamp(max(max(stage1Plaza, bellCourtyard), max(southPromenade, max(flankN, flankS))), 0.0, 1.0);
       }

       float vgStreamMask(vec2 xz) {
         // East-West Koi Stream channel (x: -22.8..+19.8, z: 22.3..27.7)
         return vgBoxMask(xz, vec2(-22.8, 22.3), vec2(19.8, 27.7), 1.1);
       }

       float vgWarmLanternPool(vec2 xz) {
         float g = 0.0;
         // Warm lantern pools at Choke Gate, Ramen/Arcade storefronts, Bell Pavilion & Stone Toro lanterns
         g += exp(-dot(xz - vec2(-28.0, 0.0), xz - vec2(-28.0, 0.0)) * 0.032) * 0.55;
         g += exp(-dot(xz - vec2(-55.0, -15.5), xz - vec2(-55.0, -15.5)) * 0.045) * 0.52;
         g += exp(-dot(xz - vec2(-55.0, 15.5), xz - vec2(-55.0, 15.5)) * 0.045) * 0.52;
         g += exp(-dot(xz - vec2(-2.0, 0.0), xz - vec2(-2.0, 0.0)) * 0.022) * 0.48;
         g += exp(-dot(xz - vec2(-64.0, -5.8), xz - vec2(-64.0, -5.8)) * 0.09) * 0.44;
         g += exp(-dot(xz - vec2(-64.0, 5.8), xz - vec2(-64.0, 5.8)) * 0.09) * 0.44;
         g += exp(-dot(xz - vec2(-33.5, -5.8), xz - vec2(-33.5, -5.8)) * 0.09) * 0.44;
         g += exp(-dot(xz - vec2(-33.5, 5.8), xz - vec2(-33.5, 5.8)) * 0.09) * 0.44;
         g += exp(-dot(xz - vec2(14.5, -6.0), xz - vec2(14.5, -6.0)) * 0.09) * 0.44;
         g += exp(-dot(xz - vec2(14.5, 6.0), xz - vec2(14.5, 6.0)) * 0.09) * 0.44;
         g += exp(-dot(xz - vec2(-1.5, 42.0), xz - vec2(-1.5, 42.0)) * 0.05) * 0.42;
         return clamp(g, 0.0, 0.85);
       }\n` +
      shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec2 xz = vVgWorld.xz;
            float streamBed = vgStreamMask(xz);
            vVgRoad = vgRoadMask(xz) * (1.0 - streamBed * 0.65);
            vVgWarmPool = vgWarmLanternPool(xz);
            vec2 cobUv = xz * 0.44;
            vec4 cob = texture2D(tCobble, cobUv);
            vVgCobOrm = texture2D(tCobbleR, cobUv);

            float macro = sin(xz.x * 0.11 + cos(xz.y * 0.09) * 2.1) * 0.5 + 0.5;
            float grass = smoothstep(0.32, 0.76, macro) * (1.0 - vVgRoad) * (1.0 - streamBed);
            float outer = smoothstep(22.0, 54.0, max(abs(xz.x + 8.0) * 0.72, abs(xz.y)));
            grass = clamp(grass + outer * (1.0 - vVgRoad) * (1.0 - streamBed) * 0.68, 0.0, 0.90);

            // Subtle concentric Zen-garden flagstone ring accent around Point A Great Bell (-2, 0)
            float bellDist = length(xz - vec2(-2.0, 0.0));
            float zenRing = smoothstep(6.2, 6.8, bellDist) * (1.0 - smoothstep(14.5, 16.0, bellDist));
            float zenRipple = sin(bellDist * 5.2) * 0.035 * zenRing;

            vec3 earthRgb = diffuseColor.rgb * vec3(1.00, 0.95, 0.88);
            vec3 mossRgb = mix(vec3(0.11, 0.30, 0.12), vec3(0.19, 0.41, 0.16), macro);
            vec3 col = mix(earthRgb, mossRgb, grass);
            vec3 cobbleCol = cob.rgb * (0.96 + zenRipple);
            col = mix(col, cobbleCol, vVgRoad * 0.95);
            col = mix(col, cob.rgb * vec3(0.36, 0.60, 0.74), streamBed * 0.90);

            // Scattered fallen pink sakura petals near garden borders & sakura trees
            float petalHash = fract(sin(dot(floor(xz * 5.5), vec2(12.9898, 78.233))) * 43758.5453);
            float nearTrees = (1.0 - streamBed) * smoothstep(0.962, 0.996, petalHash) * (1.0 - smoothstep(72.0, 92.0, max(abs(xz.x), abs(xz.y))));
            col = mix(col, vec3(0.76, 0.45, 0.57), nearTrees * 0.62);

            // Feather outer village apron (>84m) seamlessly into lush spring-emerald mountain-foothill floor
            float edgeDist = max(abs(xz.x), abs(xz.y));
            float foothillBlend = smoothstep(84.0, 116.0, edgeDist);
            vec3 foothillCol = mix(vec3(0.09, 0.24, 0.14), vec3(0.14, 0.32, 0.17), macro);
            col = mix(col, foothillCol, foothillBlend);

            diffuseColor.rgb = col;
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          {
            float streamR = vgStreamMask(vVgWorld.xz);
            roughnessFactor = mix(roughnessFactor, vVgCobOrm.g, vVgRoad * 0.95);
            roughnessFactor = mix(roughnessFactor, 0.16, streamR * 0.88);
          }`
        )
        .replace(
          '#include <aomap_fragment>',
          `{
            float earthAo = texture2D(aoMap, vAoMapUv).r;
            float blendedAo = mix(earthAo, vVgCobOrm.r, vVgRoad * 0.95);
            float ambientOcclusion = (blendedAo - 1.0) * aoMapIntensity + 1.0;
            reflectedLight.indirectDiffuse *= ambientOcclusion;
            #if defined( USE_CLEARCOAT )
              clearcoatSpecularIndirect *= ambientOcclusion;
            #endif
            #if defined( USE_SHEEN )
              sheenSpecularIndirect *= ambientOcclusion;
            #endif
            #if defined( USE_ENVMAP ) && defined( STANDARD )
              float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
              reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
            #endif
          }`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `{
            vec3 eN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
            vec3 cN = texture2D(tCobbleN, vVgWorld.xz * 0.44).xyz * 2.0 - 1.0;
            vec3 mapN = normalize(mix(eN, cN, vVgRoad * 0.95));
            mapN.xy *= normalScale;
            mat3 tbn = getTangentFrame(-vViewPosition, normal, vNormalMapUv);
            normal = normalize(tbn * mapN);
          }`
        )
        .replace(
          '#include <lights_fragment_end>',
          `{
            if (vVgWarmPool > 0.004) {
              vec3 vgLanternGlow = vec3(1.06, 0.55, 0.18) * vVgWarmPool;
              reflectedLight.indirectDiffuse += diffuseColor.rgb * vgLanternGlow * 0.68;
            }
          }
          #include <lights_fragment_end>`
        );
  };
  groundMat.customProgramCacheKey = () => 'classical-village-ground-v5';
  enhanceMaterialStylized(groundMat, { role: 'architecture', id: 'villageGround' });

  G.ground.apron.material = groundMat;
  G.ground.apron.receiveShadow = true;
}
