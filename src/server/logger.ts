import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['password', '*.password', 'passwordHash', '*.passwordHash', 'token', '*.token'],
    censor: '[redacted]',
  },
})
