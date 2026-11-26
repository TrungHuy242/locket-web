// Desktop navigation rail (hidden on phones, where the Locket top bar + bottom dock do this job).
import { useEffect } from 'react';
import { Avatar } from '../components/Avatar.jsx';
import { getAppIconDataUrl, syncDocumentAppIcon } from '../lib/appIcons.js';
import { Icon } from '../lib/icons.jsx';
import { useSettings } from '../lib/settings.js';
import { useSiteConfig } from '../lib/siteConfig.js';
import { useApp } from '../store.js';
import { nav, useSection } from '../ui/nav.jsx';
import { homeBus } from './Home.jsx';

export function Sidebar() {
  const user = useApp((s) => s.user);
  const isAdmin = useApp((s) => s.isAdmin);
  const unread = useApp((s) => s.unread);
  const notifUnread = useApp((s) => s.notifUnread);
  const homeView = useApp((s) => s.homeView);
  const appName = useSiteConfig((s) => s.appName);
  const chatEnabled = useSiteConfig((s) => s.features.chat);
  const settings = useSettings();
  const hasGold = !!(user?.gold?.active || isAdmin);
  const effectiveIcon = hasGold ? (settings.appIcon || 'classic') : 'classic';
  const showGoldBadge = hasGold && settings.goldBadge !== false;
  const section = useSection();
  const active = section || homeView;

  useEffect(() => {
    syncDocumentAppIcon(settings.appIcon, hasGold);
  }, [settings.appIcon, hasGold]);

  const toHome = (target) => { nav.closeAll(); homeBus.go(target); };
  const item = (key, label, icon, onClick, extra = null) => (
    <button type="button" className={`side-item ${active === key ? 'on' : ''}`} title={label} onClick={onClick}>
      {icon}<span className="side-label">{label}</span>{extra}
    </button>
  );

  const customIconUrl = effectiveIcon !== 'classic' ? getAppIconDataUrl(effectiveIcon, 96) : '';

  return (
    <nav className="sidebar" aria-label="Điều hướng">
      <div className="side-brand">
        {customIconUrl ? (
          <img className="brand-mark custom-app-mark" src={customIconUrl} alt="" />
        ) : (
          <span className="brand-mark"><Icon name="heart" /></span>
        )}
        <span className="word">{appName}</span>
      </div>
      {item('camera', 'Camera', <Icon name="camera" />, () => toHome('camera'))}
      {item('feed', 'Lịch sử', <Icon name="grid" />, () => toHome('feed'))}
      {item('memories', 'Kỷ niệm', <Icon name="heart" />, () => nav.openRoot('memories'))}
      {item('friends', 'Bạn bè', <Icon name="people" />, () => nav.openRoot('friends', {}, 'right'))}
      {(chatEnabled || isAdmin) ? item('chat', 'Tin nhắn', <Icon name="chat" />, () => nav.openRoot('chat'), unread ? <i className="badge">{unread > 9 ? '9+' : unread}</i> : null) : null}
      {item('notifications', 'Thông báo', <Icon name="bell" />, () => nav.openRoot('notifications'), notifUnread ? <i className="badge">{notifUnread > 9 ? '9+' : notifUnread}</i> : null)}
      {item('profile', 'Hồ sơ', <Avatar user={user} goldBadge={showGoldBadge} />, () => nav.openRoot('profile', {}, 'right'))}
      <span className="side-spacer" />
      {isAdmin ? item('admin', 'Quản trị', <Icon name="shield" />, () => nav.openRoot('admin')) : null}
      {item('settings', 'Cài đặt', <Icon name="gear" />, () => nav.openRoot('settings'))}
    </nav>
  );
}
