import { describe, expect, it } from 'vitest';
import { toOcrPage, type TesseractBlockTree } from './recognize';

function tree(words: { text: string; confidence: number; bbox: [number, number, number, number] }[][]): TesseractBlockTree {
  // One block, one paragraph, one line per inner array.
  return {
    blocks: [
      {
        paragraphs: words.map((line) => ({
          lines: [
            {
              words: line.map(({ text, confidence, bbox }) => ({
                text,
                confidence,
                bbox: { x0: bbox[0], y0: bbox[1], x1: bbox[2], y1: bbox[3] },
              })),
            },
          ],
        })),
      },
    ],
  };
}

describe('toOcrPage', () => {
  it('flattens the block/paragraph/line tree into reading order', () => {
    const page = toOcrPage(
      tree([
        [
          { text: 'first', confidence: 90, bbox: [0, 0, 10, 10] },
          { text: 'second', confidence: 91, bbox: [12, 0, 22, 10] },
        ],
        [{ text: 'third', confidence: 92, bbox: [0, 12, 10, 22] }],
      ]),
      0,
      600,
      800,
    );

    expect(page.words.map((w) => w.text)).toEqual(['first', 'second', 'third']);
  });

  it('carries the image dimensions the boxes are relative to', () => {
    // Without these the text layer cannot scale pixels into page points.
    const page = toOcrPage(tree([]), 2, 1240, 1754);

    expect(page).toMatchObject({ pageIndex: 2, imageWidth: 1240, imageHeight: 1754 });
  });

  it('preserves each word box and confidence', () => {
    const page = toOcrPage(tree([[{ text: 'Total', confidence: 87.5, bbox: [4, 8, 40, 20] }]]), 0, 600, 800);

    expect(page.words[0]).toEqual({
      text: 'Total',
      confidence: 87.5,
      bbox: { x0: 4, y0: 8, x1: 40, y1: 20 },
    });
  });

  it('copies boxes rather than aliasing the engine result', () => {
    // The worker result is reused internally by tesseract.js; holding a
    // reference into it would let later pages mutate earlier ones.
    const source = tree([[{ text: 'x', confidence: 50, bbox: [1, 2, 3, 4] }]]);
    const page = toOcrPage(source, 0, 10, 10);

    const original = source.blocks![0]!.paragraphs[0]!.lines[0]!.words[0]!;
    expect(page.words[0]!.bbox).not.toBe(original.bbox);
    expect(page.words[0]!.bbox).toEqual(original.bbox);
  });

  it('treats a page with no recognized blocks as empty, not as an error', () => {
    // A blank or entirely graphical page is normal input for a batch OCR run.
    expect(toOcrPage({ blocks: null }, 0, 600, 800).words).toEqual([]);
  });
});
