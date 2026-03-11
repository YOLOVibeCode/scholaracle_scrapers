import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  getSystemPrompt,
  getGeneratePrompt,
  getTroubleshootPrompt,
  getAdvisorPrompt,
  getParseHtmlPrompt,
  getParseHtmlMaxChars,
  getNormalizeCoursePrompt,
} from './prompts';

export type AiProvider = 'openai' | 'anthropic' | 'gemini';

/**
 * Unified AI client supporting OpenAI, Anthropic, and Gemini APIs.
 * Used for scraper generation and troubleshooting.
 */
export class AiClient {
  private readonly provider: AiProvider;
  private readonly apiKey: string;
  private readonly openai?: OpenAI;
  private readonly anthropic?: Anthropic;
  private readonly gemini?: GoogleGenerativeAI;

  constructor(provider: AiProvider, apiKey: string) {
    this.provider = provider;
    this.apiKey = apiKey;

    if (provider === 'openai') {
      this.openai = new OpenAI({ apiKey });
    } else if (provider === 'anthropic') {
      this.anthropic = new Anthropic({ apiKey });
    } else if (provider === 'gemini') {
      this.gemini = new GoogleGenerativeAI(apiKey);
    }
  }

  /**
   * Generate scraper code for a platform.
   */
  async generate(userPrompt: string): Promise<string> {
    const systemPrompt = getSystemPrompt();
    const fullPrompt = getGeneratePrompt(userPrompt);
    return this.chat(systemPrompt, fullPrompt);
  }

  /**
   * Analyze a scraper error and suggest fixes.
   */
  async troubleshoot(error: string, scraperCode: string): Promise<string> {
    const systemPrompt = getSystemPrompt();
    const fullPrompt = getTroubleshootPrompt(error, scraperCode);
    return this.chat(systemPrompt, fullPrompt);
  }

  /**
   * Extract structured data from HTML using the configured AI. Truncates HTML to stay within token limits.
   * Returns parsed JSON; throws if the AI response is not valid JSON.
   */
  async parseHtml(html: string, schema: string): Promise<Record<string, unknown>> {
    const maxChars = getParseHtmlMaxChars();
    const truncated = html.length > maxChars ? html.slice(0, maxChars) + '\n...[truncated]' : html;
    const systemPrompt = getParseHtmlPrompt(schema);
    const raw = await this.chat(systemPrompt, truncated);
    const trimmed = raw.trim();
    const jsonStr =
      trimmed.startsWith('```') && trimmed.includes('```', 3)
        ? trimmed.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim()
        : trimmed;
    return JSON.parse(jsonStr) as Record<string, unknown>;
  }

  /**
   * Generate an action plan for a student based on grade data, trends, and upcoming deadlines.
   */
  async advise(studentContext: string): Promise<string> {
    const systemPrompt =
      'You are an experienced academic advisor helping a parent support their child\'s education. ' +
      'Be specific, actionable, and empathetic. Prioritize by urgency. Use plain language.';
    const fullPrompt = getAdvisorPrompt(studentContext);
    return this.chat(systemPrompt, fullPrompt);
  }

  /**
   * Normalize course titles across SIS/LMS sources using AI.
   * Returns a map of raw title -> canonical title.
   */
  async normalizeCourseTitles(
    titles: ReadonlyArray<{ readonly raw: string; readonly provider: string; readonly period?: string }>,
  ): Promise<Record<string, string>> {
    if (titles.length === 0) return {};
    const systemPrompt =
      'You are a precise JSON generator. Return ONLY valid JSON. No markdown, no code fences, no explanation.';
    const userPrompt = getNormalizeCoursePrompt(titles);
    const raw = await this.chat(systemPrompt, userPrompt);
    const trimmed = raw.trim();
    const jsonStr =
      trimmed.startsWith('```') && trimmed.includes('```', 3)
        ? trimmed.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim()
        : trimmed;
    return JSON.parse(jsonStr) as Record<string, string>;
  }

  /**
   * Send a chat message with system + user prompt.
   */
  private async chat(systemPrompt: string, userPrompt: string): Promise<string> {
    if (this.provider === 'openai' && this.openai) {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 8000,
        temperature: 0.2,
      });
      return response.choices[0]?.message?.content ?? '';
    }

    if (this.provider === 'anthropic' && this.anthropic) {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      });
      const block = response.content[0];
      return block && 'text' in block ? block.text : '';
    }

    if (this.provider === 'gemini' && this.gemini) {
      const model = this.gemini.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: systemPrompt,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8000,
        },
      });
      const result = await model.generateContent(userPrompt);
      const response = result.response;
      return response.text() ?? '';
    }

    throw new Error(`Unknown AI provider: ${this.provider}`);
  }
}
