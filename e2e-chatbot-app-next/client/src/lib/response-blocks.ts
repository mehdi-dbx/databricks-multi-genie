/**
 * Parses assistant message text for structured response blocks (turnaround_started,
 * live_turnaround_checklist, checkin_*) so the UI can render them with dedicated styled components.
 * Block format: ```blockType\ncontent\n```
 */

export type ResponseSegment =
  | { type: 'markdown'; content: string }
  | {
      type: 'turnaround_started';
      content: string;
      parsed: { flight: string; etaMin: string; tobt: string };
    }
  | {
      type: 'live_turnaround_checklist';
      content: string;
      parsed: {
        flight: string;
        tasks: Array<{ name: string; status: string }>;
        readiness: string;
      };
    }
  | {
      type: 'checkin_root_cause';
      content: string;
      parsed: { zone: string; items: string[] };
    }
  | {
      type: 'checkin_consequences';
      content: string;
      parsed: { items: string[] };
    }
  | {
      type: 'checkin_recommended_action';
      content: string;
      parsed: { items: string[] };
    }
  | {
      type: 'checkin_available_agents';
      content: string;
      parsed: { agents: Array<{ agentId: string; name: string; zone: string; counter: string; status: string }> };
    }
  | {
      type: 'checkin_update';
      content: string;
      parsed: {
        zone: string;
        body: string;
        flights: Array<{ number: string; status: 'monitoring' | 'resolved' }>;
      };
    }
  | {
      type: 'checkin_performance_issue';
      content: string;
      parsed: {
        zone: string;
        pctChange: string;
        windowMins: string;
        avgCheckin?: string;
        baseline?: string;
        timestamp?: string;
      };
    }
  | {
      type: 'checkin_impact';
      content: string;
      parsed: {
        count: string;
        flights: Array<{ number: string; departureMin: string }>;
      };
    }
  | {
      type: 'checkin_followup';
      content: string;
      parsed: { question: string; actionId: string };
    }
  | {
      type: 'checkin_root_cause_actions';
      content: string;
      parsed: {
        agents: Array<{ agentId: string; name: string; zone: string; counter: string; status: string }>;
        actions: Array<{ actionId: string; question: string }>;
      };
    }
  | {
      type: 'refresh_table';
      content: string;
      parsed: { table: string };
    }
  | {
      type: 'staffing_duty';
      content: string;
      parsed: { zone: string; counter: string; assignedById: string };
    }
  | {
      type: 'knowledge_base';
      content: string;
      parsed: { header: string; items: string[]; footer?: string };
    };

const FENCE = '```';
const BLOCK_TURNAROUND_STARTED = 'turnaround_started';
const BLOCK_LIVE_CHECKLIST = 'live_turnaround_checklist';
const BLOCK_CHECKIN_ROOT_CAUSE = 'checkin_root_cause';
const BLOCK_CHECKIN_CONSEQUENCES = 'checkin_consequences';
const BLOCK_CHECKIN_RECOMMENDED_ACTION = 'checkin_recommended_action';
const BLOCK_CHECKIN_AVAILABLE_AGENTS = 'checkin_available_agents';
const BLOCK_CHECKIN_UPDATE = 'checkin_update';
const BLOCK_CHECKIN_PERFORMANCE_ISSUE = 'checkin_performance_issue';
const BLOCK_CHECKIN_IMPACT = 'checkin_impact';
const BLOCK_CHECKIN_FOLLOWUP = 'checkin_followup';
const BLOCK_CHECKIN_ROOT_CAUSE_ACTIONS = 'checkin_root_cause_actions';
const BLOCK_REFRESH_TABLE = 'refresh_table';
const BLOCK_STAFFING_DUTY = 'staffing_duty';
const BLOCK_KNOWLEDGE_BASE = 'knowledge_base';

