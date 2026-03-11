import axios from 'axios';
import { fetchStudents, fetchSources, registerSource } from './api-client';

jest.mock('axios', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const mockGet = axios.get as jest.Mock;
const mockPost = axios.post as jest.Mock;

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

describe('fetchStudents', () => {
  it('should return students when API returns 200 with array', async () => {
    const apiStudents = [
      { id: 'stu-1', name: 'Emma Lewis', externalId: 'emma-lewis' },
      { id: 'stu-2', name: 'Jack Smith', externalId: 'jack-smith' },
    ];
    mockGet.mockResolvedValueOnce({ status: 200, data: apiStudents });

    const result = await fetchStudents('https://api.scholarmancy.com', 'tok-123');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 'stu-1',
      name: 'Emma Lewis',
      externalId: 'emma-lewis',
    });
    expect(result[1]).toEqual({
      id: 'stu-2',
      name: 'Jack Smith',
      externalId: 'jack-smith',
    });
    expect(mockGet).toHaveBeenCalledWith(
      'https://api.scholarmancy.com/api/ingest/v1/connector/students',
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok-123' },
      })
    );
  });

  it('should pass through grade and dataSources when present', async () => {
    const apiStudents = [
      {
        id: 'abc123',
        name: 'Emma Lewis',
        externalId: 'abc123',
        grade: 7,
        dataSources: [
          {
            sourceId: 'src-uuid-1',
            provider: 'canvas',
            displayName: 'Canvas LMS',
            portalBaseUrl: 'https://lincoln.instructure.com',
          },
        ],
      },
    ];
    mockGet.mockResolvedValueOnce({ status: 200, data: apiStudents });

    const result = await fetchStudents('https://api.example.com', 'token');

    expect(result).toHaveLength(1);
    expect(result[0]?.grade).toBe(7);
    expect(result[0]?.dataSources).toHaveLength(1);
    expect(result[0]?.dataSources?.[0]).toEqual({
      sourceId: 'src-uuid-1',
      provider: 'canvas',
      displayName: 'Canvas LMS',
      portalBaseUrl: 'https://lincoln.instructure.com',
    });
  });

  it('should return empty array when API returns 200 with empty array', async () => {
    mockGet.mockResolvedValueOnce({ status: 200, data: [] });

    const result = await fetchStudents('https://api.example.com', 'token');

    expect(result).toEqual([]);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('should throw on 401 unauthorized', async () => {
    mockGet.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } })
    );

    await expect(
      fetchStudents('https://api.scholarmancy.com', 'bad-token')
    ).rejects.toThrow(/401|unauthorized|failed/i);
  });

  it('should throw on network failure', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      fetchStudents('https://api.scholarmancy.com', 'tok-123')
    ).rejects.toThrow('Network error');
  });
});

describe('registerSource', () => {
  it('should POST to /api/ingest/v1/sources with payload', async () => {
    mockPost.mockResolvedValueOnce({ status: 200 });

    await registerSource('https://api.example.com', 'tok-123', {
      sourceId: 'src-uuid-1',
      provider: 'canvas',
      adapterId: 'com.instructure.canvas',
      displayName: 'Canvas LMS',
      portalBaseUrl: 'https://lincoln.instructure.com',
    });

    expect(mockPost).toHaveBeenCalledWith(
      'https://api.example.com/api/ingest/v1/sources',
      {
        sourceId: 'src-uuid-1',
        provider: 'canvas',
        adapterId: 'com.instructure.canvas',
        displayName: 'Canvas LMS',
        portalBaseUrl: 'https://lincoln.instructure.com',
      },
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok-123' },
      })
    );
  });

  it('should omit portalBaseUrl when undefined', async () => {
    mockPost.mockResolvedValueOnce({ status: 200 });

    await registerSource('https://api.example.com', 'token', {
      sourceId: 'src-2',
      provider: 'aeries',
      adapterId: 'com.aeries.adapter',
      displayName: 'Aeries SIS',
    });

    expect(mockPost).toHaveBeenCalledWith(
      'https://api.example.com/api/ingest/v1/sources',
      {
        sourceId: 'src-2',
        provider: 'aeries',
        adapterId: 'com.aeries.adapter',
        displayName: 'Aeries SIS',
      },
      expect.any(Object)
    );
  });

  it('should throw on non-2xx', async () => {
    mockPost.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 400'), { response: { status: 400 } })
    );

    await expect(
      registerSource('https://api.example.com', 'token', {
        sourceId: 'x',
        provider: 'p',
        adapterId: 'a',
        displayName: 'D',
      })
    ).rejects.toThrow();
  });
});

describe('fetchSources', () => {
  it('should return sources from API response', async () => {
    mockGet.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        sources: [
          {
            sourceId: 'src-1',
            provider: 'canvas',
            adapterId: 'com.instructure.canvas',
            displayName: 'Canvas LMS',
            portalBaseUrl: 'https://example.edu',
          },
        ],
      },
    });

    const result = await fetchSources('https://api.example.com', 'token');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sourceId: 'src-1',
      provider: 'canvas',
      adapterId: 'com.instructure.canvas',
      displayName: 'Canvas LMS',
      portalBaseUrl: 'https://example.edu',
    });
    expect(mockGet).toHaveBeenCalledWith(
      'https://api.example.com/api/ingest/v1/sources',
      expect.objectContaining({ headers: { Authorization: 'Bearer token' } })
    );
  });

  it('should return empty array when sources missing', async () => {
    mockGet.mockResolvedValueOnce({ status: 200, data: {} });

    const result = await fetchSources('https://api.example.com', 'token');

    expect(result).toEqual([]);
  });
});
