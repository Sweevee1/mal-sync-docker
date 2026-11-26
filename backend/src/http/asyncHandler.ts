import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 does not catch rejected promises from async handlers; without this
// an anonymous bad input becomes an unhandled rejection and kills the process.
export function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
