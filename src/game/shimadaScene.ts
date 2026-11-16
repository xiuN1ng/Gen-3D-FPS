/**
 * Pure Procedural Classical Japanese Mountain Village (`花村古里 · 宿场与山城本丸`):
 *
 * 1. Sprawling ~188m x 168m (`x: -92..+92, z: -84..+84`) multi-district Edo/Sengoku mountain village:
 *    - West Shukuba-machi Post-Town Avenue (`西口冠木门 · 宿场町通`) with two-story Machiya merchant houses
 *    - Central Crystal Stream Gorge (`清流溪谷`), Rotating Waterwheel Mill (`水车小屋`), 3 Bridges & Fire-Watchtower (`火见橹`)
 *    - North Shirakawa-go Gassho Thatched Farmhouses (`合掌造茅葺民家`) & Moso Bamboo Inari Torii Trail (`孟宗竹林千本鸟居`)
 *    - South Namako-Wall Kura Storehouses (`海鼠壁白壁土藏`) & Kyudo Archery Grounds (`弓道场`)
 *    - East Two-Tier Polygonal Ishigaki Castle Terraces (`二重石垣曲轮`) & Three-Story Wooden Honmaru Tenshu (`本丸天守阁`)
 * 2. 100% De-Cyberpunk: zero neon strips, zero sci-fi towers — pure natural stone, smoked clay kawara tiles,
 *    reed thatch, hinoki/yakisugi timber, warm oiled-paper chochin lanterns, and flickering iron kagaribi braziers.
 * 3. Scene-Specific Procedural PBR Materials (`villageMaterials.ts`) with world-space UV projection, Sobel normal maps,
 *    and physical roughness maps.
 * 4. Multi-Stage Destructible Classical Buildings (`22+` breachable Machiya walls, collapsible thatched tea pavilions,
 *    destructible timber watchtowers, bamboo/wood palisades & sake barrel carts) with live `G.physics.removeBox`
 *    breaching and pooled 3D ballistic timber/tile/washi debris!
 */

import {
  createVillageMaterials,
  applyClassicalVillageGround,
  type VillageMaterialLibrary,
} from './villageMaterials';
import {
  stepDestructibleStructure,
  computeHippedRoofHalfExtents,
  computePitchedRoofColliderBoxes,
  computeFujiProfileSample,
  STYLIZED_HERO_PIPELINE_SPEC,
  type DestructibleState,
  type RoofProfileSpec,
} from './roguelike';
import { installStylizedHeroLighting } from './stylizedRenderPipeline';

/**
 * Sets radiant stylized Hanamura golden-spring sunlight & cerulean-sakura sky atmosphere
 * BEFORE `Hg` bakes the procedural sky dome & PMREM environment map!
 */
export function applyShimadaAtmosphere(Mn: any, en: any): void {
  if (Mn) {
    // Crisp golden-spring sunlight from ENE at ~27 deg elevation balanced with multi-light stylized rig
    Mn.dir.set(0.75, 0.43, 0.50).normalize();
    Mn.color.setRGB(...STYLIZED_HERO_PIPELINE_SPEC.sunColorRgb);
    Mn.intensity = STYLIZED_HERO_PIPELINE_SPEC.sunIntensity;
  }
  if (en) {
    en.zenith.setRGB(...STYLIZED_HERO_PIPELINE_SPEC.skyZenithRgb);
    en.horizon.setRGB(...STYLIZED_HERO_PIPELINE_SPEC.skyHorizonSunRgb);
    en.horizonAway.setRGB(...STYLIZED_HERO_PIPELINE_SPEC.skyHorizonAwayRgb);
    en.fog.setRGB(...STYLIZED_HERO_PIPELINE_SPEC.fogColorRgb);
  }
}

export interface DestructibleBuilding {
  id: string;
  label: string;
  kind: 'pavilion' | 'watchtower' | 'shoji_wall' | 'palisade' | 'barrels';
  state: DestructibleState;
  center: any;
  min: any;
  max: any;
  intactGroup: any;
  damagedGroup: any;
  ruinGroup: any;
  colliders: any[];
}

interface DebrisPiece {
  active: boolean;
  pool: 0 | 1 | 2; // 0 = timber plank/beam, 1 = kawara clay tile shard, 2 = washi/thatch scrap
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  vrz: number;
  sx: number;
  sy: number;
  sz: number;
  life: number;
  maxLife: number;
}

