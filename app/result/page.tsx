import type { Metadata } from "next";
import { NotFoundView, ResultView } from "@/components/ResultView";
import { serverCopy } from "@/lib/language-server";
import { kitPrice } from "@/lib/paypal";
import { getCheck } from "@/lib/store";
import { toPublicCheck } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverCopy()).result.pageTitle, robots: { index: false, follow: false } };
}

export default async function ResultPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  const check = typeof id === "string" ? getCheck(id) : null;
  if (!check) return <NotFoundView />;
  return <ResultView check={toPublicCheck(check)} price={kitPrice()} />;
}
