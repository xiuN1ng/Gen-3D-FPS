/**
 * High-Craft PBR Enemy & Boss 3D Modeling Module (`enemyModels.ts`)
 *
 * Replaces low-detail primitive enemy models (while preserving `hound` & `gull` 100% intact)
 * with articulated Karakuri-Samurai & Multi-Leg Siege Mechs:
 * 1. `trooper` (`岛田机巧铁炮武士`): Full bone-driven Karakuri-Samurai `Dou` cuirass, `Kabuto` + `Menpo` visor,
 *    `Sode` shoulder shields, `Kusazuri` tassets, hydraulic greaves, and Karakuri Pulse-Arquebus.
 * 2. `sniper` (`屋脊鹰眼狙击机关忍`): Tri-lens optical rangefinder helmet, recon cloak-collar, dorsal telemetry mast,
 *    and extended-barrel Rail-Tanegashima rifle.
 * 3. `shield_guard` (`玄甲六角重盾机关武士`): Horned Vanguard `Kabuto`, heavy `O-Sode` tower pauldrons, and a
 *    monumental bevelled hexagonal Sengoku Riot Shield with glowing cyan hex-lattice energy barrier!
 * 4. `boss` (`赤备重甲统领 · 鬼丸`): Towering Akazonae Oni-Samurai Warlord with twin curved gold `大锹形` horns,
 *    blazing furnace chestplate, dorsal `指物 Sashimono` war banner + Raijin drum ring, and Shogun cannon!
 * 5. `spider_mech` (`四足重装机关蜘蛛`): Pure custom sloped arachnid chassis (underlying dog hidden!), tri-eye
 *    sensor visor, rear glowing plasma reactor, 360° twin rotary autocannons, and 4 hydraulic 3-segment legs!
 * 6. `mortar_crab` (`六足轰击机关蟹`): Pure custom broad sloped siege-tank carapace (underlying dog hidden!),
 *    twin hydraulic front siege-claws, elevated twin magma-coil siege mortars, and 6 articulated crab legs!
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { enhanceMaterialStylized } from './stylizedRenderPipeline';

export interface EnemyPbrSuite {
  karakuriIron: any;
  akazonaeLacquer: any;
  ivoryPorcelain: any;
  kinkoGold: any;
  hydraulicChrome: any;
  bannerSilk: any;
  opticCrimsonGlow: any;
  reactorAmberGlow: any;
  sniperGoldGlow: any;
  shieldHexBarrier: any;
}

let cachedEnemySuite: EnemyPbrSuite | null = null;
let cachedEnemyThree: any = null;

function createCanvasTexPair(THREE: any, G: any, size = 256, drawFn: (cMap: CanvasRenderingContext2D, cBump: CanvasRenderingContext2D) => void, repeat = 1) {
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = size;
  mapCanvas.height = size;
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  drawFn(mapCanvas.getContext('2d')!, bumpCanvas.getContext('2d')!);

  const aniso =
    G && G.renderer && G.renderer.capabilities && G.renderer.capabilities.getMaxAnisotropy
      ? Math.min(8, G.renderer.capabilities.getMaxAnisotropy())
      : 4;

  const map = new THREE.CanvasTexture(mapCanvas);
  if (THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat, repeat);
  map.anisotropy = aniso;
  map.needsUpdate = true;

  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(repeat, repeat);
  bump.anisotropy = aniso;
  bump.needsUpdate = true;

  return { map, bump };
}

export function getEnemyPbrSuite(G: any): EnemyPbrSuite {
  const THREE = G.THREE;
  if (cachedEnemySuite && cachedEnemyThree === THREE) {
    return cachedEnemySuite;
  }
  cachedEnemyThree = THREE;

  // 1. Dark Karakuri Forged Iron + Riveted Armor Panels
  const ironTex = createCanvasTexPair(THREE, G, 256, (cm, cb) => {
    cm.fillStyle = '#22262e';
    cm.fillRect(0, 0, 256, 256);
    cb.fillStyle = '#808080';
    cb.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 2) {
      const v = 30 + ((y * 13) % 14);
      cm.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
      cm.fillRect(0, y, 256, 1);
    }
    // Samurai lames / armor panel seams + silvered edge wear
    for (let k = 0; k < 4; k++) {
      const py = k * 64;
      cm.strokeStyle = '#0f1217';
      cm.lineWidth = 4;
      cm.strokeRect(6, py + 4, 244, 56);
      cm.strokeStyle = 'rgba(170,185,205,0.28)';
      cm.lineWidth = 1.5;
      cm.strokeRect(8, py + 6, 240, 52);
      cb.strokeStyle = '#282828';
      cb.lineWidth = 4;
      cb.strokeRect(6, py + 4, 244, 56);
      for (const rx of [22, 86, 170, 234]) {
        cm.fillStyle = '#687486';
        cm.beginPath();
        cm.arc(rx, py + 16, 3.2, 0, Math.PI * 2);
        cm.fill();
        cb.fillStyle = '#dcdcdc';
        cb.beginPath();
        cb.arc(rx, py + 16, 3.2, 0, Math.PI * 2);
        cb.fill();
      }
    }
  }, 1.5);

  // 2. Akazonae (`赤备`) Crimson Battle-Lacquer with Gold Edge Trim
  const akaTex = createCanvasTexPair(THREE, G, 256, (cm, cb) => {
    const g = cm.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, '#8e1814');
    g.addColorStop(0.5, '#6d100e');
    g.addColorStop(1, '#4c0a09');
    cm.fillStyle = g;
    cm.fillRect(0, 0, 256, 256);
    cb.fillStyle = '#808080';
    cb.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 4; k++) {
      const py = k * 64;
      cm.strokeStyle = '#2b0505';
      cm.lineWidth = 3.5;
      cm.strokeRect(6, py + 4, 244, 56);
      cm.strokeStyle = 'rgba(235,190,95,0.48)';
      cm.lineWidth = 2;
      cm.strokeRect(9, py + 7, 238, 50);
      cb.strokeStyle = '#303030';
      cb.lineWidth = 3.5;
      cb.strokeRect(6, py + 4, 244, 56);
    }
  }, 1.5);

  // 3. Karakuri Porcelain-Ivory Composite Shell (matches `hound` & `gull` aesthetic!)
  const ivoryTex = createCanvasTexPair(THREE, G, 256, (cm, cb) => {
    cm.fillStyle = '#d8dce2';
    cm.fillRect(0, 0, 256, 256);
    cb.fillStyle = '#868686';
    cb.fillRect(0, 0, 256, 256);
    cm.strokeStyle = '#7e8896';
    cm.lineWidth = 3;
    cm.strokeRect(10, 10, 236, 112);
    cm.strokeRect(10, 134, 236, 112);
    cm.fillStyle = '#b43028';
    cm.fillRect(10, 102, 236, 14);
    cb.strokeStyle = '#343434';
    cb.lineWidth = 3;
    cb.strokeRect(10, 10, 236, 112);
    cb.strokeRect(10, 134, 236, 112);
  }, 1);

  // 4. Forged Kinko Brass-Gold
  const goldTex = createCanvasTexPair(THREE, G, 128, (cm, cb) => {
    const g = cm.createLinearGradient(0, 0, 128, 128);
    g.addColorStop(0, '#ecc568');
    g.addColorStop(0.5, '#c89434');
    g.addColorStop(1, '#f2d380');
    cm.fillStyle = g;
    cm.fillRect(0, 0, 128, 128);
    cb.fillStyle = '#808080';
    cb.fillRect(0, 0, 128, 128);
    cm.strokeStyle = 'rgba(90,56,10,0.4)';
    cm.lineWidth = 2.5;
    cm.strokeRect(6, 6, 116, 116);
    cb.strokeStyle = '#c8c8c8';
    cb.lineWidth = 2.5;
    cb.strokeRect(6, 6, 116, 116);
  }, 1.5);

  // 5. Glowing Hexagonal Energy Shield Lattice Texture
  const hexCanvas = document.createElement('canvas');
  hexCanvas.width = 256;
  hexCanvas.height = 256;
  const hctx = hexCanvas.getContext('2d')!;
  hctx.fillStyle = 'rgba(20, 140, 195, 0.22)';
  hctx.fillRect(0, 0, 256, 256);
  hctx.strokeStyle = 'rgba(130, 245, 255, 0.92)';
  hctx.lineWidth = 2.4;
  const rHex = 22;
  const dx = rHex * 1.5;
  const dy = rHex * Math.sqrt(3);
  for (let gx = -1; gx < 12; gx++) {
    for (let gy = -1; gy < 12; gy++) {
      const cx = gx * dx;
      const cy = gy * dy + (gx % 2 === 0 ? 0 : dy * 0.5);
      hctx.beginPath();
      for (let v = 0; v < 6; v++) {
        const a = (v * Math.PI) / 3;
        const px = cx + Math.cos(a) * (rHex - 2);
        const py = cy + Math.sin(a) * (rHex - 2);
        if (v === 0) hctx.moveTo(px, py);
        else hctx.lineTo(px, py);
      }
      hctx.closePath();
      hctx.stroke();
    }
  }
  // Bright outer border
  hctx.strokeStyle = '#b4fbff';
  hctx.lineWidth = 8;
  hctx.strokeRect(4, 4, 248, 248);
  const hexTex = new THREE.CanvasTexture(hexCanvas);
  if (THREE.SRGBColorSpace) hexTex.colorSpace = THREE.SRGBColorSpace;
  hexTex.needsUpdate = true;

  cachedEnemySuite = {
    karakuriIron: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: ironTex.map,
        bumpMap: ironTex.bump,
        bumpScale: 0.014,
        roughnessMap: ironTex.bump,
        color: new THREE.Color(0xd2dce8),
        metalness: 0.84,
        roughness: 0.28,
        envMapIntensity: 1.45,
      }),
      { role: 'enemy', id: 'karakuriIron' }
    ),
    akazonaeLacquer: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: akaTex.map,
        bumpMap: akaTex.bump,
        bumpScale: 0.012,
        color: new THREE.Color(0xffdcd8),
        metalness: 0.52,
        roughness: 0.21,
        envMapIntensity: 1.45,
      }),
      { role: 'enemy', id: 'akazonaeLacquer' }
    ),
    ivoryPorcelain: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: ivoryTex.map,
        bumpMap: ivoryTex.bump,
        bumpScale: 0.010,
        color: new THREE.Color(0xf6f8fc),
        metalness: 0.28,
        roughness: 0.32,
        envMapIntensity: 1.3,
      }),
      { role: 'enemy', id: 'ivoryPorcelain' }
    ),
    kinkoGold: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: goldTex.map,
        bumpMap: goldTex.bump,
        bumpScale: 0.012,
        metalness: 0.90,
        roughness: 0.21,
        envMapIntensity: 1.55,
      }),
      { role: 'enemy', id: 'kinkoGold' }
    ),
    hydraulicChrome: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: ironTex.map,
        color: new THREE.Color(0xcad6e6),
        metalness: 0.94,
        roughness: 0.16,
        envMapIntensity: 1.6,
      }),
      { role: 'enemy', id: 'hydraulicChrome' }
    ),
    bannerSilk: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: akaTex.map,
        bumpMap: akaTex.bump,
        bumpScale: 0.008,
        metalness: 0.12,
        roughness: 0.68,
        side: THREE.DoubleSide,
      }),
      { role: 'enemy', id: 'bannerSilk' }
    ),
    opticCrimsonGlow: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xff3b24).multiplyScalar(2.6),
      toneMapped: false,
    }),
    reactorAmberGlow: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xff9c2a).multiplyScalar(2.4),
      toneMapped: false,
    }),
    sniperGoldGlow: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x52f2ff).multiplyScalar(2.5),
      toneMapped: false,
    }),
    shieldHexBarrier: new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uHexMap: { value: hexTex },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormalV = normalize(normalMatrix * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uFlash;
        uniform sampler2D uHexMap;
        varying vec2 vUv;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          // Chamfered octagonal energy-shield boundary (zero hard rectangular corners!)
          float octDist = max(max(abs(p.x), abs(p.y)), (abs(p.x) + abs(p.y)) * 0.76);
          if (octDist > 1.0) discard;
          float rimBand = smoothstep(0.76, 0.95, octDist) * (1.0 - smoothstep(0.95, 1.0, octDist));
          float edgeSoft = 1.0 - smoothstep(0.88, 1.0, octDist);
          vec4 hexSample = texture2D(uHexMap, vUv * vec2(1.0, 1.35) + vec2(0.0, -uTime * 0.12));
          float scan = 0.55 + 0.45 * sin(p.y * 10.0 - uTime * 4.2);
          float ndv = abs(dot(normalize(vNormalV), normalize(vViewDir)));
          float graze = smoothstep(0.08, 0.45, ndv);
          vec3 baseCol = mix(vec3(0.18, 0.86, 1.0), vec3(1.0, 0.78, 0.34), clamp(uFlash, 0.0, 1.0));
          float lattice = hexSample.r * (0.45 + 0.55 * scan);
          float alpha = (lattice * 0.42 * edgeSoft + rimBand * 0.72) * graze * (1.0 + uFlash * 0.85);
          if (alpha < 0.015) discard;
          gl_FragColor = vec4(baseCol * (1.35 + rimBand * 0.9 + uFlash * 1.1), clamp(alpha, 0.0, 0.92));
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  };

  return cachedEnemySuite;
}

interface EnemyGeoBank {
  map: Map<string, any>;
  get: (key: string, factory: () => any) => any;
}

let cachedGeoBank: EnemyGeoBank | null = null;
let cachedGeoThree: any = null;
let lastPrewarmedTroopers = 0;
let lastPrewarmedHounds = 0;

function getEnemyGeoBank(THREE: any): EnemyGeoBank {
  if (cachedGeoBank && cachedGeoThree === THREE) {
    return cachedGeoBank;
  }
  cachedGeoThree = THREE;
  const map = new Map<string, any>();
  cachedGeoBank = {
    map,
    get(key: string, factory: () => any) {
      let g = map.get(key);
      if (!g) {
        g = factory();
        map.set(key, g);
      }
      return g;
    },
  };
  return cachedGeoBank;
}

function bevelPlateGeo(THREE: any, w: number, h: number, d: number, bevel = 0.012) {
  const bank = getEnemyGeoBank(THREE);
  const key = `bp:${w.toFixed(4)}:${h.toFixed(4)}:${d.toFixed(4)}:${bevel.toFixed(4)}`;
  return bank.get(key, () => {
    const hw = Math.max(0.01, w * 0.5 - bevel);
    const hh = Math.max(0.01, h * 0.5 - bevel);
    const shape = new THREE.Shape();
    const c = Math.min(hw, hh) * 0.28;
    shape.moveTo(-hw + c, -hh);
    shape.lineTo(hw - c, -hh);
    shape.lineTo(hw, -hh + c);
    shape.lineTo(hw, hh - c);
    shape.lineTo(hw - c, hh);
    shape.lineTo(-hw + c, hh);
    shape.lineTo(-hw, hh - c);
    shape.lineTo(-hw, -hh + c);
    shape.closePath();

    const depth = Math.max(0.008, d - bevel * 2);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: bevel,
      bevelThickness: bevel,
    });
    geo.translate(0, 0, -depth * 0.5);
    geo.computeVertexNormals();
    return geo;
  });
}

function cachedGeo(THREE: any, key: string, factory: () => any) {
  return getEnemyGeoBank(THREE).get(key, factory);
}

function enableShadowsRecursive(root: any) {
  root.traverse((ch: any) => {
    ch.__customEnemyPart = true;
    if (ch.isMesh) {
      ch.castShadow = true;
      ch.receiveShadow = true;
    }
  });
}

/**
 * Toggles visibility of the underlying engine `SkinnedMesh` children on `en.rig.group`
 * WITHOUT hiding `en.rig.group` itself or our custom articulated armor/mech attachments!
 * Ensures `hound` and `gull` stay 100% original when `visible = true`, while hiding the
 * underlying soldier/dog mesh on custom mechs & Karakuri-Samurai units!
 */
