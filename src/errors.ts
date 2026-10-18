import type { PunchlistErrorCode, PunchlistErrorLike } from './types';

/**
 * Single error type for every rejection path of the imperative API, so hosts
 * can branch on `err.code` instead of matching messages.
 */
export class PunchlistError extends Error implements PunchlistErrorLike {
  code: PunchlistErrorCode;
  status?: number;

  constructor(code: PunchlistErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'PunchlistError';
    this.code = code;
    if (status !== undefined) this.status = status;
    // Keep `instanceof` working when compiled down to ES5-ish targets.
    Object.setPrototypeOf(this, PunchlistError.prototype);
  }
}

export function isPunchlistError(value: unknown): value is PunchlistError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === 'PunchlistError' &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

