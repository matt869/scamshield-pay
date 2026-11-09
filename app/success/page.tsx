import type { Metadata } from "next";
import { NotFoundView } from "@/components/ResultView";
import { SuccessView } from "@/components/SuccessView";
import { serverCopy } from "@/lib/language-server";
import { getCheck } from "@/lib/store";
import { toPublicCheck } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverCopy()).success.pageTitle, robots: { index: false, follow: false } };
}

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  const check = typeof id === "string" ? await getCheck(id) : null;
  if (!check) return <NotFoundView />;
  return <SuccessView check={toPublicCheck(check)} />;
}
