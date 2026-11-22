// Profile (slides in from the left like in Locket) and Settings.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from '../components/Avatar.jsx';
import { Icon } from '../lib/icons.jsx';
import { ago } from '../lib/format.js';
import { setSetting, useSettings } from '../lib/settings.js';
import { appStore, useApp } from '../store.js';
import { Navbar, nav } from '../ui/nav.jsx';
import { ui } from '../ui/overlays.jsx';
import { applyUpdate, checkForUpdate, isIOS, isIOSSafari, promptInstall, pwaStore } from '../lib/pwa.js';
import { copyInvite, inviteLink, openFriends, shareInvite } from './Friends.jsx';
import { openRecap } from './RecapModal.jsx';

export async function editName() {
  const user = appStore.get().user;
  const first = await ui.alert({
    title: 'Sửa tên', message: 'Tên của bạn', input: { value: user.firstName, placeholder: 'Tên', maxlength: 40 },
    buttons: [{ label: 'Hủy' }, { label: 'Tiếp', bold: true }],
  });
  if (first.index !== 1 || !first.text?.trim()) return;
  const last = await ui.alert({
    title: 'Sửa tên', message: 'Họ của bạn', input: { value: user.lastName, placeholder: 'Họ', maxlength: 40 },
    buttons: [{ label: 'Hủy' }, { label: 'Lưu', bold: true }],
  });
  if (last.index !== 1) return;
  try {
    const updated = await api.updateName(first.text.trim(), (last.text || '').trim());
    appStore.set((s) => ({ user: { ...s.user, ...updated } }));
    ui.success('Đã cập nhật tên');
  } catch (err) { ui.error(err.message); }
}

async function squareBlob(file, size = 640) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const side = Math.min(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    return await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  } finally {
    bitmap.close?.();
  }
}

export function Profile({ view }) {
  const user = useApp((s) => s.user);
  const friendCount = useApp((s) => s.friends.length);
  const fileRef = useRef(null);

  useEffect(() => {
    api.me().then((u) => appStore.set((s) => ({ user: { ...s.user, ...u } }))).catch(() => {});
  }, []);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      ui.info('Đang cập nhật ảnh đại diện…', 1500);
      const updated = await api.updateAvatar(await squareBlob(file));
      appStore.set((s) => ({ user: { ...s.user, ...updated } }));
      ui.success('Đã đổi ảnh đại diện');
    } catch (err) { ui.error(err.message || 'Không đổi được ảnh đại diện'); }
  };

  const pickAvatar = async () => {
    const choice = await ui.actionSheet({ actions: [{ label: 'Chọn ảnh từ thư viện', value: 'pick' }] });
    if (choice === 'pick') fileRef.current?.click();
  };

  return (
    <>
      <Navbar title="" back="right" onBack={() => nav.pop(view.id)}
        right={<button type="button" className="icon-btn pressable" aria-label="Cài đặt" onClick={() => nav.push('settings')}><Icon name="gear" /></button>} />
      <div className="view-scroll">
        <div className="profile-head">
          <button type="button" className="avatar-btn pressable" aria-label="Đổi ảnh đại diện" onClick={pickAvatar}>
            <Avatar user={user} /><span className="edit"><Icon name="camera" /></span>
          </button>
          <h1>{user.name}</h1>
          <div className="handle">{user.username ? `@${user.username}` : ''}</div>
          <button type="button" className="btn btn-dark btn-sm" onClick={editName}>Sửa thông tin</button>
        </div>

        <div className="invite">
          <Avatar user={user} />
          <div className="grow"><b>Mời bạn bè tham gia Locket</b><small>{inviteLink().replace('https://', '')}</small></div>
          <button type="button" className="icon-btn pressable" aria-label="Chia sẻ liên kết" onClick={shareInvite}><Icon name="share" /></button>
        </div>

        <button type="button" className="mem-entry" onClick={() => nav.push('memories')}>
          <span className="ic"><Icon name="heart" /></span>
          <span className="grow"><b>Kỷ niệm</b><small>Xem lại mọi khoảnh khắc theo ngày, tháng, năm</small></span>
          <span className="chev"><Icon name="chevRight" /></span>
        </button>

        <button type="button" className="mem-entry recap-entry" onClick={openRecap}>
          <span className="ic"><Icon name="chart" /></span>
          <span className="grow"><b>Thống kê & Recap</b><small>Chuỗi ngày đăng, biểu đồ tháng và top bạn thân</small></span>
          <span className="chev"><Icon name="chevRight" /></span>
        </button>

        <div className="section-label"><Icon name="people" /> Bạn bè</div>
        <div className="group">
          <button type="button" className="cell" onClick={openFriends}><span className="ic"><Icon name="user" /></span><span className="grow">Bạn bè của bạn</span><span className="val">{friendCount}</span><span className="chev"><Icon name="chevRight" /></span></button>
          <button type="button" className="cell" onClick={copyInvite}><span className="ic"><Icon name="link" /></span><span className="grow">Sao chép liên kết Locket</span><span className="chev"><Icon name="chevRight" /></span></button>
        </div>

        <div className="section-label"><Icon name="gear" /> Tổng quát</div>
        <div className="group">
          <button type="button" className="cell" onClick={editName}><span className="ic"><Icon name="pencil" /></span><span className="grow">Sửa tên</span><span className="chev"><Icon name="chevRight" /></span></button>
          <button type="button" className="cell" onClick={() => nav.push('settings')}><span className="ic"><Icon name="gear" /></span><span className="grow">Cài đặt</span><span className="chev"><Icon name="chevRight" /></span></button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      </div>
    </>
  );
}

