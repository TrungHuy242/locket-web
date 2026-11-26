// Locket Gold Perks Sheet, 32-Icon Picker ("Biểu tượng ứng dụng"),
// 3D Phone-Card Camera Theme Carousel ("Chủ đề máy ảnh"), and User Feedback / Gold Request sheet.
import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { APP_ICONS, getAppIconDataUrl, syncDocumentAppIcon } from '../../lib/appIcons.js';
import { CAMERA_THEMES } from '../../lib/cameraThemes.js';
import { vibrate } from '../../lib/format.js';
import { Icon } from '../../lib/icons.jsx';
import { getSettings, setSetting, useSettings } from '../../lib/settings.js';
import { useApp } from '../../store.js';
import { ui } from '../../ui/overlays.jsx';

export function useHasGold() {
  const isGold = useApp((s) => !!s.user?.gold?.active);
  const isAdmin = useApp((s) => !!s.isAdmin);
  return isGold || isAdmin;
}

const FEEDBACK_CONFIG = {
  gold_request: {
    title: 'Đăng ký Locket Gold VIP',
    subtitle: 'Gửi lời nhắn tới Quản trị viên để được cấp huy hiệu Locket Gold, mở khóa 32 biểu tượng & chủ đề máy ảnh.',
    subjectPlaceholder: 'Ví dụ: Cho mình xin nâng cấp Locket Gold nhé!',
    bodyPlaceholder: 'Nhập lời nhắn của bạn gửi tới chủ trang web…',
    submitLabel: '👑 Gửi yêu cầu mở khóa Gold',
    defaultSubject: 'Yêu cầu mở khóa Locket Gold VIP',
    successToast: 'Đã gửi yêu cầu Locket Gold tới Quản trị viên!',
  },
  bug: {
    title: 'Báo cáo sự cố',
    subtitle: 'Mô tả lỗi bạn gặp phải để Quản trị viên kiểm tra và khắc phục nhanh nhất.',
    subjectPlaceholder: 'Tóm tắt lỗi (ví dụ: Không bật được camera trước)',
    bodyPlaceholder: 'Bạn đang thao tác ở màn hình nào và lỗi hiển thị ra sao?…',
    submitLabel: 'Gửi báo cáo sự cố',
    defaultSubject: 'Báo cáo sự cố từ người dùng',
    successToast: 'Cảm ơn bạn! Báo cáo sự cố đã gửi tới Quản trị viên.',
  },
  suggestion: {
    title: 'Gửi đề xuất',
    subtitle: 'Ý kiến đóng góp của bạn sẽ được chuyển trực tiếp tới hộp thư của Quản trị viên.',
    subjectPlaceholder: 'Tiêu đề góp ý ngắn gọn…',
    bodyPlaceholder: 'Chia sẻ đề xuất cải thiện giao diện hoặc trải nghiệm…',
    submitLabel: 'Gửi đề xuất',
    defaultSubject: 'Đề xuất cải tiến ứng dụng',
    successToast: 'Đã gửi đề xuất tới Quản trị viên!',
  },
  feature: {
    title: 'Yêu cầu một tính năng',
    subtitle: 'Bạn muốn Locket có thêm tính năng hay chủ đề mới nào? Hãy nói cho Quản trị viên biết!',
    subjectPlaceholder: 'Tên tính năng bạn mong muốn…',
    bodyPlaceholder: 'Mô tả chi tiết tính năng bạn muốn thêm vào web…',
    submitLabel: '✨ Gửi yêu cầu tính năng',
    defaultSubject: 'Yêu cầu tính năng mới',
    successToast: 'Đã gửi yêu cầu tính năng tới Quản trị viên!',
  },
};

