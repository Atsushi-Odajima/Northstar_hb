export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (msg: string, details?: unknown) => new AppError(400, "bad_request", msg, details);
export const unauthorized = (msg = "ログインが必要です") => new AppError(401, "unauthorized", msg);
export const forbidden = (msg = "権限がありません") => new AppError(403, "forbidden", msg);
export const notFound = (what = "record") => new AppError(404, "not_found", `${what} が見つかりません`);
export const conflict = (msg: string, details?: unknown) => new AppError(409, "conflict", msg, details);
export const tooMany = (msg = "リクエストが多すぎます。しばらく待ってください") => new AppError(429, "rate_limited", msg);
