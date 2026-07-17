export type RelayLogLevel = "info" | "warn" | "error";

export interface RelayLogEvent {
  readonly correlationId: string;
  readonly elapsedMs?: number;
  readonly eventHash?: string;
  readonly operationId?: string;
  readonly resultCode: string;
  readonly retryClassification?: "NONE" | "RETRYABLE" | "FINAL";
  readonly stage?: string;
  readonly transactionHash?: string;
}

export type RelayLogSink = (level: RelayLogLevel, serializedEvent: string) => void;

const shortenHash = (value: string | undefined): string | undefined =>
  value && value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;

const defaultSink: RelayLogSink = (level, serializedEvent) => {
  const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  writer(serializedEvent);
};

export class RelayLogger {
  readonly #sink: RelayLogSink;

  constructor(sink: RelayLogSink = defaultSink) {
    this.#sink = sink;
  }

  write(level: RelayLogLevel, event: RelayLogEvent): void {
    this.#sink(
      level,
      JSON.stringify({
        component: "submittedit-relay",
        correlationId: event.correlationId,
        ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
        ...(event.eventHash ? { eventHash: shortenHash(event.eventHash) } : {}),
        ...(event.operationId ? { operationId: event.operationId } : {}),
        resultCode: event.resultCode,
        ...(event.retryClassification ? { retryClassification: event.retryClassification } : {}),
        ...(event.stage ? { stage: event.stage } : {}),
        ...(event.transactionHash ? { transactionHash: shortenHash(event.transactionHash) } : {}),
      }),
    );
  }
}
