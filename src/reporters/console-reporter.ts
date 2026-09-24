import type { TimelineRecord } from '../core/timeline.ts';

export function formatConsole(timeline: readonly TimelineRecord[]): string {
  return timeline.map(record => {
    let detail: string;
    switch (record.category) {
      case 'scenario': detail = `${record.data.type} ${'requestId' in record.data ? record.data.requestId : record.data.payload.authorityRef}`; break;
      case 'governance': detail = `${record.data.requestId} ${record.data.decisionId} ${record.data.result}: ${record.data.rationale}`; break;
      case 'enforcement': detail = `${record.data.requestId} ${record.data.result}`; break;
      case 'execution': detail = `${record.data.requestId} ${record.data.status}`; break;
      case 'assertion': detail = `${record.data.passed ? 'PASS' : 'FAIL'} ${record.data.name}: ${record.data.reason}`; break;
    }
    return `${String(record.sequence).padStart(2, '0')} t=${record.timestamp} [${record.category}] ${detail}`;
  }).join('\n');
}
