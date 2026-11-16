/**
 * High-Craft PBR First-Person Weapons & Anatomical Multi-Jointed Gauntlets / Tactical Gloves
 * for `守望争锋` (`Shimada Genji` & `Tactical Gunner`).
 *
 * Procedurally synthesizes sRGB albedo + grayscale bump/roughness CanvasTextures (zero external URLs)
 * and sculpted bevelled `ExtrudeGeometry` / articulated 3-phalanx finger assemblies so first-person
 * hands and weapons seamlessly match the classical-meets-cyber Hanamura PBR world aesthetic.
 */

import { enhanceMaterialStylized } from './stylizedRenderPipeline';

export interface HeroViewmodelPbrSuite {
  gunmetal: any;
  darkSteel: any;
  cyberSilverArmor: any;
  cobaltAlloy: any;
  ceramicShroud: any;
  crimsonAnodized: any;
  forgedGold: any;
  carbonWeave: any;
  tacticalLeather: any;
  damascusBlade: any;
  urushiLacquer: any;
  tsukaSilk: any;
  indigoCloth: any;
  kyudoBuckskin: any;
  shimadaAzureSilk: any;
  plasmaCyanGlow: any;
  visorCrimsonGlow: any;
  jadeChakraGlow: any;
  amberLedGlow: any;
  holoLensGlass: any;
}

let cachedSuite: HeroViewmodelPbrSuite | null = null;
let cachedThreeRef: any = null;

function makeCanvasPair(size = 256) {
  const cMap = document.createElement('canvas');
  cMap.width = size;
  cMap.height = size;
  const cBump = document.createElement('canvas');
  cBump.width = size;
  cBump.height = size;
  const ctxMap = cMap.getContext('2d')!;
  const ctxBump = cBump.getContext('2d')!;
  return { cMap, cBump, ctxMap, ctxBump, size };
}

