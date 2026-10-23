import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(process.argv[2] || import.meta.dirname);
const scriptPath = join(root, 'ai_comic', 'production', 'assets', 'index-CB4bi7Oy.js');
const patches = [
  {
    original: 'interactionMode:o?`reference-only`:`expand`,projectId:t,enableMaterialLock:!o,collaborationRoomId:pe',
    patched: 'interactionMode:o?`reference-only`:`expand`,projectId:t,enableMaterialLock:!1,collaborationRoomId:pe',
    description: '素材卡片协作锁',
  },
  {
    original: 'function UDe(){return typeof IntersectionObserver>`u`}',
    patched: 'function UDe(){return!0}',
    description: '分镜历史卡片延迟挂载',
  },
];
let source = await readFile(scriptPath, 'utf8');
let changed = false;
for (const { original, patched, description } of patches) {
  const originalCount = source.split(original).length - 1;
  const patchedCount = source.split(patched).length - 1;
  if (originalCount === 0 && patchedCount === 1) {
    console.log(`${description}补丁已存在`);
  } else if (originalCount === 1 && patchedCount === 0) {
    source = source.replace(original, patched);
    changed = true;
    console.log(`已应用${description}补丁`);
  } else {
    throw Error(`前端发布脚本版本或${description}补丁状态与预期不符，请重新核对该脚本`);
  }
}
if (changed) await writeFile(scriptPath, source);