export async function createShimadaLevel(G: any): Promise<any> {
  const THREE = G.THREE;
  installStylizedHeroLighting(G);
  const mats: VillageMaterialLibrary = createVillageMaterials(G);

  const root = new THREE.Group();
  root.name = 'level-classical-japanese-village';
  G.scene.add(root);

  const staticGroup = new THREE.Group();
  staticGroup.name = 'village-static';
  const dynGroup = new THREE.Group();
  dynGroup.name = 'village-dynamic';
  root.add(staticGroup, dynGroup);

  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  function tagCylinderUvMode(geo: any) {
    const nrm = geo.attributes.normal;
    const modes = new Float32Array(nrm.count);
    for (let i = 0; i < nrm.count; i++) {
      modes[i] = Math.abs(nrm.getY(i)) < 0.5 ? 3.0 : 0.0;
    }
    geo.setAttribute('aUvMode', new THREE.BufferAttribute(modes, 1));
    return geo;
  }

  // Non-indexed 2-band curved hipped Japanese roof geometry (`反り寄栋造 / 入母屋造` sori flare)
  // with flat per-slope normals and meter-exact eave-anchored UVs (`aUvMode = 4.0`).
  // Rectangular buildings form a true horizontal ridge matching `ridgeLen` (eliminating floating ridge bars!),
  // while square pavilions/turrets form a classic Hogyo pyramid peak.
  function createHippedCurvedRoofGeo(spec: RoofProfileSpec) {
    const pos: number[] = [];
    const uvs: number[] = [];
    const modes: number[] = [];

    const pushVert = (x: number, y: number, z: number, u: number, v: number, m: number) => {
      pos.push(x, y, z);
      uvs.push(u, v);
      modes.push(m);
    };

    const indices: number[] = [];
    const BANDS = 5;
    const rings: Array<{ hx: number; hz: number; y: number; sZ: number; sX: number }> = [];
    let accSZ = 0;
    let accSX = 0;
    for (let b = 0; b <= BANDS; b++) {
      const t = b / BANDS;
      const ext = computeHippedRoofHalfExtents(spec, t);
      const y = t * spec.heightY;
      if (b > 0) {
        const prev = rings[b - 1];
        accSZ += Math.hypot(prev.hz - ext.hz, y - prev.y);
        accSX += Math.hypot(prev.hx - ext.hx, y - prev.y);
      }
      rings.push({ hx: ext.hx, hz: ext.hz, y, sZ: accSZ, sX: accSX });
    }

    // Emit each of the 4 hip slopes with shared vertices across `BANDS` so *sori* curvature is 100% seamless!
    const pushSlopeStrip = (
      evalLeft: (r: { hx: number; hz: number; y: number; sZ: number; sX: number }) => [number, number, number, number, number],
      evalRight: (r: { hx: number; hz: number; y: number; sZ: number; sX: number }) => [number, number, number, number, number]
    ) => {
      const baseV = pos.length / 3;
      for (let b = 0; b <= BANDS; b++) {
        const L = evalLeft(rings[b]);
        const R = evalRight(rings[b]);
        pushVert(L[0], L[1], L[2], L[3], L[4], 4.0);
        pushVert(R[0], R[1], R[2], R[3], R[4], 4.0);
      }
      for (let b = 0; b < BANDS; b++) {
        const i0 = baseV + b * 2;
        const i1 = i0 + 1;
        const i2 = i0 + 2;
        const i3 = i0 + 3;
        indices.push(i0, i1, i3, i0, i3, i2);
      }
    };

    // +Z South slope, -Z North slope, +X East hip slope, -X West hip slope (all CCW outward)
    pushSlopeStrip(
      (r) => [-r.hx, r.y, r.hz, -r.hx, r.sZ],
      (r) => [r.hx, r.y, r.hz, r.hx, r.sZ]
    );
    pushSlopeStrip(
      (r) => [r.hx, r.y, -r.hz, -r.hx, r.sZ],
      (r) => [-r.hx, r.y, -r.hz, r.hx, r.sZ]
    );
    pushSlopeStrip(
      (r) => [r.hx, r.y, r.hz, -r.hz, r.sX],
      (r) => [r.hx, r.y, -r.hz, r.hz, r.sX]
    );
    pushSlopeStrip(
      (r) => [-r.hx, r.y, -r.hz, -r.hz, r.sX],
      (r) => [-r.hx, r.y, r.hz, r.hz, r.sX]
    );

    // Solid bottom soffit cap facing -Y
    const e0 = rings[0];
    const capBase = pos.length / 3;
    pushVert(-e0.hx, 0, e0.hz, 0, 0, 0.0);
    pushVert(-e0.hx, 0, -e0.hz, 0, 1, 0.0);
    pushVert(e0.hx, 0, -e0.hz, 1, 1, 0.0);
    pushVert(e0.hx, 0, e0.hz, 1, 0, 0.0);
    indices.push(capBase, capBase + 1, capBase + 2, capBase, capBase + 2, capBase + 3);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('aUvMode', new THREE.Float32BufferAttribute(modes, 1));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  const cyl8 = tagCylinderUvMode(new THREE.CylinderGeometry(0.5, 0.5, 1, 8));
  const cyl12 = tagCylinderUvMode(new THREE.CylinderGeometry(0.5, 0.5, 1, 12));
  const cone4 = createHippedCurvedRoofGeo({
    widthX: 1,
    depthZ: 1,
    heightY: 1,
    overhangScale: 1.0,
    eaveYOffset: 0,
    soriMidY: 0.41,
    soriMidS: 0.465,
  });

  function makeMesh(geo: any, mat: any, cast = true, receive = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }

  function addBoxCollider(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    surface = 'concrete',
    opts: Record<string, any> = {}
  ) {
    return G.physics.addBox(
      new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
      new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)),
      { surface, ...opts }
    );
  }

  function placeBox(
    parent: any,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    mat: any,
    surface: string | null = 'concrete',
    colliderOpts: Record<string, any> = {},
    castShadow = true
  ) {
    const m = makeMesh(unitBox, mat, castShadow, true);
    m.position.set(cx, cy, cz);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    let col = null;
    if (surface) {
      col = addBoxCollider(
        cx - sx * 0.5,
        cy - sy * 0.5,
        cz - sz * 0.5,
        cx + sx * 0.5,
        cy + sy * 0.5,
        cz + sz * 0.5,
        surface,
        colliderOpts
      );
    }
    return { mesh: m, collider: col };
  }

  function makeKawaraRoofSpec(widthX: number, depthZ: number, heightY: number): RoofProfileSpec {
    return {
      widthX,
      depthZ,
      heightY,
      overhangScale: 1.04,
      eaveYOffset: 0.17,
      soriMidY: 0.41,
      soriMidS: 0.465,
      ridgeRatio: 0.82,
    };
  }

  function makeThatchRoofSpec(widthX: number, depthZ: number, heightY: number): RoofProfileSpec {
    return {
      widthX,
      depthZ,
      heightY,
      overhangScale: 1.08,
      eaveYOffset: 0.0,
      soriMidY: 0.48,
      soriMidS: 0.49,
      ridgeRatio: 0.78,
    };
  }

  function addRoofColliderSteps(
    cx: number,
    baseY: number,
    cz: number,
    spec: RoofProfileSpec,
    rotY = 0,
    tag = 'pitched-roof',
    outColliders?: any[]
  ) {
    const boxes = computePitchedRoofColliderBoxes(cx, baseY, cz, spec, rotY, 0.26);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const col = addBoxCollider(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, 'wood', {
        noNav: true,
        tag,
      });
      if (outColliders) outColliders.push(col);
    }
  }

  const _hipUp = new THREE.Vector3(0, 1, 0);
  const _hipDir = new THREE.Vector3();
  const _hipQuat = new THREE.Quaternion();

  interface RoofOverhangZone {
    cx: number;
    cz: number;
    eaveY: number;
    halfW: number;
    halfD: number;
    peakY: number;
  }
  const roofOverhangZones: RoofOverhangZone[] = [];

  interface StaircaseQaRecord {
    id: string;
    fromY: number;
    toY: number;
    steps: number;
    width: number;
    stepRise: number;
    stepDepth: number;
  }
  const staircaseRecords: StaircaseQaRecord[] = [];

  interface LanternGlowSource {
    x: number;
    y: number;
    z: number;
    radius: number;
    strength: number;
  }
  const lanternGlowSources: LanternGlowSource[] = [];

  function registerRoofOverhang(cx: number, baseY: number, cz: number, wX: number, dZ: number, hY: number) {
    roofOverhangZones.push({
      cx,
      cz,
      eaveY: baseY + 0.16,
      halfW: wX * 0.54,
      halfD: dZ * 0.54,
      peakY: baseY + hY + 0.25,
    });
  }

  // Helper: Pitched Curved-Eave Kawara Clay-Tile Japanese Roof (`反り入母屋 / 寄栋本瓦葺屋顶` + `垂木` exposed rafters)
  function buildKawaraRoof(widthX: number, depthZ: number, heightY: number, ridgeOrnament = false) {
    const g = new THREE.Group();
    const spec = makeKawaraRoofSpec(widthX, depthZ, heightY);
    const e0 = computeHippedRoofHalfExtents(spec, 0);
    const e2 = computeHippedRoofHalfExtents(spec, 1);

    // Warm hinoki rafter fascia (`轩桁`, lifted +1.5cm above y=0 so it never Z-fights wall tops)
    const rafterFascia = makeMesh(unitBox, mats.agedHinoki);
    rafterFascia.scale.set(widthX * 0.97, 0.085, depthZ * 0.97);
    rafterFascia.position.y = 0.058;
    // Dark yakisugi eave soffit trim (`破风/轩先`, strictly above hinoki fascia y = 0.105..0.165)
    const eave = makeMesh(unitBox, mats.yakisugiPlank);
    eave.scale.set(widthX * 1.025, 0.06, depthZ * 1.025);
    eave.position.y = 0.135;
    g.add(rafterFascia, eave);

    // Exposed traditional hinoki eave rafter tails (`垂木 taruki`) & corner masugumi brackets (merged into 1 static batch!)
    if (widthX >= 4.4 && depthZ >= 4.4) {
      const rafterCountX = Math.min(14, Math.max(4, Math.round(widthX / 1.45)));
      for (let r = 0; r <= rafterCountX; r++) {
        const rx = ((r / rafterCountX) - 0.5) * (widthX * 0.92);
        const taruki = makeMesh(unitBox, mats.agedHinoki, false, true);
        taruki.position.set(rx, 0.072, 0);
        taruki.scale.set(0.085, 0.052, depthZ * 1.035);
        g.add(taruki);
      }
      const rafterCountZ = Math.min(12, Math.max(4, Math.round(depthZ / 1.55)));
      for (let r = 1; r < rafterCountZ; r++) {
        const rz = ((r / rafterCountZ) - 0.5) * (depthZ * 0.90);
        const tarukiZ = makeMesh(unitBox, mats.agedHinoki, false, true);
        tarukiZ.position.set(0, 0.072, rz);
        tarukiZ.scale.set(widthX * 1.035, 0.052, 0.085);
        g.add(tarukiZ);
      }
    }

    // Curved-eave hipped smoked clay tile roof (`ibushi-gawara` courses anchored cleanly at eave y = 0.17)
    const slope = makeMesh(createHippedCurvedRoofGeo(spec), mats.kawaraTile);
    slope.position.y = 0.17;
    g.add(slope);

    // 4 Descending corner hip ridges (`降栋 kudari-mune`) aligned flush from eave corners `(+-e0.hx, +-e0.hz)`
    // up to exact hipped ridge ends `(+-e2.hx, +-e2.hz)`!
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const xStart = sx * e0.hx * 0.985;
        const zStart = sz * e0.hz * 0.985;
        const yStart = 0.19;
        const xEnd = sx * e2.hx;
        const zEnd = sz * e2.hz;
        const yEnd = 0.19 + heightY * 0.98;
        _hipDir.set(xEnd - xStart, yEnd - yStart, zEnd - zStart);
        const segLen = _hipDir.length();
        if (segLen > 0.05) {
          _hipDir.multiplyScalar(1 / segLen);
          _hipQuat.setFromUnitVectors(_hipUp, _hipDir);
          const hipBar = makeMesh(unitBox, mats.kawaraTile, false, true);
          hipBar.position.set((xStart + xEnd) * 0.5, (yStart + yEnd) * 0.5, (zStart + zEnd) * 0.5);
          hipBar.quaternion.copy(_hipQuat);
          hipBar.scale.set(0.19, segLen, 0.19);
          g.add(hipBar);
        }
      }
    }

    // Main smoked-tile ridge beam (`大栋`) + raised Shikkui lime mortar course (proud on X/Z, inset on ends -> zero Z-fighting!)
    const alongX = widthX >= depthZ;
    const ridgeSpan = (alongX ? e2.hx : e2.hz) * 2;
    const ridgeLen = Math.max(0.48, ridgeSpan + 0.28);
    const ridge = makeMesh(unitBox, mats.kawaraTile);
    ridge.scale.set(alongX ? ridgeLen : 0.34, 0.26, alongX ? 0.34 : ridgeLen);
    ridge.position.y = 0.17 + heightY + 0.06;
    const ridgeStripe = makeMesh(unitBox, mats.shikkuiPlaster, false, true);
    ridgeStripe.scale.set(alongX ? ridgeLen * 0.95 : 0.375, 0.065, alongX ? 0.375 : ridgeLen * 0.95);
    ridgeStripe.position.y = 0.17 + heightY + 0.085;
    g.add(ridge, ridgeStripe);

    for (const sgn of [-1, 1]) {
      const oni = makeMesh(unitBox, mats.kawaraTile, false, true);
      oni.scale.set(alongX ? 0.20 : 0.42, 0.38, alongX ? 0.42 : 0.20);
      oni.position.set(
        alongX ? sgn * ridgeLen * 0.5 : 0,
        0.17 + heightY + 0.12,
        alongX ? 0 : sgn * ridgeLen * 0.5
      );
      g.add(oni);
    }

    if (ridgeOrnament) {
      // Sculpted multi-part bronze Shachihoko (`鯱鉾` castle roof carp finials)
      for (const sgn of [-1, 1]) {
        const shachi = new THREE.Group();
        shachi.position.set(
          alongX ? sgn * ridgeLen * 0.48 : 0,
          0.32 + heightY,
          alongX ? 0 : sgn * ridgeLen * 0.48
        );
        const body = makeMesh(unitBox, mats.bronzeAged);
        body.scale.set(0.22, 0.46, 0.22);
        body.rotation.z = alongX ? sgn * -0.22 : 0;
        body.rotation.x = alongX ? 0 : sgn * 0.22;
        const tail = makeMesh(unitBox, mats.bronzeAged);
        tail.position.set(alongX ? sgn * 0.08 : 0, 0.34, alongX ? 0 : sgn * 0.08);
        tail.scale.set(0.16, 0.34, 0.18);
        tail.rotation.z = alongX ? sgn * 0.32 : 0;
        tail.rotation.x = alongX ? 0 : sgn * -0.32;
        shachi.add(body, tail);
        g.add(shachi);
      }
    }
    return g;
  }

  // Helper: Steep Shirakawa-go Gassho Thatched Roof (`合掌造茅葺大屋顶`)
  function buildGasshoThatchRoof(widthX: number, depthZ: number, heightY: number) {
    const g = new THREE.Group();
    const spec = makeThatchRoofSpec(widthX, depthZ, heightY);
    const e2 = computeHippedRoofHalfExtents(spec, 1);

    const gable = makeMesh(unitBox, mats.shikkuiPlaster);
    gable.scale.set(widthX * 0.78, heightY * 0.54, depthZ * 0.50);
    gable.position.y = heightY * 0.27;
    g.add(gable);

    const thatch = makeMesh(createHippedCurvedRoofGeo(spec), mats.thatchRoof);
    thatch.position.y = 0.0;
    g.add(thatch);

    // Crossed wooden ridge poles (`千木` / `栋押え`) matching exact hipped thatch ridge
    const alongX = widthX >= depthZ;
    const ridgeSpan = Math.max(0.9, (alongX ? e2.hx : e2.hz) * 2 + 0.45);
    const ridgeLog = makeMesh(cyl8, mats.agedHinoki);
    if (alongX) ridgeLog.rotation.z = Math.PI / 2;
    else ridgeLog.rotation.x = Math.PI / 2;
    ridgeLog.scale.set(0.28, ridgeSpan, 0.28);
    ridgeLog.position.y = heightY + 0.04;
    g.add(ridgeLog);

    const crossCount = Math.max(2, Math.round(ridgeSpan / 1.55));
    for (let k = 0; k < crossCount; k++) {
      const offs = crossCount === 1 ? 0 : ((k / (crossCount - 1)) - 0.5) * (ridgeSpan * 0.82);
      for (const tilt of [-0.52, 0.52]) {
        const xCross = makeMesh(unitBox, mats.yakisugiPlank);
        xCross.scale.set(0.11, 0.68, 0.11);
        xCross.position.set(alongX ? offs : 0, heightY + 0.12, alongX ? 0 : offs);
        if (alongX) xCross.rotation.x = tilt;
        else xCross.rotation.z = tilt;
        g.add(xCross);
      }
    }
    return g;
  }

  // Helper: Hanging Warm Paper Lantern (`提灯 Chochin` — static lanterns batched into 2 InstancedMeshes!)
  const swayLanterns: any[] = [];
  const staticLanternPlacements: Array<{ x: number; y: number; z: number; scale: number; phase: number }> = [];
  function addHangingChochin(parent: any, x: number, y: number, z: number, scale = 1.0) {
    lanternGlowSources.push({
      x,
      y: y - 0.52 * scale,
      z,
      radius: 4.8 * Math.max(0.85, scale),
      strength: 0.44 * scale,
    });
    if (parent === staticGroup) {
      staticLanternPlacements.push({
        x,
        y,
        z,
        scale,
        phase: staticLanternPlacements.length * 0.87 + x * 0.13 + z * 0.09,
      });
      return;
    }
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const cord = makeMesh(cyl8, mats.yakisugiPlank, false, false);
    cord.scale.set(0.03, 0.28 * scale, 0.03);
    cord.position.y = -0.14 * scale;
    const capT = makeMesh(cyl8, mats.yakisugiPlank, false, false);
    capT.scale.set(0.26 * scale, 0.06 * scale, 0.26 * scale);
    capT.position.y = -0.28 * scale;
    const body = makeMesh(cyl12, mats.warmPaperLantern, false, false);
    body.scale.set(0.36 * scale, 0.48 * scale, 0.36 * scale);
    body.position.y = -0.52 * scale;
    const capB = makeMesh(cyl8, mats.yakisugiPlank, false, false);
    capB.scale.set(0.24 * scale, 0.06 * scale, 0.24 * scale);
    capB.position.y = -0.76 * scale;
    g.add(cord, capT, body, capB);
    parent.add(g);
    swayLanterns.push(g);
  }

  // =========================================================================
  // DESTRUCTIBLE CLASSICAL ARCHITECTURE & POOLED 3D BALLISTIC DEBRIS ENGINE
  // =========================================================================
  const destructibles: DestructibleBuilding[] = [];
  const DEBRIS_PER_POOL = 64;
  const debrisPools = [
    new THREE.InstancedMesh(unitBox, mats.agedHinoki, DEBRIS_PER_POOL), // 0: splintered hinoki/cedar beams & planks
    new THREE.InstancedMesh(unitBox, mats.kawaraTile, DEBRIS_PER_POOL), // 1: shattered clay roof tiles
    new THREE.InstancedMesh(unitBox, mats.washiShoji, DEBRIS_PER_POOL), // 2: torn shoji paper & thatch reeds
  ];
  for (const inst of debrisPools) {
    inst.frustumCulled = false;
    inst.castShadow = false;
    inst.receiveShadow = false;
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dynGroup.add(inst);
  }

  const debrisList: DebrisPiece[] = [];
  let debrisCursor = 0;
  for (let i = 0; i < DEBRIS_PER_POOL * 3; i++) {
    debrisList.push({
      active: false,
      pool: (i % 3) as 0 | 1 | 2,
      px: 0,
      py: -50,
      pz: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      rx: 0,
      ry: 0,
      rz: 0,
      vrx: 0,
      vry: 0,
      vrz: 0,
      sx: 0.1,
      sy: 0.1,
      sz: 0.1,
      life: 0,
      maxLife: 1,
    });
  }

  let debrisSeed = 1337;
  const nextRand = () => {
    debrisSeed = (Math.imul(debrisSeed, 1664525) + 1013904223) | 0;
    return ((debrisSeed >>> 0) % 10000) / 10000;
  };

  function spawnDebrisBurst(
    cx: number,
    cy: number,
    cz: number,
    spreadX: number,
    spreadY: number,
    spreadZ: number,
    count: number,
    kind: DestructibleBuilding['kind'],
    impulseDir?: { x: number; y: number; z: number } | null
  ) {
    const ix = impulseDir?.x ?? 0;
    const iy = impulseDir?.y ?? 0.25;
    const iz = impulseDir?.z ?? 0;

    for (let i = 0; i < count; i++) {
      const slot = debrisList[debrisCursor % debrisList.length];
      debrisCursor++;

      let pool: 0 | 1 | 2 = 0;
      const r = nextRand();
      if (kind === 'shoji_wall') {
        pool = r < 0.55 ? 2 : 0;
      } else if (kind === 'pavilion') {
        pool = r < 0.45 ? 0 : r < 0.78 ? 2 : 1;
      } else if (kind === 'watchtower') {
        pool = r < 0.72 ? 0 : 1;
      } else {
        pool = r < 0.8 ? 0 : 1;
      }

      slot.active = true;
      slot.pool = pool;
      slot.px = cx + (nextRand() - 0.5) * spreadX;
      slot.py = Math.max(0.2, cy + (nextRand() - 0.5) * spreadY);
      slot.pz = cz + (nextRand() - 0.5) * spreadZ;

      const outX = (nextRand() - 0.5) * 9.5 + ix * 8.5;
      const outY = 3.2 + nextRand() * 6.8 + Math.max(0, iy) * 4.0;
      const outZ = (nextRand() - 0.5) * 9.5 + iz * 8.5;
      slot.vx = outX;
      slot.vy = outY;
      slot.vz = outZ;

      slot.rx = nextRand() * 6.28;
      slot.ry = nextRand() * 6.28;
      slot.rz = nextRand() * 6.28;
      slot.vrx = (nextRand() - 0.5) * 14;
      slot.vry = (nextRand() - 0.5) * 14;
      slot.vrz = (nextRand() - 0.5) * 14;

      if (pool === 0) {
        // Long splintered timber plank or beam!
        slot.sx = 0.10 + nextRand() * 0.10;
        slot.sy = 0.08 + nextRand() * 0.08;
        slot.sz = 0.65 + nextRand() * 0.95;
      } else if (pool === 1) {
        // Smoked clay roof tile shard
        slot.sx = 0.26 + nextRand() * 0.18;
        slot.sy = 0.05 + nextRand() * 0.04;
        slot.sz = 0.28 + nextRand() * 0.18;
      } else {
        // Fluttering torn shoji paper / reed bundle
        slot.sx = 0.24 + nextRand() * 0.24;
        slot.sy = 0.02 + nextRand() * 0.03;
        slot.sz = 0.30 + nextRand() * 0.26;
      }

      slot.maxLife = 1.6 + nextRand() * 1.4;
      slot.life = slot.maxLife;
    }

    // Emit engine dust/wood impact puff + flash if available
    try {
      if (G.events) {
        G.events.emit('impact', {
          point: new THREE.Vector3(cx, cy, cz),
          normal: new THREE.Vector3(0, 1, 0),
          dist: 2,
          surface: 'wood',
          dir: new THREE.Vector3(ix || 0, -0.4, iz || 1).normalize(),
          from: 'player',
        });
      }
      if (G.render?.lightPool?.flash) {
        G.render.lightPool.flash(new THREE.Vector3(cx, cy + 0.6, cz), 0xffb86c, 9, 6.5, 0.16);
      }
    } catch {
      // ignore optional fx errors
    }
  }

  let physicsRebuildQueued = false;

  function damageDestructible(
    item: DestructibleBuilding,
    damage: number,
    hitPoint?: { x: number; y: number; z: number } | null,
    impulseDir?: { x: number; y: number; z: number } | null
  ): { destroyed: boolean; damaged: boolean; label: string } {
    if (!item || !item.state || item.state.stage === 'destroyed' || damage <= 0) {
      return { destroyed: false, damaged: false, label: item?.label ?? '' };
    }
    const res = stepDestructibleStructure(item.state, damage);
    item.state = res.next;

    const sx = item.max.x - item.min.x;
    const sy = item.max.y - item.min.y;
    const sz = item.max.z - item.min.z;
    const hx = hitPoint ? hitPoint.x : item.center.x;
    const hy = hitPoint ? hitPoint.y : item.center.y;
    const hz = hitPoint ? hitPoint.z : item.center.z;

    if (res.becameDestroyed) {
      item.intactGroup.visible = false;
      item.damagedGroup.visible = false;
      item.ruinGroup.visible = true;
      for (const col of item.colliders) {
        if (col && G.physics?.removeBox) {
          G.physics.removeBox(col);
        }
      }
      item.colliders.length = 0;
      physicsRebuildQueued = true;

      spawnDebrisBurst(
        item.center.x,
        item.center.y,
        item.center.z,
        sx * 0.85,
        sy * 0.75,
        sz * 0.85,
        res.debrisCount + 8,
        item.kind,
        impulseDir
      );
      return { destroyed: true, damaged: false, label: item.label };
    }

    if (res.becameDamaged) {
      item.intactGroup.visible = false;
      item.damagedGroup.visible = true;
      spawnDebrisBurst(hx, hy, hz, sx * 0.45, sy * 0.45, sz * 0.45, res.debrisCount + 3, item.kind, impulseDir);
      return { destroyed: false, damaged: true, label: item.label };
    }

    spawnDebrisBurst(hx, hy, hz, 0.5, 0.5, 0.5, res.debrisCount, item.kind, impulseDir);
    return { destroyed: false, damaged: false, label: item.label };
  }

  function raycastDestructible(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist = 120
  ): { item: DestructibleBuilding; dist: number; point: any; normal: any } | null {
    let best: DestructibleBuilding | null = null;
    let bestDist = maxDist;
    let bestAxis = 0;
    let bestSign = 1;

    const invX = dir.x === 0 ? 1e9 : 1 / dir.x;
    const invY = dir.y === 0 ? 1e9 : 1 / dir.y;
    const invZ = dir.z === 0 ? 1e9 : 1 / dir.z;

    for (let i = 0; i < destructibles.length; i++) {
      const d = destructibles[i];
      if (d.state.stage === 'destroyed') continue;

      let tmin = 0;
      let tmax = bestDist;
      let hitAxis = -1;
      let hitSign = 1;

      // X slab
      let t1 = (d.min.x - origin.x) * invX;
      let t2 = (d.max.x - origin.x) * invX;
      let sgn = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        sgn = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        hitAxis = 0;
        hitSign = sgn;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;

      // Y slab
      t1 = (d.min.y - origin.y) * invY;
      t2 = (d.max.y - origin.y) * invY;
      sgn = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        sgn = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        hitAxis = 1;
        hitSign = sgn;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;

      // Z slab
      t1 = (d.min.z - origin.z) * invZ;
      t2 = (d.max.z - origin.z) * invZ;
      sgn = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        sgn = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        hitAxis = 2;
        hitSign = sgn;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;

      if (tmin >= 0 && tmin < bestDist) {
        bestDist = tmin;
        best = d;
        bestAxis = hitAxis >= 0 ? hitAxis : 0;
        bestSign = hitSign;
      }
    }

    if (!best) return null;
    const point = new THREE.Vector3(
      origin.x + dir.x * bestDist,
      origin.y + dir.y * bestDist,
      origin.z + dir.z * bestDist
    );
    const normal = new THREE.Vector3(
      bestAxis === 0 ? bestSign : 0,
      bestAxis === 1 ? bestSign : 0,
      bestAxis === 2 ? bestSign : 0
    );
    return { item: best, dist: bestDist, point, normal };
  }

  function damageInRadius(
    center: { x: number; y: number; z: number },
    radius: number,
    damage: number,
    impulseDir?: { x: number; y: number; z: number } | null
  ): number {
    let brokenCount = 0;
    const r2 = radius * radius;
    for (let i = 0; i < destructibles.length; i++) {
      const d = destructibles[i];
      if (d.state.stage === 'destroyed') continue;
      const cx = Math.max(d.min.x, Math.min(d.max.x, center.x));
      const cy = Math.max(d.min.y, Math.min(d.max.y, center.y));
      const cz = Math.max(d.min.z, Math.min(d.max.z, center.z));
      const dist2 =
        (center.x - cx) * (center.x - cx) +
        (center.y - cy) * (center.y - cy) +
        (center.z - cz) * (center.z - cz);
      if (dist2 <= r2) {
        const out = damageDestructible(d, damage, { x: cx, y: cy, z: cz }, impulseDir);
        if (out.destroyed) brokenCount++;
      }
    }
    return brokenCount;
  }

  // =========================================================================
  // DESTRUCTIBLE BUILDING CONSTRUCTORS
  // =========================================================================

  // A. Destructible Thatched Roadside Tea Pavilion (`可破坏 · 茅葺茶亭`, supports any terrace `baseY`)
  function createDestructibleTeaPavilion(
    id: string,
    label: string,
    px: number,
    pz: number,
    baseY = 0
  ) {
    const wrap = new THREE.Group();
    const intact = new THREE.Group();
    const damaged = new THREE.Group();
    const ruin = new THREE.Group();
    damaged.visible = false;
    ruin.visible = false;
    wrap.add(intact, damaged, ruin);
    dynGroup.add(wrap);

    placeBox(staticGroup, px, baseY + 0.16, pz, 4.2, 0.28, 4.2, mats.ishigakiStone, 'concrete');
    registerRoofOverhang(px, baseY + 2.75, pz, 4.7, 4.7, 1.9);

    const colliders: any[] = [];
    for (const ox of [-1.65, 1.65]) {
      for (const oz of [-1.65, 1.65]) {
        const p1 = makeMesh(unitBox, mats.agedHinoki);
        p1.position.set(px + ox, baseY + 1.55, pz + oz);
        p1.scale.set(0.24, 2.55, 0.24);
        intact.add(p1);

        const p2 = makeMesh(unitBox, mats.agedHinoki);
        p2.position.set(px + ox, baseY + 1.48, pz + oz);
        p2.scale.set(0.22, 2.4, 0.22);
        p2.rotation.z = ox * 0.03;
        damaged.add(p2);
      }
    }
    const backWall = makeMesh(unitBox, mats.washiShoji);
    backWall.position.set(px, baseY + 1.5, pz - 1.62);
    backWall.scale.set(3.2, 2.35, 0.14);
    const bench = makeMesh(unitBox, mats.vermilionLacquer);
    bench.position.set(px, baseY + 0.52, pz + 0.62);
    bench.scale.set(2.3, 0.44, 0.70);
    const roofI = buildGasshoThatchRoof(4.7, 4.7, 1.9);
    roofI.position.set(px, baseY + 2.75, pz);
    intact.add(backWall, bench, roofI);
    addHangingChochin(intact, px, baseY + 2.68, pz + 1.75, 0.9);

    const roofD = buildGasshoThatchRoof(4.6, 4.6, 1.8);
    roofD.position.set(px, baseY + 2.62, pz);
    roofD.rotation.set(0.06, 0, -0.08);
    const brokenScreen = makeMesh(unitBox, mats.yakisugiPlank);
    brokenScreen.position.set(px - 0.65, baseY + 1.05, pz - 1.62);
    brokenScreen.scale.set(1.5, 1.3, 0.14);
    brokenScreen.rotation.z = 0.14;
    damaged.add(roofD, brokenScreen, bench.clone());

    for (const [ox, oz] of [
      [-1.65, -1.65],
      [1.65, -1.65],
      [-1.65, 1.65],
      [1.65, 1.65],
    ]) {
      const stump = makeMesh(unitBox, mats.agedHinoki);
      stump.position.set(px + ox, baseY + 0.42, pz + oz);
      stump.scale.set(0.24, 0.35, 0.24);
      ruin.add(stump);
    }

    colliders.push(
      addBoxCollider(
        px - 1.75,
        baseY + 0.28,
        pz - 1.75,
        px + 1.75,
        baseY + 2.75,
        pz - 1.45,
        'wood',
        { tag: 'destruct-pavilion' }
      )
    );
    addRoofColliderSteps(
      px,
      baseY + 2.75,
      pz,
      makeThatchRoofSpec(4.7, 4.7, 1.9),
      0,
      'destruct-pavilion-roof',
      colliders
    );

    destructibles.push({
      id,
      label,
      kind: 'pavilion',
      state: { hp: 135, maxHp: 135, stage: 'intact' },
      center: new THREE.Vector3(px, baseY + 1.9, pz),
      min: new THREE.Vector3(px - 2.15, baseY + 0.28, pz - 2.15),
      max: new THREE.Vector3(px + 2.15, baseY + 4.3, pz + 2.15),
      intactGroup: intact,
      damagedGroup: damaged,
      ruinGroup: ruin,
      colliders,
    });
  }

  // B. Destructible Timber Guard Watchtower (`可破坏 · 木造望楼`, supports any terrace `baseY`)
  function createDestructibleWatchtower(
    id: string,
    label: string,
    wx: number,
    wz: number,
    baseY = 0
  ) {
    const wrap = new THREE.Group();
    const intact = new THREE.Group();
    const damaged = new THREE.Group();
    const ruin = new THREE.Group();
    damaged.visible = false;
    ruin.visible = false;
    wrap.add(intact, damaged, ruin);
    dynGroup.add(wrap);

    const buildTowerVisual = (target: any, tilt: number) => {
      const g = new THREE.Group();
      g.position.set(wx, baseY, wz);
      g.rotation.z = tilt;
      for (const ox of [-1.4, 1.4]) {
        for (const oz of [-1.4, 1.4]) {
          const leg = makeMesh(unitBox, mats.agedHinoki);
          leg.position.set(ox, 2.15, oz);
          leg.scale.set(0.26, 4.3, 0.26);
          g.add(leg);
        }
      }
      for (const sideZ of [-1.4, 1.4]) {
        const b1 = makeMesh(unitBox, mats.yakisugiPlank);
        b1.position.set(0, 1.6, sideZ);
        b1.scale.set(3.1, 0.14, 0.14);
        b1.rotation.z = 0.62;
        g.add(b1);
      }
      const deck = makeMesh(unitBox, mats.agedHinoki);
      deck.position.set(0, 4.15, 0);
      deck.scale.set(3.4, 0.24, 3.4);
      g.add(deck);
      for (const [rx, rz, sx, sz] of [
        [0, 1.6, 3.4, 0.14],
        [0, -1.6, 3.4, 0.14],
        [1.6, 0, 0.14, 3.4],
        [-1.6, 0, 0.14, 3.4],
      ]) {
        const rail = makeMesh(unitBox, mats.yakisugiPlank);
        rail.position.set(rx, 4.65, rz);
        rail.scale.set(sx, 0.78, sz);
        g.add(rail);
      }
      const roof = buildKawaraRoof(4.0, 4.0, 1.15, false);
      roof.position.set(0, 6.25, 0);
      for (const ox of [-1.4, 1.4]) {
        for (const oz of [-1.4, 1.4]) {
          const post = makeMesh(unitBox, mats.agedHinoki);
          post.position.set(ox, 5.25, oz);
          post.scale.set(0.20, 2.0, 0.20);
          g.add(post);
        }
      }
      g.add(roof);
      target.add(g);
    };

    buildTowerVisual(intact, 0);
    addHangingChochin(intact, wx + 1.6, baseY + 6.15, wz + 1.6, 0.95);
    buildTowerVisual(damaged, 0.085);

    for (const [ox, oz] of [
      [-1.4, -1.4],
      [1.4, -1.4],
      [-1.4, 1.4],
      [1.4, 1.4],
    ]) {
      const st = makeMesh(unitBox, mats.agedHinoki);
      st.position.set(wx + ox, baseY + 0.32, wz + oz);
      st.scale.set(0.28, 0.64, 0.28);
      st.rotation.z = ox * 0.18;
      ruin.add(st);
    }

    const colliders = [
      addBoxCollider(wx - 1.62, baseY, wz - 1.62, wx - 1.18, baseY + 4.05, wz - 1.18, 'wood', {
        tag: 'destruct-tower-base',
      }),
      addBoxCollider(wx + 1.18, baseY, wz - 1.62, wx + 1.62, baseY + 4.05, wz - 1.18, 'wood', {
        tag: 'destruct-tower-base',
      }),
      addBoxCollider(wx - 1.62, baseY, wz + 1.18, wx - 1.18, baseY + 4.05, wz + 1.62, 'wood', {
        tag: 'destruct-tower-base',
      }),
      addBoxCollider(wx + 1.18, baseY, wz + 1.18, wx + 1.62, baseY + 4.05, wz + 1.62, 'wood', {
        tag: 'destruct-tower-base',
      }),
      addBoxCollider(wx - 1.75, baseY + 4.02, wz - 1.75, wx + 1.75, baseY + 4.28, wz + 1.75, 'wood', {
        noNav: true,
        tag: 'destruct-tower-deck',
      }),
    ];
    addRoofColliderSteps(
      wx,
      baseY + 6.25,
      wz,
      makeKawaraRoofSpec(4.0, 4.0, 1.15),
      0,
      'destruct-tower-roof',
      colliders
    );

    destructibles.push({
      id,
      label,
      kind: 'watchtower',
      state: { hp: 160, maxHp: 160, stage: 'intact' },
      center: new THREE.Vector3(wx, baseY + 2.6, wz),
      min: new THREE.Vector3(wx - 1.8, baseY, wz - 1.8),
      max: new THREE.Vector3(wx + 1.8, baseY + 6.4, wz + 1.8),
      intactGroup: intact,
      damagedGroup: damaged,
      ruinGroup: ruin,
      colliders,
    });
  }

  // C. Destructible Breachable Machiya Shoji/Plank Wall Bay (`可破坏 · 町家障子木格门墙`)
  function createDestructibleWallBay(
    id: string,
    label: string,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number
  ) {
    const wrap = new THREE.Group();
    const intact = new THREE.Group();
    const damaged = new THREE.Group();
    const ruin = new THREE.Group();
    damaged.visible = false;
    ruin.visible = false;
    wrap.add(intact, damaged, ruin);
    dynGroup.add(wrap);

    // Upper translucent shoji lattice + lower proud yakisugi wainscot (strictly disjoint in Y -> zero Z-fighting!)
    const panelI = makeMesh(unitBox, mats.washiShoji);
    panelI.position.set(cx, cy + sy * 0.17, cz);
    panelI.scale.set(sx, sy * 0.66, sz);
    const wainscot = makeMesh(unitBox, mats.yakisugiPlank);
    wainscot.position.set(cx, cy - sy * 0.33, cz);
    wainscot.scale.set(sx + 0.04, sy * 0.34, sz + 0.04);
    intact.add(panelI, wainscot);
    lanternGlowSources.push({ x: cx, y: cy, z: cz, radius: 4.2, strength: 0.34 });

    const halfL = makeMesh(unitBox, mats.yakisugiPlank);
    halfL.position.set(cx - sx * 0.3, cy - sy * 0.22, cz);
    halfL.scale.set(sx * 0.36, sy * 0.52, sz);
    halfL.rotation.z = 0.12;
    const halfR = makeMesh(unitBox, mats.washiShoji);
    halfR.position.set(cx + sx * 0.3, cy + sy * 0.18, cz);
    halfR.scale.set(sx * 0.34, sy * 0.56, sz);
    halfR.rotation.z = -0.10;
    damaged.add(halfL, halfR);

    const lintel = makeMesh(unitBox, mats.agedHinoki);
    lintel.position.set(cx, cy + sy * 0.46, cz);
    lintel.scale.set(sx, 0.14, sz * 1.1);
    ruin.add(lintel);

    const col = addBoxCollider(
      cx - sx * 0.5,
      cy - sy * 0.5,
      cz - sz * 0.5,
      cx + sx * 0.5,
      cy + sy * 0.5,
      cz + sz * 0.5,
      'wood',
      { tag: 'destruct-shoji-wall' }
    );

    destructibles.push({
      id,
      label,
      kind: 'shoji_wall',
      state: { hp: 70, maxHp: 70, stage: 'intact' },
      center: new THREE.Vector3(cx, cy, cz),
      min: new THREE.Vector3(cx - sx * 0.5, cy - sy * 0.5, cz - sz * 0.5 - 0.18),
      max: new THREE.Vector3(cx + sx * 0.5, cy + sy * 0.5, cz + sz * 0.5 + 0.18),
      intactGroup: intact,
      damagedGroup: damaged,
      ruinGroup: ruin,
      colliders: [col],
    });
  }

  // D. Destructible Village Palisade / Sake Barrel & Timber Cart Cover (`可破坏 · 竹木楯墙与酒樽车`)
  function createDestructiblePalisade(
    id: string,
    label: string,
    cx: number,
    cz: number,
    rotY: number,
    isBarrelStack = false,
    baseY = 0
  ) {
    const wrap = new THREE.Group();
    const intact = new THREE.Group();
    const damaged = new THREE.Group();
    const ruin = new THREE.Group();
    damaged.visible = false;
    ruin.visible = false;
    wrap.add(intact, damaged, ruin);
    dynGroup.add(wrap);

    const gI = new THREE.Group();
    gI.position.set(cx, baseY, cz);
    gI.rotation.y = rotY;
    const gD = new THREE.Group();
    gD.position.set(cx, baseY, cz);
    gD.rotation.y = rotY;

    if (isBarrelStack) {
      const bed = makeMesh(unitBox, mats.agedHinoki);
      bed.position.set(0, 0.35, 0);
      bed.scale.set(2.4, 0.16, 1.3);
      gI.add(bed);
      gD.add(bed.clone());
      for (const bx of [-0.65, 0, 0.65]) {
        const b1 = makeMesh(cyl12, mats.agedHinoki);
        b1.position.set(bx, 0.82, 0);
        b1.scale.set(0.60, 0.78, 0.60);
        gI.add(b1);
        if (bx <= 0) gD.add(b1.clone());
      }
      const topBarrel = makeMesh(cyl12, mats.yakisugiPlank);
      topBarrel.position.set(0, 1.48, 0);
      topBarrel.scale.set(0.58, 0.76, 0.58);
      topBarrel.rotation.z = Math.PI / 2;
      gI.add(topBarrel);
    } else {
      const baseBeam = makeMesh(unitBox, mats.agedHinoki);
      baseBeam.position.set(0, 0.16, 0);
      baseBeam.scale.set(3.0, 0.32, 0.54);
      const planks = makeMesh(unitBox, mats.yakisugiPlank);
      planks.position.set(0, 0.96, 0);
      planks.scale.set(2.9, 1.35, 0.24);
      planks.rotation.x = -0.10;
      const bambooRow = makeMesh(unitBox, mats.bambooCulm);
      bambooRow.position.set(0, 1.66, -0.05);
      bambooRow.scale.set(2.95, 0.24, 0.28);
      gI.add(baseBeam, planks, bambooRow);

      const planksHalf = makeMesh(unitBox, mats.yakisugiPlank);
      planksHalf.position.set(-0.52, 0.78, 0);
      planksHalf.scale.set(1.7, 0.95, 0.24);
      planksHalf.rotation.z = 0.16;
      gD.add(baseBeam.clone(), planksHalf);
    }

    intact.add(gI);
    damaged.add(gD);

    const rubble = makeMesh(unitBox, mats.agedHinoki);
    rubble.position.set(cx, baseY + 0.08, cz);
    rubble.scale.set(1.4, 0.12, 0.65);
    rubble.rotation.y = rotY + 0.3;
    ruin.add(rubble);

    const alongX = Math.abs(Math.cos(rotY)) > 0.7;
    const hx = alongX ? 1.48 : 0.52;
    const hz = alongX ? 0.52 : 1.48;
    const col = addBoxCollider(cx - hx, baseY, cz - hz, cx + hx, baseY + 1.68, cz + hz, 'wood', {
      tag: 'destruct-palisade',
    });

    destructibles.push({
      id,
      label,
      kind: isBarrelStack ? 'barrels' : 'palisade',
      state: { hp: 80, maxHp: 80, stage: 'intact' },
      center: new THREE.Vector3(cx, baseY + 0.95, cz),
      min: new THREE.Vector3(cx - hx - 0.15, baseY, cz - hz - 0.15),
      max: new THREE.Vector3(cx + hx + 0.15, baseY + 1.78, cz + hz + 0.15),
      intactGroup: intact,
      damagedGroup: damaged,
      ruinGroup: ruin,
      colliders: [col],
    });
  }

  // =========================================================================
  // REUSABLE VERTICAL CASTLE-TOWN ARCHITECTURAL HELPERS (`石段 · 提灯连绳 · 空中渡廊 · 多重楼阁`)
  // =========================================================================
  // Walkable Granite Staircase climbing smoothly along X or Z (`risePerStep <= 0.29m < 0.42m` step-up, zero overlap!)
  function buildGraniteStaircase(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    yLow: number,
    yHigh: number,
    width: number,
    withLanternPosts = true
  ) {
    const totalRise = yHigh - yLow;
    const steps = Math.max(2, Math.ceil(totalRise / 0.29));
    const alongX = Math.abs(endX - startX) >= Math.abs(endZ - startZ);
    const totalRun = alongX ? endX - startX : endZ - startZ;
    const stepPitch = Math.abs(totalRun) / steps;
    const stepDepth = Math.max(0.26, stepPitch - 0.008);

    staircaseRecords.push({
      id: `stair_${Math.round(startX)}_${Math.round(startZ)}`,
      fromY: yLow,
      toY: yHigh,
      steps,
      width,
      stepRise: totalRise / steps,
      stepDepth: stepPitch,
    });

    for (let s = 0; s < steps; s++) {
      const tMid = (s + 0.5) / steps;
      const topY = yLow + ((s + 1) / steps) * totalRise;
      // Keep top step 1.2cm below terrace crest so even adjacent stone surfaces never share a plane
      const visTopY = s === steps - 1 ? topY - 0.012 : topY;
      const visBotY = yLow + 0.015;
      const visH = Math.max(0.12, visTopY - visBotY);
      const sx = alongX ? startX + totalRun * tMid : startX;
      const sz = alongX ? startZ : startZ + totalRun * tMid;

      const treadMesh = makeMesh(unitBox, mats.graniteSteps, true, true);
      treadMesh.position.set(sx, visBotY + visH * 0.5, sz);
      treadMesh.scale.set(alongX ? stepDepth : width, visH, alongX ? width : stepDepth);
      staticGroup.add(treadMesh);

      addBoxCollider(
        sx - (alongX ? stepPitch : width) * 0.5,
        yLow,
        sz - (alongX ? width : stepPitch) * 0.5,
        sx + (alongX ? stepPitch : width) * 0.5,
        topY,
        sz + (alongX ? width : stepPitch) * 0.5,
        'concrete',
        { tag: 'stone-stairs' }
      );
    }

    // Stepped stone cheek stringers (`石阶耳石`) + warm lantern posts at foot and crest (disjoint from tread width!)
    if (withLanternPosts) {
      for (const side of [-1, 1]) {
        const cheekOff = (width * 0.5 + 0.20) * side;
        for (let c = 0; c < 3; c++) {
          const ct = (c + 0.5) / 3;
          const segRun = Math.abs(totalRun) / 3 - 0.04;
          const segTop = yLow + ((c + 1) / 3) * totalRise + 0.34;
          const segBot = yLow + 0.02;
          const segH = segTop - segBot;
          const cx = alongX ? startX + totalRun * ct : startX + cheekOff;
          const cz = alongX ? startZ + cheekOff : startZ + totalRun * ct;
          placeBox(
            staticGroup,
            cx,
            segBot + segH * 0.5,
            cz,
            alongX ? segRun : 0.32,
            segH,
            alongX ? 0.32 : segRun,
            mats.ishigakiStone,
            'concrete',
            { noNav: true }
          );
        }
        const postOff = (width * 0.5 + 0.22) * side;
        const runSign = totalRun >= 0 ? 1 : -1;
        const px1 = alongX ? endX - runSign * 0.26 : endX + postOff;
        const pz1 = alongX ? endZ + postOff : endZ - runSign * 0.26;
        placeBox(staticGroup, px1, yHigh + 0.62, pz1, 0.38, 1.18, 0.38, mats.ishigakiStone, 'concrete', {
          noNav: true,
        });
        addHangingChochin(staticGroup, px1, yHigh + 1.38, pz1, 0.78);
      }
    }
  }

  // Overhead Festooned Chochin Lantern Garland spanning across the narrow Shukuba Street!
  function addStreetLanternGarland(gx: number, yAnchor = 5.45, zHalfSpan = 3.9) {
    const sagPts: any[] = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      const z = (u * 2 - 1) * zHalfSpan;
      const sag = Math.sin(u * Math.PI) * 0.58;
      sagPts.push(new THREE.Vector3(gx, yAnchor - sag, z));
    }
    const ropeGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sagPts), 14, 0.028, 5, false);
    const rope = makeMesh(ropeGeo, mats.yakisugiPlank, false, false);
    staticGroup.add(rope);

    for (const u of [0.22, 0.50, 0.78]) {
      const z = (u * 2 - 1) * zHalfSpan;
      const y = yAnchor - Math.sin(u * Math.PI) * 0.58;
      addHangingChochin(staticGroup, gx, y, z, u === 0.5 ? 1.08 : 0.88);
    }
  }

  // Walkable Covered Wooden Sky-Bridge (`木造空中渡廊`) crossing over the narrow street or gorge!
  function buildCoveredSkyBridge(
    cx: number,
    deckY: number,
    cz: number,
    spanX: number,
    spanZ: number,
    alongZ = true
  ) {
    // Heavy Hinoki floor deck + underneath support brackets (disjoint by 1.5cm)
    placeBox(staticGroup, cx, deckY - 0.14, cz, spanX, 0.28, spanZ, mats.bridgePlank, 'wood', {
      tag: 'sky-bridge-deck',
    });
    const beamB = makeMesh(unitBox, mats.agedHinoki);
    beamB.position.set(cx, deckY - 0.40, cz);
    beamB.scale.set(spanX * 0.94, 0.21, spanZ * 0.94);
    staticGroup.add(beamB);

    // Vermilion & Hinoki waist balustrades along the two open sides (inset rail vs proud posts -> zero coplanarity!)
    if (alongZ) {
      for (const sideX of [-spanX * 0.5 + 0.15, spanX * 0.5 - 0.15]) {
        placeBox(
          staticGroup,
          cx + sideX,
          deckY + 0.53,
          cz,
          0.14,
          1.00,
          spanZ - 0.34,
          mats.vermilionLacquer,
          'wood',
          { noNav: true, tag: 'sky-bridge-rail' }
        );
        for (const oz of [-spanZ * 0.38, 0, spanZ * 0.38]) {
          placeBox(
            staticGroup,
            cx + sideX,
            deckY + 1.49,
            cz + oz,
            0.24,
            2.92,
            0.24,
            mats.agedHinoki,
            'wood',
            { noNav: true }
          );
        }
      }
    } else {
      for (const sideZ of [-spanZ * 0.5 + 0.15, spanZ * 0.5 - 0.15]) {
        placeBox(
          staticGroup,
          cx,
          deckY + 0.53,
          cz + sideZ,
          spanX - 0.34,
          1.00,
          0.14,
          mats.vermilionLacquer,
          'wood',
          { noNav: true, tag: 'sky-bridge-rail' }
        );
        for (const ox of [-spanX * 0.38, 0, spanX * 0.38]) {
          placeBox(
            staticGroup,
            cx + ox,
            deckY + 1.49,
            cz + sideZ,
            0.24,
            2.92,
            0.24,
            mats.agedHinoki,
            'wood',
            { noNav: true }
          );
        }
      }
    }

    const roofW = spanX + 1.25;
    const roofD = spanZ + 1.25;
    const roof = buildKawaraRoof(roofW, roofD, 1.35, false);
    roof.position.set(cx, deckY + 2.96, cz);
    staticGroup.add(roof);
    registerRoofOverhang(cx, deckY + 2.96, cz, roofW, roofD, 1.35);
    addRoofColliderSteps(cx, deckY + 2.96, cz, makeKawaraRoofSpec(roofW, roofD, 1.35), 0, 'sky-bridge-roof');
    addHangingChochin(staticGroup, cx, deckY + 2.75, cz, 0.95);
  }

  // Ornate Giant Boss Challenge Bell Shrine (`荒神讨伐钟楼` — glowing bronze Bonsho bell!)
  function buildBossChallengeBellShrine(bx: number, baseY: number, bz: number, scale = 1.0) {
    const g = new THREE.Group();
    g.position.set(bx, baseY, bz);

    placeBox(
      staticGroup,
      bx,
      baseY + 0.23 * scale,
      bz,
      3.8 * scale,
      0.42 * scale,
      3.8 * scale,
      mats.graniteSteps,
      'concrete'
    );
    for (const ox of [-1.35 * scale, 1.35 * scale]) {
      for (const oz of [-1.35 * scale, 1.35 * scale]) {
        placeBox(
          staticGroup,
          bx + ox,
          baseY + 1.98 * scale,
          bz + oz,
          0.28 * scale,
          3.04 * scale,
          0.28 * scale,
          mats.vermilionLacquer,
          'wood'
        );
      }
    }
    const bell = makeMesh(cyl12, mats.bronzeAged);
    bell.position.set(0, 2.15 * scale, 0);
    bell.scale.set(0.95 * scale, 1.38 * scale, 0.95 * scale);
    const bellRim = makeMesh(
      new THREE.TorusGeometry(0.50 * scale, 0.06 * scale, 8, 20).rotateX(Math.PI / 2),
      mats.bronzeAged
    );
    bellRim.position.set(0, 1.48 * scale, 0);
    const strikerBeam = makeMesh(cyl8, mats.agedHinoki);
    strikerBeam.rotation.z = Math.PI / 2;
    strikerBeam.position.set(1.15 * scale, 2.05 * scale, 0);
    strikerBeam.scale.set(0.18 * scale, 1.45 * scale, 0.18 * scale);
    g.add(bell, bellRim, strikerBeam);
    staticGroup.add(g);

    const bRoof = buildKawaraRoof(4.6 * scale, 4.6 * scale, 1.45 * scale, true);
    bRoof.position.set(bx, baseY + 3.52 * scale, bz);
    staticGroup.add(bRoof);
    registerRoofOverhang(bx, baseY + 3.52 * scale, bz, 4.6 * scale, 4.6 * scale, 1.45 * scale);
    addRoofColliderSteps(
      bx,
      baseY + 3.52 * scale,
      bz,
      makeKawaraRoofSpec(4.6 * scale, 4.6 * scale, 1.45 * scale),
      0,
      'boss-bell-roof'
    );
    addHangingChochin(staticGroup, bx - 1.5 * scale, baseY + 3.35 * scale, bz + 1.5 * scale, 1.0);
    addHangingChochin(staticGroup, bx + 1.5 * scale, baseY + 3.35 * scale, bz + 1.5 * scale, 1.0);
  }

  // =========================================================================
  // HANAMURA MOUNTAIN CASTLE (`花村山城`) 3-STAGE CLASSICAL ARENA ARCHITECTURE
  // Zero blind stone pits/trenches & ZERO coplanar Z-fighting faces!
  // =========================================================================

  // Reusable Kyoto Machiya / Shop Pavilion Builder (disjoint plinths, proud window frames, shop hisashi awning & 2F deck)
  function buildHanamuraPavilion(opts: {
    id: string;
    cx: number;
    cz: number;
    baseY?: number;
    wX: number;
    dZ: number;
    facesZ: 1 | -1;
    stories?: 1 | 2 | 3;
    crimsonTheme?: boolean;
    withBalcony?: boolean;
  }) {
    const baseY = opts.baseY ?? 0;
    const stories = opts.stories ?? 2;
    const fz = opts.facesZ;
    const halfW = opts.wX * 0.5;
    const halfD = opts.dZ * 0.5;

    // Ground stone plinth (lifted +2cm off baseY -> y in [baseY+0.02, baseY+0.36])
    placeBox(
      staticGroup,
      opts.cx,
      baseY + 0.19,
      opts.cz,
      opts.wX + 0.5,
      0.34,
      opts.dZ + 0.5,
      mats.ishigakiStone,
      'concrete'
    );

    // Ground floor left & right Yakisugi timber wings (y in [baseY+0.37, baseY+2.93])
    const wingW = Math.max(2.4, (opts.wX - 3.80) * 0.5);
    placeBox(
      staticGroup,
      opts.cx - halfW + wingW * 0.5,
      baseY + 1.65,
      opts.cz,
      wingW,
      2.56,
      opts.dZ,
      mats.yakisugiPlank,
      'wood'
    );
    placeBox(
      staticGroup,
      opts.cx + halfW - wingW * 0.5,
      baseY + 1.65,
      opts.cz,
      wingW,
      2.56,
      opts.dZ,
      mats.yakisugiPlank,
      'wood'
    );
    // Solid rear wall strictly inside the 3.80m doorway gap & inset 6cm from rear face (zero coplanarity!)
    placeBox(
      staticGroup,
      opts.cx,
      baseY + 1.65,
      opts.cz - fz * (halfD - 0.38),
      3.72,
      2.56,
      0.64,
      mats.shikkuiPlaster,
      'wood'
    );

    // Shop entrance timber posts + overhanging *hisashi* shop pent-awning (`庇`) over the Noren curtain!
    for (const dx of [-1.86, 1.86]) {
      const post = makeMesh(unitBox, mats.agedHinoki);
      post.position.set(opts.cx + dx, baseY + 1.65, opts.cz + fz * (halfD + 0.10));
      post.scale.set(0.20, 2.54, 0.20);
      staticGroup.add(post);
    }
    const hisashi = makeMesh(unitBox, mats.kawaraTile);
    hisashi.position.set(opts.cx, baseY + 2.82, opts.cz + fz * (halfD + 0.42));
    hisashi.scale.set(4.55, 0.11, 0.88);
    hisashi.rotation.x = fz * 0.18;
    staticGroup.add(hisashi);

    // Warm shop Noren curtain + framed glowing Shoji lattice windows (strictly proud of halfD!)
    const norenMat = opts.crimsonTheme ? mats.vermilionLacquer : mats.norenIndigo;
    const noren = makeMesh(new THREE.PlaneGeometry(3.45, 0.94), norenMat, false, true);
    noren.position.set(opts.cx, baseY + 2.34, opts.cz + fz * (halfD + 0.22));
    if (fz < 0) noren.rotation.y = Math.PI;
    staticGroup.add(noren);

    for (const sideSgn of [-1, 1]) {
      const winX = opts.cx + sideSgn * (halfW - wingW * 0.5);
      const winW = wingW * 0.66;
      const shojiGlow = makeMesh(unitBox, mats.washiShoji);
      shojiGlow.position.set(winX, baseY + 1.68, opts.cz + fz * (halfD + 0.08));
      shojiGlow.scale.set(winW, 1.48, 0.08);
      // Proud hinoki top & sill window bars
      const sillT = makeMesh(unitBox, mats.agedHinoki);
      sillT.position.set(winX, baseY + 2.46, opts.cz + fz * (halfD + 0.10));
      sillT.scale.set(winW + 0.18, 0.08, 0.14);
      const sillB = makeMesh(unitBox, mats.agedHinoki);
      sillB.position.set(winX, baseY + 0.90, opts.cz + fz * (halfD + 0.10));
      sillB.scale.set(winW + 0.18, 0.09, 0.16);
      staticGroup.add(shojiGlow, sillT, sillB);
      lanternGlowSources.push({
        x: winX,
        y: baseY + 1.68,
        z: opts.cz + fz * (halfD + 0.25),
        radius: 4.2,
        strength: 0.36,
      });
    }

    addHangingChochin(staticGroup, opts.cx - 2.3, baseY + 2.74, opts.cz + fz * (halfD + 0.72), 1.0);
    addHangingChochin(staticGroup, opts.cx + 2.3, baseY + 2.74, opts.cz + fz * (halfD + 0.72), 1.0);

    createDestructibleWallBay(
      `${opts.id}_shoji`,
      '花村商铺障子门',
      opts.cx,
      baseY + 1.62,
      opts.cz + fz * (halfD - 0.12),
      3.56,
      2.48,
      0.20
    );

    if (stories === 1) {
      const roof1 = buildKawaraRoof(opts.wX + 1.8, opts.dZ + 1.8, 1.85, true);
      roof1.position.set(opts.cx, baseY + 2.96, opts.cz);
      staticGroup.add(roof1);
      registerRoofOverhang(opts.cx, baseY + 2.96, opts.cz, opts.wX + 1.8, opts.dZ + 1.8, 1.85);
      addRoofColliderSteps(
        opts.cx,
        baseY + 2.96,
        opts.cz,
        makeKawaraRoofSpec(opts.wX + 1.8, opts.dZ + 1.8, 1.85),
        0,
        'pavilion-roof-1'
      );
      return;
    }

    // Walkable 2nd-Story Veranda Deck (`y in [baseY+2.94, baseY+3.20]`) overhanging the plaza by 2.4m!
    const balcExtra = opts.withBalcony !== false ? 2.4 : 0.4;
    const deckDepth = opts.dZ + balcExtra;
    const deckCenterZ = opts.cz + fz * (balcExtra * 0.5);
    placeBox(
      staticGroup,
      opts.cx,
      baseY + 3.07,
      deckCenterZ,
      opts.wX + 0.8,
      0.26,
      deckDepth,
      mats.agedHinoki,
      'wood',
      { tag: 'hanamura-2f-deck' }
    );
    if (opts.withBalcony !== false) {
      const railZ = opts.cz + fz * (halfD + balcExtra - 0.12);
      placeBox(
        staticGroup,
        opts.cx,
        baseY + 3.63,
        railZ,
        opts.wX + 0.6,
        0.82,
        0.16,
        opts.crimsonTheme ? mats.vermilionLacquer : mats.agedHinoki,
        'wood',
        { noNav: true }
      );
    }

    // 2nd-Story Shikkui White Plaster & Proud Glowing Lattice Body (`y in [baseY+3.22, baseY+5.82]`)
    placeBox(
      staticGroup,
      opts.cx,
      baseY + 4.52,
      opts.cz,
      opts.wX - 0.6,
      2.60,
      opts.dZ - 0.6,
      mats.shikkuiPlaster,
      'wood',
      { noNav: true }
    );
    const shoji2 = makeMesh(unitBox, mats.washiShoji);
    shoji2.position.set(opts.cx, baseY + 4.58, opts.cz + fz * (halfD - 0.21));
    shoji2.scale.set(opts.wX * 0.58, 1.38, 0.10);
    const shoji2Lintel = makeMesh(unitBox, mats.agedHinoki);
    shoji2Lintel.position.set(opts.cx, baseY + 5.32, opts.cz + fz * (halfD - 0.19));
    shoji2Lintel.scale.set(opts.wX * 0.62, 0.08, 0.15);
    staticGroup.add(shoji2, shoji2Lintel);

    const roof2 = buildKawaraRoof(opts.wX + 1.8, opts.dZ + 1.6, 1.95, stories === 2);
    roof2.position.set(opts.cx, baseY + 5.85, opts.cz);
    staticGroup.add(roof2);
    registerRoofOverhang(opts.cx, baseY + 5.85, opts.cz, opts.wX + 1.8, opts.dZ + 1.6, 1.95);
    addRoofColliderSteps(
      opts.cx,
      baseY + 5.85,
      opts.cz,
      makeKawaraRoofSpec(opts.wX + 1.8, opts.dZ + 1.6, 1.95),
      0,
      'hanamura-roof-2'
    );

    if (stories === 3) {
      placeBox(
        staticGroup,
        opts.cx,
        baseY + 7.65,
        opts.cz,
        opts.wX * 0.66,
        2.30,
        opts.dZ * 0.68,
        opts.crimsonTheme ? mats.vermilionLacquer : mats.yakisugiPlank,
        'wood',
        { noNav: true }
      );
      const shoji3 = makeMesh(unitBox, mats.washiShoji);
      shoji3.position.set(opts.cx, baseY + 7.72, opts.cz + fz * (opts.dZ * 0.34 + 0.08));
      shoji3.scale.set(opts.wX * 0.42, 1.24, 0.09);
      staticGroup.add(shoji3);
      const roof3 = buildKawaraRoof(opts.wX * 0.80, opts.dZ * 0.82, 1.85, true);
      roof3.position.set(opts.cx, baseY + 8.85, opts.cz);
      staticGroup.add(roof3);
      registerRoofOverhang(opts.cx, baseY + 8.85, opts.cz, opts.wX * 0.80, opts.dZ * 0.82, 1.85);
      addRoofColliderSteps(
        opts.cx,
        baseY + 8.85,
        opts.cz,
        makeKawaraRoofSpec(opts.wX * 0.80, opts.dZ * 0.82, 1.85),
        0,
        'hanamura-roof-3'
      );
    }
  }

  // Helper: Vermilion Myojin Torii Gate (`朱漆明神鸟居`)
  function placeToriiGate(tx: number, baseY: number, tz: number, rotY: number, scale = 1.0) {
    const g = new THREE.Group();
    g.position.set(tx, baseY, tz);
    g.rotation.y = rotY;
    for (const sx of [-2.2 * scale, 2.2 * scale]) {
      const ped = makeMesh(cyl8, mats.graniteSteps);
      ped.position.set(sx, 0.26 * scale, 0);
      ped.scale.set(0.68 * scale, 0.48 * scale, 0.68 * scale);
      const col = makeMesh(cyl12, mats.vermilionLacquer);
      col.position.set(sx, 2.52 * scale, 0);
      col.scale.set(0.36 * scale, 4.46 * scale, 0.36 * scale);
      g.add(ped, col);

      const wx = tx + Math.cos(rotY) * sx;
      const wz = tz - Math.sin(rotY) * sx;
      addBoxCollider(
        wx - 0.35 * scale,
        baseY,
        wz - 0.35 * scale,
        wx + 0.35 * scale,
        baseY + 4.7 * scale,
        wz + 0.35 * scale,
        'wood'
      );
    }
    const nuki = makeMesh(unitBox, mats.vermilionLacquer);
    nuki.position.set(0, 3.82 * scale, 0);
    nuki.scale.set(5.8 * scale, 0.28 * scale, 0.30 * scale);
    const kasagi = makeMesh(unitBox, mats.vermilionLacquer);
    kasagi.position.set(0, 4.64 * scale, 0);
    kasagi.scale.set(6.8 * scale, 0.32 * scale, 0.54 * scale);
    const cap = makeMesh(unitBox, mats.yakisugiPlank);
    cap.position.set(0, 4.89 * scale, 0);
    cap.scale.set(7.1 * scale, 0.15 * scale, 0.64 * scale);
    g.add(nuki, kasagi, cap);
    staticGroup.add(g);
  }

  // =========================================================================
  // STAGE 1 (`x = -72..-28, y = 0.0m`) — WEST HANAMURA ARCADE & RIKIMARU RAMEN PLAZA
  // Flagstone paving is rendered directly by `G.ground.apron` (`applyClassicalVillageGround`) — ZERO ground Z-fighting!
  // =========================================================================
  {
    // West Attacker Spawn Gatehouse (`西侧花村总门`, `x = -70.9, z = 0`, disjoint from west wall at x <= -71.8)
    for (const sz of [-5.2, 5.2]) {
      placeBox(staticGroup, -70.9, 0.46, sz, 1.36, 0.88, 1.36, mats.ishigakiStone, 'concrete');
      placeBox(staticGroup, -70.9, 3.36, sz, 0.72, 4.90, 0.72, mats.agedHinoki, 'wood');
      addHangingChochin(staticGroup, -69.9, 4.8, sz * 0.76, 1.18);
    }
    placeBox(staticGroup, -70.9, 5.88, 0, 1.0, 0.68, 13.2, mats.agedHinoki, 'wood', { noNav: true });
    const westGateRoof = buildKawaraRoof(3.2, 14.6, 1.45, true);
    westGateRoof.position.set(-70.9, 6.24, 0);
    staticGroup.add(westGateRoof);
    registerRoofOverhang(-70.9, 6.24, 0, 3.2, 14.6, 1.45);
    addRoofColliderSteps(-70.9, 6.24, 0, makeKawaraRoofSpec(3.2, 14.6, 1.45), 0, 'west-gate-roof');

    // NORTH WEST: Iconic Rikimaru Ramen Shop (`力丸拉面本铺`) & Tea Store
    buildHanamuraPavilion({
      id: 'ramen_shop',
      cx: -55.0,
      cz: -21.5,
      wX: 14.4,
      dZ: 9.2,
      facesZ: 1,
      stories: 2,
      crimsonTheme: true,
      withBalcony: true,
    });
    buildHanamuraPavilion({
      id: 'north_kura_west',
      cx: -55.0,
      cz: -39.5,
      wX: 15.0,
      dZ: 10.5,
      facesZ: 1,
      stories: 3,
      crimsonTheme: false,
      withBalcony: false,
    });

    // SOUTH WEST: Iconic Hanamura Arcade Pavilion (`花村电玩游艺茶屋`) & Ryokan
    buildHanamuraPavilion({
      id: 'hanamura_arcade',
      cx: -55.0,
      cz: 21.5,
      wX: 14.4,
      dZ: 9.2,
      facesZ: -1,
      stories: 3,
      crimsonTheme: true,
      withBalcony: true,
    });
    buildHanamuraPavilion({
      id: 'south_ryokan_west',
      cx: -55.0,
      cz: 39.0,
      wX: 14.4,
      dZ: 9.6,
      facesZ: -1,
      stories: 2,
      crimsonTheme: false,
      withBalcony: false,
    });

    // Walkable High-Ground Promenade Decks (`y = 3.2m`, x in [-47.35, -31.15] — exact abutment between [-62.6,-47.4] & [-31.1,-24.9]!)
    placeBox(staticGroup, -39.25, 3.07, -16.8, 16.2, 0.26, 7.6, mats.agedHinoki, 'wood', {
      tag: 'west-north-2f-link',
    });
    placeBox(staticGroup, -39.25, 3.07, 16.8, 16.2, 0.26, 7.6, mats.agedHinoki, 'wood', {
      tag: 'west-south-2f-link',
    });

    // Wide Exterior Staircases (`width = 4.4m`, `y = 0 -> 3.2m`)
    buildGraniteStaircase(-45.5, -8.2, -45.5, -13.0, 0.0, 3.2, 4.4, true);
    buildGraniteStaircase(-45.5, 8.2, -45.5, 13.0, 0.0, 3.2, 4.4, true);

    // Overhead Lantern Garlands welcoming players toward the Hanamura Choke Gate
    addStreetLanternGarland(-61.0, 6.2, 8.5);
    addStreetLanternGarland(-43.0, 6.2, 8.5);
  }

  // =========================================================================
  // THE ICONIC HANAMURA CHOKE GATE (`花村一之门 · 双层高台侧窗城门`, `x = -28.0`)
  // Stone piers stop at y = 2.91m beneath the 2.92..3.20m bridgePlank deck — ZERO coplanarity!
  // =========================================================================
  {
    const gx = -28.0;
    const GALLERY_Y = 3.2;

    for (const side of [-1, 1]) {
      // Inner gate pier (`z = +-5.6..+-27.6`, `y in [0.02, 2.91]`)
      placeBox(
        staticGroup,
        gx,
        1.465,
        side * 16.6,
        5.6,
        2.89,
        22.0,
        mats.ishigakiStone,
        'concrete',
        { tag: 'choke-gate-bastion' }
      );
      // Outer gate wall beyond the `6.0m` ground flank doorway (`z = +-33.5..+-50.0`, `y in [0.02, 2.91]`)
      placeBox(
        staticGroup,
        gx,
        1.465,
        side * 41.75,
        5.2,
        2.89,
        16.4,
        mats.ishigakiStone,
        'concrete',
        { tag: 'choke-gate-outer' }
      );
      // Continuous walkable 2F Gallery Deck (`y in [2.92, 3.20]`, `z = +-5.6..+-49.0`) resting cleanly ON TOP of stone piers!
      placeBox(
        staticGroup,
        gx,
        GALLERY_Y - 0.14,
        side * 27.3,
        6.2,
        0.28,
        43.4,
        mats.bridgePlank,
        'wood',
        { tag: 'choke-window-gallery' }
      );

      // Framed Hanamura High-Ground Choke Window (`y in [3.22, 5.78]`, sx = 5.2 inset inside 5.56 lintel -> zero side Z-fighting!)
      placeBox(staticGroup, gx, GALLERY_Y + 1.30, side * 6.2, 5.2, 2.56, 0.9, mats.shikkuiPlaster, 'wood');
      placeBox(staticGroup, gx, GALLERY_Y + 1.30, side * 22.5, 5.2, 2.56, 7.2, mats.shikkuiPlaster, 'wood');
      // Proud Hinoki lintel above the choke window (`y in [5.80, 6.32]`, sx = 5.56)
      placeBox(staticGroup, gx, GALLERY_Y + 2.86, side * 14.35, 5.56, 0.52, 17.6, mats.agedHinoki, 'wood', {
        noNav: true,
      });
      // Waist-low `0.76m` vermilion windowsill (`y in [3.22, 3.98]`, z strictly inside window span `[6.7, 18.8]`)
      placeBox(staticGroup, gx + 2.3, GALLERY_Y + 0.40, side * 12.75, 0.36, 0.76, 12.0, mats.vermilionLacquer, 'wood');

      // Roof over North & South High-Ground Window Galleries (`y = 6.35m`)
      const galRoof = buildKawaraRoof(7.6, 26.0, 1.65, false);
      galRoof.position.set(gx, GALLERY_Y + 3.15, side * 15.6);
      staticGroup.add(galRoof);
      registerRoofOverhang(gx, GALLERY_Y + 3.15, side * 15.6, 7.6, 26.0, 1.65);
      addRoofColliderSteps(
        gx,
        GALLERY_Y + 3.15,
        side * 15.6,
        makeKawaraRoofSpec(7.6, 26.0, 1.65),
        0,
        'choke-gallery-roof'
      );

      // Courtyard-side wide Granite Stairs (`x = -18.5 -> -24.9`, disjoint from gallery x = -24.9)
      buildGraniteStaircase(-18.5, side * 21.5, -24.9, side * 21.5, 0.0, GALLERY_Y, 4.4, true);

      // Breachable Shoji Gate in the Ground-Level Side Flank Passage (`z = +-30.5`)
      createDestructibleWallBay(
        `choke_flank_${side < 0 ? 'north' : 'south'}`,
        '城门侧翼破风木门',
        gx,
        1.48,
        side * 30.5,
        0.28,
        2.82,
        5.56
      );
    }

    // 2. Monumental Central Yagura-Mon Gatehouse Spanning the `11.2m` Choke (`z = -5.56..+5.56`)
    placeBox(staticGroup, gx, 5.45, 0, 5.8, 0.88, 11.08, mats.agedHinoki, 'wood', { tag: 'choke-gate-lintel' });
    placeBox(staticGroup, gx, 7.16, 0, 5.2, 2.50, 12.4, mats.shikkuiPlaster, 'concrete', { noNav: true });
    const mainGateShoji = makeMesh(unitBox, mats.washiShoji);
    mainGateShoji.position.set(gx - 2.68, 7.20, 0);
    mainGateShoji.scale.set(0.10, 1.35, 7.8);
    const mainGateShojiE = mainGateShoji.clone();
    mainGateShojiE.position.x = gx + 2.68;
    staticGroup.add(mainGateShoji, mainGateShojiE);

    const chokeMainRoof = buildKawaraRoof(7.8, 15.4, 2.15, true);
    chokeMainRoof.position.set(gx, 8.45, 0);
    staticGroup.add(chokeMainRoof);
    registerRoofOverhang(gx, 8.45, 0, 7.8, 15.4, 2.15);
    addRoofColliderSteps(gx, 8.45, 0, makeKawaraRoofSpec(7.8, 15.4, 2.15), 0, 'choke-main-roof');

    addHangingChochin(staticGroup, gx - 3.1, 4.65, -4.4, 1.25);
    addHangingChochin(staticGroup, gx - 3.1, 4.65, 4.4, 1.25);
    addHangingChochin(staticGroup, gx + 3.1, 4.65, -4.4, 1.25);
    addHangingChochin(staticGroup, gx + 3.1, 4.65, 4.4, 1.25);
  }

  // =========================================================================
  // STAGE 2 (`x = -24..+22, y = 0.0m`) — POINT A: GREAT BELL COURTYARD (`花村大梵钟庭院`)
  // + NORTH 2-TIER VERMILION CLOISTER (`y = 3.2m`) + SOUTH OPEN CLIFFSIDE SAKURA OVERLOOK!
  // =========================================================================
  const waterwheelGroup = new THREE.Group();
  {
    // --- CENTERPIECE: ICONIC HANAMURA POINT A GREAT BELL PAVILION (`花村大梵钟阁`, `x = -2.0, z = 0.0`) ---
    const bx = -2.0;
    const bz = 0.0;
    // Two-step smooth low granite dais (lifted +2cm off y=0 -> zero coplanarity with ground!)
    placeBox(staticGroup, bx, 0.10, bz, 11.4, 0.16, 11.4, mats.graniteSteps, 'concrete', {
      tag: 'bell-dais-1',
    });
    placeBox(staticGroup, bx, 0.27, bz, 9.6, 0.18, 9.6, mats.graniteSteps, 'concrete', {
      tag: 'bell-dais-2',
    });
    placeBox(staticGroup, bx, 0.40, bz, 8.8, 0.06, 8.8, mats.agedHinoki, 'wood');

    // 4 Corner Vermilion Temple Pillars resting on stone plinths (disjoint Y intervals!)
    for (const ox of [-3.6, 3.6]) {
      for (const oz of [-3.6, 3.6]) {
        placeBox(staticGroup, bx + ox, 0.58, bz + oz, 0.78, 0.28, 0.78, mats.ishigakiStone, 'concrete');
        placeBox(staticGroup, bx + ox, 2.46, bz + oz, 0.52, 3.46, 0.52, mats.vermilionLacquer, 'wood');
      }
    }
    // Tie-beams (`虹梁` — X beams full 8.2m, Z beams 6.76m between X beams)
    placeBox(staticGroup, bx, 4.42, bz - 3.6, 8.2, 0.42, 0.42, mats.agedHinoki, 'wood', { noNav: true });
    placeBox(staticGroup, bx, 4.42, bz + 3.6, 8.2, 0.42, 0.42, mats.agedHinoki, 'wood', { noNav: true });
    placeBox(staticGroup, bx - 3.6, 4.42, bz, 0.42, 0.42, 6.72, mats.agedHinoki, 'wood', { noNav: true });
    placeBox(staticGroup, bx + 3.6, 4.42, bz, 0.42, 0.42, 6.72, mats.agedHinoki, 'wood', { noNav: true });

    const greatBellGrp = new THREE.Group();
    greatBellGrp.position.set(bx, 0.44, bz);
    const bellBody = makeMesh(cyl12, mats.bronzeAged);
    bellBody.position.set(0, 2.75, 0);
    bellBody.scale.set(1.65, 2.15, 1.65);
    const bellLip = makeMesh(
      new THREE.TorusGeometry(0.88, 0.095, 10, 24).rotateX(Math.PI / 2),
      mats.bronzeAged
    );
    bellLip.position.set(0, 1.72, 0);
    const bellCrown = makeMesh(cyl8, mats.bronzeAged);
    bellCrown.position.set(0, 3.95, 0);
    bellCrown.scale.set(0.55, 0.52, 0.55);
    const shumokuBeam = makeMesh(cyl8, mats.agedHinoki);
    shumokuBeam.rotation.z = Math.PI / 2;
    shumokuBeam.position.set(2.05, 2.55, 0);
    shumokuBeam.scale.set(0.24, 2.4, 0.24);
    greatBellGrp.add(bellBody, bellLip, bellCrown, shumokuBeam);
    staticGroup.add(greatBellGrp);

    const bellRoof1 = buildKawaraRoof(11.6, 11.6, 2.05, false);
    bellRoof1.position.set(bx, 4.65, bz);
    staticGroup.add(bellRoof1);
    registerRoofOverhang(bx, 4.65, bz, 11.6, 11.6, 2.05);
    addRoofColliderSteps(bx, 4.65, bz, makeKawaraRoofSpec(11.6, 11.6, 2.05), 0, 'great-bell-roof-1');

    placeBox(staticGroup, bx, 6.22, bz, 5.8, 1.44, 5.8, mats.vermilionLacquer, 'wood', { noNav: true });
    const bellRoof2 = buildKawaraRoof(8.4, 8.4, 1.95, true);
    bellRoof2.position.set(bx, 6.98, bz);
    staticGroup.add(bellRoof2);
    registerRoofOverhang(bx, 6.98, bz, 8.4, 8.4, 1.95);
    addRoofColliderSteps(bx, 6.98, bz, makeKawaraRoofSpec(8.4, 8.4, 1.95), 0, 'great-bell-roof-2');

    for (const [lx, lz] of [
      [-4.2, -4.2],
      [4.2, -4.2],
      [-4.2, 4.2],
      [4.2, 4.2],
    ]) {
      addHangingChochin(staticGroup, bx + lx, 4.35, bz + lz, 1.15);
    }

    // Traditional Temple *Tsukubai* Purification Basin & *Ema* Votive Wooden Rack (`手水舍与绘马挂`) in Courtyard!
    {
      // Tsukubai stone basin at (6.8, 0, -10.8)
      placeBox(staticGroup, 6.8, 0.14, -10.8, 2.2, 0.24, 2.2, mats.graniteSteps, 'concrete');
      const basin = makeMesh(cyl8, mats.ishigakiStone);
      basin.position.set(6.8, 0.62, -10.8);
      basin.scale.set(0.92, 0.68, 0.92);
      const bambooSpout = makeMesh(cyl8, mats.bambooCulm);
      bambooSpout.position.set(6.45, 1.08, -10.8);
      bambooSpout.rotation.z = -1.25;
      bambooSpout.scale.set(0.08, 0.72, 0.08);
      staticGroup.add(basin, bambooSpout);

      // Ema votive plaque stand (`绘马挂`) at (-9.6, 0, 10.6)
      for (const sx of [-1.2, 1.2]) {
        placeBox(staticGroup, -9.6 + sx, 1.18, 10.6, 0.18, 2.32, 0.18, mats.agedHinoki, 'wood');
      }
      placeBox(staticGroup, -9.6, 2.38, 10.6, 2.9, 0.14, 0.56, mats.yakisugiPlank, 'wood', { noNav: true });
      for (const ry of [1.15, 1.72]) {
        const rail = makeMesh(unitBox, mats.agedHinoki);
        rail.position.set(-9.6, ry, 10.6);
        rail.scale.set(2.2, 0.08, 0.08);
        staticGroup.add(rail);
        for (let k = -2; k <= 2; k++) {
          const plaque = makeMesh(unitBox, mats.washiShoji);
          plaque.position.set(-9.6 + k * 0.42, ry - 0.16, 10.6 + (k % 2 === 0 ? 0.06 : -0.06));
          plaque.scale.set(0.28, 0.22, 0.03);
          staticGroup.add(plaque);
        }
      }
    }

    // --- NORTH COURTYARD FLANK (`z = -30.0..-50.2, x = -24.8..+23.97, y = 3.2m`) — 2-TIER VERMILION CLOISTER ---
    const CLOISTER_Y = 3.2;
    placeBox(
      staticGroup,
      -0.415,
      CLOISTER_Y * 0.5,
      -40.1,
      48.77,
      CLOISTER_Y,
      20.2,
      mats.ishigakiStone,
      'concrete',
      { tag: 'north-cloister-terrace' }
    );
    // Raised 10cm *nobedan* coursed stone promenade (`y in [3.22, 3.32]`, zero coplanarity!)
    placeBox(staticGroup, -0.5, CLOISTER_Y + 0.07, -34.6, 46.0, 0.10, 7.6, mats.villageCobble, 'concrete');

    buildGraniteStaircase(-2.0, -24.2, -2.0, -30.0, 0.0, CLOISTER_Y, 4.8, true);
    buildGraniteStaircase(14.5, -24.2, 14.5, -30.0, 0.0, CLOISTER_Y, 4.6, true);

    placeBox(staticGroup, -11.5, CLOISTER_Y + 0.44, -30.15, 12.6, 0.84, 0.22, mats.vermilionLacquer, 'wood');
    placeBox(staticGroup, 6.2, CLOISTER_Y + 0.44, -30.15, 10.2, 0.84, 0.22, mats.vermilionLacquer, 'wood');

    buildBossChallengeBellShrine(-2.0, CLOISTER_Y, -41.5, 1.05);
    buildHanamuraPavilion({
      id: 'cloister_teahouse',
      cx: -15.5,
      cz: -42.5,
      baseY: CLOISTER_Y,
      wX: 11.2,
      dZ: 7.8,
      facesZ: 1,
      stories: 2,
      crimsonTheme: true,
      withBalcony: false,
    });
    buildHanamuraPavilion({
      id: 'cloister_armory',
      cx: 12.5,
      cz: -42.5,
      baseY: CLOISTER_Y,
      wX: 11.2,
      dZ: 7.8,
      facesZ: 1,
      stories: 2,
      crimsonTheme: false,
      withBalcony: false,
    });

    // --- SOUTH COURTYARD FLANK (`z = +22..+49, x = -24..+22, y = 0.0m`) — SCENIC KOI STREAM & CLIFFSIDE SAKURA OVERLOOK! ---
    const streamMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(42.0, 5.2, 1, 1).rotateX(-Math.PI / 2),
      mats.streamWater
    );
    // Lifted cleanly to y = 0.14m inside 0.36m stone curbs (14cm above ground apron -> zero Z-fighting!)
    streamMesh.position.set(-1.5, 0.14, 25.0);
    streamMesh.renderOrder = 1;
    dynGroup.add(streamMesh);

    for (const sz of [22.1, 27.9]) {
      placeBox(staticGroup, -13.8, 0.19, sz, 17.2, 0.34, 0.55, mats.ishigakiStone, 'concrete');
      placeBox(staticGroup, 11.0, 0.19, sz, 17.6, 0.34, 0.55, mats.ishigakiStone, 'concrete');
    }
    // Arched Vermilion Garden Bridge (`y in [0.12, 0.44]`, rails `y in [0.45, 1.17]`)
    placeBox(staticGroup, -1.5, 0.28, 25.0, 6.8, 0.32, 6.6, mats.bridgePlank, 'wood');
    for (const bxSide of [-3.25, 3.25]) {
      placeBox(staticGroup, -1.5 + bxSide, 0.81, 25.0, 0.18, 0.72, 6.4, mats.vermilionLacquer, 'wood');
    }

    // Rotating Timber Waterwheel (`庭院水车` at `x = -20.5, z = 25.0`)
    waterwheelGroup.position.set(-20.5, 2.05, 25.0);
    const axle = makeMesh(cyl8, mats.agedHinoki);
    axle.rotation.x = Math.PI / 2;
    axle.scale.set(0.34, 1.4, 0.34);
    waterwheelGroup.add(axle);
    for (let s = 0; s < 8; s++) {
      const ang = (s / 8) * Math.PI * 2;
      const spoke = makeMesh(unitBox, mats.agedHinoki);
      spoke.scale.set(4.0, 0.14, 0.14);
      spoke.rotation.z = ang;
      const paddle = makeMesh(unitBox, mats.yakisugiPlank);
      paddle.position.set(Math.cos(ang) * 1.92, Math.sin(ang) * 1.92, 0);
      paddle.rotation.z = ang;
      paddle.scale.set(0.12, 0.46, 0.86);
      waterwheelGroup.add(spoke, paddle);
    }
    dynGroup.add(waterwheelGroup);

    // Cliffside Moon-Viewing Gazebo (`临崖望月茶亭` at `x = -1.5, y = 0, z = 42.0`)
    placeBox(staticGroup, -1.5, 0.18, 42.0, 7.6, 0.32, 6.4, mats.graniteSteps, 'concrete');
    for (const ox of [-3.2, 3.2]) {
      for (const oz of [-2.6, 2.6]) {
        placeBox(staticGroup, -1.5 + ox, 1.92, 42.0 + oz, 0.32, 3.12, 0.32, mats.agedHinoki, 'wood');
      }
    }
    const gazeboRoof = buildKawaraRoof(8.8, 7.6, 1.55, true);
    gazeboRoof.position.set(-1.5, 3.50, 42.0);
    staticGroup.add(gazeboRoof);
    registerRoofOverhang(-1.5, 3.50, 42.0, 8.8, 7.6, 1.55);
    addRoofColliderSteps(-1.5, 3.50, 42.0, makeKawaraRoofSpec(8.8, 7.6, 1.55), 0, 'cliff-gazebo-roof');
    addHangingChochin(staticGroup, -4.5, 3.28, 42.0, 1.0);
    addHangingChochin(staticGroup, 1.5, 3.28, 42.0, 1.0);
  }

  // =========================================================================
  // STAGE 3 (`x = +24..+76.0`) — POINT B: SHIMADA CASTLE GARDEN (`y = 2.8m`)
  // & HONMARU TENSHU DRAGON-SCROLL DOJO (`y = 5.2m`, Peak `+21.8m`)
  // =========================================================================
  {
    const GARDEN_Y = 2.8;
    const DOJO_Y = 5.2;

    // Sangi-zumi Castle Corner Quoins (proud by 8cm in X & Z, inset 3cm from top/bottom -> zero Z-fighting!)
    const addSangiZumiQuoins = (
      cornerX: number,
      cornerZ: number,
      baseY: number,
      heightY: number,
      zSign: number
    ) => {
      const usableH = heightY - 0.06;
      const courses = Math.max(3, Math.round(usableH / 0.42));
      for (let c = 0; c < courses; c++) {
        const even = c % 2 === 0;
        const sx = even ? 1.32 : 0.70;
        const sz = even ? 0.70 : 1.32;
        const q = makeMesh(unitBox, mats.graniteSteps);
        q.position.set(
          cornerX - 0.08 + sx * 0.5,
          baseY + 0.03 + (c + 0.5) * (usableH / courses),
          cornerZ + zSign * (0.08 - sz * 0.5)
        );
        q.scale.set(sx, (usableH / courses) * 0.92, sz);
        staticGroup.add(q);
      }
    };

    // --- TIER 1 (`x = 24.0..46.0, z = -50.2..+49.4, top y = 2.8m`) — NINOMARU CASTLE GARDEN ---
    placeBox(staticGroup, 35.0, GARDEN_Y * 0.5, -0.4, 22.0, GARDEN_Y, 99.6, mats.ishigakiStone, 'concrete', {
      tag: 'castle-garden-tier',
    });
    // Raised 10cm *nobedan* temple flagstone approach (`y in [2.82, 2.92]`, strictly disjoint from 2.80m!)
    placeBox(staticGroup, 34.8, GARDEN_Y + 0.07, 0.0, 18.6, 0.10, 9.2, mats.villageCobble, 'concrete');
    placeBox(staticGroup, 35.0, GARDEN_Y + 0.07, -18.5, 6.4, 0.10, 26.5, mats.villageCobble, 'concrete');
    placeBox(staticGroup, 35.0, GARDEN_Y + 0.07, 18.5, 6.4, 0.10, 26.5, mats.villageCobble, 'concrete');
    addSangiZumiQuoins(24.0, -50.2, 0, GARDEN_Y, -1);
    addSangiZumiQuoins(24.0, 49.4, 0, GARDEN_Y, 1);

    // 4 Wide Access Routes from Stage 2 onto Castle Garden (`y = 2.8m`) & North Cloister (`y = 3.2m`)
    placeToriiGate(16.8, 0.0, 0.0, Math.PI / 2, 1.32);
    buildGraniteStaircase(18.0, 0.0, 24.0, 0.0, 0.0, GARDEN_Y, 9.6, true);
    buildGraniteStaircase(18.5, -17.5, 24.0, -17.5, 0.0, GARDEN_Y, 4.8, true);
    buildGraniteStaircase(25.6, -35.0, 23.98, -35.0, GARDEN_Y, 3.2, 5.6, false);
    buildGraniteStaircase(18.2, 34.5, 24.0, 34.5, 0.0, GARDEN_Y, 5.4, true);

    placeBox(staticGroup, 24.20, GARDEN_Y + 0.44, -9.8, 0.24, 0.84, 8.2, mats.agedHinoki, 'wood');
    placeBox(staticGroup, 24.20, GARDEN_Y + 0.44, 16.5, 0.24, 0.84, 20.6, mats.agedHinoki, 'wood');

    // --- TIER 2 (`x = 46.0..76.0, z = -50.2..+49.4, top y = 5.2m`) — POINT B SHIMADA HONMARU DOJO PLAZA ---
    placeBox(staticGroup, 61.0, DOJO_Y * 0.5, -0.4, 30.0, DOJO_Y, 99.6, mats.ishigakiStone, 'concrete', {
      tag: 'castle-honmaru-tier',
    });
    // Raised 10cm *nobedan* plaza walkway (`x in [46.4, 54.6]`, disjoint from engawa [54.74, 56.46] & tatami [56.5, 72.5]!)
    placeBox(staticGroup, 50.5, DOJO_Y + 0.07, 0.0, 8.2, 0.10, 52.0, mats.villageCobble, 'concrete');
    addSangiZumiQuoins(46.0, -50.2, GARDEN_Y, DOJO_Y - GARDEN_Y, -1);
    addSangiZumiQuoins(46.0, 49.4, GARDEN_Y, DOJO_Y - GARDEN_Y, 1);

    // 3 Wide Staircases climbing from Castle Garden (`y = 2.8m`) onto Point B Honmaru Dojo Plaza (`y = 5.2m`)!
    buildGraniteStaircase(40.2, 0.0, 46.0, 0.0, GARDEN_Y, DOJO_Y, 9.6, true);
    buildGraniteStaircase(40.6, -24.5, 46.0, -24.5, GARDEN_Y, DOJO_Y, 5.2, true);
    buildGraniteStaircase(40.6, 24.5, 46.0, 24.5, GARDEN_Y, DOJO_Y, 5.2, true);

    // Covered Wooden Veranda Bridges (`渡廊`) flanking the Honmaru Plaza
    buildCoveredSkyBridge(43.2, DOJO_Y + 0.04, -38.5, 6.2, 4.4, false);
    buildCoveredSkyBridge(43.2, DOJO_Y + 0.04, 38.5, 6.2, 4.4, false);

    // Twin Two-Story Sumi-Yagura Corner Watch-Turrets (`隅橹` at `x = 55.5, y = 5.2, z = +-35.5`)
    for (const tz of [-35.5, 35.5]) {
      placeBox(staticGroup, 55.5, DOJO_Y + 1.66, tz, 8.4, 3.28, 8.4, mats.namakoWall, 'concrete', {
        tag: 'sumi-yagura-1',
      });
      const yRoof1 = buildKawaraRoof(10.2, 10.2, 1.75, false);
      yRoof1.position.set(55.5, DOJO_Y + 3.32, tz);
      staticGroup.add(yRoof1);
      registerRoofOverhang(55.5, DOJO_Y + 3.32, tz, 10.2, 10.2, 1.75);
      addRoofColliderSteps(55.5, DOJO_Y + 3.32, tz, makeKawaraRoofSpec(10.2, 10.2, 1.75), 0, 'yagura-roof-1');

      placeBox(staticGroup, 55.5, DOJO_Y + 5.42, tz, 6.2, 2.74, 6.2, mats.shikkuiPlaster, 'concrete', {
        noNav: true,
      });
      const yRoof2 = buildKawaraRoof(7.8, 7.8, 1.95, true);
      yRoof2.position.set(55.5, DOJO_Y + 6.82, tz);
      staticGroup.add(yRoof2);
      registerRoofOverhang(55.5, DOJO_Y + 6.82, tz, 7.8, 7.8, 1.95);
      addRoofColliderSteps(55.5, DOJO_Y + 6.82, tz, makeKawaraRoofSpec(7.8, 7.8, 1.95), 0, 'yagura-roof-2');
      addHangingChochin(staticGroup, 51.0, DOJO_Y + 3.1, tz, 1.05);
    }

    // --- MONUMENTAL FOUR-STORY SHIMADA TENSHU KEEP & OPEN POINT-B DOJO (`岛田四重本丸天守 · 双龙挂轴道场`) ---
    const hx = 64.5;
    const hz = 0.0;
    // Open Tatami Dojo Floor (`x in [56.5, 72.5]`) + Hinoki Engawa Veranda (`x in [54.74, 56.46]`) — 100% disjoint!
    placeBox(staticGroup, hx, DOJO_Y + 0.13, hz, 16.0, 0.22, 18.0, mats.tatamiRush, 'wood');
    placeBox(staticGroup, 55.6, DOJO_Y + 0.10, hz, 1.72, 0.16, 19.4, mats.agedHinoki, 'wood');

    // Grand Open-Front Dojo Pillars (`y in [DOJO_Y+0.25, DOJO_Y+4.18]`)
    for (const px of [hx - 7.6, hx, hx + 7.6]) {
      for (const pz of [-8.6, -4.4, 4.4, 8.6]) {
        if (px === hx && Math.abs(pz) < 5.0) continue;
        placeBox(staticGroup, px, DOJO_Y + 2.32, pz, 0.44, 3.74, 0.44, mats.agedHinoki, 'wood');
      }
    }
    // Side walls strictly between corner pillars (`x in [hx+-3.0, hx+-7.3]`, `thickness = 0.28 < 0.44` -> zero pillar coplanarity!)
    for (const sz of [-8.6, 8.6]) {
      placeBox(staticGroup, hx - 5.15, DOJO_Y + 2.30, sz, 4.30, 3.70, 0.28, mats.shikkuiPlaster, 'wood');
      placeBox(staticGroup, hx + 5.15, DOJO_Y + 2.30, sz, 4.30, 3.70, 0.28, mats.shikkuiPlaster, 'wood');
    }
    // Back Tokonoma Sanctuary Wall + Layered Twin-Dragon Gold Scroll Altar (each layer cleanly stepped forward!)
    placeBox(staticGroup, hx + 7.6, DOJO_Y + 2.30, 0, 0.28, 3.70, 16.6, mats.shikkuiPlaster, 'wood');
    placeBox(staticGroup, hx + 6.1, DOJO_Y + 0.74, 0, 2.0, 0.56, 6.4, mats.yakisugiPlank, 'wood');
    const crimsonScrollBorder = makeMesh(unitBox, mats.vermilionLacquer);
    crimsonScrollBorder.position.set(hx + 7.36, DOJO_Y + 2.35, 0);
    crimsonScrollBorder.scale.set(0.08, 3.05, 6.0);
    const goldDragonScreen = makeMesh(unitBox, mats.bronzeAged);
    goldDragonScreen.position.set(hx + 7.26, DOJO_Y + 2.35, 0);
    goldDragonScreen.scale.set(0.08, 2.75, 5.5);
    staticGroup.add(crimsonScrollBorder, goldDragonScreen);

    // 1st Story Great Kawara Roof (`y = DOJO_Y + 4.2m = 9.4m`)
    const tRoof1 = buildKawaraRoof(19.6, 21.2, 2.25, false);
    tRoof1.position.set(hx, DOJO_Y + 4.2, hz);
    staticGroup.add(tRoof1);
    registerRoofOverhang(hx, DOJO_Y + 4.2, hz, 19.6, 21.2, 2.25);
    addRoofColliderSteps(hx, DOJO_Y + 4.2, hz, makeKawaraRoofSpec(19.6, 21.2, 2.25), 0, 'tenshu-roof-1');

    // 2nd Story (`y in [9.72, 13.68]`)
    placeBox(staticGroup, hx + 0.4, DOJO_Y + 6.52, hz, 13.2, 3.92, 14.4, mats.shikkuiPlaster, 'concrete', {
      noNav: true,
    });
    const tRoof2 = buildKawaraRoof(16.0, 17.2, 2.05, false);
    tRoof2.position.set(hx + 0.4, DOJO_Y + 8.5, hz);
    staticGroup.add(tRoof2);
    registerRoofOverhang(hx + 0.4, DOJO_Y + 8.5, hz, 16.0, 17.2, 2.05);
    addRoofColliderSteps(hx + 0.4, DOJO_Y + 8.5, hz, makeKawaraRoofSpec(16.0, 17.2, 2.05), 0, 'tenshu-roof-2');

    // 3rd Story
    placeBox(staticGroup, hx + 0.4, DOJO_Y + 10.55, hz, 9.8, 3.46, 10.6, mats.namakoWall, 'concrete', {
      noNav: true,
    });
    const tRoof3 = buildKawaraRoof(12.4, 13.2, 1.9, false);
    tRoof3.position.set(hx + 0.4, DOJO_Y + 12.3, hz);
    staticGroup.add(tRoof3);
    registerRoofOverhang(hx + 0.4, DOJO_Y + 12.3, hz, 12.4, 13.2, 1.9);
    addRoofColliderSteps(hx + 0.4, DOJO_Y + 12.3, hz, makeKawaraRoofSpec(12.4, 13.2, 1.9), 0, 'tenshu-roof-3');

    // 4th Top Belvedere Keep + Golden Shachihoko Roof Finials (`peak y = 21.8m`!)
    placeBox(staticGroup, hx + 0.4, DOJO_Y + 13.85, hz, 6.8, 2.86, 7.4, mats.yakisugiPlank, 'wood', {
      noNav: true,
    });
    const tRoof4 = buildKawaraRoof(9.4, 10.0, 2.25, true);
    tRoof4.position.set(hx + 0.4, DOJO_Y + 15.3, hz);
    staticGroup.add(tRoof4);
    registerRoofOverhang(hx + 0.4, DOJO_Y + 15.3, hz, 9.4, 10.0, 2.25);
    addRoofColliderSteps(hx + 0.4, DOJO_Y + 15.3, hz, makeKawaraRoofSpec(9.4, 10.0, 2.25), 0, 'tenshu-roof-4');

    for (const lz of [-4.6, 4.6]) {
      addHangingChochin(staticGroup, hx - 8.9, DOJO_Y + 3.9, lz, 1.25);
    }
  }

  // =========================================================================
  // DESTRUCTIBLE STRUCTURES & TACTICAL COVER ACROSS ALL 3 HANAMURA STAGES
  // =========================================================================
  createDestructibleTeaPavilion('tea_west_plaza', '拉面街歇脚茶亭', -40.5, -6.8, 0.0);
  createDestructibleTeaPavilion('tea_courtyard_e', '大梵钟东侧茶屋', 11.2, -9.2, 0.0);
  createDestructibleTeaPavilion('tea_garden_n', '二之丸枯山水茶亭', 33.5, -13.5, 2.8);
  createDestructibleTeaPavilion('tea_honmaru_s', '本丸南廊御茶亭', 52.0, 17.5, 5.2);

  createDestructibleWatchtower('tower_courtyard_s', '临崖樱道望楼', 10.5, 16.5, 0.0);
  createDestructibleWatchtower('tower_garden_s', '二之丸南侧哨橹', 33.5, 14.5, 2.8);

  createDestructiblePalisade('pal_1', '游艺街酒樽车', -49.5, 5.6, 0.14, true, 0.0);
  createDestructiblePalisade('pal_2', '一之门前竹束楯', -34.5, -3.4, Math.PI / 2, false, 0.0);
  createDestructiblePalisade('pal_3', '一之门南酒樽堆', -34.5, 3.6, -0.18, true, 0.0);
  createDestructiblePalisade('pal_4', '梵钟阁西侧木楯', -13.5, -4.8, Math.PI / 2, false, 0.0);
  createDestructiblePalisade('pal_5', '梵钟阁南酒樽车', -12.5, 6.2, 0.22, true, 0.0);
  createDestructiblePalisade('pal_6', '鸟居石阶前竹楯', 12.2, 4.8, Math.PI / 2, false, 0.0);
  createDestructiblePalisade('pal_7', '北朱漆回廊木楯', -8.5, -33.5, 0.0, false, 3.2);
  createDestructiblePalisade('pal_8', '二之丸中庭酒樽车', 33.5, -5.8, 0.25, true, 2.8);
  createDestructiblePalisade('pal_9', '二之丸南阶竹束楯', 33.5, 5.8, Math.PI / 2, false, 2.8);
  createDestructiblePalisade('pal_10', '本丸天守前木楯', 51.5, -7.2, Math.PI / 2, false, 5.2);

  // =========================================================================
  // SCENIC HANAMURA BOUNDARIES (`x: -72..+76, z: -50..+50` — strictly disjoint from terrace faces!)
  // =========================================================================
  {
    // North Daimyo Estate Tiled Wall (`cz = -51.0, z in [-51.7, -50.3]` — strictly outside terrace z = -50.2!)
    placeBox(staticGroup, 2.0, 2.22, -51.0, 152.0, 4.40, 1.4, mats.ishigakiStone, 'concrete', {
      noNav: true,
      tag: 'estate-wall-north-base',
    });
    const northPlaster = makeMesh(unitBox, mats.shikkuiPlaster);
    northPlaster.position.set(2.0, 5.94, -51.0);
    northPlaster.scale.set(151.6, 2.98, 1.0);
    const northTileCap = makeMesh(unitBox, mats.kawaraTile);
    northTileCap.position.set(2.0, 7.64, -51.0);
    northTileCap.scale.set(152.4, 0.36, 1.65);
    staticGroup.add(northPlaster, northTileCap);
    addBoxCollider(-75, -4, -52.2, 79, 38.0, -49.8, 'concrete', {
      noNav: true,
      noRay: true,
      noBullet: true,
      tag: 'air-wall-north',
    });

    // West Estate Wall behind Attacker Spawn (`x = -72.6, z in [-50.1, +50.1]` — disjoint from north wall!)
    placeBox(staticGroup, -72.6, 2.82, 0, 1.6, 5.56, 100.2, mats.shikkuiPlaster, 'concrete', {
      noNav: true,
      tag: 'estate-wall-west',
    });
    const westCap = makeMesh(unitBox, mats.kawaraTile);
    westCap.position.set(-72.6, 5.82, 0);
    westCap.scale.set(2.2, 0.36, 100.8);
    staticGroup.add(westCap);
    addBoxCollider(-74.5, -4, -52, -71.8, 38.0, 52, 'concrete', {
      noNav: true,
      noRay: true,
      noBullet: true,
      tag: 'air-wall-west',
    });

    // South Open Cliffside Scenic Promenade Railing (`cz = +49.82, z in [49.46, 50.18]` — strictly outside z = 49.40!)
    const southSegments: Array<[number, number, number]> = [
      [-24.0, 95.6, 0.0],
      [35.0, 21.8, 2.8],
      [61.0, 29.8, 5.2],
    ];
    for (const [cx, lenX, baseY] of southSegments) {
      placeBox(staticGroup, cx, baseY + 0.18, 49.82, lenX, 0.32, 0.72, mats.graniteSteps, 'concrete', {
        noNav: true,
      });
      placeBox(staticGroup, cx, baseY + 0.64, 49.82, lenX, 0.12, 0.18, mats.vermilionLacquer, 'wood', {
        noNav: true,
      });
      placeBox(staticGroup, cx, baseY + 1.14, 49.82, lenX, 0.14, 0.22, mats.vermilionLacquer, 'wood', {
        noNav: true,
      });
      const posts = Math.max(3, Math.round(lenX / 6.0));
      for (let p = 0; p <= posts; p++) {
        const px = cx - lenX * 0.5 + (p / posts) * lenX;
        const post = makeMesh(cyl8, mats.vermilionLacquer);
        post.position.set(px, baseY + 0.78, 49.82);
        post.scale.set(0.22, 1.18, 0.22);
        const cap = makeMesh(cyl8, mats.bronzeAged);
        cap.position.set(px, baseY + 1.45, 49.82);
        cap.scale.set(0.26, 0.16, 0.26);
        staticGroup.add(post, cap);
      }
    }
    addBoxCollider(-75, -4, 49.4, 79, 38.0, 52.0, 'concrete', {
      noNav: true,
      noRay: true,
      noBullet: true,
      tag: 'air-wall-south',
    });

    // East Cliffside Scenic Balustrade behind Shimada Tenshu (`cx = +76.40` — strictly outside x = 76.00!)
    placeBox(staticGroup, 76.40, 5.2 + 0.18, -0.4, 0.72, 0.32, 99.4, mats.graniteSteps, 'concrete', {
      noNav: true,
    });
    placeBox(staticGroup, 76.40, 5.2 + 1.14, -0.4, 0.22, 0.16, 99.4, mats.vermilionLacquer, 'wood', {
      noNav: true,
    });
    addBoxCollider(75.8, -4, -52, 79.0, 38.0, 52, 'concrete', {
      noNav: true,
      noRay: true,
      noBullet: true,
      tag: 'air-wall-east',
    });

    // Overhead invisible air-wall ceiling
    addBoxCollider(-75, 26.2, -52, 79, 30.0, 52, 'concrete', {
      noNav: true,
      noRay: true,
      noBullet: true,
      tag: 'air-wall-ceiling',
    });
  }

  // =========================================================================
  // 8. ANCIENT SAKURA (`古樱`), MOMIJI MAPLES (`红叶枫`), CASTLE PINES (`赤松`) & MOSO BAMBOO (`孟宗竹林`)
  //    Single-draw-call gnarled multi-limb trunks + merged botanical alpha-cutout sprig crowns!
  // =========================================================================
  function makeTreeRng(seed: number) {
    let s = (Math.imul(seed | 0, 747796405) + 2891336453) | 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return ((s >>> 0) % 100000) / 100000;
    };
  }

  function buildGnarledTrunkGeo(seed: number, isPine = false): any {
    const rnd = makeTreeRng(seed);
    const pos: number[] = [];
    const nrm: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];

    function appendLimbChain(
      pts: Array<[number, number, number, number]>,
      radialSegs: number,
      vScale = 0.85
    ) {
      const baseV = pos.length / 3;
      let arcLen = 0;
      for (let r = 0; r < pts.length; r++) {
        const [cx, cy, cz, rad] = pts[r];
        if (r > 0) {
          const [px, py, pz] = pts[r - 1];
          arcLen += Math.hypot(cx - px, cy - py, cz - pz);
        }
        const next = pts[Math.min(pts.length - 1, r + 1)];
        const prev = pts[Math.max(0, r - 1)];
        let tx = next[0] - prev[0];
        let ty = next[1] - prev[1];
        let tz = next[2] - prev[2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl;
        ty /= tl;
        tz /= tl;

        let ux = Math.abs(ty) < 0.92 ? -tz : 1;
        let uy = 0;
        let uz = Math.abs(ty) < 0.92 ? tx : 0;
        const ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul;
        uy /= ul;
        uz /= ul;
        const vx = ty * uz - tz * uy;
        const vy = tz * ux - tx * uz;
        const vz = tx * uy - ty * ux;

        for (let s = 0; s <= radialSegs; s++) {
          const u = s / radialSegs;
          const a = u * Math.PI * 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const flute = cy < 0.55 ? 1 + (0.55 - cy) * 0.36 * Math.cos(a * 5 + seed) : 1;
          const nx = ux * ca + vx * sa;
          const ny = uy * ca + vy * sa;
          const nz = uz * ca + vz * sa;
          pos.push(cx + nx * rad * flute, cy + ny * rad * flute, cz + nz * rad * flute);
          nrm.push(nx, ny, nz);
          uvs.push(u * 2.0, arcLen * vScale);
        }
      }
      const stride = radialSegs + 1;
      for (let r = 0; r < pts.length - 1; r++) {
        for (let s = 0; s < radialSegs; s++) {
          const a = baseV + r * stride + s;
          const b = a + 1;
          const c = a + stride;
          const d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
    }

    const leanX = isPine ? 0.42 + (rnd() - 0.3) * 0.25 : (rnd() - 0.5) * 0.28;
    const leanZ = isPine ? (rnd() - 0.5) * 0.30 : (rnd() - 0.5) * 0.28;

    appendLimbChain(
      isPine
        ? [
            [0, -0.08, 0, 0.48],
            [leanX * 0.35, 0.72, leanZ * 0.35, 0.31],
            [leanX * 0.95, 1.65, leanZ * 0.75, 0.25],
            [leanX * 0.55, 2.55, leanZ * 0.40, 0.20],
            [leanX * 0.78, 3.35, leanZ * 0.55, 0.13],
          ]
        : [
            [0, -0.08, 0, 0.52],
            [leanX * 0.30, 0.68, leanZ * 0.30, 0.34],
            [leanX * 0.70, 1.55, leanZ * 0.65, 0.28],
            [leanX * 0.55, 2.38, leanZ * 0.50, 0.23],
          ],
      8
    );

    const boughTargets: Array<[number, number, number, number]> = isPine
      ? [
          [1.65, 2.75, 0.35, 1.85],
          [-1.45, 3.05, 0.65, 2.15],
          [0.35, 3.35, -1.55, 2.35],
          [-0.55, 3.65, -0.95, 2.65],
          [1.15, 3.85, 0.85, 2.85],
          [0.15, 4.25, 0.10, 3.10],
        ]
      : [
          [1.55, 3.55, 0.55, 2.05],
          [-1.50, 3.60, 0.68, 2.10],
          [0.48, 3.58, -1.55, 2.08],
          [-0.72, 3.45, 1.52, 2.02],
          [1.42, 3.32, -1.02, 1.98],
          [-1.18, 3.72, -0.92, 2.15],
        ];

    for (let b = 0; b < boughTargets.length; b++) {
      const [tx, ty, tz, forkY] = boughTargets[b];
      const fx = leanX * 0.58;
      const fz = leanZ * 0.50;
      const mx = (fx + tx) * 0.52 + (rnd() - 0.5) * 0.28;
      const my = forkY + (ty - forkY) * 0.56 + (rnd() - 0.35) * 0.22;
      const mz = (fz + tz) * 0.52 + (rnd() - 0.5) * 0.28;
      appendLimbChain(
        [
          [fx, forkY, fz, 0.165],
          [mx, my, mz, 0.108],
          [tx, ty, tz, 0.052],
        ],
        6
      );
      appendLimbChain(
        [
          [mx, my, mz, 0.088],
          [
            tx * 0.82 + (rnd() - 0.5) * 0.85,
            ty + 0.38 + rnd() * 0.28,
            tz * 0.82 + (rnd() - 0.5) * 0.85,
            0.038,
          ],
        ],
        5
      );
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  function buildBotanicalCanopyGeo(seed: number, isPine = false): any {
    const rnd = makeTreeRng(seed);
    const pos: number[] = [];
    const nrm: number[] = [];
    const uvs: number[] = [];
    const meta: number[] = [];
    const idx: number[] = [];

    const pads: Array<[number, number, number, number, number, number]> = isPine
      ? [
          [1.62, 2.92, 0.35, 1.38, 0.46, 9],
          [-1.42, 3.22, 0.65, 1.32, 0.45, 9],
          [0.35, 3.52, -1.50, 1.28, 0.44, 8],
          [-0.50, 3.86, -0.88, 1.22, 0.44, 8],
          [1.10, 4.02, 0.82, 1.18, 0.42, 8],
          [0.18, 4.44, 0.12, 1.44, 0.48, 10],
        ]
      : [
          [0.0, 4.35, 0.0, 1.72, 0.96, 12],
          [1.55, 3.68, 0.55, 1.38, 0.84, 9],
          [-1.48, 3.74, 0.66, 1.40, 0.84, 9],
          [0.46, 3.70, -1.52, 1.35, 0.82, 8],
          [-0.70, 3.54, 1.48, 1.32, 0.80, 8],
          [1.38, 3.40, -0.98, 1.24, 0.78, 7],
          [-1.15, 3.84, -0.90, 1.26, 0.80, 7],
        ];

    const crownCenterY = 3.55;

    function addCuppedSprigCard(
      cx: number,
      cy: number,
      cz: number,
      w: number,
      h: number,
      yaw: number,
      pitch: number,
      roll: number,
      ao: number,
      sunTip: number,
      phase: number
    ) {
      const baseV = pos.length / 3;
      const cyaw = Math.cos(yaw);
      const syaw = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const cr = Math.cos(roll);
      const sr = Math.sin(roll);

      for (let iy = 0; iy <= 2; iy++) {
        const v = iy / 2;
        const ly0 = (v - 0.45) * h;
        for (let ix = 0; ix <= 2; ix++) {
          const u = ix / 2;
          const lx0 = (u - 0.5) * w;
          const cupZ = -(lx0 * lx0 * 0.24 + (v - 0.5) * (v - 0.5) * 0.18) * (isPine ? 0.65 : 1.0);

          const rx1 = lx0 * cr - ly0 * sr;
          const ry1 = lx0 * sr + ly0 * cr;
          const rz1 = cupZ;

          const rx2 = rx1;
          const ry2 = ry1 * cp - rz1 * sp;
          const rz2 = ry1 * sp + rz1 * cp;

          const wx = cx + rx2 * cyaw + rz2 * syaw;
          const wy = cy + ry2;
          const wz = cz - rx2 * syaw + rz2 * cyaw;

          pos.push(wx, wy, wz);

          let nx = wx * 0.82;
          let ny = (wy - crownCenterY) * 1.18 + (isPine ? 1.35 : 0.95);
          let nz = wz * 0.82;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nrm.push(nx / nl, ny / nl, nz / nl);

          uvs.push(u, v);
          const vAo = Math.min(1, ao * (0.86 + v * 0.22));
          meta.push(vAo, sunTip, phase);
        }
      }

      for (let iy = 0; iy < 2; iy++) {
        for (let ix = 0; ix < 2; ix++) {
          const a = baseV + iy * 3 + ix;
          const b = a + 1;
          const c = a + 3;
          const d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
    }

    for (let p = 0; p < pads.length; p++) {
      const [px, py, pz, radXZ, scaleY, cardCount] = pads[p];
      for (let k = 0; k < cardCount; k++) {
        const frac = (k + 0.5) / cardCount;
        const theta = k * 2.399963 + p * 1.17 + rnd() * 0.35;
        const shellR = Math.pow(frac, 0.55) * radXZ * (0.52 + rnd() * 0.48);
        const domeY = Math.cos(frac * Math.PI * 0.82) * radXZ * scaleY * 0.52 + (rnd() - 0.42) * 0.28;

        const sx = px + Math.cos(theta) * shellR;
        const sy = py + domeY;
        const sz = pz + Math.sin(theta) * shellR;

        const outYaw = Math.atan2(sx, sz) + (rnd() - 0.5) * 1.15;
        const pitch = isPine
          ? -0.95 + (rnd() - 0.5) * 0.42
          : -0.32 - frac * 0.48 + (rnd() - 0.5) * 0.52;
        const roll = (rnd() - 0.5) * 0.65;

        const cardW = isPine ? 1.55 + rnd() * 0.48 : 1.52 + rnd() * 0.56;
        const cardH = isPine ? 1.18 + rnd() * 0.36 : 1.42 + rnd() * 0.50;

        const heightNorm = Math.max(0, Math.min(1, (sy - 2.6) / 2.5));
        const radialNorm = Math.max(0, Math.min(1, Math.hypot(sx, sz) / 2.85));
        const ao = Math.max(0.42, Math.min(1.0, 0.48 + heightNorm * 0.34 + radialNorm * 0.24));
        const sunTip = Math.max(0.25, Math.min(1.0, 0.30 + heightNorm * 0.45 + radialNorm * 0.30));

        addCuppedSprigCard(sx, sy, sz, cardW, cardH, outYaw, pitch, roll, ao, sunTip, rnd());
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('aFolMeta', new THREE.Float32BufferAttribute(meta, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  const broadleafTrunks = [
    buildGnarledTrunkGeo(7101, false),
    buildGnarledTrunkGeo(7207, false),
    buildGnarledTrunkGeo(7309, false),
  ];
  const broadleafCanopies = [
    buildBotanicalCanopyGeo(8101, false),
    buildBotanicalCanopyGeo(8209, false),
    buildBotanicalCanopyGeo(8317, false),
  ];
  const pineTrunks = [buildGnarledTrunkGeo(7411, true), buildGnarledTrunkGeo(7517, true)];
  const pineCanopies = [buildBotanicalCanopyGeo(8419, true), buildBotanicalCanopyGeo(8527, true)];

  type VillageTreeSpecies = 'sakuraA' | 'sakuraB' | 'maple' | 'pine';

  const treeCoords: Array<[number, number, number, number, VillageTreeSpecies, number]> = [
    // Stage 1: West Ramen & Arcade Plaza Sakura & Maples (`y = 0`)
    [-66.5, -10.2, 1.26, 1, 'sakuraA', 0.0],
    [-66.5, 10.2, 1.24, 2, 'sakuraB', 0.0],
    [-36.5, -10.5, 1.22, 3, 'maple', 0.0],
    [-36.5, 10.5, 1.28, 4, 'sakuraA', 0.0],
    // Stage 2: Point A Great Bell Courtyard & Cliffside Ancient Sakura (`y = 0`)
    [-14.5, -15.5, 1.44, 5, 'sakuraA', 0.0],
    [10.5, -16.5, 1.38, 6, 'sakuraB', 0.0],
    [-14.5, 17.5, 1.46, 7, 'sakuraB', 0.0],
    [-16.5, 42.5, 1.52, 8, 'sakuraA', 0.0],
    [13.5, 41.5, 1.50, 9, 'sakuraB', 0.0],
    [-22.5, 36.0, 1.28, 10, 'pine', 0.0],
    [16.5, 29.0, 1.26, 11, 'maple', 0.0],
    // Stage 2 North Cloister High Terrace (`y = 3.2m`)
    [-22.0, -34.5, 1.28, 12, 'sakuraA', 3.2],
    [6.0, -34.5, 1.26, 13, 'maple', 3.2],
    [21.0, -43.5, 1.28, 14, 'pine', 3.2],
    // Stage 3: Point B Castle Garden (`y = 2.8m`) & Shimada Honmaru Dojo Plaza (`y = 5.2m`)
    [28.5, -28.0, 1.38, 15, 'sakuraA', 2.8],
    [28.5, 26.5, 1.42, 16, 'sakuraB', 2.8],
    [38.0, -41.5, 1.30, 17, 'pine', 2.8],
    [38.0, 41.5, 1.32, 18, 'sakuraA', 2.8],
    [50.5, -16.5, 1.40, 19, 'sakuraB', 5.2],
    [50.5, 28.5, 1.38, 20, 'sakuraA', 5.2],
    [70.5, -22.5, 1.32, 21, 'pine', 5.2],
    [70.5, 22.5, 1.30, 22, 'maple', 5.2],
  ];

  // Instance all 22 botanical village trees into 6 GPU InstancedMeshes (~38 draw calls saved!)
  {
    const treeMat4 = new THREE.Matrix4();
    const treePos = new THREE.Vector3();
    const treeQuat = new THREE.Quaternion();
    const treeEul = new THREE.Euler();
    const treeScl = new THREE.Vector3();

    interface TreeBucket {
      geo: any;
      mat: any;
      matrices: any[];
    }
    const buckets = new Map<string, TreeBucket>();
    const pushBucket = (key: string, geo: any, mat: any, m4: any) => {
      let b = buckets.get(key);
      if (!b) {
        b = { geo, mat, matrices: [] };
        buckets.set(key, b);
      }
      b.matrices.push(m4.clone());
    };

    for (const [tx, tz, sc, sd, species, by] of treeCoords) {
      const isPine = species === 'pine';
      treePos.set(tx, by, tz);
      treeEul.set(((sd % 3) - 1) * 0.025, sd * 1.73, (((sd * 3) % 3) - 1) * 0.025);
      treeQuat.setFromEuler(treeEul);
      treeScl.setScalar(sc);
      treeMat4.compose(treePos, treeQuat, treeScl);

      const trunkGeo = isPine ? pineTrunks[0] : broadleafTrunks[0];
      const canopyGeo = isPine ? pineCanopies[0] : broadleafCanopies[0];
      const barkMat = isPine ? mats.pineBark : mats.sakuraBark;
      const folMat =
        species === 'maple'
          ? mats.autumnMaple
          : species === 'pine'
          ? mats.pineNeedles
          : species === 'sakuraB'
          ? mats.sakuraBlossomB
          : mats.sakuraBlossomA;

      pushBucket(isPine ? 'trunk-pine' : 'trunk-broad', trunkGeo, barkMat, treeMat4);
      pushBucket(`crown-${species}`, canopyGeo, folMat, treeMat4);

      addBoxCollider(
        tx - 0.44 * sc,
        by,
        tz - 0.44 * sc,
        tx + 0.44 * sc,
        by + 2.9 * sc,
        tz + 0.44 * sc,
        'wood'
      );
    }

    for (const b of buckets.values()) {
      const inst = new THREE.InstancedMesh(b.geo, b.mat, b.matrices.length);
      for (let i = 0; i < b.matrices.length; i++) {
        inst.setMatrixAt(i, b.matrices[i]);
      }
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      staticGroup.add(inst);
    }
  }

  // Dense Moso Bamboo Groves (`孟宗竹林` framing North Estate Wall & Castle Corners!)
  {
    function buildBambooCrownGeo(): any {
      const pos: number[] = [];
      const nrm: number[] = [];
      const uvs: number[] = [];
      const meta: number[] = [];
      const idx: number[] = [];
      const tiers = 10;
      for (let t = 0; t < tiers; t++) {
        const frac = t / (tiers - 1);
        const yaw = t * 2.39996;
        const yOff = (frac - 0.5) * 2.55;
        const rOut = 0.22 + (1 - Math.abs(frac - 0.55) * 1.2) * 0.42;
        const w = 1.18 + (1 - frac * 0.32) * 0.35;
        const h = 1.12;
        const tilt = 0.48 + frac * 0.34;
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const ct = Math.cos(tilt);
        const st = Math.sin(tilt);
        const baseV = pos.length / 3;

        const quad = [
          [-0.5, 0.0, 0, 0],
          [0.5, 0.0, 1, 0],
          [0.5, 1.0, 1, 1],
          [-0.5, 1.0, 0, 1],
        ];
        for (const [qx, qy, u, v] of quad) {
          const lx = qx * w;
          const ly = (qy - 0.2) * h * ct;
          const lz = rOut + (qy - 0.2) * h * st;
          const wx = lx * cy + lz * sy;
          const wy = yOff + ly;
          const wz = -lx * sy + lz * cy;
          pos.push(wx, wy, wz);
          const nl = Math.hypot(wx, wy + 1.1, wz) || 1;
          nrm.push(wx / nl, (wy + 1.1) / nl, wz / nl);
          uvs.push(u, v);
          meta.push(0.62 + frac * 0.38, 0.45 + frac * 0.50, (t * 0.17) % 1);
        }
        idx.push(baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setAttribute('aFolMeta', new THREE.Float32BufferAttribute(meta, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      return g;
    }

    const bambooCenters: Array<[number, number, number, number]> = [
      [-66, -45, 18, 0.0],
      [-37, -45, 16, 0.0],
      [-23, -46, 16, 3.2],
      [35, -45, 18, 2.8],
      [68, -44, 18, 5.2],
    ];
    let totalCulms = 0;
    for (const c of bambooCenters) totalCulms += c[2];
    const bambooInst = new THREE.InstancedMesh(cyl8, mats.bambooCulm, totalCulms);
    const bambooCrownInst = new THREE.InstancedMesh(
      buildBambooCrownGeo(),
      mats.bambooFoliage,
      totalCulms
    );
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const scl = new THREE.Vector3();
    let idx = 0;
    for (let g = 0; g < bambooCenters.length; g++) {
      const [bx, bz, cnt, bY] = bambooCenters[g];
      for (let k = 0; k < cnt; k++) {
        const ang = k * 2.39996 + g;
        const rad = 0.8 + (k / cnt) * 3.8;
        const cx = bx + Math.cos(ang) * rad;
        const cz = bz + Math.sin(ang) * rad;
        const h = 5.8 + ((k * 7 + g * 3) % 5) * 1.05;
        const tiltX = ((k % 3) - 1) * 0.028;
        const tiltZ = ((k % 2) * 2 - 1) * 0.032;

        pos.set(cx, bY + h * 0.5, cz);
        eul.set(tiltX, ang, tiltZ);
        quat.setFromEuler(eul);
        scl.set(0.14, h, 0.14);
        m4.compose(pos, quat, scl);
        bambooInst.setMatrixAt(idx, m4);

        const crownS = 0.96 + ((k * 5 + g) % 4) * 0.14;
        pos.set(cx - tiltZ * h * 0.38, bY + h * 0.80, cz + tiltX * h * 0.38);
        eul.set(tiltX * 1.2, ang * 1.7, tiltZ * 1.2);
        quat.setFromEuler(eul);
        scl.set(crownS, crownS * (0.85 + (h - 5.8) * 0.08), crownS);
        m4.compose(pos, quat, scl);
        bambooCrownInst.setMatrixAt(idx, m4);
        idx++;
      }
    }
    bambooInst.castShadow = true;
    bambooInst.receiveShadow = true;
    bambooInst.instanceMatrix.needsUpdate = true;
    bambooInst.computeBoundingSphere();

    bambooCrownInst.castShadow = true;
    bambooCrownInst.receiveShadow = true;
    bambooCrownInst.instanceMatrix.needsUpdate = true;
    bambooCrownInst.computeBoundingSphere();

    staticGroup.add(bambooInst, bambooCrownInst);
  }

  // =========================================================================
  // 9. TRADITIONAL STONE TORO LANTERNS (`石灯笼`) & SHIMADA CLAN NOBORI BANNERS
  // =========================================================================
  function placeStoneToro(lx: number, lz: number, baseY = 0) {
    const g = new THREE.Group();
    g.position.set(lx, baseY, lz);
    const base = makeMesh(cyl8, mats.graniteSteps);
    base.position.set(0, 0.22, 0);
    base.scale.set(0.68, 0.38, 0.68);
    const shaft = makeMesh(cyl8, mats.graniteSteps);
    shaft.position.set(0, 0.87, 0);
    shaft.scale.set(0.26, 0.90, 0.26);
    const hibukuro = makeMesh(unitBox, mats.warmPaperLantern, false, false);
    hibukuro.position.set(0, 1.50, 0);
    hibukuro.scale.set(0.35, 0.34, 0.35);
    const kasa = makeMesh(cone4, mats.graniteSteps);
    kasa.position.set(0, 1.69, 0);
    kasa.scale.set(0.96, 0.34, 0.96);
    g.add(base, shaft, hibukuro, kasa);
    staticGroup.add(g);
    lanternGlowSources.push({
      x: lx,
      y: baseY + 1.50,
      z: lz,
      radius: 5.2,
      strength: 0.76,
    });
    addBoxCollider(lx - 0.34, baseY, lz - 0.34, lx + 0.34, baseY + 1.95, lz + 0.34, 'concrete');
  }

  for (const [lx, lz, ly] of [
    [-64.0, -5.8, 0.0],
    [-64.0, 5.8, 0.0],
    [-33.5, -5.8, 0.0],
    [-33.5, 5.8, 0.0],
    [-8.5, -6.2, 0.0],
    [-8.5, 6.2, 0.0],
    [14.5, -6.0, 0.0],
    [14.5, 6.0, 0.0],
    [-10.5, 45.5, 0.0],
    [7.5, 45.5, 0.0],
    [-7.5, -33.0, 3.2],
    [27.0, -6.2, 2.8],
    [27.0, 6.2, 2.8],
    [48.5, -6.5, 5.2],
    [48.5, 6.5, 5.2],
  ]) {
    placeStoneToro(lx, lz, ly);
  }

  const bannerMeshes: any[] = [];
  for (const [bx, by, bz, rotY] of [
    [-67.5, 0.0, -6.8, 0],
    [-67.5, 0.0, 6.8, 0],
    [-23.5, 0.0, -6.8, 0],
    [-23.5, 0.0, 6.8, 0],
    [26.0, 2.8, -7.2, 0],
    [26.0, 2.8, 7.2, 0],
    [48.0, 5.2, -7.8, 0],
    [48.0, 5.2, 7.8, 0],
  ]) {
    const staticPoleGrp = new THREE.Group();
    staticPoleGrp.position.set(bx, by, bz);
    staticPoleGrp.rotation.y = rotY;
    const pole = makeMesh(cyl8, mats.bambooCulm);
    pole.position.set(0, 2.42, 0);
    pole.scale.set(0.10, 4.76, 0.10);
    const arm = makeMesh(unitBox, mats.agedHinoki);
    arm.position.set(0.44, 4.65, 0);
    arm.scale.set(0.95, 0.06, 0.06);
    staticPoleGrp.add(pole, arm);
    staticGroup.add(staticPoleGrp);

    const cloth = makeMesh(new THREE.PlaneGeometry(0.82, 2.55, 1, 5), mats.norenIndigo, false, true);
    cloth.position.set(bx + Math.cos(rotY) * 0.44, by + 3.3, bz - Math.sin(rotY) * 0.44);
    cloth.rotation.y = rotY + Math.PI / 2;
    dynGroup.add(cloth);
    bannerMeshes.push(cloth);
  }

  // =========================================================================
  // 10. DRIFTING 3D SAKURA PETALS (`飘落樱吹雪`)
  // =========================================================================
  const PETAL_COUNT = 520;
  const petalShape = new THREE.Shape();
  petalShape.moveTo(0, -0.048);
  petalShape.quadraticCurveTo(0.04, 0.0, 0.015, 0.052);
  petalShape.lineTo(0, 0.034);
  petalShape.lineTo(-0.015, 0.052);
  petalShape.quadraticCurveTo(-0.04, 0.0, 0, -0.048);
  const petalGeo = new THREE.ShapeGeometry(petalShape, 4);
  const matPetal = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffc8da),
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
  const petalInst = new THREE.InstancedMesh(petalGeo, matPetal, PETAL_COUNT);
  petalInst.frustumCulled = false;
  petalInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dynGroup.add(petalInst);

  const petals = Array.from({ length: PETAL_COUNT }, (_, i) => {
    const u1 = (((i * 73856093) >>> 0) % 10000) / 10000;
    const u2 = (((i * 19349663) >>> 0) % 10000) / 10000;
    const u3 = (((i * 83492791) >>> 0) % 10000) / 10000;
    return {
      x: -72 + u1 * 148,
      y: 0.4 + u2 * 18.5,
      z: -50 + u3 * 100,
      speedY: 0.65 + (i % 7) * 0.12,
      phase: i * 0.73,
      scale: 0.8 + (i % 5) * 0.2,
    };
  });

  // =========================================================================
  // 11. THREE HANAMURA BEACON SHRINES (`花村三段镇守烽火台`)
  // =========================================================================
  interface BeaconAnim {
    flame: any;
    ring: any;
    smokeBeam: any;
    armed: boolean;
  }
  const beaconAnims: BeaconAnim[] = [];

  function buildVillageBeaconShrine(sx: number, sy: number, sz: number): any {
    const pedestalGrp = new THREE.Group();
    pedestalGrp.position.set(sx, sy, sz);

    const plinth = makeMesh(tagCylinderUvMode(new THREE.CylinderGeometry(0.68, 0.78, 0.24, 8)), mats.graniteSteps);
    plinth.position.y = 0.14;
    const base = makeMesh(tagCylinderUvMode(new THREE.CylinderGeometry(0.42, 0.54, 0.66, 8)), mats.ishigakiStone);
    base.position.y = 0.60;
    const collar = makeMesh(tagCylinderUvMode(new THREE.CylinderGeometry(0.54, 0.44, 0.13, 8)), mats.graniteSteps);
    collar.position.y = 1.00;
    const ironBasket = makeMesh(tagCylinderUvMode(new THREE.CylinderGeometry(0.50, 0.32, 0.40, 10)), mats.bronzeAged);
    ironBasket.position.y = 1.28;
    const emberBed = makeMesh(
      new THREE.CylinderGeometry(0.40, 0.36, 0.07, 10),
      mats.brazierEmber,
      false,
      false
    );
    emberBed.position.y = 1.44;
    pedestalGrp.add(plinth, base, collar, ironBasket, emberBed);
    staticGroup.add(pedestalGrp);
    lanternGlowSources.push({
      x: sx,
      y: sy + 1.50,
      z: sz,
      radius: 6.2,
      strength: 0.88,
    });

    const grp = new THREE.Group();
    grp.position.set(sx, sy, sz);

    const flameMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xff9c38).multiplyScalar(1.8),
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const flame = makeMesh(new THREE.OctahedronGeometry(0.24, 1), flameMat, false, false);
    flame.scale.set(0.88, 1.92, 0.88);
    flame.position.y = 1.62;

    const ring = makeMesh(
      new THREE.TorusGeometry(0.50, 0.022, 8, 20),
      mats.bronzeAged.clone(),
      false,
      false
    );
    ring.position.y = 1.46;
    ring.rotation.x = Math.PI / 2;

    const signalColumn = makeMesh(
      new THREE.CylinderGeometry(0.16, 0.34, 18, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xff5228),
        transparent: true,
        opacity: 0.36,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
      }),
      false,
      false
    );
    signalColumn.position.y = 10.2;
    signalColumn.visible = false;

    grp.add(flame, ring, signalColumn);
    dynGroup.add(grp);
    addBoxCollider(sx - 0.65, sy, sz - 0.65, sx + 0.65, sy + 1.52, sz + 0.65, 'concrete', {
      tag: 'beacon-shrine',
    });

    const anim: BeaconAnim = { flame, ring, smokeBeam: signalColumn, armed: false };
    beaconAnims.push(anim);

    grp.userData = {
      noMerge: true,
      setState(state: string) {
        const isArmed = state === 'armed';
        anim.armed = isArmed;
        signalColumn.visible = isArmed;
        flame.material.color.setHex(isArmed ? 0xff3b1f : 0xffa63b).multiplyScalar(1.8);
        ring.material.color.setHex(isArmed ? 0xff4628 : 0xe5bd5b);
      },
    };
    return grp;
  }

  const shrineA = buildVillageBeaconShrine(-9.5, 0.0, -5.6);
  const shrineB = buildVillageBeaconShrine(-6.5, 3.2, -35.0);
  const shrineC = buildVillageBeaconShrine(51.5, 5.2, 0.0);

  const objectives = [
    {
      id: 'relay_a',
      label: '甲号据点 · 花村大梵钟阁',
      zone: 'yard',
      pos: new THREE.Vector3(-9.5, 0.0, 0.0),
      object: shrineA,
    },
    {
      id: 'relay_b',
      label: '乙号据点 · 北侧朱漆高廊',
      zone: 'shed',
      pos: new THREE.Vector3(-6.5, 3.2, -35.0),
      object: shrineB,
    },
    {
      id: 'relay_c',
      label: '丙号据点 · 岛田本丸天守',
      zone: 'quay',
      pos: new THREE.Vector3(51.5, 5.2, 0.0),
      object: shrineC,
    },
  ];

  // =========================================================================
  // 12. PLAYER SPAWN, MULTI-TIER ENEMY SPAWNS, ROOFTOP PERCHES & CINEMATIC TOUR
  // =========================================================================
  const playerStart = {
    pos: new THREE.Vector3(-58.0, 0.0, 0.0),
    yaw: -Math.PI / 2, // Faces +X East straight through the iconic Hanamura Choke Gate toward Point A Great Bell, Shimada Castle & Mount Fuji!
  };

  const gSpawn = (x: number, y: number, z: number, zone: string) => ({
    pos: new THREE.Vector3(x, y, z),
    zone,
    type: 'ground',
  });
  const aSpawn = (x: number, y: number, z: number, zone: string) => ({
    pos: new THREE.Vector3(x, y, z),
    zone,
    type: 'air',
  });

  const enemySpawns = [
    // Stage 1: West Ramen & Arcade Plaza + High-Ground Choke Window Galleries (`gate`)
    gSpawn(-41.0, 0.0, -3.5, 'gate'),
    gSpawn(-41.0, 0.0, 3.5, 'gate'),
    gSpawn(-28.0, 0.0, 0.0, 'gate'),     // Right inside the iconic Hanamura Choke Gate!
    gSpawn(-28.0, 3.2, -12.5, 'gate'),   // North High-Ground Choke Window!
    gSpawn(-28.0, 3.2, 12.5, 'gate'),    // South High-Ground Choke Window!
    gSpawn(-50.0, 3.2, 15.5, 'gate'),    // Arcade 2F Balcony!
    aSpawn(-38.0, 10.5, 0.0, 'gate'),
    // Stage 2: Point A Great Bell Courtyard & Cliffside Sakura Promenade (`yard`)
    gSpawn(-13.5, 0.0, -6.5, 'yard'),
    gSpawn(-13.5, 0.0, 6.5, 'yard'),
    gSpawn(8.5, 0.0, -7.5, 'yard'),
    gSpawn(8.5, 0.0, 7.5, 'yard'),
    gSpawn(-2.0, 0.0, 33.5, 'yard'),     // Cliffside Sakura Promenade!
    aSpawn(-2.0, 11.0, -10.0, 'yard'),
    aSpawn(-2.0, 11.0, 12.0, 'yard'),
    // Stage 2 North Cloister High Ground (`shed`, `y = 3.2m`)
    gSpawn(-12.5, 3.2, -34.5, 'shed'),
    gSpawn(6.5, 3.2, -34.5, 'shed'),
    gSpawn(17.5, 3.2, -34.5, 'shed'),
    aSpawn(-2.0, 12.5, -34.0, 'shed'),
    // Stage 3: Point B Castle Garden (`y = 2.8m`) & Shimada Honmaru Dojo (`y = 5.2m`) (`quay`)
    gSpawn(31.5, 2.8, -8.5, 'quay'),
    gSpawn(31.5, 2.8, 8.5, 'quay'),
    gSpawn(33.5, 2.8, 28.0, 'quay'),
    gSpawn(50.5, 5.2, -9.5, 'quay'),
    gSpawn(50.5, 5.2, 9.5, 'quay'),
    gSpawn(59.0, 5.4, 0.0, 'quay'),      // Inside Shimada Dragon-Scroll Dojo!
    aSpawn(38.0, 13.5, 0.0, 'quay'),
  ];

  const coverPoints = [
    new THREE.Vector3(-48.0, 0.0, -4.5),
    new THREE.Vector3(-48.0, 0.0, 4.5),
    new THREE.Vector3(-34.5, 0.0, -4.2),
    new THREE.Vector3(-34.5, 0.0, 4.2),
    new THREE.Vector3(-13.5, 0.0, -5.2),
    new THREE.Vector3(-13.5, 0.0, 5.2),
    new THREE.Vector3(11.5, 0.0, -5.2),
    new THREE.Vector3(11.5, 0.0, 5.2),
    new THREE.Vector3(-6.0, 3.2, -33.5),
    new THREE.Vector3(10.0, 3.2, -33.5),
    new THREE.Vector3(32.5, 2.8, -6.5),
    new THREE.Vector3(32.5, 2.8, 6.5),
    new THREE.Vector3(51.0, 5.2, -7.5),
    new THREE.Vector3(51.0, 5.2, 7.5),
  ];

  // Sweeping Hanamura Mountain Castle Title Camera Tour!
  const cinematicPath = [
    { pos: [-56.0, 2.6, 1.5], look: [-2.0, 6.2, 0.0] },
    { pos: [-20.0, 5.4, 15.0], look: [64.5, 13.5, 0.0] },
    { pos: [-6.0, 4.2, 42.0], look: [152.0, 22.0, 48.0] },
    { pos: [16.0, 6.2, -14.0], look: [64.5, 14.5, 0.0] },
    { pos: [48.0, 8.6, 12.0], look: [280.0, 32.0, -12.0] },
    { pos: [-56.0, 2.6, 1.5], look: [-2.0, 6.2, 0.0] },
  ];

  const interiorBoxes = [
    {
      min: new THREE.Vector3(56.0, 5.2, -9.0),
      max: new THREE.Vector3(73.0, 9.6, 9.0),
    },
  ];

  const zones = [
    { name: 'gate', min: [-72, -50], max: [-24, 50] },
    { name: 'yard', min: [-24, -28], max: [24, 50] },
    { name: 'shed', min: [-24, -50], max: [24, -28] },
    { name: 'quay', min: [24, -50], max: [76, 50] },
  ];

  const sniperPerches = [
    new THREE.Vector3(-28.0, 10.65, 0.0),   // Hanamura Choke Gatehouse apex
    new THREE.Vector3(-28.0, 3.25, -12.8),  // North Choke High-Ground Window
    new THREE.Vector3(-28.0, 3.25, 12.8),   // South Choke High-Ground Window
    new THREE.Vector3(-2.0, 8.95, 0.0),     // Point A Great Bell Pavilion upper roof
    new THREE.Vector3(55.5, 14.0, -35.5),   // North Sumi-Yagura Castle Turret apex
    new THREE.Vector3(56.0, 9.8, 0.0),      // Point B Shimada Tenshu 1st roof west slope
  ];

  const honmaruHearthLight = new THREE.PointLight(0xffad58, 18, 28, 1.8);
  honmaruHearthLight.position.set(63.5, 8.2, 0.0);
  const bellPavilionLight = new THREE.PointLight(0xffa84c, 16, 26, 1.8);
  bellPavilionLight.position.set(-2.0, 4.2, 0.0);
  root.add(honmaruHearthLight, bellPavilionLight);

  // =========================================================================
  // 13. INSTANCED CHOCHIN LANTERNS (`挂檐红提灯` — 2 Draw Calls for All 50+ Lanterns!)
  // =========================================================================
  let chochinBodyInst: any = null;
  let chochinFrameInst: any = null;
  if (staticLanternPlacements.length > 0) {
    const frameParts: Array<{ r: number; h: number; y: number }> = [
      { r: 0.015, h: 0.24, y: -0.12 },
      { r: 0.145, h: 0.045, y: -0.24 },
      { r: 0.135, h: 0.045, y: -0.72 },
    ];
    const fPos: number[] = [];
    const fNrm: number[] = [];
    const fUv: number[] = [];
    const fIdx: number[] = [];
    for (const part of frameParts) {
      const cg = new THREE.CylinderGeometry(part.r, part.r, part.h, 8);
      const pa = cg.getAttribute('position');
      const na = cg.getAttribute('normal');
      const ua = cg.getAttribute('uv');
      const ia = cg.getIndex();
      const vOff = fPos.length / 3;
      for (let i = 0; i < pa.count; i++) {
        fPos.push(pa.getX(i), pa.getY(i) + part.y, pa.getZ(i));
        fNrm.push(na.getX(i), na.getY(i), na.getZ(i));
        fUv.push(ua ? ua.getX(i) : 0, ua ? ua.getY(i) : 0);
      }
      if (ia) {
        for (let i = 0; i < ia.count; i++) fIdx.push(vOff + ia.getX(i));
      }
    }
    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.Float32BufferAttribute(fPos, 3));
    frameGeo.setAttribute('normal', new THREE.Float32BufferAttribute(fNrm, 3));
    frameGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fUv, 2));
    frameGeo.setIndex(fIdx);
    frameGeo.computeBoundingSphere();

    const bodyBaseGeo = tagCylinderUvMode(new THREE.CylinderGeometry(0.18, 0.18, 0.48, 12));
    const bPos = bodyBaseGeo.getAttribute('position');
    for (let i = 0; i < bPos.count; i++) {
      bPos.setY(i, bPos.getY(i) - 0.48);
    }
    bPos.needsUpdate = true;
    bodyBaseGeo.computeBoundingSphere();

    const frameMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x1f1916),
      roughness: 0.78,
      metalness: 0.08,
    });
    chochinFrameInst = new THREE.InstancedMesh(frameGeo, frameMat, staticLanternPlacements.length);
    chochinBodyInst = new THREE.InstancedMesh(bodyBaseGeo, mats.warmPaperLantern, staticLanternPlacements.length);
    chochinFrameInst.frustumCulled = false;
    chochinBodyInst.frustumCulled = false;
    chochinFrameInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    chochinBodyInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dynGroup.add(chochinFrameInst, chochinBodyInst);
  }

  // =========================================================================
  // 14. ANALYTICAL DIRECTIONAL SUN CONTACT-SHADOW MESH (`晴昼飞檐古树投影` — 1 Draw Call!)
  //     Renders crisp-yet-feathered cool-cobalt sun shadows onto plazas & terraces even on CPU SwiftShader!
  // =========================================================================
  {
    const shOffXPerM = -0.76 / 0.62;
    const shOffZPerM = -0.54 / 0.62;

    const sPos: number[] = [];
    const sCol: number[] = [];
    const sIdx: number[] = [];

    function resolveTerraceBounds(x: number, z: number): { surfY: number; minX: number; maxX: number; minZ: number; maxZ: number } {
      if (x >= 46.2) {
        return { surfY: 5.218, minX: 46.3, maxX: 75.8, minZ: -48.6, maxZ: 49.4 };
      }
      if (x >= 24.2) {
        return { surfY: 2.818, minX: 24.3, maxX: 46.0, minZ: -48.6, maxZ: 49.4 };
      }
      if (x > -26.0 && z < -28.0) {
        return { surfY: 3.218, minX: -25.8, maxX: 23.8, minZ: -48.6, maxZ: -28.2 };
      }
      if (x > -22.5 && x < 19.5 && z > 22.4 && z < 27.6) {
        return { surfY: 0.018, minX: -71.5, maxX: 23.8, minZ: -48.6, maxZ: 22.3 };
      }
      return { surfY: 0.018, minX: -71.5, maxX: 23.8, minZ: -48.6, maxZ: 49.4 };
    }

    function pushFeatheredRectShadow(
      minX: number,
      maxX: number,
      minZ: number,
      maxZ: number,
      surfY: number,
      feather: number,
      alphaCore: number
    ) {
      if (maxX - minX < 0.45 || maxZ - minZ < 0.45) return;
      const ix0 = minX + Math.min(feather, (maxX - minX) * 0.35);
      const ix1 = maxX - Math.min(feather, (maxX - minX) * 0.35);
      const iz0 = minZ + Math.min(feather, (maxZ - minZ) * 0.35);
      const iz1 = maxZ - Math.min(feather, (maxZ - minZ) * 0.35);

      const r = 0.05;
      const g = 0.08;
      const b = 0.19;
      const base = sPos.length / 3;
      const pts: Array<[number, number, number]> = [
        [ix0, iz0, alphaCore],
        [ix1, iz0, alphaCore],
        [ix1, iz1, alphaCore],
        [ix0, iz1, alphaCore],
        [minX - feather * 0.6, minZ - feather * 0.6, 0.0],
        [maxX + feather * 0.6, minZ - feather * 0.6, 0.0],
        [maxX + feather * 0.6, maxZ + feather * 0.6, 0.0],
        [minX - feather * 0.6, maxZ + feather * 0.6, 0.0],
      ];
      for (const [px, pz, a] of pts) {
        sPos.push(px, surfY, pz);
        sCol.push(r, g, b, a);
      }
      sIdx.push(base + 0, base + 2, base + 1, base + 0, base + 3, base + 2);
      for (let e = 0; e < 4; e++) {
        const en = (e + 1) % 4;
        const i0 = base + e;
        const i1 = base + en;
        const o0 = base + 4 + e;
        const o1 = base + 4 + en;
        sIdx.push(i0, i1, o1, i0, o1, o0);
      }
    }

    function pushFeatheredDiscShadow(cx: number, cz: number, radX: number, radZ: number, surfY: number, alphaCore: number) {
      const segs = 12;
      const r = 0.05;
      const g = 0.09;
      const b = 0.20;
      const centerV = sPos.length / 3;
      sPos.push(cx, surfY, cz);
      sCol.push(r, g, b, alphaCore);
      const midBase = sPos.length / 3;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        sPos.push(cx + Math.cos(a) * radX * 0.62, surfY, cz + Math.sin(a) * radZ * 0.62);
        sCol.push(r, g, b, alphaCore * 0.78);
      }
      const outBase = sPos.length / 3;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        sPos.push(cx + Math.cos(a) * radX * 1.18, surfY, cz + Math.sin(a) * radZ * 1.18);
        sCol.push(r, g, b, 0.0);
      }
      for (let s = 0; s < segs; s++) {
        const sn = (s + 1) % segs;
        sIdx.push(centerV, midBase + sn, midBase + s);
        sIdx.push(midBase + s, midBase + sn, outBase + sn, midBase + s, outBase + sn, outBase + s);
      }
    }

    for (const rz of roofOverhangZones) {
      const tb = resolveTerraceBounds(rz.cx, rz.cz);
      const hAbove = Math.max(0.8, Math.min(8.5, rz.eaveY - tb.surfY));
      const sx0 = Math.max(tb.minX, Math.min(rz.cx - rz.halfW, rz.cx - rz.halfW + hAbove * shOffXPerM));
      const sx1 = Math.min(tb.maxX, Math.max(rz.cx + rz.halfW * 0.92, rz.cx + rz.halfW + hAbove * shOffXPerM * 0.35));
      const sz0 = Math.max(tb.minZ, Math.min(rz.cz - rz.halfD, rz.cz - rz.halfD + hAbove * shOffZPerM));
      const sz1 = Math.min(tb.maxZ, Math.max(rz.cz + rz.halfD * 0.92, rz.cz + rz.halfD + hAbove * shOffZPerM * 0.35));
      pushFeatheredRectShadow(sx0, sx1, sz0, sz1, tb.surfY, 0.95, 0.34);
    }

    for (const [tx, tz, sc, , , by] of treeCoords) {
      const tb = resolveTerraceBounds(tx, tz);
      if (Math.abs(tb.surfY - by) > 0.6) continue;
      const crownH = 3.6 * sc;
      const projX = Math.max(tb.minX + 1.8, Math.min(tb.maxX - 1.8, tx + crownH * shOffXPerM * 0.72));
      const projZ = Math.max(tb.minZ + 1.8, Math.min(tb.maxZ - 1.8, tz + crownH * shOffZPerM * 0.72));
      pushFeatheredDiscShadow(projX, projZ, 3.3 * sc, 2.9 * sc, tb.surfY, 0.30);
    }

    if (sPos.length > 0) {
      const shadowGeo = new THREE.BufferGeometry();
      shadowGeo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
      shadowGeo.setAttribute('color', new THREE.Float32BufferAttribute(sCol, 4));
      shadowGeo.setIndex(sIdx);
      shadowGeo.computeBoundingSphere();

      const shadowMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
        toneMapped: false,
      });
      const sunShadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
      sunShadowMesh.name = 'hanamura-directional-sun-shadows';
      sunShadowMesh.renderOrder = 1;
      sunShadowMesh.userData = { noMerge: true };
      dynGroup.add(sunShadowMesh);
    }
  }

  // =========================================================================
  // 15. PRE-MERGE COPLANAR FACE AUDIT SNAPSHOT + STATIC / DESTRUCTIBLE BATCHING
  //     Merges ~1,350 static world meshes down to ~18 material batches while baking
  //     3D eave/corner Ambient Occlusion (`aArchOcc`) and Warm Lantern Radiosity (`aWarmGlow`)!
  // =========================================================================
  interface PlanarFaceRecord {
    matKey: string;
    axis: 0 | 1 | 2;
    sign: 1 | -1;
    plane: number;
    minU: number;
    maxU: number;
    minV: number;
    maxV: number;
    area: number;
  }
  const planarFaces: PlanarFaceRecord[] = [];
  const matToKey = new Map<any, string>();
  for (const [k, v] of Object.entries(mats)) {
    if (v && typeof v === 'object' && (v as any).isMaterial) {
      matToKey.set(v, k);
    }
  }

  root.updateMatrixWorld(true);

  {
    const fCenter = new THREE.Vector3();
    const fNormal = new THREE.Vector3();
    const nrmMat3 = new THREE.Matrix3();
    const boxFaceDefs: Array<{ n: [number, number, number]; uAxis: 0 | 1 | 2; vAxis: 0 | 1 | 2 }> = [
      { n: [1, 0, 0], uAxis: 1, vAxis: 2 },
      { n: [-1, 0, 0], uAxis: 1, vAxis: 2 },
      { n: [0, 1, 0], uAxis: 0, vAxis: 2 },
      { n: [0, -1, 0], uAxis: 0, vAxis: 2 },
      { n: [0, 0, 1], uAxis: 0, vAxis: 1 },
      { n: [0, 0, -1], uAxis: 0, vAxis: 1 },
    ];
    const corner = new THREE.Vector3();

    staticGroup.traverse((obj: any) => {
      if (!obj.isMesh || obj.isInstancedMesh || !obj.visible) return;
      const matKey = matToKey.get(obj.material) || obj.material?.uuid || 'unknown';
      nrmMat3.getNormalMatrix(obj.matrixWorld);

      if (obj.geometry === unitBox) {
        fNormal.set(1, 0, 0).applyMatrix3(nrmMat3).normalize();
        const axAlignedX =
          Math.abs(fNormal.x) > 0.998 || Math.abs(fNormal.y) > 0.998 || Math.abs(fNormal.z) > 0.998;
        fNormal.set(0, 1, 0).applyMatrix3(nrmMat3).normalize();
        const axAlignedY =
          Math.abs(fNormal.x) > 0.998 || Math.abs(fNormal.y) > 0.998 || Math.abs(fNormal.z) > 0.998;
        if (!axAlignedX || !axAlignedY) return;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (const cx of [-0.5, 0.5]) {
          for (const cy of [-0.5, 0.5]) {
            for (const cz of [-0.5, 0.5]) {
              corner.set(cx, cy, cz).applyMatrix4(obj.matrixWorld);
              minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
              minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
              minZ = Math.min(minZ, corner.z); maxZ = Math.max(maxZ, corner.z);
            }
          }
        }
        const mins = [minX, minY, minZ];
        const maxs = [maxX, maxY, maxZ];
        for (const fd of boxFaceDefs) {
          fCenter.set(fd.n[0] * 0.5, fd.n[1] * 0.5, fd.n[2] * 0.5).applyMatrix4(obj.matrixWorld);
          fNormal.set(fd.n[0], fd.n[1], fd.n[2]).applyMatrix3(nrmMat3).normalize();
          const axis: 0 | 1 | 2 =
            Math.abs(fNormal.x) > 0.9 ? 0 : Math.abs(fNormal.y) > 0.9 ? 1 : 2;
          const sign: 1 | -1 = (axis === 0 ? fNormal.x : axis === 1 ? fNormal.y : fNormal.z) >= 0 ? 1 : -1;
          const uAx: 0 | 1 | 2 = axis === 0 ? 1 : 0;
          const vAx: 0 | 1 | 2 = axis === 2 ? 1 : 2;
          const area = (maxs[uAx] - mins[uAx]) * (maxs[vAx] - mins[vAx]);
          if (area < 0.25) continue;
          planarFaces.push({
            matKey,
            axis,
            sign,
            plane: axis === 0 ? fCenter.x : axis === 1 ? fCenter.y : fCenter.z,
            minU: mins[uAx],
            maxU: maxs[uAx],
            minV: mins[vAx],
            maxV: maxs[vAx],
            area,
          });
        }
      }
    });
  }

  function evaluateVertexArchOcc(wx: number, wy: number, wz: number, wny: number): number {
    let occ = 0.0;
    for (const ty of [0.0, 2.8, 3.2, 5.2]) {
      const dy = wy - ty;
      if (dy >= -0.05 && dy < 0.95 && wny < 0.85) {
        const contact = (1.0 - Math.max(0, dy) / 0.95) * 0.26;
        occ = Math.max(occ, contact);
      }
    }
    for (let i = 0; i < roofOverhangZones.length; i++) {
      const r = roofOverhangZones[i];
      const dx = Math.abs(wx - r.cx) - r.halfW;
      const dz = Math.abs(wz - r.cz) - r.halfD;
      if (dx < 0.35 && dz < 0.35 && wy < r.eaveY + 0.08 && wy > r.eaveY - 2.35) {
        const vertT = 1.0 - Math.max(0, r.eaveY - wy) / 2.35;
        const horizT = Math.min(1.0, Math.max(0.0, -Math.max(dx, dz) / 0.85 + 0.35));
        const downBias = wny < -0.2 ? 1.25 : 1.0;
        occ = Math.max(occ, vertT * horizT * 0.48 * downBias);
      }
    }
    return Math.min(0.62, occ);
  }

  function evaluateVertexWarmGlow(wx: number, wy: number, wz: number): number {
    let glow = 0.0;
    for (let i = 0; i < lanternGlowSources.length; i++) {
      const ls = lanternGlowSources[i];
      const dx = wx - ls.x;
      const dy = wy - ls.y;
      const dz = wz - ls.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const r2 = ls.radius * ls.radius;
      if (d2 < r2) {
        const falloff = 1.0 - Math.sqrt(d2) / ls.radius;
        glow += falloff * falloff * ls.strength;
      }
    }
    return Math.min(1.35, glow);
  }

  function batchGroupByMaterial(
    targetGroup: any,
    opts: { bakeArchLighting?: boolean } = {}
  ): { preMeshes: number; postBatches: number } {
    targetGroup.updateMatrixWorld(true);
    const invTarget = targetGroup.matrixWorld.clone().invert();

    interface CandidateMesh {
      mesh: any;
      relMat: any;
      worldMat: any;
    }
    const byMat = new Map<any, CandidateMesh[]>();
    const preserveInstanced: any[] = [];
    let preMeshes = 0;

    targetGroup.traverse((obj: any) => {
      if (obj === targetGroup) return;
      if (obj.userData?.noMerge) return;
      if (obj.isInstancedMesh) {
        preserveInstanced.push(obj);
        return;
      }
      if (!obj.isMesh || !obj.geometry || !obj.material || Array.isArray(obj.material)) return;
      preMeshes++;
      const relMat = invTarget.clone().multiply(obj.matrixWorld);
      let list = byMat.get(obj.material);
      if (!list) {
        list = [];
        byMat.set(obj.material, list);
      }
      list.push({ mesh: obj, relMat, worldMat: obj.matrixWorld.clone() });
    });

    if (preMeshes <= 1) {
      return { preMeshes, postBatches: preMeshes };
    }

    for (const inst of preserveInstanced) {
      if (inst.parent !== targetGroup) {
        const rel = invTarget.clone().multiply(inst.matrixWorld);
        inst.matrix.copy(rel);
        inst.matrix.decompose(inst.position, inst.quaternion, inst.scale);
        targetGroup.add(inst);
      }
    }
    for (let i = targetGroup.children.length - 1; i >= 0; i--) {
      const ch = targetGroup.children[i];
      if (ch.isInstancedMesh || ch.userData?.noMerge) continue;
      targetGroup.remove(ch);
    }

    const vPos = new THREE.Vector3();
    const vWorld = new THREE.Vector3();
    const vNrm = new THREE.Vector3();
    const vWorldNrm = new THREE.Vector3();
    const relNrmMat = new THREE.Matrix3();
    const worldNrmMat = new THREE.Matrix3();

    let postBatches = 0;
    for (const [mat, entries] of byMat.entries()) {
      let totalVerts = 0;
      let totalIndices = 0;
      for (const e of entries) {
        const g = e.mesh.geometry;
        const pAttr = g.getAttribute('position');
        if (!pAttr) continue;
        totalVerts += pAttr.count;
        const idx = g.getIndex();
        totalIndices += idx ? idx.count : pAttr.count;
      }
      if (totalVerts === 0) continue;

      const outPos = new Float32Array(totalVerts * 3);
      const outNrm = new Float32Array(totalVerts * 3);
      const outUv = new Float32Array(totalVerts * 2);
      const outMode = new Float32Array(totalVerts);
      const outOcc = new Float32Array(totalVerts);
      const outGlow = new Float32Array(totalVerts);
      const outIdx = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

      let vCursor = 0;
      let iCursor = 0;
      let anyCast = false;
      let anyReceive = false;

      for (const e of entries) {
        const g = e.mesh.geometry;
        const pAttr = g.getAttribute('position');
        if (!pAttr) continue;
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        const nAttr = g.getAttribute('normal');
        const uAttr = g.getAttribute('uv');
        const mAttr = g.getAttribute('aUvMode');

        if (e.mesh.castShadow) anyCast = true;
        if (e.mesh.receiveShadow) anyReceive = true;

        const me = e.relMat.elements;
        const sx = Math.hypot(me[0], me[1], me[2]);
        const sy = Math.hypot(me[4], me[5], me[6]);
        const sz = Math.hypot(me[8], me[9], me[10]);
        const flipWinding = e.relMat.determinant() < 0;

        relNrmMat.getNormalMatrix(e.relMat);
        worldNrmMat.getNormalMatrix(e.worldMat);

        for (let vi = 0; vi < pAttr.count; vi++) {
          const dst = vCursor + vi;
          vPos.set(pAttr.getX(vi), pAttr.getY(vi), pAttr.getZ(vi)).applyMatrix4(e.relMat);
          outPos[dst * 3] = vPos.x;
          outPos[dst * 3 + 1] = vPos.y;
          outPos[dst * 3 + 2] = vPos.z;

          if (nAttr) {
            vNrm.set(nAttr.getX(vi), nAttr.getY(vi), nAttr.getZ(vi)).applyMatrix3(relNrmMat).normalize();
          } else {
            vNrm.set(0, 1, 0);
          }
          outNrm[dst * 3] = vNrm.x;
          outNrm[dst * 3 + 1] = vNrm.y;
          outNrm[dst * 3 + 2] = vNrm.z;

          let u = uAttr ? uAttr.getX(vi) : 0;
          let v = uAttr ? uAttr.getY(vi) : 0;
          const srcMode = mAttr ? mAttr.getX(vi) : 0;
          let bakedMode = 0.0;

          if (srcMode > 3.5) {
            if (Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01 || Math.abs(sz - 1) > 0.01) {
              u *= 0.5 * (sx + sz);
              v *= Math.hypot(0.5 * sx, sy) / Math.hypot(0.5, 1.0);
            }
            bakedMode = 4.0;
          } else if (srcMode > 2.5) {
            u = u * Math.PI * 0.5 * (sx + sz);
            v = v * sy;
            bakedMode = 4.0;
          } else if (srcMode > 1.5) {
            u = u * sz;
            v = v * Math.hypot(0.5 * sx, sy);
            bakedMode = 4.0;
          } else if (srcMode > 0.5) {
            u = u * sx;
            v = v * Math.hypot(0.5 * sz, sy);
            bakedMode = 4.0;
          } else {
            bakedMode = 0.0;
          }
          outUv[dst * 2] = u;
          outUv[dst * 2 + 1] = v;
          outMode[dst] = bakedMode;

          if (opts.bakeArchLighting) {
            vWorld.set(pAttr.getX(vi), pAttr.getY(vi), pAttr.getZ(vi)).applyMatrix4(e.worldMat);
            if (nAttr) {
              vWorldNrm.set(nAttr.getX(vi), nAttr.getY(vi), nAttr.getZ(vi)).applyMatrix3(worldNrmMat).normalize();
            } else {
              vWorldNrm.set(0, 1, 0);
            }
            outOcc[dst] = evaluateVertexArchOcc(vWorld.x, vWorld.y, vWorld.z, vWorldNrm.y);
            outGlow[dst] = evaluateVertexWarmGlow(vWorld.x, vWorld.y, vWorld.z);
          }
        }

        const idxAttr = g.getIndex();
        if (idxAttr) {
          for (let ii = 0; ii < idxAttr.count; ii += 3) {
            const a = vCursor + idxAttr.getX(ii);
            const b = vCursor + idxAttr.getX(ii + 1);
            const c = vCursor + idxAttr.getX(ii + 2);
            if (flipWinding) {
              outIdx[iCursor++] = a;
              outIdx[iCursor++] = c;
              outIdx[iCursor++] = b;
            } else {
              outIdx[iCursor++] = a;
              outIdx[iCursor++] = b;
              outIdx[iCursor++] = c;
            }
          }
        } else {
          for (let ii = 0; ii < pAttr.count; ii += 3) {
            const a = vCursor + ii;
            const b = vCursor + ii + 1;
            const c = vCursor + ii + 2;
            if (flipWinding) {
              outIdx[iCursor++] = a;
              outIdx[iCursor++] = c;
              outIdx[iCursor++] = b;
            } else {
              outIdx[iCursor++] = a;
              outIdx[iCursor++] = b;
              outIdx[iCursor++] = c;
            }
          }
        }

        vCursor += pAttr.count;
      }

      const mergedGeo = new THREE.BufferGeometry();
      mergedGeo.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
      mergedGeo.setAttribute('normal', new THREE.BufferAttribute(outNrm, 3));
      mergedGeo.setAttribute('uv', new THREE.BufferAttribute(outUv, 2));
      mergedGeo.setAttribute('aUvMode', new THREE.BufferAttribute(outMode, 1));
      mergedGeo.setAttribute('aArchOcc', new THREE.BufferAttribute(outOcc, 1));
      mergedGeo.setAttribute('aWarmGlow', new THREE.BufferAttribute(outGlow, 1));
      mergedGeo.setIndex(new THREE.BufferAttribute(outIdx, 1));
      mergedGeo.computeBoundingSphere();
      mergedGeo.computeBoundingBox();

      const mergedMesh = new THREE.Mesh(mergedGeo, mat);
      mergedMesh.castShadow = anyCast;
      mergedMesh.receiveShadow = anyReceive;
      targetGroup.add(mergedMesh);
      postBatches++;
    }

    return { preMeshes, postBatches };
  }

  const staticBatchStats = batchGroupByMaterial(staticGroup, { bakeArchLighting: true });
  batchGroupByMaterial(waterwheelGroup, { bakeArchLighting: false });
  for (const d of destructibles) {
    batchGroupByMaterial(d.intactGroup, { bakeArchLighting: true });
    batchGroupByMaterial(d.damagedGroup, { bakeArchLighting: false });
    batchGroupByMaterial(d.ruinGroup, { bakeArchLighting: false });
  }

  let postMergeDrawCalls = 0;
  let instancedMeshCount = 0;
  let totalInstances = 0;
  let totalTriangles = 0;
  root.traverseVisible((obj: any) => {
    if (!obj.isMesh) return;
    postMergeDrawCalls++;
    const idx = obj.geometry?.getIndex();
    const pos = obj.geometry?.getAttribute('position');
    const meshTris = idx ? idx.count / 3 : pos ? pos.count / 3 : 0;
    if (obj.isInstancedMesh) {
      instancedMeshCount++;
      const cnt = typeof obj.count === 'number' ? obj.count : 0;
      totalInstances += cnt;
      totalTriangles += meshTris * cnt;
    } else {
      totalTriangles += meshTris;
    }
  });

  let groundUpgraded = false;
  let elapsed = 0;
  const _pPos = new THREE.Vector3();
  const _pQuat = new THREE.Quaternion();
  const _pEul = new THREE.Euler();
  const _pScale = new THREE.Vector3();
  const _pMat = new THREE.Matrix4();

  function update(dt: number) {
    if (G.ground) {
      if (!groundUpgraded && G.ground.apron) {
        groundUpgraded = true;
        applyClassicalVillageGround(G, mats);
      }
      if (G.ground.setRain) G.ground.setRain(0);
      if (G.ground.rain) G.ground.rain.visible = false;
      if (G.ground.splash) G.ground.splash.visible = false;
    }

    if (physicsRebuildQueued && G.physics?.build) {
      physicsRebuildQueued = false;
      try {
        G.physics.build();
      } catch {
        // ignore nav rebuild edge case
      }
    }

    elapsed += dt;
    mats.update(dt);

    // 1. Rotate the Garden Stream Waterwheel (`庭院水车`) smoothly!
    waterwheelGroup.rotation.z = -elapsed * 0.85;

    // 2. Animate 520 Drifting Sakura Petals across Hanamura!
    for (let i = 0; i < PETAL_COUNT; i++) {
      const p = petals[i];
      let py = p.y - elapsed * p.speedY;
      py = (((py % 13.5) + 13.5) % 13.5) + 0.15;
      const swayX = Math.sin(elapsed * 1.35 + p.phase) * 1.4 + elapsed * 0.55;
      const swayZ = Math.cos(elapsed * 1.1 + p.phase * 1.3) * 1.15;
      const px = -76 + ((((p.x + 76 + swayX) % 156) + 156) % 156);
      const pz = -54 + ((((p.z + 54 + swayZ) % 108) + 108) % 108);

      _pPos.set(px, py, pz);
      _pEul.set(
        elapsed * 2.1 + p.phase,
        elapsed * 1.6 + p.phase * 0.7,
        Math.sin(elapsed * 2.7 + p.phase) * 0.85
      );
      _pQuat.setFromEuler(_pEul);
      _pScale.setScalar(p.scale);
      _pMat.compose(_pPos, _pQuat, _pScale);
      petalInst.setMatrixAt(i, _pMat);
    }
    petalInst.instanceMatrix.needsUpdate = true;

    // 3. Gentle mountain breeze on Instanced Chochin Lanterns, Destructible Lanterns & Clan Banners
    if (chochinFrameInst && chochinBodyInst) {
      for (let i = 0; i < staticLanternPlacements.length; i++) {
        const lp = staticLanternPlacements[i];
        _pPos.set(lp.x, lp.y, lp.z);
        _pEul.set(
          Math.cos(elapsed * 1.6 + lp.phase) * 0.042,
          0,
          Math.sin(elapsed * 2.0 + lp.phase * 1.3) * 0.055
        );
        _pQuat.setFromEuler(_pEul);
        _pScale.setScalar(lp.scale);
        _pMat.compose(_pPos, _pQuat, _pScale);
        chochinFrameInst.setMatrixAt(i, _pMat);
        chochinBodyInst.setMatrixAt(i, _pMat);
      }
      chochinFrameInst.instanceMatrix.needsUpdate = true;
      chochinBodyInst.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < swayLanterns.length; i++) {
      swayLanterns[i].rotation.z = Math.sin(elapsed * 2.0 + i * 0.9) * 0.055;
      swayLanterns[i].rotation.x = Math.cos(elapsed * 1.6 + i * 0.6) * 0.04;
    }
    for (let b = 0; b < bannerMeshes.length; b++) {
      bannerMeshes[b].rotation.x = Math.sin(elapsed * 2.4 + b * 1.1) * 0.09;
      bannerMeshes[b].rotation.z = Math.cos(elapsed * 1.8 + b * 0.7) * 0.05;
    }

    // 4. Flicker Beacon Shrine Brazier Flames
    for (let s = 0; s < beaconAnims.length; s++) {
      const ba = beaconAnims[s];
      const fScale = 0.92 + Math.sin(elapsed * 13.5 + s * 2.1) * 0.14;
      ba.flame.scale.set(fScale, (ba.armed ? 2.35 : 1.92) * fScale, fScale);
      ba.ring.rotation.z = elapsed * (ba.armed ? 3.2 : 0.9);
    }

    // 5. Step Pooled 3D Ballistic Building Debris (`木梁碎块 · 熏瓦碎片 · 障子和纸`)!
    const counts = [0, 0, 0];
    for (let i = 0; i < debrisList.length; i++) {
      const d = debrisList[i];
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        continue;
      }
      const grav = d.pool === 2 ? 5.5 : 17.5;
      d.vy -= grav * dt;
      if (d.pool === 2) {
        d.vx *= Math.max(0, 1 - 2.4 * dt);
        d.vz *= Math.max(0, 1 - 2.4 * dt);
      }
      d.px += d.vx * dt;
      d.py += d.vy * dt;
      d.pz += d.vz * dt;
      if (d.py < 0.06) {
        d.py = 0.06;
        d.vy = Math.abs(d.vy) * 0.36;
        d.vx *= 0.68;
        d.vz *= 0.68;
        d.vrx *= 0.6;
        d.vry *= 0.6;
        d.vrz *= 0.6;
      }
      d.rx += d.vrx * dt;
      d.ry += d.vry * dt;
      d.rz += d.vrz * dt;

      const slotIdx = counts[d.pool];
      if (slotIdx < DEBRIS_PER_POOL) {
        const shrink = Math.min(1, d.life * 2.5);
        _pPos.set(d.px, d.py, d.pz);
        _pEul.set(d.rx, d.ry, d.rz);
        _pQuat.setFromEuler(_pEul);
        _pScale.set(d.sx * shrink, d.sy * shrink, d.sz * shrink);
        _pMat.compose(_pPos, _pQuat, _pScale);
        debrisPools[d.pool].setMatrixAt(slotIdx, _pMat);
        counts[d.pool]++;
      }
    }
    for (let p = 0; p < 3; p++) {
      debrisPools[p].count = counts[p];
      debrisPools[p].instanceMatrix.needsUpdate = true;
    }
  }

  update(0.016);

  return {
    root,
    materials: mats,
    destructibles,
    raycastDestructible,
    damageDestructible,
    damageInRadius,
    playerStart,
    objectives,
    extraction: { pos: new THREE.Vector3(64.5, 5.2, 0), radius: 3.5 },
    bossBells: [
      new THREE.Vector3(-2.0, 2.2, 0.0),     // Point A Great Bell Pavilion!
      new THREE.Vector3(-2.0, 4.8, -41.5),   // North Cloister Bell Shrine!
    ],
    enemySpawns,
    zones,
    interiorBoxes,
    cinematicPath,
    coverPoints,
    skylights: [],
    shedLights: [honmaruHearthLight, bellPavilionLight],
    vantage: {
      stairsFoot: new THREE.Vector3(18.0, 0, 0),
      roof: new THREE.Vector3(56.0, 9.8, 0),
    },
    sniperPerches,
    qaArchitecture: {
      preMergeStaticMeshes: staticBatchStats.preMeshes,
      postMergeStaticBatches: staticBatchStats.postBatches,
      postMergeDrawCalls,
      instancedMeshCount,
      totalInstances,
      totalTriangles: Math.round(totalTriangles),
      staircases: staircaseRecords,
      planarFaces,
      lanternGlowCount: lanternGlowSources.length,
      roofOverhangCount: roofOverhangZones.length,
    },
    stats: {
      labelsAtlased: 0,
      containers: 0,
      props: destructibles.length + treeCoords.length,
      tris: Math.round(totalTriangles),
      meshes: postMergeDrawCalls,
    },
    placed: [],
    groundSurfaceAt(x: number, z: number) {
      if (x > -22.5 && x < 19.5 && Math.abs(z - 25.0) < 2.4 && Math.abs(x - -1.5) > 3.4) {
        return 'water';
      }
      if (Math.abs(x - -1.5) <= 3.5 && Math.abs(z - 25.0) < 3.4) return 'wood';
      return 'concrete';
    },
    update,
  };
}

