import { S3Client } from '@aws-sdk/client-s3';
import * as S3Commands from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { imageSize } from 'image-size';
import { resolveS3StorageContractFromConfig } from '../config/s3-storage.config';
import type { S3StorageContract } from '../config/s3-storage.config';
import type {
  DeleteStagedObjectInput,
  InspectStagedObjectInput,
  InspectStagedObjectOutput,
  IssueUploadTicketInput,
  IssueUploadTicketOutput,
  ObjectStoragePort,
  PromoteInspectedObjectInput,
  PutObjectInput,
  PutObjectOutput,
  ReadObjectInput,
} from './object-storage.port';

type DetectedFileType = {
  ext: string;
  mime: string;
};

type FileTypeModule = {
  fileTypeFromBuffer: (input: Uint8Array | ArrayBuffer) => Promise<DetectedFileType | undefined>;
};

type ConfigReader = {
  getOrThrow: <T>(key: string) => T;
};

export class S3ObjectStorageService implements ObjectStoragePort {
  private readonly contract: S3StorageContract;
  private readonly s3Client: S3Client;
  private fileTypeFromBufferLoader?: Promise<FileTypeModule['fileTypeFromBuffer']>;

  constructor(configService: ConfigReader, s3Client?: S3Client) {
    const contract = resolveS3StorageContractFromConfig(configService);
    this.contract = contract;
    this.s3Client =
      s3Client ??
      new S3Client({
        region: contract.region,
        endpoint: contract.endpoint,
        forcePathStyle: contract.forcePathStyle,
        credentials: {
          accessKeyId: contract.accessKeyId,
          secretAccessKey: contract.secretAccessKey,
        },
      });
  }

  async issueUploadTicket(input: IssueUploadTicketInput): Promise<IssueUploadTicketOutput> {
    const post = await createPresignedPost(this.s3Client, {
      Bucket: this.contract.bucket,
      Key: input.objectKey,
      Expires: input.expiresInSeconds,
      Conditions: [
        ['eq', '$Content-Type', input.contentType],
        ['content-length-range', 1, input.maxSizeBytes],
        ['eq', '$key', input.objectKey],
      ],
      Fields: {
        key: input.objectKey,
        'Content-Type': input.contentType,
      },
    });

    return {
      kind: 'post-form',
      objectKey: input.objectKey,
      contentType: input.contentType,
      maxSizeBytes: input.maxSizeBytes,
      url: post.url,
      fields: post.fields,
    };
  }

  async inspectStagedObject(input: InspectStagedObjectInput): Promise<InspectStagedObjectOutput> {
    const timeoutMs = input.timeoutMs ?? 5000;
    const detectorPrefixBytes = 1024 * 1024;
    const headReply = await this.sendWithTimeout(
      new S3Commands.HeadObjectCommand({ Bucket: this.contract.bucket, Key: input.objectKey }),
      timeoutMs,
    );

    const head = headReply as { ContentLength?: number; ETag?: string };
    const expectedSize = Number(head.ContentLength ?? 0);
    const expectedEtag = head.ETag?.trim() ?? '';
    if (input.expectedEtag && expectedEtag !== input.expectedEtag) {
      throw new Error(`storage etag mismatch: expected ${input.expectedEtag}, got ${expectedEtag}`);
    }

    if (expectedSize <= 0) {
      throw new Error('storage object size is outside the allowed inspection range');
    }

    const inspectionByteBudget = Math.min(expectedSize, detectorPrefixBytes);
    const rangeEnd = Math.min(expectedSize - 1, detectorPrefixBytes - 1);
    const getReply = await this.sendWithTimeout(
      new S3Commands.GetObjectCommand({
        Bucket: this.contract.bucket,
        Key: input.objectKey,
        Range: `bytes=0-${rangeEnd}`,
        ...(input.expectedEtag ? { IfMatch: input.expectedEtag } : {}),
      }),
      timeoutMs,
    );

    const get = getReply as { Body?: NodeJS.ReadableStream | Buffer | Uint8Array | ArrayBuffer };
    const body = get.Body;
    if (!body) {
      throw new Error('storage object body was empty');
    }

    const data = await this.readStreamWithTimeout(body, inspectionByteBudget, timeoutMs);
    if (data.length > inspectionByteBudget) {
      throw new Error('storage object body size exceeded the inspection byte budget');
    }

    const fileType =
      (await this.detectFileTypeFromBuffer(data)) ??
      this.detectJsonText(data, data.length === expectedSize);
    if (!fileType?.mime) {
      throw new Error('storage object content type could not be detected');
    }

    const dimensions = this.detectDimensions(fileType.mime, data);
    return {
      objectKey: input.objectKey,
      etag: expectedEtag,
      sizeBytes: expectedSize,
      detectedMimeType: fileType.mime,
      dimensions,
    };
  }