function Toggle({ k, title, sub, icon, onChange }) {
  const settings = useSettings();
  return (
    <div className="cell">
      <span className="ic"><Icon name={icon} /></span>
      <span className="grow">{title}<span className="sub">{sub}</span></span>
      <button type="button" className="switch pressable" role="switch" aria-checked={settings[k] ? 'true' : 'false'} aria-label={title}
        onClick={() => onChange(k, !settings[k])} />
    </div>
  );
}

// Light / Dark / follow the system. The camera and feed stay dark either way, like the Locket app.
function Appearance() {
  const theme = useSettings().theme || 'system';
  const options = [['system', 'Tự động'], ['light', 'Sáng'], ['dark', 'Tối']];
  return (
    <>
      <div className="section-label"><Icon name="sun" /> Giao diện</div>
      <div className="group">
        <div className="cell" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div className="segmented" role="radiogroup" aria-label="Giao diện">
            {options.map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={theme === value} className={theme === value ? 'on' : ''}
                onClick={() => setSetting('theme', value)}>{label}</button>
            ))}
          </div>
          <span className="sub" style={{ marginTop: 0 }}>Camera và bảng tin luôn dùng nền tối như ứng dụng Locket.</span>
        </div>
      </div>
    </>
  );
}

function InstallSteps() {
  return (
    <div className="install-steps">
      <div className="sheet-title">Thêm Locket vào màn hình chính</div>
      <ol>
        <li><span className="n">1</span><span>Chạm nút <span className="glyph"><Icon name="share" /></span> Chia sẻ trên thanh Safari.</span></li>
        <li><span className="n">2</span><span>Chọn <b>Thêm vào MH chính</b> <span className="glyph"><Icon name="plus" /></span> (có thể phải kéo danh sách xuống).</span></li>
        <li><span className="n">3</span><span>Chạm <b>Thêm</b>. Mở Locket từ biểu tượng mới để dùng toàn màn hình như ứng dụng.</span></li>
      </ol>
      <p>Trên iPhone, chỉ có thể thêm vào màn hình chính từ menu Chia sẻ; trang web không tự hiện nút cài đặt được.</p>
    </div>
  );
}

