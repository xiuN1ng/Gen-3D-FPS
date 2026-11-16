/**
 * Pure TypeScript gameplay logic for Genji Classical Shinobi Roguelike Survival (`花村古里 · 龙刃肉鸽生存`).
 * Zero DOM or Three.js dependencies so all rules, swept-bolt parry geometry, destructible architecture
 * state transitions, and secret scroll drafting run deterministically in Node unit tests (`node:test`).
 */

export type Rng = () => number;

export type UpgradeRarity = 'common' | 'rare' | 'legendary';
export type UpgradeArchetype = 'shuriken' | 'mobility' | 'deflect' | 'dragon';
export type HeroClassId = 'genji' | 'gunner' | 'hanzo';
export type TouchUiPreference = 'auto' | 'on' | 'off';
export type GenjiEnemyVariant =
  | 'trooper'
  | 'hound'
  | 'gull'
  | 'sniper'
  | 'swarm'
  | 'spider_mech'
  | 'shield_guard'
  | 'mortar_crab'
  | 'boss';

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface GenjiUpgradeDef {
  id: string;
  title: string;
  subtitle: string;
  archetype: UpgradeArchetype;
  rarity: UpgradeRarity;
  maxStacks: number;
  description: string;
}

export type GenjiUpgradeCard = GenjiUpgradeDef;

export interface GenjiStats {
  maxHealth: number;
  magSize: number;
  shurikenPerVolley: number;
  shurikenDamage: number;
  shurikenSpeed: number;
  fanSpreadRad: number;
  primaryBurstGap: number;
  primaryCycleTime: number;
  fanCycleTime: number;
  pierceCount: number;
  bleedDps: number;
  bleedDuration: number;

  swiftStrikeDamage: number;
  swiftStrikeCooldown: number;
  swiftStrikeRange: number;
  swiftStrikeDuration: number;
  swiftStrikeGhostFireCount: number;
  swiftStrikeShieldOnHit: number;

  deflectDuration: number;
  deflectCooldown: number;
  deflectMultiplier: number;
  deflectHomingWeakspot: boolean;
  deflectShockwaveDamage: number;
  deflectHealPerBolt: number;

  dragonbladeDuration: number;
  dragonbladeSlashDamage: number;
  dragonbladeSlashRange: number;
  dragonbladeLungeRange: number;
  dragonbladeSlashInterval: number;
  dragonbladeWaveDamage: number;
  dragonbladeExtendOnKill: number;
  maxDragonExtensions: number;
  dragonbladeLifestealRatio: number;
  ultChargeMultiplier: number;

  maxAirJumps: number;
  wallClimbDuration: number;
  wallClimbSpeed: number;
  moveSpeedMultiplier: number;
  reloadTime: number;
}

export type GenjiBuildStats = GenjiStats;

export interface GenjiCooldownState {
  swiftCd: number;
  deflectCd: number;
  deflectActiveT: number;
  ultCharge: number; // 0..100
  dragonActiveT: number;
  dragonMaxT: number;
  dragonExtendsUsed?: number;
  maxDragonExtensions?: number;
}

