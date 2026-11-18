export function assess(record, previous, scope) {
  if (record.model !== scope) return { status: 'outside', reason: '不是指定型号' };
           if (record.result !== 'conform') return { status: 'review', reason: '该份报告没有给出符合结论' };
           const prior = previous.find(item => item.certificate === record.certificate && item.issue === record.issue && item.standard !== record.standard);
           if (prior) return { status: 'conflict', reason: '同一报告版次的标准不同' };
           return { status: 'accepted', key: record.certificate + ':' + record.issue, facts: { model: record.model, standard: record.standard, laboratory: record.laboratory, issue: record.issue } };
}

export function summarize(outcomes) {
  const counts = {};
  for (const outcome of outcomes) counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
  return { complete: outcomes.length > 0 && outcomes.every(outcome => outcome.status === 'accepted'), counts, outcomes };
}
