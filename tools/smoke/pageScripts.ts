/**
 * Scripts run inside the app's windows over the debugging port. They are
 * strings, not functions: a function serialised from this file would carry
 * the bundler's helpers, which do not exist in the page.
 */

export interface WidgetBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The widget's content scale in percent. */
  scale: number;
  /** What a person would read in the box. */
  text: string;
  /** Canvases, drawings and images that take up room. */
  media: number;
  /** Elements with a background of their own. */
  painted: number;
  /** Elements the widget rendered at all. */
  elements: number;
  /** Whether the box or something above it is hidden or transparent. */
  hidden: boolean;
  /** How far the content runs past the box, in its own pixels. */
  overflowX: number;
  overflowY: number;
}

/** Every widget box of an overlay window, with what is drawn in it. */
export const READ_WIDGET_BOXES = `(() => {
  const visible = (node) => {
    const box = node.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    const style = getComputedStyle(node);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const boxes = [];
  for (const el of document.querySelectorAll('[data-widget-id]')) {
    // A widget can mark parts of itself the same way (the fuel widget's
    // boxes): only the outermost element is the widget.
    if (el.parentElement && el.parentElement.closest('[data-widget-id]')) continue;
    el.setAttribute('data-smoke-widget', '');
    const rect = el.getBoundingClientRect();
    const scaleEl = el.querySelector('[data-widget-scale]');
    const content = (scaleEl && scaleEl.firstElementChild) || el;
    let media = 0;
    let painted = 0;
    const nodes = [...content.querySelectorAll('*')].slice(0, 4000);
    for (const node of nodes) {
      if (!visible(node)) continue;
      const tag = node.tagName.toLowerCase();
      if (['canvas', 'svg', 'img', 'video', 'webview'].includes(tag)) media++;
      const style = getComputedStyle(node);
      const color = style.backgroundColor;
      const transparent =
        color === 'transparent' || /,\\s*0\\)$/.test(color) || color === '';
      if (!transparent || style.backgroundImage !== 'none') painted++;
    }
    let hidden = false;
    for (let node = content; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || Number(style.opacity) < 0.05) {
        hidden = true;
        break;
      }
    }
    boxes.push({
      id: el.getAttribute('data-widget-id') || '',
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      scale: Number((scaleEl && scaleEl.getAttribute('data-widget-scale')) || 100),
      text: (content.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 600),
      media,
      painted,
      elements: nodes.length,
      hidden,
      overflowX: Math.max(0, content.scrollWidth - content.clientWidth),
      overflowY: Math.max(0, content.scrollHeight - content.clientHeight),
    });
  }
  return boxes;
})()`;

/**
 * Hides every widget box but one for a capture, or shows them all again.
 * With opacity, not visibility: a part of a widget that sets its own
 * visibility (the Lap Trace brake bars) would show through a hidden box.
 */
export const isolateWidget = (id: string | null): string => `(() => {
  const existing = document.getElementById('smoke-isolate');
  const id = ${JSON.stringify(id)};
  if (id === null) {
    if (existing) existing.remove();
  } else {
    const style = existing || document.createElement('style');
    style.id = 'smoke-isolate';
    style.textContent =
      '[data-smoke-widget]:not([data-widget-id=' + JSON.stringify(id) + ']){opacity:0 !important}';
    if (!existing) document.head.appendChild(style);
  }
  return Promise.race([
    new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))),
    new Promise((done) => setTimeout(() => done(false), 400)),
  ]);
})()`;

/**
 * Puts a dark sheet behind the widgets while pictures are taken: the overlay
 * is transparent, and light text on nothing cannot be read. It makes the
 * overlay window opaque for as long as it is on.
 */
export const setBackdrop = (on: boolean): string => `(() => {
  const existing = document.getElementById('smoke-backdrop');
  if (${on}) {
    if (existing) return true;
    const style = document.createElement('style');
    style.id = 'smoke-backdrop';
    style.textContent = 'html{background:#181c24 !important}';
    document.head.appendChild(style);
  } else if (existing) {
    existing.remove();
  }
  return true;
})()`;

export interface AppState {
  profileId: string;
  profileName: string;
  dashboard: {
    widgets: {
      id: string;
      type?: string;
      enabled: boolean;
      placement?: string;
      scale?: number;
      layout: { x: number; y: number; width: number; height: number };
      config?: Record<string, unknown>;
    }[];
    generalSettings?: Record<string, unknown>;
  };
  simulator: string | null;
  disabledForSim: string[];
  version: string;
  running: boolean;
  demo: boolean;
}

/** What the app says about itself, asked through its own bridges. */
export const READ_APP_STATE = `(async () => {
  const bridge = window.dashboardBridge;
  const profile = await bridge.getCurrentProfile();
  const dashboard = await bridge.getDashboardForProfile(profile.id);
  const simulator = await bridge.getActiveSimulator();
  const support = await bridge.getSimWidgetSupport();
  return {
    profileId: profile.id,
    profileName: profile.name,
    dashboard,
    simulator,
    disabledForSim:
      (simulator && support && support.disabledWidgets && support.disabledWidgets[simulator]) || [],
    version: String(await bridge.getAppVersion()),
    running: Boolean(await window.irsdkBridge.getRunningState()),
    demo: Boolean(await bridge.getIsDemoMode()),
  };
})()`;

