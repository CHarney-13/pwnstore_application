import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/renderer/App';

describe('App', () => {
  it('identifies the app and its authorized isolated-lab purpose', () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('<h1>Pwnstore</h1>');
    expect(markup).toContain('isolated, authorized lab');
  });
});
