'use client';

import { CircleCheck, Clock3, LogOut, ShieldX, Store } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';

export default function SellerStatusPage() {
  const { user, isLoading, logout } = useAuth();
  const status = user?.sellerStatus ?? 'pending';
  const Icon = status === 'approved' ? CircleCheck : status === 'rejected' ? ShieldX : Clock3;
  return (
    <main className="grid min-h-dvh place-items-center bg-[#fff8fa] p-6"><section className="w-full max-w-lg rounded-3xl border border-pink-100 bg-white p-8 text-center shadow-sm sm:p-10"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-pink-50 text-primary"><Icon className="size-7" /></span><p className="mt-5 text-sm font-medium uppercase tracking-[0.2em] text-primary">Seller application</p><h1 className="mt-2 font-heading text-3xl font-semibold capitalize">{isLoading ? 'Checking status…' : status}</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{status === 'approved' ? 'Your store is approved. You can now manage products, brands and locations.' : status === 'rejected' ? 'Your application was not approved. Contact the StylMe owner before submitting again.' : 'Your details are safe. An owner or admin will review your application before workspace access is enabled.'}</p><div className="mt-7 flex justify-center gap-3">{status === 'approved' && <Link href="/admin/dashboard" className={cn(buttonVariants(), 'h-10 rounded-xl px-4')}><Store />Open workspace</Link>}<button type="button" onClick={logout} className={cn(buttonVariants({ variant: 'outline' }), 'h-10 rounded-xl px-4')}><LogOut />Sign out</button></div><Link href="/" className="mt-6 inline-block text-sm text-muted-foreground hover:text-primary">Return to storefront</Link></section></main>
  );
}
