import type { Metadata } from "next";
import { NotFoundView } from "@/components/ResultView";
import { SuccessView } from "@/components/SuccessView";
import { getCheck } from "@/lib/store";
import { toPublicCheck } from "@/lib/types";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  const check = typeof id === "string" ? getCheck(id) : null;
  if (!check) return <NotFoundView />;
  return <SuccessView check={toPublicCheck(check)} />;
}
