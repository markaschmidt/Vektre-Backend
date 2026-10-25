import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TRACE_ATTR, TRACE_SPAN_NAMES } from './otel-attributes.js';
import { TelemetryService } from './telemetry.service.js';
import { extractTraceCarrier } from './w3c-traceparent.js';
import { serializeTraceparent } from './w3c-traceparent.js';
import { currentSpan } from './trace-context.js';

@Injectable()
export class HttpTraceMiddleware implements NestMiddleware {
  constructor(private readonly telemetry: TelemetryService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const carrier = extractTraceCarrier(
      req.headers as Record<string, string | string[] | undefined>,
    );
    const route = req.route?.path ?? req.path ?? req.url;
    this.telemetry.bindContext(
      carrier,
      TRACE_SPAN_NAMES.httpServer,
      {
        [TRACE_ATTR.httpMethod]: req.method,
        [TRACE_ATTR.httpRoute]: String(route),
      },
      () => {
        const span = currentSpan();
        if (span) {
          res.setHeader('traceresponse', serializeTraceparent(span.context));
        }
        res.on('finish', () => {
          this.telemetry.addAttributes({
            [TRACE_ATTR.httpStatus]: res.statusCode,
          });
          if (span) this.telemetry.recordEndedSpan(span);
        });
        next();
      },
    );
  }
}
