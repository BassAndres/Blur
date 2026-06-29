// Renderer + scene setup: WebGL renderer, fog-lit night scene, chase camera and
// an optional UnrealBloom pass for the neon glow. Bloom is wrapped in try/catch
// so the game still runs if the post-processing modules fail to load.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060f);
    this.scene.fog = new THREE.Fog(0x05060f, 120, 520);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 2000);
    this.camera.position.set(0, 8, -14);

    this._setupLights();
    this._setupComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _setupLights() {
    this.scene.add(new THREE.HemisphereLight(0x223355, 0x05060f, 0.55));
    const key = new THREE.DirectionalLight(0xbfdfff, 0.7);
    key.position.set(60, 120, 40);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 10; key.shadow.camera.far = 400;
    key.shadow.camera.left = -150; key.shadow.camera.right = 150;
    key.shadow.camera.top = 150; key.shadow.camera.bottom = -150;
    this.scene.add(key);
    this.keyLight = key;
    // distant neon city glow
    const m1 = new THREE.PointLight(0x19e6ff, 0.4, 600); m1.position.set(-200, 60, -200); this.scene.add(m1);
    const m2 = new THREE.PointLight(0xff2bd6, 0.4, 600); m2.position.set(200, 60, 100); this.scene.add(m2);
  }

  _setupComposer() {
    try {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.9, 0.6, 0.85);
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
