// Toolbar for adjusting a single tapped photo cell inside the Photobooth editor:
// retake, replace from device gallery, swap position with another cell, flip, zoom & pan.
import { Icon } from '../../lib/icons.jsx';
import { Button } from '../../ui/kit.jsx';

export function CellAdjustBar({
  index,
  shot,
  swapping,
  onRetake,
  onReplaceFile,
  onToggleSwap,
  onUpdateShot,
  onResetTransform,
  onDeselect,
}) {
  if (!shot) return null;
  const zoom = shot.zoom || 1;
  const panX = shot.panX || 0;
  const panY = shot.panY || 0;
  const hasTransform = zoom > 1.01 || Math.abs(panX) > 0.01 || Math.abs(panY) > 0.01 || !!shot.flip;

  return (
    <div className="booth-cell-bar">
      <div className="booth-selected">
        <span>{swapping ? `Chạm ảnh khác để đổi chỗ với Ảnh ${index + 1}` : `Ảnh ${index + 1}`}</span>
        <Button variant="tinted" size="sm" icon="camera" onClick={onRetake}>Chụp lại</Button>
        <Button variant="secondary" size="sm" icon="gallery" onClick={onReplaceFile}>Đổi ảnh</Button>
        <button type="button" className={`icon-btn sm ${swapping ? 'accent' : ''}`} aria-label="Đổi vị trí ảnh" title="Đổi vị trí với ảnh khác" onClick={onToggleSwap}>
          <Icon name="swap" />
        </button>
        <button type="button" className={`icon-btn sm ${shot.flip ? 'accent' : ''}`} aria-label="Lật ngang ảnh" title="Lật ngang" onClick={() => onUpdateShot({ flip: !shot.flip })}>
          <Icon name="flipH" />
        </button>
        <button type="button" className="link-btn" onClick={onDeselect}>Xong</button>
      </div>
      {!swapping ? (
        <div className="booth-cell-sliders">
          <label>
            <span>Thu phóng</span>
            <input type="range" min="1" max="2.2" step="0.05" value={zoom} onChange={(e) => onUpdateShot({ zoom: Number(e.target.value) })} />
            <b>{zoom.toFixed(1)}×</b>
          </label>
          <label>
            <span>Ngang</span>
            <input type="range" min="-1" max="1" step="0.05" value={panX} onChange={(e) => onUpdateShot({ panX: Number(e.target.value) })} />
          </label>
          <label>
            <span>Dọc</span>
            <input type="range" min="-1" max="1" step="0.05" value={panY} onChange={(e) => onUpdateShot({ panY: Number(e.target.value) })} />
          </label>
          {hasTransform ? (
            <button type="button" className="link-btn" onClick={onResetTransform}>Đặt lại</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
