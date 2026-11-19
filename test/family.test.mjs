import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceClient } from '../src/http.mjs';
import { fixtureSource } from '../src/fixture-source.mjs';
import { Archive } from '../src/archive.mjs';
import { previewFamily, collectFamily } from '../src/app.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/family-source.json', import.meta.url), 'utf8'));
const family = fixture.family;

async function withHarness(run) {
  const source = await fixtureSource(fixture);
  const directory = await mkdtemp(join(tmpdir(), 'family-'));
  const archive = await new Archive(directory).start();
  try {
    await run(source, archive);
  } finally {
    archive.close();
    await source.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const resultOf = (result, name) => result.configurations.find(item => item.name === name);
const standardOutcome = (config, standard) =>
  config.coveredBy.find(item => item.standard === standard) ??
  config.gaps.find(item => item.standard === standard);

test('差异说明改模组后覆盖随新模组生效，旧报告原文仍在库', async () => {
  await withHarness(async (source, archive) => {
    const result = await collectFamily(new SourceClient(source.url), archive, family, fixture.configurations);
    assert.equal(resultOf(result, 'C3').status, 'covered');
    assert.equal(resultOf(result, 'C1').status, 'incomplete');
    const c3std1 = standardOutcome(resultOf(result, 'C3'), 'STD1');
    assert.equal(c3std1.status, 'covered');
    const claimKinds = c3std1.evidence[0].claims.map(item => item.kind);
    assert.deepEqual(claimKinds, ['relation', 'supplement', 'difference']);
    const difference = c3std1.evidence[0].claims.find(item => item.kind === 'difference');
    assert.equal(difference.href, '/conformity/models/differences/CF100-D3');
    const receipts = archive.records('family:' + family);
    assert.ok(receipts.some(item => item.business_key === 'relation:conformity/models/relations/CF100'));
    assert.ok(receipts.some(item => item.business_key === 'difference:conformity/models/differences/CF100-D3'));
    const original = await archive.original(difference.digest);
    assert.equal(JSON.parse(original.toString()).change.module.to, 'M2');
  });
});

test('补充页排除项优先于系列覆盖：M3 被明确排除', async () => {
  await withHarness(async (source, archive) => {
    const result = await collectFamily(new SourceClient(source.url), archive, family, fixture.configurations);
    const c5 = resultOf(result, 'C5');
    const std1 = standardOutcome(c5, 'STD1');
    assert.equal(std1.status, 'excluded');
    assert.equal(std1.exclusions[0].source.href, '/conformity/models/supplements/CF100-S2');
    assert.equal(c5.status, 'excluded');
  });
});

test('区域收窄后非欧盟配置缺少依据，但不被判为不合格', async () => {
  await withHarness(async (source, archive) => {
    // 仅保留 LAB1 报告链，隔离区域收窄语义
    source.replace('/conformity/models/records/CF600', { status: 404, body: { error: '暂不存在' } });
    const result = await collectFamily(new SourceClient(source.url), archive, family, fixture.configurations);
    const c6 = resultOf(result, 'C6');
    assert.equal(c6.status, 'incomplete');
    const gap = c6.gaps.find(item => item.standard === 'STD1');
    assert.match(gap.reason, /region/);
  });
});

test('多份报告可共同支撑同一配置，覆盖结论可逐页追溯', async () => {
  await withHarness(async (source, archive) => {
    const joint = [{ name: 'J1', standards: ['STD1', 'STD2'], attributes: { power: 'PSU-A', module: 'M2', region: 'EU' } }];
    const result = await collectFamily(new SourceClient(source.url), archive, family, joint);
    const j1 = resultOf(result, 'J1');
    assert.equal(j1.status, 'covered');
    const standards = j1.coveredBy.map(item => item.standard).sort();
    assert.deepEqual(standards, ['STD1', 'STD2']);
    const byStandard = Object.fromEntries(j1.coveredBy.map(item => [item.standard, item.evidence[0].laboratory]));
    assert.equal(byStandard.STD1, 'LAB1');
    assert.equal(byStandard.STD2, 'LAB2');
    const trace = j1.coveredBy.flatMap(item => item.evidence.flatMap(e => [e.source.href, ...e.claims.map(claim => claim.href)]));
    assert.ok(trace.includes('/conformity/models/relations/CF100'));
    assert.ok(trace.includes('/conformity/models/relations/CF600'));
  });
});

test('同一检测结论不能把不同实验室的部分依据拼成不存在的测试', async () => {
  await withHarness(async (source, archive) => {
    const result = await collectFamily(new SourceClient(source.url), archive, family, fixture.configurations);
    const c4 = resultOf(result, 'C4');
    assert.equal(c4.status, 'incomplete');
    const std3 = standardOutcome(c4, 'STD3');
    assert.equal(std3.status, 'incomplete');
    assert.match(std3.reason, /不能把不同实验室的部分依据拼成/);
    assert.equal(result.available.includes('C4'), false);
  });
});

test('渠道当前可用包只含覆盖成立的配置，且作为快照保留历次结果', async () => {
  await withHarness(async (source, archive) => {
    const first = await collectFamily(new SourceClient(source.url), archive, family, fixture.configurations);
    assert.deepEqual(first.channelPackage.available, ['C3']);
    assert.equal(first.complete, false);
    const history = archive.packages(family);
    assert.equal(history.length, 1);
    const second = await collectFamily(new SourceClient(source.url), archive, family, fixture.configurations);
    assert.equal(archive.packages(family).length, 2);
    assert.deepEqual(second.available, ['C3']);
    assert.deepEqual(archive.latestPackage(family).package.available, ['C3']);
  });
});

test('只沿公开关联领取：未授权路径从不请求，链接失效记为缺依据', async () => {
  await withHarness(async (source, archive) => {
    source.replace('/conformity/models/differences/CF100-D3', { status: 403, body: { error: '无权领取' } });
    const result = await collectFamily(new SourceClient(source.url), archive, family, fixture.configurations);
    assert.equal(source.accesses.some(item => item.path === '/secret/unlisted-report'), false);
    const failed = result.documents.find(item => item.link === '/conformity/models/differences/CF100-D3');
    assert.equal(failed.status, 'error');
    // 差异说明取不到，CF100 链回到原模组 M1：M2 配置失去该项依据
    const c3 = resultOf(result, 'C3');
    assert.equal(c3.status, 'incomplete');
    assert.equal(standardOutcome(c3, 'STD1').status, 'incomplete');
    // 与差异说明无关的其他报告链保持有效，不被连带废弃
    assert.equal(standardOutcome(resultOf(result, 'C2'), 'STD2').status, 'covered');
  });
});

test('差异说明失效时仍有效的其他配置不被重复废弃', async () => {
  await withHarness(async (source, archive) => {
    source.replace('/conformity/models/differences/CF100-D3', { status: 404, body: { error: '暂不存在' } });
    const result = await collectFamily(new SourceClient(source.url), archive, family, fixture.configurations);
    // C1 是原关联页直接声明的配置（PSU-A/M1/EU），差异失效后仍由 CF100 覆盖
    const c1 = resultOf(result, 'C1');
    assert.equal(standardOutcome(c1, 'STD1').status, 'covered');
    // 其他证书的结论不受影响
    const c2Std2 = standardOutcome(resultOf(result, 'C2'), 'STD2');
    assert.equal(c2Std2.status, 'covered');
    // 依赖差异说明才能成立的 M2 配置明确标注缺依据，而不是误判不合格
    const c3Std1 = standardOutcome(resultOf(result, 'C3'), 'STD1');
    assert.equal(c3Std1.status, 'incomplete');
  });
});

test('只读预览不写入归档，且提供同样的覆盖视图', async () => {
  await withHarness(async (source, archive) => {
    const result = await previewFamily(new SourceClient(source.url), family, fixture.configurations);
    assert.equal(result.family, family);
    assert.equal(resultOf(result, 'C3').status, 'covered');
    assert.equal(archive.records('family:' + family).length, 0);
    assert.equal(archive.packages(family).length, 0);
  });
});

test('关联资料证书身份与目录不符时拒绝并入报告链', async () => {
  await withHarness(async (source, archive) => {
    source.replace('/conformity/models/relations/CF100', {
      body: {
        family, certificate: 'CF999', representative: 'MODEL-A',
        configuration: { power: 'PSU-A', module: 'M2', region: 'EU' },
        supplements: [], differences: [],
      },
    });
    const result = await collectFamily(new SourceClient(source.url), archive, family, fixture.configurations);
    const failed = result.documents.find(item => item.link === '/conformity/models/relations/CF100');
    assert.equal(failed.status, 'error');
    assert.match(failed.reason, /身份/);
    assert.equal(resultOf(result, 'C3').status, 'incomplete');
  });
});

test('目录未公开关联时不猜测任何路径，缺依据只来自已领取内容', async () => {
  await withHarness(async (source, archive) => {
    const stripped = {
      laboratory: 'LAB1',
      certificates: fixture.resources['/conformity/models'].body.certificates.map(({ id, laboratory, href }) => ({ id, laboratory, href })),
    };
    source.replace('/conformity/models', { body: stripped });
    const result = await collectFamily(new SourceClient(source.url), archive, family, fixture.configurations);
    assert.equal(source.accesses.some(item => item.path.includes('/relations/')), false);
    assert.equal(source.accesses.some(item => item.path.includes('/supplements/')), false);
    assert.equal(result.configurations.every(item => item.status === 'incomplete' || item.status === 'conflict'), true);
  });
});
