declare module 'file-type' {
  export interface FileTypeResult {
    mime?: string;
    ext?: string;
  }

  export function fileTypeFromBuffer(buffer: Buffer): Promise<FileTypeResult | undefined>;
}
