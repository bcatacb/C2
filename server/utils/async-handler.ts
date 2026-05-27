import type { Request, Response, NextFunction, RequestHandler } from 'express'

export function asyncH(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch((err: Error) => {
      console.error(`[${req.method} ${req.path}]`, err.message)
      res.status(500).json({ error: err.message })
    })
  }
}
