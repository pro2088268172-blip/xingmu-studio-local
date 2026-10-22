import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fallback = join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime',
  'dependencies', 'node', 'node_modules', 'playwright', 'index.mjs');
const { chromium } = await import('playwright').catch(() => import(pathToFileURL(fallback).href));
const browser = await chromium.launch({
  executablePath: join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  headless: true,
});

const defs = `<defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#28D3CF"/><stop offset="1" stop-color="#8C69F4"/></linearGradient></defs>`;
function icon(x, y, size) {
  return `<g transform="translate(${x} ${y}) scale(${size / 100})">
    <rect x="3" y="3" width="94" height="94" rx="25" fill="url(#g)"/>
    <rect x="21" y="28" width="58" height="47" rx="10" fill="none" stroke="white" stroke-width="6"/>
    <path d="M21 43h58M36 28v15M64 28v15" stroke="white" stroke-width="5"/>
    <path d="M44 51v16l15-8z" fill="white"/>
    <path d="M78 9l2.5 6.5L87 18l-6.5 2.5L78 27l-2.5-6.5L69 18l6.5-2.5z" fill="#FFE28C"/>
  </g>`;
}
function svg(width, height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defs}${content}</svg>`;
}
function wordmark(width, height, iconSize, fontSize, gap = 18) {
  const x = Math.round((width - (iconSize + gap + 4 * fontSize)) / 2);
  const y = Math.round((height - iconSize) / 2);
  return svg(width, height, `${icon(x, y, iconSize)}<text x="${x + iconSize + gap}" y="${height / 2 + fontSize * .36}" fill="white" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-weight="700" font-size="${fontSize}" letter-spacing="1">星幕工坊</text>`);
}
const assets = [
  ['ai_comic/production/loginlogo.png', wordmark(589, 198, 140, 94)],
  ['ai_comic/production/assets/Logo-DUHS0nL2.png', wordmark(532, 204, 135, 76)],
  ['logo.png', wordmark(444, 140, 105, 72)],
  ['ai_comic/production/assets/manage-logo-R41NT-OZ.png', svg(215, 215, icon(8, 8, 199))],
  ['branding/icon-256.png', svg(256, 256, icon(0, 0, 256))],
  ['ai_comic/production/assets/logo-DcAogcBV.png', svg(1395, 784,
    `<rect width="1395" height="784" fill="#242223"/><g opacity="0.12">${icon(360, 305, 155)}<text x="540" y="414" fill="white" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="95" font-weight="700">星幕工坊</text></g>`) ],
];

async function render(contents) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<body style="margin:0;background:transparent">${contents}</body>`);
    await page.evaluate(() => document.fonts.ready);
    return await page.locator('svg').screenshot({ omitBackground: true });
  } finally { await page.close(); }
}
try {
  await mkdir(join(root, 'branding'), { recursive: true });
  const iconSvg = svg(256, 256, icon(0, 0, 256));
  await writeFile(join(root, 'branding', 'icon.svg'), iconSvg);
  await writeFile(join(root, 'branding', 'wordmark.svg'), wordmark(589, 198, 140, 94));
  for (const [name, contents] of assets) {
    const dest = join(root, name);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, await render(contents));
  }
  const png = await render(iconSvg);
  const ico = Buffer.alloc(22 + png.length);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(1, 4);
  ico.writeUInt16LE(1, 10);
  ico.writeUInt16LE(32, 12);
  ico.writeUInt32LE(png.length, 14);
  ico.writeUInt32LE(22, 18);
  png.copy(ico, 22);
  await writeFile(join(root, 'ai_comic', 'production', 'favicon.ico'), ico);
  console.log('星幕工坊图标已生成。');
} finally { await browser.close(); }
