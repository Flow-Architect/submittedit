import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDemoFilingService } from "../../../../lib/demo/service";
import { SubmissionStatus } from "./SubmissionStatus";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  description: "Runtime status for one synthetic SubmittedIt Civic Filing Lab submission.",
  robots: { follow: false, index: false },
  title: "Synthetic filing status | SubmittedIt",
};

interface StatusPageProps {
  readonly params: Promise<{ token: string }>;
}

export default async function DemoFilingStatusPage({ params }: StatusPageProps) {
  const { token } = await params;
  const submission = await getDemoFilingService().readSubmission(token);
  if (!submission) {
    notFound();
  }

  return (
    <main className="site-shell">
      <header className="site-header">
        <Link className="brand-link" href="/">
          SubmittedIt
        </Link>
        <Link className="header-link sui-focus-ring" href="/demo/filing">
          New synthetic filing
        </Link>
      </header>
      <SubmissionStatus initialSubmission={submission} token={token} />
    </main>
  );
}
