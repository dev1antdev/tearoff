# App smoke: the real app on a recording

`npm run smoke:app` starts the real Tearoff (the packaged build by default) on
a recorded session, with a profile folder of its own, and gathers what a person
would gather by hand before a release:

- a picture of every overlay window and of every widget's own box, at several
  moments of the recording;
- every console error, unhandled rejection and exception in every window, with
  the window and the widget it came from;
- a picture of every settings page (each widget's, General, Key Bindings,
  Profiles, Driver Tags, Race Plan, Setup Comparison, Laps, Advanced, Release
  notes, About);
- whether the overlay follows what a user flips: the overlay on/off switch, one
  widget off and on, one setting changed and changed back;
- whether the built-in web server serves the browser page and its own
  connection, and turns away a page from another site and a name pointed at
  this machine;
- what the app left in the profile: `logs/main.log`, `laps.db` and its backup,
  `config.json`, the track profiles, and anything a recording should not leave.

It writes a report folder with `report.md`, `result.json` and the pictures.

The specs, the recorded-session specs and Storybook check the parts. This is
the only check that runs the whole app.

## What it cannot see

It plays a recording. Nobody drives, nothing is typed into a game, no real
simulator is attached, and the app (correctly) treats a recording as somebody
else's session: it records no laps, no stints and no track profile from it. So
this run does not show that a lap you drive ends up in the lap library. It
looks at each widget at a few moments, not continuously. It does not judge
whether a number is right, only whether something is drawn, nothing failed and
nothing that should never be shown (`NaN`, `undefined`, `[object Object]`) is.
It does not test the installer, the auto-updater, the tray menu, keyboard
shortcuts or controllers.

## Before a run

1. The recordings are in Git LFS: `git lfs pull` if
   `test-data/telemetry/*.lmudt` / `*.irdt` are pointer files.
2. The native addons must match the sources: `npm run irsdk:build` after a
   change to native code (the packaged app plays a recording through
   `lmu_tape_node.node` / `irsdk_tape_node.node`).
3. Package the build to test, beside any build of your own rather than over it:

   ```powershell
   $env:IRDASHIES_OUT_DIR = 'out/smoke'
   npx electron-forge package
   ```

   That writes `out\smoke\tearoff-win32-x64\tearoff.exe`, which is what the
   tool starts unless `--exe` names another.

The tool checks the order of these itself and fails a run whose build is not
the code in the checkout: addons in `build/Release` older than the native
sources, or a packaged app older than those addons or than the commit the
checkout is on. (It cannot see uncommitted changes made after packaging.)

## The four runs of the release gate

```powershell
# 1. Le Mans Ultimate, a new profile with every supported widget switched on
npm run smoke:app -- --tape test-data/telemetry/lmu-session.lmudt --run-id lmu-fresh

# 2. Le Mans Ultimate, a copy of your own profile
npm run smoke:app -- --tape test-data/telemetry/lmu-session.lmudt --profile copy --run-id lmu-copy

# 3. iRacing, a new profile
npm run smoke:app -- --tape test-data/telemetry/ai-race-10min.irdt --run-id iracing-fresh

# 4. iRacing, a copy of your own profile
npm run smoke:app -- --tape test-data/telemetry/ai-race-10min.irdt --profile copy --run-id iracing-copy
```

Each writes `smoke-results/<run-id>/` (ignored by Git). A run id can be used
once: the tool refuses a profile folder that already exists. The folder of a
copy run holds a copy of your settings and lap library (`profile/`,
`original/`): it is yours, not something to attach to an issue.

The owner's own library may hold little: on 2026-11-16 it held no laps, so
its upgrade moved a schema and no data. To see a library with laps upgraded,
make a profile folder with a `config.json` and a schema-1 `laps.db` that has
rows, and run `--profile copy --copy-from <that folder>`.

An LMU run takes about six minutes, an iRacing run about seven. The exit code
is 0 for PASS or ATTENTION, 1 for FAIL, 2 when the tool refused to start, 3
when the real profile changed.

To look at the pictures a sheet at a time instead of a file at a time:

```powershell
node_modules\electron\dist\electron.exe tools\smoke\contact-sheets.cjs smoke-results\lmu-fresh
```

It writes `smoke-results/<run-id>/sheets/`: the widgets of each capture twelve
to a sheet, the settings pages four to a sheet (`SMOKE_SHEET_PAGES=6` for six,
`SMOKE_SHEET_FIRST=1` for only the first picture of each page). It is a bare
page on the repository's Electron with a temporary user-data folder, not the
app.

## Options

