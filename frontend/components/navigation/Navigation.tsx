import type { AppRole } from '@/types/auth';

export type NavItem = {
  title: string;
  href: string;
  icon: string; // icon name from lucide-react; resolved where used
  roles?: AppRole[];
};

export const navItems: NavItem[] = [
  { title: 'Dashboard', href: '/admin/dashboard', icon: 'Home' },
  { title: 'Products', href: '/admin/products', icon: 'Box' },
  { title: 'New product', href: '/admin/upload', icon: 'UploadCloud' },
  { title: 'Seller approvals', href: '/admin/sellers', icon: 'Users', roles: ['admin', 'owner'] },
  { title: 'Import Progress', href: '/admin/imports', icon: 'Clock', roles: ['admin', 'owner'] },
  { title: 'Rejected Products', href: '/admin/rejected', icon: 'XCircle' },
  { title: 'Taxonomy', href: '/admin/taxonomy', icon: 'Layers', roles: ['admin', 'owner'] },
  { title: 'Checkout recovery', href: '/admin/checkout-recovery', icon: 'PhoneCall', roles: ['admin', 'owner'] },
  { title: 'AI Agents', href: '/admin/agents', icon: 'Bot', roles: ['admin', 'owner'] },
  { title: 'Settings', href: '/admin/settings', icon: 'Settings', roles: ['owner'] },
];
