import { useState } from 'react';
import { useDashboard } from '@irdashies/context';
import {
  PIT_WALL_WIDGET_ID,
  getWidgetDefaultConfig,
  sanitizePitWallConfig,
  type PitWallWidgetSettings,
} from '@irdashies/types';
import { BaseSettingsSection } from '../components/BaseSettingsSection';
import { SettingActionButton } from '../components/SettingActionButton';
import { SettingDivider } from '../components/SettingDivider';
import { SettingProps, settingPropFor } from '../components/SettingProp';
import { SettingsSection } from '../components/SettingSection';
import { PitWallBrowserAccess } from './PitWallBrowserAccess';

const SETTING_ID = PIT_WALL_WIDGET_ID;
const SettingProp = settingPropFor(SETTING_ID);

const defaultConfig = getWidgetDefaultConfig(SETTING_ID);

export const PitWallSettings = () => {
  const { currentDashboard } = useDashboard();

  const savedSettings = currentDashboard?.widgets.find(
    (w) => w.id === SETTING_ID
  );

  const fromSaved = (): PitWallWidgetSettings => ({
    id: SETTING_ID,
    enabled: savedSettings?.enabled ?? false,
    // The saved config is untrusted: an unknown layout reads as the default.
    config: savedSettings
      ? sanitizePitWallConfig(savedSettings.config)
      : defaultConfig,
  });
  const [settings, setSettings] = useState<PitWallWidgetSettings>(fromSaved);

  // Same guarded set-during-render sync as the other widget settings sections:
  // useState only reads its initialiser once, so mounting before the dashboard
  // has loaded would otherwise persist defaults over the saved config on the
  // next edit.
  const [prevSaved, setPrevSaved] = useState(savedSettings);
  if (JSON.stringify(savedSettings) !== JSON.stringify(prevSaved)) {
    setPrevSaved(savedSettings);
    if (savedSettings) setSettings(fromSaved());
  }

  const [showDisabledHint, setShowDisabledHint] = useState(false);

  if (!currentDashboard) return <>Loading...</>;

  return (
    <BaseSettingsSection
      title="Pit Wall"
      description="A page in a window of its own that follows a race from your car's side: the session, the flag, where the car is and who is in it, over panels of the widgets you already have. Made for a second monitor, and for the hours a team-mate drives."
      settings={settings}
      onSettingsChange={setSettings}
      widgetId={SETTING_ID}
      // It is never placed on the overlay, so it has no position to reset.
      hidePositionReset
    >
      {(handleConfigChange) => (
        <SettingProps
          widget={SETTING_ID}
          config={settings.config}
          onChange={handleConfigChange}
        >
          <div className="space-y-4">
            <SettingsSection title="Window" scaleWidgetId={SETTING_ID}>
              <SettingActionButton
                title="Pit Wall Window"
                description={`The Pit Wall opens when you switch it on and stays closed once you close it. Use this to bring it back; the tray menu has the same item. It remembers its place, size and monitor.${
                  showDisabledHint
                    ? ' Turn the Pit Wall on above to open its window.'
                    : ''
                }`}
                label="Show Window"
                onClick={() =>
                  void window.pitWallBridge
                    ?.showWindow()
                    .then((opened) => setShowDisabledHint(!opened))
                }
              />

              <SettingDivider />

              <SettingProp path="layout" />
            </SettingsSection>

            <PitWallBrowserAccess />

            <SettingsSection title="What this is">
              <div className="space-y-3 text-sm text-slate-400">
                <p>
                  This is the first stage of the Pit Wall. What is built: the
                  window, the same page in a browser, the header, the three
                  layouts, and panels that show widgets Tearoff already has,
                  each with the settings you gave that widget, whether or not it
                  is switched on for the overlay. A panel&apos;s gear opens that
                  widget&apos;s settings.
                </p>
                <p>
                  What is not built yet: the endurance timing tower with lap
                  averages, the class rivals table, the crew and stint timeline,
                  the race log and the pace chart. Their places are taken by the
                  nearest widget, or left out. A panel whose widget the running
                  simulator does not support is left out too: under iRacing that
                  is Tyre &amp; Brake Wear, Weather Forecast, Tyres and Damage.
                </p>
                <p>
                  Nothing here has been seen in a live game yet. It has only
                  been checked on staged data.
                </p>
                <p>
                  Press F11 in the window, or the button in its header, for full
                  screen. On the page the widgets ignore their &quot;show only
                  when on track&quot; and session switches: those keep a widget
                  off the game&apos;s screen, and this is a screen of its own.
                </p>
              </div>
            </SettingsSection>
          </div>
        </SettingProps>
      )}
    </BaseSettingsSection>
  );
};
