"use client";

import { ClipboardList, LoaderCircle, PackageCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { listCustomerOrders } from "@/lib/api/client";
import type { CustomerOrder } from "@/types/auth";

export default function AccountOrdersPage() {
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { void listCustomerOrders().then((result) => setOrders(result.items)).catch((caught) => setError(caught instanceof Error ? caught.message : "Orders could not be loaded.")); }, []);
  return <div><header><span className="inline-flex items-center gap-1.5 rounded-full bg-pink-50 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-pink-700"><ClipboardList className="size-3.5" />Orders</span><h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Your orders</h1><p className="mt-2 text-sm text-zinc-500">Track every StylMe order and its fulfilment status.</p></header>{!orders && !error && <div className="grid min-h-64 place-items-center"><LoaderCircle className="animate-spin text-pink-600" /></div>}{error && <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}{orders?.length === 0 && <div className="mt-7 grid min-h-72 place-items-center rounded-[2rem] border border-dashed border-pink-200 bg-white p-8 text-center"><div><span className="mx-auto grid size-14 place-items-center rounded-full bg-pink-50 text-pink-600"><PackageCheck /></span><h2 className="mt-4 text-xl font-black">No orders yet</h2><p className="mt-2 text-sm text-zinc-500">Your first order will appear here after checkout.</p></div></div>}<div className="mt-6 grid gap-3">{orders?.map((order) => <article key={order.id} className="rounded-2xl border border-pink-100 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-pink-600">{order.orderNumber ?? order.id}</p><p className="mt-1 text-sm text-zinc-500">{order.placedAt ? new Date(order.placedAt).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "Order created"} · {order.itemCount} items</p></div><span className="rounded-full bg-pink-50 px-3 py-1.5 text-xs font-bold text-pink-700">{order.status.replaceAll("_", " ")}</span></div><p className="mt-4 text-xl font-black">₹{Math.round(order.totalPaise / 100).toLocaleString("en-IN")}</p></article>)}</div></div>;
}
