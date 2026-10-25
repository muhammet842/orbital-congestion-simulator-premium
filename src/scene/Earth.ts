import {
  Color,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TextureLoader,
  Vector3,
} from 'three';
import { getDayNightState } from './dayNight';
import { earthTexturePaths } from './deviceProfile';

const sunDirectionUniform = { value: new Vector3(1, 0, 0) };

export class Earth {
  readonly mesh: Mesh;
  private readonly material: MeshStandardMaterial;

  constructor() {
    const geometry = new SphereGeometry(1, 32, 32);
    const loader = new TextureLoader();
    const textures = earthTexturePaths();
    const dayMap = loader.load(textures.day);
    const nightMap = loader.load(textures.night);

    this.material = new MeshStandardMaterial({
      map: dayMap,
      emissiveMap: nightMap,
      emissive: new Color(0xffcc88),
      emissiveIntensity: 0.85,
      roughness: 0.88,
      metalness: 0.02,
      depthWrite: true,
    });

    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDirection = sunDirectionUniform;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `
        #include <common>
        varying vec3 vWorldNormal;
        `,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        `
        #include <worldpos_vertex>
        vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `
        #include <common>
        varying vec3 vWorldNormal;
        uniform vec3 uSunDirection;
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `
        #include <emissivemap_fragment>
        float sunDot = dot(normalize(vWorldNormal), normalize(uSunDirection));
        float nightMask = smoothstep(0.08, -0.12, sunDot);
        totalEmissiveRadiance *= nightMask;
        `,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <output_fragment>',
        `
        float sunDotOut = dot(normalize(vWorldNormal), normalize(uSunDirection));
        float nightFill = mix(0.28, 0.0, smoothstep(-0.25, 0.2, sunDotOut));
        outgoingLight.rgb += diffuseColor.rgb * nightFill;
        #include <output_fragment>
        `,
      );
    };
    this.material.customProgramCacheKey = () => 'earth-night-mask-v2';

    this.mesh = new Mesh(geometry, this.material);
    this.mesh.renderOrder = 0;
  }

  /** Sync spin to simulated UTC; night lights follow world-space sun direction. */
  update(simTime: Date, sunDirection?: { x: number; y: number; z: number }): void {
    const state = getDayNightState(simTime);
    this.mesh.rotation.y = state.earthRotationY;

    const dir = sunDirection ?? state.sunDirection;
    sunDirectionUniform.value.set(dir.x, dir.y, dir.z).normalize();
  }
}