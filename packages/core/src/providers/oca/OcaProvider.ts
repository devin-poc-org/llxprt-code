/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Oracle Code Assist (OCA) Provider
 * 
 * This provider integrates Oracle Code Assist with llxprt-code, supporting:
 * - OAuth/PKCE authentication
 * - Internal and external OCA endpoints
 * - Prompt caching
 * - Extended thinking (reasoning)
 * - Cost calculation
 */

import OpenAI from 'openai';
import type { APIError } from 'openai';
import type { FinalRequestOptions, Headers as OpenAIHeaders } from 'openai/core';
import { IContent, TextBlock, ToolCallBlock } from '../../services/history/IContent.js';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { BaseProvider, NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { DebugLogger } from '../../debug/index.js';
import { IModel } from '../IModel.js';
import { IProvider } from '../IProvider.js';
import { retryWithBackoff } from '../../utils/retry.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { OAuthManager } from '../../auth/precedence.js';
import {
  DEFAULT_EXTERNAL_OCA_BASE_URL,
  DEFAULT_INTERNAL_OCA_BASE_URL,
  OCI_HEADER_OPC_REQUEST_ID,
} from './auth/constants.js';
import { createOcaHeaders } from './auth/utils.js';
import type { OcaMode } from './auth/types.js';

export interface OcaProviderConfig extends IProviderConfig {
  ocaMode?: OcaMode;
  ocaBaseUrl?: string;
  ocaModelId?: string;
  thinkingBudgetTokens?: number;
  ocaUsePromptCache?: boolean;
  taskId?: string;
}

export class OcaProvider extends BaseProvider implements IProvider {
  override readonly name: string = 'oca';
  
  private getLogger(): DebugLogger {
    return new DebugLogger('llxprt:provider:oca');
  }

  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    config?: OcaProviderConfig,
    oauthManager?: OAuthManager,
  ) {
    const normalizedApiKey = apiKey && apiKey.trim() !== '' ? apiKey : undefined;

    // Initialize base provider with auth configuration
    super(
      {
        name: 'oca',
        apiKey: normalizedApiKey,
        baseURL,
        envKeyNames: ['OCA_API_KEY', 'ORACLE_API_KEY'],
        isOAuthEnabled: !!oauthManager,
        oauthProvider: 'oca',
        oauthManager,
      },
      config,
    );
  }

  /**
   * Create a custom OpenAI client that adds OCA-specific headers
   */
  private createOcaClient(
    authToken: string,
    baseURL: string,
    taskId?: string,
  ): OpenAI {
    const self = this;
    
    return new (class OCAOpenAI extends OpenAI {
      protected override async prepareOptions(opts: FinalRequestOptions<unknown>): Promise<void> {
        if (!authToken) {
          throw new Error('Unable to handle auth, Oracle Code Assist (OCA) access token is not available');
        }
        
        opts.headers ??= {};
        
        const ocaHeaders = await createOcaHeaders(authToken, taskId);
        opts.headers = { ...opts.headers, ...ocaHeaders };
        
        self.getLogger().debug(() => `Making request with opc-request-id: ${opts.headers?.['opc-request-id']}`);
        
        return super.prepareOptions(opts);
      }

      protected override makeStatusError(
        status: number | undefined,
        error: Object | undefined,
        message: string | undefined,
        headers: OpenAIHeaders | undefined,
      ): APIError {
        interface OciError {
          code?: string;
          message?: string;
        }
        
        let ociErrorMessage = message;
        if (typeof error === 'object' && error !== null) {
          try {
            ociErrorMessage = JSON.stringify(error);
            const ociErr = error as OciError;
            if (ociErr.code !== undefined && ociErr.message !== undefined) {
              ociErrorMessage = `${ociErr.code}: ${ociErr.message}`;
            }
          } catch {
          }
        }
        
        const opcRequestId = headers?.[OCI_HEADER_OPC_REQUEST_ID];
        if (opcRequestId) {
          ociErrorMessage += `\n(${OCI_HEADER_OPC_REQUEST_ID}: ${opcRequestId})`;
        }
        
        return super.makeStatusError(status, error, ociErrorMessage, headers);
      }
    })({
      baseURL,
      apiKey: 'noop', // OCA uses Bearer token in headers, not API key
    });
  }

  /**
   * Get the OCA client for the current request
   */
  protected async getClient(
    options: NormalizedGenerateChatOptions,
  ): Promise<OpenAI> {
    const authToken = await resolveRuntimeAuthToken(options.resolved.authToken) ?? '';
    if (!authToken) {
      throw new Error(
        `OCA auth token unavailable for runtimeId=${options.runtime?.runtimeId}`,
      );
    }

    const ocaConfig = this.providerConfig as OcaProviderConfig;
    const ocaMode = ocaConfig?.ocaMode ?? 
      (options.settings?.getProviderSettings(this.name)?.ocaMode as OcaMode | undefined) ?? 
      'external';
    
    const baseURL = options.resolved.baseURL ?? 
      ocaConfig?.ocaBaseUrl ?? 
      (ocaMode === 'internal' ? DEFAULT_INTERNAL_OCA_BASE_URL : DEFAULT_EXTERNAL_OCA_BASE_URL);
    
    const taskId = ocaConfig?.taskId ?? 
      (options.metadata?.taskId as string | undefined);

    return this.createOcaClient(authToken, baseURL, taskId);
  }

  /**
   * Calculate cost for OCA usage
   */
  private async calculateCost(
    client: OpenAI,
    authToken: string,
    modelId: string,
    promptTokens: number,
    completionTokens: number,
    taskId?: string,
  ): Promise<number | undefined> {
    try {
      const ocaHeaders = await createOcaHeaders(authToken, taskId);
      
      const response = await fetch(`${client.baseURL}/spend/calculate`, {
        method: 'POST',
        headers: ocaHeaders,
        body: JSON.stringify({
          completion_response: {
            model: modelId,
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
            },
          },
        }),
      });

      if (response.ok) {
        const data: { cost: number } = await response.json();
        return data.cost;
      } else {
        this.getLogger().debug(() => `Error calculating spend: ${response.statusText}`);
        return undefined;
      }
    } catch (error) {
      this.getLogger().debug(() => `Error calculating spend: ${error}`);
      return undefined;
    }
  }

  /**
   * Check if OAuth is supported for OCA
   */
  protected supportsOAuth(): boolean {
    return true;
  }

  override async getModels(): Promise<IModel[]> {
    try {
      return this.getFallbackModels();
    } catch (error) {
      this.getLogger().debug(() => `Error fetching models from OCA: ${error}`);
      return this.getFallbackModels();
    }
  }

  private getFallbackModels(): IModel[] {
    return [
      {
        id: 'oca-claude-3-5-sonnet',
        name: 'OCA Claude 3.5 Sonnet',
        provider: 'oca',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'oca-gpt-4o',
        name: 'OCA GPT-4o',
        provider: 'oca',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'oca-o1-mini',
        name: 'OCA O1 Mini',
        provider: 'oca',
        supportedToolFormats: ['openai'],
      },
    ];
  }

  override getDefaultModel(): string {
    return process.env.LLXPRT_DEFAULT_OCA_MODEL || 'oca-claude-3-5-sonnet';
  }

  override getCurrentModel(): string {
    return this.getModel();
  }

  override getServerTools(): string[] {
    return [];
  }

  override async invokeServerTool(
    toolName: string,
    _params: unknown,
    _config?: unknown,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    throw new Error(`Server tool '${toolName}' not supported by OCA provider`);
  }

  /**
   * Convert llxprt IContent to OpenAI messages format
   */
  private convertToOpenAIMessages(
    contents: IContent[],
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (const content of contents) {
      if (content.role === 'user' || content.role === 'assistant') {
        const textBlocks = content.parts?.filter(
          (p): p is TextBlock => p.type === 'text',
        ) ?? [];
        const textContent = textBlocks.map((b) => b.text).join('\n');

        const toolCalls = content.parts?.filter(
          (p): p is ToolCallBlock => p.type === 'tool_call',
        ) ?? [];

        if (content.role === 'user') {
          messages.push({
            role: 'user',
            content: textContent,
          });
        } else {
          if (toolCalls.length > 0) {
            messages.push({
              role: 'assistant',
              content: textContent || null,
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.parameters),
                },
              })),
            });
          } else {
            messages.push({
              role: 'assistant',
              content: textContent,
            });
          }
        }
      } else if (content.role === 'tool') {
        const toolResponse = content.parts?.[0];
        if (toolResponse && 'tool_call_id' in toolResponse) {
          messages.push({
            role: 'tool',
            tool_call_id: toolResponse.tool_call_id,
            content: JSON.stringify(toolResponse.content),
          });
        }
      }
    }

    return messages;
  }

  /**
   * Main chat completion implementation
   */
  protected async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const client = await this.getClient(options);
    const authToken = await resolveRuntimeAuthToken(options.resolved.authToken) ?? '';
    
    const ocaConfig = this.providerConfig as OcaProviderConfig;
    const modelId = options.resolved.model || this.getDefaultModel();
    const taskId = ocaConfig?.taskId ?? (options.metadata?.taskId as string | undefined);

    const formattedMessages = this.convertToOpenAIMessages(options.contents);

    const systemPrompt = options.userMemory || '';
    if (systemPrompt) {
      formattedMessages.unshift({
        role: 'system',
        content: systemPrompt,
      });
    }

    // Configuration for extended thinking
    const budgetTokens = ocaConfig?.thinkingBudgetTokens || 0;
    const reasoningOn = budgetTokens !== 0;
    const thinkingConfig = reasoningOn ? { type: 'enabled', budget_tokens: budgetTokens } : undefined;

    const isOminiModel = modelId.includes('o1-mini') || modelId.includes('o3-mini') || modelId.includes('o4-mini');
    let temperature: number | undefined = 0;
    if (isOminiModel && reasoningOn) {
      temperature = undefined;
    }

    const usePromptCache = ocaConfig?.ocaUsePromptCache ?? false;
    const cacheControl = usePromptCache ? { cache_control: { type: 'ephemeral' } } : undefined;

    if (cacheControl && formattedMessages[0]?.role === 'system') {
      (formattedMessages[0] as any).cache_control = cacheControl.cache_control;
    }

    if (cacheControl) {
      const userMsgIndices: number[] = [];
      formattedMessages.forEach((msg, index) => {
        if (msg.role === 'user') {
          userMsgIndices.push(index);
        }
      });
      
      const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1];
      const secondLastUserMsgIndex = userMsgIndices[userMsgIndices.length - 2];
      
      if (lastUserMsgIndex !== undefined) {
        (formattedMessages[lastUserMsgIndex] as any).cache_control = cacheControl.cache_control;
      }
      if (secondLastUserMsgIndex !== undefined) {
        (formattedMessages[secondLastUserMsgIndex] as any).cache_control = cacheControl.cache_control;
      }
    }

    const tools = options.tools?.[0]?.functionDeclarations?.map((fd) => ({
      type: 'function' as const,
      function: {
        name: fd.name,
        description: fd.description,
        parameters: fd.parametersJsonSchema || fd.parameters,
      },
    }));

    const makeRequest = async () => {
      return await client.chat.completions.create({
        model: modelId,
        messages: formattedMessages,
        temperature,
        stream: true,
        max_tokens: 4096,
        stream_options: { include_usage: true },
        ...(thinkingConfig && { thinking: thinkingConfig }),
        ...(tools && tools.length > 0 && { tools }),
        ...(taskId && { litellm_session_id: `cline-${taskId}` }),
      } as any);
    };

    const stream = await retryWithBackoff(makeRequest, {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
    });

    const inputCost = (await this.calculateCost(client, authToken, modelId, 1e6, 0, taskId)) || 0;
    const outputCost = (await this.calculateCost(client, authToken, modelId, 0, 1e6, taskId)) || 0;

    let accumulatedText = '';
    let accumulatedToolCalls: Array<{
      index: number;
      id?: string;
      name?: string;
      arguments?: string;
    }> = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      // Handle normal text content
      if (delta?.content) {
        accumulatedText += delta.content;
        yield {
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: delta.content,
            },
          ],
        };
      }

      if ((delta as any)?.thinking) {
        yield {
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: `[Thinking: ${(delta as any).thinking}]`,
            },
          ],
        };
      }

      // Handle tool calls
      if (delta?.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index;
          
          if (!accumulatedToolCalls[index]) {
            accumulatedToolCalls[index] = {
              index,
              id: toolCallDelta.id,
              name: toolCallDelta.function?.name,
              arguments: toolCallDelta.function?.arguments || '',
            };
          } else {
            if (toolCallDelta.id) {
              accumulatedToolCalls[index].id = toolCallDelta.id;
            }
            if (toolCallDelta.function?.name) {
              accumulatedToolCalls[index].name = toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              accumulatedToolCalls[index].arguments += toolCallDelta.function.arguments;
            }
          }
        }
      }

      // Handle token usage information
      if (chunk.usage) {
        const usage = chunk.usage as {
          prompt_tokens: number;
          completion_tokens: number;
          cache_creation_input_tokens?: number;
          prompt_cache_miss_tokens?: number;
          cache_read_input_tokens?: number;
          prompt_cache_hit_tokens?: number;
        };

        const totalCost =
          (inputCost * usage.prompt_tokens) / 1e6 +
          (outputCost * usage.completion_tokens) / 1e6;

        const cacheWriteTokens = usage.cache_creation_input_tokens || usage.prompt_cache_miss_tokens || 0;
        const cacheReadTokens = usage.cache_read_input_tokens || usage.prompt_cache_hit_tokens || 0;

        yield {
          role: 'assistant',
          parts: [],
          metadata: {
            usage: {
              inputTokens: usage.prompt_tokens || 0,
              outputTokens: usage.completion_tokens || 0,
              cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
              cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
              totalCost,
            },
          },
        };
      }
    }

    if (accumulatedToolCalls.length > 0) {
      const toolCallParts: ToolCallBlock[] = accumulatedToolCalls
        .filter((tc) => tc.id && tc.name)
        .map((tc) => ({
          type: 'tool_call',
          id: tc.id!,
          name: tc.name!,
          parameters: tc.arguments ? JSON.parse(tc.arguments) : {},
        }));

      if (toolCallParts.length > 0) {
        yield {
          role: 'assistant',
          parts: toolCallParts,
        };
      }
    }
  }
}
