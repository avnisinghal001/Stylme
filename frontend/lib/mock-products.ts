export type ProductStatus = 'Approved' | 'Pending' | 'Rejected';

export type Product = {
  id: string;
  productName: string;
  brand: string;
  category: string;
  subcategory: string;
  color: string;
  price: number;
  rating: number;
  qualityScore: number;
  status: ProductStatus;
  imageUrl: string;
  createdAt: string;
};

const placeholder = (label: string, color = 'FF3F6C') =>
  `https://placehold.co/96x96/${color}/FFFFFF?text=${encodeURIComponent(label)}`;

export const mockProducts: Product[] = [
  { id: 'MNT-1001', productName: 'Floral Fit & Flare Midi Dress', brand: 'Roadster', category: 'Women', subcategory: 'Dresses', color: 'Pink', price: 1599, rating: 4.3, qualityScore: 94, status: 'Approved', imageUrl: placeholder('Dress'), createdAt: '2026-07-12' },
  { id: 'MNT-1002', productName: 'Slim Fit Cotton Casual Shirt', brand: 'HIGHLANDER', category: 'Men', subcategory: 'Shirts', color: 'Blue', price: 899, rating: 4.1, qualityScore: 91, status: 'Approved', imageUrl: placeholder('Shirt', '2563EB'), createdAt: '2026-07-12' },
  { id: 'MNT-1003', productName: 'Women Running Shoes', brand: 'Puma', category: 'Footwear', subcategory: 'Sports Shoes', color: 'White', price: 3299, rating: 4.5, qualityScore: 96, status: 'Approved', imageUrl: placeholder('Shoes', '7C3AED'), createdAt: '2026-07-11' },
  { id: 'MNT-1004', productName: 'Straight Fit High-Rise Jeans', brand: 'Levis', category: 'Women', subcategory: 'Jeans', color: 'Indigo', price: 2499, rating: 4.2, qualityScore: 89, status: 'Pending', imageUrl: placeholder('Jeans', '1E40AF'), createdAt: '2026-07-11' },
  { id: 'MNT-1005', productName: 'Printed Pure Cotton Kurta', brand: 'Anouk', category: 'Women', subcategory: 'Kurtas', color: 'Yellow', price: 1199, rating: 4.4, qualityScore: 93, status: 'Approved', imageUrl: placeholder('Kurta', 'CA8A04'), createdAt: '2026-07-10' },
  { id: 'MNT-1006', productName: 'Classic Analogue Watch', brand: 'Fastrack', category: 'Accessories', subcategory: 'Watches', color: 'Black', price: 1995, rating: 4.0, qualityScore: 88, status: 'Pending', imageUrl: placeholder('Watch', '374151'), createdAt: '2026-07-10' },
  { id: 'MNT-1007', productName: 'Oversized Graphic T-Shirt', brand: 'WROGN', category: 'Men', subcategory: 'T-Shirts', color: 'White', price: 749, rating: 3.8, qualityScore: 72, status: 'Rejected', imageUrl: placeholder('Tee', '0F766E'), createdAt: '2026-07-09' },
  { id: 'MNT-1008', productName: 'Textured Shoulder Bag', brand: 'Mast & Harbour', category: 'Accessories', subcategory: 'Handbags', color: 'Tan', price: 1799, rating: 4.3, qualityScore: 92, status: 'Approved', imageUrl: placeholder('Bag', '92400E'), createdAt: '2026-07-09' },
  { id: 'MNT-1009', productName: 'Regular Fit Polo T-Shirt', brand: 'Tommy Hilfiger', category: 'Men', subcategory: 'T-Shirts', color: 'Navy Blue', price: 2299, rating: 4.6, qualityScore: 97, status: 'Approved', imageUrl: placeholder('Polo', '1D4ED8'), createdAt: '2026-07-08' },
  { id: 'MNT-1010', productName: 'Embroidered Party Saree', brand: 'Sangria', category: 'Women', subcategory: 'Sarees', color: 'Maroon', price: 2899, rating: 4.2, qualityScore: 90, status: 'Approved', imageUrl: placeholder('Saree', '9F1239'), createdAt: '2026-07-08' },
  { id: 'MNT-1011', productName: 'Mesh Lace-Up Sneakers', brand: 'Nike', category: 'Footwear', subcategory: 'Casual Shoes', color: 'Grey', price: 4595, rating: 4.7, qualityScore: 98, status: 'Approved', imageUrl: placeholder('Sneaker', '4B5563'), createdAt: '2026-07-07' },
  { id: 'MNT-1012', productName: 'Slim Tapered Chinos', brand: 'U.S. Polo Assn.', category: 'Men', subcategory: 'Trousers', color: 'Beige', price: 1899, rating: 4.1, qualityScore: 87, status: 'Pending', imageUrl: placeholder('Chinos', 'A16207'), createdAt: '2026-07-07' },
  { id: 'MNT-1013', productName: 'Relaxed Fit Co-ords Set', brand: 'Tokyo Talkies', category: 'Women', subcategory: 'Co-ords', color: 'Olive', price: 2199, rating: 4.0, qualityScore: 85, status: 'Pending', imageUrl: placeholder('Co-ords', '4D7C0F'), createdAt: '2026-07-06' },
  { id: 'MNT-1014', productName: 'Leather Formal Derby Shoes', brand: 'Red Tape', category: 'Footwear', subcategory: 'Formal Shoes', color: 'Brown', price: 2699, rating: 4.3, qualityScore: 94, status: 'Approved', imageUrl: placeholder('Derby', '78350F'), createdAt: '2026-07-06' },
  { id: 'MNT-1015', productName: 'Minimal Chain Necklace', brand: 'Accessorize London', category: 'Accessories', subcategory: 'Jewellery', color: 'Gold', price: 999, rating: 3.9, qualityScore: 76, status: 'Rejected', imageUrl: placeholder('Necklace', 'B45309'), createdAt: '2026-07-05' },
  { id: 'MNT-1016', productName: 'Checked Wool Blend Shacket', brand: 'HERE&NOW', category: 'Men', subcategory: 'Jackets', color: 'Green', price: 2099, rating: 4.4, qualityScore: 92, status: 'Approved', imageUrl: placeholder('Jacket', '15803D'), createdAt: '2026-07-05' },
  { id: 'MNT-1017', productName: 'Ribbed Knit Cardigan', brand: 'Vero Moda', category: 'Women', subcategory: 'Sweaters', color: 'Cream', price: 1799, rating: 4.2, qualityScore: 90, status: 'Approved', imageUrl: placeholder('Cardigan', 'A78BFA'), createdAt: '2026-07-04' },
  { id: 'MNT-1018', productName: 'Colourblocked Training Shoes', brand: 'ASICS', category: 'Footwear', subcategory: 'Sports Shoes', color: 'Orange', price: 3999, rating: 4.5, qualityScore: 95, status: 'Approved', imageUrl: placeholder('Trainers', 'EA580C'), createdAt: '2026-07-04' },
  { id: 'MNT-1019', productName: 'Structured Laptop Backpack', brand: 'Wildcraft', category: 'Accessories', subcategory: 'Backpacks', color: 'Black', price: 2295, rating: 4.4, qualityScore: 93, status: 'Approved', imageUrl: placeholder('Pack', '111827'), createdAt: '2026-07-03' },
  { id: 'MNT-1020', productName: 'Linen Blend A-Line Skirt', brand: 'AND', category: 'Women', subcategory: 'Skirts', color: 'Blue', price: 1499, rating: 4.0, qualityScore: 84, status: 'Pending', imageUrl: placeholder('Skirt', '2563EB'), createdAt: '2026-07-03' },
  { id: 'MNT-1021', productName: 'Pack of 3 Cotton Boxers', brand: 'Jockey', category: 'Men', subcategory: 'Innerwear', color: 'Multicolour', price: 1099, rating: 4.6, qualityScore: 95, status: 'Approved', imageUrl: placeholder('Boxers', '0E7490'), createdAt: '2026-07-02' },
  { id: 'MNT-1022', productName: 'Floral Block Heel Sandals', brand: 'DressBerry', category: 'Footwear', subcategory: 'Heels', color: 'Pink', price: 1599, rating: 3.7, qualityScore: 70, status: 'Rejected', imageUrl: placeholder('Heels'), createdAt: '2026-07-02' },
  { id: 'MNT-1023', productName: 'Handcrafted Cotton Bedsheet', brand: 'DDecor', category: 'Home', subcategory: 'Bedsheets', color: 'Blue', price: 1399, rating: 4.3, qualityScore: 91, status: 'Approved', imageUrl: placeholder('Home', '1D4ED8'), createdAt: '2026-07-01' },
  { id: 'MNT-1024', productName: 'Slim Fit Distressed Jeans', brand: 'Kook N Keech', category: 'Men', subcategory: 'Jeans', color: 'Black', price: 1699, rating: 4.1, qualityScore: 88, status: 'Approved', imageUrl: placeholder('Jeans', '1F2937'), createdAt: '2026-07-01' },
  { id: 'MNT-1025', productName: 'Printed Anarkali Kurta Set', brand: 'Libas', category: 'Women', subcategory: 'Kurta Sets', color: 'Teal', price: 2499, rating: 4.5, qualityScore: 96, status: 'Approved', imageUrl: placeholder('Kurta', '0F766E'), createdAt: '2026-06-30' },
  { id: 'MNT-1026', productName: 'Polarised Aviator Sunglasses', brand: 'Ray-Ban', category: 'Accessories', subcategory: 'Sunglasses', color: 'Gold', price: 7490, rating: 4.7, qualityScore: 98, status: 'Approved', imageUrl: placeholder('Shades', 'B45309'), createdAt: '2026-06-30' },
  { id: 'MNT-1027', productName: 'Puffer Hooded Jacket', brand: 'Roadster', category: 'Men', subcategory: 'Jackets', color: 'Red', price: 2499, rating: 4.0, qualityScore: 86, status: 'Pending', imageUrl: placeholder('Puffer', 'DC2626'), createdAt: '2026-06-29' },
  { id: 'MNT-1028', productName: 'Knitted Slip-On Flats', brand: 'Clarks', category: 'Footwear', subcategory: 'Flats', color: 'Navy Blue', price: 3499, rating: 4.4, qualityScore: 93, status: 'Approved', imageUrl: placeholder('Flats', '1E3A8A'), createdAt: '2026-06-29' },
  { id: 'MNT-1029', productName: 'Satin Finish Lipstick Set', brand: 'Lakme', category: 'Beauty', subcategory: 'Makeup', color: 'Berry', price: 1199, rating: 4.2, qualityScore: 89, status: 'Approved', imageUrl: placeholder('Beauty', 'BE123C'), createdAt: '2026-06-28' },
  { id: 'MNT-1030', productName: 'Textured Cotton Bath Towels', brand: 'Spaces', category: 'Home', subcategory: 'Bath', color: 'Grey', price: 899, rating: 4.0, qualityScore: 83, status: 'Pending', imageUrl: placeholder('Towels', '6B7280'), createdAt: '2026-06-28' },
  { id: 'MNT-1031', productName: 'Seamless Medium Impact Bra', brand: 'HRX by Hrithik Roshan', category: 'Women', subcategory: 'Sportswear', color: 'Purple', price: 1299, rating: 4.3, qualityScore: 90, status: 'Approved', imageUrl: placeholder('Sports', '7E22CE'), createdAt: '2026-06-27' },
  { id: 'MNT-1032', productName: 'Regular Fit Denim Shirt', brand: 'Pepe Jeans', category: 'Men', subcategory: 'Shirts', color: 'Blue', price: 1899, rating: 4.1, qualityScore: 88, status: 'Approved', imageUrl: placeholder('Denim', '1E40AF'), createdAt: '2026-06-27' },
  { id: 'MNT-1033', productName: 'Croc-Effect Tote Bag', brand: 'Lavie', category: 'Accessories', subcategory: 'Handbags', color: 'Black', price: 1999, rating: 4.2, qualityScore: 90, status: 'Approved', imageUrl: placeholder('Tote', '111827'), createdAt: '2026-06-26' },
  { id: 'MNT-1034', productName: 'Cotton Blend Cargo Joggers', brand: 'Campus Sutra', category: 'Men', subcategory: 'Joggers', color: 'Olive', price: 1399, rating: 3.8, qualityScore: 74, status: 'Rejected', imageUrl: placeholder('Joggers', '4D7C0F'), createdAt: '2026-06-26' },
  { id: 'MNT-1035', productName: 'Embellished Ethnic Juttis', brand: 'Mochi', category: 'Footwear', subcategory: 'Ethnic Footwear', color: 'Gold', price: 1899, rating: 4.3, qualityScore: 92, status: 'Approved', imageUrl: placeholder('Jutti', 'A16207'), createdAt: '2026-06-25' },
  { id: 'MNT-1036', productName: 'Striped V-Neck T-Shirt', brand: 'ONLY', category: 'Women', subcategory: 'T-Shirts', color: 'White', price: 899, rating: 4.0, qualityScore: 85, status: 'Pending', imageUrl: placeholder('Tee', '0F766E'), createdAt: '2026-06-25' },
  { id: 'MNT-1037', productName: 'Insulated Steel Water Bottle', brand: 'Milton', category: 'Home', subcategory: 'Kitchen', color: 'Silver', price: 699, rating: 4.4, qualityScore: 94, status: 'Approved', imageUrl: placeholder('Bottle', '64748B'), createdAt: '2026-06-24' },
  { id: 'MNT-1038', productName: 'Longline Sports Jacket', brand: 'Adidas', category: 'Women', subcategory: 'Sportswear', color: 'Black', price: 4299, rating: 4.5, qualityScore: 96, status: 'Approved', imageUrl: placeholder('Jacket', '1F2937'), createdAt: '2026-06-24' },
  { id: 'MNT-1039', productName: 'Leather Belt with Metal Buckle', brand: 'Louis Philippe', category: 'Accessories', subcategory: 'Belts', color: 'Brown', price: 1299, rating: 4.2, qualityScore: 89, status: 'Approved', imageUrl: placeholder('Belt', '78350F'), createdAt: '2026-06-23' },
  { id: 'MNT-1040', productName: 'Checked Casual Blazer', brand: 'Van Heusen', category: 'Men', subcategory: 'Blazers', color: 'Grey', price: 3499, rating: 4.0, qualityScore: 87, status: 'Pending', imageUrl: placeholder('Blazer', '4B5563'), createdAt: '2026-06-23' },
  { id: 'MNT-1041', productName: 'Ruffled Sleeve Maxi Dress', brand: 'Berrylush', category: 'Women', subcategory: 'Dresses', color: 'Green', price: 2199, rating: 4.3, qualityScore: 91, status: 'Approved', imageUrl: placeholder('Dress', '15803D'), createdAt: '2026-06-22' },
  { id: 'MNT-1042', productName: 'Eau de Parfum for Women', brand: 'Fogg', category: 'Beauty', subcategory: 'Fragrances', color: 'Pink', price: 1099, rating: 3.9, qualityScore: 78, status: 'Rejected', imageUrl: placeholder('Perfume', 'DB2777'), createdAt: '2026-06-22' },
  { id: 'MNT-1043', productName: 'Canvas High-Top Sneakers', brand: 'Converse', category: 'Footwear', subcategory: 'Casual Shoes', color: 'White', price: 3999, rating: 4.6, qualityScore: 97, status: 'Approved', imageUrl: placeholder('Canvas', '334155'), createdAt: '2026-06-21' },
  { id: 'MNT-1044', productName: 'Pack of 2 Printed Cushion Covers', brand: 'Swayam', category: 'Home', subcategory: 'Decor', color: 'Multicolour', price: 599, rating: 4.1, qualityScore: 86, status: 'Approved', imageUrl: placeholder('Decor', 'C2410C'), createdAt: '2026-06-21' },
  { id: 'MNT-1045', productName: 'Tropical Print Resort Shirt', brand: 'The Souled Store', category: 'Men', subcategory: 'Shirts', color: 'Blue', price: 1199, rating: 4.2, qualityScore: 90, status: 'Approved', imageUrl: placeholder('Resort', '0369A1'), createdAt: '2026-06-20' },
  { id: 'MNT-1046', productName: 'Soft Touch Yoga Mat', brand: 'Boldfit', category: 'Sports', subcategory: 'Fitness', color: 'Purple', price: 1299, rating: 4.1, qualityScore: 87, status: 'Pending', imageUrl: placeholder('Yoga', '7E22CE'), createdAt: '2026-06-20' },
  { id: 'MNT-1047', productName: 'Classic Logo Baseball Cap', brand: 'Puma', category: 'Accessories', subcategory: 'Caps', color: 'Black', price: 799, rating: 4.0, qualityScore: 84, status: 'Pending', imageUrl: placeholder('Cap', '111827'), createdAt: '2026-06-19' },
  { id: 'MNT-1048', productName: 'Wide Leg Pleated Trousers', brand: 'Marks & Spencer', category: 'Women', subcategory: 'Trousers', color: 'Beige', price: 2399, rating: 4.4, qualityScore: 93, status: 'Approved', imageUrl: placeholder('Trousers', 'A16207'), createdAt: '2026-06-19' },
  { id: 'MNT-1049', productName: 'Lightweight Trail Running Shoes', brand: 'New Balance', category: 'Footwear', subcategory: 'Sports Shoes', color: 'Orange', price: 5699, rating: 4.5, qualityScore: 96, status: 'Approved', imageUrl: placeholder('Trail', 'EA580C'), createdAt: '2026-06-18' },
  { id: 'MNT-1050', productName: 'Rose Gold Dial Smartwatch', brand: 'boAt', category: 'Accessories', subcategory: 'Watches', color: 'Rose Gold', price: 2499, rating: 4.2, qualityScore: 90, status: 'Approved', imageUrl: placeholder('Smartwatch', 'BE123C'), createdAt: '2026-06-18' },
];
