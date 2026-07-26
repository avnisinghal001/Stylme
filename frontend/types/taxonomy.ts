export interface TaxonomyNode {
  id: string;
  name: string;
  slug: string;
  level: 'department' | 'category' | 'subCategory';
  parentId?: string;
  productCount: number;
  children?: TaxonomyNode[];
}

export interface ProductCategory {
  department: string;
  category: string;
  subCategory: string;
}
