export class PreviewSupersededError extends Error {
  constructor() { super('A newer editor request replaced this request'); this.name = 'PreviewSupersededError' }
}
