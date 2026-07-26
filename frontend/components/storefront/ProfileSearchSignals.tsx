"use client";

import { useAuth } from "@/providers/AuthProvider";
import { compatibleGenderKeys, measurementBand } from "@/lib/profile-bands";

export function ProfileSearchSignals({ mode }: { mode: "intent" | "catalog" }) {
  const { user } = useAuth();
  if (!user) return null;
  const genders = user.genderKeys ?? [];
  const { age, heightCm, weightKg } = user.profileSignals ?? {};

  if (mode === "intent") {
    return <>{genders.map((value) => <input key={value} type="hidden" name="profileGender" value={value} />)}{age !== null && age !== undefined && <input type="hidden" name="profileAge" value={age} />}{heightCm !== null && heightCm !== undefined && <input type="hidden" name="profileHeightCm" value={heightCm} />}{weightKg !== null && weightKg !== undefined && <input type="hidden" name="profileWeightKg" value={weightKg} />}</>;
  }

  const catalogGenders = compatibleGenderKeys(genders, age);
  const heightBand = measurementBand(heightCm, 15);
  const weightBand = measurementBand(weightKg, 10);
  return <>{catalogGenders.map((value) => <input key={value} type="hidden" name="gender" value={value} />)}{age !== null && age !== undefined && <><input type="hidden" name="minAge" value={age} /><input type="hidden" name="maxAge" value={age} /></>}{heightBand && <><input type="hidden" name="minHeightCm" value={heightBand.min} /><input type="hidden" name="maxHeightCm" value={heightBand.max} /></>}{weightBand && <><input type="hidden" name="minWeightKg" value={weightBand.min} /><input type="hidden" name="maxWeightKg" value={weightBand.max} /></>}</>;
}