function finalizeTextures(THREE: any, G: any, cMap: HTMLCanvasElement, cBump: HTMLCanvasElement, repeatX = 1, repeatY = 1) {
  const maxAniso =
    G && G.renderer && G.renderer.capabilities && G.renderer.capabilities.getMaxAnisotropy
      ? Math.min(8, G.renderer.capabilities.getMaxAnisotropy())
      : 4;

  const map = new THREE.CanvasTexture(cMap);
  if (THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  map.anisotropy = maxAniso;
  map.needsUpdate = true;

  const bump = new THREE.CanvasTexture(cBump);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(repeatX, repeatY);
  bump.anisotropy = maxAniso;
  bump.needsUpdate = true;

  return { map, bump };
}

export function getHeroViewmodelPbrSuite(G: any): HeroViewmodelPbrSuite {
  const THREE = G.THREE;
  if (cachedSuite && cachedThreeRef === THREE) {
    return cachedSuite;
  }
  cachedThreeRef = THREE;

  // 1. Brushed Gunmetal Titanium (milled longitudinal grain + panel seams + micro-rivets)
  const gm = makeCanvasPair(256);
  gm.ctxMap.fillStyle = '#242a34';
  gm.ctxMap.fillRect(0, 0, 256, 256);
  gm.ctxBump.fillStyle = '#808080';
  gm.ctxBump.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    const v = 34 + ((y * 17) % 14);
    gm.ctxMap.fillStyle = `rgb(${v},${v + 5},${v + 13})`;
    gm.ctxMap.fillRect(0, y, 256, 1);
    const bv = 118 + ((y * 23) % 20);
    gm.ctxBump.fillStyle = `rgb(${bv},${bv},${bv})`;
    gm.ctxBump.fillRect(0, y, 256, 1);
  }
  // Milled panel grooves & silvered edge wear
  gm.ctxMap.strokeStyle = '#141820';
  gm.ctxMap.lineWidth = 3;
  gm.ctxMap.strokeRect(10, 10, 236, 112);
  gm.ctxMap.strokeRect(10, 134, 236, 112);
  gm.ctxMap.strokeStyle = 'rgba(165,185,210,0.28)';
  gm.ctxMap.lineWidth = 1.5;
  gm.ctxMap.strokeRect(12, 12, 232, 108);
  gm.ctxBump.strokeStyle = '#262626';
  gm.ctxBump.lineWidth = 3;
  gm.ctxBump.strokeRect(10, 10, 236, 112);
  gm.ctxBump.strokeRect(10, 134, 236, 112);
  for (const rx of [24, 232]) {
    for (const ry of [24, 108, 148, 232]) {
      gm.ctxMap.fillStyle = '#525e70';
      gm.ctxMap.beginPath();
      gm.ctxMap.arc(rx, ry, 3.2, 0, Math.PI * 2);
      gm.ctxMap.fill();
      gm.ctxBump.fillStyle = '#d8d8d8';
      gm.ctxBump.beginPath();
      gm.ctxBump.arc(rx, ry, 3.2, 0, Math.PI * 2);
      gm.ctxBump.fill();
    }
  }
  const texGunmetal = finalizeTextures(THREE, G, gm.cMap, gm.cBump, 2, 2);

  // 2. Cobalt-76 Tactical Alloy (Heavy Pulse Rifle navy-cobalt armor housing + panel lines)
  const cb = makeCanvasPair(256);
  const gradCb = cb.ctxMap.createLinearGradient(0, 0, 256, 256);
  gradCb.addColorStop(0, '#2a4572');
  gradCb.addColorStop(0.55, '#1f3559');
  gradCb.addColorStop(1, '#172844');
  cb.ctxMap.fillStyle = gradCb;
  cb.ctxMap.fillRect(0, 0, 256, 256);
  cb.ctxBump.fillStyle = '#848484';
  cb.ctxBump.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 256; i += 3) {
    cb.ctxMap.fillStyle = i % 6 === 0 ? 'rgba(130,175,240,0.06)' : 'rgba(10,18,32,0.07)';
    cb.ctxMap.fillRect(0, i, 256, 1);
  }
  // Chamfered tactical panel seams + subtle metallic edge highlight
  cb.ctxMap.strokeStyle = '#0e182a';
  cb.ctxMap.lineWidth = 3;
  cb.ctxMap.beginPath();
  cb.ctxMap.moveTo(0, 84);
  cb.ctxMap.lineTo(190, 84);
  cb.ctxMap.lineTo(222, 52);
  cb.ctxMap.lineTo(256, 52);
  cb.ctxMap.moveTo(0, 188);
  cb.ctxMap.lineTo(256, 188);
  cb.ctxMap.stroke();
  cb.ctxMap.strokeStyle = 'rgba(140,190,255,0.34)';
  cb.ctxMap.lineWidth = 1.2;
  cb.ctxMap.strokeRect(8, 8, 240, 240);
  cb.ctxBump.strokeStyle = '#303030';
  cb.ctxBump.lineWidth = 3.5;
  cb.ctxBump.beginPath();
  cb.ctxBump.moveTo(0, 84);
  cb.ctxBump.lineTo(190, 84);
  cb.ctxBump.lineTo(222, 52);
  cb.ctxBump.lineTo(256, 52);
  cb.ctxBump.stroke();
  const texCobalt = finalizeTextures(THREE, G, cb.cMap, cb.cBump, 1.5, 1.5);

  // 3. Ivory-Ceramic Upper Shroud (clean matte tactical white-silver with cooling vents)
  const cw = makeCanvasPair(256);
  cw.ctxMap.fillStyle = '#dce2ea';
  cw.ctxMap.fillRect(0, 0, 256, 256);
  cw.ctxBump.fillStyle = '#888888';
  cw.ctxBump.fillRect(0, 0, 256, 256);
  cw.ctxMap.strokeStyle = '#9aa6b6';
  cw.ctxMap.lineWidth = 2.5;
  cw.ctxMap.strokeRect(12, 14, 232, 228);
  for (let k = 0; k < 5; k++) {
    const vx = 38 + k * 38;
    cw.ctxMap.fillStyle = '#3d4756';
    cw.ctxMap.fillRect(vx, 96, 20, 64);
    cw.ctxBump.fillStyle = '#202020';
    cw.ctxBump.fillRect(vx, 96, 20, 64);
  }
  const texCeramic = finalizeTextures(THREE, G, cw.cMap, cw.cBump, 1, 1);

  // 4. Carbon-Kevlar Hex/Twill Weave (gloves, under-armor & weapon furniture)
  const cf = makeCanvasPair(128);
  cf.ctxMap.fillStyle = '#181c22';
  cf.ctxMap.fillRect(0, 0, 128, 128);
  cf.ctxBump.fillStyle = '#686868';
  cf.ctxBump.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) {
    for (let x = 0; x < 128; x += 8) {
      const shift = (y / 8) % 2 === 0 ? 0 : 4;
      cf.ctxMap.fillStyle = '#262d38';
      cf.ctxMap.fillRect((x + shift) % 128, y, 5, 3);
      cf.ctxMap.fillStyle = '#12161c';
      cf.ctxMap.fillRect((x + shift + 3) % 128, y + 4, 5, 3);
      cf.ctxBump.fillStyle = '#c8c8c8';
      cf.ctxBump.fillRect((x + shift) % 128, y, 5, 3);
      cf.ctxBump.fillStyle = '#404040';
      cf.ctxBump.fillRect((x + shift + 3) % 128, y + 4, 5, 3);
    }
  }
  const texCarbon = finalizeTextures(THREE, G, cf.cMap, cf.cBump, 4, 4);

  // 5. Perforated Tactical Grip Leather (palms, finger pads & pistol grip)
  const lg = makeCanvasPair(128);
  lg.ctxMap.fillStyle = '#1f1d1e';
  lg.ctxMap.fillRect(0, 0, 128, 128);
  lg.ctxBump.fillStyle = '#868686';
  lg.ctxBump.fillRect(0, 0, 128, 128);
  for (let y = 4; y < 128; y += 8) {
    for (let x = 4; x < 128; x += 8) {
      const ox = (y / 8) % 2 === 0 ? 0 : 4;
      lg.ctxMap.fillStyle = '#111012';
      lg.ctxMap.beginPath();
      lg.ctxMap.arc((x + ox) % 128, y, 1.9, 0, Math.PI * 2);
      lg.ctxMap.fill();
      lg.ctxBump.fillStyle = '#2c2c2c';
      lg.ctxBump.beginPath();
      lg.ctxBump.arc((x + ox) % 128, y, 2.1, 0, Math.PI * 2);
      lg.ctxBump.fill();
    }
  }
  const texLeather = finalizeTextures(THREE, G, lg.cMap, lg.cBump, 3, 3);

  // 6. Folded Tamahagane Damascus Steel (`玉钢折叠锻纹` + wavy `刃文 Hamon`)
  const dm = makeCanvasPair(256);
  const gradDm = dm.ctxMap.createLinearGradient(0, 0, 256, 0);
  gradDm.addColorStop(0, '#707b8a');
  gradDm.addColorStop(0.58, '#b8c4d4');
  gradDm.addColorStop(0.76, '#eef5ff');
  gradDm.addColorStop(1, '#dce8f8');
  dm.ctxMap.fillStyle = gradDm;
  dm.ctxMap.fillRect(0, 0, 256, 256);
  dm.ctxBump.fillStyle = '#808080';
  dm.ctxBump.fillRect(0, 0, 256, 256);
  // Subtle wood-grain Damascus jihada ripples
  dm.ctxMap.strokeStyle = 'rgba(72,84,102,0.22)';
  dm.ctxMap.lineWidth = 1.1;
  dm.ctxBump.strokeStyle = 'rgba(155,155,155,0.35)';
  dm.ctxBump.lineWidth = 1.1;
  for (let k = 0; k < 28; k++) {
    const baseX = (k / 28) * 185;
    dm.ctxMap.beginPath();
    dm.ctxBump.beginPath();
    for (let y = 0; y <= 256; y += 8) {
      const wx = baseX + Math.sin(y * 0.055 + k * 0.8) * 5.5;
      if (y === 0) {
        dm.ctxMap.moveTo(wx, y);
        dm.ctxBump.moveTo(wx, y);
      } else {
        dm.ctxMap.lineTo(wx, y);
        dm.ctxBump.lineTo(wx, y);
      }
    }
    dm.ctxMap.stroke();
    dm.ctxBump.stroke();
  }
  // Wavy glowing-frost Gunome-Midare Hamon (`互之目乱刃文`)
  dm.ctxMap.strokeStyle = 'rgba(255,255,255,0.82)';
  dm.ctxMap.lineWidth = 3.2;
  dm.ctxMap.beginPath();
  for (let y = 0; y <= 256; y += 4) {
    const hx = 186 + Math.sin(y * 0.11) * 8 + Math.cos(y * 0.27) * 4;
    if (y === 0) dm.ctxMap.moveTo(hx, y);
    else dm.ctxMap.lineTo(hx, y);
  }
  dm.ctxMap.stroke();
  const texDamascus = finalizeTextures(THREE, G, dm.cMap, dm.cBump, 1, 2);

  // 7. Kuro-Urushi Samurai Lacquer (`黑红吕色漆` with subtle gold maki-e fleck & seam)
  const ur = makeCanvasPair(128);
  const gradUr = ur.ctxMap.createLinearGradient(0, 0, 128, 128);
  gradUr.addColorStop(0, '#18141a');
  gradUr.addColorStop(0.65, '#251419');
  gradUr.addColorStop(1, '#120e14');
  ur.ctxMap.fillStyle = gradUr;
  ur.ctxMap.fillRect(0, 0, 128, 128);
  ur.ctxBump.fillStyle = '#808080';
  ur.ctxBump.fillRect(0, 0, 128, 128);
  ur.ctxMap.strokeStyle = 'rgba(218,175,85,0.38)';
  ur.ctxMap.lineWidth = 2;
  ur.ctxMap.strokeRect(5, 5, 118, 118);
  ur.ctxBump.strokeStyle = '#b4b4b4';
  ur.ctxBump.lineWidth = 2;
  ur.ctxBump.strokeRect(5, 5, 118, 118);
  const texUrushi = finalizeTextures(THREE, G, ur.cMap, ur.cBump, 2, 2);

  // 8. Crimson Tsuka-Ito Silk Diamond Wrap over White Samegawa Ray-Skin (`柄卷`)
  const ts = makeCanvasPair(128);
  ts.ctxMap.fillStyle = '#dcd6c8'; // white ray-skin base peeking through diamonds
  ts.ctxMap.fillRect(0, 0, 128, 128);
  ts.ctxBump.fillStyle = '#525252';
  ts.ctxBump.fillRect(0, 0, 128, 128);
  // Ray-skin nodules inside diamond windows
  for (let y = 2; y < 128; y += 6) {
    for (let x = 2; x < 128; x += 6) {
      ts.ctxBump.fillStyle = '#888888';
      ts.ctxBump.beginPath();
      ts.ctxBump.arc(x, y, 1.6, 0, Math.PI * 2);
      ts.ctxBump.fill();
    }
  }
  // Criss-crossing crimson silk cord bands
  ts.ctxMap.strokeStyle = '#7c141b';
  ts.ctxMap.lineWidth = 14;
  ts.ctxBump.strokeStyle = '#d6d6d6';
  ts.ctxBump.lineWidth = 14;
  for (let k = -128; k <= 256; k += 32) {
    ts.ctxMap.beginPath();
    ts.ctxMap.moveTo(k, 0);
    ts.ctxMap.lineTo(k + 128, 128);
    ts.ctxMap.moveTo(k + 128, 0);
    ts.ctxMap.lineTo(k, 128);
    ts.ctxMap.stroke();

    ts.ctxBump.beginPath();
    ts.ctxBump.moveTo(k, 0);
    ts.ctxBump.lineTo(k + 128, 128);
    ts.ctxBump.moveTo(k + 128, 0);
    ts.ctxBump.lineTo(k, 128);
    ts.ctxBump.stroke();
  }
  const texTsuka = finalizeTextures(THREE, G, ts.cMap, ts.cBump, 2, 4);

  // 9. Forged Kinko Brass-Gold (`雕金真鍮`)
  const gd = makeCanvasPair(128);
  const gradGd = gd.ctxMap.createLinearGradient(0, 0, 128, 128);
  gradGd.addColorStop(0, '#e6be64');
  gradGd.addColorStop(0.5, '#c99738');
  gradGd.addColorStop(1, '#f0ce7a');
  gd.ctxMap.fillStyle = gradGd;
  gd.ctxMap.fillRect(0, 0, 128, 128);
  gd.ctxBump.fillStyle = '#808080';
  gd.ctxBump.fillRect(0, 0, 128, 128);
  gd.ctxMap.strokeStyle = 'rgba(95,62,14,0.35)';
  gd.ctxMap.lineWidth = 2;
  gd.ctxMap.strokeRect(6, 6, 116, 116);
  gd.ctxBump.strokeStyle = '#c8c8c8';
  gd.ctxBump.lineWidth = 2;
  gd.ctxBump.strokeRect(6, 6, 116, 116);
  const texGold = finalizeTextures(THREE, G, gd.cMap, gd.cBump, 2, 2);

  cachedSuite = {
    gunmetal: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texGunmetal.map,
        bumpMap: texGunmetal.bump,
        bumpScale: 0.008,
        roughnessMap: texGunmetal.bump,
        metalness: 0.88,
        roughness: 0.28,
        envMapIntensity: 1.45,
      }),
      { role: 'heroViewmodel', id: 'gunmetal' }
    ),
    darkSteel: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texGunmetal.map,
        bumpMap: texGunmetal.bump,
        bumpScale: 0.007,
        color: new THREE.Color(0x7c889c),
        metalness: 0.90,
        roughness: 0.24,
        envMapIntensity: 1.5,
      }),
      { role: 'heroViewmodel', id: 'darkSteel' }
    ),
    cyberSilverArmor: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texCeramic.map,
        bumpMap: texGunmetal.bump,
        bumpScale: 0.008,
        color: new THREE.Color(0xd2dcea),
        metalness: 0.78,
        roughness: 0.23,
        envMapIntensity: 1.55,
      }),
      { role: 'heroViewmodel', id: 'cyberSilverArmor' }
    ),
    cobaltAlloy: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texCobalt.map,
        bumpMap: texCobalt.bump,
        bumpScale: 0.009,
        color: new THREE.Color(0xd8e8ff),
        metalness: 0.70,
        roughness: 0.28,
        envMapIntensity: 1.45,
      }),
      { role: 'heroViewmodel', id: 'cobaltAlloy' }
    ),
    ceramicShroud: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texCeramic.map,
        bumpMap: texCeramic.bump,
        bumpScale: 0.008,
        color: new THREE.Color(0xf4f7fc),
        metalness: 0.22,
        roughness: 0.32,
        envMapIntensity: 1.25,
      }),
      { role: 'heroViewmodel', id: 'ceramicShroud' }
    ),
    crimsonAnodized: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texGunmetal.map,
        bumpMap: texGunmetal.bump,
        bumpScale: 0.005,
        color: new THREE.Color(0xef3b2d),
        metalness: 0.74,
        roughness: 0.25,
        envMapIntensity: 1.35,
      }),
      { role: 'heroViewmodel', id: 'crimsonAnodized' }
    ),
    forgedGold: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texGold.map,
        bumpMap: texGold.bump,
        bumpScale: 0.009,
        metalness: 0.90,
        roughness: 0.21,
        envMapIntensity: 1.55,
      }),
      { role: 'heroViewmodel', id: 'forgedGold' }
    ),
    carbonWeave: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texCarbon.map,
        bumpMap: texCarbon.bump,
        bumpScale: 0.012,
        color: new THREE.Color(0xcfd8e6),
        metalness: 0.34,
        roughness: 0.44,
        envMapIntensity: 1.15,
      }),
      { role: 'heroViewmodel', id: 'carbonWeave' }
    ),
    tacticalLeather: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texLeather.map,
        bumpMap: texLeather.bump,
        bumpScale: 0.014,
        color: new THREE.Color(0xd8d6dc),
        metalness: 0.08,
        roughness: 0.62,
      }),
      { role: 'heroViewmodel', id: 'tacticalLeather' }
    ),
    damascusBlade: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texDamascus.map,
        bumpMap: texDamascus.bump,
        bumpScale: 0.005,
        metalness: 0.95,
        roughness: 0.13,
        envMapIntensity: 1.75,
      }),
      { role: 'heroViewmodel', id: 'damascusBlade' }
    ),
    urushiLacquer: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texUrushi.map,
        bumpMap: texUrushi.bump,
        bumpScale: 0.007,
        metalness: 0.52,
        roughness: 0.18,
        envMapIntensity: 1.5,
      }),
      { role: 'heroViewmodel', id: 'urushiLacquer' }
    ),
    tsukaSilk: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texTsuka.map,
        bumpMap: texTsuka.bump,
        bumpScale: 0.018,
        metalness: 0.08,
        roughness: 0.68,
      }),
      { role: 'heroViewmodel', id: 'tsukaSilk' }
    ),
    indigoCloth: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texCarbon.map,
        bumpMap: texCarbon.bump,
        bumpScale: 0.010,
        color: new THREE.Color(0x36486b),
        metalness: 0.12,
        roughness: 0.68,
      }),
      { role: 'heroViewmodel', id: 'indigoCloth' }
    ),
    kyudoBuckskin: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texCeramic.map,
        bumpMap: texLeather.bump,
        bumpScale: 0.011,
        color: new THREE.Color(0xd89c66),
        emissive: new THREE.Color(0x2d1809),
        emissiveIntensity: 0.36,
        metalness: 0.06,
        roughness: 0.56,
        envMapIntensity: 1.2,
      }),
      { role: 'heroViewmodel', id: 'kyudoBuckskin' }
    ),
    shimadaAzureSilk: enhanceMaterialStylized(
      new THREE.MeshStandardMaterial({
        map: texCobalt.map,
        bumpMap: texCarbon.bump,
        bumpScale: 0.009,
        color: new THREE.Color(0x4b78b8),
        emissive: new THREE.Color(0x0f213d),
        emissiveIntensity: 0.32,
        metalness: 0.18,
        roughness: 0.52,
        envMapIntensity: 1.25,
      }),
      { role: 'heroViewmodel', id: 'shimadaAzureSilk' }
    ),
    plasmaCyanGlow: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x52ecff).multiplyScalar(2.2),
      toneMapped: false,
    }),
    visorCrimsonGlow: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xff4c38).multiplyScalar(2.4),
      toneMapped: false,
    }),
    jadeChakraGlow: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x38ff8e).multiplyScalar(2.2),
      toneMapped: false,
    }),
    amberLedGlow: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffbe42).multiplyScalar(2.0),
      toneMapped: false,
    }),
    holoLensGlass: new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x46dcff),
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  };

  return cachedSuite;
}

