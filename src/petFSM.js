// 猫咪动画与状态机：解析 CatRigAction，管理 AnimationMixer，驱动 Idle / Walk / Interact 状态。
import * as THREE from 'three';

export const PetState = {
  Idle: 'Idle',
  Walk: 'Walk',
  Interact: 'Interact',
};

const MAIN_CLIP = 'CatRigAction';

export function createPetFSM(gltf) {
  const root = gltf.scene;
  const mixer = new THREE.AnimationMixer(root);
  const clip = THREE.AnimationClip.findByName(gltf.animations, MAIN_CLIP) || gltf.animations[0];
  const mainAction = clip ? mixer.clipAction(clip) : null;
  const restPose = captureRestPose(root);

  let animated = true;   // 动画版 / 绑定版（静态姿势）
  let playing = true;
  let current = null;

  // 目前只有 CatRigAction 一段动画，Walk 和 Interact 先沿用它，等新动作做好再替换
  const states = {
    [PetState.Idle]: {
      enter() { startMain(); },
    },
    [PetState.Walk]: {
      enter() { startMain(); },
    },
    [PetState.Interact]: {
      enter() { startMain(); },
    },
  };

  function startMain() {
    if (!mainAction || !animated) return;
    mainAction.reset().play();
    mainAction.paused = !playing;
  }

  function setState(name) {
    if (!states[name] || name === current) return;
    states[current]?.exit?.();
    current = name;
    states[current].enter();
  }

  function update(dt) {
    states[current]?.update?.(dt);
    mixer.update(dt);
  }

  // 切到绑定版时停掉动画并回到 glTF 里的原始姿势；切回动画版时从头播放
  function setAnimated(on) {
    animated = on;
    if (on) {
      startMain();
    } else {
      mixer.stopAllAction();
      restorePose(restPose);
    }
  }

  function setPlaying(on) {
    playing = on;
    if (mainAction) mainAction.paused = !on;
  }

  return {
    mixer,
    update,
    setState,
    setAnimated,
    setPlaying,
    get state() { return current; },
  };
}

function captureRestPose(root) {
  const pose = [];
  root.traverse((obj) => {
    pose.push([obj, obj.position.clone(), obj.quaternion.clone(), obj.scale.clone()]);
  });
  return pose;
}

function restorePose(pose) {
  for (const [obj, position, quaternion, scale] of pose) {
    obj.position.copy(position);
    obj.quaternion.copy(quaternion);
    obj.scale.copy(scale);
  }
}
