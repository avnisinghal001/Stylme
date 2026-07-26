"use client";

/* eslint-disable @next/next/no-img-element */
import { Camera, Check, LoaderCircle, LockKeyhole, Sparkles, Trash2, UserRound, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { generateAppearanceProposal } from "@/lib/ai/appearance-workflow";
import { getProductTaxonomy } from "@/lib/ai/metadata-taxonomy";
import { completeCustomerOnboarding, getCustomerProfile } from "@/lib/api/client";
import { prepareProductImage, type PreparedProductImage } from "@/lib/upload/webp";
import { compatibleGenderKeys, formatMeasurementBand, measurementBand } from "@/lib/profile-bands";
import { useAuth } from "@/providers/AuthProvider";
import type { AppearanceProposal } from "@/types/auth";
import type { ProductTaxonomyContract } from "@/types/product-workflow";

const fieldClass = "mt-1.5 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-100";

export function OnboardingForm() {
  const { refresh } = useAuth();
  const [taxonomy, setTaxonomy] = useState<ProductTaxonomyContract | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [declaredAge, setDeclaredAge] = useState<number | null>(null);
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [bodyConsent, setBodyConsent] = useState(false);
  const [styles, setStyles] = useState<string[]>([]);
  const [generations, setGenerations] = useState<string[]>([]);
  const [genders, setGenders] = useState<string[]>([]);
  const [photos, setPhotos] = useState<PreparedProductImage[]>([]);
  const [appearanceConsent, setAppearanceConsent] = useState(false);
  const [proposal, setProposal] = useState<AppearanceProposal | null>(null);
  const [reviewAccepted, setReviewAccepted] = useState(false);
  const [busy, setBusy] = useState<"loading" | "photos" | "ai" | "save" | null>("loading");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([getCustomerProfile(), getProductTaxonomy(undefined, { forceRefresh: true, allowFallback: false })]).then(([profile, contract]) => {
      if (!active) return;
      setTaxonomy(contract); setFullName(profile.fullName ?? ""); setPhone(profile.phone ?? ""); setDateOfBirth(profile.bodyProfile.dateOfBirth?.slice(0, 10) ?? ""); setDeclaredAge(profile.bodyProfile.age ?? null); setHeight(profile.bodyProfile.heightCm ? String(profile.bodyProfile.heightCm) : ""); setWeight(profile.bodyProfile.weightKg ? String(profile.bodyProfile.weightKg) : ""); setBodyConsent(profile.bodyProfile.consent); setStyles(profile.preferences.styleKeys ?? []); setGenerations(profile.preferences.generationKeys ?? []); setGenders(profile.preferences.genderKeys ?? []); setProposal(profile.appearanceProfile ?? null); setReviewAccepted(Boolean(profile.appearanceProfile && !profile.appearanceProfile.reviewRequired));
    }).catch((error) => setNotice(error instanceof Error ? error.message : "Profile could not be loaded.")).finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, []);

  const toggle = (value: string, values: string[], setter: (next: string[]) => void, max = 12) => setter(values.includes(value) ? values.filter((item) => item !== value) : values.length < max ? [...values, value] : values);
  const recommendationHref = useMemo(() => {
    const params = new URLSearchParams();
    if (declaredAge !== null) { params.set("minAge", String(declaredAge)); params.set("maxAge", String(declaredAge)); }
    const heightBand = bodyConsent ? measurementBand(height, 15) : null; const weightBand = bodyConsent ? measurementBand(weight, 10) : null;
    if (heightBand) { params.set("minHeightCm", String(heightBand.min)); params.set("maxHeightCm", String(heightBand.max)); }
    if (weightBand) { params.set("minWeightKg", String(weightBand.min)); params.set("maxWeightKg", String(weightBand.max)); }
    compatibleGenderKeys(genders, declaredAge).forEach((value) => params.append("gender", value));
    styles.forEach((value) => params.append("meta", `style:${value}`)); generations.forEach((value) => params.append("meta", `generation:${value}`)); proposal?.recommendedColorFamilyKeys.forEach((value) => params.append("meta", `color_family:${value}`));
    return `/products?${params.toString()}`;
  }, [bodyConsent, declaredAge, genders, generations, height, proposal, styles, weight]);

  const choosePhotos = async (files: FileList | null) => {
    const selected = [...(files ? Array.from(files) : [])].slice(0, 4);
    if (!selected.length) return;
    setBusy("photos"); setNotice(null); setProposal(null); setReviewAccepted(false);
    try { setPhotos(await Promise.all(selected.map(prepareProductImage))); }
    catch (error) { setPhotos([]); setNotice(error instanceof Error ? error.message : "Photos could not be prepared."); }
    finally { setBusy(null); }
  };

  const runAppearance = async () => {
    if (!appearanceConsent || !photos.length) return;
    setBusy("ai"); setNotice(null);
    try {
      const result = await generateAppearanceProposal({ images: photos, declared: { ...(bodyConsent && height ? { heightCm: Number(height) } : {}), ...(bodyConsent && weight ? { weightKg: Number(weight) } : {}), styleKeys: styles } });
      setProposal(result.proposal); setStyles((current) => [...new Set([...current, ...result.proposal.styleKeys])].slice(0, 12)); setReviewAccepted(false); setNotice(result.reused ? "Your colour suggestions are ready again. Review them before saving." : "Your colour suggestions are ready. Review them before saving.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "We could not check those photos. Please try again."); }
    finally { setBusy(null); }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (proposal && !reviewAccepted) { setNotice("Review and accept the appearance suggestions, or remove them, before finishing."); return; }
    setBusy("save"); setNotice(null);
    try {
      await completeCustomerOnboarding({ fullName, phone, ...(dateOfBirth ? { dateOfBirth } : {}), bodyProfileConsent: bodyConsent, ...(bodyConsent && height ? { heightCm: Number(height) } : {}), ...(bodyConsent && weight ? { weightKg: Number(weight) } : {}), genderKeys: genders, styleKeys: styles, generationKeys: generations, metadata: { onboarding: { appearancePhotosProcessed: photos.length, recommendationHref } } });
      setPhotos([]); await refresh(); setNotice("Your profile is saved. Your photos were not saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Profile could not be saved."); }
    finally { setBusy(null); }
  };

  if (busy === "loading") return <div className="grid min-h-80 place-items-center"><LoaderCircle className="size-7 animate-spin text-pink-600" /></div>;
  return <form onSubmit={save} className="space-y-6"><header><span className="inline-flex items-center gap-1.5 rounded-full bg-pink-50 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-pink-700"><Sparkles className="size-3.5" />Personalization</span><h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Build your style profile</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Tell us what you like for better fashion matches. Photos are optional and are never saved.</p></header>
    <section className="rounded-2xl border border-pink-100 bg-white p-5 sm:p-6"><h2 className="font-black">1. About you</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold">Full name<input required minLength={2} value={fullName} onChange={(event) => setFullName(event.target.value)} className={fieldClass} /></label><label className="text-xs font-bold">Phone<input required type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className={fieldClass} /></label><label className="text-xs font-bold">Date of birth<input type="date" value={dateOfBirth} onChange={(event) => { const value = event.target.value; setDateOfBirth(value); if (!value) setDeclaredAge(null); else { const birth = new Date(`${value}T00:00:00`); const today = new Date(); let age = today.getFullYear() - birth.getFullYear(); if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1; setDeclaredAge(Math.max(0, age)); } }} className={fieldClass} /></label></div><p className="mt-2 text-[10px] leading-4 text-zinc-400">We use this number only for your account and, if you enable it, help with an unfinished cart.</p><GenderChoice options={(taxonomy?.options.gender ?? []).filter((value) => value !== "unspecified")} selected={genders} age={declaredAge} onChange={setGenders} /><label className="mt-4 flex items-start gap-3 rounded-xl bg-pink-50 p-3 text-xs leading-5 text-zinc-700"><input type="checkbox" checked={bodyConsent} onChange={(event) => setBodyConsent(event.target.checked)} className="mt-1 accent-pink-600" /><span><strong>Use my height and weight for better fit suggestions.</strong><br />Turning this off removes those measurements from your profile.</span></label>{bodyConsent && <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold">Height (cm)<input type="number" min={80} max={240} value={height} onChange={(event) => setHeight(event.target.value)} className={fieldClass} /><span className="mt-1.5 block text-[10px] font-medium text-pink-700">Helpful range: {formatMeasurementBand(measurementBand(height, 15), "cm")}</span></label><label className="text-xs font-bold">Weight (kg)<input type="number" min={20} max={350} value={weight} onChange={(event) => setWeight(event.target.value)} className={fieldClass} /><span className="mt-1.5 block text-[10px] font-medium text-pink-700">Helpful range: {formatMeasurementBand(measurementBand(weight, 10), "kg")}</span></label><p className="sm:col-span-2 text-[10px] leading-4 text-zinc-500">Styles likely to fit you appear first. You can still explore every available option.</p></div>}</section>
    <section className="rounded-2xl border border-pink-100 bg-white p-5 sm:p-6"><h2 className="font-black">2. Your choices</h2><p className="mt-1 text-xs text-zinc-500">Choose the generations and styles you enjoy. You can update these choices anytime.</p><ChoiceGroup label="Generation styling" options={taxonomy?.options.generation ?? []} selected={generations} onToggle={(value) => toggle(value, generations, setGenerations, 4)} /><ChoiceGroup label="Styles" options={taxonomy?.options.style ?? []} selected={styles} onToggle={(value) => toggle(value, styles, setStyles)} /></section>
    <section className="rounded-[1.75rem] border border-pink-200 bg-gradient-to-br from-[#fff0f5] to-white p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-pink-600 text-white"><Camera /></span><div><h2 className="font-black">3. Optional color-match photo styling</h2><p className="mt-1 text-xs leading-5 text-zinc-600">Choose 1–4 clear photos in neutral light. They are used once to suggest clothing colors, and the photos themselves are never saved.</p></div></div><label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-pink-300 bg-white px-4 py-5 text-sm font-bold text-pink-700"><Camera className="size-4" />{busy === "photos" ? "Preparing photos…" : "Choose up to 4 photos"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(event) => void choosePhotos(event.target.files)} disabled={Boolean(busy)} /></label>{photos.length > 0 && <div className="mt-3 grid grid-cols-4 gap-2">{photos.map((photo, index) => <div key={photo.normalizedSha256} className="relative aspect-square overflow-hidden rounded-xl bg-pink-50"><img src={photo.aiDataUrl} alt={`Selected style photo ${index + 1}`} className="size-full object-cover" /></div>)}</div>}<label className="mt-4 flex items-start gap-3 text-xs leading-5 text-zinc-700"><input type="checkbox" checked={appearanceConsent} onChange={(event) => setAppearanceConsent(event.target.checked)} className="mt-1 accent-pink-600" /><span>I agree to a one-time color check for clothing suggestions. Results are approximate, reviewable, and never used to judge identity, health or attractiveness.</span></label><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={!appearanceConsent || !photos.length || Boolean(busy)} onClick={runAppearance} className="inline-flex h-11 items-center gap-2 rounded-full bg-zinc-950 px-5 text-xs font-black text-white disabled:opacity-40">{busy === "ai" ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}{busy === "ai" ? "Finding your colors…" : "Find my best colors"}</button>{photos.length > 0 && <button type="button" onClick={() => { setPhotos([]); setProposal(null); setReviewAccepted(false); }} className="inline-flex h-11 items-center gap-2 rounded-full border border-zinc-200 px-4 text-xs font-bold text-zinc-600"><Trash2 className="size-4" />Remove photos</button>}</div>{proposal && <div className="mt-5 rounded-2xl border border-pink-200 bg-white p-4"><p className="text-xs font-black uppercase tracking-wider text-pink-700">Review before saving</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><ProposalLine label="Skin tone (styling only)" values={[proposal.skinTone]} /><ProposalLine label="Undertone" values={[proposal.undertone]} /><ProposalLine label="Recommended colors" values={proposal.recommendedColorFamilyKeys} /><ProposalLine label="Styles" values={proposal.styleKeys} /><ProposalLine label="Fits" values={proposal.fitKeys} /><ProposalLine label="Silhouettes" values={proposal.silhouetteKeys} /></div>{proposal.notes.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-zinc-600">{proposal.notes.map((note) => <li key={note}>{note}</li>)}</ul>}<label className="mt-4 flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={reviewAccepted} onChange={(event) => setReviewAccepted(event.target.checked)} className="accent-pink-600" />I reviewed and accept these style suggestions.</label></div>}</section>
    {notice && <p role="status" className="rounded-xl bg-zinc-950 px-4 py-3 text-sm text-white">{notice}</p>}<div className="flex flex-wrap items-center gap-3"><button disabled={Boolean(busy)} className="inline-flex h-12 items-center gap-2 rounded-full bg-pink-600 px-6 text-sm font-black text-white disabled:opacity-50">{busy === "save" ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}Save my profile</button><a href={recommendationHref} className="text-xs font-bold text-pink-700 underline-offset-4 hover:underline">Preview my matches</a><span className="ml-auto hidden items-center gap-1 text-[10px] text-zinc-400 sm:flex"><LockKeyhole className="size-3" />Your photos are never saved</span></div>
  </form>;
}