/**
 * Helper to create a cleanly chamfered/bevelled rounded-rectangle block along Z (`depth`).
 */
function makeBevelBoxGeo(THREE: any, w: number, h: number, depth: number, radius = 0.004, bevel = 0.0025) {
  const hw = Math.max(0.002, w * 0.5 - bevel);
  const hh = Math.max(0.002, h * 0.5 - bevel);
  const r = Math.min(radius, hw * 0.45, hh * 0.45);
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

  const d = Math.max(0.002, depth - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: bevel,
    bevelThickness: bevel,
  });
  geo.translate(0, 0, -d * 0.5);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a 3-phalanx articulated anatomical finger (`proximal -> middle -> distal`) with
 * dorsal carbon/steel armor plates, joint knuckles, and tapered leather pad fingertip.
 */
function buildArticulatedFinger(
  THREE: any,
  armorMat: any,
  underMat: any,
  trimMat: any,
  lenScale: number,
  widthScale: number,
  curl: [number, number, number]
) {
  const root = new THREE.Group();
  const l1 = 0.025 * lenScale;
  const l2 = 0.019 * lenScale;
  const l3 = 0.015 * lenScale;
  const rBase = 0.0068 * widthScale;

  // Metacarpal knuckle dome
  const knuckle = new THREE.Mesh(new THREE.SphereGeometry(rBase * 1.12, 8, 6), trimMat);
  knuckle.scale.set(1.08, 0.82, 1.05);
  root.add(knuckle);

  // Proximal phalanx
  const p1 = new THREE.Group();
  p1.rotation.x = curl[0];
  const seg1 = new THREE.Mesh(
    new THREE.CylinderGeometry(rBase * 0.92, rBase * 1.0, l1, 8).rotateX(Math.PI / 2),
    underMat
  );
  seg1.position.z = -l1 * 0.5;
  const plate1 = new THREE.Mesh(
    makeBevelBoxGeo(THREE, rBase * 1.85, rBase * 0.65, l1 * 0.78, 0.0015, 0.001),
    armorMat
  );
  plate1.position.set(0, rBase * 0.68, -l1 * 0.5);
  p1.add(seg1, plate1);
  root.add(p1);

  // PIP joint + Middle phalanx
  const p2 = new THREE.Group();
  p2.position.z = -l1;
  p2.rotation.x = curl[1];
  const joint1 = new THREE.Mesh(new THREE.SphereGeometry(rBase * 0.88, 7, 5), underMat);
  const seg2 = new THREE.Mesh(
    new THREE.CylinderGeometry(rBase * 0.80, rBase * 0.90, l2, 8).rotateX(Math.PI / 2),
    underMat
  );
  seg2.position.z = -l2 * 0.5;
  const plate2 = new THREE.Mesh(
    makeBevelBoxGeo(THREE, rBase * 1.62, rBase * 0.55, l2 * 0.74, 0.0012, 0.0009),
    armorMat
  );
  plate2.position.set(0, rBase * 0.58, -l2 * 0.5);
  p2.add(joint1, seg2, plate2);
  p1.add(p2);

  // DIP joint + Distal tapered fingertip
  const p3 = new THREE.Group();
  p3.position.z = -l2;
  p3.rotation.x = curl[2];
  const joint2 = new THREE.Mesh(new THREE.SphereGeometry(rBase * 0.76, 7, 5), underMat);
  const seg3 = new THREE.Mesh(
    new THREE.CylinderGeometry(rBase * 0.58, rBase * 0.78, l3, 8).rotateX(Math.PI / 2),
    underMat
  );
  seg3.position.z = -l3 * 0.5;
  const tipCap = new THREE.Mesh(new THREE.SphereGeometry(rBase * 0.58, 7, 6), armorMat);
  tipCap.scale.set(0.95, 0.85, 1.18);
  tipCap.position.z = -l3;
  p3.add(joint2, seg3, tipCap);
  p2.add(p3);

  return root;
}

/**
 * Builds an anatomical Tactical Gunner Glove + Armored Cuff + Jacket Sleeve.
 * `side`: `1` = Right trigger hand, `-1` = Left C-clamp forend support hand.
 */
export function buildTacticalGloveHand(
  THREE: any,
  mats: HeroViewmodelPbrSuite,
  side: 1 | -1,
  pose: 'rifleGrip' | 'cClampSupport'
) {
  const handGroup = new THREE.Group();

  // 1. Contoured Anatomical Palm + Metacarpal Arch + Leather Grip Pad
  const palmCore = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.068, 0.024, 0.076, 0.008, 0.004),
    mats.carbonWeave
  );
  const palmPad = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.056, 0.010, 0.060, 0.006, 0.002),
    mats.tacticalLeather
  );
  palmPad.position.set(0, -0.011, -0.003);

  // Sculpted Carbon-Titanium Dorsal Hard-Knuckle Armor Bridge + 4 Raised Knuckle Pods
  const dorsalPlate = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.064, 0.009, 0.054, 0.005, 0.0025),
    mats.cobaltAlloy
  );
  dorsalPlate.position.set(0, 0.013, 0.004);
  const knuckleBar = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.066, 0.010, 0.016, 0.003, 0.002),
    mats.gunmetal
  );
  knuckleBar.position.set(0, 0.015, -0.030);
  handGroup.add(palmCore, palmPad, dorsalPlate, knuckleBar);

  // 2. Opposable Thumb Saddle (Thenar Eminence) + 2-Phalanx Thumb
  const thumbMount = new THREE.Group();
  thumbMount.position.set(-side * 0.032, -0.003, 0.014);
  const thenarMuscle = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 7), mats.tacticalLeather);
  thenarMuscle.scale.set(0.95, 0.78, 1.45);
  thenarMuscle.position.set(side * 0.004, -0.003, -0.012);
  thumbMount.add(thenarMuscle);

  const thumbCurls: [number, number, number] =
    pose === 'cClampSupport' ? [-0.15, -0.32, -0.25] : [-0.42, -0.58, -0.38];
  const thumbFinger = buildArticulatedFinger(
    THREE,
    mats.gunmetal,
    mats.tacticalLeather,
    mats.forgedGold,
    0.84,
    1.08,
    thumbCurls
  );
  if (pose === 'cClampSupport') {
    // Thumb reaches over the top barrel handguard rail (classic tactical C-clamp!)
    thumbFinger.rotation.set(0.28, side * 0.52, side * 0.35);
  } else {
    thumbFinger.rotation.set(-0.22, side * 0.62, side * 0.45);
  }
  thumbMount.add(thumbFinger);
  handGroup.add(thumbMount);

  // 3. Four Individually Posed 3-Phalanx Fingers (Index, Middle, Ring, Pinky)
  const fingerX = [-0.023, -0.008, 0.008, 0.022].map((x) => x * side);
  const lenScales = [0.95, 1.05, 0.97, 0.80];
  const widthScales = [0.96, 1.0, 0.94, 0.84];
  const fingerCurls: [number, number, number][] =
    pose === 'rifleGrip'
      ? [
          [-0.42, -0.68, -0.45], // Index poised cleanly onto curved rifle trigger!
          [-1.08, -1.18, -0.78], // Middle wrapped tight around pistol grip
          [-1.16, -1.22, -0.82], // Ring wrapped tight
          [-1.22, -1.26, -0.85], // Pinky wrapped tight
        ]
      : [
          [-0.78, -0.92, -0.62], // C-clamp support fingers cradling underbarrel forend
          [-0.86, -0.98, -0.68],
          [-0.92, -1.04, -0.72],
          [-0.98, -1.08, -0.75],
        ];

  for (let i = 0; i < 4; i++) {
    const f = buildArticulatedFinger(
      THREE,
      mats.gunmetal,
      mats.tacticalLeather,
      mats.forgedGold,
      lenScales[i],
      widthScales[i],
      fingerCurls[i]
    );
    f.position.set(fingerX[i], 0.002 - i * 0.001, -0.036 + Math.abs(i - 1.2) * 0.003);
    f.rotation.y = (1.2 - i) * 0.04 * side;
    handGroup.add(f);
  }

  // 4. Sculpted Tactical Wrist Cuff + Holographic Chronometer (Left) + Contoured Jacket Forearm Sleeve
  const wristCuff = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.074, 0.046, 0.046, 0.010, 0.004),
    mats.gunmetal
  );
  wristCuff.position.set(0, 0.001, 0.054);
  const goldPiping = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.077, 0.049, 0.008, 0.010, 0.002),
    mats.forgedGold
  );
  goldPiping.position.set(0, 0.001, 0.076);
  handGroup.add(wristCuff, goldPiping);

  if (side === -1) {
    // Glowing cyan tactical wrist comm / biotic status chronometer on left support wrist!
    const watchBezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.018, 0.009, 12),
      mats.darkSteel
    );
    watchBezel.position.set(0.012, 0.025, 0.054);
    watchBezel.rotation.z = -0.25;
    const watchScreen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 0.010, 12),
      mats.plasmaCyanGlow
    );
    watchScreen.position.copy(watchBezel.position);
    watchScreen.rotation.copy(watchBezel.rotation);
    handGroup.add(watchBezel, watchScreen);
  }

  // Tapered Contoured Forearm Jacket Sleeve + Dorsal Vambrace Plate
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.048, 0.24, 12).rotateX(Math.PI / 2),
    mats.cobaltAlloy
  );
  sleeve.scale.set(1.06, 0.86, 1.0);
  sleeve.position.set(side * 0.006, -0.004, 0.19);

  const forearmPlate = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.056, 0.016, 0.17, 0.006, 0.003),
    mats.ceramicShroud
  );
  forearmPlate.position.set(side * 0.006, 0.028, 0.175);

  const crimsonStripe = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.014, 0.018, 0.165, 0.002, 0.0015),
    mats.crimsonAnodized
  );
  crimsonStripe.position.set(side * 0.026, 0.026, 0.175);

  handGroup.add(sleeve, forearmPlate, crimsonStripe);
  return handGroup;
}