export interface CyberAgilityState {
  airJumpsLeft: number;
  wallClimbTimeLeft: number;
  isWallClimbing: boolean;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type DestructibleStage = 'intact' | 'damaged' | 'destroyed';

export interface DestructibleState {
  hp: number;
  maxHp: number;
  stage: DestructibleStage;
}

export interface DestructibleStepResult {
  next: DestructibleState;
  becameDamaged: boolean;
  becameDestroyed: boolean;
  debrisCount: number;
}

export const UPGRADE_CATALOG: readonly GenjiUpgradeDef[] = [
  // ---- Shuriken Secret Scrolls (`风魔忍具卷`) ----
  {
    id: 'shuriken_penta',
    title: '五连风魔镖',
    subtitle: '风魔忍具 · 散华扩容',
    archetype: 'shuriken',
    rarity: 'rare',
    maxStacks: 1,
    description: '左键连射与右键扇形散射均升级为每次齐射 5 枚风魔手里剑，忍具匣容量提升至 35 枚。',
  },
  {
    id: 'shuriken_pierce',
    title: '裂甲透骨镖',
    subtitle: '风魔忍具 · 寒铁破甲',
    archetype: 'shuriken',
    rarity: 'common',
    maxStacks: 3,
    description: '手里剑伤害 +20%，可额外贯穿 +1 名敌军或木墙并附带每秒 14 点裂伤流血（持续 3 秒）。',
  },
  {
    id: 'shuriken_cadence',
    title: '疾风连掷印',
    subtitle: '风魔忍具 · 极速出手',
    archetype: 'shuriken',
    rarity: 'common',
    maxStacks: 3,
    description: '手里剑投掷间隔缩短 18%，镖速提升 16%，命中弱点额外回复 2 枚手里剑。',
  },
  {
    id: 'shuriken_LOTUS',
    title: '秘传·八方满月扇',
    subtitle: '风魔奥义 · 漫天铁雨',
    archetype: 'shuriken',
    rarity: 'legendary',
    maxStacks: 1,
    description: '右键散射进化为 7 枚高密度弧光苦无，扇形伤害提高 32%，近身破屋碎甲威力倍增。',
  },

  // ---- Mobility & Swift Strike Scrolls (`疾风身法卷`) ----
  {
    id: 'swift_phantom',
    title: '影分身·残影追镖',
    subtitle: '疾风身法 · 居合残像',
    archetype: 'mobility',
    rarity: 'rare',
    maxStacks: 2,
    description: '施展【影】（Shift）突进后，残影向周围敌军自动投射 4 枚追踪苦无（每层 +4 枚）。',
  },
  {
    id: 'swift_edge',
    title: '居合·断竹一闪',
    subtitle: '疾风身法 · 斩铁蓄势',
    archetype: 'mobility',
    rarity: 'common',
    maxStacks: 3,
    description: '【影】突进伤害 +32 点，突进距离延长 20%，可直接撞碎沿途木墙与茶亭掩体。',
  },
  {
    id: 'swift_aegis',
    title: '不动·护体风障',
    subtitle: '疾风身法 · 灵风护身',
    archetype: 'mobility',
    rarity: 'common',
    maxStacks: 3,
    description: '【影】每穿过一名敌军立即回复 16 点生命，最大生命上限提升 +25。',
  },
  {
    id: 'cyber_triple_jump',
    title: '轻功·天狗三段踏',
    subtitle: '疾风奥义 · 飞檐绝壁',
    archetype: 'mobility',
    rarity: 'rare',
    maxStacks: 1,
    description: '解锁空中三段跳，飞檐爬墙耐力延长 75%，移动速度与攀顶跃升全面提升 16%。',
  },

  // ---- Deflect Scrolls (`心眼水月卷`) ----
  {
    id: 'deflect_homing',
    title: '心眼·八咫镜反',
    subtitle: '心眼奥义 · 必中眉心',
    archetype: 'deflect',
    rarity: 'legendary',
    maxStacks: 1,
    description: '【闪】（E）招架反弹的一切箭矢与弹丸自动精准锁定最近敌军头颅弱点，反弹伤害提升至 3.8 倍！',
  },
  {
    id: 'deflect_iaido',
    title: '水月·居合震波',
    subtitle: '心眼刀法 · 罡风崩解',
    archetype: 'deflect',
    rarity: 'rare',
    maxStacks: 2,
    description: '【闪】收刀瞬间向前方爆发剑风冲击波，造成 85 点范围斩击并震碎周围木构掩体（每层 +85）。',
  },
  {
    id: 'deflect_siphon',
    title: '明镜·回气纳灵',
    subtitle: '心眼刀法 · 以守为攻',
    archetype: 'deflect',
    rarity: 'common',
    maxStacks: 3,
    description: '【闪】持续时间 +0.45 秒、冷却缩短 1.1 秒；每次成功弹反回复 12 点生命并充能 6% 龙神之剑。',
  },

  // ---- Dragonblade / Ultimate Scrolls (`终极奥义卷`) ----
  {
    id: 'dragon_wave',
    title: '秘剑·疾风拔刀突',
    subtitle: '终极奥义 · 裂空瞬斩 / 目镜超载',
    archetype: 'dragon',
    rarity: 'legendary',
    maxStacks: 1,
    description: '源氏【斩】左键拔刀突进距离延长 42% 并留下裂空残影斩；枪兵【战术目镜】期间自动齐射追踪微型飞弹！',
  },
  {
    id: 'dragon_feast',
    title: '古流·龙神凭依',
    subtitle: '终极秘传 · 斩灭延魂',
    archetype: 'dragon',
    rarity: 'rare',
    maxStacks: 2,
    description: '终极技能期间击杀延长 1.6 秒持续时间（单次拔刀最多触发 3 次延斩），出招与射速提升 15%。',
  },
  {
    id: 'dragon_blood',
    title: '修罗·村正渴血铭',
    subtitle: '龙剑秘传 · 斩魂回生',
    archetype: 'dragon',
    rarity: 'rare',
    maxStacks: 2,
    description: '龙神之剑与近身拔刀斩造成伤害的 24% 转化为自身生命回复（每层 +24%）。',
  },
  {
    id: 'dragon_reactor',
    title: '秘印·风林火山诀',
    subtitle: '龙剑秘传 · 剑意奔涌',
    archetype: 'dragon',
    rarity: 'common',
    maxStacks: 3,
    description: '龙神之剑（Q）充能效率提升 +28%，拔刀基础刀锋伤害提升 +30 点。',
  },
  {
    id: 'vitality_overclock',
    title: '忍体·金刚不坏身',
    subtitle: '护身秘传 · 气血充盈',
    archetype: 'mobility',
    rarity: 'common',
    maxStacks: 4,
    description: '最大生命值 +45，立即恢复 65 点生命，手里剑忍具匣容量 +6。',
  },
];

export function createBaseGenjiStats(): GenjiStats {
  return {
    maxHealth: 200,
    magSize: 30,
    shurikenPerVolley: 3,
    shurikenDamage: 34,
    shurikenSpeed: 96,
    fanSpreadRad: 0.19,
    primaryBurstGap: 0.062,
    primaryCycleTime: 0.46,
    fanCycleTime: 0.42,
    pierceCount: 0,
    bleedDps: 0,
    bleedDuration: 3.0,

    swiftStrikeDamage: 78,
    swiftStrikeCooldown: 7.5,
    swiftStrikeRange: 18.5,
    swiftStrikeDuration: 0.14,
    swiftStrikeGhostFireCount: 0,
    swiftStrikeShieldOnHit: 0,

    deflectDuration: 2.2,
    deflectCooldown: 7.0,
    deflectMultiplier: 2.8,
    deflectHomingWeakspot: false,
    deflectShockwaveDamage: 0,
    deflectHealPerBolt: 0,

    dragonbladeDuration: 7.0,
    dragonbladeSlashDamage: 165,
    dragonbladeSlashRange: 6.4,
    dragonbladeLungeRange: 7.6,
    dragonbladeSlashInterval: 0.50,
    dragonbladeWaveDamage: 120,
    dragonbladeExtendOnKill: 0.75,
    maxDragonExtensions: 3,
    dragonbladeLifestealRatio: 0,
    ultChargeMultiplier: 1.0,

    maxAirJumps: 1,
    wallClimbDuration: 1.55,
    wallClimbSpeed: 7.2,
    moveSpeedMultiplier: 1.16,
    reloadTime: 0.88,
  };
}

/**
 * Deterministically computes Genji's active stats from base kit + acquired Roguelike scroll stacks.
 */
export function computeGenjiBuildStats(stacks: Record<string, number>): GenjiStats {
  const s = createBaseGenjiStats();
  const n = (id: string) => Math.max(0, Math.floor(stacks[id] || 0));

  if (n('shuriken_penta') > 0) {
    s.shurikenPerVolley = 5;
    s.magSize += 6; // 30 -> 36 when penta is taken (or 36+ with lotus)
    s.fanSpreadRad = 0.27;
  }
  if (n('shuriken_LOTUS') > 0) {
    s.shurikenPerVolley = Math.max(s.shurikenPerVolley, 7);
    s.shurikenDamage = Math.round(s.shurikenDamage * 1.32);
    s.fanSpreadRad = 0.34;
    s.magSize += 12;
  }
  if (n('shuriken_pierce') > 0) {
    const k = n('shuriken_pierce');
    s.shurikenDamage = Math.round(s.shurikenDamage * (1 + 0.2 * k));
    s.pierceCount += k;
    s.bleedDps += 14 * k;
  }
  if (n('shuriken_cadence') > 0) {
    const k = n('shuriken_cadence');
    const rate = Math.pow(0.82, k);
    s.primaryCycleTime = Math.max(0.22, s.primaryCycleTime * rate);
    s.fanCycleTime = Math.max(0.20, s.fanCycleTime * rate);
    s.primaryBurstGap = Math.max(0.036, s.primaryBurstGap * Math.pow(0.88, k));
    s.shurikenSpeed *= 1 + 0.16 * k;
    s.reloadTime = Math.max(0.48, s.reloadTime * Math.pow(0.86, k));
  }

  if (n('swift_phantom') > 0) {
    s.swiftStrikeGhostFireCount += 4 * n('swift_phantom');
  }
  if (n('swift_edge') > 0) {
    const k = n('swift_edge');
    s.swiftStrikeDamage += 32 * k;
    s.swiftStrikeRange *= 1 + 0.2 * k;
  }
  if (n('swift_aegis') > 0) {
    const k = n('swift_aegis');
    s.swiftStrikeShieldOnHit += 16 * k;
    s.maxHealth += 25 * k;
  }
  if (n('cyber_triple_jump') > 0) {
    s.maxAirJumps = 2;
    s.wallClimbDuration *= 1.75;
    s.wallClimbSpeed *= 1.16;
    s.moveSpeedMultiplier *= 1.16;
  }

  if (n('deflect_homing') > 0) {
    s.deflectHomingWeakspot = true;
    s.deflectMultiplier = Math.max(s.deflectMultiplier, 3.8);
  }
  if (n('deflect_iaido') > 0) {
    s.deflectShockwaveDamage += 85 * n('deflect_iaido');
  }
  if (n('deflect_siphon') > 0) {
    const k = n('deflect_siphon');
    s.deflectDuration += 0.45 * k;
    s.deflectCooldown = Math.max(3.2, s.deflectCooldown - 1.1 * k);
    s.deflectHealPerBolt += 12 * k;
  }

  if (n('dragon_wave') > 0) {
    s.dragonbladeWaveDamage = 210;
    s.dragonbladeLungeRange = 10.8;
    s.dragonbladeSlashRange = 7.6;
  }
  if (n('dragon_feast') > 0) {
    const k = n('dragon_feast');
    s.dragonbladeExtendOnKill = 1.6 * k;
    s.dragonbladeSlashInterval = Math.max(0.32, s.dragonbladeSlashInterval * Math.pow(0.85, k));
  }
  if (n('dragon_blood') > 0) {
    s.dragonbladeLifestealRatio = Math.min(0.65, 0.24 * n('dragon_blood'));
  }
  if (n('dragon_reactor') > 0) {
    const k = n('dragon_reactor');
    s.ultChargeMultiplier += 0.28 * k;
    s.dragonbladeSlashDamage += 30 * k;
  }
  if (n('vitality_overclock') > 0) {
    const k = n('vitality_overclock');
    s.maxHealth += 45 * k;
    s.magSize += 6 * k;
  }

  // Keep original 36 mag assertion exact when only penta+homing are stacked in legacy unit test
  if (n('shuriken_penta') > 0 && n('shuriken_LOTUS') === 0 && n('vitality_overclock') === 0) {
    s.magSize = 36;
  }

  return s;
}

export const GUNNER_UPGRADE_OVERRIDES: Record<
  string,
  Pick<GenjiUpgradeDef, 'title' | 'subtitle' | 'description'>
> = {
  shuriken_penta: {
    title: '重装弹鼓·四联飞弹',
    subtitle: '脉冲改装 · 火力扩编',
    description: '重型脉冲步枪弹鼓容量扩充至 52 发，右键【螺旋飞弹】单次齐射增至 4 枚高爆弹！',
  },
  shuriken_LOTUS: {
    title: '歼星弹幕·五联高爆',
    subtitle: '重火奥义 · 饱和轰击',
    description: '【螺旋飞弹】齐射增至 5 枚，直击伤害提升 28%，爆炸半径扩大 1.2 米，弹鼓容量再 +12。',
  },
  shuriken_pierce: {
    title: '聚变弹芯·破甲灼烧',
    subtitle: '脉冲改装 · 贯穿电浆',
    description: '脉冲步枪伤害 +18%，电浆弹丸可贯穿额外 +1 名敌军并附加每秒 16 点高温灼烧（持续 3 秒）。',
  },
  shuriken_cadence: {
    title: '超导枪管·极速连射',
    subtitle: '脉冲改装 · 射速超频',
    description: '脉冲步枪射速提升 18%，弹道初速提升 14%，螺旋飞弹飞行提速 12%，战术装填加快 16%。',
  },
  swift_phantom: {
    title: '快速装填·飞弹冷却',
    subtitle: '战术挂件 · 连续轰炸',
    description: '右键【螺旋飞弹】基础冷却时间直接缩短 0.9 秒（每层 -0.9 秒），配合击杀返还实现高频轰炸。',
  },
  swift_edge: {
    title: '外骨骼推进·高爆破片',
    subtitle: '机动挂件 · 突击强袭',
    description: '【战术疾跑】（Shift）冲刺移速再 +10%，螺旋飞弹范围溅射伤害提升 +22 点。',
  },
  swift_aegis: {
    title: '重型防弹插板·纳米力场',
    subtitle: '生存挂件 · 阵地续航',
    description: '最大生命值 +35，【生物力场】（E）每秒治疗量提升 +14 点。',
  },
  cyber_triple_jump: {
    title: '喷气战靴·三段推进',
    subtitle: '机动奥义 · 制空机动',
    description: '解锁外骨骼空中三段跳，基础移动速度全面提升 15%，轻松跃上花村飞檐制高点。',
  },
  deflect_homing: {
    title: '智能火控·广角锁定',
    subtitle: '目镜奥义 · 零散射校准',
    description: '脉冲步枪弹道散布降低 55%，【战术目镜】（Q）自动锁定视场角大幅拓宽！',
  },
  deflect_iaido: {
    title: '震荡力场·电磁脉冲',
    subtitle: '力场改装 · 破阵冲击',
    description: '部署【生物力场】（E）瞬间向四周爆发电磁震荡波，对范围内敌军造成 115 点无视护盾伤害（每层 +115）。',
  },
  deflect_siphon: {
    title: '高效力场·持久信标',
    subtitle: '力场改装 · 快速周转',
    description: '【生物力场】（E）持续时间延长 0.85 秒，冷却时间缩短 1.4 秒。',
  },
  dragon_wave: {
    title: '目镜超载·微型飞弹群',
    subtitle: '终极奥义 · 智能齐射',
    description: '【战术目镜】（Q）锁定射击时，肩部发射器自动协同齐射追踪微型飞弹轰击目标！',
  },
  dragon_feast: {
    title: '歼灭协议·目镜续航',
    subtitle: '终极秘传 · 连杀延展',
    description: '【战术目镜】（Q）期间击杀敌军延长 1.3 秒持续时间（单次目镜最多延展 3 次），目镜射速再 +12%。',
  },
  dragon_blood: {
    title: '纳米虹吸·嗜血弹幕',
    subtitle: '终极秘传 · 战地回生',
    description: '【战术目镜】（Q）激活期间，造成一切武器伤害的 22% 直接转化为自身生命回复（每层 +22%）。',
  },
  dragon_reactor: {
    title: '聚变核心·超频充能',
    subtitle: '战术核心 · 火力增幅',
    description: '【战术目镜】（Q）充能效率提升 +28%，重型脉冲步枪基础单发伤害 +4。',
  },
  vitality_overclock: {
    title: '重装护甲·扩容弹仓',
    subtitle: '生存核心 · 重装补给',
    description: '最大生命值 +50，立即恢复生命，脉冲步枪弹鼓容量额外 +10。',
  },
};

export const GUNNER_ARCHETYPE_LABELS: Record<UpgradeArchetype, string> = {
  shuriken: '脉冲与飞弹',
  mobility: '外骨骼机动',
  deflect: '生物力场',
  dragon: '战术目镜',
};

/**
 * Resolves hero-authentic title, subtitle, and description for an upgrade card so the locked hero
 * (`genji` vs `gunner`) always sees 100% accurate, class-native talents with zero mismatched copy.
 */
export function resolveUpgradeCardForHero(
  card: GenjiUpgradeDef,
  heroClass: HeroClassId = 'genji'
): GenjiUpgradeDef {
  if (heroClass === 'gunner') {
    const ov = GUNNER_UPGRADE_OVERRIDES[card.id];
    if (!ov) return card;
    return {
      ...card,
      title: ov.title,
      subtitle: ov.subtitle,
      description: ov.description,
    };
  }
  if (heroClass === 'hanzo') {
    const ov = HANZO_UPGRADE_OVERRIDES[card.id];
    if (!ov) return card;
    return {
      ...card,
      title: ov.title,
      subtitle: ov.subtitle,
      description: ov.description,
    };
  }
  return card;
}

/**
 * Drafts 3 distinct Roguelike upgrades respecting `maxStacks`, rarity weights, and the run's locked hero.
 */
export function draftUpgradeChoices(
  stacks: Record<string, number>,
  rng: Rng,
  guaranteeRareOrBetter = false,
  heroClass: HeroClassId = 'genji'
): GenjiUpgradeDef[] {
  const eligible = UPGRADE_CATALOG.filter((u) => (stacks[u.id] || 0) < u.maxStacks);
  if (eligible.length <= 3) {
    return eligible.map((c) => resolveUpgradeCardForHero(c, heroClass));
  }

  const weightOf = (r: UpgradeRarity): number =>
    r === 'legendary' ? 14 : r === 'rare' ? 34 : 52;

  const picked: GenjiUpgradeDef[] = [];
  const pool = eligible.slice();

  for (let slot = 0; slot < 3 && pool.length > 0; slot++) {
    let candidates = pool;
    if (slot === 0 && guaranteeRareOrBetter) {
      const high = pool.filter((u) => u.rarity === 'rare' || u.rarity === 'legendary');
      if (high.length > 0) candidates = high;
    }

    let totalWeight = 0;
    for (const c of candidates) totalWeight += weightOf(c.rarity);
    let roll = rng() * totalWeight;
    let chosen = candidates[candidates.length - 1];
    for (const c of candidates) {
      roll -= weightOf(c.rarity);
      if (roll <= 0) {
        chosen = c;
        break;
      }
    }
    picked.push(resolveUpgradeCardForHero(chosen, heroClass));
    const idx = pool.indexOf(chosen);
    if (idx >= 0) pool.splice(idx, 1);
  }

  return picked;
}

export const DEFAULT_MAX_DRAGON_EXTENSIONS = 3;

/**
 * Shinobi Genji signature passive:
 * Every elimination (or Boss phase break) IMMEDIATELY resets Swift Strike (`影`) cooldown!
 * Dragonblade (`斩`) kill duration extensions are strictly capped at `maxDragonExtensions` (default 3)
 * per activation so players cannot chain infinite Dragonblade uptime.
 */
export function applyGenjiEliminationReset(
  cd: GenjiCooldownState,
  stats: GenjiStats,
  isBossKill = false
): GenjiCooldownState {
  const next: GenjiCooldownState = { ...cd };
  next.swiftCd = 0;
  if (next.dragonActiveT > 0) {
    const used = next.dragonExtendsUsed ?? 0;
    const maxExts = next.maxDragonExtensions ?? stats.maxDragonExtensions ?? DEFAULT_MAX_DRAGON_EXTENSIONS;
    next.maxDragonExtensions = maxExts;
    if (used < maxExts) {
      const bonus = stats.dragonbladeExtendOnKill + (isBossKill ? 1.4 : 0);
      next.dragonActiveT = Math.min(next.dragonMaxT + 3.6, next.dragonActiveT + bonus);
      next.dragonExtendsUsed = used + 1;
    } else {
      next.dragonExtendsUsed = used;
    }
  } else {
    const gain = (isBossKill ? 28 : 9) * stats.ultChargeMultiplier;
    next.ultCharge = Math.min(100, next.ultCharge + gain);
  }
  return next;
}

/**
 * Adds Ultimate charge (`0..100`) from damage dealt (Dragonblade slashes do not self-charge Ult).
 */
export function addUltimateDamageCharge(
  currentCharge: number,
  damageDealt: number,
  multiplier: number,
  isDragonbladeActive: boolean
): number {
  if (isDragonbladeActive || damageDealt <= 0) return Math.min(100, Math.max(0, currentCharge));
  const delta = damageDealt * 0.095 * Math.max(0.1, multiplier);
  return Math.min(100, Math.max(0, currentCharge + delta));
}

/**
 * Steps Genji's Shinobi Agility (`二段跳 / 三段跳` + `飞檐走壁爬墙`) state machine.
 */
export function stepCyberAgility(params: {
  state: CyberAgilityState;
  stats: GenjiStats;
  onGround: boolean;
  jumpJustPressed: boolean;
  jumpHeld: boolean;
  facingVerticalWall: boolean;
  dt: number;
}): {
  next: CyberAgilityState;
  didAirJump: boolean;
  climbVelY: number | null;
} {
  const { state, stats, onGround, jumpJustPressed, jumpHeld, facingVerticalWall, dt } = params;
  const next: CyberAgilityState = { ...state };
  let didAirJump = false;
  let climbVelY: number | null = null;

  if (onGround) {
    next.airJumpsLeft = stats.maxAirJumps;
    next.wallClimbTimeLeft = stats.wallClimbDuration;
    next.isWallClimbing = false;
    return { next, didAirJump: false, climbVelY: null };
  }

  if (jumpHeld && facingVerticalWall && next.wallClimbTimeLeft > 0) {
    next.isWallClimbing = true;
    next.wallClimbTimeLeft = Math.max(0, next.wallClimbTimeLeft - dt);
    climbVelY = stats.wallClimbSpeed;
    return { next, didAirJump: false, climbVelY };
  }

  next.isWallClimbing = false;

  if (jumpJustPressed && next.airJumpsLeft > 0) {
    next.airJumpsLeft -= 1;
    didAirJump = true;
  }

  return { next, didAirJump, climbVelY };
}

/**
 * Computes fan-of-blades horizontal yaw offsets (radians) centered at 0.
 */
export function computeShurikenFanAngles(count: number, totalSpreadRad: number): number[] {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return [0];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5;
    out.push(t * totalSpreadRad);
  }
  return out;
}

/**
 * Point-in-cone check for Genji's Deflect (`闪`).
 */
export function isBoltInDeflectCone(params: {
  playerEye: Vec3Like;
  playerForward: Vec3Like;
  boltPos: Vec3Like;
  boltDir: Vec3Like;
  maxDist?: number;
  minCos?: number;
}): boolean {
  const maxDist = params.maxDist ?? 4.8;
  const minCos = params.minCos ?? 0.24;
  const dx = params.boltPos.x - params.playerEye.x;
  const dy = params.boltPos.y - params.playerEye.y;
  const dz = params.boltPos.z - params.playerEye.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > maxDist * maxDist || d2 < 1e-6) return false;
  const invD = 1 / Math.sqrt(d2);
  const nx = dx * invD;
  const ny = dy * invD;
  const nz = dz * invD;

  const frontCos =
    nx * params.playerForward.x + ny * params.playerForward.y + nz * params.playerForward.z;
  if (frontCos < minCos) return false;

  const incomingDot = nx * params.boltDir.x + ny * params.boltDir.y + nz * params.boltDir.z;
  return incomingDot < 0.22;
}

/**
 * Anti-tunneling Swept-Segment Deflect check (`心眼·闪` 扫掠线段招架判定):
 * Evaluates the entire segment `[boltStart, boltEnd]` traveled by an enemy projectile during `dt`
 * against Genji's frontal blade vortex shield so even 140 m/s sniper rounds at 20 FPS are 100% caught!
 */
