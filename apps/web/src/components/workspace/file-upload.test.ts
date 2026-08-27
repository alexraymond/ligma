import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, formatBytes, validateFileSize } from './file-upload';

describe('formatBytes', () => {
  it('formats bytes, KB and MB at their natural boundaries', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5_000_000)).toBe('4.8 MB');
  });
});

describe('validateFileSize', () => {
  it('passes a file under the cap', () => {
    expect(validateFileSize({ size: 1000 }, MAX_IMAGE_BYTES)).toBeNull();
  });

  it('rejects a file over the cap with a human-readable message', () => {
    const message = validateFileSize({ size: MAX_IMAGE_BYTES + 1 }, MAX_IMAGE_BYTES);
    expect(message).toContain('exceeds');
    expect(message).toContain(formatBytes(MAX_IMAGE_BYTES));
  });
});