/** Stores a dashboard the way the settings window does. */
export const saveDashboard = (dashboard: unknown): string =>
  `(() => { window.dashboardBridge.saveDashboard(${JSON.stringify(dashboard)}); return true; })()`;

export const READ_DISPLAY = `({
  width: screen.width,
  height: screen.height,
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  scale: window.devicePixelRatio,
})`;

export interface SettingsPageState {
  hash: string;
  heading: string;
  text: string;
  textLength: number;
  controls: number;
  dialog: string;
  scrollable: number;
}

/** What a settings page shows once it has settled. */
export const READ_SETTINGS_PAGE = `(() => {
  const main = document.getElementById('settings-content');
  // A dialog that takes the window over: the preview panel is one that does not.
  const dialog = document.querySelector(
    'dialog:modal, [role="dialog"][aria-modal="true"]'
  );
  let scrollable = 0;
  if (main) {
    for (const node of main.querySelectorAll('*')) {
      const extra = node.scrollHeight - node.clientHeight;
      const flow = getComputedStyle(node).overflowY;
      if (extra > 40 && (flow === 'auto' || flow === 'scroll')) {
        scrollable = Math.max(scrollable, extra);
      }
    }
  }
  const heading = main && main.querySelector('h1, h2, h3');
  const text = main ? main.innerText.replace(/[ \\t]+/g, ' ').trim() : '';
  return {
    hash: location.hash,
    heading: heading ? heading.innerText.trim().slice(0, 80) : '',
    text: text.slice(0, 4000),
    textLength: text.length,
    controls: main
      ? main.querySelectorAll('button, input, select, textarea, [role="switch"]').length
      : 0,
    dialog: dialog ? (dialog.innerText || '').trim().slice(0, 300) : '',
    scrollable,
  };
})()`;

/** Scrolls the tallest scrolling part of a settings page by one screen. */
export const scrollSettingsPage = (screens: number): string => `(() => {
  const main = document.getElementById('settings-content');
  if (!main) return false;
  let best = null;
  let most = 40;
  for (const node of main.querySelectorAll('*')) {
    const extra = node.scrollHeight - node.clientHeight;
    const flow = getComputedStyle(node).overflowY;
    if (extra > most && (flow === 'auto' || flow === 'scroll')) {
      best = node;
      most = extra;
    }
  }
  if (!best) return false;
  best.scrollTop = Math.round(best.clientHeight * 0.9 * ${screens});
  return true;
})()`;

export const goToSettingsPage = (page: string): string =>
  `(() => { location.hash = ${JSON.stringify(`#/settings/${page}`)}; return true; })()`;

/** Clicks the first element a selector finds; false when there is none. */
export const click = (selector: string): string => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  el.click();
  return true;
})()`;

/** The switch in the settings menu's row for a widget. */
export const clickMenuSwitch = (widgetId: string): string => `(() => {
  const link = document.querySelector('nav a[href$=' + JSON.stringify('/settings/' + ${JSON.stringify(widgetId)}) + ']');
  const row = link && link.closest('li');
  const toggle = row && row.querySelector('button[role="switch"]');
  if (!toggle) return null;
  const before = toggle.getAttribute('aria-checked');
  toggle.click();
  return before;
})()`;

/** Clicks the first on/off setting of the open settings page. */
export const CLICK_FIRST_PAGE_SWITCH = `(() => {
  const main = document.getElementById('settings-content');
  const toggles = main ? [...main.querySelectorAll('button[role="switch"]')] : [];
  const toggle = toggles.find((el) => el.getAttribute('aria-disabled') !== 'true' && !el.disabled);
  if (!toggle) return null;
  const label =
    toggle.getAttribute('aria-label') ||
    (toggle.getAttribute('aria-labelledby') &&
      (document.getElementById(toggle.getAttribute('aria-labelledby')) || {}).innerText) ||
    (toggle.parentElement && toggle.parentElement.innerText) ||
    '';
  const before = toggle.getAttribute('aria-checked');
  toggle.click();
  return { label: String(label).trim().slice(0, 80), before };
})()`;

/** Whether the overlay is drawn: the app hides its root when switched off. */
export const READ_OVERLAY_VISIBILITY = `(() => {
  const all = [...document.querySelectorAll('[data-widget-id]')].filter(
    (el) => !(el.parentElement && el.parentElement.closest('[data-widget-id]'))
  );
  const box = all[0];
  if (!box) return { boxes: 0, hidden: null };
  return {
    boxes: all.length,
    hidden: getComputedStyle(box).visibility === 'hidden',
  };
})()`;

/** Counts the dashboard updates an overlay window is sent from now on. */
export const WATCH_DASHBOARD_UPDATES = `(() => {
  if (window.__smokeUpdates === undefined) {
    window.__smokeUpdates = 0;
    window.dashboardBridge.dashboardUpdated(() => { window.__smokeUpdates++; });
  }
  return window.__smokeUpdates;
})()`;

export const READ_DASHBOARD_UPDATES = `(window.__smokeUpdates || 0)`;

export const hasWidgetBox = (id: string): string =>
  `(document.querySelector('[data-widget-id=' + JSON.stringify(${JSON.stringify(id)}) + ']') !== null)`;
