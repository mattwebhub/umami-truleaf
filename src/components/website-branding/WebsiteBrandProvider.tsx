'use client';
import { createContext, Fragment, type ReactNode, useContext, useEffect } from 'react';
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

  useEffect(() => {
    const root = document.documentElement;

    if (brand) {
      root.dataset.websiteBrand = brand;
    } else {
      delete root.dataset.websiteBrand;
    }

    return () => {
      if (!brand || root.dataset.websiteBrand === brand) {
        delete root.dataset.websiteBrand;
      }
    };
  }, [brand]);

  return <Fragment>{children}</Fragment>;
}
