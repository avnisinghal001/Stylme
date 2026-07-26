'use client';

import { FC, ReactNode } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export const PageHeader: FC<Props> = ({ title, subtitle, actions }) => {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="mt-1">{actions}</div>}
    </div>
  );
};

export default PageHeader;