export function setBaseEnemySkinnedMeshVisible(en: any, visible: boolean) {
  if (!en || !en.rig || !en.rig.group) return;
  for (const ch of en.rig.group.children) {
    if (ch.__customEnemyRoot || ch.__customEnemyPart) continue;
    if (ch.isSkinnedMesh || ch.isMesh) {
      ch.visible = visible;
    }
  }
}

export type HumanoidEnemyRole = 'trooper' | 'sniper' | 'shield_guard' | 'boss';

/**
 * Installs a complete 14-bone-articulated Karakuri-Samurai Armor & Weapon Rig onto a `trooper`-base enemy,
 * hiding the low-poly pants/vest human mesh and reconfiguring role-specific head/shoulder/chest/weapon parts!
 */
export function applyKarakuriSamuraiRig(G: any, en: any, role: HumanoidEnemyRole) {
  const THREE = G.THREE;
  const mats = getEnemyPbrSuite(G);
  const bones = en.rig && en.rig.bones ? en.rig.bones : null;
  if (!bones) return;

  // Hide the low-poly modern human SkinnedMesh so only crisp Karakuri-Samurai PBR armor renders!
  setBaseEnemySkinnedMeshVisible(en, false);

  if (!en.__samuraiRig) {
    const parts: any[] = [];
    const addPart = (bone: any, obj: any) => {
      obj.__customEnemyRoot = true;
      enableShadowsRecursive(obj);
      bone.add(obj);
      parts.push(obj);
    };

    // 1. PELVIS (`pelvis`): Armored Kusazuri 4-Side Samurai Waist Tassets + Gold Obi Buckle
    const pelvisGrp = new THREE.Group();
    const hipCore = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.30, 0.16, 0.22, 0.012),
      mats.karakuriIron
    );
    const goldBuckle = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.09, 0.07, 0.04, 0.006),
      mats.kinkoGold
    );
    goldBuckle.position.set(0, 0.04, 0.12);
    pelvisGrp.add(hipCore, goldBuckle);

    // Front, rear, and left/right articulated Kusazuri skirt plates
    for (const side of [-1, 1]) {
      const sideTasset = new THREE.Mesh(
        bevelPlateGeo(THREE, 0.05, 0.22, 0.22, 0.008),
        mats.akazonaeLacquer
      );
      sideTasset.position.set(side * 0.18, -0.06, 0);
      sideTasset.rotation.z = -side * 0.22;
      pelvisGrp.add(sideTasset);

      const frontTasset = new THREE.Mesh(
        bevelPlateGeo(THREE, 0.13, 0.20, 0.04, 0.007),
        mats.karakuriIron
      );
      frontTasset.position.set(side * 0.075, -0.07, 0.12);
      frontTasset.rotation.x = -0.18;
      pelvisGrp.add(frontTasset);
    }
    addPart(bones.pelvis, pelvisGrp);

    // 2. TORSO (`torso`): Sculpted Karakuri-Samurai `Dou` Breastplate + Plasma Core + Dorsal Reactor + `Sode` Pauldrons
    const torsoGrp = new THREE.Group();
    const abdomen = new THREE.Mesh(
      cachedGeo(THREE, 'sam:abdomen', () => new THREE.CylinderGeometry(0.145, 0.13, 0.18, 10)),
      mats.karakuriIron
    );
    abdomen.position.set(0, 0.07, 0);

    const cuirassMain = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.36, 0.28, 0.25, 0.018),
      mats.ivoryPorcelain
    );
    cuirassMain.position.set(0, 0.23, 0.01);

    const cuirassBreast = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.28, 0.18, 0.06, 0.012),
      mats.akazonaeLacquer
    );
    cuirassBreast.position.set(0, 0.24, 0.13);

    const chestFurnaceFrame = new THREE.Mesh(
      cachedGeo(THREE, 'sam:furnaceFrame', () => new THREE.TorusGeometry(0.052, 0.012, 8, 16)),
      mats.kinkoGold
    );
    chestFurnaceFrame.position.set(0, 0.25, 0.162);
    const chestFurnaceCore = new THREE.Mesh(
      cachedGeo(THREE, 'sam:furnaceCore', () => new THREE.OctahedronGeometry(0.042, 1)),
      mats.reactorAmberGlow
    );
    chestFurnaceCore.scale.set(1, 1, 0.45);
    chestFurnaceCore.position.set(0, 0.25, 0.165);

    // Dorsal Karakuri Power-Pack with Dual Exhaust Vents
    const backPack = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.26, 0.25, 0.12, 0.014),
      mats.karakuriIron
    );
    backPack.position.set(0, 0.23, -0.15);
    const ventCylGeo = cachedGeo(THREE, 'sam:ventCyl', () => new THREE.CylinderGeometry(0.032, 0.038, 0.10, 8));
    const ventGlowGeo = cachedGeo(THREE, 'sam:ventGlow', () => new THREE.SphereGeometry(0.024, 6, 6));
    for (const sx of [-0.075, 0.075]) {
      const vent = new THREE.Mesh(ventCylGeo, mats.kinkoGold);
      vent.position.set(sx, 0.33, -0.16);
      vent.rotation.x = -0.25;
      const ventGlow = new THREE.Mesh(ventGlowGeo, mats.reactorAmberGlow);
      ventGlow.position.set(sx, 0.37, -0.17);
      torsoGrp.add(vent, ventGlow);
    }

    // Armored Neck Collar (`Nodowa 喉轮`)
    const collar = new THREE.Mesh(
      cachedGeo(THREE, 'sam:collar', () => new THREE.CylinderGeometry(0.095, 0.115, 0.09, 10)),
      mats.karakuriIron
    );
    collar.position.set(0, 0.39, 0);

    torsoGrp.add(
      abdomen,
      cuirassMain,
      cuirassBreast,
      chestFurnaceFrame,
      chestFurnaceCore,
      backPack,
      collar
    );

    // Role-specific Dorsal Sniper Mast & Boss Sashimono Banner + Heavy O-Sode
    const sniperPack = new THREE.Group();
    const mast = new THREE.Mesh(
      cachedGeo(THREE, 'sam:mast', () => new THREE.CylinderGeometry(0.012, 0.016, 0.58, 8)),
      mats.hydraulicChrome
    );
    mast.position.set(0.11, 0.55, -0.17);
    const mastBeacon = new THREE.Mesh(
      cachedGeo(THREE, 'sam:mastBeacon', () => new THREE.OctahedronGeometry(0.032, 0)),
      mats.sniperGoldGlow
    );
    mastBeacon.position.set(0.11, 0.85, -0.17);
    sniperPack.add(mast, mastBeacon);
    torsoGrp.add(sniperPack);

    const bossBannerGrp = new THREE.Group();
    const pole = new THREE.Mesh(
      cachedGeo(THREE, 'sam:pole', () => new THREE.CylinderGeometry(0.018, 0.020, 1.32, 8)),
      mats.kinkoGold
    );
    pole.position.set(0, 0.78, -0.22);
    const crossbar = new THREE.Mesh(
      cachedGeo(THREE, 'sam:crossbar', () => new THREE.CylinderGeometry(0.014, 0.014, 0.46, 8).rotateZ(Math.PI / 2)),
      mats.kinkoGold
    );
    crossbar.position.set(0, 1.38, -0.36);
    const bannerFlag = new THREE.Mesh(
      cachedGeo(THREE, 'sam:bannerFlag', () => new THREE.PlaneGeometry(0.42, 0.86)),
      mats.bannerSilk
    );
    bannerFlag.position.set(0, 0.94, -0.38);
    const bossHaloRing = new THREE.Mesh(
      cachedGeo(THREE, 'sam:bossHalo', () => new THREE.TorusGeometry(0.46, 0.022, 8, 24)),
      mats.kinkoGold
    );
    bossHaloRing.position.set(0, 0.42, -0.24);
    bossBannerGrp.add(pole, crossbar, bannerFlag, bossHaloRing);
    torsoGrp.add(bossBannerGrp);

    addPart(bones.torso, torsoGrp);

    // 3. HEAD (`head`): Karakuri-Samurai Kabuto Helmet + Menpo Faceplate + Glowing Visor + Role Variants!
    const headGrp = new THREE.Group();
    const cranium = new THREE.Mesh(
      cachedGeo(THREE, 'sam:cranium', () => new THREE.SphereGeometry(0.125, 12, 10)),
      mats.karakuriIron
    );
    cranium.position.set(0, 0.08, 0);

    // Flared Shikoro (`錣`) Samurai Neck-Guard Skirt
    const shikoro = new THREE.Mesh(
      cachedGeo(
        THREE,
        'sam:shikoro',
        () => new THREE.CylinderGeometry(0.125, 0.185, 0.13, 10, 1, true, Math.PI * 0.32, Math.PI * 1.36)
      ),
      mats.akazonaeLacquer
    );
    shikoro.position.set(0, 0.04, -0.01);

    // Menpo (`面颊`) Armored Jaw Mask + Horizontal Blazing Optic Visor Slit
    const menpo = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.17, 0.10, 0.14, 0.010),
      mats.ivoryPorcelain
    );
    menpo.position.set(0, 0.035, 0.055);

    const visorSlit = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.165, 0.032, 0.06, 0.004),
      mats.opticCrimsonGlow
    );
    visorSlit.position.set(0, 0.092, 0.098);
    headGrp.add(cranium, shikoro, menpo, visorSlit);

    // Trooper Wide Iron Jingasa-Kabuto Rim
    const trooperHat = new THREE.Group();
    const jingasaCone = new THREE.Mesh(
      cachedGeo(THREE, 'sam:jingasaCone', () => new THREE.ConeGeometry(0.28, 0.11, 14)),
      mats.karakuriIron
    );
    jingasaCone.position.set(0, 0.17, 0);
    const jingasaGoldRim = new THREE.Mesh(
      cachedGeo(THREE, 'sam:jingasaRim', () => new THREE.TorusGeometry(0.275, 0.010, 6, 20).rotateX(Math.PI / 2)),
      mats.kinkoGold
    );
    jingasaCone.add(jingasaGoldRim);
    jingasaGoldRim.position.y = -0.052;
    const jingasaCrest = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.065, 0.075, 0.025, 0.004),
      mats.kinkoGold
    );
    jingasaCrest.position.set(0, 0.18, 0.19);
    jingasaCrest.rotation.x = -0.35;
    trooperHat.add(jingasaCone, jingasaCrest);
    headGrp.add(trooperHat);

    // Sniper Tri-Lens Recon Visor Hood
    const sniperHelm = new THREE.Group();
    const hood = new THREE.Mesh(
      cachedGeo(THREE, 'sam:hood', () => new THREE.CylinderGeometry(0.13, 0.16, 0.16, 10)),
      mats.akazonaeLacquer
    );
    hood.position.set(0, 0.12, -0.01);
    const lensGeo = cachedGeo(
      THREE,
      'sam:sniperLens',
      () => new THREE.CylinderGeometry(0.022, 0.022, 0.06, 10).rotateX(Math.PI / 2)
    );
    for (const lx of [-0.052, 0, 0.052]) {
      const lens = new THREE.Mesh(lensGeo, mats.sniperGoldGlow);
      lens.position.set(lx, 0.095, 0.125);
      sniperHelm.add(lens);
    }
    headGrp.add(sniperHelm);

    // Vanguard / Boss Horned `Kuwagata 锹形` Kabuto Crest!
    const hornedCrest = new THREE.Group();
    for (const side of [-1, 1]) {
      const hornGeo = cachedGeo(THREE, `sam:horn:${side}`, () => {
        const hornCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * 0.04, 0.15, 0.11),
          new THREE.Vector3(side * 0.15, 0.26, 0.09),
          new THREE.Vector3(side * 0.21, 0.40, 0.03),
        ]);
        return new THREE.TubeGeometry(hornCurve, 10, 0.018, 6, false);
      });
      const horn = new THREE.Mesh(hornGeo, mats.kinkoGold);
      hornedCrest.add(horn);
    }
    const sunDisc = new THREE.Mesh(
      cachedGeo(THREE, 'sam:sunDisc', () => new THREE.CylinderGeometry(0.048, 0.048, 0.012, 12).rotateX(Math.PI / 2)),
      mats.kinkoGold
    );
    sunDisc.position.set(0, 0.19, 0.12);
    hornedCrest.add(sunDisc);
    headGrp.add(hornedCrest);

    addPart(bones.head, headGrp);

    // 4. ARMS & WEAPONS (`armL`, `forearmL`, `armR`, `forearmR`)
    const bicepGeo = cachedGeo(THREE, 'sam:bicep', () => new THREE.CylinderGeometry(0.055, 0.048, 0.24, 8));
    const elbowGeo = cachedGeo(THREE, 'sam:elbow', () => new THREE.SphereGeometry(0.052, 8, 6));
    for (const side of [-1, 1]) {
      const armBone = side === 1 ? bones.armL : bones.armR;
      const foreBone = side === 1 ? bones.forearmL : bones.forearmR;

      // Layered Sode Shoulder Shield + Robotic Upper Arm
      const upperGrp = new THREE.Group();
      const sode = new THREE.Mesh(
        bevelPlateGeo(THREE, 0.10, 0.20, 0.20, 0.010),
        mats.akazonaeLacquer
      );
      sode.position.set(side * 0.065, -0.04, 0);
      sode.rotation.z = -side * 0.24;
      const sodeTrim = new THREE.Mesh(
        bevelPlateGeo(THREE, 0.11, 0.045, 0.21, 0.006),
        mats.kinkoGold
      );
      sodeTrim.position.set(side * 0.068, 0.05, 0);
      sodeTrim.rotation.z = -side * 0.24;

      const bicep = new THREE.Mesh(bicepGeo, mats.karakuriIron);
      bicep.position.set(0, -0.12, 0);
      const elbow = new THREE.Mesh(elbowGeo, mats.kinkoGold);
      elbow.position.set(0, -0.24, 0);
      upperGrp.add(sode, sodeTrim, bicep, elbow);
      addPart(armBone, upperGrp);

      // Kote Armored Forearm Vambrace + Mechanical Fist
      const foreGrp = new THREE.Group();
      const kote = new THREE.Mesh(
        bevelPlateGeo(THREE, 0.095, 0.22, 0.10, 0.009),
        mats.ivoryPorcelain
      );
      kote.position.set(0, -0.11, 0);
      const fist = new THREE.Mesh(
        bevelPlateGeo(THREE, 0.085, 0.085, 0.09, 0.008),
        mats.karakuriIron
      );
      fist.position.set(0, -0.24, 0.01);
      foreGrp.add(kote, fist);
      addPart(foreBone, foreGrp);
    }

    // Right Forearm Karakuri Pulse-Arquebus (`机巧脉冲铁炮`) + Sniper Long Barrel Variant!
    const gunGrp = new THREE.Group();
    // Oriented in `forearmR` local space so it points straight along the trooper's aim!
    gunGrp.position.set(0.04, -0.24, 0.16);
    gunGrp.rotation.x = Math.PI * 0.42;

    const gunReceiver = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.075, 0.11, 0.44, 0.008),
      mats.karakuriIron
    );
    const gunGoldTrim = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.082, 0.038, 0.28, 0.005),
      mats.kinkoGold
    );
    gunGoldTrim.position.set(0, 0.042, 0.04);
    const gunBarrel = new THREE.Mesh(
      cachedGeo(THREE, 'sam:gunBarrel', () => new THREE.CylinderGeometry(0.024, 0.028, 0.52, 10).rotateX(Math.PI / 2)),
      mats.hydraulicChrome
    );
    gunBarrel.position.set(0, 0.025, 0.42);
    const gunMuzzleGlow = new THREE.Mesh(
      cachedGeo(THREE, 'sam:gunMuzzle', () => new THREE.CylinderGeometry(0.028, 0.028, 0.08, 10).rotateX(Math.PI / 2)),
      mats.reactorAmberGlow
    );
    gunMuzzleGlow.position.set(0, 0.025, 0.68);

    const sniperLongBarrel = new THREE.Mesh(
      cachedGeo(THREE, 'sam:sniperBarrel', () => new THREE.CylinderGeometry(0.018, 0.024, 0.56, 10).rotateX(Math.PI / 2)),
      mats.hydraulicChrome
    );
    sniperLongBarrel.position.set(0, 0.025, 0.88);
    const sniperScope = new THREE.Mesh(
      cachedGeo(THREE, 'sam:sniperScope', () => new THREE.CylinderGeometry(0.024, 0.024, 0.24, 10).rotateX(Math.PI / 2)),
      mats.kinkoGold
    );
    sniperScope.position.set(0, 0.088, 0.12);

    gunGrp.add(gunReceiver, gunGoldTrim, gunBarrel, gunMuzzleGlow, sniperLongBarrel, sniperScope);
    addPart(bones.forearmR, gunGrp);

    // 5. LEGS (`thighL/R`, `shinL/R`, `footL/R`): Haidate Thigh Plates, Gold Knees & Suneate Shin Greaves
    const thighCylGeo = cachedGeo(THREE, 'sam:thighCyl', () => new THREE.CylinderGeometry(0.082, 0.068, 0.38, 8));
    const kneeCapGeo = cachedGeo(THREE, 'sam:kneeCap', () => new THREE.OctahedronGeometry(0.068, 1));
    const strutGeo = cachedGeo(THREE, 'sam:strut', () => new THREE.CylinderGeometry(0.022, 0.022, 0.34, 6));
    for (const side of [-1, 1]) {
      const thighBone = side === 1 ? bones.thighL : bones.thighR;
      const shinBone = side === 1 ? bones.shinL : bones.shinR;
      const footBone = side === 1 ? bones.footL : bones.footR;

      const thighGrp = new THREE.Group();
      const thighCyl = new THREE.Mesh(thighCylGeo, mats.karakuriIron);
      thighCyl.position.set(0, -0.19, 0);
      const haidate = new THREE.Mesh(
        bevelPlateGeo(THREE, 0.14, 0.28, 0.14, 0.010),
        mats.ivoryPorcelain
      );
      haidate.position.set(0, -0.17, 0.02);
      const kneeCap = new THREE.Mesh(kneeCapGeo, mats.kinkoGold);
      kneeCap.scale.set(1.0, 1.15, 0.75);
      kneeCap.position.set(0, -0.39, 0.05);
      thighGrp.add(thighCyl, haidate, kneeCap);
      addPart(thighBone, thighGrp);

      const shinGrp = new THREE.Group();
      const suneate = new THREE.Mesh(
        bevelPlateGeo(THREE, 0.12, 0.36, 0.13, 0.010),
        mats.akazonaeLacquer
      );
      suneate.position.set(0, -0.19, 0.01);
      const strut = new THREE.Mesh(strutGeo, mats.hydraulicChrome);
      strut.position.set(0, -0.19, -0.065);
      shinGrp.add(suneate, strut);
      addPart(shinBone, shinGrp);

      const footGrp = new THREE.Group();
      const sabaton = new THREE.Mesh(
        bevelPlateGeo(THREE, 0.12, 0.08, 0.22, 0.009),
        mats.karakuriIron
      );
      sabaton.position.set(0, -0.02, 0.04);
      footGrp.add(sabaton);
      addPart(footBone, footGrp);
    }

    en.__samuraiRig = {
      parts,
      cuirassMain,
      cuirassBreast,
      visorSlit,
      trooperHat,
      sniperHelm,
      hornedCrest,
      sniperPack,
      bossBannerGrp,
      gunGrp,
      sniperLongBarrel,
      sniperScope,
    };
  }

  // Ensure all custom samurai parts are visible and configured for the exact role!
  const sr = en.__samuraiRig;
  for (const p of sr.parts) p.visible = true;

  sr.trooperHat.visible = role === 'trooper';
  sr.sniperHelm.visible = role === 'sniper';
  sr.hornedCrest.visible = role === 'shield_guard' || role === 'boss';
  sr.sniperPack.visible = role === 'sniper';
  sr.bossBannerGrp.visible = role === 'boss';
  sr.gunGrp.visible = role !== 'shield_guard';
  sr.sniperLongBarrel.visible = role === 'sniper';
  sr.sniperScope.visible = role === 'sniper';

  sr.cuirassMain.material =
    role === 'boss'
      ? mats.akazonaeLacquer
      : role === 'shield_guard'
        ? mats.karakuriIron
        : mats.ivoryPorcelain;
  sr.cuirassBreast.material = role === 'sniper' ? mats.karakuriIron : mats.akazonaeLacquer;
  sr.visorSlit.material = role === 'sniper' ? mats.sniperGoldGlow : mats.opticCrimsonGlow;
}

