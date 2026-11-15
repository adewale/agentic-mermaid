/* SPDX-License-Identifier: EPL-2.0 */
export class IllegalStateException extends Error {
  constructor(message = '', options?: ErrorOptions) { super(message, options); this.name = 'IllegalStateException' }
  override toString(): string { return 'java.lang.IllegalStateException' + (this.message ? ': ' + this.message : '') }
}
