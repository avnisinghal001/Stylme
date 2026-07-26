import { ChevronDown, Folder, FolderOpen, Tag } from 'lucide-react';

export type TaxonomyCategory = {
  name: string;
  productCount: number;
  subcategories: { name: string; productCount: number }[];
};

export function CategoryTree({ categories }: { categories: TaxonomyCategory[] }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="border-b px-5 py-4">
        <h3 className="font-semibold text-foreground">Categories</h3>
        <p className="mt-1 text-sm text-muted-foreground">Browse product categories and subcategories.</p>
      </div>
      <ul className="p-3">
        {categories.map((category, index) => (
          <li key={category.name} className="rounded-lg">
            <div className="flex items-center gap-2 px-2 py-2 text-sm font-medium text-foreground">
              <ChevronDown className="size-4 text-muted-foreground" />
              {index === 0 ? <FolderOpen className="size-4 text-primary" /> : <Folder className="size-4 text-primary" />}
              <span className="min-w-0 flex-1 truncate">{category.name}</span>
              <span className="text-xs font-normal text-muted-foreground">{category.productCount}</span>
            </div>
            <ul className="ml-4 border-l pl-3 pb-2">
              {category.subcategories.map((subcategory) => (
                <li key={subcategory.name} className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                  <Tag className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{subcategory.name}</span>
                  <span className="text-xs">{subcategory.productCount}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
