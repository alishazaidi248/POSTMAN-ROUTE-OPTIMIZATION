export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static notFound(message = "Resource not found") {
    return new AppError(message, 404);
  }

  static forbidden(message = "Forbidden") {
    return new AppError(message, 403);
  }

  static unauthorized(message = "Unauthorized") {
    return new AppError(message, 401);
  }

  static badRequest(message = "Bad request", details?: unknown) {
    return new AppError(message, 400, details);
  }

  static conflict(message = "Conflict") {
    return new AppError(message, 409);
  }
}
