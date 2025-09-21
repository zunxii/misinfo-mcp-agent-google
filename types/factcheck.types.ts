export interface Evidence {
  id: string;
  source: string;
  timestamp: string;
  content: string;
  confidence: number;
  sha256: string;
}

export interface FactCheckResult {
  verdict: 'TRUE' | 'FALSE' | 'MIXED' | 'UNVERIFIED';
  confidence: number;
  explanation: string;
  evidence: Evidence[];
  techniques: string[];
  signedArtifact: {
    id: string;
    sha256: string;
    signature: string;
  };
}