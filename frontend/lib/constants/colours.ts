export const COLOURS = [
  'Black', 'White', 'Blue', 'Navy Blue', 'Grey', 'Beige', 'Brown', 'Green',
  'Olive', 'Pink', 'Red', 'Maroon', 'Yellow', 'Mustard', 'Purple', 'Lavender',
  'Orange', 'Peach', 'Teal', 'Turquoise', 'Cream', 'Gold',
] as const;

export type Colour = (typeof COLOURS)[number];
