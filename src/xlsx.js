// Minimal .xlsx reader (first sheet only), no dependencies.
// Uses DecompressionStream, available in modern browsers and Node 18+.

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Read the zip central directory and return { name: () => Promise<Uint8Array> }.
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip/xlsx file');
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const entries = {};
  for (let n = 0; n < count; n++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = u16(buf, p + 10);
    const csize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28), extraLen = u16(buf, p + 30), cmtLen = u16(buf, p + 32);
    const local = u32(buf, p + 42);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries[name] = async () => {
      const dataStart = local + 30 + u16(buf, local + 26) + u16(buf, local + 28);
      const raw = buf.subarray(dataStart, dataStart + csize);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new Error('Unsupported zip method ' + method);
    };
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
}

const decodeXml = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const textOf = (xml) =>
  [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('');

const colIndex = (ref) => {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

// Returns rows as arrays of strings, like parseDelimited().
export async function readXlsxRows(arrayBuffer) {
  const entries = zipEntries(new Uint8Array(arrayBuffer));
  const read = async (n) => (entries[n] ? new TextDecoder().decode(await entries[n]()) : '');

  const shared = [...(await read('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    textOf(m[1])
  );
  const sheetName =
    Object.keys(entries).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new Error('No worksheet found');
  const xml = await read(sheetName);

  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      let v = '';
      if (type === 's') v = shared[Number(/<v>(.*?)<\/v>/.exec(inner)?.[1])] ?? '';
      else if (type === 'inlineStr') v = textOf(inner);
      else v = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      row[ref ? colIndex(ref) : row.length] = v;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    if (row.some((f) => f !== '')) rows.push(row);
  }
  return rows;
}
