"use client";

import Link from "next/link";
import { DEMO_PORTAL_NOTICE } from "../../../lib/demo/types";

export default function DemoFilingError() {
  return (
    <main className="simple-page">
      <p className="eyebrow">Fictional demo service unavailable</p>
      <h1>The portal cannot read its durable PostgreSQL record right now.</h1>
      <p>
        No submission was marked Accepted or Rejected by this error. Check the database connection
        and try again.
      </p>
      <p>{DEMO_PORTAL_NOTICE}</p>
      <Link className="primary-button sui-focus-ring" href="/demo/filing">
        Return to the demo form
      </Link>
    </main>
  );
}