/**
 * Builds Genji's Sculpted Cyber-Artisanal Shinobi Hand & Layered Kote (`笼手`) Forearm Vambrace!
 * Returns `{ armGroup, handPivot, reloadHatch, hatchRoll }` so `genjiWeapon.ts` animations drive them seamlessly.
 */
export function buildShinobiGauntletArm(
  THREE: any,
  mats: HeroViewmodelPbrSuite,
  side: 1 | -1,
  pose: 'shurikenPinch' | 'kujiGuard' | 'katanaGrip'
) {
  const armGroup = new THREE.Group();

  // 1. Layered Samurai Kote (`笼手`) Forearm Vambrace over Carbon-Chain Shinobi Under-Sleeve
  const underSleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.044, 0.25, 12).rotateX(Math.PI / 2),
    mats.indigoCloth
  );
  underSleeve.scale.set(1.04, 0.88, 1.0);
  underSleeve.position.set(0, -0.008, 0.12);

  const koteMainPlate = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.064, 0.044, 0.21, 0.010, 0.004),
    mats.urushiLacquer
  );
  koteMainPlate.position.set(0, -0.005, 0.105);

  // Sculpted Cyber-Shinobi Brushed Champagne-Silver Dorsal Armor Shell over the Kote!
  const koteSilverShell = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.054, 0.016, 0.195, 0.007, 0.003),
    mats.cyberSilverArmor
  );
  koteSilverShell.position.set(0, 0.018, 0.105);

  // Layered gold-trimmed samurai splint ribs along the forearm
  for (const zOff of [0.03, 0.10, 0.17]) {
    const rib = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.068, 0.048, 0.011, 0.010, 0.002),
      mats.forgedGold
    );
    rib.position.set(0, -0.001, zOff);
    armGroup.add(rib);
  }

  // Glowing Emerald Chakra Conduit Channels flanking the dorsal cyber-silver ridge
  for (const vx of [-0.014, 0.014]) {
    const chakraVein = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.005, 0.006, 0.185, 0.0015, 0.001),
      mats.jadeChakraGlow
    );
    chakraVein.position.set(vx, 0.026, 0.102);
    armGroup.add(chakraVein);
  }

  // Wrist Guard Ring (`手首金物`)
  const wristCollar = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.066, 0.044, 0.026, 0.009, 0.003),
    mats.cyberSilverArmor
  );
  wristCollar.position.set(0, -0.002, -0.004);
  armGroup.add(underSleeve, koteMainPlate, koteSilverShell, wristCollar);

  // Optional Right-Arm Mechanical Shuriken Feed Hatch (`reloadHatch` + `hatchRoll`)
  const reloadHatch = new THREE.Group();
  reloadHatch.position.set(0, 0.022, 0.045);
  const hatchPlate = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.046, 0.010, 0.078, 0.004, 0.002),
    mats.darkSteel
  );
  const hatchGoldTrim = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.020, 0.012, 0.068, 0.002, 0.0015),
    mats.forgedGold
  );
  const hatchRoll = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.011, 0.036, 10).rotateZ(Math.PI / 2),
    mats.jadeChakraGlow
  );
  hatchRoll.position.set(0, -0.006, 0);
  reloadHatch.add(hatchPlate, hatchGoldTrim, hatchRoll);
  if (side === 1 && pose === 'shurikenPinch') {
    armGroup.add(reloadHatch);
    // Twin precision shuriken launch rails extending toward the wrist
    for (const rx of [-0.018, 0.018]) {
      const rail = new THREE.Mesh(
        makeBevelBoxGeo(THREE, 0.007, 0.008, 0.095, 0.0015, 0.001),
        mats.damascusBlade
      );
      rail.position.set(rx, 0.018, -0.035);
      armGroup.add(rail);
    }
  }

  // 2. Anatomical Cyber-Shinobi Hand (`Tekko 手甲` dorsal plate + Carbon Palm + 5 Articulated Fingers)
  const handPivot = new THREE.Group();
  handPivot.position.set(0, -0.004, -0.026);
  armGroup.add(handPivot);

  const palm = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.062, 0.022, 0.068, 0.007, 0.0035),
    mats.carbonWeave
  );
  palm.position.set(0, 0, -0.032);
  const palmLeather = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.052, 0.008, 0.054, 0.005, 0.002),
    mats.tacticalLeather
  );
  palmLeather.position.set(0, -0.010, -0.032);

  // Ornate Tekko (`手甲`) Brushed Cyber-Silver Dorsal Armor Plate + Gold Shimada Stud + Jade Core Pip
  const tekkoPlate = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.060, 0.011, 0.058, 0.005, 0.0025),
    mats.cyberSilverArmor
  );
  tekkoPlate.position.set(0, 0.013, -0.030);
  const tekkoCrest = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.014, 0.006, 8),
    mats.forgedGold
  );
  tekkoCrest.position.set(0, 0.019, -0.028);
  const tekkoGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.006, 0), mats.jadeChakraGlow);
  tekkoGem.scale.set(1, 0.55, 1.35);
  tekkoGem.position.set(0, 0.022, -0.028);
  handPivot.add(palm, palmLeather, tekkoPlate, tekkoCrest, tekkoGem);

  // Opposable Shinobi Thumb with Brushed Cyber-Silver Dorsal Armor
  const thumbBase = new THREE.Group();
  thumbBase.position.set(-side * 0.031, -0.001, -0.018);
  const thumbCurls: [number, number, number] =
    pose === 'shurikenPinch'
      ? [-0.18, -0.28, -0.18]
      : pose === 'kujiGuard'
        ? [-0.32, -0.44, -0.26]
        : [-0.55, -0.68, -0.45];
  const thumb = buildArticulatedFinger(
    THREE,
    mats.cyberSilverArmor,
    mats.carbonWeave,
    mats.forgedGold,
    0.86,
    1.10,
    thumbCurls
  );
  thumb.rotation.set(-0.10, side * 0.48, side * 0.30);
  thumbBase.add(thumb);
  handPivot.add(thumbBase);

  // 4 Articulated 3-Phalanx Cyber-Shinobi Fingers with Brushed Titanium Dorsal Plates
  const fx = [-0.022, -0.0075, 0.0075, 0.021].map((x) => x * side);
  const fLens = [0.98, 1.08, 1.00, 0.84];
  const fWidths = [1.02, 1.06, 0.98, 0.88];
  const curls: [number, number, number][] =
    pose === 'shurikenPinch'
      ? [
          // Index & middle extended forward cradling the 3 Fuma Shurikens; ring & pinky tucked in shinobi mudra!
          [-0.08, -0.14, -0.08],
          [-0.06, -0.12, -0.06],
          [-0.64, -0.82, -0.54],
          [-0.78, -0.92, -0.60],
        ]
      : pose === 'kujiGuard'
        ? [
            // Iconic Genji Twin-Finger Kuji-In Sword-Seal (`临兵斗者皆阵列在前`)!
            [-0.10, -0.12, -0.06],
            [-0.08, -0.10, -0.06],
            [-0.82, -0.96, -0.66],
            [-0.92, -1.04, -0.70],
          ]
        : [
            // Wrapped firmly around Katana / Odachi Tsuka hilt
            [-1.02, -1.12, -0.76],
            [-1.08, -1.16, -0.80],
            [-1.14, -1.20, -0.82],
            [-1.20, -1.24, -0.85],
          ];

  for (let i = 0; i < 4; i++) {
    const f = buildArticulatedFinger(
      THREE,
      mats.cyberSilverArmor,
      mats.carbonWeave,
      mats.forgedGold,
      fLens[i],
      fWidths[i],
      curls[i]
    );
    f.position.set(fx[i], 0.003 - i * 0.001, -0.062 + Math.abs(i - 1.2) * 0.003);
    f.rotation.y = (1.2 - i) * 0.038 * side;
    handPivot.add(f);
  }

  return { armGroup, handPivot, reloadHatch, hatchRoll };
}

/**
 * Builds the Hollow-Ground Bevelled 4-Point Fuma Shuriken Geometry (`风魔手里剑`)
 * used for both world projectiles (`InstancedMesh`) and Genji's held 3-shuriken fan!
 */
export function buildMasterworkShurikenGeo(THREE: any, outerRadius = 0.072) {
  const rOut = outerRadius;
  const rWaist = outerRadius * 0.30;
  const shape = new THREE.Shape();
  for (let i = 0; i < 4; i++) {
    const aTip = (i * Math.PI) / 2;
    const aValley = aTip + Math.PI / 4;
    const tx = Math.cos(aTip) * rOut;
    const ty = Math.sin(aTip) * rOut;
    const vx = Math.cos(aValley) * rWaist;
    const vy = Math.sin(aValley) * rWaist;
    if (i === 0) shape.moveTo(tx, ty);
    else shape.lineTo(tx, ty);
    shape.lineTo(vx, vy);
  }
  shape.closePath();

  // Central traditional `风穴` circular ring hole
  const hole = new THREE.Path();
  hole.absarc(0, 0, outerRadius * 0.14, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.0032,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.0035,
    bevelThickness: 0.0032,
  });
  geo.rotateX(Math.PI / 2);
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds a multi-material Held Fuma Shuriken (Damascus steel bevelled star + forged gold center collar + 4 glowing jade chakra inlays).
 */
