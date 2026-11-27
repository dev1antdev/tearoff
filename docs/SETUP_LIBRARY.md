# LMU setup library

Tearoff keeps a library of Le Mans Ultimate car setups on disk and copies
the ones for the track you are driving into the game. This page is the
contract for anything that writes setups into the library (a person, a
script, an AI assistant). Tearoff itself only ever **reads** the library and
**creates** files in the game; it never edits a setup, never deletes one,
and never loads one into the car.

## Where the library is

```
%USERPROFILE%\Documents\Tearoff\Setups\LMU\<track folder>\<anything>.svm
```

- The `Documents` path is the one Windows gives Tearoff, so it follows a
  redirected Documents folder.
- One folder per track. **The folder name must be the game's own track
  folder**, the name of a folder in
  `<Le Mans Ultimate>\UserData\player\Settings\` (for example `Spa`,
  `Lemans`, `Sebring`). Matching is case-insensitive, so `spa` works too,
  and the file lands in the game's `Spa`.
- The Settings window's **Setups** page lists the track folders the game
  already has, and shows the library path with an **Open folder** button
  that creates it.
- `.svm` files lying directly in the library folder (not in a track folder)
  are listed as "not in a track folder" and are never installed.
- Subfolders inside a track folder are ignored, as is anything that is not
  a file ending in `.svm`.

## What makes a valid setup file

A file is installed only when all of these hold:

1. Its name ends in `.svm` (any case) and is at most 255 characters.
2. It is at most 256 KB (empty files are refused).
3. It contains a line

   ```
   VehicleClassSetting="<car>"
   ```

   within its first 4096 characters. The value must be the car exactly as
   LMU writes it (for example
   `GT3 Porsche_911_GT3_R_LMGT3 WEC2025`). Tearoff reads it only to show the
   car on the page; LMU itself decides which setups a car can load.

A file that changes while it is read, or was written less than two seconds
ago, is shown as **Being written** and waits for the next pass, so a file
half-copied by its producer is never installed.

## When setups get into the game

- **Automatically**, while Le Mans Ultimate is connected and the
  **Install setups automatically** switch on the Setups page is on (it is on
  by default). Tearoff asks LMU's REST API which track folder the session
  uses (`GET /rest/garage/summary`, `currentTrackFolder`) and copies that
  track's library setups into
  `<Le Mans Ultimate>\UserData\player\Settings\<track folder>\`. It does
  this once when the session starts and then every 10 seconds, so a file
  added mid-practice arrives without a restart. Nothing runs for a
  telemetry tape, a replay file, demo mode, or while another simulator is
  running.
- **By hand**, with **Install to game** on a track's section of the page.
  This works with the game closed, as long as its folder is known. A
  manual install only uses a track folder the game already has (or the
  session's own folder); it does not invent one.
- The game's folder is found through Steam, and can be chosen by hand on
  the page.

Setups are copied for every car of that track; LMU's garage shows the ones
that fit the car you are in. Tearoff never loads a setup for you: pick it in
the garage.

## Updates, and what happens to your garage saves

Tearoff records a hash of every file it writes. A later pass compares three
things: the library file, the game's file, and what Tearoff last wrote.

- No file in the game → the library file is copied.
- Same bytes → nothing happens. **A file Tearoff did not write is never
  claimed**, even when its bytes match: if the library file later changes,
  that game file is left alone and shown as a conflict.
- The game's file is exactly what Tearoff wrote last time → it is replaced
  with the library's new version.
- The game's file changed since Tearoff wrote it (you saved it in the
  garage, or it is somebody else's file with that name) → **nothing is
  touched**. The page shows "Changed in the game" or "Another file has this
  name" and a **Replace** button. Replace asks first, then overwrites the
  name. What was there is kept beside it as
  `<name> (kept <date-time>).svm`, so even a save made after the page was
  opened is not lost.
- A write never clobbers something it did not check: a new file is created
  only if the name is free, and an update moves the old file aside, checks
  it again, and only then writes the new one. If LMU saves at that exact
  moment, the save is detected and put back, or kept as a
  `(kept …).svm` the garage lists like any other setup.
- A new copy is written to a staging file and only then put in place, so a
  half-written setup never appears under the real name. If Tearoff is killed
  while replacing a file anyway (a file system without hard links), the
  previous version is kept beside it as a `(kept …).svm` and the torn file
  shows as a conflict, which **Replace** repairs.
- Removing a file from the library never removes it from the game.
- Ownership is recorded per game data folder, so pointing Tearoff at
  another install (or another `UserData`) starts with no ownership there.

Tearoff also creates the game's track folder when the session's track has
none yet, and only then; nothing else in the game's setup folder is
created, changed or deleted.

## What the page shows

| Status                     | Meaning                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| In the game                | The game has exactly these bytes.                                                                                  |
| Not in the game yet        | A valid setup that will be copied on the next pass, or by **Install to game**.                                     |
| Being written              | The file is less than two seconds old, or changed while it was read; it waits.                                     |
| Changed in the game        | The copy in the game was changed after Tearoff installed it. Use **Replace** to overwrite it.                      |
| Another file has this name | The game already has a different file under this name that Tearoff did not write. Use **Replace** to overwrite it. |
| Not a setup file: ...      | Empty, larger than 256 KB, no `VehicleClassSetting` line, or unreadable.                                           |
| Could not copy (code)      | The game held the file (for example `EBUSY`); it is retried on the next pass.                                      |

The page also shows whether LMU is running, which track folder it reports,
and the track folders the game has.
