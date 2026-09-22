import { describe, expect, it } from 'vitest';
import { formatSize } from './format';

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2 KB'],
    [4.2 * 1024 * 1024, '4.2 MB'],
    [418.3 * 1024 * 1024, '418 MB'],
  ])('writes %s bytes as %s', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });

  it('switches unit exactly at the boundary, not near it', () => {
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(1024)).toBe('1 KB');
    expect(formatSize(1024 * 1024 - 1)).toBe('1024 KB');
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('says nothing rather than something wrong about a size it cannot read', () => {
    expect(formatSize(Number.NaN)).toBe('—');
    expect(formatSize(-1)).toBe('—');
    expect(formatSize(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
