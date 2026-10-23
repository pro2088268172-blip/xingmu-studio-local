import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describeSeriesMedia, prepareSeriesExport } from './local-export.mjs';

const dataPath = process.env.JZZM_LOCAL_DATA || join(import.meta.dirname, 'local-data.json');
const empty = () => ({ nextId: 1000, projects: [], series: [], shots: [], shotHistory: [], projectHistory: [],
  libraryHistory: [], directorConfigs: [], imagePresets: [], voices: [],
  folders: [], library: [], resources: [], looseResources: [], canvasProjects: [], canvasFolders: [] });
let data = empty();
let hasSavedImagePresets = false;
if (existsSync(dataPath)) {
  try {
    const stored = JSON.parse(readFileSync(dataPath, 'utf8'));
    hasSavedImagePresets = Array.isArray(stored.imagePresets);
    data = { ...empty(), ...stored };
  }
  catch { /* Preserve the unreadable file; start with an empty in-memory state. */ }
}
data.series = data.series.map(series => ({
  timeDuration: 0, totalStoryBoardCount: 0, completedStoryBoardCount: 0, ...series,
}));
data.projects = data.projects.map(project => ({ userId: 1, ...project }));
data.shots = data.shots.map((shot, index) => ({
  boardIndex: index + 1, name: `分镜${index + 1}`, shotTitle: `分镜${index + 1}`,
  produceType: 1, duration: 2, imageList: [], videoList: [],
  imagePrompt: '', videoPrompt: '', ...shot,
}));
data.canvasProjects ||= [];
data.canvasFolders ||= [];
data.canvasDocuments ||= {};
data.resources ||= [];
data.looseResources ||= [];
data.shotHistory ||= [];
data.projectHistory ||= [];
data.libraryHistory ||= [];
data.directorConfigs ||= [];
data.imagePresets ||= [];
data.voices ||= [];
if (!hasSavedImagePresets) data.imagePresets.push({ id: ++data.nextId,
  name: '电影级人像摄影', prefixPrompt: '人物质感自然，采用柔和侧光与电影调色',
  suffixPrompt: '保留真实皮肤纹理与画面细节', type: 99, location: 110,
  available: 1, sortOrder: 0, createTime: new Date().toISOString(),
  updateTime: new Date().toISOString() });
data.artStyles ||= [];
data.scripts ||= [];
data.structuredDocuments ||= {};
const defaultArtStyle = { id: 1, name: '通用画风', prompt: '按分镜描述绘制画面',
  description: '本地项目默认画风', imageUrl: '', category: 'local' };
const localModels = [
  { eid: 'local-image-unconfigured', name: '本地生图模型（待接入）',
    vendorGroupCode: 'local', vendorGroupAlias: '本地服务',
    modelGroupCode: 'image', modelGroupAlias: '图片生成', endpointMode: 2 },
  { eid: 'local-video-unconfigured', name: '本地视频模型（待接入）',
    vendorGroupCode: 'local', vendorGroupAlias: '本地服务',
    modelGroupCode: 'video', modelGroupAlias: '视频生成',
    resolutionGroupAlias: '720P', endpointMode: 5 },
];
const localVoice = { id: 1, name: '本地音色（待接入）', voiceId: 'local-voice-unconfigured',
  category: 1, provider: 'local', language: 'zh', status: 1, avatarUrl: '' };
const localUploadUrl = value => {
  if (typeof value !== 'string') return value;
  let pathname = value;
  if (/^https?:\/\//i.test(value)) {
    try { pathname = new URL(value).pathname; }
    catch { return value; }
  }
  if (pathname.startsWith('local-upload/')) pathname = `/${pathname}`;
  return /^\/local-upload\/[A-Za-z0-9_./-]+$/.test(pathname) && !pathname.includes('..')
    ? pathname : value;
};
const localMediaList = values => Array.isArray(values) ? values.map(value =>
  typeof value === 'string' ? localUploadUrl(value) :
    value && typeof value === 'object' ? { ...value,
      url: localUploadUrl(value.url), resourceUrl: localUploadUrl(value.resourceUrl) } : value) : values;
const shotMediaUrls = values => Array.isArray(values) ? values.map(value =>
  typeof value === 'string' ? value : value?.url || value?.resourceUrl ||
    value?.imageUrl || value?.videoUrl).filter(value => typeof value === 'string' && value)
  .map(localUploadUrl) : [];
const uploadedFile = (value, category, extensions) => {
  const pathname = localUploadUrl(value);
  const pattern = new RegExp(`^/local-upload/${category}/[A-Za-z0-9_-]+\\.(${extensions.join('|')})$`, 'i');
  if (typeof pathname !== 'string' || !pattern.test(pathname)) return null;
  const absolute = join(import.meta.dirname, pathname.slice(1));
  return existsSync(absolute) ? { pathname, absolute } : null;
};
const localResourceImage = value => {
  const pathname = localUploadUrl(value);
  if (typeof pathname !== 'string' ||
      !/^\/local-upload\/[A-Za-z0-9_./-]+\.(png|jpe?g|webp|avif)$/i.test(pathname) ||
      pathname.includes('..')) return null;
  return existsSync(join(import.meta.dirname, pathname.slice(1))) ? pathname : null;
};
const localResourceMedia = value => {
  const pathname = localUploadUrl(value);
  if (typeof pathname !== 'string' ||
      !/^\/local-upload\/[A-Za-z0-9_./-]+\.(png|jpe?g|webp|avif|mp3|wav|aac|m4a|mp4)$/i.test(pathname) ||
      pathname.includes('..')) return null;
  return existsSync(join(import.meta.dirname, pathname.slice(1))) ? pathname : null;
};
const parseSrt = source => {
  const blocks = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
  if (!blocks.length) throw Error('SRT 文件为空');
  if (blocks.length > 1000) throw Error('SRT 字幕超过本地支持的 1000 条上限');
  const cues = blocks.map((block, index) => {
    const lines = block.split('\n');
    const times = lines[1]?.match(/^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})$/);
    if (!times || !lines[0]?.trim()) throw Error(`第 ${index + 1} 条字幕格式错误`);
    const milliseconds = value => {
      const [hours, minutes, seconds, fraction] = value.split(/[:,.]/).map(Number);
      if (minutes > 59 || seconds > 59) throw Error(`第 ${index + 1} 条字幕时间格式错误`);
      return ((hours * 60 + minutes) * 60 + seconds) * 1000 + fraction;
    };
    const startMs = milliseconds(times[1]);
    const endMs = milliseconds(times[2]);
    const text = lines.slice(2).join('\n').trim();
    if (!text) throw Error(`第 ${index + 1} 条字幕缺少内容`);
    if (endMs <= startMs) throw Error(`第 ${index + 1} 条字幕结束时间必须晚于开始时间`);
    return { index: index + 1, startMs, endMs,
      startTime: times[1].replace('.', ','), endTime: times[2].replace('.', ','), text };
  });
  for (let index = 0; index < cues.length - 1; index++) {
    const current = cues[index];
    const next = cues[index + 1];
    const gap = next.startMs - current.endMs;
    if (gap > 700) throw Error(`第 ${index + 1} 与 ${index + 2} 条字幕之间超过 700ms`);
    if (gap < 0) throw Error(`第 ${index + 1} 与 ${index + 2} 条字幕时间重叠`);
    if (gap > 0) {
      current.endMs = next.startMs;
      current.endTime = next.startTime;
    }
  }
  return cues;
};
for (const project of data.projects) if (project.scriptUrl)
  project.scriptUrl = localUploadUrl(project.scriptUrl);
for (const series of data.series) {
  series.subtitleFiles = localMediaList(series.subtitleFiles);
  series.dubbingFiles = localMediaList(series.dubbingFiles);
}
for (const shot of data.shots) {
  shot.imageList = shotMediaUrls(shot.imageList);
  shot.videoList = shotMediaUrls(shot.videoList);
}
for (const history of data.shotHistory) {
  history.imageList = shotMediaUrls(history.imageList);
  history.videoList = shotMediaUrls(history.videoList);
}
for (const script of data.scripts) if (script.remoteUrl)
  script.remoteUrl = localUploadUrl(script.remoteUrl);
for (const item of data.library) for (const image of item.images || []) {
  image.resourceUrl = Array.isArray(image.resourceUrl)
    ? image.resourceUrl.map(localUploadUrl) : localUploadUrl(image.resourceUrl);
}
for (const item of data.resources) for (const image of item.characterResources || []) {
  image.resourceUrl = Array.isArray(image.resourceUrl)
    ? image.resourceUrl.map(localUploadUrl) : localUploadUrl(image.resourceUrl);
}
const renumberShots = seriesId => {
  const shots = data.shots.filter(shot => shot.seriesId === seriesId);
  shots.forEach((shot, index) => { shot.boardIndex = index + 1; });
  const series = data.series.find(item => item.id === seriesId);
  if (series) {
    series.totalStoryBoardCount = shots.length;
    series.timeDuration = shots.reduce((seconds, shot) => seconds + (Number(shot.duration) > 0 ? Number(shot.duration) : 2), 0);
  }
};
for (const series of data.series) renumberShots(series.id);

const nextId = () => ++data.nextId;
const personalTargetForLibrary = library => data.resources.find(resource =>
  resource.source === 'private' && resource.sourceProjectLibraryId === library.id) ||
  data.resources.find(resource => resource.source === 'private' &&
    resource.type === library.type && resource.name === library.name);
const localLibraryImages = (library, selectedIds = null) => (library.images || [])
  .filter(image => selectedIds === null || selectedIds.has(Number(image.id)))
  .map(image => ({ image,
  url: localResourceImage(Array.isArray(image.resourceUrl)
    ? image.resourceUrl[0] : image.resourceUrl) })).filter(item => item.url);
