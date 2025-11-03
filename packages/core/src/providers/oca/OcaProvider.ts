/**
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { IContent } from '../../services/history/IContent.js';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { BaseProvider } from '../BaseProvider.js';
import { DebugLogger } from '../../debug/index.js';
import { OAuthManager } from '../../auth/precedence.js';
import { IModel } from '../IModel.js';
import { IProvider } from '../IProvider.js';
import {
  DEFAULT_INTERNAL_OCA_BASE_URL,
  DEFAULT_EXTERNAL_OCA_BASE_URL,
  DEFAULT_OCA_MODEL,
  OCI_HEADER_OPC_REQUEST_ID,
} from './constants.js';
import type { OcaConfig } from './types.js';

export class OcaProvider extends BaseProvider implements IProvider {
  override readonly name: string = 'oca';
  private logger: DebugLogger;
  private _cachedClient?: OpenAI;
  private _cachedClientKey?: string;
  private ocaConfig: OcaConfig;

  constructor(
    apiKey?: string,
    baseURL?: string,
    config?: IProviderConfig & { ocaConfig?: OcaConfig },
    oauthManager?: OAuthManager,
  ) {
    super(
      {
        name: 'oca',
        apiKey,
        baseURL,
        envKeyNames: ['OCA_API_KEY'],
        isOAuthEnabled: !!oauthManager,
        oauthProvider: oauthManager ? 'oca' : undefined,
        oauthManager,
      },
      config,
    );

    this.logger = new DebugLogger('llxprt:provider:oca');
    this.ocaConfig = config?.ocaConfig || {};
  }

  protected supportsOAuth(): boolean {
    return true;
  }

  private getOcaBaseUrl(): string {
    const baseUrl = this.getBaseURL();
    if (baseUrl) {
      return baseUrl;
    }

    const mode = this.ocaConfig.mode || 'external';
    return mode === 'internal'
      ? DEFAULT_INTERNAL_OCA_BASE_URL
      : DEFAULT_EXTERNAL_OCA_BASE_URL;
  }

  private async createOciHeaders(
    token: string,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      [OCI_HEADER_OPC_REQUEST_ID]: uuidv4(),
    };
    return headers;
  }

  private async getClient(): Promise<OpenAI> {
    const token = await this.getAuthToken();
    const baseUrl = this.getOcaBaseUrl();
    const cacheKey = `${baseUrl}:${token.substring(0, 10)}`;

    if (this._cachedClient && this._cachedClientKey === cacheKey) {
      return this._cachedClient;
    }

    const ociHeaders = await this.createOciHeaders(token);

    this._cachedClient = new OpenAI({
      apiKey: token || 'dummy',
      baseURL: baseUrl,
      defaultHeaders: ociHeaders,
    });
    this._cachedClientKey = cacheKey;

    return this._cachedClient;
  }

  async getModels(): Promise<IModel[]> {
    return [
      {
        id: DEFAULT_OCA_MODEL,
        name: 'Command R+',
        contextWindow: 128000,
        provider: 'oca',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'meta/llama-3.1-70b-instruct',
        name: 'Llama 3.1 70B',
        contextWindow: 128000,
        provider: 'oca',
        supportedToolFormats: ['openai'],
      },
    ];
  }

  getDefaultModel(): string {
    return this.ocaConfig.modelId || DEFAULT_OCA_MODEL;
  }

  override clearAuthCache(): void {
    super.clearAuthCache();
    this._cachedClient = undefined;
    this._cachedClientKey = undefined;
  }

  async *generateChatCompletion(
    content: IContent[],
    _tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parametersJsonSchema?: unknown;
      }>;
    }>,
    _signal?: AbortSignal,
  ): AsyncIterableIterator<IContent> {
    const client = await this.getClient();
    const model = this.getDefaultModel();

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = content.map(
      (item) => {
        const role = item.speaker === 'human' ? 'user' : 'assistant';
        const textContent = item.blocks
          .filter((b) => b.type === 'text')
          .map((b) => ('text' in b ? b.text : ''))
          .join('\n');

        return { role, content: textContent };
      },
    );

    try {
      const stream = await client.chat.completions.create({
        model,
        messages,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: delta.content,
              },
            ],
          };
        }
      }
    } catch (error) {
      this.logger.error(() => `OCA API error: ${error}`);
      throw error;
    }
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
    throw new Error(
      `Server tool '${toolName}' not supported by OCA provider`,
    );
  }
}
