"use client";

import { Eye, EyeOff, LoaderCircle, Sparkles, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useAuth } from "@/providers/AuthProvider";

export default function SignupPage() {
  const router = useRouter();
  const { signup } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await signup(fullName, email, phone, password); router.replace("/account/onboarding"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Account creation failed."); }
    finally { setBusy(false); }
  };
  return <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#fff8fa] px-5 py-10"><div className="absolute -left-24 top-0 size-80 rounded-full bg-pink-200/55 blur-3xl" /><div className="absolute -right-24 bottom-0 size-96 rounded-full bg-orange-100/65 blur-3xl" /><form onSubmit={submit} className="relative w-full max-w-lg rounded-[2rem] border border-pink-100 bg-white/90 p-7 shadow-[0_28px_90px_-40px_rgba(225,29,72,.4)] backdrop-blur sm:p-10"><Link href="/" className="inline-flex items-center gap-2 text-xl font-black"><span className="grid size-9 place-items-center rounded-full bg-pink-600 text-white"><Sparkles className="size-4" /></span>StylMe</Link><span className="mt-8 grid size-12 place-items-center rounded-2xl bg-pink-50 text-pink-600"><UserRoundPlus /></span><h1 className="mt-5 text-3xl font-black tracking-tight">Create your style profile</h1><p className="mt-2 text-sm leading-6 text-zinc-500">Shop normally now; optional fit and appearance onboarding comes next and stays under your control.</p><label className="mt-7 block text-sm font-bold">Full name<input required minLength={2} maxLength={120} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3 outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-100" /></label><label className="mt-4 block text-sm font-bold">Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3 outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-100" /></label><label className="mt-4 block text-sm font-bold">Phone<input required type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3 outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-100" /></label><p className="mt-2 text-xs text-zinc-400">Used for order and optional abandoned-cart recovery. Stored once in E.164 format.</p><label className="mt-4 block text-sm font-bold">Password<span className="relative mt-2 block"><input required minLength={8} maxLength={128} type={visible ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-xl border px-3 pr-11 outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-100" /><button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-zinc-400">{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></span></label><p className="mt-2 text-xs text-zinc-400">Use at least 8 characters. Your password is hashed before storage.</p>{error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<button disabled={busy} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-pink-600 text-sm font-black text-white transition hover:bg-pink-700 disabled:opacity-60">{busy && <LoaderCircle className="size-4 animate-spin" />}{busy ? "Creating account…" : "Create account"}</button><p className="mt-6 text-center text-sm text-zinc-500">Already have an account? <Link href="/login" className="font-bold text-pink-700">Sign in</Link></p></form></main>;
}
