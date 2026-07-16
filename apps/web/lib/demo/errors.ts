export class DemoPortalError extends Error {
  readonly code: string;
  readonly publicMessage: string;
  readonly status: number;

  constructor(code: string, publicMessage: string, status: number) {
    super(publicMessage);
    this.name = "DemoPortalError";
    this.code = code;
    this.publicMessage = publicMessage;
    this.status = status;
  }
}
