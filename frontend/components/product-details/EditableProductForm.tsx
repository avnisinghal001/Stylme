'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { Product } from '@/types/product';

export interface EditableProductValues {
  name: string;
  brand: string;
  price: string;
  colour: string;
  description: string;
}

interface EditableProductFormProps {
  product: Product;
  onSave: (values: EditableProductValues) => void;
  onCancel: () => void;
}

const inputClassName = 'mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function EditableProductForm({ product, onSave, onCancel }: EditableProductFormProps) {
  const initialValues: EditableProductValues = { name: product.name, brand: product.brand, price: String(product.price), colour: product.colour, description: product.description };
  const [values, setValues] = useState(initialValues);
  const update = (field: keyof EditableProductValues, value: string) => setValues((current) => ({ ...current, [field]: value }));

  return (
    <form id="product-edit-form" onSubmit={(event) => { event.preventDefault(); onSave(values); }} onReset={() => { setValues(initialValues); onCancel(); }} className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-4"><div><h2 className="text-base font-semibold text-foreground">Edit product</h2><p className="mt-1 text-sm text-muted-foreground">Review catalogue fields before saving.</p></div><Button type="reset" variant="ghost" size="sm">Cancel</Button></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-foreground">Name<input value={values.name} onChange={(event) => update('name', event.target.value)} className={inputClassName} /></label>
        <label className="text-sm font-medium text-foreground">Brand<input value={values.brand} onChange={(event) => update('brand', event.target.value)} className={inputClassName} /></label>
        <label className="text-sm font-medium text-foreground">Price<input type="number" min="0" value={values.price} onChange={(event) => update('price', event.target.value)} className={inputClassName} /></label>
        <label className="text-sm font-medium text-foreground">Colour<input value={values.colour} onChange={(event) => update('colour', event.target.value)} className={inputClassName} /></label>
      </div>
      <label className="mt-4 block text-sm font-medium text-foreground">Description<textarea value={values.description} onChange={(event) => update('description', event.target.value)} rows={4} className={`${inputClassName} h-auto py-2`} /></label>
    </form>
  );
}
