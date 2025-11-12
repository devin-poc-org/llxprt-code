/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Oracle Code Assist (OCA) authentication types
 */

export interface OcaConfig {
  internal: {
    idcs_url: string;
    client_id: string;
    scopes: string;
  };
  external: {
    idcs_url: string;
    client_id: string;
    scopes: string;
  };
}

export interface PkceState {
  code_verifier: string;
  nonce: string;
  createdAt: number;
  redirect_uri: string;
}

export interface OcaAuthState {
  user?: OcaUserInfo;
  apiKey?: string;
}

export interface OcaUserInfo {
  uid: string;
  displayName: string;
  email: string;
}

export interface OcaTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
}

export interface OcaHeaders {
  'Authorization': string;
  'opc-request-id': string;
  'Content-Type'?: string;
}

export type OcaMode = 'internal' | 'external';
