import { text, decimal } from './validation.mjs';

export function interpret(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('来源记录不是对象');
  if (!['conform', 'not-conform'].includes(raw.result)) throw new Error('检测结果未识别');
           return { certificate: text(raw.certificate, 'certificate'), laboratory: text(raw.laboratory, 'laboratory'), model: text(raw.model, 'model'), standard: text(raw.standard, 'standard'), result: raw.result, issue: text(raw.issue, 'issue') };
}
