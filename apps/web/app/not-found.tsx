import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="simple-page">
      <p className="eyebrow">Not found</p>
      <h1>No demo submission is available for that identifier.</h1>
      <p>
        Status links use high-entropy identifiers. Check the complete link or create a new synthetic
        filing.
      </p>
      <Link className="primary-button sui-focus-ring" href="/demo/filing">
        Open the fictional demo portal
      </Link>
    </main>
  );
}
