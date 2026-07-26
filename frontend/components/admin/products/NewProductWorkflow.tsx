'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, LoaderCircle, Plus, Send, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';

import { NewProductImageUploader } from '@/components/upload/NewProductImageUploader';
import { Button } from '@/components/ui/button';
import { getProductTaxonomy, primeProductTaxonomy } from '@/lib/ai/metadata-taxonomy';
import { getProductDraftOptions, submitProductDraft } from '@/lib/ai/python-api';
import { generateOneShotProductProposal, saveInitialProductDraft, submitReviewedProductWorkflow } from '@/lib/ai/product-workflow';
import type {
  ProcessedProductImage,
  ProductAiResult,
  ProductDraftOptions,
  ProductTaxonomyContract,
  ProductVariantEditor,
  ProductWorkflowContext,
} from '@/types/product-workflow';

const EMPTY_CONTEXT: ProductWorkflowContext = { title: '', brand: '', description: '', categoryHint: '' };
const fieldClass = 'mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60';

interface ListingState {
  sellerId: string;
  brandId: string;
  categoryKey: string;
  productTypeKey: string;
  genderKeys: string[];
  mrpRupees: string;
  salePriceRupees: string;
}

const EMPTY_LISTING: ListingState = {
  sellerId: '', brandId: '', categoryKey: '', productTypeKey: '', genderKeys: [], mrpRupees: '', salePriceRupees: '',
};

const newVariant = (clientId = 'variant-1'): ProductVariantEditor => ({
  clientId,
  sku: '',
  sizeKey: 'one-size',
  colorId: '',
  locationId: '',
  availableQty: 0,
  fitApplicable: false,
  minHeightCm: null,
  maxHeightCm: null,
  minWeightKg: null,
  maxWeightKg: null,
  ageApplicable: false,
  minAge: null,
  maxAge: null,
});

