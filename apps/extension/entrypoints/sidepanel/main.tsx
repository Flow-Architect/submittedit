import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("SubmittedIt side panel root is missing.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
