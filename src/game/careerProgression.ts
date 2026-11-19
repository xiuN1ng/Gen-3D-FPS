/**
 * Persistent Shinobi Career Profile, 20-Card + 6-Synergy + 10-Hostile Codex,
 * and Shura Difficulty / Challenge Mutator Rules (`花村武道生涯 · 秘传图鉴 · 修罗试炼词缀`).
 *
 * 100% pure TypeScript with injectable StorageLike adapter (defaults to browser localStorage
 * with automatic in-memory fallback in Node/headless test environments).
 */

import {
  SYNERGY_CATALOG,
  UPGRADE_CATALOG,
  type HeroClassId,
  type SynergyPairId,
  type SynergyTier,
} from './roguelike.ts';

export type DifficultyTierId = 'normal' | 'shura' | 'abyss';

export type ChallengeMutatorId =
  | 'blood_moon'
  | 'overclock_legion'
  | 'volatile_arena'
  | 'glass_cannon';

export interface DifficultyTierSpec {
  id: DifficultyTierId;
  label: string;
  shortLabel: string;
  subtitle: string;
  enemyHpMult: number;
  enemyDamageMult: number;
  spawnIntervalScale: number;
  scoreMultiplier: number;
}

export interface ChallengeMutatorSpec {
  id: ChallengeMutatorId;
  title: string;
  shortTitle: string;
  description: string;
  scoreBonus: number;
}

export interface ChallengeModifiers {
  difficulty: DifficultyTierId;
  mutators: ChallengeMutatorId[];
  enemyHpMult: number;
  enemyDamageMult: number;
  enemySpeedMult: number;
  spawnIntervalScale: number;
  playerMaxHpMult: number;
  playerDamageMult: number;
  playerUltGainMult: number;
  waveHealMult: number;
  vampiricKillHeal: number;
  propCooldownScale: number;
  propDamageMult: number;
  scoreMultiplier: number;
  bannerTag: string;
}

export const DIFFICULTY_TIERS: readonly DifficultyTierSpec[] = [
  {
    id: 'normal',
    label: '初阵 · 常世',
    shortLabel: '初阵',
    subtitle: '标准战术强度 · 均衡体验三英雄流派构筑',
    enemyHpMult: 1.0,
    enemyDamageMult: 1.0,
    spawnIntervalScale: 1.0,
    scoreMultiplier: 1.0,
  },
  {
    id: 'shura',
    label: '修罗 · 百鬼',
    shortLabel: '修罗',
    subtitle: '敌军生命 +28% · 伤害 +22% · 刷怪提速 · 武勋 ×1.45',
    enemyHpMult: 1.28,
    enemyDamageMult: 1.22,
    spawnIntervalScale: 0.86,
    scoreMultiplier: 1.45,
  },
  {
    id: 'abyss',
    label: '无间 · 天罚',
    shortLabel: '无间',
    subtitle: '敌军生命 +58% · 伤害 +42% · 狂潮强袭 · 武勋 ×1.95',
    enemyHpMult: 1.58,
    enemyDamageMult: 1.42,
    spawnIntervalScale: 0.74,
    scoreMultiplier: 1.95,
  },
];

export const CHALLENGE_MUTATORS: readonly ChallengeMutatorSpec[] = [
  {
    id: 'blood_moon',
    title: '赤月狂岚',
    shortTitle: '赤月',
    description: '波次休整回复减半，但每次直接淘汰敌军立即回复 14 点生命（武勋 +0.25×）',
    scoreBonus: 0.25,
  },
  {
    id: 'overclock_legion',
    title: '神速机关',
    shortTitle: '神速',
    description: '机关军团移速与弹速提升 20%，我方终极技充能效率提升 20%（武勋 +0.25×）',
    scoreBonus: 0.25,
  },
  {
    id: 'volatile_arena',
    title: '雷火满庭',
    shortTitle: '雷火',
    description: '花村酒樽与古寺梵钟再生提速一倍，机关爆炸与音波伤害提升 35%（武勋 +0.20×）',
    scoreBonus: 0.20,
  },
  {
    id: 'glass_cannon',
    title: '修罗孤刃',
    shortTitle: '孤刃',
    description: '我方全武器与技能伤害大幅提升 +38%，但最大生命上限降低 25%（武勋 +0.30×）',
    scoreBonus: 0.30,
  },
];

