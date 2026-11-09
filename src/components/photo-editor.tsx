import { useEffect, useRef, useState } from "react";
import { photoFileProblem } from "../lib/photo";
import { Banner, Button, Modal } from "./ui";

export function PhotoActions({
  name,
  hasPhoto,
  canEdit,
  onSaved,
  savePhoto,
  removePhoto,
}: {
  name: string;
  hasPhoto: boolean;
  canEdit: boolean;
  onSaved?: () => void;
  savePhoto: (file: Blob) => Promise<{ ok: boolean; message?: string }>;
  removePhoto: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (!canEdit && !hasPhoto) return null;

  return (
    <div className="photo-actions">
      {canEdit && (
        <>
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={`Choose a profile photo for ${name}`}
            onChange={(event) => {
              const next = event.target.files?.[0];
              event.target.value = "";
              if (!next) return;
              const problem = photoFileProblem(next);
              if (problem) {
                setError(problem);
                setFile(null);
                return;
              }
              setError("");
              setFile(next);
            }}
          />
          <Button type="button" variant={hasPhoto ? "secondary" : "primary"} onClick={() => input.current?.click()}>
            {hasPhoto ? "Change photo" : "Upload photo"}
          </Button>
        </>
      )}
      {canEdit && hasPhoto && <Button type="button" variant="danger" onClick={() => setConfirmRemove(true)}>Remove photo</Button>}
      {error && <Banner tone="error">{error}</Banner>}
      <CropDialog
        file={file}
        busy={busy}
        onClose={() => setFile(null)}
        onSave={async (blob) => {
          setBusy(true);
          const result = await savePhoto(blob);
          setBusy(false);
          if (!result.ok) {
            setError(result.message ?? "The photo could not be saved. Try again.");
            return;
          }
          setError("");
          setFile(null);
          onSaved?.();
        }}
      />
      <Modal open={confirmRemove} title="Remove profile photo" onClose={() => setConfirmRemove(false)}>
        <p>{name} will be shown with initials until a new photo is saved.</p>
        <div className="actions">
          <Button variant="secondary" onClick={() => setConfirmRemove(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const result = await removePhoto();
              setBusy(false);
              if (!result.ok) {
                setError(result.message ?? "The photo could not be removed.");
                return;
              }
              setError("");
              setConfirmRemove(false);
              onSaved?.();
            }}
          >
            Remove photo
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function CropDialog({ file, busy, onClose, onSave }: { file: File | null; busy: boolean; onClose: () => void; onSave: (blob: Blob) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState("");
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [problem, setProblem] = useState("");
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const view = 280;

  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    setZoom(1);
    setProblem("");
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const placed = (width: number, height: number, scale: number) => {
    if (!width || !height) return { drawnW: 0, drawnH: 0 };
    const cover = Math.max(view / width, view / height);
    const drawnW = width * cover * scale;
    const drawnH = height * cover * scale;
    return { drawnW, drawnH };
  };

  const clamp = (x: number, y: number, scale: number) => {
    const { drawnW, drawnH } = placed(natural.width, natural.height, scale);
    if (!drawnW || !drawnH) return { x, y };
    const minX = Math.min(0, view - drawnW);
    const minY = Math.min(0, view - drawnH);
    return { x: Math.min(0, Math.max(minX, x)), y: Math.min(0, Math.max(minY, y)) };
  };

  const center = (scale: number, width = natural.width, height = natural.height) => {
    const { drawnW, drawnH } = placed(width, height, scale);
    return clamp((view - drawnW) / 2, (view - drawnH) / 2, scale);
  };

  const { drawnW, drawnH } = natural.width ? placed(natural.width, natural.height, zoom) : { drawnW: 0, drawnH: 0 };

  return (
    <Modal open={Boolean(file)} title="Position the photo" onClose={onClose}>
      <p className="muted">Drag the image to choose what appears in the circle. The saved photo is a JPEG without the original file details.</p>
      {problem && <Banner tone="error">{problem}</Banner>}
      <div
        ref={frame}
        className="crop-frame"
        style={{ width: view, height: view }}
        onPointerDown={(event) => {
          frame.current?.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setOffset(clamp(drag.current.ox + event.clientX - drag.current.x, drag.current.oy + event.clientY - drag.current.y, zoom));
        }}
        onPointerUp={() => { drag.current = null; }}
      >
        {url && (
          <img
            ref={image}
            src={url}
            alt=""
            draggable={false}
            style={{ width: drawnW, height: drawnH, transform: `translate(${offset.x}px, ${offset.y}px)` }}
            onLoad={(event) => {
              const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
              setNatural(next);
              setOffset(center(1, next.width, next.height));
            }}
          />
        )}
      </div>
      <label className="field">
        Zoom
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          aria-valuetext={`${Math.round(zoom * 100)} percent`}
          onChange={(event) => {
            const next = Number(event.target.value);
            setZoom(next);
            setOffset((current) => clamp(current.x, current.y, next));
          }}
        />
      </label>
      <div className="actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          disabled={busy || !natural.width}
          onClick={() => {
            const source = image.current;
            if (!source || !natural.width) return;
            const canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 512;
            const context = canvas.getContext("2d");
            if (!context) {
              setProblem("This browser could not prepare the photo.");
              return;
            }
            const ratio = 512 / view;
            context.drawImage(source, offset.x * ratio, offset.y * ratio, drawnW * ratio, drawnH * ratio);
            canvas.toBlob((blob) => {
              if (!blob) {
                setProblem("The photo could not be prepared. Try a different image.");
                return;
              }
              onSave(blob);
            }, "image/jpeg", 0.86);
          }}
        >
          {busy ? "Saving…" : "Save photo"}
        </Button>
      </div>
    </Modal>
  );
}