export function FeedbackSheet({ category = 'suggestion', onClose }) {
  const cfg = FEEDBACK_CONFIG[category] || FEEDBACK_CONFIG.suggestion;
  const [title, setTitle] = useState(category === 'gold_request' ? cfg.defaultSubject : '');
  const [message, setMessage] = useState(
    category === 'gold_request' ? 'Chào Admin, cấp giúp tài khoản của mình quyền Locket Gold VIP nhé! Cảm ơn bạn nhiều 💛' : '',
  );
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true);
    try {
      const st = getSettings();
      await api.submitFeedback({
        category,
        title: title.trim() || cfg.defaultSubject,
        message: message.trim(),
        meta: {
          appIcon: st.appIcon || 'classic',
          cameraTheme: st.cameraTheme || 'classic',
          platform: navigator.platform || 'web',
        },
      });
      vibrate(15);
      ui.success(cfg.successToast);
      onClose?.();
    } catch (err) {
      ui.error(err.message || 'Không gửi được phản hồi');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gold-sheet feedback-modal">
      <div className="gold-sheet-head">
        <h2>{cfg.title}</h2>
        <p>{cfg.subtitle}</p>
      </div>
      <form onSubmit={submit} className="fb-form">
        <label className="fb-field">
          <span>Tiêu đề</span>
          <input
            type="text"
            maxLength={120}
            placeholder={cfg.subjectPlaceholder}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="fb-field">
          <span>Nội dung chi tiết</span>
          <textarea
            rows={4}
            maxLength={1500}
            required
            placeholder={cfg.bodyPlaceholder}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-gold-cta" disabled={busy || message.trim().length < 2}>
          {busy ? 'Đang gửi…' : cfg.submitLabel}
        </button>
      </form>
    </div>
  );
}

export function openFeedbackSheet(category = 'suggestion') {
  const ctl = ui.sheet(() => <FeedbackSheet category={category} onClose={() => ctl.close()} />);
  return ctl;
}

const GOLD_PERKS = [
  { emoji: '🚫', title: 'Không có quảng cáo!', desc: 'Trải nghiệm mượt mà, sạch sẽ tuyệt đối không quảng cáo.' },
  { emoji: '🎬', title: 'Video Lockets', desc: 'Quay giữ và chia sẻ những khoảnh khắc video sắc nét có âm thanh.' },
  { emoji: '👀', title: 'Lượt xem Locket', desc: 'Xem ai đã mở và thả biểu cảm vào khoảnh khắc của bạn.' },
  { emoji: '🖼️', title: 'Tải lên từ cuộn camera', desc: 'Chọn ảnh và cắt video 10 giây trực tiếp từ thư viện máy.' },
  { emoji: '💛', title: 'Thêm bạn bè tùy ý', desc: 'Kết nối và chia sẻ khoảnh khắc cùng hội bạn thân.' },
  { emoji: '🎨', title: 'Biểu tượng & Chủ đề tùy chỉnh', desc: 'Mở khóa trọn bộ 32 icon ứng dụng & 6 chủ đề máy ảnh độc quyền.' },
  { emoji: '✨', title: 'Yêu cầu một tính năng', desc: 'Đề xuất tính năng mới trực tiếp tới Quản trị viên.', action: 'feature' },
];

