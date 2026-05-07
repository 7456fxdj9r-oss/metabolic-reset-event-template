// CSV helpers shared by the edit page and the live dashboard.
// One column per stored field, one row per raffle entry. Values that
// contain commas, quotes, or newlines are wrapped in quotes with internal
// quotes doubled per RFC 4180.

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function buildRaffleEntriesCsv(entries) {
  const cols = [
    'Name', 'Email', 'Phone', 'Invited by', 'Submitted at',
    'Risk score', 'Drawn', 'Prize won', 'Lead status', 'Notes', 'Goal',
    'Newsletter', 'Apprentice',
    'Has diabetes', 'Has high BP', 'Has high cholesterol',
    'Energy', 'Sleep', 'Weight', 'Cravings', 'Mood', 'Digestion', 'Community',
    'Tried before',
  ];
  const rows = (entries || []).map((e) => {
    const q = e.quiz_answers || {};
    return [
      e.name, e.email, e.phone || '', e.invited_by || '', e.submitted_at,
      e.risk_score ?? '', e.drawn ? 'yes' : 'no',
      e.prize_won || '', e.lead_status || '', e.notes || '',
      e.goal_text || '',
      e.newsletter_optin ? 'yes' : 'no', e.apprentice_optin ? 'yes' : 'no',
      q.has_diabetes || '', q.has_high_bp || '', q.has_high_cholesterol || '',
      q.rate_energy ?? '', q.rate_sleep ?? '', q.rate_weight ?? '',
      q.rate_cravings ?? '', q.rate_mood ?? '', q.rate_digestion ?? '', q.rate_community ?? '',
      q.tried_before || '',
    ];
  });
  return [cols, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n') + '\n';
}

export function downloadCsv(filename, csv) {
  // BOM so Excel opens UTF-8 cleanly. Sheets imports either way.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
