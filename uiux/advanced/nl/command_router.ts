export interface CommandExec {
  setValue(path: string, value: any): void;
  openPanel?(panel: string): void;
  runPipeline?(pipeline: string): void;
}

export function executeActions(actions: any[], exec: CommandExec): void {
  if (!Array.isArray(actions)) return;
  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    switch (a.type) {
      case "set_value": {
        const path = String(a.path ?? "");
        if (!path) continue;
        exec.setValue(path, (a as any).value);
        break;
      }
      case "open_panel": {
        if (typeof exec.openPanel === "function") {
          exec.openPanel(String((a as any).panel ?? ""));
        }
        break;
      }
      case "run_pipeline": {
        if (typeof exec.runPipeline === "function") {
          exec.runPipeline(String((a as any).pipeline ?? ""));
        }
        break;
      }
      default:
        // ignore unknown action
        break;
    }
  }
}
