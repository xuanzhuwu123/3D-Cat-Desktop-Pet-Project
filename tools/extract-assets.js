// 一次性脚本：把 legacy/preview.html 里 base64 内嵌的模型和视频还原成独立文件。
// 用法：node tools/extract-assets.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'legacy/preview.html'), 'utf8');

const targets = [
  { id: 'glbData', out: 'assets/models/cat.glb' },
  { id: 'mp4Data', out: 'assets/preview.mp4' },
];

for (const { id, out } of targets) {
  const m = html.match(new RegExp(`id="${id}">([^<]*)<`));
  if (!m) throw new Error(`没有找到 #${id}`);
  const bytes = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  const file = path.join(root, out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  console.log(`${out}  ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);
}
