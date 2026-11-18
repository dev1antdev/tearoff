import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  WidgetGroupLayoutEditor,
  type WidgetGroupEditorTile,
} from './WidgetGroupLayoutEditor';

const START: WidgetGroupEditorTile[] = [
  {
    id: 'input',
    name: 'Input',
    layout: { x: 0, y: 0, width: 380, height: 120 },
  },
  {
    id: 'flag',
    name: 'Flag',
    layout: { x: 390, y: 0, width: 210, height: 120 },
  },
  {
    id: 'relative',
    name: 'Relative',
    layout: { x: 0, y: 130, width: 600, height: 170 },
  },
];

const Editor = () => {
  const [tiles, setTiles] = useState(START);
  return (
    <div className="w-[480px] bg-slate-900 p-4">
      <WidgetGroupLayoutEditor
        width={600}
        height={300}
        tiles={tiles}
        onChange={(id, layout) =>
          setTiles((current) =>
            current.map((tile) => (tile.id === id ? { ...tile, layout } : tile))
          )
        }
      />
    </div>
  );
};

const meta = {
  title: 'components/Settings/WidgetGroupLayoutEditor',
  component: Editor,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Editor>;
export default meta;

/** A group wider than the page, drawn to fit. Drag a tile or its edges. */
export const Primary: StoryObj<typeof meta> = {};
