// Viewfinder overlays, rich caption editor, filter tray (capture + preview) and recipient groups picker.
import { Avatar } from '../../components/Avatar.jsx';
import { Icon, SYMBOLS, SymbolIcon } from '../../lib/icons.jsx';
import { FILTERS, filterById } from '../../lib/filters.js';
import { CLIP_S, SELF, mmss } from '../../lib/cameraMedia.js';
import { isColored, overlayStyle, safeColor } from '../../lib/format.js';
import { deleteGroup, saveGroup, useGroups } from '../../lib/closeFriends.js';
import { ui } from '../../ui/overlays.jsx';

export function BoothOverlays({
  mode,
  preview,
  run,
  timerCount,
  booth,
  boothRatio,
  onCancel,
  onFinishEarly,
  onCancelTimer,
  onToggleShots,
  onCycleCountdown,
  onToggleSound,
  onPickGallery,
}) {
  const readyCount = run ? run.shots.filter(Boolean).length : 0;
  return (
    <>
      {mode === 'booth' && !preview ? <div className="booth-guide" data-when="capture" style={{ '--ar': boothRatio }}><i /></div> : null}
      {run && run.count > 0 ? <div className="booth-count" key={`${run.index}-${run.count}`}>{run.count}</div> : null}
      {timerCount > 0 ? (
        <button type="button" className="booth-count timer-count" key={`tm-${timerCount}`} onClick={onCancelTimer} title="Chạm để hủy hẹn giờ">
          {timerCount}
        </button>
      ) : null}
      {run ? (
        <div className="booth-progress" data-when="capture">
          {Array.from({ length: run.total }, (_, i) => (
            <span key={i} className={`${i === run.index ? 'now' : ''} ${run.shots[i] ? 'done' : ''}`}>{run.shots[i] ? <img src={run.shots[i].thumb} alt="" /> : i + 1}</span>
          ))}
          {run.manual && readyCount >= 2 ? (
            <button type="button" className="booth-done-early" onClick={onFinishEarly}>Xong</button>
          ) : null}
          <button type="button" className="booth-cancel" aria-label="Dừng chụp" onClick={onCancel}><Icon name="closeSm" /></button>
        </div>
      ) : null}
      {mode === 'booth' && !run && !preview ? (
        <div className="booth-bar" data-when="capture">
          <button type="button" onClick={onToggleShots}>{booth.shots} ảnh</button>
          <button type="button" onClick={onCycleCountdown}>{booth.countdown ? `⏱ ${booth.countdown}s` : '✋ Thủ công'}</button>
          <button type="button" aria-label={booth.sound !== false ? 'Tắt âm đếm ngược' : 'Bật âm đếm ngược'} title="Âm thanh đếm ngược" onClick={onToggleSound}>
            <Icon name={booth.sound !== false ? 'sound' : 'mute'} />
          </button>
          <button type="button" className="booth-gallery-pill" onClick={onPickGallery}>
            <Icon name="gallery" /><span>Thư viện</span>
          </button>
        </div>
      ) : null}
    </>
  );
}

