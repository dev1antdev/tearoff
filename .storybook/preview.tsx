import type { Decorator, Preview } from '@storybook/react-vite';
import '../src/frontend/theme.css';

const OVERLAY_SIZES = [
  'off',
  '2xs',
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
  '3xl',
] as const;

/**
 * Renders a story inside the same overlay theme the app's ThemeManager
 * applies, so a widget can be checked at any font size and palette. Off by
 * default: stories then render exactly as they did before.
 */
const overlayThemeDecorator: Decorator = (Story, context) => {
  const size = String(context.globals.overlaySize ?? 'off');
  if (size === 'off') return <Story />;
  const palette = String(context.globals.overlayPalette ?? 'black');
  return (
    <div
      className={`contents overlay-window overlay-theme-${size} overlay-theme-color-${palette} overlay-theme-font-face-lato overlay-theme-font-weight-normal`}
    >
      <Story />
    </div>
  );
};

const preview: Preview = {
  initialGlobals: {
    backgrounds: { value: 'dark' },
    overlaySize: 'off',
    overlayPalette: 'black',
  },
  globalTypes: {
    overlaySize: {
      description: 'Overlay font size, as in Settings > General',
      toolbar: {
        title: 'Overlay size',
        icon: 'paragraph',
        items: OVERLAY_SIZES.map((value) => ({
          value,
          title: value === 'off' ? 'Off (no overlay theme)' : value,
        })),
        dynamicTitle: true,
      },
    },
    overlayPalette: {
      description: 'Overlay colour palette, as in Settings > General',
      toolbar: {
        title: 'Palette',
        icon: 'mirror',
        items: [
          { value: 'black', title: 'Black' },
          { value: 'default', title: 'Slate' },
          { value: 'zinc', title: 'Zinc' },
          { value: 'stone', title: 'Stone' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [overlayThemeDecorator],
};

export default preview;
