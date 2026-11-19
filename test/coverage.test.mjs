import test from 'node:test';
import assert from 'node:assert/strict';
import { coverFamily, buildChains } from '../src/coverage.mjs';
import { interpret, } from '../src/interpret.mjs';
import { interpretRelation, interpretSupplement, interpretDifference } from '../src/family.mjs';

const cert = (overrides) => ({
  record: interpret({ certificate: 'CF1', laboratory: 'LAB1', model: 'M-A', standard: 'STD1', result: 'conform', issue: '1', ...overrides }),
  href: '/r/CF1', digest: 'd' + Math.random().toString(16).slice(2),
});
const relation = (overrides) => ({
  record: interpretRelation({
    family: 'FAM', certificate: 'CF1', representative: 'M-A',
    configuration: { power: 'PSU-A', module: 'M1' }, supplements: [], differences: [], ...overrides,
  }),
  href: '/rel/' + (overrides?.certificate ?? 'CF1'), digest: 'rel-d',
});
const configurations = [{ name: 'S1', standards: ['STD1'], attributes: { power: 'PSU-A', module: 'M1' } }];

test('没有公开家族关联时不凭系列名主张覆盖，只说明缺依据', () => {
  const result = coverFamily(
    { certificates: [cert()], relations: [], supplements: [], differences: [] },
    { family: 'FAM', configurations });
  const chain = result.chains[0];
  assert.equal(chain.status, 'error');
  assert.match(chain.reasons[0], /不能凭系列名/);
  assert.equal(result.configurations[0].status, 'incomplete');
  assert.notEqual(result.configurations[0].status, 'excluded');
});

test('系列标题相同但代表型号不一致判为冲突，不接收覆盖', () => {
  const result = coverFamily(
    { certificates: [cert()], relations: [relation({ representative: 'OTHER' })], supplements: [], differences: [] },
    { family: 'FAM', configurations });
  assert.equal(result.chains[0].status, 'conflict');
  assert.equal(result.configurations[0].status, 'conflict');
});

test('报告无符合结论时进入复核，不把产品判成不合格', () => {
  const result = coverFamily(
    { certificates: [cert({ result: 'not-conform' })], relations: [relation()], supplements: [], differences: [] },
    { family: 'FAM', configurations });
  assert.equal(result.chains[0].status, 'review');
  assert.equal(result.configurations[0].status, 'incomplete');
  assert.match(result.configurations[0].gaps[0].reason, /复核/);
});

test('补充页只能收窄：与现行约束矛盾时标记冲突', () => {
  const supplement = {
    record: interpretSupplement({
      certificate: 'CF1', issue: '1', title: 'S2', issuedAt: '2026-02-01',
      narrows: { module: 'M9' }, excludes: [],
    }),
    href: '/sup/S2', digest: 'sup-d',
  };
  const result = coverFamily(
    { certificates: [cert()], relations: [relation()], supplements: [supplement], differences: [] },
    { family: 'FAM', configurations });
  assert.equal(result.chains[0].status, 'conflict');
  assert.match(result.chains[0].reasons.join('；'), /冲突/);
});

test('补充页版次与报告版次不一致不能并入', () => {
  const supplement = {
    record: interpretSupplement({
      certificate: 'CF1', issue: '9', title: 'S2', issuedAt: '2026-02-01',
      narrows: { region: 'EU' }, excludes: [],
    }),
    href: '/sup/S2', digest: 'sup-d',
  };
  const result = coverFamily(
    { certificates: [cert()], relations: [relation()], supplements: [supplement], differences: [] },
    { family: 'FAM', configurations });
  assert.equal(result.chains[0].status, 'conflict');
  assert.match(result.chains[0].reasons.join('；'), /版次/);
});

test('差异说明原值与当前适用值不符时拒绝替换', () => {
  const difference = {
    record: interpretDifference({
      certificate: 'CF1', issue: '1', title: 'D3', issuedAt: '2026-03-01',
      change: { module: { from: 'M0', to: 'M2' } },
    }),
    href: '/diff/D3', digest: 'diff-d',
  };
  const result = coverFamily(
    { certificates: [cert()], relations: [relation()], supplements: [], differences: [difference] },
    { family: 'FAM', configurations });
  assert.equal(result.chains[0].status, 'conflict');
  assert.deepEqual(result.chains[0].constraints.module, 'M1');
});

test('差异说明按时间生效并保留完整追溯链', () => {
  const difference = {
    record: interpretDifference({
      certificate: 'CF1', issue: '1', title: 'D3', issuedAt: '2026-03-01',
      change: { module: { from: 'M1', to: 'M2' } },
    }),
    href: '/diff/D3', digest: 'diff-d',
  };
  const shifted = [{ name: 'S2', standards: ['STD1'], attributes: { power: 'PSU-A', module: 'M2' } }];
  const result = coverFamily(
    { certificates: [cert()], relations: [relation()], supplements: [], differences: [difference] },
    { family: 'FAM', configurations: shifted });
  const outcome = result.configurations[0].coveredBy[0];
  assert.equal(outcome.status, 'covered');
  assert.deepEqual(outcome.evidence[0].claims.map(item => item.kind), ['relation', 'difference']);
  assert.equal(outcome.evidence[0].claims[1].href, '/diff/D3');
});

test('buildChains 忽略其他家族的关联声明', () => {
  const chains = buildChains(
    { certificates: [cert()], relations: [relation({ family: 'OTHER' })], supplements: [], differences: [] },
    'FAM');
  assert.equal(chains[0].status, 'error');
});

test('同一标准同一实验室的多份报告均可独立支撑，不触发拼合', () => {
  const second = cert({ certificate: 'CF2' });
  const secondRelation = relation({ certificate: 'CF2' });
  secondRelation.href = '/rel/CF2';
  const result = coverFamily(
    { certificates: [cert(), second], relations: [relation(), secondRelation], supplements: [], differences: [] },
    { family: 'FAM', configurations });
  assert.equal(result.configurations[0].status, 'covered');
  assert.equal(result.configurations[0].coveredBy[0].evidence.length, 2);
});

test('多份差异说明按发布时间顺序替换，早先系列页结论不被删除', () => {
  const first = {
    record: interpretDifference({
      certificate: 'CF1', issue: '1', title: 'D1', issuedAt: '2026-03-01',
      change: { module: { from: 'M1', to: 'M2' } },
    }),
    href: '/diff/D1', digest: 'd1',
  };
  const second = {
    record: interpretDifference({
      certificate: 'CF1', issue: '1', title: 'D2', issuedAt: '2026-04-01',
      change: { module: { from: 'M2', to: 'M3' } },
    }),
    href: '/diff/D2', digest: 'd2',
  };
  const shifted = [{ name: 'S3', standards: ['STD1'], attributes: { power: 'PSU-A', module: 'M3' } }];
  const result = coverFamily(
    { certificates: [cert()], relations: [relation()], supplements: [], differences: [second, first] },
    { family: 'FAM', configurations: shifted });
  assert.equal(result.chains[0].constraints.module, 'M3');
  const claims = result.configurations[0].coveredBy[0].evidence[0].claims;
  assert.deepEqual(claims.map(item => item.href), ['/rel/CF1', '/diff/D1', '/diff/D2']);
});
