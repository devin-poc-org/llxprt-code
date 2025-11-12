/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Oracle Code Assist (OCA) authentication and API constants
 */

export const DEFAULT_INTERNAL_OCA_BASE_URL = 'https://internal-oca-endpoint.oracle.com/v1';
export const DEFAULT_EXTERNAL_OCA_BASE_URL = 'https://oca-api.oracle.com/v1';

export const OCI_HEADER_OPC_REQUEST_ID = 'opc-request-id';
export const OCI_HEADER_AUTHORIZATION = 'Authorization';

export const OCA_OAUTH_SCOPES = 'openid profile email';
export const OCA_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const PKCE_STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
export const CODE_VERIFIER_LENGTH = 128;
export const NONCE_LENGTH = 32;
