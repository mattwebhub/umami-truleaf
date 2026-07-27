import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { WebsiteBrandLogo } from './WebsiteBrandLogo';
import { WebsiteBrandProvider } from './WebsiteBrandProvider';

describe('website brand logo', () => {
  test('replaces vendor branding only inside a configured Truleaf workspace', () => {
    const branded = renderToStaticMarkup(
      <WebsiteBrandProvider brand="truleaf">
        <WebsiteBrandLogo />
      </WebsiteBrandProvider>,
    );
    const standard = renderToStaticMarkup(
      <WebsiteBrandProvider brand={null}>
        <WebsiteBrandLogo />
      </WebsiteBrandProvider>,
    );

    expect(branded).toContain('Truleaf');
    expect(branded).not.toContain('umami');
    expect(standard).toContain('umami');
    expect(standard).not.toContain('Truleaf.org');
  });
});