const recordLibraryHistory = (library, image) => {
  const resourceUrl = localResourceImage(Array.isArray(image.resourceUrl)
    ? image.resourceUrl[0] : image.resourceUrl);
  if (!resourceUrl || data.libraryHistory.some(entry =>
    entry.libraryId === library.id && entry.imageId === image.id &&
    entry.resourceUrl === resourceUrl)) return;
  const id = nextId();
  data.libraryHistory.push({ id, libraryHistoryId: id, libraryId: library.id,
    projectId: library.projectId, seriesId: library.seriesId || null,
    imageId: image.id, type: library.type, name: image.name || library.name,
    resourceUrl, createAt: new Date().toISOString() });
};
const recordShotHistory = (shot, type) => {
  const id = nextId();
  const entry = { id, storyBoardHistoryId: id, storyBoardId: shot.id,
    seriesId: shot.seriesId, projectId: shot.projectId, type, historyType: type,
    produceType: shot.produceType, name: shot.name,
    imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt,
    originText: shot.originText,
    imageList: structuredClone(shot.imageList || []),
    videoList: structuredClone(shot.videoList || []),
    audioList: structuredClone(shot.audioList || []),
    createAt: new Date().toISOString(), createTime: new Date().toISOString() };
  data.shotHistory.push(entry);
  const history = data.shotHistory.filter(item => item.storyBoardId === shot.id);
  if (history.length > 50) {
    const expired = new Set(history.slice(0, history.length - 50).map(item => item.id));
    data.shotHistory = data.shotHistory.filter(item => !expired.has(item.id));
  }
  return entry;
};
const save = () => {
  const temporary = `${dataPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2));
  renameSync(temporary, dataPath);
};
const ok = result => ({ code: 0, result });
const okStrict = result => ({ code: '0', result });
const unsupported = name => ({ code: 501, msg: `${name}需要本地生成服务，当前尚未接入` });
const list = (items, payload = {}) => {
  const page = Math.max(1, Number(payload.page || 1));
  const size = Math.max(1, Number(payload.size || 20));
  const pageItems = items.slice((page - 1) * size, page * size);
  return { items: pageItems, list: pageItems, total: items.length,
    totalCount: items.length, page, size };
};
const createProject = (body, modeType) => {
  const projectId = nextId();
  const seriesId = modeType === 0 ? null : nextId();
  const name = String(body.name || '未命名项目').trim();
  const now = new Date().toISOString();
  const project = { ...body, id: projectId, projectId, userId: 1,
    name, title: name, dramaName: name, modeType,
    proportion: body.proportion || '9:16', progress: 0,
    createTime: now, createdAt: now, updateTime: now, updatedAt: now };
  if (body.scriptUrl) project.scriptUrl = localUploadUrl(body.scriptUrl);
  data.projects.push(project);
  if (seriesId) data.series.push({ id: seriesId, seriesId, projectId, name: '第1集',
    title: '第1集', sort: 1, timeDuration: 0,
    totalStoryBoardCount: 0, completedStoryBoardCount: 0 });
  save();
  return { project, seriesId };
};
const canvasProjectView = project => ({
  ...project,
  projectId: project.projectId,
  creatorUserId: 1,
  spaceType: 'MY',
  readOnly: false,
  canMoveInCurrentSpace: true,
  capabilities: {
    canRead: true, canEdit: true, canRename: true, canDelete: true, canUpdateCover: true,
    canMove: true, canCopy: true, canShare: false,
  },
});
const canvasFolderView = folder => ({ ...folder, canManage: true,
  projectCount: data.canvasProjects.filter(project => project.folderId === folder.id).length });
const canvasDocumentFor = (projectId, projectUuid) => {
  const key = String(projectId);
  data.canvasDocuments[key] ||= {
    canvas: { projectId, projectUuid, viewport: { x: 0, y: 0, zoom: 1 },
      canvasVersion: 0, nodeCount: 0, edgeCount: 0, updatedAt: new Date().toISOString() },
    nodes: [], edges: [], businessData: {}, bootstrap: {}, changes: [],
  };
  data.canvasDocuments[key].changes ||= [];
  return data.canvasDocuments[key];
};
const canvasNodeView = node => ({ ...node, ...node.layout });
const structuredDocument = (raw, projectId) => ({
  schemaVersion: 1,
  language: raw.language === 'en' ? 'en' : 'zh',
  outline: { id: `outline-${projectId}`, revision: 1, content: String(raw.outline || '') },
  characterProfiles: { id: `characters-${projectId}`, revision: 1,
    content: String(raw.characterProfiles || '') },
  openingHook: { id: `opening-hook-${projectId}`, revision: 1,
    location: String(raw.openingHook?.location || ''),
    timeOfDay: raw.openingHook?.timeOfDay || null,
    space: raw.openingHook?.space || null,
    content: String(raw.openingHook?.content || '') },
  episodes: (Array.isArray(raw.episodes) ? raw.episodes : []).map((episode, index) => ({
    id: `episode-${projectId}-${index + 1}`, revision: 1,
    episodeNumber: Number(episode.episodeNumber) || index + 1,
    episodeTitle: String(episode.episodeTitle || ''),
    scenes: (Array.isArray(episode.scenes) ? episode.scenes : []).map((scene, sceneIndex) => ({
      id: `scene-${projectId}-${index + 1}-${sceneIndex + 1}`, revision: 1,
      sceneNumber: Number(scene.sceneNumber) || sceneIndex + 1,
      location: String(scene.location || ''), timeOfDay: scene.timeOfDay || null,
      space: scene.space || null, content: String(scene.content || ''),
    })),
  })),
});
const structuredView = (entry, sceneId) => {
  const scenes = entry.document.episodes.flatMap(episode => episode.scenes);
  return { ...entry, selectedScene: scenes.find(scene => scene.id === sceneId) || scenes[0] || null };
};
const structuredSnapshot = entry => ({ ...entry, document: {
  ...entry.document,
  outline: entry.document.outline.content,
  characterProfiles: entry.document.characterProfiles.content,
} });
const structuredOwner = (entityId, req, select) => {
  const refererProjectId = Number(String(req.headers.referer || '').match(/\/projects\/(\d+)/)?.[1]);
  const entries = refererProjectId && data.structuredDocuments[String(refererProjectId)]
    ? [data.structuredDocuments[String(refererProjectId)]]
    : Object.values(data.structuredDocuments);
  const matches = entries.map(entry => ({ entry, entity: select(entry.document, entityId) }))
    .filter(item => item.entity);
  return matches.length === 1 ? matches[0] : null;
};
const updateStructuredEntity = (entry, entity, body, fields) => {
  if (Number(body.expectedRevision) !== Number(entity.revision))
    return { code: 409, msg: '剧本文档已被其他编辑更新' };
  for (const field of fields) if (field in body) entity[field] = body[field];
  entity.revision += 1;
  entry.revision += 1;
  entry.updatedAt = new Date().toISOString();
  save();
  return okStrict({ revision: entry.revision, entityRevision: entity.revision });
};
const mutateStructuredDocument = (entry, expectedRevision, mutate, state = 'editing') => {
  if (!entry) return { code: 404, msg: '剧本文档不存在' };
  if (Number(expectedRevision) !== Number(entry.revision))
    return { code: 409, msg: '剧本文档已被其他编辑更新' };
  const error = mutate(entry.document);
  if (error) return { code: 400, msg: error };
  entry.revision += 1;
  entry.state = state;
  entry.updatedAt = new Date().toISOString();
  save();
  return okStrict(structuredView(entry));
};

export async function handleLocalApi(req, res, pathname) {
  let body = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 20 * 1024 * 1024) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    if (chunks.length) {
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { body = {}; }
    }
  }
  const path = pathname.replace(/^\/gw/, '');
  const id = Number(body.id ?? body.projectId ?? body.seriesId);
  let result;

  switch (path) {
    case '/user/api/getUserInfo':
      result = ok({ userId: 1, nickName: '本地用户', userName: '本地用户', mobile: '', orgId: '', teamId: '' });
      break;
    case '/user/resource/getOssToken':
      result = ok({ bucketName: 'local-upload', token: 'local-only' });
      break;
    case '/assets/resource/getParentResource':
    case '/user/resource/getParentResource': {
      const search = String(body.like || body.name || '').trim().toLowerCase();
      const source = String(body.source || 'private');
      let resources = [...data.resources].reverse().filter(item => item.source === source);
      if (body.type) resources = resources.filter(item => item.type === Number(body.type));
      if (search) resources = resources.filter(item =>
        `${item.name} ${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase().includes(search));
      if (Number(body.isStar) === 1) resources = resources.filter(item => item.isStar);
      if (Number(body.isStar) === 2) resources = resources.filter(item => !item.isStar);
      result = ok(list(resources, { ...body, size: body.size || body.pageSize || 30 }));
      break;
    }
    case '/user/resource/getResource': {
      const search = String(body.like || body.name || '').trim().toLowerCase();
      let resources = [...data.looseResources].reverse();
      if (Number(body.type) > 0)
        resources = resources.filter(item => item.type === Number(body.type));
      if (body.source) resources = resources.filter(item => item.source === body.source);
      if (Number(body.isStar) === 1) resources = resources.filter(item => item.isStar);
      if (Number(body.isStar) === 2) resources = resources.filter(item => !item.isStar);
      if (search) resources = resources.filter(item =>
        `${item.name} ${item.description || ''}`.toLowerCase().includes(search));
      result = ok(list(resources, { ...body, size: body.size || body.pageSize || 30 }));
      break;
    }
    case '/assets/resource/createParentResource': {
      const parentId = nextId();
      const images = (Array.isArray(body.characterResources) ? body.characterResources : []).map(image => ({
        ...image, id: nextId(), parentResourceId: parentId,
        resourceUrl: localUploadUrl(image.resourceUrl),
      }));
      const resource = { ...body, id: parentId, source: String(body.source || 'private'),
        type: Number(body.type || 1), name: String(body.name || '未命名资产'),
        characterResources: images,
        mainResourceId: images.find(image => image.isMain)?.id || images[0]?.id || null,
        isStar: false,
        createTime: new Date().toISOString(), updateTime: new Date().toISOString() };
      data.resources.push(resource);
      save();
      result = ok(resource);
      break;
    }
    case '/user/resource/createResourceFromLocalFile':
    case '/user/resource/createResource': {
      const type = Number(body.type ?? 1);
      const grouped = [1, 2, 3].includes(type);
      const url = grouped ? localResourceImage(body.resourceUrl) : localResourceMedia(body.resourceUrl);
      if (!url) { result = { code: 400, msg: '请先上传本地素材文件' }; break; }
      const now = new Date().toISOString();
      const name = String(body.name || '未命名资产').trim() || '未命名资产';
      if (!grouped) {
        const resource = { ...body, id: nextId(), type, source: 'private',
          resourceUrl: url, name, isStar: false, createTime: now, updateTime: now };
        data.looseResources.push(resource);
        save();
        result = ok(resource);
        break;
      }
      const parentId = nextId();
      const imageId = nextId();
      const image = { ...body, id: imageId, parentResourceId: parentId,
        resourceUrl: url, name, isMain: true, createTime: now, updateTime: now };
      const resource = { id: parentId, source: 'private', type,
        name, description: String(body.description || ''), tags: body.tags || [],
        mainResourceId: imageId, characterResources: [image], isStar: false,
        isHidden: false, createTime: now, updateTime: now };
      data.resources.push(resource);
      save();
      result = ok(image);
      break;
    }
    case '/assets/resource/updateParentResource': {
      const resource = data.resources.find(item => item.id === id);
      if (resource) {
        const { characterResources, ...fields } = body;
        Object.assign(resource, fields, { id: resource.id, updateTime: new Date().toISOString() });
        if (Array.isArray(characterResources)) resource.characterResources = characterResources.map(image => ({
          ...image, id: image.id || nextId(), parentResourceId: resource.id,
          resourceUrl: localUploadUrl(image.resourceUrl),
        }));
        save();
      }
      result = ok(resource || null);
      break;
    }
    case '/assets/resource/deleteParentResource': {
      const ids = new Set((Array.isArray(body.ids) ? body.ids : [id]).map(Number));
      data.resources = data.resources.filter(item => !ids.has(item.id));
      save();
      result = ok(true);
      break;
    }
    case '/user/resource/deleteResource':
    case '/assets/resource/deleteParentSubResource': {
      const ids = new Set((Array.isArray(body.ids) ? body.ids : [body.id || body.resourceId])
        .map(Number).filter(Number.isSafeInteger));
      let changed = false;
      const emptyParents = new Set();
      for (const resource of data.resources) {
        const images = resource.characterResources || [];
        const remaining = images.filter(image => !ids.has(image.id));
        if (remaining.length === images.length) continue;
        resource.characterResources = remaining;
        if (!remaining.length) emptyParents.add(resource.id);
        if (ids.has(resource.mainResourceId)) {
          resource.mainResourceId = remaining[0]?.id || null;
          for (const image of remaining) image.isMain = image.id === resource.mainResourceId;
        }
        resource.updateTime = new Date().toISOString();
        changed = true;
      }
      data.resources = data.resources.filter(resource =>
        !ids.has(resource.id) && !emptyParents.has(resource.id));
      data.looseResources = data.looseResources.filter(resource => !ids.has(resource.id));
      if (changed || ids.size) save();
      result = ok(true);
      break;
    }
    case '/assets/resource/updateParentSubResource':
    case '/user/resource/updateResource': {
      const imageId = Number(body.id || body.resourceId);
      const loose = data.looseResources.find(item => item.id === imageId);
      if (loose) {
        const resourceUrl = body.resourceUrl === undefined ? loose.resourceUrl
          : localResourceMedia(Array.isArray(body.resourceUrl) ? body.resourceUrl[0] : body.resourceUrl);
        if (!resourceUrl) { result = { code: 400, msg: '本地素材文件不存在' }; break; }
        Object.assign(loose, body, { id: imageId, resourceUrl,
          updateTime: new Date().toISOString() });
        save();
        result = ok(loose);
        break;
      }
      const parent = data.resources.find(resource =>
        resource.characterResources?.some(image => image.id === imageId));
      const image = parent?.characterResources.find(item => item.id === imageId);
      if (!image) { result = { code: 404, msg: '资产图片不存在' }; break; }
      const resourceUrl = body.resourceUrl === undefined ? image.resourceUrl
        : localResourceImage(Array.isArray(body.resourceUrl) ? body.resourceUrl[0] : body.resourceUrl);
      if (!resourceUrl) { result = { code: 400, msg: '本地图片文件不存在' }; break; }
      Object.assign(image, body, { id: imageId, parentResourceId: parent.id,
        resourceUrl, updateTime: new Date().toISOString() });
      parent.updateTime = image.updateTime;
      save();
      result = ok(image);
      break;
    }
    case '/user/resource/updateResourceName': {
      const resourceId = Number(body.id || body.resourceId);
      const loose = data.looseResources.find(item => item.id === resourceId);
      const parent = data.resources.find(item => item.id === resourceId ||
        item.characterResources?.some(image => image.id === resourceId));
      const resource = loose || parent?.characterResources?.find(image => image.id === resourceId) || parent;
      if (!resource) { result = { code: 404, msg: '资产不存在' }; break; }
      const name = String(body.name || '').trim();
      if (!name) { result = { code: 400, msg: '资产名称不能为空' }; break; }
      resource.name = name;
      resource.updateTime = new Date().toISOString();
      if (parent && resource !== parent) parent.updateTime = resource.updateTime;
      save();
      result = ok(resource);
      break;
    }
    case '/user/resource/updateParentResourceName': {
      const resource = data.resources.find(item => item.id === Number(body.id || body.parentResourceId));
      if (!resource) { result = { code: 404, msg: '资产不存在' }; break; }
      const name = String(body.name || '').trim();
      if (!name) { result = { code: 400, msg: '资产名称不能为空' }; break; }
      resource.name = name;
      resource.updateTime = new Date().toISOString();
      save();
      result = ok(resource);
      break;
    }
    case '/assets/resource/setParentResourceHidden':
    case '/assets/resource/setParentResourceVisibleScope': {
      const resource = data.resources.find(item => item.id === Number(body.id || body.parentResourceId));
      if (!resource) { result = { code: 404, msg: '资产不存在' }; break; }
      if (path.endsWith('Hidden')) resource.isHidden = Boolean(body.isHidden);
      else resource.visibleScope = body.visibleScope;
      resource.updateTime = new Date().toISOString();
      save();
      result = ok({ item: resource });
      break;
    }
    case '/user/resource/parentFavorites': {
      const resource = data.resources.find(item => item.id === Number(body.id || body.parentResourceId));
      if (!resource) { result = { code: 404, msg: '资产不存在' }; break; }
      resource.isStar = body.isStar === undefined ? !resource.isStar : Boolean(body.isStar);
      resource.updateTime = new Date().toISOString();
      save();
      result = ok(resource);
      break;
    }
    case '/user/resource/getResourceInfo': {
      const resourceId = Number(body.resourceId || body.id);
      result = ok(data.looseResources.find(item => item.id === resourceId) ||
        data.resources.find(item => item.id === resourceId ||
          item.characterResources?.some(image => image.id === resourceId)) || null);
      break;
    }
    case '/user/resource/starResource': {
      const resource = data.resources.find(item => item.id === id) ||
        data.looseResources.find(item => item.id === id);
      if (resource) { resource.isStar = !resource.isStar; save(); }
      result = ok(resource || null);
      break;
    }
    case '/user/resource/updateParentMainResource': {
      const resource = data.resources.find(item => item.id === Number(body.parentId || body.parentResourceId || body.id));
      if (resource) {
        const imageId = Number(body.resourceId || body.subResourceId || body.characterResourceId);
        if (!resource.characterResources?.some(image => image.id === imageId)) {
          result = { code: 404, msg: '主形象图片不存在' };
          break;
        }
        for (const image of resource.characterResources || []) image.isMain = image.id === imageId;
        resource.mainResourceId = imageId;
        resource.updateTime = new Date().toISOString();
        save();
      }
      result = ok(resource || null);
      break;
    }
    case '/storyboard/artstyle/listPublic':
    case '/storyboard/artstyle/list': {
      const styles = path.endsWith('listPublic')
        ? [defaultArtStyle, ...data.artStyles]
        : data.artStyles;
      result = ok(list(styles, { ...body, size: body.size || 30 }));
      break;
    }
    case '/storyboard/artstyle/create': {
      const name = String(body.name || '').trim();
      const prompt = String(body.prompt || '').trim();
      if (!name || !prompt) { result = { code: 400, msg: '画风名称和描述不能为空' }; break; }
      const style = { ...body, id: nextId(), name, prompt,
        description: prompt, imageUrl: '', category: 'local',
        createTime: new Date().toISOString() };
      data.artStyles.push(style);
      save();
      result = ok(style);
      break;
    }
    case '/storyboard/artstyle/update': {
      const style = data.artStyles.find(item => item.id === id);
      if (!style) { result = { code: 404, msg: '画风不存在' }; break; }
      Object.assign(style, body, { id: style.id });
      save();
      result = ok(style);
      break;
    }
    case '/storyboard/artstyle/delete': {
      const index = data.artStyles.findIndex(item => item.id === id);
      if (index < 0) { result = { code: 404, msg: '画风不存在' }; break; }
      data.artStyles.splice(index, 1);
      save();
      result = ok(true);
      break;
    }
    case '/storyboard/endpoint/list': {
      const modes = Array.isArray(body.endpointModes) ? body.endpointModes.map(Number) : [];
      const items = localModels.filter(model =>
        modes.length === 0 || modes.includes(model.endpointMode) ||
        model.endpointMode === 2 && modes.includes(1) ||
        model.endpointMode === 5 && modes.includes(3)).map(model =>
          model.endpointMode === 5 && modes.includes(3) && !modes.includes(5)
            ? { ...model, endpointMode: 3 } : model);
      result = ok({ items, total: items.length, totalCount: items.length });
      break;
    }
    case '/storyboard/voiceTone/list': {
      const items = body.provider === 'douge' ? [] : [localVoice];
      result = ok(list(items, body));
      break;
    }
    case '/storyboard/voiceTone/listMine':
      result = ok(list([...data.voices].reverse(), body));
      break;
    case '/storyboard/voiceTone/createMine': {
      const name = String(body.name || '').trim();
      const voiceUrl = localResourceMedia(body.voiceUrl);
      if (!name || !voiceUrl || !/\.(mp3|wav|aac|m4a)$/i.test(voiceUrl)) {
        result = { code: 400, msg: '音色名称或本地音频文件无效' };
        break;
      }
      const id = nextId();
      const voice = { id, voiceId: `local-custom-${id}`, name, voiceUrl,
        duration: Number(body.duration) || null,
        provider: 'custom', category: 1, language: 'zh',
        isDefault: 0, status: 1, createTime: new Date().toISOString() };
      data.voices.push(voice);
      save();
      result = ok(voice);
      break;
    }
    case '/storyboard/voiceTone/updateMine': {
      const voice = data.voices.find(item => item.id === Number(body.id));
      if (!voice) { result = { code: 404, msg: '自定义音色不存在' }; break; }
      const name = body.name === undefined ? voice.name : String(body.name).trim();
      const voiceUrl = body.voiceUrl === undefined ? voice.voiceUrl :
        localResourceMedia(body.voiceUrl);
      if (!name || !voiceUrl || !/\.(mp3|wav|aac|m4a)$/i.test(voiceUrl)) {
        result = { code: 400, msg: '音色名称或本地音频文件无效' };
        break;
      }
      voice.name = name;
      voice.voiceUrl = voiceUrl;
      voice.updateTime = new Date().toISOString();
      save();
      result = ok(voice);
      break;
    }
    case '/storyboard/voiceTone/deleteMine': {
      const index = data.voices.findIndex(item => item.id === Number(body.id));
      if (index < 0) { result = { code: 404, msg: '自定义音色不存在' }; break; }
      data.voices.splice(index, 1);
      save();
      result = ok(true);
      break;
    }
    case '/storyboard/voiceTone/detailAll': {
      const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
      const items = [...(ids.includes(localVoice.id) ? [localVoice] : []),
        ...data.voices.filter(voice => ids.includes(voice.id))];
      result = ok({ items, totalCount: items.length });
      break;
    }
    case '/storyboard/voiceTone/detail': {
      const voice = data.voices.find(item => item.id === id) ||
        (id === localVoice.id ? localVoice : null);
      result = voice ? ok(voice) : { code: 404, msg: '音色不存在' };
      break;
    }
    case '/storyboard/project/getIndex':
    case '/storyboard/project/getProjects':
    case '/storyboard/project/getAllProjects':
    case '/storyboard/project/getProjectLibraryProjects':
    case '/storyboard/project/getMyCreatedProjects':
    case '/storyboard/project/getUserProjects':
    case '/storyboard/project/getAssetImportProjects':
      {
        let projects = [...data.projects].reverse();
        if (body.modeType !== undefined && body.modeType !== null)
          projects = projects.filter(project => project.modeType === Number(body.modeType));
        if (body.flag !== undefined && body.flag !== null)
          projects = projects.filter(project => Number(project.flag || 0) === Number(body.flag));
        if (body.folderId) projects = projects.filter(project => project.folderId === Number(body.folderId));
        if (body.search) projects = projects.filter(project =>
          project.name.toLowerCase().includes(String(body.search).trim().toLowerCase()));
        result = ok(list(projects, body));
      }
      break;
    case '/storyboard/project/getTeamProjects':
    case '/storyboard/project/getMyManageProjects':
    case '/storyboard/project/getMyCooperatingProjects':
      result = ok(list([], body));
      break;
    case '/storyboard/project/checkUserProjectName': {
      const name = String(body.Name || body.name || '').trim();
      const duplicate = data.projects.some(project =>
        project.name === name && project.id !== Number(body.projectId || body.id));
      result = duplicate ? { code: 400, msg: '项目名称已存在，请更换其他名称' } : ok(true);
      break;
    }
    case '/storyboard/project/createProject': {
      const modeType = [0, 1, 2, 3].includes(Number(body.modeType)) ? Number(body.modeType) : 0;
      const { project } = createProject(body, modeType);
      result = ok(project);
      break;
    }
    case '/storyboard/project/createTextProject': {
      const { project } = createProject(body, 1);
      result = ok(project);
      break;
    }
    case '/storyboard/project/createDramaProject': {
      const { project } = createProject(body, 2);
      result = ok({ project, task_id: null, is_valid_script: true });
      break;
    }
    case '/storyboard/project/createFreeProject': {
      const { project, seriesId } = createProject(body, 3);
      const projectId = project.id;
      result = ok({ id: projectId, projectId, seriesId });
      break;
    }
    case '/storyboard/project/getDirectorCon': {
      const projectId = Number(body.projectId);
      if (body.id != null) {
        result = ok(data.directorConfigs.find(item =>
          item.id === Number(body.id) && item.projectId === projectId) || null);
      } else {
        const items = data.directorConfigs.filter(item => item.projectId === projectId);
        result = ok({ items, totalCount: items.length });
      }
      break;
    }
    case '/storyboard/project/createDirectorCon': {
      const projectId = Number(body.projectId);
      if (!data.projects.some(project => project.id === projectId) ||
          !body.configJson || typeof body.configJson !== 'object' ||
          Array.isArray(body.configJson)) {
        result = { code: 400, msg: '项目或导演台配置无效' };
        break;
      }
      if (data.directorConfigs.filter(item => item.projectId === projectId).length >= 10) {
        result = { code: 409, msg: '每个项目最多创建 10 条导演台' };
        break;
      }
      const now = new Date().toISOString();
      const config = { id: nextId(), projectId,
        name: String(body.name || '导演台').trim(),
        remark: String(body.remark || ''),
        configJson: structuredClone(body.configJson),
        createAt: now, updateAt: now };
      data.directorConfigs.push(config);
      save();
      result = ok(config);
      break;
    }
    case '/storyboard/project/updateDirectorCon': {
      const config = data.directorConfigs.find(item =>
        item.id === Number(body.id) && item.projectId === Number(body.projectId));
      if (!config) { result = { code: 404, msg: '导演台不存在' }; break; }
      if (body.configJson !== undefined && (!body.configJson ||
          typeof body.configJson !== 'object' || Array.isArray(body.configJson))) {
        result = { code: 400, msg: '导演台配置无效' };
        break;
      }
      if (body.name !== undefined) config.name = String(body.name).trim();
      if (body.remark !== undefined) config.remark = String(body.remark);
      if (body.configJson !== undefined) config.configJson = structuredClone(body.configJson);
      config.updateAt = new Date().toISOString();
      save();
      result = ok(config);
      break;
    }
    case '/storyboard/project/deleteDirectorCon': {
      const index = data.directorConfigs.findIndex(item =>
        item.id === Number(body.id) && item.projectId === Number(body.projectId));
      if (index < 0) { result = { code: 404, msg: '导演台不存在' }; break; }
      data.directorConfigs.splice(index, 1);
      save();
      result = ok(true);
      break;
    }
    case '/storyboard/project/getProjectInfo':
      result = ok(data.projects.find(project => project.id === id) || null);
      break;
    case '/storyboard/project/copyProject': {
      const original = data.projects.find(project => project.id === Number(body.projectId));
      if (!original) { result = { code: 404, msg: '项目不存在' }; break; }
      const now = new Date().toISOString();
      const projectId = nextId();
      const name = `${original.name.slice(0, 17)} 副本`;
      const copy = { ...structuredClone(original), id: projectId, projectId,
        name, title: name, dramaName: name, folderId: original.folderId || null,
        createTime: now, createdAt: now, updateTime: now, updatedAt: now };
      data.projects.push(copy);
      const seriesIds = new Map();
      const shotIds = new Map();
      for (const series of data.series.filter(item => item.projectId === original.id)) {
        const seriesId = nextId();
        seriesIds.set(series.id, seriesId);
        data.series.push({ ...structuredClone(series), id: seriesId, seriesId, projectId });
      }
      for (const shot of data.shots.filter(item => seriesIds.has(item.seriesId))) {
        const shotId = nextId();
        shotIds.set(shot.id, shotId);
        data.shots.push({ ...structuredClone(shot), id: shotId, storyBoardId: shotId,
          seriesId: seriesIds.get(shot.seriesId), projectId });
      }
      for (const history of data.shotHistory.filter(item => shotIds.has(item.storyBoardId))) {
        const historyId = nextId();
        data.shotHistory.push({ ...structuredClone(history), id: historyId,
          storyBoardHistoryId: historyId, storyBoardId: shotIds.get(history.storyBoardId),
          seriesId: seriesIds.get(history.seriesId), projectId });
      }
      for (const history of data.projectHistory.filter(item => item.projectId === original.id)) {
        const historyId = nextId();
        data.projectHistory.push({ ...structuredClone(history), id: historyId,
          historyId, projectId, seriesId: seriesIds.get(history.seriesId) || null });
      }
      for (const library of data.library.filter(item => item.projectId === original.id)) {
        const libraryId = nextId();
        const imageIds = new Map();
        data.library.push({ ...structuredClone(library), id: libraryId, projectId,
          seriesId: seriesIds.get(library.seriesId) || null,
          images: (library.images || []).map(image => {
            const imageId = nextId();
            imageIds.set(image.id, imageId);
            return { ...structuredClone(image), id: imageId, projectLibraryId: libraryId };
          }) });
        for (const history of data.libraryHistory.filter(item => item.libraryId === library.id)) {
          const historyId = nextId();
          data.libraryHistory.push({ ...structuredClone(history), id: historyId,
            libraryHistoryId: historyId, libraryId, projectId,
            seriesId: seriesIds.get(history.seriesId) || null,
            imageId: imageIds.get(history.imageId) || null });
        }
      }
      for (const script of data.scripts.filter(item => item.projectId === original.id)) {
        data.scripts.push({ ...structuredClone(script), id: nextId(), projectId,
          createdAt: now, updatedAt: now });
      }
      for (const config of data.directorConfigs.filter(item => item.projectId === original.id)) {
        data.directorConfigs.push({ ...structuredClone(config), id: nextId(), projectId,
          createAt: now, updateAt: now });
      }
      const originalDocument = data.structuredDocuments[String(original.id)];
      if (originalDocument) {
        const source = originalDocument.document;
        data.structuredDocuments[String(projectId)] = {
          projectId, documentId: nextId(), revision: 1, state: 'editing',
          document: structuredDocument({ language: source.language,
            outline: source.outline?.content, characterProfiles: source.characterProfiles?.content,
            openingHook: source.openingHook, episodes: source.episodes }, projectId),
          createdAt: now, updatedAt: now,
        };
      }
      save();
      result = ok(copy);
      break;
    }
    case '/storyboard/project/updateProjectName':
    case '/storyboard/project/editProject':
    case '/storyboard/project/editDramaProject':
    case '/storyboard/project/editNewDramaProject':
    case '/storyboard/project/editNewFreeProject':
    case '/storyboard/project/updateProject': {
      const project = data.projects.find(item => item.id === id);
      if (project) {
        if (body.scriptUrl) body.scriptUrl = localUploadUrl(body.scriptUrl);
        Object.assign(project, body, { id: project.id, projectId: project.id, userId: 1,
          name: String(body.name || project.name), updateTime: new Date().toISOString() });
        save();
      }
      result = ok((path === '/storyboard/project/editNewDramaProject' ||
        path === '/storyboard/project/editNewFreeProject')
        ? { project: project || null } : project || null);
      break;
    }
    case '/storyboard/project/deleteProject':
      {
      const seriesIds = new Set(data.series.filter(series => series.projectId === id).map(series => series.id));
      data.projects = data.projects.filter(project => project.id !== id);
      data.series = data.series.filter(series => series.projectId !== id);
      data.shots = data.shots.filter(shot => !seriesIds.has(shot.seriesId));
      data.shotHistory = data.shotHistory.filter(item => !seriesIds.has(item.seriesId));
      data.projectHistory = data.projectHistory.filter(item => item.projectId !== id);
      data.libraryHistory = data.libraryHistory.filter(item => item.projectId !== id);
      data.library = data.library.filter(item => item.projectId !== id);
      data.scripts = data.scripts.filter(script => script.projectId !== id);
      data.directorConfigs = data.directorConfigs.filter(config => config.projectId !== id);
      delete data.structuredDocuments[String(id)];
      save();
      result = ok(true);
      break;
      }
    case '/storyboard/project/createProjectFolder': {
      const folder = { id: nextId(), name: String(body.name || '未命名文件夹'),
        projectCount: 0, isPinned: false, createTime: new Date().toISOString() };
      data.folders.push(folder);
      save();
      result = ok(folder);
      break;
    }
    case '/storyboard/project/getProjectFolders':
      result = ok(list(data.folders.map(folder => ({ ...folder,
        projectCount: data.projects.filter(project => project.folderId === folder.id).length })), body));
      break;
    case '/storyboard/project/getCanvasWorkspaceSummary':
      result = okStrict({ total: data.canvasProjects.length, projectCount: data.canvasProjects.length,
        folderCount: data.canvasFolders.length });
      break;
    case '/storyboard/project/createCanvasProject': {
      const projectId = nextId();
      const project = { id: projectId, projectId, name: `未命名项目`,
        folderId: null, createTime: new Date().toISOString(), updateTime: new Date().toISOString(),
        coverUrl: '', nodeCount: 0, isPinned: false };
      data.canvasProjects.push(project);
      canvasDocumentFor(projectId, '');
      save();
      result = okStrict({ id: projectId, projectId });
      break;
    }
    case '/storyboard/project/getCanvasProjectAccess': {
      const project = data.canvasProjects.find(item => item.projectId === Number(body.projectId));
      result = project ? okStrict({ ...canvasProjectView(project), capabilities: {
        ...canvasProjectView(project).capabilities, canRead: true,
      } }) : { code: 'CANVAS_NOT_FOUND', msg: '画布项目不存在' };
      break;
    }
    case '/storyboard/project/updateCanvasProjectDetailedCount': {
      const project = data.canvasProjects.find(item => item.projectId === Number(body.projectId));
      if (project) {
        project.nodeCount = Number(body.detailedCount) || 0;
        save();
      }
      result = okStrict(true);
      break;
    }
    case '/storyboard/project/getCanvasProjects': {
      const search = String(body.search || '').trim().toLowerCase();
      let projects = [...data.canvasProjects].reverse();
      if (search) projects = projects.filter(project => project.name.toLowerCase().includes(search));
      if (body.folderId) projects = projects.filter(project => project.folderId === Number(body.folderId));
      if (body.location === 'UNASSIGNED') projects = projects.filter(project => !project.folderId);
      if (Array.isArray(body.creatorUserIds) && body.creatorUserIds.length && !body.creatorUserIds.map(Number).includes(1)) projects = [];
      if (body.spaceType && body.spaceType !== 'MY') projects = [];
      const page = list(projects.map(canvasProjectView), body);
      result = okStrict({ ...page, totalCount: page.total });
      break;
    }
    case '/storyboard/project/getCanvasFolders': {
      const folders = data.canvasFolders.map(canvasFolderView);
      const page = list(folders, body);
      result = okStrict({ ...page, totalCount: page.total });
      break;
    }
    case '/storyboard/project/createCanvasFolder': {
      const folder = { id: nextId(), name: String(body.name || '未命名文件夹'),
        spaceType: 'MY', isPinned: false, createTime: new Date().toISOString() };
      data.canvasFolders.push(folder);
      save();
      result = okStrict(canvasFolderView(folder));
      break;
    }
    case '/storyboard/project/updateCanvasFolder': {
      const folder = data.canvasFolders.find(item => item.id === Number(body.folderId));
      if (folder) folder.name = String(body.name || folder.name);
      if (folder) save();
      result = okStrict(folder ? canvasFolderView(folder) : null);
      break;
    }
    case '/storyboard/project/deleteCanvasFolder': {
      const folderId = Number(body.folderId);
      data.canvasFolders = data.canvasFolders.filter(folder => folder.id !== folderId);
      for (const project of data.canvasProjects) if (project.folderId === folderId) project.folderId = null;
      save();
      result = okStrict(true);
      break;
    }
    case '/storyboard/project/setCanvasFolderPinned': {
      const folder = data.canvasFolders.find(item => item.id === Number(body.folderId));
      if (folder) folder.isPinned = Boolean(body.isPinned);
      if (folder) save();
      result = okStrict(folder ? canvasFolderView(folder) : null);
      break;
    }
    case '/storyboard/project/updateCanvasProjectName':
    case '/storyboard/project/updateCanvasProjectCover': {
      const project = data.canvasProjects.find(item => item.projectId === Number(body.projectId));
      if (project) {
        if (path.endsWith('Name')) project.name = String(body.name || project.name);
        else project.coverUrl = String(body.coverUrl || '');
        project.updateTime = new Date().toISOString();
        save();
      }
      result = okStrict(project ? canvasProjectView(project) : null);
      break;
    }
    case '/storyboard/project/moveCanvasProjectsToFolder': {
      const requestedFolderId = Number(body.targetFolderId);
      const folderId = requestedFolderId === 0 ? null : requestedFolderId;
      const projectIds = Array.isArray(body.projectIds)
        ? [...new Set(body.projectIds.map(Number))] : [];
      if ((body.spaceType && body.spaceType !== 'MY') || !projectIds.length ||
          !Number.isSafeInteger(requestedFolderId) || requestedFolderId < 0 ||
          (folderId && !data.canvasFolders.some(folder => folder.id === folderId)) ||
          projectIds.some(projectId => !data.canvasProjects.some(project =>
            project.projectId === projectId))) {
        result = { code: 400, msg: '画布项目或目标文件夹无效' };
        break;
      }
      const now = new Date().toISOString();
      for (const project of data.canvasProjects) if (projectIds.includes(project.projectId)) {
        project.folderId = folderId;
        project.updateTime = now;
      }
      save();
      result = okStrict({ updatedCount: projectIds.length });
      break;
    }
    case '/storyboard/project/deleteCanvasProject': {
      const projectId = Number(body.projectId);
      data.canvasProjects = data.canvasProjects.filter(project => project.projectId !== projectId);
      delete data.canvasDocuments[String(projectId)];
      save();
      result = okStrict(true);
      break;
    }
    case '/storyboard/project/updateProjectFolder': {
      const folder = data.folders.find(item => item.id === id);
      if (folder) Object.assign(folder, body, { id: folder.id });
      save();
      result = ok(folder || null);
      break;
    }
    case '/storyboard/project/deleteProjectFolder':
      data.folders = data.folders.filter(folder => folder.id !== id);
      for (const project of data.projects) if (project.folderId === id) project.folderId = null;
      save();
      result = ok(true);
      break;
    case '/storyboard/project/setProjectFolderPinned': {
      const folder = data.folders.find(item => item.id === id);
      if (folder) folder.isPinned = Boolean(body.isPinned ?? body.pinned);
      save();
      result = ok(folder || null);
      break;
    }
    case '/storyboard/project/moveProjectsToFolder': {
      const folderId = Number(body.folderId) || null;
      const projectIds = new Set((body.projectIds || []).map(Number));
      for (const project of data.projects) if (projectIds.has(project.id)) project.folderId = folderId;
      save();
      result = ok(true);
      break;
    }
    case '/storyboard/series/getSeries':
      result = ok(list(data.series.filter(series => series.projectId === Number(body.projectId)), body));
      break;
    case '/storyboard/series/getSeriesInfo':
      result = ok(data.series.find(series => series.id === id) || null);
      break;
    case '/storyboard/series/setDetailedSeries': {
      const projectId = Number(body.projectId);
      const detailedCount = Number(body.detailedCount);
      if (!data.projects.some(project => project.id === projectId) ||
          !Number.isSafeInteger(detailedCount) || detailedCount < 0) {
        result = { code: 400, msg: '项目或剧集设置无效' };
        break;
      }
      const series = data.series.filter(item => item.projectId === projectId)
        .sort((left, right) => Number(left.sort) - Number(right.sort));
      series.forEach((item, index) => { item.isDetailed = detailedCount > index + 1 ? 1 : 0; });
      save();
      result = ok(true);
      break;
    }
    case '/storyboard/series/createSeries':
    case '/storyboard/project/createSeries': {
      const projectId = Number(body.projectId);
      const project = data.projects.find(item => item.id === projectId);
      if (!project) { result = { code: 404, msg: '项目不存在' }; break; }
      const subtitleInputs = Array.isArray(body.subtitleFiles) ? body.subtitleFiles : [];
      const dubbingInputs = Array.isArray(body.dubbingFiles) ? body.dubbingFiles : [];
      let cues = [];
      let subtitleFiles = [];
      let dubbingFiles = [];
      if (project.modeType === 0 || subtitleInputs.length || dubbingInputs.length) {
        if (subtitleInputs.length !== 1 || dubbingInputs.length !== 1) {
          result = { code: 400, msg: '请各上传一个 SRT 字幕和 WAV 或 MP3 配音文件' };
          break;
        }
        const subtitle = uploadedFile(subtitleInputs[0], 'srt', ['srt']);
        const dubbing = uploadedFile(dubbingInputs[0], 'dubbing', ['wav', 'mp3']);
        if (!subtitle || !dubbing) {
          result = { code: 400, msg: '字幕或配音文件不存在，请重新上传' };
          break;
        }
        try { cues = parseSrt(readFileSync(subtitle.absolute, 'utf8')); }
        catch (error) { result = { code: 400, msg: error.message }; break; }
        subtitleFiles = [subtitle.pathname];
        dubbingFiles = [dubbing.pathname];
      }
      const seriesId = nextId();
      const index = data.series.filter(series => series.projectId === projectId).length + 1;
      const name = String(body.name || body.title || `第${index}集`);
      const series = { id: seriesId, seriesId, projectId, name, title: name, sort: index,
        subtitleFiles, dubbingFiles, timeDuration: 0,
        totalStoryBoardCount: 0, completedStoryBoardCount: 0 };
      data.series.push(series);
      for (const cue of cues) {
        const shotId = nextId();
        data.shots.push({ id: shotId, storyBoardId: shotId, seriesId, projectId,
          boardIndex: cue.index, name: `分镜${cue.index}`, shotTitle: `分镜${cue.index}`,
          produceType: 1, startTime: cue.startTime,
          duration: (cue.endMs - cue.startMs) / 1000,
          originText: cue.text, content: cue.text,
          narrationList: [{ index: 0, startTime: cue.startTime,
            endTime: cue.endTime, text: cue.text }],
          imageList: [], videoList: [], imagePrompt: '', videoPrompt: '' });
      }
      renumberShots(seriesId);
      save();
      result = ok(series);
      break;
    }
    case '/storyboard/series/updateSeries': {
      const series = data.series.find(item => item.id === id);
      if (series) Object.assign(series, body, {
        subtitleFiles: localMediaList(body.subtitleFiles ?? series.subtitleFiles),
        dubbingFiles: localMediaList(body.dubbingFiles ?? series.dubbingFiles),
        id: series.id, seriesId: series.id,
      });
      save();
      result = ok(series || null);
      break;
    }
    case '/storyboard/series/deleteSeries': {
      const seriesId = Number(body.id ?? body.seriesId);
      data.series = data.series.filter(series => series.id !== seriesId);
      data.shots = data.shots.filter(shot => shot.seriesId !== seriesId);
      data.shotHistory = data.shotHistory.filter(item => item.seriesId !== seriesId);
      data.projectHistory = data.projectHistory.filter(item => item.seriesId !== seriesId);
      data.libraryHistory = data.libraryHistory.filter(item => item.seriesId !== seriesId);
      save();
      result = ok(true);
      break;
    }
    case '/storyboard/series/checkSeriesName':
      result = ok({ exists: data.series.some(series => series.projectId === Number(body.projectId) && series.name === body.name) });
      break;
    case '/storyboard/api/list':
      result = ok(list(data.shots.filter(shot => shot.seriesId === Number(body.seriesId)), body));
      break;
    case '/storyboard/project/copyProjectLibrary': {
      const sourceProjectId = Number(body.importProjectId);
      const targetProjectId = Number(body.newProjectId);
      const ids = Array.isArray(body.projectLibraryIds)
        ? [...new Set(body.projectLibraryIds.map(Number).filter(Number.isSafeInteger))] : [];
      if (!data.projects.some(project => project.id === sourceProjectId) ||
          !data.projects.some(project => project.id === targetProjectId) ||
          sourceProjectId === targetProjectId || !ids.length) {
        result = { code: 400, msg: '源项目、目标项目或所选素材无效' };
        break;
      }
      const copied = [];
      let skippedCount = 0;
      for (const sourceId of ids) {
        const source = data.library.find(item =>
          item.id === sourceId && item.projectId === sourceProjectId);
        if (!source || data.library.some(item => item.projectId === targetProjectId &&
            item.sourceProjectId === sourceProjectId &&
            item.sourceProjectLibraryId === sourceId)) {
          skippedCount++;
          continue;
        }
        const libraryId = nextId();
        const imageIds = new Map();
        const images = (source.images || []).map(image => {
          const imageId = nextId();
          imageIds.set(image.id, imageId);
          return { ...structuredClone(image), id: imageId, projectLibraryId: libraryId,
          resourceUrl: (Array.isArray(image.resourceUrl)
            ? image.resourceUrl : [image.resourceUrl].filter(Boolean)).map(localUploadUrl) };
        });
        const item = { ...structuredClone(source), id: libraryId,
          projectId: targetProjectId, seriesId: null,
          sourceProjectId, sourceProjectLibraryId: sourceId,
          images, createTime: new Date().toISOString() };
        data.library.push(item);
        for (const history of data.libraryHistory.filter(entry => entry.libraryId === source.id)) {
          const historyId = nextId();
          data.libraryHistory.push({ ...structuredClone(history), id: historyId,
            libraryHistoryId: historyId, libraryId, projectId: targetProjectId,
            seriesId: null, imageId: imageIds.get(history.imageId) || null });
        }
        copied.push(item);
      }
      if (copied.length) save();
      result = ok({ copiedProjectLibraryCount: copied.length, skippedCount,
        items: copied });
      break;
    }
    case '/storyboard/project/checkProjectAssetSyncConflict': {
      const library = data.library.find(item => item.id === Number(body.libraryId) &&
        item.projectId === Number(body.projectId));
      if (!library) { result = { code: 404, msg: '项目素材不存在' }; break; }
      const target = personalTargetForLibrary(library);
      if (!target) { result = ok([]); break; }
      const sourceUrls = localLibraryImages(library).map(item => item.url).sort();
      const targetUrls = (target.characterResources || []).map(item =>
        localResourceImage(Array.isArray(item.resourceUrl)
          ? item.resourceUrl[0] : item.resourceUrl)).filter(Boolean).sort();
      const hasConflict = JSON.stringify(sourceUrls) !== JSON.stringify(targetUrls);
      result = ok([{ name: library.name, hasConflict, isEdited: hasConflict,
        newestTargetId: target.id, projectLibraryId: library.id,
        parentResourceId: target.id }]);
      break;
    }
    case '/storyboard/project/syncProjectAssetLibrary': {
      const library = data.library.find(item => item.id === Number(body.libraryId) &&
        item.projectId === Number(body.projectId));
      if (!library) { result = { code: 404, msg: '项目素材不存在' }; break; }
      let selectedIds = null;
      if (body.imageIds !== undefined) {
        if (!Array.isArray(body.imageIds) || !body.imageIds.length ||
            body.imageIds.some(value => !Number.isSafeInteger(Number(value)))) {
          result = { code: 400, msg: '请选择有效的素材图片' };
          break;
        }
        selectedIds = new Set(body.imageIds.map(Number));
        if ([...selectedIds].some(imageId =>
          !(library.images || []).some(image => Number(image.id) === imageId))) {
          result = { code: 400, msg: '所选图片不属于该项目素材' };
          break;
        }
      }
      const sourceImages = localLibraryImages(library, selectedIds);
      if (!sourceImages.length) {
        result = { code: 400, msg: '项目素材没有可同步的本地图片' };
        break;
      }
      let target = personalTargetForLibrary(library);
      const action = String(body.action || '').toLowerCase();
      const now = new Date().toISOString();
      if (target && !['merge', 'overwrite'].includes(action)) {
        result = { code: 409, msg: '个人资产库已有同名素材，请选择合并或覆盖' };
        break;
      }
      if (!target) {
        target = { id: nextId(), source: 'private', sourceProjectId: library.projectId,
          sourceProjectLibraryId: library.id, type: library.type, name: library.name,
          description: library.description || '', characterResources: [],
          isStar: false, isHidden: false, createTime: now };
        data.resources.push(target);
      }
      const oldUrls = new Set((target.characterResources || []).map(image =>
        localResourceImage(Array.isArray(image.resourceUrl)
          ? image.resourceUrl[0] : image.resourceUrl)).filter(Boolean));
      const inputs = action === 'merge'
        ? sourceImages.filter(item => !oldUrls.has(item.url)) : sourceImages;
      const newImages = inputs.map(({ image, url }) => ({ ...structuredClone(image),
        id: nextId(), parentResourceId: target.id, projectLibraryImageId: image.id,
        resourceUrl: url }));
      target.characterResources = action === 'merge'
        ? [...target.characterResources, ...newImages] : newImages;
      target.mainResourceId = target.characterResources.find(image => image.isMain)?.id ||
        target.characterResources[0]?.id || null;
      target.sourceProjectId = library.projectId;
      target.sourceProjectLibraryId = library.id;
      target.updateTime = now;
      save();
      result = ok(target);
      break;
    }
    case '/storyboard/project/importParentResources': {
      const projectId = Number(body.projectId);
      if (!data.projects.some(project => project.id === projectId)) {
        result = { code: 404, msg: '项目不存在' };
        break;
      }
      const selected = Array.isArray(body.parentResources) ? body.parentResources : [];
      if (!selected.length) { result = { code: 400, msg: '请先选择资产' }; break; }
      const imported = [];
      let skippedCount = 0;
      for (const item of selected) {
        const parentId = Number(typeof item === 'object' ? item?.id : item);
        const parent = data.resources.find(resource => resource.id === parentId);
        if (!parent || data.library.some(library =>
          library.projectId === projectId && library.parentResourceId === parentId)) {
          skippedCount++;
          continue;
        }
        const imageInputs = (parent.characterResources || []).map(image => ({ image,
          url: localResourceImage(Array.isArray(image.resourceUrl)
            ? image.resourceUrl[0] : image.resourceUrl) })).filter(item => item.url);
        if (!imageInputs.length) { skippedCount++; continue; }
        const libraryId = nextId();
        const images = imageInputs.map(({ image, url }) => ({
          ...structuredClone(image), id: nextId(), projectLibraryId: libraryId,
          parentResourceImageId: image.id, name: image.name || parent.name,
          isMain: image.id === parent.mainResourceId || Boolean(image.isMain),
          resourceUrl: [url],
        }));
        const library = { id: libraryId, projectId, seriesId: null,
          parentResourceId: parent.id, type: parent.type, name: parent.name,
          description: parent.description || '', isUpload: 1,
          images, createTime: new Date().toISOString() };
        data.library.push(library);
        imported.push(library);
      }
      if (!imported.length) {
        result = { code: 409, msg: '所选资产已导入或没有可用的本地图片' };
      } else {
        save();
        result = ok({ items: imported, importedCount: imported.length, skippedCount });
      }
      break;
    }
    case '/storyboard/api/changeProduceType': {
      const shot = data.shots.find(item => item.id === Number(body.storyBoardId || body.id) &&
        item.seriesId === Number(body.seriesId));
      const produceType = Number(body.produceType);
      if (!shot || ![1, 2].includes(produceType)) {
        result = { code: 400, msg: '分镜或创作模式无效' };
        break;
      }
      shot.produceType = produceType;
      save();
      result = ok(shot);
      break;
    }
    case '/storyboard/api/libraryList': {
      const projectId = Number(body.projectId);
      const type = Number(body.type || 1);
      const characters = data.library
        .filter(item => item.projectId === projectId && item.type === type)
        .map(item => ({ ...item, resourceUrl: (item.images || []).flatMap(image =>
          Array.isArray(image.resourceUrl) ? image.resourceUrl :
            [image.resourceUrl].filter(Boolean)).map(localUploadUrl) }));
      result = ok({ characters, items: characters, total: characters.length });
      break;
    }
    case '/storyboard/api/libraryHistoryList': {
      const requestedId = Number(body.libraryId);
      const library = data.library.find(item =>
        (item.id === requestedId || item.images?.some(image => image.id === requestedId)) &&
        item.projectId === Number(body.projectId) &&
        (!body.type || item.type === Number(body.type)));
      if (!library) { result = ok({ items: [], total: 0 }); break; }
      const imageId = library.id === requestedId ? null : requestedId;
      const current = localLibraryImages(library, imageId === null ? null : new Set([imageId]))
        .map(({ image, url }) => ({
          id: -Number(image.id), libraryHistoryId: -Number(image.id),
          libraryId: library.id, projectId: library.projectId, imageId: image.id,
          type: library.type, name: image.name || library.name,
          resourceUrl: url, isCurrent: true,
          createAt: image.createTime || library.createTime,
        }));
      const previous = data.libraryHistory.filter(item => item.libraryId === library.id)
        .filter(item => imageId === null || item.imageId === imageId)
        .filter(item => localResourceImage(item.resourceUrl))
        .sort((left, right) => Date.parse(right.createAt) - Date.parse(left.createAt));
      const items = [...current, ...previous];
      result = ok({ items, total: items.length });
      break;
    }
    case '/storyboard/api/switchLibraryHistory': {
      const requestedId = Number(body.libraryId);
      const library = data.library.find(item =>
        (item.id === requestedId || item.images?.some(image => image.id === requestedId)) &&
        item.projectId === Number(body.projectId));
      const imageId = library?.id === requestedId ? null : requestedId;
      const historyId = Number(body.libraryHistoryId);
      const history = historyId > 0 ? data.libraryHistory.find(item =>
        item.id === historyId && item.libraryId === library?.id &&
        (imageId === null || item.imageId === imageId)) : null;
      const selectedImage = historyId < 0 ? library?.images?.find(image =>
        image.id === -historyId && (imageId === null || image.id === imageId)) :
        library?.images?.find(image => image.id === history?.imageId);
      const resourceUrl = historyId > 0 ? localResourceImage(history?.resourceUrl) :
        localResourceImage(Array.isArray(selectedImage?.resourceUrl)
          ? selectedImage.resourceUrl[0] : selectedImage?.resourceUrl);
      if (!library || !selectedImage || !resourceUrl) {
        result = { code: 404, msg: '项目素材历史不存在' };
        break;
      }
      if (historyId > 0) {
        recordLibraryHistory(library, selectedImage);
        selectedImage.resourceUrl = [resourceUrl];
      }
      for (const image of library.images) image.isMain = Number(image.id === selectedImage.id);
      save();
      result = ok(library);
      break;
    }
    case '/storyboard/api/projectLibraryList': {
      const library = data.library.filter(item =>
        (!body.projectId || item.projectId === Number(body.projectId)) &&
        (!body.type || item.type === Number(body.type)) &&
        (!body.seriesId || item.seriesId == null || item.seriesId === Number(body.seriesId)) &&
        (!body.onlyWithResourceUrl || item.images?.some(image => image.resourceUrl?.length)));
      result = ok(list(library, { ...body, size: body.size || body.pageSize || 20 }));
      break;
    }
    case '/storyboard/api/getProjectLibraryImageDetail': {
      const projectId = Number(body.projectId);
      const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(Number));
      const images = data.library
        .filter(item => item.projectId === projectId)
        .flatMap(item => (item.images || []).filter(image => ids.has(Number(image.id)))
          .map(image => ({ ...image, id: image.id, projectId, projectLibraryId: item.id,
            name: image.name || item.name, type: image.type ?? item.type })));
      result = ok(images);
      break;
    }
    case '/storyboard/api/createProjectLibraryWithImages': {
      const libraryId = nextId();
      const images = (Array.isArray(body.images) ? body.images : []).map(image => ({
        ...image, id: nextId(), projectLibraryId: libraryId,
        resourceUrl: (Array.isArray(image.resourceUrl) ? image.resourceUrl : [image.resourceUrl].filter(Boolean)).map(localUploadUrl),
      }));
      const item = { id: libraryId, projectId: Number(body.projectId), seriesId: body.seriesId == null ? null : Number(body.seriesId),
        type: Number(body.type), name: String(body.name || images[0]?.name || '未命名素材'),
        isUpload: Number(body.isUpload || 0), images, createTime: new Date().toISOString() };
      data.library.push(item);
      save();
      result = ok(item);
      break;
    }
    case '/storyboard/api/updateProjectLibrary': {
      const item = data.library.find(item => item.id === id &&
        (!body.projectId || item.projectId === Number(body.projectId)));
      if (!item) { result = { code: 404, msg: '项目素材不存在' }; break; }
      if (body.images !== undefined && !Array.isArray(body.images)) {
        result = { code: 400, msg: '形象列表格式无效' };
        break;
      }
      const existingImages = new Map((item.images || [])
        .filter(image => Number(image.id) > 0)
        .map(image => [Number(image.id), image]));
      const seenIds = new Set();
      if (body.images?.some(image => {
        if (!image || typeof image !== 'object' || Array.isArray(image)) return true;
        const imageId = Number(image.id) || 0;
        if (imageId <= 0) return false;
        if (!existingImages.has(imageId) || seenIds.has(imageId)) return true;
        seenIds.add(imageId);
        return false;
      })) {
        result = { code: 400, msg: '形象不属于该项目素材或重复提交' };
        break;
      }
      const fields = { ...body };
      delete fields.id;
      delete fields.projectId;
      delete fields.type;
      delete fields.images;
      Object.assign(item, fields);
      if (body.images) {
        const retainedIds = new Set();
        item.images = body.images.map(incoming => {
          const prior = existingImages.get(Number(incoming.id));
          const imageId = prior?.id || nextId();
          const sourceUrls = incoming.resourceUrl === undefined
            ? prior?.resourceUrl : incoming.resourceUrl;
          const resourceUrl = (Array.isArray(sourceUrls) ? sourceUrls :
            [sourceUrls].filter(Boolean)).map(localUploadUrl);
          if (prior && JSON.stringify(prior.resourceUrl || []) !== JSON.stringify(resourceUrl))
            recordLibraryHistory(item, prior);
          retainedIds.add(Number(imageId));
          return { ...prior, ...incoming, id: imageId, projectLibraryId: item.id,
            resourceUrl,
            referenceImages: incoming.referenceImages === undefined
              ? prior?.referenceImages : localMediaList(incoming.referenceImages) };
        });
        data.libraryHistory = data.libraryHistory.filter(history =>
          history.libraryId !== item.id || retainedIds.has(Number(history.imageId)));
        if (item.images.length && !item.images.some(image => image.isMain))
          item.images[0].isMain = 1;
        let mainSeen = false;
        for (const image of item.images) {
          const isMain = Boolean(image.isMain) && !mainSeen;
          image.isMain = Number(isMain);
          if (isMain) mainSeen = true;
        }
      }
      save();
      result = ok(item);
      break;
    }
    case '/storyboard/api/deleteProjectLibrary':
      data.library = data.library.filter(item => item.id !== id);
      data.libraryHistory = data.libraryHistory.filter(item => item.libraryId !== id);
      save();
      result = ok(true);
      break;
    case '/storyboard/api/createProjectLibraryImage': {
      const libraryId = Number(body.projectLibraryId || body.libraryId || body.id);
      const item = data.library.find(item => item.id === libraryId);
      const image = { ...body, id: nextId(), projectLibraryId: libraryId,
        resourceUrl: (Array.isArray(body.resourceUrl) ? body.resourceUrl : [body.resourceUrl].filter(Boolean)).map(localUploadUrl) };
      if (item) item.images.push(image);
      save();
      result = ok(image);
      break;
    }
    case '/storyboard/api/updateProjectLibraryImage': {
      const item = data.library.find(item => item.images?.some(image => image.id === id));
      const image = item?.images.find(image => image.id === id);
      if (image && body.resourceUrl !== undefined) recordLibraryHistory(item, image);
      if (image) Object.assign(image, body, { id: image.id,
        resourceUrl: (Array.isArray(body.resourceUrl) ? body.resourceUrl : [body.resourceUrl || image.resourceUrl].flat()).map(localUploadUrl) });
      save();
      result = ok(image || null);
      break;
    }
    case '/storyboard/api/deleteProjectLibraryImage': {
      const item = data.library.find(item => item.images?.some(image => image.id === id));
      if (item) item.images = item.images.filter(image => image.id !== id);
      data.libraryHistory = data.libraryHistory.filter(history => history.imageId !== id);
      save();
      result = ok(true);
      break;
    }
    case '/storyboard/api/setMainImage': {
      const item = data.library.find(item => item.images?.some(image => image.id === id));
      if (item) for (const image of item.images) image.isMain = Number(image.id === id);
      save();
      result = ok(true);
      break;
    }
    case '/storyboard/api/save': {
      const shotId = Number(body.id || body.storyBoardId) || nextId();
      let shot = data.shots.find(item => item.id === shotId);
      const fields = { ...body };
      if (fields.imageList) fields.imageList = shotMediaUrls(fields.imageList);
      if (fields.videoList) fields.videoList = shotMediaUrls(fields.videoList);
      const oldImageList = JSON.stringify(shot?.imageList || []);
      const oldVideoList = JSON.stringify(shot?.videoList || []);
      if (shot) Object.assign(shot, fields, { id: shotId });
      else {
        const boardIndex = data.shots.filter(item => item.seriesId === Number(body.seriesId)).length + 1;
        const parentSeries = data.series.find(item => item.id === Number(body.seriesId));
        shot = { boardIndex, name: `分镜${boardIndex}`, shotTitle: `分镜${boardIndex}`,
          produceType: 1, duration: 2, imageList: [], videoList: [], imagePrompt: '', videoPrompt: '',
          ...fields, id: shotId, storyBoardId: shotId, seriesId: Number(body.seriesId),
          projectId: Number(body.projectId || parentSeries?.projectId) };
        data.shots.push(shot);
      }
      if (Array.isArray(fields.imageList) && fields.imageList.length &&
          JSON.stringify(fields.imageList) !== oldImageList) recordShotHistory(shot, 1);
      if (Array.isArray(fields.videoList) && fields.videoList.length &&
          JSON.stringify(fields.videoList) !== oldVideoList) recordShotHistory(shot, 2);
      renumberShots(shot.seriesId);
      save();
      result = ok(shot);
      break;
    }
    case '/storyboard/api/operate': {
      const seriesId = Number(body.seriesId);
      const shots = data.shots.filter(shot => shot.seriesId === seriesId);
      const targetId = Number(body.storyBoardId || body.backStoryBoardId);
      const target = shots.find(shot => shot.id === targetId);
      const actionType = Number(body.actionType);
      let changed = null;
      if (actionType === 3 || actionType === 4) {
        const shotId = nextId();
        const shot = { id: shotId, storyBoardId: shotId, seriesId, boardIndex: 0,
          name: '', shotTitle: '', produceType: 1, duration: 2, imageList: [], videoList: [],
          imagePrompt: '', videoPrompt: '', originText: '' };
        if (actionType === 4 && target) Object.assign(shot, structuredClone(target), { id: shotId, storyBoardId: shotId });
        let insertIndex = data.shots.length;
        if (target) insertIndex = Math.max(0, data.shots.indexOf(target) + (body.backStoryBoardId ? 0 : 1));
        data.shots.splice(insertIndex, 0, shot);
        changed = shot;
      } else if (actionType === 2 && target && shots.length > 1) {
        data.shots.splice(data.shots.indexOf(target), 1);
        data.shotHistory = data.shotHistory.filter(item => item.storyBoardId !== target.id);
        changed = true;
      } else if (actionType === 1 && target && shots.length > 1) {
        const index = shots.indexOf(target);
        const next = shots[index + 1];
        if (next) {
          target.originText = [target.originText, next.originText].filter(Boolean).join('\n');
          target.duration = (Number(target.duration) || 2) + (Number(next.duration) || 2);
          data.shots.splice(data.shots.indexOf(next), 1);
          data.shotHistory = data.shotHistory.filter(item => item.storyBoardId !== next.id);
          changed = target;
        }
      }
      if (changed) {
        renumberShots(seriesId);
        save();
      }
      result = ok(changed);
      break;
    }
    case '/storyboard/api/initial':
      result = ok({ items: [], total: 0 });
      break;
    case '/storyboard/api/getPromptTemplate':
      result = ok({ templateList: [] });
      break;
    case '/storyboard/api/characterPromptTaskStatus':
      result = ok({ status: 0 });
      break;
    case '/storyboard/api/listImageVideo':
      result = describeSeriesMedia(data, body, import.meta.dirname);
      break;
    case '/storyboard/api/export/jsonBySeriesId':
    case '/storyboard/api/export/scriptJsonBySeriesId':
      result = prepareSeriesExport(data, body, import.meta.dirname);
      break;
    case '/storyboard/plaza/home':
      result = ok({ banners: [], recommendations: [], items: [] });
      break;
    case '/storyboard/plaza/content/list':
      result = ok(list([], body));
      break;
    case '/storyboard/api/historyList': {
      const storyBoardId = Number(body.storyBoardId || body.id);
      const seriesId = Number(body.seriesId);
      let history = data.shotHistory.filter(item => storyBoardId > 0
        ? item.storyBoardId === storyBoardId
        : seriesId > 0 && item.seriesId === seriesId);
      if (body.type) history = history.filter(item => item.type === Number(body.type));
      result = ok(list(history.reverse(), body));
      break;
    }
    case '/storyboard/api/projectHistoryList': {
      const projectId = Number(body.projectId);
      let history = [...data.projectHistory, ...data.shotHistory]
        .filter(item => item.projectId === projectId);
      if (Number(body.type) > 0) history = history.filter(item => item.type === Number(body.type));
      if (Number(body.seriesId) > 0)
        history = history.filter(item => item.seriesId === Number(body.seriesId));
      if (Number(body.isStar) === 1) history = history.filter(item => item.isStar);
      const search = String(body.search || '').trim().toLowerCase();
      if (search) history = history.filter(item =>
        `${item.name || ''} ${item.imagePrompt || ''} ${item.videoPrompt || ''}`
          .toLowerCase().includes(search));
      history.sort((left, right) =>
        Date.parse(right.updateAt || right.createAt || right.createTime || 0) -
        Date.parse(left.updateAt || left.createAt || left.createTime || 0));
      result = ok(list(history, body));
      break;
    }
    case '/storyboard/api/createProjectHistory': {
      const projectId = Number(body.projectId);
      const type = Number(body.type);
      if (!data.projects.some(project => project.id === projectId) || ![1, 2].includes(type)) {
        result = { code: 400, msg: '项目或历史素材类型无效' };
        break;
      }
      const seriesId = Number(body.seriesId) || null;
      if (seriesId && !data.series.some(series =>
        series.id === seriesId && series.projectId === projectId)) {
        result = { code: 400, msg: '剧集不属于该项目' };
        break;
      }
      let media = body[type === 1 ? 'imageList' : 'videoList'];
      if (typeof media === 'string') {
        try { media = JSON.parse(media); }
        catch { media = []; }
      }
      const urls = (Array.isArray(media) ? media : []).map(item =>
        typeof item === 'string' ? item : item?.url || item?.resourceUrl)
        .map(url => type === 1 ? localResourceImage(url) : localResourceMedia(url))
        .filter(url => url && (type === 1 || url.toLowerCase().endsWith('.mp4')));
      if (!urls.length) { result = { code: 400, msg: '请先上传本地图片或视频' }; break; }
      const historyId = nextId();
      const now = new Date().toISOString();
      const entry = { ...body, id: historyId, historyId, projectId, type,
        historyType: type, seriesId,
        imageList: type === 1 ? urls : [], videoList: type === 2 ? urls : [],
        isStar: 0, createAt: now, updateAt: now };
      data.projectHistory.push(entry);
      save();
      result = ok(entry);
      break;
    }
    case '/storyboard/api/updateHistoryStar': {
      const historyId = Number(body.storyBoardHistoryId || body.historyId || body.id);
      const entry = data.shotHistory.find(item => item.id === historyId) ||
        data.projectHistory.find(item => item.id === historyId);
      if (!entry || body.seriesId && Number(body.seriesId) !== entry.seriesId) {
        result = { code: 404, msg: '历史素材不存在' };
        break;
      }
      entry.isStar = Number(body.isStar === true || Number(body.isStar) === 1);
      entry.updateAt = new Date().toISOString();
      save();
      result = ok(entry);
      break;
    }
    case '/storyboard/api/switchMaterial': {
      const shot = data.shots.find(item => item.id === Number(body.storyBoardId) &&
        item.seriesId === Number(body.seriesId));
      const type = Number(body.type);
      const history = data.shotHistory.find(item =>
        item.id === Number(body.storyBoardHistoryId) &&
        item.storyBoardId === shot?.id && item.type === type);
      if (!shot || !history || ![1, 2].includes(type)) {
        result = { code: 404, msg: '分镜历史素材不存在' };
        break;
      }
      if (type === 1) shot.imageList = shotMediaUrls(history.imageList);
      else shot.videoList = shotMediaUrls(history.videoList);
      shot.historyId = history.id;
      shot.historyType = type;
      save();
      result = ok(shot);
      break;
    }
    case '/storyboard/imagePreset/list': {
      let items = data.imagePresets.filter(item =>
        body.location == null || item.location === Number(body.location));
      if (body.presetType != null && Number(body.presetType) !== 0)
        items = items.filter(item => item.type === Number(body.presetType));
      result = ok(list(items, { ...body, size: body.size || 1000 }));
      break;
    }
    case '/storyboard/imagePreset/create':
    case '/storyboard/imagePreset/update': {
      const name = String(body.name || '').trim();
      const prefixPrompt = String(body.prefixPrompt || '');
      const suffixPrompt = String(body.suffixPrompt || '');
      if (!name || [...name].length > 20 ||
          (!prefixPrompt.trim() && !suffixPrompt.trim()) ||
          [...prefixPrompt, ...suffixPrompt].length >= 3000) {
        result = { code: 400, msg: '预设名称或提示词无效' };
        break;
      }
      const editing = path.endsWith('/update');
      const preset = editing ? data.imagePresets.find(item => item.id === Number(body.id)) : null;
      if (editing && !preset) { result = { code: 404, msg: '图片预设不存在' }; break; }
      const now = new Date().toISOString();
      if (preset) Object.assign(preset, { name, prefixPrompt, suffixPrompt,
        updateTime: now });
      else {
        data.imagePresets.push({ id: nextId(), name, prefixPrompt, suffixPrompt,
          type: 99, location: Number(body.location || 110),
          available: 1, sortOrder: data.imagePresets.length,
          createTime: now, updateTime: now });
      }
      save();
      result = ok(preset || data.imagePresets.at(-1));
      break;
    }
    case '/storyboard/imagePreset/delete': {
      const index = data.imagePresets.findIndex(item => item.id === Number(body.id));
      if (index < 0) { result = { code: 404, msg: '图片预设不存在' }; break; }
      data.imagePresets.splice(index, 1);
      save();
      result = ok(true);
      break;
    }
    case '/storyboard/task/queryTaskQueue':
    case '/msg/api/getMessages':
    case '/assets/resource/characterRank':
    case '/assets/resource/assetIp/list':
    case '/assets/projectDramaBinding/pending/list':
    case '/assets/projectDramaBinding/pendingHistory':
    case '/assets/delivery/ipPlatformList':
    case '/assets/delivery/ipNameList':
    case '/assets/permission/userList':
      result = ok({ items: [], total: 0 });
      break;
    case '/assets/delivery/adaptationTypeList':
    case '/assets/delivery/copyrightTypeList':
      result = ok([]);
      break;
    case '/storyboard/activity/current':
    case '/storyboard/project/freeSplitShotInferTaskStatus':
    case '/user/projectDramaBinding/detail':
    case '/assets/projectDramaBinding/guideState':
      result = ok({});
      break;
    case '/nestjs/agreement':
      result = ok({});
      break;
    case '/nestjs/scripts': {
      const projectId = Number(body.projectId);
      if (!data.projects.some(project => project.id === projectId)) {
        result = { code: 404, msg: '项目不存在' };
        break;
      }
      const remoteUrl = localUploadUrl(body.remoteUrl);
      if (typeof remoteUrl !== 'string' || !remoteUrl.startsWith('/local-upload/')) {
        result = { code: 400, msg: '请先上传剧本文件' };
        break;
      }
      const now = new Date().toISOString();
      const script = { id: nextId(), projectId, userId: 1,
        title: String(body.title || '未命名剧本'), remoteUrl,
        checkPassed: false, checkTaskId: null, autoCompleteTaskId: null,
        splitResultJsonUrl: null, createdAt: now, updatedAt: now };
      data.scripts.push(script);
      save();
      result = okStrict(script);
      break;
    }
    case '/nestjs/structured-script-documents/candidates': {
      const projectId = Number(body.projectId);
      if (!data.projects.some(project => project.id === projectId)) {
        result = { code: 404, msg: '项目不存在' };
        break;
      }
      if (data.structuredDocuments[String(projectId)]) {
        result = { code: 409, msg: '已存在剧本文档' };
        break;
      }
      if (!body.document || !Array.isArray(body.document.episodes)) {
        result = { code: 400, msg: '剧本文档格式无效' };
        break;
      }
      const now = new Date().toISOString();
      const entry = { projectId, documentId: nextId(), revision: 1, state: 'editing',
        document: structuredDocument(body.document, projectId), createdAt: now, updatedAt: now };
      data.structuredDocuments[String(projectId)] = entry;
      save();
      result = okStrict(structuredView(entry));
      break;
    }
    case '/nestjs/url-encryption/encrypt': {
      const openUrl = localUploadUrl(body.url);
      if (typeof openUrl !== 'string' || !openUrl.startsWith('/local-upload/') ||
          !existsSync(join(import.meta.dirname, openUrl.slice(1)))) {
        result = { code: 400, msg: '本地文件不存在或路径无效' };
      } else result = okStrict({ openUrl });
      break;
    }
    case '/storyboard/project/inferTaskStatus':
      result = ok({ status: 4, error: '本地分集推理服务尚未接入', projectId: Number(body.projectId) });
      break;
    case '/storyboard/project/splitSeriesAndInfer':
      result = { code: 501, msg: '剧本已保存在本机；分集推理和要素生成需要接入本地模型服务' };
      break;
    case '/nestjs/ai-video-tool/video-processor/storyboard-composition/tasks':
      result = ok({ items: [], total: 0 });
      break;
    case '/nestjs/tasks/running-count':
      result = ok({ count: 0, total: 0 });
      break;
    case '/nestjs/tasks':
      result = ok({ items: [], list: [], total: 0 });
      break;
    default:
      {
        const structuredRoute = path.match(/^\/nestjs\/structured-script-documents\/project\/(\d+)(?:\/(workspace|snapshot|replacement|prepare|submitted|release-preparation))?$/);
        const structuredEntry = structuredRoute && data.structuredDocuments[structuredRoute[1]];
        const structuredScene = path.match(/^\/nestjs\/structured-script-documents\/scenes\/([^/]+)$/);
        const structuredEpisode = path.match(/^\/nestjs\/structured-script-documents\/project\/(\d+)\/episodes\/([^/]+)$/);
        const structuredEpisodes = path.match(/^\/nestjs\/structured-script-documents\/project\/(\d+)\/episodes$/);
        const structuredEpisodeScenes = path.match(/^\/nestjs\/structured-script-documents\/project\/(\d+)\/episodes\/([^/]+)\/scenes$/);
        const structuredProjectScene = path.match(/^\/nestjs\/structured-script-documents\/project\/(\d+)\/scenes\/([^/]+)$/);
        const structuredItem = path.match(/^\/nestjs\/structured-script-documents\/project\/(\d+)\/items\/([^/]+)\/(outline|character-profiles|opening-hook)$/);
        const scriptForProject = path.match(/^\/nestjs\/scripts\/project\/(\d+)$/);
        const scriptById = path.match(/^\/nestjs\/scripts\/(\d+)$/);
        const activeStructuredTasks = path.match(/^\/nestjs\/structured-script-tasks\/project\/(\d+)$/);
        const canvasDocument = path.match(/^\/nestjs\/canvas\/(\d+)\/([^/]+)$/);
        const canvasPreview = path.match(/^\/nestjs\/canvas\/(\d+)\/([^/]+)\/collaboration\/preview$/);
        const canvasWorkflowOperations = path.match(/^\/nestjs\/canvas\/(\d+)\/([^/]+)\/workflow-operations$/);
        const canvasUpdate = path.match(/^\/nestjs\/canvas\/(\d+)\/([^/]+)\/update$/);
        const canvasBusinessData = path.match(/^\/nestjs\/canvas\/(\d+)\/([^/]+)\/nodes\/business-data\/query$/);
        const canvasChanges = path.match(/^\/nestjs\/canvas\/(\d+)\/([^/]+)\/changes$/);
        if (activeStructuredTasks && req.method === 'GET') {
          result = okStrict(null);
        } else if (structuredEpisodes && req.method === 'POST') {
          const entry = data.structuredDocuments[structuredEpisodes[1]];
          let episodeId;
          let sceneId;
          result = mutateStructuredDocument(entry, body.expectedRevision, document => {
            const episodeNumber = Number(body.episodeNumber);
            const sceneNumber = Number(body.sceneNumber);
            if (!Number.isInteger(episodeNumber) || episodeNumber < 1)
              return '集数必须是正整数';
            if (!Number.isInteger(sceneNumber) || sceneNumber < 1)
              return '场次必须是正整数';
            if (document.episodes.some(episode => episode.episodeNumber === episodeNumber))
              return '该集数已存在';
            if (!String(body.location || '').trim() || !String(body.content || '').trim())
              return '地点和正文不能为空';
            episodeId = `episode-${nextId()}`;
            sceneId = `scene-${nextId()}`;
            document.episodes.push({ id: episodeId, revision: 1,
              episodeNumber, episodeTitle: String(body.title || body.episodeTitle || ''),
              scenes: [{ id: sceneId, revision: 1, sceneNumber,
                location: String(body.location).trim(), timeOfDay: body.timeOfDay || null,
                space: body.space || null, content: String(body.content) }] });
            return null;
          });
          if (result.code === '0') result = okStrict({ ...result.result, episodeId, sceneId });
        } else if (structuredEpisodeScenes && req.method === 'POST') {
          const entry = data.structuredDocuments[structuredEpisodeScenes[1]];
          let sceneId;
          result = mutateStructuredDocument(entry, body.expectedRevision, document => {
            const episode = document.episodes.find(item => item.id === structuredEpisodeScenes[2]);
            if (!episode) return '剧集不存在';
            const sceneNumber = Number(body.sceneNumber);
            if (!Number.isInteger(sceneNumber) || sceneNumber < 1)
              return '场次必须是正整数';
            if (episode.scenes.some(scene => scene.sceneNumber === sceneNumber))
              return '该场次已存在';
            if (!String(body.location || '').trim() || !String(body.content || '').trim())
              return '地点和正文不能为空';
            sceneId = `scene-${nextId()}`;
            episode.scenes.push({ id: sceneId, revision: 1,
              sceneNumber, location: String(body.location).trim(),
              timeOfDay: body.timeOfDay || null, space: body.space || null,
              content: String(body.content) });
            return null;
          });
          if (result.code === '0') result = okStrict({ ...result.result,
            episodeId: structuredEpisodeScenes[2], sceneId });
        } else if (structuredEpisode && req.method === 'DELETE') {
          const entry = data.structuredDocuments[structuredEpisode[1]];
          const expectedRevision = new URL(req.url, 'http://localhost').searchParams.get('expectedRevision');
          result = mutateStructuredDocument(entry, expectedRevision, document => {
            const index = document.episodes.findIndex(item => item.id === structuredEpisode[2]);
            if (index < 0) return '剧集不存在';
            document.episodes.splice(index, 1);
            return null;
          });
        } else if (structuredProjectScene && req.method === 'DELETE') {
          const entry = data.structuredDocuments[structuredProjectScene[1]];
          const expectedRevision = new URL(req.url, 'http://localhost').searchParams.get('expectedRevision');
          result = mutateStructuredDocument(entry, expectedRevision, document => {
            for (const episode of document.episodes) {
              const index = episode.scenes.findIndex(scene => scene.id === structuredProjectScene[2]);
              if (index >= 0) { episode.scenes.splice(index, 1); return null; }
            }
            return '场次不存在';
          });
        } else if (structuredRoute && !structuredRoute[2] && req.method === 'DELETE') {
          if (!structuredEntry) result = { code: 404, msg: '剧本文档不存在' };
          else {
            delete data.structuredDocuments[structuredRoute[1]];
            save();
            result = okStrict({ projectId: Number(structuredRoute[1]) });
          }
        } else if (structuredRoute && req.method === 'POST' &&
          ['prepare', 'submitted', 'release-preparation'].includes(structuredRoute[2])) {
          const state = { prepare: 'preparing', submitted: 'submitted',
            'release-preparation': 'editing' }[structuredRoute[2]];
          result = mutateStructuredDocument(structuredEntry, body.expectedRevision,
            () => null, state);
          if (structuredRoute[2] === 'prepare' && result.code === '0')
            result = okStrict({ passed: true, revision: result.result.revision,
              issues: [], state, snapshot: structuredSnapshot(structuredEntry) });
        } else if (structuredScene && req.method === 'PUT') {
          const owner = structuredOwner(structuredScene[1], req, (document, entityId) =>
            document.episodes.flatMap(episode => episode.scenes).find(scene => scene.id === entityId));
          result = owner ? updateStructuredEntity(owner.entry, owner.entity, body,
            ['sceneNumber', 'location', 'timeOfDay', 'space', 'content'])
            : { code: 404, msg: '场次不存在' };
        } else if (structuredEpisode && req.method === 'PUT') {
          const entry = data.structuredDocuments[structuredEpisode[1]];
          const episode = entry?.document.episodes.find(item => item.id === structuredEpisode[2]);
          const update = { ...body };
          if (body.title !== undefined) update.episodeTitle = String(body.title);
          result = episode ? updateStructuredEntity(entry, episode, update,
            ['episodeNumber', 'episodeTitle']) : { code: 404, msg: '剧集不存在' };
        } else if (structuredItem && req.method === 'PUT') {
          const entry = data.structuredDocuments[structuredItem[1]];
          const key = { outline: 'outline', 'character-profiles': 'characterProfiles',
            'opening-hook': 'openingHook' }[structuredItem[3]];
          const entity = entry?.document[key];
          result = entity?.id === structuredItem[2] ? updateStructuredEntity(entry, entity, body,
            ['content', 'location', 'timeOfDay', 'space']) : { code: 404, msg: '剧本条目不存在' };
        } else if (structuredRoute && req.method === 'GET' && ['workspace', 'snapshot'].includes(structuredRoute[2])) {
          const sceneId = new URL(req.url, 'http://localhost').searchParams.get('sceneId');
          result = structuredEntry ? okStrict(structuredRoute[2] === 'snapshot'
            ? structuredSnapshot(structuredEntry) : structuredView(structuredEntry, sceneId))
            : { code: 404, msg: '当前项目尚无结构化剧本' };
        } else if (structuredRoute && structuredRoute[2] === 'replacement' && req.method === 'POST') {
          if (!structuredEntry) { result = { code: 404, msg: '剧本文档不存在' }; }
          else if (Number(body.expectedRevision) !== structuredEntry.revision) {
            result = { code: 409, msg: '剧本文档已被其他编辑更新' };
          } else {
            structuredEntry.document = structuredDocument(body.document || {}, Number(structuredRoute[1]));
            structuredEntry.revision += 1;
            structuredEntry.state = 'editing';
            structuredEntry.updatedAt = new Date().toISOString();
            save();
            result = okStrict(structuredView(structuredEntry));
          }
        } else if (scriptForProject && req.method === 'GET') {
          const script = data.scripts.findLast(item => item.projectId === Number(scriptForProject[1]));
          result = script ? okStrict(script) : { code: 404, msg: '当前项目尚未上传剧本' };
        } else if (scriptById && req.method === 'GET') {
          const script = data.scripts.find(item => item.id === Number(scriptById[1]));
          result = script ? okStrict(script) : { code: 404, msg: '剧本不存在' };
        } else if (scriptById && req.method === 'PUT') {
          const script = data.scripts.find(item => item.id === Number(scriptById[1]));
          if (!script) { result = { code: 404, msg: '剧本不存在' }; }
          else {
            if (body.remoteUrl !== undefined) script.remoteUrl = localUploadUrl(body.remoteUrl);
            if (body.title !== undefined) script.title = String(body.title);
            if (body.checkPassed !== undefined) script.checkPassed = Boolean(body.checkPassed);
            script.updatedAt = new Date().toISOString();
            save();
            result = okStrict(script);
          }
        } else if (canvasDocument && req.method === 'GET') {
          const projectId = Number(canvasDocument[1]);
          const document = canvasDocumentFor(projectId, canvasDocument[2]);
          document.canvas.projectUuid = canvasDocument[2];
          result = okStrict({ canvas: document.canvas, nodes: document.nodes.map(canvasNodeView),
            edges: document.edges, bootstrap: document.bootstrap });
        } else if (canvasUpdate && req.method === 'POST') {
          const projectId = Number(canvasUpdate[1]);
          const document = canvasDocumentFor(projectId, canvasUpdate[2]);
          const now = new Date().toISOString();
          const fromVersion = document.canvas.canvasVersion;
          const changedNodeKeys = new Set();
          const deletedNodeKeys = new Set();
          const changedEdgeIds = new Set();
          const deletedEdgeIds = new Set();
          const changedBusinessKeys = new Set();
          const created = Array.isArray(body.nodes?.create) ? body.nodes.create : [];
          const updated = Array.isArray(body.nodes?.update) ? body.nodes.update : [];
          const deleted = Array.isArray(body.nodes?.delete) ? body.nodes.delete : [];
          for (const node of created) {
            if (!node?.nodeKey || document.nodes.some(item => item.nodeKey === node.nodeKey)) continue;
            document.nodes.push({ ...node, createdAt: now, updatedAt: now });
            changedNodeKeys.add(node.nodeKey);
            if (node.businessData) {
              document.businessData[node.nodeKey] = node.businessData;
              changedBusinessKeys.add(node.nodeKey);
            }
          }
          for (const patch of updated) {
            const node = document.nodes.find(item => item.nodeKey === patch.nodeKey);
            if (node) {
              Object.assign(node, patch, { nodeData: { ...node.nodeData, ...patch.nodeData },
                layout: { ...node.layout, ...patch.layout }, updatedAt: now });
              changedNodeKeys.add(patch.nodeKey);
            }
            if (patch.businessData) {
              document.businessData[patch.nodeKey] = patch.businessData;
              changedBusinessKeys.add(patch.nodeKey);
            }
          }
          for (const item of deleted) {
            const nodeKey = typeof item === 'string' ? item : item?.nodeKey;
            document.nodes = document.nodes.filter(node => node.nodeKey !== nodeKey);
            delete document.businessData[nodeKey];
            if (nodeKey) { deletedNodeKeys.add(nodeKey); changedNodeKeys.delete(nodeKey); }
          }
          if (Array.isArray(body.edges?.create)) for (const edge of body.edges.create) {
            if (!edge?.connectionId) continue;
            document.edges.push(edge);
            changedEdgeIds.add(edge.connectionId);
          }
          if (Array.isArray(body.edges?.delete)) {
            const removed = new Set(body.edges.delete.map(item => typeof item === 'string' ? item : item.connectionId));
            document.edges = document.edges.filter(edge => !removed.has(edge.connectionId));
            for (const id of removed) {
              deletedEdgeIds.add(id);
              changedEdgeIds.delete(id);
            }
          }
          if (body.viewport) document.canvas.viewport = body.viewport;
          for (const item of body.businessData?.upsert || []) {
            if (item?.nodeKey) {
              document.businessData[item.nodeKey] = item.businessData || {};
              changedBusinessKeys.add(item.nodeKey);
            }
          }
          document.canvas.canvasVersion += 1;
          document.canvas.nodeCount = document.nodes.length;
          document.canvas.edgeCount = document.edges.length;
          document.canvas.updatedAt = now;
          document.changes.push({ fromVersion, toVersion: document.canvas.canvasVersion,
            viewport: document.canvas.viewport,
            nodes: { upsert: document.nodes.filter(node => changedNodeKeys.has(node.nodeKey))
              .map(canvasNodeView), delete: [...deletedNodeKeys] },
            edges: { upsert: document.edges.filter(edge => changedEdgeIds.has(edge.connectionId)),
              delete: [...deletedEdgeIds] },
            businessData: [...changedBusinessKeys].filter(nodeKey => !deletedNodeKeys.has(nodeKey))
              .map(nodeKey => ({ nodeKey,
                hasBusinessData: nodeKey in document.businessData,
                businessDataHash: String(document.canvas.canvasVersion) })) });
          if (document.changes.length > 100) document.changes.splice(0, document.changes.length - 100);
          const project = data.canvasProjects.find(item => item.projectId === projectId);
          if (project) { project.nodeCount = document.nodes.length; project.updateTime = now; }
          save();
          result = okStrict({ requestId: String(body.requestId || ''), status: 'success',
            canvasVersion: document.canvas.canvasVersion, nodeCount: document.nodes.length,
            edgeCount: document.edges.length, updatedAt: now });
        } else if (canvasBusinessData && req.method === 'POST') {
          const document = canvasDocumentFor(Number(canvasBusinessData[1]), canvasBusinessData[2]);
          const keys = Array.isArray(body.nodeKeys) ? body.nodeKeys : [];
          result = okStrict({ items: keys.filter(key => key in document.businessData).map(nodeKey => ({
            nodeKey, businessData: document.businessData[nodeKey], dataHash: String(document.canvas.canvasVersion),
          })), missing: keys.filter(key => !(key in document.businessData)), notModified: [] });
        } else if (canvasChanges && req.method === 'GET') {
          const document = canvasDocumentFor(Number(canvasChanges[1]), canvasChanges[2]);
          const sinceVersion = Number(new URL(req.url, 'http://localhost').searchParams.get('sinceVersion') ??
            document.canvas.canvasVersion);
          const changes = document.changes.filter(change => change.toVersion > sinceVersion);
          if (!Number.isSafeInteger(sinceVersion) || sinceVersion < 0 ||
              sinceVersion > document.canvas.canvasVersion ||
              sinceVersion < document.canvas.canvasVersion && !changes.length ||
              changes.length && changes[0].fromVersion !== sinceVersion) {
            result = { code: 409, msg: '画布版本已过期，请重新加载' };
          } else {
            const nodes = new Map();
            const deletedNodes = new Set();
            const edges = new Map();
            const deletedEdges = new Set();
            const businessData = new Map();
            for (const change of changes) {
              for (const node of change.nodes.upsert) {
                nodes.set(node.nodeKey, node);
                deletedNodes.delete(node.nodeKey);
              }
              for (const nodeKey of change.nodes.delete) {
                nodes.delete(nodeKey);
                deletedNodes.add(nodeKey);
                businessData.delete(nodeKey);
              }
              for (const edge of change.edges.upsert) {
                edges.set(edge.connectionId, edge);
                deletedEdges.delete(edge.connectionId);
              }
              for (const edgeId of change.edges.delete) {
                edges.delete(edgeId);
                deletedEdges.add(edgeId);
              }
              for (const item of change.businessData) businessData.set(item.nodeKey, item);
            }
            result = okStrict({ fromVersion: sinceVersion,
              toVersion: document.canvas.canvasVersion, viewport: document.canvas.viewport,
              nodes: { upsert: [...nodes.values()], delete: [...deletedNodes] },
              edges: { upsert: [...edges.values()], delete: [...deletedEdges] },
              businessData: [...businessData.values()] });
          }
        } else if (canvasPreview && req.method === 'GET') {
          result = okStrict({ initialized: false, projectId: Number(canvasPreview[1]),
            projectUuid: canvasPreview[2] });
        } else if (canvasWorkflowOperations && req.method === 'GET') {
          result = okStrict({ items: [], total: 0 });
        } else result = unsupported(path);
      }
      break;
  }

  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(result));
}