const VALID_DIFFICULTIES = new Set<DifficultyTierId>(['normal', 'shura', 'abyss']);
const VALID_MUTATORS = new Set<ChallengeMutatorId>([
  'blood_moon',
  'overclock_legion',
  'volatile_arena',
  'glass_cannon',
]);

export function sanitizeDifficultyTier(raw: unknown): DifficultyTierId {
  return typeof raw === 'string' && VALID_DIFFICULTIES.has(raw as DifficultyTierId)
    ? (raw as DifficultyTierId)
    : 'normal';
}

export function sanitizeMutatorList(raw: unknown): ChallengeMutatorId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<ChallengeMutatorId>();
  const out: ChallengeMutatorId[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && VALID_MUTATORS.has(item as ChallengeMutatorId)) {
      const id = item as ChallengeMutatorId;
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/**
 * Pure deterministic solver computing all active gameplay & scoring multipliers for a run.
 * When `difficulty === 'normal'` and `mutators` is empty, all combat multipliers equal `1.0`.
 */
export function computeChallengeModifiers(
  difficultyRaw: DifficultyTierId = 'normal',
  mutatorsRaw: readonly ChallengeMutatorId[] = []
): ChallengeModifiers {
  const difficulty = sanitizeDifficultyTier(difficultyRaw);
  const mutators = sanitizeMutatorList([...mutatorsRaw]);
  const tier = DIFFICULTY_TIERS.find((t) => t.id === difficulty) ?? DIFFICULTY_TIERS[0];

  const has = (m: ChallengeMutatorId) => mutators.includes(m);

  let scoreBonusSum = 0;
  for (const m of mutators) {
    const spec = CHALLENGE_MUTATORS.find((c) => c.id === m);
    if (spec) scoreBonusSum += spec.scoreBonus;
  }

  const scoreMultiplier = +(tier.scoreMultiplier + scoreBonusSum).toFixed(2);
  const mutLabels = mutators
    .map((m) => CHALLENGE_MUTATORS.find((c) => c.id === m)?.shortTitle || m)
    .join('·');
  const bannerTag = mutLabels ? `${tier.shortLabel} [${mutLabels}]` : tier.label;

  return {
    difficulty,
    mutators,
    enemyHpMult: tier.enemyHpMult,
    enemyDamageMult: tier.enemyDamageMult,
    enemySpeedMult: has('overclock_legion') ? 1.20 : 1.0,
    spawnIntervalScale: tier.spawnIntervalScale,
    playerMaxHpMult: has('glass_cannon') ? 0.75 : 1.0,
    playerDamageMult: has('glass_cannon') ? 1.38 : 1.0,
    playerUltGainMult: has('overclock_legion') ? 1.20 : 1.0,
    waveHealMult: has('blood_moon') ? 0.5 : 1.0,
    vampiricKillHeal: has('blood_moon') ? 14 : 0,
    propCooldownScale: has('volatile_arena') ? 0.5 : 1.0,
    propDamageMult: has('volatile_arena') ? 1.35 : 1.0,
    scoreMultiplier,
    bannerTag,
  };
}

// ============================================================================
// PERSISTENT CAREER PROFILE & CODEX (`武道生涯档案 · 秘传与羁绊图鉴`)
// ============================================================================

export const CAREER_STORAGE_KEY = 'hanamura_career_v1';

export const HOSTILE_CODEX_SPECS: readonly { id: string; name: string; role: string }[] = [
  { id: 'trooper', name: '足轻铁炮兵', role: '中距步枪压制' },
  { id: 'hound', name: '疾风忍犬', role: '高速近身突袭' },
  { id: 'gull', name: '机关侦察鸢', role: '高空灵巧游击' },
  { id: 'swarm', name: '自爆蜂群机', role: '集群俯冲奇袭' },
  { id: 'sniper', name: '飞檐狙击手', role: '制高点激光蓄狙' },
  { id: 'spider_mech', name: '多足机关蛛', role: '六足跳跃散射' },
  { id: 'shield_guard', name: '玄甲盾卫兵', role: '正盾弹反 · 突刺破绽' },
  { id: 'mortar_crab', name: '重装迫击蟹', role: '抛物轰炸 · 散热核破绽' },
  { id: 'boss', name: '赤备统领 · 鬼丸', role: '重甲波次首领' },
  { id: 'colossus', name: '八岐鬼王丸', role: '八米荒神巨像 · 雷神天罚' },
];

export interface HeroCareerStats {
  runs: number;
  kills: number;
  bestWave: number;
  bestScore: number;
  bossKills: number;
}

export interface RunHistoryEntry {
  timestamp: number;
  hero: HeroClassId;
  difficulty: DifficultyTierId;
  mutators: ChallengeMutatorId[];
  wave: number;
  kills: number;
  score: number;
  honorGain: number;
  durationSec: number;
  rating: string;
  synergyCount: number;
}

export interface CareerProfile {
  version: 1;
  totalRuns: number;
  totalKills: number;
  totalPlayTimeSec: number;
  highestWave: number;
  highestScore: number;
  bossesDefeated: number;
  coreInterrupts: number;
  parryCount: number;
  propsTriggered: number;
  honorPoints: number;
  bgmEnabled: boolean;
  preferredDifficulty: DifficultyTierId;
  preferredMutators: ChallengeMutatorId[];
  heroStats: Record<HeroClassId, HeroCareerStats>;
  unlockedTalents: Record<string, number>;
  unlockedSynergies: Partial<Record<SynergyPairId, SynergyTier>>;
  defeatedHostiles: Record<string, number>;
  recentRuns: RunHistoryEntry[];
}

export interface CareerRankInfo {
  rankIndex: number;
  title: string;
  nextTitle: string | null;
  currentHonor: number;
  nextThreshold: number | null;
  progressRatio: number;
}

const CAREER_RANKS: readonly { threshold: number; title: string }[] = [
  { threshold: 0, title: '初阵门生' },
  { threshold: 450, title: '飞檐下忍' },
  { threshold: 1350, title: '疾风中忍' },
  { threshold: 3200, title: '秘传上忍' },
  { threshold: 6500, title: '护国剑豪' },
  { threshold: 12000, title: '花村武神' },
];

export function computeCareerRank(honorPoints: number): CareerRankInfo {
  const safeHonor = Math.max(0, Math.floor(Number.isFinite(honorPoints) ? honorPoints : 0));
  let idx = 0;
  for (let i = 0; i < CAREER_RANKS.length; i++) {
    if (safeHonor >= CAREER_RANKS[i].threshold) {
      idx = i;
    }
  }
  const curr = CAREER_RANKS[idx];
  const next = idx + 1 < CAREER_RANKS.length ? CAREER_RANKS[idx + 1] : null;
  const progressRatio = next
    ? Math.max(
        0,
        Math.min(1, (safeHonor - curr.threshold) / Math.max(1, next.threshold - curr.threshold))
      )
    : 1;

  return {
    rankIndex: idx,
    title: curr.title,
    nextTitle: next ? next.title : null,
    currentHonor: safeHonor,
    nextThreshold: next ? next.threshold : null,
    progressRatio: +progressRatio.toFixed(3),
  };
}

export interface CodexProgressSummary {
  talentsUnlocked: number;
  talentsTotal: number;
  synergiesUnlocked: number;
  synergiesTier2: number;
  synergiesTotal: number;
  hostilesUnlocked: number;
  hostilesTotal: number;
  totalUnlocked: number;
  totalEntries: number;
  completionPct: number;
}

export function computeCodexProgress(profile: CareerProfile): CodexProgressSummary {
  let talentsUnlocked = 0;
  for (const card of UPGRADE_CATALOG) {
    if ((profile.unlockedTalents[card.id] || 0) > 0) talentsUnlocked++;
  }
  let synergiesUnlocked = 0;
  let synergiesTier2 = 0;
  for (const syn of SYNERGY_CATALOG) {
    const t = profile.unlockedSynergies[syn.id] || 0;
    if (t >= 1) synergiesUnlocked++;
    if (t >= 2) synergiesTier2++;
  }
  let hostilesUnlocked = 0;
  for (const h of HOSTILE_CODEX_SPECS) {
    if ((profile.defeatedHostiles[h.id] || 0) > 0) hostilesUnlocked++;
  }

  const talentsTotal = UPGRADE_CATALOG.length;
  const synergiesTotal = SYNERGY_CATALOG.length;
  const hostilesTotal = HOSTILE_CODEX_SPECS.length;
  const totalUnlocked = talentsUnlocked + synergiesUnlocked + hostilesUnlocked;
  const totalEntries = talentsTotal + synergiesTotal + hostilesTotal;

  return {
    talentsUnlocked,
    talentsTotal,
    synergiesUnlocked,
    synergiesTier2,
    synergiesTotal,
    hostilesUnlocked,
    hostilesTotal,
    totalUnlocked,
    totalEntries,
    completionPct: Math.round((totalUnlocked / Math.max(1, totalEntries)) * 100),
  };
}

export interface RunScoreInput {
  wave: number;
  kills: number;
  durationSec: number;
  shots: number;
  hits: number;
  bossKills: number;
  coreInterrupts: number;
  parries: number;
  propsTriggered: number;
  synergyCount: number;
  scoreMultiplier: number;
}

export interface RunScoreSummary {
  rawScore: number;
  finalScore: number;
  honorGain: number;
  rating: string;
}

export function computeRunSummaryScore(input: RunScoreInput): RunScoreSummary {
  const w = Math.max(1, Math.floor(input.wave || 1));
  const kills = Math.max(0, Math.floor(input.kills || 0));
  const bossKills = Math.max(0, Math.floor(input.bossKills || 0));
  const interrupts = Math.max(0, Math.floor(input.coreInterrupts || 0));
  const parries = Math.max(0, Math.floor(input.parries || 0));
  const props = Math.max(0, Math.floor(input.propsTriggered || 0));
  const syn = Math.max(0, Math.floor(input.synergyCount || 0));
  const acc = input.shots > 0 ? Math.max(0, Math.min(1, input.hits / input.shots)) : 0;

  const rawScore =
    w * 320 +
    kills * 48 +
    bossKills * 650 +
    interrupts * 280 +
    parries * 35 +
    props * 45 +
    syn * 180 +
    Math.round(acc * 350);

  const mult = Math.max(0.5, Number.isFinite(input.scoreMultiplier) ? input.scoreMultiplier : 1.0);
  const finalScore = Math.round(rawScore * mult);
  const honorGain = Math.max(25, Math.round(finalScore * 0.14));

  let rating = '初阵历练';
  if (finalScore >= 9500) rating = '无双武神 · 传世神技';
  else if (finalScore >= 6000) rating = '护国剑豪 · 破阵惊雷';
  else if (finalScore >= 3600) rating = '秘传上忍 · 疾风迅雷';
  else if (finalScore >= 1800) rating = '果断精锐 · 锋芒毕露';

  return { rawScore, finalScore, honorGain, rating };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function createDefaultHeroStats(): HeroCareerStats {
  return { runs: 0, kills: 0, bestWave: 0, bestScore: 0, bossKills: 0 };
}

export function createEmptyCareerProfile(): CareerProfile {
  return {
    version: 1,
    totalRuns: 0,
    totalKills: 0,
    totalPlayTimeSec: 0,
    highestWave: 0,
    highestScore: 0,
    bossesDefeated: 0,
    coreInterrupts: 0,
    parryCount: 0,
    propsTriggered: 0,
    honorPoints: 0,
    bgmEnabled: true,
    preferredDifficulty: 'normal',
    preferredMutators: [],
    heroStats: {
      genji: createDefaultHeroStats(),
      gunner: createDefaultHeroStats(),
      hanzo: createDefaultHeroStats(),
    },
    unlockedTalents: {},
    unlockedSynergies: {},
    defeatedHostiles: {},
    recentRuns: [],
  };
}

function resolveDefaultStorage(): StorageLike {
  const mem = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage.getItem(key);
        }
      } catch {
        // Fallback to in-memory map on sandboxed/private storage
      }
      return mem.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      mem.set(key, value);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, value);
        }
      } catch {
        // Ignore quota / sandbox errors
      }
    },
  };
}

