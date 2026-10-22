import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dataPath = process.env.JZZM_LOCAL_DATA || join(import.meta.dirname, 'local-data.json');
const empty = () => ({ nextId: 1000, projects: [], series: [], shots: [], folders: [], library: [], resources: [], canvasProjects: [], canvasFolders: [] });
let data = empty();
if (existsSync(dataPath)) {
  try { data = { ...empty(), ...JSON.parse(readFileSync(dataPath, 'utf8')) }; }
  catch { /* Preserve the unreadable file; start with an empty in-memory state. */ }
}
data.series = data.series.map(series => ({
  timeDuration: 0, totalStoryBoardCount: 0, completedStoryBoardCount: 0, ...series,
}));
data.projects = data.projects.map(project => ({ userId: 1, ...project, modeType: project.modeType === 2 ? 3 : project.modeType }));
data.shots = data.shots.map((shot, index) => ({
  boardIndex: index + 1, name: `分镜${index + 1}`, shotTitle: `分镜${index + 1}`,
  produceType: 1, duration: 2, imageList: [], videoList: [],
  imagePrompt: '', videoPrompt: '', ...shot,
}));
data.canvasProjects ||= [];
data.canvasFolders ||= [];
data.canvasDocuments ||= {};
data.resources ||= [];
const localUploadUrl = value => typeof value === 'string'
  ? value.replace(/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?=\/local-upload\/)/, '')
  : value;
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
  return { items: pageItems, list: pageItems, total: items.length, page, size };
};
const canvasProjectView = project => ({
  ...project,
  projectId: project.projectId,
  creatorUserId: 1,
  spaceType: 'MY',
  readOnly: false,
  capabilities: {
    canEdit: true, canRename: true, canDelete: true, canUpdateCover: true,
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
    nodes: [], edges: [], businessData: {}, bootstrap: {},
  };
  return data.canvasDocuments[key];
};
const canvasNodeView = node => ({ ...node, ...node.layout });

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
      if (body.isStar) resources = resources.filter(item => item.isStar);
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
        characterResources: images, isStar: false,
        createTime: new Date().toISOString(), updateTime: new Date().toISOString() };
      data.resources.push(resource);
      save();
      result = ok(resource);
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
    case '/user/resource/getResourceInfo': {
      const resourceId = Number(body.resourceId || body.id);
      result = ok(data.resources.find(item => item.id === resourceId ||
        item.characterResources?.some(image => image.id === resourceId)) || null);
      break;
    }
    case '/user/resource/starResource': {
      const resource = data.resources.find(item => item.id === id);
      if (resource) { resource.isStar = !resource.isStar; save(); }
      result = ok(resource || null);
      break;
    }
    case '/user/resource/updateParentMainResource': {
      const resource = data.resources.find(item => item.id === Number(body.parentId || body.parentResourceId || body.id));
      if (resource) {
        const imageId = Number(body.resourceId || body.subResourceId || body.characterResourceId);
        for (const image of resource.characterResources || []) image.isMain = image.id === imageId;
        save();
      }
      result = ok(resource || null);
      break;
    }
    case '/storyboard/project/getIndex':
    case '/storyboard/project/getProjects':
    case '/storyboard/project/getAllProjects':
    case '/storyboard/project/getProjectLibraryProjects':
    case '/storyboard/project/getMyCreatedProjects':
    case '/storyboard/project/getUserProjects':
    case '/storyboard/project/getTeamProjects':
    case '/storyboard/project/getAssetImportProjects':
      result = ok(list([...data.projects].reverse(), body));
      break;
    case '/storyboard/project/getMyManageProjects':
    case '/storyboard/project/getMyCooperatingProjects':
      result = ok(list([], body));
      break;
    case '/storyboard/project/checkUserProjectName':
      result = ok({ exists: data.projects.some(project => project.name === (body.Name || body.name)) });
      break;
    case '/storyboard/project/createFreeProject': {
      const projectId = nextId();
      const seriesId = nextId();
      data.projects.push({
        id: projectId, projectId, userId: 1, name: String(body.name || '未命名项目'),
        dramaName: String(body.name || '未命名项目'), modeType: 3,
        proportion: body.proportion || '9:16',
        picLLM: body.picLLM || '', videoLLm: body.videoLLm || '',
        createTime: new Date().toISOString(), updateTime: new Date().toISOString(),
      });
      data.series.push({ id: seriesId, seriesId, projectId, name: '第1集', title: '第1集', sort: 1,
        timeDuration: 0, totalStoryBoardCount: 0, completedStoryBoardCount: 0 });
      save();
      result = ok({ id: projectId, projectId, seriesId });
      break;
    }
    case '/storyboard/project/getProjectInfo':
      result = ok(data.projects.find(project => project.id === id) || null);
      break;
    case '/storyboard/project/updateProjectName':
    case '/storyboard/project/editProject':
    case '/storyboard/project/updateProject': {
      const project = data.projects.find(item => item.id === id);
      if (project) {
        Object.assign(project, body, { id: project.id, projectId: project.id, userId: 1,
          name: String(body.name || project.name), updateTime: new Date().toISOString() });
        save();
      }
      result = ok(project || null);
      break;
    }
    case '/storyboard/project/deleteProject':
      {
      const seriesIds = new Set(data.series.filter(series => series.projectId === id).map(series => series.id));
      data.projects = data.projects.filter(project => project.id !== id);
      data.series = data.series.filter(series => series.projectId !== id);
      data.shots = data.shots.filter(shot => !seriesIds.has(shot.seriesId));
      data.library = data.library.filter(item => item.projectId !== id);
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
    case '/storyboard/series/createSeries':
    case '/storyboard/project/createSeries': {
      const projectId = Number(body.projectId);
      const seriesId = nextId();
      const index = data.series.filter(series => series.projectId === projectId).length + 1;
      const name = String(body.name || body.title || `第${index}集`);
      const series = { id: seriesId, seriesId, projectId, name, title: name, sort: index,
        timeDuration: 0, totalStoryBoardCount: 0, completedStoryBoardCount: 0 };
      data.series.push(series);
      save();
      result = ok(series);
      break;
    }
    case '/storyboard/series/updateSeries': {
      const series = data.series.find(item => item.id === id);
      if (series) Object.assign(series, body, { id: series.id, seriesId: series.id });
      save();
      result = ok(series || null);
      break;
    }
    case '/storyboard/series/deleteSeries':
      data.series = data.series.filter(series => series.id !== id);
      data.shots = data.shots.filter(shot => shot.seriesId !== id);
      save();
      result = ok(true);
      break;
    case '/storyboard/series/checkSeriesName':
      result = ok({ exists: data.series.some(series => series.projectId === Number(body.projectId) && series.name === body.name) });
      break;
    case '/storyboard/api/list':
      result = ok(list(data.shots.filter(shot => shot.seriesId === Number(body.seriesId)), body));
      break;
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
      const item = data.library.find(item => item.id === id);
      if (item) Object.assign(item, body, { id: item.id });
      save();
      result = ok(item || null);
      break;
    }
    case '/storyboard/api/deleteProjectLibrary':
      data.library = data.library.filter(item => item.id !== id);
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
      if (image) Object.assign(image, body, { id: image.id,
        resourceUrl: (Array.isArray(body.resourceUrl) ? body.resourceUrl : [body.resourceUrl || image.resourceUrl].flat()).map(localUploadUrl) });
      save();
      result = ok(image || null);
      break;
    }
    case '/storyboard/api/deleteProjectLibraryImage': {
      const item = data.library.find(item => item.images?.some(image => image.id === id));
      if (item) item.images = item.images.filter(image => image.id !== id);
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
      if (shot) Object.assign(shot, body, { id: shotId });
      else {
        const boardIndex = data.shots.filter(item => item.seriesId === Number(body.seriesId)).length + 1;
        shot = { boardIndex, name: `分镜${boardIndex}`, shotTitle: `分镜${boardIndex}`,
          produceType: 1, duration: 2, imageList: [], videoList: [], imagePrompt: '', videoPrompt: '',
          ...body, id: shotId, storyBoardId: shotId, seriesId: Number(body.seriesId) };
        data.shots.push(shot);
      }
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
        changed = true;
      } else if (actionType === 1 && target && shots.length > 1) {
        const index = shots.indexOf(target);
        const next = shots[index + 1];
        if (next) {
          target.originText = [target.originText, next.originText].filter(Boolean).join('\n');
          target.duration = (Number(target.duration) || 2) + (Number(next.duration) || 2);
          data.shots.splice(data.shots.indexOf(next), 1);
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
    case '/storyboard/plaza/home':
      result = ok({ banners: [], recommendations: [], items: [] });
      break;
    case '/storyboard/plaza/content/list':
      result = ok(list([], body));
      break;
    case '/storyboard/api/historyList':
      result = ok(list([], body));
      break;
    case '/storyboard/imagePreset/list':
      result = ok({ items: [], total: 0 });
      break;
    case '/storyboard/voiceTone/list':
    case '/storyboard/artstyle/listPublic':
    case '/storyboard/endpoint/list':
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
        const canvasDocument = path.match(/^\/nestjs\/canvas\/(\d+)\/([^/]+)$/);
        const canvasPreview = path.match(/^\/nestjs\/canvas\/(\d+)\/([^/]+)\/collaboration\/preview$/);
        const canvasWorkflowOperations = path.match(/^\/nestjs\/canvas\/(\d+)\/([^/]+)\/workflow-operations$/);
        const canvasUpdate = path.match(/^\/nestjs\/canvas\/(\d+)\/([^/]+)\/update$/);
        const canvasBusinessData = path.match(/^\/nestjs\/canvas\/(\d+)\/([^/]+)\/nodes\/business-data\/query$/);
        const canvasChanges = path.match(/^\/nestjs\/canvas\/(\d+)\/([^/]+)\/changes$/);
        if (canvasDocument && req.method === 'GET') {
          const projectId = Number(canvasDocument[1]);
          const document = canvasDocumentFor(projectId, canvasDocument[2]);
          document.canvas.projectUuid = canvasDocument[2];
          result = okStrict({ canvas: document.canvas, nodes: document.nodes.map(canvasNodeView),
            edges: document.edges, bootstrap: document.bootstrap });
        } else if (canvasUpdate && req.method === 'POST') {
          const projectId = Number(canvasUpdate[1]);
          const document = canvasDocumentFor(projectId, canvasUpdate[2]);
          const now = new Date().toISOString();
          const created = Array.isArray(body.nodes?.create) ? body.nodes.create : [];
          const updated = Array.isArray(body.nodes?.update) ? body.nodes.update : [];
          const deleted = Array.isArray(body.nodes?.delete) ? body.nodes.delete : [];
          for (const node of created) {
            if (!node?.nodeKey || document.nodes.some(item => item.nodeKey === node.nodeKey)) continue;
            document.nodes.push({ ...node, createdAt: now, updatedAt: now });
            if (node.businessData) document.businessData[node.nodeKey] = node.businessData;
          }
          for (const patch of updated) {
            const node = document.nodes.find(item => item.nodeKey === patch.nodeKey);
            if (node) Object.assign(node, patch, { nodeData: { ...node.nodeData, ...patch.nodeData },
              layout: { ...node.layout, ...patch.layout }, updatedAt: now });
            if (patch.businessData) document.businessData[patch.nodeKey] = patch.businessData;
          }
          for (const item of deleted) {
            const nodeKey = typeof item === 'string' ? item : item?.nodeKey;
            document.nodes = document.nodes.filter(node => node.nodeKey !== nodeKey);
            delete document.businessData[nodeKey];
          }
          if (Array.isArray(body.edges?.create)) document.edges.push(...body.edges.create);
          if (Array.isArray(body.edges?.delete)) {
            const removed = new Set(body.edges.delete.map(item => typeof item === 'string' ? item : item.connectionId));
            document.edges = document.edges.filter(edge => !removed.has(edge.connectionId));
          }
          if (body.viewport) document.canvas.viewport = body.viewport;
          for (const item of body.businessData?.upsert || []) {
            if (item?.nodeKey) document.businessData[item.nodeKey] = item.businessData || {};
          }
          document.canvas.canvasVersion += 1;
          document.canvas.nodeCount = document.nodes.length;
          document.canvas.edgeCount = document.edges.length;
          document.canvas.updatedAt = now;
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
          result = okStrict({ fromVersion: document.canvas.canvasVersion, toVersion: document.canvas.canvasVersion,
            viewport: document.canvas.viewport, nodes: { upsert: [], delete: [] },
            edges: { upsert: [], delete: [] }, businessData: [] });
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