export function NewProductWorkflow({ accessToken }: { accessToken?: string }) {
  const [context, setContext] = useState<ProductWorkflowContext>(EMPTY_CONTEXT);
  const [listing, setListing] = useState<ListingState>(EMPTY_LISTING);
  const [variants, setVariants] = useState<ProductVariantEditor[]>([newVariant()]);
  const [images, setImages] = useState<ProcessedProductImage[]>([]);
  const [taxonomy, setTaxonomy] = useState<ProductTaxonomyContract | null>(null);
  const [options, setOptions] = useState<ProductDraftOptions | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [ai, setAi] = useState<ProductAiResult | null>(null);
  const [reviewAccepted, setReviewAccepted] = useState(false);
  const [stage, setStage] = useState<'loading' | 'idle' | 'drafting' | 'generating' | 'submitting' | 'submitted'>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([getProductTaxonomy(accessToken), getProductDraftOptions(accessToken)])
      .then(([nextTaxonomy, nextOptions]) => {
        if (!active) return;
        if (nextTaxonomy.source === 'fallback' && nextOptions.taxonomy) {
          nextTaxonomy = nextOptions.taxonomy;
          primeProductTaxonomy(nextTaxonomy);
        }
        const seller = nextOptions.sellers[0];
        const brand = seller?.brandIds?.length
          ? nextOptions.brands.find((item) => seller.brandIds?.includes(item.id))
          : nextOptions.brands[0];
        const location = nextOptions.locations.find((item) => !seller || item.sellerId === seller.id) ?? nextOptions.locations[0];
        const colour = nextOptions.colors[0];
        setTaxonomy(nextTaxonomy);
        setOptions(nextOptions);
        setListing({
          ...EMPTY_LISTING,
          sellerId: seller?.id ?? '',
          brandId: brand?.id ?? '',
          categoryKey: nextTaxonomy.options.category[0] ?? '',
          productTypeKey: nextTaxonomy.options.product_type[0] ?? '',
        });
        setContext((current) => ({ ...current, brand: brand?.name ?? '', categoryHint: nextTaxonomy.options.category[0] ?? '' }));
        setVariants([{ ...newVariant(), sizeKey: nextOptions.sizes[0] ?? 'one-size', colorId: colour?.id ?? '', locationId: location?.id ?? '' }]);
        setStage('idle');
      })
      .catch((error) => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : 'Product form options could not be loaded.');
        setStage('idle');
      });
    return () => { active = false; };
  }, [accessToken]);

  const invalidateProposal = () => {
    setAi(null);
    setReviewAccepted(false);
    setNotice(null);
  };

  const updateContext = (key: keyof ProductWorkflowContext, value: string) => {
    setContext((current) => ({ ...current, [key]: value }));
    invalidateProposal();
  };

  const updateListing = <K extends keyof ListingState>(key: K, value: ListingState[K]) => {
    setListing((current) => ({ ...current, [key]: value }));
    invalidateProposal();
  };

  const availableBrands = options?.brands.filter((brand) => {
    const seller = options.sellers.find((item) => item.id === listing.sellerId);
    return !seller?.brandIds?.length || seller.brandIds.includes(brand.id);
  }) ?? [];
  const availableLocations = options?.locations.filter((location) => !listing.sellerId || location.sellerId === listing.sellerId) ?? [];

  const selectSeller = (sellerId: string) => {
    if (!options) return;
    const seller = options.sellers.find((item) => item.id === sellerId);
    const brand = seller?.brandIds?.length ? options.brands.find((item) => seller.brandIds?.includes(item.id)) : options.brands[0];
    const location = options.locations.find((item) => item.sellerId === sellerId);
    setListing((current) => ({ ...current, sellerId, brandId: brand?.id ?? '' }));
    setContext((current) => ({ ...current, brand: brand?.name ?? '' }));
    setVariants((current) => current.map((variant) => ({ ...variant, locationId: location?.id ?? '' })));
    invalidateProposal();
  };

  const selectBrand = (brandId: string) => {
    updateListing('brandId', brandId);
    setContext((current) => ({ ...current, brand: options?.brands.find((brand) => brand.id === brandId)?.name ?? '' }));
  };

  const selectClassification = (key: 'categoryKey' | 'productTypeKey', value: string) => {
    updateListing(key, value);
    const category = key === 'categoryKey' ? value : listing.categoryKey;
    const productType = key === 'productTypeKey' ? value : listing.productTypeKey;
    setContext((current) => ({ ...current, categoryHint: `${category}${productType ? ` / ${productType}` : ''}` }));
  };

  const updateVariant = <K extends keyof ProductVariantEditor>(index: number, key: K, value: ProductVariantEditor[K]) => {
    setVariants((current) => current.map((variant, variantIndex) => variantIndex === index ? { ...variant, [key]: value } : variant));
    invalidateProposal();
  };

  const validationError = () => {
    if (!options || !taxonomy) return 'Product options are still loading.';
    if (!listing.sellerId || !listing.brandId) return 'Choose an approved seller and managed brand.';
    if (context.title.trim().length < 3) return 'Enter a product title of at least 3 characters.';
    if (context.description.trim().length < 10) return 'Enter a product description of at least 10 characters.';
    if (!listing.categoryKey || !listing.productTypeKey || !listing.genderKeys.length) return 'Complete category, product type, and gender classification.';
    if (!images.length) return 'Upload at least one product image.';
    const mrp = Number(listing.mrpRupees);
    const sale = Number(listing.salePriceRupees);
    if (!Number.isFinite(mrp) || !Number.isFinite(sale) || mrp < 0 || sale < 0 || sale > mrp) return 'Enter valid INR prices with sale price not above MRP.';
    if (!variants.length || variants.some((variant) => !variant.sku.trim() || !variant.sizeKey || !variant.colorId || !variant.locationId || variant.availableQty < 0)) return 'Every variant needs SKU, size, colour, fulfilment location, and non-negative stock.';
    if (variants.some((variant) => variant.fitApplicable && [variant.minHeightCm, variant.maxHeightCm, variant.minWeightKg, variant.maxWeightKg].some((value) => value === null))) return 'Complete all height and weight bounds for personalized-fit variants.';
    if (variants.some((variant) => variant.fitApplicable && ((variant.minHeightCm ?? 0) > (variant.maxHeightCm ?? 0) || (variant.minWeightKg ?? 0) > (variant.maxWeightKg ?? 0)))) return 'Variant fit minimums cannot exceed their maximums.';
    if (variants.some((variant) => variant.ageApplicable && [variant.minAge, variant.maxAge].some((value) => value === null))) return 'Complete both age bounds for age-targeted variants.';
    if (variants.some((variant) => variant.ageApplicable && (variant.minAge ?? 0) > (variant.maxAge ?? 0))) return 'Variant minimum age cannot exceed maximum age.';
    if (new Set(variants.map((variant) => variant.sku.trim().toLowerCase())).size !== variants.length) return 'Variant SKUs must be unique.';
    return null;
  };

  const generate = async () => {
    if (stage !== 'idle' || !options) return;
    const invalid = validationError();
    if (invalid) { setNotice(invalid); return; }
    setStage('drafting');
    setNotice(null);
    try {
      const saved = await saveInitialProductDraft({
        draftId,
        context,
        images,
        sellerId: listing.sellerId,
        brandId: listing.brandId,
        categoryKey: listing.categoryKey,
        productTypeKey: listing.productTypeKey,
        genderKeys: listing.genderKeys,
        mrpPaise: Math.round(Number(listing.mrpRupees) * 100),
        salePricePaise: Math.round(Number(listing.salePriceRupees) * 100),
        variants,
        accessToken,
      });
      setDraftId(saved.draftId);
      setStage('generating');
      const result = await generateOneShotProductProposal({
        context,
        images,
        draftId: saved.draftId,
        contractVersion: options.contractVersion,
        accessToken,
      });
      setAi(result);
      setNotice('One-shot AI proposal generated. Review every field before submitting.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Product draft or AI processing failed.');
    } finally {
      setStage((current) => current === 'submitted' ? current : 'idle');
    }
  };

  const submit = async () => {
    if (!draftId || !ai || !reviewAccepted || stage !== 'idle') return;
    setStage('submitting');
    setNotice(null);
    try {
      const result = await submitReviewedProductWorkflow({ draftId, ai, accessToken });
      setNotice(`Product draft ${result.draftId} submitted with status “${result.status}”.`);
      setStage('submitted');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Product submission failed.');
      setStage('idle');
    }
  };

  const submitManualDraft = async () => {
    if (!draftId || ai || stage !== 'idle') return;
    setStage('submitting');
    setNotice(null);
    try {
      const result = await submitProductDraft(draftId, accessToken);
      setNotice(`Manual product draft ${result.draftId} submitted with status “${result.status}”.`);
      setStage('submitted');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Manual draft submission failed.');
      setStage('idle');
    }
  };

  if (stage === 'loading') return <section className="rounded-xl border bg-card p-8 text-sm text-muted-foreground"><LoaderCircle className="mr-2 inline size-4 animate-spin" />Loading Mongo-controlled product options…</section>;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <section className="rounded-xl border bg-card p-5">
          <div><h2 className="text-base font-semibold">1. Seller and listing</h2><p className="mt-1 text-sm text-muted-foreground">The initial valid draft is reserved before the single AI workflow begins.</p></div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <SelectField label="Approved seller" value={listing.sellerId} onChange={selectSeller} disabled={Boolean(draftId) || stage !== 'idle'} options={options?.sellers.map((item) => ({ value: item.id, label: item.name })) ?? []} />
            <SelectField label="Managed brand" value={listing.brandId} onChange={selectBrand} disabled={stage !== 'idle'} options={availableBrands.map((item) => ({ value: item.id, label: item.name }))} />
            <label className="text-sm font-medium sm:col-span-2">Product title<input className={fieldClass} value={context.title} maxLength={300} disabled={stage !== 'idle'} onChange={(event) => updateContext('title', event.target.value)} placeholder="Floral wrap midi dress" /></label>
            <label className="text-sm font-medium sm:col-span-2">Description<textarea className={`${fieldClass} min-h-28 resize-y`} value={context.description} maxLength={20000} disabled={stage !== 'idle'} onChange={(event) => updateContext('description', event.target.value)} placeholder="Seller-confirmed fabric, fit, construction, and care details" /></label>
            <SelectField label="Category" value={listing.categoryKey} onChange={(value) => selectClassification('categoryKey', value)} disabled={stage !== 'idle'} options={(taxonomy?.options.category ?? []).map((value) => ({ value, label: value }))} />
            <SelectField label="Product type" value={listing.productTypeKey} onChange={(value) => selectClassification('productTypeKey', value)} disabled={stage !== 'idle'} options={(taxonomy?.options.product_type ?? []).map((value) => ({ value, label: value }))} />
            <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Gender</legend><div className="mt-2 flex flex-wrap gap-2">{(taxonomy?.options.gender ?? []).map((gender) => <label key={gender} className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm"><input type="checkbox" checked={listing.genderKeys.includes(gender)} disabled={stage !== 'idle'} onChange={(event) => updateListing('genderKeys', event.target.checked ? [...listing.genderKeys, gender] : listing.genderKeys.filter((value) => value !== gender))} />{gender}</label>)}</div></fieldset>
            <label className="text-sm font-medium">MRP (₹)<input type="number" min="0" step="0.01" className={fieldClass} value={listing.mrpRupees} disabled={stage !== 'idle'} onChange={(event) => updateListing('mrpRupees', event.target.value)} /></label>
            <label className="text-sm font-medium">Sale price (₹)<input type="number" min="0" step="0.01" className={fieldClass} value={listing.salePriceRupees} disabled={stage !== 'idle'} onChange={(event) => updateListing('salePriceRupees', event.target.value)} /></label>
          </div>
        </section>

        <NewProductImageUploader value={images} onChange={(next) => { setImages(next); invalidateProposal(); }} disabled={stage !== 'idle'} />

        <section className="rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">2. Variants and inventory</h2><p className="mt-1 text-sm text-muted-foreground">Each SKU is tied to a controlled colour and active seller fulfilment location.</p></div><Button variant="outline" size="sm" disabled={stage !== 'idle' || variants.length >= 20} onClick={() => setVariants((current) => [...current, { ...newVariant(`variant-${crypto.randomUUID()}`), sizeKey: options?.sizes[0] ?? 'one-size', colorId: options?.colors[0]?.id ?? '', locationId: availableLocations[0]?.id ?? '' }])}><Plus />Add variant</Button></div>
          <div className="mt-4 space-y-3">{variants.map((variant, index) => <div key={variant.clientId} className="rounded-lg border bg-muted/10 p-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><label className="text-xs font-medium">SKU<input className={fieldClass} value={variant.sku} maxLength={160} disabled={stage !== 'idle'} onChange={(event) => updateVariant(index, 'sku', event.target.value)} /></label><SelectField label="Size" value={variant.sizeKey} onChange={(value) => updateVariant(index, 'sizeKey', value)} disabled={stage !== 'idle'} options={(options?.sizes ?? []).map((value) => ({ value, label: value }))} compact /><SelectField label="Colour" value={variant.colorId} onChange={(value) => updateVariant(index, 'colorId', value)} disabled={stage !== 'idle'} options={(options?.colors ?? []).map((item) => ({ value: item.id, label: `${item.name}${item.hex ? ` · ${item.hex}` : ''}` }))} compact /><SelectField label="Location" value={variant.locationId} onChange={(value) => updateVariant(index, 'locationId', value)} disabled={stage !== 'idle'} options={availableLocations.map((item) => ({ value: item.id, label: `${item.name}${item.pincode ? ` · ${item.pincode}` : ''}` }))} compact /><div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-xs font-medium">Stock<input type="number" min="0" step="1" className={fieldClass} value={variant.availableQty} disabled={stage !== 'idle'} onChange={(event) => updateVariant(index, 'availableQty', Math.max(0, Number(event.target.value) || 0))} /></label><Button variant="ghost" size="icon-sm" aria-label="Remove variant" disabled={stage !== 'idle' || variants.length === 1} onClick={() => { setVariants((current) => current.filter((_, itemIndex) => itemIndex !== index)); invalidateProposal(); }}><Trash2 /></Button></div></div><div className="mt-3 flex flex-wrap gap-4"><label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={variant.fitApplicable} disabled={stage !== 'idle'} onChange={(event) => updateVariant(index, 'fitApplicable', event.target.checked)} />Use height/weight personalization</label><label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={variant.ageApplicable} disabled={stage !== 'idle'} onChange={(event) => updateVariant(index, 'ageApplicable', event.target.checked)} />Target an age range</label></div>{variant.fitApplicable && <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><FitNumber label="Min height (cm)" value={variant.minHeightCm} onChange={(value) => updateVariant(index, 'minHeightCm', value)} disabled={stage !== 'idle'} min={40} max={260} /><FitNumber label="Max height (cm)" value={variant.maxHeightCm} onChange={(value) => updateVariant(index, 'maxHeightCm', value)} disabled={stage !== 'idle'} min={40} max={260} /><FitNumber label="Min weight (kg)" value={variant.minWeightKg} onChange={(value) => updateVariant(index, 'minWeightKg', value)} disabled={stage !== 'idle'} min={2} max={400} /><FitNumber label="Max weight (kg)" value={variant.maxWeightKg} onChange={(value) => updateVariant(index, 'maxWeightKg', value)} disabled={stage !== 'idle'} min={2} max={400} /></div>}{variant.ageApplicable && <div className="mt-3 grid gap-3 sm:grid-cols-2"><FitNumber label="Min age" value={variant.minAge} onChange={(value) => updateVariant(index, 'minAge', value)} disabled={stage !== 'idle'} min={0} max={110} /><FitNumber label="Max age" value={variant.maxAge} onChange={(value) => updateVariant(index, 'maxAge', value)} disabled={stage !== 'idle'} min={0} max={110} /></div>}</div>)}</div>
        </section>

        {ai && <AiReview result={ai} />}
      </div>

      <aside className="h-fit space-y-4 xl:sticky xl:top-24">
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-base font-semibold">Generate and review</h2>
          <ol className="mt-4 space-y-3 text-sm"><WorkflowStep done={images.length > 0} label={`${images.length || 'No'} hosted image${images.length === 1 ? '' : 's'}`} /><WorkflowStep done={Boolean(draftId)} label={draftId ? `Draft ${draftId.slice(-6)} reserved` : 'Valid draft pending'} /><WorkflowStep done={Boolean(ai)} label={ai ? 'AI proposal completed once' : 'AI proposal pending'} /><WorkflowStep done={reviewAccepted} label="Human review accepted" /></ol>
          <Button className="mt-5 w-full" onClick={generate} disabled={Boolean(ai) || stage !== 'idle'}>{stage === 'drafting' || stage === 'generating' ? <LoaderCircle className="animate-spin" /> : <Sparkles />}{stage === 'drafting' ? 'Saving valid draft…' : stage === 'generating' ? 'Processing once…' : ai ? 'AI processing complete' : 'Save draft and process once'}</Button>
          {ai && <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/20 p-3 text-sm"><input type="checkbox" className="mt-1 size-4 accent-pink-600" checked={reviewAccepted} onChange={(event) => setReviewAccepted(event.target.checked)} disabled={stage !== 'idle'} /><span><span className="font-medium">I reviewed the generated product</span><span className="mt-1 block text-xs text-muted-foreground">Only ImgBB URLs, hashes, canonical offer data, and approved taxonomy JSON are committed.</span></span></label>}
          <Button className="mt-3 w-full" variant={reviewAccepted ? 'default' : 'outline'} onClick={submit} disabled={!ai || !reviewAccepted || stage !== 'idle'}>{stage === 'submitting' ? <LoaderCircle className="animate-spin" /> : <Send />}{stage === 'submitting' ? 'Applying and submitting…' : 'Apply AI and submit draft'}</Button>
          {draftId && !ai && <Button className="mt-3 w-full" variant="ghost" onClick={submitManualDraft} disabled={stage !== 'idle'}><Send />Submit saved draft without AI</Button>}
          {notice && <p role="status" className={`mt-4 rounded-lg px-3 py-2 text-sm ${stage === 'submitted' ? 'bg-emerald-50 text-emerald-800' : 'bg-primary/5 text-foreground'}`}>{notice}</p>}
        </section>
        <section className="rounded-xl border bg-card p-4 text-xs text-muted-foreground"><p className="flex gap-2"><ShieldCheck className="size-4 shrink-0 text-emerald-600" />Hackathon direct mode exposes public provider credentials by design. Mongo still authorizes the seller, validates taxonomy, reserves the one-shot run, and records the reviewed draft.</p></section>
      </aside>
    </div>
  );
}

function SelectField({ label, value, options, onChange, disabled, compact = false }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean; compact?: boolean }) {
  return <label className={compact ? 'text-xs font-medium' : 'text-sm font-medium'}>{label}<select className={fieldClass} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">Select {label.toLowerCase()}</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function FitNumber({ label, value, onChange, disabled, min, max }: { label: string; value: number | null; onChange: (value: number | null) => void; disabled?: boolean; min: number; max: number }) {
  return <label className="text-xs font-medium">{label}<input type="number" min={min} max={max} step="1" className={fieldClass} value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} /></label>;
}

