import type { EditorView } from "@codemirror/view";

import { extractMetabotBufferContext } from "./utils";

const createMockView = ({
  sql,
  from,
  to,
}: {
  sql: string;
  from: number;
  to?: number;
}) => {
  const lines = sql.split("\n");

  const getLineAt = (position: number) => {
    let offset = 0;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const lineStart = offset;
      const lineEnd = lineStart + line.length;

      if (position <= lineEnd || index === lines.length - 1) {
        return {
          number: index + 1,
          from: lineStart,
          to: lineEnd,
          text: line,
        };
      }

      offset = lineEnd + 1;
    }

    return {
      number: lines.length,
      from: sql.length,
      to: sql.length,
      text: lines.at(-1) ?? "",
    };
  };

  return {
    state: {
      doc: {
        toString: () => sql,
        lineAt: getLineAt,
      },
      selection: {
        main: {
          head: from,
          from,
          to: to ?? from,
          empty: to == null || to === from,
        },
      },
      sliceDoc: (start: number, end: number) => sql.slice(start, end),
    },
  } as EditorView;
};

describe("extractMetabotBufferContext", () => {
  it("includes the current SQL source for the active buffer", () => {
    const sql = "SELECT *\nFROM orders";
    const view = createMockView({ sql, from: 0 });

    const buffer = extractMetabotBufferContext(view, 42, "qb");

    expect(buffer.source).toEqual({
      language: "sql",
      database_id: 42,
      value: sql,
    });
  });

  it("includes the selected SQL text when text is highlighted", () => {
    const sql = "SELECT *\nFROM orders";
    const view = createMockView({ sql, from: 0, to: 8 });

    const buffer = extractMetabotBufferContext(view, 42, "qb");

    expect(buffer.selection).toEqual({
      text: "SELECT *",
      start: { line: 1, column: 0 },
      end: { line: 1, column: 8 },
    });
  });
});
