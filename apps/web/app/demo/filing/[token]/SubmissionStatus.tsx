"use client";

import { useCallback, useEffect, useState } from "react";
import { DEMO_AUTHORITY_NAME, DEMO_PORTAL_NOTICE } from "../../../../lib/demo/types";
import type { DemoSubmissionView } from "../../../../lib/demo/types";

interface StatusResponse {
  readonly submission: DemoSubmissionView;
}

interface SubmissionStatusProps {
  readonly initialSubmission: DemoSubmissionView;
  readonly token: string;
}

const formTypeLabels = {
  SAMPLE_ANNUAL_FILING: "Sample annual filing",
  SAMPLE_CORRECTION: "Sample correction",
  SAMPLE_EXTENSION_REQUEST: "Sample extension request",
} as const;

const amount = (cents: number): string =>
  new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" }).format(cents / 100);

const dateTime = (value: string): string =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));

export function SubmissionStatus({ initialSubmission, token }: SubmissionStatusProps) {
  const [submission, setSubmission] = useState(initialSubmission);
  const [pollError, setPollError] = useState(false);
  const [checking, setChecking] = useState(false);

  const refreshStatus = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch(`/api/demo/filings/${encodeURIComponent(token)}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error("Status request failed.");
      }
      const result = (await response.json()) as StatusResponse;
      setSubmission(result.submission);
      setPollError(false);
    } catch {
      setPollError(true);
    } finally {
      setChecking(false);
    }
  }, [token]);

  useEffect(() => {
    if (submission.status !== "QUEUED") {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await refreshStatus();
      if (!cancelled) {
        timer = window.setTimeout(() => void poll(), 750);
      }
    };
    timer = window.setTimeout(() => void poll(), 750);

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [refreshStatus, submission.status]);

  const acknowledgment = submission.acknowledgment;
  const statusContent =
    submission.status === "QUEUED"
      ? {
          description: `${DEMO_AUTHORITY_NAME} stored this transmission and placed it in its processing queue. No authoritative outcome exists yet.`,
          label: "Transmission queued",
          symbol: "→",
          tone: "queued",
        }
      : submission.status === "PENDING"
        ? {
            description:
              "The fictional authority produced no acknowledgment. This does not prove acceptance or rejection.",
            label: "No acknowledgment received / still pending",
            symbol: "!",
            tone: "pending",
          }
        : submission.status === "ACCEPTED"
          ? {
              description: `${DEMO_AUTHORITY_NAME} issued a persisted fictional acceptance acknowledgment for this demo submission.`,
              label: "Accepted",
              symbol: "✓",
              tone: "accepted",
            }
          : {
              description: `${DEMO_AUTHORITY_NAME} issued a persisted fictional rejection acknowledgment for this demo submission.`,
              label: "Rejected",
              symbol: "×",
              tone: "rejected",
            };

  return (
    <div className="status-layout">
      <section
        aria-labelledby="status-heading"
        aria-live="polite"
        className="status-sheet"
        data-demo-status={statusContent.tone}
      >
        <p className="eyebrow">{DEMO_AUTHORITY_NAME} runtime status</p>
        <div className="status-heading">
          <span aria-hidden="true" className="status-symbol">
            {statusContent.symbol}
          </span>
          <div>
            <h1 id="status-heading">{statusContent.label}</h1>
            <p>{statusContent.description}</p>
          </div>
        </div>

        {submission.status === "QUEUED" ? (
          <div className="queued-warning">
            <strong>Queued is not accepted.</strong>
            <span>Waiting for a separate fictional authority outcome.</span>
          </div>
        ) : null}

        {submission.status === "PENDING" ? (
          <div className="pending-warning">
            <strong>Queued is not accepted.</strong>
            <span>
              No authoritative acknowledgment exists. Do not assume this fictional filing is
              complete.
            </span>
          </div>
        ) : null}

        {pollError ? (
          <p className="poll-error" role="status">
            Live status refresh is temporarily unavailable. Refreshing this page will read the same
            durable server record; no outcome has been changed.
          </p>
        ) : null}

        <dl className="submission-summary">
          <div>
            <dt>Submission reference</dt>
            <dd className="mono">{submission.submissionReference}</dd>
          </div>
          <div>
            <dt>Queued</dt>
            <dd>{dateTime(submission.queuedAt)}</dd>
          </div>
          <div>
            <dt>Demo scenario</dt>
            <dd>{submission.scenarioLabel}</dd>
          </div>
          <div>
            <dt>Current fictional outcome</dt>
            <dd>{submission.status}</dd>
          </div>
          <div>
            <dt>Fictional filer</dt>
            <dd>{submission.filerDisplayName}</dd>
          </div>
          <div>
            <dt>Sample form</dt>
            <dd>
              {formTypeLabels[submission.formType]} · {submission.filingYear}
            </dd>
          </div>
          <div>
            <dt>Synthetic amount</dt>
            <dd>{amount(submission.claimedAmountCents)}</dd>
          </div>
          <div>
            <dt>Synthetic contact</dt>
            <dd>{submission.contactEmail}</dd>
          </div>
        </dl>

        {acknowledgment ? (
          <section className="acknowledgment" aria-labelledby="acknowledgment-title">
            <div className="acknowledgment-title-row">
              <div>
                <p className="eyebrow">Fictional authority acknowledgment</p>
                <h2 id="acknowledgment-title">
                  {acknowledgment.outcome === "ACCEPTED"
                    ? "Acceptance acknowledgment issued"
                    : "Rejection acknowledgment issued"}
                </h2>
              </div>
              <span className="verified-badge">Persisted authority outcome</span>
            </div>
            <dl className="technical-details">
              <div>
                <dt>Outcome</dt>
                <dd>{acknowledgment.outcome}</dd>
              </div>
              <div>
                <dt>Acknowledged</dt>
                <dd>{dateTime(acknowledgment.acknowledgedAt)}</dd>
              </div>
              <div>
                <dt>Authority reference</dt>
                <dd className="mono">{acknowledgment.reference}</dd>
              </div>
              {acknowledgment.reason ? (
                <div>
                  <dt>Fictional rejection reason</dt>
                  <dd>{acknowledgment.reason}</dd>
                </div>
              ) : null}
            </dl>
            <p>
              A later SubmittedIt client may ask the server to sign a matching terminal
              <code> AuthorityEventCore</code>. This page does not create an extension receipt or
              claim that anything was anchored onchain.
            </p>
            <a className="secondary-button sui-focus-ring" href="/api/demo/authority">
              View authority public-key metadata
            </a>
          </section>
        ) : null}

        <div className="status-actions">
          {submission.status === "QUEUED" || submission.status === "PENDING" ? (
            <button
              className="secondary-button sui-focus-ring"
              disabled={checking}
              onClick={() => void refreshStatus()}
              type="button"
            >
              {checking ? "Checking…" : "Check again"}
            </button>
          ) : null}
          <a className="secondary-button sui-focus-ring" href="/demo/filing">
            Create another independent submission
          </a>
        </div>

        <div className="demo-disclaimer status-disclaimer" role="note">
          <strong>{DEMO_PORTAL_NOTICE}</strong>
        </div>
      </section>

      <aside className="independent-receipt-note">
        <p className="eyebrow">SubmittedIt proof boundary</p>
        <h2>The portal record is not the independent browser receipt.</h2>
        <p>
          This page works without the extension. The future extension supplies separate evidence of
          what the browser attempted and what this site displayed.
        </p>
        <p>
          Goal 06 sends no Monad transaction. An eventual onchain fingerprint would not replace this
          authority acknowledgment or prove legal timeliness.
        </p>
      </aside>
    </div>
  );
}
