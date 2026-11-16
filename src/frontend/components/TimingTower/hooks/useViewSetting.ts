import { useState } from 'react';

/**
 * A choice made in the widget itself that starts from a saved setting: a
 * switch in the tower's header.
 *
 * The tower may be a copy hosted on the Pit Wall, which never writes to
 * disk, so the choice is kept here for as long as the widget is on screen.
 * It follows the saved setting again when that is changed: whoever moves
 * the setting means the tower to show it.
 */
export const useViewSetting = <T>(saved: T): [T, (value: T) => void] => {
  const [value, setValue] = useState(saved);
  const [followed, setFollowed] = useState(saved);
  if (followed !== saved) {
    setFollowed(saved);
    setValue(saved);
  }
  return [value, setValue];
};