export function buildHeldShurikenAssembly(THREE: any, mats: HeroViewmodelPbrSuite, sharedBladeGeo: any) {
  const grp = new THREE.Group();
  const blade = new THREE.Mesh(sharedBladeGeo, mats.damascusBlade);
  const brassHub = new THREE.Mesh(
    new THREE.TorusGeometry(0.0135, 0.0028, 6, 16).rotateX(Math.PI / 2),
    mats.forgedGold
  );
  const jadeRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.0185, 0.0018, 6, 16).rotateX(Math.PI / 2),
    mats.jadeChakraGlow
  );
  grp.add(blade, brassHub, jadeRing);

  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2;
    const runePip = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.004, 0.0045, 0.018, 0.001, 0.0008),
      mats.jadeChakraGlow
    );
    runePip.rotation.y = -ang + Math.PI / 2;
    runePip.position.set(Math.cos(ang) * 0.032, 0, Math.sin(ang) * 0.032);
    grp.add(runePip);
  }
  return grp;
}

/**
 * Builds a Masterwork Curved `镐造 Shinogi-Zukuri` Samurai Blade (`Wakizashi 胁差` or `Dragonblade 龙神大太刀`)
 * with Damascus `刃文`, brass `鎺 Habaki`, openwork gold `鍔 Tsuba`, and crimson silk `柄卷 Tsuka`.
 */
export function buildMasterworkKatana(
  THREE: any,
  mats: HeroViewmodelPbrSuite,
  options: { bladeLen: number; hiltLen: number; soriCurve: number; withDragonVein: boolean }
) {
  const grp = new THREE.Group();
  const { bladeLen, hiltLen, soriCurve, withDragonVein } = options;

  // 1. Tsuka (`柄` — Crimson Silk Diamond Wrap over Samegawa + Gold Kashira & Menuki)
  const tsuka = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.024, hiltLen, 0.034, 0.007, 0.003).rotateX(Math.PI / 2),
    mats.tsukaSilk
  );
  // Orient blade along +Y (`0 -> bladeLen`) and hilt along `-Y` (`0 -> -hiltLen`) to match GenjiWeapon conventions!
  const tsukaBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0145, 0.0135, hiltLen, 10),
    mats.tsukaSilk
  );
  tsukaBody.scale.set(0.82, 1.0, 1.18);
  tsukaBody.position.y = -hiltLen * 0.5;
  tsuka.visible = false; // use cylinder with crisp elliptical samurai grip profile

  const kashira = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0155, 0.013, 0.020, 10),
    mats.forgedGold
  );
  kashira.scale.set(0.85, 1.0, 1.2);
  kashira.position.y = -hiltLen - 0.008;

  const fuchi = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0165, 0.0155, 0.018, 10),
    mats.forgedGold
  );
  fuchi.scale.set(0.86, 1.0, 1.22);
  fuchi.position.y = -0.010;

  // Twin gold dragon Menuki (`目贯`) under silk wrap
  for (const side of [-1, 1]) {
    const menuki = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.005, 0.028, 0.012, 0.0015, 0.001),
      mats.forgedGold
    );
    menuki.position.set(side * 0.012, -hiltLen * 0.45, 0);
    grp.add(menuki);
  }

  // 2. Sculpted Openwork Dragon Wheel `鍔 Tsuba` + Brass `鎺 Habaki` Blade Collar
  const tsubaOuter = new THREE.Mesh(
    new THREE.TorusGeometry(0.040, 0.0055, 8, 20).rotateX(Math.PI / 2),
    mats.forgedGold
  );
  const tsubaPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.037, 0.037, 0.006, 16),
    mats.urushiLacquer
  );
  const habaki = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.015, 0.030, 0.031, 0.002, 0.0015),
    mats.forgedGold
  );
  habaki.position.y = 0.018;
  grp.add(tsukaBody, kashira, fuchi, tsubaOuter, tsubaPlate, habaki);

  // 3.Segmented Curved `反り Sori` Diamond-Ridge `镐造` Damascus Steel Blade (`+Y` up, edge facing `-Z`)
  const segs = 10;
  const spinePts: any[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = 0.03 + t * bladeLen;
    const zCurve = Math.pow(t, 1.85) * soriCurve; // graceful upward/backward sori curve
    spinePts.push(new THREE.Vector3(0, y, zCurve));
  }

  for (let i = 0; i < segs; i++) {
    const p0 = spinePts[i];
    const p1 = spinePts[i + 1];
    const tMid = (i + 0.5) / segs;
    const segDir = new THREE.Vector3().subVectors(p1, p0);
    const segLen = segDir.length();
    const taper = 1 - tMid * 0.36;
    const bThick = 0.0075 * taper;
    const bWidth = 0.028 * taper;

    // 2-part Shinogi-Zukuri profile: dark steel `棟 Mune` spine + gleaming Damascus `刃 Ha` bevel!
    const segGrp = new THREE.Group();
    segGrp.position.copy(p0).addScaledVector(segDir, 0.5);
    segGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), segDir.clone().normalize());

    const bladeBevel = new THREE.Mesh(
      new THREE.CylinderGeometry(bWidth * 0.45, bWidth * 0.52, segLen * 1.03, 4),
      mats.damascusBlade
    );
    bladeBevel.rotation.y = Math.PI / 4;
    bladeBevel.scale.set(bThick / bWidth, 1.0, 1.0);

    const muneSpine = new THREE.Mesh(
      new THREE.BoxGeometry(bThick * 1.08, segLen * 1.02, bWidth * 0.28),
      mats.darkSteel
    );
    muneSpine.position.z = bWidth * 0.34;
    segGrp.add(bladeBevel, muneSpine);

    if (withDragonVein) {
      // Glowing jade spirit fuller (`樋 Bo-Hi`) running along the blade!
      const fuller = new THREE.Mesh(
        new THREE.BoxGeometry(bThick * 1.24, segLen * 0.96, bWidth * 0.14),
        mats.jadeChakraGlow
      );
      fuller.position.z = bWidth * 0.14;
      segGrp.add(fuller);
    }
    grp.add(segGrp);
  }

  return grp;
}

/**
 * Builds Gunner's Masterwork Heavy Pulse Rifle (`重型脉冲步枪 · MK-76`) with bevelled PBR receiver,
 * slotted cyan plasma barrel shroud, cantilevered holographic sight, underbarrel tri-tube Helix launcher,
 * live LED ammo bar, and integrated anatomical right trigger hand & left C-clamp support hand!
 */
