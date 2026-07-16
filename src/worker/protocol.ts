import type { ConversionStage } from "../state/machine";

export interface WorkerImage {
  id: string;
  name: string;
  file: File;
}

export type WorkerRequest =
  | { type: "CONVERT"; jobId: string; images: WorkerImage[] }
  | { type: "CANCEL"; jobId: string };

export type WorkerResponse =
  | {
      type: "PROGRESS";
      jobId: string;
      current: number;
      total: number;
      stage: ConversionStage;
      fileName?: string;
    }
  | { type: "COMPLETE"; jobId: string; pdf: ArrayBuffer }
  | { type: "CANCELLED"; jobId: string }
  | { type: "ERROR"; jobId: string; message: string; fileName?: string };
