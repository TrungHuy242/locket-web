// Redesigned Profile & Native Settings screens matching iOS Locket (Gold stamp, 4 circular actions,
// scannable QR code, Locket Gold perks, Widgets card, App Icon & Camera Theme pickers, and full Settings).
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from '../components/Avatar.jsx';
import { getAppIconDataUrl, getAppIconSpec } from '../lib/appIcons.js';
import { getCameraTheme } from '../lib/cameraThemes.js';
import { ago, thumb, vibrate } from '../lib/format.js';
import { Icon } from '../lib/icons.jsx';
import { applyUpdate, checkForUpdate, isIOS, isIOSSafari, promptInstall, pwaStore } from '../lib/pwa.js';
import { setSetting, useSettings } from '../lib/settings.js';
import { useSiteConfig } from '../lib/siteConfig.js';
import { appStore, readFeedCache, useApp } from '../store.js';
import { Navbar, nav } from '../ui/nav.jsx';
import { ui } from '../ui/overlays.jsx';
import { copyInvite, inviteLink, openFriends, shareInvite } from './Friends.jsx';
import { openRecap } from './RecapModal.jsx';
import {
  openAppIconSheet,
  openCameraThemeSheet,
  openFeedbackSheet,
  openLocketGoldSheet,
  useHasGold,
} from './profile/GoldSheets.jsx';
import {
  openBirthdateSheet,
  openBlockedAccountsSheet,
  openInfoSheet,
  openNotificationsPrefSheet,
  openPasswordSheet,
  openProfileQrSheet,
  openWidgetGuideSheet,
} from './profile/ProfileModals.jsx';

