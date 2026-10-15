/** Saves `blob` to the user's device as `filename` through a temporary download link. */
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Deferred: some WebKit and older Gecko builds cancel a download whose URL is revoked in the same tick.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
