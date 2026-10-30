const cell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export const toCsv = (rows: string[][]): string => rows.map((r) => r.map(cell).join(",")).join("\r\n");

export const downloadCsv = (filename: string, rows: string[][]): void => {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
