import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { CryptoUtils } from './crypto.utils';

export class FileUtils {
  static async ensureDirectory(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error('Failed to create directory:', error);
    }
  }

  static async downloadFile(url: string, destPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`);
    }
    const buffer = await response.buffer();
    await fs.writeFile(destPath, buffer);
  }

  static async saveBase64File(data: string, destPath: string): Promise<void> {
    const buffer = Buffer.from(data, 'base64');
    await fs.writeFile(destPath, buffer);
  }

  static async computeFileHash(filePath: string): Promise<string> {
    try {
      const fileBuffer = await fs.readFile(filePath);
      return CryptoUtils.computeSha256(fileBuffer.toString());
    } catch (error) {
      return CryptoUtils.computeSha256(filePath + Date.now());
    }
  }

  static async cleanup(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.warn(`Failed to cleanup file ${filePath}:`, error);
    }
  }
}