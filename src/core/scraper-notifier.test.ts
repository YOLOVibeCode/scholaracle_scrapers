import { ScraperNotifier } from './scraper-notifier';
import { NoctusoftClient } from './noctusoft-client';

jest.mock('./noctusoft-client');

const MockedNoctusoftClient = NoctusoftClient as jest.MockedClass<typeof NoctusoftClient>;

afterEach(() => {
  jest.clearAllMocks();
});

describe('ScraperNotifier', () => {
  describe('notifyAuthFailure', () => {
    it('should send email notification for auth failure', async () => {
      const mockSendEmail = jest.fn().mockResolvedValue(undefined);
      MockedNoctusoftClient.mockImplementation(() => ({
        sendEmail: mockSendEmail,
        sendSms: jest.fn(),
      } as any));

      const notifier = new ScraperNotifier({
        apiKey: 'test-key',
        notifyEmail: 'admin@example.com',
        fromEmail: 'noreply@apirelay.us.noctusoft.com',
      });

      await notifier.notifyAuthFailure({
        scraper: 'canvas',
        student: 'Ava Lewis',
        message: 'Invalid credentials',
      });

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
          from: 'noreply@apirelay.us.noctusoft.com',
          subject: '🔑 Scraper Auth Failed: canvas (Ava Lewis)',
          text: expect.stringContaining('Invalid credentials'),
        }),
      );
    });

    it('should skip notification when email not configured', async () => {
      const mockSendEmail = jest.fn();
      MockedNoctusoftClient.mockImplementation(() => ({
        sendEmail: mockSendEmail,
        sendSms: jest.fn(),
      } as any));

      const notifier = new ScraperNotifier({ apiKey: 'test-key' });

      await notifier.notifyAuthFailure({
        scraper: 'canvas',
        student: 'Ava Lewis',
        message: 'Invalid credentials',
      });

      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  describe('notifyScraperComplete', () => {
    it('should send success notification with stats', async () => {
      const mockSendEmail = jest.fn().mockResolvedValue(undefined);
      MockedNoctusoftClient.mockImplementation(() => ({
        sendEmail: mockSendEmail,
        sendSms: jest.fn(),
      } as any));

      const notifier = new ScraperNotifier({
        apiKey: 'test-key',
        notifyEmail: 'admin@example.com',
        fromEmail: 'noreply@apirelay.us.noctusoft.com',
      });

      await notifier.notifyScraperComplete({
        scraper: 'canvas',
        student: 'Ava Lewis',
        opsCount: 142,
        durationMs: 15000,
      });

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
          subject: '✓ Scraper Complete: canvas (Ava Lewis)',
          text: expect.stringContaining('142 ops'),
        }),
      );
    });
  });

  describe('notifyScraperError', () => {
    it('should send error notification', async () => {
      const mockSendEmail = jest.fn().mockResolvedValue(undefined);
      MockedNoctusoftClient.mockImplementation(() => ({
        sendEmail: mockSendEmail,
        sendSms: jest.fn(),
      } as any));

      const notifier = new ScraperNotifier({
        apiKey: 'test-key',
        notifyEmail: 'admin@example.com',
        fromEmail: 'noreply@apirelay.us.noctusoft.com',
      });

      await notifier.notifyScraperError({
        scraper: 'skyward',
        student: 'Emma Lewis',
        error: new Error('Network timeout'),
      });

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'admin@example.com',
          subject: '✗ Scraper Error: skyward (Emma Lewis)',
          text: expect.stringContaining('Network timeout'),
        }),
      );
    });
  });

  describe('notifyMissingAssignments', () => {
    it('should send SMS alert for missing assignments', async () => {
      const mockSendSms = jest.fn().mockResolvedValue({ sid: 'SM123' });
      MockedNoctusoftClient.mockImplementation(() => ({
        sendEmail: jest.fn(),
        sendSms: mockSendSms,
      } as any));

      const notifier = new ScraperNotifier({
        apiKey: 'test-key',
        notifySms: '+15551234567',
      });

      await notifier.notifyMissingAssignments({
        student: 'Ava Lewis',
        count: 3,
        courses: ['Math', 'Science', 'History'],
      });

      expect(mockSendSms).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '+15551234567',
          body: expect.stringContaining('3 missing'),
        }),
      );
    });

    it('should skip SMS when not configured', async () => {
      const mockSendSms = jest.fn();
      MockedNoctusoftClient.mockImplementation(() => ({
        sendEmail: jest.fn(),
        sendSms: mockSendSms,
      } as any));

      const notifier = new ScraperNotifier({ apiKey: 'test-key' });

      await notifier.notifyMissingAssignments({
        student: 'Ava Lewis',
        count: 3,
        courses: ['Math'],
      });

      expect(mockSendSms).not.toHaveBeenCalled();
    });
  });
});
