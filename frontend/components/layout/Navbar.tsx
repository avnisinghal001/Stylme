'use client';

import { FC, useState } from 'react';
import { Bell, Search, ChevronDown, Menu, LogOut, Store } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/common/Avatar';
import Breadcrumb from '@/components/common/Breadcrumb';
import { useAuth } from '@/providers/AuthProvider';

type Props = {
  title?: string;
  breadcrumbItems?: { href: string; label: string }[];
  onMenuToggle?: () => void;
};

export const Navbar: FC<Props> = ({ title, breadcrumbItems = [], onMenuToggle }) => {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const router = useRouter();

  const signOut = () => {
    logout();
    router.replace('/login');
  };

  return (
    <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-4">
              <button
                aria-label="Open navigation menu"
                className="rounded-md p-2 text-gray-600 hover:bg-gray-100 md:hidden"
                onClick={onMenuToggle}
              >
                <Menu className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
                {breadcrumbItems.length > 0 && <div className="mt-1"><Breadcrumb items={breadcrumbItems} /></div>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center rounded-md border border-gray-100 bg-white px-3 py-1 shadow-sm xl:flex">
              <Search className="w-4 h-4 text-gray-400" />
              <input aria-label="Search" placeholder="Search" className="ml-2 outline-none text-sm text-gray-700" />
            </div>

            <button aria-label="Notifications" className="p-2 rounded hover:bg-gray-50">
              <Bell className="w-5 h-5 text-gray-600" />
            </button>

            <div className="relative">
              <button onClick={() => setOpen(s => !s)} className="flex items-center gap-2 p-1 rounded hover:bg-gray-50">
                <Avatar name={user?.fullName ?? 'StylMe user'} />
                <span className="hidden text-sm text-gray-700 sm:block">{user?.fullName?.split(' ')[0] ?? 'Account'}</span>
                <ChevronDown className="w-4 h-4 text-gray-500" />
              </button>

              {open && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-100 rounded-md shadow-lg py-2 z-40">
                  <p className="border-b px-4 pb-2 text-xs text-muted-foreground">{user?.email}</p>
                  <Link className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-pink-50" href="/"><Store className="size-4" />Storefront</Link>
                  {user?.roles.includes('owner') && <Link className="block px-4 py-2 text-sm text-gray-700 hover:bg-pink-50" href="/admin/settings">Settings</Link>}
                  <button type="button" onClick={signOut} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"><LogOut className="size-4" />Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
