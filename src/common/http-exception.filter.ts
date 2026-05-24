import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { FileLoggerService } from './logger.service';

interface MinimalRequest {
  method: string;
  originalUrl?: string;
  url?: string;
  ip?: string;
}

interface MinimalResponse {
  headersSent: boolean;
  status(code: number): MinimalResponse;
  json(body: unknown): MinimalResponse;
}

/**
 * Catches every exception that bubbles out of an HTTP controller (e.g. the
 * health endpoints) and logs it before returning the standard error response.
 * Without this, Nest only logs at WARN level for HttpException and silently
 * swallows non-HTTP errors. With it, the Render console always shows what
 * went wrong on a failed cron ping / browser hit.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  constructor(private readonly fileLogger: FileLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<MinimalResponse>();
    const req = ctx.getRequest<MinimalRequest>();
    const url = req.originalUrl ?? req.url ?? '';

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: 500, message: 'Internal server error' };

    this.logger.error(
      `${req.method} ${url} -> ${status} ${(exception as Error)?.message || ''}`,
    );
    this.fileLogger.logError('http-exception', exception, {
      method: req.method,
      url,
      status,
      ip: req.ip,
    });

    if (!res.headersSent) {
      res.status(status).json(typeof message === 'string' ? { message } : message);
    }
  }
}
