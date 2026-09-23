import axios from 'axios';
import { AiClient } from './client';

jest.mock('axios');

const post = axios.post as jest.Mock;

describe('AiClient', () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ data: { content: 'Generated scraper code here' } });
  });

  it('sends a build request to the Scholaracle API with the connector token', async () => {
    const client = new AiClient('https://api.scholarmancy.com/', 'connector-token');
    const result = await client.generate('Create a scraper for ParentSquare');

    expect(result).toContain('scraper code');
    expect(post).toHaveBeenCalledWith(
      'https://api.scholarmancy.com/api/ingest/v1/ai/scraper-assist',
      expect.objectContaining({
        purpose: 'generate',
        prompt: expect.stringContaining('ParentSquare'),
      }),
      expect.objectContaining({ headers: { Authorization: 'Bearer connector-token' } })
    );
  });

  it('sends a repair request as troubleshoot', async () => {
    const client = new AiClient('https://api.scholarmancy.com', 'tok');
    await client.troubleshoot('selector #grades not found', 'await page.click("#grades")');
    expect(post.mock.calls[0]![1]).toEqual(expect.objectContaining({ purpose: 'troubleshoot' }));
  });

  it('throws when the API omits content', async () => {
    post.mockResolvedValueOnce({ data: {} });
    const client = new AiClient('https://api.scholarmancy.com', 'tok');
    await expect(client.generate('x')).rejects.toThrow('no model content');
  });
});
