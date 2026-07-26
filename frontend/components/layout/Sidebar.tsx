'use client';

import { ElementType, FC } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Box,
  UploadCloud,
  Clock,
  XCircle,
  Layers,
  Sparkles,
  Settings as SettingsIcon,
  Users,
  PhoneCall,
  Bot,
} from 'lucide-react';
import { navItems } from '@/components/navigation/Navigation';
import { useAuth } from '@/providers/AuthProvider';

const iconMap: Record<string, ElementType<{ className?: string }>> = {
  Home,
  Box,
  UploadCloud,
  Clock,
  XCircle,
  Layers,
  Users,
  PhoneCall,
  Bot,
  Settings: SettingsIcon
};

type SidebarProps = {
  mobileOpen: boolean;
  onNavigate: () => void;
};

export const Sidebar: FC<SidebarProps> = ({ mobileOpen, onNavigate }) => {
  const pathname = usePathname() || '';
  const { user } = useAuth();

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-64 flex-col border-r border-gray-200 bg-white shadow-sm transition-transform duration-200 md:translate-x-0 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between border-b border-pink-100 p-4">
        <div className="flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-xl bg-primary text-white shadow-sm"><Sparkles className="size-4" /></div>
          <div><div className="font-heading text-sm font-semibold text-gray-900">StylMe</div><div className="text-[11px] text-gray-500">Operations workspace</div></div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-1">
          {navItems.filter((item) => !item.roles || user?.roles.some((role) => item.roles?.includes(role))).map(item => {
            const Icon = iconMap[item.icon as keyof typeof iconMap] || Home;
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} onClick={onNavigate} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-gray-50 ${active ? 'bg-pink-50 text-pink-700' : ''}`}>
                  <Icon className={`w-5 h-5 ${active ? 'text-[#FF3F6C]' : 'text-gray-500 group-hover:text-[#FF3F6C]'}`} />
                  <span className={`text-sm ${active ? 'font-medium text-gray-900' : 'text-gray-700'}`}>{item.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-pink-100 p-4">
        <div className="text-xs text-gray-500">SwoopStyl · local-first fashion</div>
      </div>
    </aside>
  );
};

export default Sidebar;