export function LocketGoldSheet({ reasonText = '', onClose }) {
  const user = useApp((s) => s.user);
  const hasGold = useHasGold();
  const sinceYear = user?.gold?.since || new Date().getFullYear();

  return (
    <div className="gold-sheet">
      <div className="gold-hero">
        <div className="gold-hero-badge">
          <span className="gold-heart-medallion">💛</span>
          <span className="gold-spark s1">✦</span>
          <span className="gold-spark s2">✦</span>
        </div>
        <h2>Locket Gold</h2>
        {hasGold ? (
          <span className="gold-status-pill active">👑 Đã mở khóa VIP • Member Since {sinceYear}</span>
        ) : (
          <span className="gold-status-pill">Đặc quyền VIP do Quản trị viên cấp</span>
        )}
        {reasonText ? <p className="gold-reason-note">{reasonText}</p> : null}
      </div>

      <div className="gold-perk-list">
        {GOLD_PERKS.map((p) => {
          const Tag = p.action ? 'button' : 'div';
          return (
            <Tag
              key={p.title}
              type={p.action ? 'button' : undefined}
              className={`gold-perk-row ${p.action ? 'clickable pressable' : ''}`}
              onClick={p.action ? () => { onClose?.(); openFeedbackSheet('feature'); } : undefined}
            >
              <span className="gold-perk-ic">{p.emoji}</span>
              <span className="gold-perk-txt">
                <b>{p.title}</b>
                <small>{p.desc}</small>
              </span>
              {p.action ? <Icon name="chevRight" /> : null}
            </Tag>
          );
        })}
      </div>

      <div className="gold-sheet-foot">
        {hasGold ? (
          <div className="gold-vip-actions">
            <button
              type="button"
              className="btn btn-dark"
              onClick={() => { onClose?.(); openAppIconSheet(); }}
            >
              Đổi biểu tượng
            </button>
            <button
              type="button"
              className="btn btn-gold-cta"
              onClick={() => { onClose?.(); openCameraThemeSheet(); }}
            >
              Đổi chủ đề máy ảnh
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-gold-cta"
            onClick={() => { onClose?.(); openFeedbackSheet('gold_request'); }}
          >
            👑 Gửi yêu cầu cấp Locket Gold VIP
          </button>
        )}
      </div>
    </div>
  );
}

export function openLocketGoldSheet(reasonText = '') {
  const ctl = ui.sheet(() => <LocketGoldSheet reasonText={reasonText} onClose={() => ctl.close()} />, { full: true });
  return ctl;
}