function sanitizeHeroStats(raw: unknown): HeroCareerStats {
  if (!raw || typeof raw !== 'object') return createDefaultHeroStats();
  const obj = raw as Record<string, unknown>;
  const num = (k: string) => {
    const v = Number(obj[k]);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  };
  return {
    runs: num('runs'),
    kills: num('kills'),
    bestWave: num('bestWave'),
    bestScore: num('bestScore'),
    bossKills: num('bossKills'),
  };
}

export function parseCareerProfile(rawJson: string | null): CareerProfile {
  const base = createEmptyCareerProfile();
  if (!rawJson) return base;
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return base;
    const num = (k: string) => {
      const v = Number(parsed[k]);
      return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
    };

    base.totalRuns = num('totalRuns');
    base.totalKills = num('totalKills');
    base.totalPlayTimeSec = num('totalPlayTimeSec');
    base.highestWave = num('highestWave');
    base.highestScore = num('highestScore');
    base.bossesDefeated = num('bossesDefeated');
    base.coreInterrupts = num('coreInterrupts');
    base.parryCount = num('parryCount');
    base.propsTriggered = num('propsTriggered');
    base.honorPoints = num('honorPoints');
    base.bgmEnabled = parsed.bgmEnabled !== false;
    base.preferredDifficulty = sanitizeDifficultyTier(parsed.preferredDifficulty);
    base.preferredMutators = sanitizeMutatorList(parsed.preferredMutators);

    if (parsed.heroStats && typeof parsed.heroStats === 'object') {
      const hs = parsed.heroStats as Record<string, unknown>;
      base.heroStats.genji = sanitizeHeroStats(hs.genji);
      base.heroStats.gunner = sanitizeHeroStats(hs.gunner);
      base.heroStats.hanzo = sanitizeHeroStats(hs.hanzo);
    }

    if (parsed.unlockedTalents && typeof parsed.unlockedTalents === 'object') {
      for (const [k, v] of Object.entries(parsed.unlockedTalents as Record<string, unknown>)) {
        const n = Math.floor(Number(v));
        if (Number.isFinite(n) && n > 0) base.unlockedTalents[k] = n;
      }
    }
    if (parsed.unlockedSynergies && typeof parsed.unlockedSynergies === 'object') {
      for (const syn of SYNERGY_CATALOG) {
        const v = Math.floor(
          Number((parsed.unlockedSynergies as Record<string, unknown>)[syn.id])
        );
        if (v === 1 || v === 2) {
          base.unlockedSynergies[syn.id] = v;
        }
      }
    }
    if (parsed.defeatedHostiles && typeof parsed.defeatedHostiles === 'object') {
      for (const [k, v] of Object.entries(parsed.defeatedHostiles as Record<string, unknown>)) {
        const n = Math.floor(Number(v));
        if (Number.isFinite(n) && n > 0) base.defeatedHostiles[k] = n;
      }
    }
    if (Array.isArray(parsed.recentRuns)) {
      base.recentRuns = parsed.recentRuns.slice(0, 8).filter((r) => r && typeof r === 'object') as RunHistoryEntry[];
    }
    return base;
  } catch {
    return createEmptyCareerProfile();
  }
}

