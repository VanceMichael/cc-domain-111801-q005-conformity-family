export function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('字段缺失或无效：' + name);
  return value;
}
export function decimal(value, name) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('十进制字段无效：' + name);
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error('数值超出范围：' + name);
  return result;
}
export function array(value, name) {
  if (!Array.isArray(value)) throw new Error('字段缺失或无效：' + name);
  return value;
}
export function attributes(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('属性集合无效：' + name);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    text(key, name + '键');
    result[key] = text(item, name + '.' + key);
  }
  if (Object.keys(result).length === 0) throw new Error('属性集合为空：' + name);
  return result;
}
export function linkPath(value, name) {
  const result = text(value, name);
  if (!result.startsWith('/')) throw new Error('关联位置必须是来源内路径：' + name);
  try {
    const url = new URL(result, 'http://source.local');
    if (url.origin !== 'http://source.local') throw new Error('x');
  } catch {
    throw new Error('关联位置不是来源内路径：' + name);
  }
  return result;
}
