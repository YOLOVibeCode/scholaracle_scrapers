import { AiClient, type AiProvider } from './client';

// Mock OpenAI (create mock stored so parseHtml test can return JSON)
const openaiCreateMock = jest.fn().mockResolvedValue({
  choices: [{ message: { content: 'Generated scraper code here' } }],
});
jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: { create: openaiCreateMock },
      },
    })),
  };
});

// Mock Anthropic
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Generated scraper code here' }],
        }),
      },
    })),
  };
});

// Mock Gemini
jest.mock('@google/generative-ai', () => {
  const mockGenerateContent = jest.fn().mockResolvedValue({
    response: { text: () => 'Generated scraper code here (Gemini)' },
  });
  const mockGetGenerativeModel = jest.fn().mockReturnValue({
    generateContent: mockGenerateContent,
  });
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    })),
  };
});

describe('AiClient', () => {
  describe('constructor', () => {
    it('should create client with openai provider', () => {
      const client = new AiClient('openai', 'sk-test');
      expect(client).toBeDefined();
    });

    it('should create client with anthropic provider', () => {
      const client = new AiClient('anthropic', 'sk-test');
      expect(client).toBeDefined();
    });

    it('should create client with gemini provider', () => {
      const client = new AiClient('gemini', 'AIza-test');
      expect(client).toBeDefined();
    });
  });

  describe('generate()', () => {
    it('should send prompt to OpenAI and return response', async () => {
      const client = new AiClient('openai', 'sk-test');
      const result = await client.generate('Create a scraper for ParentSquare');
      expect(result).toContain('scraper code');
    });

    it('should send prompt to Anthropic and return response', async () => {
      const client = new AiClient('anthropic', 'sk-test');
      const result = await client.generate('Create a scraper for ParentSquare');
      expect(result).toContain('scraper code');
    });

    it('should send prompt to Gemini and return response', async () => {
      const client = new AiClient('gemini', 'AIza-test');
      const result = await client.generate('Create a scraper for ParentSquare');
      expect(result).toContain('scraper code');
      expect(result).toContain('Gemini');
    });

    it('should return a non-empty string from generate', async () => {
      const client = new AiClient('openai', 'sk-test');
      const result = await client.generate('Create a scraper');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('troubleshoot()', () => {
    it('should analyze error with OpenAI', async () => {
      const client = new AiClient('openai', 'sk-test');
      const result = await client.troubleshoot(
        'TimeoutError: waiting for selector #email',
        'await page.fill("#email", email);',
      );
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should analyze error with Anthropic', async () => {
      const client = new AiClient('anthropic', 'sk-test');
      const result = await client.troubleshoot(
        'Login failed',
        'scraper code here',
      );
      expect(result).toBeDefined();
    });
  });

  describe('parseHtml()', () => {
    it('should call chat and return parsed JSON', async () => {
      openaiCreateMock.mockResolvedValueOnce({
        choices: [{ message: { content: '{"courses":[{"name":"Math","grade":"A"}]}' } }],
      });
      const client = new AiClient('openai', 'sk-test');
      const result = await client.parseHtml('<table><tr><td>Math</td><td>A</td></tr></table>', 'courses: array of { name, grade }');
      expect(result).toEqual({ courses: [{ name: 'Math', grade: 'A' }] });
    });

    it('should strip markdown code fence when present', async () => {
      openaiCreateMock.mockResolvedValueOnce({
        choices: [{ message: { content: '```json\n{"courses":[]}\n```' } }],
      });
      const client = new AiClient('openai', 'sk-test');
      const result = await client.parseHtml('<div>empty</div>', 'courses: array');
      expect(result).toEqual({ courses: [] });
    });

    it('should throw when AI returns invalid JSON', async () => {
      openaiCreateMock.mockResolvedValueOnce({
        choices: [{ message: { content: 'not json at all' } }],
      });
      const client = new AiClient('openai', 'sk-test');
      await expect(client.parseHtml('<div/>', 'x')).rejects.toThrow(SyntaxError);
    });
  });

  describe('normalizeCourseTitles()', () => {
    it('should return parsed JSON map from AI response', async () => {
      const mockResponse = JSON.stringify({
        'ALGEBRA 1': 'ALGEBRA 1',
        'algebra': 'ALGEBRA 1',
        'BIOLOGY': 'BIOLOGY',
        'biology': 'BIOLOGY',
      });
      openaiCreateMock.mockResolvedValueOnce({
        choices: [{ message: { content: mockResponse } }],
      });
      const client = new AiClient('openai', 'sk-test');
      const result = await client.normalizeCourseTitles([
        { raw: 'ALGEBRA 1', provider: 'skyward' },
        { raw: 'algebra', provider: 'canvas' },
        { raw: 'BIOLOGY', provider: 'skyward' },
        { raw: 'biology', provider: 'canvas' },
      ]);

      expect(result['ALGEBRA 1']).toBe('ALGEBRA 1');
      expect(result['algebra']).toBe('ALGEBRA 1');
      expect(result['BIOLOGY']).toBe('BIOLOGY');
    });

    it('should handle markdown-wrapped JSON response', async () => {
      openaiCreateMock.mockResolvedValueOnce({
        choices: [{ message: { content: '```json\n{"ART 1":"ART 1","art":"ART 1"}\n```' } }],
      });
      const client = new AiClient('openai', 'sk-test');
      const result = await client.normalizeCourseTitles([
        { raw: 'ART 1', provider: 'skyward' },
        { raw: 'art', provider: 'canvas' },
      ]);
      expect(result['art']).toBe('ART 1');
    });

    it('should return empty object for empty input', async () => {
      const client = new AiClient('openai', 'sk-test');
      const result = await client.normalizeCourseTitles([]);
      expect(result).toEqual({});
    });
  });
});
