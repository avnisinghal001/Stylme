'use client';

import { FC } from 'react';
import { User } from 'lucide-react';

type Props = { name?: string };

export const Avatar: FC<Props> = ({ name }) => {
  const initials = name ? name.split(' ').map(s => s[0]).slice(0,2).join('') : '';
  return (
    <div className="w-9 h-9 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center font-medium">
      {initials || <User className="w-4 h-4" />}
    </div>
  );
};

export default Avatar;
