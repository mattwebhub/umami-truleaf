'use client';
import { createContext, type ReactNode, useContext } from 'react';
import type { WebsiteBrandId } from '@/lib/website-branding/config';

const WebsiteBrandContext = createContext<WebsiteBrandId | null>(null);

export function WebsiteBrandProvider({
  brand,
  children,
}: {
  brand: WebsiteBrandId | null;
  children: ReactNode;
}) {
  return <WebsiteBrandContext.Provider value={brand}>{children}</WebsiteBrandContext.Provider>;
}

export function useWebsiteBrand() {
  return useContext(WebsiteBrandContext);
}

export function WebsiteBrandBoundary({ children }: { children: ReactNode }) {
  const brand = useWebsiteBrand();

  return (
    <div data-website-brand={brand ?? undefined} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
