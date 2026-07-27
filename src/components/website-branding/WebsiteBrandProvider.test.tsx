import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WebsiteBrandBoundary, WebsiteBrandProvider } from './WebsiteBrandProvider';

describe('WebsiteBrandBoundary', () => {
  afterEach(() => {
    delete document.documentElement.dataset.websiteBrand;
  });

  it('scopes the active website brand to the document root and removes it on navigation', async () => {
    const { rerender, unmount } = render(
      <WebsiteBrandProvider brand="truleaf">
        <WebsiteBrandBoundary>Truleaf analytics</WebsiteBrandBoundary>
      </WebsiteBrandProvider>,
    );

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute('data-website-brand', 'truleaf'),
    );

    rerender(
      <WebsiteBrandProvider brand={null}>
        <WebsiteBrandBoundary>Standard analytics</WebsiteBrandBoundary>
      </WebsiteBrandProvider>,
    );

    await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-website-brand'));

    rerender(
      <WebsiteBrandProvider brand="truleaf">
        <WebsiteBrandBoundary>Truleaf analytics</WebsiteBrandBoundary>
      </WebsiteBrandProvider>,
    );
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute('data-website-brand', 'truleaf'),
    );

    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-website-brand');
  });
});
