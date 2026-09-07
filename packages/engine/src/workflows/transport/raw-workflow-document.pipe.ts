import { Injectable, PipeTransform } from '@nestjs/common';

/**
 * Hands a submitted workflow document to the service untouched. The global `ValidationPipe`
 * whitelists DTO properties, and a workflow document has no fixed property list — the DDL is the
 * authority on its shape, and it reports where a document is wrong far better than a DTO could.
 */
@Injectable()
export class RawWorkflowDocumentPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown): unknown {
    return value;
  }
}
