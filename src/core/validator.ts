import {
  SLC_INGEST_SCHEMA_VERSION_V1,
  SLC_ENTITY_TYPES,
  type SlcEntityType,
  type ISlcDeltaOp,
  type ISlcIngestEnvelopeV1,
} from './types';

// ---------------------------------------------------------------------------
// Validation result types
// ---------------------------------------------------------------------------

export interface ValidationCheck {
  readonly name: string;
  readonly severity: 'error' | 'warning' | 'pass';
  readonly message: string;
}

export interface OpValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface EnvelopeValidationReport {
  readonly passed: boolean;
  readonly checks: readonly ValidationCheck[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly passCount: number;
  readonly entityCounts: Record<string, number>;
  readonly totalOps: number;
}

// ---------------------------------------------------------------------------
// Entity-level record validation (required fields only)
// ---------------------------------------------------------------------------

function requireString(entity: string, field: string, value: unknown): string | null {
  if (value === undefined || value === null) return `${entity}.${field} is required`;
  if (typeof value !== 'string') return `${entity}.${field} must be a string`;
  if (value.trim().length === 0) return `${entity}.${field} must be non-empty`;
  return null;
}

function validateRecord(entity: SlcEntityType, record: Record<string, unknown>): string[] {
  const errors: string[] = [];

  switch (entity) {
    case 'assignment': {
      const e = requireString('assignment', 'title', record['title']);
      if (e) errors.push(e);
      const atts = record['attachments'];
      if (Array.isArray(atts)) {
        for (let i = 0; i < atts.length; i++) {
          const att = atts[i] as Record<string, unknown> | undefined;
          if (!att) continue;
          const nameErr = requireString(`assignment.attachments[${i}]`, 'name', att['name']);
          if (nameErr) errors.push(nameErr);
        }
      }
      break;
    }
    case 'gradeSnapshot': {
      const e1 = requireString('gradeSnapshot', 'courseExternalId', record['courseExternalId']);
      const e2 = requireString('gradeSnapshot', 'asOfDate', record['asOfDate']);
      if (e1) errors.push(e1);
      if (e2) errors.push(e2);
      break;
    }
    case 'course': {
      const e = requireString('course', 'title', record['title']);
      if (e) errors.push(e);
      break;
    }
    case 'studentProfile': {
      const e = requireString('studentProfile', 'name', record['name']);
      if (e) errors.push(e);
      break;
    }
    case 'attendanceEvent': {
      const e1 = requireString('attendanceEvent', 'date', record['date']);
      const e2 = requireString('attendanceEvent', 'status', record['status']);
      if (e1) errors.push(e1);
      if (e2) errors.push(e2);
      break;
    }
    case 'teacher': {
      const e = requireString('teacher', 'name', record['name']);
      if (e) errors.push(e);
      break;
    }
    case 'courseMaterial': {
      const e1 = requireString('courseMaterial', 'title', record['title']);
      const e2 = requireString('courseMaterial', 'courseExternalId', record['courseExternalId']);
      const e3 = requireString('courseMaterial', 'type', record['type']);
      if (e1) errors.push(e1);
      if (e2) errors.push(e2);
      if (e3) errors.push(e3);
      break;
    }
    case 'message': {
      const e1 = requireString('message', 'subject', record['subject']);
      const e2 = requireString('message', 'body', record['body']);
      const e3 = requireString('message', 'senderName', record['senderName']);
      const e4 = requireString('message', 'sentAt', record['sentAt']);
      if (e1) errors.push(e1);
      if (e2) errors.push(e2);
      if (e3) errors.push(e3);
      if (e4) errors.push(e4);
      break;
    }
    case 'academicTerm': {
      const e1 = requireString('academicTerm', 'title', record['title']);
      const e2 = requireString('academicTerm', 'startDate', record['startDate']);
      const e3 = requireString('academicTerm', 'endDate', record['endDate']);
      if (e1) errors.push(e1);
      if (e2) errors.push(e2);
      if (e3) errors.push(e3);
      break;
    }
    case 'institution': {
      const e = requireString('institution', 'name', record['name']);
      if (e) errors.push(e);
      break;
    }
    case 'eventSeries': {
      const e = requireString('eventSeries', 'title', record['title']);
      if (e) errors.push(e);
      break;
    }
    case 'eventOverride': {
      const e = requireString('eventOverride', 'seriesExternalId', record['seriesExternalId']);
      if (e) errors.push(e);
      break;
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Per-op validation
// ---------------------------------------------------------------------------

export function validateOp(op: ISlcDeltaOp): OpValidationResult {
  const errors: string[] = [];

  if (!op.op || (op.op !== 'upsert' && op.op !== 'delete')) {
    errors.push('Invalid op type — must be "upsert" or "delete"');
  }

  if (!op.entity || !SLC_ENTITY_TYPES.includes(op.entity)) {
    errors.push(`Unknown entity type: ${op.entity}`);
  }

  if (!op.key?.provider?.trim()) errors.push('Missing key.provider');
  if (!op.key?.adapterId?.trim()) errors.push('Missing key.adapterId');
  if (!op.key?.externalId?.trim()) errors.push('Missing key.externalId');
  if (!op.observedAt?.trim()) errors.push('Missing observedAt');

  if (op.op === 'upsert' && !op.record) {
    errors.push('Upsert op requires a record');
  }

  if (op.op === 'upsert' && op.record && SLC_ENTITY_TYPES.includes(op.entity)) {
    const recordErrors = validateRecord(op.entity, op.record as Record<string, unknown>);
    errors.push(...recordErrors);
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Full envelope validation
// ---------------------------------------------------------------------------

export function validateEnvelope(envelope: ISlcIngestEnvelopeV1): EnvelopeValidationReport {
  const checks: ValidationCheck[] = [];

  // Schema version
  if (envelope.schemaVersion === SLC_INGEST_SCHEMA_VERSION_V1) {
    checks.push({ name: 'schema-version', severity: 'pass', message: `schemaVersion = "${envelope.schemaVersion}"` });
  } else {
    checks.push({ name: 'schema-version', severity: 'error', message: `Invalid schemaVersion: "${envelope.schemaVersion}"` });
  }

  // Run metadata
  if (envelope.run?.runId?.trim()) {
    checks.push({ name: 'run-id', severity: 'pass', message: `runId = "${envelope.run.runId}"` });
  } else {
    checks.push({ name: 'run-id', severity: 'error', message: 'Missing run.runId' });
  }

  if (envelope.run?.provider?.trim()) {
    checks.push({ name: 'run-provider', severity: 'pass', message: `provider = "${envelope.run.provider}"` });
  } else {
    checks.push({ name: 'run-provider', severity: 'error', message: 'Missing run.provider' });
  }

  if (envelope.run?.adapterId?.trim()) {
    checks.push({ name: 'run-adapterId', severity: 'pass', message: `adapterId = "${envelope.run.adapterId}"` });
  } else {
    checks.push({ name: 'run-adapterId', severity: 'error', message: 'Missing run.adapterId' });
  }

  if (envelope.run?.timezone?.trim()) {
    checks.push({ name: 'run-timezone', severity: 'pass', message: `timezone = "${envelope.run.timezone}"` });
  } else {
    checks.push({ name: 'run-timezone', severity: 'error', message: 'Missing run.timezone' });
  }

  // Source metadata
  if (envelope.source?.sourceId?.trim()) {
    checks.push({ name: 'source-id', severity: 'pass', message: `sourceId = "${envelope.source.sourceId}"` });
  } else {
    checks.push({ name: 'source-id', severity: 'error', message: 'Missing source.sourceId' });
  }

  // Ops
  if (!Array.isArray(envelope.ops)) {
    checks.push({ name: 'ops-array', severity: 'error', message: 'ops is not an array' });
    return buildReport(checks, {});
  }

  if (envelope.ops.length === 0) {
    checks.push({ name: 'ops-non-empty', severity: 'warning', message: 'Envelope has zero ops (empty)' });
  } else {
    checks.push({ name: 'ops-non-empty', severity: 'pass', message: `${envelope.ops.length} ops` });
  }

  // Per-op validation
  const entityCounts: Record<string, number> = {};
  let opErrors = 0;

  for (const op of envelope.ops) {
    entityCounts[op.entity] = (entityCounts[op.entity] ?? 0) + 1;
    const result = validateOp(op);
    if (!result.valid) {
      opErrors++;
      for (const err of result.errors) {
        checks.push({ name: `op-${op.entity}-${op.key?.externalId ?? 'unknown'}`, severity: 'error', message: err });
      }
    }
  }

  if (opErrors === 0 && envelope.ops.length > 0) {
    checks.push({ name: 'ops-valid', severity: 'pass', message: 'All ops pass validation' });
  }

  return buildReport(checks, entityCounts);
}

function buildReport(checks: ValidationCheck[], entityCounts: Record<string, number>): EnvelopeValidationReport {
  const errorCount = checks.filter(c => c.severity === 'error').length;
  const warningCount = checks.filter(c => c.severity === 'warning').length;
  const passCount = checks.filter(c => c.severity === 'pass').length;
  const totalOps = Object.values(entityCounts).reduce((a, b) => a + b, 0);

  return {
    passed: errorCount === 0,
    checks,
    errorCount,
    warningCount,
    passCount,
    entityCounts,
    totalOps,
  };
}
