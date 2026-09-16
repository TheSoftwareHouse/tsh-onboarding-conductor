import type { PrismTheme } from 'prism-react-renderer';

// Syntax palettes from the theme spec (THEME.md §1): dark panels colour keys blue, strings yellow and
// literals purple on ink; light blocks stay near-monochrome so code reads as text, not decoration.

const dark = {
  plain: '#EDF1F4',
  background: '#282A2B',
  key: '#8DD4FF',
  string: '#FFCE85',
  literal: '#B5B4FF',
  muted: '#8F9094',
};

const light = {
  plain: '#1D1F20',
  background: '#F7F9FA',
  key: '#000000',
  string: '#62686A',
  literal: '#8785FF',
  muted: '#8F9094',
};

function palette(colors: typeof dark): PrismTheme {
  return {
    plain: { color: colors.plain, backgroundColor: colors.background },
    styles: [
      {
        types: ['comment', 'prolog', 'doctype', 'cdata'],
        style: { color: colors.muted, fontStyle: 'italic' },
      },
      { types: ['punctuation', 'operator'], style: { color: colors.muted } },
      {
        types: ['property', 'tag', 'attr-name', 'keyword', 'selector', 'class-name', 'builtin'],
        style: { color: colors.key },
      },
      {
        types: ['string', 'char', 'attr-value', 'url', 'regex', 'template-string'],
        style: { color: colors.string },
      },
      {
        types: ['number', 'boolean', 'constant', 'symbol', 'null', 'important'],
        style: { color: colors.literal },
      },
      { types: ['function', 'variable', 'parameter'], style: { color: colors.plain } },
      { types: ['deleted'], style: { color: '#EE1313' } },
      { types: ['inserted'], style: { color: colors.string } },
    ],
  };
}

export const tshDark = palette(dark);
export const tshLight = palette(light);
