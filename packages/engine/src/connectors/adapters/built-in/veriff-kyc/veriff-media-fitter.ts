import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import type { KycDocument } from '../kyc/kyc-provider.port';
import { VERIFF_MEDIA_MAX_SIDE_PX } from './veriff-contract';

/**
 * Brings a captured image within Veriff's longer-side limit before upload, because the engine's
 * own upload cap is in bytes and a phone photo well under it is still refused by
 * `POST /v1/sessions/{id}/media` on its pixel dimensions. An image already within the limit
 * passes through as the same object. Only images reach it: `VeriffKycProvider.submit` refuses
 * anything else before a session exists.
 */
@Injectable()
export class VeriffMediaFitter {
  private readonly logger = new Logger(VeriffMediaFitter.name);

  async fit(document: KycDocument): Promise<KycDocument> {
    const { width = 0, height = 0 } = await sharp(document.content).metadata();

    if (Math.max(width, height) <= VERIFF_MEDIA_MAX_SIDE_PX) {
      return document;
    }

    // `rotate()` with no angle bakes the EXIF orientation in, which `resize()` would otherwise
    // drop, so a portrait phone photo does not arrive at Veriff lying on its side.
    const content = await sharp(document.content)
      .rotate()
      .resize({
        width: VERIFF_MEDIA_MAX_SIDE_PX,
        height: VERIFF_MEDIA_MAX_SIDE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer();
    const fitted = await sharp(content).metadata();

    this.logger.log(
      `VERIFF_MEDIA_DOWNSCALED from=${width}x${height} to=${fitted.width}x${fitted.height}`,
    );

    return { ...document, content };
  }
}
