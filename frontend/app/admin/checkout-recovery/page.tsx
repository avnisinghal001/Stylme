"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowRight, CalendarDays, CheckCircle2, Clock3, GitBranch, Languages, LoaderCircle, PhoneCall, Play, RefreshCw, ShieldCheck, ShoppingBag, Sparkles, TriangleAlert } from "lucide-react";

import { getCalls, getCampaignAnalytics, loadAgentWorkspace, runAbandonedCheckout } from "@/lib/api/agent-admin";
import type { AiCall, AiCampaign, AgentSwarm } from "@/types/ai-agents";

type AnalyticsItem = { period: string; status: string; count: number };
type RecoveryState = {
  campaign: AiCampaign | null;
  swarm: AgentSwarm | null;
  calls: AiCall[];
  total: number;
  daily: AnalyticsItem[];
  monthly: AnalyticsItem[];
};

const emptyState: RecoveryState = { campaign: null, swarm: null, calls: [], total: 0, daily: [], monthly: [] };
const languages = "English · Hindi · Bengali · Tamil · Telugu · Gujarati · Kannada · Malayalam · Marathi · Punjabi · Odia";

export default function CheckoutRecoveryPage() {
  const [state, setState] = useState<RecoveryState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const workspace = await loadAgentWorkspace();
      const campaign = workspace.campaigns.find((item) => item.kind === "abandoned_checkout") ?? null;
      if (!campaign) {
        setState(emptyState);
        setError("The abandoned-checkout campaign has not been seeded yet.");
        return;
      }
      const [calls, daily, monthly] = await Promise.all([
        getCalls(1, 20, campaign.id),
        getCampaignAnalytics(campaign.id, "day"),
        getCampaignAnalytics(campaign.id, "month"),
      ]);
      setState({
        campaign,
        swarm: workspace.swarms.find((item) => item.id === campaign.swarmId) ?? null,
        calls: calls.items,
        total: calls.total,
        daily: daily.items,
        monthly: monthly.items,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Recovery operations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(task);
  }, [refresh]);

  async function runNow() {
    if (!state.campaign || !window.confirm("Discover eligible unpaid checkouts and schedule consented recovery calls now?")) return;
    setRunning(true); setError(""); setNotice("");
    try {
      const result = await runAbandonedCheckout(state.campaign.id, 100);
      setNotice(`Fetched ${result.fetched ?? 0}, found ${result.eligible}, scheduled ${result.scheduled}, and dispatched ${result.dispatched}. Duplicates remain idempotent.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The workflow could not be started.");
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <div className="grid min-h-[34rem] place-items-center bg-[#fffafa]"><div className="text-center"><LoaderCircle className="mx-auto size-7 animate-spin text-pink-600" /><p className="mt-3 text-sm text-zinc-500">Loading the recovery control room…</p></div></div>;

  const campaign = state.campaign;
  return <div className="min-h-full bg-[#fffafa] p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-[90rem]">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><span className="inline-flex items-center gap-1.5 rounded-full bg-pink-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-pink-700"><Sparkles className="size-3" /> SwoopStyl operations</span><h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-zinc-950 sm:text-4xl">Checkout recovery</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">A native StylMe campaign powered by the Go call ledger and LiveKit—not an external Samora workflow.</p></div><div className="flex gap-2"><button type="button" onClick={() => void refresh()} className="inline-flex h-11 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-xs font-black"><RefreshCw className="size-4" /> Refresh</button><button type="button" onClick={() => void runNow()} disabled={!campaign || running} className="inline-flex h-11 items-center gap-2 rounded-xl bg-pink-600 px-5 text-xs font-black text-white shadow-lg shadow-pink-200 disabled:opacity-40">{running ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />} Run now</button></div></header>

    {error && <div role="alert" className="mt-6 flex gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{error}</div>}
    {notice && <div role="status" className="mt-6 flex gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{notice}</div>}

    <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={PhoneCall} label="Campaign" value={campaign?.status ?? "Unavailable"} detail={campaign?.name ?? "Seed required"} />
      <Metric icon={ShoppingBag} label="Call records" value={state.total.toLocaleString("en-IN")} detail="Idempotent checkout targets" />
      <Metric icon={GitBranch} label="Starts at" value={campaign?.entryNodeKey ?? "—"} detail={`${state.swarm?.graph.nodes.length ?? 0} node DAG`} />
      <Metric icon={Languages} label="Voice" value={campaign?.language ?? "—"} detail="11 Indian languages ready" />
    </section>

    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,.75fr)]">
      <section className="rounded-3xl border border-pink-100 bg-white p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-pink-600">Live campaign contract</p><h2 className="mt-1 text-xl font-black">{campaign?.instructions.objective ?? "Campaign unavailable"}</h2></div>{campaign && <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-black uppercase text-emerald-700">{campaign.status}</span>}</div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2"><Info icon={Clock3} label="Calling window" value={campaign ? `${campaign.callingWindow.start}–${campaign.callingWindow.end} · ${campaign.callingWindow.timezone}` : "—"} /><Info icon={Activity} label="Concurrency" value={campaign ? `${campaign.maxConcurrency} active · ${campaign.callsPerSecond}/sec` : "—"} /><Info icon={PhoneCall} label="Caller binding" value={campaign?.fromNumber ? `Configured ···${campaign.fromNumber.slice(-4)}` : "Not configured"} /><Info icon={ShieldCheck} label="Recovery safeguards" value="Consent, opt-out, immutable snapshot" /></div>
        <div className="mt-5 rounded-2xl bg-pink-50 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-pink-700">Regional language coverage</p><p className="mt-2 text-xs leading-6 text-zinc-600">{languages}</p></div>
        <Link href="/admin/agents" className="mt-5 inline-flex items-center gap-2 text-xs font-black text-pink-700">Open campaign, DAG, test call, and API keys in Agent Studio <ArrowRight className="size-4" /></Link>
      </section>

      <section className="rounded-3xl bg-zinc-950 p-5 text-white sm:p-7"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-pink-300">cron-job.org · every 5 minutes</p><h2 className="mt-2 text-xl font-black">Checkout discovery + scheduling</h2><p className="mt-2 text-xs leading-5 text-zinc-400">Keep the secret in the request header. This endpoint also attempts the first safe dispatch batch.</p><ContractRow label="Method" value="POST" /><ContractRow label="URL" value="https://stylme-ai-control-plane.vercel.app/v1/workflows/abandoned-checkout" /><ContractRow label="Header" value="X-Internal-Key: <root CRON_SECRET>" /><ContractRow label="Body" value='{"campaignId":"campaign_default_checkout_recovery","limit":100}' /><div className="mt-5 border-t border-white/10 pt-5"><p className="text-[10px] font-black uppercase text-zinc-500">Queue drain · every minute</p><code className="mt-2 block break-all text-[10px] leading-5 text-pink-200">POST /v1/runtime/dispatch?limit=5</code></div></section>
    </div>

    <section className="mt-5 rounded-3xl border border-pink-100 bg-white p-5 sm:p-7"><div className="flex items-center justify-between"><div><h2 className="text-lg font-black">Day and month outcomes</h2><p className="mt-1 text-xs text-zinc-500">Aggregated from one inbound/outbound calls collection.</p></div><CalendarDays className="size-5 text-pink-500" /></div><div className="mt-5 grid gap-5 lg:grid-cols-2"><Analytics title="Daily" items={state.daily} /><Analytics title="Monthly" items={state.monthly} /></div></section>

    <section className="mt-5 overflow-hidden rounded-3xl border border-pink-100 bg-white"><div className="flex items-center justify-between border-b border-pink-100 p-5"><div><h2 className="text-lg font-black">Recent recovery calls</h2><p className="mt-1 text-xs text-zinc-500">Open Agent Studio for full transcripts and captured disposition JSON.</p></div><span className="rounded-full bg-pink-50 px-3 py-1 text-xs font-black text-pink-700">{state.total}</span></div>{state.calls.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-zinc-50 text-[10px] uppercase tracking-wider text-zinc-400"><tr><th className="px-5 py-3">Created</th><th className="px-5 py-3">Shopper</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Node</th><th className="px-5 py-3">Outcome</th></tr></thead><tbody>{state.calls.map((call) => <tr key={call.id} className="border-t border-zinc-100"><td className="px-5 py-4 text-zinc-500">{new Date(call.createdAt).toLocaleString("en-IN")}</td><td className="px-5 py-4 font-mono">···{call.to.slice(-4)}</td><td className="px-5 py-4"><Status value={call.status} /></td><td className="px-5 py-4 font-semibold">{call.currentNodeKey}</td><td className="max-w-sm px-5 py-4 text-zinc-500">{call.disposition?.summary ?? "Awaiting call completion"}</td></tr>)}</tbody></table></div> : <div className="grid min-h-48 place-items-center p-8 text-center"><div><PhoneCall className="mx-auto size-7 text-pink-200" /><p className="mt-3 text-sm font-black">No recovery calls yet</p><p className="mt-1 text-xs text-zinc-400">Run the workflow or wait for cron-job.org.</p></div></div>}</section>
  </div></div>;
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof PhoneCall; label: string; value: string; detail: string }) { return <div className="rounded-2xl border border-pink-100 bg-white p-5"><div className="flex items-center justify-between"><span className="grid size-9 place-items-center rounded-xl bg-pink-50 text-pink-600"><Icon className="size-4" /></span><span className="text-[9px] font-black uppercase tracking-wider text-zinc-400">{label}</span></div><p className="mt-4 text-2xl font-black tracking-tight text-zinc-950">{value}</p><p className="mt-1 text-[10px] text-zinc-500">{detail}</p></div>; }
function Info({ icon: Icon, label, value }: { icon: typeof PhoneCall; label: string; value: string }) { return <div className="flex items-start gap-3 rounded-2xl border border-zinc-100 p-4"><Icon className="mt-0.5 size-4 shrink-0 text-pink-600" /><div><p className="text-[9px] font-black uppercase tracking-wider text-zinc-400">{label}</p><p className="mt-1 text-xs font-bold text-zinc-800">{value}</p></div></div>; }
function ContractRow({ label, value }: { label: string; value: string }) { return <div className="mt-4"><p className="text-[9px] font-black uppercase tracking-wider text-zinc-500">{label}</p><code className="mt-1 block break-all text-[10px] leading-5 text-pink-200">{value}</code></div>; }
function Analytics({ title, items }: { title: string; items: AnalyticsItem[] }) { return <div className="rounded-2xl bg-zinc-50 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-zinc-500">{title}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{items.length ? items.slice(0, 12).map((item) => <div key={`${item.period}-${item.status}`} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-[10px]"><span>{item.period} · {item.status}</span><strong>{item.count}</strong></div>) : <p className="text-[10px] text-zinc-400">No outcomes in this period.</p>}</div></div>; }
function Status({ value }: { value: string }) { const good = ["completed", "active", "running"].includes(value); const bad = ["failed", "cancelled"].includes(value); return <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${good ? "bg-emerald-50 text-emerald-700" : bad ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{value}</span>; }
