import { COLOUR_FAMILIES, type ColourFamily, type PaletteColour } from '@/types/product-workflow';

const toHex = (value: number) => value.toString(16).padStart(2, '0').toUpperCase();

export function colourFamilyForRgb(red: number, green: number, blue: number): ColourFamily {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  if (lightness < 0.13) return 'black';
  if (lightness > 0.9 && saturation < 0.18) return 'white';
  if (saturation < 0.14) return 'gray';

  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;

  if ((hue < 42 || hue >= 345) && lightness < 0.42) return 'brown';
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 45) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 195) return 'teal';
  if (hue < 255) return 'blue';
  if (hue < 292) return 'purple';
  return 'pink';
}

export function extractPalette(pixels: Uint8ClampedArray, maximum = 6): PaletteColour[] {
  const buckets = new Map<number, { count: number; red: number; green: number; blue: number }>();
  let visiblePixels = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const bucket = (red >> 5) << 10 | (green >> 5) << 5 | (blue >> 5);
    const current = buckets.get(bucket) ?? { count: 0, red: 0, green: 0, blue: 0 };
    current.count += 1;
    current.red += red;
    current.green += green;
    current.blue += blue;
    buckets.set(bucket, current);
    visiblePixels += 1;
  }

  if (!visiblePixels) return [];
  const selected = [...buckets.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, maximum)
    .map((bucket) => {
      const red = Math.round(bucket.red / bucket.count);
      const green = Math.round(bucket.green / bucket.count);
      const blue = Math.round(bucket.blue / bucket.count);
      return {
        hex: `#${toHex(red)}${toHex(green)}${toHex(blue)}`,
        family: colourFamilyForRgb(red, green, blue),
        proportion: Number((bucket.count / visiblePixels).toFixed(4)),
      } satisfies PaletteColour;
    });

  return selected.filter((colour) => COLOUR_FAMILIES.includes(colour.family));
}