/** Matches opening fence then optional whitespace/newline then block type (for detection). */
const RE_TURNAROUND_STARTED = /```\s*turnaround_started/i;
const RE_LIVE_CHECKLIST = /```\s*live_turnaround_checklist/i;
const RE_CHECKIN_ROOT_CAUSE = /```\s*checkin_root_cause/i;
const RE_CHECKIN_CONSEQUENCES = /```\s*checkin_consequences/i;
const RE_CHECKIN_RECOMMENDED_ACTION = /```\s*checkin_recommended_action/i;
const RE_CHECKIN_AVAILABLE_AGENTS = /```\s*checkin_available_agents/i;
const RE_CHECKIN_UPDATE = /```\s*checkin_update/i;
const RE_CHECKIN_PERFORMANCE_ISSUE = /```\s*checkin_performance_issue/i;
const RE_CHECKIN_IMPACT = /```\s*checkin_impact/i;
const RE_CHECKIN_FOLLOWUP = /```\s*checkin_followup/i;
const RE_CHECKIN_ROOT_CAUSE_ACTIONS = /```\s*checkin_root_cause_actions/i;
const RE_REFRESH_TABLE = /```\s*refresh_table/i;
const RE_STAFFING_DUTY = /```\s*staffing_duty/i;
const RE_KNOWLEDGE_BASE = /```\s*knowledge_base/i;

function parseRefreshTable(inner: string): { table: string } {
  const table = inner.trim().split(/\r?\n/)[0]?.trim() ?? '';
  return { table };
}

function parseTurnaroundStarted(inner: string): {
  flight: string;
  etaMin: string;
  tobt: string;
} {
  const lines = inner.trim().split(/\r?\n/);
  const first = lines[0]?.trim() ?? '';
  const second = lines[1]?.trim() ?? '';
  const flight = first.replace(/^Turnaround started\s*-\s*/i, '').trim();
  const etaMatch = second.match(/ETA:\s*([^\t\s]+)/i);
  const tobtMatch = second.match(/TOBT\s*([^\s]+)/i);
  return {
    flight,
    etaMin: etaMatch?.[1] ?? '',
    tobt: tobtMatch?.[1] ?? '',
  };
}

function parseLiveTurnaroundChecklist(inner: string): {
  flight: string;
  tasks: Array<{ name: string; status: string }>;
  readiness: string;
} {
  const lines = inner.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let flight = '';
  const tasks: Array<{ name: string; status: string }> = [];
  let readiness = '';

  const titleLine = 'Live Turnaround Checklist (synced with TMS)';
  const flightPrefix = 'Turnaround - ';
  const readinessPrefix = 'Readiness vs TOBT: ';

  for (const line of lines) {
    if (line === titleLine) continue;
    if (line.startsWith(flightPrefix)) {
      flight = line.slice(flightPrefix.length).trim();
      continue;
    }
    if (line.startsWith(readinessPrefix)) {
      readiness = line.slice(readinessPrefix.length).trim();
      continue;
    }
    const tab = line.indexOf('\t');
    const spaceRun = line.match(/\s{2,}/);
    const statusMatch = line.match(/\s+(Notified|Pending|In Progress|Completed)$/i);
    const sep =
      tab >= 0
        ? tab
        : spaceRun?.index ?? (statusMatch ? line.length - statusMatch[0].length : -1);
    if (sep >= 0) {
      const name = line.slice(0, sep).trim();
      const status = line.slice(sep).trim();
      if (name && status) tasks.push({ name, status });
    }
  }

  return { flight, tasks, readiness };
}

/** Parse checkin_root_cause: first line = zone, rest = bullet items (with or without - prefix). */
function parseCheckinRootCause(inner: string): { zone: string; items: string[] } {
  const lines = inner.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { zone: '', items: [] };
  const zone = lines[0];
  const items = lines.slice(1).map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean);
  return { zone, items };
}

/** Parse checkin_consequences: each line = bullet item. */
function parseCheckinConsequences(inner: string): { items: string[] } {
  const lines = inner.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = lines.map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean);
  return { items };
}

/** Parse checkin_recommended_action: each line = bullet item. */
function parseCheckinRecommendedAction(inner: string): { items: string[] } {
  const lines = inner.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = lines.map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean);
  return { items };
}

