import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const testRoot = await mkdtemp(join(tmpdir(), 'xingmu-assets-'));
const originalDataPath = process.env.JZZM_LOCAL_DATA;
const testDataPath = join(testRoot, 'data.json');

async function call(api, pathname, body = {}) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = 'POST';
  request.url = pathname;
  request.headers = {};
  let output = '';
  const response = { writeHead() {}, end(value) { output = String(value || ''); } };
  await api(request, response, pathname);
  return JSON.parse(output);
}

try {
  await cp(join(sourceRoot, 'local-api.mjs'), join(testRoot, 'local-api.mjs'));
  await cp(join(sourceRoot, 'local-export.mjs'), join(testRoot, 'local-export.mjs'));
  await mkdir(join(testRoot, 'local-upload', 'image'), { recursive: true });
  await mkdir(join(testRoot, 'local-upload', 'material'), { recursive: true });
  await writeFile(join(testRoot, 'local-upload', 'image', 'test.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'));
  await writeFile(join(testRoot, 'local-upload', 'image', 'test2.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'));
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(2, 40);
  await writeFile(join(testRoot, 'local-upload', 'material', 'tone.wav'), wav);
  process.env.JZZM_LOCAL_DATA = testDataPath;
  const moduleUrl = pathToFileURL(join(testRoot, 'local-api.mjs')).href;
  let api = (await import(moduleUrl)).handleLocalApi;

  const created = await call(api, '/gw/user/resource/createResourceFromLocalFile', {
    type: 1, name: '角色 A', resourceUrl: '/local-upload/image/test.png',
  });
  assert.equal(created.code, 0);
  const imageId = created.result.id;
  let listing = await call(api, '/gw/assets/resource/getParentResource');
  const parentId = listing.result.items[0].id;
  assert.equal(listing.result.items[0].characterResources[0].id, imageId);

  assert.equal((await call(api, '/gw/assets/resource/updateParentSubResource', {
    id: imageId, name: '角色 A 更新',
  })).result.name, '角色 A 更新');
  assert.equal((await call(api, '/gw/user/resource/parentFavorites', { id: parentId })).result.isStar, true);
  assert.equal((await call(api, '/gw/assets/resource/setParentResourceHidden', {
    id: parentId, isHidden: true,
  })).result.item.isHidden, true);
  assert.equal((await call(api, '/gw/user/resource/updateParentResourceName', {
    id: parentId, name: '角色组',
  })).result.name, '角色组');

  const audio = await call(api, '/gw/user/resource/createResource', {
    type: 4, name: '提示音', resourceUrl: '/local-upload/material/tone.wav',
  });
  assert.equal(audio.code, 0);
  assert.equal((await call(api, '/gw/user/resource/getResource', { type: 4 }))
    .result.items[0].id, audio.result.id);
  assert.equal((await call(api, '/gw/user/resource/updateResourceName', {
    id: audio.result.id, name: '提示音更新',
  })).result.name, '提示音更新');
  assert.equal((await call(api, '/gw/user/resource/starResource', {
    id: audio.result.id,
  })).result.isStar, true);
  assert.equal((await call(api, '/gw/user/resource/getResource', {
    type: 4, isStar: 1,
  })).result.total, 1);
  assert.equal((await call(api, '/gw/user/resource/getResource', {
    type: 4, isStar: 2,
  })).result.total, 0);
  assert.equal((await call(api, '/gw/assets/resource/getParentResource', {
    type: 1, isStar: 1,
  })).result.total, 1);

  const unrelated = await call(api, '/gw/assets/resource/createParentResource', {
    name: '空资源组', characterResources: [],
  });
  assert.equal(unrelated.code, 0);
  assert.equal((await call(api, '/gw/assets/resource/deleteParentSubResource', {
    ids: [imageId],
  })).code, 0);

  const saved = JSON.parse(await readFile(testDataPath, 'utf8'));
  assert.equal(saved.resources.some(item => item.id === parentId), false);
  assert.equal(saved.resources.some(item => item.id === unrelated.result.id), true);
  assert.equal(saved.looseResources.some(item => item.id === audio.result.id), true);
  api = (await import(`${moduleUrl}?reload=1`)).handleLocalApi;
  listing = await call(api, '/gw/assets/resource/getParentResource');
  assert.deepEqual(listing.result.items.map(item => item.name), ['空资源组']);
  assert.deepEqual((await call(api, '/gw/user/resource/getResource', { type: 4 }))
    .result.items.map(item => item.name), ['提示音更新']);
  const project = await call(api, '/gw/storyboard/project/createFreeProject', { name: '测试项目' });
  const { projectId, seriesId } = project.result;
  const shot = await call(api, '/gw/storyboard/api/save', {
    projectId, seriesId, originText: '测试分镜',
  });
  assert.equal(shot.code, 0);
  assert.equal((await call(api, '/gw/storyboard/api/changeProduceType', {
    seriesId, storyBoardId: shot.result.id, produceType: 2,
  })).result.produceType, 2);
  assert.equal((await call(api, '/gw/storyboard/series/setDetailedSeries', {
    projectId, detailedCount: 2,
  })).code, 0);
  await call(api, '/gw/storyboard/api/save', { id: shot.result.id, seriesId,
    imageList: [{ url: '/local-upload/image/test.png' }] });
  await call(api, '/gw/storyboard/api/save', { id: shot.result.id, seriesId,
    imageList: [{ url: '/local-upload/image/test2.png' }] });
  const history = await call(api, '/gw/storyboard/api/historyList', {
    storyBoardId: shot.result.id, type: 1,
  });
  assert.equal(history.result.items.length, 2);
  assert.equal((await call(api, '/gw/storyboard/api/switchMaterial', {
    seriesId, storyBoardId: shot.result.id,
    storyBoardHistoryId: history.result.items[1].id, type: 1,
  })).result.imageList[0].url, '/local-upload/image/test.png');
  api = (await import(`${moduleUrl}?reload=2`)).handleLocalApi;
  const restoredShot = (await call(api, '/gw/storyboard/api/list', { seriesId })).result.items[0];
  assert.equal(restoredShot.produceType, 2);
  assert.equal(restoredShot.imageList[0].url, '/local-upload/image/test.png');
  assert.equal((await call(api, '/gw/storyboard/series/getSeries', { projectId }))
    .result.items[0].isDetailed, 1);
  const copied = await call(api, '/gw/storyboard/project/copyProject', { projectId });
  assert.equal(copied.code, 0);
  const copiedSeries = (await call(api, '/gw/storyboard/series/getSeries', {
    projectId: copied.result.id,
  })).result.items[0];
  const copiedShot = (await call(api, '/gw/storyboard/api/list', {
    seriesId: copiedSeries.id,
  })).result.items[0];
  assert.equal((await call(api, '/gw/storyboard/api/historyList', {
    storyBoardId: copiedShot.id,
  })).result.items.length, 2);
  await call(api, '/gw/storyboard/series/deleteSeries', { id: seriesId });
  assert.equal((await call(api, '/gw/storyboard/api/historyList', {
    storyBoardId: shot.result.id,
  })).result.items.length, 0);
  console.log('资产、剧集、分镜模式与素材历史的本地持久化检查通过');
} finally {
  if (originalDataPath === undefined) delete process.env.JZZM_LOCAL_DATA;
  else process.env.JZZM_LOCAL_DATA = originalDataPath;
  const safeRoot = resolve(tmpdir()) + sep;
  if (!resolve(testRoot).startsWith(safeRoot)) throw Error('测试目录超出临时目录');
  await rm(testRoot, { recursive: true, force: true });
}
