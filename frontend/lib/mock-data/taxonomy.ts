import { PRODUCT_CATEGORIES } from '@/lib/constants/categories';
import type { TaxonomyNode } from '@/types/taxonomy';

export const mockTaxonomy: TaxonomyNode[] = [...new Set(PRODUCT_CATEGORIES.map(({ department }) => department))].map((department) => ({
  id: department.toLowerCase(),
  name: department,
  slug: department.toLowerCase(),
  level: 'department',
  productCount: PRODUCT_CATEGORIES.filter((item) => item.department === department).length * 10,
  children: PRODUCT_CATEGORIES.filter((item) => item.department === department).map((item) => ({
    id: `${department}-${item.subCategory}`.toLowerCase().replaceAll(' ', '-'),
    name: item.subCategory,
    slug: item.subCategory.toLowerCase().replaceAll(' ', '-'),
    level: 'subCategory',
    parentId: department.toLowerCase(),
    productCount: 10,
  })),
}));
