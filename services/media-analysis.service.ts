import { spawn } from 'child_process';
import { VideoInfo } from '../types/video-forensics.types.js';

export class MediaAnalysisService {
  async getVideoInfo(videoPath: string): Promise<VideoInfo> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        videoPath
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => output += data.toString());
      
      ffprobe.on('close', (code) => {
        if (code !== 0) {
          return resolve(this.getDefaultVideoInfo());
        }

        try {
          const info = JSON.parse(output);
          const videoStream = info.streams.find((s: any) => s.codec_type === 'video');
          
          resolve({
            duration: parseFloat(info.format.duration) || 60,
            frameCount: parseInt(videoStream?.nb_frames) || 1800,
            resolution: {
              width: videoStream?.width || 1920,
              height: videoStream?.height || 1080,
            },
          });
        } catch (error) {
          resolve(this.getDefaultVideoInfo());
        }
      });

      ffprobe.on('error', () => resolve(this.getDefaultVideoInfo()));
    });
  }

  private getDefaultVideoInfo(): VideoInfo {
    return {
      duration: 60,
      frameCount: 1800,
      resolution: { width: 1920, height: 1080 },
    };
  }

  async extractAudioFromVideo(videoPath: string): Promise<string> {
    const audioPath = videoPath.replace(/\.[^/.]+$/, '_audio.wav');
    
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', videoPath,
        '-vn',
        '-acodec', 'pcm_s16le',
        '-ar', '16000',
        '-ac', '1',
        '-y',
        audioPath
      ]);

      ffmpeg.on('close', () => resolve(audioPath));
      ffmpeg.on('error', () => resolve(audioPath));
    });
  }
}