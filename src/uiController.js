// 页面 UI：按钮与下拉框事件、加载进度与提示、视频和下载链接，以及预留的破框（탈프레임）视效。

export function initUI({ onModelChange, onPlayToggle, onResetView }) {
  const modelSelect = document.getElementById('modelSelect');
  const playToggle = document.getElementById('playToggle');
  const resetView = document.getElementById('resetView');
  const progressBar = document.getElementById('progressBar');
  const loadHint = document.getElementById('loadHint');
  let isPlaying = true;

  modelSelect.addEventListener('change', () => {
    const isAnimated = modelSelect.value === 'anim';
    playToggle.style.display = isAnimated ? '' : 'none';
    onModelChange(isAnimated);
  });

  playToggle.addEventListener('click', () => {
    isPlaying = !isPlaying;
    playToggle.textContent = isPlaying ? '⏸ 暂停动画' : '▶ 播放动画';
    onPlayToggle(isPlaying);
  });

  resetView.addEventListener('click', () => onResetView());

  function setProgress(fraction) {
    const pct = Math.round(fraction * 100);
    if (pct < 100) {
      progressBar.style.width = pct + '%';
      loadHint.textContent = '模型加载中… ' + pct + '%';
    } else {
      progressBar.style.width = '0%';
    }
  }

  function setLoaded() {
    loadHint.textContent = '';
    loadHint.className = 'hint';
    progressBar.style.width = '0%';
  }

  function showError(msg) {
    loadHint.textContent = msg;
    loadHint.className = 'hint error';
  }

  function setMedia({ glbUrl, mp4Url }) {
    document.getElementById('dlGlb').href = glbUrl;
    document.getElementById('previewVideo').src = mp4Url;
    document.getElementById('dlMp4').href = mp4Url;
  }

  return { setProgress, setLoaded, showError, setMedia };
}

// TODO(uiController 负责人)：破框视效——让猫咪越过 .viewer-card 的边框显示在卡片外
export function enableFrameBreak(viewerCard) {}
