import { text, array, linkPath } from './validation.mjs';

export const collectionPath = "/conformity/models";
export async function browse(client) {
  const document = await client.get(collectionPath);
  const raw = document.raw;
  const context = text(raw.laboratory, "laboratory");
  if (!Array.isArray(raw.certificates)) throw new Error('来源目录结构无效');
  const references = raw.certificates.map(entry => {
    const reference = {
      identity: text(entry.id, 'id'), href: text(entry.href, 'href'),
      context: entry.laboratory === undefined ? context : text(entry.laboratory, 'laboratory'),
    };
    if (entry.relations !== undefined) {
      reference.relations = array(entry.relations, 'relations').map(item => linkPath(item, 'relations'));
    }
    return reference;
  });
  if (new Set(references.map(entry => entry.identity)).size !== references.length) throw new Error('目录包含重复来源身份');
  const links = references.flatMap(entry => entry.relations ?? []);
  if (new Set(links).size !== links.length) throw new Error('目录包含重复关联位置');
  return { context, references };
}
export async function retrieve(client, reference) {
  const document = await client.get(reference.href);
  if (document.raw.certificate !== reference.identity) throw new Error('原文身份与目录引用不符');
  if (document.raw.laboratory !== reference.context) throw new Error('原文上下文与目录不符');
  return document;
}
export async function retrieveLinked(client, link, context, kind) {
  const document = await client.get(linkPath(link, kind));
  const raw = document.raw;
  if (typeof raw.laboratory === 'string' && raw.laboratory.trim() && raw.laboratory !== context) {
    throw new Error(kind + '实验室上下文与目录不符');
  }
  return document;
}
