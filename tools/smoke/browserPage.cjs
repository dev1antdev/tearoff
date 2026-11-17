// Opens one page of the app's built-in web server as a browser on this
// machine does, waits for it to draw, photographs it and says what it saw.
// The smoke run uses it for /pitwall: asking the server for the page shows
// that the page is served, not that a browser can draw it.
//
// Run with the repository's Electron, not Node, and not the app:
//   node_modules\electron\dist\electron.exe tools\smoke\browserPage.cjs <picture.png> <url>
// The address comes last: Electron refuses to start on a command line that
// has anything after an address (it exits at once and says nothing).
//
// It is a bare browser window that is never shown, with a user-data folder of
// its own: SMOKE_PAGE_USER_DATA, which the smoke run makes and removes, or a
// new one in the system's temporary folder, which stays there. The page gets
// no preload, no Node and no bridge of the app's: what it has is what a
// tablet's browser has, the page and its connection to the server.
//
// What it saw is one line on standard output, `SMOKE_PAGE ` and then JSON:
// the status the server answered with, whether the page's own element was
// found (in whichever frame: the server's page is a frame around the real
// one), its `data-` attributes, how much text it drew, the text of that
// frame, the errors and warnings of the page's console, and whether a
// picture was written. Judging that is the caller's.
//
// SMOKE_PAGE_SELECTOR=<css> is the element that says the page has drawn
// (`main[data-layout]`, the Pit Wall's), SMOKE_PAGE_WAIT_MS how long to wait
// for it (30000), SMOKE_PAGE_SETTLE_MS how long to let it fill after that
// (4000) and SMOKE_PAGE_SIZE the window's size (`1600x900`).
/* eslint-disable @typescript-eslint/no-require-imports -- run by Electron as plain CommonJS */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const [file, url] = process.argv.slice(2);
const givenUserData = process.env.SMOKE_PAGE_USER_DATA;
const selector = process.env.SMOKE_PAGE_SELECTOR || 'main[data-layout]';
const waitMs = Number(process.env.SMOKE_PAGE_WAIT_MS) || 30000;
const settleMs = Number(process.env.SMOKE_PAGE_SETTLE_MS) || 4000;
const [width, height] = (process.env.SMOKE_PAGE_SIZE || '1600x900')
  .split('x')
  .map((side) => Math.max(200, Number(side) || 0));

/** The most of a page's text, and of its console, that is handed back. */
const TEXT_LIMIT = 20000;
const LINE_LIMIT = 500;
const LINES_LIMIT = 20;

const userData = givenUserData
  ? path.resolve(givenUserData)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'tearoff-smoke-page-'));
app.setPath('userData', userData);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => undefined);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Run inside a frame: the element that says the page has drawn, if it is there. */
const READ = `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return null;
  const attributes = {};
  for (const attribute of element.attributes) {
    if (attribute.name.startsWith('data-')) {
      attributes[attribute.name] = attribute.value;
    }
  }
  return {
    drawn: (element.innerText || '').trim().length,
    attributes,
    text: (document.body ? document.body.innerText : '').slice(0, ${TEXT_LIMIT}),
  };
})()`;

/** The frame that has the element, and what it reads there. */
async function readPage(contents) {
  let found = null;
  for (const frame of contents.mainFrame.framesInSubtree) {
    const read = await frame.executeJavaScript(READ).catch(() => null);
    if (!read) continue;
    const seen = { frame: frame.url, ...read };
    if (seen.drawn > 0) return seen;
    found = found ?? seen;
  }
  return found;
}

app.whenReady().then(async () => {
  const seen = {
    url: url ?? null,
    status: null,
    found: false,
    frame: null,
    attributes: {},
    drawn: 0,
    text: '',
    errors: [],
    warnings: 0,
    pictured: false,
    failure: null,
  };
  const error = (text) => {
    if (seen.errors.length < LINES_LIMIT) {
      seen.errors.push(String(text).slice(0, LINE_LIMIT));
    }
  };
  let window;
  try {
    if (!url || !file) {
      throw new Error('usage: electron browserPage.cjs <picture.png> <url>');
    }
    window = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const contents = window.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('console-message', (event) => {
      if (event.level === 'error') error(event.message);
      else if (event.level === 'warning') seen.warnings += 1;
    });
    contents.on('did-navigate', (_event, _url, status) => {
      seen.status = typeof status === 'number' && status > 0 ? status : null;
    });
    contents.on('render-process-gone', (_event, details) =>
      error(`the page's process is gone: ${details && details.reason}`)
    );

    // The size is set through the debugger rather than the window: a window
    // is cut down to the screen it is on, and the picture should not depend
    // on the screen of the machine that takes it.
    const cdp = contents.debugger;
    cdp.attach('1.3');
    await contents.loadURL(url);
    await cdp.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const deadline = Date.now() + waitMs;
    let read = null;
    while (Date.now() < deadline) {
      read = await readPage(contents);
      if (read && read.drawn > 0) break;
      await sleep(250);
    }
    if (read && read.drawn > 0) {
      // Drawn; what a panel asks the app for comes a moment later.
      await sleep(settleMs);
      read = (await readPage(contents)) ?? read;
    }
    if (read) {
      seen.found = true;
      seen.frame = read.frame;
      seen.attributes = read.attributes;
      seen.drawn = read.drawn;
      seen.text = read.text;
    }
    // Photographed whatever became of it: a page that did not draw is
    // worth seeing as well.
    const shot = await cdp.sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(path.resolve(file), Buffer.from(shot.data, 'base64'));
    seen.pictured = true;
  } catch (failure) {
    seen.failure = String((failure && failure.message) || failure);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    process.stdout.write(`SMOKE_PAGE ${JSON.stringify(seen)}\n`, () =>
      app.exit(0)
    );
  }
});
