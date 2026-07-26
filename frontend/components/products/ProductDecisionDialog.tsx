'use client';

import { Check, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import type { ProductReviewDecision } from '@/services/product.service';
import type { Product } from '@/types/product';

interface ProductDecisionDialogProps {
  product: Product;
  decision: ProductReviewDecision;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
}

export function ProductDecisionDialog({
  product,
  decision,
  busy = false,
  error = '',
  onClose,
  onConfirm,
}: ProductDecisionDialogProps) {
  const [reason, setReason] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  const isApproval = decision === 'approved';
  const canSubmit = isApproval || reason.trim().length >= 3;

  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) onCloseRef.current();
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]') ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSubmit && !busy) onConfirm(isApproval ? undefined : reason.trim());
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[2px]" onMouseDown={() => !busy && onClose()}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-decision-title"
        aria-describedby="product-decision-description"
        className="w-full max-w-lg rounded-2xl border bg-background p-6 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form onSubmit={submit}>
          <div className="flex items-start gap-4">
            <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${isApproval ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {isApproval ? <Check className="size-5" /> : <X className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="product-decision-title" className="text-lg font-semibold">
                {isApproval ? 'Approve this product?' : 'Reject this product?'}
              </h2>
              <p id="product-decision-description" className="mt-1 text-sm leading-6 text-muted-foreground">
                {isApproval
                  ? 'Approval publishes the product and its seller offer to the customer catalogue.'
                  : 'The seller will see your reason and can update the draft before resubmitting it.'}
              </p>
            </div>
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close decision dialog" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50">
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-5 rounded-xl border bg-muted/35 px-4 py-3">
            <p className="font-medium text-foreground">{product.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{product.brand} · {product.id}</p>
          </div>

          {!isApproval && (
            <label className="mt-5 block text-sm font-medium">
              Reason for rejection
              <textarea
                autoFocus
                required
                minLength={3}
                maxLength={1000}
                rows={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain exactly what the seller needs to fix…"
                className="mt-2 w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="mt-1.5 block text-xs font-normal text-muted-foreground">{reason.trim().length}/1000 characters · minimum 3</span>
            </label>
          )}

          {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button
              type="submit"
              variant={isApproval ? 'default' : 'destructive'}
              autoFocus={isApproval}
              disabled={!canSubmit || busy}
              className={isApproval ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : isApproval ? <Check /> : <X />}
              {busy ? (isApproval ? 'Publishing…' : 'Rejecting…') : (isApproval ? 'Approve & publish' : 'Reject product')}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
