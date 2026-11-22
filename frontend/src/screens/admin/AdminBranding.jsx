// Admin Branding & Settings tab: live app identity, global announcement banner, maintenance mode, feature flags.
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../lib/icons.jsx';
import { applySiteConfig } from '../../lib/siteConfig.js';
import { Button } from '../../ui/kit.jsx';
import { ui } from '../../ui/overlays.jsx';

const ACCENT_PRESETS = [
  { hex: '#ffc629', name: 'Vàng Locket' },
  { hex: '#ff6b9d', name: 'Hồng Pastel' },
  { hex: '#7c5cff', name: 'Tím Studio' },
  { hex: '#0a84ff', name: 'Xanh Dương' },
  { hex: '#30d158', name: 'Xanh Lá' },
  { hex: '#ff7a30', name: 'Cam Hoàng Hôn' },
  { hex: '#ff453a', name: 'Đỏ Ruby' },
  { hex: '#2dd4bf', name: 'Ngọc Bích' },
];

const ANNOUNCE_TYPES = [
  ['info', 'Thông tin'],
  ['update', 'Cập nhật mới'],
  ['warning', 'Cảnh báo'],
  ['maintenance', 'Bảo trì'],
];

const FEATURE_META = [
  ['photobooth', 'Photobooth ghép ảnh', 'Chế độ chụp nhiều tấm 1:1 & khung ảnh trang trí'],
  ['boothVideo', 'Video động Photobooth', 'Xuất video động 1:1 có hiệu ứng từ bộ ảnh Photobooth'],
  ['smartCaptions', 'Chú thích thông minh (Nhạc / Thời tiết / Vị trí)', 'Tra cứu bài hát, thời tiết trực tiếp và check-in địa điểm'],
  ['zipExport', 'Xuất ZIP Kỷ niệm', 'Cho phép chọn nhiều khoảnh khắc tải xuống dạng file .zip'],
  ['chat', 'Tin nhắn trò chuyện', 'Nhắn tin trực tiếp với bạn bè ngay trên web'],
];

