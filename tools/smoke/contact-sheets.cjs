// Puts the pictures of a smoke report on a few sheets, so a person (or a
// reviewer with a picture budget) can look at every widget and every settings
// page without opening a hundred files.
//
// Run with the repository's Electron, not Node, and not the app:
//   node_modules\electron\dist\electron.exe tools\smoke\contact-sheets.cjs <report folder>
//
// It is a bare page in a window that is never shown, with a user-data folder
// of its own in the system's temporary folder: it reads the report's pictures
// and writes <report folder>/sheets/*.png, nothing else.
//
// SMOKE_SHEET_PAGES=<n> puts n settings pictures on a sheet instead of 4, and
// SMOKE_SHEET_FIRST=1 takes only the first picture of each settings page (a
// long page has several), for a quick look at all of them.
/* eslint-disable @typescript-eslint/no-require-imports -- run by Electron as plain CommonJS */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const reportDir = path.resolve(process.argv[process.argv.length - 1]);
const shots = path.join(reportDir, 'shots');
const sheets = path.join(reportDir, 'sheets');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-sheets-'));
app.setPath('userData', userData);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => undefined);

const pngs = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.png'))
        .sort()
        .map((name) => path.join(dir, name))
    : [];

const chunk = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, index * size + size)
  );

/** One sheet: pictures in a wrapping row, each under its file name. */
function page(files, width, imageWidth) {
  const items = files
    .map(
      (file) => `<figure><figcaption>${path.basename(file, '.png')}</figcaption>
<img src="${pathToFileURL(file).href}" ${imageWidth ? `width="${imageWidth}"` : ''}></figure>`
    )
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:10px;width:${width - 20}px;background:#0b0f14;color:#e2e8f0;font:13px sans-serif;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
figure{margin:0;border:1px solid #334155;background:#181c24}
figcaption{padding:2px 6px;background:#1e293b;color:#fbbf24}
img{display:block;max-width:${width - 40}px}
</style>${items}`;
}

async function render(name, html, width) {
  const file = path.join(userData, `${name}.html`);
  fs.writeFileSync(file, html);
  const window = new BrowserWindow({
    show: false,
    width,
    height: 800,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true },
  });
  await window.loadFile(file);
  const height = await window.webContents.executeJavaScript(
    `Promise.all([...document.images].map((i) => i.decode().catch(() => undefined))).then(() => document.documentElement.scrollHeight)`
  );
  window.setContentSize(width, Math.min(Number(height) + 10, 6000));
  await new Promise((done) => setTimeout(done, 700));
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(sheets, `${name}.png`), image.toPNG());
  window.destroy();
  process.stdout.write(`${path.join(sheets, `${name}.png`)}\n`);
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(sheets, { recursive: true });
    const captures = fs.existsSync(shots)
      ? fs.readdirSync(shots).filter((name) => /^capture\d+$/.test(name))
      : [];
    for (const capture of captures.sort()) {
      const widgets = pngs(path.join(shots, capture)).filter(
        (file) => !path.basename(file).startsWith('window-')
      );
      for (const [index, files] of chunk(widgets, 12).entries()) {
        await render(
          `widgets-${capture}-${index + 1}`,
          page(files, 1500, 0),
          1500
        );
      }
    }
    const perSheet = Math.max(1, Number(process.env.SMOKE_SHEET_PAGES) || 4);
    const columns = perSheet > 4 ? 3 : 2;
    const settings = pngs(path.join(shots, 'settings')).filter(
      (file) =>
        process.env.SMOKE_SHEET_FIRST !== '1' ||
        !/-\d\.png$/.test(path.basename(file))
    );
    for (const [index, files] of chunk(settings, perSheet).entries()) {
      await render(
        `settings-${String(index + 1).padStart(2, '0')}`,
        page(files, 1540, Math.floor(1480 / columns) - 14),
        1540
      );
    }
  } catch (error) {
    process.stderr.write(`${error && error.stack}\n`);
    process.exitCode = 1;
  } finally {
    app.exit(process.exitCode ?? 0);
  }
});