export function buildMasterworkPulseRifleRig(THREE: any, mats: HeroViewmodelPbrSuite) {
  const rifleGroup = new THREE.Group();
  rifleGroup.position.set(0.138, -0.088, -0.455);

  // 1. Sculpted Upper & Lower Receiver (`Cobalt-76` Alloy + `Ceramic-Ivory` Upper Cowling + `Gunmetal` Chassis)
  const lowerReceiver = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.068, 0.072, 0.34, 0.008, 0.004),
    mats.gunmetal
  );
  lowerReceiver.position.set(0, -0.008, -0.02);

  const cobaltMainHousing = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.074, 0.066, 0.38, 0.009, 0.0045),
    mats.cobaltAlloy
  );
  cobaltMainHousing.position.set(0, 0.024, -0.05);

  const ceramicUpperCowl = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.064, 0.026, 0.30, 0.007, 0.0035),
    mats.ceramicShroud
  );
  ceramicUpperCowl.position.set(0, 0.055, -0.06);

  // Machined diagonal plasma cooling gills + glowing cyan side conduits along the upper receiver!
  for (let g = 0; g < 5; g++) {
    const gill = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.068, 0.008, 0.016, 0.0015, 0.001),
      mats.darkSteel
    );
    gill.position.set(0, 0.056, -0.02 - g * 0.042);
    gill.rotation.x = 0.32;
    rifleGroup.add(gill);
  }
  for (const sx of [-0.038, 0.038]) {
    const plasmaConduit = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.006, 0.009, 0.28, 0.0015, 0.001),
      mats.plasmaCyanGlow
    );
    plasmaConduit.position.set(sx, 0.018, -0.14);
    rifleGroup.add(plasmaConduit);
  }

  const crimsonFlankL = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.008, 0.015, 0.25, 0.002, 0.0015),
    mats.crimsonAnodized
  );
  crimsonFlankL.position.set(-0.037, 0.034, -0.06);
  const crimsonFlankR = crimsonFlankL.clone();
  crimsonFlankR.position.x = 0.037;

  // Rear Buttstock Cheek-Rest + Integrated Glowing LED Ammo Counter Bar (directly visible to player!)
  const buttStock = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.062, 0.078, 0.16, 0.008, 0.004),
    mats.gunmetal
  );
  buttStock.position.set(0, 0.004, 0.18);

  const ammoReadoutBezel = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.040, 0.020, 0.024, 0.003, 0.0015),
    mats.darkSteel
  );
  ammoReadoutBezel.position.set(-0.022, 0.056, 0.088);
  ammoReadoutBezel.rotation.y = -0.22;

  const ammoBarFill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.032, 0.010),
    mats.plasmaCyanGlow.clone()
  );
  ammoBarFill.position.set(-0.022, 0.056, 0.101);
  ammoBarFill.rotation.y = -0.22;

  // Top Picatinny Rail Teeth (`10` machined cross-ribs)
  for (let i = 0; i < 10; i++) {
    const tooth = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.032, 0.007, 0.011, 0.0015, 0.001),
      mats.darkSteel
    );
    tooth.position.set(0, 0.071, 0.04 - i * 0.024);
    rifleGroup.add(tooth);
  }

  // Side Brass/Plasma Ejection Port + Reciprocating Bolt Carrier
  const boltCarrier = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.014, 0.022, 0.088, 0.002, 0.0015),
    mats.forgedGold
  );
  boltCarrier.position.set(0.035, 0.032, -0.02);

  // Angled Tactical Pistol Grip + Trigger Guard + Curved Trigger
  const pistolGrip = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.038, 0.105, 0.048, 0.007, 0.003),
    mats.tacticalLeather
  );
  pistolGrip.position.set(0, -0.072, 0.068);
  pistolGrip.rotation.x = 0.28;

  const triggerGuard = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.022, 0.007, 0.056, 0.002, 0.001),
    mats.gunmetal
  );
  triggerGuard.position.set(0, -0.056, 0.024);

  rifleGroup.add(
    lowerReceiver,
    cobaltMainHousing,
    ceramicUpperCowl,
    crimsonFlankL,
    crimsonFlankR,
    buttStock,
    ammoReadoutBezel,
    ammoBarFill,
    boltCarrier,
    pistolGrip,
    triggerGuard
  );

  // 2. True Open-Window Cantilevered Holographic Reflex Sight (`镂空全息战术瞄具`)
  const opticGroup = new THREE.Group();
  opticGroup.position.set(0, 0.092, -0.055);
  const opticBase = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.054, 0.012, 0.088, 0.003, 0.002),
    mats.gunmetal
  );
  opticBase.position.y = -0.016;
  const opticRoof = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.052, 0.008, 0.076, 0.003, 0.0015),
    mats.gunmetal
  );
  opticRoof.position.y = 0.018;
  const opticWallL = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.007, 0.036, 0.078, 0.002, 0.0015),
    mats.cobaltAlloy
  );
  opticWallL.position.set(-0.023, 0.001, 0);
  const opticWallR = opticWallL.clone();
  opticWallR.position.x = 0.023;

  const opticWindowGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.038, 0.026),
    mats.holoLensGlass.clone()
  );
  opticWindowGlass.position.set(0, 0.002, 0.004);

  const reticleRing = new THREE.Mesh(
    new THREE.RingGeometry(0.0062, 0.0082, 20),
    mats.plasmaCyanGlow.clone()
  );
  reticleRing.position.set(0, 0.002, 0.005);

  const reticleDot = new THREE.Mesh(
    new THREE.CircleGeometry(0.0022, 10),
    mats.plasmaCyanGlow
  );
  reticleDot.position.set(0, 0.002, 0.0055);

  const opticScrew = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0055, 0.0055, 0.058, 10).rotateZ(Math.PI / 2),
    mats.forgedGold
  );
  opticScrew.position.set(0, -0.016, 0);
  opticGroup.add(
    opticBase,
    opticRoof,
    opticWallL,
    opticWallR,
    opticWindowGlass,
    reticleRing,
    reticleDot,
    opticScrew
  );
  rifleGroup.add(opticGroup);

  // 3. Slotted Heavy Barrel Shroud + Exposed Glowing Cyan Plasma Accelerator Core + Muzzle Brake
  const shroudOuter = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.058, 0.054, 0.25, 0.008, 0.0035),
    mats.cobaltAlloy
  );
  shroudOuter.position.set(0, 0.026, -0.34);

  // Glowing cyan plasma accelerator tube running down the center of the slotted barrel!
  const barrelHeatTube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.016, 0.34, 12).rotateX(Math.PI / 2),
    mats.plasmaCyanGlow.clone()
  );
  barrelHeatTube.position.set(0, 0.028, -0.36);

  // Flanking radiator fins exposing the plasma core glow
  for (let k = 0; k < 4; k++) {
    const finCollar = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.064, 0.014, 0.018, 0.003, 0.0015),
      mats.ceramicShroud
    );
    finCollar.position.set(0, 0.044, -0.25 - k * 0.052);
    rifleGroup.add(finCollar);
  }

  const heavyBarrelTip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.018, 0.14, 14).rotateX(Math.PI / 2),
    mats.darkSteel
  );
  heavyBarrelTip.position.set(0, 0.028, -0.51);

  const muzzleBrake = new THREE.Mesh(
    new THREE.CylinderGeometry(0.021, 0.019, 0.055, 8).rotateX(Math.PI / 2),
    mats.gunmetal
  );
  muzzleBrake.position.set(0, 0.028, -0.585);

  const muzzleCoreGlow = new THREE.Mesh(
    new THREE.TorusGeometry(0.014, 0.0038, 8, 16),
    mats.plasmaCyanGlow
  );
  muzzleCoreGlow.position.set(0, 0.028, -0.612);

  // Front Blade Sight Post with glowing tritium pip
  const frontSightPost = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.018, 0.028, 0.022, 0.002, 0.0015),
    mats.gunmetal
  );
  frontSightPost.position.set(0, 0.064, -0.44);
  const frontTritium = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 6, 6), mats.amberLedGlow);
  frontTritium.position.set(0, 0.076, -0.432);

  rifleGroup.add(
    shroudOuter,
    barrelHeatTube,
    heavyBarrelTip,
    muzzleBrake,
    muzzleCoreGlow,
    frontSightPost,
    frontTritium
  );

  // 4. Underbarrel Tri-Tube Helix Rocket Launcher Pod (`螺旋飞弹三联发射巢`)
  const helixPod = new THREE.Group();
  helixPod.position.set(0, -0.028, -0.34);
  const podHousing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.034, 0.24, 12).rotateX(Math.PI / 2),
    mats.gunmetal
  );
  const podGoldCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.022, 12).rotateX(Math.PI / 2),
    mats.forgedGold
  );
  podGoldCollar.position.z = -0.105;
  helixPod.add(podHousing, podGoldCollar);

  // 3 visible Helix micro-warhead nosecones nested inside the rotary pod!
  for (let w = 0; w < 3; w++) {
    const a = (w * Math.PI * 2) / 3 + Math.PI / 6;
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.010, 0.010, 0.04, 8).rotateX(Math.PI / 2),
      mats.darkSteel
    );
    tube.position.set(Math.cos(a) * 0.014, Math.sin(a) * 0.014, -0.112);
    const warheadTip = new THREE.Mesh(
      new THREE.ConeGeometry(0.0085, 0.024, 8).rotateX(-Math.PI / 2),
      mats.crimsonAnodized
    );
    warheadTip.position.set(Math.cos(a) * 0.014, Math.sin(a) * 0.014, -0.132);
    helixPod.add(tube, warheadTip);
  }
  rifleGroup.add(helixPod);

  // 5. Detachable Curved Energy Magazine (`magGroup`) with Live Cyan Plasma Window
  const magGroup = new THREE.Group();
  magGroup.position.set(0, -0.068, -0.08);
  const magBody = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.036, 0.125, 0.064, 0.006, 0.003),
    mats.darkSteel
  );
  magBody.rotation.x = -0.18;
  const magBaseplate = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.042, 0.018, 0.072, 0.004, 0.002),
    mats.forgedGold
  );
  magBaseplate.position.set(0, -0.062, -0.011);
  magBaseplate.rotation.x = -0.18;
  const magPlasmaStrip = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.040, 0.088, 0.012, 0.002, 0.001),
    mats.plasmaCyanGlow
  );
  magPlasmaStrip.position.set(0, -0.004, 0.012);
  magPlasmaStrip.rotation.x = -0.18;
  magGroup.add(magBody, magBaseplate, magPlasmaStrip);
  rifleGroup.add(magGroup);

  // 6. Anatomical Right Trigger Hand & Left C-Clamp Forend Support Hand (framed cleanly in 1st-person view!)
  const rightGlove = buildTacticalGloveHand(THREE, mats, 1, 'rifleGrip');
  rightGlove.position.set(0.012, -0.054, 0.068);
  rightGlove.rotation.set(-0.18, -0.08, 0.06);
  rifleGroup.add(rightGlove);

  const leftSupportHand = buildTacticalGloveHand(THREE, mats, -1, 'cClampSupport');
  leftSupportHand.position.set(-0.036, -0.018, -0.228);
  leftSupportHand.rotation.set(0.14, 0.48, 0.44);
  rifleGroup.add(leftSupportHand);

  return {
    rifleGroup,
    rightGlove,
    leftSupportHand,
    magGroup,
    boltCarrier,
    opticLens: reticleRing,
    opticWindowGlass,
    ammoBarFill,
    barrelHeatTube,
    helixPod,
  };
}

/**
 * Builds Shimada Hanzo's Masterwork Asymmetric Recurve Storm Bow (`风林火山 · 岚弓`)
 * with carbon-urushi laminated limbs, forged Kinko-gold dragon tips (`弭`), holographic Kyudo sight ring,
 * zero-GC dynamic 2-segment elastic bowstring, swap-ready nocked arrow (Standard / Sonic / Storm),
 * left Kyudo bow-grip gauntlet, and right `弽 Yugake` 3-finger draw hand!
 */
