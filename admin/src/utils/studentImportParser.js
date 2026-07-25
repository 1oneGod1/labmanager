export const MAX_STUDENT_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_STUDENT_IMPORT_ROWS = 5_000;
export const MAX_STUDENT_IMPORT_COLUMNS = 50;

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

export function spreadsheetRowsToRecords(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  if (rows.length - 1 > MAX_STUDENT_IMPORT_ROWS) {
    throw new Error(`Berkas melebihi batas ${MAX_STUDENT_IMPORT_ROWS.toLocaleString('id-ID')} siswa.`);
  }

  const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
  if (headerRow.length === 0 || headerRow.length > MAX_STUDENT_IMPORT_COLUMNS) {
    throw new Error('Jumlah kolom berkas tidak valid.');
  }

  const headers = headerRow.map((value, index) => {
    const rawHeader = String(value ?? '');
    const header = (index === 0 ? rawHeader.replace(/^\uFEFF/, '') : rawHeader).trim();
    return header || `kolom_${index + 1}`;
  });

  return rows
    .slice(1)
    .filter((row) => Array.isArray(row) && row.some(hasValue))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}

export function parseStudentCsv(csvText) {
  const input = String(csvText ?? '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  const pushCell = () => {
    if (row.length >= MAX_STUDENT_IMPORT_COLUMNS) {
      throw new Error(`CSV melebihi batas ${MAX_STUDENT_IMPORT_COLUMNS} kolom.`);
    }
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    if (row.some(hasValue) || rows.length === 0) rows.push(row);
    row = [];
    if (rows.length - 1 > MAX_STUDENT_IMPORT_ROWS) {
      throw new Error(`CSV melebihi batas ${MAX_STUDENT_IMPORT_ROWS.toLocaleString('id-ID')} siswa.`);
    }
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      pushCell();
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      pushRow();
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error('Format CSV tidak valid: tanda kutip belum ditutup.');
  if (cell.length > 0 || row.length > 0) pushRow();
  return spreadsheetRowsToRecords(rows);
}
