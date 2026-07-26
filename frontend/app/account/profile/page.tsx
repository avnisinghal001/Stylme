"use client";

import { ArrowRight, LoaderCircle, Ruler, Sparkles, UserRound, Weight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { getCustomerProfile } from "@/lib/api/client";
import { compatibleGenderKeys, formatMeasurementBand, measurementBand } from "@/lib/profile-bands";
import type { CustomerProfile } from "@/types/auth";

export default function AccountProfilePage() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void getCustomerProfile().then(setProfile).catch((caught) => setError(caught instanceof Error ? caught.message : "Profile could not be loaded.")); }, []);
  const shopHref = useMemo(() => {
    if (!profile) return "/products";
    const params = new URLSearchParams();
    const { age, heightCm, weightKg, consent } = profile.bodyProfile;
    if (age !== null && age !== undefined) { params.set("minAge", String(age)); params.set("maxAge", String(age)); }
    const heightBand = consent ? measurementBand(heightCm, 15) : null; const weightBand = consent ? measurementBand(weightKg, 10) : null;
    if (heightBand) { params.set("minHeightCm", String(heightBand.min)); params.set("maxHeightCm", String(heightBand.max)); }
    if (weightBand) { params.set("minWeightKg", String(weightBand.min)); params.set("maxWeightKg", String(weightBand.max)); }
    compatibleGenderKeys(profile.preferences.genderKeys ?? [], age).forEach((value) => params.append("gender", value));
    profile.preferences.styleKeys?.forEach((value) => params.append("meta", `style:${value}`)); profile.preferences.generationKeys?.forEach((value) => params.append("meta", `generation:${value}`)); profile.appearanceProfile?.recommendedColorFamilyKeys?.forEach((value) => params.append("meta", `color_family:${value}`));
    return `/products?${params.toString()}`;
  }, [profile]);
  if (!profile && !error) return <div className="grid min-h-80 place-items-center"><LoaderCircle className="animate-spin text-pink-600" /></div>;
  if (!profile) return <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  const tags = [...(profile.preferences.genderKeys ?? []), ...(profile.preferences.generationKeys ?? []), ...(profile.preferences.styleKeys ?? [])];
  return <div><header className="rounded-[2rem] bg-gradient-to-br from-zinc-950 via-[#2b0918] to-pink-900 p-6 text-white sm:p-9"><span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-black"><Sparkles className="size-3.5 text-pink-300" />Your style profile</span><h1 className="mt-4 text-3xl font-black tracking-tight sm:text-5xl">Hi, {profile.fullName.split(" ")[0]}.</h1><p className="mt-2 max-w-xl text-sm leading-6 text-pink-100">Your saved size, fit, style and colour choices help bring better matches first. Photos are never saved.</p><div className="mt-6 flex flex-wrap gap-3"><Link href={shopHref} className="inline-flex h-11 items-center gap-2 rounded-full bg-pink-500 px-5 text-sm font-black">Shop my style <ArrowRight className="size-4" /></Link><Link href="/account/onboarding" className="inline-flex h-11 items-center rounded-full border border-white/20 px-5 text-sm font-bold">Edit profile</Link></div></header><div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={<UserRound />} label="Shopping section" value={profile.preferences.genderKeys?.length ? profile.preferences.genderKeys.join(" + ") : "Any"} /><Metric icon={<Sparkles />} label="Age" value={profile.bodyProfile.age ? `${profile.bodyProfile.age} years` : "Any"} /><Metric icon={<Ruler />} label="Height range" value={profile.bodyProfile.consent ? formatMeasurementBand(measurementBand(profile.bodyProfile.heightCm, 15), "cm") : "Any"} /><Metric icon={<Weight />} label="Weight range" value={profile.bodyProfile.consent ? formatMeasurementBand(measurementBand(profile.bodyProfile.weightKg, 10), "kg") : "Any"} /></div><section className="mt-5 rounded-2xl border border-pink-100 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-black">Your preferences</h2><span className="text-xs text-zinc-400">{tags.length} selected</span></div><div className="mt-4 flex flex-wrap gap-2">{tags.length ? tags.map((tag) => <span key={tag} className="rounded-full bg-pink-50 px-3 py-2 text-xs font-bold text-pink-700">{tag.replaceAll("-", " ")}</span>) : <p className="text-sm text-zinc-500">No choices yet—showing every style.</p>}</div></section>{profile.appearanceProfile && <section className="mt-5 rounded-2xl border border-pink-100 bg-white p-5"><h2 className="font-black">Your colour suggestions</h2><p className="mt-2 text-xs leading-5 text-zinc-500">These shades are optional suggestions for your outfits. Your photos are never saved.</p><div className="mt-4 flex flex-wrap gap-2">{profile.appearanceProfile.recommendedColorFamilyKeys.map((color) => <span key={color} className="rounded-full bg-zinc-950 px-3 py-2 text-xs font-bold capitalize text-pink-100">{color.replaceAll("-", " ")}</span>)}</div></section>}</div>;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="rounded-2xl border border-pink-100 bg-white p-5"><span className="text-pink-600 [&>svg]:size-5">{icon}</span><p className="mt-3 text-xs font-bold text-zinc-400">{label}</p><p className="mt-1 text-lg font-black">{value}</p></div>; }
