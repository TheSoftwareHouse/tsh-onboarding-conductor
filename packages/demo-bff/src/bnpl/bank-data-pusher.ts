import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppConfig } from '../config/app.config';
import { EngineClient } from '../engine/engine.client';
import { EngineError } from '../engine/engine-error';
import { PersonaService } from '../personas/persona.service';
import { rebaseDates } from '../personas/rebase-dates';

const BANK_DATA_FIELD = 'bankData';
const CONTENT_TYPE = 'application/json';

export type PushResult = { parked: boolean };

/** The presigned upload was refused or never reached storage. */
export class BankDataUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BankDataUploadError';
  }
}

/**
 * Pushes a persona's bank data into an onboarding the way a customer's browser would upload a
 * document: reserve, upload to the presigned form, complete, then submit the document id.
 */
@Injectable()
export class BankDataPusher {
  private readonly uploadOrigin: string;

  constructor(
    private readonly engine: EngineClient,
    private readonly personas: PersonaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.uploadOrigin = new URL(config.get('UPLOAD_PUBLIC_HOST', { infer: true })).origin;
  }

  /**
   * `parked: true` means the submit ran the connector chain and the onboarding now waits on the
   * provider (`ONBOARDING_AWAITING_CONNECTOR`); the caller polls `/state`, never resubmits.
   */
  async push(
    onboardingId: string,
    personaId: string,
    today: Date = new Date(),
  ): Promise<PushResult> {
    const content = Buffer.from(
      JSON.stringify(rebaseDates(this.personas.load(personaId), today)),
      'utf8',
    );

    const reservation = await this.engine.reserveDocument(onboardingId, {
      field: BANK_DATA_FIELD,
      contentType: CONTENT_TYPE,
      sizeBytes: content.byteLength,
    });

    await this.upload(reservation.upload, content);
    await this.engine.completeDocument(onboardingId, reservation.documentId);

    try {
      await this.engine.submit(onboardingId, { [BANK_DATA_FIELD]: reservation.documentId });
    } catch (error) {
      if (error instanceof EngineError && error.code === 'ONBOARDING_AWAITING_CONNECTOR') {
        return { parked: true };
      }
      throw error;
    }

    return { parked: false };
  }

  private async upload(
    ticket: { url: string; fields: Record<string, string> },
    content: Buffer,
  ): Promise<void> {
    // Only the origin changes: the signature covers the path, query and fields, not the host.
    const target = new URL(ticket.url);
    const url = `${this.uploadOrigin}${target.pathname}${target.search}`;

    const form = new FormData();
    for (const [name, value] of Object.entries(ticket.fields)) {
      form.append(name, value);
    }
    // The file part goes last, as S3 POST policies require.
    form.append(
      'file',
      new Blob([new Uint8Array(content)], { type: CONTENT_TYPE }),
      'bank-data.json',
    );

    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', body: form });
    } catch (error) {
      throw new BankDataUploadError(
        `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      throw new BankDataUploadError(`Upload refused with ${response.status}`);
    }
  }
}