export function AdminBranding() {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.admin.getConfig().then(setCfg).catch((err) => ui.error(err.message));
  }, []);

  if (!cfg) {
    return <div className="empty"><span className="spinner" /></div>;
  }

  const setTop = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  const setAnn = (k, v) => setCfg((c) => ({ ...c, announcement: { ...c.announcement, [k]: v } }));
  const setMnt = (k, v) => setCfg((c) => ({ ...c, maintenance: { ...c.maintenance, [k]: v } }));
  const setFeat = (k, v) => setCfg((c) => ({ ...c, features: { ...c.features, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.admin.saveConfig(cfg);
      setCfg(saved);
      applySiteConfig(saved);
      ui.success('Đã lưu & áp dụng cấu hình thương hiệu ngay!');
    } catch (err) {
      ui.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    setCfg((c) => ({
      ...c,
      appName: 'Locket',
      tagline: 'Ảnh trực tiếp từ bạn bè, ngay trên màn hình chính',
      accentColor: '#ffc629',
    }));
  };

  return (
    <>
      <section className="adm-section">
        <div className="adm-card">
          <div className="adm-section-head" style={{ marginTop: 0 }}>
            <h3><Icon name="sparkles" /> Thương hiệu Ứng dụng Riêng (Live Branding)</h3>
            <button type="button" className="link-btn" onClick={resetDefaults}>Khôi phục mặc định</button>
          </div>

          <div className="adm-preview-box">
            <div className="adm-preview-brand">
              <span className="adm-preview-mark" style={{ background: cfg.accentColor, color: '#111' }}>
                <Icon name="heart" />
              </span>
              <span>{cfg.appName || 'Locket'}</span>
            </div>
            <div className="adm-preview-tag">{cfg.tagline || 'Chưa có khẩu hiệu'}</div>
          </div>

          <div className="adm-grid-2">
            <div className="adm-field">
              <label htmlFor="adm-app-name">Tên ứng dụng</label>
              <input
                id="adm-app-name"
                className="adm-input"
                type="text"
                maxLength={36}
                placeholder="VD: Huy's Locket, Locket Studio…"
                value={cfg.appName}
                onChange={(e) => setTop('appName', e.target.value)}
              />
            </div>

            <div className="adm-field">
              <label>Màu nhấn chủ đạo (Accent Color)</label>
              <div className="adm-swatches">
                {ACCENT_PRESETS.map((p) => (
                  <button
                    key={p.hex}
                    type="button"
                    title={p.name}
                    aria-label={p.name}
                    className={`adm-swatch ${cfg.accentColor?.toLowerCase() === p.hex ? 'on' : ''}`}
                    style={{ background: p.hex }}
                    onClick={() => setTop('accentColor', p.hex)}
                  />
                ))}
                <input
                  className="adm-color-pick"
                  type="color"
                  aria-label="Chọn màu tùy chỉnh"
                  value={cfg.accentColor || '#ffc629'}
                  onChange={(e) => setTop('accentColor', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="adm-field">
            <label htmlFor="adm-tagline">Khẩu hiệu màn hình đăng nhập (Tagline)</label>
            <input
              id="adm-tagline"
              className="adm-input"
              type="text"
              maxLength={140}
              value={cfg.tagline}
              onChange={(e) => setTop('tagline', e.target.value)}
            />
          </div>

          <div className="adm-field">
            <label htmlFor="adm-footer">Dòng chú thích chân trang đăng nhập</label>
            <input
              id="adm-footer"
              className="adm-input"
              type="text"
              maxLength={240}
              value={cfg.footerCredit}
              onChange={(e) => setTop('footerCredit', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-card">
          <div className="adm-section-head" style={{ marginTop: 0 }}>
            <h3><Icon name="megaphone" /> Thanh Thông báo Toàn hệ thống (Banner)</h3>
            <button
              type="button"
              className="switch pressable"
              role="switch"
              aria-checked={cfg.announcement.enabled ? 'true' : 'false'}
              aria-label="Bật thanh thông báo"
              onClick={() => setAnn('enabled', !cfg.announcement.enabled)}
            />
          </div>

          <div className="adm-chips" style={{ marginBottom: 12 }}>
            {ANNOUNCE_TYPES.map(([type, label]) => (
              <button
                key={type}
                type="button"
                className={`adm-chip ${cfg.announcement.type === type ? 'on' : ''}`}
                onClick={() => setAnn('type', type)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="adm-field">
            <label htmlFor="adm-ann-text">Nội dung thông báo</label>
            <input
              id="adm-ann-text"
              className="adm-input"
              type="text"
              maxLength={240}
              placeholder="VD: Đã cập nhật Photobooth 1:1 & Nhạc thịnh hành mới!"
              value={cfg.announcement.text}
              onChange={(e) => setAnn('text', e.target.value)}
            />
          </div>

          <div className="adm-grid-2">
            <div className="adm-field">
              <label htmlFor="adm-ann-link">Liên kết kèm theo (không bắt buộc)</label>
              <input
                id="adm-ann-link"
                className="adm-input"
                type="url"
                maxLength={300}
                placeholder="https://..."
                value={cfg.announcement.link}
                onChange={(e) => setAnn('link', e.target.value)}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="adm-ann-label">Chữ nút liên kết</label>
              <input
                id="adm-ann-label"
                className="adm-input"
                type="text"
                maxLength={40}
                placeholder="VD: Xem chi tiết"
                value={cfg.announcement.linkLabel}
                onChange={(e) => setAnn('linkLabel', e.target.value)}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-grid-2">
          <div className="adm-card">
            <div className="adm-section-head" style={{ marginTop: 0 }}>
              <h3><Icon name="wrench" /> Chế độ Bảo trì (Maintenance)</h3>
              <button
                type="button"
                className="switch pressable"
                role="switch"
                aria-checked={cfg.maintenance.enabled ? 'true' : 'false'}
                aria-label="Bật chế độ bảo trì"
                onClick={() => setMnt('enabled', !cfg.maintenance.enabled)}
              />
            </div>
            <div className="adm-field">
              <label htmlFor="adm-mnt-msg">Thông điệp hiển thị cho người dùng thường</label>
              <textarea
                id="adm-mnt-msg"
                className="adm-textarea"
                maxLength={260}
                value={cfg.maintenance.message}
                onChange={(e) => setMnt('message', e.target.value)}
              />
            </div>
            <small style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 600 }}>
              Khi bật, người dùng thường sẽ thấy màn hình bảo trì; tài khoản Admin vẫn sử dụng bình thường.
            </small>
          </div>

          <div className="adm-card">
            <div className="adm-section-head" style={{ marginTop: 0 }}>
              <h3><Icon name="gear" /> Công tắc Tính năng (Feature Flags)</h3>
            </div>
            {FEATURE_META.map(([key, title, desc]) => (
              <div key={key} className="adm-toggle-row">
                <div>
                  <b>{title}</b>
                  <small>{desc}</small>
                </div>
                <button
                  type="button"
                  className="switch pressable"
                  role="switch"
                  aria-checked={cfg.features[key] ? 'true' : 'false'}
                  aria-label={title}
                  onClick={() => setFeat(key, !cfg.features[key])}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="adm-save-bar">
        <Button variant="primary" icon="check" loading={saving} onClick={save}>
          Lưu &amp; Áp dụng ngay
        </Button>
      </div>
    </>
  );
}