/**
 * 100% Pure Classical Japanese Mountain-Valley Horizon Backdrop (`灵峰富士 · 三重连绵群峰 · 断崖古寺五重塔 · 山间流云 · 篝火渔舟`):
 * Zero low-poly cones, zero grey dodecahedron balls, and zero cyberpunk elements!
 */
export async function createShimadaBackdrop(G: any): Promise<any> {
  const THREE = G.THREE;
  const root = new THREE.Group();
  root.name = 'backdrop-classical-japan-horizon';
  G.scene.add(root);

  const sunDir = new THREE.Vector3(0.76, 0.36, 0.54).normalize();

  function ridgedWave(theta: number, freq: number, phase: number): number {
    const s = Math.sin(theta * freq + phase);
    const c = Math.cos(theta * (freq * 0.618 + 1) - phase * 0.73);
    const r = 1.0 - Math.abs(s * 0.72 + c * 0.28);
    return r * r;
  }

  function sampleMountainRingHeight(
    uRad: number,
    theta: number,
    seed: number,
    maxH: number,
    lakePassDepth: number,
    fujiWindowDip: number
  ): number {
    const ridgeArch = Math.sin(Math.pow(uRad, 0.78) * Math.PI);
    const spurShift = (uRad - 0.5) * 0.42;

    const r1 = ridgedWave(theta + spurShift * 0.35, 5, seed * 1.13);
    const r2 = ridgedWave(theta - spurShift * 0.65, 11, seed * 2.41 + 1.2);
    const r3 = ridgedWave(theta + spurShift * 1.15, 23, seed * 3.87 + 2.7);
    const r4 = ridgedWave(theta - spurShift * 1.65, 41, seed * 5.19 + 0.6);

    const macroSaddle = 0.62 + 0.38 * Math.sin(theta * 3 + seed * 0.9);
    let h = maxH * ridgeArch * macroSaddle * (0.48 * r1 + 0.29 * r2 + 0.15 * r3 + 0.08 * r4);

    const spur = Math.sin((1 - uRad) * Math.PI) * ridgedWave(theta, 15, seed * 4.1) * maxH * 0.24;
    h += spur * Math.max(0, 1 - uRad * 1.35);

    // Eastern Caldera Lake & Fuji Vista Pass (`theta ≈ 0`, East `+X`)
    const eastDist = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta)));
    if (lakePassDepth > 0) {
      const passOpen = 1.0 - Math.min(1, Math.max(0, (eastDist - 0.30) / 0.26));
      const smoothPass = passOpen * passOpen * (3 - 2 * passOpen);
      h = h * (1 - smoothPass) - lakePassDepth * smoothPass;
    }

    // Lower distant ridges directly along Mount Fuji sightline (`theta ≈ -0.045`) so Fuji dominates the eastern sky!
    if (fujiWindowDip > 0) {
      const fujiDelta = Math.abs(Math.atan2(Math.sin(theta + 0.045), Math.cos(theta + 0.045)));
      const dipT = 1.0 - Math.min(1, Math.max(0, (fujiDelta - 0.16) / 0.30));
      const smoothDip = dipT * dipT * (3 - 2 * dipT);
      h *= 1.0 - fujiWindowDip * smoothDip;
    }

    const edgeSink =
      uRad < 0.08
        ? -3.6 * (1 - uRad / 0.08)
        : uRad > 0.90
        ? -4.5 * ((uRad - 0.90) / 0.10)
        : 0;

    return h + edgeSink;
  }

  function createSculptedMountainRingGeo(opts: {
    rInner: number;
    rOuter: number;
    segTheta: number;
    segRad: number;
    seed: number;
    maxH: number;
    lakePassDepth: number;
    fujiWindowDip: number;
  }): any {
    const { rInner, rOuter, segTheta, segRad, seed, maxH, lakePassDepth, fujiWindowDip } = opts;
    const cols = segTheta + 1;
    const rows = segRad + 1;
    const pos = new Float32Array(cols * rows * 3);
    const uvs = new Float32Array(cols * rows * 2);
    const meta = new Float32Array(cols * rows * 2);
    const indices: number[] = [];

    for (let ir = 0; ir <= segRad; ir++) {
      const u = ir / segRad;
      const rad = rInner + (rOuter - rInner) * u;
      for (let it = 0; it <= segTheta; it++) {
        const tWrap = (it % segTheta) / segTheta;
        const theta = tWrap * Math.PI * 2 - Math.PI;
        const h = sampleMountainRingHeight(u, theta, seed, maxH, lakePassDepth, fujiWindowDip);

        const vi = ir * cols + it;
        pos[vi * 3] = Math.cos(theta) * rad;
        pos[vi * 3 + 1] = h;
        pos[vi * 3 + 2] = Math.sin(theta) * rad;

        uvs[vi * 2] = (it / segTheta) * 16.0;
        uvs[vi * 2 + 1] = u * 4.0;
        meta[vi * 2] = Math.max(0, Math.min(1, h / Math.max(1, maxH)));
        meta[vi * 2 + 1] = u;
      }
    }

    for (let ir = 0; ir < segRad; ir++) {
      for (let it = 0; it < segTheta; it++) {
        const a = ir * cols + it;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setAttribute('aMtnMeta', new THREE.BufferAttribute(meta, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    const nAttr = g.getAttribute('normal');
    for (let ir = 0; ir <= segRad; ir++) {
      const i0 = ir * cols;
      const iLast = ir * cols + segTheta;
      nAttr.setXYZ(iLast, nAttr.getX(i0), nAttr.getY(i0), nAttr.getZ(i0));
    }
    nAttr.needsUpdate = true;
    g.computeBoundingSphere();
    return g;
  }

  function createMountainLayerMaterial(opts: {
    forestLow: [number, number, number];
    forestHigh: [number, number, number];
    rockCol: [number, number, number];
    autumnAccent: number;
    hazeCol: [number, number, number];
    hazeStrength: number;
    mistTopY: number;
    cacheKey: string;
  }): any {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      roughness: 0.93,
      metalness: 0.02,
      fog: false,
    });
    mat.onBeforeCompile = (shader: any) => {
      shader.uniforms.uMtnSun = { value: sunDir };
      shader.uniforms.uForestLow = { value: new THREE.Color(...opts.forestLow) };
      shader.uniforms.uForestHigh = { value: new THREE.Color(...opts.forestHigh) };
      shader.uniforms.uRockCol = { value: new THREE.Color(...opts.rockCol) };
      shader.uniforms.uHazeCol = { value: new THREE.Color(...opts.hazeCol) };

      shader.vertexShader =
        `attribute vec2 aMtnMeta;
         varying vec3 vMtnWorldPos;
         varying vec3 vMtnWorldNrm;
         varying vec2 vMtnMeta;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vMtnMeta = aMtnMeta;
           vMtnWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vMtnWorldNrm = normalize(mat3(modelMatrix) * objectNormal);`
        );

      shader.fragmentShader =
        `uniform vec3 uMtnSun;
         uniform vec3 uForestLow;
         uniform vec3 uForestHigh;
         uniform vec3 uRockCol;
         uniform vec3 uHazeCol;
         varying vec3 vMtnWorldPos;
         varying vec3 vMtnWorldNrm;
         varying vec2 vMtnMeta;\n` +
        shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             {
               vec3 wn = normalize(vMtnWorldNrm);
               float n1 = sin(vMtnWorldPos.x * 0.085 + cos(vMtnWorldPos.z * 0.075) * 2.2) * 0.5 + 0.5;
               float n2 = cos(vMtnWorldPos.z * 0.19 - sin(vMtnWorldPos.x * 0.17) * 1.8) * 0.5 + 0.5;
               // High-frequency 3D cedar/pine forest crown cellular texture
               float crownA = sin(vMtnWorldPos.x * 0.72 + sin(vMtnWorldPos.z * 0.68) * 1.9)
                            * cos(vMtnWorldPos.z * 0.76 - cos(vMtnWorldPos.x * 0.64) * 1.7);
               float crownB = sin(vMtnWorldPos.x * 1.85 + vMtnWorldPos.y * 0.9) * cos(vMtnWorldPos.z * 1.92 - vMtnWorldPos.y * 0.7);
               float crownBump = crownA * 0.65 + crownB * 0.35;
               float crownShade = clamp(0.72 + crownBump * 0.38, 0.38, 1.18);

               float strata = sin(vMtnWorldPos.y * 0.95 + n2 * 3.6 + crownB * 0.8) * 0.5 + 0.5;

               vec3 canopy = mix(uForestLow, uForestHigh, clamp(vMtnMeta.x * 0.65 + n1 * 0.35, 0.0, 1.0)) * crownShade;
               float momijiPatch = smoothstep(0.66, 0.89, n1 * 0.62 + n2 * 0.38) * (1.0 - smoothstep(0.58, 0.86, vMtnMeta.x));
               canopy = mix(canopy, vec3(0.84, 0.36, 0.42) * crownShade, momijiPatch * ${opts.autumnAccent.toFixed(3)});

               float cliffMask = 1.0 - smoothstep(0.45, 0.74, wn.y + (n2 - 0.5) * 0.18);
               vec3 rock = uRockCol * (0.76 + strata * 0.40);
               vec3 surf = mix(canopy, rock, cliffMask);

               vec3 bumpedN = normalize(wn + vec3(crownA * 0.24, 0.0, crownB * 0.24) * (1.0 - cliffMask));
               float sunFace = max(0.0, dot(bumpedN, uMtnSun));
               surf += vec3(0.18, 0.14, 0.08) * pow(sunFace, 2.0) * smoothstep(0.16, 0.84, vMtnMeta.x);

               diffuseColor.rgb = surf;
             }`
          )
          .replace(
            '#include <tonemapping_fragment>',
            `{
               float valleyMist = 1.0 - smoothstep(-2.2, ${opts.mistTopY.toFixed(1)}, vMtnWorldPos.y);
               vec3 mistCol = mix(uHazeCol, vec3(0.28, 0.40, 0.66), 0.38);
               gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeCol, ${opts.hazeStrength.toFixed(3)});
               gl_FragColor.rgb = mix(gl_FragColor.rgb, mistCol, valleyMist * 0.26);
             }
             #include <tonemapping_fragment>`
          );
    };
    mat.customProgramCacheKey = () => `hanamura-mtn-ring-stylized-v4-${opts.cacheKey}`;
    return mat;
  }

  // =========================================================================
  // 1. SCULPTED CONCAVE CATENARY MOUNT FUJI (`灵峰富士` — Single-Piece Custom Volcanic Mesh!)
  // =========================================================================
  {
    const fujiSegTheta = 72;
    const fujiSegRad = 30;
    const baseR = 268;
    const peakH = 148;
    const cols = fujiSegTheta + 1;
    const rows = fujiSegRad + 1;
    const fPos = new Float32Array(cols * rows * 3);
    const fUv = new Float32Array(cols * rows * 2);
    const fMeta = new Float32Array(cols * rows * 2);
    const fIdx: number[] = [];

    for (let ir = 0; ir <= fujiSegRad; ir++) {
      const u = ir / fujiSegRad;
      for (let it = 0; it <= fujiSegTheta; it++) {
        const tWrap = (it % fujiSegTheta) / fujiSegTheta;
        const theta = tWrap * Math.PI * 2;
        const sample = computeFujiProfileSample(u, theta);
        const rad = baseR * sample.radiusRatio;
        const y = sample.heightNorm * peakH - (u > 0.88 ? ((u - 0.88) / 0.12) * 5.0 : 0);

        const vi = ir * cols + it;
        fPos[vi * 3] = Math.cos(theta) * rad;
        fPos[vi * 3 + 1] = y;
        fPos[vi * 3 + 2] = Math.sin(theta) * rad;
        fUv[vi * 2] = (it / fujiSegTheta) * 8.0;
        fUv[vi * 2 + 1] = u;
        fMeta[vi * 2] = sample.snowMask;
        fMeta[vi * 2 + 1] = sample.heightNorm;
      }
    }

    const calderaCenterIdx = cols * rows;
    const fPosFull = new Float32Array((cols * rows + 1) * 3);
    fPosFull.set(fPos);
    fPosFull[calderaCenterIdx * 3] = 0;
    fPosFull[calderaCenterIdx * 3 + 1] = peakH * 0.90;
    fPosFull[calderaCenterIdx * 3 + 2] = 0;

    const fUvFull = new Float32Array((cols * rows + 1) * 2);
    fUvFull.set(fUv);
    const fMetaFull = new Float32Array((cols * rows + 1) * 2);
    fMetaFull.set(fMeta);
    fMetaFull[calderaCenterIdx * 2] = 0.85;
    fMetaFull[calderaCenterIdx * 2 + 1] = 0.92;

    for (let it = 0; it < fujiSegTheta; it++) {
      fIdx.push(calderaCenterIdx, it + 1, it);
    }
    for (let ir = 0; ir < fujiSegRad; ir++) {
      for (let it = 0; it < fujiSegTheta; it++) {
        const a = ir * cols + it;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        fIdx.push(a, c, b, b, c, d);
      }
    }

    const fujiGeo = new THREE.BufferGeometry();
    fujiGeo.setAttribute('position', new THREE.BufferAttribute(fPosFull, 3));
    fujiGeo.setAttribute('uv', new THREE.BufferAttribute(fUvFull, 2));
    fujiGeo.setAttribute('aFujiMeta', new THREE.BufferAttribute(fMetaFull, 2));
    fujiGeo.setIndex(fIdx);
    fujiGeo.computeVertexNormals();
    const fnAttr = fujiGeo.getAttribute('normal');
    for (let ir = 0; ir <= fujiSegRad; ir++) {
      const i0 = ir * cols;
      const iLast = ir * cols + fujiSegTheta;
      fnAttr.setXYZ(iLast, fnAttr.getX(i0), fnAttr.getY(i0), fnAttr.getZ(i0));
    }
    fnAttr.needsUpdate = true;
    fujiGeo.computeBoundingSphere();

    const matFuji = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xffffff),
      roughness: 0.78,
      metalness: 0.03,
      fog: false,
    });
    matFuji.onBeforeCompile = (shader: any) => {
      shader.uniforms.uFujiSun = { value: sunDir };
      shader.vertexShader =
        `attribute vec2 aFujiMeta;
         varying vec3 vFujiLocal;
         varying vec3 vFujiWorld;
         varying vec3 vFujiNrm;
         varying vec2 vFujiMeta;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vFujiLocal = transformed;
           vFujiMeta = aFujiMeta;
           vFujiWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vFujiNrm = normalize(mat3(modelMatrix) * objectNormal);`
        );

      shader.fragmentShader =
        `uniform vec3 uFujiSun;
         varying vec3 vFujiLocal;
         varying vec3 vFujiWorld;
         varying vec3 vFujiNrm;
         varying vec2 vFujiMeta;\n` +
        shader.fragmentShader
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             {
               vec3 wn = normalize(vFujiNrm);
               float ang = atan(vFujiLocal.z, vFujiLocal.x);
               float fineRib = sin(ang * 31.0 + vFujiMeta.y * 4.5) * 0.045
                             + cos(ang * 53.0 - vFujiMeta.y * 7.0) * 0.032
                             + sin(ang * 89.0) * 0.018;
               float steepScree = 1.0 - smoothstep(0.46, 0.72, wn.y);
               float snow = smoothstep(0.28, 0.66, vFujiMeta.x + fineRib - steepScree * 0.28);

               vec3 lowerTimber = vec3(0.24, 0.35, 0.58);
               vec3 upperBasalt = vec3(0.28, 0.31, 0.54) * (0.86 + 0.28 * sin(ang * 47.0));
               vec3 rockCol = mix(lowerTimber, upperBasalt, smoothstep(0.18, 0.62, vFujiMeta.y));

               float sunLit = clamp(dot(wn, uFujiSun) * 0.65 + 0.35, 0.0, 1.0);
               vec3 snowShade = vec3(0.32, 0.46, 0.76);
               vec3 snowSun = vec3(0.76, 0.73, 0.70);
               vec3 snowCol = mix(snowShade, snowSun, smoothstep(0.20, 0.80, sunLit));

               diffuseColor.rgb = mix(rockCol, snowCol, snow);
             }`
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
             roughnessFactor = mix(0.84, 0.50, vFujiMeta.x);`
          )
          .replace(
            '#include <tonemapping_fragment>',
            `{
               float baseMist = 1.0 - smoothstep(-2.0, 36.0, vFujiWorld.y);
               vec3 skyScatter = vec3(0.22, 0.36, 0.64);
               vec3 baseGlow = vec3(0.28, 0.41, 0.68);
               gl_FragColor.rgb = mix(gl_FragColor.rgb, skyScatter, 0.24 * (1.0 - vFujiMeta.y * 0.45));
               gl_FragColor.rgb = mix(gl_FragColor.rgb, baseGlow, baseMist * 0.58);
             }
             #include <tonemapping_fragment>`
          );
    };
    matFuji.customProgramCacheKey = () => 'hanamura-sculpted-fuji-stylized-v3';

    const fujiMesh = new THREE.Mesh(fujiGeo, matFuji);
    fujiMesh.position.set(398, -2.5, -18);
    fujiMesh.frustumCulled = false;
    root.add(fujiMesh);
  }

  // =========================================================================
  // 2. THREE CONTINUOUS 360° SCULPTED MOUNTAIN RINGS + INSTANCED CEDAR FOREST SPIRES!
  // =========================================================================
  const nearRingGeo = createSculptedMountainRingGeo({
    rInner: 100,
    rOuter: 188,
    segTheta: 192,
    segRad: 22,
    seed: 1.7,
    maxH: 40,
    lakePassDepth: 9.5,
    fujiWindowDip: 0,
  });
  const matNearFoothills = createMountainLayerMaterial({
    forestLow: [0.11, 0.28, 0.19],
    forestHigh: [0.20, 0.42, 0.25],
    rockCol: [0.38, 0.40, 0.48],
    autumnAccent: 0.65,
    hazeCol: [0.16, 0.29, 0.54],
    hazeStrength: 0.14,
    mistTopY: 3.6,
    cacheKey: 'near-foothills-v4',
  });
  const nearRingMesh = new THREE.Mesh(nearRingGeo, matNearFoothills);
  nearRingMesh.frustumCulled = false;
  nearRingMesh.receiveShadow = true;
  root.add(nearRingMesh);

  const midRingGeo = createSculptedMountainRingGeo({
    rInner: 180,
    rOuter: 310,
    segTheta: 144,
    segRad: 16,
    seed: 4.3,
    maxH: 74,
    lakePassDepth: 0,
    fujiWindowDip: 0.78,
  });
  const matMidRange = createMountainLayerMaterial({
    forestLow: [0.10, 0.21, 0.36],
    forestHigh: [0.16, 0.28, 0.46],
    rockCol: [0.24, 0.32, 0.48],
    autumnAccent: 0.22,
    hazeCol: [0.20, 0.34, 0.60],
    hazeStrength: 0.42,
    mistTopY: 14.5,
    cacheKey: 'mid-alpine-v4',
  });
  const midRingMesh = new THREE.Mesh(midRingGeo, matMidRange);
  midRingMesh.frustumCulled = false;
  root.add(midRingMesh);

  const farRingGeo = createSculptedMountainRingGeo({
    rInner: 304,
    rOuter: 495,
    segTheta: 120,
    segRad: 12,
    seed: 8.9,
    maxH: 96,
    lakePassDepth: 0,
    fujiWindowDip: 0.88,
  });
  const matFarRange = createMountainLayerMaterial({
    forestLow: [0.16, 0.26, 0.48],
    forestHigh: [0.22, 0.34, 0.56],
    rockCol: [0.28, 0.38, 0.58],
    autumnAccent: 0.0,
    hazeCol: [0.24, 0.38, 0.64],
    hazeStrength: 0.64,
    mistTopY: 22.5,
    cacheKey: 'far-sumie-v4',
  });
  const farRingMesh = new THREE.Mesh(farRingGeo, matFarRange);
  farRingMesh.frustumCulled = false;
  root.add(farRingMesh);

  // 2B. 320 Botanical Alpha-Cutout *Kitayama-Sugi & Akamatsu* Mountain Grove Trees (`远山杉松林冠`)!
  //     Replaces uniform geometric cones with ragged multi-tiered cedar/pine foliage silhouettes!
  {
    let sugiTex: any = null;
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 256;
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 256, 256);
        let rs = 9187;
        const rnd = () => {
          rs = (Math.imul(rs, 1664525) + 1013904223) | 0;
          return ((rs >>> 0) % 100000) / 100000;
        };
        // Dark cedar trunk core
        ctx.fillStyle = '#241610';
        ctx.beginPath();
        ctx.moveTo(121, 256);
        ctx.lineTo(135, 256);
        ctx.lineTo(130, 38);
        ctx.lineTo(126, 38);
        ctx.closePath();
        ctx.fill();

        // 8 ragged horizontal/drooping Japanese Sugi & Red Pine bough tiers with vibrant stylized emerald needle clusters!
        const palette = ['#173a2c', '#1f4d36', '#28613f', '#347649', '#438d53', '#55a45f'];
        for (let tier = 0; tier < 9; tier++) {
          const tFrac = tier / 8; // 0 = bottom wide boughs, 1 = irregular top leader crown
          const cy = 222 - tFrac * 188;
          const halfSpan = (1 - Math.pow(tFrac, 1.15) * 0.74) * 96 + (rnd() - 0.5) * 14;
          const clusters = 18 - Math.floor(tFrac * 8);
          for (let c = 0; c < clusters; c++) {
            const side = (c / Math.max(1, clusters - 1)) * 2 - 1;
            const bx = 128 + side * halfSpan * (0.25 + rnd() * 0.78);
            const by = cy + Math.abs(side) * 12 + (rnd() - 0.5) * 16;
            const col = palette[Math.min(palette.length - 1, Math.floor((tFrac * 0.55 + rnd() * 0.55) * palette.length))];
            ctx.strokeStyle = col;
            ctx.lineCap = 'round';
            const fanCount = 9;
            const rad = 16 + (1 - tFrac * 0.45) * 14 * (0.7 + rnd() * 0.5);
            ctx.lineWidth = 2.6;
            for (let n = 0; n < fanCount; n++) {
              const a = -Math.PI * 0.5 + ((n / (fanCount - 1)) - 0.5) * 2.1 + side * 0.35;
              const l = rad * (0.65 + rnd() * 0.5);
              ctx.beginPath();
              ctx.moveTo(bx, by);
              ctx.lineTo(bx + Math.cos(a) * l, by + Math.sin(a) * l * 0.82);
              ctx.stroke();
            }
          }
        }
        sugiTex = new THREE.CanvasTexture(cv);
        sugiTex.colorSpace = THREE.SRGBColorSpace;
        sugiTex.needsUpdate = true;
      }
    }

    if (sugiTex) {
      // 3 crossed vertical botanical planes (`0°, 60°, 120°`) with smooth upward canopy normals!
      const cPos: number[] = [];
      const cNrm: number[] = [];
      const cUv: number[] = [];
      const cIdx: number[] = [];
      for (let p = 0; p < 3; p++) {
        const ang = (p * Math.PI) / 3;
        const ca = Math.cos(ang) * 0.5;
        const sa = Math.sin(ang) * 0.5;
        const bV = cPos.length / 3;
        cPos.push(-ca, 0, -sa, ca, 0, sa, ca, 1, sa, -ca, 1, -sa);
        cNrm.push(-ca * 0.4, 0.92, -sa * 0.4, ca * 0.4, 0.92, sa * 0.4, ca * 0.3, 0.96, sa * 0.3, -ca * 0.3, 0.96, -sa * 0.3);
        cUv.push(0, 0, 1, 0, 1, 1, 0, 1);
        cIdx.push(bV, bV + 1, bV + 2, bV, bV + 2, bV + 3);
      }
      const cedarGeo = new THREE.BufferGeometry();
      cedarGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
      cedarGeo.setAttribute('normal', new THREE.Float32BufferAttribute(cNrm, 3));
      cedarGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cUv, 2));
      cedarGeo.setIndex(cIdx);

      const matCedar = new THREE.MeshStandardMaterial({
        map: sugiTex,
        alphaTest: 0.40,
        side: THREE.DoubleSide,
        roughness: 0.90,
        metalness: 0.0,
        fog: false,
      });
      matCedar.onBeforeCompile = (shader: any) => {
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <normal_fragment_begin>',
            `vec3 normal = normalize((viewMatrix * vec4(0.18, 0.96, 0.12, 0.0)).xyz);
             vec3 nonPerturbedNormal = normal;`
          )
          .replace(
            '#include <tonemapping_fragment>',
            `gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.62, 0.74, 0.92), 0.18);
             #include <tonemapping_fragment>`
          );
      };
      matCedar.customProgramCacheKey = () => 'hanamura-distant-sugi-stylized-v3';
      const CEDAR_COUNT = 320;
      const cedarInst = new THREE.InstancedMesh(cedarGeo, matCedar, CEDAR_COUNT);
      const m4 = new THREE.Matrix4();
      const pV = new THREE.Vector3();
      const qV = new THREE.Quaternion();
      const eV = new THREE.Euler();
      const sV = new THREE.Vector3();
      let placed = 0;
      // Place in natural clustered forest groves along the near mountain slopes & ridges
      for (let i = 0; i < 520 && placed < CEDAR_COUNT; i++) {
        const groveIdx = Math.floor(i / 9);
        const inGrove = i % 9;
        const groveBaseTheta = ((groveIdx * 0.6180339887) % 1) * Math.PI * 2 - Math.PI;
        const theta = groveBaseTheta + Math.sin(inGrove * 2.1 + groveIdx) * 0.075;
        if (Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))) < 0.43) continue;

        const groveU = 0.08 + ((groveIdx * 0.381966) % 1) * 0.66;
        const u = Math.max(0.06, Math.min(0.82, groveU + Math.cos(inGrove * 1.7 + groveIdx) * 0.065));
        const rad = 100 + (188 - 100) * u;
        const h = sampleMountainRingHeight(u, theta, 1.7, 40, 9.5, 0);
        if (h < 1.0) continue;

        const treeH = 7.5 + ((i * 7 + groveIdx * 3) % 9) * 1.15;
        const widthScale = 0.58 + ((i * 5) % 4) * 0.09;
        pV.set(Math.cos(theta) * rad, h - 0.85, Math.sin(theta) * rad);
        eV.set(((i % 3) - 1) * 0.04, (i * 2.39996) % (Math.PI * 2), ((i % 2) * 2 - 1) * 0.04);
        qV.setFromEuler(eV);
        sV.set(treeH * widthScale, treeH, treeH * widthScale);
        m4.compose(pV, qV, sV);
        cedarInst.setMatrixAt(placed++, m4);
      }
      cedarInst.count = placed;
      cedarInst.instanceMatrix.needsUpdate = true;
      cedarInst.frustumCulled = false;
      root.add(cedarInst);
    }
  }

  // =========================================================================
  // 3. SCULPTED STRATIFIED CLIFF PROMONTORY & FIVE-STORY PAGODA (`断崖古寺五重塔`)
  // =========================================================================
  const matTimberDark = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.18, 0.10, 0.065),
    roughness: 0.74,
    metalness: 0.04,
  });
  const matPagodaShikkui = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.86, 0.82, 0.75),
    roughness: 0.84,
    metalness: 0.0,
  });
  const matPagodaVermilion = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.56, 0.11, 0.07),
    roughness: 0.48,
    metalness: 0.04,
  });
  const matPagodaRoof = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.13, 0.15, 0.18),
    roughness: 0.56,
    metalness: 0.18,
    side: THREE.DoubleSide,
  });
  const matSorinBronze = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.68, 0.52, 0.24),
    emissive: new THREE.Color(0.16, 0.10, 0.03),
    roughness: 0.34,
    metalness: 0.82,
  });
  const matLanternWarm = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffb864),
    toneMapped: false,
    fog: false,
  });
  const matCliffRock = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.24, 0.23, 0.22),
    roughness: 0.92,
    metalness: 0.03,
    flatShading: true,
  });

  function createJaggedCliffGeo(topR: number, baseR: number, height: number, seed: number): any {
    const segT = 22;
    const segY = 9;
    const cols = segT + 1;
    const pos: number[] = [];
    const idx: number[] = [];

    for (let iy = 0; iy <= segY; iy++) {
      const v = iy / segY;
      const stepV = v + Math.sin(v * Math.PI * 5) * 0.035;
      const baseInterp = baseR + (topR - baseR) * Math.pow(stepV, 0.72);
      const y = -3.2 + v * (height + 3.2);
      for (let it = 0; it <= segT; it++) {
        const tw = (it % segT) / segT;
        const a = tw * Math.PI * 2;
        const jag =
          1.0 +
          (1 - Math.pow(v, 3.0) * 0.72) *
            (0.24 * Math.sin(a * 5 + seed + iy * 0.45) +
              0.16 * Math.cos(a * 9 - seed * 1.7 - iy * 0.6) +
              0.10 * Math.sin(a * 14 + iy * 1.1));
        const r = baseInterp * jag;
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      }
    }
    const topCenter = pos.length / 3;
    pos.push(0, height, 0);

    for (let iy = 0; iy < segY; iy++) {
      for (let it = 0; it < segT; it++) {
        const a = iy * cols + it;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const topRow = segY * cols;
    for (let it = 0; it < segT; it++) {
      idx.push(topCenter, topRow + it, topRow + it + 1);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function createCurvedPagodaRoofGeo(span: number, roofH: number): any {
    const profile: Array<[number, number]> = [
      [0.54, 0.0],
      [0.34, 0.34],
      [0.14, 0.72],
      [0.0, 1.0],
    ];
    const pos: number[] = [];
    const idx: number[] = [];
    for (let r = 0; r < profile.length; r++) {
      const [hHalf, yn] = profile[r];
      const hw = span * hHalf;
      const cornerLift = r === 0 ? roofH * 0.24 : r === 1 ? roofH * 0.06 : 0;
      const y = yn * roofH + cornerLift;
      const midY = yn * roofH;
      const ringPts: Array<[number, number, number]> = [
        [-hw, y, hw],
        [0, midY, hw * 0.96],
        [hw, y, hw],
        [hw * 0.96, midY, 0],
        [hw, y, -hw],
        [0, midY, -hw * 0.96],
        [-hw, y, -hw],
        [-hw * 0.96, midY, 0],
      ];
      for (const [px, py, pz] of ringPts) pos.push(px, py, pz);
    }
    for (let r = 0; r < profile.length - 1; r++) {
      for (let s = 0; s < 8; s++) {
        const sn = (s + 1) % 8;
        const a = r * 8 + s;
        const b = r * 8 + sn;
        const c = (r + 1) * 8 + s;
        const d = (r + 1) * 8 + sn;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  {
    const px = 152;
    const pz = 62;
    const pagodaGrp = new THREE.Group();
    pagodaGrp.position.set(px, 0, pz);

    const mainBluff = new THREE.Mesh(createJaggedCliffGeo(9.2, 24.5, 15.2, 1.3), matCliffRock);
    const northSpire = new THREE.Mesh(createJaggedCliffGeo(3.2, 13.5, 11.4, 3.7), matCliffRock);
    northSpire.position.set(-10.5, 0, -9.5);
    const westLedge = new THREE.Mesh(createJaggedCliffGeo(4.8, 14.0, 8.6, 5.1), matCliffRock);
    westLedge.position.set(-13.5, 0, 4.5);
    const eastCrag = new THREE.Mesh(createJaggedCliffGeo(4.2, 15.5, 12.2, 7.4), matCliffRock);
    eastCrag.position.set(11.0, 0, 8.0);
    pagodaGrp.add(mainBluff, northSpire, westLedge, eastCrag);

    const podium = new THREE.Mesh(new THREE.BoxGeometry(10.8, 1.4, 10.8), matPagodaShikkui);
    podium.position.y = 15.8;
    pagodaGrp.add(podium);

    for (let tier = 0; tier < 5; tier++) {
      const ty = 16.5 + tier * 4.05;
      const eaveSpan = 10.4 - tier * 1.12;
      const coreW = eaveSpan * 0.50;

      const core = new THREE.Mesh(new THREE.BoxGeometry(coreW, 3.4, coreW), matPagodaShikkui);
      core.position.y = ty + 1.65;
      const timberBand = new THREE.Mesh(new THREE.BoxGeometry(coreW + 0.24, 0.42, coreW + 0.24), matTimberDark);
      timberBand.position.y = ty + 3.10;
      const koran = new THREE.Mesh(new THREE.BoxGeometry(coreW + 1.15, 0.36, coreW + 1.15), matPagodaVermilion);
      koran.position.y = ty + 0.28;
      const warmWindow = new THREE.Mesh(new THREE.BoxGeometry(coreW + 0.08, 0.52, coreW * 0.46), matLanternWarm);
      warmWindow.position.y = ty + 1.45;
      const warmWindowZ = new THREE.Mesh(new THREE.BoxGeometry(coreW * 0.46, 0.52, coreW + 0.08), matLanternWarm);
      warmWindowZ.position.y = ty + 1.45;

      const roof = new THREE.Mesh(createCurvedPagodaRoofGeo(eaveSpan, 1.68), matPagodaRoof);
      roof.position.y = ty + 3.12;

      pagodaGrp.add(core, timberBand, koran, warmWindow, warmWindowZ, roof);
    }

    const sorinShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.28, 7.6, 8), matSorinBronze);
    sorinShaft.position.y = 40.2;
    pagodaGrp.add(sorinShaft);
    for (let r = 0; r < 6; r++) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.52 - r * 0.05, 0.52 - r * 0.05, 0.14, 8), matSorinBronze);
      ring.position.y = 37.6 + r * 0.72;
      pagodaGrp.add(ring);
    }

    const matCliffPine = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.09, 0.19, 0.10),
      roughness: 0.88,
      metalness: 0.0,
    });
    for (const [ox, oy, oz, sc] of [
      [-6.8, 15.2, -5.2, 1.3],
      [6.4, 15.1, -4.8, 1.1],
      [-12.5, 8.5, 3.8, 1.4],
    ]) {
      const pTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * sc, 0.32 * sc, 3.2 * sc, 6), matTimberDark);
      pTrunk.position.set(ox, oy + 1.5 * sc, oz);
      pTrunk.rotation.z = -0.22;
      pagodaGrp.add(pTrunk);
      for (const [px2, py2, pz2, pr] of [
        [0.4, 3.1, 0, 2.1],
        [-0.8, 2.5, 0.6, 1.7],
        [0.9, 2.2, -0.5, 1.6],
      ]) {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(pr * 0.65 * sc, pr * sc, 0.68 * sc, 7), matCliffPine);
        pad.position.set(ox + px2 * sc, oy + py2 * sc, oz + pz2 * sc);
        pagodaGrp.add(pad);
      }
    }

    // Batch cliffside pagoda & pines by material (~46 meshes -> 6 draw calls!)
    pagodaGrp.updateMatrixWorld(true);
    const invPagoda = pagodaGrp.matrixWorld.clone().invert();
    const pagByMat = new Map<any, any[]>();
    for (const ch of pagodaGrp.children) {
      if (!ch.isMesh) continue;
      let arr = pagByMat.get(ch.material);
      if (!arr) {
        arr = [];
        pagByMat.set(ch.material, arr);
      }
      arr.push(ch);
    }
    pagodaGrp.clear();
    const tmpP = new THREE.Vector3();
    const tmpN = new THREE.Vector3();
    const tmpNM = new THREE.Matrix3();
    for (const [mat, meshes] of pagByMat.entries()) {
      const pos: number[] = [];
      const nrm: number[] = [];
      const idx: number[] = [];
      for (const m of meshes) {
        const rel = invPagoda.clone().multiply(m.matrixWorld);
        tmpNM.getNormalMatrix(rel);
        const g = m.geometry;
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        const pa = g.getAttribute('position');
        const na = g.getAttribute('normal');
        const ia = g.getIndex();
        const base = pos.length / 3;
        for (let i = 0; i < pa.count; i++) {
          tmpP.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(rel);
          tmpN.set(na.getX(i), na.getY(i), na.getZ(i)).applyMatrix3(tmpNM).normalize();
          pos.push(tmpP.x, tmpP.y, tmpP.z);
          nrm.push(tmpN.x, tmpN.y, tmpN.z);
        }
        if (ia) {
          for (let i = 0; i < ia.count; i++) idx.push(base + ia.getX(i));
        } else {
          for (let i = 0; i < pa.count; i++) idx.push(base + i);
        }
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      bg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      bg.setIndex(idx);
      bg.computeBoundingSphere();
      pagodaGrp.add(new THREE.Mesh(bg, mat));
    }

    root.add(pagodaGrp);
  }

  // =========================================================================
  // 4. SOFT FEATHERED VALLEY MIST RIBBONS (`山间流云霞霭`) & UKAI FISHING SKIFFS (`篝火渔舟`)
  // =========================================================================
  const mistBands: Array<{ mesh: any; baseX: number; baseZ: number; amp: number; speed: number; phase: number }> = [];
  {
    let mistTex: any;
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = 256;
      cv.height = 64;
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 256, 64);
        const puffs = [
          [64, 34, 58, 24, 0.55],
          [128, 30, 82, 26, 0.72],
          [192, 35, 62, 23, 0.52],
          [104, 38, 68, 20, 0.45],
          [156, 28, 56, 20, 0.42],
        ];
        for (const [cx, cy, rx, ry, aMax] of puffs) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(rx, ry);
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
          g.addColorStop(0, `rgba(255, 244, 236, ${aMax})`);
          g.addColorStop(0.5, `rgba(242, 232, 235, ${aMax * 0.48})`);
          g.addColorStop(1, 'rgba(232, 224, 235, 0.0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        mistTex = new THREE.CanvasTexture(cv);
        mistTex.colorSpace = THREE.SRGBColorSpace;
        mistTex.needsUpdate = true;
      }
    }

    if (mistTex) {
      const mistPlane = new THREE.PlaneGeometry(1, 1);
      const mistSpecs: Array<[number, number, number, number, number, number, number]> = [
        [285, 22, -26, 240, 28, Math.PI * 0.5, 0.34],
        [315, 38, 18, 210, 24, Math.PI * 0.46, 0.28],
        [136, 5.5, 36, 95, 14, Math.PI * 0.58, 0.26],
        [142, 6.5, -42, 105, 15, Math.PI * 0.42, 0.25],
        [-12, 12.5, -118, 150, 20, 0.06, 0.26],
        [-14, 12.5, 118, 150, 20, -0.05, 0.26],
        [-126, 14.0, 4, 155, 22, Math.PI * 0.5, 0.28],
      ];
      mistSpecs.forEach(([mx, my, mz, sx, sy, ry, op], idx) => {
        const mMat = new THREE.MeshBasicMaterial({
          map: mistTex,
          transparent: true,
          opacity: op,
          depthWrite: false,
          fog: false,
          side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(mistPlane, mMat);
        m.position.set(mx, my, mz);
        m.scale.set(sx, sy, 1);
        m.rotation.y = ry;
        m.renderOrder = 2;
        root.add(m);
        mistBands.push({
          mesh: m,
          baseX: mx,
          baseZ: mz,
          amp: 6.5 + (idx % 3) * 3.0,
          speed: 0.08 + idx * 0.015,
          phase: idx * 1.4,
        });
      });
    }
  }

  const boats: Array<{ grp: any; fire: any; baseY: number; phase: number }> = [];
  const matWaterGlow = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xff9436),
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    fog: false,
  });
  for (let i = 0; i < 3; i++) {
    const [bx, bz, ry] = [
      [112.0, 18.0, 0.38],
      [126.0, -15.0, -0.28],
      [138.0, 32.0, 0.58],
    ][i];
    const bGrp = new THREE.Group();
    bGrp.position.set(bx, -1.52, bz);
    bGrp.rotation.y = ry;

    const timberParts: any[] = [];
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.42, 5.4), matTimberDark);
    hull.position.y = 0.22;
    const prow = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.85, 4), matTimberDark);
    prow.rotation.x = -Math.PI * 0.42;
    prow.rotation.z = Math.PI * 0.25;
    prow.position.set(0, 0.44, -3.25);
    const stern = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.48, 1.2), matTimberDark);
    stern.position.set(0, 0.36, 2.95);
    stern.rotation.x = 0.22;
    const yakataPosts = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.92, 2.2), matTimberDark);
    yakataPosts.position.set(0, 0.82, 0.25);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 2.2, 5), matTimberDark);
    pole.position.set(0, 1.05, -2.75);
    pole.rotation.x = -0.58;
    timberParts.push(hull, prow, stern, yakataPosts, pole);

    const bPos: number[] = [];
    const bNrm: number[] = [];
    const bIdx: number[] = [];
    const tp = new THREE.Vector3();
    const tn = new THREE.Vector3();
    const tnm = new THREE.Matrix3();
    for (const part of timberParts) {
      part.updateMatrix();
      tnm.getNormalMatrix(part.matrix);
      const g = part.geometry;
      const pa = g.getAttribute('position');
      const na = g.getAttribute('normal');
      const ia = g.getIndex();
      const base = bPos.length / 3;
      for (let vi = 0; vi < pa.count; vi++) {
        tp.set(pa.getX(vi), pa.getY(vi), pa.getZ(vi)).applyMatrix4(part.matrix);
        tn.set(na.getX(vi), na.getY(vi), na.getZ(vi)).applyMatrix3(tnm).normalize();
        bPos.push(tp.x, tp.y, tp.z);
        bNrm.push(tn.x, tn.y, tn.z);
      }
      if (ia) {
        for (let ii = 0; ii < ia.count; ii++) bIdx.push(base + ia.getX(ii));
      } else {
        for (let ii = 0; ii < pa.count; ii++) bIdx.push(base + ii);
      }
    }
    const boatTimberGeo = new THREE.BufferGeometry();
    boatTimberGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
    boatTimberGeo.setAttribute('normal', new THREE.Float32BufferAttribute(bNrm, 3));
    boatTimberGeo.setIndex(bIdx);
    boatTimberGeo.computeBoundingSphere();
    const boatTimberMesh = new THREE.Mesh(boatTimberGeo, matTimberDark);

    const yakataRoof = new THREE.Mesh(createCurvedPagodaRoofGeo(2.35, 0.52), matPagodaRoof);
    yakataRoof.position.set(0, 1.25, 0.25);
    const kagaribi = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), matLanternWarm);
    kagaribi.position.set(0, 1.42, -3.45);
    const shimmer = new THREE.Mesh(new THREE.CircleGeometry(1.65, 12), matWaterGlow);
    shimmer.rotation.x = -Math.PI * 0.5;
    shimmer.position.set(0, -0.04, -3.45);

    bGrp.add(boatTimberMesh, yakataRoof, kagaribi, shimmer);
    root.add(bGrp);
    boats.push({ grp: bGrp, fire: kagaribi, baseY: -1.52, phase: i * 1.9 });
  }

  let backdropDraws = 0;
  let backdropTris = 0;
  root.traverseVisible((o: any) => {
    if (!o.isMesh) return;
    backdropDraws++;
    const idx = o.geometry?.getIndex();
    const pos = o.geometry?.getAttribute('position');
    backdropTris += idx ? idx.count / 3 : pos ? pos.count / 3 : 0;
  });

  let t = 0;
  function update(dt: number) {
    t += dt;
    for (const b of boats) {
      b.grp.position.y = b.baseY + Math.sin(t * 1.2 + b.phase) * 0.055;
      b.grp.rotation.z = Math.sin(t * 1.0 + b.phase) * 0.024;
      const flick = 0.92 + Math.sin(t * 11.5 + b.phase * 2.3) * 0.14;
      b.fire.scale.setScalar(flick);
    }
    for (const mb of mistBands) {
      mb.mesh.position.x = mb.baseX + Math.sin(t * mb.speed + mb.phase) * mb.amp * 0.45;
      mb.mesh.position.z = mb.baseZ + Math.cos(t * mb.speed + mb.phase) * mb.amp;
    }
  }

  return {
    update,
    root,
    boat: boats[0].grp,
    crane: null,
    ship: null,
    skyline: null,
    gulls: null,
    lamps: null,
    colliders: [],
    spreader: null,
    boatBase: new THREE.Vector3(112.0, -1.52, 18.0),
    extractionPoint: new THREE.Vector3(70.0, 3.6, 0),
    shipName: '篝火渔舟',
    craneId: '山城本丸',
    stats: { tris: Math.round(backdropTris), drawCalls: backdropDraws },
  };
}
