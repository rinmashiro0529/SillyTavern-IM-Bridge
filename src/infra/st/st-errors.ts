import { AppError } from "../../shared/errors/app-error";

export function createStRequestError(pathname: string, status: number): AppError {
  return new AppError("ST_REQUEST_FAILED", `ST request failed: ${pathname} -> ${status}`, 502);
}

export function createStPayloadError(code: string, message: string): AppError {
  return new AppError(code, message, 502);
}

export function createStGenerateError(message: string): AppError {
  return new AppError("ST_GENERATE_FAILED", `ST generate failed: ${message}`, 502);
}