export async function editName() {
  const user = appStore.get().user;
  if (!user) return;
  const first = await ui.alert({
    title: 'Sửa tên',
    message: 'Tên của bạn',
    input: { value: user.firstName, placeholder: 'Tên', maxlength: 40 },
    buttons: [{ label: 'Hủy' }, { label: 'Tiếp', bold: true }],
  });
  if (first.index !== 1 || !first.text?.trim()) return;
  const last = await ui.alert({
    title: 'Sửa tên',
    message: 'Họ của bạn',
    input: { value: user.lastName, placeholder: 'Họ', maxlength: 40 },
    buttons: [{ label: 'Hủy' }, { label: 'Lưu', bold: true }],
  });
  if (last.index !== 1) return;
  try {
    const updated = await api.updateName(first.text.trim(), (last.text || '').trim());
    appStore.set((s) => ({ user: { ...s.user, ...updated } }));
    ui.success('Đã cập nhật tên');
  } catch (err) {
    ui.error(err.message);
  }
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

function GoldCircularStamp({ since }) {
  const label = `LOCKET GOLD • SINCE ${since || new Date().getFullYear()} • `;
  return (
    <div className="gold-stamp" aria-label={`Locket Gold Since ${since}`}>
      <svg viewBox="0 0 100 100" className="gold-stamp-svg">
        <defs>
          <path id="goldStampCircle" d="M 50, 50 m -36, 0 a 36,36 0 1,1 72,0 a 36,36 0 1,1 -72,0" />
        </defs>
        <text fill="currentColor" fontSize="9.6" fontWeight="900" letterSpacing="1.5">
          <textPath href="#goldStampCircle">{label.repeat(2)}</textPath>
        </text>
      </svg>
      <span className="gold-stamp-core">💛</span>
    </div>
  );
}

export function Profile({ view }) {
  const user = useApp((s) => s.user);
  const isAdmin = useApp((s) => s.isAdmin);
  const friendCount = useApp((s) => s.friends.length);
  const settings = useSettings();
  const hasGold = useHasGold();
  const showGoldBadge = hasGold && settings.goldBadge !== false;
  const activeIcon = getAppIconSpec(hasGold ? settings.appIcon : 'classic');
  const activeCamTheme = getCameraTheme(settings.cameraTheme, hasGold);
  const fileRef = useRef(null);

  useEffect(() => {
    api.me().then((u) => appStore.set((s) => (s.user ? { user: { ...s.user, ...u } } : {}))).catch(() => {});
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
    } catch (err) {
      ui.error(err.message || 'Không đổi được ảnh đại diện');
    }
  };

  const pickAvatar = async () => {
    const choice = await ui.actionSheet({ actions: [{ label: 'Chọn ảnh từ thư viện', value: 'pick' }] });
    if (choice === 'pick') fileRef.current?.click();
  };

  const toggleGoldBadge = () => {
    if (!hasGold) {
      openLocketGoldSheet('Huy hiệu trái tim vàng trên ảnh đại diện là đặc quyền của Locket Gold VIP.');
      return;
    }
    vibrate(10);
    setSetting('goldBadge', !(settings.goldBadge !== false));
  };

  const cachedFeed = readFeedCache(user?.uid);
  const latestThumb = cachedFeed?.moments?.[0]?.image ? thumb(cachedFeed.moments[0].image, 128) : '';
  const cleanLink = inviteLink().replace(/^https?:\/\//, '');

  return (
    <>
      <Navbar
        title=""
        back="left"
        onBack={() => nav.pop(view.id)}
        right={(
          <div className="nav-actions">
            <button type="button" className="icon-btn pressable" aria-label="Bạn bè" onClick={openFriends}>
              <Icon name="people" />
            </button>
            <button type="button" className="icon-btn pressable" aria-label="Cài đặt" onClick={() => nav.push('settings')}>
              <Icon name="gear" />
            </button>
          </div>
        )}
      />
      <div className="view-scroll profile-v2-scroll">
        <div className="profile-head profile-head-v2">
          {hasGold ? <GoldCircularStamp since={user?.gold?.since} /> : null}
          <button type="button" className={`avatar-btn pressable ${hasGold ? 'is-gold' : ''}`} aria-label="Đổi ảnh đại diện" onClick={pickAvatar}>
            <Avatar user={user} goldBadge={showGoldBadge} />
            <span className="edit"><Icon name="pencil" /></span>
          </button>
          <h1>{user?.name || ''}</h1>
          <button type="button" className="profile-link-pill pressable" onClick={copyInvite}>
            <span>{cleanLink}</span>
            <Icon name="link" />
          </button>

          {/* 4 Circular Native Profile Action Buttons */}
          <div className="profile-quick-circles">
            <button type="button" className="pq-item pressable" onClick={openFriends}>
              <span className="pq-circle"><Icon name="people" /></span>
              <span className="pq-label">{friendCount} người bạn</span>
            </button>
            <button type="button" className="pq-item pressable" onClick={() => openProfileQrSheet(user, showGoldBadge)}>
              <span className="pq-circle"><Icon name="qr" /></span>
              <span className="pq-label">Hiện mã QR</span>
            </button>
            <button type="button" className="pq-item pressable" onClick={copyInvite}>
              <span className="pq-circle"><Icon name="copy" /></span>
              <span className="pq-label">Sao chép liên kết</span>
            </button>
            <button type="button" className="pq-item pressable" onClick={shareInvite}>
              <span className="pq-circle"><Icon name="share" /></span>
              <span className="pq-label">Chia sẻ liên kết</span>
            </button>
          </div>
        </div>

        {/* Locket Gold Banner Card */}
        <button type="button" className={`locket-gold-banner pressable ${hasGold ? 'active' : ''}`} onClick={() => openLocketGoldSheet()}>
          <span className="lgb-emblem">💛</span>
          <span className="lgb-body">
            <b>{hasGold ? 'Locket Gold' : 'Nâng cấp Locket Gold'}</b>
            <small>{hasGold ? 'Đã mở khóa toàn bộ đặc quyền VIP của bạn' : 'Huy hiệu vàng, 32 biểu tượng & chủ đề máy ảnh'}</small>
          </span>
          <span className="lgb-chev"><Icon name="chevRight" /></span>
        </button>

        {/* Stealth Owner Admin Entry — strictly invisible to non-admins */}
        {isAdmin ? (
          <button type="button" className="mem-entry admin-entry" onClick={() => nav.push('admin')}>
            <span className="ic"><Icon name="shield" /></span>
            <span className="grow"><b>Bảng điều khiển Quản trị</b><small>Cấp quyền Gold VIP, hộp thư góp ý, thống kê &amp; hệ thống</small></span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
        ) : null}

        {/* Widgets ("Tiện ích") Card */}
        <div className="section-label widget-sec-head">
          <span><Icon name="widget" /> Tiện ích</span>
          <span className="new-pill">Mới +</span>
        </div>
        <div className="widgets-showcase">
          <button type="button" className="widget-create-tile pressable" onClick={() => openWidgetGuideSheet(user)}>
            {latestThumb ? <img src={latestThumb} alt="" className="wct-bg" /> : null}
            <span className="wct-plus">+</span>
            <b>Tạo</b>
          </button>
          <button type="button" className="widget-info-tile pressable" onClick={() => nav.push('memories')}>
            <span className="wit-ic"><Icon name="calendar" /></span>
            <b>Kỷ niệm</b>
            <small>Lịch tháng &amp; kho lưu trữ</small>
          </button>
          <button type="button" className="widget-info-tile pressable" onClick={openRecap}>
            <span className="wit-ic"><Icon name="chart" /></span>
            <b>Recap</b>
            <small>Chuỗi ngày &amp; bạn thân</small>
          </button>
        </div>

        {/* Locket Gold Customization Group */}
        <div className="section-label"><Icon name="crown" /> Locket Gold</div>
        <div className="group">
          <button type="button" className="cell" onClick={openAppIconSheet}>
            <span className="ic"><Icon name="appIcon" /></span>
            <span className="grow">Đổi biểu tượng ứng dụng</span>
            <img className="cell-mini-appicon" src={getAppIconDataUrl(activeIcon.id, 64)} alt="" />
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={openCameraThemeSheet}>
            <span className="ic"><Icon name="palette" /></span>
            <span className="grow">Chủ đề máy ảnh</span>
            <span className="val">{activeCamTheme.name}</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <div className="cell">
            <span className="ic"><Icon name="heart" /></span>
            <span className="grow">
              Huy hiệu Locket Gold
              {!hasGold ? <span className="sub">Cần tài khoản Locket Gold VIP</span> : null}
            </span>
            <button
              type="button"
              className="switch gold-switch pressable"
              role="switch"
              aria-checked={showGoldBadge ? 'true' : 'false'}
              aria-label="Huy hiệu Locket Gold"
              onClick={toggleGoldBadge}
            />
          </div>
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
      <span className="grow">{title}{sub ? <span className="sub">{sub}</span> : null}</span>
      <button type="button" className="switch gold-switch pressable" role="switch" aria-checked={settings[k] ? 'true' : 'false'} aria-label={title}
        onClick={() => onChange(k, !settings[k])} />
    </div>
  );
}

function Appearance() {
  const theme = useSettings().theme || 'system';
  const options = [['system', 'Tự động'], ['light', 'Sáng'], ['dark', 'Tối']];
  return (
    <div className="cell" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="ic"><Icon name="sun" /></span>
        <span className="grow">Chế độ Sáng / Tối</span>
      </div>
      <div className="segmented" role="radiogroup" aria-label="Giao diện">
        {options.map(([value, label]) => (
          <button key={value} type="button" role="radio" aria-checked={theme === value} className={theme === value ? 'on' : ''}
            onClick={() => setSetting('theme', value)}>{label}</button>
        ))}
      </div>
    </div>
  );
}

function fmtMB(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb < 0.1 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${mb.toFixed(1)} MB`;
}

function PrivacyDataSheet() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const installed = pwaStore.use((s) => s.installed);
  const installEvent = pwaStore.use((s) => s.installEvent);
  const version = pwaStore.use((s) => s.version);
  const updateReady = pwaStore.use((s) => s.updateReady);
  const supported = pwaStore.use((s) => s.supported);
  const [checking, setChecking] = useState(false);

  useEffect(() => { api.syncStatus().then(setSt).catch(() => {}); }, []);

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

  const checkUpd = async () => {
    setChecking(true);
    try {
      const r = await checkForUpdate();
      if (r === 'latest') ui.success('Bạn đang dùng phiên bản mới nhất');
      if (r === 'unsupported') ui.warning('Trình duyệt này chưa bật cập nhật ngoại tuyến');
    } catch { ui.error('Không kiểm tra được bản cập nhật'); } finally { setChecking(false); }
  };

  return (
    <div className="gold-sheet">
      <div className="gold-sheet-head">
        <h2>Quyền riêng tư và dữ liệu</h2>
        <p>Quản lý sao lưu mã hóa đám mây, bộ nhớ đệm và phiên bản ứng dụng PWA</p>
      </div>
      <div className="group">
        <div className="cell">
          <span className="ic"><Icon name="cloud" /></span>
          <span className="grow">
            Sao lưu đám mây
            <span className="sub">
              {!st ? 'Đang kiểm tra…' : st.enabled ? `${st.encrypted ? 'Đang bật · Mã hóa AES' : 'Đang bật'}${st.lastSyncAt ? ` · Sao lưu ${ago(st.lastSyncAt)}` : ''}` : 'Lưu cục bộ trên máy chủ'}
            </span>
          </span>
        </div>
        {st?.enabled ? (
          <button type="button" className="cell" onClick={syncNow} disabled={busy}>
            <span className="ic"><Icon name="refresh" /></span>
            <span className="grow">Đồng bộ ngay</span>
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
        {!installed && installEvent ? (
          <button type="button" className="cell" onClick={() => promptInstall()}>
            <span className="ic"><Icon name="download" /></span>
            <span className="grow">Cài đặt ứng dụng Locket</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
        ) : null}
        <button type="button" className="cell" onClick={updateReady ? applyUpdate : checkUpd} disabled={checking || !supported}>
          <span className="ic"><Icon name="arrowDown" /></span>
          <span className="grow">{updateReady ? 'Cập nhật ngay' : 'Kiểm tra bản cập nhật'}<span className="sub">{version ? `Phiên bản ${version}` : isIOS && !isIOSSafari ? 'Mở bằng Safari để cài PWA' : 'Ứng dụng Web'}</span></span>
          {checking ? <span className="spinner" /> : <span className="chev"><Icon name="chevRight" /></span>}
        </button>
      </div>
    </div>
  );
}

export function Settings({ view, onSignOut }) {
  const user = useApp((s) => s.user);
  const blockedCount = useApp((s) => s.blocked.length);
  const settings = useSettings();
  const footerCredit = useSiteConfig((s) => s.footerCredit);
  const avatarInputRef = useRef(null);
  const [restoring, setRestoring] = useState(false);

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
    setSetting(key, value);
  };

  const onAvatarFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      ui.info('Đang cập nhật ảnh đại diện…', 1500);
      const updated = await api.updateAvatar(await squareBlob(file));
      appStore.set((s) => ({ user: { ...s.user, ...updated } }));
      ui.success('Đã đổi ảnh đại diện');
    } catch (err) {
      ui.error(err.message || 'Không đổi được ảnh đại diện');
    }
  };

  const restorePurchases = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const fresh = await api.me();
      appStore.set((s) => (s.user ? { user: { ...s.user, ...fresh } } : {}));
      if (fresh?.gold?.active) {
        ui.success('👑 Đã khôi phục & đồng bộ đặc quyền Locket Gold VIP!');
      } else {
        ui.info('Tài khoản hiện ở gói tiêu chuẩn. Bạn có thể gửi yêu cầu cấp Gold cho Quản trị viên.');
      }
    } catch (err) {
      ui.error(err.message);
    } finally {
      setRestoring(false);
    }
  };

  const showPhoneInfo = () => {
    ui.alert({
      title: 'Số điện thoại',
      message: user?.phone
        ? `Số điện thoại đang liên kết: ${user.phone}`
        : 'Tài khoản này đăng nhập qua Email. Để đổi số điện thoại SMS, hãy thực hiện trên ứng dụng Locket di động.',
      buttons: [{ label: 'Đã hiểu', bold: true }],
    });
  };

  const showEmailInfo = () => {
    ui.alert({
      title: 'Địa chỉ Email',
      message: user?.email
        ? `Email đăng nhập hiện tại: ${user.email}`
        : 'Chưa có địa chỉ email gắn với hồ sơ này.',
      buttons: [{ label: 'Đóng', bold: true }],
    });
  };

  const logout = async () => {
    if (!await ui.confirm('Đăng xuất khỏi Locket?', 'Phiên đăng nhập trên máy chủ sẽ bị xóa.', 'Đăng xuất')) return;
    try { await api.logout(); } catch { /* dropped locally either way */ }
    onSignOut();
  };

  const readReceiptsOn = !settings.ghostRead;

  return (
    <>
      <Navbar title="Cài đặt" onBack={() => nav.pop(view.id)} />
      <div className="view-scroll settings-v2-scroll">
        {/* 1. Thiết lập tiện ích */}
        <div className="section-label"><Icon name="widget" /> Thiết lập tiện ích</div>
        <div className="group">
          <button type="button" className="cell" onClick={() => openWidgetGuideSheet(user)}>
            <span className="ic"><Icon name="plus" /></span>
            <span className="grow">Cách thêm tiện ích</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
        </div>

        {/* 2. Tổng quát */}
        <div className="section-label"><Icon name="user" /> Tổng quát</div>
        <div className="group">
          <button type="button" className="cell" onClick={openNotificationsPrefSheet}>
            <span className="ic"><Icon name="bell" /></span>
            <span className="grow">Thông báo</span>
            <span className="val">{settings.notifications ? 'Đang bật' : 'Tắt'}</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={openBirthdateSheet}>
            <span className="ic"><Icon name="cake" /></span>
            <span className="grow">Sửa ngày sinh</span>
            <span className="val">{user?.birthdate || 'Thêm'}</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={editName}>
            <span className="ic"><Icon name="pencil" /></span>
            <span className="grow">Sửa tên</span>
            <span className="val">{user?.name || '—'}</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={() => avatarInputRef.current?.click()}>
            <span className="ic"><Icon name="camera" /></span>
            <span className="grow">Chỉnh sửa ảnh đại diện</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={showPhoneInfo}>
            <span className="ic"><Icon name="phone" /></span>
            <span className="grow">Số điện thoại</span>
            <span className="val">{user?.phone || 'Xem'}</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={showEmailInfo}>
            <span className="ic"><Icon name="mail" /></span>
            <span className="grow">{user?.email ? 'Địa chỉ email' : 'Thêm địa chỉ email'}</span>
            <span className="val">{user?.email || '—'}</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={() => openPasswordSheet(user?.email)}>
            <span className="ic"><Icon name="lock" /></span>
            <span className="grow">Đổi mật khẩu</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
        </div>

        {/* 3. Hỗ trợ */}
        <div className="section-label"><Icon name="help" /> Hỗ trợ</div>
        <div className="group">
          <button type="button" className="cell" onClick={() => openInfoSheet('help')}>
            <span className="ic"><Icon name="help" /></span>
            <span className="grow">Trung tâm trợ giúp</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={() => openInfoSheet('parents')}>
            <span className="ic"><Icon name="people" /></span>
            <span className="grow">Trung tâm phụ huynh</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={() => openInfoSheet('safety')}>
            <span className="ic"><Icon name="shield" /></span>
            <span className="grow">Trung tâm an toàn</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={() => openFeedbackSheet('bug')}>
            <span className="ic"><Icon name="bug" /></span>
            <span className="grow">Báo cáo sự cố</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={() => openFeedbackSheet('suggestion')}>
            <span className="ic"><Icon name="sparkles" /></span>
            <span className="grow">Gửi đề xuất</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={restorePurchases} disabled={restoring}>
            <span className="ic"><Icon name="refresh" /></span>
            <span className="grow">Khôi phục đơn hàng</span>
            {restoring ? <span className="spinner" /> : <span className="chev"><Icon name="chevRight" /></span>}
          </button>
        </div>

        {/* 4. Riêng tư & bảo mật */}
        <div className="section-label"><Icon name="lock" /> Riêng tư &amp; bảo mật</div>
        <div className="group">
          <button type="button" className="cell" onClick={openBlockedAccountsSheet}>
            <span className="ic"><Icon name="ban" /></span>
            <span className="grow">Tài khoản đã bị chặn</span>
            {blockedCount > 0 ? <span className="val">{blockedCount}</span> : null}
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <div className="cell">
            <span className="ic"><Icon name="checkSquare" /></span>
            <span className="grow">
              Gửi xác nhận đã đọc
              <span className="sub">Cho bạn bè biết khi bạn đã đọc tin nhắn của họ</span>
            </span>
            <button
              type="button"
              className="switch gold-switch pressable"
              role="switch"
              aria-checked={readReceiptsOn ? 'true' : 'false'}
              aria-label="Gửi xác nhận đã đọc"
              onClick={() => setSetting('ghostRead', readReceiptsOn)}
            />
          </div>
          <button type="button" className="cell" onClick={() => ui.sheet(() => <PrivacyDataSheet />, { full: true })}>
            <span className="ic"><Icon name="cloud" /></span>
            <span className="grow">Quyền riêng tư và dữ liệu</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
        </div>

        {/* 5. Máy ảnh & Giao diện Web */}
        <div className="section-label"><Icon name="camera" /> Máy ảnh &amp; Giao diện</div>
        <div className="group">
          <Appearance />
          <Toggle k="mirrorFront" title="Lật ảnh camera trước" sub="Lưu ảnh selfie giống như bạn thấy trong khung ngắm" icon="camera" onChange={change} />
          <Toggle k="recordAudio" title="Ghi âm khi quay video" sub="Cần quyền micro của trình duyệt" icon="mic" onChange={change} />
          <Toggle k="saveAfterSend" title="Lưu vào máy sau khi gửi" sub="Tự tải ảnh/video về thiết bị" icon="download" onChange={change} />
        </div>

        {/* 6. Giới thiệu */}
        <div className="section-label"><Icon name="info" /> Giới thiệu</div>
        <div className="group">
          <a className="cell" href="https://www.tiktok.com/@locketcamera" target="_blank" rel="noopener noreferrer">
            <span className="ic"><Icon name="tiktok" /></span>
            <span className="grow">TikTok</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </a>
          <a className="cell" href="https://www.instagram.com/locketcamera" target="_blank" rel="noopener noreferrer">
            <span className="ic"><Icon name="instagram" /></span>
            <span className="grow">Instagram</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </a>
          <a className="cell" href="https://x.com/locketcamera" target="_blank" rel="noopener noreferrer">
            <span className="ic"><Icon name="twitter" /></span>
            <span className="grow">Twitter</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </a>
          <button type="button" className="cell" onClick={shareInvite}>
            <span className="ic"><Icon name="share" /></span>
            <span className="grow">Chia sẻ Locket</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={() => openFeedbackSheet('suggestion')}>
            <span className="ic"><Icon name="star" /></span>
            <span className="grow">Đánh giá Locket</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
          <button type="button" className="cell" onClick={() => openInfoSheet('terms')}>
            <span className="ic"><Icon name="info" /></span>
            <span className="grow">Điều khoản dịch vụ</span>
            <span className="chev"><Icon name="chevRight" /></span>
          </button>
        </div>

        {/* 7. Đăng xuất */}
        <div className="section-label" style={{ color: 'var(--danger)' }}>Tài khoản</div>
        <div className="group">
          <button type="button" className="cell danger" onClick={logout}>
            <span className="ic"><Icon name="logout" /></span>
            <span className="grow">Đăng xuất</span>
          </button>
        </div>

        <p className="footnote">{footerCredit || 'Ứng dụng web không chính thức. Token đăng nhập chỉ nằm trên máy chủ của bạn.'}</p>
        <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={onAvatarFile} />
      </div>
    </>
  );
}
