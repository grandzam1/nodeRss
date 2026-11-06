/** HTTP-aware error. `status` maps to the response code; `message` is safe to show users. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
