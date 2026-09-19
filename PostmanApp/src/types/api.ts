export interface ApiErrorBody {
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;
  readonly isNetworkError: boolean;

  constructor(message: string, statusCode: number, details?: unknown, isNetworkError = false) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isNetworkError = isNetworkError;
  }
}

export interface PaginatedResponse<T> {
  total: number;
  page: number;
  pageSize: number;
  rows: T[];
}
