/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Oracle Code Assist (OCA) authentication utilities
 */

import crypto from 'crypto';
import type { OcaHeaders, OcaConfig } from './types.js';
import {
  OCI_HEADER_OPC_REQUEST_ID,
  OCI_HEADER_AUTHORIZATION,
  CODE_VERIFIER_LENGTH,
  NONCE_LENGTH,
} from './constants.js';

/**
 * Generate a cryptographically secure random string
 */
export function generateRandomString(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomBytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[randomBytes[i] % charset.length];
  }
  return result;
}

/**
 * Generate a PKCE code verifier
 */
export function generateCodeVerifier(): string {
  return generateRandomString(CODE_VERIFIER_LENGTH);
}

/**
 * Generate a PKCE code challenge from a verifier using SHA256
 */
export function pkceChallengeFromVerifier(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate a random nonce for OIDC
 */
export function generateNonce(): string {
  return generateRandomString(NONCE_LENGTH);
}

/**
 * Create OCA-specific headers for API requests
 */
export async function createOcaHeaders(
  token: string,
  taskId?: string,
): Promise<OcaHeaders> {
  const requestId = taskId
    ? `cline-${taskId}-${Date.now()}`
    : `cline-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  return {
    [OCI_HEADER_AUTHORIZATION]: `Bearer ${token}`,
    [OCI_HEADER_OPC_REQUEST_ID]: requestId,
    'Content-Type': 'application/json',
  };
}

/**
 * Get OCA configuration from environment or defaults
 */
export function getOcaConfig(): OcaConfig {
  return {
    internal: {
      idcs_url:
        process.env.OCA_INTERNAL_IDCS_URL ||
        'https://idcs-internal.oracle.com',
      client_id: process.env.OCA_INTERNAL_CLIENT_ID || 'internal-client-id',
      scopes: process.env.OCA_INTERNAL_SCOPES || 'openid profile email',
    },
    external: {
      idcs_url:
        process.env.OCA_EXTERNAL_IDCS_URL ||
        'https://idcs.oracle.com',
      client_id: process.env.OCA_EXTERNAL_CLIENT_ID || 'external-client-id',
      scopes: process.env.OCA_EXTERNAL_SCOPES || 'openid profile email',
    },
  };
}

/**
 * Get axios settings for OCA requests (proxy support, etc.)
 */
export function getAxiosSettings(): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    timeout: 30000,
  };

  if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
    settings.proxy = false; // Let axios handle proxy from env vars
  }

  return settings;
}
