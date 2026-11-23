// Admin Branding & Announcement Studio v2: 2-column live WYSIWYG preview + 5 one-click theme presets + Sticky Unsaved Bar.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../lib/icons.jsx';
import { applySiteConfig } from '../../lib/siteConfig.js';
import { Button } from '../../ui/kit.jsx';
import { ui } from '../../ui/overlays.jsx';

const THEME_PRESETS = [
  { name: 'Vàng Locket', accentColor: '#ffc629', tagline: 'Ảnh trực tiếp từ bạn bè, ngay trên màn hình chính' },
  { name: 'Hồng Pastel', accentColor: '#ff6b9d', tagline: 'Góc nhỏ lưu giữ từng khoảnh khắc đáng yêu cùng nhau' },
  { name: 'Tím Studio', accentColor: '#7c5cff', tagline: 'Không gian chia sẻ khoảnh khắc riêng tư & phong cách' },
  { name: 'Matcha Tươi', accentColor: '#30d158', tagline: 'Nhật ký ảnh mỗi ngày — nhẹ nhàng, gần gũi' },
  { name: 'Biển Xanh', accentColor: '#0a84ff', tagline: 'Kết nối bạn thân qua từng khung hình tức thì' },
];

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

function contrastOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return '#111';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#111111' : '#ffffff';
}

function pickBrandingFields(c) {
  if (!c) return null;
  return {
    appName: c.appName || '',
    tagline: c.tagline || '',
    accentColor: (c.accentColor || '#ffc629').toLowerCase(),
    footerCredit: c.footerCredit || '',
    announcement: {
      enabled: !!c.announcement?.enabled,
      type: c.announcement?.type || 'info',
      text: c.announcement?.text || '',
      link: c.announcement?.link || '',
      linkLabel: c.announcement?.linkLabel || '',
    },
  };
}

