'use client';

import { LoaderCircle, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/AuthProvider';
import type { AppRole } from '@/types/auth';

export function ProtectedRoute({ children, roles = ['seller', 'admin', 'owner'] }: { children: ReactNode; roles?: AppRole[] }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const allowed = Boolean(user?.roles.some((role) => roles.includes(role)));

  useEffect(() => {
    if (!isLoading && !user) router.replace(`/login?next=${encodeURIComponent(pathname || '/admin/dashboard')}`);
  }, [isLoading, pathname, router, user]);

  if (isLoading || !user) {
    return <div className="grid min-h-dvh place-items-center bg-pink-50/40"><LoaderCircle className="size-7 animate-spin text-primary" aria-label="Checking session" /></div>;
  }
  if (!allowed) {
    return (
      <main className="grid min-h-dvh place-items-center bg-pink-50/40 p-6">
        <section className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm">
          <ShieldAlert className="mx-auto size-10 text-primary" />
          <h1 className="mt-4 font-heading text-2xl font-semibold">Access restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your account does not have permission to open this workspace.</p>
          <Link href="/" className={cn(buttonVariants(), 'mt-5')}>Return to StylMe</Link>
        </section>
      </main>
    );
  }
  if (user.roles.includes('seller') && user.sellerStatus && user.sellerStatus !== 'approved') {
    router.replace('/seller/status');
    return null;
  }
  return children;
}
