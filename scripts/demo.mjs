import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceClient } from '../src/http.mjs';
import { Archive } from '../src/archive.mjs';
import { fixtureSource } from '../src/fixture-source.mjs';
import { collect, collectFamily } from '../src/app.mjs';

const singleFixture = JSON.parse(await readFile(new URL('../fixtures/source.json', import.meta.url), 'utf8'));
const familyFixture = JSON.parse(await readFile(new URL('../fixtures/family-source.json', import.meta.url), 'utf8'));

const directory = await mkdtemp(join(tmpdir(), 'conformity-family-'));
const archive = await new Archive(directory).start();
try {
  // 单份证书查询维持原来的用法
  const singleSource = await fixtureSource(singleFixture);
  try {
    const single = await collect(new SourceClient(singleSource.url), archive, singleFixture.scope);
    console.log('单证书收件：', JSON.stringify(single.counts));
  } finally {
    await singleSource.close();
  }

  // 家族配置覆盖：按实际销售配置领取证书、代表型号报告、差异说明、补充页与排除项
  const familySource = await fixtureSource(familyFixture);
  try {
    const result = await collectFamily(
      new SourceClient(familySource.url), archive, familyFixture.family, familyFixture.configurations);
    console.log('\n家族覆盖结论：');
    for (const configuration of result.configurations) {
      const detail = configuration.status === 'covered'
        ? '覆盖依据 ' + configuration.coveredBy.map(item => item.standard + '<-' + item.evidence.map(e => e.certificate).join(',')).join('；')
        : configuration.gaps.map(gap => gap.standard + ':' + gap.reason).join('；');
      console.log(' -', configuration.name, configuration.attributes, '=>', configuration.status, detail);
    }
    console.log('\n渠道当前可用包（快照 ' + result.snapshotId + '）：', result.channelPackage.available);
    console.log('家族原文与收据数量：', archive.records('family:' + familyFixture.family).length);
    if (result.documents.some(item => item.status === 'error')) process.exitCode = 1;
  } finally {
    await familySource.close();
  }
} finally {
  archive.close();
  await rm(directory, { recursive: true, force: true });
}