/** Parse checkin_available_agents: each line = "agentId – name (zone, counter) — status". */
function parseCheckinAvailableAgents(inner: string): {
  agents: Array<{ agentId: string; name: string; zone: string; counter: string; status: string }>;
} {
  const lines = inner.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const agents: Array<{ agentId: string; name: string; zone: string; counter: string; status: string }> = [];
  for (const line of lines) {
    // Format: A02 – T. Nguyen (Zone B, counter B02) — BREAK or A02 - Name - Zone X, status
    const dashMatch = line.match(/\s+[–-]\s+/);
    if (!dashMatch) {
      if (line.trim()) agents.push({ agentId: '', name: line.trim(), zone: '', counter: '', status: '' });
      continue;
    }
    const dashIdx = line.indexOf(dashMatch[0]);
    const agentId = line.slice(0, dashIdx).trim();
    const rest = line.slice(dashIdx + dashMatch[0].length).trim();
    const parenStart = rest.indexOf('(');
    const parenEnd = rest.indexOf(')');
    let name = rest;
    let zone = '';
    let counter = '';
    let status = '';
    if (parenStart >= 0 && parenEnd > parenStart) {
      name = rest.slice(0, parenStart).trim();
      const innerParen = rest.slice(parenStart + 1, parenEnd);
      const zoneMatch = innerParen.match(/Zone\s+(\w+)/i);
      const counterMatch = innerParen.match(/counter\s+(\w+)/i);
      zone = zoneMatch?.[1] ?? '';
      counter = counterMatch?.[1] ?? '';
    }
    const statusMatch = rest.match(/\s+[—–-]\s+/);
    if (statusMatch) {
      const statusSep = rest.indexOf(statusMatch[0]);
      status = rest.slice(statusSep + statusMatch[0].length).trim();
    }
    if (agentId || name) agents.push({ agentId, name, zone, counter, status });
  }
  return { agents };
}

/** Parse checkin_update: line1=zone, line2=body, optional agent|name|zone, rest=flight|status. */
function parseCheckinUpdate(inner: string): {
  zone: string;
  body: string;
  agent?: { name: string; zone: string };
  flights: Array<{ number: string; status: 'monitoring' | 'resolved' }>;
} {
  const lines = inner.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { zone: '', body: '', flights: [] };
  const zone = lines[0];
  const body = lines[1] ?? '';
  let agent: { name: string; zone: string } | undefined;
  const flights: Array<{ number: string; status: 'monitoring' | 'resolved' }> = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (line.toLowerCase().startsWith('agent|')) {
      const parts = line.slice(6).split('|').map((p) => p.trim());
      if (parts.length >= 2) agent = { name: parts[0], zone: parts[1] };
      continue;
    }
    const pipeIdx = line.indexOf('|');
    if (pipeIdx >= 0) {
      const number = line.slice(0, pipeIdx).trim();
      const statusRaw = line.slice(pipeIdx + 1).trim().toLowerCase();
      const status = statusRaw === 'resolved' ? 'resolved' : 'monitoring';
      if (number) flights.push({ number, status });
    }
  }
  return { zone, body, agent, flights };
}

/** Parse checkin_performance_issue: line1=zone, line2=pctChange, line3=windowMins, optional line4=avgCheckin|baseline|timestamp. */
function parseCheckinPerformanceIssue(inner: string): {
  zone: string;
  pctChange: string;
  windowMins: string;
  avgCheckin?: string;
  baseline?: string;
  timestamp?: string;
} {
  const lines = inner.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) return { zone: '', pctChange: '', windowMins: '' };
  const [zone, pctChange, windowMins] = lines;
  const fourth = lines[3];
  let avgCheckin: string | undefined;
  let baseline: string | undefined;
  let timestamp: string | undefined;
  if (fourth) {
    const parts = fourth.split('|').map((p) => p.trim());
    avgCheckin = parts[0] || undefined;
    baseline = parts[1] || undefined;
    timestamp = parts[2] || undefined;
  }
  return { zone, pctChange, windowMins, avgCheckin, baseline, timestamp };
}

/** Parse checkin_impact: line1=count, rest=flight|departureMin. */
function parseCheckinImpact(inner: string): {
  count: string;
  flights: Array<{ number: string; departureMin: string }>;
} {
  const lines = inner.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { count: '0', flights: [] };
  const count = lines[0];
  const flights: Array<{ number: string; departureMin: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const pipeIdx = line.indexOf('|');
    if (pipeIdx >= 0) {
      const number = line.slice(0, pipeIdx).trim();
      const departureMin = line.slice(pipeIdx + 1).trim();
      if (number) flights.push({ number, departureMin });
    }
  }
  return { count, flights };
}