export function buildMasterworkStormBowRig(THREE: any, mats: HeroViewmodelPbrSuite) {
  const bowGroup = new THREE.Group();
  bowGroup.name = 'viewmodel-hanzo-storm-bow';

  const riserCore = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.030, 0.24, 0.044, 0.006, 0.003),
    mats.urushiLacquer
  );
  const nigiriWrap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0175, 0.0185, 0.115, 12),
    mats.tsukaSilk
  );
  nigiriWrap.scale.set(0.88, 1.0, 1.18);
  nigiriWrap.position.set(0, -0.025, 0.004);

  const riserGoldUpper = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.034, 0.032, 0.048, 0.004, 0.002),
    mats.forgedGold
  );
  riserGoldUpper.position.set(0, 0.088, 0);
  const riserGoldLower = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.034, 0.028, 0.048, 0.004, 0.002),
    mats.forgedGold
  );
  riserGoldLower.position.set(0, -0.105, 0);

  const arrowShelf = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.026, 0.012, 0.056, 0.002, 0.0015),
    mats.forgedGold
  );
  arrowShelf.position.set(0.016, 0.036, -0.008);

  const dragonInlay = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.033, 0.12, 0.012, 0.002, 0.001),
    mats.plasmaCyanGlow.clone()
  );
  dragonInlay.position.set(0, 0.015, -0.018);

  const stabilizerRod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0065, 0.008, 0.16, 10).rotateX(Math.PI / 2),
    mats.carbonWeave
  );
  stabilizerRod.position.set(0, -0.072, -0.095);
  const stabilizerTip = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.016, 1),
    mats.forgedGold
  );
  stabilizerTip.position.set(0, -0.072, -0.18);

  bowGroup.add(
    riserCore,
    nigiriWrap,
    riserGoldUpper,
    riserGoldLower,
    arrowShelf,
    dragonInlay,
    stabilizerRod,
    stabilizerTip
  );

  // Cantilevered Open Kyudo Holographic Sight Ring
  const sightBracket = new THREE.Mesh(
    makeBevelBoxGeo(THREE, 0.038, 0.009, 0.032, 0.002, 0.001),
    mats.gunmetal
  );
  sightBracket.position.set(0.028, 0.068, -0.022);
  const sightRingOuter = new THREE.Mesh(
    new THREE.TorusGeometry(0.022, 0.0028, 8, 24),
    mats.forgedGold
  );
  sightRingOuter.position.set(0.050, 0.068, -0.026);
  const sightReticleInner = new THREE.Mesh(
    new THREE.RingGeometry(0.007, 0.0095, 20),
    mats.plasmaCyanGlow.clone()
  );
  sightReticleInner.position.set(0.050, 0.068, -0.025);
  bowGroup.add(sightBracket, sightRingOuter, sightReticleInner);

  // Articulated Upper & Lower Laminated Recurve Limbs
  const buildRecurveLimb = (dirSign: 1 | -1) => {
    const pivot = new THREE.Group();
    pivot.position.set(0, dirSign * 0.105, 0);

    const innerLimb = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.024, 0.21, 0.028, 0.004, 0.002),
      mats.carbonWeave
    );
    innerLimb.position.set(0, dirSign * 0.10, -0.012);
    innerLimb.rotation.x = dirSign * 0.16;

    const cobaltRib = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.026, 0.18, 0.012, 0.002, 0.001),
      mats.cobaltAlloy
    );
    cobaltRib.position.set(0, dirSign * 0.10, -0.024);
    cobaltRib.rotation.x = dirSign * 0.16;

    const outerRecurve = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.019, 0.19, 0.022, 0.003, 0.0015),
      mats.urushiLacquer
    );
    outerRecurve.position.set(0, dirSign * 0.275, -0.004);
    outerRecurve.rotation.x = -dirSign * 0.22;

    const limbEnergyVein = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.021, 0.16, 0.008, 0.001, 0.001),
      mats.plasmaCyanGlow.clone()
    );
    limbEnergyVein.position.set(0, dirSign * 0.27, 0.006);
    limbEnergyVein.rotation.x = -dirSign * 0.22;

    const tipAnchor = new THREE.Group();
    tipAnchor.position.set(0, dirSign * 0.365, 0.024);
    const tipHorn = new THREE.Mesh(
      new THREE.ConeGeometry(0.012, 0.048, 8),
      mats.forgedGold
    );
    if (dirSign < 0) tipHorn.rotation.x = Math.PI;
    const tipCollar = new THREE.Mesh(
      new THREE.TorusGeometry(0.011, 0.003, 6, 14).rotateX(Math.PI / 2),
      mats.forgedGold
    );
    tipAnchor.add(tipHorn, tipCollar);

    pivot.add(innerLimb, cobaltRib, outerRecurve, limbEnergyVein, tipAnchor);
    return { pivot, tipAnchor, limbEnergyVein };
  };

  const upperLimb = buildRecurveLimb(1);
  const lowerLimb = buildRecurveLimb(-1);
  bowGroup.add(upperLimb.pivot, lowerLimb.pivot);

  // Dynamic 2-Segment Elastic Spirit-Silk Bowstring
  const unitCylGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 1.0, 6);
  const stringMat = mats.plasmaCyanGlow.clone();
  const upperString = new THREE.Mesh(unitCylGeo, stringMat);
  const lowerString = new THREE.Mesh(unitCylGeo, stringMat);
  bowGroup.add(upperString, lowerString);

  // Nocked Arrow Assembly with Standard / Sonic / Storm Warhead Swap
  const nockedArrowGrp = new THREE.Group();
  const arrowLen = 0.70;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0038, 0.0042, arrowLen, 8).rotateX(Math.PI / 2),
    mats.carbonWeave
  );
  shaft.position.z = -arrowLen * 0.5;

  const goldCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0058, 0.0052, 0.028, 8).rotateX(Math.PI / 2),
    mats.forgedGold
  );
  goldCollar.position.z = -arrowLen + 0.015;

  const nockClip = new THREE.Mesh(
    new THREE.TorusGeometry(0.0055, 0.0018, 6, 12),
    mats.forgedGold
  );

  for (let f = 0; f < 3; f++) {
    const a = (f * Math.PI * 2) / 3;
    const vane = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.0018, 0.016, 0.082, 0.0008, 0.0006),
      f === 0 ? mats.plasmaCyanGlow : mats.ceramicShroud
    );
    vane.position.set(Math.cos(a) * 0.007, Math.sin(a) * 0.007, -0.062);
    vane.rotation.z = a - Math.PI / 2;
    nockedArrowGrp.add(vane);
  }

  const standardHead = new THREE.Group();
  const broadBlade = new THREE.Mesh(
    new THREE.ConeGeometry(0.013, 0.068, 4).rotateX(-Math.PI / 2),
    mats.damascusBlade
  );
  broadBlade.scale.set(1.25, 0.45, 1.0);
  broadBlade.position.z = -arrowLen - 0.032;
  standardHead.add(broadBlade);

  const sonicHead = new THREE.Group();
  const sonarCrystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.018, 0),
    mats.plasmaCyanGlow
  );
  sonarCrystal.scale.set(0.85, 0.85, 2.2);
  sonarCrystal.position.z = -arrowLen - 0.034;
  const sonarRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.022, 0.0026, 6, 16),
    mats.forgedGold
  );
  sonarRing.position.z = -arrowLen - 0.018;
  sonicHead.add(sonarCrystal, sonarRing);
  sonicHead.visible = false;

  const stormHead = new THREE.Group();
  const stormSpear = new THREE.Mesh(
    new THREE.ConeGeometry(0.016, 0.088, 6).rotateX(-Math.PI / 2),
    mats.plasmaCyanGlow
  );
  stormSpear.position.z = -arrowLen - 0.042;
  const stormHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.020, 0.0028, 6, 16),
    mats.plasmaCyanGlow
  );
  stormHalo.position.z = -arrowLen - 0.012;
  const shaftGlow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0055, 0.0055, arrowLen * 0.88, 6).rotateX(Math.PI / 2),
    mats.plasmaCyanGlow
  );
  shaftGlow.position.z = -arrowLen * 0.5;
  stormHead.add(stormSpear, stormHalo, shaftGlow);
  stormHead.visible = false;

  nockedArrowGrp.add(shaft, goldCollar, nockClip, standardHead, sonicHead, stormHead);
  bowGroup.add(nockedArrowGrp);

  // =========================================================================
  // SHIMADA KYUDO FIRST-PERSON HANDS & FOREARMS (`押手 Oshite` & `胜手三弽 Katte`)
  // =========================================================================
  const buildKyudoBowHandArm = () => {
    const rootGrp = new THREE.Group();

    // Sculpted Contoured Kyudo Palm & Silver-Gold `手甲 (Tekko)` Dorsal Protector around `nigiri`
    const palmCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 12, 10),
      mats.kyudoBuckskin
    );
    palmCore.scale.set(0.86, 1.32, 0.72);
    palmCore.position.set(-0.020, -0.012, 0.012);
    palmCore.rotation.set(0.08, 0.28, 0.14);

    const dorsalPlate = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.036, 0.056, 0.010, 0.004, 0.002),
      mats.cyberSilverArmor
    );
    dorsalPlate.position.set(-0.033, -0.011, 0.020);
    dorsalPlate.rotation.set(0.08, 0.34, 0.14);

    const crestMedallion = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.012, 0.005, 12).rotateZ(Math.PI / 2),
      mats.forgedGold
    );
    crestMedallion.position.set(-0.039, -0.010, 0.022);
    crestMedallion.rotation.y = 0.32;

    rootGrp.add(palmCore, dorsalPlate, crestMedallion);

    // 4 Articulated 3-Phalanx Buckskin Fingers wrapping cleanly around front (`-Z`) & right (`+X`) of riser
    const fingerHeights = [0.020, 0.003, -0.014, -0.030];
    const fingerLens = [0.026, 0.029, 0.027, 0.022];
    for (let f = 0; f < 4; f++) {
      const fy = fingerHeights[f];
      const fl = fingerLens[f];
      const fBase = new THREE.Group();
      fBase.position.set(-0.018, fy, -0.006);

      const p1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0068, 0.0076, fl, 8).rotateX(Math.PI / 2),
        mats.kyudoBuckskin
      );
      p1.position.set(0.002, 0, -fl * 0.45);
      p1.rotation.y = -0.32;

      const knuckle = new THREE.Mesh(
        new THREE.SphereGeometry(0.0074, 8, 6),
        f < 2 ? mats.forgedGold : mats.cyberSilverArmor
      );

      const p2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0060, 0.0068, fl * 0.88, 8).rotateZ(Math.PI / 2),
        mats.kyudoBuckskin
      );
      p2.position.set(0.018, 0, -fl * 0.85);
      p2.rotation.y = -0.18;

      const p3 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0052, 0.0060, fl * 0.72, 8),
        mats.forgedGold
      );
      p3.position.set(0.030, 0, -fl * 0.52);
      p3.rotation.x = Math.PI / 2;
      p3.rotation.z = 0.25;

      fBase.add(knuckle, p1, p2, p3);
      rootGrp.add(fBase);
    }

    // Kyudo `角见 (Tsunomi)` Thumb braced firmly against the upper-right throat of the bow riser
    const thumbGrp = new THREE.Group();
    thumbGrp.position.set(-0.006, 0.018, 0.022);
    const thumbP1 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0080, 0.0090, 0.030, 8).rotateZ(Math.PI / 2),
      mats.kyudoBuckskin
    );
    thumbP1.position.set(0.012, 0.006, -0.008);
    thumbP1.rotation.y = 0.48;
    const thumbCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.0085, 8, 6),
      mats.forgedGold
    );
    thumbCap.scale.set(1.3, 0.85, 0.95);
    thumbCap.position.set(0.025, 0.008, -0.018);
    thumbGrp.add(thumbP1, thumbCap);
    rootGrp.add(thumbGrp);

    // Sculpted Left `弓笼手 (Yugote)` Azure-Silk & Ivory-Silver Bracer sweeping cleanly toward bottom-left
    const forearmAxis = new THREE.Vector3(-0.56, -0.54, 0.63).normalize();
    const forearmGrp = new THREE.Group();
    forearmGrp.position.set(-0.026, -0.036, 0.026);
    forearmGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forearmAxis);

    const wristCuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.026, 0.032, 12),
      mats.forgedGold
    );
    wristCuff.position.y = 0.016;

    const sleeveBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.041, 0.028, 0.24, 12),
      mats.shimadaAzureSilk
    );
    sleeveBody.position.y = 0.135;

    const koteArmor = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.040, 0.185, 0.022, 0.006, 0.003),
      mats.ceramicShroud
    );
    koteArmor.position.set(-0.014, 0.132, 0.015);

    const koteVein = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.009, 0.145, 0.007, 0.002, 0.001),
      mats.plasmaCyanGlow
    );
    koteVein.position.set(-0.030, 0.132, 0.022);

    forearmGrp.add(wristCuff, sleeveBody, koteArmor, koteVein);
    for (let b = 0; b < 3; b++) {
      const cord = new THREE.Mesh(
        new THREE.TorusGeometry(0.032 + b * 0.0035, 0.0034, 6, 14).rotateX(Math.PI / 2),
        mats.tsukaSilk
      );
      cord.position.y = 0.056 + b * 0.055;
      forearmGrp.add(cord);
    }
    rootGrp.add(forearmGrp);

    return rootGrp;
  };

  const buildKyudoDrawHandArm = () => {
    // Origin `(0, 0, 0)` sits directly on the bowstring nock point (`_nock`)!
    const anchorGrp = new THREE.Group();
    const handBody = new THREE.Group();
    anchorGrp.add(handBody);

    // Sleek Anatomical Rounded `鹿革三弽 (Mitsugake)` Deerskin Glove Metacarpal (NO chunky dark box!)
    const glovePalm = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 12, 10),
      mats.kyudoBuckskin
    );
    glovePalm.scale.set(0.78, 1.24, 1.06);
    glovePalm.position.set(0.040, -0.018, 0.028);
    glovePalm.rotation.set(-0.12, -0.38, -0.24);

    // Slender Silver-Gold Kyudo Tekko Dorsal Plate & Crimson/Gold `弽绪 (Kake-o)` Wrist Tie
    const dorsalGuard = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.034, 0.048, 0.010, 0.004, 0.002),
      mats.cyberSilverArmor
    );
    dorsalGuard.position.set(0.052, -0.014, 0.034);
    dorsalGuard.rotation.set(-0.12, -0.38, -0.24);

    const wristGoldStrap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.028, 0.026, 12),
      mats.forgedGold
    );
    wristGoldStrap.position.set(0.062, -0.036, 0.048);
    wristGoldStrap.rotation.set(-0.42, -0.32, -0.58);

    const crimsonWristCord = new THREE.Mesh(
      new THREE.TorusGeometry(0.027, 0.0038, 6, 14),
      mats.tsukaSilk
    );
    crimsonWristCord.position.set(0.058, -0.032, 0.044);
    crimsonWristCord.rotation.set(0.95, 0.45, -0.35);

    handBody.add(glovePalm, dorsalGuard, wristGoldStrap, crimsonWristCord);

    // Articulated `帽子 (Boshi)` Rigid Buckskin-and-Gold Thumb hooking bowstring cleanly from below
    const thumbPivot = new THREE.Group();
    thumbPivot.position.set(0.024, -0.015, 0.016);
    const thumbBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0076, 0.0088, 0.028, 8).rotateZ(Math.PI / 2),
      mats.kyudoBuckskin
    );
    thumbBase.position.set(-0.011, 0.004, -0.008);
    thumbBase.rotation.y = 0.46;
    const thumbHorn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0066, 0.0078, 0.022, 8),
      mats.forgedGold
    );
    thumbHorn.position.set(-0.022, 0.012, -0.012);
    thumbHorn.rotation.z = 0.35;
    thumbPivot.add(thumbBase, thumbHorn);
    handBody.add(thumbPivot);

    // Articulated Index & Middle `鹿革三弽` Buckskin Gloved Fingers hooking bowstring above & below arrow nock
    const hookFingerPivots: any[] = [];
    for (let f = 0; f < 2; f++) {
      const fy = f === 0 ? 0.013 : -0.004;
      const fp = new THREE.Group();
      fp.position.set(0.036, fy, 0.020);

      const seg1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0066, 0.0076, 0.032, 8).rotateZ(Math.PI / 2),
        mats.kyudoBuckskin
      );
      seg1.position.set(-0.015, 0.002, -0.009);
      seg1.rotation.y = 0.40;

      const knuckle = new THREE.Mesh(
        new THREE.SphereGeometry(0.0072, 8, 6),
        mats.forgedGold
      );
      knuckle.position.set(-0.028, 0.002, -0.016);

      const seg2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0058, 0.0066, 0.023, 8).rotateX(Math.PI / 2),
        mats.kyudoBuckskin
      );
      seg2.position.set(-0.034, 0.001, -0.005);
      seg2.rotation.y = -0.36;

      fp.add(seg1, knuckle, seg2);
      handBody.add(fp);
      hookFingerPivots.push(fp);
    }

    // Slender Curled Ring & Little Fingers tucked into palm (`三弽` exposed/soft lower fingers)
    for (let f = 0; f < 2; f++) {
      const tucked = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0062, 0.0070, 0.026, 8).rotateZ(Math.PI / 2),
        mats.kyudoBuckskin
      );
      tucked.position.set(0.028 + f * 0.004, -0.022 - f * 0.012, 0.016 + f * 0.004);
      tucked.rotation.y = -0.35;
      handBody.add(tucked);
    }

    // Sculpted Right Shimada Azure-Silk & Silver Archery Forearm extending into lower-right viewport
    // Camera-safe length (`0.19m` along `(+0.62, -0.60, +0.38)`) so `z` stays cleanly in front of lens!
    const rightForearmAxis = new THREE.Vector3(0.62, -0.60, 0.38).normalize();
    const rightForearm = new THREE.Group();
    rightForearm.position.set(0.064, -0.040, 0.050);
    rightForearm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), rightForearmAxis);

    const sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.039, 0.026, 0.19, 12),
      mats.shimadaAzureSilk
    );
    sleeve.position.y = 0.095;

    const bracerShell = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.038, 0.15, 0.022, 0.006, 0.003),
      mats.cyberSilverArmor
    );
    bracerShell.position.set(0.013, 0.095, 0.013);

    const dragonTrim = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.011, 0.135, 0.009, 0.002, 0.001),
      mats.forgedGold
    );
    dragonTrim.position.set(0.030, 0.095, 0.019);

    const spiritConduit = new THREE.Mesh(
      makeBevelBoxGeo(THREE, 0.007, 0.115, 0.007, 0.001, 0.001),
      mats.plasmaCyanGlow
    );
    spiritConduit.position.set(0.020, 0.095, 0.024);

    rightForearm.add(sleeve, bracerShell, dragonTrim, spiritConduit);
    handBody.add(rightForearm);

    const setReleaseOpen = (openRatio: number, drawRatio: number) => {
      const r = Math.max(0, Math.min(1, openRatio));
      // `离れ (Hanare)` finger snap-open & crisp Kyudo outward follow-through!
      thumbPivot.rotation.set(0, -r * 0.58, -r * 0.36);
      hookFingerPivots[0].rotation.set(-r * 0.32, r * 0.68, r * 0.28);
      hookFingerPivots[1].rotation.set(r * 0.18, r * 0.64, r * 0.24);
      handBody.position.set(r * 0.032, r * 0.010, r * 0.024);
      handBody.rotation.set(-drawRatio * 0.05, -drawRatio * 0.08 - r * 0.22, -r * 0.18);
    };

    return { anchorGrp, setReleaseOpen };
  };

  const leftBowHand = buildKyudoBowHandArm();
  leftBowHand.position.set(0, -0.006, 0.002);
  bowGroup.add(leftBowHand);

  const rightDrawRig = buildKyudoDrawHandArm();
  const rightDrawHand = rightDrawRig.anchorGrp;
  bowGroup.add(rightDrawHand);

  const _tipU = new THREE.Vector3();
  const _tipL = new THREE.Vector3();
  const _nock = new THREE.Vector3();
  const _mid = new THREE.Vector3();
  const _seg = new THREE.Vector3();
  const _yUp = new THREE.Vector3(0, 1, 0);
  const _qStr = new THREE.Quaternion();

  function updateBowDraw(
    drawRatio: number,
    arrowMode: 'normal' | 'sonic' | 'storm',
    showNockedArrow = true,
    releaseOpen = 0
  ) {
    const d = Math.max(0, Math.min(1, drawRatio));
    const flexRad = d * 0.24;
    upperLimb.pivot.rotation.x = -flexRad;
    lowerLimb.pivot.rotation.x = flexRad;

    const upperTipY = 0.105 + Math.cos(flexRad) * 0.365 - Math.sin(flexRad) * 0.024;
    const upperTipZ = Math.sin(flexRad) * 0.365 + Math.cos(flexRad) * 0.024;
    const lowerTipY = -0.105 - Math.cos(flexRad) * 0.365 + Math.sin(flexRad) * 0.024;
    const lowerTipZ = Math.sin(flexRad) * 0.365 + Math.cos(flexRad) * 0.024;

    _tipU.set(0, upperTipY, upperTipZ);
    _tipL.set(0, lowerTipY, lowerTipZ);

    // Camera-frustum-calibrated nock travel (`0.118m -> 0.306m`) so idle hands are cleanly separated
    // along the arrow shaft and full draw stays 100% inside `viewCamera` foreground!
    const nockZ = 0.118 + d * 0.188;
    _nock.set(0.016, 0.038, nockZ);

    _mid.addVectors(_tipU, _nock).multiplyScalar(0.5);
    _seg.subVectors(_nock, _tipU);
    const lenU = Math.max(0.01, _seg.length());
    upperString.position.copy(_mid);
    _qStr.setFromUnitVectors(_yUp, _seg.multiplyScalar(1 / lenU));
    upperString.quaternion.copy(_qStr);
    upperString.scale.set(1, lenU, 1);

    _mid.addVectors(_tipL, _nock).multiplyScalar(0.5);
    _seg.subVectors(_nock, _tipL);
    const lenL = Math.max(0.01, _seg.length());
    lowerString.position.copy(_mid);
    _qStr.setFromUnitVectors(_yUp, _seg.multiplyScalar(1 / lenL));
    lowerString.quaternion.copy(_qStr);
    lowerString.scale.set(1, lenL, 1);

    nockedArrowGrp.visible = showNockedArrow;
    nockedArrowGrp.position.copy(_nock);

    // Keep right `Mitsugake` string-drawing hand anchored cleanly to the bowstring nock (with release recoil)
    const handPullZ = showNockedArrow ? nockZ : 0.118 + Math.max(d, releaseOpen * 0.72) * 0.188;
    rightDrawHand.position.set(0.016, 0.038, handPullZ);
    rightDrawRig.setReleaseOpen(releaseOpen, d);

    standardHead.visible = arrowMode === 'normal';
    sonicHead.visible = arrowMode === 'sonic';
    stormHead.visible = arrowMode === 'storm';

    const glowHex =
      arrowMode === 'storm'
        ? 0x38d8ff
        : arrowMode === 'sonic'
          ? 0x62ffee
          : d > 0.85
            ? 0xffd166
            : 0x3ca8ff;
    const glowBoost = (arrowMode !== 'normal' ? 2.4 : 1.7) + d * 1.1;
    dragonInlay.material.color.setHex(glowHex).multiplyScalar(glowBoost);
    upperLimb.limbEnergyVein.material.color.setHex(glowHex).multiplyScalar(glowBoost);
    lowerLimb.limbEnergyVein.material.color.setHex(glowHex).multiplyScalar(glowBoost);
    stringMat.color.setHex(glowHex).multiplyScalar(1.8 + d * 1.2);
    sightReticleInner.material.color.setHex(glowHex).multiplyScalar(2.2);
  }

  updateBowDraw(0, 'normal', true, 0);

  return {
    bowGroup,
    upperLimb: upperLimb.pivot,
    lowerLimb: lowerLimb.pivot,
    upperString,
    lowerString,
    nockedArrowGrp,
    leftBowHand,
    rightDrawHand,
    sightReticleInner,
    updateBowDraw,
  };
}

