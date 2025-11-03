/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuthProvider } from './oauth-manager.js';
import { OAuthToken, TokenStore } from './types.js';
import { HistoryItemWithoutId } from '../ui/types.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';

export class OcaOAuthProvider implements OAuthProvider {
  readonly name = 'oca';
  private currentToken: OAuthToken | null = null;
  private tokenStore?: TokenStore;
  private logger: DebugLogger;
  private _addItem?: (
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ) => number;

  constructor(
    tokenStore?: TokenStore,
    addItem?: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp: number,
    ) => number,
  ) {
    this.tokenStore = tokenStore;
    this._addItem = addItem;
    this.logger = new DebugLogger('llxprt:auth:oca');

    if (!tokenStore) {
      console.warn(
        `DEPRECATION: ${this.name} OAuth provider created without TokenStore. ` +
          `Token persistence will not work. Please update your code.`,
      );
    }
  }

  setAddItem(
    addItem: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp: number,
    ) => number,
  ): void {
    this._addItem = addItem;
  }

  async initializeToken(): Promise<void> {
    if (!this.tokenStore) {
      return;
    }

    try {
      const savedToken = await this.tokenStore.getToken('oca');
      if (savedToken) {
        this.currentToken = savedToken;
      }
    } catch (error) {
      this.logger.debug(() => `Failed to load OCA token: ${error}`);
    }
  }

  async initiateAuth(): Promise<void> {
    throw new Error(
      'OCA OAuth flow must be initiated through the OAuth manager',
    );
  }

  async getToken(): Promise<OAuthToken | null> {
    if (!this.currentToken && this.tokenStore) {
      try {
        this.currentToken = await this.tokenStore.getToken('oca');
      } catch (error) {
        this.logger.debug(() => `Failed to get OCA token: ${error}`);
        return null;
      }
    }
    return this.currentToken;
  }

  async refreshIfNeeded(): Promise<OAuthToken | null> {
    if (!this.currentToken) {
      return null;
    }

    const now = Date.now() / 1000;
    const expiresAt = this.currentToken.expiry;

    if (expiresAt && expiresAt <= now + 30) {
      this.currentToken = null;
      if (this.tokenStore) {
        try {
          await this.tokenStore.removeToken('oca');
        } catch (error) {
          this.logger.debug(() => `Failed to remove expired OCA token: ${error}`);
        }
      }
      return null;
    }

    return this.currentToken;
  }

  async logout(): Promise<void> {
    this.currentToken = null;
    if (this.tokenStore) {
      try {
        await this.tokenStore.removeToken('oca');
      } catch (error) {
        this.logger.debug(() => `Failed to remove OCA token: ${error}`);
      }
    }
  }
}
