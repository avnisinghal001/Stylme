export type MeasurementBand = { min: number; max: number };

export function measurementBand(value: number | string | null | undefined, width: number): MeasurementBand | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const min = Math.floor(numeric / width) * width;
  return { min, max: min + width };
}

export function formatMeasurementBand(band: MeasurementBand | null, unit: string): string {
  return band ? `${band.min}–${band.max} ${unit}` : "Wildcard";
}

export function compatibleGenderKeys(values: string[], age?: number | null) {
  const resolved: string[] = [];
  for (const value of values) {
    if (value === "unspecified") continue;
    if (value === "women" || value === "girls") {
      if (age === null || age === undefined || age >= 13) resolved.push("women");
      if (age === null || age === undefined || age <= 14) resolved.push("girls", "kids");
      resolved.push("unisex");
    } else if (value === "men" || value === "boys") {
      if (age === null || age === undefined || age >= 13) resolved.push("men");
      if (age === null || age === undefined || age <= 14) resolved.push("boys", "kids");
      resolved.push("unisex");
    } else if (value === "kids") {
      resolved.push("kids", "girls", "boys", "unisex");
    } else {
      resolved.push(value);
    }
  }
  return [...new Set(resolved)];
}