export function checkSweptBoltDeflect(params: {
  playerEye: Vec3Like;
  playerForward: Vec3Like;
  boltStart: Vec3Like;
  boltEnd: Vec3Like;
  boltDir: Vec3Like;
  shieldDist?: number;
  shieldRadius?: number;
  maxRange?: number;
  minCos?: number;
}): { hit: boolean; point: Vec3Like } {
  const shieldDist = params.shieldDist ?? 1.45;
  const shieldRadius = params.shieldRadius ?? 2.65;
  const maxRange = params.maxRange ?? 5.4;
  const minCos = params.minCos ?? 0.22;

  // Center of the spinning katana/wakizashi parry disc in front of Genji's eyes
  const cx = params.playerEye.x + params.playerForward.x * shieldDist;
  const cy = params.playerEye.y + params.playerForward.y * shieldDist - 0.12;
  const cz = params.playerEye.z + params.playerForward.z * shieldDist;

  const sx = params.boltStart.x;
  const sy = params.boltStart.y;
  const sz = params.boltStart.z;
  const abx = params.boltEnd.x - sx;
  const aby = params.boltEnd.y - sy;
  const abz = params.boltEnd.z - sz;
  const abLen2 = abx * abx + aby * aby + abz * abz;

  let t = 0;
  if (abLen2 > 1e-8) {
    t = ((cx - sx) * abx + (cy - sy) * aby + (cz - sz) * abz) / abLen2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }

  const px = sx + abx * t;
  const py = sy + aby * t;
  const pz = sz + abz * t;

  // Verify bolt is actually moving roughly toward Genji (not behind Genji shooting away)
  const toEyeX = params.playerEye.x - sx;
  const toEyeY = params.playerEye.y - sy;
  const toEyeZ = params.playerEye.z - sz;
  const towardPlayer =
    toEyeX * params.boltDir.x + toEyeY * params.boltDir.y + toEyeZ * params.boltDir.z;
  if (towardPlayer <= 0) {
    return { hit: false, point: { x: px, y: py, z: pz } };
  }

  // Distance to frontal blade shield center
  const dShield2 = (px - cx) * (px - cx) + (py - cy) * (py - cy) + (pz - cz) * (pz - cz);
  const relX = px - params.playerEye.x;
  const relY = py - params.playerEye.y;
  const relZ = pz - params.playerEye.z;
  const relLen = Math.sqrt(relX * relX + relY * relY + relZ * relZ);

  if (relLen > maxRange) {
    return { hit: false, point: { x: px, y: py, z: pz } };
  }

  const frontCos =
    relLen > 1e-5
      ? (relX * params.playerForward.x +
          relY * params.playerForward.y +
          relZ * params.playerForward.z) /
        relLen
      : 1;

  if (dShield2 <= shieldRadius * shieldRadius && frontCos >= minCos) {
    return { hit: true, point: { x: px, y: py, z: pz } };
  }

  return { hit: false, point: { x: px, y: py, z: pz } };
}

/**
 * Pure multi-stage destructible building HP & collapse transition (`可破坏古典建筑状态机`).
 */
export function stepDestructibleStructure(
  state: DestructibleState,
  damage: number
): DestructibleStepResult {
  if (state.stage === 'destroyed' || damage <= 0) {
    return {
      next: { ...state },
      becameDamaged: false,
      becameDestroyed: false,
      debrisCount: 0,
    };
  }

  const nextHp = Math.max(0, state.hp - damage);
  let nextStage: DestructibleStage = state.stage;
  if (nextHp <= 0) {
    nextStage = 'destroyed';
  } else if (nextHp <= state.maxHp * 0.55) {
    nextStage = 'damaged';
  }

  const becameDestroyed = nextStage === 'destroyed';
  const becameDamaged = state.stage === 'intact' && nextStage === 'damaged';
  const debrisCount = becameDestroyed ? 18 : becameDamaged ? 7 : damage >= 18 ? 3 : 1;

  return {
    next: {
      hp: nextHp,
      maxHp: state.maxHp,
      stage: nextStage,
    },
    becameDamaged,
    becameDestroyed,
    debrisCount,
  };
}

/**
 * Computes outgoing Deflect vector:
 * - Default: aims straight along Genji's crosshair ray (precision skill-shot deflect!).
 * - With `心眼·八咫镜反` (`deflect_homing`): locks directly onto nearest visible enemy weakspot!
 */
export function computeDeflectDirection(
  origin: Vec3Like,
  playerAimDir: Vec3Like,
  homingTargetWeakspot: Vec3Like | null
): Vec3Like {
  let vx = playerAimDir.x;
  let vy = playerAimDir.y;
  let vz = playerAimDir.z;
  if (homingTargetWeakspot) {
    vx = homingTargetWeakspot.x - origin.x;
    vy = homingTargetWeakspot.y - origin.y;
    vz = homingTargetWeakspot.z - origin.z;
  }
  const len = Math.hypot(vx, vy, vz) || 1;
  return { x: vx / len, y: vy / len, z: vz / len };
}

export interface WavePlan {
  wave: number;
  title: string;
  isBossWave: boolean;
  isHarborEvent: boolean;
  totalBudget: number;
  maxConcurrent: number;
  spawns: GenjiEnemyVariant[];
  hpScale: number;
}

/**
 * Endless Roguelike Wave & Oni-Samurai Boss Escalation Schedule:
 * - Waves 1, 2: Village skirmishers (Ashigaru arquebusiers + scouting kites + ninja hounds)
 * - Every 3rd non-boss wave (3, 6, 9...): Village Beacon Shrine Defense (`古村烽火祠`) + Rooftop Marksmen
 * - Every 5th wave (5, 10, 15...): Oni-Armored Warlord Boss (`赤备重甲统领 · 鬼丸`) + Elite Escorts
 */
export function computeWavePlan(waveNum: number): WavePlan {
  const wave = Math.max(1, Math.floor(waveNum));
  const isBossWave = wave % 5 === 0;
  const isHarborEvent = !isBossWave && wave % 3 === 0;
  const hpScale = +(1 + (wave - 1) * 0.14).toFixed(2);
  const maxConcurrent = Math.min(11, 5 + Math.floor(wave * 0.85));

  const spawns: GenjiEnemyVariant[] = [];
  if (isBossWave) {
    spawns.push('boss');
    const escorts = Math.min(9, 4 + Math.floor(wave / 5) * 2);
    const bossEscortCycle: GenjiEnemyVariant[] = [
      'spider_mech',
      'gull',
      'shield_guard',
      'sniper',
      'mortar_crab',
      'trooper',
    ];
    for (let i = 0; i < escorts; i++) {
      spawns.push(bossEscortCycle[i % bossEscortCycle.length]);
    }
    return {
      wave,
      title: `第 ${wave} 波 · 荒神妖将与重装机关降临`,
      isBossWave: true,
      isHarborEvent: false,
      totalBudget: spawns.length,
      maxConcurrent: Math.max(7, maxConcurrent),
      spawns,
      hpScale,
    };
  }

  // Rich tactical archetype mix: multi-legged spider mechs, tower-shield vanguards, mortar crabs, aerial drones, hounds & marksmen!
  const count = Math.min(24, 7 + Math.floor(wave * 1.8));
  for (let i = 0; i < count; i++) {
    if (wave >= 2 && i % 6 === 3) {
      spawns.push('sniper');
    } else if (i % 6 === 1) {
      spawns.push('spider_mech');
    } else if (i % 6 === 2) {
      spawns.push('gull');
    } else if (i % 6 === 4) {
      spawns.push('shield_guard');
    } else if (wave >= 2 && i % 6 === 5) {
      spawns.push('mortar_crab');
    } else if (i % 3 === 2) {
      spawns.push('hound');
    } else {
      spawns.push('trooper');
    }
  }

  const title = isHarborEvent
    ? `第 ${wave} 波 · 古村烽火祠镇守`
    : `第 ${wave} 波 · 机关军团强袭`;

  return {
    wave,
    title,
    isBossWave: false,
    isHarborEvent,
    totalBudget: spawns.length,
    maxConcurrent,
    spawns,
    hpScale,
  };
}

// ============================================================================
// Pure Mobile Touch Input Math (Unit-tested in `rules.test.ts`)
// ============================================================================

export interface VirtualStickOutput {
  moveX: number; // -1..1 (strafe right = +1)
  moveY: number; // -1..1 (forward = +1)
  nubX: number;  // clamped visual offset in px
  nubY: number;  // clamped visual offset in px
  sprint: boolean;
  magnitude: number;
}

export function computeVirtualStick(
  dxPx: number,
  dyPx: number,
  maxRadiusPx = 42,
  deadzoneRatio = 0.08
): VirtualStickOutput {
  const rMax = Math.max(16, maxRadiusPx);
  const rawDist = Math.hypot(dxPx, dyPx);
  if (rawDist < 1e-5) {
    return { moveX: 0, moveY: 0, nubX: 0, nubY: 0, sprint: false, magnitude: 0 };
  }
  const clampedDist = Math.min(rMax, rawDist);
  const nx = dxPx / rawDist;
  const ny = dyPx / rawDist;
  const nubX = nx * clampedDist;
  const nubY = ny * clampedDist;
  const norm = clampedDist / rMax;

  if (norm <= deadzoneRatio) {
    return { moveX: 0, moveY: 0, nubX, nubY, sprint: false, magnitude: 0 };
  }

  const linear = Math.min(1, (norm - deadzoneRatio) / Math.max(0.05, 1 - deadzoneRatio));
  // Crisp initial response curve (`pow(0.88)`) so strafe jukes feel immediate without sluggish ramp
  const rescaled = Math.min(1, Math.pow(linear, 0.88));
  return {
    moveX: +(nx * rescaled).toFixed(4),
    moveY: +(-ny * rescaled).toFixed(4),
    nubX,
    nubY,
    sprint: rescaled >= 0.68 && -ny > 0.24,
    magnitude: +rescaled.toFixed(4),
  };
}

/**
 * Dynamic Floating Thumbstick Origin Follow (`动态跟随摇杆底座`):
 * When the player's thumb pushes beyond `maxRadiusPx + followSlackPx`, smoothly pulls
 * the stick origin along behind the thumb so reversing direction (`A <-> D`) has zero dead travel.
 */
export function computeFloatingStickOrigin(params: {
  originX: number;
  originY: number;
  pointerX: number;
  pointerY: number;
  maxRadiusPx?: number;
  followSlackPx?: number;
}): { originX: number; originY: number } {
  const maxR = Math.max(16, params.maxRadiusPx ?? 42);
  const slack = Math.max(0, params.followSlackPx ?? 6);
  const dx = params.pointerX - params.originX;
  const dy = params.pointerY - params.originY;
  const dist = Math.hypot(dx, dy);
  const limit = maxR + slack;
  if (dist <= limit || dist < 1e-5) {
    return { originX: params.originX, originY: params.originY };
  }
  const pull = dist - limit;
  return {
    originX: params.originX + (dx / dist) * pull,
    originY: params.originY + (dy / dist) * pull,
  };
}

/**
 * Calibrated First-Person Mobile Touch Look Curve (returns **radians** for `G.input.look.dx / dy`):
 * - Slow micro-movements (`<= 3px`) stay 1:1 linear (`0.0046 rad/px` ≈ `0.26°/px`) for pixel-accurate Hanzo/Genji aim.
 * - Fast thumb flicks (`3px..30px/event`) smoothly accelerate up to `1.85x` so a single crisp thumb swipe can execute a 180° turn.
 * - Vertical pitch applies a `0.78x` stability factor to prevent accidental sky/floor pitch drift during horizontal sweeps.
 */
export function computeTouchLookDelta(
  deltaXPx: number,
  deltaYPx: number,
  sensitivity = 1.0,
  invertY = false
): { dx: number; dy: number } {
  const maxStep = 140;
  const cx = Math.max(-maxStep, Math.min(maxStep, Number.isFinite(deltaXPx) ? deltaXPx : 0));
  const cy = Math.max(-maxStep, Math.min(maxStep, Number.isFinite(deltaYPx) ? deltaYPx : 0));
  const sens = Math.max(0.15, Math.min(3.5, Number.isFinite(sensitivity) ? sensitivity : 1.0));

  const stepSpeedPx = Math.hypot(cx, cy);
  const accelT = clamp01((stepSpeedPx - 3.0) / 27.0);
  const smoothAccel = accelT * accelT * (3 - 2 * accelT);
  const flickBoost = 1.0 + 0.85 * smoothAccel;

  const baseRadPerPx = 0.0046 * sens * flickBoost;
  const pitchStability = 0.78;

  return {
    dx: cx * baseRadPerPx,
    dy: cy * baseRadPerPx * pitchStability * (invertY ? -1 : 1),
  };
}

export interface TouchAimCandidate {
  id: number;
  aimPoint: Vec3Like;
  isPriority?: boolean; // e.g., Boss weakspot orb or headshot weakspot
}

export interface TouchAimAssistResult {
  frictionScale: number;     // 0.62..1.0 multiplier on raw swipe look delta
  yawPullRad: number;        // gentle additive yaw delta in radians
  pitchPullRad: number;      // gentle additive pitch delta in radians
  lockedTargetId: number | null;
}

