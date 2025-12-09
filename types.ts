export enum AppStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export type Language = 'sv' | 'en';

export interface ProcessingLog {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

export interface ChunkResult {
  original: string;
  cleaned: string;
  index: number;
}

export interface CleanerConfig {
  encoding: string;
  chunkSize: number;
}