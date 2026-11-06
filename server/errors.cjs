// SPDX-License-Identifier: Apache-2.0
// Shared error types for the API server and its modules.
'use strict';

/** An error with an HTTP status code; app.cjs turns it into a JSON error response. */
class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

module.exports = { HttpError };