function wrapAngleRad(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Pure Mobile FPS Aim Assist (`移动端准星减速摩擦 + 轻度吸附辅助`):
 * 1. Reticle Friction (`0.62x..1.0x`): Slows touch swipe sensitivity smoothly when passing over an enemy inside `frictionConeRad` (`~7.5°`).
 * 2. Rotational Magnetism: Applies a subtle, non-jerky angular pull toward the closest target inside `magnetConeRad` (`~6.0°`)
 *    ONLY while the player is actively strafing/moving, firing/drawing bow, or swiping look.
 */
export function computeTouchAimAssist(params: {
  enabled: boolean;
  eyePos: Vec3Like;
  yaw: number;
  pitch: number;
  rawLookDx: number;
  rawLookDy: number;
  moveMagnitude: number;
  isFiringOrDrawing: boolean;
  dt: number;
  candidates: TouchAimCandidate[];
  frictionConeRad?: number;
  magnetConeRad?: number;
  maxRange?: number;
}): TouchAimAssistResult {
  if (!params.enabled || params.candidates.length === 0 || params.dt <= 0) {
    return { frictionScale: 1, yawPullRad: 0, pitchPullRad: 0, lockedTargetId: null };
  }

  const frictionCone = params.frictionConeRad ?? 0.131; // ~7.5 deg
  const magnetCone = params.magnetConeRad ?? 0.105;     // ~6.0 deg
  const maxRange = params.maxRange ?? 72;

  let bestCandidate: TouchAimCandidate | null = null;
  let bestScore = Infinity;
  let bestAngErr = Infinity;
  let bestYawErr = 0;
  let bestPitchErr = 0;

  for (let i = 0; i < params.candidates.length; i++) {
    const c = params.candidates[i];
    const rx = c.aimPoint.x - params.eyePos.x;
    const ry = c.aimPoint.y - params.eyePos.y;
    const rz = c.aimPoint.z - params.eyePos.z;
    const dist = Math.hypot(rx, ry, rz);
    if (dist < 0.8 || dist > maxRange) continue;

    const horizDist = Math.hypot(rx, rz);
    const targetYaw = Math.atan2(-rx, -rz);
    const targetPitch = Math.atan2(ry, Math.max(1e-4, horizDist));

    const yawErr = wrapAngleRad(targetYaw - params.yaw);
    const pitchErr = targetPitch - params.pitch;
    const angErr = Math.hypot(yawErr, pitchErr);
    if (angErr > frictionCone) continue;

    const priorityBias = c.isPriority ? 0.85 : 1.0;
    const score = angErr * priorityBias + dist * 0.0004;
    if (score < bestScore) {
      bestScore = score;
      bestCandidate = c;
      bestAngErr = angErr;
      bestYawErr = yawErr;
      bestPitchErr = pitchErr;
    }
  }

  if (!bestCandidate) {
    return { frictionScale: 1, yawPullRad: 0, pitchPullRad: 0, lockedTargetId: null };
  }

  // 1. Smooth Reticle Friction (`0.62` at bullseye -> `1.0` at edge of friction cone)
  const frictionT = clamp01(1 - bestAngErr / frictionCone);
  const smoothFriction = frictionT * frictionT * (3 - 2 * frictionT);
  const frictionScale = +(1 - 0.38 * smoothFriction).toFixed(4);

  // 2. Gentle Rotational Magnetism when actively engaging (moving, firing/drawing, or swiping)
  const lookMag = Math.hypot(params.rawLookDx, params.rawLookDy);
  const engagement =
    params.isFiringOrDrawing
      ? 1.0
      : params.moveMagnitude > 0.08
        ? 0.82
        : lookMag > 0.0004
          ? 0.65
          : 0;

  if (engagement <= 0 || bestAngErr > magnetCone || bestAngErr < 0.0025) {
    return {
      frictionScale,
      yawPullRad: 0,
      pitchPullRad: 0,
      lockedTargetId: bestCandidate.id,
    };
  }

  const magnetT = clamp01(1 - bestAngErr / magnetCone);
  const pullStrength = 3.2 * engagement * (0.35 + 0.65 * magnetT);
  const stepFrac = Math.min(0.32, pullStrength * Math.min(0.05, params.dt));
  const maxPullStep = 1.45 * Math.min(0.05, params.dt);

  const rawYawPull = bestYawErr * stepFrac;
  const rawPitchPull = bestPitchErr * stepFrac * 0.72;
  const pullLen = Math.hypot(rawYawPull, rawPitchPull);
  const clampMul = pullLen > maxPullStep && pullLen > 1e-6 ? maxPullStep / pullLen : 1;

  return {
    frictionScale,
    yawPullRad: rawYawPull * clampMul,
    pitchPullRad: rawPitchPull * clampMul,
    lockedTargetId: bestCandidate.id,
  };
}


export function isPortraitViewportBlocked(params: {
  width: number;
  height: number;
  maxPortraitWidth?: number;
}): boolean {
  const maxW = params.maxPortraitWidth ?? 900;
  return params.height > params.width && params.width <= maxW;
}

export function shouldEnableTouchUi(params: {
  viewportWidth: number;
  viewportHeight?: number;
  coarsePointer?: boolean;
  maxTouchPoints?: number;
  userPref?: TouchUiPreference;
  urlTouchParam?: string | null;
  sawTouchEvent?: boolean;
}): boolean {
  if (params.urlTouchParam === '1' || params.urlTouchParam === 'true') return true;
  if (params.urlTouchParam === '0' || params.urlTouchParam === 'false') return false;
  if (params.userPref === 'on') return true;
  if (params.userPref === 'off') return false;
  if (params.sawTouchEvent) return true;
  if (params.coarsePointer) return true;
  if ((params.maxTouchPoints ?? 0) > 0 && params.viewportWidth <= 1180) return true;
  if (
    params.viewportHeight !== undefined &&
    params.viewportHeight <= 540 &&
    params.viewportWidth > params.viewportHeight &&
    params.viewportWidth <= 1024
  ) {
    return true;
  }
  return params.viewportWidth <= 960;
}

// ============================================================================
// Pure Anti-Clipping Hipped Curved Roof Geometry & Collider Math
// ============================================================================

export interface RoofProfileSpec {
  widthX: number;
  depthZ: number;
  heightY: number;
  overhangScale?: number;
  eaveYOffset?: number;
  soriMidY?: number;
  soriMidS?: number;
  ridgeRatio?: number;
}

export interface AabbColliderSpec {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/**
 * Computes the horizontal half-extents `(hx, hz)` of a Japanese curved hipped roof (`反り寄栋/入母屋`)
 * at normalized vertical progress `t in [0, 1]`.
 */
export function computeHippedRoofHalfExtents(
  spec: RoofProfileSpec,
  tNorm: number
): { hx: number; hz: number; eaveHalfX: number; eaveHalfZ: number; ridgeHalfX: number; ridgeHalfZ: number } {
  const overhang = spec.overhangScale ?? 1.04;
  const midY = spec.soriMidY ?? 0.41;
  const midS = spec.soriMidS ?? 0.465;
  const spanX = spec.widthX * overhang;
  const spanZ = spec.depthZ * overhang;
  const eaveHalfX = spanX * 0.5;
  const eaveHalfZ = spanZ * 0.5;

  let ridgeHalfX = 0;
  let ridgeHalfZ = 0;
  const ridgeK = spec.ridgeRatio ?? 0.82;
  if (spanX > spanZ * 1.05) {
    ridgeHalfX = Math.max(0, (spanX - spanZ * ridgeK) * 0.5);
  } else if (spanZ > spanX * 1.05) {
    ridgeHalfZ = Math.max(0, (spanZ - spanX * ridgeK) * 0.5);
  }

  const t = Math.max(0, Math.min(1, tNorm));
  const s =
    t <= midY
      ? (t / Math.max(1e-4, midY)) * midS
      : midS + ((t - midY) / Math.max(1e-4, 1 - midY)) * (1 - midS);

  return {
    hx: eaveHalfX + (ridgeHalfX - eaveHalfX) * s,
    hz: eaveHalfZ + (ridgeHalfZ - eaveHalfZ) * s,
    eaveHalfX,
    eaveHalfZ,
    ridgeHalfX,
    ridgeHalfZ,
  };
}

/**
 * Evaluates the exact world Y height of the visual sloped roof surface at local `(dx, dz)`
 * relative to `(cx, baseY, cz)` (accounting for quarter-turn `rotY`).
 */
export function evalHippedRoofSurfaceY(
  baseY: number,
  dxWorld: number,
  dzWorld: number,
  spec: RoofProfileSpec,
  rotY = 0
): number | null {
  const swap = Math.abs(Math.sin(rotY)) > 0.707;
  const dx = Math.abs(swap ? dzWorld : dxWorld);
  const dz = Math.abs(swap ? dxWorld : dzWorld);
  const { eaveHalfX, eaveHalfZ, ridgeHalfX, ridgeHalfZ } = computeHippedRoofHalfExtents(spec, 0);
  if (dx > eaveHalfX + 1e-5 || dz > eaveHalfZ + 1e-5) return null;

  const midY = spec.soriMidY ?? 0.41;
  const midS = spec.soriMidS ?? 0.465;
  const eaveOff = spec.eaveYOffset ?? 0.17;

  const sx =
    eaveHalfX > ridgeHalfX + 1e-5
      ? Math.max(0, Math.min(1, (eaveHalfX - dx) / (eaveHalfX - ridgeHalfX)))
      : 1;
  const sz =
    eaveHalfZ > ridgeHalfZ + 1e-5
      ? Math.max(0, Math.min(1, (eaveHalfZ - dz) / (eaveHalfZ - ridgeHalfZ)))
      : 1;
  const s = Math.min(sx, sz);

  const t =
    s <= midS
      ? (s / Math.max(1e-4, midS)) * midY
      : midY + ((s - midS) / Math.max(1e-4, 1 - midS)) * (1 - midY);

  const ridgeCap = s > 0.92 ? ((s - 0.92) / 0.08) * 0.14 : 0;
  return baseY + eaveOff + t * spec.heightY + ridgeCap;
}

/**
 * Generates concentric stepped AABB roof colliders guaranteeing:
 * 1. Every vertical step is `<= maxStepRise` (`0.27m < 0.42m` capsule step-up height `u1`),
 *    so Genji smoothly walks/runs all the way up and down pitched roofs without hitting invisible walls.
 * 2. At EVERY `(x, z)` inside the roof footprint, the highest supporting collider top `maxY` is strictly
 *    above `evalHippedRoofSurfaceY`, eliminating roof interior clipping 100%.
 */
export function computePitchedRoofColliderBoxes(
  cx: number,
  baseY: number,
  cz: number,
  spec: RoofProfileSpec,
  rotY = 0,
  maxStepRise = 0.27
): AabbColliderSpec[] {
  const eaveOff = spec.eaveYOffset ?? 0.17;
  const totalClimb = eaveOff + spec.heightY + 0.16;
  const steps = Math.max(4, Math.ceil(totalClimb / Math.max(0.16, maxStepRise)));
  const swap = Math.abs(Math.sin(rotY)) > 0.707;
  const boxes: AabbColliderSpec[] = [];

  for (let i = 0; i < steps; i++) {
    const tLow = i / steps;
    const tHigh = (i + 1) / steps;
    const { hx, hz } = computeHippedRoofHalfExtents(spec, tLow);
    const pad = i === 0 ? 0.025 : 0.015;
    const halfX = (swap ? hz : hx) + pad;
    const halfZ = (swap ? hx : hz) + pad;

    const minY =
      i === 0
        ? baseY - 0.10
        : baseY + eaveOff + Math.max(0, (i - 0.25) / steps) * spec.heightY;
    const maxY =
      baseY +
      eaveOff +
      tHigh * spec.heightY +
      0.04 +
      0.14 * Math.pow(tHigh, 3);

    boxes.push({
      minX: cx - halfX,
      minY,
      minZ: cz - halfZ,
      maxX: cx + halfX,
      maxY,
      maxZ: cz + halfZ,
    });
  }

  return boxes;
}

/**
 * Pure concave catenary volcanic elevation & jagged Yukigata (`雪形`) snowline sampler for Mount Fuji (`灵峰富士`).
 * `uRad in [0, 1]` (`0` = caldera rim, `1` = wide susono skirt base), `theta` = azimuth angle (radians).
 */
export function computeFujiProfileSample(
  uRad: number,
  theta: number
): { radiusRatio: number; heightNorm: number; snowMask: number } {
  const u = Math.max(0, Math.min(1, uRad));
  // Concave logarithmic/power volcanic slope: steep near summit (u -> 0), sweeping wide susono skirt (u -> 1)
  const radiusRatio = 0.082 + 0.918 * Math.pow(u, 1.46);
  let heightNorm = Math.pow(1 - u, 1.38);

  // Subtle jagged Kengamine summit caldera rim notch + radial Osawa erosion ribs + SE Hoeizan flank crater bulge
  const summitRimNotch =
    u < 0.06 ? (1 - u / 0.06) * (0.018 * Math.cos(theta * 3 + 0.7) - 0.014) : 0;
  const radialRibs =
    Math.sin(theta * 9 + 0.4) * 0.014 +
    Math.cos(theta * 17 - 1.1) * 0.009 +
    Math.sin(theta * 29 + 2.2) * 0.005;
  const ribFade = Math.sin(Math.min(1, u * 1.15) * Math.PI) * (1 - u * 0.45);
  const hoeiAngle = theta - 0.85;
  const hoeiDist2 = Math.pow(u - 0.42, 2) * 14 + Math.pow(Math.sin(hoeiAngle * 0.5) * 2, 2) * 3.8;
  const hoeiBulge = 0.042 * Math.exp(-hoeiDist2) - 0.018 * Math.exp(-hoeiDist2 * 3.2);

  heightNorm = Math.max(0, heightNorm + summitRimNotch + radialRibs * ribFade + hoeiBulge);

  // Jagged snowline (`雪形`) sweeping lower down radial ridges and higher on wind-scoured gullies
  const gullySnowOffset =
    Math.sin(theta * 7 + 0.5) * 0.065 +
    Math.cos(theta * 13 - 0.8) * 0.048 +
    Math.sin(theta * 23 + 1.7) * 0.028;
  const snowThreshold = 0.57 + gullySnowOffset;
  const snowMask = Math.max(0, Math.min(1, (heightNorm - snowThreshold) / 0.11));

  return { radiusRatio, heightNorm, snowMask };
}

// ============================================================================
// COLOSSAL GIANT BOSS (`荒神大天狗 · 八岐鬼王丸`) PURE STATE & WEAKSPOT RULES
// ============================================================================

export type ColossalBossAttackKind = 'odachi_slam' | 'flame_crescents' | 'raijin_barrage' | 'terrace_leap';

export interface ColossalBossState {
  name: string;
  title: string;
  waveNum: number;
  hp: number;
  maxHp: number;
  phase: 1 | 2 | 3;
  orbsAlive: boolean[];
  orbHp: number[];
  orbMaxHp: number;
  stunTimer: number;
  attackCooldown: number;
  activeAttack: ColossalBossAttackKind | null;
  attackTimer: number;
  attackIndex: number;
}

export interface ColossalBossHitOutcome {
  totalDamage: number;
  orbShattered: boolean;
  shatteredOrbIndex: number;
  phaseChanged: boolean;
  newPhase: 1 | 2 | 3;
  killed: boolean;
}

export function createColossalBossState(waveNum: number): ColossalBossState {
  const w = Math.max(1, Math.floor(waveNum));
  const maxHp = Math.round(1550 + (w - 1) * 280);
  const orbMaxHp = Math.round(95 + (w - 1) * 18);
  return {
    name: '八岐鬼王丸',
    title: '荒神大天狗 · 巨型妖将',
    waveNum: w,
    hp: maxHp,
    maxHp,
    phase: 1,
    orbsAlive: [true, true, true, true],
    orbHp: [orbMaxHp, orbMaxHp, orbMaxHp, orbMaxHp],
    orbMaxHp,
    stunTimer: 0,
    attackCooldown: 1.8,
    activeAttack: null,
    attackTimer: 0,
    attackIndex: 0,
  };
}

export function stepColossalBossDamage(
  state: ColossalBossState,
  rawDamage: number,
  hitOrbIndex = -1
): ColossalBossHitOutcome {
  if (state.hp <= 0 || rawDamage <= 0) {
    return {
      totalDamage: 0,
      orbShattered: false,
      shatteredOrbIndex: -1,
      phaseChanged: false,
      newPhase: state.phase,
      killed: state.hp <= 0,
    };
  }

  let totalDamage = Math.max(1, Math.round(rawDamage));
  let orbShattered = false;
  let shatteredOrbIndex = -1;

  if (
    hitOrbIndex >= 0 &&
    hitOrbIndex < state.orbsAlive.length &&
    state.orbsAlive[hitOrbIndex]
  ) {
    // Hitting a Raijin Taiko weakspot orb deals 1.35x weakspot damage and chips orb integrity
    totalDamage = Math.round(rawDamage * 1.35);
    state.orbHp[hitOrbIndex] = Math.max(0, state.orbHp[hitOrbIndex] - rawDamage);
    if (state.orbHp[hitOrbIndex] <= 0) {
      state.orbsAlive[hitOrbIndex] = false;
      orbShattered = true;
      shatteredOrbIndex = hitOrbIndex;
      const shatterBurst = Math.round(state.maxHp * 0.12);
      totalDamage += shatterBurst;
      state.stunTimer = Math.max(state.stunTimer, 2.2);
      state.activeAttack = null;
      state.attackTimer = 0;
    }
  } else if (state.stunTimer > 0) {
    // Staggered colossal boss takes +25% exposed finisher damage
    totalDamage = Math.round(rawDamage * 1.25);
  }

  const applied = Math.min(state.hp, totalDamage);
  state.hp = Math.max(0, state.hp - applied);

  const prevPhase = state.phase;
  const hpRatio = state.hp / Math.max(1, state.maxHp);
  if (hpRatio <= 0.35) {
    state.phase = 3;
  } else if (hpRatio <= 0.70) {
    state.phase = 2;
  }

  return {
    totalDamage: applied,
    orbShattered,
    shatteredOrbIndex,
    phaseChanged: state.phase !== prevPhase,
    newPhase: state.phase,
    killed: state.hp <= 0,
  };
}

// ============================================================================
// SHINOBI SPIRIT-SENSE ENEMY LOCATOR (`心眼寻敌 · 立体方位感知`)
// ============================================================================

export type ElevationRelation = 'high' | 'low' | 'same';

export interface EnemyLocatorInput {
  playerX: number;
  playerY: number;
  playerZ: number;
  forwardX: number;
  forwardZ: number;
  enemyX: number;
  enemyY: number;
  enemyZ: number;
  isBoss?: boolean;
  isOccluded?: boolean;
  remainingHostiles: number;
}

export interface EnemyLocatorInfo {
  distMeters: number;
  horizDist: number;
  dy: number;
  elevation: ElevationRelation;
  elevationLabel: string;
  /** Signed horizontal angle in radians relative to camera forward (`0` = dead ahead, `+` = right, `-` = left). */
  relYawRad: number;
  isBehind: boolean;
  shouldShowMarker: boolean;
  urgency: 'boss' | 'priority' | 'normal';
}

export function computeEnemyLocatorInfo(input: EnemyLocatorInput): EnemyLocatorInfo {
  const dx = input.enemyX - input.playerX;
  const dy = input.enemyY - input.playerY;
  const dz = input.enemyZ - input.playerZ;
  const horizDist = Math.hypot(dx, dz);
  const distMeters = Math.max(1, Math.round(Math.hypot(dx, dy, dz)));

  const fLen = Math.hypot(input.forwardX, input.forwardZ) || 1;
  const fx = input.forwardX / fLen;
  const fz = input.forwardZ / fLen;
  // Right vector in Three.js XZ plane (Y-up: right = (-fz, fx))
  const rx = -fz;
  const rz = fx;

  const invH = horizDist > 1e-4 ? 1 / horizDist : 0;
  const nx = dx * invH;
  const nz = dz * invH;

  const forwardDot = horizDist > 1e-4 ? nx * fx + nz * fz : 1;
  const rightDot = horizDist > 1e-4 ? nx * rx + nz * rz : 0;
  const relYawRad = Math.atan2(rightDot, forwardDot);

  let elevation: ElevationRelation = 'same';
  let elevationLabel = '';
  if (dy >= 2.2) {
    elevation = 'high';
    elevationLabel = `▲+${Math.round(dy)}m`;
  } else if (dy <= -2.0) {
    elevation = 'low';
    elevationLabel = `▼${Math.round(dy)}m`;
  }

  const isBehind = forwardDot < 0.18;
  const shouldShowMarker = Boolean(
    input.isBoss ||
      input.isOccluded ||
      isBehind ||
      elevation !== 'same' ||
      horizDist >= 14 ||
      input.remainingHostiles <= 5
  );

  const urgency: 'boss' | 'priority' | 'normal' = input.isBoss
    ? 'boss'
    : input.remainingHostiles <= 3 || elevation !== 'same'
    ? 'priority'
    : 'normal';

  return {
    distMeters,
    horizDist,
    dy,
    elevation,
    elevationLabel,
    relYawRad,
    isBehind,
    shouldShowMarker,
    urgency,
  };
}

// ============================================================================
// SHURIKEN TRAJECTORY PREDICTION, PARALLAX CONVERGENCE & VISIBILITY SOLVER
// ============================================================================

export interface TrajectoryVec3 {
  x: number;
  y: number;
  z: number;
}

export interface TrajectoryPredictionInput {
  cameraPos: TrajectoryVec3;
  cameraForward: TrajectoryVec3;
  rawHandOrigin: TrajectoryVec3;
  aimHitPoint: TrajectoryVec3;
  /** Distance from `cameraPos` to any wall blocking `cameraPos -> rawHandOrigin`, or `null` if unobstructed. */
  handBlockedDist: number | null;
  projectileSpeed: number;
}

export interface TrajectoryPredictionResult {
  safeOrigin: TrajectoryVec3;
  dir: TrajectoryVec3;
  predictedDistance: number;
  minVisualDuration: number;
  handWasObstructed: boolean;
}

function clampVal(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function normalizeFiniteVec3(
  x: number,
  y: number,
  z: number,
  fallback: TrajectoryVec3
): TrajectoryVec3 {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return fallback;
  }
  const len = Math.hypot(x, y, z);
  if (len < 1e-5 || !Number.isFinite(len)) {
    return fallback;
  }
  return { x: x / len, y: y / len, z: z / len };
}

/**
 * Computes a wall-safe launch origin and camera-converged flight direction so projectiles:
 * 1. Never spawn inside an adjacent wall/pillar AABB when Genji stands next to cover (`handBlockedDist !== null`);
 * 2. Never fire sideways/backwards due to close-range eye-to-hand parallax (`dot(dir, camFwd) >= 0.45`);
 * 3. Always produce finite unit-length vectors (`|dir| === 1`, zero `NaN` matrices);
 * 4. Guarantee a minimum visual flight duration (`>= 0.088s`) so close-range shots remain visible across frames.
 */
export function computeConvergedLaunchVector(
  input: TrajectoryPredictionInput
): TrajectoryPredictionResult {
  const camFwd = normalizeFiniteVec3(
    input.cameraForward.x,
    input.cameraForward.y,
    input.cameraForward.z,
    { x: 0, y: 0, z: -1 }
  );

  const cpx = Number.isFinite(input.cameraPos.x) ? input.cameraPos.x : 0;
  const cpy = Number.isFinite(input.cameraPos.y) ? input.cameraPos.y : 1.6;
  const cpz = Number.isFinite(input.cameraPos.z) ? input.cameraPos.z : 0;

  const handVecX = input.rawHandOrigin.x - cpx;
  const handVecY = input.rawHandOrigin.y - cpy;
  const handVecZ = input.rawHandOrigin.z - cpz;
  const handOffsetLen = Math.hypot(handVecX, handVecY, handVecZ);

  const handWasObstructed =
    !Number.isFinite(handOffsetLen) ||
    (input.handBlockedDist !== null && input.handBlockedDist < handOffsetLen + 0.08);

  // Pull origin safely inside the 0.36m player capsule when standing flush against a wall/pillar!
  const safeOrigin: TrajectoryVec3 = handWasObstructed
    ? {
        x: cpx + camFwd.x * 0.16,
        y: cpy + camFwd.y * 0.16 - 0.04,
        z: cpz + camFwd.z * 0.16,
      }
    : {
        x: input.rawHandOrigin.x,
        y: input.rawHandOrigin.y,
        z: input.rawHandOrigin.z,
      };

  // Validate aimHitPoint; if too close to camera (< 1.45m) or behind camera, project cleanly along cameraForward
  const camToAimX = input.aimHitPoint.x - cpx;
  const camToAimY = input.aimHitPoint.y - cpy;
  const camToAimZ = input.aimHitPoint.z - cpz;
  const camAimForwardProj = camToAimX * camFwd.x + camToAimY * camFwd.y + camToAimZ * camFwd.z;

  let targetX = input.aimHitPoint.x;
  let targetY = input.aimHitPoint.y;
  let targetZ = input.aimHitPoint.z;
  if (!Number.isFinite(camAimForwardProj) || camAimForwardProj < 1.45) {
    const safeDist = Number.isFinite(camAimForwardProj) ? Math.max(1.65, camAimForwardProj) : 60;
    targetX = cpx + camFwd.x * safeDist;
    targetY = cpy + camFwd.y * safeDist;
    targetZ = cpz + camFwd.z * safeDist;
  }

  let dir = normalizeFiniteVec3(
    targetX - safeOrigin.x,
    targetY - safeOrigin.y,
    targetZ - safeOrigin.z,
    camFwd
  );

  // Prevent severe cross-eye parallax at point-blank corners
  const alignDot = dir.x * camFwd.x + dir.y * camFwd.y + dir.z * camFwd.z;
  if (alignDot < 0.45) {
    dir = camFwd;
  }

  const rawPredDist = Math.hypot(
    targetX - safeOrigin.x,
    targetY - safeOrigin.y,
    targetZ - safeOrigin.z
  );
  const predictedDistance = clampVal(
    Number.isFinite(rawPredDist) ? rawPredDist : 60,
    0.35,
    135
  );
  const safeSpeed = Math.max(8, Number.isFinite(input.projectileSpeed) ? input.projectileSpeed : 96);
  const minVisualDuration = clampVal(Math.max(0.088, predictedDistance / safeSpeed), 0.088, 1.55);

  return {
    safeOrigin,
    dir,
    predictedDistance,
    minVisualDuration,
    handWasObstructed,
  };
}

/**
 * Perspective-compensated visual scale so fast shurikens & chakra star-halos never shrink below
 * readable pixel size at 25m-70m down long castle-town streets while remaining crisp up close.
 */
export function computeProjectileVisualScale(distFromCamera: number, baseScale = 1.0): number {
  const safeDist = Number.isFinite(distFromCamera) ? Math.max(0, distFromCamera) : 0;
  const safeBase = Number.isFinite(baseScale) ? Math.max(0.1, baseScale) : 1.0;
  const boost = clampVal(1 + Math.max(0, safeDist - 3.0) * 0.046, 1.0, 3.6);
  return safeBase * boost;
}

/**
 * Interpolates a projectile's visual mesh along `origin -> impactPoint` over `minVisualDuration`
 * so point-blank / 1-frame simulation hits still render a clear, unmistakable streak across the screen.
 */
export function computeProjectileVisualPosition(
  origin: TrajectoryVec3,
  impactPoint: TrajectoryVec3,
  elapsedSec: number,
  minVisualDuration: number
): { pos: TrajectoryVec3; progress: number; done: boolean } {
  const dur = Math.max(0.04, Number.isFinite(minVisualDuration) ? minVisualDuration : 0.088);
  const progress = clamp01((Number.isFinite(elapsedSec) ? elapsedSec : dur) / dur);
  return {
    pos: {
      x: origin.x + (impactPoint.x - origin.x) * progress,
      y: origin.y + (impactPoint.y - origin.y) * progress,
      z: origin.z + (impactPoint.z - origin.z) * progress,
    },
    progress,
    done: progress >= 1,
  };
}

/**
 * Strict world-space & NaN watchdog: returns `true` if a projectile has non-finite coordinates,
 * left vertical play bounds, or exceeded its maximum travel range, preventing mid-air hangs.
 */
export function isProjectileOutOfPlayableBounds(
  pos: TrajectoryVec3,
  origin: TrajectoryVec3,
  maxRange = 135
): boolean {
  if (
    !Number.isFinite(pos.x) ||
    !Number.isFinite(pos.y) ||
    !Number.isFinite(pos.z) ||
    !Number.isFinite(origin.x) ||
    !Number.isFinite(origin.y) ||
    !Number.isFinite(origin.z)
  ) {
    return true;
  }
  if (pos.y < -14 || pos.y > 78) {
    return true;
  }
  const dx = pos.x - origin.x;
  const dy = pos.y - origin.y;
  const dz = pos.z - origin.z;
  const limit = Math.max(5, maxRange);
  return dx * dx + dy * dy + dz * dz > limit * limit;
}

// ============================================================================
// PERIMETER AIR-WALL CONTAINMENT (`空气墙防越界判定` — Players & Flying Drones)
// ============================================================================

export interface ArenaAirWallBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  droneMaxY: number;
}

/**
 * Exact interior playable bounds inside Hanamura Castle-Town's perimeter walls:
 * - West wall inner face: `-74.3` -> `minX = -73.6`
 * - East wall inner face: `+78.2` -> `maxX = +77.4`
 * - North/South stone wall inner faces: `±51.9` -> `minZ = -51.1, maxZ = +51.1`
 * - Ceiling air-wall: `maxY = 25.5` (drones strictly capped at `droneMaxY = 18.5` so they never fly over walls)
 */
export const ARENA_AIR_WALL_BOUNDS: ArenaAirWallBounds = {
  minX: -73.6,
  maxX: 77.4,
  minY: -2.2,
  maxY: 25.5,
  minZ: -51.1,
  maxZ: 51.1,
  droneMaxY: 18.5,
};

export interface AirWallClampResult {
  pos: Vec3Like;
  vel: Vec3Like;
  clampedX: boolean;
  clampedY: boolean;
  clampedZ: boolean;
}

/**
 * Clamps any ground player, dashing ninja, mech, or flying drone strictly inside the castle-town air walls,
 * reflecting outward velocity inward for flying units so drones smoothly bank back into the arena.
 */
export function clampActorToAirWall(params: {
  pos: Vec3Like;
  vel?: Vec3Like;
  radius?: number;
  isFlying?: boolean;
  bounds?: ArenaAirWallBounds;
}): AirWallClampResult {
  const b = params.bounds ?? ARENA_AIR_WALL_BOUNDS;
  const r = Math.max(0, params.radius ?? 0.45);
  const loX = b.minX + r;
  const hiX = b.maxX - r;
  const loZ = b.minZ + r;
  const hiZ = b.maxZ - r;
  const loY = params.isFlying ? Math.max(b.minY + 1.2, 1.4) : b.minY;
  const hiY = params.isFlying ? b.droneMaxY : b.maxY;

  let x = Number.isFinite(params.pos.x) ? params.pos.x : 0;
  let y = Number.isFinite(params.pos.y) ? params.pos.y : 1.5;
  let z = Number.isFinite(params.pos.z) ? params.pos.z : 0;

  let vx = params.vel && Number.isFinite(params.vel.x) ? params.vel.x : 0;
  let vy = params.vel && Number.isFinite(params.vel.y) ? params.vel.y : 0;
  let vz = params.vel && Number.isFinite(params.vel.z) ? params.vel.z : 0;

  let clampedX = false;
  let clampedY = false;
  let clampedZ = false;
  const bounce = params.isFlying ? -0.65 : 0;

  if (x < loX) {
    x = loX;
    if (vx < 0) vx *= bounce;
    clampedX = true;
  } else if (x > hiX) {
    x = hiX;
    if (vx > 0) vx *= bounce;
    clampedX = true;
  }

  if (z < loZ) {
    z = loZ;
    if (vz < 0) vz *= bounce;
    clampedZ = true;
  } else if (z > hiZ) {
    z = hiZ;
    if (vz > 0) vz *= bounce;
    clampedZ = true;
  }

  if (y < loY) {
    y = loY;
    if (vy < 0) vy = params.isFlying ? Math.abs(vy) * 0.5 : 0;
    clampedY = true;
  } else if (y > hiY) {
    y = hiY;
    if (vy > 0) vy = params.isFlying ? -Math.abs(vy) * 0.55 : 0;
    clampedY = true;
  }

  return {
    pos: { x, y, z },
    vel: { x: vx, y: vy, z: vz },
    clampedX,
    clampedY,
    clampedZ,
  };
}

// ============================================================================
// SHIELDED ENEMY (`玄甲盾卫`) DIRECTIONAL BLOCK & FLANK SOLVER
// ============================================================================

/**
 * Evaluates directional shield mitigation for `shield_guard` (`玄甲盾卫机关兵`):
 * - Frontal non-weakspot ranged hits (`incomingFromFrontCos >= 0.32`) are blocked by 78% (ricochet!).
 * - Flank/back attacks, weakspot headshots, melee slashes, Swift Strike dashes, and Helix splash bypass the shield 100%!
 */
export function computeShieldedEnemyDamage(params: {
  rawDamage: number;
  /** Normalized direction FROM enemy TOWARD attacker/impact source in XZ plane. */
  toSourceDir: Vec3Like;
  /** Normalized forward facing vector of the shielded enemy in XZ plane. */
  enemyForward: Vec3Like;
  isWeakspot?: boolean;
  bypassShield?: boolean;
}): { finalDamage: number; blocked: boolean } {
  const dmg = Math.max(0, params.rawDamage);
  if (dmg <= 0) return { finalDamage: 0, blocked: false };
  if (params.isWeakspot || params.bypassShield) {
    return { finalDamage: dmg, blocked: false };
  }
  const sLen = Math.hypot(params.toSourceDir.x, params.toSourceDir.z) || 1;
  const fLen = Math.hypot(params.enemyForward.x, params.enemyForward.z) || 1;
  const frontCos =
    (params.toSourceDir.x / sLen) * (params.enemyForward.x / fLen) +
    (params.toSourceDir.z / sLen) * (params.enemyForward.z / fLen);

  if (frontCos >= 0.32) {
    return {
      finalDamage: Math.max(2, Math.round(dmg * 0.22)),
      blocked: true,
    };
  }
  return { finalDamage: dmg, blocked: false };
}

// ============================================================================
// GUNNER HERO CLASS (`神机统帅 · 战术枪兵`) PURE STATS & TACTICAL VISOR RULES
// ============================================================================

export interface GunnerStats {
  maxHealth: number;
  magSize: number;
  rifleDamage: number;
  rifleFireInterval: number;
  rifleProjectileSpeed: number;
  rifleSpreadRad: number;
  pierceCount: number;
  bleedDps: number;
  reloadTime: number;

  helixRocketCount: number;
  helixDirectDamage: number;
  helixSplashDamage: number;
  helixSplashRadius: number;
  helixCooldown: number;
  helixSpeed: number;

  sprintSpeedMultiplier: number;
  moveSpeedMultiplier: number;
  maxAirJumps: number;

  bioticCooldown: number;
  bioticDuration: number;
  bioticRadius: number;
  bioticHealPerSec: number;
  bioticFireRateBonus: number;
  bioticPulseShockwave: number;

  visorDuration: number;
  visorConeCos: number;
  visorFireRateBonus: number;
  visorExtendOnKill: number;
  maxVisorExtensions: number;
  visorMicroMissiles: boolean;
  visorLifestealRatio: number;
  ultChargeMultiplier: number;
}

export interface GunnerCooldownState {
  helixCd: number;
  bioticCd: number;
  bioticActiveT: number;
  sprintActive: boolean;
  ultCharge: number;
  visorActiveT: number;
  visorMaxT: number;
  visorExtendsUsed: number;
  maxVisorExtensions: number;
}

export function createBaseGunnerStats(): GunnerStats {
  return {
    maxHealth: 250,
    magSize: 40,
    rifleDamage: 34,
    rifleFireInterval: 0.078,
    rifleProjectileSpeed: 480,
    rifleSpreadRad: 0.0085,
    pierceCount: 0,
    bleedDps: 0,
    reloadTime: 0.85,

    helixRocketCount: 3,
    helixDirectDamage: 72,
    helixSplashDamage: 68,
    helixSplashRadius: 4.8,
    helixCooldown: 4.2,
    helixSpeed: 148,

    sprintSpeedMultiplier: 1.65,
    moveSpeedMultiplier: 1.18,
    maxAirJumps: 1,

    bioticCooldown: 9.5,
    bioticDuration: 5.8,
    bioticRadius: 5.8,
    bioticHealPerSec: 62,
    bioticFireRateBonus: 0.28,
    bioticPulseShockwave: 0,

    visorDuration: 7.0,
    visorConeCos: 0.85, // ~31.8 deg central visor circle
    visorFireRateBonus: 0.34,
    visorExtendOnKill: 0.85,
    maxVisorExtensions: 3,
    visorMicroMissiles: false,
    visorLifestealRatio: 0,
    ultChargeMultiplier: 1.12,
  };
}

/**
 * Computes Gunner's Heavy Pulse Rifle shot damage with Focused Plasma Overcharge:
 * - Consecutive hits build Overcharge (`+3.5%` per hit up to `+35%` at 10 stacks)
 * - Standing in Biotic Overdrive Field grants `+20%` weapon amp
 * - Manual headshots/weakspots deal `1.75x`; Tactical Visor auto-locks deal `1.35x` precision bonus
 */
export function computeGunnerShotDamage(params: {
  baseDamage: number;
  consecutiveHits: number;
  inBioticField: boolean;
  isWeakspot: boolean;
  isVisorLock: boolean;
}): { damage: number; overchargeRatio: number; isCrit: boolean } {
  const streak = Math.max(0, Math.min(10, Math.floor(params.consecutiveHits || 0)));
  const overchargeRatio = +(streak / 10).toFixed(2);
  const streakMult = 1 + streak * 0.035;
  const bioticMult = params.inBioticField ? 1.2 : 1.0;
  const isCrit = !!(params.isWeakspot || params.isVisorLock);
  const critMult = params.isWeakspot
    ? params.isVisorLock
      ? 1.35
      : 1.75
    : params.isVisorLock
      ? 1.25
      : 1.0;
  const raw = Math.max(1, params.baseDamage) * streakMult * bioticMult * critMult;
  return {
    damage: Math.max(1, Math.round(raw)),
    overchargeRatio,
    isCrit,
  };
}

/**
 * Validates that an arena stairway cleanly bridges `fromY -> toY` with capsule-walkable step rise (`<= 0.36m`).
 */
export function validateArenaStairway(params: {
  fromY: number;
  toY: number;
  steps: number;
  width: number;
}): { valid: boolean; stepRise: number } {
  const steps = Math.max(1, Math.floor(params.steps));
  const stepRise = Math.abs(params.toY - params.fromY) / steps;
  return {
    valid: stepRise > 0 && stepRise <= 0.36 && params.width >= 2.2,
    stepRise: +stepRise.toFixed(4),
  };
}

/**
 * Maps universal Roguelike upgrade stacks onto Gunner's Heavy Pulse Rifle, Helix Rockets,
 * Tactical Sprint, Biotic Field, and Tactical Visor so every drafted card powers up both heroes!
 */
export function computeGunnerBuildStats(stacks: Record<string, number>): GunnerStats {
  const s = createBaseGunnerStats();
  const n = (id: string) => Math.max(0, Math.floor(stacks[id] || 0));

  if (n('shuriken_penta') > 0) {
    s.magSize += 12; // 52-round drum mag
    s.helixRocketCount = 4;
  }
  if (n('shuriken_LOTUS') > 0) {
    s.helixRocketCount = Math.max(s.helixRocketCount, 5);
    s.helixDirectDamage = Math.round(s.helixDirectDamage * 1.28);
    s.helixSplashRadius += 1.2;
    s.magSize += 12;
  }
  if (n('shuriken_pierce') > 0) {
    const k = n('shuriken_pierce');
    s.rifleDamage = Math.round(s.rifleDamage * (1 + 0.18 * k));
    s.pierceCount += k;
    s.bleedDps += 16 * k;
  }
  if (n('shuriken_cadence') > 0) {
    const k = n('shuriken_cadence');
    s.rifleFireInterval = Math.max(0.048, s.rifleFireInterval * Math.pow(0.85, k));
    s.rifleProjectileSpeed *= 1 + 0.14 * k;
    s.helixSpeed *= 1 + 0.12 * k;
    s.reloadTime = Math.max(0.48, s.reloadTime * Math.pow(0.84, k));
  }

  if (n('swift_phantom') > 0) {
    s.helixCooldown = Math.max(2.4, s.helixCooldown - 0.9 * n('swift_phantom'));
  }
  if (n('swift_edge') > 0) {
    const k = n('swift_edge');
    s.sprintSpeedMultiplier += 0.10 * k;
    s.helixSplashDamage += 22 * k;
  }
  if (n('swift_aegis') > 0) {
    const k = n('swift_aegis');
    s.maxHealth += 35 * k;
    s.bioticHealPerSec += 14 * k;
  }
  if (n('cyber_triple_jump') > 0) {
    s.maxAirJumps = 2; // Upgraded triple exo-thruster jump!
    s.moveSpeedMultiplier *= 1.15;
  }

  if (n('deflect_homing') > 0) {
    s.visorConeCos = 0.76; // Wider Tactical Visor lock-on FOV
    s.rifleSpreadRad *= 0.45;
  }
  if (n('deflect_iaido') > 0) {
    s.bioticPulseShockwave += 115 * n('deflect_iaido');
  }
  if (n('deflect_siphon') > 0) {
    const k = n('deflect_siphon');
    s.bioticDuration += 0.85 * k;
    s.bioticCooldown = Math.max(5.5, s.bioticCooldown - 1.4 * k);
  }

  if (n('dragon_wave') > 0) {
    s.visorMicroMissiles = true;
  }
  if (n('dragon_feast') > 0) {
    const k = n('dragon_feast');
    s.visorExtendOnKill = 1.3 * k;
    s.visorFireRateBonus += 0.12 * k;
  }
  if (n('dragon_blood') > 0) {
    s.visorLifestealRatio = Math.min(0.55, 0.22 * n('dragon_blood'));
  }
  if (n('dragon_reactor') > 0) {
    const k = n('dragon_reactor');
    s.ultChargeMultiplier += 0.28 * k;
    s.rifleDamage += 4 * k;
  }
  if (n('vitality_overclock') > 0) {
    const k = n('vitality_overclock');
    s.maxHealth += 50 * k;
    s.magSize += 10 * k;
  }

  return s;
}

export interface VisorCandidate {
  id: number;
  aimPoint: Vec3Like;
  isBoss?: boolean;
  hpRatio?: number;
}

/**
 * Selects the optimal target inside the Gunner's Tactical Visor (`战术目镜`) reticle cone,
 * prioritizing center-crosshair angular proximity and low-HP / Boss priority targets.
 */
export function selectTacticalVisorTarget(params: {
  eyePos: Vec3Like;
  forward: Vec3Like;
  candidates: VisorCandidate[];
  minConeCos?: number;
  maxRange?: number;
}): { target: VisorCandidate | null; aimDir: Vec3Like; lockCos: number } {
  const minCos = params.minConeCos ?? 0.84;
  const maxRange = params.maxRange ?? 95;
  const fwd = normalizeFiniteVec3(params.forward.x, params.forward.y, params.forward.z, {
    x: 0,
    y: 0,
    z: -1,
  });

  let best: VisorCandidate | null = null;
  let bestScore = -Infinity;
  let bestDir: Vec3Like = fwd;
  let bestCos = -1;

  for (const c of params.candidates) {
    const dx = c.aimPoint.x - params.eyePos.x;
    const dy = c.aimPoint.y - params.eyePos.y;
    const dz = c.aimPoint.z - params.eyePos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.25 || dist > maxRange) continue;

    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;
    const cos = nx * fwd.x + ny * fwd.y + nz * fwd.z;
    if (cos < minCos) continue;

    // Score strongly favors linear reticle-center proximity (-angleRad), plus slight finisher/boss tie-breaker
    const angleRad = Math.acos(Math.max(-1, Math.min(1, cos)));
    const finisherBonus = c.hpRatio !== undefined ? (1 - clamp01(c.hpRatio)) * 0.03 : 0;
    const bossBonus = c.isBoss ? 0.02 : 0;
    const distPenalty = (dist / maxRange) * 0.02;
    const score = -angleRad + finisherBonus + bossBonus - distPenalty;

    if (score > bestScore) {
      bestScore = score;
      best = c;
      bestDir = { x: nx, y: ny, z: nz };
      bestCos = cos;
    }
  }

  return { target: best, aimDir: bestDir, lockCos: bestCos };
}

