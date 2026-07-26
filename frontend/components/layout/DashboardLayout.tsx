'use client';

import { FC, PropsWithChildren, useState } from 'react';
import Sidebar from './Sidebar';
import Navbar from './Navbar';
import { navItems } from '@/components/navigation/Navigation';
import { usePathname } from 'next/navigation';

export const DashboardLayout: FC<PropsWithChildren<Record<string, unknown>>> = ({ children }) => {
  const pathname = usePathname() || '';
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Determine title from nav items
  const active = navItems.find(n => pathname.startsWith(n.href));
  const title = active?.title ?? 'Admin';
  const isDashboardHome = pathname === '/admin/dashboard';

  // build breadcrumb items
  const segments = pathname.replace(/^\/|\/$/g, '').split('/');
  const crumbs = segments.reduce<{ href: string; label: string }[]>((acc, seg, idx) => {
    const href = '/' + segments.slice(0, idx + 1).join('/');
    acc.push({ href, label: seg.charAt(0).toUpperCase() + seg.slice(1) });
    return acc;
  }, []);

  return (
    <div className="flex min-h-dvh bg-gray-50">
      <Sidebar
        mobileOpen={mobileSidebarOpen}
        onNavigate={() => setMobileSidebarOpen(false)}
      />

      {mobileSidebarOpen && (
        <button
          aria-label="Close navigation menu"
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <div className="min-w-0 flex-1 md:ml-64">
        <Navbar
          title={title}
          breadcrumbItems={crumbs}
          onMenuToggle={() => setMobileSidebarOpen(true)}
        />

        <main className="p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl">
            {isDashboardHome ? children : (
              <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
                {children}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
