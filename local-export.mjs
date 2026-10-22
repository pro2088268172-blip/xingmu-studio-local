import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const mediaTypes = {
  image: { folder: 'image', extensions: new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']) },
  video: { folder: 'video', extensions: new Set(['.mp4']) },
  audio: { folder: 'dubbing', extensions: new Set(['.mp3', '.wav']) },
  subtitle: { folder: 'srt', extensions: new Set(['.srt']) },
};

const result = value => ({ code: 0, result: value });
const failure = (code, msg) => ({ code, msg });
const identifier = value => {
  const hex = createHash('sha256').update(String(value)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const mediaUrl = value => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  for (const candidate of [value.url, value.resourceUrl, value.videoUrl,
    value.imageUrl, value.fileUrl]) {
    const url = Array.isArray(candidate) ? candidate[0] : candidate;
    if (typeof url === 'string' && url) return url;
  }
  return null;
};
const localFile = (root, raw, type) => {
  const url = mediaUrl(raw);
  const rule = mediaTypes[type];
  if (!url || !rule) return null;
  let pathname = url;
  if (/^https?:\/\//i.test(url)) {
    try { pathname = new URL(url).pathname; }
    catch { return null; }
  }
  if (pathname.startsWith('local-upload/')) pathname = `/${pathname}`;
  if (!new RegExp(`^/local-upload/${rule.folder}/[A-Za-z0-9_-]+\\.[A-Za-z0-9]+$`, 'i').test(pathname)) return null;
  if (!rule.extensions.has(extname(pathname).toLowerCase())) return null;
  return existsSync(join(root, pathname.slice(1))) ? pathname : null;
};
const seriesContext = (data, body) => {
  const seriesId = Number(body.seriesId);
  const series = data.series.find(item => item.id === seriesId);
  const project = series && data.projects.find(item => item.id === series.projectId);
  if (!series || !project || body.projectId && Number(body.projectId) !== project.id) return null;
  const shots = data.shots.filter(item => item.seriesId === seriesId)
    .sort((a, b) => Number(a.boardIndex) - Number(b.boardIndex));
  return { series, project, shots };
};
const shotDuration = shot => Math.max(1, Math.round((Number(shot.duration) || 2) * 1_000_000));

export function describeSeriesMedia(data, body, root) {
  const context = seriesContext(data, body);
  if (!context) return failure(404, '剧集不存在');
  const list = context.shots.map(shot => {
    const images = (shot.imageList || []).map(item => localFile(root, item, 'image')).filter(Boolean);
    const videos = (shot.videoList || []).map(item => localFile(root, item, 'video')).filter(Boolean);
    return { id: shot.id, storyBoardId: shot.id, boardIndex: shot.boardIndex,
      imageCount: images.length, videoCount: videos.length,
      enhanceVideoTaskStatus: 0, duration: Number(shot.duration) || 2 };
  });
  const totalImageCount = list.reduce((count, item) => count + item.imageCount, 0);
  const totalVideoCount = list.reduce((count, item) => count + item.videoCount, 0);
  return result({ total: list.length, totalImageCount, totalVideoCount,
    totalEnhanceVideoCount: 0, totalPendingDuration: list.reduce((seconds, item) =>
      seconds + (item.videoCount ? item.duration : 0), 0), totalPendingToken: 0, list });
}

export function prepareSeriesExport(data, body, root) {
  const context = seriesContext(data, body);
  if (!context) return failure(404, '剧集不存在');
  const { series, project, shots } = context;
  const materials = [];
  const draftVideos = [];
  const draftAudios = [];
  const imageSegments = [];
  const videoSegments = [];
  const draftMetaMaterials = [];
  const now = Date.now();
  let timelineStart = 0;

  for (const shot of shots) {
    const number = String(shot.boardIndex || 1).padStart(3, '0');
    const duration = shotDuration(shot);
    const mediaByType = { image: [], video: [] };
    for (const type of ['image', 'video']) {
      for (const [index, item] of (shot[type === 'image' ? 'imageList' : 'videoList'] || []).entries()) {
        const url = localFile(root, item, type);
        if (!url) continue;
        const path = `media/shot-${number}-${type}-${index + 1}${extname(url).toLowerCase()}`;
        const id = identifier(`${project.id}:${series.id}:${shot.id}:${type}:${index}:${url}`);
        const material = { url, path, type: type === 'image' ? 'photo' : 'video' };
        materials.push(material);
        const entry = { id, path, type: material.type, duration,
          width: project.proportion === '16:9' ? 1920 : 1080,
          height: project.proportion === '16:9' ? 1080 : 1920,
          material_name: path.split('/').at(-1), create_time: now };
        draftVideos.push(entry);
        mediaByType[type].push(entry);
        draftMetaMaterials.push({ type: type === 'image' ? 1 : 0, entry });
      }
    }
    const chosen = mediaByType.video.at(-1) || mediaByType.image.at(-1);
    if (chosen) {
      const segment = { id: identifier(`segment:${chosen.id}`), material_id: chosen.id,
        target_timerange: { start: timelineStart, duration },
        source_timerange: { start: 0, duration },
        clip: { rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 } } };
      (chosen.type === 'video' ? videoSegments : imageSegments).push(segment);
    }
    timelineStart += duration;
  }

  for (const [index, item] of (series.dubbingFiles || []).entries()) {
    const url = localFile(root, item, 'audio');
    if (!url) continue;
    const path = `media/dubbing-${index + 1}${extname(url).toLowerCase()}`;
    materials.push({ url, path, type: 'audio' });
    draftAudios.push({ id: identifier(`audio:${series.id}:${url}`), path, type: 'audio',
      category: 'audio', duration: timelineStart, name: path.split('/').at(-1),
      create_time: now });
  }
  for (const [index, item] of (series.subtitleFiles || []).entries()) {
    const url = localFile(root, item, 'subtitle');
    if (url) materials.push({ url, path: `media/subtitles-${index + 1}.srt`, type: 'subtitle' });
  }
  if (!draftVideos.length && !draftAudios.length)
    return failure(400, '当前剧集没有可导出的图片、视频或配音');

  const tracks = [];
  if (imageSegments.length) tracks.push({ id: identifier(`image-track:${series.id}`),
    type: 'photo', segments: imageSegments });
  if (videoSegments.length) tracks.push({ id: identifier(`video-track:${series.id}`),
    type: 'video', segments: videoSegments });
  if (draftAudios.length) tracks.push({ id: identifier(`audio-track:${series.id}`),
    type: 'audio', segments: [{ id: identifier(`audio-segment:${series.id}`),
      material_id: draftAudios[0].id, material_type: 'audio',
      target_timerange: { start: 0, duration: timelineStart },
      source_timerange: { start: 0, duration: timelineStart },
      volume: 1, speed: 1 }] });
  const draftId = identifier(`draft:${project.id}:${series.id}`);
  const draftInfo = { id: draftId, create_time: now * 1000,
    update_time: now * 1000, duration: timelineStart, fps: 30,
    platform: { os: 'windows' }, last_modified_platform: { os: 'windows' },
    canvas_config: { width: project.proportion === '16:9' ? 1920 : 1080,
      height: project.proportion === '16:9' ? 1080 : 1920,
      ratio: project.proportion || '9:16' },
    materials: { adjusts: [], audios: draftAudios, effects: [], filters: [],
      handwrites: [], stickers: [], texts: [], videos: draftVideos }, tracks };
  const draftMetaInfo = { draft_id: draftId, tm_draft_create: Math.floor(now / 1000),
    tm_draft_modified: Math.floor(now / 1000), tm_duration: timelineStart,
    draft_materials: [0, 1].map(type => ({ type,
      value: draftMetaMaterials.filter(item => item.type === type).map(({ entry }) => ({
        id: entry.id, file_Path: entry.path, duration: entry.duration,
        width: entry.width, height: entry.height, create_time: entry.create_time,
        import_time_ms: now, item_source: 0, extra_info: entry.material_name,
      })) })) };
  return result({ materials, draftInfo, draftMetaInfo });
}
