import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@submittedit/ui/tokens.css";
import "./styles.css";

export const metadata: Metadata = {
  description:
    "SubmittedIt keeps independent evidence of what a browser attempted, what a site showed, and whether an authority actually accepted or rejected it.",
  title: {
    default: "SubmittedIt — Know when it's really submitted.",
    template: "%s",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body data-submittedit-theme="light">{children}</body>
    </html>
  );
}