export function AdminBranding({ onDirtyChange, onSaved }) {
  const [savedCfg, setSavedCfg] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.admin.getConfig()
      .then((res) => {
        const picked = pickBrandingFields(res);
        setSavedCfg(picked);
        setCfg(picked);
      })
      .catch((err) => ui.error(err.message));
  }, []);

  const dirty = useMemo(() => {
    if (!cfg || !savedCfg) return false;
    return JSON.stringify(cfg) !== JSON.stringify(savedCfg);
  }, [cfg, savedCfg]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  if (!cfg) {
    return <div className="empty"><span className="spinner" /></div>;
  }

  const setTop = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  const setAnn = (k, v) => setCfg((c) => ({ ...c, announcement: { ...c.announcement, [k]: v } }));

  const applyTheme = (preset) => {
    setCfg((c) => ({ ...c, accentColor: preset.accentColor, tagline: preset.tagline }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.admin.saveConfig(cfg);
      const picked = pickBrandingFields(saved);
      setSavedCfg(picked);
      setCfg(picked);
      applySiteConfig(saved);
      onSaved?.();
      ui.success('Đã lưu & áp dụng giao diện thương hiệu ngay!');
    } catch (err) {
      ui.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const revert = () => {
    setCfg(savedCfg);
  };

  const btnInk = contrastOn(cfg.accentColor);

  return (
    <>
      <div className="adm-page-head">
        <div>
          <h1>Thương hiệu &amp; Thông báo</h1>
          <p>Biến trang web thành ứng dụng mang dấu ấn riêng của bạn — xem trước trực tiếp mọi thay đổi trước khi áp dụng.</p>
        </div>
      </div>

      <div className="adm-studio">
        <div>
          <section className="adm-section">
            <div className="adm-card">
              <div className="adm-section-head">
                <h3><Icon name="sparkles" /> Bộ giao diện nhanh (1 chạm)</h3>
              </div>
              <div className="adm-theme-grid">
                {THEME_PRESETS.map((t) => (
                  <button
                    key={t.name}
                    type="button"
                    className={`adm-theme-card ${cfg.accentColor === t.accentColor ? 'on' : ''}`}
                    onClick={() => applyTheme(t)}
                  >
                    <span className="adm-theme-dot" style={{ background: t.accentColor }} />
                    <span>{t.name}</span>
                  </button>
                ))}
              </div>

              <div className="adm-grid-2">
                <div className="adm-field">
                  <label htmlFor="adm-app-name">Tên ứng dụng</label>
                  <input
                    id="adm-app-name"
                    className="adm-input"
                    type="text"
                    maxLength={36}
                    placeholder="VD: Locket Của Huy, Huy Studio…"
                    value={cfg.appName}
                    onChange={(e) => setTop('appName', e.target.value)}
                  />
                </div>

                <div className="adm-field">
                  <label>Màu nhấn chủ đạo</label>
                  <div className="adm-swatches">
                    {ACCENT_PRESETS.map((p) => (
                      <button
                        key={p.hex}
                        type="button"
                        title={p.name}
                        aria-label={p.name}
                        className={`adm-swatch ${cfg.accentColor === p.hex ? 'on' : ''}`}
                        style={{ background: p.hex }}
                        onClick={() => setTop('accentColor', p.hex)}
                      />
                    ))}
                    <input
                      className="adm-color-pick"
                      type="color"
                      aria-label="Chọn màu tùy chỉnh"
                      value={cfg.accentColor || '#ffc629'}
                      onChange={(e) => setTop('accentColor', e.target.value.toLowerCase())}
                    />
                  </div>
                </div>
              </div>

              <div className="adm-field">
                <label htmlFor="adm-tagline">Khẩu hiệu màn hình đăng nhập</label>
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
              <div className="adm-section-head">
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
                <label htmlFor="adm-ann-text">Nội dung thông báo gửi tới mọi người dùng</label>
                <input
                  id="adm-ann-text"
                  className="adm-input"
                  type="text"
                  maxLength={240}
                  placeholder="VD: Đã nâng cấp Photobooth 1:1 & Nhạc thịnh hành mới!"
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
                  <label htmlFor="adm-ann-label">Chữ trên nút liên kết</label>
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
        </div>

        {/* Sticky Live Preview Mockup */}
        <aside className="adm-studio-preview" aria-label="Xem trước trực tiếp">
          <div className="adm-mockup-phone">
            <div className="adm-mockup-label">
              <span>Xem trước trực tiếp</span>
              <span style={{ color: cfg.accentColor }}>● Trực quan</span>
            </div>

            {cfg.announcement.enabled && cfg.announcement.text.trim() ? (
              <div className={`adm-mockup-banner ${cfg.announcement.type}`}>
                <span style={{ color: cfg.accentColor, flex: 'none' }}><Icon name="megaphone" /></span>
                <span style={{ flex: 1, minWidth: 0 }}>{cfg.announcement.text}</span>
                {cfg.announcement.link ? (
                  <span style={{ padding: '2px 7px', borderRadius: 8, background: cfg.accentColor, color: btnInk, fontSize: 10, fontWeight: 900 }}>
                    {cfg.announcement.linkLabel || 'Xem'}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="adm-mockup-center">
              <div className="adm-mockup-logo">
                <span className="adm-mockup-mark" style={{ background: cfg.accentColor, color: btnInk }}>
                  <Icon name="heart" />
                </span>
                <span>{cfg.appName || 'Locket'}</span>
              </div>
              <div className="adm-mockup-tag">{cfg.tagline || 'Chưa có khẩu hiệu'}</div>
              <div className="adm-mockup-btn" style={{ background: cfg.accentColor, color: btnInk }}>Đăng nhập</div>
              <div className="adm-mockup-foot">{cfg.footerCredit}</div>
            </div>
          </div>
        </aside>
      </div>

      {dirty ? (
        <div className="adm-dirty-bar" role="status">
          <div className="adm-dirty-msg">
            <i className="adm-dirty-dot" />
            <span>Bạn có thay đổi thương hiệu / thông báo chưa lưu</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" disabled={saving} onClick={revert}>Hoàn tác</Button>
            <Button variant="primary" size="sm" icon="check" loading={saving} onClick={save}>Lưu &amp; Áp dụng ngay</Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
