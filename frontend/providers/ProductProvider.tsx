'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { productService } from '@/services/product.service';
import type { Product } from '@/types/product';

interface ProductContextValue {
  products: Product[];
  isLoading: boolean;
  error: string;
  refreshProducts: () => Promise<void>;
}

const ProductContext = createContext<ProductContextValue | undefined>(undefined);

export function ProductProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshProducts = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      setProducts(await productService.getManagedProducts());
    } catch (cause) {
      setProducts([]);
      setError(cause instanceof Error ? cause.message : 'Could not load managed products.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    void productService.getManagedProducts().then((data) => {
      if (isMounted) setProducts(data);
    }).catch((cause) => {
      if (isMounted) {
        setProducts([]);
        setError(cause instanceof Error ? cause.message : 'Could not load managed products.');
      }
    }).finally(() => {
      if (isMounted) setIsLoading(false);
    });

    return () => { isMounted = false; };
  }, []);

  return (
    <ProductContext.Provider value={{ products, isLoading, error, refreshProducts }}>
      {children}
    </ProductContext.Provider>
  );
}

export function useProducts() {
  const context = useContext(ProductContext);

  if (!context) {
    throw new Error('useProducts must be used within a ProductProvider');
  }

  return context;
}
