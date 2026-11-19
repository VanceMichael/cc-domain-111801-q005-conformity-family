import { text, array, attributes, linkPath } from './validation.mjs';

// 关联资料（代表型号报告的家族适用声明）
export function interpretRelation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('关联记录不是对象');
  const relation = {
    kind: 'relation',
    family: text(raw.family, 'family'),
    certificate: text(raw.certificate, 'certificate'),
    representative: text(raw.representative, 'representative'),
    configuration: attributes(raw.configuration, 'configuration'),
    supplements: [],
    differences: [],
  };
  if (raw.supplements !== undefined) {
    relation.supplements = array(raw.supplements, 'supplements').map(item => linkPath(item, 'supplements'));
  }
  if (raw.differences !== undefined) {
    relation.differences = array(raw.differences, 'differences').map(item => linkPath(item, 'differences'));
  }
  return relation;
}

// 报告补充页：只能收窄适用约束或追加排除，不能放宽早先声明
export function interpretSupplement(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('补充页记录不是对象');
  return {
    kind: 'supplement',
    certificate: text(raw.certificate, 'certificate'),
    issue: text(raw.issue, 'issue'),
    title: text(raw.title, 'title'),
    issuedAt: text(raw.issuedAt, 'issuedAt'),
    narrows: attributes(raw.narrows, 'narrows'),
    excludes: array(raw.excludes ?? [], 'excludes').map(item => attributes(item, 'excludes')),
  };
}

// 差异说明：按原值替换后给出新值；只能改它明确声明的属性
export function interpretDifference(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('差异说明记录不是对象');
  const change = raw.change;
  if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('差异说明缺少变更内容');
  const changes = {};
  for (const [key, item] of Object.entries(change)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('差异条目无效：' + key);
    changes[key] = { from: text(item.from, 'change.' + key + '.from'), to: text(item.to, 'change.' + key + '.to') };
    if (changes[key].from === changes[key].to) throw new Error('差异说明没有实际改变属性：' + key);
  }
  if (Object.keys(changes).length === 0) throw new Error('差异说明缺少变更内容');
  return {
    kind: 'difference',
    certificate: text(raw.certificate, 'certificate'),
    issue: text(raw.issue, 'issue'),
    title: text(raw.title, 'title'),
    issuedAt: text(raw.issuedAt, 'issuedAt'),
    changes,
  };
}

// 业务提出的实际销售配置
export function interpretConfiguration(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('销售配置不是对象');
  const sourceAttributes = raw.attributes ?? Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== 'name' && key !== 'standards'));
  const configuration = {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '',
    standards: Array.isArray(raw.standards) ? raw.standards.map(item => text(item, 'standards')) : undefined,
    attributes: attributes(sourceAttributes, 'attributes'),
  };
  if (!configuration.name) {
    configuration.name = Object.keys(configuration.attributes).sort().map(key => key + '=' + configuration.attributes[key]).join('|');
  }
  return configuration;
}