  async readObject(input: ReadObjectInput): Promise<Buffer> {
    const timeoutMs = 5000;
    const getReply = await this.sendWithTimeout(
      new S3Commands.GetObjectCommand({
        Bucket: this.contract.bucket,
        Key: input.objectKey,
        ...(input.expectedEtag ? { IfMatch: input.expectedEtag } : {}),
      }),
      timeoutMs,
    );

    const get = getReply as {
      Body?: NodeJS.ReadableStream | Buffer | Uint8Array | ArrayBuffer;
      ETag?: string;
    };
    const etag = get.ETag?.trim() ?? '';
    if (input.expectedEtag && etag !== input.expectedEtag) {
      throw new Error(`storage etag mismatch: expected ${input.expectedEtag}, got ${etag}`);
    }

    const body = get.Body;
    if (!body) {
      throw new Error('storage object body was empty');
    }

    const data = await this.readStreamWithTimeout(
      body,
      input.maxBytes,
      timeoutMs,
      'storage object exceeded the read byte budget',
    );
    if (data.length > input.maxBytes) {
      throw new Error('storage object exceeded the read byte budget');
    }

    return data;
  }

  /**
   * `file-type` knows binary signatures only, so a JSON document (the credit step's `bankData`)
   * never detects. Text that decodes as UTF-8 and opens like a JSON value is reported as
   * `application/json`; when the whole object fit into the inspection window it must also parse.
   */
  private detectJsonText(buffer: Buffer, complete: boolean): DetectedFileType | undefined {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return undefined;
    }

    const body = text.replace(/^\uFEFF/, '').trimStart();
    if (!body.startsWith('{') && !body.startsWith('[')) {
      return undefined;
    }

    if (complete) {
      try {
        JSON.parse(body);
      } catch {
        return undefined;
      }
    }

