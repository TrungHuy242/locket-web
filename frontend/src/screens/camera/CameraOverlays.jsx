// Viewfinder overlays and recipient picker extracted from CameraPage.
import { Avatar } from '../../components/Avatar.jsx';
import { Icon } from '../../lib/icons.jsx';
import { FILTERS, filterById } from '../../lib/filters.js';
import { CLIP_S, SELF, mmss } from '../../lib/cameraMedia.js';
import { isColored, overlayStyle } from '../../lib/format.js';

export function BoothOverlays({ mode, preview, run, booth, boothRatio, boothAspect, onCancel, onToggleShots, onCycleCountdown, onCycleAspect }) {
  return (
    <>
      {mode === 'booth' && !preview ? <div className="booth-guide" data-when="capture" style={{ '--ar': boothRatio }}><i /></div> : null}
      {run && run.count > 0 ? <div className="booth-count" key={`${run.index}-${run.count}`}>{run.count}</div> : null}
      {run ? (
        <div className="booth-progress" data-when="capture">
          {Array.from({ length: run.total }, (_, i) => (
            <span key={i} className={`${i === run.index ? 'now' : ''} ${run.shots[i] ? 'done' : ''}`}>{run.shots[i] ? <img src={run.shots[i].thumb} alt="" /> : i + 1}</span>
          ))}
          <button type="button" className="booth-cancel" aria-label="Dừng chụp" onClick={onCancel}><Icon name="closeSm" /></button>
        </div>
      ) : null}
      {mode === 'booth' && !run && !preview ? (
        <div className="booth-bar" data-when="capture">
          <button type="button" onClick={onToggleShots}>{booth.shots} ảnh</button>
          <button type="button" onClick={onCycleCountdown}>⏱ {booth.countdown}s</button>
          <button type="button" onClick={onCycleAspect}>{boothAspect}</button>
        </div>
      ) : null}
    </>
  );
}

export function FilterTray({ open, preview, filterId, filterAmount, thumbs, onPick, onAmount }) {
  if (!open || preview) return null;
  return (
    <div className="fx-tray" data-when="capture" onPointerUp={(e) => e.stopPropagation()}>
      <div className="fx-row">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={`fx-chip ${filterId === f.id ? 'on' : ''}`} onClick={() => onPick(f.id)}>
            {thumbs[f.id] ? <img src={thumbs[f.id]} alt="" /> : <i />}<span>{f.name}</span>
          </button>
        ))}
      </div>
      {filterId !== 'none' ? (
        <label className="fx-amount"><span>{filterById(filterId).name}</span>
          <input type="range" min="0" max="1" step="0.05" value={filterAmount} aria-label="Cường độ bộ lọc" onChange={(e) => onAmount(Number(e.target.value))} />
          <b>{Math.round(filterAmount * 100)}%</b></label>
      ) : null}
    </div>
  );
}

export function PreviewLayers({ preview, shotVideoRef, soundOn, trimStart, onShotTime, onToggleSound, onTrim }) {
  if (!preview) return null;
  return (
    <>
      {preview.imageUrl ? <img className="shot" data-when="preview" src={preview.imageUrl} alt="Ảnh vừa chụp" /> : null}
      {preview.videoUrl ? <video ref={shotVideoRef} className={`shot shot-video ${preview.mirrorVideo ? 'flip' : ''}`} src={preview.videoUrl} playsInline muted loop autoPlay onTimeUpdate={onShotTime} /> : null}
      {preview.library && !preview.decodable ? (
        <div className="vf-msg"><b>Không xem trước được video này</b><span>Trình duyệt không giải mã được định dạng của video. Bạn vẫn có thể gửi: máy chủ sẽ xử lý và tạo ảnh bìa.</span></div>
      ) : null}
      {preview.video ? (
        <div className="shot-tools" data-when="preview">
          <span className="shot-len"><Icon name="play" />{mmss(preview.seconds || 0)}</span>
          {preview.audio !== false ? (
            <button type="button" className="vf-btn sound" aria-label={soundOn ? 'Tắt tiếng' : 'Bật tiếng'} onClick={onToggleSound}><Icon name={soundOn ? 'sound' : 'mute'} /></button>
          ) : null}
        </div>
      ) : null}
      {preview.library && preview.duration > CLIP_S + 0.05 ? (
        <div className="trim-bar" data-when="preview" onPointerUp={(e) => e.stopPropagation()}>
          <input type="range" min={0} max={Math.max(0, preview.duration - CLIP_S)} step={0.1} value={trimStart}
            aria-label="Chọn đoạn 10 giây" onChange={(e) => onTrim(Number(e.target.value))} />
          <span>Đoạn {mmss(trimStart)} – {mmss(trimStart + CLIP_S)} / {mmss(preview.duration)}</span>
        </div>
      ) : null}
    </>
  );
}

export function CaptionEditor({ preview, preset, placeholder, captionRef, onCaptionInput }) {
  if (!preview) return null;
  return (
    <div className={`caption-edit ${isColored(preset) ? 'colored' : ''}`} data-when="preview" style={preset ? overlayStyle(preset) : undefined} onClick={() => captionRef.current?.focus()}>
      {preset?.icon ? <span className="ico">{preset.icon}</span> : null}
      <span ref={captionRef} className="txt" contentEditable suppressContentEditableWarning spellCheck={false} data-placeholder={placeholder}
        onInput={onCaptionInput}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ')); }} />
    </div>
  );
}

export function RecipientsBar({ user, friends, selected, onToggle }) {
  return (
    <div className="recipients" data-when="preview">
      <button type="button" className={`recipient ${selected.size === 0 ? 'on' : ''}`} onClick={() => onToggle('')}>
        <span className="avatar all"><Icon name="people" /></span><span>Tất cả</span>
      </button>
      <button type="button" className={`recipient ${selected.has(SELF) ? 'on' : ''}`} onClick={() => onToggle(SELF)}>
        <Avatar user={user} /><span>Chỉ mình tôi</span>
      </button>
      {friends.map((f) => (
        <button type="button" key={f.uid} className={`recipient ${selected.has(f.uid) ? 'on' : ''}`} onClick={() => onToggle(f.uid)}>
          <Avatar user={f} /><span>{f.firstName || f.name}</span>
        </button>
      ))}
    </div>
  );
}
