import { CixData, CixMetadata, PanelSpecification, RoutingPath } from "./types";

class CixParser {
  private currentSheetHeight = 0;

  parse(content: string, filename = "upload.cix"): CixData {
    const sheetId = filename.replace(/\.[^.]+$/, "");
    const cix: CixData = {
      filename,
      sheetId,
      panels: [],
      raw_content: content,
      parse_errors: [],
      metadata: {},
    };

    try {
      this.parseContent(content, cix);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      cix.parse_errors.push(message);
    }

    return cix;
  }

  private parseContent(content: string, cix: CixData) {
    const lines = content.split("\n");

    const sheetDims = this.parseMaindata(lines);
    const sheetHeight = sheetDims?.LPY ?? 0;
    this.currentSheetHeight = sheetHeight || 0;

    if (sheetDims) {
      cix.metadata.sheet_width = sheetDims.LPX ?? 0;
      cix.metadata.sheet_height = sheetDims.LPY ?? 0;
      cix.metadata.sheet_thickness = sheetDims.LPZ ?? 18;
    }

    const macros = this.parseMacros(lines);

    let panelCount = 0;
    for (const macro of macros) {
      if (macro._MACRO_TYPE === "LABEL") {
        const panel = this.createPanelFromLabel(macro, sheetDims);
        if (panel) {
          cix.panels.push(panel);
          panelCount += 1;
        }
      }
    }

    const routingPaths = this.parseRoutingPaths(lines, sheetHeight);
    cix.metadata.routing_paths = routingPaths;

    const drilling = this.parseDrillingFromMacros(macros);
    cix.metadata.drilling = drilling;

    if (panelCount === 0) {
      cix.parse_errors.push("No LABEL macros found in CIX file");
    }
  }

  private parseMaindata(lines: string[]): Record<string, number> {
    const maindata: Record<string, number> = {};
    let inMain = false;

    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("BEGIN MAINDATA")) {
        inMain = true;
        continue;
      }
      if (line.startsWith("END MAINDATA")) {
        inMain = false;
        break;
      }
      if (!inMain) continue;

