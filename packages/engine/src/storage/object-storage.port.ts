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

export const OBJECT_STORAGE_PORT = Symbol('OBJECT_STORAGE_PORT');

export interface ObjectStoragePort {
  issueUploadTicket(input: IssueUploadTicketInput): Promise<IssueUploadTicketOutput>;
  inspectStagedObject(input: InspectStagedObjectInput): Promise<InspectStagedObjectOutput>;
  promoteInspectedObject(input: PromoteInspectedObjectInput): Promise<void>;
  deleteStagedObject(input: DeleteStagedObjectInput): Promise<void>;
}
