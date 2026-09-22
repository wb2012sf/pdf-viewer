// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resampleImage } from './image-resampler';

/**
 * jsdom has no 2D context, so the drawing itself is exercised end to end in
 * `tests/e2e/reduce-size.spec.ts` against a real JPEG. What is worth pinning
 * down here is the contract the rest of compression leans on: a resampler
 * returns `null` on anything it cannot handle and never throws, because a throw
 * would abandon every image after the one that failed.
 */

const image = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff]),
  mediaType: 'image/jpeg',
  width: 400,
  height: 300,
} as const;

const target = { width: 200, height: 150, quality: 0.7 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resampleImage', () => {
  it('leaves an image the platform cannot decode', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('Unsupported colour space'))),
    );

    await expect(resampleImage(image, target)).resolves.toBeNull();
  });

  it('leaves the image alone when no 2D context can be had', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve({ close })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    await expect(resampleImage(image, target)).resolves.toBeNull();
    // Even on the way out, the decoded pixels have to be handed back.
    expect(close).toHaveBeenCalled();
  });

  it('leaves the image alone when the canvas encodes nothing', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve({ close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(null);
    });

    await expect(resampleImage(image, target)).resolves.toBeNull();
  });

  it('re-encodes at the size it was asked for', async () => {
    const encoded = new Uint8Array([1, 2, 3, 4]);
    const drawImage = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve({ close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback,
      type,
      quality,
    ) {
      expect(type).toBe('image/jpeg');
      expect(quality).toBe(0.7);
      expect([this.width, this.height]).toEqual([200, 150]);
      callback(new Blob([encoded.slice().buffer]));
    });

    const result = await resampleImage(image, target);

    expect(result).toEqual({ bytes: encoded, width: 200, height: 150 });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 200, 150);
  });
});