/**
 * Builds the Shield Guard's Monumental Bevelled Hex-Frame Sengoku Riot Tower Shield (`玄甲六角能量大盾`).
 * Mounted directly to `bones.pelvis` when available so the shield strides, crouches, leans, and topples with the body!
 */
export function buildMasterworkShieldGuardAttachment(G: any, en: any) {
  if (en.__shieldDecor) return en.__shieldDecor;
  const THREE = G.THREE;
  const mats = getEnemyPbrSuite(G);

  const grp = new THREE.Group();
  grp.__customEnemyRoot = true;

  // Heavy Chamfered Octagonal/Hexagonal Riot Frame (`0.94m x 1.44m`)
  const shieldFrame = new THREE.Mesh(
    bevelPlateGeo(THREE, 0.92, 1.42, 0.08, 0.020),
    mats.karakuriIron
  );
  shieldFrame.position.set(0.10, 0.94, 0.46);

  const innerCrimsonPlate = new THREE.Mesh(
    bevelPlateGeo(THREE, 0.72, 1.18, 0.09, 0.015),
    mats.akazonaeLacquer
  );
  innerCrimsonPlate.position.set(0.10, 0.94, 0.465);

  // Armored Viewport Slit + Central Golden Shimada Crest Boss + 4 Corner Locking Bolts
  const viewportGlow = new THREE.Mesh(
    bevelPlateGeo(THREE, 0.48, 0.055, 0.105, 0.005),
    mats.sniperGoldGlow
  );
  viewportGlow.position.set(0.10, 1.32, 0.47);

  const centralCrest = new THREE.Mesh(
    cachedGeo(THREE, 'shd:crest', () => new THREE.OctahedronGeometry(0.15, 1)),
    mats.kinkoGold
  );
  centralCrest.scale.set(1.1, 1.35, 0.38);
  centralCrest.position.set(0.10, 0.92, 0.52);

  const shieldBoltGeo = cachedGeo(
    THREE,
    'shd:bolt',
    () => new THREE.CylinderGeometry(0.045, 0.052, 0.11, 6).rotateX(Math.PI / 2)
  );
  for (const cx of [-0.36, 0.36]) {
    for (const cy of [0.36, 1.50]) {
      const bolt = new THREE.Mesh(shieldBoltGeo, mats.kinkoGold);
      bolt.position.set(0.10 + cx, cy, 0.47);
      grp.add(bolt);
    }
  }

  // Projected Octagonal Hex-Lattice Energy Barrier (`en.__shieldEnergyRim`) — soft ShaderMaterial
  const energyRim = new THREE.Mesh(
    cachedGeo(THREE, 'shd:energyRim', () => new THREE.PlaneGeometry(1.14, 1.60)),
    mats.shieldHexBarrier
  );
  energyRim.position.set(0.10, 0.94, 0.545);

  grp.add(shieldFrame, innerCrimsonPlate, viewportGlow, centralCrest, energyRim);
  enableShadowsRecursive(grp);
  energyRim.castShadow = false;
  energyRim.receiveShadow = false;

  const pelvisBone = en.rig && en.rig.bones ? en.rig.bones.pelvis : null;
  if (pelvisBone) {
    const restY = pelvisBone.position && pelvisBone.position.y > 0.4 ? pelvisBone.position.y : 0;
    grp.position.set(0, -restY, 0);
    pelvisBone.add(grp);
  } else {
    en.rig.group.add(grp);
  }
  en.__shieldDecor = grp;
  en.__shieldEnergyRim = energyRim;
  return grp;
}

