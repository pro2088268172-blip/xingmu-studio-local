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
  await mkdir(join(testRoot, 'local-upload', 'script'), { recursive: true });
  await writeFile(join(testRoot, 'local-upload', 'script', 'test.txt'), '第一场\n角色进入房间。');
  await writeFile(join(testRoot, 'local-upload', 'image', 'test.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'));
  await writeFile(join(testRoot, 'local-upload', 'image', 'test2.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'));
  await writeFile(join(testRoot, 'local-upload', 'image', 'test3.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'));
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(2, 40);
  await writeFile(join(testRoot, 'local-upload', 'material', 'tone.wav'), wav);
  await writeFile(join(testRoot, 'local-upload', 'material', 'tone.aac'), Buffer.from([0xff, 0xf1]));
  await writeFile(join(testRoot, 'local-upload', 'material', 'tone.m4a'), Buffer.from('local-audio-fixture'));
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
  const customVoice = await call(api, '/gw/storyboard/voiceTone/createMine', {
    name: '本地旁白', voiceUrl: '/local-upload/material/tone.wav',
  });
  assert.equal(customVoice.result.provider, 'custom');
  assert.equal((await call(api, '/gw/storyboard/voiceTone/updateMine', {
    id: customVoice.result.id, name: '本地旁白更新',
  })).result.name, '本地旁白更新');
  assert.equal((await call(api, '/gw/storyboard/voiceTone/updateMine', {
    id: customVoice.result.id, name: '不应保存', voiceUrl: '/local-upload/material/missing.wav',
  })).code, 400);
  assert.equal((await call(api, '/gw/storyboard/voiceTone/detail', {
    id: customVoice.result.id,
  })).result.name, '本地旁白更新');
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
  assert.equal((await call(api, '/gw/storyboard/voiceTone/listMine', {
    page: 1, size: 20, provider: 'custom',
  })).result.items[0].name, '本地旁白更新');
  assert.equal((await call(api, '/gw/storyboard/voiceTone/detailAll', {
    ids: [customVoice.result.id],
  })).result.items[0].voiceUrl, '/local-upload/material/tone.wav');
  assert.equal((await call(api, '/gw/storyboard/voiceTone/deleteMine', {
    id: customVoice.result.id,
  })).code, 0);
  assert.equal((await call(api, '/gw/storyboard/voiceTone/listMine')).result.total, 0);
  assert.equal((await call(api, '/gw/storyboard/voiceTone/detail', {
    id: customVoice.result.id,
  })).code, 404);
  for (const extension of ['aac', 'm4a']) {
    const item = await call(api, '/gw/storyboard/voiceTone/createMine', {
      name: `测试 ${extension}`, voiceUrl: `/local-upload/material/tone.${extension}`,
    });
    assert.equal(item.result.voiceUrl, `/local-upload/material/tone.${extension}`);
    assert.equal((await call(api, '/gw/storyboard/voiceTone/deleteMine', {
      id: item.result.id,
    })).code, 0);
  }
  const project = await call(api, '/gw/storyboard/project/createFreeProject', { name: '测试项目' });
  const { projectId, seriesId } = project.result;
  assert.equal((await call(api, '/gw/storyboard/project/editNewFreeProject', {
    id: projectId, scriptUrl: '/local-upload/script/test.txt',
    scriptName: '本地上传的文稿',
  })).result.project.scriptName, '本地上传的文稿');
  const director = await call(api, '/gw/storyboard/project/createDirectorCon', {
    projectId, name: '导演台01', remark: '',
    configJson: { version: 1, project: { objects: [], cameras: [] } },
  });
  assert.equal(director.result.configJson.version, 1);
  assert.equal((await call(api, '/gw/storyboard/project/getDirectorCon', {
    projectId,
  })).result.totalCount, 1);
  assert.equal((await call(api, '/gw/storyboard/project/updateDirectorCon', {
    id: director.result.id, projectId, name: '镜头预演',
    configJson: { version: 2, project: { objects: [{ id: 'actor-1' }] } },
  })).result.configJson.version, 2);
  const canvas = await call(api, '/gw/storyboard/project/createCanvasProject');
  const canvasListing = await call(api, '/gw/storyboard/project/getCanvasProjects', {
    spaceType: 'MY',
  });
  assert.equal(canvasListing.result.items[0].capabilities.canRead, true);
  assert.equal(canvasListing.result.items[0].canMoveInCurrentSpace, true);
  const canvasFolder = await call(api, '/gw/storyboard/project/createCanvasFolder', {
    name: '预演画布',
  });
  assert.equal((await call(api, '/gw/storyboard/project/moveCanvasProjectsToFolder', {
    spaceType: 'MY', targetFolderId: canvasFolder.result.id,
    projectIds: [canvas.result.projectId],
  })).result.updatedCount, 1);
  assert.equal((await call(api, '/gw/storyboard/project/moveCanvasProjectsToFolder', {
    spaceType: 'MY', targetFolderId: 9999999,
    projectIds: [canvas.result.projectId],
  })).code, 400);
  assert.equal((await call(api, '/gw/storyboard/project/moveCanvasProjectsToFolder', {
    spaceType: 'MY', targetFolderId: 'missing',
    projectIds: [canvas.result.projectId],
  })).code, 400);
  assert.equal((await call(api, '/gw/storyboard/project/getCanvasProjects', {
    spaceType: 'MY', folderId: canvasFolder.result.id,
  })).result.total, 1);
  const imagePreset = await call(api, '/gw/storyboard/imagePreset/create', {
    name: '本地电影风格', prefixPrompt: '柔和侧光', suffixPrompt: '保留真实质感',
    location: 110,
  });
  assert.equal(imagePreset.result.type, 99);
  assert.equal((await call(api, '/gw/storyboard/imagePreset/update', {
    id: imagePreset.result.id, name: '本地摄影风格',
    prefixPrompt: '自然侧光', suffixPrompt: '保留真实质感',
  })).result.name, '本地摄影风格');
  assert.equal((await call(api, '/gw/storyboard/imagePreset/list', {
    presetType: 0, location: 110,
  })).result.items.find(item => item.id === imagePreset.result.id).prefixPrompt,
  '自然侧光');
  const syncSource = await call(api, '/gw/storyboard/api/createProjectLibraryWithImages', {
    projectId, type: 1, name: '待同步角色',
    images: [{ name: '第一版', resourceUrl: '/local-upload/image/test.png' }],
  });
  assert.deepEqual((await call(api, '/gw/storyboard/project/checkProjectAssetSyncConflict', {
    projectId, libraryId: syncSource.result.id, isMerge: true,
  })).result, []);
  assert.equal((await call(api, '/gw/storyboard/project/syncProjectAssetLibrary', {
    projectId, libraryId: syncSource.result.id,
    imageIds: [syncSource.result.images[0].id],
  })).result.characterResources.length, 1);
  const secondImage = await call(api, '/gw/storyboard/api/createProjectLibraryImage', {
    projectLibraryId: syncSource.result.id, name: '第二版',
    resourceUrl: '/local-upload/image/test2.png',
  });
  assert.equal(secondImage.code, 0);
  assert.equal((await call(api, '/gw/storyboard/project/checkProjectAssetSyncConflict', {
    projectId, libraryId: syncSource.result.id, isMerge: true,
  })).result[0].hasConflict, true);
  assert.equal((await call(api, '/gw/storyboard/project/syncProjectAssetLibrary', {
    projectId, libraryId: syncSource.result.id, imageIds: [secondImage.result.id, 9999999],
    action: 'merge',
  })).code, 400);
  assert.equal((await call(api, '/gw/storyboard/project/syncProjectAssetLibrary', {
    projectId, libraryId: syncSource.result.id,
    imageIds: [secondImage.result.id, secondImage.result.id], action: 'merge',
  })).result.characterResources.length, 2);
  const overwritten = await call(api, '/gw/storyboard/project/syncProjectAssetLibrary', {
    projectId, libraryId: syncSource.result.id,
    imageIds: [syncSource.result.images[0].id], action: 'overwrite',
  });
  assert.equal(overwritten.result.characterResources.length, 1);
  assert.equal(overwritten.result.characterResources[0].resourceUrl,
    '/local-upload/image/test.png');
  assert.equal((await call(api, '/gw/assets/resource/getParentResource', { type: 1 }))
    .result.items.find(item => item.id === unrelated.result.id).characterResources.length, 0);
  await call(api, '/gw/storyboard/api/updateProjectLibraryImage', {
    id: syncSource.result.images[0].id,
    resourceUrl: ['/local-upload/image/test3.png'],
  });
  const libraryHistory = await call(api, '/gw/storyboard/api/libraryHistoryList', {
    projectId, libraryId: syncSource.result.id, type: 1,
  });
  const originalVersion = libraryHistory.result.items.find(item =>
    item.id > 0 && item.resourceUrl === '/local-upload/image/test.png');
  assert.ok(originalVersion);
  const imageHistory = await call(api, '/gw/storyboard/api/libraryHistoryList', {
    projectId, libraryId: syncSource.result.images[0].id, type: 1,
  });
  assert.equal(imageHistory.result.items.some(item => item.id === originalVersion.id), true);
  assert.equal(imageHistory.result.items.every(item =>
    item.imageId === syncSource.result.images[0].id), true);
  assert.equal((await call(api, '/gw/storyboard/api/switchLibraryHistory', {
    projectId, libraryId: secondImage.result.id,
    libraryHistoryId: originalVersion.id,
  })).code, 404);
  assert.equal((await call(api, '/gw/storyboard/api/switchLibraryHistory', {
    projectId, libraryId: syncSource.result.images[0].id,
    libraryHistoryId: originalVersion.id,
  })).result.images[0].resourceUrl[0], '/local-upload/image/test.png');
  assert.equal((await call(api, '/gw/storyboard/api/switchLibraryHistory', {
    projectId, libraryId: syncSource.result.id,
    libraryHistoryId: 9999999,
  })).code, 404);
  const parentAsset = await call(api, '/gw/assets/resource/createParentResource', {
    name: '可引用角色', type: 1,
    characterResources: [{ name: '形象 1', isMain: true,
      resourceUrl: '/local-upload/image/test.png' }],
  });
  const imported = await call(api, '/gw/storyboard/project/importParentResources', {
    projectId, parentResources: [parentAsset.result],
  });
  assert.equal(imported.result.importedCount, 1);
  const projectAssets = await call(api, '/gw/storyboard/api/projectLibraryList', {
    projectId, type: 1,
  });
  const materialStage = await call(api, '/gw/storyboard/api/libraryList', {
    projectId, type: 1,
  });
  assert.equal(materialStage.result.characters.length, projectAssets.result.total);
  assert.equal(materialStage.result.characters.some(item =>
    item.id === syncSource.result.id &&
    item.resourceUrl.includes('/local-upload/image/test2.png')), true);
  const importedProjectAsset = projectAssets.result.items.find(item =>
    item.parentResourceId === parentAsset.result.id);
  assert.equal(importedProjectAsset.images[0].resourceUrl[0],
    '/local-upload/image/test.png');
  const imageDetail = await call(api, '/gw/storyboard/api/getProjectLibraryImageDetail', {
    projectId, ids: [importedProjectAsset.images[0].id],
  });
  assert.equal(imageDetail.result[0].name, '形象 1');
  const targetProject = await call(api, '/gw/storyboard/project/createFreeProject', {
    name: '素材目标项目',
  });
  const targetProjectId = targetProject.result.projectId;
  const transfer = await call(api, '/gw/storyboard/project/copyProjectLibrary', {
    importProjectId: projectId, newProjectId: targetProjectId,
    projectLibraryIds: [importedProjectAsset.id],
  });
  assert.equal(transfer.result.copiedProjectLibraryCount, 1);
  assert.notEqual(transfer.result.items[0].images[0].id,
    importedProjectAsset.images[0].id);
  assert.equal((await call(api, '/gw/storyboard/project/copyProjectLibrary', {
    importProjectId: projectId, newProjectId: targetProjectId,
    projectLibraryIds: [importedProjectAsset.id],
  })).result.copiedProjectLibraryCount, 0);
  assert.equal((await call(api, '/gw/storyboard/api/projectLibraryList', {
    projectId: targetProjectId,
  })).result.total, 1);
  assert.equal((await call(api, '/gw/storyboard/api/libraryHistoryList', {
    projectId, libraryId: syncSource.result.id, type: 1,
  })).result.items.some(item => item.resourceUrl === '/local-upload/image/test3.png'), true);
  assert.equal((await call(api, '/gw/storyboard/project/importParentResources', {
    projectId, parentResources: [parentAsset.result],
  })).code, 409);
  await call(api, '/gw/assets/resource/deleteParentResource', {
    ids: [parentAsset.result.id],
  });
  assert.equal((await call(api, '/gw/storyboard/api/projectLibraryList', {
    projectId, type: 1,
  })).result.items.some(item => item.id === importedProjectAsset.id), true);
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
  const scriptExport = await call(api, '/gw/storyboard/api/export/scriptJsonBySeriesId', {
    seriesId,
  });
  assert.equal(scriptExport.code, 0);
  assert.equal(scriptExport.result.materials[0].url, '/local-upload/image/test2.png');
  assert.equal(scriptExport.result.draftInfo.tracks.length, 1);
  const history = await call(api, '/gw/storyboard/api/historyList', {
    storyBoardId: shot.result.id, type: 1,
  });
  assert.equal(history.result.items.length, 2);
  assert.equal((await call(api, '/gw/storyboard/api/historyList', {
    seriesId, type: 1,
  })).result.total, 2);
  assert.equal((await call(api, '/gw/storyboard/api/createProjectHistory', {
    projectId, seriesId: targetProject.result.seriesId, type: 1,
    imageList: ['/local-upload/image/test.png'],
  })).code, 400);
  const standaloneHistory = await call(api, '/gw/storyboard/api/createProjectHistory', {
    projectId, seriesId, type: 1, imagePrompt: '单独保存的画面',
    imageList: JSON.stringify(['/local-upload/image/test.png']),
  });
  assert.equal(standaloneHistory.code, 0);
  assert.equal((await call(api, '/gw/storyboard/api/projectHistoryList', {
    projectId, type: 1, search: '单独保存',
  })).result.total, 1);
  assert.equal((await call(api, '/gw/storyboard/api/updateHistoryStar', {
    seriesId, storyBoardHistoryId: standaloneHistory.result.id, isStar: 1,
  })).result.isStar, 1);
  assert.equal((await call(api, '/gw/storyboard/api/projectHistoryList', {
    projectId, isStar: 1,
  })).result.total, 1);
  assert.equal((await call(api, '/gw/storyboard/api/updateHistoryStar', {
    seriesId, storyBoardHistoryId: history.result.items[0].id, isStar: 1,
  })).result.isStar, 1);
  assert.equal((await call(api, '/gw/storyboard/api/projectHistoryList', {
    projectId, isStar: 1,
  })).result.total, 2);
  assert.equal((await call(api, '/gw/storyboard/api/updateHistoryStar', {
    seriesId, storyBoardHistoryId: history.result.items[0].id, isStar: '0',
  })).result.isStar, 0);
  assert.equal((await call(api, '/gw/storyboard/api/projectHistoryList', {
    projectId, isStar: 1,
  })).result.total, 1);
  await call(api, '/gw/storyboard/api/updateHistoryStar', {
    seriesId, storyBoardHistoryId: history.result.items[0].id, isStar: 1,
  });
  assert.equal((await call(api, '/gw/storyboard/api/switchMaterial', {
    seriesId, storyBoardId: shot.result.id,
    storyBoardHistoryId: history.result.items[1].id, type: 1,
  })).result.imageList[0], '/local-upload/image/test.png');
  api = (await import(`${moduleUrl}?reload=2`)).handleLocalApi;
  assert.equal((await call(api, '/gw/storyboard/project/getDirectorCon', {
    id: director.result.id, projectId,
  })).result.name, '镜头预演');
  assert.equal((await call(api, '/gw/storyboard/project/getProjectInfo', {
    projectId,
  })).result.scriptName, '本地上传的文稿');
  assert.equal((await call(api, '/gw/storyboard/project/getCanvasProjects', {
    spaceType: 'MY', folderId: canvasFolder.result.id,
  })).result.total, 1);
  assert.equal((await call(api, '/gw/storyboard/project/moveCanvasProjectsToFolder', {
    spaceType: 'MY', targetFolderId: 0,
    projectIds: [canvas.result.projectId],
  })).result.updatedCount, 1);
  assert.equal((await call(api, '/gw/storyboard/project/getCanvasProjects', {
    spaceType: 'MY', location: 'UNASSIGNED',
  })).result.items.some(item => item.projectId === canvas.result.projectId), true);
  assert.equal((await call(api, '/gw/storyboard/imagePreset/list', {
    presetType: 0, location: 110,
  })).result.items.find(item => item.id === imagePreset.result.id).name,
  '本地摄影风格');
  assert.equal((await call(api, '/gw/storyboard/imagePreset/delete', {
    id: imagePreset.result.id,
  })).code, 0);
  assert.equal((await call(api, '/gw/storyboard/imagePreset/list', {
    presetType: 0, location: 110,
  })).result.total, 1);
  const restoredShot = (await call(api, '/gw/storyboard/api/list', { seriesId })).result.items[0];
  assert.equal(restoredShot.produceType, 2);
  assert.equal(restoredShot.imageList[0], '/local-upload/image/test.png');
  assert.equal((await call(api, '/gw/storyboard/series/getSeries', { projectId }))
    .result.items[0].isDetailed, 1);
  assert.equal((await call(api, '/gw/storyboard/api/projectHistoryList', {
    projectId,
  })).result.total, 3);
  assert.equal((await call(api, '/gw/storyboard/api/libraryHistoryList', {
    projectId, libraryId: syncSource.result.id, type: 1,
  })).result.items.some(item =>
    item.id > 0 && item.resourceUrl === '/local-upload/image/test3.png'), true);
  assert.equal((await call(api, '/gw/storyboard/api/projectLibraryList', {
    projectId: targetProjectId,
  })).result.total, 1);
  const copied = await call(api, '/gw/storyboard/project/copyProject', { projectId });
  assert.equal(copied.code, 0);
  assert.equal((await call(api, '/gw/storyboard/project/getDirectorCon', {
    projectId: copied.result.id,
  })).result.items[0].configJson.version, 2);
  assert.equal((await call(api, '/gw/storyboard/project/deleteDirectorCon', {
    id: director.result.id, projectId,
  })).code, 0);
  assert.equal((await call(api, '/gw/storyboard/project/getDirectorCon', {
    projectId,
  })).result.totalCount, 0);
  const copiedSeries = (await call(api, '/gw/storyboard/series/getSeries', {
    projectId: copied.result.id,
  })).result.items[0];
  const copiedShot = (await call(api, '/gw/storyboard/api/list', {
    seriesId: copiedSeries.id,
  })).result.items[0];
  const copiedProjectAssets = await call(api, '/gw/storyboard/api/projectLibraryList', {
    projectId: copied.result.id, type: 1,
  });
  const copiedSyncSource = copiedProjectAssets.result.items.find(item =>
    item.name === '待同步角色');
  assert.equal((await call(api, '/gw/storyboard/api/libraryHistoryList', {
    projectId: copied.result.id, libraryId: copiedSyncSource.id, type: 1,
  })).result.items.some(item =>
    item.id > 0 && item.resourceUrl === '/local-upload/image/test3.png'), true);
  assert.equal(copiedProjectAssets.result.items.find(item =>
    item.parentResourceId === parentAsset.result.id).images[0].resourceUrl[0],
  '/local-upload/image/test.png');
  assert.equal((await call(api, '/gw/storyboard/api/historyList', {
    storyBoardId: copiedShot.id,
  })).result.items.length, 2);
  assert.equal((await call(api, '/gw/storyboard/api/projectHistoryList', {
    projectId: copied.result.id,
  })).result.total, 3);
  const beforeAppearanceEdit = (await call(api, '/gw/storyboard/api/projectLibraryList', {
    projectId, type: 1,
  })).result.items.find(item => item.id === syncSource.result.id);
  const editedAppearance = await call(api, '/gw/storyboard/api/updateProjectLibrary', {
    id: syncSource.result.id, projectId, name: '待同步角色已编辑',
    images: [...beforeAppearanceEdit.images, {
      name: '页面新增形象', isMain: 0,
      resourceUrl: [`http://127.0.0.1:4175/local-upload/image/test3.png`],
      referenceImages: [`http://127.0.0.1:4175/local-upload/image/test.png`],
    }],
  });
  assert.equal(editedAppearance.code, 0);
  const newAppearance = editedAppearance.result.images.find(image =>
    image.name === '页面新增形象');
  assert.ok(Number(newAppearance.id) > 0);
  assert.equal(newAppearance.projectLibraryId, syncSource.result.id);
  assert.equal(newAppearance.resourceUrl[0], '/local-upload/image/test3.png');
  assert.equal(newAppearance.referenceImages[0], '/local-upload/image/test.png');
  assert.equal((await call(api, '/gw/storyboard/api/updateProjectLibrary', {
    id: syncSource.result.id, projectId,
    images: [{ id: 9999999, name: '其他素材形象' }],
  })).code, 400);
  assert.equal((await call(api, '/gw/storyboard/api/setMainImage', {
    id: newAppearance.id,
  })).code, 0);
  api = (await import(`${moduleUrl}?reload=3`)).handleLocalApi;
  const persistedAppearance = (await call(api, '/gw/storyboard/api/projectLibraryList', {
    projectId, type: 1,
  })).result.items.find(item => item.id === syncSource.result.id)
    .images.find(image => image.id === newAppearance.id);
  assert.equal(persistedAppearance.resourceUrl[0], '/local-upload/image/test3.png');
  assert.equal(persistedAppearance.isMain, 1);
  await call(api, '/gw/storyboard/series/deleteSeries', { id: seriesId });
  assert.equal((await call(api, '/gw/storyboard/api/historyList', {
    storyBoardId: shot.result.id,
  })).result.items.length, 0);
  assert.equal((await call(api, '/gw/storyboard/api/projectHistoryList', {
    projectId,
  })).result.total, 0);
  console.log('项目素材、历史、音色、画布文件夹、图片预设、导演台及分镜的本地持久化检查通过');
} finally {
  if (originalDataPath === undefined) delete process.env.JZZM_LOCAL_DATA;
  else process.env.JZZM_LOCAL_DATA = originalDataPath;
  const safeRoot = resolve(tmpdir()) + sep;
  if (!resolve(testRoot).startsWith(safeRoot)) throw Error('测试目录超出临时目录');
  await rm(testRoot, { recursive: true, force: true });
}
