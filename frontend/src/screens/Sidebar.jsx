// Desktop navigation rail (hidden on phones, where the Locket top bar does this job).
import { Avatar } from '../components/Avatar.jsx';
import { Icon } from '../lib/icons.jsx';
import { useApp } from '../store.js';
import { nav, useSection } from '../ui/nav.jsx';
import { homeBus } from './Home.jsx';

export function Sidebar() {
  const user = useApp((s) => s.user);
  const unread = useApp((s) => s.unread);
  const notifUnread = useApp((s) => s.notifUnread);
  const homeView = useApp((s) => s.homeView);
  const section = useSection();
  const active = section || homeView;

  const toHome = (target) => { nav.closeAll(); homeBus.go(target); };
  const item = (key, label, icon, onClick, extra = null) => (
    <button type="button" className={`side-item ${active === key ? 'on' : ''}`} title={label} onClick={onClick}>
      {icon}<span className="side-label">{label}</span>{extra}
    </button>
  );

  return (
    <nav className="sidebar" aria-label="Điều hướng">
      <div className="side-brand"><span className="brand-mark"><Icon name="heart" /></span><span className="word">Locket</span></div>
      {item('camera', 'Camera', <Icon name="camera" />, () => toHome('camera'))}
      {item('feed', 'Lịch sử', <Icon name="grid" />, () => toHome('feed'))}
      {item('memories', 'Kỷ niệm', <Icon name="heart" />, () => nav.openRoot('memories'))}
      {item('friends', 'Bạn bè', <Icon name="people" />, () => nav.openRoot('friends', {}, 'right'))}
      {item('chat', 'Tin nhắn', <Icon name="chat" />, () => nav.openRoot('chat'), unread ? <i className="badge">{unread > 9 ? '9+' : unread}</i> : null)}
      {item('notifications', 'Thông báo', <Icon name="bell" />, () => nav.openRoot('notifications'), notifUnread ? <i className="badge">{notifUnread > 9 ? '9+' : notifUnread}</i> : null)}
      {item('profile', 'Hồ sơ', <Avatar user={user} />, () => nav.openRoot('profile', {}, 'right'))}
      <span className="side-spacer" />
      {item('settings', 'Cài đặt', <Icon name="gear" />, () => nav.openRoot('settings'))}
    </nav>
  );
}