/** Parse knowledge_base: header, bullet items, optional --- divider, optional footer. */
function parseKnowledgeBase(inner: string): {
  header: string;
  items: string[];
  footer?: string;
} {
  const lines = inner.trim().split(/\r?\n/).map((l) => l.trim());
  const headerLines: string[] = [];
  const items: string[] = [];
  let footer = '';
  let phase: 'header' | 'items' | 'footer' = 'header';

  for (const line of lines) {
    if (line === '---') {
      phase = 'footer';
      continue;
    }
    if (phase === 'header') {
      if (line.startsWith('- ')) {
        phase = 'items';
        items.push(line.slice(2).trim());
      } else {
        headerLines.push(line);
      }
      continue;
    }
    if (phase === 'items') {
      if (line.startsWith('- ')) {
        items.push(line.slice(2).trim());
      } else if (line === '---') {
        seenDivider = true;
        phase = 'footer';
      } else if (line) {
        items.push(line);
      }
      continue;
    }
    if (phase === 'footer' && line) {
      footer += (footer ? '\n' : '') + line;
    }
  }

  return {
    header: headerLines.join(' ').trim(),
    items,
    footer: footer.trim() || undefined,
  };
}

/** Parse staffing_duty: zone|counter|assigned_by_id. */
function parseStaffingDuty(inner: string): { zone: string; counter: string; assignedById: string } {
  const line = inner.trim().split(/\r?\n/)[0]?.trim() ?? '';
  const parts = line.split('|').map((p) => p.trim());
  return {
    zone: parts[0] ?? '',
    counter: parts[1] ?? '',
    assignedById: parts[2] ?? '',
  };
}

/** Parse checkin_followup: line1=actionId, line2=question (optional). */
function parseCheckinFollowup(inner: string): { question: string; actionId: string } {
  const lines = inner.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const actionId = lines[0] ?? '';
  const question = lines[1] ?? '';
  return { actionId, question };
}

/** Parse checkin_root_cause_actions: ---agents--- section + ---actions--- section. */
function parseCheckinRootCauseActions(inner: string): {
  agents: Array<{ agentId: string; name: string; zone: string; counter: string; status: string }>;
  actions: Array<{ actionId: string; question: string }>;
} {
  const agentsSection = inner.split(/---actions---/i)[0] ?? '';
  const actionsSection = inner.split(/---actions---/i)[1] ?? '';
  const agentsInner = agentsSection.replace(/---agents---/i, '').trim();
  const agents = agentsInner ? parseCheckinAvailableAgents(agentsInner).agents : [];
  const actionLines = actionsSection.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const actions: Array<{ actionId: string; question: string }> = [];
  for (const line of actionLines) {
    const pipeIdx = line.indexOf('|');
    if (pipeIdx >= 0) {
      const actionId = line.slice(0, pipeIdx).trim();
      const question = line.slice(pipeIdx + 1).trim();
      if (actionId) actions.push({ actionId, question });
    }
  }
  return { agents, actions };
}

/**
 * Splits message text into segments: markdown and structured blocks.
 * Recognises ```turnaround_started ... ``` and ```live_turnaround_checklist ... ```.
 */