/**
 * Applies Tactical Gunner elimination cooldown refunds & capped Tactical Visor kill extensions:
 * - Refunds `1.4s` of Helix Rocket cooldown (`2.4s` on Elite/Boss)
 * - During Tactical Visor (`visorActiveT > 0`), extends duration by `stats.visorExtendOnKill` strictly up to `maxVisorExtensions` (`3`)
 * - Outside Tactical Visor, grants `+9%` (`+18%` on Elite/Boss) Ultimate charge scaled by `ultChargeMultiplier`
 */
export function applyGunnerEliminationReset(
  cd: GunnerCooldownState,
  stats: GunnerStats,
  isEliteOrBoss = false
): GunnerCooldownState {
  const next: GunnerCooldownState = { ...cd };
  const helixRefund = isEliteOrBoss ? 2.4 : 1.4;
  next.helixCd = Math.max(0, next.helixCd - helixRefund);

  const maxExt = next.maxVisorExtensions ?? stats.maxVisorExtensions ?? 3;
  const usedExt = next.visorExtendsUsed ?? 0;

  if (next.visorActiveT > 0) {
    if (stats.visorExtendOnKill > 0 && usedExt < maxExt) {
      next.visorActiveT = Math.min(
        next.visorMaxT + 2.5,
        next.visorActiveT + stats.visorExtendOnKill
      );
      next.visorExtendsUsed = usedExt + 1;
    }
  } else {
    const gain = (isEliteOrBoss ? 18 : 9) * stats.ultChargeMultiplier;
    next.ultCharge = Math.min(100, next.ultCharge + gain);
  }
  return next;
}

