import type { IncomingMessage, Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  TELEMETRY_INSPECTOR_RATE_HZ,
  type Telemetry,
  type Session,
  type DashboardLayout,
} from '@irdashies/types';
import type {
  IrSdkSourceBridge,
  DashboardBridge,
  PitLaneBridge,
} from '@irdashies/types';
import {
  getActiveSimulator,
  getIsDemoMode,
  onActiveSimulatorChanged,
} from '../bridge/iracingSdk/setup';
import { getAvailableSimulators } from '../bridge/iracingSdk/sims/registry';
import { loadSimWidgetSupport } from '../storage/simWidgetSupport';
import logger from '../logger';
import { getHiddenWidgets, onWidgetHiddenChanged } from '../widgetVisibility';
import type { ChannelBus } from '../bridge/channelBridge';
import type { CheckedRaceHistoryBridge } from '../bridge/raceHistoryBridge';
import { getRacePlanState, onRacePlanState } from '../services/racePlanSource';
import {
  createRefusalLog,
  evaluateAccess,
  type AccessPolicy,
  type AccessRequest,
} from './accessPolicy';
import { mergeBrowserPositions } from './browserPositions';
import type { DeviceAccess } from './deviceAccess';
import {
  DEVICE_KEY_COOKIE,
  createKeyRefusalLog,
  forgetKeyCookie,
  keyRefusalAnswer,
  readCookie,
  type KeyDecision,
} from './deviceKey';
import { createRaceHistoryReads } from './raceHistoryReads';
import { briefMessageType, createSocketLogLimit } from './socketLog';

/** A whole dashboard is a few hundred kilobytes; nothing a page sends is more. */
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

const NOT_ALLOWED = 'Not allowed over a browser connection';

/** What the far end of a socket is, as far as the handshake showed. */
interface Visitor {
  /** A page this server served. Only such a page may change anything. */
  ownPage: boolean;
}

const isShortString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512;

// Export current state so it can be accessed by other parts of the app
export let currentDashboard: DashboardLayout | null = null;

/**
 * Bridge proxy that exposes Electron bridge data via WebSocket
 * Allows external browsers to receive real-time telemetry, session data, and dashboard configuration
 *
 * A socket is opened only for a visitor `accessPolicy` lets in, and reads are
 * all most of them get. The two things a browser page does change, where its
 * widgets sit and the pit lane it measured while driving, are accepted from a
 * page this server served and from nobody else. Everything the settings
 * window changes goes over IPC and is refused here.
 *
 * The race history is among the reads: the laps, stints, driver changes and
 * log of a race, and the races kept. It is answered by the bridge the app's
 * own windows ask over IPC, the same instance, which checks every argument
 * itself (`raceHistoryBridge.ts`); how many of those reads one socket may
 * have waiting is capped in `raceHistoryReads.ts`.
 *
 * A visitor that is not this machine must also hold the key, which its
 * handshake carries in the cookie the server set when it opened the page by
 * its link (`deviceAccess`). The key never travels over the socket itself:
 * no message asks for it and none answers with it.
 */
