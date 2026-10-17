/**
 * AirReach API のエラー型。ブラウザへ返すのは code と短い message と details だけ。
 * Supabase の応答本文やスタックはレスポンスに載せない（ログにも要約だけ）。
 * ops/airreach-api/src/errors.ts からの移植（型注釈を除去）。
 */
export class ApiError extends Error {
  constructor(status, code, message, details = [], logHint = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = Array.isArray(details) ? details.slice(0, 20) : [];
    this.logHint = logHint;
  }
  static badRequest(message, details = []) { return new ApiError(400, 'bad_request', message, details); }
  static notFound(message = 'Not found') { return new ApiError(404, 'not_found', message); }
  static methodNotAllowed(message = 'Method not allowed') { return new ApiError(405, 'method_not_allowed', message); }
  static originNotAllowed() { return new ApiError(403, 'origin_not_allowed', 'Origin not allowed'); }
  static conflict(message) { return new ApiError(409, 'conflict', message); }
  static payloadTooLarge() { return new ApiError(413, 'payload_too_large', 'Payload too large'); }
  static validation(details) { return new ApiError(422, 'validation_failed', 'Validation failed', details); }
  static internal(logHint = null) { return new ApiError(500, 'internal_error', 'Internal error', [], logHint); }
  static dependency(logHint = null) { return new ApiError(503, 'dependency_unavailable', 'Storage temporarily unavailable', [], logHint); }
  static upstream(status, message, logHint = null) { return new ApiError(status, 'upstream_error', message, [], logHint); }
}
