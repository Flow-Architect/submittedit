import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import {
  CAPTURE_DEDUPE_WINDOW_MS,
  captureMessageByteLength,
  createCaptureAttemptRequest,
  hashPagePath,
  isUnusuallySensitiveField,
  MAX_CAPTURE_MESSAGE_BYTES,
  privacySafePageUrl,
  randomOpaqueId,
  randomReceiptId,
  serializeSuccessfulControls,
  type CaptureAttemptRequest,
  type CaptureControlDescriptor,
  type CapturePageErrorRequest,
  type SuccessfulFormDataEntry,
} from "../lib/capture";
import {
  CONFIRMATION_CONTENT_COMMAND,
  createPageContextObservationRequest,
  type PageEvidenceCandidate,
  type PageContextObservationRequest,
} from "../lib/site-confirmation";

const INSTALLATION_KEY = "__submitteditAttemptCaptureV2";
const CONTENT_COMMAND = "SUBMITTEDIT_CAPTURE_COMMAND";
const NON_EVIDENCE_SELECTOR =
  "input, textarea, select, option, script, style, [hidden], [aria-hidden='true']";

interface CaptureInstallation {
  dispose(): void;
  status(): CapturePageStatus;
}

interface CapturePageStatus {
  readonly origin: string;
  readonly reachable: true;
  readonly formCount: number;
  readonly hasForm: boolean;
  readonly unusuallySensitiveFieldCount: number;
}

interface CachedAttempt {
  readonly capturedAtMs: number;
  readonly fingerprint: string;
  readonly request: CaptureAttemptRequest;
}

type CaptureGlobal = typeof globalThis & {
  [INSTALLATION_KEY]?: CaptureInstallation;
};

function formEncoding(form: HTMLFormElement) {
  switch (form.enctype.toLowerCase()) {
    case "application/x-www-form-urlencoded":
      return "APPLICATION_X_WWW_FORM_URLENCODED" as const;
    case "multipart/form-data":
      return "MULTIPART_FORM_DATA" as const;
    case "text/plain":
      return "TEXT_PLAIN" as const;
    case "application/json":
      return "APPLICATION_JSON" as const;
    default:
      return "OTHER" as const;
  }
}

function controlType(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  if (control instanceof HTMLTextAreaElement) {
    return "TEXTAREA" as const;
  }
  if (control instanceof HTMLSelectElement) {
    return control.multiple ? ("SELECT_MULTIPLE" as const) : ("SELECT_ONE" as const);
  }
  switch (control.type.toLowerCase()) {
    case "password":
      return "PASSWORD" as const;
    case "file":
      return "FILE" as const;
    case "hidden":
      return "HIDDEN" as const;
    case "checkbox":
      return "CHECKBOX" as const;
    case "radio":
      return "RADIO" as const;
    case "button":
    case "submit":
    case "reset":
    case "image":
      return null;
    default:
      return "TEXT" as const;
  }
}

function supportedControls(form: HTMLFormElement): CaptureControlDescriptor[] {
  const descriptors: CaptureControlDescriptor[] = [];
  for (const [index, element] of [...form.elements].entries()) {
    if (
      !(
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      ) ||
      element.name.length === 0 ||
      element.matches(":disabled")
    ) {
      continue;
    }
    const mappedType = controlType(element);
    if (!mappedType) {
      continue;
    }
    const successful =
      mappedType !== "CHECKBOX" && mappedType !== "RADIO"
        ? true
        : element instanceof HTMLInputElement && element.checked;
    descriptors.push({
      ...(element.autocomplete ? { autocomplete: element.autocomplete } : {}),
      controlType: mappedType,
      fieldId: `field-${index.toString(36)}-${mappedType.toLowerCase()}`,
      name: element.name,
      successful,
    });
  }
  return descriptors;
}

function formDataEntries(formData: FormData): SuccessfulFormDataEntry[] {
  const entries: SuccessfulFormDataEntry[] = [];
  for (const [name, value] of formData.entries()) {
    entries.push(
      typeof value === "string" ? { kind: "STRING", name, value } : { kind: "FILE", name },
    );
  }
  return entries;
}

function currentStatus(): CapturePageStatus {
  let unusuallySensitiveFieldCount = 0;
  for (const form of [...document.forms]) {
    for (const control of supportedControls(form)) {
      if (isUnusuallySensitiveField(control.name, control.autocomplete)) {
        unusuallySensitiveFieldCount += 1;
      }
    }
  }
  return {
    origin: location.origin,
    reachable: true,
    formCount: document.forms.length,
    hasForm: document.forms.length > 0,
    unusuallySensitiveFieldCount,
  };
}

