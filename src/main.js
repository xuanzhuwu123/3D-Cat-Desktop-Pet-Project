// 入口：初始化 Three.js 场景与渲染循环，加载模型并挂载到场景，把其他模块串起来。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import glbUrl from '../assets/models/cat.glb?url';
import mp4Url from '../assets/preview.mp4?url';
import { initUI } from './uiController.js';
import { createPetFSM, PetState } from './petFSM.js';
import { setupLighting, fitShadowToModel, polishMaterials, createCameraRig } from './sceneLighting.js';

const container = document.getElementById('viewer');
let pet = null;

const ui = initUI({
  onModelChange: (isAnimated) => pet?.setAnimated(isAnimated),
  onPlayToggle: (isPlaying) => pet?.setPlaying(isPlaying),
  onResetView: () => cameraRig.reset(),
});
ui.setMedia({ glbUrl, mp4Url });

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch (e) {
  ui.showError('3D 查看器没有启动成功，请换用最新版 Chrome / Edge / Firefox / Safari 打开本文件。');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
renderer.domElement.style.touchAction = 'pan-y';

const lighting = setupLighting(renderer, scene);
const cameraRig = createCameraRig(camera, controls);

function resize() {
  const { clientWidth: w, clientHeight: h } = container;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);
resize();

new GLTFLoader().load(
  glbUrl,
  (gltf) => {
    const model = gltf.scene;
    polishMaterials(model, renderer);
    scene.add(model);

    const box = new THREE.Box3().setFromObject(model);
    fitShadowToModel(lighting, box);
    cameraRig.frame(box);

    pet = createPetFSM(gltf);
    pet.setState(PetState.Idle);
    ui.setLoaded();
  },
  (e) => { if (e.lengthComputable) ui.setProgress(e.loaded / e.total); },
  () => ui.showError('模型加载失败，请换用最新版 Chrome / Edge / Firefox 打开。')
);

const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  pet?.update(timer.getDelta());
  controls.update();
  renderer.render(scene, camera);
});
