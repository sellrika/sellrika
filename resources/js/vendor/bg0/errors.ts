export type BackgroundRemovalErrorCode =
  | 'unsupported-image'
  | 'image-too-large'
  | 'decode-failed'
  | 'model-load-failed'
  | 'out-of-memory'
  | 'inference-failed'
  | 'cancelled'

export class BackgroundRemovalError extends Error {
  readonly code: BackgroundRemovalErrorCode

  constructor(
    code: BackgroundRemovalErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'BackgroundRemovalError'
    this.code = code
  }
}

export function normalizeError(error: unknown): BackgroundRemovalError {
  if (error instanceof BackgroundRemovalError) return error

  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (
    message.includes('memory') ||
    message.includes('allocation') ||
    message.includes('bad_alloc')
  ) {
    return new BackgroundRemovalError(
      'out-of-memory',
      'This image needs more memory than your browser can provide. Try a smaller image.',
      { cause: error },
    )
  }

  return new BackgroundRemovalError(
    'inference-failed',
    'Local processing could not finish. Try again or use a smaller image.',
    { cause: error },
  )
}