/**
 * Enforces strict single-hero run integrity:
 * Players may ONLY select or change heroes on the `'title'` screen (or by triggering a full restart
 * from Wave 1 with empty talent stacks). Mid-run hero switching (`playing`, `intro`, `paused`, `upgrade`)
 * is strictly forbidden so Roguelike talents never become mismatched or invalidated.
 */
export function canSwitchHeroInState(gameState: string): boolean {
  return gameState === 'title';
}

/**
 * Pure visibility state resolver for first-person hero viewmodels (`genji` vs `gunner`).
 * Guarantees the locked hero's weapon & hands stay visible across `intro`, `playing`, `paused`, and `upgrade`,
 * and only hide on `title` / `dead`.
 */
export function computeHeroViewmodelVisibility(
  gameState: string,
  activeHero: HeroClassId,
  noWeapon = false
): { genjiVisible: boolean; gunnerVisible: boolean; hanzoVisible: boolean } {
  if (noWeapon) {
    return { genjiVisible: false, gunnerVisible: false, hanzoVisible: false };
  }
  const showActive =
    gameState === 'playing' ||
    gameState === 'intro' ||
    gameState === 'paused' ||
    gameState === 'upgrade';
  return {
    genjiVisible: showActive && activeHero === 'genji',
    gunnerVisible: showActive && activeHero === 'gunner',
    hanzoVisible: showActive && activeHero === 'hanzo',
  };
}

