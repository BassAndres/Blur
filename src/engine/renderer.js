// Renderer + scene setup: physically-based night scene with ACES tone mapping,
// an image-based environment map (for realistic car-paint reflections), soft
// real-time shadows and an UnrealBloom pass for neon glow. Quality scales down
// on mobile to hold a smooth frame-rate.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

function detectQuality() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (coarse && (cores <= 6 || mem <= 4)) return 'mobile';
  return 'high';
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.quality = detectQuality();
    const mobile = this.quality === 'mobile';

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060f);
    this.scene.fog = new THREE.FogExp2(0x05060f, mobile ? 0.0024 : 0.0018);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 3000);
    this.camera.position.set(0, 8, -14);

    this._setupEnvironment();
    this._setupLights(mobile);
    this._setupComposer(mobile);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _setupEnvironment() {
    // Image-based lighting for believable metallic car paint + glass reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new RoomEnvironment(this.renderer);
    this.envMap = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environment = this.envMap;
    pmrem.dispose();
  }

  _setupLights(mobile) {
    this.scene.add(new THREE.HemisphereLight(0x2a3a66, 0x05060f, 0.5));

    const key = new THREE.DirectionalLight(0xcfe4ff, 1.1);
    key.position.set(80, 160, 60);
    key.castShadow = true;
    const sm = mobile ? 1024 : 2048;
    key.shadow.mapSize.set(sm, sm);
    key.shadow.camera.near = 10; key.shadow.camera.far = 600;
    key.shadow.camera.left = -180; key.shadow.camera.right = 180;
    key.shadow.camera.top = 180; key.shadow.camera.bottom = -180;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    this.keyLight = key;
    this._shadowTarget = new THREE.Object3D();
    this.scene.add(this._shadowTarget);
    key.target = this._shadowTarget;

    // colored neon fills for the night-city mood
    const m1 = new THREE.PointLight(0x19e6ff, 80, 700, 2); m1.position.set(-220, 70, -220); this.scene.add(m1);
    const m2 = new THREE.PointLight(0xff2bd6, 80, 700, 2); m2.position.set(220, 70, 120); this.scene.add(m2);
  }

  // Keep the shadow frustum centered on the action for crisp shadows.
  followShadow(pos) {
    if (!this.keyLight) return;
    this._shadowTarget.position.set(pos.x, 0, pos.z);
    this.keyLight.position.set(pos.x + 80, 160, pos.z + 60);
  }

  _setupComposer(mobile) {
    try {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      const strength = mobile ? 0.55 : 0.7;
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), strength, 0.5, 0.82);
      this.composer.addPass(this.bloom);
    } catch (e) {
      console.warn('Bloom disabled:', e);
      this.composer = null;
    }
  }

  setBloom(on) {
    if (this.bloom) this.bloom.enabled = on;
    this._bloomOn = on;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }

  render() {
    if (this.composer && (this.bloom ? this.bloom.enabled : true) && this._bloomOn !== false) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
