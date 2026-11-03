const HTTP_NO_CONTENT = 204;

/** A 1x1 transparent PNG: small, and a real image, so the engine's dimension check passes. */
export const IDENTITY_DOCUMENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export interface PresignedPostForm {
  url: string;
  fields: Record<string, string>;
}

/**
 * Posts the bytes to the presigned target as the contract describes: every field verbatim, the file
 * last under the part name `file`. The engine signs the URL for the object store's address inside
 * Compose, so its origin is replaced with `storageUrl`, the one the host can reach.
 */
export async function uploadDocumentBytes(
  form: PresignedPostForm,
  storageUrl: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const target = new URL(form.url);
  const storage = new URL(storageUrl);
  target.protocol = storage.protocol;
  target.host = storage.host;

  const body = new FormData();
  for (const [name, value] of Object.entries(form.fields)) {
    body.append(name, value);
  }
  body.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }));

  const response = await fetch(target, { method: 'POST', body });

  if (response.status !== HTTP_NO_CONTENT) {
    throw new Error(
      `The object store answered ${response.status} to the document upload: ${await response.text()}`,
    );
  }
}