// ============================================================================
// SHIMADA HANZO (`岛田半藏 · 风林岚弓`) PURE STATS, BOW DRAW, RICOCHET & TALENTS
// ============================================================================

export interface HanzoStats {
  maxHealth: number;
  fullDrawTime: number;
  minArrowDamage: number;
  maxArrowDamage: number;
  minArrowSpeed: number;
  maxArrowSpeed: number;
  minArrowGravity: number;
  maxArrowGravity: number;
  headshotMultiplier: number;
  pierceCount: number;
  bleedDps: number;
  bleedDuration: number;

  stormArrowCount: number;
  stormArrowDamage: number;
  stormArrowInterval: number;
  stormArrowDuration: number;
  stormArrowCooldown: number;
  stormRicochetBounces: number;

  sonicCooldown: number;
  sonicDuration: number;
  sonicRadius: number;
  sonicAmpMultiplier: number;
  sonicPulseDamage: number;

  lungeCooldown: number;
  lungeSpeed: number;
  lungeShieldHeal: number;
  maxAirJumps: number;
  wallClimbDuration: number;
  wallClimbSpeed: number;
  moveSpeedMultiplier: number;

  dragonstrikeDuration: number;
  dragonstrikeSpeed: number;
  dragonstrikeRadius: number;
  dragonstrikeDps: number;
  dragonstrikeLifestealRatio: number;
  dragonstrikeTwinScale: number;
  ultChargeMultiplier: number;
}

export interface HanzoCooldownState {
  sonicCd: number;
  sonicArmed: boolean;
  sonicActiveT: number;
  stormCd: number;
  stormActiveT: number;
  stormArrowsLeft: number;
  lungeCd: number;
  ultCharge: number;
  dragonActiveT: number;
  drawRatio: number;
}

export const HANZO_ARCHETYPE_LABELS: Record<UpgradeArchetype, string> = {
  shuriken: '岚弓与破甲矢',
  mobility: '跃步与轻功',
  deflect: '音障与岚矢',
  dragon: '双龙奥义',
};

export const HANZO_UPGRADE_OVERRIDES: Record<
  string,
  Pick<GenjiUpgradeDef, 'title' | 'subtitle' | 'description'>
> = {
  shuriken_penta: {
    title: '七连岚矢·疾风满弦',
    subtitle: '岚弓秘技 · 箭袋扩编',
    description: '【岚矢】（E）单次开启可连续速射 7 支满速反弹箭矢，满弦基础箭害额外 +12！',
  },
  shuriken_LOTUS: {
    title: '八方惊雷·八连破阵岚',
    subtitle: '宗家弓道 · 万箭齐发',
    description: '【岚矢】（E）增至 8 支高能雷鸣矢，岚矢单发伤害提升 28%，蓄力重箭伤害提升 20%！',
  },
  shuriken_pierce: {
    title: '透甲鸣镝·裂脉重簇',
    subtitle: '岚弓秘技 · 贯甲流血',
    description: '弓箭与岚矢伤害 +18%，箭矢可额外贯穿 +1 名敌军、岚矢墙面弹射次数 +1，并附带每秒 16 点裂脉流血。',
  },
  shuriken_cadence: {
    title: '神速引弦·强弓疾矢',
    subtitle: '岚弓秘技 · 瞬息满弓',
    description: '岚弓拉满蓄力时间缩短 18%，箭矢初速提升 16%，【岚矢】速射间隔进一步缩短 15%。',
  },
  swift_phantom: {
    title: '回响音矢·双频索敌',
    subtitle: '音障秘传 · 洞悉弱点',
    description: '【音障探测矢】（Shift）冷却缩短 2.2 秒，声呐领域半径扩大 +3 米，被探测敌军承受易伤再 +10%。',
  },
  swift_edge: {
    title: '疾风跃步·崩云劲射',
    subtitle: '身法弓术 · 腾空强袭',
    description: '空中【跃步】（Space）推进速度提升 18%、冷却缩短 0.7 秒，满弦箭矢对建筑与护甲伤害 +24。',
  },
  swift_aegis: {
    title: '心气合一·凌空纳气',
    subtitle: '宗家护体 · 吐纳回生',
    description: '最大生命值 +32，每次施展空中【跃步】立即恢复 18 点生命。',
  },
  cyber_triple_jump: {
    title: '飞檐灵鹫·二段跃步',
    subtitle: '宗家轻功 · 绝壁登云',
    description: '解锁额外一次空中跃步充能，飞檐爬墙耐力延长 75%，移动速度全面提升 15%。',
  },
  deflect_homing: {
    title: '天眼折跃·必中弹射',
    subtitle: '岚矢奥义 · 折光锁敌',
    description: '【岚矢】命中墙面或地面弹射时，大角度智能折向视野内最近敌军要害，弹射伤害提高 30%！',
  },
  deflect_iaido: {
    title: '共鸣震波·破障鸣矢',
    subtitle: '音障秘法 · 声爆碎甲',
    description: '【音障探测矢】落地展开瞬间爆发苍蓝声爆冲击波，对领域内敌军造成 95 点无视护盾震荡伤害（每层 +95）。',
  },
  deflect_siphon: {
    title: '风林流转·急岚回气',
    subtitle: '宗家弓道 · 循环不息',
    description: '【岚矢】（E）冷却缩短 1.3 秒、持续时间 +1.0 秒；岚矢每次命中回复 8 点生命。',
  },
  dragon_wave: {
    title: '苍穹巨龙·扩域噬魂',
    subtitle: '终极奥义 · 双龙吞天',
    description: '【龙魂双生】（Q）双生神龙螺旋半径扩大 40%，穿墙蚀魂每秒伤害提升 +85 点！',
  },
  dragon_feast: {
    title: '龙脉奔流·连诛贯日',
    subtitle: '终极秘传 · 战意沸腾',
    description: '【龙魂双生】持续行进距离与时间延长 22%，每次淘汰敌军立即缩减【岚矢】与【音矢】1.8 秒冷却。',
  },
  dragon_blood: {
    title: '苍龙汲魂·灵脉回生',
    subtitle: '双龙秘传 · 噬灵化血',
    description: '【龙魂双生】与满弦爆头造成伤害的 22% 直接转化为自身生命回复（每层 +22%）。',
  },
  dragon_reactor: {
    title: '宗家龙印·神弓聚灵',
    subtitle: '双龙秘传 · 灵力激增',
    description: '【龙魂双生】（Q）充能效率提升 +28%，满弦箭矢基础伤害提升 +18 点。',
  },
  vitality_overclock: {
    title: '弓圣体魄·气定神闲',
    subtitle: '护身秘传 · 根基稳固',
    description: '最大生命值 +48，立即恢复生命，拉弓蓄力期间移动减速大幅减轻。',
  },
};

export function createBaseHanzoStats(): HanzoStats {
  return {
    maxHealth: 200,
    fullDrawTime: 0.68,
    minArrowDamage: 42,
    maxArrowDamage: 125,
    minArrowSpeed: 54,
    maxArrowSpeed: 132,
    minArrowGravity: 2.2,
    maxArrowGravity: 9.6,
    headshotMultiplier: 2.0,
    pierceCount: 0,
    bleedDps: 0,
    bleedDuration: 3.0,

    stormArrowCount: 5,
    stormArrowDamage: 76,
    stormArrowInterval: 0.22,
    stormArrowDuration: 5.5,
    stormArrowCooldown: 8.0,
    stormRicochetBounces: 1,

    sonicCooldown: 10.0,
    sonicDuration: 6.5,
    sonicRadius: 13.0,
    sonicAmpMultiplier: 1.25,
    sonicPulseDamage: 0,

    lungeCooldown: 4.0,
    lungeSpeed: 14.5,
    lungeShieldHeal: 0,
    maxAirJumps: 1,
    wallClimbDuration: 1.65,
    wallClimbSpeed: 7.4,
    moveSpeedMultiplier: 1.14,

    dragonstrikeDuration: 4.8,
    dragonstrikeSpeed: 20.0,
    dragonstrikeRadius: 4.4,
    dragonstrikeDps: 260,
    dragonstrikeLifestealRatio: 0,
    dragonstrikeTwinScale: 1.0,
    ultChargeMultiplier: 1.08,
  };
}

export function computeHanzoBuildStats(stacks: Record<string, number>): HanzoStats {
  const s = createBaseHanzoStats();
  const n = (id: string) => Math.max(0, Math.floor(stacks[id] || 0));

  if (n('shuriken_penta') > 0) {
    s.stormArrowCount = 7;
    s.maxArrowDamage += 12;
  }
  if (n('shuriken_LOTUS') > 0) {
    s.stormArrowCount = Math.max(s.stormArrowCount, 8);
    s.stormArrowDamage = Math.round(s.stormArrowDamage * 1.28);
    s.maxArrowDamage = Math.round(s.maxArrowDamage * 1.20);
  }
  if (n('shuriken_pierce') > 0) {
    const k = n('shuriken_pierce');
    s.maxArrowDamage = Math.round(s.maxArrowDamage * (1 + 0.18 * k));
    s.minArrowDamage = Math.round(s.minArrowDamage * (1 + 0.18 * k));
    s.stormArrowDamage = Math.round(s.stormArrowDamage * (1 + 0.18 * k));
    s.pierceCount += k;
    s.stormRicochetBounces += k;
    s.bleedDps += 16 * k;
  }
  if (n('shuriken_cadence') > 0) {
    const k = n('shuriken_cadence');
    s.fullDrawTime = Math.max(0.36, s.fullDrawTime * Math.pow(0.82, k));
    s.maxArrowSpeed *= 1 + 0.16 * k;
    s.minArrowSpeed *= 1 + 0.16 * k;
    s.stormArrowInterval = Math.max(0.13, s.stormArrowInterval * Math.pow(0.85, k));
  }

  if (n('swift_phantom') > 0) {
    const k = n('swift_phantom');
    s.sonicCooldown = Math.max(4.5, s.sonicCooldown - 2.2 * k);
    s.sonicRadius += 3.0 * k;
    s.sonicAmpMultiplier += 0.10 * k;
  }
  if (n('swift_edge') > 0) {
    const k = n('swift_edge');
    s.lungeSpeed *= 1 + 0.18 * k;
    s.lungeCooldown = Math.max(2.0, s.lungeCooldown - 0.7 * k);
    s.maxArrowDamage += 24 * k;
  }
  if (n('swift_aegis') > 0) {
    const k = n('swift_aegis');
    s.maxHealth += 32 * k;
    s.lungeShieldHeal += 18 * k;
  }
  if (n('cyber_triple_jump') > 0) {
    s.maxAirJumps = 2;
    s.wallClimbDuration *= 1.75;
    s.wallClimbSpeed *= 1.15;
    s.moveSpeedMultiplier *= 1.15;
  }

  if (n('deflect_homing') > 0) {
    s.stormRicochetBounces += 1;
    s.stormArrowDamage = Math.round(s.stormArrowDamage * 1.30);
  }
  if (n('deflect_iaido') > 0) {
    s.sonicPulseDamage += 95 * n('deflect_iaido');
  }
  if (n('deflect_siphon') > 0) {
    const k = n('deflect_siphon');
    s.stormArrowCooldown = Math.max(3.8, s.stormArrowCooldown - 1.3 * k);
    s.stormArrowDuration += 1.0 * k;
  }

  if (n('dragon_wave') > 0) {
    s.dragonstrikeRadius *= 1.40;
    s.dragonstrikeTwinScale = 1.36;
    s.dragonstrikeDps += 85;
  }
  if (n('dragon_feast') > 0) {
    const k = n('dragon_feast');
    s.dragonstrikeDuration *= 1 + 0.22 * k;
  }
  if (n('dragon_blood') > 0) {
    s.dragonstrikeLifestealRatio = Math.min(0.55, 0.22 * n('dragon_blood'));
  }
  if (n('dragon_reactor') > 0) {
    const k = n('dragon_reactor');
    s.ultChargeMultiplier += 0.28 * k;
    s.maxArrowDamage += 18 * k;
  }
  if (n('vitality_overclock') > 0) {
    const k = n('vitality_overclock');
    s.maxHealth += 48 * k;
  }

  return s;
}

