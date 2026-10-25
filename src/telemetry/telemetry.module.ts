import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HttpTraceMiddleware } from './http-trace.middleware.js';
import { TelemetryService } from './telemetry.service.js';

@Global()
@Module({
  providers: [TelemetryService, HttpTraceMiddleware],
  exports: [TelemetryService],
})
export class TelemetryModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpTraceMiddleware).forRoutes('*');
  }
}
