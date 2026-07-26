import { StorefrontFooter } from "@/components/storefront/StorefrontFooter";
import { StorefrontNavbar } from "@/components/storefront/StorefrontNavbar";

export default function StorefrontLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex min-h-dvh flex-col bg-[#fffdfd] text-zinc-950"><StorefrontNavbar /><main className="flex-1">{children}</main><StorefrontFooter /></div>;
}
