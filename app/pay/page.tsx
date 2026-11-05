import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PayView } from "@/components/PayView";
import { NotFoundView } from "@/components/ResultView";
import { isPayPalConfigured, kitPrice, paypalClientId } from "@/lib/paypal";
import { getCheck } from "@/lib/store";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  const check = typeof id === "string" ? getCheck(id) : null;
  if (!check) return <NotFoundView />;
  if (check.paymentStatus === "paid") redirect(`/success?id=${check.id}`);
  return (
    <PayView
      checkId={check.id}
      price={kitPrice()}
      clientId={isPayPalConfigured() ? paypalClientId() : null}
      revoked={check.paymentStatus === "revoked"}
    />
  );
}
