// Semantic DB projection shared by the correctness oracle and external measurements.
const omittedKeys = new Set(['domId', 'config', 'look', 'themeVariables']);
function plain(value, seen = new Map(), path = '$') {
  if (typeof value === 'function' || typeof value === 'undefined') return undefined;
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return { $ref: seen.get(value) };
  seen.set(value, path);
  let out;
  if (value instanceof Map) {
    const entries = [...value];
    // Sort primitive-keyed DB collections before assigning reference paths.
    // Object keys retain insertion order and need no recursive sort probe.
    if (entries.every(([key]) => key === null || typeof key !== 'object')) entries.sort((a, b) => String(JSON.stringify(a[0])).localeCompare(String(JSON.stringify(b[0]))));
    out = entries.map(([key, entry], index) => [plain(key, seen, `${path}[${index}][0]`), plain(entry, seen, `${path}[${index}][1]`)]);
  }
  else if (value instanceof Set) out = [...value].map((entry, index) => plain(entry, seen, `${path}[${index}]`));
  else if (Array.isArray(value)) out = value.map((entry, index) => plain(entry, seen, `${path}[${index}]`));
  else {
    out = {};
    for (const key of Object.keys(value).sort()) {
      if (omittedKeys.has(key) || key.startsWith('$')) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) continue;
      const entry = plain(descriptor.value, seen, `${path}[${JSON.stringify(key)}]`);
      if (entry !== undefined) out[key] = entry;
    }
  }
  seen.delete(value);
  return out;
}

export function snapshot(db, includeConfig = false) {
  const names = new Set();
  for (let proto = db; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
  }
  const data = {}, errors = {};
  for (const name of [...names].sort()) {
    if (!/^get[A-Z]|^(?:topAxisEnabled|inclusiveEndDates)$/.test(name)) continue;
    if (/Logger|DomId|Tooltip|Mapping|Position/.test(name) || /Config/.test(name) && !includeConfig) continue;
    const getter = db[name];
    // These C4 getters take an optional parent filter. Calling them without
    // one returns the complete authored collection, needed for label census.
    const optionalFilter = name === 'getC4ShapeArray' || name === 'getBoundaries';
    if (typeof getter !== 'function' || (getter.length !== 0 && !optionalFilter)) continue;
    try {
      const value = getter.call(db);
      if (value && typeof value.then === 'function') continue;
      const normalized = name === 'getCommonDb' ? snapshot(value).data : plain(value);
      if (normalized !== undefined) data[name] = normalized;
    } catch (error) { errors[name] = String(error?.message ?? error).slice(0, 500); }
  }
  return { data, errors };
}
