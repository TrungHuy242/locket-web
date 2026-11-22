// App-level status: the offline / server-unreachable banner, the "reconnected" signal, the
// "new version available" prompt from the service worker, and React error boundaries.
import { Component, useEffect, useRef } from 'react';
import { Icon } from '../lib/icons.jsx';
import { applyUpdate, pwaStore } from '../lib/pwa.js';
import { ui } from '../ui/overlays.jsx';
import { Button, StateView } from '../ui/kit.jsx';

export const RECONNECT_EVENT = 'locket:reconnect';

export function AppStatus({ banner = true }) {
  const online = pwaStore.use((s) => s.online);
  const serverDown = pwaStore.use((s) => s.serverDown);
  const updateReady = pwaStore.use((s) => s.updateReady);
  const down = !online || serverDown;
  const wasDown = useRef(false);

  useEffect(() => {
    if (down) { wasDown.current = true; return; }
    if (wasDown.current) {
      wasDown.current = false;
      ui.success('Đã kết nối lại');
      window.dispatchEvent(new Event(RECONNECT_EVENT));   // screens reload what they show
    }
  }, [down]);

  return (
    <>
      {down && banner ? (
        <div className="net-banner" role="status">
          <Icon name="info" />
          <span>{!online ? 'Không có kết nối mạng. Sẽ tự cập nhật khi có mạng trở lại.' : 'Không kết nối được máy chủ. Đang thử lại…'}</span>
        </div>
      ) : null}
      {updateReady ? (
        <div className="update-pill" role="status">
          <span>Đã có phiên bản mới</span>
          <button type="button" onClick={applyUpdate}>Cập nhật</button>
        </div>
      ) : null}
    </>
  );
}

export function OfflineScreen({ onRetry, busy }) {
  const online = pwaStore.use((s) => s.online);
  return (
    <div className="offline-screen">
      <img src="/icons/icon-192.png" alt="" width="72" height="72" />
      <b>{online ? 'Đang kết nối lại máy chủ…' : 'Bạn đang ngoại tuyến'}</b>
      <p>{online
        ? 'Máy chủ có thể đang khởi động lại sau bản cập nhật. Ứng dụng sẽ tự mở lại sau vài giây.'
        : 'Locket cần kết nối mạng để đăng nhập và tải khoảnh khắc. Ứng dụng sẽ tự mở lại khi có mạng.'}</p>
      <Button variant="primary" loading={busy} onClick={onRetry}>Thử lại ngay</Button>
    </div>
  );
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[Locket UI error]', error, info?.componentStack);
  }

  reset = () => { this.setState({ error: null }); };

  render() {
    if (!this.state.error) return this.props.children;
    const { inline = false, title = 'Đã xảy ra sự cố hiển thị', onClose } = this.props;
    if (inline) {
      return (
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 }}>
          <StateView icon="warning" tone="error" title={title}
            text="Màn hình này gặp lỗi bất ngờ. Bạn có thể thử mở lại hoặc đóng màn hình này."
            action="Thử lại" onAction={this.reset} />
          {onClose ? <Button variant="plain" size="sm" onClick={() => { this.reset(); onClose(); }}>Quay lại</Button> : null}
        </div>
      );
    }
    return (
      <div className="offline-screen">
        <img src="/icons/icon-192.png" alt="" width="72" height="72" />
        <b>{title}</b>
        <p>Ứng dụng vừa gặp lỗi không mong muốn. Hãy thử khôi phục hoặc tải lại trang.</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="secondary" onClick={this.reset}>Thử lại</Button>
          <Button variant="primary" onClick={() => window.location.reload()}>Tải lại</Button>
        </div>
      </div>
    );
  }
}
