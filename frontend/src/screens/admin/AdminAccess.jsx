// Admin Access tab: Invite-Only private mode, Max Users cap, Whitelist, and Invite Code generator.
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../lib/icons.jsx';
import { loadSiteConfig } from '../../lib/siteConfig.js';
import { Button } from '../../ui/kit.jsx';
import { ui } from '../../ui/overlays.jsx';

function fmtDate(ms) {
  if (!ms) return 'Không hết hạn';
  const d = new Date(ms);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

export function AdminAccess() {
  const [acc, setAcc] = useState(null);
  const [wlInput, setWlInput] = useState('');
  const [invLabel, setInvLabel] = useState('');
  const [invMaxUses, setInvMaxUses] = useState('5');
  const [invDays, setInvDays] = useState('30');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = () => {
    api.admin.getAccess().then(setAcc).catch((err) => ui.error(err.message));
  };
  useEffect(() => { load(); }, []);

  if (!acc) {
    return <div className="empty"><span className="spinner" /></div>;
  }

  const saveAccess = async (nextAcc = acc) => {
    setSaving(true);
    try {
      const saved = await api.admin.saveAccess({
        inviteOnly: nextAcc.inviteOnly,
        maxUsers: Number(nextAcc.maxUsers) || 0,
        whitelist: nextAcc.whitelist,
      });
      setAcc(saved);
      loadSiteConfig();
      ui.success('Đã lưu quy tắc truy cập');
    } catch (err) {
      ui.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addWhitelist = async (e) => {
    e.preventDefault();
    const val = wlInput.trim();
    if (!val) return;
    const norm = val.includes('@') ? val.toLowerCase() : val;
    if (acc.whitelist.includes(norm)) {
      ui.info('Đã có trong danh sách đặc cách');
      return;
    }
    const next = { ...acc, whitelist: [...acc.whitelist, norm] };
    setAcc(next);
    setWlInput('');
    await saveAccess(next);
  };

  const removeWhitelist = async (item) => {
    const next = { ...acc, whitelist: acc.whitelist.filter((x) => x !== item) };
    setAcc(next);
    await saveAccess(next);
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
      ui.success(`Đã tạo mã mời ${res.invite.code}`);
    } catch (err) {
      ui.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      ui.success(`Đã sao chép mã ${code}`);
    } catch {
      ui.info(`Mã mời: ${code}`);
    }
  };

  const revokeInvite = async (code) => {
    if (!await ui.confirm(`Thu hồi mã ${code}?`, 'Người dùng mới sẽ không thể dùng mã này để đăng nhập nữa.', 'Thu hồi')) return;
    try {
      await api.admin.revokeInvite(code);
      setAcc((cur) => ({ ...cur, invites: (cur.invites || []).filter((i) => i.code !== code) }));
      ui.success(`Đã thu hồi mã ${code}`);
    } catch (err) {
      ui.error(err.message);
    }
  };

  const now = Date.now();

  return (
    <>
      <section className="adm-section">
        <div className="adm-card">
          <div className="adm-section-head" style={{ marginTop: 0 }}>
            <h3><Icon name="lock" /> Chế độ Riêng tư &amp; Giới hạn</h3>
          </div>

          <div className="adm-toggle-row">
            <div>
              <b>Chế độ Chỉ người được mời (Invite-Only)</b>
              <small>Biến web thành ứng dụng riêng cho bạn &amp; nhóm bạn thân — người mới cần có Mã mời hoặc nằm trong Whitelist</small>
            </div>
            <button
              type="button"
              className="switch pressable"
              role="switch"
              aria-checked={acc.inviteOnly ? 'true' : 'false'}
              aria-label="Bật chế độ chỉ người được mời"
              onClick={() => setAcc((c) => ({ ...c, inviteOnly: !c.inviteOnly }))}
            />
          </div>

          <div className="adm-field" style={{ marginTop: 14 }}>
            <label htmlFor="adm-max-users">Giới hạn tổng số người dùng (0 = không giới hạn)</label>
            <div className="adm-inline-form">
              <input
                id="adm-max-users"
                className="adm-input"
                type="number"
                min="0"
                max="100000"
                value={acc.maxUsers}
                onChange={(e) => setAcc((c) => ({ ...c, maxUsers: e.target.value }))}
              />
              <Button variant="primary" loading={saving} onClick={() => saveAccess(acc)}>Lưu cài đặt</Button>
            </div>
          </div>
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-card">
          <div className="adm-section-head" style={{ marginTop: 0 }}>
            <h3><Icon name="people" /> Danh sách Đặc cách (Whitelist)</h3>
            <span className="adm-tag info">{acc.whitelist.length} mục</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600, marginBottom: 10 }}>
            Email hoặc UID trong danh sách này luôn được vào web ngay cả khi bật chế độ Riêng tư (không cần nhập mã mời).
          </p>
          <form className="adm-inline-form" onSubmit={addWhitelist}>
            <input
              className="adm-input"
              type="text"
              placeholder="Nhập email (vd: ban@gmail.com) hoặc UID…"
              value={wlInput}
              onChange={(e) => setWlInput(e.target.value)}
            />
            <Button type="submit" variant="secondary" icon="plus" disabled={!wlInput.trim()}>Thêm</Button>
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
            <div style={{ marginTop: 10, fontSize: 13, color: 'var(--faint)', fontWeight: 600 }}>Chưa có ai trong danh sách đặc cách.</div>
          )}
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-card">
          <div className="adm-section-head" style={{ marginTop: 0 }}>
            <h3><Icon name="key" /> Mã mời (Invite Codes)</h3>
            <span className="adm-tag info">{(acc.invites || []).length} mã</span>
          </div>

          <form className="adm-inline-form" onSubmit={createInvite}>
            <input
              className="adm-input"
              type="text"
              maxLength={60}
              placeholder="Nhãn gợi nhớ (vd: Nhóm lớp, Bạn thân…)"
              value={invLabel}
              onChange={(e) => setInvLabel(e.target.value)}
            />
            <input
              className="adm-input"
              style={{ maxWidth: 120 }}
              type="number"
              min="0"
              max="10000"
              title="Số lượt tối đa (0 = vô hạn)"
              placeholder="Lượt"
              value={invMaxUses}
              onChange={(e) => setInvMaxUses(e.target.value)}
            />
            <input
              className="adm-input"
              style={{ maxWidth: 120 }}
              type="number"
              min="0"
              max="365"
              title="Hạn dùng (ngày, 0 = vĩnh viễn)"
              placeholder="Ngày"
              value={invDays}
              onChange={(e) => setInvDays(e.target.value)}
            />
            <Button type="submit" variant="primary" icon="plus" loading={creating}>Tạo mã</Button>
          </form>

          {!(acc.invites || []).length ? (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--faint)', fontWeight: 600 }}>
              Chưa có mã mời nào. Bấm &ldquo;Tạo mã&rdquo; để cấp mã cho bạn bè.
            </div>
          ) : (
            acc.invites.map((inv) => {
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
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginTop: 3 }}>
                      Đã dùng: <b>{inv.uses}</b> / {inv.maxUses || '∞'} · Hạn: {fmtDate(inv.expiresAt)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="secondary" size="sm" icon="copy" onClick={() => copyCode(inv.code)}>Chép</Button>
                    <Button variant="destructive-tinted" size="sm" icon="trash" onClick={() => revokeInvite(inv.code)}>Xóa</Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </>
  );
}
