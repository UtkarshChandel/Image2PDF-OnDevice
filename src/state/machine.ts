export type ConversionStage = "preparing" | "processing" | "assembling";

export type AppState =
  | { status: "empty" }
  | { status: "ready"; fileCount: number }
  | {
      status: "converting";
      fileCount: number;
      current: number;
      total: number;
      stage: ConversionStage;
      fileName?: string;
    }
  | { status: "complete"; fileCount: number; message: string }
  | { status: "error"; fileCount: number; message: string };

export type AppEvent =
  | { type: "FILES_CHANGED"; fileCount: number }
  | { type: "CONVERT_STARTED"; fileCount: number }
  | {
      type: "PROGRESS";
      current: number;
      total: number;
      stage: ConversionStage;
      fileName?: string;
    }
  | { type: "CONVERT_SUCCEEDED"; fileCount: number; message: string }
  | { type: "CONVERT_FAILED"; fileCount: number; message: string }
  | { type: "CONVERT_CANCELLED"; fileCount: number }
  | { type: "RESET" };

export const initialState: AppState = { status: "empty" };

export function transition(state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case "FILES_CHANGED":
      return event.fileCount > 0
        ? { status: "ready", fileCount: event.fileCount }
        : initialState;
    case "CONVERT_STARTED":
      if (event.fileCount < 1 || state.status === "converting") return state;
      return {
        status: "converting",
        fileCount: event.fileCount,
        current: 0,
        total: event.fileCount,
        stage: "preparing",
      };
    case "PROGRESS":
      if (state.status !== "converting") return state;
      return {
        ...state,
        current: event.current,
        total: event.total,
        stage: event.stage,
        ...(event.fileName ? { fileName: event.fileName } : {}),
      };
    case "CONVERT_SUCCEEDED":
      return {
        status: "complete",
        fileCount: event.fileCount,
        message: event.message,
      };
    case "CONVERT_FAILED":
      return {
        status: "error",
        fileCount: event.fileCount,
        message: event.message,
      };
    case "CONVERT_CANCELLED":
      return event.fileCount > 0
        ? { status: "ready", fileCount: event.fileCount }
        : initialState;
    case "RESET":
      return initialState;
  }
}
