import { describe, expect, it } from 'vitest';
import { STEP_TYPE } from '@tsh/ddl-schema/step-types';
import { findConfigHint, findConfigLabel } from './config-hints';

describe('findConfigHint', () => {
  it("reads a step type's own config hint", () => {
    expect(findConfigHint('config', STEP_TYPE.decision, 'fallback')).toBe(
      'Adds a default port for when no branch matches.',
    );
  });

  it('reads a connector hint on any step type', () => {
    expect(findConfigHint('connector', STEP_TYPE.decision, 'fallback')).toBe(
      'Backup providers of the same type, tried in order.',
    );
    expect(findConfigHint('connector', null, 'errorHandler')).toBe(
      'What to do when the call fails; empty falls back.',
    );
  });

  it("gives a connector's order the same hint on every step type", () => {
    for (const type of [STEP_TYPE.connectorCall, STEP_TYPE.custom]) {
      expect(findConfigHint('connector', type, 'order')).toBe(
        'The order connectors run in; unique within the step.',
      );
    }
  });

  it("tells http-call's own field mapping apart from a connector's", () => {
    expect(findConfigHint('config', STEP_TYPE.httpCall, 'fieldMapping')).toBe(
      'Only to fill a placeholder from another field: placeholder → field.',
    );
    expect(findConfigHint('connector', STEP_TYPE.httpCall, 'fieldMapping')).toBe(
      'Fields sent to the provider, as provider name → field.',
    );
  });

  it('keeps hints to their owner and step type', () => {
    expect(findConfigHint('config', STEP_TYPE.form, 'fallback')).toBeUndefined();
    expect(findConfigHint('config', STEP_TYPE.decision, 'when')).toBeUndefined();
    expect(findConfigHint('field', STEP_TYPE.form, 'when')).toBe(
      'Asks for the field only when this holds; otherwise it must be left out.',
    );
  });

  it('finds nothing for an inherited object key', () => {
    expect(findConfigHint('config', 'constructor', 'toString')).toBeUndefined();
    expect(findConfigHint('field', STEP_TYPE.form, 'constructor')).toBeUndefined();
  });
});

describe('findConfigLabel', () => {
  it('overrides url and timeoutMs only', () => {
    expect(findConfigLabel('url')).toBe('URL');
    expect(findConfigLabel('timeoutMs')).toBe('Timeout (ms)');
    expect(findConfigLabel('method')).toBeUndefined();
  });
});
