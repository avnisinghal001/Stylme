'use client';

import { ArrowLeft, LoaderCircle, MapPin, Store } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { applyAsSeller } from '@/lib/api/client';

const initialForm = { fullName: '', displayName: '', brandName: '', email: '', phone: '', password: '', addressLine: '', pincode: '' };

export default function SellerApplicationPage() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await applyAsSeller(form);
      router.push('/login?seller=applied');
    } catch (applicationError) {
      setError(applicationError instanceof Error ? applicationError.message : 'Application failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const field = (key: keyof typeof form, label: string, options: { type?: string; placeholder?: string; required?: boolean; maxLength?: number } = {}) => (
    <label className="block text-sm font-medium">{label}<input type={options.type ?? 'text'} required={options.required ?? true} maxLength={options.maxLength} value={form[key]} onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))} placeholder={options.placeholder} className="mt-2 h-11 w-full rounded-xl border px-3 outline-none transition focus:border-primary focus:ring-4 focus:ring-pink-100" /></label>
  );

  return (
    <main className="min-h-dvh bg-[#fff8fa] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl"><Link href="/login" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" />Back to sign in</Link>
        <form onSubmit={submit} className="mt-5 rounded-3xl border border-pink-100 bg-white p-6 shadow-[0_24px_80px_-36px_rgb(225_29_72/0.3)] sm:p-10">
          <span className="grid size-12 place-items-center rounded-2xl bg-pink-50 text-primary"><Store /></span><h1 className="mt-5 font-heading text-3xl font-semibold">Join StylMe as a seller</h1><p className="mt-2 text-sm text-muted-foreground">Create your application and first fulfilment location. An owner or admin must approve it before products can be submitted.</p>
          <div className="mt-7 grid gap-5 sm:grid-cols-2">{field('fullName', 'Your full name')}{field('displayName', 'Store display name')}{field('brandName', 'Primary brand')}{field('email', 'Work email', { type: 'email' })}{field('phone', 'Phone', { type: 'tel', required: false })}{field('password', 'Password', { type: 'password' })}</div>
          <div className="mt-7 rounded-2xl border bg-pink-50/40 p-5"><h2 className="flex items-center gap-2 font-heading font-semibold"><MapPin className="size-4 text-primary" />Primary seller location</h2><div className="mt-4 grid gap-5 sm:grid-cols-[1fr_170px]">{field('addressLine', 'Address')}{field('pincode', 'Pincode', { maxLength: 6 })}</div></div>
          {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" onClick={() => router.push('/login')}>Cancel</Button><Button type="submit" size="lg" className="rounded-xl" disabled={isSubmitting}>{isSubmitting && <LoaderCircle className="animate-spin" />}{isSubmitting ? 'Submitting…' : 'Submit application'}</Button></div>
        </form>
      </div>
    </main>
  );
}