export function AppIconSheet({ onClose }) {
  const settings = useSettings();
  const hasGold = useHasGold();
  const activeId = hasGold ? (settings.appIcon || 'classic') : 'classic';

  const previews = useMemo(
    () => APP_ICONS.map((ic) => ({ ...ic, url: getAppIconDataUrl(ic.id, 144) })),
    [],
  );

  const pick = (ic) => {
    if (!hasGold && !ic.free) {
      onClose?.();
      openLocketGoldSheet(`Biểu tượng "${ic.name}" thuộc gói Locket Gold VIP. Hãy gửi yêu cầu để Quản trị viên mở khóa cho bạn!`);
      return;
    }
    vibrate(12);
    setSetting('appIcon', ic.id);
    syncDocumentAppIcon(ic.id, hasGold);
    ui.success(`Đã đổi biểu tượng sang "${ic.name}"`, 1600);
  };

  return (
    <div className="gold-sheet app-icon-sheet">
      <div className="gold-sheet-head">
        <h2>Biểu tượng ứng dụng</h2>
        <p>Chọn một biểu tượng ứng dụng tùy chỉnh cho Màn hình chính của bạn</p>
      </div>
      <div className="app-icon-grid">
        {previews.map((ic) => {
          const selected = activeId === ic.id;
          const locked = !hasGold && !ic.free;
          return (
            <button
              key={ic.id}
              type="button"
              className={`app-icon-cell pressable ${selected ? 'on' : ''}`}
              onClick={() => pick(ic)}
              title={ic.name}
            >
              <span className="app-icon-squircle">
                <img src={ic.url} alt={ic.name} loading="lazy" />
                {locked ? <i className="app-icon-lock">👑</i> : null}
              </span>
              <span className="app-icon-name">{ic.name}</span>
              <span className={`app-icon-radio ${selected ? 'on' : ''}`} aria-hidden="true">
                {selected ? <Icon name="check" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function openAppIconSheet() {
  const ctl = ui.sheet(() => <AppIconSheet onClose={() => ctl.close()} />, { full: true });
  return ctl;
}

export function CameraThemeSheet({ onClose }) {
  const settings = useSettings();
  const hasGold = useHasGold();
  const currentId = hasGold ? (settings.cameraTheme || 'classic') : 'classic';
  const [selectedIdx, setSelectedIdx] = useState(() => Math.max(0, CAMERA_THEMES.findIndex((t) => t.id === currentId)));
  const focused = CAMERA_THEMES[selectedIdx] || CAMERA_THEMES[0];

  const applyTheme = (theme) => {
    if (!hasGold && !theme.free) {
      onClose?.();
      openLocketGoldSheet(`Chủ đề máy ảnh "${theme.name}" thuộc đặc quyền Locket Gold VIP. Gửi yêu cầu để Quản trị viên kích hoạt ngay nhé!`);
      return;
    }
    vibrate(14);
    setSetting('cameraTheme', theme.id);
    ui.success(`Đã áp dụng chủ đề "${theme.name}"`, 1600);
  };

  return (
    <div className="gold-sheet cam-theme-sheet">
      <div className="gold-sheet-head">
        <h2>Chủ đề máy ảnh</h2>
        <p>Trang trí máy ảnh bằng cách chọn một chủ đề</p>
      </div>

      <div className="cam-theme-carousel" role="listbox" aria-label="Chủ đề máy ảnh">
        {CAMERA_THEMES.map((t, idx) => {
          const isCurrent = currentId === t.id;
          const isFocused = selectedIdx === idx;
          const locked = !hasGold && !t.free;
          return (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={isFocused}
              className={`cam-theme-phone pressable ${isFocused ? 'focused' : ''} ${isCurrent ? 'applied' : ''}`}
              style={{ background: t.shellGrad }}
              onClick={() => { setSelectedIdx(idx); applyTheme(t); }}
            >
              <div className="ctp-topbar">
                <span className="ctp-dot" />
                <span className="ctp-pill" style={{ background: t.pillBg, color: t.pillText }}>👥 Bạn bè</span>
                <span className="ctp-dot gold" />
              </div>

              <div className={`ctp-vf ${t.id}`}>
                {t.id === 'coquette' ? (
                  <div className="ctp-frame coquette">
                    <div className="ctp-grid2x2">
                      <span /><span /><span /><span />
                    </div>
                    <div className="ctp-frame-cap">🎀 sweet coquette 🧸</div>
                  </div>
                ) : t.id === 'berry' ? (
                  <div className="ctp-frame berry">
                    <div className="ctp-grid2x2">
                      <span /><span /><span /><span />
                    </div>
                    <div className="ctp-frame-cap">📸 LOCKET EDITION ♥</div>
                  </div>
                ) : (
                  <div className="ctp-lens-glow">
                    <span className="ctp-vf-ic tl">⚡</span>
                    <span className="ctp-vf-ic tr">1x</span>
                    <span className="ctp-vf-ic bc">↖↘</span>
                  </div>
                )}
              </div>

              <div className="ctp-controls">
                <span className="ctp-card-stack" />
                <span className="ctp-shutter" style={{ boxShadow: `inset 0 0 0 3.5px ${t.shutterRing}` }} />
                <span className="ctp-flip">↻</span>
              </div>

              <div className="ctp-foot">
                <b>{t.name}</b>
                {locked ? <span className="ctp-tag lock">👑 Gold</span> : isCurrent ? <span className="ctp-tag on">✓ Đang dùng</span> : null}
              </div>
            </button>
          );
        })}
      </div>

      <div className="cam-theme-caption">
        <b>{focused.name}</b>
        <span>{focused.subtitle}</span>
        {focused.badge ? <small className="cam-theme-frame-pill">{focused.badge}</small> : null}
      </div>

      <div className="gold-sheet-foot">
        <button type="button" className="btn btn-gold-cta" onClick={() => applyTheme(focused)}>
          {!hasGold && !focused.free
            ? '👑 Mở khóa với Locket Gold'
            : currentId === focused.id
              ? '✓ Đang sử dụng chủ đề này'
              : `Áp dụng "${focused.name}"`}
        </button>
      </div>
    </div>
  );
}

export function openCameraThemeSheet() {
  const ctl = ui.sheet(() => <CameraThemeSheet onClose={() => ctl.close()} />, { full: true });
  return ctl;
}