| Option                 | Meaning                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--tape <file>`        | The recording. `.lmudt` plays as Le Mans Ultimate, `.irdt` as iRacing.                                              |
| `--profile fresh`      | Default. A new profile; see below.                                                                                  |
| `--profile copy`       | A copy of the profile in `--copy-from` (default `%APPDATA%\tearoff`).                                               |
| `--target dev`         | Runs `npm start` instead of the packaged build. Slower to start; the frontend comes from the dev server.            |
| `--exe <file>`         | The packaged app to run (default `out/smoke/tearoff-win32-x64/tearoff.exe`).                                        |
| `--speed <n>`          | Replay speed. Default 2 for iRacing and 4 for LMU; see "Replay speed" below.                                        |
| `--no-loop`            | Stop at the end of the recording. By default it loops, which the app sees as a session ending and another starting. |
| `--points <n>`         | How many times every widget is captured (default 3, spread over the recording).                                     |
| `--tape-seconds <n>`   | Length of the recording, to spread the captures (default 240 for LMU, 600 for iRacing).                             |
| `--out <dir>`          | The report folder (default `smoke-results/<run-id>`).                                                               |
| `--profile-dir <dir>`  | The isolated profile (default `<out>/profile`). No spaces in the path.                                              |
| `--real-profile <dir>` | The profile that must not change (default `%APPDATA%\tearoff`).                                                     |
| `--skip-settings`      | Captures only: no settings pages, no toggles.                                                                       |

## What a run does

1. **Refuses to start** when Tearoff, iRacing or Le Mans Ultimate is running,
   or when an Electron app is running from a checkout (a dev Tearoff). It also
   refuses when Tearoff is registered to start with Windows: every start of
   the app rewrites that registry entry under a name the smoke build shares
   with the installed app, so a run would replace or remove it. Turn the
   setting off in the installed app for the run.
2. **Records the real profile**: the size and modification time of every file
   in `%APPDATA%\tearoff`.
3. **Makes the profile.**
   - _fresh_: an empty folder. Once the app is up, the tool reads the default
     dashboard through the app's own bridge and saves it back with every
     widget the simulator supports switched on, laid out in a grid at each
     widget's default size, and set to show off track as well (the same
     overrides the performance harness uses for a replay).
   - _copy_: everything in the source folder that is the user's data
     (`config.json`, `simWidgetSupport.json`, `laps.db*`, the other JSON files,
     `track-profiles/`, `Local Storage/`, ...), not Chromium's caches and not
     the logs. "Start with Windows" is turned off in the copy if it was on.
     The copied `config.json` and `laps.db*` are also kept untouched in
     `<out>/original/` to compare against afterwards.
4. **Starts the app** with `--user-data-dir=<profile>` and
   `--remote-debugging-port=<a free port>`, and the recording in
   `IRDASHIES_LMU_REPLAY` or `IRDASHIES_TELEMETRY_REPLAY` (+ `_SPEED`, `_LOOP`).
5. **Attaches to every window** over the debugging port and records
   `Runtime.exceptionThrown` (which includes unhandled rejections), console
   errors and warnings, browser log errors and renderer crashes.
6. **Captures** (three times by default): each overlay window whole, then each
   widget's box. Where boxes overlap, the others are hidden for the instant of
   the picture so each widget is on its own. A dark sheet is put behind the
   transparent overlay while pictures are taken. A widget that is a window of
   its own (the Gantry, the Pit Wall) is photographed as that window, whole:
   a fresh profile switches both on where the simulator supports them, so
   their windows open with the overlay.
7. **Walks the settings window** page by page, scrolling long pages, then
   **flips** the overlay switch, one widget's switch in the menu and the first
   on/off setting on that widget's page, checking the overlay each time and
   putting everything back.
8. **Knocks on the built-in web server**, which the run puts on a port of its
   own (`COMPONENT_PORT`): `/dashboard`, the page bundle, a connection as the
   server's own page, then a request and a connection as another site and a
   request under a foreign host name, which must all be refused. A copied
   profile with the web server switched off is noted and not checked.
9. **Quits the app** by asking the browser to close (`Browser.close`), which
   runs the app's own shutdown and storage flush, the same as Quit in the tray.
10. **Inspects the profile and the real profile**, and writes the report.

Everything the tool starts is stopped by the process id it started, also when
a run fails.

## Reading the report

`report.md` starts with the verdict:

- **FAIL**: something blocks a release until it is explained. A build that is
  not the code in the checkout; an error in a window or in `main.log`; a widget with an error, or switched on and never on
  screen; `NaN` / `undefined` shown; a broken settings page; the overlay not
  following a switch; the app not quitting; `config.json` not parsing, a widget
  lost or its switch flipped; the lap library unreadable, its backup not equal
  to the library as it was, or rows lost in the upgrade; the real profile or
  the Windows start-up entry changed.
- **ATTENTION**: nothing failed, and a person should look. Widgets that drew
  nothing (several only draw at moments: in the pit lane, in the garage, for a
  hybrid car), content larger than its box, warnings, settings the user had
  that the build changed.
- **PASS**: neither.

The widget table has one line per widget: `rendered`, `empty`, `error`,
`missing` (switched on, supported, never on screen), `off`, `not for this
simulator`, `own window` (the Gantry, the Pit Wall), with what the box read
and a link to each picture. **Look at the pictures.** The tool can tell an
empty box from a drawn one; it cannot tell a drawn one from a right one.

The verdict counts every console error. Errors that are already known and
accepted are not filtered out: read the list, it groups repeats.

## What the app does on the network during a run

Nothing in the app switches these off for a packaged build, so the tool does
not either; this is what was seen:

- **Auto-update**: `update-electron-app` runs, sets its feed and fails at once
  with `Can not find Squirrel` (in `app-output.log`), because a packaged folder
  is not an installed app. Nothing is requested and nothing can be installed.
  With `--target dev` the updater is not started at all.
- **Release notes**: the app asks `api.github.com` for the release it is on
  when a profile comes from an older version (the copy runs), and for the
  release list when the Release notes page is opened.
- **Fonts**: every window asks `fonts.googleapis.com` for its fonts.
- **Analytics**: off. `POSTHOG_KEY` is not set at build time.
- The recording stands in for the simulator's local REST API and shared
  memory; a live-standings socket is not opened for a recording.

## Things worth knowing

- **Where it runs matters.** Started from a service or an agent session
  (Windows session 0), the app's windows are on an invisible 1024x768 desktop
  with no GPU: nothing appears on the screen, WebGL is off, and a layout made
  for a larger monitor is shown through the app's fallback for widgets saved
  off-screen. Started from a desktop session, the windows are on the screen
  for the length of the run. The report says which display the app saw.
- **The profile switch works**: `--user-data-dir` moves `config.json`, the lap
  library, the logs (`<profile>\logs\main.log`) and Chromium's data together,
  and the single-instance lock is per profile folder, so a run does not collide
  with an installed Tearoff. The tool still refuses to run beside one.
- **`%APPDATA%\tearoff\logs\main.log` is not the app's alone.** Every spec run
  on the machine appends to it (electron-log under plain Node resolves to the
  package name). The tool therefore judges that file apart: it failing to stay
  the same proves nothing, while one of the run's own log lines turning up in
  it would stop the gate.
- **Replay speed.** An LMU recording plays at about its recorded pace
  whatever `IRDASHIES_LMU_REPLAY_SPEED` says: the tape source hands out one
  recorded frame per poll of the bridge, so the LMU runs take the four minutes
  the recording lasts. At a speed of exactly 1 its first frame took 102 s and
  165 s to arrive in two runs (the bridge reopens a recording whose first
  frame is not yet due, which starts its clock again), so the default is 4,
  which started at once every time. An iRacing recording does play faster,
  and the app then measures laps from fewer samples: at 8x the laps it timed
  were up to two seconds off and Lap Delta never found a reference, so the
  default is 2. The tool waits up to four minutes for the recording to start
  and says so in the report when it took more than a few seconds.
- **Quitting can take long on a busy machine.** Once the app has logged
  `App quit` its own shutdown is over; what is left is Chromium's. That waits
  for the network service process to end, for its own worker threads, and for
  every thread to exit, and some of those threads run at background priority
  (so do the idle-priority threads of the graphics driver in the GPU process).
  Windows gives such threads no processor while the cores it keeps them on are
  busy with anything of higher priority: on a hybrid CPU those are the
  efficiency cores, and another test run on the machine is enough to fill
  them. The process then stays for seconds to minutes and ends by itself.
  Measured on 2026-11-16 with both builds (this one and 2.2.1): 60 to 90 ms
  with the efficiency cores free, 3 s to more than 90 s with them full. A
  Tearoff started again in the meantime comes up as usual: the old process
  no longer holds the single-instance lock or the web server's port. The
  tool waits 60 s, then stops the process by its id and fails the run, so run
  the gate while nothing else heavy is running, and read a slow quit beside
  the processor load of the moment.
- **Global shortcuts** cannot be registered from a session without a desktop:
  `main.log` says `Shortcut unavailable` for each, and the Key Bindings page
  shows its warning on every row.
- **Closing the settings window from its page does not quit the app**
  (`window.close()` destroys that window without the close handler), which is
  why the tool quits through `Browser.close`.
- **A fresh profile logs one line for each file it does not have yet**:
  `No config.json yet: starting from the defaults`, at info level. A file that
  is there and cannot be read or parsed is still a warning with its error.
- **The tool's own pieces** that are pure (the grid, the error classification,
  the report and verdict, the profile and database comparisons, the guards)
  have specs in `tools/smoke/*.spec.ts`.
