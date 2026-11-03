import { ToolError } from '../tool-error';
import { CsvParser, readCsvRecords } from './csv-records';

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<string[][]> {
  const records: string[][] = [];
  for await (const record of readCsvRecords(body)) {
    records.push(record);
  }
  return records;
}

describe('CsvParser', () => {
  it('reads CRLF records, doubled quotes, commas and line breaks inside quotes', () => {
    const parser = new CsvParser();

    const records = [
      ...parser.push('a,b,c\r\n1,"x, ""y""",\r\n"multi\r\nline",2,3\r\n'),
      ...parser.finish(),
    ];

    expect(records).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, "y"', ''],
      ['multi\r\nline', '2', '3'],
    ]);
  });

  it('reads a record split across chunks, including inside a quote pair', () => {
    const parser = new CsvParser();

    const records = [
      ...parser.push('a,"b"'),
      ...parser.push('"c",d\n1'),
      ...parser.push(',2'),
      ...parser.finish(),
    ];

    expect(records).toEqual([
      ['a', 'b"c', 'd'],
      ['1', '2'],
    ]);
  });

  it('returns the last record when there is no final line break and skips blank lines', () => {
    const parser = new CsvParser();

    expect([...parser.push('a,b\n\n1,2'), ...parser.finish()]).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it.each([1, 2, 3, 7])('reads the same records with chunks of %i characters', (size) => {
    const text = 'a,b,c\r\n1,"x, y",\r\n"say ""hi""","line\nbreak",3\r\n';
    const parser = new CsvParser();
    const records: string[][] = [];

    for (let start = 0; start < text.length; start += size) {
      records.push(...parser.push(text.slice(start, start + size)));
    }

    expect([...records, ...parser.finish()]).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', ''],
      ['say "hi"', 'line\nbreak', '3'],
    ]);
  });

  it('skips blank lines but keeps a record of empty cells', () => {
    const parser = new CsvParser();

    expect([...parser.push('a,b\n\n,\n'), ...parser.finish()]).toEqual([
      ['a', 'b'],
      ['', ''],
    ]);
  });

  it('refuses a quoted field that never closes', () => {
    const parser = new CsvParser();
    parser.push('a,"open');

    expect(() => parser.finish()).toThrow(ToolError);
  });
});

describe('readCsvRecords', () => {
  const encoder = new TextEncoder();

  it('drops the byte order mark and reads multi-byte text split between chunks', async () => {
    const bytes = encoder.encode('﻿Name,City\r\nZoë,Łódź\r\n');

    const records = await collect(streamOf(bytes.slice(0, 12), bytes.slice(12)));

    expect(records).toEqual([
      ['Name', 'City'],
      ['Zoë', 'Łódź'],
    ]);
  });

  it('cancels the body when the caller stops early', async () => {
    const cancel = jest.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode('a,b\r\n1,2\r\n'));
      },
      cancel,
    });

    const records = readCsvRecords(body);
    await records.next();
    await records.return();

    expect(cancel).toHaveBeenCalled();
  });

  it('turns a connection aborted mid-file into a tool error', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('a,b\r\n'));
        controller.error(new Error('socket hang up'));
      },
    });

    await expect(collect(body)).rejects.toThrow(ToolError);
  });
});
