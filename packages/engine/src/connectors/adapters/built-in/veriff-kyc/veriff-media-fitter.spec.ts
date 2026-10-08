import { Logger } from '@nestjs/common';
import sharp from 'sharp';
import type { KycDocument } from '../kyc/kyc-provider.port';
import { VeriffMediaFitter } from './veriff-media-fitter';

const image = async (width: number, height: number, format: 'png' | 'jpeg' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: '#808080' } })
    .toFormat(format)
    .toBuffer();

const document = (content: Buffer, contentType: string): KycDocument => ({
  documentId: 'document-1',
  docSet: 'IDENTITY',
  docType: 'ID_CARD',
  side: 'FRONT_SIDE',
  country: 'PL',
  contentType,
  content,
});

const dimensions = async (content: Buffer) => {
  const { width, height, format } = await sharp(content).metadata();

  return { width, height, format };
};

describe('VeriffMediaFitter', () => {
  const fitter = new VeriffMediaFitter();

  it.each([
    [3000, 2000, 1920, 1280],
    [1000, 4000, 480, 1920],
  ])(
    'downscales a %dx%d image to %dx%d, keeping its format and content type',
    async (width, height, expectedWidth, expectedHeight) => {
      const original = document(await image(width, height), 'image/png');

      const fitted = await fitter.fit(original);

      expect(fitted).not.toBe(original);
      expect(fitted.contentType).toBe('image/png');
      expect(fitted.documentId).toBe('document-1');
      await expect(dimensions(fitted.content)).resolves.toEqual({
        width: expectedWidth,
        height: expectedHeight,
        format: 'png',
      });
    },
  );

  it('keeps a JPEG a JPEG', async () => {
    const fitted = await fitter.fit(document(await image(2500, 100, 'jpeg'), 'image/jpeg'));

    await expect(dimensions(fitted.content)).resolves.toMatchObject({
      width: 1920,
      format: 'jpeg',
    });
  });

  it.each([
    [1920, 1080],
    [100, 100],
  ])('returns the same object for a %dx%d image', async (width, height) => {
    const original = document(await image(width, height), 'image/png');

    await expect(fitter.fit(original)).resolves.toBe(original);
  });

  it('returns the same object for a PDF without reading it', async () => {
    const original = document(Buffer.from('%PDF-1.4 not an image'), 'application/pdf');

    await expect(fitter.fit(original)).resolves.toBe(original);
  });

  it('logs the dimensions before and after and nothing else', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await fitter.fit(document(await image(3000, 2000), 'image/png'));

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('VERIFF_MEDIA_DOWNSCALED from=3000x2000 to=1920x1280');
  });

  it('logs nothing when the image already fits', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await fitter.fit(document(await image(100, 100), 'image/png'));

    expect(log).not.toHaveBeenCalled();
  });
});
