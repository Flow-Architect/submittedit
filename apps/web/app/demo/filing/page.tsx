import type { Metadata } from "next";
import Link from "next/link";
import {
  DEMO_AUTHORITY_NAME,
  DEMO_PORTAL_NOTICE,
  DEMO_SCENARIO_LABELS,
} from "../../../lib/demo/types";

export const metadata: Metadata = {
  description:
    "Submit a synthetic filing to the fictional SubmittedIt Civic Filing Lab and observe a durable queued, accepted, rejected, or pending server outcome.",
  robots: { follow: false, index: false },
  title: "Fictional demo filing portal | SubmittedIt",
};

const fieldHintId = (field: string) => `${field}-hint`;

export default function DemoFilingPage() {
  return (
    <main className="site-shell">
      <header className="site-header">
        <Link className="brand-link" href="/">
          SubmittedIt
        </Link>
        <span className="header-context">Fictional demo authority</span>
      </header>

      <div className="demo-layout">
        <section className="filing-sheet" aria-labelledby="filing-title">
          <p className="eyebrow">Fictional demo filing portal</p>
          <div className="authority-heading">
            <div aria-hidden="true" className="authority-mark">
              SIT
            </div>
            <div>
              <p className="authority-name">{DEMO_AUTHORITY_NAME}</p>
              <h1 id="filing-title">Sample annual filing</h1>
            </div>
          </div>
          <p className="lede">
            Submit synthetic information to create a new durable server record and watch the
            fictional authority produce a real runtime outcome.
          </p>
          <div className="demo-disclaimer" role="note">
            <strong>{DEMO_PORTAL_NOTICE}</strong>
            <span>
              It is not affiliated with the IRS, the U.S. Treasury, a state government, or any other
              real authority.
            </span>
          </div>

          <form
            action="/api/demo/filings"
            className="filing-form"
            id="sample-annual-filing"
            method="post"
            name="sampleAnnualFiling"
          >
            <fieldset>
              <legend>Synthetic filer details</legend>
              <div className="form-grid">
                <label className="field field-wide">
                  <span>Fictional filer display name</span>
                  <input
                    aria-describedby={fieldHintId("filer-name")}
                    autoComplete="off"
                    id="filer-display-name"
                    maxLength={120}
                    minLength={2}
                    name="filerDisplayName"
                    defaultValue="Alex Example"
                    required
                    type="text"
                  />
                  <small id={fieldHintId("filer-name")}>
                    Use an invented name, not a legal or real person’s name.
                  </small>
                </label>

                <label className="field">
                  <span>Filing year</span>
                  <select defaultValue="2026" id="filing-year" name="filingYear" required>
                    <option value="2026">2026</option>
                    <option value="2025">2025</option>
                    <option value="2024">2024</option>
                  </select>
                </label>

                <label className="field">
                  <span>Sample form type</span>
                  <select
                    defaultValue="SAMPLE_ANNUAL_FILING"
                    id="form-type"
                    name="formType"
                    required
                  >
                    <option value="SAMPLE_ANNUAL_FILING">Sample annual filing</option>
                    <option value="SAMPLE_EXTENSION_REQUEST">Sample extension request</option>
                    <option value="SAMPLE_CORRECTION">Sample correction</option>
                  </select>
                </label>

                <label className="field">
                  <span>Synthetic claimed amount</span>
                  <span className="money-input">
                    <span aria-hidden="true">$</span>
                    <input
                      aria-describedby={fieldHintId("claimed-amount")}
                      id="claimed-amount"
                      inputMode="decimal"
                      maxLength={11}
                      name="claimedAmount"
                      pattern="(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?"
                      defaultValue="1250.00"
                      required
                      type="text"
                    />
                  </span>
                  <small id={fieldHintId("claimed-amount")}>Synthetic demo value only.</small>
                </label>

                <label className="field">
                  <span>Synthetic contact email</span>
                  <input
                    aria-describedby={fieldHintId("contact-email")}
                    autoComplete="off"
                    id="contact-email"
                    maxLength={254}
                    name="contactEmail"
                    defaultValue="alex@example.invalid"
                    required
                    type="email"
                  />
                  <small id={fieldHintId("contact-email")}>
                    Reserved example, .test, or .invalid domains only.
                  </small>
                </label>
              </div>
            </fieldset>

            <fieldset className="scenario-fieldset">
              <legend>Demo processing path</legend>
              <p className="fieldset-help">
                This explicit control chooses the fictional authority’s persisted scenario. It does
                not change state only in this browser.
              </p>
              <div className="scenario-options">
                <label>
                  <input defaultChecked name="scenario" type="radio" value="ACCEPTED" />
                  <span>
                    <strong>{DEMO_SCENARIO_LABELS.ACCEPTED}</strong>
                    <small>A persisted fictional acceptance after a short server delay.</small>
                  </span>
                </label>
                <label>
                  <input name="scenario" type="radio" value="REJECTED" />
                  <span>
                    <strong>{DEMO_SCENARIO_LABELS.REJECTED}</strong>
                    <small>A persisted fictional rejection with a synthetic reason.</small>
                  </span>
                </label>
                <label>
                  <input name="scenario" type="radio" value="PENDING" />
                  <span>
                    <strong>{DEMO_SCENARIO_LABELS.PENDING}</strong>
                    <small>Remains pending without fabricating an outcome.</small>
                  </span>
                </label>
              </div>
            </fieldset>

            <label className="certification">
              <input name="certification" required type="checkbox" value="certified" />
              <span>
                I certify that every value above is fictional and supplied only for this
                demonstration.
              </span>
            </label>

            <button className="primary-button sui-focus-ring" type="submit">
              Submit synthetic filing
            </button>
            <p className="submit-note">
              The next page will first say <strong>Transmission queued</strong>. Queued is not
              accepted.
            </p>
          </form>
        </section>

        <aside className="evidence-explainer" aria-labelledby="independent-evidence-title">
          <p className="eyebrow">What this demonstrates</p>
          <h2 id="independent-evidence-title">The portal works without the extension.</h2>
          <p>
            {DEMO_AUTHORITY_NAME} creates its own server record and fictional outcome. The
            SubmittedIt extension can separately record local browser-observed Attempted evidence
            after you explicitly enable this origin. That evidence is not a portal confirmation or
            authority acceptance.
          </p>
          <ol className="evidence-steps">
            <li>
              <span>1</span>
              <div>
                <strong>Browser submits</strong>
                <p>A standard HTML form sends a real request.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Portal queues</strong>
                <p>A success-looking page still says acceptance is missing.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Authority decides</strong>
                <p>
                  Accepted and Rejected persist real acknowledgment data that can sign only a
                  matching receipt event.
                </p>
              </div>
            </li>
          </ol>
          <div className="proof-boundary">
            <strong>Queued is not accepted.</strong>
            <p>A website response cannot substitute for a verified authoritative acknowledgment.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
