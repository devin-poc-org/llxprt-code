/**
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OCA-specific configuration types
 */

export interface OcaConfig {
  /**
   * Mode: 'internal' or 'external'
   */
  mode?: 'internal' | 'external';

  /**
   * Base URL for OCA API
   * Overrides default URL based on mode
   */
  baseUrl?: string;

  /**
   * Model ID to use with OCA
   */
  modelId?: string;

  /**
   * Enable extended thinking
   */
  enableThinking?: boolean;

  /**
   * Thinking budget in tokens
   */
  thinkingBudgetTokens?: number;

  /**
   * Enable prompt caching
   */
  enablePromptCache?: boolean;
}
