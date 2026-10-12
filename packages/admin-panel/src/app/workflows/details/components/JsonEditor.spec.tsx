import { cleanup, fireEvent, render } from '@testing-library/react';
import { EditorView } from 'codemirror';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonEditor } from './JsonEditor';

const BACKSPACE_KEY_CODE = 8;

afterEach(cleanup);

function renderEditor(readOnly: boolean): EditorView {
  const { container } = render(<JsonEditor value='{"a":1}' readOnly={readOnly} label="Doc" />);
  const view = EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!);
  if (view === null) {
    throw new Error('The editor view was not mounted.');
  }
  return view;
}

describe('JsonEditor', () => {
  it('refuses edit commands when read-only', () => {
    const view = renderEditor(true);
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    fireEvent.keyDown(view.contentDOM, { key: 'Backspace', keyCode: BACKSPACE_KEY_CODE });

    expect(view.state.readOnly).toBe(true);
    expect(view.state.doc.toString()).toBe('{"a":1}');
  });

  it('applies edit commands when editable', () => {
    const view = renderEditor(false);
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    fireEvent.keyDown(view.contentDOM, { key: 'Backspace', keyCode: BACKSPACE_KEY_CODE });

    expect(view.state.doc.toString()).toBe('{"a":1');
  });
});
