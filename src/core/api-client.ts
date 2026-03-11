import axios from 'axios';

/** Data source entry in GET /connector/students response (no credentials). */
export interface IApiStudentDataSource {
  readonly sourceId: string;
  readonly provider: string;
  readonly displayName: string;
  readonly portalBaseUrl?: string;
}

/** Shape returned by GET /api/ingest/v1/connector/students (matches IStudentProfile). */
export interface IApiStudent {
  readonly id: string;
  readonly name: string;
  readonly externalId: string;
  readonly grade?: number;
  readonly dataSources?: readonly IApiStudentDataSource[];
}

/**
 * Fetches students linked to the connector from the Scholaracle API.
 * Throws on non-2xx or network errors.
 */
export async function fetchStudents(
  apiBaseUrl: string,
  connectorToken: string
): Promise<IApiStudent[]> {
  const base = apiBaseUrl.replace(/\/$/, '');
  const url = `${base}/api/ingest/v1/connector/students`;
  const res = await axios.get<IApiStudent[]>(url, {
    headers: { Authorization: `Bearer ${connectorToken}` },
    timeout: 15_000,
  });
  const raw = res.data ?? [];
  return raw.map(s => ({
    id: s.id,
    name: s.name,
    externalId: s.externalId,
    ...(s.grade !== undefined && { grade: s.grade }),
    ...(s.dataSources !== undefined && { dataSources: s.dataSources }),
  }));
}

/** Payload for POST /api/ingest/v1/sources. */
export interface IRegisterSourcePayload {
  readonly sourceId: string;
  readonly provider: string;
  readonly adapterId: string;
  readonly displayName: string;
  readonly portalBaseUrl?: string;
}

/**
 * Registers a source with the Scholaracle API. Throws on non-2xx or network errors.
 */
export async function registerSource(
  apiBaseUrl: string,
  connectorToken: string,
  source: IRegisterSourcePayload
): Promise<void> {
  const base = apiBaseUrl.replace(/\/$/, '');
  const url = `${base}/api/ingest/v1/sources`;
  await axios.post(
    url,
    {
      sourceId: source.sourceId,
      provider: source.provider,
      adapterId: source.adapterId,
      displayName: source.displayName,
      ...(source.portalBaseUrl !== undefined && { portalBaseUrl: source.portalBaseUrl }),
    },
    {
      headers: { Authorization: `Bearer ${connectorToken}` },
      timeout: 15_000,
    }
  );
}

/** Shape of one source in GET /api/ingest/v1/sources response. */
export interface IApiSource {
  readonly sourceId: string;
  readonly provider: string;
  readonly adapterId: string;
  readonly displayName: string;
  readonly portalBaseUrl?: string;
}

/**
 * Fetches registered sources for the connector. Throws on non-2xx or network errors.
 */
export async function fetchSources(
  apiBaseUrl: string,
  connectorToken: string
): Promise<IApiSource[]> {
  const base = apiBaseUrl.replace(/\/$/, '');
  const url = `${base}/api/ingest/v1/sources`;
  const res = await axios.get<{ success?: boolean; sources?: IApiSource[] }>(url, {
    headers: { Authorization: `Bearer ${connectorToken}` },
    timeout: 15_000,
  });
  const body = res.data ?? {};
  const sources = body.sources ?? [];
  return sources;
}
