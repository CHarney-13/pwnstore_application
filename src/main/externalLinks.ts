export function isLoopbackLabUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && url.hostname === '127.0.0.1'
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}
