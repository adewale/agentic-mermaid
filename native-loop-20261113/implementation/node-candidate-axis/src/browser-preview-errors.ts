export class PreviewSupersededError extends Error {
  constructor() { super('A newer editor request replaced this request'); this.name = 'PreviewSupersededError' }
}

export class PreviewRuntimeLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'PreviewRuntimeLoadError' }
}
