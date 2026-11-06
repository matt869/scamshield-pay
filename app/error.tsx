"use client";

import { ErrorView } from "@/components/StatusViews";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView onRetry={reset} />;
}
