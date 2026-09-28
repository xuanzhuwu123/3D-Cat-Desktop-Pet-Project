// 灯光、材质与相机运镜。
// 数值对应旧版 model-viewer 的属性：exposure="1.05" shadow-intensity="1.1" shadow-softness="0.8"
// camera-orbit="60deg 75deg 105%" min-camera-orbit="auto auto 40%" max-camera-orbit="auto auto 250%"
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const VIEW = {
  exposure: 1.05,
  shadowIntensity: 1.1,
  shadowSoftness: 0.8,
  fov: 30,          // 竖直视场角（度）
  theta: 60,        // 水平环绕角（度），0 = 正面
  phi: 75,          // 俯仰角（度），0 = 正上方
  radius: 1.05,     // 相对"刚好装下模型"距离的倍数
  minRadius: 0.4,
  maxRadius: 2.5,
};

export function setupLighting(renderer, scene) {
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = VIEW.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  // 顶光只负责投出地面软阴影，强度很低，主要照明来自环境贴图
  const shadowLight = new THREE.DirectionalLight(0xffffff, 0.3);
  shadowLight.castShadow = true;
  shadowLight.shadow.mapSize.set(512, 512);
  shadowLight.shadow.radius = 2 + VIEW.shadowSoftness * 12;
  shadowLight.shadow.blurSamples = 16;
  scene.add(shadowLight, shadowLight.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShadowMaterial({ opacity: Math.min(VIEW.shadowIntensity, 1) * 0.35 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  return { shadowLight, ground };
}

// 把地面和阴影相机对齐到模型的包围盒
export function fitShadowToModel(lighting, box) {
  const { shadowLight, ground } = lighting;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.z) * 2;

  ground.position.set(center.x, box.min.y, center.z);
  ground.scale.set(extent * 2, extent * 2, 1);

  shadowLight.position.set(center.x, box.max.y + size.y * 2, center.z);
  shadowLight.target.position.set(center.x, box.min.y, center.z);
  const cam = shadowLight.shadow.camera;
  cam.left = cam.bottom = -extent;
  cam.right = cam.top = extent;
  cam.near = 0.01;
  cam.far = size.y * 4;
  cam.updateProjectionMatrix();
}

// 材质打磨：开启投影、提高贴图各向异性过滤
export function polishMaterials(root, renderer) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materials) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
        if (mat[key]) mat[key].anisotropy = maxAniso;
      }
    }
  });
}

// 相机运镜：初始构图、重置视角，以及预留的点击特写
export function createCameraRig(camera, controls) {
  const target = new THREE.Vector3();
  let idealDistance = 1;

  function frame(box) {
    box.getCenter(target);
    // 按"竖直半高 / 水平半对角线"中较大者取景，比包围球更贴近 model-viewer 的构图
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.y / 2, Math.hypot(size.x, size.z) / 2);
    const vHalf = THREE.MathUtils.degToRad(VIEW.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    idealDistance = radius / Math.sin(Math.min(vHalf, hHalf));

    controls.minDistance = idealDistance * VIEW.minRadius;
    controls.maxDistance = idealDistance * VIEW.maxRadius;
    camera.near = idealDistance / 100;
    camera.far = idealDistance * 10;
    reset();
  }

  function reset() {
    // 先关掉阻尼更新一次，清掉拖拽留下的惯性，否则重置后镜头还会继续转
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;

    camera.fov = VIEW.fov;
    const offset = new THREE.Vector3().setFromSphericalCoords(
      idealDistance * VIEW.radius,
      THREE.MathUtils.degToRad(VIEW.phi),
      THREE.MathUtils.degToRad(VIEW.theta)
    );
    camera.position.copy(target).add(offset);
    controls.target.copy(target);
    camera.updateProjectionMatrix();
    controls.update();
  }

  // TODO(sceneLighting 负责人)：点击猫咪时平滑推近到 object 的特写，再次调用 reset() 退出
  function focusOn(object) {}

  return { frame, reset, focusOn };
}