function AppSection() {
  const installed = pwaStore.use((s) => s.installed);
  const installEvent = pwaStore.use((s) => s.installEvent);
  const version = pwaStore.use((s) => s.version);
  const updateReady = pwaStore.use((s) => s.updateReady);
  const supported = pwaStore.use((s) => s.supported);
  const [checking, setChecking] = useState(false);

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') ui.info('Đang cài đặt Locket');
  };
  const check = async () => {
    setChecking(true);
    try {
      const r = await checkForUpdate();
      if (r === 'latest') ui.success('Bạn đang dùng phiên bản mới nhất');
      if (r === 'unsupported') ui.warning('Trình duyệt này chưa bật cập nhật ngoại tuyến');
    } catch { ui.error('Không kiểm tra được bản cập nhật'); } finally { setChecking(false); }
  };

  let installCell;
  if (installed) {
    installCell = <div className="cell"><span className="ic"><Icon name="check" /></span><span className="grow">Đã cài đặt<span className="sub">Đang chạy như ứng dụng</span></span></div>;
  } else if (installEvent) {
    installCell = <button type="button" className="cell" onClick={install}><span className="ic"><Icon name="download" /></span><span className="grow">Cài đặt Locket<span className="sub">Mở toàn màn hình, có biểu tượng riêng</span></span><span className="chev"><Icon name="chevRight" /></span></button>;
  } else if (isIOS) {
    installCell = (
      <button type="button" className="cell" onClick={() => ui.sheet(() => <InstallSteps />)}>
        <span className="ic"><Icon name="plus" /></span>
        <span className="grow">Thêm vào màn hình chính<span className="sub">{isIOSSafari ? 'Dùng nút Chia sẻ của Safari' : 'Mở trang này bằng Safari để thêm'}</span></span>
        <span className="chev"><Icon name="chevRight" /></span>
      </button>
    );
  } else {
    installCell = <div className="cell"><span className="ic"><Icon name="download" /></span><span className="grow">Cài đặt ứng dụng<span className="sub">Dùng nút cài đặt trên thanh địa chỉ hoặc menu trình duyệt (Chrome, Edge, Safari trên Mac)</span></span></div>;
  }

  return (
    <>
      <div className="section-label"><Icon name="download" /> Ứng dụng</div>
      <div className="group">
        {installCell}
        <button type="button" className="cell" onClick={updateReady ? applyUpdate : check} disabled={checking || !supported}>
          <span className="ic"><Icon name="arrowDown" /></span>
          <span className="grow">{updateReady ? 'Cập nhật ngay' : 'Kiểm tra cập nhật'}<span className="sub">{version ? `Phiên bản ${version}` : supported ? 'Đang bật bộ nhớ đệm ngoại tuyến…' : 'Trình duyệt không hỗ trợ'}</span></span>
          {checking ? <span className="spinner" /> : null}
        </button>
      </div>
    </>
  );
}