export interface RunCompletionRecordInput {
  hero: HeroClassId;
  difficulty: DifficultyTierId;
  mutators: ChallengeMutatorId[];
  wave: number;
  kills: number;
  durationSec: number;
  shots: number;
  hits: number;
  bossKills: number;
  coreInterrupts: number;
  parries: number;
  propsTriggered: number;
  synergyCount: number;
  scoreMultiplier: number;
  timestamp?: number;
}

export interface RunCompletionOutcome {
  scoreSummary: RunScoreSummary;
  isNewBestWave: boolean;
  isNewBestScore: boolean;
  rankUp: boolean;
  prevRank: CareerRankInfo;
  nextRank: CareerRankInfo;
}

export interface CareerStore {
  readonly profile: CareerProfile;
  save: () => void;
  setBgmEnabled: (enabled: boolean) => void;
  setChallengeSelection: (difficulty: DifficultyTierId, mutators: ChallengeMutatorId[]) => void;
  recordTalentPick: (cardId: string) => boolean;
  recordSynergies: (tiers: Record<SynergyPairId, SynergyTier>) => boolean;
  recordHostileDefeat: (variantId: string) => boolean;
  recordCombatMilestone: (kind: 'parry' | 'prop' | 'core_interrupt') => void;
  recordRunCompleted: (input: RunCompletionRecordInput) => RunCompletionOutcome;
  getRankInfo: () => CareerRankInfo;
  getCodexProgress: () => CodexProgressSummary;
  resetCareer: () => void;
}