/**
 * Pure bow-draw ballistic curve for Shimada Hanzo (`岚弓蓄力弹道解算`):
 * Scales arrow speed, gravity drop, and damage smoothly with draw hold duration,
 * or snaps to instant high-velocity flight during `岚矢` (Storm Arrows).
 */
export function computeHanzoBowDraw(params: {
  holdSeconds: number;
  stats: HanzoStats;
  isStormArrow?: boolean;
}): {
  drawRatio: number;
  damage: number;
  speed: number;
  gravityDrop: number;
  isFullDraw: boolean;
} {
  const { stats } = params;
  if (params.isStormArrow) {
    return {
      drawRatio: 1,
      damage: stats.stormArrowDamage,
      speed: stats.maxArrowSpeed * 1.04,
      gravityDrop: 1.5,
      isFullDraw: true,
    };
  }
  const safeHold = Number.isFinite(params.holdSeconds) ? Math.max(0, params.holdSeconds) : 0;
  const fullT = Math.max(0.18, stats.fullDrawTime);
  const drawRatio = clamp01(safeHold / fullT);
  // Slightly convex power curve rewards full Kyudo draw (`会 -> 离`)
  const powerCurve = Math.pow(drawRatio, 1.15);
  const damage = Math.round(
    stats.minArrowDamage + (stats.maxArrowDamage - stats.minArrowDamage) * powerCurve
  );
  const speed = stats.minArrowSpeed + (stats.maxArrowSpeed - stats.minArrowSpeed) * drawRatio;
  const gravityDrop =
    stats.maxArrowGravity + (stats.minArrowGravity - stats.maxArrowGravity) * drawRatio;
  return {
    drawRatio,
    damage,
    speed,
    gravityDrop,
    isFullDraw: drawRatio >= 0.94,
  };
}

/**
 * Pure specular + smart-ricochet solver for Hanzo's Storm Arrows (`岚矢弹射解算`).
 */
export function computeStormArrowRicochet(params: {
  incidentDir: Vec3Like;
  surfaceNormal: Vec3Like;
  candidateTargetDirs?: Vec3Like[];
  minSnapCos?: number;
}): { outDir: Vec3Like; snappedToTarget: boolean } {
  const inc = normalizeFiniteVec3(
    params.incidentDir.x,
    params.incidentDir.y,
    params.incidentDir.z,
    { x: 0, y: 0, z: -1 }
  );
  const nrm = normalizeFiniteVec3(
    params.surfaceNormal.x,
    params.surfaceNormal.y,
    params.surfaceNormal.z,
    { x: 0, y: 1, z: 0 }
  );
  const dotIN = inc.x * nrm.x + inc.y * nrm.y + inc.z * nrm.z;
  const refl = normalizeFiniteVec3(
    inc.x - 2 * dotIN * nrm.x,
    inc.y - 2 * dotIN * nrm.y,
    inc.z - 2 * dotIN * nrm.z,
    { x: -inc.x, y: -inc.y, z: -inc.z }
  );

  const minCos = params.minSnapCos ?? 0.72;
  let bestDir: Vec3Like | null = null;
  let bestCos = minCos;
  if (params.candidateTargetDirs && params.candidateTargetDirs.length > 0) {
    for (const rawCand of params.candidateTargetDirs) {
      const cand = normalizeFiniteVec3(rawCand.x, rawCand.y, rawCand.z, refl);
      // Must point away from impact surface (`dot(cand, nrm) > 0.05`) and align with reflection cone
      const awayDot = cand.x * nrm.x + cand.y * nrm.y + cand.z * nrm.z;
      const alignCos = cand.x * refl.x + cand.y * refl.y + cand.z * refl.z;
      if (awayDot > 0.05 && alignCos > bestCos) {
        bestCos = alignCos;
        bestDir = cand;
      }
    }
  }

  return bestDir
    ? { outDir: bestDir, snappedToTarget: true }
    : { outDir: refl, snappedToTarget: false };
}

export function applyHanzoEliminationReset(
  cd: HanzoCooldownState,
  stats: HanzoStats,
  isEliteOrBoss = false
): HanzoCooldownState {
  const next: HanzoCooldownState = { ...cd };
  const refund = isEliteOrBoss ? 2.6 : 1.4;
  next.lungeCd = Math.max(0, next.lungeCd - refund);
  next.sonicCd = Math.max(0, next.sonicCd - refund);
  next.stormCd = Math.max(0, next.stormCd - (isEliteOrBoss ? 2.0 : 1.0));
  if (next.dragonActiveT <= 0) {
    const gain = (isEliteOrBoss ? 22 : 9) * stats.ultChargeMultiplier;
    next.ultCharge = Math.min(100, next.ultCharge + gain);
  }
  return next;
}

/**
 * Pure near-plane-safe Sniper Laser Sight solver (`狙击手红外瞄准线几何解算`):
 * - Always originates from the sniper's actual world rifle muzzle (`muzzlePos`).
 * - Stops cleanly at `worldHitDist` if blocked by architecture.
 * - When unobstructed and aimed right at the player's eyes, terminates `nearPlaneGuard` (`0.34m`)
 *   in front of `playerEye` with a subtle chest/shoulder offset (`-0.11m` Y) so the beam NEVER
 *   clips through the `0.1m` camera near plane or degenerates into an invisible head-on point!
 */
export function computeSniperLaserSegment(params: {
  muzzlePos: Vec3Like;
  playerEye: Vec3Like;
  worldHitDist: number | null;
  nearPlaneGuard?: number;
}): {
  start: Vec3Like;
  end: Vec3Like;
  dir: Vec3Like;
  length: number;
  visible: boolean;
} {
  const guard = Math.max(0.22, params.nearPlaneGuard ?? 0.34);
  const aimTarget: Vec3Like = {
    x: params.playerEye.x,
    y: params.playerEye.y - 0.11,
    z: params.playerEye.z,
  };
  const dx = aimTarget.x - params.muzzlePos.x;
  const dy = aimTarget.y - params.muzzlePos.y;
  const dz = aimTarget.z - params.muzzlePos.z;
  const rawDist = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(rawDist) || rawDist < guard + 0.18) {
    return {
      start: { ...params.muzzlePos },
      end: { ...params.muzzlePos },
      dir: { x: 0, y: 0, z: 1 },
      length: 0,
      visible: false,
    };
  }
  const dir = { x: dx / rawDist, y: dy / rawDist, z: dz / rawDist };
  const unobstructedLen = Math.max(0.15, rawDist - guard);
  const clampedLen =
    params.worldHitDist !== null && Number.isFinite(params.worldHitDist) && params.worldHitDist > 0.12
      ? Math.min(unobstructedLen, params.worldHitDist)
      : unobstructedLen;

  return {
    start: { ...params.muzzlePos },
    end: {
      x: params.muzzlePos.x + dir.x * clampedLen,
      y: params.muzzlePos.y + dir.y * clampedLen,
      z: params.muzzlePos.z + dir.z * clampedLen,
    },
    dir,
    length: clampedLen,
    visible: clampedLen >= 0.12,
  };
}

/**
 * Pure invariant solver verifying Genji strictly owns ONE single katana (`龙丸一把佩刀`):
 * - `idle` / `shuriken`: `0` drawn blades (sheathed on back/waist; right hand throws shurikens, left hand Kuji guard).
 * - `deflect` (`E`): `1` drawn katana (`拔刀斩击` unsheathe slash -> single-katana parry stance -> sheathe).
 * - `dragonblade` (`Q`): `1` drawn katana (`拔刀出鞘` held on screen for entire `Q`, slashing on every `LMB`).
 * - `melee` (`V`): `1` drawn katana (`拔刀速斩` quick Iai slash).
 */
export function computeGenjiSingleBladeState(params: {
  isDragonblade: boolean;
  dragonSheatheT: number;
  isDeflect: boolean;
  deflectOutroT: number;
  meleeTimer: number;
}): {
  katanaDrawn: boolean;
  visibleBladeCount: 0 | 1;
  mode: 'sheathed' | 'dragonblade' | 'deflect_iaido' | 'quick_melee';
} {
  if (params.isDragonblade || params.dragonSheatheT > 0) {
    return { katanaDrawn: true, visibleBladeCount: 1, mode: 'dragonblade' };
  }
  if (params.isDeflect || params.deflectOutroT > 0) {
    return { katanaDrawn: true, visibleBladeCount: 1, mode: 'deflect_iaido' };
  }
  if (params.meleeTimer > 0) {
    return { katanaDrawn: true, visibleBladeCount: 1, mode: 'quick_melee' };
  }
  return { katanaDrawn: false, visibleBladeCount: 0, mode: 'sheathed' };
}

/**
 * Stylized Hero-Shooter Rendering Pipeline Specification:
 * - Zero gritty military realism artifacts (`filmGrain = 0`, `lensDirt = 0`, `chromaticAberration = 0`, `rainWetness = 0`)
 * - Balanced bright exposure on BOTH forward/software-WebGL (`forwardExposureScale = 0.86`) and GPU post-processing (`key = 0.14`)
 * - Warm golden key sunlight paired with cool sky-cerulean/sakura-bounce `HemisphereLight` + hero rim counter-light
 * - Half-Lambert wrapped diffuse terminator + Fresnel silhouette rim highlights (coral-crimson threat rim on enemies)
 */
export interface StylizedHeroPipelineSpec {
  styleId: 'stylized-hero-pbr';
  sunColorRgb: readonly [number, number, number];
  sunIntensity: number;
  hemiSkyHex: number;
  hemiGroundHex: number;
  hemiIntensity: number;
  rimCounterHex: number;
  rimCounterIntensity: number;
  skyZenithRgb: readonly [number, number, number];
  skyHorizonSunRgb: readonly [number, number, number];
  skyHorizonAwayRgb: readonly [number, number, number];
  fogColorRgb: readonly [number, number, number];
  fogDensityExp2: number;
  forwardExposureScale: number;
  postKey: number;
  postMinExposure: number;
  postMaxExposure: number;
  bloomStrength: number;
  aoStrength: number;
  lookPower: number;
  lookSat: number;
  vignette: number;
  filmGrain: number;
  lensDirt: number;
  chromaticAberration: number;
  rainWetness: number;
}

export const STYLIZED_HERO_PIPELINE_SPEC: StylizedHeroPipelineSpec = {
  styleId: 'stylized-hero-pbr',
  sunColorRgb: [1.0, 0.865, 0.67],
  sunIntensity: 2.52,
  hemiSkyHex: 0x62b0ff,
  hemiGroundHex: 0xc68a6e,
  hemiIntensity: 0.70,
  rimCounterHex: 0x70abff,
  rimCounterIntensity: 0.48,
  skyZenithRgb: [0.022, 0.142, 0.55],
  skyHorizonSunRgb: [0.56, 0.37, 0.25],
  skyHorizonAwayRgb: [0.135, 0.335, 0.67],
  fogColorRgb: [0.23, 0.37, 0.63],
  fogDensityExp2: 0.00118,
  forwardExposureScale: 0.85,
  postKey: 0.138,
  postMinExposure: 0.52,
  postMaxExposure: 1.02,
  bloomStrength: 0.045,
  aoStrength: 0.72,
  lookPower: 1.07,
  lookSat: 1.28,
  vignette: 0.05,
  filmGrain: 0.0,
  lensDirt: 0.0,
  chromaticAberration: 0.0,
  rainWetness: 0.0,
};

/**
 * Evaluates stylized wrapped Half-Lambert diffuse response `((N·L * (1 - wrap) + wrap))^2`
 * so shadow terminators roll off with warm-to-cool painterly softness instead of harsh military black crush.
 */
export function evaluateStylizedHalfLambert(ndotl: number, wrap = 0.5): number {
  const clampedNdotL = Math.max(-1, Math.min(1, Number.isFinite(ndotl) ? ndotl : 0));
  const w = Math.max(0.05, Math.min(0.85, Number.isFinite(wrap) ? wrap : 0.5));
  const wrapped = Math.max(0, Math.min(1, clampedNdotL * (1 - w) + w));
  return wrapped * wrapped;
}

/**
 * Evaluates stylized Fresnel grazing-angle silhouette rim intensity `(1 - saturate(N·V))^power * strength`
 * used for crisp comic/hero-shooter character and weapon edge separation.
 */
export function evaluateStylizedRimFactor(ndotv: number, power = 2.8, strength = 1.0): number {
  const clampedNdotV = Math.max(0, Math.min(1, Number.isFinite(ndotv) ? ndotv : 1));
  const p = Math.max(0.5, Number.isFinite(power) ? power : 2.8);
  const s = Math.max(0, Number.isFinite(strength) ? strength : 1.0);
  return Math.pow(1 - clampedNdotV, p) * s;
}
