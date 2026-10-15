import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFile } from './download-file';

describe('downloadFile', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clicks a temporary download anchor, then removes it and revokes the URL after a tick', () => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(document.body.contains(this)).toBe(true);
    });

    downloadFile(new Blob(['a,b']), 'out.csv');

    const clicked = click.mock.contexts[0] as HTMLAnchorElement | undefined;
    expect(clicked?.download).toBe('out.csv');
    expect(clicked?.getAttribute('href')).toBe('blob:csv');
    expect(document.body.contains(clicked ?? null)).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:csv');
  });
});
