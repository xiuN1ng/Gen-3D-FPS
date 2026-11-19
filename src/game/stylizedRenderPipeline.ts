import { STYLIZED_HERO_PIPELINE_SPEC } from './roguelike';

export type StylizedMaterialRole = 'architecture' | 'enemy' | 'heroViewmodel';

export interface EnhanceStylizedOptions {
  role: StylizedMaterialRole;
  id: string;
}

/**
 * Installs the Stylized Hero-Shooter Lighting & Atmospheric Rig:
 * 1. Sky-Cerulean / Warm-Sakura-Bounce `HemisphereLight` across ALL camera layers (`camera` + `viewCamera`)
 *    so shadows are filled with luminous cool-cobalt sky light & warm terracotta ground bounce instead of black crush.
 * 2. Cool Cobalt-Lavender Rim Counter-Light (`DirectionalLight`, shadowless, opposite the sun) for crisp 3D form separation
 *    on architecture, enemy mechs, and first-person hero hands/weapons.
 * 3. Luminous Pastel Sky-Lavender `FogExp2` matching the painted Hanamura horizon so distant roofs & ridges blend airily.
 */
export function installStylizedHeroLighting(G: any): void {
  if (!G || !G.THREE || !G.scene) return;
  const THREE = G.THREE;
  const scene = G.scene;

  if (!scene.userData.__stylizedHeroRigInstalled) {
    scene.userData.__stylizedHeroRigInstalled = true;

    const hemi = new THREE.HemisphereLight(
      STYLIZED_HERO_PIPELINE_SPEC.hemiSkyHex,
      STYLIZED_HERO_PIPELINE_SPEC.hemiGroundHex,
      STYLIZED_HERO_PIPELINE_SPEC.hemiIntensity
    );
    hemi.name = 'stylized-hero-hemisphere';
    hemi.position.set(0, 80, 0);
    hemi.layers.enableAll();
    scene.add(hemi);

    const rimLight = new THREE.DirectionalLight(
      STYLIZED_HERO_PIPELINE_SPEC.rimCounterHex,
      STYLIZED_HERO_PIPELINE_SPEC.rimCounterIntensity
    );
    rimLight.name = 'stylized-hero-rim-counter';
    rimLight.position.set(-76, 52, -54);
    rimLight.castShadow = false;
    rimLight.layers.enableAll();
    scene.add(rimLight, rimLight.target);
  }

  // Luminous pastel sky-lavender aerial perspective mist (replaces neutral grey smog)
  const [fr, fg, fb] = STYLIZED_HERO_PIPELINE_SPEC.fogColorRgb;
  if (typeof THREE.FogExp2 === 'function') {
    scene.fog = new THREE.FogExp2(new THREE.Color(fr, fg, fb), STYLIZED_HERO_PIPELINE_SPEC.fogDensityExp2);
  }

  // Keep first-person viewmodel & metallic PBR reflections crisp without blowing out highlights
  if (G.render) {
    G.render.viewFill = 1.04;
    if (G.render.post) {
      G.render.post.wet = 0;
    }
  }
}

/**
 * Composable `onBeforeCompile` PBR + NPR Stylized Shader Enhancer (hybrid PBR + cel-rim look):
 * - Preserves any existing `mat.onBeforeCompile` & `mat.customProgramCacheKey` (such as world-space architectural UVs).
 * - `'architecture'`: Soft Half-Lambert shadow bounce strictly in shaded regions (cool cerulean sky from above + warm
 *   sakura-terracotta from below) so sunlit stone & plaster never get over-exposed.
 * - `'enemy'`: Signature stylized coral-crimson Fresnel threat silhouette rim + lifted cool-cobalt shadows
 *   + punchy cel-PBR specular highlights so enemies pop unmistakably against every background.
 * - `'heroViewmodel'`: Clean comic-hero cyan-ivory grazing edge highlight + grounded shadow fill + crisp metallic gleam
 *   on first-person weapons & articulated hands.
 */
