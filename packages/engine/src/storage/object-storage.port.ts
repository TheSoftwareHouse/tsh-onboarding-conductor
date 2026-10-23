export type ObjectStorageUploadTicketKind = 'post-form';

export interface IssueUploadTicketInput {
  objectKey: string;
  contentType: string;
  maxSizeBytes: number;
  expiresInSeconds: number;
}

export interface IssueUploadTicketOutput {
  kind: ObjectStorageUploadTicketKind;
  objectKey: string;
  contentType: string;
  maxSizeBytes: number;
  url: string;
  fields: Record<string, string>;
}

export interface InspectStagedObjectInput {
  objectKey: string;
  expectedEtag?: string;
  timeoutMs?: number;
}

export interface ReadObjectInput {
  objectKey: string;
  expectedEtag?: string;
  maxBytes: number;
}

export interface InspectStagedObjectOutput {
  objectKey: string;
  etag: string;
  sizeBytes: number;
  detectedMimeType: string;
  dimensions?: { width: number; height: number };
}

export interface PromoteInspectedObjectInput {
  stagingObjectKey: string;
  finalObjectKey: string;
  sourceEtag: string;
  expectedSourceEtag: string;
}

export interface DeleteStagedObjectInput {
  objectKey: string;
}

/** A write of bytes the engine itself produced, straight to a final key; no staging, no inspection. */
export interface PutObjectInput {
  objectKey: string;
  contentType: string;
  body: Buffer;
}

export interface PutObjectOutput {
  objectKey: string;
  etag: string;
  sizeBytes: number;
}

export const OBJECT_STORAGE_PORT = Symbol('OBJECT_STORAGE_PORT');

export interface ObjectStoragePort {
  issueUploadTicket(input: IssueUploadTicketInput): Promise<IssueUploadTicketOutput>;
  inspectStagedObject(input: InspectStagedObjectInput): Promise<InspectStagedObjectOutput>;
  readObject(input: ReadObjectInput): Promise<Buffer>;
  promoteInspectedObject(input: PromoteInspectedObjectInput): Promise<void>;
  deleteStagedObject(input: DeleteStagedObjectInput): Promise<void>;
  putObject(input: PutObjectInput): Promise<PutObjectOutput>;
}
