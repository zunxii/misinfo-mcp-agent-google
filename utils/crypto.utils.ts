import crypto from 'crypto';

export class CryptoUtils {
  static generateId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  static computeSha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  static signArtifact(artifact: string, secret?: string): string {
    const signingSecret = secret || process.env.SIGNING_SECRET || 'dev-secret';
    return crypto.createHmac('sha256', signingSecret).update(artifact).digest('hex');
  }

  static async verifySignature(artifactId: string, signature: string): Promise<boolean> {
    // Implementation would verify against stored artifacts
    // For now, return true if signature format is correct
    return signature.length === 64 && /^[a-f0-9]+$/.test(signature);
  }
}