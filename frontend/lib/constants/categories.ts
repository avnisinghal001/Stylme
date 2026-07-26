import type { ProductCategory } from '@/types/taxonomy';

export const PRODUCT_CATEGORIES: readonly ProductCategory[] = [
  { department: 'Men', category: 'Clothing', subCategory: 'Tshirts' },
  { department: 'Men', category: 'Clothing', subCategory: 'Shirts' },
  { department: 'Men', category: 'Clothing', subCategory: 'Jeans' },
  { department: 'Men', category: 'Clothing', subCategory: 'Trousers' },
  { department: 'Women', category: 'Clothing', subCategory: 'Kurtas' },
  { department: 'Women', category: 'Clothing', subCategory: 'Dresses' },
  { department: 'Women', category: 'Clothing', subCategory: 'Tops' },
  { department: 'Women', category: 'Clothing', subCategory: 'Sarees' },
  { department: 'Footwear', category: 'Shoes', subCategory: 'Casual Shoes' },
  { department: 'Footwear', category: 'Shoes', subCategory: 'Sports Shoes' },
] as const;

export const DEPARTMENTS = [...new Set(PRODUCT_CATEGORIES.map(({ department }) => department))];
