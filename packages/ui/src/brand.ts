export const brandMetadata = {
  name: "SubmittedIt",
  tagline: "Know when it's really submitted.",
  coreQuestion: "Submitted it—or only thought you did?",
  markAlternativeText: "SubmittedIt receipt trail mark",
} as const;

export const statusPresentations = {
  prepared: {
    label: "Prepared",
    symbol: "○",
    iconTreatment: "Open docket",
    accessibilityLabel: "Prepared — ready locally, not submitted",
  },
  attempted: {
    label: "Attempted",
    symbol: "→",
    iconTreatment: "Outbound trail",
    accessibilityLabel: "Attempted — the browser attempted transmission",
  },
  siteConfirmed: {
    label: "Site confirmed",
    symbol: "◆",
    iconTreatment: "Site stamp",
    accessibilityLabel: "Site confirmed — the website displayed confirmation evidence",
  },
  pendingAcceptance: {
    label: "Pending acceptance",
    symbol: "!",
    iconTreatment: "Incomplete ring with alert",
    accessibilityLabel: "Pending acceptance — authoritative acceptance is still missing",
  },
  accepted: {
    label: "Accepted",
    symbol: "✓",
    iconTreatment: "Authority check",
    accessibilityLabel: "Accepted — verified authoritative acknowledgment received",
  },
  rejected: {
    label: "Rejected",
    symbol: "×",
    iconTreatment: "Authority cross",
    accessibilityLabel: "Rejected — verified authoritative rejection received",
  },
  verificationFailed: {
    label: "Verification failed",
    symbol: "≠",
    iconTreatment: "Broken evidence trail",
    accessibilityLabel: "Verification failed — this receipt cannot be trusted",
  },
} as const;

export type StatusPresentationKey = keyof typeof statusPresentations;
export type StatusPresentation = (typeof statusPresentations)[StatusPresentationKey];
