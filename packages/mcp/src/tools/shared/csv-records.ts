import { ToolError } from '../tool-error';

const QUOTE = '"';
const COMMA = ',';
const LINE_FEED = '\n';
const CARRIAGE_RETURN = '\r';

/**
 * An RFC 4180 reader that takes text in chunks, so an export is parsed as it arrives. A quoted
 * field may hold commas, quotes (doubled) and line breaks; records end at a line feed, with or
 * without the carriage return before it; blank lines are skipped.
 */
export class CsvParser {
  private record: string[] = [];
  private field = '';
  private inQuotes = false;
  private quoteSeen = false;

  /** The records the chunk completes; a record still open waits for the next chunk. */
  push(chunk: string): string[][] {
    const records: string[][] = [];

    for (const char of chunk) {
      if (this.quoteSeen) {
        this.quoteSeen = false;
        if (char === QUOTE) {
          this.field += QUOTE;
          continue;
        }
        this.inQuotes = false;
      }

      if (this.inQuotes) {
        if (char === QUOTE) {
          this.quoteSeen = true;
        } else {
          this.field += char;
        }
        continue;
      }

      switch (char) {
        case QUOTE:
          this.inQuotes = true;
          break;
        case COMMA:
          this.endField();
          break;
        case LINE_FEED:
          this.endField();
          this.endRecord(records);
          break;
        case CARRIAGE_RETURN:
          break;
        default:
          this.field += char;
      }
    }

    return records;
  }

  /** The last record when the text does not end in a line break; throws on an unclosed quote. */
  finish(): string[][] {
    const records: string[][] = [];

    if (this.quoteSeen) {
      this.quoteSeen = false;
      this.inQuotes = false;
    }
    if (this.inQuotes) {
      throw new ToolError('The engine export is malformed: a quoted field is never closed.');
    }
    if (this.field !== '' || this.record.length > 0) {
      this.endField();
      this.endRecord(records);
    }

    return records;
  }

  private endField(): void {
    this.record.push(this.field);
    this.field = '';
  }

  private endRecord(records: string[][]): void {
    const isBlankLine = this.record.length === 1 && this.record[0] === '';

    if (!isBlankLine) {
      records.push(this.record);
    }
    this.record = [];
  }
}

/**
 * The records of a CSV response body, one at a time. Stopping early cancels the body, so a caller
 * that needs only the header and one row never downloads the rest.
 */
export async function* readCsvRecords(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string[], void> {
  const reader = body.getReader();
  // The default decoder drops the UTF-8 byte order mark the engine writes first.
  const decoder = new TextDecoder();
  const parser = new CsvParser();

  try {
    for (;;) {
      const { done, value } = await reader.read().catch(() => {
        throw new ToolError('The engine export ended early. Try again shortly.');
      });

      yield* parser.push(decoder.decode(value, { stream: !done }));

      if (done) {
        break;
      }
    }

    yield* parser.finish();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
