import { mockTaxonomy } from '@/lib/mock-data/taxonomy';
import type { TaxonomyNode } from '@/types/taxonomy';

export const getTaxonomy = (): Promise<TaxonomyNode[]> => Promise.resolve(mockTaxonomy);

export const taxonomyService = { getTaxonomy };