export function FilterTray({ open, preview, previewPhoto = false, filterId, filterAmount, thumbs, onPick, onAmount }) {
  if (!open || (preview && !previewPhoto)) return null;
  return (
    <div className={`fx-tray ${previewPhoto ? 'in-preview' : ''}`} onPointerUp={(e) => e.stopPropagation()}>
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

export function PreviewLayers({
  preview,
  shotVideoRef,
  soundOn,
  trimStart,
  previewTrayOpen,
  canFilterPreview,
  canEditBooth,
  onEditBooth,
  onTogglePreviewTray,
  onShotTime,
  onToggleSound,
  onTrim,
}) {
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
          <div className="shot-tools-left">
            <span className="shot-len"><Icon name="play" />{mmss(preview.seconds || 0)}</span>
            {canEditBooth ? (
              <button type="button" className="shot-edit-booth" onClick={onEditBooth}><Icon name="pencil" /><span>Sửa khung</span></button>
            ) : null}
          </div>
          {preview.audio !== false ? (
            <button type="button" className="vf-btn sound" aria-label={soundOn ? 'Tắt tiếng' : 'Bật tiếng'} onClick={onToggleSound}><Icon name={soundOn ? 'sound' : 'mute'} /></button>
          ) : null}
        </div>
      ) : (canFilterPreview || canEditBooth) ? (
        <div className="shot-tools" data-when="preview">
          {canEditBooth ? (
            <button type="button" className="shot-edit-booth" onClick={onEditBooth}><Icon name="pencil" /><span>Sửa khung</span></button>
          ) : <span />}
          {canFilterPreview ? (
            <button type="button" className={`vf-btn sound ${previewTrayOpen ? 'on' : ''}`} aria-label="Bộ lọc ảnh" title="Đổi bộ lọc" onClick={onTogglePreviewTray}>
              <Icon name="filters" />
            </button>
          ) : <span />}
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

function PresetIcon({ icon }) {
  if (!icon) return null;
  if (typeof icon === 'string' || icon.kind === 'emoji') return <span className="ico">{typeof icon === 'string' ? icon : icon.value}</span>;
  if (icon.kind === 'image' && icon.value) return <img className="ico art" src={icon.value} alt="" draggable="false" />;
  if (icon.kind === 'symbol' && SYMBOLS[icon.value]) {
    return <span className="ico sym" style={{ color: safeColor(icon.color, 'currentColor') }}><SymbolIcon name={icon.value} /></span>;
  }
  return null;
}

export function CaptionEditor({ preview, preset, placeholder, captionRef, onCaptionInput }) {
  if (!preview) return null;
  return (
    <div className={`caption-edit ${isColored(preset) ? 'colored' : ''}`} data-when="preview" style={preset ? overlayStyle(preset) : undefined} onClick={() => captionRef.current?.focus()}>
      <PresetIcon icon={preset?.icon} />
      {typeof preset?.rating === 'number' ? <span className="rate">★ {preset.rating}</span> : null}
      <span ref={captionRef} className="txt" contentEditable suppressContentEditableWarning spellCheck={false} data-placeholder={placeholder}
        onInput={onCaptionInput}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ')); }} />
    </div>
  );
}

export function RecipientsBar({ user, friends, selected, onToggle, onApplyGroup }) {
  const groups = useGroups();
  const friendIds = new Set(friends.map((f) => f.uid));
  const pickedFriends = [...selected].filter((id) => id !== SELF && friendIds.has(id));

  const createGroup = async () => {
    if (!pickedFriends.length) {
      ui.info('Hãy chạm chọn ít nhất 1 bạn bè trước rồi lưu thành nhóm');
      return;
    }
    const res = await ui.alert({
      title: 'Lưu nhóm người nhận',
      message: `Lưu ${pickedFriends.length} người bạn đang chọn để gửi nhanh 1 chạm.`,
      input: { value: '', placeholder: 'Tên nhóm (vd: Bạn thân)', maxlength: 24 },
      buttons: [{ label: 'Hủy' }, { label: 'Lưu', bold: true }],
    });
    if (res.index === 1 && res.text?.trim()) {
      saveGroup(res.text.trim(), pickedFriends);
      ui.success(`Đã lưu nhóm "${res.text.trim()}"`);
    }
  };

  const onGroupClick = async (g, e) => {
    if (e.shiftKey || e.metaKey) {
      if (await ui.confirm(`Xóa nhóm "${g.name}"?`, '', 'Xóa')) deleteGroup(g.id);
      return;
    }
    const valid = g.uids.filter((u) => friendIds.has(u));
    if (!valid.length) {
      if (await ui.confirm(`Nhóm "${g.name}" không còn thành viên hợp lệ`, 'Xóa nhóm này?', 'Xóa')) deleteGroup(g.id);
      return;
    }
    const already = valid.length === pickedFriends.length && valid.every((u) => selected.has(u));
    if (already) {
      const choice = await ui.actionSheet({
        title: `Nhóm ${g.name} (${valid.length} người)`,
        actions: [
          { label: 'Bỏ chọn nhóm', value: 'clear' },
          { label: 'Xóa nhóm này', value: 'delete', destructive: true },
        ],
      });
      if (choice === 'clear') onToggle('');
      if (choice === 'delete') { deleteGroup(g.id); ui.success(`Đã xóa nhóm "${g.name}"`); }
      return;
    }
    onApplyGroup(valid);
  };

  return (
    <div className="recipients" data-when="preview">
      <button type="button" className={`recipient ${selected.size === 0 ? 'on' : ''}`} onClick={() => onToggle('')}>
        <span className="avatar all"><Icon name="people" /></span><span>Tất cả</span>
      </button>
      <button type="button" className={`recipient ${selected.has(SELF) ? 'on' : ''}`} onClick={() => onToggle(SELF)}>
        <Avatar user={user} /><span>Chỉ mình tôi</span>
      </button>
      {groups.map((g) => {
        const valid = g.uids.filter((u) => friendIds.has(u));
        const active = valid.length > 0 && valid.length === pickedFriends.length && valid.every((u) => selected.has(u));
        return (
          <button type="button" key={g.id} className={`recipient ${active ? 'on' : ''}`}
            title={`${g.name} (${valid.length} người) — bấm lại khi đang chọn để xóa nhóm`}
            onClick={(e) => onGroupClick(g, e)}>
            <span className="avatar grp"><Icon name="star" /></span><span>{g.name}</span>
          </button>
        );
      })}
      {pickedFriends.length > 0 ? (
        <button type="button" className="recipient" onClick={createGroup} title="Lưu nhóm đang chọn">
          <span className="avatar add-grp"><Icon name="plus" /></span><span>Lưu nhóm</span>
        </button>
      ) : null}
      {friends.map((f) => (
        <button type="button" key={f.uid} className={`recipient ${selected.has(f.uid) ? 'on' : ''}`} onClick={() => onToggle(f.uid)}>
          <Avatar user={f} /><span>{f.firstName || f.name}</span>
        </button>
      ))}
    </div>
  );
}