function WorkflowStep({ done, label }: { done: boolean; label: string }) {
  return <li className="flex items-center gap-2"><CheckCircle2 className={`size-4 ${done ? 'text-emerald-600' : 'text-muted-foreground/40'}`} /><span className={done ? 'text-foreground' : 'text-muted-foreground'}>{label}</span></li>;
}

function AiReview({ result }: { result: ProductAiResult }) {
  const { proposal } = result;
  const groups = [['Genders', proposal.genders], ['Styles', proposal.styles], ['Themes', proposal.themes], ['Occasions', proposal.occasions], ['Festivals', proposal.festivals], ['Cultural themes', proposal.culturalThemes], ['Materials', proposal.materials], ['Patterns', proposal.patterns], ['Fits', proposal.fits], ['Silhouettes', proposal.silhouettes], ['Seasons', proposal.seasons], ['Moods', proposal.moods], ['Outfit roles', proposal.outfitRoles]] as const;
  return <section className="rounded-xl border border-pink-200 bg-card p-5 shadow-sm"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-pink-600">AI proposal · review required</p><h2 className="mt-1 text-xl font-semibold">{proposal.title}</h2><p className="mt-1 text-sm text-muted-foreground">{proposal.shortDescription}</p></div><span className="w-fit rounded-full bg-pink-50 px-2.5 py-1 text-xs font-medium text-pink-700">{Math.round(proposal.confidence * 100)}% confidence</span></div><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-foreground/85">{proposal.description}</p><dl className="mt-5 grid gap-3 rounded-lg bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">{[['Category', proposal.category], ['Product type', proposal.productType], ['Taxonomy source', result.taxonomy.source], ['Schema version', String(result.taxonomy.schemaVersion)]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium capitalize">{value}</dd></div>)}</dl><div className="mt-4 grid gap-3 sm:grid-cols-2">{groups.map(([label, values]) => <div key={label}><p className="text-xs font-medium text-muted-foreground">{label}</p><div className="mt-1 flex flex-wrap gap-1.5">{values.map((value) => <span key={value} className="rounded-full border bg-background px-2 py-0.5 text-xs capitalize">{value}</span>)}</div></div>)}</div><div className="mt-4"><p className="text-xs font-medium text-muted-foreground">Colours</p><div className="mt-2 flex flex-wrap gap-2">{proposal.colours.map((colour) => <span key={`${colour.hex}-${colour.name}`} className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-1 text-xs"><span className="size-3 rounded-full border" style={{ backgroundColor: colour.hex }} />{colour.name} · {colour.family}</span>)}</div></div>{(proposal.warnings.length > 0 || proposal.missingInfo.length > 0) && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{proposal.warnings.map((warning) => <p key={warning}>Warning: {warning}</p>)}{proposal.missingInfo.map((item) => <p key={item}>Missing: {item}</p>)}</div>}<p className="mt-4 text-xs text-muted-foreground">Generated by {result.telemetry.provider}/{result.telemetry.model} in {(result.telemetry.latencyMs / 1000).toFixed(1)}s · {result.telemetry.attempts} attempt{result.telemetry.attempts === 1 ? '' : 's'}</p></section>;
}
