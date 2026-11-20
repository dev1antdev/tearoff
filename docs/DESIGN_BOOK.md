# Tearoff Design Book

> **Purpose:** how Tearoff looks and why, for anyone (human or LLM) changing
> what the user sees. Read it before any visual change. The values live in
> code (`src/frontend/theme.css` and Tailwind 4's palette); this book names
> them, says where each one is used, and sets the rules that keep the widgets
> one family.
>
> **Keep it current:** a PR that changes a colour role, a type step, a radius
> or one of the rules below updates this file in the same PR.

---

## 1. Two surfaces

Every rule here belongs to one of two surfaces.

| Surface        | What                                                                                                         | Root class                                                                     | Follows the driver's settings                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **Overlays**   | The widgets: transparent windows over the simulator (Standings, Relative, Input, Fuel, …)                    | `.overlay-window` (set by `ThemeManager`)                                      | Yes: font face, size, weight and palette from Settings > General |
| **App chrome** | Where the driver configures and watches: Settings, the Pit Wall's header and panels' frames, the Gantry bars | `.settings-shell` (in `SettingsLayout`, the Pit Wall and Gantry chrome pieces) | No: its own type and palette                                     |

The Pit Wall window sits inside `ThemeManager` too, so a widget hosted in a Pit
Wall panel uses the overlay scale and palette, exactly as it does on track. A
Pit Wall or Gantry frame is the hosted widget's panel: inside it the widget's
`overlay-panel` loses its own edge and corners (`shadow-none`,
`rounded-none`), so there is one box, not two; a border the widget draws itself
(the flag contour), the Fuel Calculator's warning outline and Traffic's pit-exit ring still show. A widget drawn as a stack of panels (the
session bars above and below Standings and Relative, `SessionPanels`, marked
`data-panel-stack`) closes up inside a frame: its panels sit flush, as bands of
one box.

The app is dark only (`color-scheme: dark`).

---

## 2. Content

- Call the product **Tearoff** in every user-visible string. Code identifiers keep the old `irdashies` names on purpose (`@irdashies/*` aliases, `IRDASHIES_*` variables, storage keys); see `AGENTS.md`.
- Sentence case for labels: "App settings", "Skip to settings", "Overlay font sample", "Name format", "Speed position".
- Name an action by what it does: "Reset position", "Move up". A destructive action states its verb, carries a trash icon, and its confirmation opens on Cancel.
- An error or warning is written next to the field it concerns and tied with `aria-describedby`. Colour is never the only cue.
- **No emoji anywhere in the UI.** Icons are Phosphor (section 9).
- Numbers use `tabular-nums`. Lap times read `1:32.418`; gaps and deltas carry a sign (`+0.4`, `-0.214`).
- Settings stay calm and dense, like a desktop utility: no racing textures, promotional imagery, ornamental statistics or empty preview panels.

---

## 3. Overlays

### 3.1 Panel and rows

| Element          | Classes                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Widget panel     | `overlay-panel` (`theme.css`): `bg-slate-950/(--bg-opacity)`, a 1px edge drawn as an inset `white/9` shadow so it takes no room, `rounded-xl` (12px); `p-2` (compact mode drops it), `text-white`                                                |
| Rows             | No background. A hairline between them: `border-t overlay-divider first:border-t-0`; on a table row, on its cells (`[&>td]:border-t [&>td]:overlay-divider`)                                                                                     |
| The player's row | An amber tint (`bg-amber-500/(--player-row-opacity)` in Standings and Relative) and `text-amber-300`, the position included                                                                                                                      |
| Divider          | `overlay-divider` (a `white/5` border colour), between sections of one panel; between the children of a row or column, `overlay-rules-x` / `-y`, a line in the middle of the gap that adds no size (`--rule-gap` for a gap other than `gap-1.5`) |
| Selected row     | `overlay-selected` (`bg-slate-800/60 rounded-md`): the chosen or recommended line of a table or column of a strip (the Fuel Calculator's average, its best pit lap)                                                                              |
| Bar track        | `bg-slate-900/70`, `rounded-full` when thin, `rounded-md` when tall (Pitlane Helper); the fill inside takes its meaning's colour                                                                                                                 |
| Chip / scrim     | `bg-slate-950/NN` (behind a chip, a warning pill, a readout over a graphic)                                                                                                                                                                      |
| Inner tile       | Avoid a tile inside a panel: group with space and a divider. Where one is needed, `bg-slate-900/70`, `rounded-md`                                                                                                                                |

`--bg-opacity` comes from the widget's own `background.opacity` setting
(0–100). At low opacity the game is the ground, so values stay `text-white`.
An inline border (the flag contour) adds its own width while it shows. The
edge itself takes none, so a layout sized before panels had edges, or a stack of
several panels, keeps fitting its frame.

A widget made of several sections can draw each as a card of its own instead,
an `overlay-panel` per section in a stack (`data-panel-stack`) with no panel
around them. The Fuel Calculator draws a card for each section stacked down
its layout; boxes side by side share one card, a hairline between them. The
cards have no padding of their own (the sub-widgets pad themselves), so they
take no more room than the single panel did and a saved layout keeps fitting
its frame. Its fuel warning draws one outline in its colour round the whole
stack. A safe fuel state is the normal one, so it is neutral (white values, a
light bar); caution and danger take amber and red.

Graphic widgets (Radar, Track Map, Minimap, Blind Spot Monitor, the Flag light
board) draw their own shapes and have no panel. A canvas cannot read CSS
variables, so the canvas widgets read the palette's neutrals and the overlay's
font from where they sit (`useCanvasTheme`, again when either changes) and turn
the colours into hex once, which a canvas parses fastest each frame. The track
maps draw a light neutral road on a dark edge (`slate-300` on `slate-950`,
swapped when inverted), cars in their exact class colours with the number dark
on a light fill (`textColorOn`), you in amber, a car in the pits `slate-500`,
and turn names in small capitals on a `slate-950` scrim; the moving markers
have no drop shadow (Minimal Car Markers, on by default). The Minimap's disc
is the panel's `slate-950`, its road `slate-300`, the car it follows white in
a ring of your highlight colour. The Radar takes its neutrals from the palette
too; your own car stays white there, since amber is its close warning, so the
warning is the one bright spot. Elevation tints the driven part of the lap a
light neutral, not sky (rain), and its reading carries no shadow; Corner
Names writes the corner number as a grey label and its progress is a neutral
bar on a bar track. Corner Names keeps its own font size in pixels, as Timing
keeps its Text Scale. The Tachometer's and Shift
Light's readout boxes are overlay panels; the Tachometer's rev lights are
rounded segments, unlit `slate-800`, lit at once in their own colours (the
car's, or green, yellow, red and purple at the shift point) with no glow, edge
or fade. The Broadcast graphics keep their own panels (own themes). The Timing
Tower takes the overlay panel, hairline rows and the shared cells, and keeps
its fixed column widths and type sizes.

Input: each pedal is a thin rounded strip on a bar track, half its column wide,
its value above and its letter (C, B, T) below as a label. Pedals take the 400
shades (clutch `blue-400`, brake `red-400`, throttle `green-400`) in the bars
and the trace alike; an assist at work turns the strip `yellow-500`. The trace
grid is a faint solid hairline. The default wheel is a faint ring with a short
arc that turns with the wheel and the angle in its centre; the wheel pictures
and the ring with the gear inside remain styles. Gear and speed are in the
overlay font, the unit a grey label.

Car systems: a system's own colour (Car Systems' dials) is a short bar under its
label, which is the small grey capitals; the label fills `yellow-500` only
while the system works, and the value `amber-400` for a moment after the driver
moves its dial. The Hybrid's motor state is a
tinted pill (deploy orange, regeneration emerald), and a charge in range is a
neutral bar, as safe fuel is; low and high take red and amber. The Lift and
Coast lights are the rev lights' rounded segments in the sim's own colours,
unlit `slate-800`, with no rim. Cruise's readings sit on the panel, not on
tiles of their own.

Car state: Damage draws Tearoff's own car from above, long as a real car, in
eight body panels with a gap between each, one per zone: a whole panel is a
dark band with a thin `slate-600` edge, a dented one filled `amber-400`, a
badly damaged one `red-500`, and one that has come off a dashed red line. Each
corner has its wheel, which shows the tyre alone (grey, a red rim when flat,
dark and dashed when it has come off), and a wishbone beside it for the
suspension: a thin grey outline while sound, filled with the damage scale.
The figure in the middle is laid over the drawing in the overlay's type size. Tyres are blocks filled with the temperature scale, the temperature
large inside, pressure and wear small beside them. A bar that is in range
(ride height, what Our Car has aboard) is neutral; only a warning colours it. Chassis
lays its blocks out in a column, in two rows or in one row; a hairline in the
middle of the gap separates them, a pseudo-element that adds no size.
Our Car's damage line is white while the car is sound, `amber-400` for damage
to watch and `red-400` for a wheel off or flat. A tyre pressure on the driver's
target stays `green-400`, the one good news shown in colour here, because the
target is the reading's purpose; low is `sky-400`, high `red-400`.

Conditions: Weather's readings sit on the panel with a hairline between them
(a pseudo-element in the gap, no size), the icon and caption grey and thin,
the value white, captions `overlay-label` in a column and grey in their own type in a row (so a row is no wider); the wind compass is a thin ring in
the wind's own colour, its speed an overlay step. Track wetness is drawn in the
forecast's rain colours (`sky`), not blue, which is a lapped car.
The forecast's columns have no tiles: the column for now is the selected one
(`overlay-selected`), and a wet point ahead takes its heading in `sky-300`;
a lighter sky is drawn with a thin outline, a heavier one with the regular
stroke. The Information Bar's items stand in columns with a hairline in the middle of
each gap (a pseudo-element, so the bar is no wider); it keeps its tinted strip inside
its panel on purpose, the strip being what its Foreground Opacity setting sets. Flags keep their exact colours.

Timing: readings sit on the panel with `overlay-rules-x` / `-y` between them.
A sector's colour (session best purple, personal best green, slower yellow,
red) is a light tint of its reading (`SECTOR_TINT`, 20%), not a bar under it.
The Lap Timer's current and
predicted lap and its stat cells (their captions grey in their own type, so a cell is no wider) keep their tinted tiles: they are what its
Foreground Opacity setting sets. The Lap Timer keeps its own record colours,
session best green, overall best purple and all-time best yellow, flashed on
the current lap when set. Timing keeps its own Text Scale instead of the
Font size: a general change would resize every saved Timing window.

Rival tables (Battle, Class Rivals, Finish Projection's rivals) are drawn as
the standings are: no stripes, a hairline between rows (the cells' top pixel of background
where a border would make a row taller), the focus row `bg-amber-500/20`, a car
number grey after a bar in its class colour (`CarNumberCell`; Battle's own cell keeps its
narrower width; `CarNumber` in a row that is not a table), a pit request a thin green outline. The Timing
Tower's status tags take the status badges' outlines (`STATUS_BORDER`). Class
Fields names each class with the short bar, its counts on the panel, a hairline
between classes, and the focus car's class `overlay-selected`. Finish
Projection's column for now is `overlay-selected`; a margin near a lap's edge
is a caution, `amber-400`.

Traffic alerts are calm until they warn. A rejoin or pit-exit warning (Rejoin
Indicator, Traffic's pit exit block) is an opaque panel, not a block of
colour: the state's word is the one bright spot (`REJOIN_LOOK`), filled for a
caution (`amber-500`) or a danger (`red-600`) and tinted when clear, and a
caution or a danger rings the panel in its colour (the Fuel Calculator's
warning outline colours, 2px inside the edge rather than its 1px, as it
stands in for a block of colour). Traffic's mirror rows and contact
columns have no tiles, a hairline between them; a car coming to lap you keeps
its blue outline, and a meeting inside the lap is a caution. Faster Cars From
Behind draws each car as an opaque card of its own (`rounded-lg`, a short
card), the class a bar in its colour, its proximity bar on a `slate-800` track
(the closest card is `slate-900`). A car coming to lap you is drawn in the blue
flag's `blue-500`, not sky, which is rain. Slow Car Ahead's bars sit on a bar track; the Blind Spot Monitor stays
a graphic, its track in the palette's darkest neutral.

### 3.2 Neutrals follow the palette

The driver picks one of four palettes. Each remaps `--color-slate-*` under
`.overlay-window`:

| Setting value | Name            | What `slate-*` becomes        |
| ------------- | --------------- | ----------------------------- |
| `black`       | Black (default) | Neutral greys, `oklch(L 0 0)` |
| `default`     | Slate           | Tailwind's slate (blue-grey)  |
| `zinc`        | Zinc            | Tailwind's zinc               |
| `stone`       | Stone           | Tailwind's stone (warm grey)  |

So: **overlay neutrals are written in `slate-*` only.** `gray-*`, `zinc-*`,
`neutral-*`, `black`, or a hex neutral does not follow the palette.

| Text role                            | Class                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| Values                               | `text-white`                                                                     |
| Supporting values                    | `text-slate-200`, `text-slate-300`                                               |
| Column headers, labels, muted values | `text-slate-400` (about 6.5:1 on `slate-950`)                                    |
| Labels over or beside a value        | `overlay-label`: `text-2xs`, semibold, upper case, `tracking-wider`, `slate-400` |
| Units, placeholders, empty values    | `text-slate-500` (about 3.5:1 on `slate-950`: never for content)                 |

### 3.3 Meanings

These hold in every palette.

| Meaning                                                                 | Class                                             | Note                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| The player ("you")                                                      | `text-amber-300`; a focused row `bg-amber-500/20` | Keep amber for "you"                                           |
| Session's fastest lap                                                   | `text-purple-400`                                 | Timing-screen convention                                       |
| A driver's personal best                                                | `text-green-400`                                  |                                                                |
| Gain, good outcome (spare fuel at the end, …)                           | `text-green-400`                                  | With a sign or an arrow                                        |
| Caution, within reach (fuel tight, a place at risk, a target reachable) | `text-amber-400`                                  | Not `amber-300`, which is "you"; red when it turns into a loss |
| Loss, warning, error, urgent countdown                                  | `text-red-400`                                    | With a sign, an arrow or words                                 |
| Lapped car                                                              | `text-blue-400`                                   |                                                                |
| Marked or voided lap                                                    | `text-white/60`                                   |                                                                |
| Text on a tinted badge                                                  | the light shade of its hue                        | e.g. `bg-red-900 text-red-200`, `bg-red-500/20 text-red-300`   |

Colour is for these meanings only. A neutral value (an amount to add that fits, a level
in the tank) stays white even when it is good news.

### 3.4 Sim colours stay exact

These come from the simulator's own vocabulary and are not themed.

- **Flags** (`getFlagColor`): green `green-500`, yellow and debris `yellow-400`, blue `blue-500`, red `red-500`, white and chequered white, black and disqualified black, meatball `orange-500`, none `gray-400`. A readout that works like a traffic light (the pit-lane speed: green, amber, red) uses the same -500 shades.
- **Licence badges** (`DriverRatingBadge`): the licence colour as a 1px outline at 70% and a 12% tint, the text in its light shade, `text-xs`, `rounded-md`: R `red-500`/`red-300`, D `orange-500`/`orange-300`, C `yellow-500`/`yellow-300`, B `green-500`/`green-300`, A `blue-500`/`blue-300`, P `purple-500`/`purple-300`, W `zinc-100`. Minimal keeps a faint outline and the coloured text. The iRating beside it is `bg-white/8 text-slate-200`.
- **Status badges** (`DriverStatusBadges`: PIT, OUT, DNF, …): a 1px outline in the status colour, `rounded-full`.
- **Class colours** (`getTailwindStyle`): iRacing ranks classes fastest first as yellow, blue, red, cyan, pink, purple, amber, lime; a class renders in the -500 shade as a short bar before the class name and as the car number's left border; the number itself is `slate-400`. Filling the class name, the class info and the number with the class colour (the -500 and -800 shades) are settings, off by default. Le Mans Ultimate classes keep their exact livery values (Hypercar `#ff000a`, LMP2 `#0690ff`, LMP3 `#763993`, LMGT3 `#00ff6a`, LMGTE `#fff600`); the chip shows them at 30% with a solid border. An unknown class falls back to stone.
- **LMU rank badges** (`LmuRatingBadge`) and the penalty badge's exact `#FF0000`.

### 3.5 Type scale

Overlay text sizes are relative. `.overlay-window` sets `--text-xs` to
`--theme-offset`; each step up adds 1px and `--text-2xs` sits 1px below xs. The
Font size setting picks the offset, from 7px (`4xs`) to 22px (`9xl`).

| Class                  | At the default size (`sm`) | Use                                                 |
| ---------------------- | -------------------------- | --------------------------------------------------- |
| `text-2xs`             | 10px                       | Smallest labels: chart ticks, captions over a value |
| `text-xs`              | 11px                       | Footers, badges, units                              |
| `text-sm`              | 12px                       | Table rows (Standings, Relative)                    |
| `text-base`            | 13px                       | Standalone values in small widgets                  |
| `text-lg`              | 14px                       | Emphasised readouts                                 |
| `text-xl` … `text-9xl` | 15px … 23px                | Emphasised numbers, large deltas                    |
| `text-display-sm`      | 22px (offset × 2)          | The value a small widget exists to show             |
| `text-display-md`      | 27.5px (offset × 2.5)      | Gear, a headline delta                              |
| `text-display-lg`      | 38.5px (offset × 3.5)      | The one number of a large widget                    |

Rules:

- **Use the scale only.** Never `text-[11px]` or a rem size: they ignore the Font size setting. `em` sizes inside a widget (`text-[0.7em]`) are fine, since they scale with it.
- `text-2xs` sets no line height of its own; the others carry Tailwind's.
- Where a larger size leaves a fixed-width tile too narrow, let the line wrap (`flex-wrap`) rather than cut words short.
- **Fixed-size by design:** the Timing Tower (its columns have fixed widths, so its text is fixed with them) and the Broadcast graphics (they have their own themes on the Broadcast settings page). Make anything else fixed only with a reason written next to it.
- Widget Scale (50–200%, 5% steps) scales a whole widget on top of the font size.

The display steps scale with the Font size setting too and set a line height
of 1.

Faces: Figtree by default; Lato, Noto Sans, Inter and Roboto are the driver's
alternatives, all from Google Fonts. A profile still on Lato, the default
before Figtree, moves to Figtree once when it loads (`redesignDefaultsApplied`);
picking Lato afterwards sticks. The canvas widgets (the track maps, the
Minimap, the Radar) draw their text in the overlay's face too, read with the
palette. Weights run from light to extrabold, normal by default.

### 3.6 Hierarchy, and what overlays avoid

The rules a widget is brought to when its look is redone, one group of widgets
at a time; a widget not redone yet may still break the first four.

- **Size and brightness, not colour, say what matters.** The value a widget
  exists for is the largest (a display step); its unit is smaller and
  `slate-400` beside it (`46.42 L`, `27.4 PSI`). Supporting numbers are smaller
  again.
- **One bright spot per row.** Tinted text and a thin outline before a filled
  background; a fill only for what needs action now (a tow, the brake point).
- **No stripes, no border around every cell, no tile inside a tile.**
- **No glow, blur or shadow on anything that changes every frame** (pedals, RPM
  lights, live deltas). Electron's GPU process already takes the largest share
  of the app's CPU (`docs/performance/2026-11-14-cpu-sniff.md`). A static
  element may carry a soft glow.
- **Thin icons** in overlays: Phosphor `weight="light"`.
- **Our own drawings.** "You" is amber; car and tyre drawings are Tearoff's own.

---

## 4. App chrome

### 4.1 Colour roles

Inside `.settings-shell`, `slate-*` and `accent-*` are redefined (below). The
`settings-*` roles are global `@theme` colours.

| Role                                     | Class / variable                                       | Value                 |
| ---------------------------------------- | ------------------------------------------------------ | --------------------- |
| Header and sidebar canvas                | `bg-slate-950`                                         | `#141a21`             |
| Page surface, ground for fields          | `bg-slate-900`, `bg-settings-page`                     | `#1b222b`             |
| Raised control or panel                  | `bg-slate-800`, `bg-settings-control`                  | `#242c36`             |
| Quiet rule, off-switch track, hover fill | `slate-700`, `bg-settings-hover`                       | `#343d49`             |
| Control border                           | `border-settings-boundary`                             | `#8794a6`             |
| Legacy range track                       | `settings-track`                                       | `#8794a6`             |
| Main text                                | `text-slate-200`                                       | `#e0e5eb`             |
| Secondary labels, field hover border     | `text-slate-300`                                       | `#c5cdd7`             |
| Helper and navigation copy               | `text-slate-400`                                       | `#a5afbd`             |
| Captions, disabled Reset                 | `text-slate-500`                                       | `#9aa5b4`             |
| Page headings                            | `text-white`                                           | `#ffffff`             |
| Selection, focus, slider signal          | `accent-400`                                           | `#f87171`             |
| Selected label over a red tint           | `text-accent-200`                                      | `#fecaca`             |
| Switch on, Pit Wall selected tab         | `bg-accent-500`                                        | `#dc2626`             |
| Primary button fill / hover              | `settings-button-primary`: `accent-600` / `accent-700` | `#b91c1c` / `#991b1b` |
| Text on accent fills                     | `text-on-accent`                                       | `#ffffff`             |

- **Never use `slate-600` (`#768394`) as a fill**: white on it is only 3.86:1.
- Outside `.settings-shell` the `accent-*` scale resolves to Tailwind blue; overlays do not use it.
- Opaque surfaces first; alpha only for selected backgrounds and light panel separation.
- Status dot beside the simulator name: `bg-emerald-400`.

### 4.2 Controls

Opt in per element with the `theme.css` utilities; never style controls through
descendant selectors.

| Utility                   | What                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `settings-button`         | 36px min height, `settings-control` fill, 1px `settings-boundary`, 13px text, `rounded-md`                                  |
| `settings-button-primary` | Red fill (`accent-600`, hover `accent-700`), white text. For create actions                                                 |
| `settings-button-danger`  | Neutral fill, `text-red-300`, `bg-red-950` on hover. Plus the verb and a trash icon                                         |
| `settings-field`          | Text, number, search, select, textarea. Same box; hover raises the border to `slate-300`; `aria-invalid` turns it `red-400` |

Build pages from the existing primitives: `BaseSettingsSection`,
`SettingsSection` (`variant` `panel` or `inline`; titleless sections default
to inline), `SettingToggleRow`, `SettingNumberRow`, `SettingSelectRow`,
`TabButton`, `ToggleSwitch`, `ConfirmDialog`, `ReorderControls`, and the
manifest-backed `settingPropFor` rows (see `AGENTS.md`, Adding a widget).

### 4.3 States

- **Focus:** 2px `accent-400` outline, 3px offset, on `:focus-visible`, scoped to `.settings-shell`. An error never hides it.
- **Hover:** brighten the border or raise the neutral fill.
- **Selected:** a red rule or underline plus text and background; `aria-pressed` or `aria-current`; name formats add a check mark.
- **Disabled:** native `disabled`, 45% opacity, the reason kept in view.
- **Invalid:** `aria-invalid`, `red-400` border, a written error tied with `aria-describedby`.

### 4.4 Keyboard and interaction

- **Skip to settings** is first in keyboard order and sends focus to the main region. On a route change focus goes to main; not on first mount or while filtering.
- Every reorder row has always-visible Move up / Move down buttons (36px) beside the drag handle; announce the new position and item count.
- Confirmations start on Cancel, contain Tab, close on Escape, make the background inert and return focus to the invoker (or to main if it is gone).
- The App settings disclosure follows the WAI disclosure pattern; don't claim combobox or listbox roles without their full keyboard contract.
- Search is local UI state: case-insensitive, trimmed, never persisted.

### 4.5 Type

`.settings-shell` uses `'Segoe UI', system-ui, sans-serif` at 14px / 1.5.
Do not bundle or fetch Segoe UI; elsewhere the platform UI face stands in.

| Role            | Classes                                           | Size |
| --------------- | ------------------------------------------------- | ---- |
| Page heading    | `text-xl font-semibold tracking-tight text-white` | 24px |
| Section heading | `text-lg font-semibold`                           | 17px |
| Label, body     | `text-base`                                       | 14px |
| Control, helper | `text-sm`                                         | 13px |
| Group caption   | `text-xs uppercase tracking-wider text-slate-500` | 12px |

### 4.6 Layout

- 4px rhythm: 8px related gaps, 12px compact gutters, 16px section padding, 20px between rows, 24px between major groups, 28px main gutter from 1024px.
- Controls at least 36px high; no target under 24px. Switches 44×24 (navigation 36×24).
- Shell: header at least 80px; sidebar 232px, 252px from 1280px; the form column at most 960px, centred. Navigation and page scroll separately. Labels wrap rather than truncate; nothing scrolls sideways at 808px.
- The Settings window opens at 1600×900 logical pixels, capped at 90% of the primary display's work area and centred (`defaultSettingsWindowBounds`).
- Only show previews backed by real components and configuration; no fake screenshots.

---

## 5. Logo and wordmark

- The mark is `src/frontend/assets/icons/logo.svg` (also `docs/assets/icons/logo.svg`, `logo.png`, `logo-tray.png`, `.ico`, `.icns`). Use it unchanged: its red `#fa2713`, orange `#f89806` and blue `#0097dc` stay inside the artwork. Never tint, outline or redraw it.
- The wordmark is live text beside the 28px mark with a 12px gap: `Tear<span className="text-red-600">off</span>` in `text-lg font-semibold tracking-[-0.04em] text-white`. It heads the Settings, Pit Wall and Gantry windows. At phone width the Pit Wall hides the words and keeps the mark.

---

## 6. Shape, borders and depth

- Radii: overlay panels `rounded-xl` (12px, part of `overlay-panel`); rev light segments `rounded-[30%]`; a fill or flash box inside an overlay panel (the Delta Speed fill, the Shift Light readout) `rounded-lg`; fields, buttons and licence badges `rounded-md`; larger settings panels and Pit Wall panels `rounded-lg`; dots, thumbs, thin bars and their tracks, a class's colour bar, status pills and scrollbars `rounded-full`; tall bar tracks (Pitlane Helper) `rounded-md`.
- Separate with hairlines and space, not depth. Shadows only for layers that float over the page (menus, popovers, the profile-switch notice).
- Scrollbars in `.settings-shell`: 6px, thumb `white/12%` (hover `white/24%`), transparent track.

---

## 7. Motion

Short, and only with a job. `theme.css` defines `pulse-border` and `blink`
(1s, repeating) for states that need attention, `broadcast-enter` (400ms
ease-out slide-in), `broadcast-fade` (5s) and `name-slide-*` (5s) that
alternate a driver's name and label. Broadcast transitions are chosen on the
Broadcast settings page. Settings uses colour transitions only.

---

## 8. Accessibility targets

Normal text at least 4.5:1, borders, focus rings and state cues at least 3:1,
measured against the surface actually behind them (including alpha).
Measured pairs: `slate-200` on `settings-control` 11.1:1, `settings-boundary`
on `settings-control` 4.58:1, white on `accent-600` 6.46:1, white on
`accent-500` 4.83:1, `accent-400` on `slate-800` about 5.1:1. Overlay
`slate-500` text is about 3.5:1 on the `slate-950` panel, which is why it is
kept for units and empty values.

---

## 9. Icons

- Phosphor through `@phosphor-icons/react`. Regular weight in settings; `weight="light"` in overlays as each is redone (section 3.6): wrap the widget in `<IconContext.Provider value={OVERLAY_ICONS}>` (`src/frontend/utils/overlayIcons.ts`) rather than setting the weight icon by icon, with `weight="fill"` or `weight="bold"` only where an icon has to hold up at a small size. 16px in buttons and rows; icons take the text colour.
- Map icon names chosen at runtime through `src/frontend/utils/phosphorIconMap.ts`.
- The one custom glyph is the finished-car checkered flag in `DriverStatusBadges.tsx`: Phosphor's `FlagCheckered` cannot be read at badge size.

---

## 10. Checking a visual change

1. In Storybook, the toolbar's **Overlay size** and **Palette** render any story inside the overlay theme. Check a widget at the default `sm`, at a large size (`lg` or `xl`) and in a second palette.
2. Pit Wall panel stories render inside the overlay theme, as the real window does.
3. Every visual PR carries Before / After screenshots (see `AGENTS.md`, Pull Requests).

---

The Tearoff mark and the original design come from the irDashies project by
Tarik Alani and its contributors.
