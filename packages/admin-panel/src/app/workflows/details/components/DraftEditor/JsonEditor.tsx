import { useEffect, useRef, type ReactElement } from 'react';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import { basicSetup, EditorView } from 'codemirror';

export interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Names the editable region for assistive tech. */
  label: string;
}

const MIN_EDITOR_HEIGHT = '24rem';

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    minHeight: MIN_EDITOR_HEIGHT,
    backgroundColor: 'var(--color-bg-page)',
    color: 'var(--color-fg-1)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-mono)',
  },
  '&.cm-focused': { outline: '2px solid var(--color-tsh-black)', outlineOffset: '-2px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', overflow: 'auto' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-bg-subtle)',
    color: 'var(--color-fg-4)',
    borderRight: '1px solid var(--color-border-rule)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--color-bg-subtle)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--color-tsh-blue-100)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--color-tsh-black)' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--color-tsh-red)',
  },
});

/** A CodeMirror 6 JSON editor, controlled by `value`; a change from outside replaces the document. */
export function JsonEditor({ value, onChange, label }: JsonEditorProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return undefined;
    }

    const view = new EditorView({
      doc: value,
      parent: host,
      extensions: [
        basicSetup,
        json(),
        linter(jsonParseLinter()),
        lintGutter(),
        editorTheme,
        EditorView.contentAttributes.of({ 'aria-label': label }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The view is built once; `value` reaches it through the effect below.
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view !== null && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} className="min-h-0 flex-1 border-y border-border-rule" />;
}
