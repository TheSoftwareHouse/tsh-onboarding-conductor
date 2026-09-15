import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import * as imageSizeModule from 'image-size';
import { S3ObjectStorageService } from './s3-object-storage.service';

const mockSend = jest.fn();
const TEST_ETAG = '"etag-1"';
const mockCreatePresignedPost = jest.mocked(createPresignedPost);

const PNG_1X1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x11, 0x22, 0x33, 0xff,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x7f, 0x5d, 0x1f, 0x93, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

const JPEG_1X1 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
  0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x22, 0x00, 0x02,
  0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00,
  0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0xff, 0xd9,
]);

const GIF_1X1 = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

const WEBP_1X1 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x26, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  0x1a, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x01, 0x40,
  0x26, 0x25, 0xa4, 0x00, 0x03, 0x70, 0x00, 0xfe, 0xfb, 0xfd, 0x50, 0x00,
]);

const PDF_MINIMAL = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');

const ZIP_MINIMAL = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const UNKNOWN_BYTES = Buffer.from('not-a-known-signature', 'utf8');

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  HeadObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  CopyObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: jest.fn(),
}));

describe('S3ObjectStorageService', () => {
  const mockConfigService: Pick<ConfigService, 'getOrThrow'> = {
    getOrThrow: jest.fn((name: string) => {
      switch (name) {
        case 'STORAGE_DRIVER':
          return 's3';
        case 'STORAGE_S3_BUCKET':
          return 'test-bucket';
        case 'STORAGE_S3_REGION':
          return 'us-east-1';
        case 'STORAGE_S3_ENDPOINT':
          return 'http://localhost:3900';
        case 'STORAGE_S3_FORCE_PATH_STYLE':
          return true;
        case 'STORAGE_S3_ACCESS_KEY_ID':
          return 'access';
        case 'STORAGE_S3_SECRET_ACCESS_KEY':
          return 'secret';
        default:
          return undefined;
      }
    }),
  };

  let mockS3Client: S3Client;

  const queueInspectRead = (body: Buffer) => {
    mockSend
      .mockResolvedValueOnce({
        ContentLength: body.length,
        ETag: TEST_ETAG,
      })
      .mockResolvedValueOnce({
        Body: body,
      });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockCreatePresignedPost.mockReset();
    mockS3Client = new S3Client({ region: 'us-east-1' });
    jest.mocked(S3Client).mockClear();
  });

  it('resolves the S3 contract once for default client construction and uses the resolved options', () => {
    const lookupCounts: Record<string, number> = {};
    const configService = {
      getOrThrow: jest.fn((name: string) => {
        lookupCounts[name] = (lookupCounts[name] ?? 0) + 1;
        switch (name) {
          case 'STORAGE_S3_BUCKET':
            return 'test-bucket';
          case 'STORAGE_S3_REGION':
            return 'us-east-1';
          case 'STORAGE_S3_ENDPOINT':
            return 'http://localhost:3900';
          case 'STORAGE_S3_FORCE_PATH_STYLE':
            return true;
          case 'STORAGE_S3_ACCESS_KEY_ID':
            return 'access';
          case 'STORAGE_S3_SECRET_ACCESS_KEY':
            return 'secret';
          default:
            return undefined;
        }
      }),
    };

    jest.mocked(S3Client).mockClear();

    new S3ObjectStorageService(configService as never);

    expect(lookupCounts).toEqual({
      STORAGE_S3_BUCKET: 1,
      STORAGE_S3_REGION: 1,
      STORAGE_S3_ENDPOINT: 1,
      STORAGE_S3_FORCE_PATH_STYLE: 1,
      STORAGE_S3_ACCESS_KEY_ID: 1,
      STORAGE_S3_SECRET_ACCESS_KEY: 1,
    });
    expect(jest.mocked(S3Client)).toHaveBeenCalledTimes(1);
    expect(jest.mocked(S3Client)).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'us-east-1',
        endpoint: 'http://localhost:3900',
        forcePathStyle: true,
        credentials: { accessKeyId: 'access', secretAccessKey: 'secret' },
      }),
    );
  });

  it('preserves injected clients without constructing a fallback client', async () => {
    jest.mocked(S3Client).mockClear();

    const service = new S3ObjectStorageService(mockConfigService as never, mockS3Client);
    await service.deleteStagedObject({ objectKey: 'staged/object' });

    expect(jest.mocked(S3Client)).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toEqual(
      expect.objectContaining({ input: { Bucket: 'test-bucket', Key: 'staged/object' } }),
    );
  });

  it('issues a normalized POST upload ticket with policy constraints', async () => {
    mockCreatePresignedPost.mockResolvedValue({
      url: 'https://example.test/upload',
      fields: { key: 'staged/object', 'Content-Type': 'image/png', 'X-Amz-Signature': 'abc' },
    });

    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);
    const ticket = await service.issueUploadTicket({
      objectKey: 'staged/object',
      contentType: 'image/png',
      maxSizeBytes: 11 * 1024 * 1024,
      expiresInSeconds: 90,
    });

    expect(ticket.kind).toBe('post-form');
    expect(ticket.objectKey).toBe('staged/object');
    expect(ticket.contentType).toBe('image/png');
    expect(ticket.maxSizeBytes).toBe(11 * 1024 * 1024);
    expect(ticket.url).toBe('https://example.test/upload');
    expect(ticket.fields).toEqual(expect.objectContaining({ key: 'staged/object' }));
    expect(createPresignedPost).toHaveBeenCalledWith(
      mockS3Client,
      expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'staged/object',
        Expires: 90,
        Conditions: [
          ['eq', '$Content-Type', 'image/png'],
          ['content-length-range', 1, 11 * 1024 * 1024],
          ['eq', '$key', 'staged/object'],
        ],
      }),
    );
  });

  it('uses a range-bounded prefix for large inspection requests while preserving the head-reported size', async () => {
    const largeHeadContentLength = 2 * 1024 * 1024;
    mockSend
      .mockResolvedValueOnce({
        ContentLength: largeHeadContentLength,
        ETag: TEST_ETAG,
      })
      .mockResolvedValueOnce({
        Body: PNG_1X1,
      });

    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);
    const result = await service.inspectStagedObject({ objectKey: 'staged/object' });

    expect(result.sizeBytes).toBe(largeHeadContentLength);
    expect(result.detectedMimeType).toBe('image/png');
    expect(mockSend.mock.calls[1][0].input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'staged/object',
      Range: 'bytes=0-1048575',
    });
  });

  it('uses the smaller final byte when the inspected object is shorter than the detector prefix', async () => {
    mockSend
      .mockResolvedValueOnce({
        ContentLength: PNG_1X1.length,
        ETag: TEST_ETAG,
      })
      .mockResolvedValueOnce({
        Body: PNG_1X1,
      });

    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);
    await service.inspectStagedObject({ objectKey: 'staged/object' });

    expect(mockSend.mock.calls[1][0].input).toMatchObject({
      Range: `bytes=0-${PNG_1X1.length - 1}`,
    });
  });

  it.each([
    ['image/png', PNG_1X1],
    ['image/jpeg', JPEG_1X1],
    ['image/gif', GIF_1X1],
    ['image/webp', WEBP_1X1],
    ['application/pdf', PDF_MINIMAL],
  ])('detects %s using file-type signatures', async (expectedMime, body) => {
    queueInspectRead(body);

    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);
    const result = await service.inspectStagedObject({ objectKey: 'staged/object' });

    expect(result.detectedMimeType).toBe(expectedMime);
    expect(result.etag).toBe(TEST_ETAG);
    expect(result.sizeBytes).toBe(body.length);
    if (expectedMime === 'application/pdf') {
      expect(result.dimensions).toBeUndefined();
    }
  });

  it('rejects inconclusive signature detection', async () => {
    queueInspectRead(UNKNOWN_BYTES);

    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);
    await expect(service.inspectStagedObject({ objectKey: 'staged/object' })).rejects.toThrow(
      'storage object content type could not be detected',
    );
  });

  it('returns detected ZIP metadata without adapter-side allowlist rejection', async () => {
    queueInspectRead(ZIP_MINIMAL);

    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);
    const result = await service.inspectStagedObject({ objectKey: 'staged/object' });

    expect(result.detectedMimeType).toBe('application/zip');
    expect(result.etag).toBe(TEST_ETAG);
    expect(result.sizeBytes).toBe(ZIP_MINIMAL.length);
  });

  it('falls back to PNG header dimensions when image-size parsing throws', async () => {
    queueInspectRead(PNG_1X1);
    const imageSizeSpy = jest.spyOn(imageSizeModule, 'imageSize').mockImplementation(() => {
      throw new Error('invalid png');
    });

    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);
    const result = await service.inspectStagedObject({
      objectKey: 'staged/object',
      expectedEtag: TEST_ETAG,
    });

    imageSizeSpy.mockRestore();

    expect(result.detectedMimeType).toBe('image/png');
    expect(result.dimensions).toEqual({ width: 1, height: 1 });
  });

  it('reads a bounded object body conditionally with a matching ETag', async () => {
    const body = Buffer.from('abc');
    mockSend.mockResolvedValueOnce({ Body: body, ETag: TEST_ETAG });

    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);
    const result = await service.readObject({
      objectKey: 'private/object',
      expectedEtag: TEST_ETAG,
      maxBytes: body.length,
    });

    expect(result).toEqual(body);
    const [command] = mockSend.mock.calls[0];
    expect(command.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'private/object',
      IfMatch: TEST_ETAG,
    });
  });

  it('rejects reads when the body is missing', async () => {
    mockSend.mockResolvedValueOnce({ ETag: TEST_ETAG });

    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);
    await expect(
      service.readObject({ objectKey: 'private/object', expectedEtag: TEST_ETAG, maxBytes: 8 }),
    ).rejects.toThrow('storage object body was empty');
  });

  it('rejects reads that exceed the byte budget', async () => {
    mockSend.mockResolvedValueOnce({ Body: Buffer.from('abcde'), ETag: TEST_ETAG });

    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);
    await expect(service.readObject({ objectKey: 'private/object', maxBytes: 4 })).rejects.toThrow(
      'storage object exceeded the read byte budget',
    );
  });

  it('propagates ETag mismatch and timeout failures for readObject calls', async () => {
    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);

    mockSend.mockResolvedValueOnce({ Body: Buffer.from('abc'), ETag: '"etag-2"' });
    await expect(
      service.readObject({ objectKey: 'private/object', expectedEtag: TEST_ETAG, maxBytes: 3 }),
    ).rejects.toThrow(/etag mismatch/i);

    mockSend.mockRejectedValueOnce(new Error('read timeout'));
    await expect(service.readObject({ objectKey: 'private/object', maxBytes: 3 })).rejects.toThrow(
      'read timeout',
    );
  });

  it('promotes the inspected object conditionally and deletes staging only after promotion succeeds', async () => {
    mockSend.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);
    await service.promoteInspectedObject({
      stagingObjectKey: 'staged/object',
      finalObjectKey: 'private/object',
      sourceEtag: '"etag-1"',
      expectedSourceEtag: '"etag-1"',
    });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0]).toBeDefined();
    expect(mockSend.mock.calls[1][0]).toBeDefined();
  });

  it('refuses promotion when the ETag has changed without making network calls', async () => {
    const service = new S3ObjectStorageService(mockConfigService, mockS3Client);

    await expect(
      service.promoteInspectedObject({
        stagingObjectKey: 'staged/object',
        finalObjectKey: 'private/object',
        sourceEtag: '"etag-2"',
        expectedSourceEtag: '"etag-1"',
      }),
    ).rejects.toThrow(/etag/i);

    expect(mockSend).not.toHaveBeenCalled();
  });
});
