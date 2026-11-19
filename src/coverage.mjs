// 家族配置覆盖引擎：把证书、代表型号关联、补充页、差异说明解释成
// 每个实际销售配置的覆盖结论，并保证每条结论可追溯到报告页与适用声明。

function view(document) {
  return { href: document.href, digest: document.digest, title: document.record.title ?? document.record.issue };
}

// 依据公开关联为每份证书构造一条“报告链”，并按生效顺序收窄适用范围
export function buildChains(evidence, family) {
  const relationsByCertificate = new Map();
  for (const document of evidence.relations) {
    if (document.record.family !== family) continue;
    const bucket = relationsByCertificate.get(document.record.certificate) ?? [];
    bucket.push(document);
    relationsByCertificate.set(document.record.certificate, bucket);
  }
  return evidence.certificates.map(document => {
    const record = document.record;
    const chain = {
      certificate: record.certificate, issue: record.issue, standard: record.standard,
      laboratory: record.laboratory, certificateSource: view(document),
      status: 'ready', reasons: [], claimSources: [], constraints: {}, excludes: [],
    };
    if (record.result !== 'conform') {
      chain.status = 'review';
      chain.reasons.push('该份报告没有给出符合结论，需人工复核');
    }
    const relations = relationsByCertificate.get(record.certificate) ?? [];
    if (relations.length === 0) {
      chain.status = chain.status === 'ready' ? 'error' : chain.status;
      chain.reasons.push('目录未公开该证书的家族关联，不能凭系列名主张覆盖');
      return chain;
    }
    if (relations.length > 1) {
      chain.status = 'conflict';
      chain.reasons.push('同一证书在家族 ' + family + ' 下存在多份关联声明，适用口径冲突');
    }
    const relation = relations[0];
    if (relation.record.representative !== record.model) {
      chain.status = 'conflict';
      chain.reasons.push('关联代表型号 ' + relation.record.representative + ' 与报告型号 ' + record.model + ' 不一致');
    }
    Object.assign(chain.constraints, relation.record.configuration);
    chain.claimSources.push({ kind: 'relation', ...view(relation) });

    for (const supplementDocument of evidence.supplements) {
      const supplement = supplementDocument.record;
      if (supplement.certificate !== record.certificate) continue;
      if (supplement.issue !== record.issue) {
        chain.status = 'conflict';
        chain.reasons.push('补充页 ' + supplement.issue + ' 与报告版次 ' + record.issue + ' 不一致');
        continue;
      }
      const clash = Object.entries(supplement.narrows).find(([key, value]) =>
        Object.hasOwn(chain.constraints, key) && chain.constraints[key] !== value);
      if (clash) {
        chain.status = 'conflict';
        chain.reasons.push('补充页 ' + supplement.title + ' 与现行适用约束在 ' + clash[0] + ' 上冲突');
        continue;
      }
      Object.assign(chain.constraints, supplement.narrows);
      chain.excludes.push(...supplement.excludes.map(attributes => ({ attributes, source: view(supplementDocument) })));
      chain.claimSources.push({ kind: 'supplement', ...view(supplementDocument) });
    }

    const differences = evidence.differences
      .filter(item => item.record.certificate === record.certificate)
      .sort((a, b) => a.record.issuedAt.localeCompare(b.record.issuedAt) || a.href.localeCompare(b.href));
    for (const differenceDocument of differences) {
      const difference = differenceDocument.record;
      if (difference.laboratory && difference.laboratory !== record.laboratory) {
        chain.status = 'conflict';
        chain.reasons.push('差异说明 ' + difference.title + ' 来自不同实验室，不能并入本报告结论');
        continue;
      }
      const mismatch = Object.entries(difference.changes).find(([key, change]) => chain.constraints[key] !== change.from);
      if (mismatch) {
        chain.status = 'conflict';
        chain.reasons.push('差异说明 ' + difference.title + ' 声明的原值与当前适用值不符：' + mismatch[0]);
        continue;
      }
      for (const [key, change] of Object.entries(difference.changes)) chain.constraints[key] = change.to;
      chain.claimSources.push({ kind: 'difference', ...view(differenceDocument) });
    }
    return chain;
  });
}

function exclusionMatches(attributes, configuration) {
  return Object.entries(attributes).every(([key, value]) => configuration[key] === value);
}

// 完整匹配：销售配置声明的每个维度都被报告适用约束覆盖且取值一致；
// 报告还约束了配置未声明的维度不影响覆盖（配置不主张该维度）。
// 部分匹配：链对配置的任一已声明维度给出了适用声明，却不能独立覆盖全部维度；
// 不同实验室的部分匹配不能拼成一次不存在的测试。
function constraintMatch(chain, configuration) {
  const keys = Object.keys(configuration);
  const conflicts = keys.filter(key => Object.hasOwn(chain.constraints, key) && chain.constraints[key] !== configuration[key]);
  if (conflicts.length > 0) return 'none';
  const unconstrained = keys.filter(key => !Object.hasOwn(chain.constraints, key));
  return unconstrained.length === 0 ? 'full' : 'partial';
}

