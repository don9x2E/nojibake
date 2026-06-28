export const resultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/don9x2E/nojibake/schemas/result-envelope.json',
  title: 'Nojibake Result Envelope',
  type: 'object',
  required: ['schemaVersion', 'toolVersion', 'invocationId', 'ok', 'command', 'summary', 'data', 'errors', 'warnings'],
  properties: {
    schemaVersion: { type: 'string' },
    toolVersion: { type: 'string' },
    invocationId: { type: 'string' },
    ok: { type: 'boolean' },
    command: { type: 'string' },
    summary: { type: 'string' },
    data: {},
    errors: { type: 'array' },
    warnings: { type: 'array' }
  },
  additionalProperties: false
} as const;
