// Admin Features & Maintenance tab v2: dedicated Feature Flags console + Maintenance Mode with live preview & sticky Save Bar.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../lib/icons.jsx';
import { applySiteConfig, useSiteConfig } from '../../lib/siteConfig.js';
import { Button } from '../../ui/kit.jsx';
import { ui } from '../../ui/overlays.jsx';

const FEATURE_META = [
  ['photobooth', 'Photobooth ghép ảnh 1:1', 'Chế độ chụp nhiều tấm, chọn ảnh từ thư viện, khung trang trí và sticker'],
  ['boothVideo', 'Video động Photobooth', 'Xuất video 1:1 có hiệu ứng chuyển động từ bộ ảnh Photobooth (tốn CPU trình duyệt)'],
  ['smartCaptions', 'Chú thích thông minh (Nhạc / Thời tiết / Vị trí)', 'Tra cứu bài hát Spotify/iTunes, thời tiết trực tiếp và check-in địa điểm'],
  ['zipExport', 'Xuất album ZIP Kỷ niệm', 'Cho phép người dùng chọn nhiều khoảnh khắc tải xuống dạng file .zip (tốn băng thông)'],
  ['chat', 'Tin nhắn trò chuyện', 'Nhắn tin trực tiếp và đồng bộ tin nhắn chưa đọc với bạn bè ngay trên web'],
];

function pickFields(c) {
  if (!c) return null;
  return {
    maintenance: {
      enabled: !!c.maintenance?.enabled,
      message: c.maintenance?.message || 'Hệ thống đang bảo trì nâng cấp. Vui lòng quay lại sau ít phút nhé!',
    },
    features: {
      photobooth: c.features?.photobooth !== false,
      boothVideo: c.features?.boothVideo !== false,
      smartCaptions: c.features?.smartCaptions !== false,
      zipExport: c.features?.zipExport !== false,
      chat: c.features?.chat !== false,
    },
  };
}

export function AdminFeatures({ onDirtyChange, onSaved }) {
  const appName = useSiteConfig((s) => s.appName);
  const [savedCfg, setSavedCfg] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.admin.getConfig()
      .then((res) => {
        const p = pickFields(res);
        setSavedCfg(p);
        setCfg(p);
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

  const setMnt = (k, v) => setCfg((c) => ({ ...c, maintenance: { ...c.maintenance, [k]: v } }));
  const setFeat = (k, v) => setCfg((c) => ({ ...c, features: { ...c.features, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.admin.saveConfig(cfg);
      const p = pickFields(saved);
      setSavedCfg(p);
      setCfg(p);
      applySiteConfig(saved);
      onSaved?.();
      ui.success('Đã lưu cài đặt tính năng & bảo trì!');
    } catch (err) {
      ui.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = Object.values(cfg.features).filter(Boolean).length;

  return (
    <>
      <div className="adm-page-head">
        <div>
          <h1>Tính năng &amp; Bảo trì</h1>
          <p>Bật/tắt tức thì từng tính năng để tối ưu tài nguyên Render Free hoặc tạm khóa web khi cần nâng cấp.</p>
        </div>
      </div>

      <div className="adm-grid-2">
        <section className="adm-section">
          <div className="adm-card">
            <div className="adm-section-head">
              <h3><Icon name="gear" /> Công tắc Tính năng</h3>
              <span className="adm-tag online">{enabledCount} / {FEATURE_META.length} đang bật</span>
            </div>

            {FEATURE_META.map(([key, title, desc]) => {
              const on = !!cfg.features[key];
              return (
                <div key={key} className="adm-toggle-row">
                  <div>
                    <b>
                      <span>{title}</span>
                      <span className={`adm-tag ${on ? 'online' : 'info'}`}>{on ? 'Đang bật' : 'Đã tắt'}</span>
                    </b>
                    <small>{desc}</small>
                  </div>
                  <button
                    type="button"
                    className="switch pressable"
                    role="switch"
                    aria-checked={on ? 'true' : 'false'}
                    aria-label={title}
                    onClick={() => setFeat(key, !on)}
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="adm-section">
          <div className={`adm-card ${cfg.maintenance.enabled ? 'danger-border' : ''}`}>
            <div className="adm-section-head">
              <h3><Icon name="wrench" /> Chế độ Bảo trì</h3>
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
              <small>Khi bật, người dùng thường sẽ bị tạm khóa truy cập; tài khoản Chủ sở hữu của bạn vẫn đăng nhập &amp; sử dụng bình thường.</small>
            </div>

            <div className="adm-mockup-phone" style={{ marginTop: 14, padding: 16 }}>
              <div className="adm-mockup-label">
                <span>Xem trước màn hình bảo trì</span>
                <span style={{ color: cfg.maintenance.enabled ? 'var(--danger)' : '#8e8e93' }}>
                  {cfg.maintenance.enabled ? '● ĐANG KÍCH HOẠT' : 'Đang tắt'}
                </span>
              </div>
              <div className="adm-mockup-center" style={{ padding: '10px 6px' }}>
                <div className="adm-mockup-mark" style={{ background: 'var(--gold-soft)', color: 'var(--gold-text)' }}>
                  <Icon name="wrench" />
                </div>
                <b style={{ fontSize: 16 }}>{appName} đang bảo trì</b>
                <div className="adm-mockup-tag">{cfg.maintenance.message}</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {dirty ? (
        <div className="adm-dirty-bar" role="status">
          <div className="adm-dirty-msg">
            <i className="adm-dirty-dot" />
            <span>Bạn có thay đổi tính năng / bảo trì chưa lưu</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" disabled={saving} onClick={() => setCfg(savedCfg)}>Hoàn tác</Button>
            <Button variant="primary" size="sm" icon="check" loading={saving} onClick={save}>Lưu &amp; Áp dụng ngay</Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