/**
 * Builds the Pure Custom Quadruped Heavy Spider Battle-Mech (`四足重装机关蜘蛛`):
 * Hides the underlying `hound` SkinnedMesh 100% and constructs a suspended arachnid hull (`__spiderChassis`),
 * glowing tri-optic sensor cluster, rear plasma reactor abdomen, 360° Twin Rotary Autocannon Turret,
 * and 4 true 3-DOF (`coxa -> femurPivot -> tibiaPivot`) diagonal-trot hydraulic spider legs!
 */
export function buildMasterworkSpiderMechRig(G: any, en: any) {
  setBaseEnemySkinnedMeshVisible(en, false);
  if (en.__spiderDecor) return en.__spiderDecor;

  const THREE = G.THREE;
  const mats = getEnemyPbrSuite(G);

  const grp = new THREE.Group();
  grp.__customEnemyRoot = true;
  grp.position.set(0, 0.42, 0);

  const chassisGrp = new THREE.Group();
  grp.add(chassisGrp);

  // 1. Sloped Bevelled Arachnid Main Chassis + Ivory Porcelain Upper Carapace
  const lowerChassis = new THREE.Mesh(
    bevelPlateGeo(THREE, 0.78, 0.24, 0.88, 0.024),
    mats.karakuriIron
  );
  lowerChassis.position.set(0, 0.14, 0.02);

  const upperCarapace = new THREE.Mesh(
    bevelPlateGeo(THREE, 0.68, 0.16, 0.74, 0.022),
    mats.ivoryPorcelain
  );
  upperCarapace.position.set(0, 0.28, 0.04);

  const crimsonStripe = new THREE.Mesh(
    bevelPlateGeo(THREE, 0.24, 0.175, 0.76, 0.010),
    mats.akazonaeLacquer
  );
  crimsonStripe.position.set(0, 0.282, 0.04);

  // Forward Tri-Lens Crimson Arachnid Sensor Cluster + Twin Pincer Mandibles
  const visorHousing = new THREE.Mesh(
    bevelPlateGeo(THREE, 0.44, 0.14, 0.18, 0.014),
    mats.karakuriIron
  );
  visorHousing.position.set(0, 0.20, 0.48);
  const eyeCenterGeo = cachedGeo(THREE, 'spd:eyeCenter', () => new THREE.SphereGeometry(0.062, 10, 8));
  const eyeSideGeo = cachedGeo(THREE, 'spd:eyeSide', () => new THREE.SphereGeometry(0.042, 10, 8));
  for (const ex of [-0.12, 0, 0.12]) {
    const eye = new THREE.Mesh(ex === 0 ? eyeCenterGeo : eyeSideGeo, mats.opticCrimsonGlow);
    eye.position.set(ex, 0.20 + (ex === 0 ? 0.01 : -0.01), 0.56);
    chassisGrp.add(eye);
  }
  for (const side of [-1, 1]) {
    const fang = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.055, 0.065, 0.22, 0.008),
      mats.kinkoGold
    );
    fang.position.set(side * 0.18, 0.12, 0.56);
    fang.rotation.y = -side * 0.28;
    chassisGrp.add(fang);
  }

  // Rear Armored Abdomen Plasma Reactor Pod + Cooling Gills
  const abdomenArmor = new THREE.Mesh(
    bevelPlateGeo(THREE, 0.62, 0.28, 0.48, 0.024),
    mats.akazonaeLacquer
  );
  abdomenArmor.position.set(0, 0.22, -0.56);
  abdomenArmor.rotation.x = -0.16;
  const reactorCore = new THREE.Mesh(
    cachedGeo(THREE, 'spd:reactor', () => new THREE.CylinderGeometry(0.14, 0.14, 0.52, 10).rotateZ(Math.PI / 2)),
    mats.reactorAmberGlow
  );
  reactorCore.position.set(0, 0.23, -0.62);

  chassisGrp.add(lowerChassis, upperCarapace, crimsonStripe, visorHousing, abdomenArmor, reactorCore);

  // 2. Dorsal 360° Rotating Twin-Rotary Autocannon Turret (`en.__spiderTurret`)
  const turret = new THREE.Group();
  turret.position.set(0, 0.38, 0.04);
  const turretRing = new THREE.Mesh(
    cachedGeo(THREE, 'spd:turretRing', () => new THREE.CylinderGeometry(0.24, 0.27, 0.07, 12)),
    mats.kinkoGold
  );
  const turretHousing = new THREE.Mesh(
    bevelPlateGeo(THREE, 0.42, 0.20, 0.44, 0.016),
    mats.karakuriIron
  );
  turretHousing.position.y = 0.12;
  const turretSensor = new THREE.Mesh(
    cachedGeo(THREE, 'spd:turretSensor', () => new THREE.CylinderGeometry(0.045, 0.045, 0.12, 10).rotateX(Math.PI / 2)),
    mats.opticCrimsonGlow
  );
  turretSensor.position.set(0, 0.18, 0.20);
  turret.add(turretRing, turretHousing, turretSensor);

  const ammoDrumGeo = cachedGeo(THREE, 'spd:ammoDrum', () => new THREE.CylinderGeometry(0.095, 0.095, 0.16, 10).rotateZ(Math.PI / 2));
  const shroudGeo = cachedGeo(THREE, 'spd:shroud', () => new THREE.CylinderGeometry(0.052, 0.058, 0.56, 10).rotateX(Math.PI / 2));
  const muzzleCollarGeo = cachedGeo(THREE, 'spd:muzzleCollar', () => new THREE.CylinderGeometry(0.062, 0.058, 0.09, 10).rotateX(Math.PI / 2));
  for (const side of [-1, 1]) {
    const ammoDrum = new THREE.Mesh(ammoDrumGeo, mats.akazonaeLacquer);
    ammoDrum.position.set(side * 0.24, 0.11, 0.02);
    const shroud = new THREE.Mesh(shroudGeo, mats.hydraulicChrome);
    shroud.position.set(side * 0.14, 0.11, 0.38);
    const muzzleCollar = new THREE.Mesh(muzzleCollarGeo, mats.kinkoGold);
    muzzleCollar.position.set(side * 0.14, 0.11, 0.64);
    turret.add(ammoDrum, shroud, muzzleCollar);
  }
  chassisGrp.add(turret);

  // 3. Four True 3-DOF Articulated Hydraulic Spider Legs (`en.__spiderLegs`)
  // Order: 0 = Front-Right (+X,+Z), 1 = Rear-Right (+X,-Z), 2 = Front-Left (-X,+Z), 3 = Rear-Left (-X,-Z)
  // Diagonal trot pairs: (0: FR + 3: RL) => diag 0; (1: RR + 2: FL) => diag 1!
  const legs: any[] = [];
  const legAngles = [Math.PI * 0.24, Math.PI * 0.76, -Math.PI * 0.24, -Math.PI * 0.76];
  const coxaGeo = cachedGeo(THREE, 'spd:coxa', () => new THREE.CylinderGeometry(0.09, 0.09, 0.14, 10));
  const pistonRodGeo = cachedGeo(THREE, 'spd:piston', () => new THREE.CylinderGeometry(0.024, 0.028, 0.48, 8).rotateX(Math.PI / 2));
  const kneeGeo = cachedGeo(THREE, 'spd:knee', () => new THREE.CylinderGeometry(0.075, 0.075, 0.13, 10).rotateZ(Math.PI / 2));
  const footClawGeo = cachedGeo(THREE, 'spd:claw', () => new THREE.ConeGeometry(0.075, 0.16, 6));
  for (let i = 0; i < 4; i++) {
    const hip = new THREE.Group();
    const a = legAngles[i];
    hip.position.set(Math.sin(a) * 0.38, 0.14, Math.cos(a) * 0.38);
    hip.rotation.y = a;

    // Brass Coxa Servo Drum (rotates horizontally around Y)
    const coxa = new THREE.Mesh(coxaGeo, mats.kinkoGold);
    hip.add(coxa);

    // Femur Elevation Pivot (rotates vertically around local X)
    const femurPivot = new THREE.Group();
    const femurPlate = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.11, 0.13, 0.56, 0.010),
      mats.ivoryPorcelain
    );
    femurPlate.position.set(0, 0.18, 0.26);
    femurPlate.rotation.x = -0.58;

    const pistonRod = new THREE.Mesh(pistonRodGeo, mats.hydraulicChrome);
    pistonRod.position.set(0, 0.10, 0.26);
    pistonRod.rotation.x = -0.52;
    femurPivot.add(femurPlate, pistonRod);

    // Knee Servo Joint Pivot (`tibiaPivot` at femur tip `(0, 0.32, 0.50)`, flexes independently around local X!)
    const tibiaPivot = new THREE.Group();
    tibiaPivot.position.set(0, 0.32, 0.50);

    const knee = new THREE.Mesh(kneeGeo, mats.kinkoGold);

    const tibiaArmor = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.095, 0.76, 0.14, 0.010),
      mats.karakuriIron
    );
    tibiaArmor.position.set(0, -0.38, 0.14);
    tibiaArmor.rotation.x = 0.28;

    const tibiaAccent = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.102, 0.32, 0.08, 0.007),
      mats.akazonaeLacquer
    );
    tibiaAccent.position.set(0, -0.24, 0.13);
    tibiaAccent.rotation.x = 0.28;

    const footClaw = new THREE.Mesh(footClawGeo, mats.kinkoGold);
    footClaw.rotation.x = Math.PI;
    footClaw.position.set(0, -0.76, 0.24);

    tibiaPivot.add(knee, tibiaArmor, tibiaAccent, footClaw);
    femurPivot.add(tibiaPivot);
    hip.add(femurPivot);
    grp.add(hip);

    const side = i < 2 ? 1 : -1;
    const diag: 0 | 1 = i === 0 || i === 3 ? 0 : 1;
    legs.push({ hip, femurPivot, tibiaPivot, baseYaw: a, side, diag });
  }

  enableShadowsRecursive(grp);
  en.rig.group.add(grp);
  en.__spiderDecor = grp;
  en.__spiderChassis = chassisGrp;
  en.__spiderTurret = turret;
  en.__spiderLegs = legs;
  return grp;
}

