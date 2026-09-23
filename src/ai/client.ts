import axios from 'axios';
import { getSystemPrompt, getGeneratePrompt, getTroubleshootPrompt } from './prompts';

type ScraperAssistPurpose = 'generate' | 'troubleshoot';

/**
 * Model help for writing or repairing a scraper, through the Scholaracle API.
 * A scrape run never calls this: navigation is generated code, and linking
 * data across sources happens on the API after ingest.
 */
export class AiClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly connectorToken: string
  ) {}

  async generate(userPrompt: string): Promise<string> {
    return this.assist('generate', getSystemPrompt(), getGeneratePrompt(userPrompt));
  }

  async troubleshoot(error: string, scraperCode: string): Promise<string> {
    return this.assist('troubleshoot', getSystemPrompt(), getTroubleshootPrompt(error, scraperCode));
  }

  private async assist(
    purpose: ScraperAssistPurpose,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const base = this.apiBaseUrl.replace(/\/$/, '');
    const res = await axios.post<{ content?: string }>(
      `${base}/api/ingest/v1/ai/scraper-assist`,
      { purpose, system: systemPrompt, prompt: userPrompt, maxTokens: 8000 },
      {
        headers: { Authorization: `Bearer ${this.connectorToken}` },
        timeout: 120_000,
      }
    );
    if (typeof res.data.content !== 'string') {
      throw new Error('Scholaracle API returned no model content');
    }
    return res.data.content;
  }
}
