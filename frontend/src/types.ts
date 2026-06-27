export interface BatchRecord {
  batch_number: number;
  overall_accuracy: number;
  per_confusion_pair_error_rate: Record<string, number>;
  active_heuristic_ids: string[];
}

export interface Session {
  session_id: string;
  antigravity_environment_id: string;
  current_batch_number: number;
  batches: BatchRecord[];
}

export type SSEEvent =
  | { type: "session_created"; session: Session }
  | { type: "session_resumed"; session: Session }
  | { type: "session_state"; session: Session }
  | { type: "batch_start"; batch_number: number }
  | { type: "batch_complete"; batch: BatchRecord; session: Session }
  | { type: "run_complete"; session: Session };
