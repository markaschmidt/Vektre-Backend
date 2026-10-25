/**
 * Minimal structured logging for the standalone Yjs/Hocuspocus process.
 * This runs outside Nest's DI graph (see yjs-server.ts), so it intentionally
 * does not depend on @nestjs/common's Logger — just consistent JSON lines
 * that are easy to grep/ingest from container logs.
 */

type LogFields = Record<string, unknown>;

function emit(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields?: LogFields,
): void {
  const line = JSON.stringify({
    level,
    event,
    ts: new Date().toISOString(),
    ...fields,
  });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const collabLog = {
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
};