function GenderChoice({ options, selected, age, onChange }: { options: string[]; selected: string[]; age: number | null; onChange: (values: string[]) => void }) {
  const ageNote = age === null
    ? "Add your date of birth for more suitable suggestions."
    : age < 15
      ? `We will show age-suitable choices for ${age}.`
      : "We will prioritise adult styles while keeping your options open.";
  return <fieldset className="mt-5 rounded-2xl border border-pink-100 bg-gradient-to-br from-pink-50/80 to-white p-4"><legend className="px-1 text-xs font-black uppercase tracking-wider text-zinc-600"><span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5 text-pink-600" />Where do you usually shop?</span></legend><p className="mt-1 text-xs leading-5 text-zinc-600">Choose the section that usually fits you. This is never guessed from your photos.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => onChange([])} aria-pressed={selected.length === 0} className={`rounded-full border px-3 py-2 text-xs font-bold transition ${selected.length === 0 ? "border-pink-600 bg-pink-600 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-pink-300"}`}>Any style</button>{options.map((option) => <button key={option} type="button" onClick={() => onChange([option])} aria-pressed={selected.includes(option)} className={`rounded-full border px-3 py-2 text-xs font-bold capitalize transition ${selected.includes(option) ? "border-pink-600 bg-pink-600 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-pink-300"}`}>{option.replaceAll("-", " ")}</button>)}</div><p className="mt-3 text-[10px] leading-4 text-zinc-500">{ageNote} Choose “Any style” to explore everything.</p></fieldset>;
}

function ChoiceGroup({ label, options, selected, onToggle }: { label: string; options: string[]; selected: string[]; onToggle: (value: string) => void }) { return <fieldset className="mt-5"><legend className="text-xs font-black uppercase tracking-wider text-zinc-500">{label}</legend><div className="mt-2 flex flex-wrap gap-2">{options.map((option) => <button key={option} type="button" onClick={() => onToggle(option)} aria-pressed={selected.includes(option)} className={`rounded-full border px-3 py-2 text-xs font-bold transition ${selected.includes(option) ? "border-pink-600 bg-pink-600 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-pink-300"}`}>{option.replaceAll("-", " ")}</button>)}</div></fieldset>; }
function ProposalLine({ label, values }: { label: string; values: string[] }) { return <div><p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">{label}</p><p className="mt-1 text-xs font-semibold text-zinc-700">{values.length ? values.join(", ") : "No confident suggestion"}</p></div>; }
