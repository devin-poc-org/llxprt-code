/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Oracle Code Assist (OCA) provider-specific types
 */

export interface OcaModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  temperature?: number;
  supportsThinking?: boolean;
  supportsPromptCache?: boolean;
}

export interface OcaCostInfo {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheWriteCostPerMillion?: number;
  cacheReadCostPerMillion?: number;
}

export interface OcaUsageInfo {
  promptTokens: number;
  completionTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalCost?: number;
}
