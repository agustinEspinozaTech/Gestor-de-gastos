/**
 * Responsabilidad: capa de acceso a Airtable REST API usando fetch().
 * - Maneja requests, paginación de listRecords, y CRUD.
 * - No usa librerías externas.
 */

import { AIRTABLE_API_URL, AIRTABLE_BASE_ID, AIRTABLE_TOKEN } from "../config.js";

function assertConfig() {
  if (!AIRTABLE_BASE_ID || AIRTABLE_BASE_ID.includes("PEGA_ACA")) {
    throw new Error("Falta configurar AIRTABLE_BASE_ID en js/config.js");
  }
  if (!AIRTABLE_TOKEN || AIRTABLE_TOKEN.includes("PEGA_ACA")) {
    throw new Error("Falta configurar AIRTABLE_TOKEN en js/config.js");
  }
}

function buildUrl(table, path = "", queryParams = null) {
  const base = `${AIRTABLE_API_URL}/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(table)}${path}`;
  if (!queryParams) return base;
  const qs = new URLSearchParams(queryParams);
  return `${base}?${qs.toString()}`;
}

export async function airtableRequest(method, table, path = "", body = null, queryParams = null) {
  assertConfig();

  const url = buildUrl(table, path, queryParams);
  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : null
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg = data?.error?.message || `Error Airtable (${res.status})`;
    const detail = data?.error?.type ? ` (${data.error.type})` : "";
    throw new Error(`${msg}${detail}`);
  }

  return data;
}

export async function listRecords(table, filterFormula = "", extraParams = {}) {
  /**
   * Lista records con paginación automática.
   * filterByFormula se pasa sin URL-encode manual (URLSearchParams lo hace).
   */
  const records = [];
  let offset = undefined;

  do {
    const params = {
      ...extraParams
    };
    if (filterFormula) params.filterByFormula = filterFormula;
    if (offset) params.offset = offset;

    const data = await airtableRequest("GET", table, "", null, params);
    if (Array.isArray(data?.records)) records.push(...data.records);
    offset = data?.offset;
  } while (offset);

  return records;
}

export async function createRecord(table, fields) {
  const body = { fields };
  const data = await airtableRequest("POST", table, "", body);
  return data;
}

export async function updateRecord(table, recordId, fields) {
  const body = { fields };
  const data = await airtableRequest("PATCH", table, `/${encodeURIComponent(recordId)}`, body);
  return data;
}

export async function deleteRecord(table, recordId) {
  const data = await airtableRequest("DELETE", table, `/${encodeURIComponent(recordId)}`);
  return data;
}

/**
 * Batch update opcional (mejora el reset mensual de isPaid).
 * Airtable permite hasta 10 records por request.
 */
export async function batchUpdateRecords(table, updates) {
  // updates: [{id, fields}, ...]
  const chunks = [];
  for (let i = 0; i < updates.length; i += 10) {
    chunks.push(updates.slice(i, i + 10));
  }

  const results = [];
  for (const chunk of chunks) {
    const body = { records: chunk.map(u => ({ id: u.id, fields: u.fields })) };
    const data = await airtableRequest("PATCH", table, "", body);
    if (Array.isArray(data?.records)) results.push(...data.records);
  }
  return results;
}