export function parseResponseBlocks(text: string): ResponseSegment[] {
  const segments: ResponseSegment[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const open = remaining.indexOf(FENCE);
    if (open < 0) {
      if (remaining.trim()) segments.push({ type: 'markdown', content: remaining });
      break;
    }

    const before = remaining.slice(0, open);
    if (before.trim()) segments.push({ type: 'markdown', content: before });
    remaining = remaining.slice(open + FENCE.length);
    // Allow optional whitespace/newline after ``` before language tag
    const afterFence = remaining.replace(/^\s+/, '');
    const newline = afterFence.indexOf('\n');
    const lang =
      newline >= 0
        ? afterFence.slice(0, newline).trim().toLowerCase()
        : afterFence.trim().toLowerCase();
    const contentStart =
      remaining.length - afterFence.length + (newline >= 0 ? newline + 1 : afterFence.length);
    const closeIdx = remaining.indexOf(FENCE, contentStart);
    if (closeIdx < 0) {
      segments.push({ type: 'markdown', content: FENCE + remaining });
      break;
    }

    const inner = remaining.slice(contentStart, closeIdx);
    remaining = remaining.slice(closeIdx + FENCE.length);

    if (lang === BLOCK_TURNAROUND_STARTED) {
      try {
        const parsed = parseTurnaroundStarted(inner);
        segments.push({ type: 'turnaround_started', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_TURNAROUND_STARTED + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_LIVE_CHECKLIST) {
      try {
        const parsed = parseLiveTurnaroundChecklist(inner);
        segments.push({ type: 'live_turnaround_checklist', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_LIVE_CHECKLIST + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_CHECKIN_ROOT_CAUSE) {
      try {
        const parsed = parseCheckinRootCause(inner);
        segments.push({ type: 'checkin_root_cause', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_CHECKIN_ROOT_CAUSE + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_CHECKIN_CONSEQUENCES) {
      try {
        const parsed = parseCheckinConsequences(inner);
        segments.push({ type: 'checkin_consequences', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_CHECKIN_CONSEQUENCES + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_CHECKIN_RECOMMENDED_ACTION) {
      try {
        const parsed = parseCheckinRecommendedAction(inner);
        segments.push({ type: 'checkin_recommended_action', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_CHECKIN_RECOMMENDED_ACTION + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_CHECKIN_AVAILABLE_AGENTS) {
      try {
        const parsed = parseCheckinAvailableAgents(inner);
        segments.push({ type: 'checkin_available_agents', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_CHECKIN_AVAILABLE_AGENTS + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_CHECKIN_UPDATE) {
      try {
        const parsed = parseCheckinUpdate(inner);
        segments.push({ type: 'checkin_update', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_CHECKIN_UPDATE + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_CHECKIN_PERFORMANCE_ISSUE) {
      try {
        const parsed = parseCheckinPerformanceIssue(inner);
        segments.push({ type: 'checkin_performance_issue', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_CHECKIN_PERFORMANCE_ISSUE + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_CHECKIN_IMPACT) {
      try {
        const parsed = parseCheckinImpact(inner);
        segments.push({ type: 'checkin_impact', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_CHECKIN_IMPACT + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_CHECKIN_FOLLOWUP) {
      try {
        const parsed = parseCheckinFollowup(inner);
        segments.push({ type: 'checkin_followup', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_CHECKIN_FOLLOWUP + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_CHECKIN_ROOT_CAUSE_ACTIONS) {
      try {
        const parsed = parseCheckinRootCauseActions(inner);
        segments.push({ type: 'checkin_root_cause_actions', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_CHECKIN_ROOT_CAUSE_ACTIONS + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_REFRESH_TABLE) {
      try {
        const parsed = parseRefreshTable(inner);
        segments.push({ type: 'refresh_table', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_REFRESH_TABLE + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_STAFFING_DUTY) {
      try {
        const parsed = parseStaffingDuty(inner);
        segments.push({ type: 'staffing_duty', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_STAFFING_DUTY + '\n' + inner + FENCE });
      }
    } else if (lang === BLOCK_KNOWLEDGE_BASE) {
      try {
        const parsed = parseKnowledgeBase(inner);
        segments.push({ type: 'knowledge_base', content: inner, parsed });
      } catch {
        segments.push({ type: 'markdown', content: FENCE + BLOCK_KNOWLEDGE_BASE + '\n' + inner + FENCE });
      }
    } else {
      segments.push({
        type: 'markdown',
        content: FENCE + lang + (newline >= 0 ? '\n' + inner : '') + FENCE,
      });
    }
  }

  return segments;
}

/** Returns true if text contains any structured block we handle. */
export function hasResponseBlocks(text: string): boolean {
  return (
    RE_TURNAROUND_STARTED.test(text) ||
    RE_LIVE_CHECKLIST.test(text) ||
    RE_CHECKIN_ROOT_CAUSE.test(text) ||
    RE_CHECKIN_CONSEQUENCES.test(text) ||
    RE_CHECKIN_RECOMMENDED_ACTION.test(text) ||
    RE_CHECKIN_AVAILABLE_AGENTS.test(text) ||
    RE_CHECKIN_UPDATE.test(text) ||
    RE_CHECKIN_PERFORMANCE_ISSUE.test(text) ||
    RE_CHECKIN_IMPACT.test(text) ||
    RE_CHECKIN_FOLLOWUP.test(text) ||
    RE_CHECKIN_ROOT_CAUSE_ACTIONS.test(text) ||
    RE_REFRESH_TABLE.test(text) ||
    RE_STAFFING_DUTY.test(text) ||
    RE_KNOWLEDGE_BASE.test(text)
  );
}
