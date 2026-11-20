import { describe, expect, it } from 'vitest';
import { isLoopbackLabUrl } from '../../src/main/externalLinks';

describe('external lab links', () => {
  it('accepts only HTTP loopback destinations without credentials', () => {
    expect(isLoopbackLabUrl('http://127.0.0.1:18081/path')).toBe(true);
    for (const url of [
      'http://127.0.0.1:18081@example.com/',
      'http://user:password@127.0.0.1:18081/',
      'http://127.0.0.1.example.com:18081/',
      'https://127.0.0.1:18081/',
      'file:///etc/passwd',
      'not a URL',
    ]) expect(isLoopbackLabUrl(url)).toBe(false);
  });
});