export function enhanceMaterialStylized<T>(mat: T, opts: EnhanceStylizedOptions): T {
  const m = mat as any;
  if (!m || m.userData?.__stylizedEnhanced) return mat;
  m.userData = m.userData || {};
  m.userData.__stylizedEnhanced = opts.role;

  const prevCompile = typeof m.onBeforeCompile === 'function' ? m.onBeforeCompile.bind(m) : null;
  const prevCacheKey =
    typeof m.customProgramCacheKey === 'function' ? m.customProgramCacheKey.bind(m) : null;

  let injection = '';
  if (opts.role === 'architecture') {
    injection = `
      #include <lights_fragment_end>
      {
        vec3 styViewDir = normalize(vViewPosition);
        float styViewDist = length(vViewPosition);
        float styNdotV = clamp(dot(normal, styViewDir), 0.0, 1.0);
        float styUp = clamp((vec4(normal, 0.0) * viewMatrix).y * 0.5 + 0.5, 0.0, 1.0);
        float styDirLum = dot(reflectedLight.directDiffuse, vec3(0.299, 0.587, 0.114));
        float styShadowMask = 1.0 - smoothstep(0.02, 0.36, styDirLum);
        float stySunMask = smoothstep(0.18, 0.72, styDirLum);
        vec3 styBounce = mix(vec3(0.19, 0.115, 0.105), vec3(0.135, 0.25, 0.46), styUp);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * styBounce * (0.31 * styShadowMask);
        reflectedLight.directDiffuse *= mix(vec3(1.0), vec3(1.04, 1.01, 0.96), stySunMask);

        // Stylized two-band specular crispness on smoked kawara tiles, lacquer & polished stone
        float stySpecLum = dot(reflectedLight.directSpecular, vec3(0.299, 0.587, 0.114));
        float stySpecBand = smoothstep(0.016, 0.18, stySpecLum);
        reflectedLight.directSpecular *= mix(0.88, 1.28, stySpecBand);

        // Grazing sky sheen + subtle stylized cobalt aerial perspective at distance
        float styGrazing = pow(1.0 - styNdotV, 3.8) * (0.18 + 0.82 * styUp);
        reflectedLight.indirectSpecular += vec3(0.05, 0.092, 0.17) * styGrazing * (1.0 - roughnessFactor * 0.62);
        float styAerial = smoothstep(54.0, 182.0, styViewDist);
        reflectedLight.indirectDiffuse = mix(
          reflectedLight.indirectDiffuse,
          diffuseColor.rgb * vec3(0.25, 0.38, 0.65),
          styAerial * 0.20
        );
      }
    `;
  } else if (opts.role === 'enemy') {
    injection = `
      #include <lights_fragment_end>
      {
        vec3 styViewDir = normalize(vViewPosition);
        float styNdotV = clamp(dot(normal, styViewDir), 0.0, 1.0);
        float styUp = clamp((vec4(normal, 0.0) * viewMatrix).y * 0.5 + 0.5, 0.0, 1.0);
        float styThreatRim = smoothstep(0.34, 0.84, 1.0 - styNdotV);
        float stySharpRim = pow(1.0 - styNdotV, 2.75);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * mix(vec3(0.13, 0.17, 0.30), vec3(0.18, 0.29, 0.46), styUp) * 0.29;
        float stySpecLum = dot(reflectedLight.directSpecular, vec3(0.299, 0.587, 0.114));
        reflectedLight.directSpecular *= mix(0.95, 1.36, smoothstep(0.018, 0.20, stySpecLum));
        totalEmissiveRadiance += vec3(1.0, 0.20, 0.13) * (styThreatRim * 0.30 + stySharpRim * 0.52)
                               + vec3(0.36, 0.62, 0.98) * (stySharpRim * styUp * 0.16);
      }
    `;
  } else {
    injection = `
      #include <lights_fragment_end>
      {
        vec3 styViewDir = normalize(vViewPosition);
        float styNdotV = clamp(dot(normal, styViewDir), 0.0, 1.0);
        float styUp = clamp((vec4(normal, 0.0) * viewMatrix).y * 0.5 + 0.5, 0.0, 1.0);
        float styHeroRim = pow(1.0 - styNdotV, 2.70);
        vec3 styHeroFill = mix(vec3(0.12, 0.16, 0.25), vec3(0.17, 0.29, 0.48), styUp);
        reflectedLight.indirectDiffuse += diffuseColor.rgb * styHeroFill * 0.23;
        float stySpecLum = dot(reflectedLight.directSpecular, vec3(0.299, 0.587, 0.114));
        reflectedLight.directSpecular *= mix(0.95, 1.32, smoothstep(0.018, 0.19, stySpecLum));
        reflectedLight.indirectSpecular += mix(vec3(0.12, 0.22, 0.36), vec3(0.34, 0.56, 0.84), styUp)
                                         * styHeroRim * (0.28 + 0.40 * (1.0 - roughnessFactor));
      }
    `;
  }

  m.onBeforeCompile = (shader: any, renderer: any) => {
    if (prevCompile) {
      prevCompile(shader, renderer);
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', injection);
  };

  m.customProgramCacheKey = () => {
    const base = prevCacheKey ? prevCacheKey() : m.type || 'std';
    return `${base}|sty-ow-mr-v5-${opts.role}`;
  };

  m.needsUpdate = true;
  return mat;
}