      if (line.includes("=")) {
        const [keyRaw, valueRaw] = line.split("=", 1 + 1);
        const key = keyRaw.trim();
        const value = valueRaw.trim().replace(/\.+$/, "");
        if (["LPX", "LPY", "LPZ"].includes(key)) {
          const parsed = Number.parseFloat(value);
          if (!Number.isNaN(parsed)) {
            maindata[key] = parsed;
          }
        }
      }
    }
    return maindata;
  }

  private parseMacros(lines: string[]): Array<Record<string, any>> {
    const macros: Array<Record<string, any>> = [];
    let inMacro = false;
    let current: Record<string, any> | null = null;

    for (const raw of lines) {
      const line = raw.trim();

      if (line.startsWith("BEGIN MACRO")) {
        inMacro = true;
        current = {};
        continue;
      }
      if (line.startsWith("END MACRO")) {
        if (current) {
          macros.push(current);
        }
        current = null;
        inMacro = false;
        continue;
      }

      if (!inMacro || !current) continue;

      if (line.startsWith("NAME=")) {
        const value = line.split("=", 1 + 1)[1]?.replace(/"/g, "").trim();
        current._MACRO_TYPE = value;
      } else if (line.startsWith("PARAM")) {
        const params = this.parseParamLine(line);
        if (params.NAME && params.VALUE !== undefined) {
          current[params.NAME] = params.VALUE;
        }
      }
    }

    return macros;
  }

  private parseParamLine(line: string): Record<string, string> {
    const params: Record<string, string> = {};
    const parts = line.split(",");
    for (const part of parts.slice(1)) {
      if (!part.includes("=")) continue;
      const [k, v] = part.split("=", 1 + 1);
      params[k.trim()] = v.trim().replace(/^"+|"+$/g, "");
    }
    return params;
  }

  private createPanelFromLabel(
    labelMacro: Record<string, any>,
    sheetDims: Record<string, number>,
  ): PanelSpecification | null {
    try {
      const id = labelMacro.ID ?? "Unknown";
      const x = this.parseFloat(labelMacro.X);
      const yValue = labelMacro.Y ?? "0";
      const yValueStr = String(yValue);
      const yRaw = this.parseFloat(yValue);
      const yHasExpression =
        yValueStr.includes(".") && yValueStr.includes("-") && yValueStr.split(".").length > 2;
      // LABEL Y is often expressed as "LPY.-y", which is already bottom-origin.
      const y = yHasExpression ? yRaw : this.flipY(yRaw, this.currentSheetHeight);
      const rotRaw = this.parseFloat(labelMacro.ROT);
      const rot = rotRaw;
      const dataStr = labelMacro.DATA ?? "";
      const metadata = {
        x_position: x,
        y_position: y,
        y_position_raw: yRaw,
        rotation: rot,
        rotation_raw: rotRaw,
        data: dataStr,
        label_name: labelMacro.NAME ?? "",
      };
      const panel: PanelSpecification = {
        id,
        width: 0,
        height: 0,
        thickness: sheetDims?.LPZ ?? 18,
        geometry: [],
        holes: [],
        edges: {},
        metadata,
      };
      return panel;
    } catch (err) {
      return null;
    }
  }

  private parseFloat(value: unknown): number {
    if (typeof value === "number") return value;
    if (value === undefined || value === null) return 0;
    const asStr = String(value);
    try {
      if (asStr.includes(".") && asStr.includes("-") && asStr.split(".").length > 2) {
        // Handles expressions like 1550.-305.96
        // eslint-disable-next-line no-eval
        return Number(eval(asStr));
      }
      const parsed = Number.parseFloat(asStr);
      return Number.isNaN(parsed) ? 0 : parsed;
    } catch {
      return 0;
    }
  }

  private parseRoutingPaths(lines: string[], sheetHeight = 0): RoutingPath[] {
    const routing: RoutingPath[] = [];
    let inRout = false;
    let current: RoutingPath | null = null;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      if (line.startsWith("BEGIN MACRO")) {
        i += 1;
        const nameLine = lines[i]?.trim() ?? "";
        if (nameLine.includes("NAME=ROUT") && !nameLine.includes("NAME=ROUTG")) {
          inRout = true;
          current = { points: [], params: {}, max_depth: 0, diameter: undefined };
          while (i < lines.length && !lines[i].trim().startsWith("END MACRO")) {
            const paramLine = lines[i].trim();
            if (paramLine.startsWith("PARAM")) {
              const params = this.parseParamLine(paramLine);
              if (params.NAME && params.VALUE !== undefined) {
                current.params[params.NAME] = params.VALUE;
                if (params.NAME === "DIA") {
                  const dia = Number.parseFloat(params.VALUE);
                  if (!Number.isNaN(dia)) current.diameter = dia;
                }
              }
            }
            i += 1;
          }
        }
        continue;
      }

      if (inRout && line.includes("NAME=START_POINT")) {
        let x = 0;
        let y = 0;
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith("END MACRO")) {
          const paramLine = lines[i].trim();
          if (paramLine.includes("PARAM,NAME=X")) {
            x = this.parseFloat(paramLine.split("VALUE=")[1]);
          } else if (paramLine.includes("PARAM,NAME=Y")) {
            y = this.parseFloat(paramLine.split("VALUE=")[1]);
          }
          i += 1;
        }
        if (current) {
          current.points.push({ x, y: this.flipY(y, sheetHeight), type: "start" });
        }
        continue;
      }

      if (inRout && line.includes("NAME=LINE_EP")) {
        let xe = 0;
        let ye = 0;
        let ze = 0;
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith("END MACRO")) {
          const paramLine = lines[i].trim();
          if (paramLine.includes("PARAM,NAME=XE")) {
            xe = this.parseFloat(paramLine.split("VALUE=")[1]);
          } else if (paramLine.includes("PARAM,NAME=YE")) {
            ye = this.parseFloat(paramLine.split("VALUE=")[1]);
          } else if (paramLine.includes("PARAM,NAME=ZE")) {
            ze = this.parseFloat(paramLine.split("VALUE=")[1]);
          }
          i += 1;
        }
        if (current) {
          current.points.push({ x: xe, y: this.flipY(ye, sheetHeight), z: ze, type: "line" });
          if (ze < 0) current.max_depth = Math.max(current.max_depth, Math.abs(ze));
        }
        continue;
      }

      if (inRout && (line.includes("NAME=ARC_EPTP") || line.includes("NAME=ARC_EPRA"))) {
        let xe = 0;
        let ye = 0;
        let ze = 0;
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith("END MACRO")) {
          const paramLine = lines[i].trim();
          if (paramLine.includes("PARAM,NAME=XE")) {
            xe = this.parseFloat(paramLine.split("VALUE=")[1]);
          } else if (paramLine.includes("PARAM,NAME=YE")) {
            ye = this.parseFloat(paramLine.split("VALUE=")[1]);
          } else if (paramLine.includes("PARAM,NAME=ZE")) {
            ze = this.parseFloat(paramLine.split("VALUE=")[1]);
          }
          i += 1;
        }
        if (current) {
          current.points.push({ x: xe, y: this.flipY(ye, sheetHeight), z: ze, type: "arc" });
          if (ze < 0) current.max_depth = Math.max(current.max_depth, Math.abs(ze));
        }
        continue;
      }

      if (inRout && line.includes("NAME=ARC_EPCE")) {
        let xe = 0;
        let ye = 0;
        let xc = 0;
        let yc = 0;
        let ze = 0;
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith("END MACRO")) {
          const paramLine = lines[i].trim();
          if (paramLine.includes("PARAM,NAME=XE")) {
            xe = this.parseFloat(paramLine.split("VALUE=")[1]);
          } else if (paramLine.includes("PARAM,NAME=YE")) {
            ye = this.parseFloat(paramLine.split("VALUE=")[1]);
          } else if (paramLine.includes("PARAM,NAME=XC")) {
            xc = this.parseFloat(paramLine.split("VALUE=")[1]);
          } else if (paramLine.includes("PARAM,NAME=YC")) {
            yc = this.parseFloat(paramLine.split("VALUE=")[1]);
          } else if (paramLine.includes("PARAM,NAME=ZE")) {
            ze = this.parseFloat(paramLine.split("VALUE=")[1]);
          }
          i += 1;
        }
        if (current) {
          current.points.push({
            x: xe,
            y: this.flipY(ye, sheetHeight),
            z: ze,
            type: "arc",
            center: { x: xc, y: this.flipY(yc, sheetHeight) },
          });
          if (ze < 0) current.max_depth = Math.max(current.max_depth, Math.abs(ze));
        }
        continue;
      }

      if (inRout && line.includes("NAME=ENDPATH")) {
        let pathId: number | undefined;
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith("END MACRO")) {
          const paramLine = lines[i].trim();
          if (paramLine.includes("PARAM,NAME=ID")) {
            pathId = this.parseFloat(paramLine.split("VALUE=")[1]);
          }
          i += 1;
        }
        if (current && current.points.length > 0) {
          current.id = current.id ?? pathId;
          routing.push(current);
        }
        current = null;
        inRout = false;
        continue;
      }

      i += 1;
    }

    return routing;
  }

  private parseDrillingFromMacros(macros: Array<Record<string, any>>) {
    const holes: CixMetadata["drilling"] = [];
    for (const macro of macros) {
      if (macro._MACRO_TYPE !== "BV") continue;
      try {
        const x = this.parseFloat(macro.X);
        const y = this.parseFloat(macro.Y);
        const dia = this.parseFloat(macro.DIA ?? "5");
        const depth = this.parseFloat(macro.DP ?? "0");
        const repeat = Math.max(1, Number.parseInt(String(macro.NRP ?? "1"), 10));
        const dx = this.parseFloat(macro.DX ?? "0");
        const dy = this.parseFloat(macro.DY ?? "0");

        for (let i = 0; i < repeat; i += 1) {
          holes.push({
            x: x + dx * i,
            y: this.flipY(y + dy * i, this.currentSheetHeight),
            diameter: dia,
            depth,
            id: macro.ID,
          });
        }
      } catch {
        // Ignore malformed BV macro
      }
    }
    return holes;
  }

  private flipY(value: number, sheetHeight: number) {
    if (!sheetHeight || Number.isNaN(sheetHeight)) return value;
    const h = Number(sheetHeight);
    if (h <= 0) return value;
    return h - value;
  }
}

export const parseCixContent = (content: string, filename = "upload.cix") => {
  const parser = new CixParser();
  return parser.parse(content, filename);
};