/**
 * Builds the Pure Custom Hexapod Siege-Artillery Crab Mech (`六足轰击机关蟹`):
 * Hides the underlying `hound` SkinnedMesh 100% and builds a suspended siege carapace (`__crabChassis`),
 * articulated hydraulic front pincer-claws (`__crabClaws`), recoil-mounted twin magma-coil mortars (`__crabMortarCradle`),
 * and 6 true 3-DOF alternating-tripod crab legs!
 */
export function buildMasterworkMortarCrabRig(G: any, en: any) {
  setBaseEnemySkinnedMeshVisible(en, false);
  if (en.__crabDecor) return en.__crabDecor;

  const THREE = G.THREE;
  const mats = getEnemyPbrSuite(G);

  const grp = new THREE.Group();
  grp.__customEnemyRoot = true;
  grp.position.set(0, 0.36, 0);

  const chassisGrp = new THREE.Group();
  grp.add(chassisGrp);

  // 1. Broad Sloped Hexagonal Siege-Tank Carapace + Gold Skirt Trim
  const mainHull = new THREE.Mesh(
    bevelPlateGeo(THREE, 1.18, 0.32, 0.92, 0.028),
    mats.akazonaeLacquer
  );
  mainHull.position.set(0, 0.20, 0);

  const upperDeck = new THREE.Mesh(
    bevelPlateGeo(THREE, 0.96, 0.14, 0.74, 0.020),
    mats.karakuriIron
  );
  upperDeck.position.set(0, 0.38, -0.02);

  const goldSkirt = new THREE.Mesh(
    bevelPlateGeo(THREE, 1.24, 0.08, 0.96, 0.014),
    mats.kinkoGold
  );
  goldSkirt.position.set(0, 0.08, 0);

  chassisGrp.add(mainHull, upperDeck, goldSkirt);

  // Forward Armored Visor Bar + Twin Stalk-Mounted Crimson Optics
  const stalkGeo = cachedGeo(THREE, 'crb:stalk', () => new THREE.CylinderGeometry(0.032, 0.04, 0.16, 8));
  const stalkEyeGeo = cachedGeo(THREE, 'crb:stalkEye', () => new THREE.SphereGeometry(0.052, 10, 8));
  for (const sx of [-0.22, 0.22]) {
    const stalk = new THREE.Mesh(stalkGeo, mats.hydraulicChrome);
    stalk.position.set(sx, 0.34, 0.44);
    stalk.rotation.x = 0.35;
    const eye = new THREE.Mesh(stalkEyeGeo, mats.opticCrimsonGlow);
    eye.position.set(sx, 0.41, 0.49);
    chassisGrp.add(stalk, eye);
  }

  // 2. Twin Hydraulic Front Siege Pincer-Claws (`en.__crabClaws`)!
  const crabClaws: any[] = [];
  const clawShoulderGeo = cachedGeo(THREE, 'crb:shoulder', () => new THREE.SphereGeometry(0.095, 8, 8));
  for (const side of [-1, 1]) {
    const clawArm = new THREE.Group();
    clawArm.position.set(side * 0.52, 0.16, 0.38);
    clawArm.rotation.y = -side * 0.34;

    const shoulder = new THREE.Mesh(clawShoulderGeo, mats.kinkoGold);
    const forearm = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.20, 0.16, 0.36, 0.014),
      mats.ivoryPorcelain
    );
    forearm.position.set(0, 0, 0.20);

    const upperJaw = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.14, 0.07, 0.28, 0.008),
      mats.karakuriIron
    );
    upperJaw.position.set(-side * 0.03, 0.05, 0.44);
    upperJaw.rotation.y = side * 0.18;

    const lowerJaw = new THREE.Mesh(
      bevelPlateGeo(THREE, 0.12, 0.06, 0.25, 0.008),
      mats.kinkoGold
    );
    lowerJaw.position.set(side * 0.03, -0.04, 0.42);
    lowerJaw.rotation.y = -side * 0.15;

    clawArm.add(shoulder, forearm, upperJaw, lowerJaw);
    chassisGrp.add(clawArm);
    crabClaws.push({ clawArm, side, baseYaw: -side * 0.34 });
  }

  // 3. Elevated Twin-Barrel Magma-Coil Siege Mortar Battery (`en.__crabMortarCradle`)!
  const mortarCradle = new THREE.Group();
  mortarCradle.position.set(0, 0.46, -0.06);
  mortarCradle.rotation.x = 0.52;

  const cradleBase = new THREE.Mesh(
    bevelPlateGeo(THREE, 0.64, 0.22, 0.36, 0.016),
    mats.karakuriIron
  );
  mortarCradle.add(cradleBase);

  const mortarBarrelPool: any[] = [];
  const mortarBarrelGeo = cachedGeo(THREE, 'crb:barrel', () => new THREE.CylinderGeometry(0.125, 0.155, 0.62, 12));
  const recoilSleeveGeo = cachedGeo(THREE, 'crb:sleeve', () => new THREE.CylinderGeometry(0.168, 0.168, 0.22, 12));
  const plasmaCoilGeo = cachedGeo(THREE, 'crb:coil', () => new THREE.TorusGeometry(0.145, 0.026, 8, 16).rotateX(Math.PI / 2));
  const boreGlowGeo = cachedGeo(THREE, 'crb:bore', () => new THREE.CylinderGeometry(0.10, 0.10, 0.06, 12));
  for (const side of [-1, 1]) {
    const barrelSlide = new THREE.Group();
    barrelSlide.position.set(side * 0.19, 0, 0);

    const barrel = new THREE.Mesh(mortarBarrelGeo, mats.karakuriIron);
    barrel.position.set(0, 0.30, 0);

    const recoilSleeve = new THREE.Mesh(recoilSleeveGeo, mats.kinkoGold);
    recoilSleeve.position.set(0, 0.16, 0);
    mortarCradle.add(recoilSleeve);
    recoilSleeve.position.x = side * 0.19;

    const plasmaCoil = new THREE.Mesh(plasmaCoilGeo, mats.reactorAmberGlow);
    plasmaCoil.position.set(0, 0.42, 0);

    const boreGlow = new THREE.Mesh(boreGlowGeo, mats.opticCrimsonGlow);
    boreGlow.position.set(0, 0.60, 0);

    barrelSlide.add(barrel, plasmaCoil, boreGlow);
    mortarCradle.add(barrelSlide);
    mortarBarrelPool.push(barrelSlide);
  }
  chassisGrp.add(mortarCradle);

  // 4. Six True 3-DOF Alternating-Tripod Armored Crab Legs (`en.__crabLegs`)
  // Tripod A (`groupIndex = 0`): Left-Front, Right-Middle, Left-Rear
  // Tripod B (`groupIndex = 1`): Right-Front, Left-Middle, Right-Rear
  const crabLegs: any[] = [];
  const hipServoGeo = cachedGeo(THREE, 'crb:hipServo', () => new THREE.SphereGeometry(0.078, 8, 6));
  const kneeJointGeo = cachedGeo(THREE, 'crb:kneeJoint', () => new THREE.SphereGeometry(0.068, 8, 6));
  const lowerSpikeGeo = cachedGeo(THREE, 'crb:lowerSpike', () => new THREE.ConeGeometry(0.068, 0.58, 6));
  for (const side of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      const legPivot = new THREE.Group();
      legPivot.position.set(side * 0.58, 0.16, k * 0.30);
      const baseYaw = -side * k * 0.20;
      legPivot.rotation.y = baseYaw;

      const hipServo = new THREE.Mesh(hipServoGeo, mats.kinkoGold);
      legPivot.add(hipServo);

      const femurPivot = new THREE.Group();
      const upperLeg = new THREE.Mesh(
        bevelPlateGeo(THREE, 0.34, 0.10, 0.11, 0.010),
        mats.ivoryPorcelain
      );
      upperLeg.position.set(side * 0.16, 0.06, 0);
      upperLeg.rotation.z = side * 0.28;
      femurPivot.add(upperLeg);

      const tibiaPivot = new THREE.Group();
      tibiaPivot.position.set(side * 0.32, 0.12, 0);
      const kneeJoint = new THREE.Mesh(kneeJointGeo, mats.kinkoGold);

      const lowerSpike = new THREE.Mesh(lowerSpikeGeo, mats.karakuriIron);
      lowerSpike.position.set(side * 0.10, -0.28, 0);
      lowerSpike.rotation.z = side * 2.86;

      tibiaPivot.add(kneeJoint, lowerSpike);
      femurPivot.add(tibiaPivot);
      legPivot.add(femurPivot);
      grp.add(legPivot);

      const rowIdx = k + 1; // 0 = rear, 1 = mid, 2 = front
      const groupIndex: 0 | 1 = ((side < 0 ? 0 : 1) + rowIdx) % 2 === 0 ? 0 : 1;
      crabLegs.push({
        pivot: legPivot,
        femurPivot,
        tibiaPivot,
        side,
        baseYaw,
        groupIndex,
      });
    }
  }

  enableShadowsRecursive(grp);
  en.rig.group.add(grp);
  en.__crabDecor = grp;
  en.__crabChassis = chassisGrp;
  en.__crabClaws = crabClaws;
  en.__crabMortarCradle = mortarCradle;
  en.__crabMortarBarrels = mortarBarrelPool;
  en.__crabLegs = crabLegs;
  return grp;
}

