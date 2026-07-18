export type PreparedFrame = {
  index: number;
  timestampMs: number;
  dataUrl: string;
};

export type PreparedBrowserVideo = {
  filename: string;
  durationMs: number;
  frames: PreparedFrame[];
  audioWavBase64: string;
};

const maxDurationSeconds = 90;
const audioSampleRate = 8000;

function waitForEvent(target: EventTarget, name: string, errorName = "error") {
  return new Promise<void>((resolve, reject) => {
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("La vidéo ne peut pas être décodée par ce navigateur."));
    };
    const cleanup = () => {
      target.removeEventListener(name, onSuccess);
      target.removeEventListener(errorName, onError);
    };
    target.addEventListener(name, onSuccess, { once: true });
    target.addEventListener(errorName, onError, { once: true });
  });
}

async function loadVideo(file: File) {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  await waitForEvent(video, "loadedmetadata");
  return { video, url };
}

async function seek(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.01) return;
  video.currentTime = time;
  await waitForEvent(video, "seeked");
}

async function extractFrames(video: HTMLVideoElement): Promise<PreparedFrame[]> {
  const width = Math.min(720, video.videoWidth || 720);
  const height = Math.max(2, Math.round(width * (video.videoHeight / video.videoWidth || 9 / 16)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Impossible de préparer les images de la vidéo.");

  const count = Math.min(12, Math.max(3, Math.ceil(video.duration / 5)));
  const frames: PreparedFrame[] = [];
  for (let index = 0; index < count; index += 1) {
    const timestamp = Math.min(video.duration - 0.05, (video.duration * (index + 0.5)) / count);
    await seek(video, Math.max(0, timestamp));
    context.drawImage(video, 0, 0, width, height);
    frames.push({
      index: index + 1,
      timestampMs: Math.round(timestamp * 1000),
      dataUrl: canvas.toDataURL("image/jpeg", 0.58),
    });
  }
  return frames;
}

function resampleToMono(buffer: AudioBuffer, targetRate: number) {
  const inputLength = buffer.length;
  const outputLength = Math.max(1, Math.round((inputLength * targetRate) / buffer.sampleRate));
  const output = new Float32Array(outputLength);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourcePosition = (outputIndex * buffer.sampleRate) / targetRate;
    const leftIndex = Math.min(inputLength - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(inputLength - 1, leftIndex + 1);
    const fraction = sourcePosition - leftIndex;
    let sample = 0;
    for (const channel of channels) {
      const left = channel[leftIndex] ?? 0;
      const right = channel[rightIndex] ?? left;
      sample += left + (right - left) * fraction;
    }
    output[outputIndex] = sample / Math.max(1, channels.length);
  }
  return output;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}

async function extractAudio(file: File) {
  const AudioContextClass = window.AudioContext;
  const audioContext = new AudioContextClass();
  try {
    const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
    if (decoded.numberOfChannels === 0 || decoded.duration <= 0) {
      throw new Error("Aucune narration audio n’a été détectée.");
    }
    return bytesToBase64(encodeWav(resampleToMono(decoded, audioSampleRate), audioSampleRate));
  } catch (error) {
    if (error instanceof Error && error.message.includes("narration")) throw error;
    throw new Error("La piste audio n’est pas lisible. Utilisez un MP4 ou WebM avec narration.");
  } finally {
    await audioContext.close();
  }
}

export async function prepareVideoForCompilation(file: File): Promise<PreparedBrowserVideo> {
  const { video, url } = await loadVideo(file);
  try {
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("La durée de la vidéo est invalide.");
    }
    if (video.duration > maxDurationSeconds) {
      throw new Error("La vidéo dépasse 90 secondes. Raccourcissez-la pour cette démo.");
    }

    const [frames, audioWavBase64] = await Promise.all([
      extractFrames(video),
      extractAudio(file),
    ]);

    return {
      filename: file.name,
      durationMs: Math.round(video.duration * 1000),
      frames,
      audioWavBase64,
    };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}
