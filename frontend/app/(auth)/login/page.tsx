'use client';

import { Eye, EyeOff, LoaderCircle, LockKeyhole, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/providers/AuthProvider';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const user = await login(email, password);
      if (user.roles.includes('seller') && user.sellerStatus !== 'approved') router.replace('/seller/status');
      else if (user.roles.some((role) => role === 'owner' || role === 'admin' || role === 'seller')) router.replace('/admin/dashboard');
      else router.replace(user.onboardingCompleted ? '/account/profile' : '/account/onboarding');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="relative grid min-h-dvh overflow-hidden bg-[#fff8fa] px-5 py-10 lg:grid-cols-2 lg:px-10">
      <div className="pointer-events-none absolute -left-20 top-16 size-72 rounded-full bg-pink-200/45 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-8 size-96 rounded-full bg-rose-200/35 blur-3xl" />
      <section className="relative hidden items-center justify-center lg:flex">
        <div className="max-w-lg">
          <Link href="/" className="inline-flex items-center gap-2 font-heading text-2xl font-bold"><span className="grid size-10 place-items-center rounded-full bg-primary text-white"><Sparkles className="size-5" /></span>StylMe</Link>
          <h1 className="mt-10 font-heading text-6xl font-semibold leading-[1.05] tracking-tight">Fashion operations,<br /><span className="text-primary">beautifully simple.</span></h1>
          <p className="mt-6 max-w-md text-lg leading-8 text-muted-foreground">One place to manage your catalogue, sellers and fastest-delivery locations.</p>
        </div>
      </section>
      <section className="relative grid place-items-center">
        <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-pink-100 bg-white/90 p-7 shadow-[0_24px_80px_-32px_rgb(225_29_72/0.35)] backdrop-blur sm:p-10">
          <div className="lg:hidden"><Link href="/" className="inline-flex items-center gap-2 font-heading text-xl font-bold"><Sparkles className="size-5 text-primary" />StylMe</Link></div>
          <div className="mt-7 lg:mt-0"><span className="grid size-11 place-items-center rounded-2xl bg-pink-50 text-primary"><LockKeyhole /></span><h2 className="mt-5 font-heading text-3xl font-semibold">Welcome back</h2><p className="mt-2 text-sm text-muted-foreground">Sign in to shop, manage your style profile, or open your seller workspace.</p></div>
          <label className="mt-7 block text-sm font-medium">Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-white px-3 outline-none transition focus:border-primary focus:ring-4 focus:ring-pink-100" placeholder="you@stylme.in" /></label>
          <label className="mt-4 block text-sm font-medium">Password<span className="relative mt-2 block"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-xl border bg-white px-3 pr-11 outline-none transition focus:border-primary focus:ring-4 focus:ring-pink-100" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground" aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></span></label>
          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" className="mt-6 h-11 w-full rounded-xl" disabled={isSubmitting}>{isSubmitting && <LoaderCircle className="animate-spin" />}{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
          <p className="mt-6 text-center text-sm text-muted-foreground">New to StylMe? <Link href="/signup" className="font-medium text-primary hover:underline">Create a shopper account</Link></p><p className="mt-2 text-center text-xs text-muted-foreground">Want to sell? <Link href="/seller/apply" className="font-medium text-primary hover:underline">Apply as a seller</Link></p>
        </form>
      </section>
    </main>
  );
}