export function createBridgeProxy(
  httpServer: HTTPServer,
  irsdkBridge: IrSdkSourceBridge,
  dashboardBridge?: DashboardBridge,
  channelBus?: ChannelBus,
  pitLaneBridge?: PitLaneBridge,
  accessPolicy?: AccessPolicy,
  deviceAccess?: DeviceAccess,
  raceHistoryBridge?: CheckedRaceHistoryBridge
) {
  const visitorOf = (req: IncomingMessage): AccessRequest => ({
    host: req.headers.host,
    origin: req.headers.origin,
    remoteAddress: req.socket?.remoteAddress,
  });
  const accessOf = (req: IncomingMessage | undefined) =>
    req && accessPolicy ? evaluateAccess(visitorOf(req), accessPolicy) : null;

  /**
   * The key rule for a handshake. Where there is a policy and no key rule to
   * ask, only loopback is let in, so that leaving the rule out can never
   * open the socket to another device.
   */
  const passOf = (req: IncomingMessage, loopback: boolean): KeyDecision => {
    if (deviceAccess) {
      return deviceAccess.check({
        remoteAddress: req.socket?.remoteAddress,
        cookieKey: readCookie(req.headers.cookie, DEVICE_KEY_COOKIE),
      });
    }
    return loopback
      ? { allowed: true, thisMachine: true, staleCookie: false }
      : {
          allowed: false,
          thisMachine: false,
          refusal: 'missing',
          staleCookie: false,
        };
  };
  /** What the handshake decided, for the connection that follows it. */
  const passes = new WeakMap<IncomingMessage, KeyDecision>();

  const reportRefusal = createRefusalLog((line) =>
    logger.warn(`Bridge proxy: connection ${line}`)
  );
  const reportKeyRefusal = createKeyRefusalLog((line) =>
    logger.warn(`Bridge proxy: connection ${line}`)
  );
  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: (info, done) => {
      const access = accessOf(info.req);
      if (access && !access.allowed) {
        reportRefusal(access.refusal, visitorOf(info.req));
        done(false, 403, 'Forbidden');
        return;
      }
      if (!access && !deviceAccess) {
        done(true);
        return;
      }
      // Host and Origin first; the key is asked of whoever they let through.
      const pass = passOf(info.req, access?.loopback === true);
      if (!pass.allowed) {
        reportKeyRefusal(pass.refusal, info.req.socket?.remoteAddress);
        const { status, text } = keyRefusalAnswer(pass);
        done(
          false,
          status,
          text,
          pass.staleCookie ? { 'Set-Cookie': forgetKeyCookie() } : undefined
        );
        return;
      }
      passes.set(info.req, pass);
      done(true);
    },
  });

  const clients = new Set<WebSocket>();
  const inspectorStreams = new Map<
    WebSocket,
    Set<'telemetryInspector' | 'sessionData'>
  >();
  const racePlanSubscriptions = new Map<WebSocket, () => void>();
  let nextChannelTargetId = -1;
  let currentTelemetry: Telemetry | null = null;
  let lastTelemetryBroadcastTime = Number.NEGATIVE_INFINITY;
  let currentSession: Session | null = null;
  let isRunning = false;
  let isDemoMode = getIsDemoMode();
  // Browser views are not BrowserWindows, so OverlayManager's 'simulatorChanged'
  // publish never reaches them. Without this they never learn which sim is
  // running and show every enabled widget, including ones simWidgetSupport.json
  // disables for that sim.
  let activeSimulator = getActiveSimulator() ?? null;

  if (dashboardBridge?.getCurrentDashboard) {
    currentDashboard = dashboardBridge.getCurrentDashboard();
  }

  const broadcast = (type: string, data: unknown) => {
    let message: string | undefined;
    clients.forEach((client) => {
      if (
        (type === 'telemetry' || type === 'sessionData') &&
        !inspectorStreams
          .get(client)
          ?.has(type === 'telemetry' ? 'telemetryInspector' : 'sessionData')
      ) {
        return;
      }
      if (client.readyState === WebSocket.OPEN) {
        // Serialize once, only after finding an eligible recipient.
        message ??= JSON.stringify({ type, data });
        client.send(message);
      }
    });
  };

  let currentBridge: IrSdkSourceBridge | null = null;
  let unsubscribeFunctions: (() => void)[] = [];

  const subscribeToBridge = (bridge: IrSdkSourceBridge) => {
    currentBridge = bridge;

    const unsubTelemetry = bridge.onTelemetry((telemetry: Telemetry) => {
      currentTelemetry = telemetry;
      const now = performance.now();
      if (
        clients.size > 0 &&
        now - lastTelemetryBroadcastTime >= 1000 / TELEMETRY_INSPECTOR_RATE_HZ
      ) {
        lastTelemetryBroadcastTime = now;
        broadcast('telemetry', telemetry);
      }
    });

    const unsubSession = bridge.onSessionData((session: Session) => {
      currentSession = session;
      if (clients.size > 0) {
        broadcast('sessionData', session);
      }
    });

    const unsubRunning = bridge.onRunningState((running: boolean) => {
      isRunning = running;
      if (clients.size > 0) {
        broadcast('runningState', running);
      }
    });

    unsubscribeFunctions = [unsubTelemetry, unsubSession, unsubRunning].filter(
      (fn) => typeof fn === 'function'
    );
  };

  const unsubscribeFromBridge = () => {
    unsubscribeFunctions.forEach((unsub) => unsub());
    unsubscribeFunctions = [];
  };

  const resubscribeToBridge = (newBridge: IrSdkSourceBridge) => {
    logger.info('Bridge proxy: Re-subscribing to new bridge...');
    // Unsubscribe from old bridge first
    unsubscribeFromBridge();
    currentTelemetry = null;
    currentSession = null;
    isRunning = false;
    subscribeToBridge(newBridge);
  };

  onActiveSimulatorChanged((simulator) => {
    activeSimulator = simulator;
    broadcast('simulatorChanged', simulator);
  });

  // Per-widget hotkeys only reach overlay windows; forward them so a
  // commentator can show or hide broadcast widgets on the OBS page too.
  onWidgetHiddenChanged((widgetId, hide) =>
    broadcast('widgetToggleHide', { widgetId, hide })
  );

  if (dashboardBridge) {
    dashboardBridge.dashboardUpdated(
      (dashboard: DashboardLayout, profileId?: string) => {
        // Every profile's saves are announced here: a browser page of a
        // profile that is not the active one saving where its widgets sit,
        // and the driver tags, which are announced for each profile in turn.
        // `currentDashboard` is the active profile's (it answers a new
        // connection, `getDashboard`, an unknown profile and the index
        // page's widget list), so it is read again rather than taken from
        // whichever profile spoke last.
        const active = dashboardBridge.getCurrentDashboard?.();
        if (active) currentDashboard = active;
        else if (profileId === undefined) currentDashboard = dashboard;
        // Each page keeps only what names its own profile.
        broadcast('dashboardUpdated', { dashboard, profileId });
      }
    );

    if (dashboardBridge.onDemoModeChanged) {
      dashboardBridge.onDemoModeChanged((demoMode: boolean) => {
        isDemoMode = demoMode;
        broadcast('demoModeChanged', demoMode);
      });
    }
  }

  wss.on('connection', (ws: WebSocket, req?: IncomingMessage) => {
    const visitor: Visitor = { ownPage: accessOf(req)?.ownPage === true };
    // Another device, let in for its key: counted as connected for the
    // settings window, and disconnected if the key is replaced.
    const pass = req ? passes.get(req) : undefined;
    if (deviceAccess && req && !pass) {
      // Every handshake is decided before it gets here. One that was not is
      // not a connection to answer.
      ws.close(1008, 'Forbidden');
      return;
    }
    const releaseDevice =
      deviceAccess && pass && !pass.thisMachine
        ? deviceAccess.admit(ws, req?.socket?.remoteAddress)
        : undefined;
    clients.add(ws);
    inspectorStreams.set(ws, new Set());
    const channelTarget = {
      id: nextChannelTargetId--,
      isDestroyed: () => ws.readyState === WebSocket.CLOSED,
      isVisible: () => ws.readyState === WebSocket.OPEN,
      send: (_delivery: string, channel: string, payload: unknown) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({ type: 'channel', data: { channel, payload } })
          );
        }
      },
    };

    // This socket's reads of the race history: one at a time, in the order
    // they came, and only so many in hand.
    const raceHistoryReads = createRaceHistoryReads({
      bridge: raceHistoryBridge,
      isOpen: () => ws.readyState === WebSocket.OPEN,
      send: (answer) =>
        new Promise<void>((resolve) => {
          // Called once the answer has left for the network, or could not.
          ws.send(JSON.stringify(answer), () => resolve());
        }),
      onFailure: (type, error) =>
        logger.warn(`Bridge proxy: ${type} failed`, error),
    });

    // What this socket may write to the log about its own messages.
    const logUnknown = createSocketLogLimit();

    if (unsubscribeFunctions.length === 0) {
      logger.info('No active subscriptions, subscribing to bridge...');
      subscribeToBridge(currentBridge || irsdkBridge);
    }

    ws.send(
      JSON.stringify({
        type: 'initialState',
        data: {
          isRunning,
          dashboard: currentDashboard,
          isDemoMode,
          simulator: activeSimulator,
          hiddenWidgets: getHiddenWidgets(),
        },
      })
    );

    ws.on('message', async (message: Buffer) => {
      // A socket that is being closed, as one is when its device's key was
      // replaced, is no longer listened to while the close goes through.
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        const parsed = JSON.parse(message.toString());

        switch (parsed.type) {
          case 'pitLane:getData':
          case 'pitLane:updateData':
          case 'pitLane:getCurrentTrack':
          case 'pitLane:resetData': {
            const { type, requestId, data } = parsed;
            try {
              // Resetting is the settings window's to do. Measuring is a
              // widget's, so a page of ours may report what it measured.
              if (
                type === 'pitLane:resetData' ||
                (type === 'pitLane:updateData' && !visitor.ownPage)
              ) {
                throw new Error(NOT_ALLOWED);
              }
              if (!pitLaneBridge)
                throw new Error('Pit lane calibration is unavailable');
              let result: unknown;
              if (type === 'pitLane:getData')
                result = await pitLaneBridge.getPitLaneData(data?.trackId);
              else if (type === 'pitLane:updateData')
                result = await pitLaneBridge.updatePitLaneData(
                  data?.trackId,
                  data?.update,
                  data?.revision,
                  data?.sourceId
                );
              else if (type === 'pitLane:resetData')
                result = await pitLaneBridge.resetPitLaneData(data?.trackId);
              else result = await pitLaneBridge.getCurrentTrackPitLaneInfo();
              ws.send(
                JSON.stringify({ type, requestId, data: result ?? null })
              );
            } catch (error) {
              ws.send(
                JSON.stringify({
                  type,
                  requestId,
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Pit lane request failed',
                })
              );
            }
            break;
          }
          case 'telemetryInspectorSubscribe': {
            const stream = parsed.data?.stream;
            if (stream !== 'telemetryInspector' && stream !== 'sessionData') {
              throw new Error('Invalid Telemetry Inspector subscription');
            }
            inspectorStreams.get(ws)?.add(stream);
            const current =
              stream === 'telemetryInspector'
                ? currentTelemetry
                : currentSession;
            if (current !== null && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: stream === 'telemetryInspector' ? 'telemetry' : stream,
                  data: current,
                })
              );
            }
            break;
          }
          case 'telemetryInspectorUnsubscribe': {
            const stream = parsed.data?.stream;
            if (stream !== 'telemetryInspector' && stream !== 'sessionData') {
              throw new Error('Invalid Telemetry Inspector unsubscribe');
            }
            inspectorStreams.get(ws)?.delete(stream);
            break;
          }
          // Read-only: browser views show the plan but never change it.
          case 'racePlan:getState': {
            ws.send(
              JSON.stringify({
                type: parsed.type,
                requestId: parsed.requestId,
                data: await getRacePlanState(),
              })
            );
            break;
          }
          case 'racePlan:subscribe': {
            if (racePlanSubscriptions.has(ws)) break;
            racePlanSubscriptions.set(
              ws,
              onRacePlanState((state) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({ type: 'racePlanState', data: state })
                  );
                }
              })
            );
            break;
          }
          case 'racePlan:unsubscribe': {
            racePlanSubscriptions.get(ws)?.();
            racePlanSubscriptions.delete(ws);
            break;
          }
          // The race history, reading only. These five are every read its
          // bridge has; it has no call that changes a record, and no other
          // `raceHistory:` type is a message this server knows.
          case 'raceHistory:getCarLaps':
            raceHistoryReads.ask('getCarLaps', parsed);
            break;
          case 'raceHistory:getCarStints':
            raceHistoryReads.ask('getCarStints', parsed);
            break;
          case 'raceHistory:getDriverChanges':
            raceHistoryReads.ask('getDriverChanges', parsed);
            break;
          case 'raceHistory:listRaces':
            raceHistoryReads.ask('listRaces', parsed);
            break;
          case 'raceHistory:getEvents':
            raceHistoryReads.ask('getEvents', parsed);
            break;
          case 'channelSubscribe': {
            const channel = parsed.data?.channel;
            const rate = parsed.data?.requestedRateHz;
            if (
              typeof channel !== 'string' ||
              (rate !== undefined && typeof rate !== 'number')
            ) {
              throw new Error('Invalid channel subscription');
            }
            channelBus?.subscribe(channelTarget, channel, rate);
            break;
          }
          case 'channelUnsubscribe': {
            const channel = parsed.data?.channel;
            if (typeof channel !== 'string') {
              throw new Error('Invalid channel unsubscribe');
            }
            channelBus?.unsubscribe(channelTarget.id, channel);
            break;
          }
          case 'getActiveSimulator': {
            const { requestId } = parsed;
            ws.send(
              JSON.stringify({
                type: 'getActiveSimulator',
                requestId,
                data: activeSimulator,
              })
            );
            break;
          }
          case 'getAvailableSimulators': {
            const { requestId } = parsed;
            ws.send(
              JSON.stringify({
                type: 'getAvailableSimulators',
                requestId,
                data: getAvailableSimulators(),
              })
            );
            break;
          }
          case 'getSimWidgetSupport': {
            const { requestId } = parsed;
            ws.send(
              JSON.stringify({
                type: 'getSimWidgetSupport',
                requestId,
                data: await loadSimWidgetSupport(),
              })
            );
            break;
          }
          case 'getDashboard':
            ws.send(
              JSON.stringify({
                type: 'dashboard',
                data: currentDashboard,
              })
            );
            break;
          case 'getDashboardForProfile': {
            const { requestId, data } = parsed;
            const result =
              (isShortString(data?.profileId)
                ? await dashboardBridge?.getDashboardForProfile?.(
                    data.profileId
                  )
                : null) || currentDashboard;
            ws.send(
              JSON.stringify({
                type: 'getDashboardForProfile',
                requestId,
                data: result,
              })
            );
            break;
          }
          case 'reloadDashboard':
            dashboardBridge?.reloadDashboard();
            break;
          // The page sends its whole dashboard; only where its widgets sit
          // is taken from it. See mergeBrowserPositions.
          case 'saveDashboard': {
            if (!visitor.ownPage || !dashboardBridge) break;
            const { dashboard, options } = parsed.data || {};
            const profileId = isShortString(options?.profileId)
              ? options.profileId
              : undefined;
            const stored = profileId
              ? await dashboardBridge.getDashboardForProfile?.(profileId)
              : dashboardBridge.getCurrentDashboard?.();
            if (!stored) break;
            const merged = mergeBrowserPositions(stored, dashboard);
            if (merged) {
              dashboardBridge.saveDashboard(
                merged,
                profileId ? { profileId } : undefined
              );
            }
            break;
          }
          case 'getAppVersion': {
            const { requestId } = parsed;
            const result = await dashboardBridge?.getAppVersion();
            ws.send(
              JSON.stringify({
                type: 'getAppVersion',
                requestId,
                data: result,
              })
            );
            break;
          }
          case 'getGarageCoverImageAsDataUrl': {
            const { requestId, data } = parsed;
            const result = isShortString(data?.imagePath)
              ? await dashboardBridge?.getGarageCoverImageAsDataUrl(
                  data.imagePath
                )
              : null;
            ws.send(
              JSON.stringify({
                type: 'getGarageCoverImageAsDataUrl',
                requestId,
                data: result,
              })
            );
            break;
          }
          case 'getPlayerIconImageAsDataUrl': {
            const { requestId, data } = parsed;
            if (!isShortString(data?.imagePath)) {
              ws.send(
                JSON.stringify({
                  type: 'getPlayerIconImageAsDataUrl',
                  requestId,
                  data: null,
                })
              );
              break;
            }
            const result = await dashboardBridge?.getPlayerIconImageAsDataUrl(
              data.imagePath
            );
            ws.send(
              JSON.stringify({
                type: 'getPlayerIconImageAsDataUrl',
                requestId,
                data: result,
              })
            );
            break;
          }
          // Both belong to the settings window, which uses IPC. Answered, so a
          // page that asks is not left waiting, and never carried out.
          case 'savePlayerIconImage': {
            ws.send(
              JSON.stringify({
                type: 'savePlayerIconImage',
                requestId: parsed.requestId,
                data: '',
                error: NOT_ALLOWED,
              })
            );
            break;
          }
          case 'getCurrentProfile': {
            const { requestId } = parsed;
            const result = await dashboardBridge?.getCurrentProfile();
            ws.send(
              JSON.stringify({
                type: 'getCurrentProfile',
                requestId,
                data: result,
              })
            );
            break;
          }
          case 'listProfiles': {
            const { requestId } = parsed;
            const result = await dashboardBridge?.listProfiles();
            ws.send(
              JSON.stringify({
                type: 'listProfiles',
                requestId,
                data: result,
              })
            );
            break;
          }
          case 'updateProfileTheme': {
            ws.send(
              JSON.stringify({
                type: 'updateProfileTheme',
                requestId: parsed.requestId,
                data: null,
                error: NOT_ALLOWED,
              })
            );
            break;
          }
          default:
            // The type is the visitor's own text, megabytes of it if it
            // likes: a short cleaned piece is written, a few times a minute.
            logUnknown((leftOut) =>
              logger.info(
                `Bridge proxy: Unknown message type ${briefMessageType(parsed.type)}${leftOut}`
              )
            );
            break;
        }
      } catch (error) {
        logger.error('Error parsing client message:', error);
      }
    });

    ws.on('close', () => {
      releaseDevice?.();
      clients.delete(ws);
      inspectorStreams.delete(ws);
      racePlanSubscriptions.get(ws)?.();
      racePlanSubscriptions.delete(ws);
      raceHistoryReads.close();
      channelBus?.removeRenderer(channelTarget.id);

      if (clients.size === 0) {
        logger.info('No clients connected, unsubscribing from bridge...');
        unsubscribeFromBridge();
      }
    });

    ws.on('error', (error: Error) => {
      logger.error('WebSocket error:', error);
    });
  });

  return { wss, resubscribeToBridge };
}
