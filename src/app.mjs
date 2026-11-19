import { browse, retrieve, retrieveLinked } from './source.mjs';
import { interpret } from './interpret.mjs';
import { assess, summarize } from './receiving.mjs';
import { interpretRelation, interpretSupplement, interpretDifference, interpretConfiguration } from './family.mjs';
import { coverFamily } from './coverage.mjs';
import { createHash } from 'node:crypto';

export async function preview(client) {
  const manifest = await browse(client);
  const entries = [];
  for (const ref of manifest.references) {
    const document = await retrieve(client, ref);
    entries.push(interpret(document.raw));
  }
  return { context: manifest.context, entries };
}

export async function collect(client, archive, scope, operator) {
  const manifest = await browse(client);
  const outcomes = [];
  for (const reference of manifest.references) {
    let digest;
    try {
      const document = await retrieve(client, reference);
      digest = await archive.preserve(document);
      const record = interpret(document.raw);
      const prior = archive.records(scope).filter(item => item.decision.status === 'accepted').map(item => item.record);
      const decision = assess(record, prior, scope);
      if (operator && decision.status === 'accepted') decision.portal = await operator(record);
      archive.put(scope, decision.key ?? reference.identity, digest, record, decision);
      outcomes.push({ reference: reference.identity, digest, ...decision });
    } catch (error) {
      outcomes.push({ reference: reference.identity, digest, status: 'error', reason: error.message });
    }
  }
  return { context: manifest.context, ...summarize(outcomes) };
}

// 沿目录公开的关联逐跳领取：关联页 -> 补充页 / 差异说明。
// 未在公开链接中出现的路径不会被请求。
async function followFamilyLinks(client, manifest, archive, scope, preserve) {
  const documentOutcomes = [];
  const evidence = { certificates: [], relations: [], supplements: [], differences: [] };
  const seen = new Set();

  const take = async (link, kind, context, parse, expectCertificate) => {
    if (seen.has(kind + '|' + link)) return;
    seen.add(kind + '|' + link);
    try {
      const document = await retrieveLinked(client, link, context, kind);
      const digest = preserve ? await archive.preserve(document)
        : createHash('sha256').update(document.bytes).digest('hex');
      const record = parse(document.raw);
      if (expectCertificate && record.certificate !== expectCertificate) {
        throw new Error(kind + '证书身份与公开关联不符');
      }
      documentOutcomes.push({ kind, link, digest, status: 'accepted' });
      if (preserve) {
        archive.put(scope, kind + ':' + link.slice(1), digest, record, { status: 'accepted', kind, link });
      }
      return { record, href: link, digest };
    } catch (error) {
      documentOutcomes.push({ kind, link, status: 'error', reason: error.message });
      return null;
    }
  };

  for (const reference of manifest.references) {
    try {
      const document = await retrieve(client, reference);
      const digest = preserve ? await archive.preserve(document)
        : createHash('sha256').update(document.bytes).digest('hex');
      const record = interpret(document.raw);
      documentOutcomes.push({ kind: 'certificate', link: reference.href, digest, status: 'accepted' });
      if (preserve) {
        archive.put(scope, 'certificate:' + reference.identity, digest, record, { status: 'accepted', kind: 'certificate' });
      }
      evidence.certificates.push({ record, href: reference.href, digest });
    } catch (error) {
      documentOutcomes.push({ kind: 'certificate', link: reference.href, status: 'error', reason: error.message });
    }
  }

  for (const reference of manifest.references) {
    for (const link of reference.relations ?? []) {
      const relationDocument = await take(link, 'relation', reference.context, interpretRelation, reference.identity);
      if (!relationDocument) continue;
      const relation = relationDocument.record;
      evidence.relations.push(relationDocument);
      for (const supplementLink of relation.supplements) {
        const supplement = await take(supplementLink, 'supplement', reference.context, interpretSupplement, reference.identity);
        if (supplement) evidence.supplements.push(supplement);
      }
      for (const differenceLink of relation.differences) {
        const difference = await take(differenceLink, 'difference', reference.context, interpretDifference, reference.identity);
        if (difference) evidence.differences.push(difference);
      }
    }
  }
  return { evidence, documentOutcomes };
}

// 只读预览：不入库，业务人员可先查看来源当前能领取到的家族资料
export async function previewFamily(client, family, configurations, options = {}) {
  const manifest = await browse(client);
  const { evidence, documentOutcomes } = await followFamilyLinks(client, manifest, null, '', false);
  const coverage = coverFamily(evidence, {
    family,
    configurations: configurations.map(interpretConfiguration),
    standards: options.standards,
  });
  return { context: manifest.context, family, documents: documentOutcomes, ...coverage };
}

// 家族领取：保存全部原文、形成覆盖结论，并把当前可交付的渠道包作为快照落库
export async function collectFamily(client, archive, family, configurations, options = {}) {
  if (!family || typeof family !== 'string') throw new Error('缺少家族范围');
  const scope = options.scope ?? ('family:' + family);
  const manifest = await browse(client);
  const { evidence, documentOutcomes } = await followFamilyLinks(client, manifest, archive, scope, true);
  const coverage = coverFamily(evidence, {
    family,
    configurations: configurations.map(interpretConfiguration),
    standards: options.standards,
  });
  const snapshotId = new Date().toISOString() + '-' + createHash('sha256')
    .update(JSON.stringify(coverage.configurations)).digest('hex').slice(0, 12);
  const channelPackage = {
    family,
    standards: coverage.standards,
    available: coverage.available,
    configurations: coverage.configurations,
    producedFrom: documentOutcomes.filter(item => item.status === 'accepted').map(item => ({ kind: item.kind, href: item.link, digest: item.digest })),
  };
  archive.savePackage(family, snapshotId, channelPackage);
  const documentSummary = summarize(documentOutcomes);
  return {
    context: manifest.context,
    family,
    scope,
    snapshotId,
    documents: documentOutcomes,
    documentCounts: documentSummary.counts,
    documentsComplete: documentSummary.complete,
    ...coverage,
    channelPackage,
  };
}
