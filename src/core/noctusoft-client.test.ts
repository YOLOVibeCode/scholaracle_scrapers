import { NoctusoftClient } from './noctusoft-client';
import type { IEmailOptions, ISmsOptions } from './noctusoft-client';

// Mock fetch globally
global.fetch = jest.fn();

afterEach(() => {
  jest.clearAllMocks();
});

describe('NoctusoftClient', () => {
  describe('constructor', () => {
    it('should create client with API key', () => {
      const client = new NoctusoftClient('test-api-key');
      expect(client).toBeDefined();
    });

    it('should create client without API key (Tailscale mode)', () => {
      const client = new NoctusoftClient();
      expect(client).toBeDefined();
    });
  });

  describe('sendEmail', () => {
    it('should send email with required fields only', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);

      const client = new NoctusoftClient('test-key');
      const options: IEmailOptions = {
        to: 'user@example.com',
        from: 'noreply@apirelay.us.noctusoft.com',
        subject: 'Test Email',
        text: 'Hello world',
      };

      await client.sendEmail(options);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.sndgrid.us.noctusoft.com/v3/mail/send',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'X-Api-Key': 'test-key',
            'Content-Type': 'application/json',
          },
        }),
      );
    });

    it('should send email with HTML body', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);

      const client = new NoctusoftClient('test-key');
      const options: IEmailOptions = {
        to: 'user@example.com',
        from: 'noreply@apirelay.us.noctusoft.com',
        subject: 'Test Email',
        html: '<p>Hello <strong>world</strong></p>',
      };

      await client.sendEmail(options);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs![1]!.body as string);
      expect(body.content[0].value).toBe('<p>Hello <strong>world</strong></p>');
    });

    it('should send email with reply_to', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);

      const client = new NoctusoftClient('test-key');
      const options: IEmailOptions = {
        to: 'user@example.com',
        from: 'noreply@apirelay.us.noctusoft.com',
        replyTo: 'support@example.com',
        subject: 'Test Email',
        text: 'Reply here',
      };

      await client.sendEmail(options);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs![1]!.body as string);
      expect(body.reply_to.email).toBe('support@example.com');
    });

    it('should work without API key (Tailscale)', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);

      const client = new NoctusoftClient();
      const options: IEmailOptions = {
        to: 'user@example.com',
        from: 'noreply@apirelay.us.noctusoft.com',
        subject: 'Test Email',
        text: 'Hello',
      };

      await client.sendEmail(options);

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs![1]!.headers as Record<string, string>;
      expect(headers['X-Api-Key']).toBeUndefined();
    });

    it('should throw on API error', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Invalid email' }),
      } as Response);

      const client = new NoctusoftClient('test-key');
      const options: IEmailOptions = {
        to: 'invalid',
        from: 'noreply@apirelay.us.noctusoft.com',
        subject: 'Test',
        text: 'Test',
      };

      await expect(client.sendEmail(options)).rejects.toThrow(
        'Noctusoft email failed: 400 Bad Request',
      );
    });
  });

  describe('sendSms', () => {
    it('should send SMS with required fields', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sid: 'SM123' }),
      } as Response);

      const client = new NoctusoftClient('test-key');
      const options: ISmsOptions = {
        to: '+15551234567',
        body: 'Test SMS message',
      };

      const result = await client.sendSms(options);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.twilio.us.noctusoft.com/2010-04-01/Accounts/REDACTED/Messages.json',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'X-Api-Key': 'test-key',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }),
      );
      expect(result.sid).toBe('SM123');
    });

    it('should send SMS with custom from number', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ sid: 'SM456' }),
      } as Response);

      const client = new NoctusoftClient('test-key');
      const options: ISmsOptions = {
        to: '+15551234567',
        from: '+15559876543',
        body: 'Custom from',
      };

      await client.sendSms(options);

      const callArgs = mockFetch.mock.calls[0];
      const body = new URLSearchParams(callArgs![1]!.body as string);
      expect(body.get('From')).toBe('+15559876543');
    });

    it('should throw on SMS API error', async () => {
      const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Invalid phone number' }),
      } as Response);

      const client = new NoctusoftClient('test-key');
      const options: ISmsOptions = {
        to: 'invalid',
        body: 'Test',
      };

      await expect(client.sendSms(options)).rejects.toThrow(
        'Noctusoft SMS failed: 400 Bad Request',
      );
    });
  });
});