    return { ext: 'json', mime: 'application/json' };
  }

  private async detectFileTypeFromBuffer(buffer: Buffer): Promise<DetectedFileType | undefined> {
    const fileTypeFromBuffer = await this.loadFileTypeFromBuffer();
    return fileTypeFromBuffer(buffer);
  }

  private async loadFileTypeFromBuffer(): Promise<FileTypeModule['fileTypeFromBuffer']> {
    if (!this.fileTypeFromBufferLoader) {
      this.fileTypeFromBufferLoader = this.loadNativeFileTypeFromBuffer();
    }

    return this.fileTypeFromBufferLoader;
  }

  private async loadNativeFileTypeFromBuffer(): Promise<FileTypeModule['fileTypeFromBuffer']> {
    // `file-type` is ESM-only; this keeps native import semantics under CommonJS transpilation.
    // eslint-disable-next-line no-eval
    const module = (await (0, eval)('import("file-type")')) as FileTypeModule;
    return module.fileTypeFromBuffer;
  }

  async promoteInspectedObject(input: PromoteInspectedObjectInput): Promise<void> {
    if (input.sourceEtag !== input.expectedSourceEtag) {
      throw new Error('storage promotion refused because the source etag changed');
    }

    await this.s3Client.send(
      new S3Commands.CopyObjectCommand({
        Bucket: this.contract.bucket,
        Key: input.finalObjectKey,
        CopySource: `${this.contract.bucket}/${encodeURIComponent(input.stagingObjectKey)}`,
        MetadataDirective: 'COPY',
        IfMatch: input.sourceEtag,
      }),
    );

    await this.s3Client.send(
      new S3Commands.DeleteObjectCommand({
        Bucket: this.contract.bucket,
        Key: input.stagingObjectKey,
      }),
    );
  }

  async deleteStagedObject(input: DeleteStagedObjectInput): Promise<void> {
    await this.s3Client.send(
      new S3Commands.DeleteObjectCommand({ Bucket: this.contract.bucket, Key: input.objectKey }),
    );
  }

  /** Writes engine-produced bytes to their final key; the etag S3 answers is the one later reads pin. */
  async putObject(input: PutObjectInput): Promise<PutObjectOutput> {
    if (input.body.length === 0) {
      throw new Error('storage object body was empty');
    }

    const reply = (await this.s3Client.send(
      new S3Commands.PutObjectCommand({
        Bucket: this.contract.bucket,
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.body.length,
      }),
    )) as { ETag?: string };
    const etag = reply.ETag?.trim() ?? '';

    if (etag === '') {
      throw new Error('storage object write answered no etag');
    }

    return { objectKey: input.objectKey, etag, sizeBytes: input.body.length };
  }

  private async sendWithTimeout<T>(
    command: S3Commands.HeadObjectCommand | S3Commands.GetObjectCommand,
    timeoutMs: number,
  ): Promise<T> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      return (await this.s3Client.send(command as never, {
        abortSignal: abortController.signal,
      })) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readStreamWithTimeout(
    body: NodeJS.ReadableStream | Buffer | Uint8Array | ArrayBuffer,
    maxBytes: number,
    timeoutMs: number,
    errorMessage = 'storage object exceeded the inspection byte budget',
  ): Promise<Buffer> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    const chunks: Buffer[] = [];
    let bytesRead = 0;

    try {
      if (Buffer.isBuffer(body)) {
        const buffer = body as Buffer;
        chunks.push(buffer);
        bytesRead = buffer.length;
      } else if (body instanceof Uint8Array) {
        const buffer = Buffer.from(body);
        chunks.push(buffer);
        bytesRead = buffer.length;
      } else if (body instanceof ArrayBuffer) {
        const buffer = Buffer.from(body);
        chunks.push(buffer);
        bytesRead = buffer.length;
      } else if (typeof body === 'string') {
        const text = body as string;
        const buffer = Buffer.from(text);
        chunks.push(buffer);
        bytesRead = buffer.length;
      } else if (
        body &&
        typeof (body as { [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array> })[
          Symbol.asyncIterator
        ] === 'function'
      ) {
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytesRead += buffer.length;
          if (bytesRead > maxBytes) {
            throw new Error('storage object exceeded the inspection byte budget');
          }
          chunks.push(buffer);
          if (bytesRead === maxBytes) {
            break;
          }
        }
      }

      if (bytesRead > maxBytes) {
        throw new Error(errorMessage);
      }
    } finally {
      clearTimeout(timeout);
    }

    return Buffer.concat(chunks);
  }

  private detectDimensions(mimeType: string, buffer: Buffer) {
    if (!mimeType.startsWith('image/')) {
      return undefined;
    }

    try {
      const dimensions = imageSize(buffer);
      if (dimensions?.width && dimensions?.height) {
        return { width: dimensions.width, height: dimensions.height };
      }
    } catch {
      // Keep inspection resilient in test/runtime environments where parsers reject minimal images.
    }

    if (mimeType === 'image/png') {
      return this.detectPngDimensionsFromHeader(buffer);
    }

    return undefined;
  }

  private detectPngDimensionsFromHeader(buffer: Buffer) {
    if (buffer.length < 24) {
      return undefined;
    }

    const pngSignature =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;
    const hasIhdrChunk =
      buffer.readUInt32BE(8) === 13 &&
      buffer[12] === 0x49 &&
      buffer[13] === 0x48 &&
      buffer[14] === 0x44 &&
      buffer[15] === 0x52;

    if (!pngSignature || !hasIhdrChunk) {
      return undefined;
    }

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width <= 0 || height <= 0) {
      return undefined;
    }

    return { width, height };
  }
}