/**
 * Pre-warms every pooled `trooper` and `hound` rig at boot so mid-wave enemy spawns
 * perform ZERO `BufferGeometry`, `Material`, or `Mesh` allocations!
 */
export function prewarmEnemyVariantPools(G: any) {
  if (!G || !G.enemies || !G.enemies.debug) return;
  getEnemyPbrSuite(G);
  const dbg = G.enemies.debug;

  let tCount = 0;
  if (Array.isArray(dbg.troopers)) {
    for (const tr of dbg.troopers) {
      if (!tr || !tr.rig || !tr.rig.group) continue;
      applyKarakuriSamuraiRig(G, tr, 'trooper');
      const shd = buildMasterworkShieldGuardAttachment(G, tr);
      if (shd) shd.visible = false;
      tCount++;
    }
  }

  let hCount = 0;
  if (Array.isArray(dbg.hounds)) {
    for (const hd of dbg.hounds) {
      if (!hd || !hd.rig || !hd.rig.group) continue;
      const spd = buildMasterworkSpiderMechRig(G, hd);
      const crb = buildMasterworkMortarCrabRig(G, hd);
      if (spd) spd.visible = false;
      if (crb) crb.visible = false;
      setBaseEnemySkinnedMeshVisible(hd, true);
      hCount++;
    }
  }

  lastPrewarmedTroopers = tCount;
  lastPrewarmedHounds = hCount;
}

export function getEnemyPoolDiagnostics() {
  return {
    geoBankCount: cachedGeoBank ? cachedGeoBank.map.size : 0,
    prewarmedTroopers: lastPrewarmedTroopers,
    prewarmedHounds: lastPrewarmedHounds,
    sharedPbrReady: !!cachedEnemySuite,
  };
}
