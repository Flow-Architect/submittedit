export class ReceiptProtocolError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, message: string, path = "$") {
    super(`${path} ${message}`);
    this.name = "ReceiptProtocolError";
    this.code = code;
    this.path = path;
  }
}

export const protocolError = (code: string, message: string, path?: string): never => {
  throw new ReceiptProtocolError(code, message, path);
};
