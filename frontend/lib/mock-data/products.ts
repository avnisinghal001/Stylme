import { BRANDS } from '@/lib/constants/brands';
import { COLOURS } from '@/lib/constants/colours';
import { PRODUCT_CATEGORIES } from '@/lib/constants/categories';
import type { Product } from '@/types/product';

const PRODUCT_NAMES = [
  'Pure Cotton Printed T-shirt', 'Slim Fit Casual Shirt', 'Mid-Rise Skinny Jeans',
  'Regular Fit Chinos', 'Floral Print Straight Kurta', 'A-Line Midi Dress',
  'Ribbed Fitted Top', 'Woven Design Saree', 'Colourblocked Sneakers', 'Mesh Running Shoes',
] as const;

const FITS = ['Regular Fit', 'Slim Fit', 'Relaxed Fit', 'Comfort Fit'] as const;
const FABRICS = ['100% Cotton', 'Cotton Blend', 'Polyester', 'Viscose Rayon', 'Denim'] as const;
const SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;

const imageFor = (id: number) => `https://assets.myntassets.com/h_720,q_90,w_540/v1/assets/images/${10000000 + id}/2024/1/1/${id}-product.jpg`;

export const mockProducts: Product[] = Array.from({ length: 100 }, (_, index) => {
  const id = index + 1;
  const category = PRODUCT_CATEGORIES[index % PRODUCT_CATEGORIES.length];
  const item = PRODUCT_NAMES[index % PRODUCT_NAMES.length];
  const brand = BRANDS[index % BRANDS.length];
  const status = index % 17 === 0 ? 'rejected' : index % 11 === 0 ? 'draft' : index % 7 === 0 ? 'pending' : 'approved';
  const price = 499 + ((index * 317) % 3500);
  const rating = Number((3.6 + ((index * 7) % 14) / 10).toFixed(1));
  const createdAt = new Date(Date.UTC(2026, 0, 1 + index)).toISOString();

  return {
    id: `MYN-${String(id).padStart(5, '0')}`,
    name: `${brand} ${item}`,
    price,
    colour: COLOURS[(index * 3) % COLOURS.length],
    brand,
    img: imageFor(id),
    ratingCount: 42 + ((index * 137) % 6842),
    avgRating: rating,
    description: `A ${category.subCategory.toLowerCase()} by ${brand}, designed for everyday comfort with a polished ${category.department.toLowerCase()}wear look.`,
    attributes: {
      Department: category.department,
      Category: category.category,
      'Sub Category': category.subCategory,
      Fabric: FABRICS[index % FABRICS.length],
      Fit: FITS[index % FITS.length],
      Size: [...SIZES],
      'Wash Care': index % 3 === 0 ? 'Machine wash' : 'Hand wash separately',
      'Country of Origin': 'India',
    },
    status,
    qualityScore: 68 + ((index * 9) % 33),
    createdAt,
    updatedAt: new Date(Date.UTC(2026, 2, 1 + (index % 28))).toISOString(),
  };
});

export const MOCK_PRODUCT_COUNT = mockProducts.length;