function sendPageError(code: CapturePageErrorRequest["code"]): void {
  const message: CapturePageErrorRequest = {
    type: "CAPTURE_PAGE_ERROR",
    capturedAt: new Date().toISOString(),
    code,
    origin: location.origin,
  };
  void browser.runtime.sendMessage(message).catch(() => undefined);
}

function textNodeIsRendered(node: Text): boolean {
  let element = node.parentElement;
  if (!element) {
    return false;
  }
  while (element) {
    if (element.matches(NON_EVIDENCE_SELECTOR)) {
      return false;
    }
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      Number.parseFloat(style.opacity) === 0 ||
      style.getPropertyValue("content-visibility") === "hidden"
    ) {
      return false;
    }
    element = element.parentElement;
  }
  const renderedRange = document.createRange();
  renderedRange.selectNodeContents(node);
  return [...renderedRange.getClientRects()].some(
    (rectangle) => rectangle.width > 0 && rectangle.height > 0,
  );
}

function selectedTextNodes(range: Range): Text[] {
  const commonAncestor = range.commonAncestorContainer;
  const candidates: Text[] = [];
  if (commonAncestor instanceof Text) {
    candidates.push(commonAncestor);
  } else {
    const walker = document.createTreeWalker(commonAncestor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Text) {
        candidates.push(node);
      }
    }
  }
  return candidates.filter((node) => {
    if (!node.nodeValue?.trim()) {
      return false;
    }
    try {
      return range.intersectsNode(node);
    } catch {
      return false;
    }
  });
}

function selectedVisibleText(): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  let hasRenderedText = false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const container =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    if (!container || container.closest(NON_EVIDENCE_SELECTOR)) {
      return null;
    }
    const textNodes = selectedTextNodes(range);
    if (textNodes.some((node) => !textNodeIsRendered(node))) {
      return null;
    }
    if (textNodes.length > 0) {
      hasRenderedText = true;
    }
  }

  const text = selection.toString();
  return hasRenderedText && text.trim().length > 0 ? text : null;
}

