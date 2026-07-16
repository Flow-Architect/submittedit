import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing-page">
      <header className="site-header landing-header">
        <span className="brand-link">SubmittedIt</span>
        <Link className="header-link sui-focus-ring" href="/demo/filing">
          Open the demo
        </Link>
      </header>
      <section className="landing-hero">
        <div>
          <p className="eyebrow">Independent submission evidence</p>
          <h1>Submitted it—or only thought you did?</h1>
          <p className="landing-lede">
            A click is not acceptance. SubmittedIt separates the browser attempt, the site’s
            response, and the authority’s actual outcome.
          </p>
          <Link className="primary-button sui-focus-ring" href="/demo/filing">
            Try the fictional filing portal
          </Link>
        </div>
        <div className="landing-evidence" aria-label="Evidence trail ending in pending acceptance">
          <p>
            <span>→</span> Browser attempted
          </p>
          <p>
            <span>◆</span> Site responded
          </p>
          <p className="missing">
            <span>○</span> Authority acknowledgment
          </p>
          <strong>Pending acceptance</strong>
          <small>Authority evidence is still missing.</small>
        </div>
      </section>
      <p className="landing-boundary">
        Attempted is not accepted. Site confirmed is not accepted. Only a verified authoritative
        acknowledgment can support Accepted or Rejected.
      </p>
    </main>
  );
}
