"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, LoaderCircle, Pause, Play, Search, Volume2 } from "lucide-react";

import { getSarvamVoices, previewSarvamVoice } from "@/lib/api/agent-admin";
import type { AgentConfig, SarvamVoice } from "@/types/ai-agents";

type VoiceConfig = NonNullable<AgentConfig["voice"]>;
type GenderFilter = "all" | SarvamVoice["gender"];

const languageLabels: Record<string, string> = {
  "en-IN": "English (India)", "hi-IN": "Hindi", "bn-IN": "Bengali", "ta-IN": "Tamil",
  "te-IN": "Telugu", "gu-IN": "Gujarati", "kn-IN": "Kannada", "ml-IN": "Malayalam",
  "mr-IN": "Marathi", "pa-IN": "Punjabi", "od-IN": "Odia",
};

export default function SarvamVoicePicker({ value, onChange }: { value: VoiceConfig; onChange: (next: VoiceConfig) => void }) {
  const [voices, setVoices] = useState<SarvamVoice[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState<GenderFilter>("all");
  const [previewText, setPreviewText] = useState("Namaste! Main StylMe se bol raha hoon. How can I help you today?");
  const [loadingVoice, setLoadingVoice] = useState("");
  const [playingVoice, setPlayingVoice] = useState("");
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");

  useEffect(() => {
    let active = true;
    void getSarvamVoices()
      .then((catalog) => {
        if (!active) return;
        setVoices(catalog.items);
        setLanguages(catalog.languages);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Sarvam voices could not be loaded.");
      });
    return () => {
      active = false;
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return voices.filter((voice) => (gender === "all" || voice.gender === gender) && (!needle || voice.name.toLowerCase().includes(needle)));
  }, [gender, query, voices]);
  const selected = voices.find((voice) => voice.id === value.speaker);
  const femaleCount = voices.filter((voice) => voice.gender === "female").length;
  const maleCount = voices.filter((voice) => voice.gender === "male").length;

  function stopAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingVoice("");
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = "";
  }

  async function audition(voice: SarvamVoice) {
    if (playingVoice === voice.id && audioRef.current) {
      stopAudio();
      return;
    }
    stopAudio();
    setError("");
    setLoadingVoice(voice.id);
    try {
      const blob = await previewSarvamVoice({
        speaker: voice.id,
        language: value.language === "multi" ? "hi-IN" : value.language,
        text: previewText,
        pace: value.pace,
      });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audioUrlRef.current = url;
      audio.onended = stopAudio;
      audio.onerror = () => { setError("The generated preview could not be played."); stopAudio(); };
      await audio.play();
      setPlayingVoice(voice.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Voice preview failed.");
      stopAudio();
    } finally {
      setLoadingVoice("");
    }
  }

  return <section className="mt-6 overflow-hidden rounded-2xl border border-pink-100 bg-[#fffdfd]">
    <div className="border-b border-pink-100 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-xl bg-pink-600 text-white"><Volume2 className="size-4" /></span><div><h3 className="text-sm font-black text-zinc-950">Voice & delivery</h3><p className="mt-0.5 text-[11px] leading-5 text-zinc-500">Audition the complete Sarvam Bulbul v3 catalog before saving.</p></div></div></div>
        <div className="flex items-center gap-2"><span className="rounded-full border border-pink-100 bg-white px-2.5 py-1 text-[10px] font-black text-pink-700">Sarvam</span><span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 font-mono text-[10px] font-bold text-zinc-500">bulbul:v3</span></div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-[minmax(16rem,1fr)_13rem_10rem]">
        <label className="block md:col-span-2 2xl:col-span-1"><span className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">Preview script</span><textarea value={previewText} onChange={(event) => setPreviewText(event.target.value.slice(0, 500))} rows={2} className="mt-2 w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs leading-5 text-zinc-800 outline-none transition focus:border-pink-400 focus:ring-2 focus:ring-pink-100" /><span className="mt-1 block text-right text-[9px] font-bold text-zinc-400">{previewText.length}/500</span></label>
        <label className="block"><span className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">TTS language</span><select value={value.language} onChange={(event) => onChange({ ...value, language: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-700 outline-none focus:border-pink-400"><option value="multi">Multilingual · Hindi preview</option>{languages.map((code) => <option key={code} value={code}>{languageLabels[code] ?? code}</option>)}</select></label>
        <label className="block"><span className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-500">Pace</span><select value={String(value.pace)} onChange={(event) => onChange({ ...value, pace: Number(event.target.value) })} className="mt-2 h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-700 outline-none focus:border-pink-400">{[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((pace) => <option key={pace} value={pace}>{pace === 1 ? "1.0" : pace}×</option>)}</select></label>
      </div>
    </div>

    <div className="p-4 sm:p-5">
      <div className="flex flex-wrap gap-3">
        <label className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search voices" className="h-10 w-full rounded-xl border border-zinc-200 bg-white pl-9 pr-3 text-xs font-semibold outline-none focus:border-pink-400 focus:ring-2 focus:ring-pink-100" /></label>
        <div className="flex rounded-xl border border-zinc-200 bg-white p-1" role="group" aria-label="Filter voices by gender">{([["all", `All ${voices.length}`], ["female", `Female ${femaleCount}`], ["male", `Male ${maleCount}`]] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setGender(key)} className={`rounded-lg px-3 py-2 text-[10px] font-black transition ${gender === key ? "bg-zinc-950 text-white" : "text-zinc-500 hover:bg-pink-50 hover:text-pink-700"}`}>{label}</button>)}</div>
      </div>

      {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
      <div className="mt-4 max-h-[26rem] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-2">
        {voices.length === 0 && !error ? <div className="grid min-h-40 place-items-center"><div className="text-center"><LoaderCircle className="mx-auto size-5 animate-spin text-pink-600" /><p className="mt-2 text-[11px] text-zinc-500">Loading Sarvam voices…</p></div></div> : filtered.length === 0 ? <div className="grid min-h-40 place-items-center text-xs font-semibold text-zinc-500">No voices match this filter.</div> : <ul className="grid gap-2 md:grid-cols-2">{filtered.map((voice) => {
          const isSelected = voice.id === value.speaker;
          const isPlaying = voice.id === playingVoice;
          const isLoading = voice.id === loadingVoice;
          return <li key={voice.id} className={`flex items-center gap-3 rounded-xl border p-2.5 transition ${isSelected ? "border-pink-300 bg-pink-50" : "border-zinc-100 hover:border-pink-200"}`}>
            <button type="button" onClick={() => void audition(voice)} disabled={!previewText.trim() || Boolean(loadingVoice && !isLoading)} aria-label={`${isPlaying ? "Stop" : "Preview"} ${voice.name}`} className={`grid size-9 shrink-0 place-items-center rounded-full border transition ${isPlaying ? "border-pink-600 bg-pink-600 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-pink-400 hover:text-pink-700"}`}>{isLoading ? <LoaderCircle className="size-4 animate-spin" /> : isPlaying ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}</button>
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"><span className="min-w-0 flex-1"><span className="block truncate text-xs font-black text-zinc-900">{voice.name}</span><span className="mt-0.5 block text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-400">{voice.gender}</span></span><input type="radio" name="sarvam-speaker" value={voice.id} checked={isSelected} onChange={() => onChange({ ...value, speaker: voice.id, ttsModel: "bulbul:v3", ttsProvider: "sarvam" })} className="sr-only" /><span className={`grid size-6 shrink-0 place-items-center rounded-full border ${isSelected ? "border-pink-600 bg-pink-600 text-white" : "border-zinc-300 bg-white"}`}>{isSelected && <Check className="size-3.5 stroke-[3]" />}</span></label>
          </li>;
        })}</ul>}
      </div>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-pink-100 bg-pink-50/60 px-4 py-3 sm:px-5">
      <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-zinc-950 text-white"><Volume2 className="size-4" /></span><div><p className="text-[9px] font-black uppercase tracking-[0.12em] text-pink-600">Selected voice</p><p className="text-sm font-black text-zinc-950">{selected?.name ?? value.speaker}</p></div></div>
      <p className="text-[10px] font-semibold text-zinc-500">{value.language === "multi" ? "Multilingual STT · Hindi TTS fallback" : languageLabels[value.language] ?? value.language} · {value.pace}× pace</p>
    </div>
  </section>;
}
