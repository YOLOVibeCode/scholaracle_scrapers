/**
 * Full insights pipeline: reconcile grades → record history → analyze risk → AI action plan.
 * Uses existing envelope data from output/ directory.
 *
 * Usage: npx ts-node --transpile-only run-insights.ts
 */

import { reconcileGrades } from './src/core/grade-reconciler';
import { GradeHistory } from './src/core/grade-history';
import { buildStudentReport } from './src/core/student-insights';
import { AiClient } from './src/ai/client';
import { ScraperConfig } from './src/core/config';
import { readFileSync, existsSync } from 'node:fs';

async function main(): Promise<void> {
  const canvasPath = 'output/canvas-envelope.json';
  const skywardPath = 'output/skyward-envelope.json';

  if (!existsSync(canvasPath) || !existsSync(skywardPath)) {
    console.error('  Missing envelope files. Run both scrapers first.');
    process.exit(1);
  }

  const canvas = JSON.parse(readFileSync(canvasPath, 'utf-8'));
  const skyward = JSON.parse(readFileSync(skywardPath, 'utf-8'));
  const studentId = 'ava-lewis';

  // Step 1: Reconcile grades
  const reconciled = reconcileGrades(skyward.ops, canvas.ops);

  // Step 2: Record to history + compute trends
  const history = new GradeHistory();
  history.recordFromReconciled(studentId, reconciled);
  const trends = history.computeAllTrends(studentId);

  // Step 3: Build student report
  const allOps = [...canvas.ops, ...skyward.ops];
  const report = buildStudentReport(reconciled, trends, allOps, 14);

  // Print report
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('  ║              STUDENT INSIGHTS — Ava Lewis (LDISD)                       ║');
  console.log('  ╚══════════════════════════════════════════════════════════════════════════╝');

  console.log('\n  ── RISK ASSESSMENT ──\n');
  for (const r of report.riskAssessments) {
    const icon = { critical: '🔴', high: '🟠', moderate: '🟡', low: '🟢' }[r.riskLevel];
    const grade = r.officialGrade != null ? `${r.officialGrade}%` : 'N/A';
    const trendIcon = { improving: '↑', declining: '↓', stable: '→', unknown: '?' }[r.trend];
    console.log(`  ${icon} ${r.courseName.padEnd(30)} ${grade.padEnd(8)} ${trendIcon} ${r.trend.padEnd(12)} ${r.riskLevel.toUpperCase()}`);
    for (const reason of r.reasons) {
      console.log(`      ${reason}`);
    }
    if (r.teacherName) {
      console.log(`      Teacher: ${r.teacherName}${r.teacherEmail ? ' <' + r.teacherEmail + '>' : ''}`);
    }
  }

  console.log(`\n  Missing assignments: ${report.missingAssignmentCount}`);

  if (report.upcomingDeadlines.length > 0) {
    console.log('\n  ── UPCOMING DEADLINES (next 14 days) ──\n');
    const courseMap = new Map<string, string>();
    for (const op of allOps) {
      if (op.entity === 'course') {
        courseMap.set(op.key.externalId, (op.record as Record<string, unknown>)?.title as string ?? '');
      }
    }
    for (const d of report.upcomingDeadlines.slice(0, 15)) {
      const majorTag = d.major ? ' [MAJOR]' : '';
      const pts = d.pointsPossible ? ` (${d.pointsPossible} pts)` : '';
      const course = courseMap.get(d.courseExternalId) || d.courseExternalId;
      const days = d.daysUntilDue === 1 ? 'TOMORROW' : `${d.daysUntilDue} days`;
      console.log(`  ${days.padEnd(12)} ${d.title.substring(0, 40).padEnd(42)} ${course.substring(0, 20)}${pts}${majorTag}`);
    }
  }

  // Step 4: AI Action Plan
  const config = new ScraperConfig();
  const configData = config.load();
  if (configData.aiProvider && configData.aiApiKey) {
    console.log('\n  ── AI ACTION PLAN ──\n');
    console.log('  Generating recommendations...\n');

    const atRiskSummary = report.riskAssessments
      .filter(r => r.riskLevel === 'critical' || r.riskLevel === 'high' || r.riskLevel === 'moderate')
      .map(r => {
        const trend = trends[r.courseName];
        return `${r.courseName}: ${r.officialGrade ?? 'N/A'}% (${r.riskLevel}) — ` +
          `trend: ${r.trend}, velocity: ${r.velocity} pts/week` +
          (r.teacherName ? `, teacher: ${r.teacherName}` : '') +
          (r.teacherEmail ? ` <${r.teacherEmail}>` : '') +
          `\n    Reasons: ${r.reasons.join('; ')}`;
      }).join('\n');

    const deadlineSummary = report.upcomingDeadlines.slice(0, 10)
      .map(d => `${d.title} — due in ${d.daysUntilDue} days (${d.pointsPossible ?? '?'} pts)${d.major ? ' [MAJOR]' : ''}`)
      .join('\n');

    const context = `Student: Ava Lewis, 9th grade, Lake Dallas High School

AT-RISK COURSES:
${atRiskSummary || 'None'}

MISSING ASSIGNMENTS: ${report.missingAssignmentCount} total

UPCOMING DEADLINES:
${deadlineSummary || 'None in the next 14 days'}

GRADE HISTORY TRENDS:
${Object.entries(trends).map(([name, t]) => `${name}: ${t.direction} (${t.velocity > 0 ? '+' : ''}${t.velocity} pts/week, ${t.dataPoints} data points)`).join('\n')}`;

    try {
      const ai = new AiClient(configData.aiProvider, configData.aiApiKey);
      const plan = await ai.advise(context);
      console.log(plan.split('\n').map(l => '  ' + l).join('\n'));
    } catch (err) {
      console.error('  AI advisor failed:', err instanceof Error ? err.message : String(err));
      console.log('  (Set AI_PROVIDER and AI_API_KEY in config to enable AI recommendations)');
    }
  } else {
    console.log('\n  ── AI ACTION PLAN ──\n');
    console.log('  AI advisor not configured. Run `npx scholaracle-scraper setup` to add AI provider.');
  }

  console.log('');
}

main().catch(e => {
  console.error('Failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