function fmtMB(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb < 0.1 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${mb.toFixed(1)} MB`;
}

function SyncSection() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => { api.syncStatus().then(setSt).catch(() => {}); };
  useEffect(() => { load(); }, []);

  const syncNow = async () => {
    setBusy(true);
    try {
      const res = await api.syncNow();
      setSt(res.status);
      ui.success(res.synced ? 'Đã đồng bộ dữ liệu lên đám mây' : 'Dữ liệu đã ở bản mới nhất');
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const stateText = !st ? 'Đang kiểm tra…'
    : st.enabled
      ? `${st.encrypted ? 'Đang bật · Mã hóa AES' : 'Đang bật'}${st.syncedFiles ? ` · ${st.syncedFiles} tệp` : ''}`
      : 'Chỉ lưu cục bộ (chưa cấu hình HF Dataset)';

  const lastText = st?.lastSyncAt ? `Sao lưu ${ago(st.lastSyncAt)}`
    : st?.lastRestoreAt ? `Khôi phục ${ago(st.lastRestoreAt)}`
      : st?.enabled ? 'Chưa có thay đổi mới' : '';

  return (
    <>
      <div className="section-label"><Icon name="cloud" /> Sao lưu & Bộ nhớ</div>
      <div className="group">
        <div className="cell">
          <span className="ic"><Icon name="cloud" /></span>
          <span className="grow">
            Sao lưu đám mây
            <span className="sub">{stateText}{lastText ? ` · ${lastText}` : ''}{st?.lastError ? ` · Lỗi: ${st.lastError}` : ''}</span>
          </span>
        </div>
        {st?.enabled ? (
          <button type="button" className="cell" onClick={syncNow} disabled={busy}>
            <span className="ic"><Icon name="refresh" /></span>
            <span className="grow">Đồng bộ ngay<span className="sub">{st.dirty ? 'Có thay đổi chờ sao lưu' : 'Đẩy bản chụp mới nhất lên HF Dataset'}</span></span>
            {busy ? <span className="spinner" /> : <span className="chev"><Icon name="chevRight" /></span>}
          </button>
        ) : null}
        {st ? (
          <div className="cell">
            <span className="ic"><Icon name="grid" /></span>
            <span className="grow">Bộ nhớ đệm máy chủ<span className="sub">Ảnh thu nhỏ {fmtMB(st.thumbCacheBytes)} · Video {fmtMB(st.videoCacheBytes)}</span></span>
            <span className="val">{fmtMB(st.cacheBytes)}</span>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function Settings({ view, onSignOut }) {
  const user = useApp((s) => s.user);

  const change = async (key, value) => {
    if (key === 'recordAudio' && value) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getTracks().forEach((t) => t.stop());
      } catch {
        ui.warning('Trình duyệt chưa cho phép dùng micro');
        return;
      }
    }
    if (key === 'browserAlerts' && value) {
      if (typeof Notification === 'undefined') {
        ui.warning('Trình duyệt này không hỗ trợ thông báo nền');
        return;
      }
      if (Notification.permission === 'denied') {
        ui.warning('Bạn đã chặn quyền thông báo trong cài đặt trình duyệt');
        return;
      }
      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          ui.warning('Chưa được cấp quyền thông báo');
          return;
        }
      }
    }
    setSetting(key, value);
    if (key === 'notifications') {
      api.setNotifications(value).catch((err) => { setSetting(key, !value); ui.error(err.message); });
    }
  };

  const logout = async () => {
    if (!await ui.confirm('Đăng xuất khỏi Locket?', 'Phiên đăng nhập trên máy chủ sẽ bị xóa.', 'Đăng xuất')) return;
    try { await api.logout(); } catch { /* the session is dropped locally either way */ }
    onSignOut();
  };

  return (
    <>
      <Navbar title="Cài đặt" onBack={() => nav.pop(view.id)} />
      <div className="view-scroll">
        <div className="section-label"><Icon name="user" /> Tài khoản</div>
        <div className="group">
          <button type="button" className="cell" onClick={editName}><span className="ic"><Icon name="pencil" /></span><span className="grow">Tên</span><span className="val">{user.name}</span><span className="chev"><Icon name="chevRight" /></span></button>
          <div className="cell"><span className="ic"><Icon name="mail" /></span><span className="grow">Email</span><span className="val">{user.email || '—'}</span></div>
          <div className="cell"><span className="ic"><Icon name="link" /></span><span className="grow">Tên người dùng</span><span className="val">{user.username ? `@${user.username}` : '—'}</span></div>
        </div>

        <Appearance />

        <div className="section-label"><Icon name="camera" /> Camera</div>
        <div className="group">
          <Toggle k="mirrorFront" title="Lật ảnh camera trước" sub="Lưu ảnh selfie giống như bạn thấy trong khung ngắm" icon="camera" onChange={change} />
          <Toggle k="recordAudio" title="Ghi âm khi quay video" sub="Cần quyền micro của trình duyệt" icon="sound" onChange={change} />
          <Toggle k="saveAfterSend" title="Lưu vào máy sau khi gửi" sub="Tự tải ảnh/video về thiết bị" icon="download" onChange={change} />
        </div>

        <div className="section-label"><Icon name="eyeOff" /> Quyền riêng tư</div>
        <div className="group">
          <Toggle k="ghostRead" title="Ẩn trạng thái đã xem" sub="Đọc tin nhắn mà không gửi thông báo đã xem" icon="eyeOff" onChange={change} />
          <Toggle k="notifications" title="Thông báo đẩy" sub="Đồng bộ tùy chọn thông báo với tài khoản Locket" icon="bell" onChange={change} />
          <Toggle k="browserAlerts" title="Thông báo trên trình duyệt" sub="Báo tin nhắn & tương tác mới khi tab chạy nền" icon="bell" onChange={change} />
        </div>

        <SyncSection />

        <AppSection />

        <div className="section-label"><Icon name="info" /> Giới thiệu</div>
        <div className="group">
          <div className="cell"><span className="ic"><Icon name="info" /></span><span className="grow">Kết nối</span><span className="mode-chip">Locket</span></div>
          <div className="cell"><span className="ic"><Icon name="link" /></span><span className="grow">Nền tảng API<span className="sub">locketlam SDK 1.0.2 (không chính thức)</span></span></div>
        </div>

        <div className="section-label" style={{ color: 'var(--danger)' }}>Vùng nguy hiểm</div>
        <div className="group">
          <button type="button" className="cell danger" onClick={logout}><span className="ic"><Icon name="logout" /></span><span className="grow">Đăng xuất</span></button>
        </div>
        <p className="footnote">Đây là ứng dụng web không chính thức, không liên kết với Locket Labs.<br />Token đăng nhập chỉ nằm trên máy chủ của bạn.</p>
      </div>
    </>
  );
}
