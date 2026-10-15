import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { EngineClient } from '../engine/engine.client';
import { EngineError } from '../engine/engine-error';
import { PersonaService } from '../personas/persona.service';
import { BankDataPusher, BankDataUploadError } from './bank-data-pusher';

const BANK_DATA = {
  accounts: [
    {
      balanceDate: '2026-10-14T12:00:00.000Z',
      transactions: [{ dates: { debitedAt: '2026-10-13T12:00:00.000Z' } }],
    },
  ],
};

describe('BankDataPusher', () => {
  const calls: string[] = [];
  let engine: jest.Mocked<Pick<EngineClient, 'reserveDocument' | 'completeDocument' | 'submit'>>;
  let fetchMock: jest.SpyInstance;
  let pusher: BankDataPusher;

  beforeEach(() => {
    calls.length = 0;
    engine = {
      reserveDocument: jest.fn().mockImplementation(async () => {
        calls.push('reserve');
        return {
          documentId: 'doc-1',
          upload: {
            kind: 'post-form',
            url: 'http://garage:3900/bucket?X-Amz-Signature=abc',
            fields: { key: 'k', policy: 'p' },
          },
          expiresAt: 'x',
        };
      }),
      completeDocument: jest.fn().mockImplementation(async () => {
        calls.push('complete');
        return { documentId: 'doc-1' };
      }),
      submit: jest.fn().mockImplementation(async () => {
        calls.push('submit');
        return {};
      }),
    };
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls.push('upload');
      return new Response(null, { status: 204 });
    });
    pusher = new BankDataPusher(
      engine as unknown as EngineClient,
      { load: () => structuredClone(BANK_DATA) } as unknown as PersonaService,
      { get: () => 'http://localhost:9000' } as unknown as ConfigService<AppConfig, true>,
    );
  });

  it('reserves, uploads, completes and submits in that order', async () => {
    await expect(
      pusher.push('o1', 'sherlock_holmes', new Date('2026-11-20T08:00:00Z')),
    ).resolves.toEqual({
      parked: false,
    });

    expect(calls).toEqual(['reserve', 'upload', 'complete', 'submit']);
    expect(engine.submit).toHaveBeenCalledWith('o1', { bankData: 'doc-1' });
  });

  it('reserves the compact rebased JSON with its byte length', async () => {
    await pusher.push('o1', 'sherlock_holmes', new Date('2026-11-20T08:00:00Z'));

    const [, reservation] = engine.reserveDocument.mock.calls[0];
    const form = fetchMock.mock.calls[0][1].body as FormData;
    const file = form.get('file') as File;
    const text = await file.text();

    expect(reservation).toEqual({
      field: 'bankData',
      contentType: 'application/json',
      sizeBytes: Buffer.byteLength(text),
    });
    expect(JSON.parse(text).accounts[0].balanceDate).toBe('2026-11-20T12:00:00.000Z');
    expect(text).toBe(JSON.stringify(JSON.parse(text)));
  });

  it('rewrites only the host of the presigned URL and sends the file part last', async () => {
    await pusher.push('o1', 'sherlock_holmes');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const names = [...(init.body as FormData).keys()];

    expect(url).toBe('http://localhost:9000/bucket?X-Amz-Signature=abc');
    expect(init.method).toBe('POST');
    expect(names).toEqual(['key', 'policy', 'file']);
  });

  it('reports a parked onboarding instead of failing', async () => {
    engine.submit.mockRejectedValue(
      EngineError.fromResponse(409, { code: 'ONBOARDING_AWAITING_CONNECTOR', message: 'parked' }),
    );

    await expect(pusher.push('o1', 'sherlock_holmes')).resolves.toEqual({ parked: true });
  });

  it('rethrows any other submit failure', async () => {
    engine.submit.mockRejectedValue(
      EngineError.fromResponse(422, { code: 'OTHER', message: 'no' }),
    );

    await expect(pusher.push('o1', 'sherlock_holmes')).rejects.toMatchObject({ code: 'OTHER' });
  });

  it('stops before completing when the upload is refused', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));

    await expect(pusher.push('o1', 'sherlock_holmes')).rejects.toBeInstanceOf(BankDataUploadError);
    expect(engine.completeDocument).not.toHaveBeenCalled();
  });
});
