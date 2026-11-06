import type { Metadata } from "next";
import { LostView } from "@/components/StatusViews";
import { serverCopy } from "@/lib/language-server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverCopy()).status.notFoundTitle };
}

export default function NotFound() {
  return <LostView />;
}
