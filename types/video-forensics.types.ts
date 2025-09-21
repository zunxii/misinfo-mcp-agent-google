export interface ForensicFrame {
  timestamp: number;
  frameIndex: number;
  suspicionScore: number;
  anomalies: string[];
  thumbnail?: string;
}

export interface AudioSegment {
  start: number;
  end: number;
  text: string;
  confidence: number;
  speaker?: string;
}

export interface AudioAnalysis {
  segments: AudioSegment[];
  manipulationIndicators: string[];
  overallConfidence: number;
}

export interface VideoInfo {
  duration: number;
  frameCount: number;
  resolution: {
    width: number;
    height: number;
  };
}

export interface VideoForensicsResult {
  videoHash: string;
  duration: number;
  frameCount: number;
  resolution: {
    width: number;
    height: number;
  };
  suspicious_frames: ForensicFrame[];
  audio_analysis: AudioAnalysis;
  metadata_analysis: {
    creation_date?: string;
    device_info?: string;
    location?: string;
    software_used?: string;
    inconsistencies: string[];
  };
  tampering_probability: number;
  techniques_detected: string[];
  timeline: Array<{
    timestamp: number;
    event: string;
    confidence: number;
  }>;
}
