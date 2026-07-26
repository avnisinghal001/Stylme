'use client';

import Link from 'next/link';
import { FC } from 'react';

type Crumb = { href: string; label: string };

type Props = { items: Crumb[] };

export const Breadcrumb: FC<Props> = ({ items }) => {
  return (
    <nav className="text-sm text-gray-500" aria-label="Breadcrumb">
      <ol className="flex items-center gap-2">
        {items.map((it, idx) => (
          <li key={it.href} className="flex items-center">
            <Link href={it.href} className={`hover:text-pink-600 ${idx === items.length - 1 ? 'text-gray-800 font-medium' : ''}`}>
              {it.label}
            </Link>
            {idx < items.length - 1 && <span className="mx-2 text-gray-300">/</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
};

export default Breadcrumb;
