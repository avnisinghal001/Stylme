const reasonStyles = {
  'Missing image': 'bg-amber-50 text-amber-700 ring-amber-600/20',
  'Invalid category': 'bg-violet-50 text-violet-700 ring-violet-600/20',
  'Incomplete attributes': 'bg-rose-50 text-rose-700 ring-rose-600/20',
  'Duplicate product': 'bg-sky-50 text-sky-700 ring-sky-600/20',
} as const satisfies Record<string, string>;

export type RejectionReason = string;

export function RejectionReasonBadge({ reason }: { reason: RejectionReason }) {
  const style = reasonStyles[reason as keyof typeof reasonStyles] ?? 'bg-rose-50 text-rose-700 ring-rose-600/20';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${style}`}>
      {reason}
    </span>
  );
}
