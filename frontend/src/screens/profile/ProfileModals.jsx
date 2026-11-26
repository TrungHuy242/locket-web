// Modals & sub-sheets for the redesigned Profile and Settings screens:
// - Scannable QR Code Card ("Hiện mã QR")
// - Widget Studio & Setup Guide ("Tiện ích" / "Cách thêm tiện ích")
// - Birthdate Editor ("Sửa ngày sinh")
// - Change / Reset Password ("Đổi mật khẩu")
// - Blocked Accounts Manager ("Tài khoản đã bị chặn")
// - Help / Parent / Safety / Terms Info Sheets
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Avatar } from '../../components/Avatar.jsx';
import { downloadBlob, thumb, vibrate } from '../../lib/format.js';
import { Icon } from '../../lib/icons.jsx';
import { isIOS, isIOSSafari, promptInstall, pwaStore } from '../../lib/pwa.js';
import { renderQrToCanvas } from '../../lib/qrCode.js';
import { setSetting, useSettings } from '../../lib/settings.js';
import { appStore, loadFriends, readFeedCache, useApp } from '../../store.js';
import { ui } from '../../ui/overlays.jsx';
import { copyInvite, inviteLink, shareInvite } from '../Friends.jsx';

export function ProfileQrSheet({ user, hasGold }) {
  const link = inviteLink();
  const qrDataUrl = useMemo(() => {
    try {
      return renderQrToCanvas(link, 340, { dark: '#111113', light: '#ffffff', quiet: 3 }).toDataURL('image/png');
    } catch {
      return '';
    }
  }, [link]);

  const saveCard = async () => {
    try {
      const cnv = document.createElement('canvas');
      cnv.width = 640;
      cnv.height = 800;
      const ctx = cnv.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 640, 800);
      g.addColorStop(0, '#1e1b14');
      g.addColorStop(1, '#0d0d10');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 640, 800);

      ctx.strokeStyle = '#ffc629';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.roundRect(24, 24, 592, 752, 44);
      ctx.stroke();

      const qrCnv = renderQrToCanvas(link, 400, { dark: '#111113', light: '#ffffff', quiet: 3 });
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(120, 140, 400, 400, 36);
      ctx.clip();
      ctx.drawImage(qrCnv, 120, 140);
      ctx.restore();

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 36px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(user?.name || 'Locket', 320, 615);
      ctx.fillStyle = '#ffc629';
      ctx.font = '800 24px system-ui, sans-serif';
      ctx.fillText(link.replace(/^https?:\/\//, ''), 320, 662);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText('Quét mã QR bằng Camera để kết bạn trên Locket', 320, 718);

      const blob = await new Promise((r) => cnv.toBlob(r, 'image/png'));
      if (blob) {
        downloadBlob(blob, `locket-qr-${user?.username || 'me'}.png`);
        ui.success('Đã lưu thẻ QR về thiết bị');
      }
    } catch {
      ui.error('Không xuất được ảnh QR');
    }
  };

  return (
    <div className="gold-sheet qr-sheet">
      <div className="qr-card">
        <div className="qr-user">
          <Avatar user={user} size={64} goldBadge={hasGold} />
          <b>{user?.name || 'Locket'}</b>
          <span>{link.replace(/^https?:\/\//, '')}</span>
        </div>
        <div className="qr-box">
          {qrDataUrl ? <img src={qrDataUrl} alt="Mã QR kết bạn Locket" /> : <span>Không tạo được mã QR</span>}
          <span className="qr-center-heart" aria-hidden="true">💛</span>
        </div>
        <p className="qr-hint">Đưa camera điện thoại của bạn bè quét mã này để kết bạn ngay lập tức</p>
      </div>
      <div className="gold-vip-actions">
        <button type="button" className="btn btn-dark" onClick={saveCard}>
          <Icon name="download" /> Lưu ảnh QR
        </button>
        <button type="button" className="btn btn-gold-cta" onClick={shareInvite}>
          <Icon name="share" /> Chia sẻ liên kết
        </button>
      </div>
    </div>
  );
}

export function openProfileQrSheet(user, hasGold) {
  ui.sheet(() => <ProfileQrSheet user={user} hasGold={hasGold} />);
}

export function WidgetGuideSheet({ user }) {
  const installed = pwaStore.use((s) => s.installed);
  const installEvent = pwaStore.use((s) => s.installEvent);
  const cached = readFeedCache(user?.uid);
  const latest = cached?.moments?.[0];

  const handleInstall = async () => {
    if (installEvent) {
      const r = await promptInstall();
      if (r === 'accepted') ui.success('Đang thêm Locket ra màn hình chính!');
    } else {
      copyInvite();
    }
  };

  return (
    <div className="gold-sheet widget-guide-sheet">
      <div className="gold-sheet-head">
        <h2>Tiện ích Màn hình chính</h2>
        <p>Đặt Locket ngay trên màn hình chính để mở toàn màn hình và xem ảnh mới nhất từ bạn bè</p>
      </div>

      <div className="widget-preview-mockup">
        <div className="widget-mock-tile">
          {latest?.image ? (
            <img src={thumb(latest.image, 360)} alt="" />
          ) : (
            <div className="widget-mock-placeholder">💛</div>
          )}
          <span className="widget-mock-label">{latest ? (latest.mine ? 'Bạn' : latest.user?.firstName || 'Bạn bè') : 'Locket'}</span>
        </div>
        <div className="widget-mock-caption">Xem trước tiện ích Locket của bạn</div>
      </div>

      <div className="install-steps" style={{ marginTop: 14 }}>
        <ol>
          {isIOS ? (
            <>
              <li><span className="n">1</span><span>Chạm nút <b>Chia sẻ</b> <Icon name="share" /> trên thanh trình duyệt {isIOSSafari ? 'Safari' : '(mở bằng Safari)'}.</span></li>
              <li><span className="n">2</span><span>Chọn <b>Thêm vào MH chính (Add to Home Screen)</b>.</span></li>
              <li><span className="n">3</span><span>Chọn biểu tượng tùy chỉnh yêu thích trong mục <b>Biểu tượng ứng dụng</b> rồi nhấn <b>Thêm</b>!</span></li>
            </>
          ) : (
            <>
              <li><span className="n">1</span><span>Nhấn nút <b>Cài đặt ứng dụng</b> bên dưới hoặc biểu tượng cài đặt trên thanh địa chỉ Chrome / Edge.</span></li>
              <li><span className="n">2</span><span>Ghim biểu tượng Locket ra màn hình chính / thanh tác vụ để mở nhanh 1 chạm.</span></li>
              <li><span className="n">3</span><span>Bật <b>Thông báo trình duyệt</b> trong Cài đặt để nhận báo ảnh mới tức thì.</span></li>
            </>
          )}
        </ol>
      </div>

      {!installed && installEvent ? (
        <button type="button" className="btn btn-gold-cta" style={{ marginTop: 14 }} onClick={handleInstall}>
          + Cài đặt tiện ích Locket ngay
        </button>
      ) : null}
    </div>
  );
}

export function openWidgetGuideSheet(user) {
  ui.sheet(() => <WidgetGuideSheet user={user} />, { full: true });
}

export function BirthdateSheet({ current, onClose }) {
  const [date, setDate] = useState(() => (current && /^\d{4}-\d{2}-\d{2}$/.test(current) ? current : '2003-01-01'));
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    if (!date || busy) return;
    setBusy(true);
    try {
      const updated = await api.updateBirthdate(date);
      appStore.set((s) => ({ user: { ...s.user, ...updated, birthdate: date } }));
      vibrate(12);
      ui.success('Đã cập nhật ngày sinh');
      onClose?.();
    } catch (err) {
      ui.error(err.message || 'Không cập nhật được ngày sinh');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gold-sheet">
      <div className="gold-sheet-head">
        <h2>Sửa ngày sinh</h2>
        <p>Ngày sinh của bạn được đồng bộ với hồ sơ Locket và dùng để tính cung hoàng đạo chú thích</p>
      </div>
      <form onSubmit={save} className="fb-form">
        <label className="fb-field">
          <span>Chọn ngày sinh</span>
          <input type="date" required value={date} max={new Date().toISOString().slice(0, 10)} min="1920-01-01" onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-gold-cta" disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu ngày sinh'}
        </button>
      </form>
    </div>
  );
}

export function openBirthdateSheet() {
  const current = appStore.get().user?.birthdate || '';
  const ctl = ui.sheet(() => <BirthdateSheet current={current} onClose={() => ctl.close()} />);
}

export function PasswordSheet({ email, onClose }) {
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  const submitChange = async (e) => {
    e.preventDefault();
    if (pwd.length < 6) { ui.warning('Mật khẩu mới cần ít nhất 6 ký tự'); return; }
    if (pwd !== pwd2) { ui.warning('Mật khẩu nhập lại chưa khớp'); return; }
    setBusy(true);
    try {
      await api.changePassword(pwd);
      vibrate(14);
      ui.success('Đã đổi mật khẩu tài khoản Locket thành công!');
      onClose?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async () => {
    setResetBusy(true);
    try {
      const res = await api.sendPasswordReset();
      ui.success(`Đã gửi liên kết đặt lại mật khẩu tới ${res.email || email || 'email của bạn'}`);
      onClose?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="gold-sheet">
      <div className="gold-sheet-head">
        <h2>Đổi mật khẩu</h2>
        <p>Đặt mật khẩu mới cho tài khoản Locket của bạn hoặc nhận liên kết đặt lại qua email</p>
      </div>
      <form onSubmit={submitChange} className="fb-form">
        <label className="fb-field">
          <span>Mật khẩu mới (tối thiểu 6 ký tự)</span>
          <input type="password" minLength={6} maxLength={128} placeholder="Nhập mật khẩu mới…" value={pwd} onChange={(e) => setPwd(e.target.value)} />
        </label>
        <label className="fb-field">
          <span>Nhập lại mật khẩu mới</span>
          <input type="password" minLength={6} maxLength={128} placeholder="Xác nhận mật khẩu mới…" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-gold-cta" disabled={busy || pwd.length < 6}>
          {busy ? 'Đang cập nhật…' : 'Cập nhật mật khẩu'}
        </button>
      </form>
      {email ? (
        <button type="button" className="btn btn-dark" style={{ width: '100%', marginTop: 10 }} disabled={resetBusy} onClick={sendReset}>
          {resetBusy ? 'Đang gửi email…' : `Gửi email đặt lại tới ${email}`}
        </button>
      ) : null}
    </div>
  );
}

export function openPasswordSheet(email) {
  const ctl = ui.sheet(() => <PasswordSheet email={email} onClose={() => ctl.close()} />);
}

export function BlockedAccountsSheet() {
  const blocked = useApp((s) => s.blocked);
  const friendsLoaded = useApp((s) => s.friendsLoaded);
  const [busyUid, setBusyUid] = useState('');

  useEffect(() => {
    if (!friendsLoaded) loadFriends();
  }, [friendsLoaded]);

  const handleUnblock = async (person) => {
    if (!await ui.confirm(`Bỏ chặn ${person.name}?`, 'Người này có thể tìm thấy bạn trên Locket trở lại.', 'Bỏ chặn')) return;
    setBusyUid(person.uid);
    try {
      await api.unblock(person.uid);
      await loadFriends();
      ui.success(`Đã bỏ chặn ${person.name}`);
    } catch (err) {
      ui.error(err.message || 'Không bỏ chặn được');
    } finally {
      setBusyUid('');
    }
  };

  return (
    <div className="gold-sheet blocked-sheet">
      <div className="gold-sheet-head">
        <h2>Tài khoản đã bị chặn</h2>
        <p>Những tài khoản bị chặn sẽ không thể gửi ảnh hoặc nhắn tin với bạn trên Locket</p>
      </div>
      {!friendsLoaded ? (
        <div className="empty" style={{ padding: '28px 0' }}><span className="spinner" /></div>
      ) : blocked.length === 0 ? (
        <div className="blocked-empty">
          <span>🛡️</span>
          <b>Chưa có tài khoản nào bị chặn</b>
          <small>Khi bạn chặn ai đó trong danh sách bạn bè, họ sẽ xuất hiện tại đây.</small>
        </div>
      ) : (
        <div className="blocked-list">
          {blocked.map((u) => (
            <div key={u.uid} className="person">
              <Avatar user={u} size={46} />
              <div className="who">
                {u.name}
                <small>{u.username ? `@${u.username}` : u.uid.slice(0, 12)}</small>
              </div>
              <button
                type="button"
                className="btn btn-dark btn-sm"
                disabled={busyUid === u.uid}
                onClick={() => handleUnblock(u)}
              >
                {busyUid === u.uid ? '…' : 'Bỏ chặn'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function openBlockedAccountsSheet() {
  ui.sheet(() => <BlockedAccountsSheet />, { full: true });
}

export function NotificationsPrefSheet() {
  const settings = useSettings();

  const togglePush = (val) => {
    setSetting('notifications', val);
    api.setNotifications(val).catch((err) => { setSetting('notifications', !val); ui.error(err.message); });
  };

  const toggleBrowser = async (val) => {
    if (val) {
      if (typeof Notification === 'undefined') { ui.warning('Trình duyệt này không hỗ trợ thông báo nền'); return; }
      if (Notification.permission === 'denied') { ui.warning('Bạn đã tắt quyền thông báo trong cài đặt trình duyệt'); return; }
      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') { ui.warning('Chưa cấp quyền thông báo'); return; }
      }
    }
    setSetting('browserAlerts', val);
  };

  return (
    <div className="gold-sheet">
      <div className="gold-sheet-head">
        <h2>Thông báo</h2>
        <p>Tùy chỉnh cách bạn nhận thông báo khoảnh khắc và tin nhắn mới từ bạn bè</p>
      </div>
      <div className="group" style={{ marginTop: 8 }}>
        <div className="cell">
          <span className="ic"><Icon name="bell" /></span>
          <span className="grow">Thông báo đẩy Locket<span className="sub">Đồng bộ trạng thái nhận thông báo với tài khoản Locket</span></span>
          <button type="button" className="switch gold-switch pressable" role="switch" aria-checked={settings.notifications ? 'true' : 'false'} onClick={() => togglePush(!settings.notifications)} />
        </div>
        <div className="cell">
          <span className="ic"><Icon name="megaphone" /></span>
          <span className="grow">Thông báo trên trình duyệt<span className="sub">Hiển thị thông báo khi tab Locket đang chạy nền</span></span>
          <button type="button" className="switch gold-switch pressable" role="switch" aria-checked={settings.browserAlerts ? 'true' : 'false'} onClick={() => toggleBrowser(!settings.browserAlerts)} />
        </div>
      </div>
    </div>
  );
}

export function openNotificationsPrefSheet() {
  ui.sheet(() => <NotificationsPrefSheet />);
}

const INFO_PAGES = {
  help: {
    title: 'Trung tâm trợ giúp',
    items: [
      ['Làm sao chụp ảnh & quay video?', 'Chạm nhẹ nút chụp tròn để chụp ảnh tức thì, hoặc nhấn giữ nút chụp để quay video tối đa 10 giây.'],
      ['Làm sao dùng Diện mạo & Photobooth?', 'Chạm biểu tượng khuôn mặt ở góc trái dưới khung ngắm để gắn sticker bám theo mặt, hoặc chuyển sang tab PHOTOBOOTH để chụp ghép 4 tấm!'],
      ['Cách mở khóa Locket Gold?', 'Nhấn vào thẻ Locket Gold trên trang Hồ sơ để gửi yêu cầu mở khóa trực tiếp cho Quản trị viên.'],
    ],
  },
  parents: {
    title: 'Trung tâm phụ huynh',
    items: [
      ['Không gian riêng tư cho bạn thân', 'Locket không có bảng tin công khai hay tìm kiếm ngẫu nhiên — người dùng chỉ thấy ảnh từ những người bạn đã kết nối hai chiều.'],
      ['Kiểm soát danh sách kết nối', 'Có thể hủy kết bạn hoặc chặn bất kỳ tài khoản nào ngay trong mục Bạn bè hoặc Riêng tư & bảo mật.'],
    ],
  },
  safety: {
    title: 'Trung tâm an toàn',
    items: [
      ['Chỉ kết bạn với người quen ngoài đời', 'Chỉ chia sẻ mã QR hoặc liên kết Locket của bạn cho bạn bè và người thân tin cậy.'],
      ['Báo cáo & chặn tài khoản', 'Nếu gặp hành vi làm phiền, hãy chặn tài khoản đó hoặc bấm "Báo cáo sự cố" để Quản trị viên hỗ trợ xử lý.'],
    ],
  },
  terms: {
    title: 'Điều khoản & Quyền riêng tư',
    items: [
      ['Bảo mật phiên đăng nhập', 'Token xác thực được giữ trong cookie HttpOnly phía máy chủ, tự động mã hóa AES khi sao lưu và không bao giờ lưu thô trên trình duyệt.'],
      ['Quyền sở hữu nội dung', 'Mọi khoảnh khắc ảnh, video và tin nhắn thuộc toàn quyền sở hữu của bạn trên tài khoản Locket cá nhân.'],
    ],
  },
};

export function openInfoSheet(kind) {
  const page = INFO_PAGES[kind] || INFO_PAGES.help;
  ui.sheet(() => (
    <div className="gold-sheet info-sheet">
      <div className="gold-sheet-head">
        <h2>{page.title}</h2>
      </div>
      <div className="info-cards">
        {page.items.map(([h, body]) => (
          <div key={h} className="info-card">
            <b>{h}</b>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </div>
  ));
}
