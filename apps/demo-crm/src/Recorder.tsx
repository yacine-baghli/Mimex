import { useRef, useState } from "react";

export function Recorder({ onVideo }: { onVideo: (file: File) => void }) {
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const chunks = useRef<Blob[]>([]);

  function stopTracks() {
    streams.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    streams.current = [];
  }

  async function start() {
    setMessage(null);
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") {
      setMessage("L'enregistrement d'écran nécessite Chrome ou Edge récent.");
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      streams.current = [display];
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
      const instance = new MediaRecorder(display, { mimeType });
      recorder.current = instance;
      chunks.current = [];
      instance.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      instance.onstop = () => {
        const file = new File(chunks.current, `mimex-${Date.now()}.webm`, { type: "video/webm" });
        stopTracks();
        setRecording(false);
        onVideo(file);
      };
      display.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (instance.state === "recording") instance.stop();
      });
      instance.start(1000);
      setRecording(true);
    } catch (error) {
      stopTracks();
      setMessage(error instanceof DOMException && error.name === "NotAllowedError" ? "Partage d'écran annulé." : "Impossible de démarrer l'enregistrement.");
    }
  }

  return <div className="recorder-row">
    <button className={recording ? "danger-button" : "secondary-button"} type="button" onClick={recording ? () => recorder.current?.stop() : start}>
      {recording ? "■ Arrêter et utiliser la vidéo" : "● Enregistrer mon écran"}
    </button>
    <span>{recording ? "Enregistrement en cours… montre la procédure puis arrête." : "Ou filme directement l'action depuis Mimex."}</span>
    {message ? <small>{message}</small> : null}
  </div>;
}
