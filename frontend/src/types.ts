export interface BatchRecord {
  batch_number: number;
  overall_accuracy: number;
  per_confusion_pair_error_rate: Record<string, number>;
  active_heuristic_ids: string[];
  tile_count?: number;
}

export interface TileRecord {
  tile_id: string;
  batch_id: string;
  true_label: string;
  predicted_label: string;
  confidence: number;
  correct: boolean;
  model_reasoning: string;
  retrieved_heuristic_ids: string[];
  timestamp: string;
  image_url?: string;
}

export interface Session {
  session_id: string;
  antigravity_environment_id: string;
  current_batch_number: number;
  batches: BatchRecord[];
}

export type PipelineStep = "retrieving" | "classifying" | "scoring" | "extracting" | "storing";

export type SSEEvent =
  | { type: "session_created"; session: Session }
  | { type: "session_resumed"; session: Session }
  | { type: "session_state"; session: Session }
  | { type: "batch_start"; batch_number: number }
  | { type: "step"; step: PipelineStep; batch_number: number }
  | { type: "tile_classified"; tile: TileRecord; batch_number: number; tile_index: number; total_tiles: number }
  | { type: "batch_complete"; batch: BatchRecord; session: Session }
  | { type: "run_complete"; session: Session }
  | { type: "correction_applied"; tile_id: string; corrected_label: string; timestamp: string };