export default defineContentScript({
  registration: "runtime",
  runAt: "document_start",
  noScriptStartedPostMessage: true,
  main() {
    const captureGlobal = globalThis as CaptureGlobal;
    if (captureGlobal[INSTALLATION_KEY]) {
      return;
    }

    const recentAttempts = new WeakMap<HTMLFormElement, CachedAttempt>();
    const constructingFormData = new WeakSet<HTMLFormElement>();
    const documentInstanceId = randomOpaqueId();
    let attemptCapturedInDocument = false;
    let documentObservationSent = false;
    let domObservationSent = false;
    let observer: MutationObserver | null = null;

    const sendObservation = (kind: PageContextObservationRequest["kind"]): void => {
      try {
        const message = createPageContextObservationRequest({
          documentInstanceId,
          kind,
          observationId: randomOpaqueId(),
          observedAt: new Date().toISOString(),
          origin: location.origin,
          pageUrl: privacySafePageUrl(location.href),
        });
        void browser.runtime.sendMessage(message).catch(() => undefined);
      } catch {
        // Structural navigation reporting never blocks the host page.
      }
    };

    const reportDocument = (): void => {
      if (!documentObservationSent) {
        documentObservationSent = true;
        sendObservation("DOCUMENT");
      }
    };

    const reportHistory = (): void => {
      sendObservation("HISTORY");
    };

    const startObserver = (): void => {
      if (observer || !document.documentElement) {
        return;
      }
      observer = new MutationObserver(() => {
        if (!attemptCapturedInDocument || domObservationSent) {
          return;
        }
        domObservationSent = true;
        window.setTimeout(() => sendObservation("DOM_UPDATE"), 250);
      });
      observer.observe(document.documentElement, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    };

    const capture = (form: HTMLFormElement, formData: FormData): void => {
      try {
        const pageUrl = privacySafePageUrl(location.href);
        const actionUrl = privacySafePageUrl(form.action || pageUrl);
        const input = {
          actionOrigin: new URL(actionUrl).origin,
          attemptId: randomOpaqueId(),
          capturedAt: new Date().toISOString(),
          documentInstanceId,
          fields: serializeSuccessfulControls(supportedControls(form), formDataEntries(formData)),
          form: {
            actionUrl,
            encoding: formEncoding(form),
            ...(form.id ? { formId: form.id } : {}),
            ...(form.name ? { formName: form.name } : {}),
            method: form.method || "GET",
          },
          origin: location.origin,
          pagePathHash: hashPagePath(location.origin, location.pathname),
          pageUrl,
          receiptId: randomReceiptId(),
          receiptNonce: randomOpaqueId(),
        };
        let request = createCaptureAttemptRequest(input);
        const capturedAtMs = Date.now();
        const previous = recentAttempts.get(form);
        if (
          previous &&
          previous.fingerprint === request.attemptFingerprint &&
          capturedAtMs - previous.capturedAtMs <= CAPTURE_DEDUPE_WINDOW_MS
        ) {
          request = previous.request;
        } else {
          domObservationSent = false;
          recentAttempts.set(form, {
            capturedAtMs,
            fingerprint: request.attemptFingerprint,
            request,
          });
        }

        const byteLength = captureMessageByteLength(request);
        if (byteLength === null || byteLength > MAX_CAPTURE_MESSAGE_BYTES) {
          sendPageError("CAPTURE_TOO_LARGE");
          return;
        }
        attemptCapturedInDocument = true;
        void browser.runtime.sendMessage(request).catch(() => undefined);
      } catch {
        sendPageError("FORM_SERIALIZATION_FAILED");
      }
    };

    const handleSubmit = (event: Event): void => {
      if (!(event.target instanceof HTMLFormElement)) {
        return;
      }
      const form = event.target;
      try {
        constructingFormData.add(form);
        const submitter =
          event instanceof SubmitEvent &&
          (event.submitter instanceof HTMLButtonElement ||
            event.submitter instanceof HTMLInputElement)
            ? event.submitter
            : undefined;
        const formData = submitter ? new FormData(form, submitter) : new FormData(form);
        capture(form, formData);
      } catch {
        sendPageError("FORM_SERIALIZATION_FAILED");
      } finally {
        constructingFormData.delete(form);
      }
    };

    const handleFormData = (event: FormDataEvent): void => {
      if (event.target instanceof HTMLFormElement && !constructingFormData.has(event.target)) {
        capture(event.target, event.formData);
      }
    };

    const handleCommand = (
      message: unknown,
      _sender: Browser.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ): boolean | undefined => {
      if (
        typeof message !== "object" ||
        message === null ||
        Array.isArray(message) ||
        !("type" in message)
      ) {
        return undefined;
      }
      const command = "command" in message ? message.command : undefined;
      if (message.type === CONTENT_COMMAND && command === "STATUS") {
        sendResponse(currentStatus());
        return false;
      }
      if (message.type === CONTENT_COMMAND && command === "UNINSTALL") {
        captureGlobal[INSTALLATION_KEY]?.dispose();
        sendResponse({ removed: true });
        return false;
      }
      if (message.type === CONFIRMATION_CONTENT_COMMAND && command === "READ_VISIBLE_SELECTION") {
        const selectedText = selectedVisibleText();
        const candidate: PageEvidenceCandidate | null = selectedText
          ? {
              documentInstanceId,
              origin: location.origin,
              pageTitle: document.title,
              pageUrl: privacySafePageUrl(location.href),
              selectedText,
            }
          : null;
        sendResponse(candidate);
        return false;
      }
      if (message.type === CONFIRMATION_CONTENT_COMMAND && command === "READ_PAGE_CONTEXT") {
        sendResponse({
          documentInstanceId,
          origin: location.origin,
          pageUrl: privacySafePageUrl(location.href),
        });
        return false;
      }
      return undefined;
    };

    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("formdata", handleFormData, true);
    document.addEventListener("DOMContentLoaded", reportDocument, { once: true });
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
    window.addEventListener("pageshow", reportDocument);
    window.addEventListener("popstate", reportHistory);
    window.addEventListener("hashchange", reportHistory);
    browser.runtime.onMessage.addListener(handleCommand);
    if (document.readyState !== "loading") {
      reportDocument();
      startObserver();
    }

    captureGlobal[INSTALLATION_KEY] = {
      dispose() {
        document.removeEventListener("submit", handleSubmit, true);
        document.removeEventListener("formdata", handleFormData, true);
        document.removeEventListener("DOMContentLoaded", reportDocument);
        document.removeEventListener("DOMContentLoaded", startObserver);
        window.removeEventListener("pageshow", reportDocument);
        window.removeEventListener("popstate", reportHistory);
        window.removeEventListener("hashchange", reportHistory);
        observer?.disconnect();
        browser.runtime.onMessage.removeListener(handleCommand);
        delete captureGlobal[INSTALLATION_KEY];
      },
      status: currentStatus,
    };
  },
});
