/** One table of a database, as a digest of every row in rowid order. */
export interface TableDump {
  columns: string[];
  rows: string[];
}

export interface DumpComparison {
  equal: boolean;
  differences: string[];
}

/** Whether the second dump holds the first one's tables, columns and rows. */
export function compareDumps(
  first: ReadonlyMap<string, TableDump>,
  second: ReadonlyMap<string, TableDump>
): DumpComparison {
  const differences: string[] = [];
  for (const [table, a] of first) {
    const b = second.get(table);
    if (!b) {
      differences.push(`table ${table} is missing`);
      continue;
    }
    if (a.columns.join(',') !== b.columns.join(',')) {
      differences.push(`table ${table} has other columns`);
    }
    if (a.rows.length !== b.rows.length) {
      differences.push(
        `table ${table} has ${b.rows.length} rows, not ${a.rows.length}`
      );
      continue;
    }
    const differing = a.rows.filter((row, index) => row !== b.rows[index]);
    if (differing.length > 0) {
      differences.push(`table ${table}: ${differing.length} rows differ`);
    }
  }
  for (const table of second.keys()) {
    if (!first.has(table)) differences.push(`table ${table} is extra`);
  }
  return { equal: differences.length === 0, differences };
}
