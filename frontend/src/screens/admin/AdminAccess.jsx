// Admin Access & Invites v2: auto-saving Invite-Only switch, clear labels + quick-picks for Invite Codes,
// and 1-tap shareable Messenger/Zalo invite message copy.
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../lib/icons.jsx';
import { loadSiteConfig, useSiteConfig } from '../../lib/siteConfig.js';
import { Button } from '../../ui/kit.jsx';
import { ui } from '../../ui/overlays.jsx';

function fmtDate(ms) {
  if (!ms) return 'Vĩnh viễn';
  const d = new Date(ms);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

export function AdminAccess({ onChanged }) {
  const appName = useSiteConfig((s) => s.appName);
  const [acc, setAcc] = useState(null);
  const [maxUsersDraft, setMaxUsersDraft] = useState('0');
  const [wlInput, setWlInput] = useState('');
  const [invLabel, setInvLabel] = useState('');
  const [invMaxUses, setInvMaxUses] = useState('5');
  const [invDays, setInvDays] = useState('30');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.admin.getAccess()
      .then((res) => { setAcc(res); setMaxUsersDraft(String(res.maxUsers ?? 0)); })
      .catch((err) => ui.error(err.message));
  }, []);

  if (!acc) {
    return <div className="empty"><span className="spinner" /></div>;
  }

  const persistAccess = async (patch, successMsg) => {
    setSaving(true);
    try {
      const saved = await api.admin.saveAccess({
        inviteOnly: patch.inviteOnly ?? acc.inviteOnly,
        maxUsers: patch.maxUsers !== undefined ? Number(patch.maxUsers) || 0 : acc.maxUsers,
        whitelist: patch.whitelist ?? acc.whitelist,
      });
      setAcc(saved);
      setMaxUsersDraft(String(saved.maxUsers ?? 0));
      loadSiteConfig();
      onChanged?.();
      if (successMsg) ui.success(successMsg);
    } catch (err) {
      ui.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Auto-save Invite-Only immediately so the owner never forgets to click Save!
  const toggleInviteOnly = async () => {
    const next = !acc.inviteOnly;
    setAcc((c) => ({ ...c, inviteOnly: next }));
    await persistAccess(
      { inviteOnly: next },
      next ? 'Đã bật Chế độ Riêng tư (chỉ người được mời)' : 'Đã chuyển sang Chế độ Công khai',
    );
  };

  const saveMaxUsers = async (e) => {
    e.preventDefault();
    const num = Math.max(0, Math.min(100000, Number(maxUsersDraft) || 0));
    await persistAccess({ maxUsers: num }, num ? `Đã đặt giới hạn tối đa ${num} người dùng` : 'Đã bỏ giới hạn số người dùng');
  };

  const addWhitelist = async (e) => {
    e.preventDefault();
    const val = wlInput.trim();
    if (!val) return;
    const norm = val.includes('@') ? val.toLowerCase() : val;
    if (acc.whitelist.includes(norm)) {
      ui.info('Người này đã có sẵn trong danh sách đặc cách');
      return;
    }
    setWlInput('');
    await persistAccess({ whitelist: [...acc.whitelist, norm] }, `Đã thêm ${norm} vào Whitelist`);
  };

  const removeWhitelist = async (item) => {
    await persistAccess({ whitelist: acc.whitelist.filter((x) => x !== item) }, `Đã gỡ ${item} khỏi Whitelist`);
  };

  const createInvite = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.admin.createInvite({
        label: invLabel.trim(),
        maxUses: Math.max(0, Number(invMaxUses) || 0),
        expiresDays: Math.max(0, Number(invDays) || 0),
      });
      setAcc((cur) => ({ ...cur, invites: [res.invite, ...(cur.invites || [])] }));
      setInvLabel('');
      onChanged?.();
      ui.success(`Đã tạo mã mời ${res.invite.code}`);
    } catch (err) {
      ui.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const copyText = async (txt, msg) => {
    try {
      await navigator.clipboard.writeText(txt);
      ui.success(msg);
    } catch {
      ui.info(txt);
    }
  };

  const copyFullInvite = (inv) => {
    const url = typeof window !== 'undefined' ? window.location.origin : '';
    const text = `Mời bạn vào ${appName} cùng mình nè!\nTruy cập: ${url}\nMã mời: ${inv.code}`;
    copyText(text, `Đã chép lời mời kèm mã ${inv.code} — dán vào Zalo/Messenger ngay!`);
  };

  const revokeInvite = async (code) => {
    if (!await ui.confirm(`Thu hồi mã ${code}?`, 'Người mới sẽ không thể dùng mã này để đăng nhập nữa.', 'Thu hồi')) return;
    try {
      await api.admin.revokeInvite(code);
      setAcc((cur) => ({ ...cur, invites: (cur.invites || []).filter((i) => i.code !== code) }));
      onChanged?.();
      ui.success(`Đã thu hồi mã ${code}`);
    } catch (err) {
      ui.error(err.message);
    }
  };

  const now = Date.now();
  const maxChanged = String(acc.maxUsers ?? 0) !== maxUsersDraft.trim();

  return (
    <>
      <div className="adm-page-head">
        <div>
          <h1>Kiểm soát Truy cập &amp; Mã mời</h1>
          <p>Quyết định ai được phép sử dụng trang web của bạn — mở công khai hoặc giữ riêng cho nhóm bạn thân.</p>
        </div>
      </div>

      <section className="adm-section">
        <div className={`adm-card ${acc.inviteOnly ? 'warn-border' : ''}`}>
          <div className="adm-toggle-row" style={{ paddingTop: 0 }}>
            <div>
              <b>
                Chế độ Riêng tư (Chỉ người được mời)
                <span className={`adm-tag ${acc.inviteOnly ? 'admin' : 'online'}`}>
                  {acc.inviteOnly ? 'Đang bật (Riêng tư)' : 'Đang tắt (Công khai)'}
                </span>
              </b>
              <small>Khi bật, người mới đăng nhập lần đầu bắt buộc phải nhập Mã mời hoặc có email nằm trong Whitelist. Tự động lưu ngay khi gạt.</small>
            </div>
            <button
              type="button"
              className="switch pressable"
              role="switch"
              disabled={saving}
              aria-checked={acc.inviteOnly ? 'true' : 'false'}
              aria-label="Bật chế độ riêng tư"
              onClick={toggleInviteOnly}
            />
          </div>

          <form className="adm-field" style={{ marginTop: 14 }} onSubmit={saveMaxUsers}>
            <label htmlFor="adm-max-users">Giới hạn tổng số người dùng tối đa</label>
            <small>Nhập 0 để không giới hạn. Hữu ích khi muốn tiết kiệm tài nguyên Render Free.</small>
            <div className="adm-inline-form" style={{ marginTop: 4 }}>
              <input
                id="adm-max-users"
                className="adm-input"
                style={{ maxWidth: 220 }}
                type="number"
                min="0"
                max="100000"
                value={maxUsersDraft}
                onChange={(e) => setMaxUsersDraft(e.target.value)}
              />
              <Button type="submit" variant={maxChanged ? 'primary' : 'secondary'} size="sm" loading={saving} disabled={!maxChanged}>
                Lưu giới hạn
              </Button>
            </div>
          </form>
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-card">
          <div className="adm-section-head">
            <h3><Icon name="people" /> Danh sách Đặc cách (Whitelist)</h3>
            <span className="adm-tag info">{acc.whitelist.length} người</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, marginBottom: 12 }}>
            Email hoặc UID trong danh sách này luôn được vào web mà không cần nhập mã mời (bạn cũng có thể thêm nhanh trong tab <b>Người dùng</b>).
          </p>
          <form className="adm-inline-form" onSubmit={addWhitelist}>
            <input
              className="adm-input"
              type="text"
              placeholder="Nhập email bạn bè (vd: ban@gmail.com) hoặc UID…"
              value={wlInput}
              onChange={(e) => setWlInput(e.target.value)}
            />
            <Button type="submit" variant="primary" size="sm" icon="plus" disabled={!wlInput.trim() || saving}>Thêm vào Whitelist</Button>
          </form>

          {acc.whitelist.length ? (
            <div className="adm-wl-list">
              {acc.whitelist.map((item) => (
                <span key={item} className="adm-wl-chip">
                  <span>{item}</span>
                  <button type="button" aria-label={`Xóa ${item}`} onClick={() => removeWhitelist(item)}><Icon name="closeSm" /></button>
                </span>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--faint)', fontWeight: 600 }}>Chưa có ai trong danh sách đặc cách.</div>
          )}
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-card">
          <div className="adm-section-head">
            <h3><Icon name="key" /> Tạo &amp; Quản lý Mã mời</h3>
            <span className="adm-tag info">{(acc.invites || []).length} mã</span>
          </div>

          <form className="adm-invite-grid" onSubmit={createInvite}>
            <div className="adm-field" style={{ marginBottom: 0 }}>
              <label htmlFor="adm-inv-label">Nhãn gợi nhớ</label>
              <input
                id="adm-inv-label"
                className="adm-input"
                type="text"
                maxLength={60}
                placeholder="VD: Nhóm lớp, Bạn thân…"
                value={invLabel}
                onChange={(e) => setInvLabel(e.target.value)}
              />
            </div>

            <div className="adm-field" style={{ marginBottom: 0 }}>
              <label htmlFor="adm-inv-uses">Số lượt dùng (0 = vô hạn)</label>
              <input
                id="adm-inv-uses"
                className="adm-input"
                type="number"
                min="0"
                max="10000"
                value={invMaxUses}
                onChange={(e) => setInvMaxUses(e.target.value)}
              />
              <div className="adm-quick-picks">
                {[['1', '1 lượt'], ['5', '5 lượt'], ['0', 'Vô hạn']].map(([v, lbl]) => (
                  <button key={v} type="button" className={invMaxUses === v ? 'on' : ''} onClick={() => setInvMaxUses(v)}>{lbl}</button>
                ))}
              </div>
            </div>

            <div className="adm-field" style={{ marginBottom: 0 }}>
              <label htmlFor="adm-inv-days">Hạn dùng (ngày, 0 = mãi mãi)</label>
              <input
                id="adm-inv-days"
                className="adm-input"
                type="number"
                min="0"
                max="365"
                value={invDays}
                onChange={(e) => setInvDays(e.target.value)}
              />
              <div className="adm-quick-picks">
                {[['7', '7 ngày'], ['30', '30 ngày'], ['0', 'Vĩnh viễn']].map(([v, lbl]) => (
                  <button key={v} type="button" className={invDays === v ? 'on' : ''} onClick={() => setInvDays(v)}>{lbl}</button>
                ))}
              </div>
            </div>

            <Button type="submit" variant="primary" icon="plus" loading={creating}>Tạo mã mời</Button>
          </form>

          {!(acc.invites || []).length ? (
            <div style={{ marginTop: 14, fontSize: 13, color: 'var(--faint)', fontWeight: 600 }}>
              Chưa có mã mời nào. Điền thông tin ở trên rồi bấm <b>Tạo mã mời</b> để cấp cho bạn bè.
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              {acc.invites.map((inv) => {
                const expired = inv.expiresAt > 0 && inv.expiresAt < now;
                const exhausted = inv.maxUses > 0 && inv.uses >= inv.maxUses;
                return (
                  <div key={inv.code} className="adm-invite-row">
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="adm-invite-code">{inv.code}</span>
                        {inv.label ? <span style={{ fontSize: 13, fontWeight: 800 }}>{inv.label}</span> : null}
                        {expired ? <span className="adm-tag banned">Hết hạn</span> : null}
                        {exhausted ? <span className="adm-tag banned">Hết lượt</span> : null}
                        {!expired && !exhausted ? <span className="adm-tag online">Đang hoạt động</span> : null}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginTop: 4 }}>
                        Đã dùng: <b>{inv.uses}</b> / {inv.maxUses || '∞'} lượt · Hạn sử dụng: <b>{fmtDate(inv.expiresAt)}</b>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Button variant="tinted" size="sm" icon="share" onClick={() => copyFullInvite(inv)}>Chép lời mời</Button>
                      <Button variant="secondary" size="sm" icon="copy" onClick={() => copyText(inv.code, `Đã sao chép mã ${inv.code}`)}>Chép mã</Button>
                      <Button variant="destructive-tinted" size="sm" icon="trash" onClick={() => revokeInvite(inv.code)}>Thu hồi</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