export function createCareerStore(customStorage?: StorageLike): CareerStore {
  const storage = customStorage ?? resolveDefaultStorage();
  let profile = parseCareerProfile(storage.getItem(CAREER_STORAGE_KEY));

  function save() {
    storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(profile));
  }

  return {
    get profile() {
      return profile;
    },
    save,
    setBgmEnabled(enabled: boolean) {
      profile.bgmEnabled = Boolean(enabled);
      save();
    },
    setChallengeSelection(difficulty: DifficultyTierId, mutators: ChallengeMutatorId[]) {
      profile.preferredDifficulty = sanitizeDifficultyTier(difficulty);
      profile.preferredMutators = sanitizeMutatorList(mutators);
      save();
    },
    recordTalentPick(cardId: string): boolean {
      const prev = profile.unlockedTalents[cardId] || 0;
      profile.unlockedTalents[cardId] = prev + 1;
      save();
      return prev === 0;
    },
    recordSynergies(tiers: Record<SynergyPairId, SynergyTier>): boolean {
      let newlyDiscovered = false;
      for (const syn of SYNERGY_CATALOG) {
        const nextTier = tiers[syn.id] || 0;
        if (nextTier >= 1) {
          const prevTier = profile.unlockedSynergies[syn.id] || 0;
          if (nextTier > prevTier) {
            profile.unlockedSynergies[syn.id] = nextTier;
            if (prevTier === 0) newlyDiscovered = true;
          }
        }
      }
      if (newlyDiscovered) save();
      else save();
      return newlyDiscovered;
    },
    recordHostileDefeat(variantId: string): boolean {
      if (!variantId) return false;
      const prev = profile.defeatedHostiles[variantId] || 0;
      profile.defeatedHostiles[variantId] = prev + 1;
      if (variantId === 'boss' || variantId === 'colossus') {
        profile.bossesDefeated++;
      }
      // Persist immediately on first codex discovery; otherwise batch at run completion / draft
      if (prev === 0) {
        save();
        return true;
      }
      return false;
    },
    recordCombatMilestone(kind: 'parry' | 'prop' | 'core_interrupt') {
      if (kind === 'parry') profile.parryCount++;
      else if (kind === 'prop') profile.propsTriggered++;
      else if (kind === 'core_interrupt') profile.coreInterrupts++;
    },
    recordRunCompleted(input: RunCompletionRecordInput): RunCompletionOutcome {
      const prevRank = computeCareerRank(profile.honorPoints);
      const scoreSummary = computeRunSummaryScore(input);

      const wave = Math.max(1, Math.floor(input.wave || 1));
      const kills = Math.max(0, Math.floor(input.kills || 0));
      const dur = Math.max(0, Math.floor(input.durationSec || 0));

      const isNewBestWave = wave > profile.highestWave;
      const isNewBestScore = scoreSummary.finalScore > profile.highestScore;

      profile.totalRuns++;
      profile.totalKills += kills;
      profile.totalPlayTimeSec += dur;
      if (isNewBestWave) profile.highestWave = wave;
      if (isNewBestScore) profile.highestScore = scoreSummary.finalScore;
      profile.honorPoints += scoreSummary.honorGain;

      const hs = profile.heroStats[input.hero] ?? createDefaultHeroStats();
      hs.runs++;
      hs.kills += kills;
      hs.bossKills += Math.max(0, Math.floor(input.bossKills || 0));
      if (wave > hs.bestWave) hs.bestWave = wave;
      if (scoreSummary.finalScore > hs.bestScore) hs.bestScore = scoreSummary.finalScore;
      profile.heroStats[input.hero] = hs;

      const entry: RunHistoryEntry = {
        timestamp: input.timestamp ?? Date.now(),
        hero: input.hero,
        difficulty: sanitizeDifficultyTier(input.difficulty),
        mutators: sanitizeMutatorList(input.mutators),
        wave,
        kills,
        score: scoreSummary.finalScore,
        honorGain: scoreSummary.honorGain,
        durationSec: dur,
        rating: scoreSummary.rating,
        synergyCount: Math.max(0, Math.floor(input.synergyCount || 0)),
      };
      profile.recentRuns.unshift(entry);
      if (profile.recentRuns.length > 8) {
        profile.recentRuns.length = 8;
      }

      const nextRank = computeCareerRank(profile.honorPoints);
      save();

      return {
        scoreSummary,
        isNewBestWave,
        isNewBestScore,
        rankUp: nextRank.rankIndex > prevRank.rankIndex,
        prevRank,
        nextRank,
      };
    },
    getRankInfo: () => computeCareerRank(profile.honorPoints),
    getCodexProgress: () => computeCodexProgress(profile),
    resetCareer() {
      profile = createEmptyCareerProfile();
      save();
    },
  };
}