function missingAttributes(chain, configuration) {
  return Object.keys(configuration)
    .filter(key => chain.constraints[key] !== configuration[key])
    .map(key => Object.hasOwn(chain.constraints, key)
      ? key + '（报告适用 ' + key + '=' + chain.constraints[key] + '，销售配置为 ' + configuration[key] + '）'
      : key + '（报告未声明，销售配置为 ' + configuration[key] + '）');
}

function evaluateStandard(chains, standard, configuration) {
  const scoped = chains.filter(chain => chain.standard === standard);
  const exclusions = [];
  for (const chain of scoped) {
    for (const exclusion of chain.excludes) {
      if (exclusionMatches(exclusion.attributes, configuration)) {
        exclusions.push({ certificate: chain.certificate, source: exclusion.source, attributes: exclusion.attributes });
      }
    }
  }
  const hardConflict = scoped.find(chain => chain.status === 'conflict');
  const broken = scoped.find(chain => chain.status === 'error');
  const review = scoped.find(chain => chain.status === 'review');
  const usable = scoped.filter(chain => chain.status === 'ready');
  const full = usable.filter(chain => constraintMatch(chain, configuration) === 'full');
  if (full.length > 0) {
    return {
      standard, status: 'covered',
      evidence: full.map(chain => ({
        certificate: chain.certificate, laboratory: chain.laboratory, issue: chain.issue,
        source: chain.certificateSource, claims: chain.claimSources,
        constraints: { ...chain.constraints },
      })),
    };
  }
  if (exclusions.length > 0) {
    return { standard, status: 'excluded', reason: '报告补充页明确排除该配置', exclusions };
  }
  // 任何同标准的现成链都构成对该配置的部分声明；多实验室并存时不得跨实验室拼合
  const partial = usable.filter(chain => constraintMatch(chain, configuration) !== 'full');
  if (partial.length > 0) {
    const laboratories = [...new Set(partial.map(chain => chain.laboratory))].sort();
    const basis = partial.map(chain => {
      const detail = missingAttributes(chain, configuration).join('、');
      return chain.laboratory + '/' + chain.certificate + '（' + detail + '）';
    });
    const reason = laboratories.length > 1
      ? '同一检测结论只能由同一实验室的报告链支撑，不能把不同实验室的部分依据拼成不存在的测试：' + basis.join('；')
      : '现有报告链不能独立覆盖该配置，缺少的配置依据是：' + basis.join('；');
    return { standard, status: 'incomplete', reason, laboratories, exclusions };
  }
  if (hardConflict) return { standard, status: 'conflict', reason: hardConflict.reasons.join('；'), exclusions };
  if (broken) return { standard, status: 'incomplete', reason: broken.reasons.join('；'), exclusions };
  if (review) return { standard, status: 'incomplete', reason: review.reasons.join('；'), exclusions };
  return { standard, status: 'incomplete', reason: '当前来源没有任何报告对该标准给出适用声明', exclusions };
}

export function coverFamily(evidence, options) {
  if (!options || typeof options.family !== 'string' || !options.family.trim()) throw new Error('缺少家族范围');
  const configurations = (options.configurations ?? []).map(item =>
    item.attributes ? item : { name: '', attributes: item });
  if (configurations.length === 0) throw new Error('缺少实际销售配置');
  const allStandards = options.standards?.length
    ? [...options.standards]
    : [...new Set(evidence.certificates.map(item => item.record.standard))].sort();
  if (allStandards.length === 0) throw new Error('缺少需要覆盖的检测标准');
  const chains = buildChains(evidence, options.family);
  const results = configurations.map(configuration => {
    const standards = configuration.standards?.length ? [...configuration.standards] : allStandards;
    const outcomes = standards.map(standard => evaluateStandard(chains, standard, configuration.attributes));
    let status;
    if (outcomes.some(outcome => outcome.status === 'conflict')) status = 'conflict';
    else if (outcomes.some(outcome => outcome.status === 'incomplete')) status = 'incomplete';
    else if (outcomes.some(outcome => outcome.status === 'excluded')) status = 'excluded';
    else status = 'covered';
    const gaps = outcomes
      .filter(outcome => outcome.status !== 'covered')
      .map(outcome => ({ standard: outcome.standard, status: outcome.status, reason: outcome.reason, exclusions: outcome.exclusions }));
    return {
      name: configuration.name,
      family: options.family,
      attributes: { ...configuration.attributes },
      status,
      coveredBy: outcomes.filter(outcome => outcome.status === 'covered'),
      gaps,
    };
  });
  const counts = {};
  for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
  return {
    family: options.family,
    standards: allStandards,
    counts,
    complete: results.length > 0 && results.every(result => result.status === 'covered' || result.status === 'excluded'),
    available: results.filter(result => result.status === 'covered').map(result => result.name),
    configurations: results,
    chains,
  };
}
