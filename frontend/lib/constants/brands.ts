export const BRANDS = [
  'Roadster', 'HIGHLANDER', 'HRX by Hrithik Roshan', 'WROGN', 'HERE&NOW',
  'Mast & Harbour', 'Anouk', 'Sangria', 'Biba', 'Libas', 'Aurelia', 'KALINI',
  'Nautica', 'U.S. Polo Assn.', 'Puma', 'adidas', 'Nike', 'Levis', 'Allen Solly',
  'Van Heusen', 'DressBerry', 'Tokyo Talkies', 'Freakins', 'Campus Sutra',
] as const;

export type Brand = (typeof BRANDS)[number];
