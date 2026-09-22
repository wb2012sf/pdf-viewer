import type { EmbeddedImage, ImageResampler, ResampleTarget, ResampledImage } from './compress';

/**
 * The browser half of size reduction: decode an image, scale it down, and
 * encode it again as JPEG.
 *
 * A plain `<canvas>` rather than an `OffscreenCanvas` — the desktop app runs on
 * WebKitGTK on Linux and WebView2 on Windows, and `convertToBlob` is the newer
 * and less evenly supported of the two. This runs on the main thread either
 * way, one image at a time, so there is nothing to gain by moving off it.
 */
export const resampleImage: ImageResampler = async (image, target) => {
  try {
    return await scale(image, target);
  } catch {
    // A CMYK JPEG, a truncated stream, a canvas the platform will not hand
    // back: all of them mean "leave this image as it is". Throwing here would
    // abandon every image after this one.
    return null;
  }
};

async function scale(image: EmbeddedImage, target: ResampleTarget): Promise<ResampledImage | null> {
  // `slice()` gives the Blob a buffer of its own; the stream bytes are a view
  // into the whole document, which Blob would otherwise hold on to.
  const bitmap = await createImageBitmap(new Blob([image.bytes.slice().buffer], { type: image.mediaType }));

  try {
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;

    const context = canvas.getContext('2d');
    if (!context) return null;

    // Downscaling in one step without this leaves a photo visibly aliased.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    // JPEG has no alpha, and anything left uncovered would encode as black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, target.width, target.height);
    context.drawImage(bitmap, 0, 0, target.width, target.height);

    const blob = await toBlob(canvas, target.quality);
    if (!blob) return null;

    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: target.width, height: target.height };
  } finally {
    // Decoded pixels, which on a scan is tens of megabytes a page.
    bitmap.close();
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
}
