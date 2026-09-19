import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/AppError";
import { logger } from "../config/logger";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.path}` } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: { message: "Validation failed", issues: err.issues }
    });
  }

  if (err instanceof AppError) {
    if (!err.isOperational) logger.error({ err }, "Non-operational AppError");
    return res.status(err.statusCode).json({
      error: { message: err.message, details: err.details }
    });
  }

  // Prisma errors are operational failures, not bugs — surface them as clean
  // 4xx responses instead of falling through to a generic 500. This covers
  // every unique-constraint route in the app (duplicate employee ID, email,
  // tracking ID, beat number, asset ID, ...) in one place rather than
  // needing a try/catch in each handler.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const fields = (err.meta?.target as string[] | undefined)?.join(", ") ?? "field";
      return res.status(409).json({ error: { message: `A record with this ${fields} already exists` } });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: { message: "Resource not found" } });
    }
  }

  logger.error({ err, path: req.path }, "Unhandled error");
  return res.status(500).json({ error: { message: "Internal server error" } });
}
