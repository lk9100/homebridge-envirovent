export class EnviroventError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EnviroventError';
  }
}

/** TCP connection to the unit failed (refused, unreachable, etc.) */
export class ConnectionError extends EnviroventError {
  constructor(
    public readonly host: string,
    public readonly port: number,
    cause?: Error,
  ) {
    super(`Failed to connect to ${host}:${port}`, { cause });
    this.name = 'ConnectionError';
  }
}

/** Socket operation timed out */
export class TimeoutError extends EnviroventError {
  constructor(
    public readonly host: string,
    public readonly port: number,
    public readonly timeoutMs: number,
  ) {
    super(`Connection to ${host}:${port} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

/** Unit returned success=0 with an error message */
export class CommandError extends EnviroventError {
  constructor(public readonly unitError: string) {
    super(`Unit returned error: ${unitError}`);
    this.name = 'CommandError';
  }
}

/** Unit did not send any response data */
export class NoResponseError extends EnviroventError {
  constructor(
    public readonly host: string,
    public readonly port: number,
  ) {
    super(`No response from unit at ${host}:${port}`);
    this.name = 'NoResponseError';
  }
}

/** Response JSON could not be parsed or had unexpected structure */
export class ParseError extends EnviroventError {
  constructor(
    message: string,
    public readonly rawData?: string,
  ) {
    super(`Failed to parse response: ${message}`);
    this.name = 'ParseError';
  }
}
