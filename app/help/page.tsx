import type { Metadata } from "next";
import { HelpView } from "@/components/HelpView";
import { serverCopy } from "@/lib/language-server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await serverCopy()).help.pageTitle };
}

export default function HelpPage() {
  return <HelpView />;
}
