export class MemoryCloudError extends Error {
  code: string;
  statusCode?: number;
  traceId?: string;
  payload?: unknown;

  constructor(
    code: string,
    message: string,
    options?: {
      statusCode?: number;
      traceId?: string;
      payload?: unknown;
    }
  ) {
    super(message);
    this.code = code;
    this.statusCode = options?.statusCode;
    this.traceId = options?.traceId;
    this.payload = options?.payload;
  }
}
