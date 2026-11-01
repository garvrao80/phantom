import { describe, it, expect } from 'vitest';
import { EventHub, emit } from '../src/events.ts';

describe('emit', () => {
  it('broadcasts on every open hub and skips closed ones', () => {
    const sent: string[] = [];
    const hub = new EventHub();
    const closed = new EventHub();
    (hub as unknown as { broadcast: (m: string) => void }).broadcast = (m) => sent.push(m);
    (closed as unknown as { broadcast: (m: string) => void }).broadcast = () => sent.push('closed');
    closed.close();
    emit('materialize', { jobId: 'job_1', phase: 'context' });
    hub.close();
    expect(sent).toEqual(['event: materialize\ndata: {"jobId":"job_1","phase":"context"}\n\n']);
  });
});
