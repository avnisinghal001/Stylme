import type { ProductStatus } from '@/lib/constants/product-status';

/** Raw column shape used by the Myntra Fashion Product Dataset. */
export interface MyntraProductDatasetRow {
  p_id: string | number;
  name: string;
  price: number;
  colour: string;
  brand: string;
  img: string;
  ratingCount: number;
  avg_rating: number;
  description: string;
  p_attributes: ProductAttributes;
}

export type ProductAttributeValue = string | string[];
export type ProductAttributes = Record<string, ProductAttributeValue>;

/** Normalized product model used throughout the application. */
export interface Product {
  id: string;
  name: string;
  price: number;
  colour: string;
  brand: string;
  img: string;
  ratingCount: number;
  avgRating: number;
  description: string;
  attributes: ProductAttributes;
  status: ProductStatus;
  qualityScore: number;
  createdAt: string;
  updatedAt: string;
}

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;
